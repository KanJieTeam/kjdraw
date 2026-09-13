import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK, findBestSnap, getDocumentSnapSettings, getEntityGrips, intersectEntityPair2, nearestPointOnEntity2 } from '../src/index.js'

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

test('full and partial ellipses expose exact rotated quadrant, endpoint and parameter-midpoint snaps', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'ellipse-object-snaps' })
  const full = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [10, 20, 3], majorAxis: [6, 8, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  const quadrants = sdk.snap([10, 20], { radius: 11, modes: ['quadrant'], entityIds: [full.id] })
  assert.equal(quadrants.length, 4)
  for (const expected of [[16, 28], [6, 23], [4, 12], [14, 17]]) {
    const candidate = quadrants.find(value => Math.hypot(value.point[0] - expected[0], value.point[1] - expected[1]) < 1e-9)
    assert.ok(candidate); assert.equal(candidate.point[2], 3); assert.ok(Number.isFinite(candidate.parameter))
  }
  assert.equal(sdk.snap([16, 28], { radius: .01, modes: ['endpoint'], entityIds: [full.id] }).length, 0)
  const exactParameter = Math.PI / 4
  const exactPoint = [10 + 2 * Math.SQRT1_2, 20 + 11 * Math.SQRT1_2]
  const nearest = sdk.snap(exactPoint, { radius: .01, modes: ['nearest'], entityIds: [full.id] })
  assert.equal(nearest.length, 1); closePoint(nearest[0].point, exactPoint, 1e-7); close(nearest[0].parameter, exactParameter, 1e-7)

  const partial = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [-20, 5, 0], majorAxis: [10, 0, 0], ratio: .4, startParameter: Math.PI / 2, endParameter: Math.PI * 1.5,
  } })
  const endpoints = sdk.snap([-20, 5], { radius: 20, modes: ['endpoint'], entityIds: [partial.id] })
  assert.equal(endpoints.length, 2); closePoint(endpoints[0].point, [-20, 9]); closePoint(endpoints[1].point, [-20, 1])
  assert.deepEqual(endpoints.map(value => value.role), ['start', 'end'])
  const midpoint = sdk.snap([-30, 5], { radius: 20, modes: ['midpoint'], entityIds: [partial.id] })
  assert.equal(midpoint.length, 1); closePoint(midpoint[0].point, [-30, 5])
  const partialQuadrants = sdk.snap([-20, 5], { radius: 20, modes: ['quadrant'], entityIds: [partial.id] })
  assert.deepEqual(partialQuadrants.map(value => value.parameter).sort((a, b) => a - b), [Math.PI / 2, Math.PI, Math.PI * 1.5])
  const nearestEndpoint = sdk.snap([-10, 5], { radius: 20, modes: ['nearest'], entityIds: [partial.id] })
  assert.equal(nearestEndpoint.length, 1); closePoint(nearestEndpoint[0].point, [-20, 9]); close(nearestEndpoint[0].parameter, Math.PI / 2)
})

test('ellipse intersection snaps transform line, ray and xline domains into the native ellipse parameter space', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'ellipse-intersection-snaps' })
  const rotated = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [10, 20, 0], majorAxis: [6, 8, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  const axis = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-2, 4, 0], end: [22, 36, 0] } })
  let intersections = sdk.snap([16, 28], { radius: .1, modes: ['intersection'], entityIds: [rotated.id, axis.id] })
  assert.equal(intersections.length, 1); closePoint(intersections[0].point, [16, 28]); assert.deepEqual(new Set(intersections[0].entityIds), new Set([rotated.id, axis.id]))
  intersections = sdk.snap([4, 12], { radius: .1, modes: ['intersection'], entityIds: [rotated.id, axis.id] })
  assert.equal(intersections.length, 1); closePoint(intersections[0].point, [4, 12])

  const partial = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [40, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI,
  } })
  const crossing = await sdk.executeCommand('CREATE', { type: 'XLINE', payload: { origin: [40, -20, 0], direction: [0, 1, 0] } })
  intersections = sdk.snap([40, 5], { radius: 20, modes: ['intersection'], entityIds: [partial.id, crossing.id] })
  assert.equal(intersections.length, 1); closePoint(intersections[0].point, [40, 5])
  const away = await sdk.executeCommand('CREATE', { type: 'RAY', payload: { origin: [70, 20, 0], direction: [1, 0, 0] } })
  assert.equal(sdk.snap([16, 28], { radius: 100, modes: ['intersection'], entityIds: [rotated.id, away.id] }).length, 0)
})

