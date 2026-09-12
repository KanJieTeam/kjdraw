import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { createDraftingSession } from '../src/drafting.js'
import { projectDimension } from '../src/geometry/annotation.js'
import { KJValidationError } from '../src/errors.js'

function polylineDimensionSpec(sourceId) {
  const draft = createDraftingSession('dimension', { dimensionType: 'ALIGNED', textHeight: 2 })
  draft.addPoint([0, 0], { entityId: sourceId, feature: 'vertex', vertexIndex: 0 })
  draft.addPoint([10, 0], { entityId: sourceId, feature: 'vertex', vertexIndex: 2 })
  return draft.addPoint([5, 4])
}

async function polylineFixture(id = 'dimension-pedit') {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: id, units: 'millimeter' })
  const polyline = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: {
    vertices: [{ point: [0, 0, 0] }, { point: [5, 0, 0] }, { point: [10, 0, 0] }], closed: false, color: 3,
  } }, { document: drawing })
  const dimension = await sdk.executeCommand('CREATE', polylineDimensionSpec(polyline.id), { document: drawing })
  return { sdk, drawing, polyline, dimension }
}

const associations = (drawing, dimensionId) => drawing.getObject(dimensionId).payload.dimensionAssociations
const measurement = (drawing, dimensionId) => projectDimension(drawing.getObject(dimensionId).payload).measurement

test('PEDIT migrates vertex indices without changing the referenced physical vertices', async () => {
  const { sdk, drawing, polyline, dimension } = await polylineFixture()
  const identity = { id: dimension.id, handle: dimension.handle }
  await sdk.executeCommand('PEDIT', { id: polyline.id, operation: 'INSERT', segmentIndex: 0, point: [2.5, 0, 0] }, { document: drawing })
  assert.deepEqual(associations(drawing, dimension.id).map(item => item.vertexIndex), [0, 3])
  assert.equal(measurement(drawing, dimension.id), 10)
  assert.deepEqual({ id: drawing.getObject(dimension.id).id, handle: drawing.getObject(dimension.id).handle }, identity)
  await sdk.executeCommand('UNDO', {}, { document: drawing })
  assert.deepEqual(associations(drawing, dimension.id).map(item => item.vertexIndex), [0, 2])
  await sdk.executeCommand('REDO', {}, { document: drawing })
  assert.deepEqual(associations(drawing, dimension.id).map(item => item.vertexIndex), [0, 3])

  for (const format of ['KJD', 'DXF']) {
    const reopenedSdk = createKJDrawSDK(), reopened = await reopenedSdk.readDocument(await sdk.writeDocument(drawing, { format }), { format })
    const reopenedDimension = reopened.listEntities({ type: 'DIMENSION' })[0]
    const sourceId = reopenedDimension.payload.dimensionAssociations[0].entityId
    await reopenedSdk.executeCommand('PEDIT', { id: sourceId, operation: 'DELETE', vertexIndex: 1 }, { document: reopened })
    assert.deepEqual(associations(reopened, reopenedDimension.id).map(item => item.vertexIndex), [0, 2])
    assert.equal(measurement(reopened, reopenedDimension.id), 10)
  }
})

test('PEDIT rejects deletion of a referenced vertex but preserves stable vertex anchors through arc switching', async () => {
  const { sdk, drawing, polyline, dimension } = await polylineFixture('dimension-pedit-arc')
  const polylineBefore = drawing.serialize(), polylineRevision = drawing.revision
  await assert.rejects(sdk.executeCommand('PEDIT', { id: polyline.id, operation: 'DELETE', vertexIndex: 2 }, { document: drawing }), error => error instanceof KJValidationError && /cannot delete vertex/.test(error.message))
  assert.equal(drawing.serialize(), polylineBefore); assert.equal(drawing.revision, polylineRevision)
  await sdk.executeCommand('PEDIT', { id: polyline.id, operation: 'SET_BULGE', segmentIndex: 0, sweepDegrees: 45 }, { document: drawing })
  assert.deepEqual(associations(drawing, dimension.id).map(item => item.vertexIndex), [0, 2])
  assert.equal(measurement(drawing, dimension.id), 10)
})

test('BREAK migrates unique endpoint references while JOIN and EXPLODE reject ambiguous replacement', async () => {
  const lineSdk = createKJDrawSDK(), lineDrawing = lineSdk.createDocument({ documentId: 'dimension-topology-lines' })
  const first = await lineSdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [10, 0, 0] } }, { document: lineDrawing })
  const second = await lineSdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [10, 0, 0], end: [20, 0, 0] } }, { document: lineDrawing })
  const draft = createDraftingSession('dimension', { dimensionType: 'ALIGNED' })
  draft.addPoint([0, 0], { entityId: first.id, feature: 'start' })
  draft.addPoint([10, 0], { entityId: first.id, feature: 'end' })
  await lineSdk.executeCommand('CREATE', draft.addPoint([5, 4]), { document: lineDrawing })
  const dimension = lineDrawing.listEntities({ type: 'DIMENSION' })[0], pieces = await lineSdk.executeCommand('BREAK', { id: first.id, point: [5, 0, 0] }, { document: lineDrawing })
  assert.equal(pieces[0].id, first.id); assert.notEqual(pieces[1].id, first.id)
  assert.deepEqual(lineDrawing.getObject(dimension.id).payload.dimensionAssociations.map(item => [item.feature, item.entityId]), [['start', first.id], ['end', pieces[1].id]])
  assert.equal(measurement(lineDrawing, dimension.id), 10)
  const before = lineDrawing.serialize(), revision = lineDrawing.revision
  await assert.rejects(lineSdk.executeCommand('JOIN', { id: pieces[1].id, ids: [pieces[1].id, second.id] }, { document: lineDrawing }), /cannot split or replace/)
  assert.equal(lineDrawing.serialize(), before); assert.equal(lineDrawing.revision, revision)

  const { sdk, drawing, polyline } = await polylineFixture('dimension-topology-explode')
  const polylineBefore = drawing.serialize(), polylineRevision = drawing.revision
  await assert.rejects(sdk.executeCommand('EXPLODE', { id: polyline.id }, { document: drawing }), /cannot split or replace/)
  assert.equal(drawing.serialize(), polylineBefore); assert.equal(drawing.revision, polylineRevision)
})

test('protected associated dimensions roll back PEDIT index migration', async t => {
  for (const [name, patch] of [['locked', { locked: true }], ['hidden', { visible: false }], ['frozen', { frozen: true }]]) {
    await t.test(name, async () => {
      const { sdk, drawing, polyline, dimension } = await polylineFixture('dimension-pedit-protected-' + name)
      const layer = await sdk.executeCommand('LAYERNEW', { name: 'Protected ' + name }, { document: drawing })
      await sdk.executeCommand('PROPERTIES', { id: dimension.id, patch: { payload: { layerId: layer.id } } }, { document: drawing })
      await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch }, { document: drawing })
      const before = drawing.serialize(), revision = drawing.revision
      await assert.rejects(sdk.executeCommand('PEDIT', { id: polyline.id, operation: 'INSERT', segmentIndex: 0, point: [2.5, 0, 0] }, { document: drawing }), KJValidationError)
      assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
    })
  }
})
