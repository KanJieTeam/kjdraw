import assert from 'node:assert/strict'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { previewPlanarBoundaries } from '@kanjieteam/kjdraw/planar-boundaries'
import { applyPlanarBoundaryExtraction } from '@kanjieteam/kjdraw/planar-boundary-edit'

const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
await document.transact('Installed native boundary sources', tx => {
  const points = [[0, 0, 0], [20, 0, 0], [20, 10, 0], [0, 10, 0]]
  for (let i = 0; i < 4; i++) tx.createEntity('LINE', { start: points[i], end: points[(i + 1) % 4] }, { id: `edge-${i}` })
  tx.createEntity('CIRCLE', { center: [10, 5, 0], radius: 2 }, { id: 'hole' })
})
const sourceRecords = document.listEntities().map(entity => structuredClone(entity)), before = document.serialize()
const request = { ids: ['hole', 'edge-3', 'edge-1', 'edge-0', 'edge-2'], units: 'millimeter', expectedRevision: document.revision }
const preview = await previewPlanarBoundaries(document, request)
assert.equal(document.serialize(), before)
assert.equal(preview.complete, true)
assert.deepEqual(preview.contours.map(ring => ring.hole), [false, true])
const result = await applyPlanarBoundaryExtraction(document, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest })
assert.equal(result.resultIds.length, 2)
for (const source of sourceRecords) assert.deepEqual(document.getObject(source.id), source)
await document.undo()
assert.equal(document.listEntities().length, 5)
await document.redo()
const reopenedSdk = createKJDrawSDK(), reopened = reopenedSdk.openDocument(document.serialize())
const next = await reopenedSdk.executeCommand('CONTOUROFFSET', { ids: result.resultIds, units: 'millimeter', expectedRevision: reopened.revision, distance: 1 }, { document: reopened, expectedRevision: reopened.revision })
assert.ok(Math.abs(next.area - 260) < 1e-7)
console.log(JSON.stringify({ source: 'installed-tarball', multipleBoundaries: true, nativeArcs: true, sourcePreservation: true, undoRedo: true, reopenedOffset: true }))