test('public nearest-point and intersection queries accept native ellipses', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'ellipse-geometry-queries' })
  const ellipse = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [10, 20, 0], majorAxis: [6, 8, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-2, 4, 0], end: [22, 36, 0] } })
  const nearest = nearestPointOnEntity2(ellipse, [16.2, 28.1])
  closePoint(nearest.point, [16, 28], 1e-7); close(nearest.parameter, 0, 1e-7); assert.equal(nearest.segmentIndex, null)
  const intersections = intersectEntityPair2(ellipse, line)
  assert.equal(intersections.kind, 'point'); assert.equal(intersections.infinite, false); assert.equal(intersections.points.length, 2)
  for (const expected of [[16, 28], [4, 12]]) assert.ok(intersections.points.some(point => Math.hypot(point[0] - expected[0], point[1] - expected[1]) < 1e-9))
})

test('native rational SPLINE intersects LINE, RAY and XLINE within both finite domains', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-linear-intersections' })
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2,
    controlPoints: [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    weights: [1, Math.SQRT1_2, 1],
    knots: [0, 0, 0, 1, 1, 1],
  } })
  const expected = [Math.sqrt(3) / 2, .5]
  const xline = await sdk.executeCommand('CREATE', { type: 'XLINE', payload: { origin: [0, .5, 0], direction: [1, 0, 0] } })
  let result = intersectEntityPair2(spline, xline)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], expected, 2e-8)

  const segment = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [.8, .5, 0], end: [.9, .5, 0] } })
  result = intersectEntityPair2(spline, segment)
  assert.equal(result.kind, 'point'); closePoint(result.points[0], expected, 2e-8)
  const short = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, .5, 0], end: [.8, .5, 0] } })
  assert.equal(intersectEntityPair2(spline, short).kind, 'none')
  const forward = await sdk.executeCommand('CREATE', { type: 'RAY', payload: { origin: [.8, .5, 0], direction: [1, 0, 0] } })
  result = intersectEntityPair2(spline, forward); assert.equal(result.kind, 'point'); closePoint(result.points[0], expected, 2e-8)
  const away = await sdk.executeCommand('CREATE', { type: 'RAY', payload: { origin: [.9, .5, 0], direction: [1, 0, 0] } })
  assert.equal(intersectEntityPair2(spline, away).kind, 'none')

  const candidates = sdk.snap([expected[0] + .002, expected[1] - .001], { radius: .02, modes: ['nearest', 'intersection'], entityIds: [spline.id, xline.id] })
  assert.equal(candidates.length, 1); assert.equal(candidates[0].mode, 'intersection'); closePoint(candidates[0].point, expected, 2e-8)
})

test('SPLINE intersection isolates tangency and repeated-knot spans with a bounded fail-closed degree', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-intersection-bounds' })
  const tangent = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[-1, 1, 0], [0, -1, 0], [1, 1, 0]], knots: [0, 0, 0, 1, 1, 1],
  } })
  const axis = await sdk.executeCommand('CREATE', { type: 'XLINE', payload: { origin: [0, 0, 0], direction: [1, 0, 0] } })
  let result = intersectEntityPair2(tangent, axis)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], [0, 0], 2e-8)

  const multi = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2,
    controlPoints: [[-2, -1, 0], [-1, 1, 0], [0, -1, 0], [1, 1, 0], [2, -1, 0]],
    knots: [0, 0, 0, .5, .5, 1, 1, 1],
  } })
  result = intersectEntityPair2(multi, axis)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 2)
  assert.ok(result.points.every(point => Math.abs(point[1]) <= 2e-8 && point[0] >= -2 && point[0] <= 2))
  assert.ok(result.points[0][0] < 0 && result.points[1][0] > 0)

  const degree = 17, controls = Array.from({ length: degree + 1 }, (_, index) => [index, index % 2, 0])
  const oversizedDegree = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree, controlPoints: controls, knots: [...Array(degree + 1).fill(0), ...Array(degree + 1).fill(1)] } })
  assert.throws(() => intersectEntityPair2(oversizedDegree, axis), /degree must be an integer from 1 to 16/)
})

