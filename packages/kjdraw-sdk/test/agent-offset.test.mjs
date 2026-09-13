import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'

const tool = 'cad_propose_offset'
function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LINE', payload: { start: [0, 0, 0], end: [40, 0, 0] }, options: { id: 'wall' } },
    { type: 'CIRCLE', payload: { center: [80, 20, 0], radius: 10 }, options: { id: 'opening' } },
  ] })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}

test('AI OFFSET previews and commits one stable native parallel copy that survives KJD and DXF', async () => {
  const { sdk, document, session } = await fixture(), before = document.serialize()
  const proposal = value(await session.call(tool, { expectedRevision: 1, units: 'millimeter', id: 'wall', distance: 5, sidePoint: { x: 10, y: 20 } }))
  assert.equal(document.serialize(), before)
  assert.equal(proposal.command, 'OFFSET')
  assert.equal(proposal.preview.before.length, 0)
  assert.equal(proposal.preview.after.length, 1)
  assert.equal(proposal.arguments.resultId, proposal.preview.after[0].id)
  assert.deepEqual(proposal.preview.after[0].payload.start, [0, 5, 0])
  assert.deepEqual(proposal.preview.after[0].payload.end, [40, 5, 0])
  const source = document.getObject('wall')
  value(await session.approve(proposal.planId, 'reviewer'))
  assert.deepEqual(document.getObject('wall'), source)
  assert.deepEqual(document.getObject(proposal.arguments.resultId).payload, proposal.preview.after[0].payload)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    assert.equal(reopened.listEntities({ type: 'LINE' }).length, 2)
    assert.ok(reopened.listEntities({ type: 'LINE' }).some(item => item.payload.start[1] === 5 && item.payload.end[1] === 5))
  }
  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length, 2)
  assert.equal(document.getObject(proposal.arguments.resultId), null)
})

test('AI OFFSET chooses concentric inward and outward results from the side point', async () => {
  const { document, session } = await fixture()
  let proposal = value(await session.call(tool, { expectedRevision: 1, units: 'millimeter', id: 'opening', distance: 3, sidePoint: { x: 80, y: 20 } }))
  assert.equal(proposal.preview.after[0].payload.radius, 7)
  value(session.reject(proposal.planId, 'reviewer'))
  proposal = value(await session.call(tool, { expectedRevision: 1, units: 'millimeter', id: 'opening', distance: 3, sidePoint: { x: 100, y: 20 } }))
  assert.equal(proposal.preview.after[0].payload.radius, 13)
  assert.equal(document.revision, 1)
})

test('AI OFFSET rejects malformed, collapsing, protected, stale and forged result inputs atomically', async () => {
  const { sdk, document, session } = await fixture(), source = document.serialize()
  const base = { expectedRevision: 1, units: 'millimeter', id: 'opening', distance: 10, sidePoint: { x: 80, y: 20 } }
  for (const patch of [
    { distance: 0 }, { distance: -1 }, { distance: Infinity }, { distance: 1e13 },
    { sidePoint: { x: Infinity, y: 0 } }, { id: 'missing' }, { expectedRevision: 0 }, { units: 'meter' }, { command: 'DELETE' },
  ]) {
    assert.equal((await session.call(tool, { ...base, ...patch })).ok, false)
    assert.equal(document.serialize(), source)
  }
  assert.equal((await session.call(tool, base)).ok, false, 'an inward offset cannot collapse the circle')
  await assert.rejects(sdk.executeCommand('OFFSET', { id: 'opening', distance: 2, sidePoint: [100, 20], resultId: 'opening' }), /resultId/)
  assert.equal(document.serialize(), source)
  await sdk.executeCommand('LAYERUPDATE', { id: document.getObject('wall').payload.layerId, patch: { locked: true } })
  const locked = document.serialize()
  assert.equal((await session.call(tool, { ...base, expectedRevision: document.revision, id: 'wall', distance: 2 })).ok, false)
  assert.equal(document.serialize(), locked)
  assert.equal(document.serialize(), locked)
})

test('AI OFFSET publishes a strict bounded schema and no host-controlled result identity', () => {
  const definition = KJDRAW_AGENT_TOOLS.find(item => item.name === tool)
  assert.ok(definition)
  assert.deepEqual(definition.inputSchema.required, ['expectedRevision', 'units', 'id', 'distance', 'sidePoint'])
  assert.equal(definition.inputSchema.additionalProperties, false)
  assert.equal(definition.inputSchema.properties.distance.exclusiveMinimum, 0)
  assert.equal('resultId' in definition.inputSchema.properties, false)
})
