import test from 'node:test'
import assert from 'node:assert/strict'
import { computeRoadDesign } from '../src/road-design.js'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
function fixture() {
  return { units: 'meter', startStation: 0, alignment: [[0, 0], [100, 0]],
    profile: [{ station: 0, elevation: 2 }, { station: 100, elevation: 2 }],
    sections: [{ station: 0, ground: [[-30, 0], [30, 0]] }, { station: 100, ground: [[-30, 0], [30, 0]] }],
    pavement: { leftWidth: 5, rightWidth: 5, leftCrossfall: 0, rightCrossfall: 0 }, slopes: { cutHtoV: 1, fillHtoV: 2 } }
}

test('hand-calculated fill section has 28 square metres and 2800 cubic metres over 100 m', () => {
  const input = fixture(), before = structuredClone(input), result = computeRoadDesign(input)
  assert.deepEqual(input, before)
  assert.equal(result.length, 100)
  assert.equal(result.volumeMethod, 'average-end-area')
  assert.equal(result.areaUnits, 'square-meter')
  assert.equal(result.volumeUnits, 'cubic-meter')
  for (const section of result.sections) {
    assert.deepEqual(section.design, [[-9, 0], [-5, 2], [0, 2], [5, 2], [9, 0]])
    assert.deepEqual(section.areas, { cut: 0, fill: 28 }) // 10*2 + 2*(4*2/2)
    assert.equal(section.daylight.left.mode, 'fill')
    assert.equal(section.daylight.right.mode, 'fill')
  }
  assert.deepEqual(result.totalVolume, { cut: 0, fill: 2800 })
  assert.ok(Object.isFrozen(result.sections[0].design[0]))
  input.sections[0].ground[0][1] = 99
  assert.deepEqual(result.sections[0].ground[0], [-30, 0])
})

test('hand-calculated cut section has 39 square metres and keeps excavation separate from fill', () => {
  const input = fixture()
  input.profile.forEach(point => { point.elevation = 0 })
  input.sections.forEach(section => { section.ground = [[-30, 3], [30, 3]] })
  const result = computeRoadDesign(input)
  assert.deepEqual(result.sections[0].design, [[-8, 3], [-5, 0], [0, 0], [5, 0], [8, 3]])
  assert.deepEqual(result.sections[0].areas, { cut: 39, fill: 0 }) // 10*3 + 2*(3*3/2)
  assert.equal(result.sections[0].daylight.left.mode, 'cut')
  assert.deepEqual(result.totalVolume, { cut: 3900, fill: 0 })
})

test('outward signed crossfalls and asymmetric pavement widths use the supplied parameters', () => {
  const input = fixture()
  input.pavement.leftCrossfall = -.1
  input.pavement.rightCrossfall = -.1
  const crown = computeRoadDesign(input).sections[0]
  assert.deepEqual(crown.pavement, [[-5, 1.5], [0, 2], [5, 1.5]])
  assert.deepEqual(crown.daylight.left.point, [8, 0])
  close(crown.areas.fill, 22) // 2*(5*(2+1.5)/2) + 2*(3*1.5/2)
  input.pavement = { leftWidth: 4, rightWidth: 2, leftCrossfall: .25, rightCrossfall: -.5 }
  const asymmetric = computeRoadDesign(input).sections[0]
  assert.deepEqual(asymmetric.pavement, [[-2, 1], [0, 2], [4, 3]])
  assert.deepEqual(asymmetric.daylight.right.point, [-4, 0])
  assert.deepEqual(asymmetric.daylight.left.point, [10, 0])
  close(asymmetric.areas.fill, 23) // 2*(1+2)/2 + 4*(2+3)/2 + 2*1/2 + 6*3/2
})

test('a hillside section independently integrates equal 4 square metre cut and fill lobes', () => {
  const input = fixture()
  input.profile.forEach(point => { point.elevation = 0 })
  input.pavement.leftWidth = input.pavement.rightWidth = 2
  input.slopes = { cutHtoV: .5, fillHtoV: .5 }
  input.sections.forEach(section => { section.ground = [[-10, -10], [10, 10]] })
  const result = computeRoadDesign(input)
  assert.deepEqual(result.sections[0].design, [[-4, -4], [-2, 0], [0, 0], [2, 0], [4, 4]])
  assert.deepEqual(result.sections[0].areas, { cut: 4, fill: 4 })
  assert.deepEqual(result.totalVolume, { cut: 400, fill: 400 })
})

