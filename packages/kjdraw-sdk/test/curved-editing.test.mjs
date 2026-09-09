import assert from 'node:assert/strict'
import test from 'node:test'
// Exercise the TypeScript authority directly; runtime generation is verified separately.
import { trimEntityPayloads, extendEntityPayload, trimLinePayload, trimLinePayloads, extendLinePayload } from '../src/editing.js'
import { arcSweep } from '../src/geometry/index.js'
import { normalizeStandardEntityPayload } from '../src/standard-entities.js'

const radians = degrees => degrees * Math.PI / 180
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
const circle = (extra = {}) => ({ type: 'CIRCLE', payload: { center: [0, 0, 6], radius: 10, normal: [0, 0, 1], ...extra } })
const arc = (start, end, clockwise = false, extra = {}) => ({ type: 'ARC', payload: { ...circle(extra).payload, startAngle: radians(start), endAngle: radians(end), clockwise } })
const line = (start, end) => ({ type: 'LINE', payload: { start, end } })
const vertical = (x, z = 6, low = -20, high = 20) => line([x, low, z], [x, high, z])
const ray = degrees => ({ type: 'RAY', payload: { origin: [0, 0, 6], direction: [Math.cos(radians(degrees)), Math.sin(radians(degrees)), 0] } })
const onCircle = (degrees, radius = 10, center = [0, 0, 6]) => [center[0] + radius * Math.cos(radians(degrees)), center[1] + radius * Math.sin(radians(degrees)), center[2]]
const normalizeDegrees = value => ((value % 360) + 360) % 360
function expectArc(payload, start, end, sweep) {
  close(normalizeDegrees(payload.startAngle * 180 / Math.PI), normalizeDegrees(start))
  close(normalizeDegrees(payload.endAngle * 180 / Math.PI), normalizeDegrees(end))
  close(arcSweep(payload) * 180 / Math.PI, sweep)
  assert.deepEqual(payload.center, [0, 0, 6])
  assert.equal(payload.radius, 10)
  assert.deepEqual(normalizeStandardEntityPayload('ARC', payload).center, payload.center)
}

test('generic editing helpers preserve existing LINE results and the safe legacy APIs', () => {
  const target = line([0, 0, 6], [100, 0, 16]), cuts = [vertical(30, 0), vertical(70, 0)]
  const before = structuredClone([target, cuts])
  assert.deepEqual(trimEntityPayloads(target, cuts, [50, 0]), trimLinePayloads(target, cuts, [50, 0]).map(payload => ({ type: 'LINE', payload })))
  assert.throws(() => trimLinePayload(target, cuts, [50, 0]), /trimLinePayloads/)
  assert.deepEqual(extendEntityPayload(target, [vertical(120)], [100, 0]), extendLinePayload(target, [vertical(120)], [100, 0]))
  assert.deepEqual([target, cuts], before)
})

test('CIRCLE trim removes the picked half and returns its complementary native ARC', () => {
  const target = circle(), cuttingLine = vertical(0)
  const left = trimEntityPayloads(target, [cuttingLine], onCircle(0))
  assert.deepEqual(left.map(piece => piece.type), ['ARC'])
  expectArc(left[0].payload, 90, 270, 180)
  const right = trimEntityPayloads(target, [cuttingLine], onCircle(180))
  expectArc(right[0].payload, 270, 90, 180)
  assert.equal(target.type, 'CIRCLE')
  assert.equal(target.payload.startAngle, undefined)
})

test('CIRCLE trim preserves styles, center Z and custom metadata but discards stale source geometry tags', () => {
  const properties = { layerId: 'parts', color: 2, trueColor: 0x345678, linetypeId: 'dash', linetypeScale: 1.5, lineweight: 35,
    visible: true, transparency: .25, thickness: .2, elevation: 6, metadata: { part: 'A' } }
  const target = circle({ ...properties, fullCircle: true, rawTags: [{ code: 0, value: 'CIRCLE' }], rawData: 'old circle', originalType: 'CIRCLE' })
  const before = structuredClone(target)
  const [result] = trimEntityPayloads(target, [vertical(0)], onCircle(0))
  for (const [key, value] of Object.entries(properties)) assert.deepEqual(result.payload[key], value)
  for (const key of ['rawTags', 'rawData', 'originalType', 'fullCircle']) assert.equal(Object.hasOwn(result.payload, key), false)
  assert.deepEqual(result.payload.normal, [0, 0, 1])
  result.payload.center[2] = 999
  result.payload.metadata.part = 'changed'
  assert.deepEqual(target, before)
})

