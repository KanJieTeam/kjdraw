import test from 'node:test'
import assert from 'node:assert/strict'
import { KJDocument } from '../src/document.js'

test('queries reuse frozen object views without exposing mutable state', async () => {
  const doc = KJDocument.create()
  let id
  const payload = { start: [0, 0], end: [10, 20], custom: { tags: ['original'] } }
  await doc.transact('create', tx => { id = tx.createEntity('LINE', payload).id })
  payload.start[0] = 99
  payload.custom.tags.push('outside')
  const object = doc.getObject(id)
  assert.equal(doc.listEntities()[0], object)
  assert.equal(doc.listEntities({ type: 'LINE' })[0], object)
  assert.throws(() => object.payload.start.push(1), TypeError)
  assert.throws(() => object.payload.custom.tags.push('mutated'), TypeError)
  assert.deepEqual(object.payload.start, [0, 0, 0])
  assert.deepEqual(object.payload.custom.tags, ['original'])
  const layer = doc.getTable('layers').records[0]
  assert.equal(layer, doc.getObject(layer.id, { includeErased: true }))
  assert.throws(() => doc.getTable('layers').records.push(layer), TypeError)
  await doc.transact('edit', tx => tx.updateObject(id, { payload: { end: [30, 40] } }))
  assert.notEqual(doc.getObject(id), object)
  assert.deepEqual(object.payload.end, [10, 20, 0])
  assert.deepEqual(doc.listEntities()[0].payload.end, [30, 40, 0])
  await doc.undo()
  assert.deepEqual(doc.listEntities()[0].payload.end, [10, 20, 0])
  await doc.redo()
  assert.deepEqual(doc.listEntities()[0].payload.end, [30, 40, 0])
})

test('query caches retain erased filtering and invalid creation stays atomic', async () => {
  const doc = KJDocument.create()
  await doc.transact('custom', tx => tx.createEntity('PLUGIN_ENTITY', { nested: { x: 1 } }, { id: 'custom' }))
  const before = doc.serialize()
  await assert.rejects(doc.transact('invalid', tx => tx.createEntity('CIRCLE', { center: [0, 0], radius: -1 })))
  assert.equal(doc.serialize(), before)
  await doc.transact('erase', tx => tx.eraseObject('custom'))
  assert.equal(doc.getObject('custom'), null)
  assert.equal(doc.listEntities().length, 0)
  assert.equal(doc.listEntities({ includeErased: true })[0], doc.getObject('custom', { includeErased: true }))
  await doc.undo()
  assert.equal(doc.listEntities().length, 1)
})
