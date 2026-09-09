import test from 'node:test'
import assert from 'node:assert/strict'
import { KJDocument } from '../src/document.js'

test('membership index respects predeclared IDs and replaced owner arrays', async () => {
  const doc = KJDocument.create()
  const owner = doc.snapshot().spaces.modelSpaceId
  await doc.transact('predeclared members', tx => {
    tx.updateObject(owner, { payload: { entityIds: ['ahead'] } })
    tx.createEntity('POINT', { position: [0, 0] }, { id: 'ahead' })
    tx.createEntity('POINT', { position: [1, 1] }, { id: 'second' })
    tx.updateObject(owner, { payload: { entityIds: ['ahead', 'second', 'third'] } })
    tx.createEntity('POINT', { position: [2, 2] }, { id: 'third' })
  })
  assert.deepEqual(doc.getObject(owner).payload.entityIds, ['ahead', 'second', 'third'])
  assert.equal(doc.validate().valid, true)
})

test('membership index survives reparent, hard delete, rollback and history restoration', async () => {
  const doc = KJDocument.create()
  const owner = doc.snapshot().spaces.modelSpaceId
  let block
  await doc.transact('moving members', tx => {
    block = tx.upsertTableRecord('blockRecords', { name: 'part', payload: { entityIds: [] } })
    tx.createEntity('POINT', { position: [0, 0] }, { id: 'moving' })
    tx.reparentObject('moving', block.id)
    tx.reparentObject('moving', owner)
    tx.reparentObject('moving', block.id)
    tx.eraseObject('moving', { hard: true })
    tx.createEntity('POINT', { position: [3, 4] }, { id: 'moving', ownerId: block.id })
  })
  assert.deepEqual(doc.getObject(owner).payload.entityIds, [])
  assert.deepEqual(doc.getObject(block.id).payload.entityIds, ['moving'])
  const before = doc.serialize()
  await assert.rejects(doc.transact('rollback members', tx => {
    tx.reparentObject('moving', owner)
    throw new Error('abort')
  }))
  assert.equal(doc.serialize(), before)
  await doc.undo()
  assert.equal(doc.getObject('moving'), null)
  await doc.redo()
  assert.deepEqual(doc.getObject(block.id).payload.entityIds, ['moving'])
  assert.equal(doc.validate().valid, true)
})
