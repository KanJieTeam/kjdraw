import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { closedHatchSplineConic } from '../src/geometry/hatch-boundary.js'

function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const args = (document, ids, extra = {}) => ({ expectedRevision: document.revision, units: 'millimeter', ids, ...extra })

test('agent move, rotate and scale preserve native hatch curves, islands and pattern state', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  await document.transact('native hatch', tx => tx.createEntity('HATCH', { solid: false, patternName: 'ANSI31', patternScale: 2, patternAngle: 0, boundaryLoops: [
    { external: true, edges: [{ type: 'ELLIPSE', center: [10, 5, 0], majorAxis: [6, 0, 0], ratio: 0.5, startAngle: 0, endAngle: Math.PI * 2, counterClockwise: true }] },
    { external: false, vertices: [[8, 4], [12, 4], [12, 6], [8, 6]] },
  ] }, { id: 'section' }))

  let proposal = value(await session.call('cad_propose_move', args(document, ['section'], { dx: 5, dy: -2 })))
  assert.deepEqual(proposal.preview.after[0].payload.boundaryLoops[0].edges[0].center, [15, 3, 0])
  value(await session.approve(proposal.planId, 'reviewer'))
  proposal = value(await session.call('cad_propose_rotate', args(document, ['section'], { center: { x: 0, y: 0 }, angleDegrees: 90 })))
  value(await session.approve(proposal.planId, 'reviewer'))
  proposal = value(await session.call('cad_propose_scale', args(document, ['section'], { center: { x: 0, y: 0 }, factor: 2 })))
  value(await session.approve(proposal.planId, 'reviewer'))

  const hatch = document.getObject('section'), ellipse = hatch.payload.boundaryLoops[0].edges[0]
  assert.ok(Math.abs(ellipse.center[0] + 6) < 1e-12)
  assert.ok(Math.abs(ellipse.center[1] - 30) < 1e-12)
  assert.ok(Math.abs(Math.hypot(ellipse.majorAxis[0], ellipse.majorAxis[1]) - 12) < 1e-12)
  assert.equal(hatch.payload.patternScale, 4)
  assert.equal(hatch.payload.boundaryLoops.length, 2)

  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    const restored = reopened.getObject('section') ?? reopened.listEntities({ type: 'HATCH' })[0]
    assert.equal(restored.payload.boundaryLoops[0].edges[0].type, 'ELLIPSE')
    assert.equal(restored.payload.boundaryLoops.length, 2)
  }
  await document.undo()
  assert.equal(document.getObject('section').payload.patternScale, 2)
  await document.redo()
  assert.equal(document.getObject('section').payload.patternScale, 4)
})

test('agent hatch transforms fail closed for unsupported or protected native data', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  await document.transact('unsafe hatches', tx => {
    tx.createEntity('HATCH', { boundaryLoops: [{ edges: [{ type: 'SPLINE', dxfEdgeType: 4, rawTags: [] }] }] }, { id: 'unsupported' })
    tx.createEntity('HATCH', { boundaryLoops: [{ vertices: [[0, 0], [4, 0], [0, 4]] }], locked: true }, { id: 'locked' })
  })
  const before = document.serialize()
  assert.equal((await session.call('cad_propose_move', args(document, ['unsupported'], { dx: 1, dy: 0 }))).ok, false)
  assert.equal((await session.call('cad_propose_scale', args(document, ['locked'], { center: { x: 0, y: 0 }, factor: 2 }))).ok, false)
  assert.equal(document.serialize(), before)
})

const splineKnots = [0, 0, 0, .25, .25, .5, .5, .75, .75, 1, 1, 1]
const splineWeights = [1, Math.SQRT1_2, 1, Math.SQRT1_2, 1, Math.SQRT1_2, 1, Math.SQRT1_2, 1]
const json = input => JSON.parse(JSON.stringify(input))
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)

function conicEdge({ center = [30, 20], u = [8, 3], v = [-1.5, 4] } = {}) {
  const [x, y] = center, [ux, uy] = u, [vx, vy] = v
  return { type: 'SPLINE', degree: 2, controlPoints: [
    [x + ux, y + uy, 0], [x + ux + vx, y + uy + vy, 0], [x + vx, y + vy, 0],
    [x - ux + vx, y - uy + vy, 0], [x - ux, y - uy, 0], [x - ux - vx, y - uy - vy, 0],
    [x - vx, y - vy, 0], [x + ux - vx, y + uy - vy, 0], [x + ux, y + uy, 0],
  ], knots: splineKnots, weights: splineWeights, fitPoints: [], periodic: false }
}

