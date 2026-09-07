import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK, findBestSnap, getEntityGrips } from '../src/index.js'

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
const closePoint = (actual, expected, epsilon = 1e-9) => { close(actual[0], expected[0], epsilon); close(actual[1], expected[1], epsilon) }

test('object snapping resolves endpoints, midpoints, nearest points and intersections', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'snapping' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-5, 0], end: [5, 0] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0], radius: 3 } })
  const endpoint = findBestSnap(document, [-4.9, 0.1], { radius: 1, modes: ['endpoint'] })
  assert.equal(endpoint.entityIds[0], line.id)
  closePoint(endpoint.point, [-5, 0])
  const midpoint = findBestSnap(document, [0.1, 0.1], { radius: 1, modes: ['midpoint'] })
  closePoint(midpoint.point, [0, 0])
  const nearest = findBestSnap(document, [2, 1], { radius: 2, modes: ['nearest'], entityIds: [line.id] })
  closePoint(nearest.point, [2, 0])
  const intersections = sdk.snap([3.1, 0.1], { radius: 1, modes: ['intersection'] })
  assert.equal(intersections[0].mode, 'intersection')
  assert.deepEqual(new Set(intersections[0].entityIds), new Set([line.id, circle.id]))
  closePoint(intersections[0].point, [3, 0])
})

test('arc and bulge-polyline snaps respect their actual curved domains', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'curved-snapping' })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [0, 0], radius: 4, startAngle: 0, endAngle: Math.PI / 2 } })
  const polyline = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [{ point: [-1, 0], bulge: 1 }, { point: [1, 0] }], closed: false } })
  const quadrants = sdk.snap([0, 4], { radius: 10, modes: ['quadrant'], entityIds: [arc.id] })
  assert.equal(quadrants.length, 2)
  assert.ok(quadrants.every(candidate => candidate.point[0] >= -1e-9 && candidate.point[1] >= -1e-9))
  const bulgeMid = sdk.snap([0, -1], { radius: 0.1, modes: ['midpoint'], entityIds: [polyline.id] })[0]
  closePoint(bulgeMid.point, [0, -1])
})

test('standard grips expose stable roles and GRIPEDIT commits real geometry changes', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'grips' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [20, 0], radius: 2 } })
  assert.deepEqual(getEntityGrips(document.getObject(line.id)).map(grip => grip.id), ['start', 'mid', 'end'])
  await sdk.executeCommand('GRIPEDIT', { id: line.id, gripId: 'end', point: [12, 4] })
  closePoint(document.getObject(line.id).payload.end, [12, 4])
  await sdk.executeCommand('GRIPEDIT', { id: line.id, gripId: 'mid', point: [10, 5] })
  closePoint(document.getObject(line.id).payload.start, [4, 3])
  closePoint(document.getObject(line.id).payload.end, [16, 7])
  await sdk.executeCommand('GRIPEDIT', { id: circle.id, gripId: 'quadrant:0', point: [25, 0] })
  close(document.getObject(circle.id).payload.radius, 5)
})

test('invalid grip edits roll back and preserve the prior revision payload', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'grip-rollback' })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0], radius: 2 } })
  const before = document.serialize()
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: circle.id, gripId: 'quadrant:0', point: [0, 0] }), KJValidationError)
  assert.equal(document.serialize(), before)
})
