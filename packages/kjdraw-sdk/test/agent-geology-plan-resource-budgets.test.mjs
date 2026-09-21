import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK } from '../src/sdk.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'
import { KJAgentToolSession } from '../src/agent-tools.js'

const resourceBatch = count => ({
  resources: {
    linetypes: Array.from({ length: count }, (_, index) => ({ id: `line-type-${index + 1}`, name: `PUBLIC_TYPE_${index + 1}`, pattern: [] })),
    layers: [],
  },
  entities: [{ type: 'LINE', payload: { start: [0, 0, 0], end: [1, 0, 0] }, options: { id: 'edge' } }],
})

test('CREATEBATCH accepts exactly 80 table records and rejects 81 atomically', async () => {
  const acceptedSdk = createKJDrawSDK(), accepted = acceptedSdk.createDocument({ units: 'meter' })
  await acceptedSdk.executeCommand('CREATEBATCH', resourceBatch(80), { document: accepted })
  assert.equal(accepted.getTable('linetypes').records.length, 81)

  const rejectedSdk = createKJDrawSDK(), rejected = rejectedSdk.createDocument({ units: 'meter' }), before = rejected.serialize()
  await assert.rejects(rejectedSdk.executeCommand('CREATEBATCH', resourceBatch(81), { document: rejected }), /at most 80 records per table/)
  assert.equal(rejected.serialize(), before)
})

test('Agent resource preview remains 32 by default and requires an explicit bounded opt-in', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), args = resourceBatch(33)
  await assert.rejects(createAgentGeometryPreview(document, 'CREATEBATCH', args), /32 new resource limit/)
  const preview = await createAgentGeometryPreview(document, 'CREATEBATCH', args, { maxCreatedResources: 256 })
  assert.equal(preview.resources.length, 33)
  assert.equal(document.listEntities().length, 0)
  for (const maxCreatedResources of [0, 257, 1.5, NaN, Infinity])
    await assert.rejects(createAgentGeometryPreview(document, 'CREATEBATCH', args, { maxCreatedResources }), /integer from 1 to 256/)
})

const geologyIntent = () => {
  const baseMapStyles = Array.from({ length: 26 }, (_, index) => ({
    id: `source-style-${String(index + 1).padStart(2, '0')}`,
    color: index + 1,
    lineweight: 18,
    pattern: [],
  }))
  return {
    version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-RESOURCE-PLAN', scale: 500,
    boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
    boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
    sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
    coordinateGrid: { origin: [0, 0], spacing: 20 },
    baseMapStyles,
    baseMapLinework: baseMapStyles.map((style, index) => ({ id: `line-${index + 1}`, styleId: style.id, kind: 'line', start: [5, 3 + index * 3], end: [12, 3 + index * 3] })),
    baseMapBlocks: [{ id: 'symbol', basePoint: [0, 0], entities: [{ id: 'edge', styleId: baseMapStyles[0].id, kind: 'line', start: [-1, 0], end: [1, 0] }] }],
    baseMapInserts: [{ id: 'symbol-instance', styleId: baseMapStyles[0].id, blockId: 'symbol', position: [70, 45], scale: [1, 1, 1], rotationDegrees: 0 }],
  }
}

test('ordinary geology-plan MCP approves 35 layers and reopens KJD and DXF without proxies', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const definition = session.definitions.find(item => item.name === 'cad_propose_geology_plan')
  assert.equal(definition.inputSchema.properties.baseMapStyles.maxItems, 64)
  const proposal = await session.call('cad_propose_geology_plan', geologyIntent())
  assert.equal(proposal.ok, true, JSON.stringify(proposal))
  assert.equal(proposal.value.arguments.resources.layers.length, 35)
  assert.equal(proposal.value.arguments.resources.linetypes.length, 29)
  assert.ok(proposal.value.preview.resources.length > 32)
  assert.equal(proposal.value.engineeringEvidence.proposalByteLimit, 4194304)
  assert.equal(proposal.value.engineeringEvidence.proposalBytes, new TextEncoder().encode(JSON.stringify(proposal)).length)
  assert.ok(proposal.value.engineeringEvidence.proposalBytes < proposal.value.engineeringEvidence.proposalByteLimit)
  const receipt = await session.approve(proposal.value.planId, 'host-reviewer')
  assert.equal(receipt.ok, true, JSON.stringify(receipt))
  for (const format of ['KJD', 'DXF']) {
    const contents = await sdk.writeDocument(document, format === 'DXF' ? { format, version: '2018' } : { format })
    const reopened = await sdk.readDocument(contents, { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  }
})
