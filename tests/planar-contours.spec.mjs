import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { spawnSyncWithFileStdin } from '../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK, computePlanarContours, previewPlanarContourEdit, applyPlanarContourEdit } from '../packages/kjdraw-sdk/src/index.js'

const backend = async () => ({ wasmBytes: await readFile(new URL('../packages/kjdraw-sdk/src/assets/kjcontour.wasm', import.meta.url)) })
const vertex = (x, y, bulge = 0) => ({ point: [x, y, 0], bulge })
const square = (x0, y0, x1, y1) => ({ closed: true, vertices: [vertex(x0, y0), vertex(x1, y0), vertex(x1, y1), vertex(x0, y1)] })
const circle = (radius, x = 0, y = 0, clockwise = false) => ({ closed: true, vertices: [vertex(x - radius, y, clockwise ? -1 : 1), vertex(x + radius, y, clockwise ? -1 : 1)] })
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)

// Independent Green integral: each circular segment supplements the chord area.
// This does not use SDK geometry, flattening, or the WASM result's area field.
function signedArea(contour) {
  const origin = contour.vertices[0].point
  return contour.vertices.reduce((area, a, i, vertices) => {
    const b = vertices[(i + 1) % vertices.length]
    const [ax, ay] = [a.point[0] - origin[0], a.point[1] - origin[1]], [bx, by] = [b.point[0] - origin[0], b.point[1] - origin[1]]
    const bulge = a.bulge ?? 0, chord = Math.hypot(bx - ax, by - ay)
    const theta = 4 * Math.atan(bulge), radius = bulge === 0 ? 0 : chord * (1 + bulge * bulge) / (4 * Math.abs(bulge))
    const segment = Math.abs(theta) < 1e-3 ? theta ** 3 / 6 - theta ** 5 / 120 + theta ** 7 / 5040 : theta - Math.sin(theta)
    return area + (ax * by - bx * ay) / 2 + radius * radius * segment / 2
  }, 0)
}
function arcGeometry(a, b) {
  const [ax, ay] = a.point, [bx, by] = b.point, q = a.bulge, dx = bx - ax, dy = by - ay
  assert.notEqual(q, 0)
  return { center: [(ax + bx) / 2 - dy * (1 - q * q) / (4 * q), (ay + by) / 2 + dx * (1 - q * q) / (4 * q)], radius: Math.hypot(dx, dy) * (1 + q * q) / (4 * Math.abs(q)) }
}
function circleBoundaryError(result, center, expectedRadius) {
  assert.equal(result.contours.length, 1)
  let error = 0
  const vertices = result.contours[0].vertices
  const twoSum = (a, b) => { const sum = a + b, split = sum - a; return [sum, (a - (sum - split)) + (b - split)] }
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length], q = a.bulge ?? 0
    assert.notEqual(q, 0)
    const dx = b.point[0] - a.point[0], dy = b.point[1] - a.point[1], k = (1 - q * q) / (4 * q)
    const centerDelta = [0, 1].map(axis => {
      const [sum, low] = twoSum(a.point[axis], b.point[axis]), [relative, remainder] = twoSum(sum / 2, -center[axis])
      return relative + (remainder + low / 2) + (axis === 0 ? -dy * k : dx * k)
    })
    const geometry = { center: centerDelta, radius: Math.hypot(dx, dy) * (1 + q * q) / (4 * Math.abs(q)) }
    // Exact circle Hausdorff distance: Euclidean center displacement plus radius
    // displacement. Per-component bounds do not establish the requested tolerance.
    error = Math.max(error, Math.hypot(...geometry.center) + Math.abs(geometry.radius - expectedRadius))
  }
  return error
}
function precisionRefusal(error) {
  assert.equal(error.name, 'KJValidationError')
  assert.match(`${error.message} ${error.details?.cause ?? ''} ${error.cause?.message ?? ''}`, /tolerance|precision|represent|budget|preserve|conversion|uncertainty|localization|translation/i)
}
function receiptBudget(receipt) {
  assert.ok(Number.isFinite(receipt.sourceBoundaryError) && receipt.sourceBoundaryError >= 0)
  assert.ok(Number.isFinite(receipt.backendTolerance) && receipt.backendTolerance >= 1e-9)
  assert.ok(receipt.sourceBoundaryError + receipt.backendTolerance <= receipt.tolerance, 'Source and backend tolerances must fit the caller budget together')
}
function verifyResult(result, expectedArea) {
  close(result.area, expectedArea)
  close(result.contours.reduce((sum, ring) => sum + signedArea(ring), 0), expectedArea)
  for (const ring of result.contours) {
    assert.equal(ring.closed, true)
    assert.ok(ring.vertices.length >= 2)
    close(ring.area, signedArea(ring))
    assert.equal(ring.hole, signedArea(ring) < 0)
    for (const item of ring.vertices) {
      assert.equal(item.point.length, 3); assert.equal(item.point[2], 0)
      assert.ok(item.point.every(Number.isFinite)); assert.ok(Number.isFinite(item.bulge ?? 0))
    }
  }
  assert.equal(result.receipt.schema, 'kjdraw.planar-contours.v1')
  assert.equal(result.receipt.backend, 'cavalier-contours-wasm')
  assert.equal(result.receipt.resultCount, result.contours.length)
  receiptBudget(result.receipt)
  assert.match(result.receipt.inputDigest, /^[a-f0-9]{16}$/)
  assert.match(result.receipt.geometryDigest, /^[a-f0-9]{16}$/)
}
const state = document => ({ serialized: document.serialize(), history: JSON.stringify(document.history), revision: document.revision })
const unchanged = (document, before) => assert.deepEqual(state(document), before)
const request = (document, operation, ids, extra = {}) => ({ operation, ids, units: 'millimeter', expectedRevision: document.revision, ...extra })
async function fixture(specs) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'planar-contour-acceptance', units: 'millimeter' })
  const sources = []
  for (const spec of specs) sources.push(await sdk.executeCommand('CREATE', spec, { document }))
  const sentinel = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [100, 100, 0], end: [101, 102, 0], color: 3 } }, { document })
  return { sdk, document, sources, sentinel }
}
const circleSpec = (radius = 10, x = 0) => ({ type: 'CIRCLE', payload: { center: [x, 0, 0], radius, color: 2 } })
const polySpec = contour => ({ type: 'LWPOLYLINE', payload: { ...contour, color: 2 } })

