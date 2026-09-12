import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { createDraftingSession } from '../src/drafting.js'
import { projectDimension } from '../src/geometry/annotation.js'
import { KJValidationError } from '../src/errors.js'

function alignedSpec(sourceId) {
  const draft = createDraftingSession('dimension', { dimensionType: 'ALIGNED', textHeight: 2 })
  draft.addPoint([10, 0], { entityId: sourceId, feature: 'start' })
  draft.addPoint([20, 0], { entityId: sourceId, feature: 'end' })
  return draft.addPoint([15, 4])
}

async function fixture(id) {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: id, units: 'millimeter' })
  const source = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [10, 0, 0], end: [20, 0, 0], color: 3 } }, { document: drawing })
  const dimension = await sdk.executeCommand('CREATE', alignedSpec(source.id), { document: drawing })
  return { sdk, drawing, source, dimension }
}

const variants = [
  ['COPY', { dx: 30, dy: 5 }],
  ['MIRROR', { lineStart: [0, -10], lineEnd: [0, 10] }],
  ['ARRAYRECT', { rows: 1, columns: 3, rowSpacing: 0, columnSpacing: 30 }],
  ['ARRAYPOLAR', { count: 3, center: [0, 0], angleDegrees: 360 }],
]

function assertLocalReferences(drawing, copies, source, dimension) {
  const copiedSources = copies.filter(item => item.type === 'LINE')
  const copiedDimensions = copies.filter(item => item.type === 'DIMENSION')
  assert.equal(copiedSources.length, copiedDimensions.length)
  const sourceIds = new Set(copiedSources.map(item => item.id))
  for (const copiedDimension of copiedDimensions) {
    assert.equal(copiedDimension.source.copiedFromId, dimension.id)
    const references = copiedDimension.payload.dimensionAssociations
    assert.equal(new Set(references.map(item => item.entityId)).size, 1)
    const copiedSourceId = references[0].entityId
    assert.ok(sourceIds.has(copiedSourceId))
    const copiedSource = drawing.getObject(copiedSourceId)
    assert.equal(copiedSource.source.copiedFromId, source.id)
    assert.deepEqual(copiedDimension.payload.definitionPoints[1], copiedSource.payload.start)
    assert.deepEqual(copiedDimension.payload.definitionPoints[2], copiedSource.payload.end)
    assert.equal(projectDimension(copiedDimension.payload).measurement, 10)
  }
}

for (const [command, commandArgs] of variants) {
  test(`${command} isolates copied source-dimension instances and rejects a dimension-only copy`, async () => {
    const together = await fixture('dimension-copy-' + command.toLowerCase())
    const copies = await together.sdk.executeCommand(command, { ids: [together.source.id, together.dimension.id], ...commandArgs }, { document: together.drawing })
    assertLocalReferences(together.drawing, copies, together.source, together.dimension)
    assert.ok(copies.filter(item => item.type === 'DIMENSION').every(item => item.payload.dimensionAssociations.every(reference => reference.entityId !== together.source.id)))
    assert.ok(together.drawing.getObject(together.dimension.id).payload.dimensionAssociations.every(reference => reference.entityId === together.source.id))

    const sourceOnly = await fixture('dimension-source-only-' + command.toLowerCase())
    const sourceCopies = await sourceOnly.sdk.executeCommand(command, { id: sourceOnly.source.id, ...commandArgs }, { document: sourceOnly.drawing })
    assert.ok(sourceCopies.every(item => item.type === 'LINE'))
    assert.ok(sourceOnly.drawing.getObject(sourceOnly.dimension.id).payload.dimensionAssociations.every(reference => reference.entityId === sourceOnly.source.id))

    const dimensionOnly = await fixture('dimension-only-' + command.toLowerCase())
    const before = dimensionOnly.drawing.serialize(), revision = dimensionOnly.drawing.revision
    await assert.rejects(
      dimensionOnly.sdk.executeCommand(command, { id: dimensionOnly.dimension.id, ...commandArgs }, { document: dimensionOnly.drawing }),
      error => error instanceof KJValidationError && /cannot copy associated dimension/.test(error.message),
    )
    assert.equal(dimensionOnly.drawing.serialize(), before)
    assert.equal(dimensionOnly.drawing.revision, revision)
  })
}

