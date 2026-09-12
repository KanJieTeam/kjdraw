import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentTaskToolBinding, runPersistedKJAgentTask } from '../src/agent-task-runner.js'
import { commitAgentTaskLengthenApproval, createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'
import { stableHash } from '../src/utils.js'

const actor = { kind: 'host', id: 'atomic-lengthen-test' }
const at = second => `2026-09-12T14:00:${String(second).padStart(2, '0')}.000Z`
const toolNames = ['cad_check_geometry', 'cad_propose_lengthen']

function taskToolBinding(session, apiVersion = '1') {
  const binding = createAgentTaskToolBinding(session.definitions, toolNames)
  if (apiVersion === binding.apiVersion) return binding
  const definitions = new Map(session.definitions.map(definition => [definition.name, definition]))
  const tools = [...binding.names].sort().map(name => {
    const definition = definitions.get(name)
    return { name: definition.name, effect: definition.effect, description: definition.description, inputSchema: definition.inputSchema }
  })
  return { ...binding, apiVersion, contractHash: stableHash({ apiVersion, tools }) }
}

async function fixture(expectedLength = 15, toolApiVersion = '1') {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `atomic-lengthen-${Math.random()}`, units: 'millimeter' })
  await document.transact('Seed drawing', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { id: 'edge' })
    tx.createEntity('LINE', { start: [100, 0, 0], end: [110, 0, 0] }, { id: 'outside' })
  })
  const session = new KJAgentToolSession(sdk, document)
  const definition = {
    requirements: [{
      id: 'edge_length', description: 'Lengthen the edge to the exact required length.',
      check: {
        toolName: 'cad_check_geometry', assertion: { path: 'passed', operator: 'is_true', expected: true },
        geometryCheck: { id: 'edge_length', kind: 'line-length', objectId: 'edge', expected: expectedLength, tolerance: 0 },
      },
    }],
    steps: [{ id: 'lengthen', title: 'Lengthen and verify the edge', requirementIds: ['edge_length'] }],
    tools: taskToolBinding(session, toolApiVersion), capabilities: [],
  }
  await document.transact('Create task', tx => createAgentTask(document, tx, {
    id: 'task-lengthen', expectedRevision: document.revision, title: 'Atomic lengthen task', goal: 'Lengthen only the edge to fifteen millimeters.',
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

async function propose(value, id = 'edge') {
  const revision = value.document.revision
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [{
    id: 'lengthen-edge', name: 'cad_propose_lengthen', arguments: { expectedRevision: revision, units: 'millimeter', id, endpoint: 'end', mode: 'TOTAL', value: 15 },
  }] }) }) }
  return runPersistedKJAgentTask({
    document: value.document, session: value.session, model, taskId: value.task.id,
    expectedRevision: revision, expectedTaskVersion: value.task.taskVersion, expectedStatus: 'running',
    toolNames, maxTurns: 2, maxToolCalls: 2,
  })
}

async function directProposal(value) {
  const result = await value.session.call('cad_propose_lengthen', { expectedRevision: value.document.revision, units: 'millimeter', id: 'edge', endpoint: 'end', mode: 'TOTAL', value: 15 })
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

function approval(value, overrides = {}) {
  const task = value.task
  return {
    id: task.id, expectedRevision: value.document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: 'running', expectedScopeSha256: task.scope.sha256,
    sourceToolName: 'cad_propose_lengthen', toolApiVersion: task.definition.tools.apiVersion, toolContractHash: task.definition.tools.contractHash,
    argumentsDigest: stableHash({ id: 'edge', endpoint: 'end', mode: 'TOTAL', value: 15 }), capabilityLocks: [], planId: 'plan-direct', executionEnvelopeId: 'envelope-direct',
    reviewerId: 'reviewer', lengthenedEntityIds: ['edge'], at: at(4), ...overrides,
  }
}

test('persisted LENGTHEN commits exact geometry, checks and task completion in one undo unit', async () => {
  const value = await fixture(), before = value.document.serialize(), revision = value.document.revision, handle = value.document.getObject('edge').handle
  const proposed = await propose(value), planId = proposed.proposalIds[0]
  assert.equal(proposed.status, 'awaiting-approval')
  assert.equal(value.document.serialize(), before)
  assert.equal((await value.session.approve(planId, 'reviewer')).ok, false)
  const approved = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(approved.ok, true, JSON.stringify(approved))
  assert.equal(approved.value.command, 'LENGTHEN')
  assert.equal(value.document.revision, revision + 1)
  assert.deepEqual(value.document.getObject('edge').payload.start, [0, 0, 0])
  assert.deepEqual(value.document.getObject('edge').payload.end, [15, 0, 0])
  assert.deepEqual(value.document.getObject('outside').payload.start, [100, 0, 0])
  assert.equal(value.document.getObject('edge').handle, handle)
  const task = readAgentTasks(value.document)[0]
  assert.equal(task.status, 'completed')
  assert.equal(task.receipts[0].command, 'LENGTHEN')
  assert.equal(task.receipts[0].sourceToolName, 'cad_propose_lengthen')
  assert.equal(task.receipts[0].argumentsDigest, stableHash(proposed.outputs[0].result.value.arguments))
  assert.equal(task.receipts[0].checks[0].actual, 15)
  assert.equal(task.progress.steps[0].checks[0].receiptId, task.receipts[0].receiptId)
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)

  await value.document.undo()
  assert.deepEqual(value.document.getObject('edge').payload.end, [10, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  await value.document.redo()
  assert.deepEqual(value.document.getObject('edge').payload.end, [15, 0, 0])
  assert.equal(readAgentTasks(value.document)[0].status, 'completed')

  const kjd = await value.sdk.writeDocument(value.document, { format: 'KJD' })
  assert.deepEqual(readAgentTasks(await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })), readAgentTasks(value.document))
  const kjp = await createKjpPackage({ projectId: 'atomic-lengthen-project', drawings: { [value.document.id]: value.document }, activeDrawing: value.document.id, createdAt: at(4), modifiedAt: at(4) })
  assert.deepEqual(readAgentTasks((await openKjpPackage(kjp)).activeDocument), readAgentTasks(value.document))
})