test('arc offset has independently verified area, radius, distance and native bulges in both input orientations', async () => {
  for (const clockwise of [false, true]) {
    const input = { operation: 'offset', contours: [circle(10, 0, 0, clockwise)], distance: 2, tolerance: 1e-8 }
    const original = structuredClone(input), result = await computePlanarContours(input, await backend())
    assert.deepEqual(input, original)
    verifyResult(result, 144 * Math.PI)
    assert.equal(result.contours.length, 1)
    assert.ok(result.contours[0].vertices.length <= 4, 'circle remains arcs rather than tessellated line segments')
    const ring = result.contours[0]
    for (let i = 0; i < ring.vertices.length; i++) {
      const a = ring.vertices[i], b = ring.vertices[(i + 1) % ring.vertices.length], geometry = arcGeometry(a, b)
      close(geometry.center[0], 0); close(geometry.center[1], 0); close(geometry.radius, 12)
      close(Math.hypot(a.point[0], a.point[1]) - 10, 2)
      assert.ok(a.bulge > 0)
    }
    const repeat = await computePlanarContours(input, await backend())
    assert.deepEqual(repeat, result)
  }
  const inward = await computePlanarContours({ operation: 'offset', contours: [circle(10)], distance: -2 }, await backend())
  verifyResult(inward, 64 * Math.PI)
})

test('line Boolean operations and a circular lens agree with analytic areas', async () => {
  const contours = [square(0, 0, 10, 10), square(5, 0, 15, 10)]
  for (const [operation, area] of [['union', 150], ['intersection', 50], ['difference', 50]]) {
    const result = await computePlanarContours({ operation, contours }, await backend())
    verifyResult(result, area); assert.equal(result.contours.length, 1)
  }
  const lens = await computePlanarContours({ operation: 'intersection', contours: [circle(10), circle(10, 10)] }, await backend())
  verifyResult(lens, 200 * Math.acos(0.5) - 5 * Math.sqrt(300))
  assert.ok(lens.contours.flatMap(ring => ring.vertices).some(item => Math.abs(item.bulge ?? 0) > 0))
})

test('difference represents circular holes with clockwise signed area and empty geometry explicitly', async () => {
  const hole = await computePlanarContours({ operation: 'difference', contours: [circle(10), circle(4)] }, await backend())
  verifyResult(hole, 84 * Math.PI)
  assert.equal(hole.contours.length, 2)
  assert.deepEqual(hole.contours.map(ring => ring.hole).sort(), [false, true])
  const inner = hole.contours.find(ring => ring.hole)
  close(signedArea(inner), -16 * Math.PI)
  for (const input of [
    { operation: 'intersection', contours: [circle(1), circle(1, 10)] },
    { operation: 'offset', contours: [circle(10)], distance: -11 },
  ]) {
    const empty = await computePlanarContours(input, await backend())
    verifyResult(empty, 0); assert.deepEqual(empty.contours, [])
  }
})

