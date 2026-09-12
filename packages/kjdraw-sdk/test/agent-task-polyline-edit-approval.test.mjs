import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentTaskToolBinding, runPersistedKJAgentTask } from '../src/agent-task-runner.js'
import { createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'

const actor = { kind: 'host', id: 'atomic-pedit-test' }
const at = second => '2026-09-13T01:00:' + String(second).padStart(2, '0') + '.000Z'
const toolNames = ['cad_check_geometry', 'cad_propose_polyline_edit']
const signedBulge = -Math.tan(Math.PI / 8)

async function fixture(requirements) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'atomic-pedit-' + Math.random(), units: 'millimeter' })
  await document.transact('Seed drawing', tx => {
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [10, 0], [20, 0]], closed: false }, { id: 'path' })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 10], [10, 10]], closed: false }, { id: 'outside' })
  })
  const session = new KJAgentToolSession(sdk, document)
  const definition = {
    requirements: requirements.map(check => ({
      id: check.id, description: 'Verify ' + check.kind + ' after the reviewed edit.',
      check: { toolName: 'cad_check_geometry', assertion: { path: 'passed', operator: 'is_true', expected: true }, geometryCheck: check },
    })),
    steps: [{ id: 'edit', title: 'Edit and verify the native polyline', requirementIds: requirements.map(check => check.id) }],
    tools: createAgentTaskToolBinding(session.definitions, toolNames), capabilities: [],
  }
  await document.transact('Create task', tx => createAgentTask(document, tx, {
    id: 'task-pedit', expectedRevision: document.revision, title: 'Atomic polyline edit task',
    goal: 'Modify exactly one native polyline without replacing its identity.',
    entityIds: ['path'], definition, at: at(1), actor,
  }))
  for (const [status, second] of [['ready', 2], ['running', 3]]) {
    const task = readAgentTasks(document)[0]
    await document.transact('Task ' + status, tx => transitionAgentTask(document, tx, {
      id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion,
      expectedStatus: task.status, to: status, at: at(second), actor, reason: 'Task is ' + status + '.',
    }))
  }
  return { sdk, document, session, task: readAgentTasks(document)[0] }
}

async function propose(value, arguments_) {
  const revision = value.document.revision
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [{
    id: 'edit-path', name: 'cad_propose_polyline_edit',
    arguments: { expectedRevision: revision, units: 'millimeter', ...arguments_ },
  }] }) }) }
  return runPersistedKJAgentTask({
    document: value.document, session: value.session, model, taskId: value.task.id,
    expectedRevision: revision, expectedTaskVersion: value.task.taskVersion, expectedStatus: 'running',
    toolNames, maxTurns: 2, maxToolCalls: 2,
  })
}

