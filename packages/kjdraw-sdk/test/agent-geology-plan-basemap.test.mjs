import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAgentGeologyPlan, createKJDrawSDK, KJDocument } from '../src/index.js'

function input(patch = {}) {
  return {
    version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en',
    drawingId: 'PUBLIC-BASEMAP-LINEWORK', title: 'INVESTIGATION PLAN', revision: 'A', scale: 500,
    boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
    boreholes: [
      { id: 'P1', position: [20, 20], collarElevation: 100, depth: 20 },
      { id: 'P2', position: [115, 70], collarElevation: 98, depth: 25 },
    ],
    sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2'], label: 'A-A', endpointLabels: ['A', 'A'] }],
    coordinateGrid: { origin: [0, 0], spacing: 20 },
    baseMapStyles: [
      { id: 'primary', color: 7, lineweight: 25, pattern: [] },
      { id: 'secondary', color: 3, lineweight: 18, pattern: [4, -2] },
    ],
    baseMapLinework: [
      { id: 'edge', styleId: 'primary', kind: 'line', start: [10, 10], end: [60, 10] },
      { id: 'curve', styleId: 'secondary', kind: 'arc', center: [60, 40], radius: 10, startAngleDegrees: 0, endAngleDegrees: 90 },
      { id: 'ring', styleId: 'secondary', kind: 'circle', center: [95, 45], radius: 6 },
      { id: 'outline', styleId: 'primary', kind: 'polyline', points: [[30, 55], [50, 55], [50, 70], [30, 70]], closed: true, startWidths: [0.5, 0.5, 0.5, 0.5], endWidths: [0.5, 0.5, 0.5, 0.5] },
    ],
    northAngleDegrees: 0,
    ...patch,
  }
}

test('geology plan compiles only explicit source-backed base-map linework with exact native styles through KJD and DXF', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-basemap-linework', units: 'meter' })
  const compiled = buildAgentGeologyPlan(document, input())
  assert.equal(compiled.evidence.baseMapStyleCount, 2)
  assert.equal(compiled.evidence.baseMapLineworkCount, 4)
  assert.deepEqual(compiled.evidence.baseMapLineworkTypeCounts, { line: 1, arc: 1, circle: 1, polyline: 1 })
  assert.ok(compiled.evidence.limitations.some(value => value.includes('explicit source-backed line')))
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const linework = document.listEntities().filter(entity => entity.payload.semanticRole === 'source-backed-base-map-linework')
  assert.deepEqual(linework.map(entity => [entity.type, entity.payload.sourceId]), [['LINE', 'edge'], ['ARC', 'curve'], ['CIRCLE', 'ring'], ['LWPOLYLINE', 'outline']])
  assert.equal(linework.every(entity => entity.payload.sourceBacked === true), true)
  const lineLayer = document.getObject(linework[0].payload.layerId), arcLayer = document.getObject(linework[1].payload.layerId)
  assert.deepEqual([lineLayer.name, lineLayer.payload.color, lineLayer.payload.lineweight], ['BASEMAP_01', 7, 25])
  assert.deepEqual([arcLayer.name, arcLayer.payload.color, arcLayer.payload.lineweight], ['BASEMAP_02', 3, 18])
  assert.deepEqual(document.getObject(arcLayer.payload.linetypeId).payload.pattern, [4, -2])
  assert.deepEqual(linework[3].payload.vertices.map(vertex => [vertex.startWidth, vertex.endWidth]), [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]])

  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2007' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD' }), reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF' })
  for (const reopened of [reopenedKjd, reopenedDxf]) {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  }
  assert.deepEqual(['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE'].map(type => reopenedKjd.listEntities({ type }).filter(entity => entity.payload.semanticRole === 'source-backed-base-map-linework').length), [1, 1, 1, 1])
  const dxfLinework = reopenedDxf.listEntities().filter(entity => {
    const layer = reopenedDxf.getObject(entity.payload.layerId)
    return layer?.name === 'BASEMAP_01' || layer?.name === 'BASEMAP_02'
  })
  assert.deepEqual(dxfLinework.map(entity => entity.type).sort(), ['ARC', 'CIRCLE', 'LINE', 'LWPOLYLINE'])
})

test('geology plan base-map linework fails closed on incomplete, unsafe or inferred geometry', () => {
  const rejects = (patch, pattern) => assert.throws(() => buildAgentGeologyPlan(KJDocument.create({ units: 'meter' }), input(patch)), pattern)
  rejects({ baseMapStyles: [{ id: 'unused', color: 7, lineweight: 25, pattern: [] }], baseMapLinework: [] }, /requires supplied baseMapLinework/u)
  rejects({ baseMapLinework: [{ id: 'bad', styleId: 'missing', kind: 'line', start: [10, 10], end: [20, 20] }] }, /unknown base-map style/u)
  rejects({ baseMapStyles: [{ id: 'bad', color: 7, lineweight: 25, pattern: [-2, 1] }] }, /alternate positive dashes/u)
  rejects({ baseMapLinework: [{ id: 'bad', styleId: 'primary', kind: 'line', start: [10, 10], end: [10, 10] }] }, /positive length/u)
  rejects({ baseMapLinework: [{ id: 'bad', styleId: 'primary', kind: 'circle', center: [190, 40], radius: 10 }] }, /declared model viewport/u)
  rejects({ baseMapLinework: [{ id: 'bad', styleId: 'primary', kind: 'arc', center: [60, 40], radius: 10, startAngleDegrees: 0, endAngleDegrees: 0 }] }, /nonzero partial sweep/u)
  rejects({ baseMapLinework: [{ id: 'bad', styleId: 'primary', kind: 'polyline', points: [[10, 10], [20, 10]], startWidths: [1] }] }, /one width per point/u)
  rejects({ baseMapLinework: [{ id: 'bad', styleId: 'primary', kind: 'line', start: [10, 10], end: [20, 20], inferred: true }] }, /unsupported field/u)
})