test('offset expands the filled annulus while shrinking its clockwise hole', async () => {
  for (const [distance, expected] of [[2, 140 * Math.PI], [-2, 28 * Math.PI]]) {
    const result = await computePlanarContours({ operation: 'offset', contours: [circle(10), circle(4, 0, 0, true)], distance }, await backend())
    verifyResult(result, expected); assert.equal(result.contours.length, 2)
    assert.equal(result.contours.filter(ring => ring.hole).length, 1)
  }
})

test('major and shallow arcs remain native bulges under independent Boolean area checks', async () => {
  for (const [length, bulge, shift] of [[2, 2, 0], [100, 1e-5, 1e8], [1000, 1e-5, 1e6]]) {
    const cap = { closed: true, vertices: [vertex(shift, shift, bulge), vertex(shift + length, shift)] }
    const isolated = circle(1, shift - 10, shift + 10)
    const result = await computePlanarContours({ operation: 'union', contours: [cap, isolated], tolerance: 1e-7 }, await backend())
    verifyResult(result, signedArea(cap) + Math.PI)
    assert.equal(result.contours.length, 2)
    assert.ok(result.contours.flatMap(ring => ring.vertices).some(v => Math.abs(v.bulge ?? 0) > 0 && (bulge >= 1e-3 || Math.abs(v.bulge ?? 0) < 1e-3)), bulge < 1e-3 ? 'shallow arc must remain an arc' : 'major arc must retain its native arc pieces')
  }
  const unresolvable = { operation: 'union', contours: [
    { closed: true, vertices: [vertex(1e8, 1e8, 1e-8), vertex(1e8 + 1e6, 1e8)] },
    circle(1, 1e8 - 10, 1e8 + 10),
  ], tolerance: 1e-7 }
  const before = structuredClone(unresolvable)
  await assert.rejects(computePlanarContours(unresolvable, await backend()), /Derived arc radius cannot preserve the requested absolute tolerance/)
  assert.deepEqual(unresolvable, before)
})

test('far separated regions retain independent analytic Boolean and multi-island offset areas', async () => {
  for (const coordinate of [1e8, 9e8]) {
    const contours = [square(-coordinate, -coordinate, -coordinate + 10, -coordinate + 10), square(coordinate, coordinate, coordinate + 10, coordinate + 10)]
    for (const [operation, area, count] of [['union', 200, 2], ['difference', 100, 1], ['intersection', 0, 0]]) {
      const result = await computePlanarContours({ operation, contours, tolerance: 1e-7 }, await backend())
      verifyResult(result, area); assert.equal(result.contours.length, count)
    }
    for (const [distance, eachArea] of [[2, 180 + 4 * Math.PI], [-2, 36]]) {
      const result = await computePlanarContours({ operation: 'offset', contours, distance, tolerance: 1e-7 }, await backend())
      verifyResult(result, 2 * eachArea); assert.equal(result.contours.length, 2)
      for (const ring of result.contours) close(signedArea(ring), eachArea)
    }
  }
})

test('far small circles refuse unrepresentable tolerance atomically and receipts use actual output vertices', async () => {
  const { document, sources: [source] } = await fixture([circleSpec(0.1, 9e8)])
  const strict = request(document, 'offset', [source.id], { distance: 0.01, tolerance: 1e-9 }), before = state(document)
  const originalSource = structuredClone(document.getObject(source.id))
  await assert.rejects(previewPlanarContourEdit(document, strict, await backend()), /tolerance|precision|represent/i)
  unchanged(document, before)
  await assert.rejects(applyPlanarContourEdit(document, strict, await backend()), /tolerance|precision|represent/i)
  unchanged(document, before)
  const pureStrict = { operation: 'offset', contours: [circle(0.1, 9e8)], distance: 0.01, tolerance: 1e-9 }
  const pureBefore = structuredClone(pureStrict)
  await assert.rejects(computePlanarContours(pureStrict, await backend()), /tolerance|precision|represent/i)
  assert.deepEqual(pureStrict, pureBefore)
  const relaxed = request(document, 'offset', [source.id], { distance: 0.01, tolerance: 1e-7 })
  const preview = await previewPlanarContourEdit(document, relaxed, await backend())
  verifyResult(preview, Math.PI * 0.11 ** 2)
  assert.equal(preview.contours.length, 1)
  close(preview.area, signedArea(preview.contours[0]), 1e-12)
  for (let i = 0; i < preview.contours[0].vertices.length; i++) {
    const vertices = preview.contours[0].vertices, geometry = arcGeometry(vertices[i], vertices[(i + 1) % vertices.length])
    assert.ok(Math.abs(geometry.radius - 0.11) <= 1e-7)
    assert.ok(Math.hypot(geometry.center[0] - 9e8, geometry.center[1]) <= 1e-7)
  }
  const defaultTolerance = await previewPlanarContourEdit(document, request(document, 'offset', [source.id], { distance: 0.01 }), await backend())
  assert.deepEqual(defaultTolerance, preview)
  assert.ok(preview.receipt.sourceBoundaryError >= Math.abs((9e8 + 0.1) - 9e8 - 0.1))
  assert.ok(preview.receipt.backendTolerance < preview.receipt.tolerance)
  unchanged(document, before)
  const applied = await applyPlanarContourEdit(document, { ...relaxed, expectedGeometryDigest: preview.receipt.geometryDigest }, await backend())
  close(applied.area, signedArea(document.getObject(applied.resultIds[0]).payload), 1e-12)
  assert.deepEqual(document.getObject(source.id), originalSource)
  const yShift = await fixture([{ type: 'CIRCLE', payload: { center: [0, 9e8, 0], radius: 0.1, color: 2 } }])
  const yBefore = state(yShift.document)
  const yPreview = await previewPlanarContourEdit(yShift.document, request(yShift.document, 'offset', yShift.sources.map(entity => entity.id), { distance: 0.01, tolerance: 1e-9 }), await backend())
  verifyResult(yPreview, Math.PI * 0.11 ** 2); close(yPreview.area, signedArea(yPreview.contours[0]), 1e-12)
  unchanged(yShift.document, yBefore)
})

