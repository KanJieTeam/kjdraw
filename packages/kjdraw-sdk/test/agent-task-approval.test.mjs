import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentTaskToolBinding, runPersistedKJAgentTask } from '../src/agent-task-runner.js'
import { createAgentTask, readAgentTasks, transitionAgentTask } from '../src/agent-tasks.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { stableHash } from '../src/utils.js'
import { KJDocument } from '../src/document.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'

const actor = { kind: 'host', id: 'atomic-task-test' }
const at = second => `2026-09-12T06:00:${String(second).padStart(2, '0')}.000Z`
const toolNames = ['cad_check_geometry', 'cad_propose_lines']

async function fixture(expectedLength = 10, withSeed = false, stopAtReady = false, deterministic = true) {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `atomic-task-${Math.random()}`, units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  if (withSeed) await document.transact('Seed', tx => tx.createEntity('CIRCLE', { center: [50, 50, 0], radius: 5 }, { id: 'seed' }))
  const definition = {
    requirements: [{
      id: 'created_line_length',
      description: 'The first entity in the reviewed batch is the required line.',
      check: {
        toolName: 'cad_check_geometry',
        assertion: { path: 'passed', operator: 'is_true', expected: true },
        ...(deterministic ? { geometryCheck: { id: 'created_line_length', kind: 'line-length', objectId: 'created:0', expected: expectedLength, tolerance: 0 } } : {}),
      },
    }],
    steps: [{ id: 'draw', title: 'Draw and verify the line', requirementIds: ['created_line_length'] }],
    tools: createAgentTaskToolBinding(session.definitions, toolNames),
    capabilities: [],
  }
  await document.transact('Create task', tx => createAgentTask(document, tx, {
    id: 'task-1', expectedRevision: document.revision, title: 'Atomic line task', goal: 'Create one exact line.', entityIds: withSeed ? ['seed'] : [], definition, at: at(1), actor,
  }))
  for (const [status, second] of (stopAtReady ? [['ready', 2]] : [['ready', 2], ['running', 3]])) {
    const task = readAgentTasks(document)[0]
    await document.transact(`Task ${status}`, tx => transitionAgentTask(document, tx, {
      id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: task.status,
      to: status, at: at(second), actor, reason: `Task is ${status}.`,
    }))
  }
  return { sdk, document, session, task: readAgentTasks(document)[0] }
}

async function propose(value, length = 10) {
  const revision = value.document.revision
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [{
    id: 'draw-line', name: 'cad_propose_lines', arguments: {
      expectedRevision: revision, units: 'millimeter', lines: [{ start: { x: 0, y: 0 }, end: { x: length, y: 0 } }],
    },
  }] }) }) }
  return runPersistedKJAgentTask({
    document: value.document, session: value.session, model, taskId: value.task.id,
    expectedRevision: revision, expectedTaskVersion: value.task.taskVersion, expectedStatus: value.task.status,
    toolNames, maxTurns: 2, maxToolCalls: 2,
  })
}

