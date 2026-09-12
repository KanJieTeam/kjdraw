import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { createDraftingSession } from '../src/drafting.js'
import { projectDimension } from '../src/geometry/annotation.js'
import { KJValidationError } from '../src/errors.js'

function alignedSpec(sourceId, end = [10, 0]) {
  const draft = createDraftingSession('dimension', { dimensionType: 'ALIGNED', textHeight: 2 })
  draft.addPoint([0, 0], { entityId: sourceId, feature: 'start' })
  draft.addPoint(end, { entityId: sourceId, feature: 'end' })
  return draft.addPoint([5, 4])
}

function radiusSpec(sourceId, radius = 5) {
  const draft = createDraftingSession('dimension', { dimensionType: 'RADIUS', textHeight: 2 })
  draft.addPoint([0, 0], { entityId: sourceId, feature: 'center' })
  return draft.addPoint([radius, 0], { entityId: sourceId, feature: 'curve', angle: 0 })
}

const measurement = (drawing, id) => projectDimension(drawing.getObject(id).payload).measurement

async function lineFixture(id = 'dimension-edit-paths') {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: id, units: 'millimeter' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [10, 0, 0], color: 3 } }, { document: drawing })
  const cut = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [8, -5, 0], end: [8, 5, 0] } }, { document: drawing })
  const extension = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [15, -5, 0], end: [15, 5, 0] } }, { document: drawing })
  const dimension = await sdk.executeCommand('CREATE', alignedSpec(line.id), { document: drawing })
  return { sdk, drawing, line, cut, extension, dimension }
}

test('GRIPEDIT, EXTEND and identity-retaining TRIM refresh one associated dimension transactionally', async () => {
  const { sdk, drawing, line, cut, extension, dimension } = await lineFixture()
  const identity = { id: dimension.id, handle: dimension.handle }
  await sdk.executeCommand('GRIPEDIT', { id: line.id, gripId: 'end', point: [12, 0, 0] }, { document: drawing })
  assert.equal(measurement(drawing, dimension.id), 12)
  await sdk.executeCommand('EXTEND', { id: line.id, boundaryIds: [extension.id], pickPoint: [12, 0] }, { document: drawing })
  assert.equal(measurement(drawing, dimension.id), 15)
  await sdk.executeCommand('TRIM', { id: line.id, boundaryIds: [cut.id], pickPoint: [14, 0] }, { document: drawing })
  assert.equal(measurement(drawing, dimension.id), 8)
  assert.deepEqual({ id: drawing.getObject(dimension.id).id, handle: drawing.getObject(dimension.id).handle }, identity)
  assert.deepEqual(drawing.getObject(line.id).payload.end, [8, 0, 0])
  await sdk.executeCommand('UNDO', {}, { document: drawing })
  assert.equal(measurement(drawing, dimension.id), 15)
  await sdk.executeCommand('REDO', {}, { document: drawing })
  assert.equal(measurement(drawing, dimension.id), 8)

  for (const format of ['KJD', 'DXF']) {
    const reopenedSdk = createKJDrawSDK(), reopened = await reopenedSdk.readDocument(await sdk.writeDocument(drawing, { format }), { format })
    const reopenedDimension = reopened.listEntities({ type: 'DIMENSION' })[0]
    const endReference = reopenedDimension.payload.dimensionAssociations.find(item => item.feature === 'end')
    await reopenedSdk.executeCommand('GRIPEDIT', { id: endReference.entityId, gripId: 'end', point: [6, 0, 0] }, { document: reopened })
    assert.equal(measurement(reopened, reopenedDimension.id), 6)
  }
})

test('TRIM refuses associated source splits and type replacement without rebinding dimensions', async () => {
  const split = await lineFixture('associated-trim-split')
  const secondCut = await split.sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [3, -5, 0], end: [3, 5, 0] } }, { document: split.drawing })
  const beforeSplit = split.drawing.serialize(), splitRevision = split.drawing.revision
  await assert.rejects(
    split.sdk.executeCommand('TRIM', { id: split.line.id, boundaryIds: [secondCut.id, split.cut.id], pickPoint: [5, 0] }, { document: split.drawing }),
    error => error instanceof KJValidationError && /cannot split or replace/.test(error.message),
  )
  assert.equal(split.drawing.serialize(), beforeSplit)
  assert.equal(split.drawing.revision, splitRevision)

  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'associated-circle-trim' })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 5 } }, { document: drawing })
  const boundary = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-10, 0, 0], end: [10, 0, 0] } }, { document: drawing })
  await sdk.executeCommand('CREATE', radiusSpec(circle.id), { document: drawing })
  const beforeCircle = drawing.serialize(), circleRevision = drawing.revision
  await assert.rejects(
    sdk.executeCommand('TRIM', { id: circle.id, boundaryIds: [boundary.id], pickPoint: [0, 5] }, { document: drawing }),
    error => error instanceof KJValidationError && /cannot split or replace/.test(error.message),
  )
  assert.equal(drawing.serialize(), beforeCircle)
  assert.equal(drawing.revision, circleRevision)
})

test('degenerate and protected associated dimensions roll back the entire source edit', async t => {
  await t.test('degenerate grip', async () => {
    const { sdk, drawing, line, dimension } = await lineFixture('associated-grip-degenerate')
    const before = drawing.serialize(), revision = drawing.revision
    await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: line.id, gripId: 'end', point: [0, 0, 0] }, { document: drawing }), /degenerate/)
    assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision); assert.equal(measurement(drawing, dimension.id), 10)
  })
  for (const [name, patch] of [['locked', { locked: true }], ['hidden', { visible: false }], ['frozen', { frozen: true }]]) {
    await t.test(name, async () => {
      const { sdk, drawing, line, dimension } = await lineFixture('associated-protected-' + name)
      const layer = await sdk.executeCommand('LAYERNEW', { name: 'Protected dimensions ' + name }, { document: drawing })
      await sdk.executeCommand('PROPERTIES', { id: dimension.id, patch: { payload: { layerId: layer.id } } }, { document: drawing })
      await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch }, { document: drawing })
      const before = drawing.serialize(), revision = drawing.revision
      await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: line.id, gripId: 'end', point: [12, 0, 0] }, { document: drawing }), KJValidationError)
      assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
    })
  }
})
