import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { agentPreviewMatchesDocument } from '../src/agent-preview.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const DOOR = 'org.kjdraw.architecture.single-swing-door'
const input = (document, patch = {}) => ({
  expectedRevision: document.revision, units: 'millimeter', componentId: DOOR, version: '1.0.0',
  parameters: [{ name: 'width', value: 1000 }, { name: 'wallThickness', value: 200 }, { name: 'swingDegrees', value: 90 }],
  position: { x: 100, y: 200 }, scale: 1, rotationDegrees: 90, ...patch,
})

test('agent component tools search, preview and approve one licensed editable native component', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const search = value(await session.call('cad_read_components', { expectedRevision: 0, query: 'door', category: 'architecture', locale: 'en', limit: 2, cursor: 0 }))
  assert.equal(search.documentId, document.id); assert.equal(search.revision, 0); assert.equal(search.items.length, 1)
  assert.equal(search.items[0].id, DOOR); assert.equal(search.items[0].license.spdx, 'Apache-2.0')

  const source = document.serialize(), history = structuredClone(document.history)
  const proposal = value(await session.call('cad_propose_component_insert', input(document)))
  assert.equal(proposal.command, 'COMPONENTINSERT'); assert.equal(proposal.preview.command, 'COMPONENTINSERT')
  assert.equal(proposal.preview.before.length, 0); assert.equal(proposal.preview.after.length, 5)
  assert.equal(proposal.preview.after.filter(item => item.type === 'INSERT').length, 1)
  assert.equal(proposal.preview.resources.length, 1); assert.equal(proposal.preview.resources[0].kind, 'block-record')
  assert.equal(proposal.preview.resources[0].payload.component.license.spdx, 'Apache-2.0')
  assert.equal(document.serialize(), source); assert.deepEqual(document.history, history)

  const receipt = value(await session.approve(proposal.planId, 'trusted-host'))
  assert.equal(receipt.afterRevision, 1); assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  const insert = document.listEntities({ ownerId: document.spaces.modelSpaceId, type: 'INSERT' })[0]
  assert.deepEqual(insert.payload.position, [100, 200, 0]); assert.equal(insert.payload.rotation, Math.PI / 2)
  const block = document.getObject(insert.payload.blockRecordId)
  assert.equal(block.kind, 'block-record'); assert.equal(block.payload.component.componentId, DOOR)
  assert.equal(document.listEntities({ ownerId: block.id }).length, 4)

  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const reopenedInsert = reopened.listEntities({ ownerId: reopened.spaces.modelSpaceId, type: 'INSERT' })[0]
  assert.equal(reopened.getObject(reopenedInsert.payload.blockRecordId).payload.component.componentId, DOOR)
})

test('repeated agent insert reuses its definition and invalid proposals remain atomic', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const first = value(await session.call('cad_propose_component_insert', input(document)))
  value(await session.approve(first.planId, 'trusted-host'))
  const definitionId = document.listEntities({ type: 'INSERT' })[0].payload.blockRecordId

  const second = value(await session.call('cad_propose_component_insert', input(document, { position: { x: 1500, y: 200 }, rotationDegrees: 0 })))
  assert.equal(second.preview.after.length, 1); assert.equal(second.preview.after[0].type, 'INSERT'); assert.equal(second.preview.resources, undefined)
  value(await session.approve(second.planId, 'trusted-host'))
  assert.equal(document.listEntities({ type: 'INSERT' }).length, 2)
  assert.equal(document.getTable('blockRecords').records.filter(item => item.id === definitionId).length, 1)
  assert.equal(new Set(document.listEntities({ type: 'INSERT' }).map(item => item.payload.blockRecordId)).size, 1)

  const source = document.serialize(), revision = document.revision, history = structuredClone(document.history)
  for (const bad of [
    input(document, { parameters: [{ name: 'width', value: 1000 }, { name: 'width', value: 900 }] }),
    input(document, { parameters: [{ name: 'unknown', value: 1 }] }),
    input(document, { expectedRevision: revision - 1 }),
    input(document, { scale: 0 }),
  ]) assert.equal((await session.call('cad_propose_component_insert', bad)).ok, false)
  assert.equal(document.serialize(), source); assert.equal(document.revision, revision); assert.deepEqual(document.history, history)

  const rejected = value(await session.call('cad_propose_component_insert', input(document, { position: { x: 2500, y: 200 } })))
  assert.equal(session.reject(rejected.planId, 'trusted-host').ok, true)
  assert.equal(document.serialize(), source); assert.equal(document.revision, revision)
})
