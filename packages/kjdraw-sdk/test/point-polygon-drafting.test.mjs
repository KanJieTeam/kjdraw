import test from 'node:test'
import assert from 'node:assert/strict'
import { createDraftingSession, createKJDrawSDK } from '../src/index.js'

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const xy = vertex => vertex.point.slice(0, 2)
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

test('point and all regular-polygon constructions produce precise native entities', () => {
  const point = createDraftingSession('point')
  assert.equal(point.state.nextPoint, 'position')
  assert.deepEqual(point.preview([1.125, -2.375]).payload.position, [1.125, -2.375, 0])
  assert.deepEqual(point.addCoordinate('1.125,-2.375').payload.position, [1.125, -2.375, 0])

  const inscribed = createDraftingSession('polygon', { sides: 6, polygonMode: 'inscribed' })
  inscribed.addPoint([1.25, 2.5])
  assert.equal(inscribed.state.nextPoint, 'polygonVertex')
  const inscribedSpec = inscribed.addPoint([5.25, 2.5])
  assert.equal(inscribedSpec.payload.closed, true)
  assert.deepEqual(xy(inscribedSpec.payload.vertices[0]), [5.25, 2.5])
  for (const vertex of inscribedSpec.payload.vertices) close(distance(xy(vertex), [1.25, 2.5]), 4)

  const circumscribed = createDraftingSession('polygon', { sides: 4, polygonMode: 'circumscribed' })
  circumscribed.addPoint([0, 0])
  assert.equal(circumscribed.state.nextPoint, 'polygonSideMidpoint')
  const circumscribedSpec = circumscribed.addCoordinate('@2<90')
  const topSide = circumscribedSpec.payload.vertices.slice(0, 2).map(xy)
  close((topSide[0][0] + topSide[1][0]) / 2, 0)
  close((topSide[0][1] + topSide[1][1]) / 2, 2)

  const edge = createDraftingSession('polygon', { sides: 5, polygonMode: 'edge' })
  edge.addPoint([0.125, 0.25])
  assert.equal(edge.state.nextPoint, 'edgeEnd')
  const preview = edge.preview([3.375, 0.25])
  assert.equal(preview.payload.vertices.length, 5)
  const edgeSpec = edge.addCoordinate('@3.25<0')
  xy(edgeSpec.payload.vertices[0]).forEach((value, axis) => close(value, [0.125, 0.25][axis]))
  xy(edgeSpec.payload.vertices[1]).forEach((value, axis) => close(value, [3.375, 0.25][axis]))
  const vertices = edgeSpec.payload.vertices.map(xy)
  for (let index = 0; index < vertices.length; index += 1) close(distance(vertices[index], vertices[(index + 1) % vertices.length]), 3.25)
})

test('polygon undo, retry, validation, history and KJD/DXF reopen remain exact', async () => {
  assert.throws(() => createDraftingSession('polygon', { polygonMode: 'free' }), /Unsupported polygon mode/)
  assert.throws(() => createDraftingSession('polygon', { sides: 2 }), /3 to 1024/)
  const draft = createDraftingSession('polygon', { sides: 7, polygonMode: 'edge' })
  draft.addPoint([10.125, 20.25])
  assert.throws(() => draft.addPoint([10.125, 20.25]), /Polygon edge|distinct/)
  assert.equal(draft.points.length, 1)
  assert.deepEqual(draft.undoPoint(), [10.125, 20.25])
  assert.equal(draft.points.length, 0)
  draft.addPoint([10.125, 20.25])
  const polygon = draft.addPoint([12.625, 20.25])

  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'point-polygon', units: 'inch' })
  const createdPolygon = await sdk.executeCommand('CREATE', polygon)
  const createdPoint = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [1.125, -2.375, 0] } })
  await sdk.executeCommand('UNDO')
  assert.equal(drawing.listEntities().length, 1)
  await sdk.executeCommand('REDO')
  assert.equal(drawing.listEntities().length, 2)

  const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
  const fromKjd = await sdk.readDocument(kjd, { format: 'KJD', documentId: 'point-polygon-kjd' })
  assert.equal(fromKjd.snapshot().header.units, 'inch')
  assert.deepEqual(fromKjd.getObject(createdPoint.id).payload.position, [1.125, -2.375, 0])
  assert.equal(fromKjd.getObject(createdPolygon.id).payload.vertices.length, 7)

  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const fromDxf = await sdk.readDocument(dxf, { format: 'DXF', documentId: 'point-polygon-dxf' })
  assert.deepEqual(fromDxf.listEntities({ type: 'POINT' })[0].payload.position, [1.125, -2.375, 0])
  const reopenedPolygon = fromDxf.listEntities({ type: 'LWPOLYLINE' })[0]
  assert.equal(reopenedPolygon.payload.closed, true)
  assert.equal(reopenedPolygon.payload.vertices.length, 7)
})
