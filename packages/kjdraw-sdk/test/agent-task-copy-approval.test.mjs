import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentTaskToolBinding, runPersistedKJAgentTask } from '../src/agent-task-runner.js'
import { createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { stableHash } from '../src/utils.js'

const actor = { kind: 'host', id: 'atomic-copy-test' }
const at = second => `2026-09-14T01:00:${String(second).padStart(2, '0')}.000Z`
const toolNames = ['cad_check_geometry', 'cad_propose_copy']

async function fixture(expectedDistance = 25) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `atomic-copy-${Math.random()}`, units: 'millimeter' })
  await document.transact('Seed drawing', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'edge' })
    tx.createEntity('LINE', { start: [100, 0, 0], end: [110, 0, 0] }, { id: 'outside' })
  })
  const session = new KJAgentToolSession(sdk, document)
  const definition = {
    requirements: [{
      id: 'copy_offset',
      description: 'The reviewed copy starts at the required distance from its source.',
      check: {
        toolName: 'cad_check_geometry', assertion: { path: 'passed', operator: 'is_true', expected: true },
        geometryCheck: { id: 'copy_offset', kind: 'point-distance', from: { objectId: 'created:0', feature: 'start' }, to: { objectId: 'edge', feature: 'start' }, expected: expectedDistance, tolerance: 0 },
      },
    }],
    steps: [{ id: 'copy', title: 'Copy and verify the edge', requirementIds: ['copy_offset'] }],
    tools: createAgentTaskToolBinding(session.definitions, toolNames), capabilities: [],
  }
  await document.transact('Create task', tx => createAgentTask(document, tx, {
    id: 'task-copy', expectedRevision: document.revision, title: 'Atomic copy task', goal: 'Copy the edge by 25 millimeters.',
    entityIds: ['edge'], definition, at: at(1), actor,
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

async function propose(value, ids = ['edge']) {
  const revision = value.document.revision
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [{
    id: 'copy-edge', name: 'cad_propose_copy', arguments: { expectedRevision: revision, units: 'millimeter', ids, dx: 25, dy: 0 },
  }] }) }) }
  return runPersistedKJAgentTask({
    document: value.document, session: value.session, model, taskId: value.task.id,
    expectedRevision: revision, expectedTaskVersion: value.task.taskVersion, expectedStatus: 'running',
    toolNames, maxTurns: 2, maxToolCalls: 2,
  })
}

test('persisted COPY commits reviewed new geometry, deterministic evidence and expanded scope in one undo unit', async () => {
  const value = await fixture(), before = value.document.serialize(), revision = value.document.revision
  const proposed = await propose(value), planId = proposed.proposalIds[0]
  assert.equal(proposed.status, 'awaiting-approval')
  assert.equal(value.document.serialize(), before)
  assert.equal((await value.session.approve(planId, 'reviewer')).ok, false)
  const argumentsDigest = stableHash(proposed.outputs[0].result.value.arguments)
  const copiedId = proposed.outputs[0].result.value.arguments.resultIds[0]
  const approved = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(approved.ok, true, JSON.stringify(approved))
  assert.equal(approved.value.command, 'COPY')
  assert.equal(value.document.revision, revision + 1)
  assert.deepEqual(value.document.getObject(copiedId).payload.start, [25, 0, 0])
  const task = readAgentTasks(value.document)[0]
  assert.equal(task.status, 'completed')
  assert.deepEqual(task.scope.members.map(member => member.id), ['edge', copiedId])
  assert.equal(task.receipts[0].command, 'COPY')
  assert.equal(task.receipts[0].argumentsDigest, argumentsDigest)
  assert.equal(task.receipts[0].checks[0].actual, 25)
  assert.equal(task.receipts[0].checks[0].references[0].objectId, copiedId)
  await value.document.undo()
  assert.equal(value.document.getObject(copiedId), null)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  await value.document.redo()
  assert.deepEqual(value.document.getObject(copiedId).payload.start, [25, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'completed')
  const reopened = await createKJDrawSDK().readDocument(await value.sdk.writeDocument(value.document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(readAgentTasks(reopened), readAgentTasks(value.document))
})

test('COPY check failure rolls back geometry, task, revision and history without consuming the plan', async () => {
  const value = await fixture(30), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), revision = value.document.revision, history = value.document.snapshot().revisions.length
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /does not satisfy/)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.document.snapshot().revisions.length, history)
  assert.equal(value.document.listEntities().length, 2)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
})

test('COPY cannot use a source outside the persisted task scope', async () => {
  const value = await fixture(), proposed = await propose(value, ['outside']), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), revision = value.document.revision
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /persisted task scope/)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.document.listEntities().length, 2)
  assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
})

test('COPY rejects a replaced command without mutation or plan consumption', async () => {
  const value = await fixture(), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), revision = value.document.revision
  value.sdk.commands.register({ id: 'COPY', execute() { throw new Error('must not execute') } }, { replace: true, owner: 'forged' })
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
})

test('authoritative COPY uncertainty rolls back local state and forbids replay', async () => {
  const value = await fixture(), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), state = value.document.toJSON()
  value.document.bindAuthority({ serialize: () => structuredClone(state), close() {}, commit() { throw new Error('response lost') } })
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.listEntities().length, 2)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.equal(value.sdk.agentPlans.get(planId).status, 'consumed')
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
})
