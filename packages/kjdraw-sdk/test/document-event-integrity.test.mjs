import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJEventBus, KJ_EVENT_NAMES } from '../src/index.js'

function authority(document) {
  let state = document.toJSON(), commits = 0
  document.bindAuthority({
    serialize: () => structuredClone(state), close() {},
    commit(serialized, expectedRevision) {
      assert.equal(state.revision, expectedRevision)
      commits++; state = JSON.parse(serialized); return structuredClone(state)
    },
  })
  return { get state() { return structuredClone(state) }, get commits() { return commits } }
}

test('before-commit veto runs before authority and leaves both document states and history untouched', async () => {
  const document = KJDocument.create(), backend = authority(document)
  const before = document.serialize(), history = document.history
  const off = document.on(KJ_EVENT_NAMES.BEFORE_COMMIT, payload => {
    assert.equal(backend.commits, 0)
    assert.equal(payload.before.revision, 0); assert.equal(payload.after.revision, 1)
    assert.ok(payload.after.objects.line)
    assert.throws(() => { payload.after.objects.line.payload.start[0] = 99 }, TypeError)
    throw new Error('Rejected by integration')
  })
  await assert.rejects(document.transact('Rejected line', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }, { id: 'line' })), error => error.cause?.message === 'Rejected by integration')
  assert.equal(backend.commits, 0); assert.equal(backend.state.revision, 0)
  assert.equal(document.serialize(), before); assert.deepEqual(document.history, history)
  assert.equal(document.hasAuthoritativeBackend, true)
  off()
  await document.transact('Accepted line', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }, { id: 'line' }))
  assert.equal(backend.commits, 1); assert.equal(document.revision, 1)
  assert.deepEqual(document.toJSON(), backend.state)
})

test('a before-commit authority replacement cannot overwrite the replacement document', async () => {
  const document = KJDocument.create(), replacement = document.toJSON()
  replacement.metadata.title = 'Replacement session'
  let commits = 0
  const off = document.on(KJ_EVENT_NAMES.BEFORE_COMMIT, () => {
    document.bindAuthority({ serialize: () => structuredClone(replacement), close() {}, commit(value) { commits++; return value } })
  })
  await assert.rejects(document.transact('Obsolete change', tx => tx.createEntity('POINT', { position: [1, 2, 0] })), /session changed/)
  assert.equal(commits, 0); assert.equal(document.snapshot().metadata.title, 'Replacement session')
  assert.equal(document.listEntities().length, 0); assert.equal(document.history.undoCount, 0)
  off()
})

test('post-commit observer failures cannot falsify commit, undo or redo and reach diagnostic listeners', async () => {
  const document = KJDocument.create(), backend = authority(document), deliveries = [], failures = []
  const error = new Error('Broken observer')
  for (const name of [KJ_EVENT_NAMES.AFTER_COMMIT, KJ_EVENT_NAMES.UNDO, KJ_EVENT_NAMES.REDO, KJ_EVENT_NAMES.CHANGE, KJ_EVENT_NAMES.HISTORY]) {
    document.on(name, () => { throw error })
    document.on(name, () => deliveries.push([name, document.revision]))
  }
  document.on(KJ_EVENT_NAMES.LISTENER_ERROR, () => { throw new Error('Broken diagnostics') })
  document.on(KJ_EVENT_NAMES.LISTENER_ERROR, payload => failures.push(payload))
  const line = await document.transact('Line', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }, { id: 'line' }))
  assert.equal(line.id, 'line'); assert.equal(document.history.undoCount, 1)
  assert.equal(await document.undo(), true); assert.equal(document.getObject('line'), null)
  assert.equal(await document.redo(), true); assert.equal(document.getObject('line').id, 'line')
  assert.equal(backend.commits, 3); assert.deepEqual(document.toJSON(), backend.state)
  assert.deepEqual(deliveries, [
    [KJ_EVENT_NAMES.AFTER_COMMIT, 1], [KJ_EVENT_NAMES.CHANGE, 1], [KJ_EVENT_NAMES.HISTORY, 1],
    [KJ_EVENT_NAMES.UNDO, 2], [KJ_EVENT_NAMES.CHANGE, 2], [KJ_EVENT_NAMES.HISTORY, 2],
    [KJ_EVENT_NAMES.REDO, 3], [KJ_EVENT_NAMES.CHANGE, 3], [KJ_EVENT_NAMES.HISTORY, 3],
  ])
  assert.equal(failures.length, 9)
  failures.forEach((payload, i) => {
    assert.equal(payload.error, error); assert.equal(payload.documentId, document.id)
    assert.equal(payload.documentRevision, Math.floor(i / 3) + 1)
    assert.equal(payload.eventName, deliveries[i][0]); assert.equal(Object.isFrozen(payload), true)
  })
})

for (const action of ['commit', 'undo', 'redo']) test(`a queued session replacement cannot be overwritten by a local ${action}`, async () => {
  const document = KJDocument.create()
  await document.transact('Seed', tx => tx.createEntity('POINT', { position: [1, 2, 0] }, { id: 'point' }))
  if (action === 'redo') await document.undo()
  const replacement = document.toJSON()
  replacement.metadata.title = 'Queued replacement'
  let commits = 0, replacementHistory
  const replace = () => {
    document.bindAuthority({
      serialize: () => structuredClone(replacement), close() {}, commit(value) { commits++; return value },
    })
    replacementHistory = document.history
  }
  if (action === 'commit') document.on(KJ_EVENT_NAMES.BEFORE_COMMIT, () => queueMicrotask(replace))
  const operation = action === 'commit'
    ? document.transact('Obsolete edit', tx => tx.updateObject('point', { name: 'Obsolete' }))
    : document[action]()
  if (action !== 'commit') queueMicrotask(replace)
  await assert.rejects(operation, /session changed/)
  assert.equal(commits, 0); assert.deepEqual(document.toJSON(), replacement)
  assert.deepEqual(document.history, replacementHistory)
  assert.equal(document.hasAuthoritativeBackend, true)
})

test('event bus strict dispatch preserves its existing exception contract', () => {
  const events = new KJEventBus(), error = new Error('Strict listener'), calls = []
  events.on('event', () => { throw error }); events.on('event', () => calls.push('second'))
  assert.throws(() => events.emit('event', {}), value => value === error)
  assert.deepEqual(calls, [])
})