test('LENGTHEN check failure rolls back geometry, task, revision and history without consuming the plan', async () => {
  const value = await fixture(14), planId = (await propose(value)).proposalIds[0]
  const before = value.document.serialize(), revision = value.document.revision, history = value.document.snapshot().revisions.length
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /does not satisfy/)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.document.snapshot().revisions.length, history)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.deepEqual(readAgentTasks(value.document)[0].receipts, [])
  assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
})

test('LENGTHEN refuses out-of-scope targets, revision drift and command replacement', async () => {
  const outside = await fixture(), outsidePlan = (await propose(outside, 'outside')).proposalIds[0], beforeOutside = outside.document.serialize()
  assert.equal((await outside.session.approveTask(outsidePlan, 'reviewer', at(4))).ok, false)
  assert.equal(outside.document.serialize(), beforeOutside)
  assert.equal(outside.sdk.agentPlans.get(outsidePlan).status, 'active')

  const stale = await fixture(), stalePlan = (await propose(stale)).proposalIds[0]
  await stale.document.transact('Host edit', tx => tx.updateObject('outside', { payload: { start: [101, 0, 0], end: [111, 0, 0] } }))
  const staleBefore = stale.document.serialize(), staleRevision = stale.document.revision
  assert.equal((await stale.session.approveTask(stalePlan, 'reviewer', at(4))).ok, false)
  assert.equal(stale.document.serialize(), staleBefore)
  assert.equal(stale.document.revision, staleRevision)

  const replaced = await fixture(), replacedPlan = await directProposal(replaced), replacedBefore = replaced.document.serialize()
  replaced.session.bindTaskProposal(replacedPlan, exactBinding(replaced))
  replaced.sdk.commands.register({ id: 'LENGTHEN', execute() { throw new Error('must not execute') } }, { replace: true, owner: 'forged' })
  assert.equal((await replaced.session.approveTask(replacedPlan, 'reviewer', at(4))).ok, false)
  assert.equal(replaced.document.serialize(), replacedBefore)
  assert.equal(replaced.sdk.agentPlans.get(replacedPlan).status, 'active')
})

test('LENGTHEN bindings and commit enforce API, contract, capability, scope and exact changed IDs', async () => {
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

  const unsupported = await fixture(15, '999'), unsupportedPlan = await directProposal(unsupported), unsupportedBefore = unsupported.document.serialize()
  assert.throws(() => unsupported.session.bindTaskProposal(unsupportedPlan, exactBinding(unsupported)), /Unsupported persistent task tool API version/)
  unsupported.session.bindTaskProposal(unsupportedPlan, { ...exactBinding(unsupported), toolApiVersion: '1' })
  assert.equal((await unsupported.session.approveTask(unsupportedPlan, 'reviewer', at(4))).ok, false)
  assert.equal(unsupported.document.serialize(), unsupportedBefore)

  const direct = await fixture(15, '999'), directBefore = direct.document.serialize(), directRevision = direct.document.revision
  await assert.rejects(direct.document.transact('Forged atomic LENGTHEN', tx => commitAgentTaskLengthenApproval(direct.document, tx, approval(direct))), /unsupported persistent task tool API version/)
  assert.equal(direct.document.serialize(), directBefore)
  assert.equal(direct.document.revision, directRevision)

  const extra = await fixture(), extraBefore = extra.document.serialize(), extraRevision = extra.document.revision
  await assert.rejects(extra.document.transact('Lengthen plus unrelated edit', async tx => {
    tx.updateObject('edge', { payload: { start: [0, 0, 0], end: [15, 0, 0] } })
    tx.updateObject('outside', { payload: { start: [101, 0, 0], end: [111, 0, 0] } })
    await commitAgentTaskLengthenApproval(extra.document, tx, approval(extra))
  }), /must change exactly/)
  assert.equal(extra.document.serialize(), extraBefore)
  assert.equal(extra.document.revision, extraRevision)
})

test('authoritative LENGTHEN uncertainty rolls back local state and forbids replay', async () => {
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
