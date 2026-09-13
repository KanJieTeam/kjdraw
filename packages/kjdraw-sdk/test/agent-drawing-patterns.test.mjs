import test from 'node:test'
import assert from 'node:assert/strict'
import { expandPolarDrawingPattern as expandPolar, expandRectangularDrawingPattern as expand } from '../src/agent-drawing-patterns.js'
import { createKJDrawSDK } from '../src/sdk.js'

const pattern = { rows: 1, columns: 1, dx: 0, dy: 0 }
const circle = () => ({ type: 'CIRCLE', payload: { center: [2, 3, 0], radius: 1 } })
const ellipse = () => ({ type: 'ELLIPSE', payload: { center: [7, 8, 0], majorAxis: [4, 3, 0], ratio: .4, startParameter: Math.PI / 6, endParameter: Math.PI * 1.5 } })
const mixed = () => [
  { type: 'LINE', payload: { start: [0, 0, 0], end: [4, 2, 0] } }, circle(),
  { type: 'ARC', payload: { center: [5, 6, 0], radius: 2, startAngle: Math.PI / 2, endAngle: Math.PI, clockwise: false } },
  { type: 'LWPOLYLINE', payload: { vertices: [[1, 1, 0], [3, 1, 0], [3, 2, 0]], closed: true } },
]
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)

test('rectangular patterns preserve exact native geometry and deterministic row-column-source order', () => {
  const source = mixed(), output = expand(source, { rows: 2, columns: 3, dx: 10, dy: 20 })
  assert.equal(output.length, 24)
  for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) {
    const offset = (row * 3 + column) * 4
    assert.deepEqual(output.slice(offset, offset + 4).map(item => item.type), source.map(item => item.type))
    assert.deepEqual(output[offset].payload.start, [column * 10, row * 20, 0])
    assert.deepEqual(output[offset + 1].payload.center, [2 + column * 10, 3 + row * 20, 0])
    assert.equal(output[offset + 2].payload.startAngle, Math.PI / 2)
    assert.equal(output[offset + 2].payload.endAngle, Math.PI)
    assert.deepEqual(output[offset + 3].payload.vertices[2], [3 + column * 10, 2 + row * 20, 0])
  }
})

test('single and negative spacings are supported while zero spacing in a repeated direction is rejected', () => {
  assert.deepEqual(expand(mixed(), pattern), mixed())
  assert.deepEqual(expand([circle()], { rows: 2, columns: 2, dx: -4, dy: -5 }).map(item => item.payload.center), [[2, 3, 0], [-2, 3, 0], [2, -2, 0], [-2, -2, 0]])
  assert.throws(() => expand([circle()], { ...pattern, columns: 3 }), /nonzero spacing/)
  assert.throws(() => expand([circle()], { ...pattern, rows: 3 }), /nonzero spacing/)
})

test('native elliptical arcs translate centers while preserving axes, ratios and parameters', () => {
  const output = expand([ellipse()], { rows: 2, columns: 2, dx: 10, dy: -20 })
  assert.deepEqual(output.map(item => item.payload.center), [[7, 8, 0], [17, 8, 0], [7, -12, 0], [17, -12, 0]])
  for (const item of output) {
    assert.deepEqual(item.payload.majorAxis, [4, 3, 0])
    assert.equal(item.payload.ratio, .4)
    assert.equal(item.payload.startParameter, Math.PI / 6)
    assert.equal(item.payload.endParameter, Math.PI * 1.5)
  }
  output[0].payload.majorAxis[0] = 99
  assert.equal(output[1].payload.majorAxis[0], 4)
})

test('frozen input stays unchanged and all output payloads and points are independently owned', () => {
  const source = freeze(mixed()), output = expand(source, freeze({ ...pattern, columns: 2, dx: 1 }))
  output[0].payload.start[0] = 90
  output[3].payload.vertices[0][0] = 80
  assert.equal(source[0].payload.start[0], 0)
  assert.equal(source[3].payload.vertices[0][0], 1)
  assert.equal(output[4].payload.start[0], 1)
  assert.equal(output[7].payload.vertices[0][0], 2)
})

