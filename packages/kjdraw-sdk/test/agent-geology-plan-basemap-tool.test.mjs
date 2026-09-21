import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

test('ordinary geology-plan MCP accepts a reviewed source-backed base map beyond the former preview ceiling', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const definition = session.definitions.find(tool => tool.name === 'cad_propose_geology_plan')
  assert.equal(definition.inputSchema.properties.baseMapStyles.maxItems, 64)
  assert.equal(definition.inputSchema.properties.baseMapLinework.maxItems, 1024)
  assert.deepEqual(definition.inputSchema.properties.baseMapLinework.items.required, ['id', 'styleId', 'kind'])
  assert.deepEqual(definition.inputSchema.properties.baseMapLinework.items.properties.kind.enum, ['line', 'arc', 'circle', 'polyline'])

  const baseMapLinework = Array.from({ length: 600 }, (_, index) => {
    const row = Math.floor(index / 30), column = index % 30
    const x = 5 + column * 4, y = 5 + row * 3.5
    return { id: `line-${index + 1}`, styleId: 'source', kind: 'line', start: [x, y], end: [x + 2.5, y + 1] }
  })
  const result = await session.call('cad_propose_geology_plan', {
    version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en',
    drawingId: 'PUBLIC-MCP-BASEMAP', title: 'INVESTIGATION PLAN', scale: 500,
    boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
    boreholes: [
      { id: 'P1', position: [20, 20], collarElevation: 100, depth: 20 },
      { id: 'P2', position: [115, 70], collarElevation: 98, depth: 25 },
    ],
    sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
    coordinateGrid: { origin: [0, 0], spacing: 20 },
    baseMapStyles: [{ id: 'source', color: 7, lineweight: 18, pattern: [] }],
    baseMapLinework,
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.status, 'awaiting-host-approval')
  assert.equal(result.value.engineeringEvidence.baseMapLineworkCount, 600)
  assert.equal(result.value.preview.after.length, result.value.engineeringEvidence.entityCount)
  assert.equal(document.revision, 0)
  assert.equal(document.listEntities().length, 0)
})
