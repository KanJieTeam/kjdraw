import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK, detectMechanicalBearingSeatEndView, detectMechanicalFourHoleBoltCircle } from '../src/index.js'

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
  assert.ok(Math.abs(feature.startAngleRadians - Math.PI / 6) < 1e-12)
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
const circleFacts = circles => circles.map(item => {
  const center = item.payload.center
  return [center[0], center[1], item.payload.radius].map(value => Math.round(value * 1e8) / 1e8)
}).sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2])

function expandedComponentCircles(document) {
  const insert = document.listEntities({ ownerId: document.snapshot().spaces.modelSpaceId, type: 'INSERT' })
  assert.equal(insert.length, 1)
  const instance = insert[0], members = document.listEntities({ ownerId: instance.payload.blockRecordId, type: 'CIRCLE' })
  assert.equal(members.length, 6)
  const [x, y] = instance.payload.position, rotation = instance.payload.rotation ?? 0
  const [sx, sy] = instance.payload.scale ?? [1, 1]
  assert.equal(sx, 1)
  assert.equal(sy, 1)
  return members.map(item => {
    const [localX, localY] = item.payload.center
    return { payload: { center: [x + localX * Math.cos(rotation) - localY * Math.sin(rotation),
      y + localX * Math.sin(rotation) + localY * Math.cos(rotation)], radius: item.payload.radius } }
  })
}

test('detected rotated four-hole facts drive native parametric generation with exact KJD/DXF reopen', async () => {
  const source = [
    { type: 'CIRCLE', payload: { center: [230, 126, 0], radius: 60 } },
    { type: 'CIRCLE', payload: { center: [230, 126, 0], radius: 20 } },
    ...boltCircle(230, 126, 45, 5, Math.PI / 6),
  ]
  const detection = detectMechanicalFourHoleBoltCircle(source)
  assert.equal(detection.status, 'match')
  const feature = detection.candidates[0]
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const component = await sdk.executeCommand('COMPONENTINSERT', {
    componentId: 'org.kjdraw.mechanical.four-hole-flange', version: '1.0.0', units: 'millimeter',
    position: feature.center, rotation: feature.startAngleRadians, scale: 1,
    parameters: {
      outerDiameter: source[0].payload.radius * 2, boreDiameter: source[1].payload.radius * 2,
      boltCircleDiameter: feature.pitchDiameter, holeDiameter: feature.holeDiameter, holeCount: 4,
    },
  }, { document, expectedRevision: 0 })
  assert.equal(document.revision, 1)
  assert.equal(component.definitionEntityCount, 6)
  const expected = circleFacts(source)
  assert.deepEqual(circleFacts(expandedComponentCircles(document)), expected)
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await createKJDrawSDK().readDocument(bytes, { format })
    assert.equal(reopened.validate().valid, true)
    assert.deepEqual(circleFacts(expandedComponentCircles(reopened)), expected)
  }
})
