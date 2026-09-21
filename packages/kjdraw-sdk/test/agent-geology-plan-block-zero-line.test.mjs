import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'

test('explicit zero-length LINE members remain native inside reviewed source-backed blocks', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' }), session = new KJAgentToolSession(sdk, document)
  const result = await session.call('cad_propose_geology_plan', {
    version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en', drawingId: 'PUBLIC-DEGENERATE-BLOCK', scale: 500,
    boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
    boreholes: [{ id: 'P1', position: [20, 20], collarElevation: 100 }, { id: 'P2', position: [115, 70], collarElevation: 98 }],
    sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
    coordinateGrid: { origin: [0, 0], spacing: 20 },
    baseMapStyles: [{ id: 'source', color: 7, lineweight: 18, pattern: [] }],
    baseMapBlocks: [{ id: 'marker', basePoint: [0, 0], entities: [
      { id: 'degenerate-edge', styleId: 'source', kind: 'line', start: [0, 0], end: [0, 0] },
      { id: 'ring', styleId: 'source', kind: 'circle', center: [0, 0], radius: 1 },
    ] }],
    baseMapInserts: [{ id: 'marker-instance', styleId: 'source', blockId: 'marker', position: [70, 45], scale: [1, 1, 1], rotationDegrees: 0 }],
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal((await session.approve(result.value.planId, 'host-reviewer')).ok, true)
  const zeroLines = value => value.listEntities({ type: 'LINE' }).filter(entity => {
    const start = entity.payload.start, end = entity.payload.end
    return Array.isArray(start) && Array.isArray(end) && start.every((coordinate, index) => coordinate === end[index])
  })
  assert.equal(zeroLines(document).length, 1)
  for (const format of ['KJD', 'DXF']) {
    const contents = await sdk.writeDocument(document, format === 'DXF' ? { format, version: '2018' } : { format })
    const reopened = await sdk.readDocument(contents, { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    assert.equal(zeroLines(reopened).length, 1)
  }
})
