import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, previewPlanarBoundaries, applyPlanarBoundaryExtraction } from '../packages/kjdraw-sdk/src/index.js'

async function drawing(extra = false) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Original boundary sources', tx => {
    for (const [id, start, end] of [
      ['top', [0, 10, 0], [20, 10, 0]], ['right', [20, 10, 0], [20, 0, 0]],
      ['bottom', [0, 0, 0], [20, 0, 0]], ['left', [0, 0, 0], [0, 10, 0]],
    ]) tx.createEntity('LINE', { start, end }, { id })
    tx.createEntity('CIRCLE', { center: [10, 5, 0], radius: 2 }, { id: 'hole' })
    tx.createEntity('TEXT', { text: 'Manual note', position: [30, 15, 0], height: 2 }, { id: 'note' })
    if (extra) tx.createEntity('LINE', { start: [40, 0, 0], end: [45, 0, 0] }, { id: 'loose' })
  })
  const ids = ['top', 'hole', 'bottom', 'right', 'left', ...(extra ? ['loose'] : [])]
  return { sdk, document, request: { ids, units: 'millimeter', expectedRevision: document.revision } }
}

test('reviewed extraction preserves full sources and manual content through one undo, redo and KJD/DXF reopen', async () => {
  const { sdk, document, request } = await drawing()
  const originals = new Map(document.listEntities().map(entity => [entity.id, JSON.stringify(entity)]))
  const originalBytes = document.serialize(), originalUndo = document.history.undoCount
  const preview = await previewPlanarBoundaries(document, request)
  assert.equal(preview.complete, true)
  assert.equal(document.serialize(), originalBytes)
  const result = await applyPlanarBoundaryExtraction(document, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest })
  assert.equal(result.resultIds.length, 2)
  assert.equal(result.revisionAfter, request.expectedRevision + 1)
  assert.equal(document.history.undoCount, originalUndo + 1)
  for (const [id, original] of originals) assert.equal(JSON.stringify(document.getObject(id)), original)
  const rings = result.resultIds.map(id => document.getObject(id))
  assert.deepEqual(rings.map(ring => ring.payload.closed), [true, true])
  assert.deepEqual(rings.map(ring => ring.source.boundaryHole), [false, true])
  assert.ok(rings[1].payload.vertices.every(vertex => vertex.bulge < 0))
  await document.undo()
  assert.deepEqual(document.listEntities().map(e => e.id).sort(), [...originals.keys()].sort())
  for (const [id, original] of originals) assert.equal(JSON.stringify(document.getObject(id)), original)
  await document.redo()
  const reopenedSdk = createKJDrawSDK(), reopened = reopenedSdk.openDocument(document.serialize())
  for (const [id, original] of originals) assert.deepEqual(reopened.getObject(id), JSON.parse(original))
  for (const ring of rings) assert.deepEqual(reopened.getObject(ring.id), ring)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const nativeSdk = createKJDrawSDK(), native = await nativeSdk.readDocument(dxf, { format: 'DXF' })
  const nativeRings = rings.map(ring => native.listEntities().find(entity => entity.handle === ring.handle))
  assert.ok(nativeRings.every(Boolean))
  for (let i = 0; i < rings.length; i++) assert.deepEqual(nativeRings[i].payload.vertices.map(v => [v.point, v.bulge ?? 0]), rings[i].payload.vertices.map(v => [v.point, v.bulge ?? 0]))
  const continued = await nativeSdk.executeCommand('CONTOUROFFSET', {
    operation: 'offset', ids: nativeRings.map(ring => ring.id), units: 'millimeter',
    expectedRevision: native.revision, distance: 1,
  }, { document: native, expectedRevision: native.revision })
  const expectedArea = 200 + 60 + Math.PI - Math.PI
  assert.ok(Math.abs(continued.area - expectedArea) < 1e-7)
})