async function splineFixture(payload = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-spline-hatch', units: 'millimeter' })
  await document.transact('Verified SPLINE hatch', tx => tx.createEntity('HATCH', {
    solid: false, patternName: 'ANSI31', patternScale: 2, patternAngle: .25,
    boundaryLoops: [{ external: true, edges: [conicEdge()] }], ...payload,
  }, { id: 'spline-hatch' }))
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}

const splineCalls = {
  MOVE: document => ({ expectedRevision: document.revision, units: 'millimeter', ids: ['spline-hatch'], dx: 7, dy: -3 }),
  ROTATE: document => ({ expectedRevision: document.revision, units: 'millimeter', ids: ['spline-hatch'], center: { x: 10, y: 5 }, angleDegrees: 90 }),
  SCALE: document => ({ expectedRevision: document.revision, units: 'millimeter', ids: ['spline-hatch'], center: { x: 10, y: 5 }, factor: 2 }),
}

for (const command of ['MOVE', 'ROTATE', 'SCALE']) test(`AI ${command} previews and commits a verified native SPLINE HATCH`, async () => {
  const { sdk, document, session } = await splineFixture(), source = document.serialize(), before = json(document.getObject('spline-hatch'))
  const proposal = value(await session.call(`cad_propose_${command.toLowerCase()}`, splineCalls[command](document)))
  assert.equal(document.serialize(), source)
  const previewEdge = proposal.preview.after[0].payload.boundaryLoops[0].edges[0]
  assert.ok(closedHatchSplineConic(previewEdge))
  assert.deepEqual(previewEdge.knots, splineKnots)
  assert.deepEqual(previewEdge.weights, splineWeights)
  value(await session.approve(proposal.planId, 'trusted-host'))
  const accepted = json(document.getObject('spline-hatch')), acceptedEdge = accepted.payload.boundaryLoops[0].edges[0]
  assert.equal(accepted.id, before.id)
  assert.equal(accepted.handle, before.handle)
  assert.ok(closedHatchSplineConic(acceptedEdge))
  near(accepted.payload.patternScale, command === 'SCALE' ? 4 : 2)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    const edge = reopened.listEntities({ type: 'HATCH' })[0].payload.boundaryLoops[0].edges[0]
    assert.ok(closedHatchSplineConic(edge), `${format} boundary remains verified`)
    edge.weights.forEach((weight, index) => near(weight, splineWeights[index]))
    acceptedEdge.controlPoints.forEach((point, index) => point.forEach((coordinate, axis) => near(edge.controlPoints[index][axis], coordinate)))
  }
  await document.undo(); assert.deepEqual(json(document.getObject('spline-hatch')), before)
  await document.redo(); assert.deepEqual(json(document.getObject('spline-hatch')), accepted)
})

test('AI HATCH transforms reject raw, free-form, damaged and mixed SPLINE boundaries before proposal', async () => {
  const invalidEdges = [
    { type: 'SPLINE', rawTags: [{ code: 94, value: 2 }] },
    { ...conicEdge(), controlPoints: conicEdge().controlPoints.map((point, index) => index === 3 ? [point[0] + 1, point[1], 0] : point) },
    { ...conicEdge(), weights: splineWeights.map((weight, index) => index === 1 ? .8 : weight) },
    { ...conicEdge(), knots: [0, 0, 0, .2, .2, .5, .5, .75, .75, 1, 1, 1] },
  ]
  for (const boundaryLoops of [
    ...invalidEdges.map(edge => [{ external: true, edges: [edge] }]),
    [{ external: true, edges: [conicEdge(), conicEdge({ center: [60, 20] })] }],
  ]) {
    const { document, session } = await splineFixture({ boundaryLoops }), source = document.serialize(), history = json(document.history)
    for (const command of ['MOVE', 'ROTATE', 'SCALE']) {
      const result = await session.call(`cad_propose_${command.toLowerCase()}`, splineCalls[command](document))
      assert.equal(result.ok, false)
      assert.match(result.error.message, /HATCH|SPLINE/)
      assert.equal(document.serialize(), source)
      assert.deepEqual(json(document.history), history)
    }
  }
})
