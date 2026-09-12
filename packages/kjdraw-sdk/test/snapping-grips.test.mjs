import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK, findBestSnap, getDocumentSnapSettings, getEntityGrips } from '../src/index.js'

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

test('circle and arc quadrant snaps keep exact coordinates, sweep boundaries and radius limits', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'quadrant-boundaries' })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [10, -5, 0], radius: 5 } })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [-10, 5, 0], radius: 4, startAngle: 0, endAngle: Math.PI / 2 } })
  const circlePoints = sdk.snap([10, -5], { radius: 6, modes: ['quadrant'], entityIds: [circle.id] })
  for (const expected of [[15, -5], [10, 0], [5, -5], [10, -10]]) assert.ok(circlePoints.some(candidate => Math.hypot(candidate.point[0] - expected[0], candidate.point[1] - expected[1]) < 1e-9))
  assert.ok(circlePoints.every(candidate => candidate.mode === 'quadrant' && candidate.entityIds[0] === circle.id))
  const arcPoints = sdk.snap([-10, 5], { radius: 5, modes: ['quadrant'], entityIds: [arc.id] })
  assert.equal(arcPoints.length, 2); closePoint(arcPoints[0].point, [-6, 5]); closePoint(arcPoints[1].point, [-10, 9])
  assert.equal(sdk.snap([15.02, -5], { radius: 0.01, modes: ['quadrant'], entityIds: [circle.id] }).length, 0)
  closePoint(sdk.snap([15.02, -5], { radius: 0.03, modes: ['quadrant'], entityIds: [circle.id] })[0].point, [15, -5])
  assert.throws(() => sdk.snap([0, 0], { radius: 0, modes: ['quadrant'] }), /radius must be positive/)
})

test('exact snaps outrank nearest while nearest remains an explicit fallback', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'snap-priority' })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0], radius: 10 } })
  const exact = sdk.snap([10, 0.2], { radius: 1, modes: ['quadrant', 'nearest'], entityIds: [circle.id] })
  assert.deepEqual(exact.map(candidate => candidate.mode), ['quadrant'])
  closePoint(exact[0].point, [10, 0])
  const fallback = sdk.snap([10, 0.2], { radius: 1, modes: ['nearest'], entityIds: [circle.id] })
  assert.equal(fallback[0].mode, 'nearest')
  assert.equal(sdk.snap([10, 0.2], { radius: 1, modes: [], entityIds: [circle.id] }).length, 0)
  assert.doesNotThrow(() => sdk.snap([10, 0.2], { radius: 1, modes: ['quadrant'], maxIntersectionPairs: 0 }))
})

test('intersection pair budget searches nearby primitives before distant drawing content', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'snap-budget' })
  for (let index = 0; index < 20; index += 1) await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [1000 + index * 10, 1000], end: [1000 + index * 10, 1010] } })
  const horizontal = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-10, 0], end: [10, 0] } })
  const vertical = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, -10], end: [0, 10] } })
  const hit = sdk.snap([0.1, 0.1], { radius: 1, modes: ['intersection'], maxIntersectionPairs: 1 })[0]
  assert.equal(hit.mode, 'intersection')
  assert.deepEqual(new Set(hit.entityIds), new Set([horizontal.id, vertical.id]))
  closePoint(hit.point, [0, 0])
  assert.throws(() => sdk.snap([0, 0], { modes: ['intersection'], maxIntersectionPairs: 0 }), /positive safe integer/)
})

test('document snap settings default, persist through KJD and participate in undo-redo', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'snap-settings' })
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'nearest'], aperture: 10 })
  await sdk.executeCommand('SNAPSETTINGS', { modes: ['quadrant', 'nearest'], radius: 17 })
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['quadrant', 'nearest'], aperture: 17 })
  await sdk.executeCommand('UNDO')
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'nearest'], aperture: 10 })
  await sdk.executeCommand('REDO')
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['quadrant', 'nearest'], aperture: 17 })
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(getDocumentSnapSettings(reopened), { modes: ['quadrant', 'nearest'], aperture: 17 })
  await sdk.executeCommand('SNAPSETTINGS', { modes: [], radius: 6 })
  assert.deepEqual(getDocumentSnapSettings(document), { modes: [], aperture: 6 })
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
