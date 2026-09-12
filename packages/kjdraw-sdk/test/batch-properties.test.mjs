import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK } from '../src/index.js'

test('batch PROPERTIES changes editable entity styles atomically in one undoable revision and survives KJD reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'batch-properties' })
  const target = await sdk.executeCommand('LAYERNEW', { name: 'FABRICATION', color: 3, lineweight: 35 })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 4], end: [10, 0, 4] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [20, 0, 4], radius: 3 } })
  const beforeRevision = document.revision
  const beforeEntities = [line, circle].map(entity => document.getObject(entity.id))
  const changed = await sdk.executeCommand('PROPERTIES', { ids: [line.id, circle.id, line.id], patch: { payload: { layerId: target.id, color: 2, lineweight: 50, linetypeScale: 1.5 } } })
  assert.equal(document.revision, beforeRevision + 1)
  assert.deepEqual(changed.map(item => item.id), [line.id, circle.id])
  for (const [original, entity] of [[line, document.getObject(line.id)], [circle, document.getObject(circle.id)]]) {
    assert.equal(entity.handle, original.handle)
    assert.deepEqual(entity.payload, { ...original.payload, layerId: target.id, color: 2, lineweight: 50, linetypeScale: 1.5 })
  }
  const afterEntities = [line, circle].map(entity => document.getObject(entity.id))
  await sdk.executeCommand('UNDO')
  assert.deepEqual([line, circle].map(entity => document.getObject(entity.id)), beforeEntities)
  await sdk.executeCommand('REDO')
  assert.deepEqual([line, circle].map(entity => document.getObject(entity.id)), afterEntities)
  const bytes = await sdk.writeDocument(document, { format: 'KJD' })
  const reopened = await createKJDrawSDK().readDocument(bytes, { format: 'KJD' })
  for (const id of [line.id, circle.id]) assert.deepEqual(reopened.getObject(id).payload, document.getObject(id).payload)
})

test('batch PROPERTIES rejects protected, missing, empty and oversized sets without partial changes', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'batch-properties-atomic' })
  const locked = await sdk.executeCommand('LAYERNEW', { name: 'LOCKED' })
  const first = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const second = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 5], end: [10, 5], layerId: locked.id } })
  await sdk.executeCommand('LAYERUPDATE', { id: locked.id, patch: { locked: true } })
  const before = document.serialize()
  const rejected = [
    { ids: [first.id, second.id], patch: { payload: { color: 4 } } },
    { ids: [first.id, 'missing'], patch: { payload: { color: 4 } } },
    { ids: [], patch: { payload: { color: 4 } } },
    { ids: [first.id], patch: {} },
    { id: first.id, ids: [second.id], patch: { payload: { color: 4 } } },
    { ids: Array.from({ length: 4097 }, () => first.id), patch: { payload: { color: 4 } } },
  ]
  for (const args of rejected) {
    await assert.rejects(sdk.executeCommand('PROPERTIES', args), KJValidationError)
    assert.equal(document.serialize(), before)
  }
})
