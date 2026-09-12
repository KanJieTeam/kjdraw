import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, KJDocument, readDesignRelations } from '../src/index.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'

const expression = (parameter, coefficient = 1) => ({ constant: 0, terms: [{ parameter, coefficient }] })
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const definition = () => ({
  parameters: [{ name: 'width', value: 10, min: 1, max: 100 }, { name: 'margin', value: 2, min: 1, max: 10 }],
  derived: [{ name: 'right', expression: { constant: 0, terms: [{ parameter: 'width', coefficient: 1 }, { parameter: 'margin', coefficient: -1 }] } }],
  bindings: [{ entityId: 'line', path: 'end.0', expression: expression('width') }, { entityId: 'hole', path: 'center.0', expression: expression('right') }],
  requirements: [{ name: 'clearance', min: 0, max: 100, expression: { constant: -2, terms: [{ parameter: 'width', coefficient: 1 }, { parameter: 'margin', coefficient: -2 }] } }],
})
async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Unbound native geometry', tx => {
    tx.createEntity('LINE', { start: [0, 0, 3], end: [10, 0, 3], color: 3 }, { id: 'line' })
    tx.createEntity('CIRCLE', { center: [8, 2, 3], radius: 1, color: 5 }, { id: 'hole' })
  })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
const args = (document, input = {}) => ({ expectedRevision: document.revision, units: 'millimeter', name: 'Native part', definition: definition(), ...input })

test('AI binds a new persistent design with stable preview identity and continuously updates original geometry', async () => {
  const { sdk, document, session } = await fixture(), original = document.listEntities(), before = document.serialize()
  const proposal = value(await session.call('cad_propose_design_bind', args(document)))
  assert.equal(document.serialize(), before); assert.deepEqual(readDesignRelations(document), [])
  assert.equal(proposal.command, 'DESIGNCREATE')
  assert.equal(proposal.preview.designChange.record.id, proposal.arguments.id)
  assert.deepEqual(proposal.preview.before, []); assert.deepEqual(proposal.preview.after, [])
  assert.deepEqual(proposal.preview.designChange.before.parameters, [])
  const revision = document.revision
  value(await session.approve(proposal.planId, 'host'))
  assert.equal(document.revision, revision + 1)
  assert.deepEqual(document.getObject(proposal.arguments.id), proposal.preview.designChange.record)
  assert.deepEqual(document.listEntities(), original)
  const update = value(await session.call('cad_propose_design_update', { expectedRevision: document.revision, units: 'millimeter', id: proposal.arguments.id, changes: [{ name: 'width', value: 20 }] }))
  value(await session.approve(update.planId, 'host'))
  assert.deepEqual(document.getObject('line').payload.end, [20, 0, 3]); assert.deepEqual(document.getObject('hole').payload.center, [18, 2, 3])
  assert.equal(document.getObject('hole').handle, original[1].handle)
  assert.equal(readDesignRelations(KJDocument.open(document.serialize()))[0].values.width, 20)
  await sdk.executeCommand('UNDO'); assert.equal(readDesignRelations(document)[0].values.width, 10)
  await sdk.executeCommand('UNDO'); assert.deepEqual(readDesignRelations(document), []); assert.deepEqual(document.listEntities(), original)
  await sdk.executeCommand('REDO'); assert.equal(readDesignRelations(document)[0].id, proposal.arguments.id)
  await sdk.executeCommand('REDO'); assert.equal(readDesignRelations(document)[0].values.width, 20)
})

test('AI relation creation rejects invented geometry, cycles, duplicate ownership and invalid schemas without editing', async () => {
  const { document, session } = await fixture()
  for (const mutate of [
    model => { model.bindings[0].path = 'layerId' }, model => { model.bindings[0].entityId = 'missing' },
    model => { model.parameters[0].value = 20 }, model => { model.derived[0].expression = expression('right') },
    model => model.bindings.push(structuredClone(model.bindings[0])), model => { model.parameters[0].extra = true },
  ]) {
    const model = definition(); mutate(model); const before = document.serialize()
    assert.equal((await session.call('cad_propose_design_bind', args(document, { definition: model }))).ok, false)
    assert.equal(document.serialize(), before)
  }
  const discarded = value(await session.call('cad_propose_design_bind', args(document)))
  value(session.reject(discarded.planId, 'host')); assert.deepEqual(readDesignRelations(document), [])
  const proposal = value(await session.call('cad_propose_design_bind', args(document)))
  value(await session.approve(proposal.planId, 'host'))
  const before = document.serialize()
  assert.equal((await session.call('cad_propose_design_bind', args(document, { name: 'Other part' }))).ok, false)
  assert.equal(document.serialize(), before)
  await assert.rejects(createAgentGeometryPreview(document, 'DESIGNCREATE', { name: 'Missing stable ID', definition: definition() }), /stable preallocated ID/)
})

test('AI relation approval rejects stale source geometry and cannot replay a relation creation', async () => {
  const { sdk, document, session } = await fixture()
  const proposal = value(await session.call('cad_propose_design_bind', args(document)))
  await sdk.executeCommand('MOVE', { ids: ['hole'], dx: 1, dy: 0 })
  const before = document.serialize()
  assert.equal((await session.approve(proposal.planId, 'host')).ok, false)
  assert.equal(document.serialize(), before); assert.deepEqual(readDesignRelations(document), [])
  assert.equal((await session.approve(proposal.planId, 'host')).ok, false)
})

test('AI new relation approval verifies unchanged bound members and its dictionary pointer against authority corruption', async () => {
  for (const corrupt of [state => { state.objects.line.payload.end[0] = 11 }, state => {
    const entries = state.objects[state.namedObjectsDictionaryId].payload.entries
    delete entries[Object.keys(entries).find(key => key.startsWith('KJDRAW_DESIGN:'))]
  }]) {
    const { document, session } = await fixture()
    let state = document.toJSON(), commits = 0
    document.bindAuthority({ serialize: () => structuredClone(state), close() {}, commit(serialized) {
      commits++; state = JSON.parse(serialized); corrupt(state); return structuredClone(state)
    } })
    const proposal = value(await session.call('cad_propose_design_bind', args(document)))
    const result = await session.approve(proposal.planId, 'host')
    assert.equal(result.ok, false); assert.match(result.error.message, /differs from the reviewed preview/)
    assert.equal(commits, 1); assert.equal((await session.approve(proposal.planId, 'host')).ok, false); assert.equal(commits, 1)
    document.unbindAuthority()
  }
})
