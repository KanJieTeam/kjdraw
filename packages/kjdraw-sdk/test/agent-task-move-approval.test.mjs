import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentTaskToolBinding, runPersistedKJAgentTask } from '../src/agent-task-runner.js'
import { createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'
import { stableHash } from '../src/utils.js'

const actor = { kind: 'host', id: 'atomic-move-test' }
const at = second => `2026-09-12T08:00:${String(second).padStart(2, '0')}.000Z`
const toolNames = ['cad_check_geometry', 'cad_propose_move']

async function fixture(expectedDistance = 10) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `atomic-move-${Math.random()}`, units: 'millimeter' })
  await document.transact('Seed drawing', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'edge' })
    tx.createEntity('LINE', { start: [15, 0, 0], end: [15, 10, 0] }, { id: 'anchor' })
    tx.createEntity('LINE', { start: [100, 0, 0], end: [110, 0, 0] }, { id: 'outside' })
  })
  const session = new KJAgentToolSession(sdk, document)
  const definition = {
    requirements: [{
      id: 'edge_to_anchor',
      description: 'Move edge so its start is the required distance from the fixed anchor.',
      check: {
        toolName: 'cad_check_geometry', assertion: { path: 'passed', operator: 'is_true', expected: true },
        geometryCheck: { id: 'edge_to_anchor', kind: 'point-distance', from: { objectId: 'edge', feature: 'start' }, to: { objectId: 'anchor', feature: 'start' }, expected: expectedDistance, tolerance: 0 },
      },
    }],
    steps: [{ id: 'move', title: 'Move and verify the edge', requirementIds: ['edge_to_anchor'] }],
    tools: createAgentTaskToolBinding(session.definitions, toolNames), capabilities: [],
  }
  await document.transact('Create task', tx => createAgentTask(document, tx, {
    id: 'task-move', expectedRevision: document.revision, title: 'Atomic move task', goal: 'Move only the edge by five millimeters.',
    entityIds: ['edge', 'anchor'], definition, at: at(1), actor,
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

async function propose(value, ids = ['edge'], dx = 5) {
  const revision = value.document.revision
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [{
    id: 'move-edge', name: 'cad_propose_move', arguments: { expectedRevision: revision, units: 'millimeter', ids, dx, dy: 0 },
  }] }) }) }
  return runPersistedKJAgentTask({
    document: value.document, session: value.session, model, taskId: value.task.id,
    expectedRevision: revision, expectedTaskVersion: value.task.taskVersion, expectedStatus: 'running',
    toolNames, maxTurns: 2, maxToolCalls: 2,
  })
}

async function directProposal(value, ids = ['edge']) {
  const result = await value.session.call('cad_propose_move', { expectedRevision: value.document.revision, units: 'millimeter', ids, dx: 5, dy: 0 })
  assert.equal(result.ok, true)
  return result.value.planId
}

function exactBinding(value) {
  return {
    taskId: value.task.taskId, taskVersion: value.task.taskVersion, taskStatus: 'running', documentRevision: value.document.revision,
    units: value.task.units, scopeSha256: value.task.scope.sha256, toolApiVersion: value.task.definition.tools.apiVersion,
    toolNames: [...value.task.definition.tools.names], toolContractHash: value.task.definition.tools.contractHash, capabilityLocks: [],
  }
}