test('incomplete geometry, unreviewed or stale receipts and blocked layers refuse without partial writes', async () => {
  const unresolved = await drawing(true), before = unresolved.document.serialize()
  const partial = await previewPlanarBoundaries(unresolved.document, unresolved.request)
  assert.equal(partial.complete, false)
  assert.ok(partial.diagnostics.some(item => item.code === 'open-chain'))
  await assert.rejects(applyPlanarBoundaryExtraction(unresolved.document, { ...unresolved.request, expectedGeometryDigest: partial.receipt.geometryDigest }), /incomplete/i)
  assert.equal(unresolved.document.serialize(), before)
  const { document, request } = await drawing(), preview = await previewPlanarBoundaries(document, request)
  const initial = document.serialize()
  await assert.rejects(applyPlanarBoundaryExtraction(document, request), /reviewed geometry digest/i)
  await assert.rejects(applyPlanarBoundaryExtraction(document, { ...request, expectedGeometryDigest: 'wrong' }), /reviewed preview/i)
  assert.equal(document.serialize(), initial)
  await document.transact('Manual update', tx => tx.updateObject('note', { payload: { ...tx.getObject('note').payload, text: 'Changed manually' } }))
  const manual = document.serialize()
  await assert.rejects(applyPlanarBoundaryExtraction(document, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest }), /revision conflict/i)
  assert.equal(document.serialize(), manual)
  const layerId = document.getObject('top').payload.layerId
  await document.transact('Lock layer', tx => tx.updateObject(layerId, { payload: { ...tx.getObject(layerId).payload, locked: true } }))
  const lockedRequest = { ...request, expectedRevision: document.revision }
  const lockedPreview = await previewPlanarBoundaries(document, lockedRequest), locked = document.serialize()
  await assert.rejects(applyPlanarBoundaryExtraction(document, { ...lockedRequest, expectedGeometryDigest: lockedPreview.receipt.geometryDigest }), /unlocked/i)
  assert.equal(document.serialize(), locked)
})

test('public command requires a matching revision envelope and retains actor provenance', async () => {
  const { sdk, document, request } = await drawing(), preview = await previewPlanarBoundaries(document, request)
  const args = { ...request, expectedGeometryDigest: preview.receipt.geometryDigest }
  const before = document.serialize()
  await assert.rejects(sdk.executeCommand('CONTOURBOUNDARIES', args, { document }), /expectedRevision/i)
  assert.equal(document.serialize(), before)
  const result = await sdk.executeCommand('CONTOURBOUNDARIES', args, { document, expectedRevision: request.expectedRevision, author: 'reviewer' })
  assert.equal(result.resultIds.length, 2)
  assert.equal(document.snapshot().revisions.at(-1).author, 'reviewer')
  assert.equal(document.snapshot().revisions.at(-1).metadata.commandId, 'CONTOURBOUNDARIES')
})

test('separate boundaries retain their own layers and styles without choosing one globally', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  let otherLayer
  await document.transact('Different styled source rings', tx => {
    otherLayer = tx.upsertTableRecord('layers', { name: 'Second ring', type: 'LAYER', payload: { color: 3, visible: true, locked: false, frozen: false } }).id
    tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 4, color: 1 }, { id: 'first' })
    tx.createEntity('CIRCLE', { center: [20, 0, 0], radius: 2, layerId: otherLayer, color: 3 }, { id: 'second' })
  })
  const request = { ids: ['second', 'first'], units: 'millimeter', expectedRevision: document.revision }, preview = await previewPlanarBoundaries(document, request)
  assert.equal(preview.complete, true)
  const result = await applyPlanarBoundaryExtraction(document, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest })
  for (const id of result.resultIds) {
    const output = document.getObject(id), source = document.getObject(output.source.derivedFromIds[0])
    assert.equal(output.payload.layerId, source.payload.layerId)
    assert.equal(output.payload.color, source.payload.color)
  }
})
