import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument } from '../src/document.js'
import { createAgentTask, inspectAgentTask, readAgentTasks, rebaseAgentTask, transitionAgentTask } from '../src/agent-tasks.js'

const at = second => `2026-09-12T00:00:${String(second).padStart(2, '0')}.000Z`
const actor = { kind: 'host', id: 'task-test' }
const hash = character => character.repeat(16)
const definition = {
  requirements: [{ id: 'geometry_valid', description: 'The scoped geometry passes its exact checks.', check: { toolName: 'cad_validate_geometry', assertion: { path: 'passed', operator: 'is_true', expected: true } } }],
  steps: [{ id: 'draw_and_check', title: 'Draw and validate', requirementIds: ['geometry_valid'] }],
  tools: { apiVersion: '1', names: ['cad_validate_geometry'], contractHash: hash('a') },
  capabilities: [{ id: 'core_drawing', version: '1.0.0', contentHash: hash('b') }],
}
async function fixture() {
  const document = KJDocument.create({ documentId: 'task-drawing', units: 'millimeter' })
  await document.transact('Geometry', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [100, 0, 0] }, { id: 'edge' })
    tx.createEntity('CIRCLE', { center: [20, 20, 0], radius: 5 }, { id: 'hole' })
  })
  const created = await document.transact('Task', tx => createAgentTask(document, tx, { id: 'task-1', expectedRevision: document.revision, title: 'Mounting plate', goal: 'Resize the plate and preserve the hole clearance.', entityIds: ['edge', 'hole'], definition, at: at(1), actor }))
  return { document, created }
}
const transition = (document, task, to, second, extra = {}) => document.transact(`Task ${to}`, tx => transitionAgentTask(document, tx, { id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: task.status, to, at: at(second), actor, reason: `move to ${to}`, ...extra }))

test('drawing-scoped task keeps stable identity, NOD binding, KJD persistence and exact undo/redo', async () => {
  const { document, created } = await fixture(), initial = readAgentTasks(document)[0]
  assert.equal(initial.id, 'task-1'); assert.equal(initial.handle, created.handle); assert.equal(initial.status, 'draft')
  assert.equal(document.getObject(document.snapshot().namedObjectsDictionaryId).payload.entries.KJDRAW_AI_TASK_TASK_1, undefined)
  assert.equal(Object.values(document.getObject(document.snapshot().namedObjectsDictionaryId).payload.entries).includes('task-1'), true)
  await transition(document, initial, 'ready', 2)
  const ready = readAgentTasks(document)[0], serialized = document.serialize()
  assert.equal(ready.handle, initial.handle); assert.equal(ready.taskVersion, 2); assert.equal((await inspectAgentTask(document, ready.id)).scopeMatches, true)
  assert.deepEqual(readAgentTasks(KJDocument.open(serialized)), readAgentTasks(document))
  await document.undo(); assert.equal(readAgentTasks(document)[0].status, 'draft')
  await document.redo(); assert.deepEqual(readAgentTasks(document)[0], ready)
})