test('total source-circle conversion and world-output errors share one absolute tolerance budget', async () => {
  const radius = 1 - 5.95e-8, distance = 1.0000000597, tolerance = 1e-7
  for (const center of [[9e8, 0, 0], [9e8, 9e8, 0]]) {
    const { sdk, document, sources: [source] } = await fixture([{ type: 'CIRCLE', payload: { center, radius, color: 2 } }])
    const before = state(document), originalSource = structuredClone(document.getObject(source.id))
    const input = request(document, 'offset', [source.id], { distance, tolerance })
    let preview, refusal
    try { preview = await previewPlanarContourEdit(document, input, await backend()) } catch (error) { refusal = error }
    unchanged(document, before)
    if (refusal) {
      precisionRefusal(refusal)
      await assert.rejects(applyPlanarContourEdit(document, input, await backend()), error => { precisionRefusal(error); return true })
      unchanged(document, before); assert.deepEqual(document.getObject(source.id), originalSource)
    } else {
      assert.ok(circleBoundaryError(preview, center, radius + distance) <= tolerance, 'Cumulative source/output boundary error exceeds caller tolerance')
      assert.equal(preview.receipt.tolerance, tolerance)
      receiptBudget(preview.receipt)
      const repeated = await previewPlanarContourEdit(document, { ...input, tolerance: undefined }, await backend())
      assert.deepEqual(repeated, preview); unchanged(document, before)
      const applied = await applyPlanarContourEdit(document, { ...input, expectedGeometryDigest: preview.receipt.geometryDigest }, await backend())
      assert.deepEqual(applied.contours, preview.contours); assert.deepEqual(document.getObject(source.id), originalSource)
      await sdk.executeCommand('UNDO', {}, { document }); assert.deepEqual(document.getObject(source.id), originalSource)
      assert.ok(applied.resultIds.every(id => document.getObject(id) === null))
    }
  }
  const normal = await fixture([circleSpec(4, 8)]), ids = normal.sources.map(source => source.id), before = state(normal.document)
  const implicit = await previewPlanarContourEdit(normal.document, request(normal.document, 'offset', ids, { distance: 2 }), await backend())
  const explicit = await previewPlanarContourEdit(normal.document, request(normal.document, 'offset', ids, { distance: 2, tolerance }), await backend())
  assert.deepEqual(implicit, explicit); assert.ok(circleBoundaryError(explicit, [8, 0, 0], 6) <= tolerance); unchanged(normal.document, before)
  receiptBudget(explicit.receipt); assert.equal(explicit.receipt.sourceBoundaryError, 0); assert.equal(explicit.receipt.backendTolerance, tolerance)
  const minimum = await fixture([{ type: 'CIRCLE', payload: { center: [9e8, 9e8, 0], radius, color: 2 } }]), minimumBefore = state(minimum.document)
  const belowMinimum = request(minimum.document, 'offset', minimum.sources.map(source => source.id), { distance: 1, tolerance: 6e-8 })
  await assert.rejects(previewPlanarContourEdit(minimum.document, belowMinimum, await backend()), error => { precisionRefusal(error); return true })
  unchanged(minimum.document, minimumBefore)
  await assert.rejects(applyPlanarContourEdit(minimum.document, belowMinimum, await backend()), error => { precisionRefusal(error); return true })
  unchanged(minimum.document, minimumBefore)
  const mixed = await fixture([{ type: 'CIRCLE', payload: { center: [0.1, 0, 0], radius: 1e8, color: 2 } }]), mixedBefore = state(mixed.document)
  const mixedIds = mixed.sources.map(source => source.id)
  const mixedStrict = request(mixed.document, 'offset', mixedIds, { distance: 2, tolerance: 1e-9 })
  await assert.rejects(previewPlanarContourEdit(mixed.document, mixedStrict, await backend()), error => { precisionRefusal(error); return true })
  unchanged(mixed.document, mixedBefore)
  await assert.rejects(applyPlanarContourEdit(mixed.document, mixedStrict, await backend()), error => { precisionRefusal(error); return true })
  unchanged(mixed.document, mixedBefore)
  const mixedPreview = await previewPlanarContourEdit(mixed.document, request(mixed.document, 'offset', mixedIds, { distance: 2, tolerance: 1e-5 }), await backend())
  receiptBudget(mixedPreview.receipt); assert.ok(mixedPreview.receipt.sourceBoundaryError > 5.9e-9, 'TwoSum must retain mixed-scale source rounding residual')
  assert.ok(circleBoundaryError(mixedPreview, [0.1, 0, 0], 1e8 + 2) <= 1e-5); unchanged(mixed.document, mixedBefore)
})

