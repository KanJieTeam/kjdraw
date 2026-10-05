import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const args = (document, change = {}) => ({ expectedRevision: document.revision, units: 'millimeter', id: 'hole', radius: 8, ...change })

async function fixture() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: `circle-radius-${Math.random()}`, units: 'millimeter' })
  await document.transact('Seed geometry', tx => {
    tx.createEntity('CIRCLE', { center: [20, 30, 0], radius: 5, color: 3 }, { id: 'hole' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [50, 0, 0] }, { id: 'datum' })
  })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}

test('circle radius proposal retains native identity and unrelated geometry across approval, undo and DXF', async () => {
  const { sdk, document, session } = await fixture()
  const before = document.serialize(), original = document.getObject('hole'), datum = document.getObject('datum')
  const proposal = value(await session.call('cad_propose_set_circle_radius', args(document)))
  assert.equal(proposal.command, 'PROPERTIES')
  assert.equal(document.serialize(), before)
  assert.deepEqual(proposal.arguments, { ids: ['hole'], patch: { payload: { radius: 8 } } })
  assert.deepEqual(proposal.preview.before.map(entity => entity.id), ['hole'])
  assert.deepEqual(proposal.preview.after.map(entity => entity.id), ['hole'])
  assert.deepEqual(proposal.preview.after[0].payload, { ...original.payload, radius: 8 })
  value(await session.approve(proposal.planId, 'reviewer'))
  const changed = document.getObject('hole')
  assert.equal(changed.id, original.id)
  assert.equal(changed.handle, original.handle)
  assert.deepEqual(changed.payload, { ...original.payload, radius: 8 })
  assert.deepEqual(document.getObject('datum'), datum)
  assert.equal((await session.approve(proposal.planId, 'reviewer')).ok, false)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    const hole = reopened.listEntities({ type: 'CIRCLE' })[0]
    assert.equal(hole.payload.radius, 8)
    assert.deepEqual(hole.payload.center, [20, 30, 0])
  }
  await document.undo()
  assert.deepEqual(document.getObject('hole'), original)
  assert.deepEqual(document.getObject('datum'), datum)
  await document.redo()
  assert.deepEqual(document.getObject('hole'), changed)
})

test('circle radius tool rejects stale, invalid, protected, bound and unchanged targets', async () => {
  const { sdk, document, session } = await fixture()
  for (const change of [{ radius: 0 }, { radius: -1 }, { radius: 5 }, { id: 'datum' }, { id: 'missing' }, { expectedRevision: document.revision - 1 }]) {
    assert.equal((await session.call('cad_propose_set_circle_radius', args(document, change))).ok, false, JSON.stringify(change))
  }
  await assert.rejects(createAgentGeometryPreview(document, 'PROPERTIES', { ids: ['hole'], patch: { payload: { radius: 8, color: 4 } } }), /exactly one payload field/)
  await document.transact('Lock the hole', tx => tx.updateObject('hole', { payload: { locked: true } }))
  assert.equal((await session.call('cad_propose_set_circle_radius', args(document))).ok, false)
  await document.transact('Unlock the hole', tx => tx.updateObject('hole', { payload: { locked: false } }))
  await sdk.executeCommand('DESIGNCREATE', { name: 'Hole size', definition: { parameters: [{ name: 'radius', value: 5, min: 1, max: 20 }], derived: [], bindings: [{ entityId: 'hole', path: 'radius', expression: { constant: 0, terms: [{ parameter: 'radius', coefficient: 1 }] } }], requirements: [] } }, { document })
  assert.equal((await session.call('cad_propose_set_circle_radius', args(document))).ok, false)
})
