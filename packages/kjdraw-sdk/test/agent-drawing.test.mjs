import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { mountingProfile } from '../examples/fixtures/mounting-profile.mjs'

function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }

test('mixed drawing proposal creates an editable profile, four holes and a slot as one transaction', async () => {
  const { sdk, document, session } = fixture()
  const source = document.serialize()
  const proposal = value(await session.call('cad_propose_drawing', mountingProfile()))
  assert.equal(document.serialize(), source)
  assert.equal(proposal.preview.after.length, 9)
  value(await session.approve(proposal.planId, 'reviewer'))
  assert.equal(document.revision, 1)
  for (const expected of proposal.preview.after) assert.deepEqual(document.getObject(expected.id).payload, expected.payload)
  const contour = document.listEntities().find(entity => entity.type === 'LWPOLYLINE')
  assert.equal(contour.payload.closed, true)
  assert.equal(contour.payload.vertices.length, 4)
  const arcs = document.listEntities().filter(entity => entity.type === 'ARC')
  assert.equal(arcs[0].payload.startAngle, 1.5 * Math.PI)
  assert.equal(arcs[0].payload.endAngle, 0.5 * Math.PI)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    assert.deepEqual(reopened.listEntities().map(entity => entity.type).sort(), document.listEntities().map(entity => entity.type).sort())
    const circle = reopened.listEntities().find(entity => entity.type === 'CIRCLE' && entity.payload.center[0] === 10 && entity.payload.center[1] === 10)
    assert.equal(circle.payload.radius, 3)
    assert.deepEqual(circle.payload.center, [10, 10, 0])
    const arc = reopened.listEntities().find(entity => entity.type === 'ARC' && entity.payload.center[0] === 70)
    assert.ok(Math.abs(arc.payload.startAngle - 1.5 * Math.PI) < 1e-10)
    assert.ok(Math.abs(arc.payload.endAngle - 0.5 * Math.PI) < 1e-10)
    assert.equal(reopened.listEntities().find(entity => entity.type === 'LWPOLYLINE').payload.closed, true)
  }
  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length, 0)
  await sdk.executeCommand('REDO')
  assert.equal(document.listEntities().length, 9)
})

test('the whole profile can be moved with an exact geometry preview and one undo', async () => {
  const { sdk, document, session } = fixture()
  const proposal = value(await session.call('cad_propose_drawing', mountingProfile()))
  value(await session.approve(proposal.planId, 'reviewer'))
  const ids = document.listEntities().map(entity => entity.id)
  const before = document.serialize()
  const moved = value(await session.call('cad_propose_move', { expectedRevision: 1, units: 'millimeter', ids, dx: 20, dy: -10 }))
  assert.equal(document.serialize(), before)
  assert.equal(moved.preview.before.length, 9)
  assert.equal(moved.preview.after.length, 9)
  value(await session.approve(moved.planId, 'reviewer'))
  assert.equal(document.revision, 2)
  assert.deepEqual(document.listEntities().find(entity => entity.type === 'CIRCLE').payload.center, [30, 0, 0])
  assert.deepEqual(document.listEntities().find(entity => entity.type === 'LWPOLYLINE').payload.vertices[0].point, [20, -10, 0])
  await sdk.executeCommand('UNDO')
  for (const expected of moved.preview.before) assert.deepEqual(document.getObject(expected.id).payload, expected.payload)
})

test('mixed drawing rejects malformed or oversized groups atomically', async () => {
  const { document, session } = fixture()
  const empty = { expectedRevision: 0, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [] }
  const good = mountingProfile()
  const inputs = [
    empty,
    { ...empty, circles: Array(64).fill(good.circles[0]), polylines: good.polylines },
    { ...good, arcs: [{ ...good.arcs[0], startDegrees: 0, endDegrees: 360 }] },
    { ...good, arcs: [{ ...good.arcs[0], endDegrees: 361 }] },
    { ...good, arcs: [{ ...good.arcs[0], radius: 0 }] },
    { ...good, polylines: [{ ...good.polylines[0], closed: 'yes' }] },
    { ...good, polylines: [{ vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: true }] },
    { ...good, polylines: [{ vertices: [{ x: 0, y: 0 }, { x: 0, y: 0 }], closed: false }] },
    { ...good, polylines: [{ vertices: [...good.polylines[0].vertices, { x: 0, y: 0 }], closed: true }] },
    { ...good, polylines: [{ vertices: Array(65).fill({ x: 1, y: 2 }), closed: false }] },
    { ...good, commands: [{ command: 'DELETE' }] },
  ]
  const source = document.serialize()
  for (const input of inputs) {
    assert.equal((await session.call('cad_propose_drawing', input)).ok, false, JSON.stringify(input))
    assert.equal(document.serialize(), source)
  }
})