test('rotated native circles preserve total Euclidean boundary tolerance through JSON and coordinate transforms or explicitly refuse', async () => {
  const center = [1e7, 1e7, 0], tolerance = 1e-9
  for (let i = 1; i <= 24; i++) for (const diagonal of [1, -1]) {
    const radius = 3 + i / 11, distance = 0.1 + i / 17, q = radius / Math.sqrt(2)
    const vertices = [vertex(center[0] + q, center[1] + diagonal * q, 1), vertex(center[0] - q, center[1] - diagonal * q, 1)]
    const inputRadius = Math.hypot(vertices[0].point[0] - vertices[1].point[0], vertices[0].point[1] - vertices[1].point[1]) / 2
    const input = { operation: 'offset', contours: [{ closed: true, vertices }], distance, tolerance }, original = structuredClone(input)
    let result, refusal
    try { result = await computePlanarContours(input, await backend()) } catch (error) { refusal = error }
    assert.deepEqual(input, original)
    if (refusal) { precisionRefusal(refusal); continue }
    const error = circleBoundaryError(result, center, inputRadius + distance)
    assert.ok(error <= tolerance, `Rotated circle ${i}/${diagonal} boundary error ${error} exceeds ${tolerance}`)
    assert.equal(result.receipt.tolerance, tolerance)
    receiptBudget(result.receipt)
    close(result.area, signedArea(result.contours[0]), 1e-12)
  }
})

test('near-tangent source-circle intersection refuses inexact source conversion atomically', async () => {
  const x = 9e8, y = 9e8, rightX = x + (2 - 2 ** -23), separation = rightX - x, tolerance = 1e-7
  for (const radius of [1 - 5e-8, 1 - 4e-8, 1 - 3e-8, 1 - 2e-8]) {
    const { document, sources } = await fixture([{ type: 'CIRCLE', payload: { center: [x, y, 0], radius, color: 2 } }, { type: 'CIRCLE', payload: { center: [rightX, y, 0], radius, color: 2 } }])
    const before = state(document), sourceRecords = sources.map(source => structuredClone(document.getObject(source.id)))
    const input = request(document, 'intersection', sources.map(source => source.id), { tolerance })
    let preview, refusal
    try { preview = await previewPlanarContourEdit(document, input, await backend()) } catch (error) { refusal = error }
    unchanged(document, before)
    if (!refusal) {
      const trueHalfHeight = Math.sqrt((radius - separation / 2) * (radius + separation / 2))
      const outputHalfHeight = Math.max(...preview.contours.flatMap(r => r.vertices.map(v => Math.abs(v.point[1] - y))))
      assert.fail(`Inexact source-circle Boolean must refuse; true finite lens half-height ${trueHalfHeight}, emitted ${outputHalfHeight}`)
    }
    precisionRefusal(refusal); assert.match(refusal.message, /Inexact CIRCLE conversion/)
    await assert.rejects(applyPlanarContourEdit(document, input, await backend()), /Inexact CIRCLE conversion/)
    unchanged(document, before); assert.deepEqual(sources.map(source => document.getObject(source.id)), sourceRecords)
  }
})