test('native rational SPLINE intersects CIRCLE and filters the native ARC angular domain', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-circular-intersections' })
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2,
    controlPoints: [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    weights: [1, Math.SQRT1_2, 1],
    knots: [0, 0, 0, 1, 1, 1],
  } })
  const expected = [.6875, Math.sqrt(1 - .6875 ** 2)]
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [.5, 0, 0], radius: .75 } })
  let result = intersectEntityPair2(spline, circle)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], expected, 2e-8)
  assert.deepEqual(intersectEntityPair2(circle, spline), result)

  const upper = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [.5, 0, 0], radius: .75, startAngle: 0, endAngle: Math.PI } })
  result = intersectEntityPair2(spline, upper)
  assert.equal(result.kind, 'point'); closePoint(result.points[0], expected, 2e-8)
  const lower = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [.5, 0, 0], radius: .75, startAngle: Math.PI, endAngle: Math.PI * 2 } })
  assert.equal(intersectEntityPair2(spline, lower).kind, 'none')

  const candidates = sdk.snap([expected[0] + .001, expected[1] - .002], { radius: .02, modes: ['nearest', 'intersection'], entityIds: [spline.id, circle.id] })
  assert.equal(candidates.length, 1); assert.equal(candidates[0].mode, 'intersection'); closePoint(candidates[0].point, expected, 2e-8)
})

test('SPLINE circular intersections retain tangent contact, overlap and weight accuracy boundaries', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-circular-boundaries' })
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2,
    controlPoints: [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1],
  } })
  const tangent = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [Math.SQRT1_2 / 2, Math.SQRT1_2 / 2, 0], radius: .5 } })
  let result = intersectEntityPair2(spline, tangent)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], [Math.SQRT1_2, Math.SQRT1_2], 2e-8)
  const sameCircle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 1 } })
  result = intersectEntityPair2(spline, sameCircle)
  assert.deepEqual(result, { kind: 'overlap', points: [], infinite: true })

  const unstable = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[0, 0, 0], [1, 1, 0], [2, 0, 0]], weights: [1, 1e-13, 1], knots: [0, 0, 0, 1, 1, 1],
  } })
  assert.throws(() => intersectEntityPair2(unstable, sameCircle), /weight ratio exceeds the 1e12 accuracy bound/)
})

test('native rational SPLINE intersects rotated ELLIPSE geometry and filters its elliptical-arc domain', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-ellipse-intersections' })
  const angle = Math.PI / 6, cosine = Math.cos(angle), sine = Math.sin(angle), center = [4, -3, 0]
  const transform = ([x, y]) => [center[0] + cosine * x - sine * y, center[1] + sine * x + cosine * y, 0]
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[1, 0], [1, 1], [0, 1]].map(transform),
    weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1],
  } })
  const x = 9 / Math.sqrt(125), y = Math.sqrt(44 / 125), expected = transform([x, y])
  const ellipsePayload = { center, majorAxis: [1.2 * cosine, 1.2 * sine, 0], ratio: 2 / 3 }
  const ellipse = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: { ...ellipsePayload, startParameter: 0, endParameter: Math.PI * 2 } })
  let result = intersectEntityPair2(spline, ellipse)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], expected, 2e-8)
  assert.deepEqual(intersectEntityPair2(ellipse, spline), result)

  const upper = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: { ...ellipsePayload, startParameter: 0, endParameter: Math.PI / 2 } })
  result = intersectEntityPair2(spline, upper)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], expected, 2e-8)
  const excluded = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: { ...ellipsePayload, startParameter: Math.PI, endParameter: Math.PI * 2 } })
  assert.equal(intersectEntityPair2(spline, excluded).kind, 'none')

  const candidates = sdk.snap([expected[0] + .001, expected[1] - .001], { radius: .02, modes: ['nearest', 'intersection'], entityIds: [spline.id, ellipse.id] })
  assert.equal(candidates.length, 1); assert.equal(candidates[0].mode, 'intersection'); closePoint(candidates[0].point, expected, 2e-8)
})

test('SPLINE elliptical intersections retain internal tangency, overlap and conditioning boundaries', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-ellipse-boundaries' })
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1],
  } })
  const tangent = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [.8 * Math.SQRT1_2, .8 * Math.SQRT1_2, 0], majorAxis: [-.3 * Math.SQRT1_2, .3 * Math.SQRT1_2, 0], ratio: 2 / 3,
    startParameter: 0, endParameter: Math.PI * 2,
  } })
  let result = intersectEntityPair2(spline, tangent)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], [Math.SQRT1_2, Math.SQRT1_2], 2e-8)

  const coincident = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [0, 0, 0], majorAxis: [1, 0, 0], ratio: 1, startParameter: 0, endParameter: Math.PI / 4,
  } })
  result = intersectEntityPair2(spline, coincident)
  assert.deepEqual(result, { kind: 'overlap', points: [], infinite: true })

  const illConditioned = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [0, 0, 0], majorAxis: [1, 0, 0], ratio: 1e-13, startParameter: 0, endParameter: Math.PI * 2,
  } })
  assert.throws(() => intersectEntityPair2(spline, illConditioned), /bounded nondegenerate semiaxes/)
})