test('CIRCLE trim selects only the clicked cyclic interval and deduplicates cuts across zero degrees', () => {
  const cuts = [vertical(0), line([-20, 0, 6], [20, 0, 6]), ray(360), ray(90)]
  expectArc(trimEntityPayloads(circle(), cuts, onCircle(45))[0].payload, 90, 0, 270)
  expectArc(trimEntityPayloads(circle(), cuts, onCircle(315))[0].payload, 0, 270, 270)
  assert.throws(() => trimEntityPayloads(circle(), cuts, onCircle(0)), /exactly/)
})

test('ARC trim retains both surviving sides in source direction for counterclockwise and clockwise sweeps', () => {
  for (const clockwise of [false, true]) {
    const target = clockwise ? arc(180, 0, true, { color: 3 }) : arc(0, 180, false, { color: 3 })
    const before = structuredClone(target)
    const result = trimEntityPayloads(target, [vertical(-5), vertical(5)], onCircle(90))
    assert.deepEqual(result.map(piece => piece.type), ['ARC', 'ARC'])
    if (clockwise) { expectArc(result[0].payload, 180, 120, -60); expectArc(result[1].payload, 60, 0, -60) }
    else { expectArc(result[0].payload, 0, 60, 60); expectArc(result[1].payload, 120, 180, 60) }
    assert.ok(result.every(piece => piece.payload.clockwise === clockwise && piece.payload.color === 3))
    assert.deepEqual(target, before)
  }
})

test('ARC trim handles zero-degree wrap in both sweep directions without exchanging the remaining pieces', () => {
  const cuts = [ray(330), ray(30)]
  const ccw = trimEntityPayloads(arc(300, 60), cuts, onCircle(0))
  expectArc(ccw[0].payload, 300, 330, 30); expectArc(ccw[1].payload, 30, 60, 30)
  const cw = trimEntityPayloads(arc(60, 300, true), cuts, onCircle(0))
  expectArc(cw[0].payload, 60, 30, -30); expectArc(cw[1].payload, 330, 300, -30)
})

test('ARC end trims leave one piece and endpoint-only boundaries cannot erase the arc', () => {
  const target = arc(0, 180), cuts = [vertical(-5), vertical(5)]
  const start = trimEntityPayloads(target, cuts, onCircle(15))
  assert.equal(start.length, 1); expectArc(start[0].payload, 60, 180, 120)
  const end = trimEntityPayloads(target, cuts, onCircle(165))
  assert.equal(end.length, 1); expectArc(end[0].payload, 0, 120, 120)
  assert.throws(() => trimEntityPayloads(target, [ray(0), ray(180)], onCircle(90)), /No trim intersection/)
  assert.throws(() => trimEntityPayloads(target, cuts, onCircle(60)), /exactly/)
})

test('circular trim respects finite LINE, forward RAY and infinite XLINE domains', () => {
  const start = [-15, 0, 6], direction = [-1, 0, 0]
  assert.throws(() => trimEntityPayloads(circle(), [line(start, [-12, 0, 6])], onCircle(90)), /two distinct/)
  assert.throws(() => trimEntityPayloads(circle(), [{ type: 'RAY', payload: { origin: start, direction } }], onCircle(90)), /two distinct/)
  expectArc(trimEntityPayloads(circle(), [{ type: 'XLINE', payload: { origin: start, direction } }], onCircle(90))[0].payload, 180, 0, 180)
  expectArc(trimEntityPayloads(circle(), [{ type: 'RAY', payload: { origin: start, direction: [1, 0, 0] } }], onCircle(90))[0].payload, 180, 0, 180)
})

