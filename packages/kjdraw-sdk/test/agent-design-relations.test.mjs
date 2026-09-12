import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, KJDocument, readDesignRelations } from '../src/index.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createAgentGeometryPreview, agentPreviewMatchesDocument } from '../src/agent-preview.js'
import { createAgentDesignContext } from '../src/agent-design-relations.js'
import { KJDRAW_CHAT_TOOL_NAMES } from '../../../apps/playground/agent-chat.js'

const expression = (name, coefficient = 1, constant = 0) => ({ constant, terms: [{ parameter: name, coefficient }] })
const parameter = (name, value) => ({ name, value, min: 1, max: 1000 })
const bind = (entityId, path, name, coefficient = 1) => ({ entityId, path, expression: expression(name, coefficient) })
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const args = (document, input) => ({ expectedRevision: document.revision, units: 'millimeter', ...input })
async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Native geometry', tx => {
    tx.createEntity('LINE', { start: [0, 0, 3], end: [200, 0, 3] }, { id: 'line' })
    tx.createEntity('CIRCLE', { center: [180, 20, 3], radius: 5 }, { id: 'hole' })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[100, -15, 0], [0, 0, 0], [200, 0, 0]] }, { id: 'dim' })
  })
  const design = await sdk.executeCommand('DESIGNCREATE', { name: 'Plate edge', definition: {
    parameters: [parameter('width', 200), parameter('margin', 20)],
    derived: [{ name: 'holeX', expression: { constant: 0, terms: [{ parameter: 'width', coefficient: 1 }, { parameter: 'margin', coefficient: -1 }] } }],
    bindings: [bind('line', 'end.0', 'width'), bind('hole', 'center.0', 'holeX'), bind('dim', 'definitionPoints.0.0', 'width', .5), bind('dim', 'definitionPoints.2.0', 'width')],
    requirements: [{ name: 'edge_clearance', expression: { constant: -5, terms: [{ parameter: 'margin', coefficient: 1 }] }, min: 0, max: 1000 }],
  } })
  return { sdk, document, design, session: new KJAgentToolSession(sdk, document) }
}

test('AI discovers parameter ranges and previews exact dependent edits; host approval commits one undoable update', async () => {
  const { sdk, document, design, session } = await fixture()
  assert.ok(KJDRAW_CHAT_TOOL_NAMES.includes('cad_read_designs'))
  assert.ok(KJDRAW_CHAT_TOOL_NAMES.includes('cad_propose_design_update'))
  const before = document.serialize(), query = { expectedRevision: document.revision, offset: 0, limit: 20, maxBytes: 262144 }
  const context = value(await session.call('cad_read_designs', query))
  assert.equal(context.designs[0].id, design.id); assert.equal(context.designs[0].parameters[0].max, 1000)
  assert.equal(context.designs[0].derived.holeX, 180)
  assert.equal(JSON.stringify(context).includes('bindings'), false)
  assert.equal(document.serialize(), before)
  const proposal = value(await session.call('cad_propose_design_update', args(document, { id: design.id, changes: [{ name: 'width', value: 300 }, { name: 'margin', value: 25 }] })))
  assert.equal(document.serialize(), before)
  assert.equal(proposal.command, 'DESIGNUPDATE')
  assert.equal(proposal.preview.designChange.before.parameters[0].value, 200)
  assert.equal(proposal.preview.designChange.after.parameters[0].value, 300)
  assert.deepEqual(proposal.preview.after.find(entity => entity.id === 'hole').payload.center, [275, 20, 3])
  assert.equal(proposal.preview.after.find(entity => entity.id === 'dim').payload.measurement, 300)
  const revision = document.revision, originals = document.listEntities()
  value(await session.approve(proposal.planId, 'host'))
  assert.equal(document.revision, revision + 1)
  assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  for (const entity of originals) assert.equal(document.getObject(entity.id).handle, entity.handle)
  assert.equal(readDesignRelations(document)[0].values.width, 300)
  const current = document.getObject('line')
  await sdk.executeCommand('UNDO'); assert.equal(readDesignRelations(document)[0].values.width, 200)
  await sdk.executeCommand('REDO'); assert.deepEqual(document.getObject('line'), current)
  assert.equal((await session.approve(proposal.planId, 'host')).ok, false)
  assert.deepEqual(readDesignRelations(KJDocument.open(document.serialize())), readDesignRelations(document))
})