test('terrain breakpoints and sign changes split cut/fill instead of cancelling signed areas', () => {
  const input = fixture()
  input.profile.forEach(point => { point.elevation = 1 })
  input.pavement.leftWidth = input.pavement.rightWidth = 2
  input.slopes.fillHtoV = 1
  input.sections.forEach(section => { section.ground = [[-10, 0], [-2, 0], [-1, 2], [0, 0], [1, 2], [2, 0], [10, 0]] })
  const section = computeRoadDesign(input).sections[0]
  close(section.areas.cut, 1)
  close(section.areas.fill, 2)
  for (const zero of [-1.5, -.5, .5, 1.5]) assert.ok(section.strips.some(strip => strip.toOffset === zero))
  assert.ok(section.strips.every(strip => strip.cutArea === 0 || strip.fillArea === 0))
})

test('alignment chainage, knot tangents, profile grades and world section offsets are explicit', () => {
  const input = fixture()
  input.startStation = 100
  input.alignment = [[10, 20], [13, 24], [13, 36]]
  input.profile = [{ station: 100, elevation: 0 }, { station: 105, elevation: 1 }, { station: 117, elevation: 2.2 }]
  input.sections = [100, 105, 111, 117].map(station => ({ station, ground: [[-30, -5], [30, -5]] }))
  input.pavement.leftWidth = input.pavement.rightWidth = 2
  const result = computeRoadDesign(input)
  assert.equal(result.length, 17)
  assert.equal(result.endStation, 117)
  assert.deepEqual(result.alignment.map(segment => segment.length), [5, 12])
  assert.deepEqual(result.sections.map(section => section.center), [[10, 20], [13, 24], [13, 30], [13, 36]])
  assert.deepEqual(result.sections.map(section => section.tangent), [[.6, .8], [0, 1], [0, 1], [0, 1]])
  close(result.sections[0].longitudinalGrade, .2)
  close(result.sections[1].longitudinalGrade, .1)
  close(result.sections[2].designElevation, 1.6)
  assert.ok(result.sections[1].worldDesign.some(point => point[0] === 11 && point[1] === 24 && point[2] === 1))
})

test('average end-area volumes use actual section areas and only the supplied station interval', () => {
  const input = fixture()
  input.profile[1].elevation = 3
  let result = computeRoadDesign(input)
  close(result.sections[0].areas.fill, 28)
  close(result.sections[1].areas.fill, 48)
  close(result.totalVolume.fill, 3800) // (28+48)/2 * 100
  input.profile[1].elevation = 2
  input.sections[0].station = 25; input.sections[1].station = 75
  result = computeRoadDesign(input)
  assert.deepEqual(result.volumeRange, [25, 75])
  assert.equal(result.totalVolume.fill, 1400)
  assert.match(result.limitations.join(' '), /supplied section intervals only/)
})

test('decimal elevations and sloping terrain retain computed daylight boundaries without spurious sign slivers', () => {
  const input = fixture()
  input.profile.forEach(point => { point.elevation = 1.23 })
  input.pavement = { leftWidth: 3.4, rightWidth: 2.7, leftCrossfall: -.025, rightCrossfall: -.035 }
  input.slopes.fillHtoV = 1.5
  input.sections.forEach(section => { section.ground = [[-30, -.37], [30, -.37]] })
  close(computeRoadDesign(input).sections[0].areas.fill, 12.9092414375)
  input.pavement = { leftWidth: 2, rightWidth: 2, leftCrossfall: 0, rightCrossfall: 0 }
  input.sections.forEach(section => { section.ground = [[-30, -5.47], [30, 4.73]] }) // z=0.17*offset-0.37
  const section = computeRoadDesign(input).sections[0]
  const leftRun = 1.26 / (2 / 3 + .17), rightRun = 1.94 / (2 / 3 - .17)
  close(section.daylight.left.point[0], 2 + leftRun)
  close(section.daylight.right.point[0], -2 - rightRun)
  close(section.areas.fill, 6.4 + .5 * (1.26 * leftRun + 1.94 * rightRun))
  close(section.areas.cut, 0)
})