test('native rational SPLINE intersects another native SPLINE symmetrically at crossings and endpoints', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-spline-crossings' })
  const arc = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1],
  } })
  const crossing = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 1, controlPoints: [[0, .5, 0], [1, .5, 0]], weights: [1, 2], knots: [0, 0, 1, 1],
  } })
  const expected = [Math.sqrt(3) / 2, .5]
  let result = intersectEntityPair2(arc, crossing)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], expected, 2e-8)
  assert.deepEqual(intersectEntityPair2(crossing, arc), result)
  const candidates = sdk.snap([expected[0] + .001, expected[1] - .001], { radius: .02, modes: ['nearest', 'intersection'], entityIds: [arc.id, crossing.id] })
  assert.equal(candidates.length, 1); assert.equal(candidates[0].mode, 'intersection'); closePoint(candidates[0].point, expected, 2e-8)

  const endpoint = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 1, controlPoints: [[1, 0, 0], [2, -1, 0]], knots: [0, 0, 1, 1],
  } })
  result = intersectEntityPair2(arc, endpoint)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], [1, 0], 2e-8)
  const away = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 1, controlPoints: [[0, 2, 0], [1, 2, 0]], weights: [2, 1], knots: [0, 0, 1, 1],
  } })
  assert.equal(intersectEntityPair2(arc, away).kind, 'none')
})

test('SPLINE/SPLINE returns every isolated crossing in canonical curve order', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-spline-multiple-crossings' })
  const arch = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[0, 0, 0], [.5, 2, 0], [1, 0, 0]], knots: [0, 0, 0, 1, 1, 1],
  } })
  const axis = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 1, controlPoints: [[0, .5, 0], [1, .5, 0]], weights: [1, 3], knots: [0, 0, 1, 1],
  } })
  const result = intersectEntityPair2(arch, axis), parameters = [(1 - Math.SQRT1_2) / 2, (1 + Math.SQRT1_2) / 2]
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 2)
  for (const parameter of parameters) assert.ok(result.points.some(point => Math.hypot(point[0] - parameter, point[1] - .5) <= 2e-8))
  assert.deepEqual(intersectEntityPair2(axis, arch), result)
})

test('SPLINE/SPLINE intersections preserve tangent contact and prove forward or reversed native overlap', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-spline-tangent-overlap' })
  const controlPoints = [[1, 0, 0], [1, 1, 0], [0, 1, 0]], weights = [1, Math.SQRT1_2, 1]
  const arc = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 2, controlPoints, weights, knots: [0, 0, 0, 1, 1, 1] } })
  const touch = [Math.SQRT1_2, Math.SQRT1_2]
  const tangent = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 1,
    controlPoints: [[touch[0] + .5, touch[1] - .5, 0], [touch[0] - .5, touch[1] + .5, 0]],
    knots: [0, 0, 1, 1],
  } })
  let result = intersectEntityPair2(arc, tangent)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], touch, 2e-8)

  const scaledKnots = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints, weights: weights.map(value => value * 2), knots: [5, 5, 5, 9, 9, 9],
  } })
  assert.deepEqual(intersectEntityPair2(arc, scaledKnots), { kind: 'overlap', points: [], infinite: true })
  const reversed = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [...controlPoints].reverse(), weights: [...weights].reverse(), knots: [0, 0, 0, 1, 1, 1],
  } })
  assert.deepEqual(intersectEntityPair2(arc, reversed), { kind: 'overlap', points: [], infinite: true })
})

