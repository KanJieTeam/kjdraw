import assert from 'node:assert/strict'
import test from 'node:test'
import { trimEntityPayloads, extendEntityPayload } from '../src/editing.js'
import { arcSweep } from '../src/geometry/index.js'

const SEED = 0xcada2026
const TURN = 2 * Math.PI
const ANGLE_EPSILON = 5e-8
const turn = value => ((value % TURN) + TURN) % TURN
const angleDistance = (a, b) => Math.min(turn(a - b), turn(b - a))
const pointAt = (center, radius, angle) => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), center[2]]
function randomGenerator(seed) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
}
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= ANGLE_EPSILON, `${message}: ${actual} != ${expected}`)
const sameAngle = (actual, expected, message) => assert.ok(angleDistance(actual, expected) <= ANGLE_EPSILON, `${message}: ${actual} != ${expected}`)

function fixture(random, index, circle, extension = false) {
  const center = [(random() - .5) * 20000, (random() - .5) * 20000, (random() - .5) * 1000]
  const radius = 10 ** (-1 + random() * 4)
  const start = (random() - .5) * TURN
  const direction = circle || index % 2 === 0 ? 1 : -1
  const span = circle ? TURN : Math.PI * (.4 + random() * 1.2)
  const target = { type: circle ? 'CIRCLE' : 'ARC', payload: {
    center, radius, normal: [0, 0, 1], layerId: `case-${index}`, color: index % 255 + 1, lineweight: 35,
    linetypeScale: 1.5, metadata: { seed: SEED, index },
    ...(circle ? {} : { startAngle: start, endAngle: start + direction * span, clockwise: direction < 0 }),
  } }
  const boundaries = [], cuts = []
  const add = (boundary, angles) => {
    const boundaryIndex = boundaries.length
    boundaries.push(boundary)
    for (const angle of angles) cuts.push({ angle, offset: turn(direction * (angle - start)), boundaryIndex })
  }
  const available = extension ? TURN - span : span
  const base = extension ? span : 0
  const lineAngle = start + direction * (base + available * (.2 + random() * .1))
  add({ type: 'LINE', payload: { start: pointAt(center, radius * .2, lineAngle), end: pointAt(center, radius * 1.5, lineAngle) } }, [lineAngle])
  const rayAngle = start + direction * (base + available * (.65 + random() * .1))
  const rayScale = 10 ** (-6 + random() * 12)
  add({ type: 'RAY', payload: { origin: [...center], direction: [Math.cos(rayAngle) * rayScale, Math.sin(rayAngle) * rayScale, 0] } }, [rayAngle])

  const xlineNormal = start + random() * TURN
  add({ type: 'XLINE', payload: { origin: pointAt(center, radius * .25, xlineNormal),
    direction: [-Math.sin(xlineNormal), Math.cos(xlineNormal), 0] } }, [xlineNormal - Math.acos(.25), xlineNormal + Math.acos(.25)])

  // These two intersection angles come from the cosine rule, independently of
  // KJDraw's intersection implementation.
  const circleAxis = start + random() * TURN
  const circleHalf = Math.acos((1 + 1.2 ** 2 - .9 ** 2) / (2 * 1.2))
  add({ type: 'CIRCLE', payload: { center: pointAt(center, radius * 1.2, circleAxis), radius: radius * .9, normal: [0, 0, 1] } },
    [circleAxis - circleHalf, circleAxis + circleHalf])

  const arcAxis = start + random() * TURN
  const arcCenter = pointAt(center, radius * 1.1, arcAxis)
  const arcHit = arcAxis + Math.acos(1.1 / 2)
  const intersection = pointAt(center, radius, arcHit)
  const localAngle = Math.atan2(intersection[1] - arcCenter[1], intersection[0] - arcCenter[0])
  const boundaryClockwise = index % 3 === 0
  add({ type: 'ARC', payload: { center: arcCenter, radius, normal: [0, 0, 1],
    startAngle: localAngle + (boundaryClockwise ? .1 : -.1), endAngle: localAngle + (boundaryClockwise ? -.1 : .1), clockwise: boundaryClockwise } }, [arcHit])
  cuts.sort((a, b) => a.offset - b.offset)
  return { index, target, boundaries, cuts, center, radius, start, direction, span, circle }
}