test('entity cardinality is checked before inspecting input geometry or allocating expanded output', () => {
  const unreadable = { get type() { assert.fail('Oversized source must not be inspected') } }
  for (const invalid of [{ rows: 0 }, { rows: 1.5 }, { columns: Number.MAX_SAFE_INTEGER }, { rows: 100001 }, { dx: Infinity }, { dy: NaN }]) assert.throws(() => expand([circle()], { ...pattern, ...invalid }))
  assert.throws(() => expand([unreadable], { ...pattern, rows: 100001, dy: 1 }), /entity budget/)
  assert.throws(() => expand([unreadable, unreadable], { ...pattern, columns: 2, dx: 1 }, { maxEntities: 3 }), /entity budget/)
  assert.throws(() => expand([], pattern))
  for (const maxEntities of [0, 4097, 1.1]) assert.throws(() => expand([circle()], pattern, { maxEntities }))
  assert.equal(expand([circle()], { ...pattern, columns: 64, dx: 1 }).length, 64)
  assert.throws(() => expand([circle()], { ...pattern, columns: 65, dx: 1 }), /entity budget/)
  assert.equal(expand([circle()], { ...pattern, columns: 4096, dx: 1 }, { maxEntities: 4096 }).length, 4096)
})

test('point-work limits are independent from entity limits and admit their exact boundary', () => {
  assert.equal(expand(mixed(), { ...pattern, columns: 2, dx: 1 }, { maxEntities: 8, maxPoints: 14 }).length, 8)
  assert.throws(() => expand(mixed(), { ...pattern, columns: 2, dx: 1 }, { maxEntities: 8, maxPoints: 13 }), /point-work/)
  assert.throws(() => expand([circle()], pattern, { maxPoints: 1000001 }))
})

test('nonfinite, non-XY and translated out-of-range coordinates are rejected before expansion', () => {
  for (const center of [[Infinity, 0, 0], [0, NaN, 0], [0, 0, 1], [0, 0], [1e12 + 1, 0, 0]]) assert.throws(() => expand([{ ...circle(), payload: { center, radius: 1 } }], pattern))
  const edge = { ...circle(), payload: { center: [1e12, -1e12, 0], radius: 1 } }
  assert.equal(expand([edge], pattern).length, 1)
  assert.throws(() => expand([edge], { ...pattern, columns: 2, dx: 1 }), /coordinate range/)
  assert.throws(() => expand([edge], { ...pattern, rows: 2, dy: -1 }), /coordinate range/)
  assert.throws(() => expand([{ type: 'LINE', payload: { start: [0, 0, 0], end: [1e-9, 0, 0] } }], { ...pattern, columns: 2, dx: 1e12 }), /precision/)
  const a = 0.000055, b = 0.00007, dx = 2 ** 38
  assert.notEqual(a, b)
  assert.notEqual(a + 2 * dx, b + 2 * dx)
  assert.equal(a + dx, b + dx, 'Only the intermediate cell collapses')
  for (const entity of [
    { type: 'LINE', payload: { start: [a, 0, 0], end: [b, 0, 0] } },
    { type: 'LWPOLYLINE', payload: { vertices: [[a, 0, 0], [b, 0, 0], [1, 1, 0]], closed: true } },
  ]) assert.throws(() => expand([entity], { ...pattern, columns: 3, dx }), /precision/)
})

test('unsupported payloads and degenerate geometry cannot pass the native definition boundary', () => {
  const bad = [
    { type: 'TEXT', payload: {} }, { ...circle(), options: { id: 'duplicate-id' } },
    { type: 'LINE', payload: { start: [0, 0, 0], end: [0, 0, 0] } },
    { ...circle(), payload: { center: [0, 0, 0], radius: 0 } },
    { ...mixed()[2], payload: { ...mixed()[2].payload, endAngle: Math.PI / 2 } },
    { ...mixed()[2], payload: { ...mixed()[2].payload, clockwise: 'false' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[0, 0, 0], [1, 0, 0]], closed: true } },
    { type: 'LWPOLYLINE', payload: { vertices: [[0, 0, 0], [0, 0, 0]], closed: false } },
    { ...mixed()[3], payload: { ...mixed()[3].payload, width: 3 } },
    { ...ellipse(), payload: { ...ellipse().payload, majorAxis: [0, 0, 0] } },
    { ...ellipse(), payload: { ...ellipse().payload, ratio: 0 } },
    { ...ellipse(), payload: { ...ellipse().payload, startParameter: 1, endParameter: 1 } },
  ]
  for (const entity of bad) assert.throws(() => expand([entity], pattern))
})

