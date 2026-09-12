import assert from 'node:assert/strict'
import test from 'node:test'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'
import { KJDocument, createKJDrawSDK, entityLength2 } from '../src/index.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'agent-lengthen', units: 'millimeter' })
  await document.transact('Lengthen fixtures', tx => {
    tx.createEntity('LINE', { start: [0, 0, 2], end: [10, 0, 4], color: 3, lineweight: 25 }, { id: 'line' })
    tx.createEntity('ARC', { center: [20, 0, 6], radius: 5, startAngle: 0, endAngle: Math.PI / 2, clockwise: false, color: 5 }, { id: 'arc' })
    tx.createEntity('ARC', { center: [40, 0, 7], radius: 5, startAngle: 0, endAngle: 3 * Math.PI / 2, clockwise: true }, { id: 'clockwise-arc' })
    tx.createEntity('CIRCLE', { center: [60, 0, 0], radius: 5 }, { id: 'circle' })
    tx.createEntity('LINE', { start: [0, 90, 0], end: [1, 90, 1e12] }, { id: 'steep-line' })
    tx.createEntity('LINE', { start: [1e12 - 10, 100, 0], end: [1e12, 100, 0] }, { id: 'far-line' })
  })
  const group = await sdk.executeCommand('GROUP', { name: 'Editable detail', ids: ['line', 'arc'] })
  return { sdk, document, group, session: new KJAgentToolSession(sdk, document) }
}
const args = (document, input) => ({ expectedRevision: document.revision, units: 'millimeter', ...input })

test('AI LENGTHEN modifies explicit LINE endpoints in all modes with stable identity and one undo per approval', async () => {
  const { sdk, document, session, group } = await fixture()
  const original = document.getObject('line')
  const inputs = [
    [{ id: 'line', endpoint: 'end', mode: 'TOTAL', value: 15 }, [0, 0, 2], [15, 0, 5]],
    [{ id: 'line', endpoint: 'start', mode: 'DELTA', value: -5 }, [5, 0, 3], [15, 0, 5]],
    [{ id: 'line', endpoint: 'end', mode: 'PERCENT', value: 50 }, [5, 0, 3], [10, 0, 4]],
    [{ id: 'line', endpoint: 'end', mode: 'DYNAMIC', targetPoint: { x: 13, y: 7 } }, [5, 0, 3], [13, 0, 4.6]],
  ]
  for (const [input, start, end] of inputs) {
    const before = document.serialize(), revision = document.revision, previous = document.getObject('line')
    const proposal = value(await session.call('cad_propose_lengthen', args(document, input)))
    assert.equal(document.serialize(), before)
    assert.equal(proposal.command, 'LENGTHEN')
    assert.deepEqual(proposal.preview.before.map(entity => entity.id), ['line'])
    assert.deepEqual(proposal.preview.after[0].payload.start, start)
    proposal.preview.after[0].payload.end.forEach((coordinate, index) => close(coordinate, end[index]))
    value(await session.approve(proposal.planId, 'host-reviewer'))
    assert.equal(document.revision, revision + 1)
    assert.equal(document.getObject('line').handle, original.handle)
    assert.equal(document.getObject('line').payload.color, 3)
    assert.equal(document.getObject('line').payload.lineweight, 25)
    assert.deepEqual(document.getObject(group.id).payload.memberIds, ['line', 'arc'])
    const current = document.getObject('line')
    await sdk.executeCommand('UNDO'); assert.deepEqual(document.getObject('line'), previous)
    await sdk.executeCommand('REDO'); assert.deepEqual(document.getObject('line'), current)
    assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
  }
  close(entityLength2(document.getObject('line')).value, 8)
  assert.equal(KJDocument.open(document.serialize()).serialize(), document.serialize())
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  close(entityLength2(reopened.listEntities({ type: 'LINE' })[0]).value, 8)
  close(reopened.listEntities({ type: 'LINE' })[0].payload.end[2], 4.6)
})

test('AI LENGTHEN preserves ARC center, radius, elevation and directed sweep through DXF reopening', async () => {
  const { sdk, document, session } = await fixture()
  for (const id of ['arc', 'clockwise-arc']) {
    const original = document.getObject(id)
    let proposal = value(await session.call('cad_propose_lengthen', args(document, { id, endpoint: 'end', mode: 'TOTAL', value: 5 * Math.PI })))
    close(entityLength2(proposal.preview.after[0]).value, 5 * Math.PI)
    value(await session.approve(proposal.planId, 'host-reviewer'))
    proposal = value(await session.call('cad_propose_lengthen', args(document, { id, endpoint: 'start', mode: 'DELTA', value: -2.5 * Math.PI })))
    close(entityLength2(proposal.preview.after[0]).value, 2.5 * Math.PI)
    value(await session.approve(proposal.planId, 'host-reviewer'))
    proposal = value(await session.call('cad_propose_lengthen', args(document, { id, endpoint: 'end', mode: 'PERCENT', value: 200 })))
    close(entityLength2(proposal.preview.after[0]).value, 5 * Math.PI)
    value(await session.approve(proposal.planId, 'host-reviewer'))
    proposal = value(await session.call('cad_propose_lengthen', args(document, { id, endpoint: 'end', mode: 'DYNAMIC', targetPoint: { x: original.payload.center[0] - 5, y: 0 } })))
    close(entityLength2(proposal.preview.after[0]).value, 2.5 * Math.PI)
    value(await session.approve(proposal.planId, 'host-reviewer'))
    const actual = document.getObject(id)
    assert.equal(actual.handle, original.handle)
    assert.deepEqual(actual.payload.center, original.payload.center)
    assert.equal(actual.payload.radius, original.payload.radius)
    assert.equal(actual.payload.clockwise, original.payload.clockwise)
  }
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  for (const arc of reopened.listEntities({ type: 'ARC' })) close(entityLength2(arc).value, 2.5 * Math.PI)
})