test('native source localization must be exact before near-tangent Boolean and separated multi-offset operations', async () => {
  const near = { operation: 'intersection', contours: [circle(1, 0.1), circle(1, 2.1 - 2 ** -26)], tolerance: 1e-7 }
  const xs = near.contours.flatMap(c => c.vertices.map(v => v.point[0])), origin = (Math.min(...xs) + Math.max(...xs)) / 2
  assert.ok(xs.some(x => { const sum = x - origin, split = sum - x; return (x - (sum - split)) + (-origin - split) !== 0 }), 'Fixture really requires an inexact source-frame subtraction')
  const x = 5e8, ulp = 2 ** -24
  const cumulative = { operation: 'offset', contours: [circle(1, x, x + ulp), circle(1, -x + ulp, -x)], distance: 1.00000002985, tolerance: 1e-7 }
  for (const input of [near, cumulative]) {
    const original = structuredClone(input)
    await assert.rejects(computePlanarContours(input, await backend()), error => { precisionRefusal(error); assert.match(error.message, /translation|localization/i); return true })
    assert.deepEqual(input, original)
  }
})

test('inexact source circles refuse erosion disappearance uncertainty and multi-source offsets without mutation', async () => {
  const radius = 1 - 2e-8
  for (const [specs, distance] of [[[circleSpec(radius, 9e8)], -1], [[circleSpec(radius, 9e8), circleSpec(radius, -9e8)], 1]]) {
    const { document, sources } = await fixture(specs), before = state(document)
    const originalSources = sources.map(source => structuredClone(document.getObject(source.id)))
    const input = request(document, 'offset', sources.map(source => source.id), { distance, tolerance: 1e-7 })
    const reason = distance < 0 ? /disappearance threshold/ : /Inexact CIRCLE conversion/
    await assert.rejects(previewPlanarContourEdit(document, input, await backend()), reason); unchanged(document, before)
    await assert.rejects(applyPlanarContourEdit(document, input, await backend()), reason); unchanged(document, before)
    assert.deepEqual(sources.map(source => document.getObject(source.id)), originalSources)
  }
})

test('invalid pure inputs reject instead of projecting, repairing, or returning fabricated geometry', async () => {
  const invalid = [
    { operation: 'offset', contours: [{ ...square(0, 0, 2, 2), closed: false }], distance: 1 },
    { operation: 'offset', contours: [{ closed: true, vertices: [vertex(0, 0), vertex(2, 2), vertex(0, 2), vertex(2, 0)] }], distance: 1 },
    { operation: 'offset', contours: [{ closed: true, vertices: [{ point: [0, 0, 1] }, vertex(2, 0), vertex(0, 2)] }], distance: 1 },
    { operation: 'offset', contours: [circle(10)], distance: NaN },
    { operation: 'offset', contours: [circle(10)], distance: 1, tolerance: 0 },
    { operation: 'union', contours: [circle(10)] },
    { operation: 'union', contours: [circle(10), circle(4), circle(2)] },
  ]
  for (const input of invalid) {
    const before = structuredClone(input)
    await assert.rejects(computePlanarContours(input, await backend()))
    assert.deepEqual(input, before)
  }
})

test('preview is read only; apply preserves sources and adds results in one reversible transaction', async () => {
  const { sdk, document, sources: [source], sentinel } = await fixture([circleSpec()])
  const before = state(document), originalSource = structuredClone(document.getObject(source.id)), originalSentinel = structuredClone(document.getObject(sentinel.id))
  const input = request(document, 'offset', [source.id], { distance: 2, tolerance: 1e-8 })
  const preview = await previewPlanarContourEdit(document, input, await backend())
  unchanged(document, before); verifyResult(preview, 144 * Math.PI)
  assert.deepEqual(preview.sourceIds, [source.id]); assert.match(preview.sourceDigest, /^[a-f0-9]{16}$/)
  assert.equal(preview.revisionBefore, before.revision); assert.equal(preview.units, 'millimeter')
  const applied = await applyPlanarContourEdit(document, { ...input, expectedGeometryDigest: preview.receipt.geometryDigest }, await backend())
  verifyResult(applied, 144 * Math.PI)
  assert.equal(document.revision, before.revision + 1)
  assert.equal(applied.revisionBefore, before.revision); assert.equal(applied.revisionAfter, document.revision)
  assert.deepEqual(applied.sourceIds, [source.id]); assert.equal(applied.resultIds.length, 1)
  assert.deepEqual(document.getObject(source.id), originalSource)
  assert.deepEqual(document.getObject(sentinel.id), originalSentinel)
  const resultRecords = applied.resultIds.map(id => structuredClone(document.getObject(id)))
  for (const entity of resultRecords) {
    assert.equal(entity.type, 'LWPOLYLINE'); assert.equal(entity.ownerId, originalSource.ownerId)
    assert.equal(entity.payload.layerId, originalSource.payload.layerId); assert.equal(entity.payload.color, 2)
    close(signedArea(entity.payload), 144 * Math.PI)
  }
  await sdk.executeCommand('UNDO', {}, { document })
  assert.deepEqual(document.getObject(source.id), originalSource)
  for (const id of applied.resultIds) assert.equal(document.getObject(id), null)
  assert.deepEqual(document.getObject(sentinel.id), originalSentinel)
  await sdk.executeCommand('REDO', {}, { document })
  assert.deepEqual(document.getObject(source.id), originalSource)
  assert.deepEqual(applied.resultIds.map(id => document.getObject(id)), resultRecords)
  assert.deepEqual(document.getObject(sentinel.id), originalSentinel)
})