test('expanded definitions create editable native entities through existing CREATEBATCH and survive KJD reopening', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const entities = expand(mixed(), { rows: 2, columns: 2, dx: 10, dy: -20 })
  await sdk.executeCommand('CREATEBATCH', { entities })
  assert.equal(document.listEntities().length, 16)
  assert.deepEqual(document.listEntities().filter(item => item.type === 'CIRCLE').map(item => item.payload.center), [[2, 3, 0], [12, 3, 0], [2, -17, 0], [12, -17, 0]])
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.equal(reopened.listEntities().length, document.listEntities().length)
  for (const entity of document.listEntities()) assert.deepEqual(reopened.getObject(entity.id).payload, entity.payload)
})

test('polar patterns rotate native geometry in deterministic copy-source order without duplicating a full-circle endpoint', () => {
  const source = [
    { type: 'LINE', payload: { start: [5, 0, 0], end: [10, 0, 0] } },
    { type: 'CIRCLE', payload: { center: [10, 0, 0], radius: 1 } },
    { type: 'ARC', payload: { center: [8, 0, 0], radius: 2, startAngle: 0, endAngle: Math.PI / 2, clockwise: false } },
    ellipse(),
  ]
  const output = expandPolar(source, { center: [0, 0, 0], count: 4, angleDegrees: 360 })
  assert.equal(output.length, 16)
  assert.deepEqual(output.slice(0, 4), source)
  for (let copy = 0; copy < 4; copy++) assert.deepEqual(output.slice(copy * 4, copy * 4 + 4).map(item => item.type), source.map(item => item.type))
  const centers = [0, 1, 2, 3].map(copy => output[copy * 4 + 1].payload.center)
  ;[[10, 0], [0, 10], [-10, 0], [0, -10]].forEach(([x, y], index) => { near(centers[index][0], x); near(centers[index][1], y) })
  near(output[6].payload.startAngle, Math.PI / 2)
  near(output[6].payload.endAngle, Math.PI)
  near(output[7].payload.majorAxis[0], -3)
  near(output[7].payload.majorAxis[1], 4)
  assert.notDeepEqual(output.at(-4).payload.start, source[0].payload.start)
})

test('partial signed polar patterns include both endpoints and reject unsafe definitions before expansion', () => {
  const output = expandPolar([circle()], { center: [2, 3, 0], count: 3, angleDegrees: -180 })
  assert.equal(output.length, 3)
  assert.deepEqual(output.map(item => item.payload.center), [[2, 3, 0], [2, 3, 0], [2, 3, 0]])
  const offset = { type: 'CIRCLE', payload: { center: [12, 3, 0], radius: 1 } }
  const rotated = expandPolar([offset], { center: [2, 3, 0], count: 3, angleDegrees: -180 })
  ;[[12, 3], [2, -7], [-8, 3]].forEach(([x, y], index) => { near(rotated[index].payload.center[0], x); near(rotated[index].payload.center[1], y) })
  for (const pattern of [
    { center: [0, 0, 0], count: 1, angleDegrees: 360 },
    { center: [0, 0, 0], count: 2, angleDegrees: 0 },
    { center: [0, 0, 0], count: 2, angleDegrees: 361 },
    { center: [0, 0, 1], count: 2, angleDegrees: 90 },
    { center: [0, 0, 0], count: 2.5, angleDegrees: 90 },
  ]) assert.throws(() => expandPolar([circle()], pattern))
  const unreadable = { get type() { assert.fail('Oversized polar source must not be inspected') } }
  assert.throws(() => expandPolar([unreadable], { center: [0, 0, 0], count: 65, angleDegrees: 360 }), /entity budget/)
  assert.throws(() => expandPolar([circle()], { center: [0, 0, 0], count: 3, angleDegrees: 180 }, { maxEntities: 3, maxPoints: 2 }), /point-work/)
})