test('SPLINE/SPLINE intersection rejects degenerate curves and exhausts a deterministic span-pair budget', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-spline-bounds' })
  const arc = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[1, 0, 0], [1, 1, 0], [0, 1, 0]], weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1],
  } })
  const degenerate = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 1, controlPoints: [[0, 0, 0], [0, 0, 0]], knots: [0, 0, 1, 1],
  } })
  assert.throws(() => intersectEntityPair2(arc, degenerate), /requires nondegenerate planar curves/)

  const count = 365, knots = [0, 0, ...Array.from({ length: count - 2 }, (_, index) => index + 1), count - 1, count - 1]
  const first = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 1, controlPoints: Array.from({ length: count }, (_, index) => [index % 2, index % 2, 0]), knots,
  } })
  const second = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 1, controlPoints: Array.from({ length: count }, (_, index) => [index % 2, 1 - index % 2, 0]), knots,
  } })
  assert.throws(() => intersectEntityPair2(first, second), /exceeds the 131072 interval work budget/)
})

test('ellipse intersections support circles, arc domains and tangent contact', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'ellipse-circular-intersections' })
  const ellipse = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [0, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 8 } })
  let result = intersectEntityPair2(ellipse, circle)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 4)
  for (const point of result.points) { close(point[0] * point[0] / 100 + point[1] * point[1] / 25, 1, 1e-8); close(Math.hypot(point[0], point[1]), 8, 1e-8) }
  let candidates = sdk.snap([Math.sqrt(52), Math.sqrt(12)], { radius: .01, modes: ['intersection'], entityIds: [ellipse.id, circle.id] })
  assert.equal(candidates.length, 1); closePoint(candidates[0].point, [Math.sqrt(52), Math.sqrt(12)], 1e-8)

  const upperArc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [0, 0, 0], radius: 8, startAngle: 0, endAngle: Math.PI } })
  result = intersectEntityPair2(ellipse, upperArc)
  assert.equal(result.points.length, 2); assert.ok(result.points.every(point => point[1] >= -1e-9))
  const tangentCircle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 5 } })
  result = intersectEntityPair2(ellipse, tangentCircle)
  assert.equal(result.points.length, 2)
  for (const expected of [[0, 5], [0, -5]]) assert.ok(result.points.some(point => Math.hypot(point[0] - expected[0], point[1] - expected[1]) < 1e-8))
})

test('ellipse intersections support translated profiles, partial domains and coincident arcs', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'ellipse-ellipse-intersections' })
  const first = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [0, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  const translated = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [6, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  let result = intersectEntityPair2(first, translated)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 2)
  for (const expected of [[3, 5 * Math.sqrt(.91)], [3, -5 * Math.sqrt(.91)]]) assert.ok(result.points.some(point => Math.hypot(point[0] - expected[0], point[1] - expected[1]) < 1e-8))
  const upper = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [6, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI,
  } })
  result = intersectEntityPair2(first, upper)
  assert.equal(result.points.length, 1); closePoint(result.points[0], [3, 5 * Math.sqrt(.91)], 1e-8)
  const tangent = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [20, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  result = intersectEntityPair2(first, tangent)
  assert.equal(result.points.length, 1); closePoint(result.points[0], [10, 0], 1e-8)

  const same = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [0, 0, 0], majorAxis: [-10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  result = intersectEntityPair2(first, same)
  assert.equal(result.kind, 'overlap'); assert.equal(result.infinite, true)
  const quarterA = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [40, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI / 2,
  } })
  const quarterB = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [40, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: Math.PI / 2, endParameter: Math.PI,
  } })
  result = intersectEntityPair2(quarterA, quarterB)
  assert.equal(result.kind, 'point'); assert.equal(result.points.length, 1); closePoint(result.points[0], [40, 5])
  const disjoint = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [40, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: Math.PI, endParameter: Math.PI * 1.5,
  } })
  assert.equal(intersectEntityPair2(quarterA, disjoint).kind, 'none')
})

test('ellipse tangent snaps are exact for external references and respect partial-arc domains', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'ellipse-tangent-snaps' })
  const full = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [0, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  const upper = [5, 5 * Math.sqrt(3) / 2]
  let tangents = sdk.snap(upper, { radius: .01, modes: ['tangent'], entityIds: [full.id], referencePoint: [20, 0] })
  assert.equal(tangents.length, 1); closePoint(tangents[0].point, upper); close(tangents[0].parameter, Math.PI / 3)
  const tangentVector = [-10 * Math.sin(tangents[0].parameter), 5 * Math.cos(tangents[0].parameter)]
  close((tangents[0].point[0] - 20) * tangentVector[1] - tangents[0].point[1] * tangentVector[0], 0)
  assert.equal(sdk.snap([5, 0], { radius: 20, modes: ['tangent'], entityIds: [full.id], referencePoint: [0, 0] }).length, 0)

  const partial = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [30, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI,
  } })
  tangents = sdk.snap([35, 4.3], { radius: 1, modes: ['tangent'], entityIds: [partial.id], referencePoint: [50, 0] })
  assert.equal(tangents.length, 1); closePoint(tangents[0].point, [35, 5 * Math.sqrt(3) / 2]); close(tangents[0].parameter, Math.PI / 3)
})