function explainFailure(data, fn) {
  try { fn() } catch (error) {
    error.message = `seed=0x${SEED.toString(16)} case=${data.index}\nfixture=${JSON.stringify(data)}\n${error.message}`
    throw error
  }
}

function assertPointOnBoundary(point, boundary, tolerance) {
  const payload = boundary.payload
  if (boundary.type === 'CIRCLE' || boundary.type === 'ARC') {
    const distance = Math.hypot(point[0] - payload.center[0], point[1] - payload.center[1])
    assert.ok(Math.abs(distance - payload.radius) <= tolerance, 'extended endpoint lies on the actual cutting circle')
    if (boundary.type === 'ARC') {
      const angle = Math.atan2(point[1] - payload.center[1], point[0] - payload.center[0])
      const direction = payload.clockwise ? -1 : 1
      assert.ok(turn(direction * (angle - payload.startAngle)) <= Math.abs(arcSweep(payload)) + ANGLE_EPSILON, 'extended endpoint lies inside the cutting ARC domain')
    }
    return
  }
  const start = payload.start ?? payload.origin
  const vector = payload.direction ?? [payload.end[0] - start[0], payload.end[1] - start[1]]
  const length = Math.hypot(vector[0], vector[1]), unit = vector.map(value => value / length)
  const delta = [point[0] - start[0], point[1] - start[1]]
  assert.ok(Math.abs(delta[0] * unit[1] - delta[1] * unit[0]) <= tolerance, 'extended endpoint lies on the actual cutting line')
  const along = delta[0] * unit[0] + delta[1] * unit[1]
  if (boundary.type !== 'XLINE') assert.ok(along >= -tolerance, 'extended endpoint does not lie behind the cutting ray')
  if (boundary.type === 'LINE') assert.ok(along <= length + tolerance, 'extended endpoint remains on the finite cutting segment')
}

test('seed 0xcada2026: 160 translated, scaled and rotated CIRCLE/ARC trims conserve angle length and retain only the uncut subsets', () => {
  const random = randomGenerator(SEED)
  for (let index = 0; index < 160; index++) {
    const data = fixture(random, index, index % 4 < 2)
    explainFailure(data, () => {
      const { target, boundaries, cuts, center, radius, start, direction, span, circle } = data
      const candidates = circle ? cuts : cuts.filter(cut => cut.offset > ANGLE_EPSILON && cut.offset < span - ANGLE_EPSILON)
      const intervals = circle ? candidates.map((cut, cutIndex) => [cut.offset, candidates[(cutIndex + 1) % candidates.length].offset + (cutIndex + 1 === candidates.length ? TURN : 0)])
        : [0, ...candidates.map(cut => cut.offset), span].slice(0, -1).map((lower, cutIndex) => [lower, [...candidates.map(cut => cut.offset), span][cutIndex]])
      const [lower, upper] = intervals[Math.floor(random() * intervals.length)]
      const pick = pointAt(center, radius, start + direction * ((lower + upper) / 2))
      const before = structuredClone({ target, boundaries, pick })
      const pieces = trimEntityPayloads(target, boundaries, pick)
      assert.deepEqual({ target, boundaries, pick }, before, 'the geometry query must not mutate any input')
      const expectedCount = circle ? 1 : Number(lower > 0) + Number(upper < span)
      assert.equal(pieces.length, expectedCount)
      near(pieces.reduce((total, piece) => total + Math.abs(arcSweep(piece.payload)), 0), span - (upper - lower), 'angular length conservation')
      for (const piece of pieces) {
        assert.equal(piece.type, 'ARC')
        assert.deepEqual(piece.payload.center, center)
        assert.equal(piece.payload.radius, radius)
        assert.equal(piece.payload.layerId, target.payload.layerId)
        assert.deepEqual(piece.payload.metadata, target.payload.metadata)
        assert.equal(Math.sign(arcSweep(piece.payload)), direction)
        for (let sample = 0; sample < 17; sample++) {
          const angle = piece.payload.startAngle + arcSweep(piece.payload) * ((sample + .5) / 17)
          const offset = turn(direction * (angle - start))
          if (!circle) assert.ok(offset <= span + ANGLE_EPSILON, 'retained point lies within the original target arc')
          const withinRemoved = circle ? turn(offset - lower) < upper - lower - ANGLE_EPSILON
            : offset > lower + ANGLE_EPSILON && offset < upper - ANGLE_EPSILON
          assert.equal(withinRemoved, false, 'retained geometry must never bridge across the deleted interval')
        }
      }
      const expected = circle ? [[upper, lower + TURN]] : [...(lower > 0 ? [[0, lower]] : []), ...(upper < span ? [[upper, span]] : [])]
      pieces.forEach((piece, pieceIndex) => {
        sameAngle(piece.payload.startAngle, start + direction * expected[pieceIndex][0], 'retained start angle and ordering')
        sameAngle(piece.payload.endAngle, start + direction * expected[pieceIndex][1], 'retained end angle and ordering')
      })
    })
  }
})