test('strict schema and budgets reject unsafe or oversized creation without partial NOD records', async () => {
  const { document } = await fixture()
  const invalid = [
    { id: '__proto__' }, { id: 'new', entityIds: [] }, { id: 'new', entityIds: ['edge', 'edge'] }, { id: 'new', entityIds: ['missing'] },
    { id: 'new', title: 'x'.repeat(257) }, { id: 'new', goal: 'x'.repeat(8193) }, { id: 'new', arbitrary: true },
    { id: 'new', actor: { kind: 'provider', id: 'bad' } }, { id: 'new', at: 'tomorrow' }, { id: 'new', expectedRevision: 0 },
  ]
  for (const patch of invalid) {
    const before = document.serialize(), input = { id: 'new', expectedRevision: document.revision, title: 'Title', goal: 'Goal', entityIds: ['edge'], definition, at: at(2), actor, ...patch }
    await assert.rejects(document.transact('Invalid task', tx => createAgentTask(document, tx, input)), /AI task/)
    assert.equal(document.serialize(), before)
  }
  const before = document.serialize()
  await assert.rejects(document.transact('Duplicate', tx => createAgentTask(document, tx, { id: 'task-1', expectedRevision: document.revision, title: 'Other', goal: 'Other', entityIds: ['edge'], definition, at: at(2), actor })), /already exists/)
  assert.equal(document.serialize(), before)
  const getter = { id: 'getter-task', expectedRevision: document.revision, title: 'Title', goal: 'Goal', entityIds: ['edge'], definition, at: at(2), actor }
  Object.defineProperty(getter, 'goal', { enumerable: true, get() { throw new Error('getter executed') } })
  await assert.rejects(document.transact('Accessor', tx => createAgentTask(document, tx, getter)), /accessors/)
  const inherited = Object.create({ credential: 'must-not-be-read' })
  Object.assign(inherited, { id: 'inherited-task', expectedRevision: document.revision, title: 'Title', goal: 'Goal', entityIds: ['edge'], definition, at: at(2), actor })
  await assert.rejects(document.transact('Prototype', tx => createAgentTask(document, tx, inherited)), /plain object/)
})

test('lifecycle, task-version and document-revision conflicts fail atomically; terminal states stay terminal', async () => {
  const { document } = await fixture()
  let task = readAgentTasks(document)[0]
  await assert.rejects(transition(document, task, 'completed', 2, { resolution: { code: 'done', message: 'Done', retryable: false } }), /illegal lifecycle/)
  await transition(document, task, 'ready', 2); task = readAgentTasks(document)[0]
  await transition(document, task, 'running', 3); task = readAgentTasks(document)[0]
  const staleVersion = task.taskVersion, staleRevision = document.revision
  await transition(document, task, 'needs_attention', 4, { resolution: { code: 'input.required', message: 'Need a host decision.', retryable: true } })
  const before = document.serialize()
  for (const input of [
    { expectedTaskVersion: staleVersion, expectedRevision: document.revision },
    { expectedTaskVersion: readAgentTasks(document)[0].taskVersion, expectedRevision: staleRevision },
    { expectedTaskVersion: readAgentTasks(document)[0].taskVersion, expectedRevision: document.revision, expectedStatus: 'running' },
  ]) await assert.rejects(document.transact('Race loser', tx => transitionAgentTask(document, tx, { id: task.id, expectedStatus: 'needs_attention', to: 'running', at: at(5), actor, reason: 'retry', ...input })), /conflict/)
  assert.equal(document.serialize(), before)
  task = readAgentTasks(document)[0]
  await transition(document, task, 'failed', 5, { resolution: { code: 'geometry.failed', message: 'Cannot produce valid geometry.', retryable: false } })
  task = readAgentTasks(document)[0]
  await assert.rejects(transition(document, task, 'running', 6), /illegal lifecycle/)
})

test('scoped edits are explicit drift; unrelated edits remain compatible and stale recovery rebases exact members', async () => {
  const { document } = await fixture()
  await document.transact('Unrelated', tx => tx.createEntity('POINT', { position: [500, 500, 0] }, { id: 'unrelated' }))
  assert.equal((await inspectAgentTask(document, 'task-1')).scopeMatches, true)
  let task = readAgentTasks(document)[0]
  await transition(document, task, 'ready', 2); task = readAgentTasks(document)[0]
  await transition(document, task, 'running', 3); task = readAgentTasks(document)[0]
  await document.transact('Manual drift', tx => tx.updateObject('edge', { payload: { end: [120, 0, 0] } }))
  const inspection = await inspectAgentTask(document, task.id)
  assert.equal(inspection.scopeMatches, false); assert.deepEqual(inspection.driftedEntityIds, ['edge']); assert.equal(inspection.recovery, 'replan-after-drift')
  await assert.rejects(transition(document, task, 'completed', 4, { resolution: { code: 'done', message: 'Done', retryable: false } }), /scope drifted/)
  task = readAgentTasks(document)[0]
  await transition(document, task, 'stale', 4); task = readAgentTasks(document)[0]
  assert.equal((await inspectAgentTask(document, task.id)).recovery, 'replan-after-drift')
  await document.transact('Rebase', tx => rebaseAgentTask(document, tx, { id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: 'stale', at: at(5), actor, reason: 'Host accepted the manual edit and requested a new plan.' }))
  const rebased = readAgentTasks(document)[0]
  assert.equal(rebased.status, 'ready'); assert.equal((await inspectAgentTask(document, rebased.id)).scopeMatches, true)
  await document.transact('Add a parameter relation over the scoped line', tx => tx.createObject({ id: 'relation', kind: 'custom', type: 'DESIGN_RELATIONS', ownerId: document.snapshot().namedObjectsDictionaryId, payload: { definition: { bindings: [{ entityId: 'edge' }] } } }))
  assert.deepEqual((await inspectAgentTask(document, rebased.id)).driftedEntityIds, ['edge', 'hole'])
})