test('persisted PEDIT INSERT commits exact vertex evidence and task completion atomically', async () => {
  const requirements = [
    { id: 'vertex_count', kind: 'polyline-vertex-count', objectId: 'path', expected: 4, tolerance: 0 },
    { id: 'left_half', kind: 'point-distance', from: { objectId: 'path', feature: 'vertex', vertexIndex: 0 }, to: { objectId: 'path', feature: 'vertex', vertexIndex: 1 }, expected: 5, tolerance: 0 },
    { id: 'right_half', kind: 'point-distance', from: { objectId: 'path', feature: 'vertex', vertexIndex: 1 }, to: { objectId: 'path', feature: 'vertex', vertexIndex: 2 }, expected: 5, tolerance: 0 },
  ]
  const value = await fixture(requirements), before = value.document.serialize(), revision = value.document.revision
  const proposed = await propose(value, { id: 'path', operation: 'INSERT', segmentIndex: 0, point: { x: 5, y: 0 } })
  const planId = proposed.proposalIds[0]
  assert.equal(proposed.status, 'awaiting-approval')
  assert.equal(value.document.serialize(), before)
  assert.equal((await value.session.approve(planId, 'reviewer')).ok, false)
  const approved = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(approved.ok, true, JSON.stringify(approved))
  assert.equal(approved.value.command, 'PEDIT')
  assert.equal(value.document.revision, revision + 1)
  assert.deepEqual(value.document.getObject('path').payload.vertices.map(vertex => vertex.point), [[0, 0, 0], [5, 0, 0], [10, 0, 0], [20, 0, 0]])
  const task = readAgentTasks(value.document)[0]
  assert.equal(task.status, 'completed')
  assert.equal(task.receipts[0].command, 'PEDIT')
  assert.deepEqual(task.receipts[0].checks.map(check => check.actual), [4, 5, 5])
  await value.document.undo()
  assert.equal(value.document.getObject('path').payload.vertices.length, 3)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  await value.document.redo()
  assert.equal(value.document.getObject('path').payload.vertices.length, 4)
  const reopened = await createKJDrawSDK().readDocument(await value.sdk.writeDocument(value.document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(readAgentTasks(reopened), readAgentTasks(value.document))
  const bytes = await createKjpPackage({ projectId: 'pedit-project', drawings: { [value.document.id]: value.document }, activeDrawing: value.document.id, createdAt: at(4), modifiedAt: at(4) })
  assert.deepEqual(readAgentTasks((await openKjpPackage(bytes)).activeDocument), readAgentTasks(value.document))
})

test('persisted PEDIT SET_BULGE records the signed native segment value', async () => {
  const value = await fixture([{ id: 'signed_bulge', kind: 'polyline-segment-bulge', objectId: 'path', segmentIndex: 0, expected: signedBulge, tolerance: 1e-12 }])
  const planId = (await propose(value, { id: 'path', operation: 'SET_BULGE', segmentIndex: 0, sweepDegrees: -90 })).proposalIds[0]
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.ok(Math.abs(value.document.getObject('path').payload.vertices[0].bulge - signedBulge) <= 1e-12)
  assert.equal(readAgentTasks(value.document)[0].receipts[0].checks[0].references[0].segmentIndex, 0)
})

test('PEDIT check failure, scope escape and command replacement roll back task and geometry', async () => {
  const failed = await fixture([{ id: 'wrong_bulge', kind: 'polyline-segment-bulge', objectId: 'path', segmentIndex: 0, expected: 1, tolerance: 0 }])
  const failedPlan = (await propose(failed, { id: 'path', operation: 'SET_BULGE', segmentIndex: 0, bulge: 0.5 })).proposalIds[0]
  const before = failed.document.serialize()
  assert.equal((await failed.session.approveTask(failedPlan, 'reviewer', at(4))).ok, false)
  assert.equal(failed.document.serialize(), before)
  assert.equal(readAgentTasks(failed.document)[0].status, 'running')

  const outside = await fixture([{ id: 'count', kind: 'polyline-vertex-count', objectId: 'path', expected: 3, tolerance: 0 }])
  const outsidePlan = (await propose(outside, { id: 'outside', operation: 'INSERT', segmentIndex: 0, point: { x: 5, y: 10 } })).proposalIds[0]
  assert.equal((await outside.session.approveTask(outsidePlan, 'reviewer', at(4))).ok, false)
  assert.equal(outside.document.getObject('outside').payload.vertices.length, 2)

  const replaced = await fixture([{ id: 'count', kind: 'polyline-vertex-count', objectId: 'path', expected: 4, tolerance: 0 }])
  const replacedPlan = (await propose(replaced, { id: 'path', operation: 'INSERT', segmentIndex: 0, point: { x: 5, y: 0 } })).proposalIds[0]
  replaced.sdk.commands.register({ id: 'PEDIT', title: 'Replaced', execute: () => null }, { owner: 'test', replace: true })
  assert.equal((await replaced.session.approveTask(replacedPlan, 'reviewer', at(4))).ok, false)
  assert.equal(replaced.document.getObject('path').payload.vertices.length, 3)
})

test('authoritative PEDIT uncertainty rolls back locally and permanently consumes the plan', async () => {
  const value = await fixture([{ id: 'count', kind: 'polyline-vertex-count', objectId: 'path', expected: 4, tolerance: 0 }])
  const planId = (await propose(value, { id: 'path', operation: 'INSERT', segmentIndex: 0, point: { x: 5, y: 0 } })).proposalIds[0]
  const before = value.document.serialize(), state = value.document.toJSON()
  value.document.bindAuthority({ serialize: () => structuredClone(state), close() {}, commit() { throw new Error('response lost') } })
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(4))).ok, false)
  assert.equal(value.document.serialize(), before)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.equal(value.sdk.agentPlans.get(planId).status, 'consumed')
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
})