test('parameter edits recompute the complete result without cached geometry or quantities', () => {
  const input = fixture(), original = computeRoadDesign(input)
  input.pavement.leftWidth = 6
  assert.equal(computeRoadDesign(input).sections[0].areas.fill, 30)
  input.pavement.leftWidth = 5; input.slopes.fillHtoV = 1
  assert.equal(computeRoadDesign(input).sections[0].areas.fill, 24)
  input.slopes.fillHtoV = 2; input.profile.forEach(point => { point.elevation = 3 })
  assert.equal(computeRoadDesign(input).sections[0].areas.fill, 48)
  input.profile.forEach(point => { point.elevation = 2 })
  input.sections.forEach(section => { section.ground = [[-30, 1], [30, 1]] })
  assert.equal(computeRoadDesign(input).sections[0].areas.fill, 12)
  assert.equal(original.sections[0].areas.fill, 28)
})

test('unsupported, ambiguous and incomplete terrain fails without extrapolation or fabricated daylight', () => {
  const invalid = [
    input => { input.sections[0].ground = [[-6, 0], [6, 0]] },
    input => { input.sections[0].ground = [[-4, 0], [30, 0]] },
    input => { input.sections[0].ground = [[-30, 0], [0, 0], [0, 1], [30, 0]] },
    input => { input.sections[0].ground = [[30, 0], [-30, 0]] },
    input => { input.slopes.fillHtoV = 1; input.sections[0].ground = [[-20, 0], [5, 0], [6, 2], [8, -2], [10, 0], [20, 0]] },
    input => { input.slopes.fillHtoV = 1; input.sections[0].ground = [[-20, 0], [5, 0], [6, 1], [7, 0], [20, 0]] },
  ]
  for (const modify of invalid) { const input = fixture(); modify(input); assert.throws(() => computeRoadDesign(input), /Road design:/) }
  const matched = fixture(); matched.sections.forEach(section => { section.ground = [[-30, 2], [30, 2]] })
  const result = computeRoadDesign(matched)
  assert.deepEqual(result.totalVolume, { cut: 0, fill: 0 })
  assert.equal(result.sections[0].daylight.left.mode, 'none')
})

test('strict data validation rejects duplicate/reversed stations, nonfinite numbers, accessors and oversized input', () => {
  const invalid = [
    input => { input.units = 'millimeter' },
    input => { input.alignment = [[0, 0], [0, 0]] },
    input => { input.profile[1].station = 0 },
    input => { input.profile.reverse() },
    input => { input.profile[0].station = 1 },
    input => { input.sections[1].station = 0 },
    input => { input.sections.reverse() },
    input => { input.sections[1].station = 101 },
    input => { input.pavement.leftWidth = 0 },
    input => { input.slopes.fillHtoV = 0 },
    input => { input.slopes.cutHtoV = -1 },
    input => { input.sections = new Array(2) },
    input => { input.sections = Array.from({ length: 2049 }, () => input.sections[0]) },
    input => { input.alignment[0].push(0) },
    input => { input.terrain = 'invented' },
    ...[NaN, Infinity, -Infinity].flatMap(value => [input => { input.profile[0].elevation = value }, input => { input.sections[0].ground[0][1] = value }, input => { input.pavement.leftCrossfall = value }, input => { input.slopes.fillHtoV = value }]),
  ]
  for (const modify of invalid) { const input = fixture(); modify(input); assert.throws(() => computeRoadDesign(input), /Road design:/) }
  let invoked = 0
  const getter = fixture(); Object.defineProperty(getter.sections[0].ground[0], '1', { enumerable: true, get() { invoked++; return 0 } })
  assert.throws(() => computeRoadDesign(getter), /dense data entries/)
  assert.equal(invoked, 0)
})
