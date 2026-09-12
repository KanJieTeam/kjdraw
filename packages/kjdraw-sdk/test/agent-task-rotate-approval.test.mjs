import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentTaskToolBinding, runPersistedKJAgentTask } from '../src/agent-task-runner.js'
import { createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'
import { stableHash } from '../src/utils.js'

const actor = { kind: 'host', id: 'atomic-rotate-test' }
const at = second => '2026-09-12T10:00:' + String(second).padStart(2, '0') + '.000Z'
const toolNames = ['cad_check_geometry', 'cad_propose_rotate']
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, actual + ' != ' + expected)

async function fixture(expectedDistance = 5) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'atomic-rotate-' + Math.random(), units: 'millimeter' })
  await document.transact('Seed drawing', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'edge' })
    tx.createEntity('LINE', { start: [0, 15, 0], end: [10, 15, 0] }, { id: 'anchor' })
    tx.createEntity('LINE', { start: [100, 0, 0], end: [110, 0, 0] }, { id: 'outside' })
  })
  const session = new KJAgentToolSession(sdk, document)
  const definition = {
    requirements: [{
      id: 'rotated_end_to_anchor',
      description: 'Rotate the edge so its end is five millimeters from the fixed anchor.',
      check: {
        toolName: 'cad_check_geometry', assertion: { path: 'passed', operator: 'is_true', expected: true },
        geometryCheck: { id: 'rotated_end_to_anchor', kind: 'point-distance', from: { objectId: 'edge', feature: 'end' }, to: { objectId: 'anchor', feature: 'start' }, expected: expectedDistance, tolerance: 1e-9 },
      },
    }],
    steps: [{ id: 'rotate', title: 'Rotate and verify the edge', requirementIds: ['rotated_end_to_anchor'] }],
    tools: createAgentTaskToolBinding(session.definitions, toolNames), capabilities: [],
  }
  await document.transact('Create task', tx => createAgentTask(document, tx, {
    id: 'task-rotate', expectedRevision: document.revision, title: 'Atomic rotate task', goal: 'Rotate only the edge by ninety degrees.',
    entityIds: ['edge', 'anchor'], definition, at: at(1), actor,
  }))
  for (const [status, second] of [['ready', 2], ['running', 3]]) {
    const task = readAgentTasks(document)[0]
    await document.transact('Task ' + status, tx => transitionAgentTask(document, tx, {
      id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: task.status,
      to: status, at: at(second), actor, reason: 'Task is ' + status + '.',
    }))
  }
  return { sdk, document, session, task: readAgentTasks(document)[0] }
}

async function propose(value, ids = ['edge']) {
  const revision = value.document.revision
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [{
    id: 'rotate-edge', name: 'cad_propose_rotate', arguments: { expectedRevision: revision, units: 'millimeter', ids, center: { x: 0, y: 0 }, angleDegrees: 90 },
  }] }) }) }
  return runPersistedKJAgentTask({
    document: value.document, session: value.session, model, taskId: value.task.id,
    expectedRevision: revision, expectedTaskVersion: value.task.taskVersion, expectedStatus: 'running',
    toolNames, maxTurns: 2, maxToolCalls: 2,
  })
}