async function directProposal(value) {
  const result = await value.session.call('cad_propose_lines', {
    expectedRevision: value.document.revision, units: 'millimeter', lines: [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
  })
  assert.equal(result.ok, true)
  return result.value.planId
}

function exactBinding(value) {
  return {
    taskId: value.task.taskId, taskVersion: value.task.taskVersion, taskStatus: 'running', documentRevision: value.document.revision,
    units: value.task.units, scopeSha256: value.task.scope.sha256, toolApiVersion: value.task.definition.tools.apiVersion,
    toolNames: [...value.task.definition.tools.names], toolContractHash: value.task.definition.tools.contractHash,
    capabilityLocks: [],
  }
}

test('blank persisted task resolves created:index and commits CREATEBATCH, checks, scope and receipt in one undo unit', async () => {
  const value = await fixture(), before = value.document.serialize(), revision = value.document.revision
  const proposed = await propose(value)
  assert.equal(proposed.status, 'awaiting-approval')
  assert.equal(proposed.proposalIds.length, 1)
  assert.equal(value.document.serialize(), before)
  await assert.rejects(async () => {
    const result = await value.session.approve(proposed.proposalIds[0], 'reviewer')
    if (!result.ok) throw new Error(result.error.message)
  }, /approveTask/)
  const approved = await value.session.approveTask(proposed.proposalIds[0], 'reviewer', at(4))
  assert.equal(approved.ok, true)
  assert.equal(value.document.revision, revision + 1)
  const [line] = value.document.listEntities({ type: 'LINE' }), [task] = readAgentTasks(value.document)
  assert.equal(line.payload.end[0], 10)
  assert.equal(task.status, 'completed')
  assert.deepEqual(task.scope.members.map(member => member.id), [line.id])
  assert.equal(task.receipts.length, 1)
  assert.equal(task.receipts[0].checks[0].actual, 10)
  assert.equal(task.receipts[0].checks[0].references[0].objectId, line.id)
  assert.equal(task.receipts[0].argumentsDigest, stableHash(proposed.outputs[0].result.value.arguments))
  assert.equal(task.progress.steps[0].checks[0].receiptId, task.receipts[0].receiptId)
  assert.equal(task.observedRevision, task.updatedRevision)
  assert.equal((await value.session.approveTask(proposed.proposalIds[0], 'reviewer', at(5))).ok, false)
  await value.document.undo()
  assert.equal(value.document.listEntities({ type: 'LINE' }).length, 0)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  await value.document.redo()
  assert.equal(value.document.listEntities({ type: 'LINE' }).length, 1)
  assert.equal(readAgentTasks(value.document)[0].status, 'completed')
})

test('failed deterministic check rolls back geometry and task without consuming the reviewed plan', async () => {
  const value = await fixture(11), proposed = await propose(value, 10)
  const before = value.document.serialize(), revision = value.document.revision, history = value.document.snapshot().revisions.length, planId = proposed.proposalIds[0]
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.match(result.error.message, /does not satisfy/)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.document.snapshot().revisions.length, history)
  assert.equal(value.document.listEntities({ type: 'LINE' }).length, 0)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.deepEqual(readAgentTasks(value.document)[0].receipts, [])
  assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
  assert.equal(value.session.reject(planId, 'reviewer').ok, true)
  assert.equal(value.sdk.agentPlans.get(planId).status, 'rejected')
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
})

test('authoritative uncertainty keeps local geometry and task unchanged and forbids replay', async () => {
  const value = await fixture(), proposed = await propose(value), planId = proposed.proposalIds[0]
  const before = value.document.serialize(), state = value.document.toJSON()
  value.document.bindAuthority({ serialize: () => structuredClone(state), close() {}, commit() { throw new Error('response lost') } })
  const result = await value.session.approveTask(planId, 'reviewer', at(4))
  assert.equal(result.ok, false)
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.listEntities({ type: 'LINE' }).length, 0)
  assert.equal(readAgentTasks(value.document)[0].status, 'running')
  assert.equal(value.sdk.agentPlans.get(planId).status, 'consumed')
  assert.equal((await value.session.approveTask(planId, 'reviewer', at(5))).ok, false)
})

test('completed receipt and preserved prior scope survive KJD and KJP reopen', async () => {
  const value = await fixture(10, true), proposed = await propose(value)
  assert.equal((await value.session.approveTask(proposed.proposalIds[0], 'reviewer', at(4))).ok, true)
  const task = readAgentTasks(value.document)[0]
  assert.equal(task.scope.members[0].id, 'seed')
  assert.equal(task.scope.members.length, 2)
  const bytes = await value.sdk.writeDocument(value.document, { format: 'KJD' })
  const kjdSdk = createKJDrawSDK(), kjd = await kjdSdk.readDocument(bytes, { format: 'KJD' })
  assert.deepEqual(readAgentTasks(kjd), [task])
  const packageBytes = await createKjpPackage({ projectId: 'atomic-task-project', drawings: { [value.document.id]: value.document }, activeDrawing: value.document.id, createdAt: at(4), modifiedAt: at(4) })
  assert.deepEqual(readAgentTasks((await openKjpPackage(packageBytes)).activeDocument), [task])
  const tampered = value.document.toJSON()
  tampered.objects['task-1'].payload.receipts[0].checks[0].actual = 999
  assert.throws(() => readAgentTasks(KJDocument.open(tampered)), /receipt geometry evidence|receipt digest/)
})