test('MIRROR eraseSource retargets group and named-selection membership with undo-redo and reopen', async () => {
  const { sdk, drawing, source, dimension } = await fixture('dimension-mirror-membership')
  const group = await sdk.executeCommand('GROUP', { name: 'Measured pair', ids: [source.id, dimension.id] }, { document: drawing })
  const selection = await sdk.executeCommand('SELECTIONSAVE', { name: 'Measured selection', ids: [source.id, dimension.id] }, { document: drawing })
  const beforeMirror = drawing.snapshot().objects
  const copies = await sdk.executeCommand('MIRROR', { ids: [source.id, dimension.id], lineStart: [0, -10], lineEnd: [0, 10], eraseSource: true }, { document: drawing })
  assertLocalReferences(drawing, copies, source, dimension)
  const copiedIds = copies.map(item => item.id)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, copiedIds)
  assert.deepEqual(drawing.getObject(selection.id).payload.memberIds, copiedIds)
  assert.equal(drawing.getObject(source.id), null); assert.equal(drawing.getObject(dimension.id), null)
  const afterMirror = drawing.snapshot().objects
  await sdk.executeCommand('UNDO', {}, { document: drawing })
  assert.deepEqual(drawing.snapshot().objects, beforeMirror)
  await sdk.executeCommand('REDO', {}, { document: drawing })
  assert.deepEqual(drawing.snapshot().objects, afterMirror)

  for (const format of ['KJD', 'DXF']) {
    const reopenedSdk = createKJDrawSDK(), reopened = await reopenedSdk.readDocument(await sdk.writeDocument(drawing, { format }), { format })
    const reopenedDimension = reopened.listEntities({ type: 'DIMENSION' })[0]
    const endReference = reopenedDimension.payload.dimensionAssociations.find(item => item.feature === 'end')
    const line = reopened.getObject(endReference.entityId)
    await reopenedSdk.executeCommand('GRIPEDIT', { id: line.id, gripId: 'end', point: [line.payload.end[0] - 5, line.payload.end[1], 0] }, { document: reopened })
    assert.equal(projectDimension(reopened.getObject(reopenedDimension.id).payload).measurement, 15)
  }
})

test('MIRROR eraseSource refuses to leave an unselected associated dimension dangling', async () => {
  const { sdk, drawing, source } = await fixture('dimension-mirror-dangling')
  const before = drawing.serialize(), revision = drawing.revision
  await assert.rejects(sdk.executeCommand('MIRROR', { id: source.id, lineStart: [0, -10], lineEnd: [0, 10], eraseSource: true }, { document: drawing }), /must include dimension/)
  assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
})

test('copying an associated pair respects protected source and destination layers atomically', async t => {
  for (const [name, protection] of [['locked', { locked: true }], ['hidden', { visible: false }], ['frozen', { frozen: true }]]) {
    await t.test(name, async () => {
      const { sdk, drawing, source, dimension } = await fixture('dimension-copy-protected-' + name)
      const layer0 = drawing.getTable('layers').currentId
      const layer = await sdk.executeCommand('LAYERNEW', { name: 'Protected copies ' + name }, { document: drawing })
      await sdk.executeCommand('PROPERTIES', { ids: [source.id, dimension.id], patch: { payload: { layerId: layer.id } } }, { document: drawing })
      await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: protection }, { document: drawing })
      const before = drawing.serialize(), revision = drawing.revision
      await assert.rejects(sdk.executeCommand('COPY', { ids: [source.id, dimension.id], dx: 30 }, { document: drawing }), KJValidationError)
      assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
      const copies = await sdk.executeCommand('COPY', { ids: [source.id, dimension.id], dx: 30, payloadPatch: { layerId: layer0 } }, { document: drawing })
      assertLocalReferences(drawing, copies, source, dimension)
      assert.ok(copies.every(item => item.payload.layerId === layer0))
    })
  }
})