test('circular cutting does not depend on construction-line vector scale or far-away finite endpoints', () => {
  for (const magnitude of [1e-8, 1, 1e8]) {
    const boundary = { type: 'RAY', payload: { origin: [-15, 0, 6], direction: [magnitude, 0, 0] } }
    expectArc(trimEntityPayloads(circle(), [boundary], onCircle(90))[0].payload, 180, 0, 180)
  }
  expectArc(trimEntityPayloads(circle(), [line([-1e9, 0, 6], [1e9, 0, 6])], onCircle(90))[0].payload, 180, 0, 180)
  const tinyCircle = circle({ radius: 1e-6 })
  const [piece] = trimEntityPayloads(tinyCircle, [line([-1, 0, 6], [1, 0, 6])], [0, 1e-6, 6])
  close(arcSweep(piece.payload), Math.PI)
  assert.equal(piece.payload.radius, 1e-6)
})

test('circular targets intersect circular boundaries and filter the boundary ARC sweep', () => {
  const otherCircle = circle({ center: [10, 0, 6] })
  const result = trimEntityPayloads(arc(270, 90), [otherCircle], onCircle(0))
  expectArc(result[0].payload, 270, 300, 30); expectArc(result[1].payload, 60, 90, 30)
  const coveringArc = arc(120, 240, false, { center: [10, 0, 6] })
  expectArc(trimEntityPayloads(circle(), [coveringArc], onCircle(0))[0].payload, 60, 300, 240)
  const onePointArc = arc(120, 180, false, { center: [10, 0, 6] })
  assert.throws(() => trimEntityPayloads(circle(), [onePointArc], onCircle(0)), /two distinct/)
  const clockwiseCover = arc(240, 120, true, { center: [10, 0, 6] })
  expectArc(trimEntityPayloads(circle(), [clockwiseCover], onCircle(0))[0].payload, 60, 300, 240)
})

test('tangent boundaries produce one cut, not a duplicate or a fictitious zero-length ARC', () => {
  const tangent = circle({ center: [20, 0, 6] })
  assert.throws(() => trimEntityPayloads(circle(), [tangent, tangent], onCircle(90)), /two distinct/)
  const result = trimEntityPayloads(arc(270, 90), [tangent, tangent], onCircle(315))
  assert.equal(result.length, 1); expectArc(result[0].payload, 0, 90, 90)
  assert.throws(() => trimEntityPayloads(arc(270, 90), [tangent], onCircle(0)), /exactly/)
})

test('ARC extend finds the nearest boundary beyond either picked end and preserves all drawing data', () => {
  const target = arc(0, 90, false, { color: 2, lineweight: 35, metadata: { part: 'B' } })
  const cuts = [ray(150), ray(120), ray(240), ray(300)]
  const before = structuredClone([target, cuts])
  const end = extendEntityPayload(target, cuts, onCircle(80))
  expectArc(end, 0, 120, 120)
  const start = extendEntityPayload(target, cuts, onCircle(10))
  expectArc(start, 300, 90, 150)
  for (const payload of [start, end]) { assert.equal(payload.color, 2); assert.equal(payload.lineweight, 35); assert.deepEqual(payload.metadata, { part: 'B' }) }
  assert.deepEqual([target, cuts], before)
})

test('clockwise and zero-crossing ARC extension follows the original signed continuation', () => {
  const cw = arc(90, 0, true), cuts = [ray(120), ray(240), ray(300)]
  expectArc(extendEntityPayload(cw, cuts, onCircle(80)), 120, 0, -120)
  expectArc(extendEntityPayload(cw, cuts, onCircle(10)), 90, 300, -150)
  expectArc(extendEntityPayload(arc(300, 30), [ray(60)], onCircle(15)), 300, 60, 120)
  expectArc(extendEntityPayload(arc(30, 300, true), [ray(270)], onCircle(315)), 30, 270, -120)
})

test('ARC extension honors circular and finite curved boundary domains', () => {
  const target = arc(0, 30), other = circle({ center: [10, 0, 6] })
  expectArc(extendEntityPayload(target, [other], onCircle(25)), 0, 60, 60)
  expectArc(extendEntityPayload(target, [arc(100, 140, false, { center: [10, 0, 6] })], onCircle(25)), 0, 60, 60)
  // This boundary arc contains only the lower intersection, so the upper hit
  // must not be used as if the boundary were a complete circle.
  expectArc(extendEntityPayload(target, [arc(220, 260, false, { center: [10, 0, 6] })], onCircle(25)), 0, 300, 300)
  assert.throws(() => extendEntityPayload(target, [vertical(-20)], onCircle(25)), /No boundary/)
})

