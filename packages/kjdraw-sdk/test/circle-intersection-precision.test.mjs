import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { intersectCircleCircle2 } from '../src/geometry/intersections.js'
import { registerGeometryBackend, unregisterGeometryBackend, getGeometryBackendStatus } from '../src/geometry/backend.js'
import { createWasmGeometryBackend } from '../src/geometry/wasm.js'
import { trimEntityPayloads, extendEntityPayload } from '../src/editing.js'

const TURN = Math.PI * 2
const positive = angle => ((angle % TURN) + TURN) % TURN
const close = (actual, expected, epsilon, context) => assert.ok(Math.abs(actual - expected) <= epsilon, `${context}: ${actual} != ${expected} (±${epsilon})`)
const transform = ([x, y], angle, origin) => [origin[0] + x * Math.cos(angle) - y * Math.sin(angle), origin[1] + x * Math.sin(angle) + y * Math.cos(angle)]

function expectPoints(actual, expected, epsilon, context) {
  assert.equal(actual.kind, 'point', context)
  assert.equal(actual.points.length, expected.length, context)
  const remaining = [...actual.points]
  for (const point of expected) {
    const index = remaining.findIndex(candidate => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) <= epsilon)
    assert.notEqual(index, -1, `${context}: expected ${JSON.stringify(point)}, received ${JSON.stringify(remaining)}`)
    remaining.splice(index, 1)
  }
}

function analyticIntersections() {
  // With d = R, the small-circle chord is exactly r²/(2R) from its center.
  // This expectation does not subtract R² from another large square.
  for (const [large, small] of [[1e6, .01], [1e4, .001], [1e8, .001], [13, 5]]) {
    const x = large - small * (small / large) / 2
    const h = small * Math.sqrt(1 - (small / (2 * large)) ** 2)
    for (const [angle, origin] of [[0, [0, 0]], [.37, [23567, -98123]], [Math.PI / 2, [-45000, 75000]], [2.8, [1000, -2500]]]) {
      const a = transform([0, 0], angle, origin), b = transform([large, 0], angle, origin)
      const expected = [transform([x, h], angle, origin), transform([x, -h], angle, origin)]
      const epsilon = Math.max(1e-12, 16 * Number.EPSILON * Math.max(large, ...origin.map(Math.abs)))
      for (const swapped of [false, true]) {
        const label = JSON.stringify({ large, small, angle, origin, swapped })
        const result = swapped ? intersectCircleCircle2(b, small, a, large) : intersectCircleCircle2(a, large, b, small)
        expectPoints(result, expected, epsilon, label)
        for (const point of result.points) close(Math.hypot(point[0] - b[0], point[1] - b[1]), small, epsilon, `small-circle residual ${label}`)
        if (angle === 0) for (const point of result.points) close(Math.abs(point[1]), h, Math.max(1e-14, small * 2e-14), `transverse precision ${label}`)
      }
    }
  }
  // Nearly concentric equal circles exercise a different cancellation: d is
  // tiny relative to both radii, so the sorted Heron factors must retain d.
  const radius = 1e6, distance = .00002
  expectPoints(intersectCircleCircle2([0, 0], radius, [distance, 0], radius), [[distance / 2, radius], [distance / 2, -radius]], 1e-9, 'nearly concentric equal radii')
}

function analyticClassifications() {
  for (const swapped of [false, true]) {
    const intersection = (a, ra, b, rb) => swapped ? intersectCircleCircle2(b, rb, a, ra) : intersectCircleCircle2(a, ra, b, rb)
    expectPoints(intersection([0, 0], 5, [6, 0], 5), [[3, 4], [3, -4]], 1e-12, '3-4-5 triangle')
    expectPoints(intersection([0, 0], 13, [18, 0], 5), [[13, 0]], 1e-12, 'external tangent')
    expectPoints(intersection([0, 0], 13, [8, 0], 5), [[13, 0]], 1e-12, 'internal tangent')
    expectPoints(intersection([0, 0], 5, [5, 0], 0), [[5, 0]], 1e-12, 'point circle')
    const distance = 10 - 2 ** -20, along = distance / 2, h = Math.sqrt((5 - along) * (5 + along))
    expectPoints(intersection([0, 0], 5, [distance, 0], 5), [[along, h], [along, -h]], 1e-12, 'near tangent retains two points')
    for (const [radius, point] of [[1, [7, 0]], [1, [3, 0]], [1, [0, 0]], [5, [10 + 2 ** -20, 0]]]) {
      const result = intersection([0, 0], 5, point, radius)
      assert.equal(result.kind, 'none', `disjoint or contained: ${JSON.stringify({ radius, point, swapped })}`)
      assert.deepEqual(result.points, [])
    }
    const coincident = intersection([3, -8], 5, [3, -8], 5)
    assert.equal(coincident.kind, 'overlap')
    assert.equal(coincident.infinite, true)
  }
}