test('AI LENGTHEN rejects incomplete, ambiguous, collapsed, full-circle and no-op requests without mutation', async () => {
  const { document, session } = await fixture()
  const before = document.serialize(), revision = document.revision
  const base = { id: 'line', endpoint: 'end', mode: 'TOTAL', value: 15 }
  const invalid = [
    { ...base, id: 'missing' }, { ...base, id: 'circle' }, { ...base, endpoint: 'nearest' },
    { ...base, value: 0 }, { ...base, value: 10 }, { ...base, mode: 'DELTA', value: -10 },
    { ...base, mode: 'PERCENT', value: 100 }, { ...base, mode: 'DYNAMIC' },
    { ...base, targetPoint: { x: 15, y: 0 } }, { ...base, mode: 'DYNAMIC', targetPoint: { x: 15, y: 0 } },
    { id: 'line', endpoint: 'end', mode: 'TOTAL' },
    { id: 'line', endpoint: 'end', mode: 'DYNAMIC', targetPoint: { x: -1, y: 0 } },
    { id: 'arc', endpoint: 'end', mode: 'TOTAL', value: 10 * Math.PI },
    { id: 'arc', endpoint: 'end', mode: 'TOTAL', value: 2.5 * Math.PI },
    { id: 'arc', endpoint: 'end', mode: 'DYNAMIC', targetPoint: { x: 20, y: 0 } },
    { id: 'steep-line', endpoint: 'end', mode: 'TOTAL', value: 2 },
    { id: 'far-line', endpoint: 'end', mode: 'TOTAL', value: 20 },
    { ...base, mode: 'DYNAMIC', value: undefined, targetPoint: { x: 15, y: 0 } },
  ]
  for (const input of invalid) {
    const result = await session.call('cad_propose_lengthen', args(document, input))
    assert.equal(result.ok, false, JSON.stringify(input))
    assert.equal(document.serialize(), before)
    assert.equal(document.revision, revision)
  }
  await assert.rejects(createAgentGeometryPreview(document, 'LENGTHEN', { id: 'line', endpoint: 'end', mode: 'TOTAL', value: 15, pickPoint: [10, 0] }), /Unexpected/)
})

test('AI LENGTHEN rejects protected geometry and stale or replaced approvals', async () => {
  const { sdk, document, session } = await fixture()
  await document.transact('Protected lengthen fixtures', tx => {
    for (const [id, patch, owner] of [
      ['hidden', { visible: false }], ['locked', { locked: true }], ['frozen', { frozen: true }],
      ['ocs', { normal: [0, 1, 0] }], ['thick', { thickness: 1 }], ['paper', {}, document.snapshot().spaces.paperSpaceIds[0]],
    ]) tx.createEntity('ARC', { center: [80, 0, 0], radius: 5, startAngle: 0, endAngle: Math.PI / 2, ...patch }, { id, ...(owner ? { ownerId: owner } : {}) })
  })
  for (const id of ['hidden', 'locked', 'frozen', 'ocs', 'thick', 'paper']) {
    const before = document.serialize()
    assert.equal((await session.call('cad_propose_lengthen', args(document, { id, endpoint: 'end', mode: 'TOTAL', value: 5 * Math.PI }))).ok, false)
    assert.equal(document.serialize(), before)
  }
  const input = { id: 'line', endpoint: 'end', mode: 'TOTAL', value: 15 }
  const proposal = value(await session.call('cad_propose_lengthen', args(document, input)))
  await sdk.executeCommand('MOVE', { ids: ['line'], dx: 1, dy: 0 })
  const drift = document.serialize()
  assert.equal((await session.approve(proposal.planId, 'host-reviewer')).ok, false)
  assert.equal(document.serialize(), drift)
  const replacement = value(await session.call('cad_propose_lengthen', args(document, input)))
  let invoked = false
  sdk.commands.register({ id: 'LENGTHEN', execute() { invoked = true } }, { owner: 'plugin', replace: true })
  assert.equal((await session.approve(replacement.planId, 'host-reviewer')).ok, false)
  assert.equal(invoked, false)
  assert.equal(document.serialize(), drift)
  const definition = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_lengthen')
  assert.deepEqual(definition.inputSchema.required, ['expectedRevision', 'units', 'id', 'endpoint', 'mode'])
  assert.ok(Buffer.byteLength(JSON.stringify(definition)) < 3000)
})