test('empty intersections and collapsed offsets change no document bytes or history', async () => {
  for (const [specs, operation, extra] of [
    [[circleSpec(1), circleSpec(1, 10)], 'intersection', {}],
    [[circleSpec(10)], 'offset', { distance: -11 }],
  ]) {
    const { sdk, document, sources } = await fixture(specs), before = state(document)
    const input = request(document, operation, sources.map(source => source.id), extra)
    const result = await applyPlanarContourEdit(document, input, await backend())
    verifyResult(result, 0); assert.deepEqual(result.resultIds, []); unchanged(document, before)
    const command = operation === 'offset' ? 'CONTOUROFFSET' : 'CONTOURBOOLEAN'
    const commanded = await sdk.executeCommand(command, input, { document, expectedRevision: document.revision })
    verifyResult(commanded, 0); unchanged(document, before)
  }
})

test('document refusal and stale review are atomic, including nonplanar and unsupported native properties', async () => {
  const payloads = [
    { ...circleSpec().payload, center: [0, 0, 1] },
    { ...circleSpec().payload, normal: [0, 0, -1] },
    { ...circleSpec().payload, thickness: 1 },
    { ...square(0, 0, 10, 10), closed: false },
    { ...square(0, 0, 10, 10), elevation: 1 },
    { ...square(0, 0, 10, 10), constantWidth: 1 },
    { ...square(0, 0, 10, 10), vertices: [ { ...vertex(0, 0), startWidth: 1 }, vertex(10, 0), vertex(10, 10), vertex(0, 10) ] },
  ]
  for (const [index, payload] of payloads.entries()) {
    const { document, sources: [source] } = await fixture([{ type: index < 3 ? 'CIRCLE' : 'LWPOLYLINE', payload }])
    const before = state(document)
    await assert.rejects(applyPlanarContourEdit(document, request(document, 'offset', [source.id], { distance: 2 }), await backend()))
    unchanged(document, before)
  }
  const { sdk, document, sources: [source] } = await fixture([circleSpec()])
  for (const extra of [{ units: 'meter' }, { expectedRevision: document.revision - 1 }, { expectedGeometryDigest: '0'.repeat(64) }, { ids: ['missing'] }, { ids: [source.id, source.id] }]) {
    const before = state(document)
    await assert.rejects(applyPlanarContourEdit(document, request(document, 'offset', [source.id], { distance: 2, ...extra }), await backend()))
    unchanged(document, before)
  }
  const before = state(document), input = request(document, 'offset', [source.id], { distance: 2 })
  await assert.rejects(sdk.executeCommand('CONTOUROFFSET', input, { document, expectedRevision: document.revision - 1 }))
  unchanged(document, before)
  const unsafe = await fixture([polySpec({ closed: true, vertices: [vertex(1e8, 1e8, 1e-8), vertex(1e8 + 1e6, 1e8)] })])
  for (const tolerance of [1e-7, 1e-9]) {
    const original = state(unsafe.document), ids = unsafe.sources.map(source => source.id)
    await assert.rejects(applyPlanarContourEdit(unsafe.document, request(unsafe.document, 'offset', ids, { distance: 1, tolerance }), await backend()), /Derived arc radius cannot preserve the requested absolute tolerance/)
    unchanged(unsafe.document, original)
  }
})