function curvedEditing() {
  for (const [radius, small] of [[1e6, .01], [1e4, .001]]) {
    const payload = { center: [0, 0, 6], radius, layerId: 'parts', color: 2, lineweight: 35, metadata: { part: 'tiny-notch' } }
    const circle = { type: 'CIRCLE', payload }
    const boundary = { type: 'CIRCLE', payload: { center: [radius, 0, 6], radius: small } }
    const before = structuredClone([circle, boundary])
    const theta = 2 * Math.asin(small / (2 * radius))
    for (const cuttingBoundary of [boundary, { type: 'ARC', payload: { ...boundary.payload, startAngle: Math.PI / 4, endAngle: Math.PI * 7 / 4, clockwise: false } }]) {
      const [piece] = trimEntityPayloads(circle, [cuttingBoundary], [radius, 0, 6])
      assert.equal(piece.type, 'ARC')
      close(piece.payload.startAngle, theta, 1e-15, 'retained arc starts at upper cut')
      close(piece.payload.endAngle, TURN - theta, 1e-15, 'retained arc ends at lower cut')
      const removedLength = radius * (TURN - positive(piece.payload.endAngle - piece.payload.startAngle))
      close(removedLength, 2 * radius * theta, 2e-9, 'small notch arc length')
      for (const key of ['center', 'radius', 'layerId', 'color', 'lineweight', 'metadata']) assert.deepEqual(piece.payload[key], payload[key])
      for (const clockwise of [false, true]) {
        const arc = { type: 'ARC', payload: { ...payload, startAngle: clockwise ? .1 : -.1, endAngle: clockwise ? -.1 : .1, clockwise } }
        const pieces = trimEntityPayloads(arc, [cuttingBoundary], [radius, 0, 6])
        assert.equal(pieces.length, 2)
        close(pieces[0].payload.endAngle, positive(clockwise ? theta : -theta), 1e-15, 'first arc ends at correct cut')
        close(pieces[1].payload.startAngle, positive(clockwise ? -theta : theta), 1e-15, 'second arc starts at correct cut')
        const extendTarget = { type: 'ARC', payload: { ...payload, startAngle: clockwise ? Math.PI / 2 : -Math.PI / 2, endAngle: clockwise ? .1 : -.1, clockwise } }
        const extended = extendEntityPayload(extendTarget, [cuttingBoundary], [radius * Math.cos(.1), radius * Math.sin(clockwise ? .1 : -.1), 6])
        close(extended.endAngle, positive(clockwise ? theta : -theta), 1e-15, 'extend finds nearest valid tiny-circle boundary')
      }
    }
    assert.deepEqual([circle, boundary], before)
  }
}

async function withNative(run) {
  const bytes = await readFile(new URL('../../../web/public/kjcore/kjcore.wasm', import.meta.url))
  const { instance } = await WebAssembly.instantiate(bytes, {})
  registerGeometryBackend(createWasmGeometryBackend(instance))
  try {
    assert.equal(getGeometryBackendStatus().authoritative, true)
    run()
  } finally { unregisterGeometryBackend() }
}

test('reference circle-circle preserves analytic tiny chords under swapped, rotated and translated inputs', () => {
  unregisterGeometryBackend()
  analyticIntersections()
})
test('reference circle-circle classifies internal/external tangency, near tangency and containment', () => {
  unregisterGeometryBackend()
  analyticClassifications()
})
test('reference curved editing preserves tiny circular cuts and ARC extension endpoints', () => {
  unregisterGeometryBackend()
  curvedEditing()
})
test('actual WASM circle-circle preserves the same analytic intersections and classifications', async () => {
  await withNative(() => { analyticIntersections(); analyticClassifications() })
})
test('actual WASM curved editing preserves tiny circular cuts and ARC extension endpoints', async () => {
  await withNative(curvedEditing)
})
