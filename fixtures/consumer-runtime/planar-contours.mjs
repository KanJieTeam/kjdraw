import assert from 'node:assert/strict'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { computePlanarContours, previewPlanarContourEdit, applyPlanarContourEdit } from '@kanjieteam/kjdraw/planar-contours'

const circle = radius => ({ closed: true, vertices: [
  { point: [-radius, 0, 0], bulge: 1 }, { point: [radius, 0, 0], bulge: 1 },
] })
const ring = await computePlanarContours({ operation: 'difference', contours: [circle(10), circle(4)] })
assert.equal(ring.contours.length, 2)
assert.equal(ring.contours.filter(contour => contour.hole).length, 1)
assert.ok(Math.abs(ring.area - Math.PI * 84) < 1e-7)
assert.ok(ring.contours.every(contour => contour.vertices.every(vertex => vertex.bulge !== 0)))

const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
await drawing.transact('Part', tx => tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5 }, { id: 'part' }))
const before = drawing.serialize(), source = drawing.getObject('part')
const request = { operation: 'offset', ids: ['part'], units: 'millimeter', expectedRevision: drawing.revision, distance: 2 }
const preview = await previewPlanarContourEdit(drawing, request)
assert.equal(drawing.serialize(), before)
const applied = await applyPlanarContourEdit(drawing, { ...request, expectedGeometryDigest: preview.receipt.geometryDigest })
assert.ok(Math.abs(applied.area - Math.PI * 49) < 1e-7)
assert.deepEqual(drawing.getObject('part'), source)
assert.equal(applied.resultIds.length, 1)
assert.equal(drawing.revision, request.expectedRevision + 1)
await drawing.undo()
assert.equal(drawing.listEntities().length, 1)
await drawing.redo()
const nextSdk = createKJDrawSDK(), next = nextSdk.openDocument(drawing.serialize())
const offset = await nextSdk.executeCommand('CONTOUROFFSET', {
  ids: applied.resultIds, units: 'millimeter', expectedRevision: next.revision, distance: 1,
}, { document: next, expectedRevision: next.revision })
assert.ok(Math.abs(offset.area - Math.PI * 64) < 1e-7)
console.log(JSON.stringify({ source: 'installed-tarball', nativeArcs: true, hole: true, previewUnchanged: true, undoRedo: true, reopenedUpdate: true }))