test('ellipse perpendicular snaps solve rotated normal points and respect partial-arc domains', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'ellipse-perpendicular-snaps' })
  const full = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [-30, 20, 0], majorAxis: [8, 6, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2,
  } })
  const reference = [-14, 32], majorEnd = [-22, 26]
  let feet = sdk.snap(majorEnd, { radius: .01, modes: ['perpendicular'], entityIds: [full.id], referencePoint: reference })
  assert.equal(feet.length, 1); closePoint(feet[0].point, majorEnd); close(feet[0].parameter, 0)
  const tangentVector = [-3, 4], connector = [feet[0].point[0] - reference[0], feet[0].point[1] - reference[1]]
  close(connector[0] * tangentVector[0] + connector[1] * tangentVector[1], 0)

  const partial = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [20, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: Math.PI / 2, endParameter: Math.PI * 1.5,
  } })
  feet = sdk.snap([30, 0], { radius: .01, modes: ['perpendicular'], entityIds: [partial.id], referencePoint: [40, 0] })
  assert.equal(feet.length, 0)
  feet = sdk.snap([10, 0], { radius: .01, modes: ['perpendicular'], entityIds: [partial.id], referencePoint: [40, 0] })
  assert.equal(feet.length, 1); closePoint(feet[0].point, [10, 0]); close(feet[0].parameter, Math.PI)
  const circular = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [60, 0, 0], majorAxis: [5, 0, 0], ratio: 1, startParameter: 0, endParameter: Math.PI * 2,
  } })
  assert.equal(sdk.snap([65, 0], { radius: 10, modes: ['perpendicular'], entityIds: [circular.id], referencePoint: [60, 0] }).length, 0)
})

test('native rational SPLINE exposes exact tangent and perpendicular snaps from a construction reference', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-relation-snaps' })
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1],
  } })
  const tangentPoint = [.5, Math.sqrt(3) / 2]
  let candidates = sdk.snap([tangentPoint[0] + .001, tangentPoint[1] - .001], {
    radius: .02, modes: ['tangent', 'nearest'], entityIds: [spline.id], referencePoint: [2, 0],
  })
  assert.equal(candidates.length, 1); assert.equal(candidates[0].mode, 'tangent'); closePoint(candidates[0].point, tangentPoint, 2e-8)
  const tangent = [-Math.sin(Math.PI / 3), Math.cos(Math.PI / 3)], connector = [2 - candidates[0].point[0], -candidates[0].point[1]]
  close(tangent[0] * connector[1] - tangent[1] * connector[0], 0, 2e-8)

  candidates = sdk.snap([1, 0], { radius: .01, modes: ['perpendicular', 'nearest'], entityIds: [spline.id], referencePoint: [2, 0] })
  assert.equal(candidates.length, 1); assert.equal(candidates[0].mode, 'perpendicular'); closePoint(candidates[0].point, [1, 0]); close(candidates[0].parameter, 0)
})

test('SPLINE relation roots retain multiple normals, multiple tangents and repeated tangent contact', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-relation-root-coverage' })
  const parabola = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[-1, 1, 0], [0, -1, 0], [1, 1, 0]], knots: [0, 0, 0, 1, 1, 1],
  } })
  let candidates = sdk.snap([0, 0], { radius: 10, modes: ['perpendicular'], entityIds: [parabola.id], referencePoint: [0, 1] })
  assert.equal(candidates.length, 3)
  for (const x of [-Math.SQRT1_2, 0, Math.SQRT1_2]) assert.ok(candidates.some(candidate => Math.hypot(candidate.point[0] - x, candidate.point[1] - x * x) <= 2e-8))
  candidates = sdk.snap([0, 0], { radius: 10, modes: ['tangent'], entityIds: [parabola.id], referencePoint: [0, -.5] })
  assert.equal(candidates.length, 2)
  for (const x of [-Math.SQRT1_2, Math.SQRT1_2]) assert.ok(candidates.some(candidate => Math.hypot(candidate.point[0] - x, candidate.point[1] - .5) <= 2e-8))

  const cubic = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 3, controlPoints: [[-1, -1, 0], [-1 / 3, 1, 0], [1 / 3, -1, 0], [1, 1, 0]], knots: [0, 0, 0, 0, 1, 1, 1, 1],
  } })
  candidates = sdk.snap([0, 0], { radius: .01, modes: ['tangent'], entityIds: [cubic.id], referencePoint: [-1, 0] })
  assert.equal(candidates.length, 1); closePoint(candidates[0].point, [0, 0], 2e-8); close(candidates[0].parameter, .5, 2e-8)
})