test('ARC extension cannot cross the opposite end, wrap a full turn or choose an ambiguous end', () => {
  const target = arc(0, 270)
  assert.throws(() => extendEntityPayload(target, [ray(0), ray(90), ray(180)], onCircle(260)), /No boundary/)
  expectArc(extendEntityPayload(target, [ray(315)], onCircle(260)), 0, 315, 315)
  assert.throws(() => extendEntityPayload(arc(0, 90), [ray(180)], onCircle(45)), /midpoint/)
  assert.throws(() => extendEntityPayload(arc(0, 90), [ray(20), ray(180)], onCircle(20)), /exactly/)
  assert.throws(() => extendEntityPayload(circle(), [ray(180)], onCircle(20)), /LINE or ARC/)
})

test('circular editing rejects coincident boundaries, center picks, out-of-sweep picks and invalid geometry without mutation', () => {
  const target = circle(), before = structuredClone(target)
  assert.throws(() => trimEntityPayloads(target, [circle(), vertical(0)], onCircle(30)), /Coincident/)
  assert.throws(() => trimEntityPayloads(target, [arc(0, 90), vertical(0)], onCircle(30)), /Coincident/)
  assert.throws(() => trimEntityPayloads(target, [vertical(0)], [0, 0]), /center/)
  assert.throws(() => trimEntityPayloads(arc(0, 90), [vertical(5)], onCircle(180)), /within.*sweep/)
  assert.throws(() => extendEntityPayload(arc(0, 90), [ray(180)], [0, 0]), /center/)
  for (const invalid of [arc(0, 0), arc(0, 360), arc(0, 720), arc(0, 90, false, { fullCircle: true }), circle({ radius: 0 }), circle({ center: [0, 0, NaN] })]) {
    assert.throws(() => trimEntityPayloads(invalid, [vertical(0)], onCircle(30)))
  }
  assert.deepEqual(target, before)
})

test('circular editing explicitly rejects tilted normals and non-coplanar cutting geometry', () => {
  for (const normal of [[1, 0, 1], [0, 0, -1], [0, 0, 0], [0, 0, NaN]]) {
    assert.throws(() => trimEntityPayloads(circle({ normal }), [vertical(0)], onCircle(30)))
  }
  const invalidBoundaries = [vertical(0, 7), line([0, -20, 6], [0, 20, 7]),
    circle({ center: [10, 0, 7] }), circle({ center: [10, 0, 6], normal: [0, 1, 1] }),
    { type: 'RAY', payload: { origin: [0, 0, 6], direction: [1, 0, 1] } }]
  for (const boundary of invalidBoundaries) {
    const before = structuredClone(boundary)
    assert.throws(() => trimEntityPayloads(circle(), [boundary, vertical(0)], onCircle(30)), /plane|normal/)
    assert.throws(() => extendEntityPayload(arc(0, 90), [boundary, ray(180)], onCircle(30)), /plane|normal/)
    assert.deepEqual(boundary, before)
  }
})

test('new LINE dispatch rejects ambiguous overlap instead of silently ignoring it alongside a valid cutter', () => {
  const target = line([0, 0, 6], [100, 0, 6]), overlapping = line([20, 0, 6], [80, 0, 6])
  assert.throws(() => trimEntityPayloads(target, [overlapping, vertical(50)], [10, 0]), /Overlapping/)
  assert.throws(() => extendEntityPayload(target, [overlapping, vertical(120)], [90, 0]), /Overlapping/)
})

test('a disjoint outward collinear RAY does not suppress another valid LINE trim boundary', () => {
  const target = line([0, 0, 6], [100, 0, 6])
  for (const [origin, direction] of [[[-20, 0, 6], [-1, 0, 0]], [[120, 0, 6], [1, 0, 0]]]) {
    const result = trimEntityPayloads(target, [{ type: 'RAY', payload: { origin, direction } }, vertical(50)], [10, 0])
    assert.equal(result.length, 1)
    assert.deepEqual(result[0].payload.start, [50, 0, 6])
    assert.deepEqual(result[0].payload.end, [100, 0, 6])
  }
})
