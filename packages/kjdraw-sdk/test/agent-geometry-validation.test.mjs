import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Inspection geometry', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [-3, -4, -12] }, { id: 'line' })
    tx.createEntity('CIRCLE', { center: [3, 4, 0], radius: 2 }, { id: 'circle' })
    tx.createEntity('ELLIPSE', { center: [6, 8, 0], majorAxis: [6, 8, 0], ratio: 0.4, startParameter: 0, endParameter: Math.PI * 2 }, { id: 'ellipse' })
    tx.createEntity('SPLINE', { degree: 1, controlPoints: [[0, 0, 0], [3, 4, 0]], knots: [0, 0, 1, 1] }, { id: 'spline' })
    tx.createEntity('HATCH', { solid: false, patternName: 'ANSI31', boundaryLoops: [
      { external: true, vertices: [[0, 0], [10, 0], [10, 8], [0, 8]] },
      { external: false, vertices: [[2, 2], [4, 2], [4, 5], [2, 5]] },
    ] }, { id: 'hatch' })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[0, 2, 0], [0, 0, 0], [3, 4, 0]], textOverride: 'untrusted label' }, { id: 'dimension' })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [10, 0], [10, 10]], closed: true }, { id: 'closed' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [3, 4, 0] }, { id: 'paper', ownerId: document.snapshot().spaces.paperSpaceIds[0] })
  })
  return { document, sdk, session: new KJAgentToolSession(sdk, document) }
}
const input = (document, patch = {}) => ({ expectedRevision: document.revision, units: 'millimeter',
  lineLengths: [{ id: 'length', objectId: 'line', expected: 13, tolerance: 0 }],
  circleRadii: [{ id: 'radius', objectId: 'circle', expected: 2, tolerance: 0 }],
  dimensionMeasurements: [{ id: 'dimension', objectId: 'dimension', expected: 5, tolerance: 1e-12 }],
  pointDistances: [{ id: 'spacing', from: { objectId: 'line', feature: 'start' }, to: { objectId: 'circle', feature: 'center' }, expected: 5, tolerance: 0 }],
  polylineClosures: [{ id: 'closure', objectId: 'closed', expected: true }], ...patch })

test('geometry tool returns exact immutable evidence including native dimensions without modifying drawing history', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  assert.equal(session.definitions.find(tool => tool.name === 'cad_check_geometry').effect, 'read')
  const result = await session.call('cad_check_geometry', input(document))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.passed, true)
  assert.equal(result.value.revision, document.revision)
  const actual = result.value.checks.map(check => check.actual), errors = result.value.checks.map(check => check.error)
  assert.deepEqual([actual[0], actual[1], actual[3], actual[4]], [13, 2, 5, true])
  assert.ok(Math.abs(actual[2] - 5) < 1e-12)
  assert.deepEqual([errors[0], errors[1], errors[3], errors[4]], [0, 0, 0, 0])
  assert.ok(errors[2] < 1e-12)
  assert.equal(result.value.checks[0].references[0].ownerId, document.getObject('line').ownerId)
  assert.ok(Object.isFrozen(result.value.checks[0].references[0]))
  assert.equal(document.serialize(), before)
})

test('geometry tool validates native curves and polygonal hatch topology through explicit optional groups', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  const definition = session.definitions.find(tool => tool.name === 'cad_check_geometry')
  assert.ok(definition.inputSchema.properties.ellipseMajorRadii)
  assert.ok(definition.inputSchema.properties.ellipseMinorRadii)
  assert.ok(definition.inputSchema.properties.splineLengths)
  assert.ok(definition.inputSchema.properties.hatchAreas)
  assert.ok(definition.inputSchema.properties.hatchLoopCounts)
  assert.equal(definition.inputSchema.required.includes('ellipseMajorRadii'), false)
  assert.equal(definition.inputSchema.required.includes('splineLengths'), false)
  const result = await session.call('cad_check_geometry', {
    expectedRevision: document.revision,
    units: 'millimeter',
    lineLengths: [], circleRadii: [], pointDistances: [], polylineClosures: [],
    ellipseMajorRadii: [{ id: 'major', objectId: 'ellipse', expected: 10, tolerance: 0 }],
    ellipseMinorRadii: [{ id: 'minor', objectId: 'ellipse', expected: 4, tolerance: 0 }],
    splineLengths: [{ id: 'spline', objectId: 'spline', expected: 5, tolerance: 1e-12 }],
    hatchAreas: [{ id: 'hatch-area', objectId: 'hatch', expected: 74, tolerance: 0 }],
    hatchLoopCounts: [{ id: 'hatch-loops', objectId: 'hatch', expected: 2 }],
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.passed, true)
  assert.deepEqual(result.value.checks.map(item => item.kind), ['ellipse-major-radius', 'ellipse-minor-radius', 'spline-length', 'hatch-area', 'hatch-loop-count'])
  assert.deepEqual(result.value.checks.map(item => item.actual), [10, 4, 5, 74, 2])
  assert.equal(document.serialize(), before)
})

