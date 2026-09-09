import test from 'node:test'
import assert from 'node:assert/strict'
import { KJDocument } from '../src/document.js'

test('fork isolates bidirectional edits, failure, history, events and authority', async () => {
  const source = KJDocument.create()
  await source.transact('seed', tx => tx.createEntity('LINE', { start: [0, 0], end: [10, 0] }, { id: 'line' }))
  let events = 0, commits = 0, closes = 0
  source.on('document:change', () => events++)
  source.bindAuthority({ serialize: () => source.serialize(), commit: serialized => { commits++; return serialized }, close: () => closes++ })
  const initial = source.serialize(), snapshot = source.snapshot(), branch = source.fork()
  assert.equal(branch.serialize(), initial)
  assert.equal(branch.snapshot(), snapshot)
  assert.equal(branch.hasAuthoritativeBackend, false)
  assert.equal(branch.history.canUndo, false)
  await branch.transact('edit fork', tx => tx.updateObject('line', { payload: { end: [20, 0] } }))
  assert.equal(source.serialize(), initial)
  assert.equal(events, 0)
  assert.equal(commits, 0)
  await assert.rejects(branch.transact('invalid', tx => { tx.eraseObject('line'); throw new Error('rollback') }))
  assert.equal(branch.getObject('line').payload.end[0], 20)
  await source.transact('edit source', tx => tx.updateObject('line', { payload: { start: [3, 0] } }))
  assert.equal(branch.getObject('line').payload.start[0], 0)
  assert.equal(commits, 1)
  await branch.undo()
  assert.deepEqual(branch.getObject('line').payload.end, [10, 0, 0])
  assert.equal(source.getObject('line').payload.start[0], 3)
  await branch.redo()
  assert.equal(branch.getObject('line').payload.end[0], 20)
  assert.equal(source.getObject('line').payload.end[0], 10)
  assert.equal(branch.validate().valid, true)
  assert.equal(source.validate().valid, true)
  assert.equal(closes, 0)
  source.unbindAuthority()
  assert.equal(closes, 1)
})

test('a fork captures committed state, not queued source work', async () => {
  const source = KJDocument.create()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const pending = source.transact('pending', async tx => {
    await gate
    tx.createEntity('CIRCLE', { center: [0, 0], radius: 3 })
  })
  const branch = source.fork()
  release()
  await pending
  assert.equal(source.listEntities().length, 1)
  assert.equal(branch.listEntities().length, 0)
  assert.equal(branch.revision, 0)
  assert.equal(branch.history.canUndo, false)
})
