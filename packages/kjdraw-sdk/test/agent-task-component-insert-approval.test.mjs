import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentTaskToolBinding, runPersistedKJAgentTask } from '../src/agent-task-runner.js'
import { createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { stableHash } from '../src/utils.js'

const actor = { kind: 'host', id: 'atomic-component-test' }
const at = second => `2026-09-14T02:00:${String(second).padStart(2, '0')}.000Z`
const toolNames = ['cad_check_geometry', 'cad_propose_component_insert']

async function fixture(expectedRadius = 60, reuseDefinition = false) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `atomic-component-${Math.random()}`, units: 'millimeter' })
  if (reuseDefinition) await sdk.executeCommand('COMPONENTINSERT', {
    componentId: 'org.kjdraw.mechanical.four-hole-flange', version: '1.0.0', units: 'millimeter',
    parameters: { outerDiameter: 120, boreDiameter: 50, boltCircleDiameter: 90, holeDiameter: 12, holeCount: 4 }, position: [-200, 0], scale: 1, rotation: 0,
  }, { document, expectedRevision: document.revision })
  const session = new KJAgentToolSession(sdk, document)
  const definition = {
    requirements: [{
      id: 'outer_radius', description: 'The reviewed native flange has the required outer radius.',
      check: {
        toolName: 'cad_check_geometry', assertion: { path: 'passed', operator: 'is_true', expected: true },
        geometryCheck: { id: 'outer_radius', kind: 'circle-radius', objectId: 'created:0', expected: expectedRadius, tolerance: 0 },
      },
    }],
    steps: [{ id: 'insert', title: 'Insert and verify the reusable flange', requirementIds: ['outer_radius'] }],
    tools: createAgentTaskToolBinding(session.definitions, toolNames), capabilities: [],
  }
  await document.transact('Create task', tx => createAgentTask(document, tx, {
    id: 'task-component', expectedRevision: document.revision, title: 'Atomic component task', goal: 'Insert one reusable native four-hole flange.',
    entityIds: [], definition, at: at(1), actor,
  }))
  for (const [status, second] of [['ready', 2], ['running', 3]]) {
    const task = readAgentTasks(document)[0]
    await document.transact(`Task ${status}`, tx => transitionAgentTask(document, tx, {
      id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: task.status,
      to: status, at: at(second), actor, reason: `Task is ${status}.`,
    }))
  }
  return { sdk, document, session, task: readAgentTasks(document)[0] }
}

async function propose(value) {
  const revision = value.document.revision
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [{
    id: 'insert-flange', name: 'cad_propose_component_insert', arguments: {
      expectedRevision: revision, units: 'millimeter', componentId: 'org.kjdraw.mechanical.four-hole-flange', version: '1.0.0',
      parameters: [{ name: 'outerDiameter', value: 120 }, { name: 'boreDiameter', value: 50 }, { name: 'boltCircleDiameter', value: 90 }, { name: 'holeDiameter', value: 12 }, { name: 'holeCount', value: 4 }],
      position: { x: 100, y: 200 }, scale: 1, rotationDegrees: 0,
    },
  }] }) }) }
  return runPersistedKJAgentTask({
    document: value.document, session: value.session, model, taskId: value.task.id,
    expectedRevision: revision, expectedTaskVersion: value.task.taskVersion, expectedStatus: 'running',
    toolNames, maxTurns: 2, maxToolCalls: 2,
  })
}

test('persisted COMPONENTINSERT atomically commits native block members, insert, dependencies and receipt', async () => {
  const value = await fixture(), before = value.document.serialize(), revision = value.document.revision
  const proposed = await propose(value), planId = proposed.proposalIds[0]
  assert.equal(proposed.status, 'awaiting-approval')
  assert.equal(value.document.serialize(), before)
  assert.equal((await value.session.approve(planId, 'reviewer')).ok, false)
  const argumentsDigest = stableHash(proposed.outputs[0].result.value.arguments)
  const identity = proposed.outputs[0].result.value.arguments.identity
  const approved = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(approved.ok, true, JSON.stringify(approved))
  assert.equal(approved.value.command, 'COMPONENTINSERT')
  assert.equal(value.document.revision, revision + 1)
  assert.equal(value.document.getObject(identity.insertId).type, 'INSERT')
  const task = readAgentTasks(value.document)[0]
  assert.equal(task.status, 'completed')
  assert.deepEqual(task.scope.members.map(member => member.id), [...identity.memberIds, identity.insertId])
  assert.deepEqual(task.scope.relations.map(relation => relation.id), [identity.definitionId])
  assert.equal(task.receipts[0].command, 'COMPONENTINSERT')
  assert.equal(task.receipts[0].argumentsDigest, argumentsDigest)
  assert.equal(task.receipts[0].checks[0].actual, 60)
  await value.document.undo()
  assert.equal(value.document.getObject(identity.insertId), null)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  await value.document.redo()
  assert.equal(value.document.getObject(identity.insertId).type, 'INSERT')
  const reopened = await createKJDrawSDK().readDocument(await value.sdk.writeDocument(value.document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(readAgentTasks(reopened), readAgentTasks(value.document))
})

test('persisted COMPONENTINSERT safely reuses and locks an existing exact block definition', async () => {
  const value = await fixture(60, true), proposed = await propose(value)
  const proposalArguments = proposed.outputs[0].result.value.arguments, beforeCount = value.document.listEntities().length
  const approved = await value.session.approveTask(proposed.proposalIds[0], 'reviewer', at(4))
  assert.equal(approved.ok, true, JSON.stringify(approved))
  assert.equal(value.document.listEntities().length, beforeCount + 1)
  const task = readAgentTasks(value.document)[0]
  assert.deepEqual(task.scope.members.map(member => member.id), [...proposalArguments.identity.memberIds, proposalArguments.identity.insertId])
  assert.deepEqual(task.scope.relations.map(relation => relation.id), [proposalArguments.identity.definitionId])
})

test('COMPONENTINSERT validation failure rolls back block, members, insert, task and history', async () => {
  const value = await fixture(61), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), revision = value.document.revision, history = value.document.snapshot().revisions.length
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /does not satisfy/)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.document.snapshot().revisions.length, history)
  assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
})

test('COMPONENTINSERT rejects a replaced command without mutation or plan consumption', async () => {
  const value = await fixture(), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), revision = value.document.revision
  value.sdk.commands.register({ id: 'COMPONENTINSERT', execute() { throw new Error('must not execute') } }, { replace: true, owner: 'forged' })
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
})

test('authoritative COMPONENTINSERT uncertainty rolls back local state and forbids replay', async () => {
  const value = await fixture(), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), state = value.document.toJSON()
  value.document.bindAuthority({ serialize: () => structuredClone(state), close() {}, commit() { throw new Error('response lost') } })
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.equal(value.document.serialize(), before)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.equal(value.sdk.agentPlans.get(planId).status, 'consumed')
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
})
