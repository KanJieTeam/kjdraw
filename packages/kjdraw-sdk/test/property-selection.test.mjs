import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK, selectEntitiesByProperty } from '../src/index.js'

async function fixture() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'property-selection', units: 'millimeter' })
  const cut = await sdk.executeCommand('LAYERNEW', { name: 'CUT', color: 1, lineweight: 35 })
  const locked = await sdk.executeCommand('LAYERNEW', { name: 'LOCKED', color: 1 })
  const hidden = await sdk.executeCommand('LAYERNEW', { name: 'HIDDEN', color: 1 })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0], layerId: cut.id } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [20, 0], radius: 3, layerId: cut.id } })
  const other = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 10], end: [10, 10] } })
  const protectedLine = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 20], end: [10, 20], layerId: locked.id } })
  const invisibleLine = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 30], end: [10, 30], layerId: hidden.id } })
  await sdk.executeCommand('LAYERUPDATE', { id: locked.id, patch: { locked: true } })
  await sdk.executeCommand('LAYERUPDATE', { id: hidden.id, patch: { visible: false } })
  return { sdk, document, line, circle, other, protectedLine, invisibleLine }
}

test('bounded property selection supports replace/add/remove and canonical CAD properties without editing the drawing', async () => {
  const { sdk, document, line, circle, other, protectedLine, invisibleLine } = await fixture()
  const revision = document.revision, before = document.serialize()
  assert.deepEqual(selectEntitiesByProperty(document, { property: 'type', value: 'line' }), [line.id, other.id])
  assert.deepEqual(selectEntitiesByProperty(document, { property: 'type', value: 'line', operator: 'not-equals' }), [circle.id])
  assert.deepEqual(selectEntitiesByProperty(document, { property: 'id', value: line.id }), [line.id])
  assert.deepEqual(selectEntitiesByProperty(document, { property: 'name', value: '' }), [line.id, circle.id, other.id])
  assert.deepEqual(selectEntitiesByProperty(document, { property: 'linetype', value: 'continuous' }), [line.id, circle.id, other.id])
  assert.deepEqual(await sdk.executeCommand('QSELECT', { property: 'layer', value: 'cut' }), [line.id, circle.id])
  assert.deepEqual(await sdk.executeCommand('SELECTBYPROPERTY', { property: 'type', value: 'LINE', operation: 'add' }), [line.id, circle.id, other.id])
  assert.deepEqual(await sdk.executeCommand('QSELECT', { property: 'color', value: 1, operation: 'remove' }), [other.id])
  assert.deepEqual(selectEntitiesByProperty(document, { property: 'lineweight', value: 35 }), [line.id, circle.id])
  assert.ok(!sdk.activeSelection.ids.includes(protectedLine.id))
  assert.ok(!sdk.activeSelection.ids.includes(invisibleLine.id))
  assert.equal(document.revision, revision)
  assert.equal(document.serialize(), before)
})

test('invalid property queries preserve selection and history atomically', async () => {
  const { sdk, document, other } = await fixture()
  sdk.activeSelection.replace([other.id])
  const before = document.serialize(), selected = sdk.activeSelection.ids
  for (const args of [
    { property: 'payload.start', value: '0,0' },
    { property: 'color', value: '1' },
    { property: 'type', value: 'LINE', operator: 'contains' },
    { property: 'type', value: 'LINE', operation: 'toggle' },
  ]) await assert.rejects(sdk.executeCommand('QSELECT', args), KJValidationError)
  assert.deepEqual(sdk.activeSelection.ids, selected)
  assert.equal(document.serialize(), before)
})

test('a property-selected named set follows EXPLODE members through undo, redo and KJD reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'property-membership' })
  const polyline = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [[0, 0], [10, 0], [10, 5]], closed: false } })
  assert.deepEqual(await sdk.executeCommand('QSELECT', { property: 'type', value: 'lwpolyline' }), [polyline.id])
  const saved = await sdk.executeCommand('SELECTIONSAVE', { name: 'Fabrication path' })
  const pieces = await sdk.executeCommand('EXPLODE', { id: polyline.id })
  assert.deepEqual(document.getObject(saved.id).payload.memberIds, pieces.map(piece => piece.id))
  await sdk.executeCommand('UNDO')
  assert.deepEqual(document.getObject(saved.id).payload.memberIds, [polyline.id])
  await sdk.executeCommand('REDO')
  assert.deepEqual(document.getObject(saved.id).payload.memberIds, pieces.map(piece => piece.id))
  const bytes = await sdk.writeDocument(document, { format: 'KJD' })
  const reopenedSdk = createKJDrawSDK(), reopened = await reopenedSdk.readDocument(bytes, { format: 'KJD' })
  assert.deepEqual(reopenedSdk.getSelectionManager().loadNamed('fabrication path').ids, pieces.map(piece => piece.id))
  assert.equal(reopened.validate().valid, true)
})
