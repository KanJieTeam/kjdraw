import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK } from '../src/index.js'

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
const closePoint = (actual, expected, epsilon = 1e-9) => { close(actual[0], expected[0], epsilon); close(actual[1], expected[1], epsilon) }

test('OFFSET creates exact derived line and circular geometry without mutating sources', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'offset' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [20, 0], radius: 5 } })
  const offsetLine = await sdk.executeCommand('OFFSET', { id: line.id, distance: 2, sidePoint: [0, 10] })
  closePoint(offsetLine.payload.start, [0, 2]); closePoint(offsetLine.payload.end, [10, 2])
  const innerCircle = await sdk.executeCommand('OFFSET', { id: circle.id, distance: 2, side: 'inward' })
  close(innerCircle.payload.radius, 3)
  close(document.getObject(circle.id).payload.radius, 5)
  const before = document.serialize()
  await assert.rejects(sdk.executeCommand('OFFSET', { id: circle.id, distance: 5, side: 'inward' }), KJValidationError)
  assert.equal(document.serialize(), before)
})

test('BREAK, EXPLODE and ARRAYPOLAR produce independent canonical entities', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'derive' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const pieces = await sdk.executeCommand('BREAK', { id: line.id, point: [4, 0] })
  assert.equal(pieces.length, 2)
  closePoint(pieces[0].payload.end, [4, 0]); closePoint(pieces[1].payload.start, [4, 0])
  assert.equal(pieces[0].id, line.id)
  assert.equal(document.getObject(line.id).payload.end[0], 4)
  assert.ok(pieces.every(piece => piece.payload.contractVersion === 1))

  const polyline = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [{ point: [-1, 0], bulge: 1 }, { point: [1, 0] }, { point: [2, 0] }] } })
  const exploded = await sdk.executeCommand('EXPLODE', { id: polyline.id })
  assert.deepEqual(exploded.map(entity => entity.type), ['ARC', 'LINE'])
  close(exploded[0].payload.radius, 1)

  const point = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [10, 0] } })
  const array = await sdk.executeCommand('ARRAYPOLAR', { id: point.id, center: [0, 0], count: 4 })
  assert.equal(array.length, 3)
  closePoint(array[0].payload.position, [0, 10])
  closePoint(array[1].payload.position, [-10, 0])
  closePoint(array[2].payload.position, [0, -10])
})

test('TRIM and EXTEND use real boundary intersections and preserve entity identity', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'trim-extend' })
  const target = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const cutter = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [5, -5], end: [5, 5] } })
  const handle = target.handle
  await sdk.executeCommand('TRIM', { id: target.id, boundaryIds: [cutter.id], pickPoint: [1, 0] })
  closePoint(document.getObject(target.id).payload.start, [5, 0])
  assert.equal(document.getObject(target.id).handle, handle)

  const short = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 10], end: [3, 10] } })
  const boundary = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [5, 5], end: [5, 15] } })
  await sdk.executeCommand('EXTEND', { id: short.id, boundaryIds: [boundary.id], pickPoint: [3, 10] })
  closePoint(document.getObject(short.id).payload.end, [5, 10])
})

test('CHAMFER and FILLET trim selected rays and create actual connector entities', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'corners' })
  const horizontal = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const vertical = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [0, 10] } })
  const chamfer = await sdk.executeCommand('CHAMFER', { firstId: horizontal.id, secondId: vertical.id, distance: 2, pickPoint1: [8, 0], pickPoint2: [0, 8] })
  closePoint(chamfer.first.payload.start, [2, 0]); closePoint(chamfer.second.payload.start, [0, 2])
  assert.equal(chamfer.connector.type, 'LINE')

  const h2 = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [20, 0], end: [30, 0] } })
  const v2 = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [20, 0], end: [20, 10] } })
  const fillet = await sdk.executeCommand('FILLET', { firstId: h2.id, secondId: v2.id, radius: 2, pickPoint1: [28, 0], pickPoint2: [20, 8] })
  assert.equal(fillet.connector.type, 'ARC')
  closePoint(fillet.connector.payload.center, [22, 2])
  close(fillet.connector.payload.radius, 2)
  assert.equal(document.validate().valid, true)
})

test('DISTANCE, ANGLE, NEAREST and INTERSECT expose exact geometry queries', async () => {
  const sdk = createKJDrawSDK()
  sdk.createDocument({ documentId: 'queries' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [5, 0], radius: 2 } })
  const distance = await sdk.executeCommand('DISTANCE', { firstPoint: [0, 0], secondPoint: [3, 4] })
  assert.equal(distance.distance, 5)
  const nearest = await sdk.executeCommand('NEAREST', { id: line.id, point: [4, 3] })
  assert.deepEqual(nearest.point, [4, 0, 0])
  assert.equal(nearest.distance, 3)
  const angle = await sdk.executeCommand('ANGLE', { firstVector: [1, 0], secondVector: [0, 1] })
  assert.equal(angle.degrees, 90)
  const intersection = await sdk.executeCommand('INTERSECT', { firstId: line.id, secondId: circle.id })
  assert.equal(intersection.kind, 'point')
  assert.deepEqual(intersection.points, [[3, 0, 0], [7, 0, 0]])
})
