import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'

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