test('both contour commands retain actor and envelope provenance in exactly one reversible revision', async () => {
  for (const [command, specs, operation, extra] of [
    ['CONTOUROFFSET', [circleSpec(10)], 'offset', { distance: 2 }],
    ['CONTOURBOOLEAN', [circleSpec(10), circleSpec(4)], 'difference', {}],
  ]) {
    const { sdk, document, sources } = await fixture(specs)
    const sourceRecords = sources.map(source => structuredClone(document.getObject(source.id))), beforeRevision = document.revision
    const author = { id: 'local-contour-operator', role: 'reviewer' }
    const commandEnvelope = { id: 'contour-review-envelope', schema: 'com.kanjie.kjdraw.command', schemaVersion: '1.0.0', origin: { kind: 'agent', agentId: 'contour-acceptance' } }
    const result = await sdk.executeCommand(command, request(document, operation, sources.map(source => source.id), extra), { document, expectedRevision: beforeRevision, author, commandEnvelope })
    assert.equal(document.revision, beforeRevision + 1)
    const revision = document.snapshot().revisions.at(-1)
    assert.deepEqual(revision.author, author); assert.equal(revision.source, `command:${command}`)
    assert.equal(revision.metadata.commandId, command)
    assert.equal(revision.metadata.commandEnvelopeId, commandEnvelope.id)
    assert.equal(revision.metadata.commandProtocol, `${commandEnvelope.schema}@${commandEnvelope.schemaVersion}`)
    assert.deepEqual(revision.metadata.commandOrigin, commandEnvelope.origin)
    assert.deepEqual(revision.metadata.sourceIds, sources.map(source => source.id))
    assert.deepEqual(revision.metadata.geometryReceipt, result.receipt)
    const resultRecords = result.resultIds.map(id => structuredClone(document.getObject(id)))
    assert.deepEqual(sources.map(source => document.getObject(source.id)), sourceRecords)
    await sdk.executeCommand('UNDO', {}, { document })
    assert.deepEqual(sources.map(source => document.getObject(source.id)), sourceRecords)
    assert.ok(result.resultIds.every(id => document.getObject(id) === null))
    await sdk.executeCommand('REDO', {}, { document })
    assert.deepEqual(result.resultIds.map(id => document.getObject(id)), resultRecords)
    assert.deepEqual(sources.map(source => document.getObject(source.id)), sourceRecords)
  }
  const { document, sources: [source] } = await fixture([circleSpec()])
  for (const options of [ { source: 'caller-overrides-command' }, { metadata: { geometryReceipt: 'caller-overrides-receipt' } }, { commandEnvelope: { id: 'envelope', source: 'invalid' } } ]) {
    const before = state(document)
    await assert.rejects(applyPlanarContourEdit(document, request(document, 'offset', [source.id], { distance: 2 }), { ...await backend(), ...options }))
    unchanged(document, before)
  }
})

const pythonOracle = `import io,json,os,math,ezdxf
doc=ezdxf.read(io.StringIO(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()))
audit=doc.audit();rings=[]
for entity in doc.modelspace().query('LWPOLYLINE'):
 points=list(entity.get_points('xyb'));area=0.;arcs=0
 for i,(x,y,b) in enumerate(points):
  nx,ny,_=points[(i+1)%len(points)];area+=(x*ny-nx*y)/2
  if b:
   t=4*math.atan(b);r=math.hypot(nx-x,ny-y)*(1+b*b)/(4*abs(b));area+=r*r*(t-math.sin(t))/2;arcs+=1
 rings.append({'closed':entity.closed,'area':area,'arcs':arcs,'vertices':len(points),'layer':entity.dxf.layer})
print(json.dumps({'version':ezdxf.__version__,'units':doc.units,'errors':len(audit.errors),'fixes':len(audit.fixes),'rings':rings}))`

test('hole results survive complete KJD reopen and native DXF reopen with an independent ezdxf audit and bulge integral', async t => {
  const { sdk, document, sources } = await fixture([circleSpec(10), circleSpec(4)])
  const applied = await applyPlanarContourEdit(document, request(document, 'difference', sources.map(source => source.id)), await backend())
  verifyResult(applied, 84 * Math.PI)
  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const kjdReopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  assert.deepEqual(JSON.parse(kjdReopened.serialize()), JSON.parse(document.serialize()))
  assert.deepEqual(applied.resultIds.map(id => kjdReopened.getObject(id)), applied.resultIds.map(id => document.getObject(id)))
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const dxfReopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const rings = dxfReopened.listEntities({ type: 'LWPOLYLINE' })
  assert.equal(rings.length, 2); close(rings.reduce((sum, entity) => sum + signedArea(entity.payload), 0), 84 * Math.PI)
  for (const entity of rings) assert.ok(entity.payload.vertices.some(item => Math.abs(item.bulge) > 0))
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-B', '-c', pythonOracle], dxf, { encoding: 'utf8', env: { ...process.env, PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail('Independent ezdxf validator is required but unavailable')
    return t.skip('Independent ezdxf validator unavailable; native reopen checks completed')
  }
  assert.equal(independent.status, 0, independent.stderr)
  const oracle = JSON.parse(independent.stdout)
  assert.equal(oracle.version, '1.4.4'); assert.equal(oracle.units, 4); assert.equal(oracle.errors, 0); assert.equal(oracle.fixes, 0)
  assert.equal(oracle.rings.length, 2); assert.ok(oracle.rings.every(ring => ring.closed && ring.arcs > 0))
  close(oracle.rings.reduce((sum, ring) => sum + ring.area, 0), 84 * Math.PI)
  assert.ok(oracle.rings.some(ring => ring.area < 0)); assert.ok(oracle.rings.some(ring => ring.area > 0))
})