test('unit changes are incompatible numeric intent and cannot be silently rebased', async () => {
  const { document } = await fixture()
  let task = readAgentTasks(document)[0]
  await transition(document, task, 'stale', 2); task = readAgentTasks(document)[0]
  await document.transact('Change drawing units', tx => tx.setHeader('units', 'meter'))
  const inspection = await inspectAgentTask(document, task.id)
  assert.equal(inspection.unitsMatch, false); assert.equal(inspection.scopeMatches, false)
  const before = document.serialize()
  await assert.rejects(document.transact('Unsafe rebase', tx => rebaseAgentTask(document, tx, { id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: 'stale', at: at(3), actor, reason: 'Do not reinterpret values.' })), /units changed/)
  assert.equal(document.serialize(), before)
})

test('awaiting approval exposes reopen recovery and explicit rebase accepts an ambiguous approved change', async () => {
  const { document } = await fixture()
  let task = readAgentTasks(document)[0]
  await transition(document, task, 'ready', 2); task = readAgentTasks(document)[0]
  await transition(document, task, 'running', 3); task = readAgentTasks(document)[0]
  await transition(document, task, 'awaiting_approval', 4); task = readAgentTasks(document)[0]
  assert.equal((await inspectAgentTask(KJDocument.open(document.serialize()), task.id)).recovery, 'repropose-after-reopen')
  await document.transact('Approved geometry outside task record', tx => tx.updateObject('hole', { payload: { center: [25, 20, 0] } }))
  assert.equal((await inspectAgentTask(document, task.id)).recovery, 'review-approval-outcome')
  await document.transact('Recover reviewed approval', tx => rebaseAgentTask(document, tx, { id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: 'awaiting_approval', at: at(5), actor, reason: 'Host verified the committed approval receipt.' }))
  assert.equal(readAgentTasks(document)[0].status, 'running')
  assert.equal((await inspectAgentTask(document, task.id)).scopeMatches, true)
})

test('dictionary corruption, handle replacement and second-operation failure are detected without partial task state', async () => {
  const { document } = await fixture(), task = readAgentTasks(document)[0]
  const before = document.serialize()
  await assert.rejects(document.transact('Rollback all', async tx => {
    await transitionAgentTask(document, tx, { id: task.id, expectedRevision: document.revision, expectedTaskVersion: task.taskVersion, expectedStatus: task.status, to: 'ready', at: at(2), actor, reason: 'ready' })
    tx.createObject({ id: task.id, kind: 'custom', type: 'FAIL' })
  }), /Duplicate object id/)
  assert.equal(document.serialize(), before)
  await document.transact('Replace identity', tx => {
    tx.eraseObject('edge', { hard: true })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [100, 0, 0] }, { id: 'edge' })
  })
  assert.deepEqual((await inspectAgentTask(document, task.id)).driftedEntityIds, ['edge'])
  const damaged = document.toJSON(), dictionary = damaged.objects[damaged.namedObjectsDictionaryId]
  const taskKey = Object.keys(dictionary.payload.entries).find(name => dictionary.payload.entries[name] === task.id)
  delete dictionary.payload.entries[taskKey]
  const reopened = KJDocument.open(damaged)
  assert.throws(() => readAgentTasks(reopened), /dictionary binding/)
})