test('SPLINE relation snapping fails closed for indeterminate, degenerate, unstable and over-budget geometry', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-relation-bounds' })
  const line = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 1, controlPoints: [[-1, 0, 0], [1, 0, 0]], knots: [0, 0, 1, 1] } })
  assert.equal(sdk.snap([0, 0], { radius: 10, modes: ['tangent'], entityIds: [line.id], referencePoint: [-2, 0] }).length, 0)
  const degenerate = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 1, controlPoints: [[0, 0, 0], [0, 0, 0]], knots: [0, 0, 1, 1] } })
  assert.equal(sdk.snap([0, 0], { radius: 10, modes: ['perpendicular', 'tangent'], entityIds: [degenerate.id], referencePoint: [2, 0] }).length, 0)
  const unstable = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[0, 0, 0], [1, 1, 0], [2, 0, 0]], weights: [1, 1e-13, 1], knots: [0, 0, 0, 1, 1, 1],
  } })
  assert.throws(() => sdk.snap([1, 0], { radius: 10, modes: ['perpendicular'], entityIds: [unstable.id], referencePoint: [1, 2] }), /weight ratio exceeds the 1e12 accuracy bound/)
  assert.throws(() => sdk.snap([0, 0], { radius: 10, modes: ['tangent'], entityIds: [line.id], referencePoint: [1e13, 0] }), /reference must be finite within ±1e12/)

  const spans = 1500, controls = [[-1, 1, 0], [0, -1, 0], [1, 1, 0]]
  for (let span = 1; span < spans; span += 1) controls.push([0, -1, 0], [span % 2 ? -1 : 1, 1, 0])
  const knots = [0, 0, 0]
  for (let span = 1; span < spans; span += 1) knots.push(span, span)
  knots.push(spans, spans, spans)
  const oversized = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 2, controlPoints: controls, knots } })
  assert.throws(() => sdk.snap([0, 0], { radius: 10, modes: ['perpendicular'], entityIds: [oversized.id], referencePoint: [0, 1] }), /exceeds the 131072 interval work budget/)
})

test('native spline endpoint, midpoint and nearest snaps follow the evaluated curve', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'spline-object-snaps' })
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[0, 0, 2], [5, 10, 4], [10, 0, 6]], knots: [0, 0, 0, 1, 1, 1],
  } })
  const endpoints = sdk.snap([5, 0], { radius: 20, modes: ['endpoint'], entityIds: [spline.id] })
  assert.equal(endpoints.length, 2); assert.deepEqual(endpoints.map(value => value.role), ['start', 'end'])
  assert.deepEqual(endpoints[0].point, [0, 0, 2]); assert.deepEqual(endpoints[1].point, [10, 0, 6])
  const midpoint = sdk.snap([5, 5], { radius: .01, modes: ['midpoint'], entityIds: [spline.id] })
  assert.equal(midpoint.length, 1); closePoint(midpoint[0].point, [5, 5]); close(midpoint[0].point[2], 4); close(midpoint[0].parameter, .5)
  const nearest = sdk.snap([5, 6], { radius: 2, modes: ['nearest'], entityIds: [spline.id] })
  assert.equal(nearest.length, 1); closePoint(nearest[0].point, [5, 5], 1e-7); close(nearest[0].parameter, .5, 1e-7)
  const queried = nearestPointOnEntity2(spline, [5, 6])
  closePoint(queried.point, [5, 5], 1e-7); close(queried.point[2], 4, 1e-7); assert.equal(queried.segmentIndex, null)

  const closed = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
    degree: 2, controlPoints: [[20, 0], [25, 10], [30, 0]], knots: [0, 0, 0, 1, 1, 1], closed: true,
  } })
  assert.equal(sdk.snap([25, 0], { radius: 20, modes: ['endpoint'], entityIds: [closed.id] }).length, 0)
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