test('persisted MOVE commits reviewed scoped geometry, deterministic evidence and task completion in one undo unit', async () => {
  const value = await fixture(), before = value.document.serialize(), revision = value.document.revision, edgeHandle = value.document.getObject('edge').handle
  const proposed = await propose(value), planId = proposed.proposalIds[0]
  assert.equal(proposed.status, 'awaiting-approval')
  assert.equal(value.document.serialize(), before)
  assert.equal((await value.session.approve(planId, 'reviewer')).ok, false)
  const approved = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(approved.ok, true)
  assert.equal(approved.value.command, 'MOVE')
  assert.equal(value.document.revision, revision + 1)
  assert.deepEqual(value.document.getObject('edge').payload.start, [5, 0, 0])
  assert.deepEqual(value.document.getObject('anchor').payload.start, [15, 0, 0])
  const task = readAgentTasks(value.document)[0]
  assert.equal(task.status, 'completed')
  assert.deepEqual(task.scope.members.map(member => member.id), ['edge', 'anchor'])
  assert.equal(task.receipts[0].command, 'MOVE')
  assert.equal(task.receipts[0].argumentsDigest, stableHash(proposed.outputs[0].result.value.arguments))
  assert.equal(task.receipts[0].checks[0].actual, 10)
  assert.equal(value.document.getObject('edge').handle, edgeHandle)
  assert.equal(task.progress.steps[0].checks[0].receiptId, task.receipts[0].receiptId)
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
  await value.document.undo()
  assert.deepEqual(value.document.getObject('edge').payload.start, [0, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  await value.document.redo()
  assert.deepEqual(value.document.getObject('edge').payload.start, [5, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'completed')

  const bytes = await value.sdk.writeDocument(value.document, { format: 'KJD' })
  assert.deepEqual(readAgentTasks(await createKJDrawSDK().readDocument(bytes, { format: 'KJD' })), readAgentTasks(value.document))
  const packageBytes = await createKjpPackage({ projectId: 'atomic-move-project', drawings: { [value.document.id]: value.document }, activeDrawing: value.document.id, createdAt: at(4), modifiedAt: at(4) })
  assert.deepEqual(readAgentTasks((await openKjpPackage(packageBytes)).activeDocument), readAgentTasks(value.document))
})

test('MOVE check failure rolls back geometry, task, revision and history without consuming the plan', async () => {
  const value = await fixture(9), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), revision = value.document.revision, history = value.document.snapshot().revisions.length
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /does not satisfy/)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.document.snapshot().revisions.length, history)
  assert.deepEqual(value.document.getObject('edge').payload.start, [0, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.deepEqual(readAgentTasks(value.document)[0].receipts, [])
  assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
  assert.equal(value.session.reject(planId, 'reviewer').ok, true)
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
})

test('MOVE cannot modify an out-of-scope object or execute after task revision drift', async () => {
  const outside = await fixture(), proposed = await propose(outside, ['outside']), outsidePlan = proposed.proposalIds[0]
  const beforeOutside = outside.document.serialize()
  assert.equal((await outside.session.approveTask(outsidePlan, 'reviewer', at(4))).ok, false)
  assert.equal(outside.document.serialize(), beforeOutside)
  assert.equal(outside.sdk.agentPlans.get(outsidePlan).status, 'active')

  const stale = await fixture(), staleProposal = await propose(stale), stalePlan = staleProposal.proposalIds[0]
  await stale.document.transact('Host edit', tx => tx.updateObject('outside', { payload: { start: [101, 0, 0], end: [111, 0, 0] } }))
  const beforeApproval = stale.document.serialize(), staleRevision = stale.document.revision
  assert.equal((await stale.session.approveTask(stalePlan, 'reviewer', at(4))).ok, false)
  assert.equal(stale.document.serialize(), beforeApproval)
  assert.equal(stale.document.revision, staleRevision)
  assert.deepEqual(stale.document.getObject('edge').payload.start, [0, 0, 0])
})

test('forged MOVE bindings and command replacement fail without mutation or plan consumption', async () => {
  const mutations = [
    binding => ({ ...binding, taskVersion: binding.taskVersion + 1 }),
    binding => ({ ...binding, scopeSha256: 'f'.repeat(64) }),
    binding => ({ ...binding, toolContractHash: 'f'.repeat(16) }),
    binding => ({ ...binding, capabilityLocks: [{ id: 'forged', version: '1', contentHash: 'f'.repeat(16) }] }),
  ]
  for (const mutate of mutations) {
    const value = await fixture(), planId = await directProposal(value), before = value.document.serialize()
    value.session.bindTaskProposal(planId, mutate(exactBinding(value)))
    assert.equal((await value.session.approveTask(planId, 'reviewer', at(4))).ok, false)
    assert.equal(value.document.serialize(), before)
    assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
  }
  const replaced = await fixture(), planId = await directProposal(replaced), before = replaced.document.serialize()
  replaced.session.bindTaskProposal(planId, exactBinding(replaced))
  replaced.sdk.commands.register({ id: 'MOVE', execute() { throw new Error('must not execute') } }, { replace: true, owner: 'forged' })
  assert.equal((await replaced.session.approveTask(planId, 'reviewer', at(4))).ok, false)
  assert.equal(replaced.document.serialize(), before)
  assert.equal(replaced.sdk.agentPlans.get(planId).status, 'active')
})

test('authoritative MOVE uncertainty rolls back local state and forbids replay', async () => {
  const value = await fixture(), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), state = value.document.toJSON()
  value.document.bindAuthority({ serialize: () => structuredClone(state), close() {}, commit() { throw new Error('response lost') } })
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.equal(value.document.serialize(), before)
  assert.deepEqual(value.document.getObject('edge').payload.start, [0, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.equal(value.sdk.agentPlans.get(planId).status, 'consumed')
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
})
