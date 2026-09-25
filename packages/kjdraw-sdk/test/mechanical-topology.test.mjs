import assert from 'node:assert/strict'
import test from 'node:test'

import { detectMechanicalBearingSeatEndView, detectMechanicalFourHoleBoltCircle } from '../src/index.js'

const center = (x = 0, y = 0) => {
  const angle = Math.acos(18 / 38)
  return [
    { type: 'ARC', payload: { center: [x, y, 0], radius: 38, startAngle: angle, endAngle: Math.PI - angle } },
    { type: 'ARC', payload: { center: [x, y, 0], radius: 38, startAngle: Math.PI + angle, endAngle: 2 * Math.PI - angle } },
    { type: 'CIRCLE', payload: { center: [x, y, 0], radius: 12 } },
    { type: 'CIRCLE', payload: { center: [x, y, 0], radius: 18 } },
    { type: 'CIRCLE', payload: { center: [x, y - 28, 0], radius: 5.5 } },
    { type: 'CIRCLE', payload: { center: [x, y + 28, 0], radius: 5.5 } },
  ]
}

test('detects dimensionally coherent end-view facts without interpreting annotations', () => {
  const entities = [...center(230, 126), { type: 'CIRCLE', payload: { center: [270, 20, 0], radius: 3 } }]
  assert.deepEqual(detectMechanicalBearingSeatEndView(entities), {
    status: 'match', candidates: [{ center: [230, 126], crownRadius: 38, housingDiameter: 36,
      boreDiameter: 24, mountingHoleDiameter: 11, mountingHoleSpacing: 56 }],
  })
})

test('abstains on the old loose signature when crown endpoints or hole symmetry are wrong', () => {
  const wrongArc = center()
  wrongArc[0].payload.startAngle += 0.1
  assert.equal(detectMechanicalBearingSeatEndView(wrongArc).status, 'none')
  const wrongHoles = center()
  wrongHoles[5].payload.center[1] += 2
  assert.equal(detectMechanicalBearingSeatEndView(wrongHoles).status, 'none')
  assert.equal(detectMechanicalBearingSeatEndView(center().slice(0, 5)).status, 'none')
})

test('reports multiple valid end views as ambiguous instead of choosing one', () => {
  const result = detectMechanicalBearingSeatEndView([...center(0, 0), ...center(120, 0)])
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.candidates.length, 2)
})

test('ignores malformed primitives and guards unbounded input', () => {
  assert.equal(detectMechanicalBearingSeatEndView([{ type: 'CIRCLE', payload: { center: [Infinity, 0], radius: 1 } }]).status, 'none')
  assert.equal(detectMechanicalBearingSeatEndView([{ type: 'CIRCLE' }, { type: 'ARC', payload: null }, null]).status, 'none')
  assert.equal(detectMechanicalBearingSeatEndView(new Array(100_001).fill({ type: 'LINE', payload: {} })).status, 'none')
  const tooManyArcs = new Array(500).fill({ type: 'ARC', payload: { center: [0, 0], radius: 1, startAngle: 0, endAngle: 1 } })
  const tooManyCircles = new Array(20).fill({ type: 'CIRCLE', payload: { center: [0, 0], radius: 0.5 } })
  assert.equal(detectMechanicalBearingSeatEndView([...tooManyArcs, ...tooManyCircles]).status, 'none')
})

const boltCircle = (cx, cy, pitchRadius = 45, holeRadius = 5, rotation = 0) =>
  Array.from({ length: 4 }, (_, index) => {
    const angle = rotation + index * Math.PI / 2
    return { type: 'CIRCLE', payload: { center: [cx + pitchRadius * Math.cos(angle), cy + pitchRadius * Math.sin(angle), 0], radius: holeRadius } }
  })

test('extracts a rotated four-hole PCD feature from noisy native circles without treating it as a full drawing', () => {
  const entities = [
    { type: 'CIRCLE', payload: { center: [230, 126, 0], radius: 15 } },
    ...boltCircle(230, 126, 45, 5, Math.PI / 6),
    { type: 'CIRCLE', payload: { center: [230, 126, 0], radius: 60 } },
    { type: 'CIRCLE', payload: { center: [310, 40, 0], radius: 3 } },
  ]
  const result = detectMechanicalFourHoleBoltCircle(entities)
  assert.equal(result.status, 'match')
  assert.equal(result.candidates.length, 1)
  const feature = result.candidates[0]
  assert.deepEqual(feature.center, [230, 126])
  assert.equal(feature.pitchDiameter, 90)
  assert.equal(feature.holeDiameter, 10)
  assert.equal(feature.holeCenters.length, 4)
  assert.deepEqual(feature.holeCenters.map(([x, y]) => Math.round(Math.hypot(x - 230, y - 126))), [45, 45, 45, 45])
  assert.deepEqual(detectMechanicalFourHoleBoltCircle(entities.slice().reverse()), result)
})

test('four-hole PCD feature abstains on rectangular, missing, unequal and overlapping holes', () => {
  const rectangular = boltCircle(0, 0).map((item, index) => ({
    ...item, payload: { ...item.payload, center: [item.payload.center[0], item.payload.center[1] * (index % 2 ? 1.2 : 0.8), 0] },
  }))
  assert.equal(detectMechanicalFourHoleBoltCircle(rectangular).status, 'none')
  assert.equal(detectMechanicalFourHoleBoltCircle(boltCircle(0, 0).slice(0, 3)).status, 'none')
  const unequal = boltCircle(0, 0)
  unequal[3].payload.radius = 6
  assert.equal(detectMechanicalFourHoleBoltCircle(unequal).status, 'none')
  assert.equal(detectMechanicalFourHoleBoltCircle(boltCircle(0, 0, 5, 5)).status, 'none')
})

test('separate four-hole features are reported as ambiguous and dense inputs abstain', () => {
  const two = detectMechanicalFourHoleBoltCircle([...boltCircle(0, 0), ...boltCircle(200, 0)])
  assert.equal(two.status, 'ambiguous')
  assert.equal(two.candidates.length, 2)
  const samePitchDifferentRotation = detectMechanicalFourHoleBoltCircle([
    ...boltCircle(0, 0, 45, 5, 0), ...boltCircle(0, 0, 45, 5, Math.PI / 4),
  ])
  assert.equal(samePitchDifferentRotation.status, 'ambiguous')
  assert.equal(samePitchDifferentRotation.candidates.length, 2)
  assert.equal(detectMechanicalFourHoleBoltCircle(new Array(127).fill({ type: 'CIRCLE', payload: { center: [0, 0], radius: 1 } })).status, 'none')
})