test('legacy version-1 task without geometryCheck or receipts still reopens', async () => {
  const value = await fixture(), json = value.document.toJSON()
  const record = json.objects['task-1']
  delete record.payload.receipts
  delete record.payload.definition.requirements[0].check.geometryCheck
  const reopened = KJDocument.open(json), task = readAgentTasks(reopened)[0]
  assert.equal(task.contractVersion, 1)
  assert.deepEqual(task.receipts, [])
  assert.equal(task.definition.requirements[0].check.geometryCheck, undefined)
  const forged = structuredClone(json)
  forged.objects['task-1'].payload.observedRevision = forged.objects['task-1'].payload.updatedRevision
  assert.throws(() => readAgentTasks(KJDocument.open(forged)), /same-revision observation/)
})

test('forged task bindings and a replaced CREATEBATCH fail before any commit', async () => {
  const cases = [
    binding => ({ ...binding, taskVersion: binding.taskVersion + 1 }),
    binding => ({ ...binding, scopeSha256: 'f'.repeat(64) }),
    binding => ({ ...binding, toolContractHash: 'f'.repeat(16) }),
    binding => ({ ...binding, capabilityLocks: [{ id: 'forged', version: '1.0.0', contentHash: 'f'.repeat(16) }] }),
  ]
  for (const mutate of cases) {
    const value = await fixture(), planId = await directProposal(value), before = value.document.serialize()
    value.session.bindTaskProposal(planId, mutate(exactBinding(value)))
    assert.equal((await value.session.approveTask(planId, 'reviewer', at(4))).ok, false)
    assert.equal(value.document.serialize(), before)
    assert.equal(value.document.listEntities({ type: 'LINE' }).length, 0)
    assert.equal(value.sdk.agentPlans.get(planId).status, 'active')
  }
  const narrowed = await fixture(), narrowedPlan = await directProposal(narrowed)
  assert.throws(() => narrowed.session.bindTaskProposal(narrowedPlan, { ...exactBinding(narrowed), toolNames: ['cad_check_geometry'] }), /source tool/)
  const replaced = await fixture(), replacedPlan = await directProposal(replaced), before = replaced.document.serialize()
  replaced.session.bindTaskProposal(replacedPlan, exactBinding(replaced))
  replaced.sdk.commands.register({ id: 'CREATEBATCH', execute() { throw new Error('must not execute') } }, { replace: true, owner: 'forged' })
  assert.equal((await replaced.session.approveTask(replacedPlan, 'reviewer', at(4))).ok, false)
  assert.equal(replaced.document.serialize(), before)
  assert.equal(replaced.sdk.agentPlans.get(replacedPlan).status, 'active')
})

async function assertRejectedPersistentProposals(value, run, count) {
  const before = value.document.serialize(), revision = value.document.revision, history = value.document.snapshot().revisions.length
  await assert.rejects(run, /persistent task mutation.*deterministic geometry checks/)
  const plans = value.sdk.agentPlans.list()
  assert.equal(plans.length, count)
  assert.ok(plans.every(plan => plan.status === 'rejected'))
  for (const plan of plans) {
    assert.equal((await value.session.approve(plan.planId, 'reviewer')).ok, false)
    assert.equal((await value.session.approveTask(plan.planId, 'reviewer', at(5))).ok, false)
  }
  assert.equal(value.document.serialize(), before)
  assert.equal(value.document.revision, revision)
  assert.equal(value.document.snapshot().revisions.length, history)
  assert.equal(value.document.listEntities({ type: 'LINE' }).length, 0)
  assert.equal(readAgentTasks(value.document)[0].status, value.task.status)
}

test('ready persisted tasks reject every proposal instead of exposing ordinary approval', async () => {
  const value = await fixture(10, false, true, true)
  await assertRejectedPersistentProposals(value, propose(value), 1)
})

test('running legacy tasks without deterministic geometry checks reject every proposal', async () => {
  const value = await fixture(10, false, false, false)
  await assertRejectedPersistentProposals(value, propose(value), 1)
})

test('a running deterministic task rejects a model batch containing multiple proposals', async () => {
  const value = await fixture(), revision = value.document.revision
  const call = (id, y) => ({ id, name: 'cad_propose_lines', arguments: { expectedRevision: revision, units: 'millimeter', lines: [{ start: { x: 0, y }, end: { x: 10, y } }] } })
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [call('one', 0), call('two', 5)] }) }) }
  const run = runPersistedKJAgentTask({ document: value.document, session: value.session, model, taskId: value.task.id, expectedRevision: revision, expectedTaskVersion: value.task.taskVersion, expectedStatus: 'running', toolNames, maxTurns: 2, maxToolCalls: 2 })
  await assertRejectedPersistentProposals(value, run, 2)
})