test('persisted ROTATE commits reviewed geometry, checks and task completion in one undo unit', async () => {
  const value = await fixture(), before = value.document.serialize(), revision = value.document.revision, edgeHandle = value.document.getObject('edge').handle
  const proposed = await propose(value), planId = proposed.proposalIds[0]
  assert.equal(proposed.status, 'awaiting-approval')
  assert.equal(value.document.serialize(), before)
  assert.equal((await value.session.approve(planId, 'reviewer')).ok, false)
  const approved = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(approved.ok, true, JSON.stringify(approved))
  assert.equal(approved.value.command, 'ROTATE')
  assert.equal(value.document.revision, revision + 1)
  const end = value.document.getObject('edge').payload.end
  close(end[0], 0); close(end[1], 10); close(end[2], 0)
  assert.deepEqual(value.document.getObject('anchor').payload.start, [0, 15, 0])
  const task = readAgentTasks(value.document)[0]
  assert.equal(task.status, 'completed')
  assert.equal(task.receipts[0].command, 'ROTATE')
  assert.equal(task.receipts[0].sourceToolName, 'cad_propose_rotate')
  assert.equal(task.receipts[0].argumentsDigest, stableHash(proposed.outputs[0].result.value.arguments))
  assert.equal(task.receipts[0].checks[0].actual, 5)
  assert.equal(value.document.getObject('edge').handle, edgeHandle)
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
  await value.document.undo()
  assert.deepEqual(value.document.getObject('edge').payload.end, [10, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  await value.document.redo()
  close(value.document.getObject('edge').payload.end[1], 10)
  assert.equal(readAgentTasks(value.document)[0].status, 'completed')

  const kjd = await value.sdk.writeDocument(value.document, { format: 'KJD' })
  assert.deepEqual(readAgentTasks(await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })), readAgentTasks(value.document))
  const kjp = await createKjpPackage({ projectId: 'atomic-rotate-project', drawings: { [value.document.id]: value.document }, activeDrawing: value.document.id, createdAt: at(4), modifiedAt: at(4) })
  assert.deepEqual(readAgentTasks((await openKjpPackage(kjp)).activeDocument), readAgentTasks(value.document))
})

test('ROTATE check failure rolls back geometry, task, revision and history without consuming the plan', async () => {
  const value = await fixture(4), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), revision = value.document.revision, history = value.document.snapshot().revisions.length
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /does not satisfy/)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.document.snapshot().revisions.length, history)
  assert.deepEqual(value.document.getObject('edge').payload.end, [10, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.deepEqual(readAgentTasks(value.document)[0].receipts, [])
  assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
})

test('ROTATE refuses out-of-scope targets, revision drift and command replacement', async () => {
  const outside = await fixture(), outsidePlan = (await propose(outside, ['outside'])).proposalIds[0], beforeOutside = outside.document.serialize()
  assert.equal((await outside.session.approveTask(outsidePlan, 'reviewer', at(4))).ok, false)
  assert.equal(outside.document.serialize(), beforeOutside)
  assert.equal(outside.sdk.agentPlans.get(outsidePlan).status, 'active')

  const stale = await fixture(), stalePlan = (await propose(stale)).proposalIds[0]
  await stale.document.transact('Host edit', tx => tx.updateObject('outside', { payload: { start: [101, 0, 0], end: [111, 0, 0] } }))
  const staleBefore = stale.document.serialize(), staleRevision = stale.document.revision
  assert.equal((await stale.session.approveTask(stalePlan, 'reviewer', at(4))).ok, false)
  assert.equal(stale.document.serialize(), staleBefore)
  assert.equal(stale.document.revision, staleRevision)

  const replaced = await fixture(), replacedPlan = (await propose(replaced)).proposalIds[0], replacedBefore = replaced.document.serialize()
  replaced.sdk.commands.register({ id: 'ROTATE', execute() { throw new Error('must not execute') } }, { replace: true, owner: 'forged' })
  assert.equal((await replaced.session.approveTask(replacedPlan, 'reviewer', at(4))).ok, false)
  assert.equal(replaced.document.serialize(), replacedBefore)
  assert.equal(replaced.sdk.agentPlans.get(replacedPlan).status, 'active')
})

test('authoritative ROTATE uncertainty rolls back local state and forbids replay', async () => {
  const value = await fixture(), planId = (await propose(value)).proposalIds[0]
  const before = value.document.serialize(), state = value.document.toJSON()
  value.document.bindAuthority({ serialize: () => structuredClone(state), close() {}, commit() { throw new Error('response lost') } })
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.equal(value.document.serialize(), before)
  assert.deepEqual(value.document.getObject('edge').payload.end, [10, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.equal(value.sdk.agentPlans.get(planId).status, 'consumed')
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
})
