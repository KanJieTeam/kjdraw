import assert from 'node:assert/strict'
import test from 'node:test'

import { detectMechanicalBearingSeatEndView } from '../src/index.js'

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
