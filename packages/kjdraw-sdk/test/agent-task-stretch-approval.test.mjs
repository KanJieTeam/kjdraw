import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentTaskToolBinding, runPersistedKJAgentTask } from '../src/agent-task-runner.js'
import { createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'

const actor = { kind: 'host', id: 'atomic-stretch-test' }
const at = second => `2026-09-12T15:00:${String(second).padStart(2, '0')}.000Z`
const toolNames = ['cad_check_geometry', 'cad_propose_stretch']

async function fixture(expectedLength = 15) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `atomic-stretch-${Math.random()}`, units: 'millimeter' })
  await document.transact('Seed drawing', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'edge' })
    tx.createEntity('LINE', { start: [100, 0, 0], end: [110, 0, 0] }, { id: 'outside' })
  })
  const session = new KJAgentToolSession(sdk, document)
  const definition = {
    requirements: [{
      id: 'edge_length', description: 'Stretch the endpoint to the required length.',
      check: {
        toolName: 'cad_check_geometry', assertion: { path: 'passed', operator: 'is_true', expected: true },
        geometryCheck: { id: 'edge_length', kind: 'line-length', objectId: 'edge', expected: expectedLength, tolerance: 0 },
      },
    }],
    steps: [{ id: 'stretch', title: 'Stretch and verify the edge', requirementIds: ['edge_length'] }],
    tools: createAgentTaskToolBinding(session.definitions, toolNames), capabilities: [],
  }
  await document.transact('Create task', tx => createAgentTask(document, tx, {
    id: 'task-stretch', expectedRevision: document.revision, title: 'Atomic stretch task', goal: 'Stretch only the selected endpoint.',
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
    id: 'stretch-edge', name: 'cad_propose_stretch', arguments: {
      expectedRevision: revision, units: 'millimeter', ids,
      crossingStart: { x: 9, y: -1 }, crossingEnd: { x: 11, y: 1 }, dx: 5, dy: 0,
    },
  }] }) }) }
  return runPersistedKJAgentTask({
    document: value.document, session: value.session, model, taskId: value.task.id,
    expectedRevision: revision, expectedTaskVersion: value.task.taskVersion, expectedStatus: 'running',
    toolNames, maxTurns: 2, maxToolCalls: 2,
  })
}

test('persisted STRETCH commits exact geometry, checks and task completion in one undo unit', async () => {
  const value = await fixture(), before = value.document.serialize(), revision = value.document.revision
  const proposed = await propose(value), planId = proposed.proposalIds[0]
  assert.equal(proposed.status, 'awaiting-approval')
  assert.equal(value.document.serialize(), before)
  assert.equal((await value.session.approve(planId, 'reviewer')).ok, false)
  const approved = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(approved.ok, true, JSON.stringify(approved))
  assert.equal(approved.value.command, 'STRETCH')
  assert.equal(value.document.revision, revision + 1)
  assert.deepEqual(value.document.getObject('edge').payload.start, [0, 0, 0])
  assert.deepEqual(value.document.getObject('edge').payload.end, [15, 0, 0])
  assert.deepEqual(value.document.getObject('outside').payload.end, [110, 0, 0])
  const task = readAgentTasks(value.document)[0]
  assert.equal(task.status, 'completed')
  assert.equal(task.receipts[0].command, 'STRETCH')
  assert.equal(task.receipts[0].sourceToolName, 'cad_propose_stretch')
  assert.equal(task.receipts[0].checks[0].actual, 15)
  await value.document.undo()
  assert.deepEqual(value.document.getObject('edge').payload.end, [10, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  await value.document.redo()
  assert.deepEqual(value.document.getObject('edge').payload.end, [15, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'completed')
  const reopened = await createKJDrawSDK().readDocument(await value.sdk.writeDocument(value.document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(readAgentTasks(reopened), readAgentTasks(value.document))
  const packageBytes = await createKjpPackage({ projectId: 'atomic-stretch-project', drawings: { [value.document.id]: value.document }, activeDrawing: value.document.id, createdAt: at(4), modifiedAt: at(4) })
  assert.deepEqual(readAgentTasks((await openKjpPackage(packageBytes)).activeDocument), readAgentTasks(value.document))
})

test('STRETCH check failure rolls back geometry, task, revision and history', async () => {
  const value = await fixture(14), planId = (await propose(value)).proposalIds[0]
  const before = value.document.serialize(), revision = value.document.revision, history = value.document.snapshot().revisions.length
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /does not satisfy/)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.document.snapshot().revisions.length, history)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
})

test('STRETCH refuses out-of-scope targets and drawing revision drift', async () => {
  const outside = await fixture(), outsidePlan = (await propose(outside, ['outside'])).proposalIds[0]
  const outsideBefore = outside.document.serialize()
  assert.equal((await outside.session.approveTask(outsidePlan, 'reviewer', at(4))).ok, false)
  assert.equal(outside.document.serialize(), outsideBefore)

  const stale = await fixture(), stalePlan = (await propose(stale)).proposalIds[0]
  await stale.document.transact('Concurrent edit', tx => tx.updateObject('outside', { payload: { start: [101, 0, 0], end: [111, 0, 0] } }))
  const staleBefore = stale.document.serialize()
  assert.equal((await stale.session.approveTask(stalePlan, 'reviewer', at(4))).ok, false)
  assert.equal(stale.document.serialize(), staleBefore)

  const replaced = await fixture(), replacedPlan = (await propose(replaced)).proposalIds[0], replacedBefore = replaced.document.serialize()
  replaced.sdk.commands.register({ id: 'STRETCH', title: 'Replaced', execute: () => null }, { owner: 'test', replace: true })
  assert.equal((await replaced.session.approveTask(replacedPlan, 'reviewer', at(4))).ok, false)
  assert.equal(replaced.document.serialize(), replacedBefore)
})