test('hatch geometry checks fail closed for curved, nonplanar and invalid island boundaries', async () => {
  const { document, session } = await fixture()
  for (const payload of [
    { boundaryLoops: [{ edges: [{ type: 'ARC', center: [0, 0, 0], radius: 5, startAngle: 0, endAngle: Math.PI * 2 }] }] },
    { boundaryLoops: [{ vertices: [[0, 0, 1], [4, 0, 1], [0, 4, 1]] }] },
    { boundaryLoops: [{ external: true, vertices: [[0, 0], [2, 0], [0, 2]] }, { external: false, vertices: [[0, 0], [4, 0], [0, 4]] }] },
  ]) {
    const id = `invalid-hatch-${document.revision}`
    await document.transact('invalid hatch area fixture', tx => tx.createEntity('HATCH', payload, { id }))
    const beforeCheck = document.serialize()
    const result = await session.call('cad_check_geometry', { expectedRevision: document.revision, units: 'millimeter', lineLengths: [], circleRadii: [], pointDistances: [], polylineClosures: [], hatchAreas: [{ id: 'area', objectId: id, expected: 1, tolerance: 0 }] })
    assert.equal(result.ok, false)
    assert.equal(document.serialize(), beforeCheck)
  }
})

test('a failed requirement is a successful read, not a tool exception or an applied edit', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  const args = input(document)
  args.lineLengths[0].expected = 20
  args.circleRadii[0].expected = 4
  args.circleRadii[0].tolerance = 2
  const result = await session.call('cad_check_geometry', args)
  assert.equal(result.ok, true)
  assert.equal(result.value.passed, false)
  assert.deepEqual(result.value.checks.map(check => check.passed), [false, true, true, true, true])
  assert.equal(result.value.checks[0].error, 7)
  assert.equal(result.value.checks[0].expected, 20)
  assert.equal(result.value.checks[1].tolerance, 2)
  assert.equal('planId' in result.value, false)
  assert.equal(document.serialize(), before)
})

test('explicit large tolerances are reported faithfully and do not become a global design certification', async () => {
  const { document, session } = await fixture()
  const args = input(document)
  args.lineLengths[0].expected = 1e12
  args.lineLengths[0].tolerance = 1e12
  const result = await session.call('cad_check_geometry', args)
  assert.equal(result.ok, true)
  const length = result.value.checks[0]
  assert.equal(length.actual, 13)
  assert.equal(length.expected, 1e12)
  assert.equal(length.error, 1e12 - 13)
  assert.equal(length.tolerance, 1e12)
  assert.equal(length.passed, true)
  assert.equal('certified' in result.value, false)
})

test('wrong refs, features, entity types, units, revisions and cross-group budgets are rejected before returning evidence', async () => {
  const { document, session } = await fixture(), before = document.serialize()
  const cases = []
  for (const patch of [{ objectId: 'missing' }, { objectId: 'circle' }, { tolerance: -1 }, { tolerance: Infinity }, { expected: '13' }, { unexpected: 1 }]) {
    const args = input(document); Object.assign(args.lineLengths[0], patch); cases.push(args)
  }
  const duplicate = input(document); duplicate.circleRadii[0].id = 'length'; cases.push(duplicate)
  const feature = input(document); feature.pointDistances[0].to.feature = 'end'; cases.push(feature)
  const owner = input(document); owner.pointDistances[0].to = { objectId: 'paper', feature: 'end' }; cases.push(owner)
  const bool = input(document); bool.polylineClosures[0].expected = 1; cases.push(bool)
  const missingGroup = input(document); delete missingGroup.circleRadii; cases.push(missingGroup)
  const missingTolerance = input(document); delete missingTolerance.lineLengths[0].tolerance; cases.push(missingTolerance)
  cases.push(input(document, { units: 'mm' }), input(document, { expectedRevision: document.revision - 1 }))
  cases.push(input(document, { lineLengths: [], circleRadii: [], dimensionMeasurements: [], pointDistances: [], polylineClosures: [] }))
  cases.push(input(document, { lineLengths: Array.from({ length: 64 }, (_, i) => ({ id: `line-${i}`, objectId: 'line', expected: 13, tolerance: 0 })), circleRadii: [{ id: 'extra', objectId: 'circle', expected: 2, tolerance: 0 }], dimensionMeasurements: [], pointDistances: [], polylineClosures: [] }))
  for (const args of cases) {
    const result = await session.call('cad_check_geometry', args)
    assert.equal(result.ok, false, JSON.stringify(args))
    assert.equal('value' in result, false)
  }
  assert.equal(document.serialize(), before)
})

test('object and array accessors are rejected without running supplied code', async () => {
  const { document, session } = await fixture()
  let invoked = 0
  const object = input(document)
  Object.defineProperty(object.lineLengths[0], 'expected', { enumerable: true, get() { invoked++; return 13 } })
  assert.equal((await session.call('cad_check_geometry', object)).ok, false)
  const array = input(document)
  Object.defineProperty(array.lineLengths, '0', { enumerable: true, get() { invoked++; return { id: 'length', objectId: 'line', expected: 13, tolerance: 0 } } })
  assert.equal((await session.call('cad_check_geometry', array)).ok, false)
  assert.equal(invoked, 0)
})