test('AI parameter proposals reject invalid values, duplicate names, stale units/revisions and manually edited geometry atomically', async () => {
  const { sdk, document, design, session } = await fixture()
  for (const input of [
    { id: design.id, changes: [] }, { id: 'missing', changes: [{ name: 'width', value: 300 }] },
    { id: design.id, changes: [{ name: 'width', value: 300 }, { name: 'width', value: 400 }] },
    { id: design.id, changes: [{ name: 'holeX', value: 300 }] }, { id: design.id, changes: [{ name: 'margin', value: 2 }] },
    { id: design.id, changes: [{ name: 'width', value: NaN }] }, { id: design.id, changes: [{ name: 'width', value: 300 }], units: 'meter' },
    { id: design.id, changes: [{ name: 'width', value: 300 }], expectedRevision: 0 },
  ]) {
    const before = document.serialize()
    assert.equal((await session.call('cad_propose_design_update', args(document, input))).ok, false)
    assert.equal(document.serialize(), before)
  }
  const proposal = value(await session.call('cad_propose_design_update', args(document, { id: design.id, changes: [{ name: 'width', value: 300 }] })))
  value(await session.reject(proposal.planId, 'Keep the original width'))
  assert.equal(readDesignRelations(document)[0].values.width, 200)
  const stale = value(await session.call('cad_propose_design_update', args(document, { id: design.id, changes: [{ name: 'width', value: 300 }] })))
  await sdk.executeCommand('MOVE', { ids: ['hole'], dx: 1, dy: 0 })
  assert.equal((await session.approve(stale.planId, 'host')).ok, false)
  const before = document.serialize()
  assert.equal((await session.call('cad_propose_design_update', args(document, { id: design.id, changes: [{ name: 'width', value: 300 }] }))).ok, false)
  assert.equal(document.serialize(), before)
  await assert.rejects(createAgentGeometryPreview(document, 'DESIGNUPDATE', { id: design.id, parameters: { width: 300 }, arbitrary: true }), /requires a design ID/)
})

test('AI design discovery paginates with exact response byte bounds and makes oversized rows explicit', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  for (let i = 0; i < 3; i++) {
    await document.transact('Line', tx => tx.createEntity('LINE', { start: [0, i, 0], end: [10, i, 0] }, { id: `line${i}` }))
    await sdk.executeCommand('DESIGNCREATE', { name: `Part ${i}`, definition: { parameters: [parameter('length', 10)], derived: [], bindings: [bind(`line${i}`, 'end.0', 'length')], requirements: [] } })
  }
  const session = new KJAgentToolSession(sdk, document), before = document.serialize()
  const first = value(await session.call('cad_read_designs', { expectedRevision: document.revision, offset: 0, limit: 1, maxBytes: 1024 }))
  assert.equal(first.designs.length, 1); assert.equal(first.nextOffset, 1)
  const second = value(await session.call('cad_read_designs', { expectedRevision: document.revision, offset: 1, limit: 2, maxBytes: 1024 }))
  assert.equal(second.designs.length, 2); assert.equal(second.nextOffset, null)
  assert.ok(new TextEncoder().encode(JSON.stringify({ ok: true, value: second })).length <= 1024)
  assert.equal(document.serialize(), before)
  await document.transact('Oversized discovery fixture', tx => {
    const record = document.listObjects().find(item => item.type === 'DESIGN_RELATIONS')
    const definition = structuredClone(record.payload.definition)
    definition.parameters.push(...Array.from({ length: 63 }, (_, i) => parameter(`unused${i}`, 10)))
    tx.updateObject(record.id, { payload: { definition } })
  })
  const small = createAgentDesignContext(document, 0, 1, 1024)
  assert.deepEqual(small.designs, []); assert.equal(small.nextOffset, 0); assert.equal(small.firstRowTooLarge, true)
  assert.equal(createAgentDesignContext(document, 0, 1, 262144).designs.length, 1)
  assert.equal((await session.call('cad_read_designs', {})).ok, false)
})

test('AI approval detects corrupted authoritative design persistence and never replays an uncertain commit', async () => {
  const { document, design, session } = await fixture()
  let state = document.toJSON(), commits = 0
  document.bindAuthority({ serialize: () => structuredClone(state), close() {}, commit(serialized) {
    commits++; state = JSON.parse(serialized); state.objects[design.id].payload.geometry = {}; return structuredClone(state)
  } })
  const proposal = value(await session.call('cad_propose_design_update', args(document, { id: design.id, changes: [{ name: 'width', value: 300 }] })))
  const before = document.serialize()
  const result = await session.approve(proposal.planId, 'host')
  assert.equal(result.ok, false); assert.match(result.error.message, /mismatched document commit/)
  assert.equal(document.hasAuthoritativeBackend, false)
  assert.equal(document.serialize(), before)
  assert.equal(commits, 1)
  assert.equal(agentPreviewMatchesDocument(document, proposal.preview), false)
  assert.equal((await session.approve(proposal.planId, 'host')).ok, false)
  assert.equal(commits, 1)
  document.unbindAuthority()
})