test('perpendicular and tangent snaps use the construction reference and exact curve domains', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'relationship-snaps' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [30, 0], radius: 10 } })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [0, 30], radius: 10, startAngle: 0, endAngle: Math.PI } })

  const foot = sdk.snap([4.2, 0.2], { radius: 1, modes: ['perpendicular', 'nearest'], entityIds: [line.id], referencePoint: [4, 8] })
  assert.deepEqual(foot.map(candidate => candidate.mode), ['perpendicular'])
  closePoint(foot[0].point, [4, 0])
  assert.equal(sdk.snap([20, 0], { radius: 30, modes: ['perpendicular'], entityIds: [line.id], referencePoint: [20, 8] }).length, 0)

  const circleFeet = sdk.snap([40, 0], { radius: 25, modes: ['perpendicular'], entityIds: [circle.id], referencePoint: [50, 0] })
  assert.equal(circleFeet.length, 2)
  closePoint(circleFeet[0].point, [40, 0])
  closePoint(circleFeet[1].point, [20, 0])

  const tangent = sdk.snap([35, 8.7], { radius: 1, modes: ['tangent', 'nearest'], entityIds: [circle.id], referencePoint: [50, 0] })
  assert.deepEqual(tangent.map(candidate => candidate.mode), ['tangent'])
  closePoint(tangent[0].point, [35, Math.sqrt(75)])
  const radius = [tangent[0].point[0] - 30, tangent[0].point[1]], construction = [50 - tangent[0].point[0], -tangent[0].point[1]]
  close(radius[0] * construction[0] + radius[1] * construction[1], 0)

  const arcTangents = sdk.snap([5, 38.7], { radius: 2, modes: ['tangent'], entityIds: [arc.id], referencePoint: [20, 30] })
  assert.equal(arcTangents.length, 1)
  closePoint(arcTangents[0].point, [5, 30 + Math.sqrt(75)])
  assert.equal(sdk.snap([40, 0], { radius: 30, modes: ['tangent'], entityIds: [circle.id], referencePoint: [30, 0] }).length, 0)
  assert.equal(sdk.snap([4, 0], { radius: 2, modes: ['perpendicular'], entityIds: [line.id] }).length, 0)
  assert.throws(() => sdk.snap([4, 0], { modes: ['perpendicular'], referencePoint: [Number.NaN, 0] }), /referencePoint/)
})

test('snap references exclude hidden, frozen and other-space geometry while locked layers remain usable', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'snap-visibility' })
  const locked = await sdk.executeCommand('LAYERNEW', { name: 'Locked', locked: true })
  const hidden = await sdk.executeCommand('LAYERNEW', { name: 'Hidden', visible: false })
  const frozen = await sdk.executeCommand('LAYERNEW', { name: 'Frozen', frozen: true })
  let ids
  await document.transact('References', tx => {
    ids = {
      locked: tx.createEntity('LINE', { start: [-5, 0], end: [5, 0], layerId: locked.id }).id,
      hidden: tx.createEntity('LINE', { start: [-5, 10], end: [5, 10], layerId: hidden.id }).id,
      frozen: tx.createEntity('LINE', { start: [-5, 20], end: [5, 20], layerId: frozen.id }).id,
      invisible: tx.createEntity('LINE', { start: [-5, 30], end: [5, 30], visible: false }).id,
      paper: tx.createEntity('LINE', { start: [-5, 40], end: [5, 40] }, { ownerId: document.snapshot().spaces.paperSpaceIds[0] }).id,
    }
  })
  assert.equal(sdk.snap([0, 0.2], { radius: 1, modes: ['nearest'] })[0].entityIds[0], ids.locked)
  for (const y of [10, 20, 30, 40]) assert.equal(sdk.snap([0, y], { radius: 1, modes: ['nearest'] }).length, 0)
  const paper = sdk.snap([0, 40], { radius: 1, modes: ['nearest'], spaceId: document.snapshot().spaces.paperSpaceIds[0] })[0]
  assert.equal(paper.entityIds[0], ids.paper)
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
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'perpendicular', 'tangent', 'nearest'], aperture: 10 })
  await sdk.executeCommand('SNAPSETTINGS', { modes: ['quadrant', 'nearest'], radius: 17 })
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['quadrant', 'nearest'], aperture: 17 })
  await sdk.executeCommand('UNDO')
  assert.deepEqual(getDocumentSnapSettings(document), { modes: ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'perpendicular', 'tangent', 'nearest'], aperture: 10 })
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
