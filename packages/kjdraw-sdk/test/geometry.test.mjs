import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KJValidationError,
  auditRoundTrip,
  bulgeSegmentMetrics,
  closestPointOnCircle2,
  createKJDrawSDK,
  distance2,
  ellipseArcLength2,
  entityArea2,
  entityLength2,
  intersectCircleCircle2,
  intersectLineCircle2,
  intersectLineLine2,
  invert3,
  multiply3,
  polylineArea2,
  polylineLength2,
  reflectionAcrossLine3,
  rotationAround3,
  scale3,
  splineLength2,
  splinePoint2,
  transformEntityPayload,
  transformPoint3,
} from '../src/index.js'

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
const closePoint = (actual, expected, epsilon = 1e-9) => { close(actual[0], expected[0], epsilon); close(actual[1], expected[1], epsilon) }

test('affine matrices rotate, reflect and invert Float64 coordinates', () => {
  const rotation = rotationAround3(Math.PI / 2, [10, 10])
  closePoint(transformPoint3(rotation, [12, 10]), [10, 12])
  const mirror = reflectionAcrossLine3([0, 0], [1, 0])
  closePoint(transformPoint3(mirror, [4, 3]), [4, -3])
  const composed = multiply3(rotation, mirror)
  const point = [7.123456789, -8.987654321]
  closePoint(transformPoint3(invert3(composed), transformPoint3(composed, point)), point, 1e-12)
})

test('line, circle and overlap intersections report domains explicitly', () => {
  const crossing = intersectLineLine2([0, 0], [10, 0], [5, -5], [5, 5])
  assert.equal(crossing.kind, 'point')
  closePoint(crossing.points[0], [5, 0])
  const outside = intersectLineLine2([0, 0], [1, 0], [2, -1], [2, 1])
  assert.equal(outside.kind, 'none')
  const overlap = intersectLineLine2([0, 0], [10, 0], [4, 0], [12, 0])
  assert.equal(overlap.kind, 'overlap')
  closePoint(overlap.points[0], [4, 0]); closePoint(overlap.points[1], [10, 0])
  const lineCircle = intersectLineCircle2([-2, 0], [2, 0], [0, 0], 1)
  assert.equal(lineCircle.points.length, 2)
  closePoint(lineCircle.points[0], [-1, 0]); closePoint(lineCircle.points[1], [1, 0])
  const circles = intersectCircleCircle2([0, 0], 2, [3, 0], 2)
  assert.equal(circles.points.length, 2)
  close(circles.points[0][0], 1.5)
  const closest = closestPointOnCircle2([4, 0], [0, 0], 2)
  closePoint(closest.point, [2, 0]); close(closest.distance, 2)
})

test('bulge polylines retain exact arc length and signed segment area', () => {
  const metrics = bulgeSegmentMetrics([-1, 0], [1, 0], 1)
  close(metrics.radius, 1)
  close(metrics.sweep, Math.PI)
  close(metrics.length, Math.PI)
  close(metrics.segmentArea, Math.PI / 2)
  const vertices = [{ point: [-1, 0], bulge: 1 }, { point: [1, 0], bulge: 0 }]
  close(polylineLength2(vertices, { closed: true }), Math.PI + 2)
  close(polylineArea2(vertices), Math.PI / 2)
})

test('entity measurement distinguishes exact and approximate results', () => {
  close(entityLength2({ type: 'LINE', payload: { start: [0, 0], end: [3, 4] } }).value, 5)
  const circle = { type: 'CIRCLE', payload: { center: [0, 0], radius: 3 } }
  close(entityLength2(circle).value, Math.PI * 6)
  close(entityArea2(circle).value, Math.PI * 9)
  const spline = { type: 'SPLINE', payload: { degree: 2, controlPoints: [[0, 0], [1, 1], [2, 0]] } }
  const splineMetric = entityLength2(spline)
  assert.equal(splineMetric.approximate, true)
  assert.ok(splineMetric.value > 2 && splineMetric.value < 3)
  closePoint(splinePoint2(spline.payload, 0.5), [1, 0.5])

  const ellipse = { type: 'ELLIPSE', payload: { center: [0, 0], majorAxis: [2, 0, 0], ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 } }
  assert.ok(ellipseArcLength2(ellipse.payload) > 9.68)
  assert.ok(ellipseArcLength2(ellipse.payload) < 9.69)
  close(entityArea2(ellipse).value, Math.PI * 2)
  assert.ok(splineLength2(spline.payload) > 2)
})

test('entity transforms preserve circular geometry and reject invalid distortion', () => {
  const circle = { center: [2, 0], radius: 3 }
  const rotated = transformEntityPayload('CIRCLE', circle, rotationAround3(Math.PI / 2))
  closePoint(rotated.center, [0, 2]); close(rotated.radius, 3)
  const nonUniformLine = transformEntityPayload('LINE', { start: [0, 0], end: [1, 1] }, scale3(2, 3))
  closePoint(nonUniformLine.end, [2, 3])
  assert.throws(() => transformEntityPayload('CIRCLE', circle, scale3(2, 3)), KJValidationError)
})

test('MOVE, ROTATE, SCALE, COPY, MIRROR and ARRAYRECT are real transactional commands', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'editing' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [2, 3], radius: 2 } })

  await sdk.executeCommand('MOVE', { id: line.id, dx: 5, dy: 2 })
  closePoint(document.getObject(line.id).payload.start, [5, 2])
  await sdk.executeCommand('ROTATE', { id: line.id, center: [5, 2], angleDegrees: 90 })
  closePoint(document.getObject(line.id).payload.end, [5, 12])
  await sdk.executeCommand('SCALE', { id: circle.id, center: [2, 3], factor: 2 })
  close(document.getObject(circle.id).payload.radius, 4)

  const copied = await sdk.executeCommand('COPY', { id: circle.id, from: [0, 0], to: [10, 0] })
  assert.notEqual(copied[0].handle, document.getObject(circle.id).handle)
  closePoint(copied[0].payload.center, [12, 3])
  const mirrored = await sdk.executeCommand('MIRROR', { id: circle.id, lineStart: [0, 0], lineEnd: [1, 0] })
  closePoint(mirrored[0].payload.center, [2, -3])
  assert.ok(document.getObject(circle.id))

  const array = await sdk.executeCommand('ARRAYRECT', { id: line.id, rows: 2, columns: 3, rowSpacing: 20, columnSpacing: 30 })
  assert.equal(array.length, 5)
  assert.equal(document.listEntities().length, 2 + 1 + 1 + 5)
  const length = await sdk.executeCommand('LENGTH', { id: line.id })
  close(length[0].value, 10)
  const area = await sdk.executeCommand('AREA', { id: circle.id })
  close(area[0].value, Math.PI * 16)
  assert.equal(document.validate().valid, true)
})

test('editing history restores transformed payloads without changing object identity', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'editing-history' })
  const entity = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [1, 0] } })
  const handle = entity.handle
  await sdk.executeCommand('MOVE', { id: entity.id, dx: 9, dy: 0 })
  closePoint(document.getObject(entity.id).payload.start, [9, 0])
  await document.undo()
  closePoint(document.getObject(entity.id).payload.start, [0, 0])
  assert.equal(document.getObject(entity.id).handle, handle)
  await document.redo()
  closePoint(document.getObject(entity.id).payload.start, [9, 0])
  assert.equal(auditRoundTrip(document, document).passed, true)
  close(distance2(document.getObject(entity.id).payload.start, [9, 0]), 0)
})