test('seed 0xcada2026: 80 ARC extensions reach the nearest actual boundary while preserving the entire original arc and opposite endpoint', () => {
  const random = randomGenerator(SEED ^ 0x13579bdf)
  for (let index = 0; index < 80; index++) {
    const data = fixture(random, index, false, true)
    explainFailure(data, () => {
      const { target, boundaries, cuts, center, radius, start, direction, span } = data
      const extendStart = index % 4 < 2
      const candidates = cuts.filter(cut => cut.offset > span + ANGLE_EPSILON && cut.offset < TURN - ANGLE_EPSILON)
      const nearest = extendStart ? candidates.at(-1) : candidates[0]
      assert.ok(nearest)
      const first = extendStart ? nearest.offset - TURN : 0
      const last = extendStart ? span : nearest.offset
      const pick = pointAt(center, radius, start + direction * span * (extendStart ? .15 : .85))
      const before = structuredClone({ target, boundaries, pick })
      const result = extendEntityPayload(target, boundaries, pick)
      assert.deepEqual({ target, boundaries, pick }, before, 'extension is also a pure query')
      assert.deepEqual(result.center, center)
      assert.equal(result.radius, radius)
      assert.equal(result.layerId, target.payload.layerId)
      assert.deepEqual(result.metadata, target.payload.metadata)
      near(arcSweep(result), direction * (last - first), 'extension reaches the closest boundary in the selected direction')
      assert.ok(Math.abs(arcSweep(result)) < TURN, 'extension may not wrap a complete circle')
      sameAngle(result.startAngle, start + direction * first, 'extended start angle')
      sameAngle(result.endAngle, start + direction * last, 'extended end angle')
      const selectedAngle = extendStart ? result.startAngle : result.endAngle
      const selectedPoint = pointAt(center, radius, selectedAngle)
      const expectedPoint = pointAt(center, radius, nearest.angle)
      const modelTolerance = Math.max(1e-7, radius * ANGLE_EPSILON)
      assert.ok(Math.hypot(selectedPoint[0] - expectedPoint[0], selectedPoint[1] - expectedPoint[1]) <= modelTolerance)
      assertPointOnBoundary(selectedPoint, boundaries[nearest.boundaryIndex], modelTolerance)
      sameAngle(extendStart ? result.endAngle : result.startAngle, extendStart ? target.payload.endAngle : target.payload.startAngle, 'the unselected endpoint stays fixed')
      for (let sample = 0; sample < 17; sample++) {
        const originalAngle = start + direction * span * ((sample + .5) / 17)
        assert.ok(turn(direction * (originalAngle - result.startAngle)) <= Math.abs(arcSweep(result)) + ANGLE_EPSILON, 'extension contains every original arc sample')
      }
    })
  }
})
