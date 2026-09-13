import assert from 'node:assert/strict'
import test from 'node:test'

import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'

const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

function multiply(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

const transform = (matrix, point) => [
  matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
  matrix[1] * point[0] + matrix[3] * point[1] + matrix[5],
]

function projectedLength(output, viewportId, start, end) {
  const viewport = output.report.viewports.find(row => row.entityId === viewportId)
  assert.ok(viewport, 'the site viewport must be present in the physical export report')
  const matrix = multiply(output.plot.drawingToPaperMatrix, viewport.matrix)
  return distance(transform(matrix, start), transform(matrix, end))
}

function layerByName(document, name) {
  const layer = document.getTable('layers').records.find(record => record.name === name)
  assert.ok(layer, `missing layer ${name}`)
  return layer
}

function entitiesOn(document, layerName) {
  const layer = layerByName(document, layerName)
  return document.listEntities().filter(entity => entity.payload.layerId === layer.id)
}

function findRoadCenterline(document) {
  const road = entitiesOn(document, 'C-ROAD')
  const centerline = road.find(entity => entity.type === 'LWPOLYLINE' &&
    entity.payload.vertices.length === 2 &&
    Math.abs(entity.payload.vertices[0].point[1] - 3_000_038) < 1e-9)
  assert.ok(centerline, 'moved 100 m road centerline must remain identifiable by geometry and layer')
  return centerline
}

function verifySiteModel(document) {
  assert.equal(document.snapshot().header.units, 'meter')
  assert.deepEqual([
    entitiesOn(document, 'C-BOUNDARY').length,
    entitiesOn(document, 'C-ROAD').length,
    entitiesOn(document, 'A-BUILDING').length,
    entitiesOn(document, 'U-WATER').length,
  ], [1, 3, 2, 3])

  const centerline = findRoadCenterline(document)
  assert.deepEqual(centerline.payload.vertices.map(vertex => vertex.point), [
    [500_015, 3_000_038, 0],
    [500_115, 3_000_038, 0],
  ])
  near(distance(centerline.payload.vertices[0].point, centerline.payload.vertices[1].point), 100)
  return centerline
}

function verifyPlot(document) {
  const layout = document.listObjects({ kind: 'layout' }).find(record => record.name === 'Site plan 1:500')
  assert.ok(layout, 'the named site layout must reopen')
  const viewports = document.listEntities({ ownerId: layout.payload.blockRecordId, type: 'VIEWPORT' })
  const viewport = viewports.find(record => record.payload.width === 300 && record.payload.height === 200)
  assert.ok(viewport, 'the 1:500 site viewport must reopen')

  const output = exportDrawingSvg(document, { layoutId: layout.id })
  const scale = output.report.viewports.find(row => row.entityId === viewport.id)
  assert.ok(scale)
  near(scale.millimetersPerModelUnit, 2)
  near(projectedLength(output, viewport.id, [500_015, 3_000_038], [500_115, 3_000_038]), 200)
  assert.equal(output.paper.widthMm, 841)
  assert.equal(output.paper.heightMm, 594)
  assert.equal(output.report.diagnostics.length, 0)
  return output
}

test('blank meter site plan completes layered editing, history, persistence and independently measured 1:500 output', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'production-site-workflow', units: 'meter' })
  assert.equal(document.snapshot().header.units, 'meter')
  assert.equal(document.listEntities().length, 0, 'the workflow must start from a blank KJDocument')

  const boundaryLayer = await sdk.executeCommand('LAYERNEW', { name: 'C-BOUNDARY', color: 2, lineweight: 50 }, { document })
  const roadLayer = await sdk.executeCommand('LAYERNEW', { name: 'C-ROAD', color: 1, lineweight: 35 }, { document })
  const buildingLayer = await sdk.executeCommand('LAYERNEW', { name: 'A-BUILDING', color: 3, lineweight: 50 }, { document })
  const utilityLayer = await sdk.executeCommand('LAYERNEW', { name: 'U-WATER', color: 5, lineweight: 25 }, { document })

  await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LWPOLYLINE', payload: { vertices: [[500_000, 3_000_000], [500_120, 3_000_000], [500_120, 3_000_080], [500_000, 3_000_080]], closed: true, layerId: boundaryLayer.id }, options: { id: 'site-boundary' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500_010, 3_000_040], [500_110, 3_000_040]], closed: false, layerId: roadLayer.id }, options: { id: 'road-centerline' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500_010, 3_000_035], [500_110, 3_000_035]], closed: false, layerId: roadLayer.id }, options: { id: 'road-edge-south' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500_010, 3_000_045], [500_110, 3_000_045]], closed: false, layerId: roadLayer.id }, options: { id: 'road-edge-north' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500_025, 3_000_052], [500_045, 3_000_052], [500_045, 3_000_070], [500_025, 3_000_070]], closed: true, layerId: buildingLayer.id }, options: { id: 'building-a' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500_075, 3_000_010], [500_100, 3_000_010], [500_100, 3_000_028], [500_075, 3_000_028]], closed: true, layerId: buildingLayer.id }, options: { id: 'building-b' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500_015, 3_000_020], [500_060, 3_000_030], [500_105, 3_000_020]], closed: false, layerId: utilityLayer.id }, options: { id: 'water-main' } },
    { type: 'CIRCLE', payload: { center: [500_015, 3_000_020], radius: 1, layerId: utilityLayer.id }, options: { id: 'water-manhole-west' } },
    { type: 'CIRCLE', payload: { center: [500_105, 3_000_020], radius: 1, layerId: utilityLayer.id }, options: { id: 'water-manhole-east' } },
  ] }, { document })

  assert.deepEqual((await sdk.executeCommand('DISTANCE', {
    firstPoint: [500_010, 3_000_040], secondPoint: [500_110, 3_000_040],
  }, { document })).distance, 100)

  const selectedRoadIds = await sdk.executeCommand('SELECTBYPROPERTY', { property: 'layer', value: 'C-ROAD' }, { document })
  assert.deepEqual(selectedRoadIds, ['road-centerline', 'road-edge-south', 'road-edge-north'])
  const selectionSet = await sdk.executeCommand('SELECTIONSAVE', { name: 'Road property selection' }, { document })
  const group = await sdk.executeCommand('GROUP', { name: 'Road work set', ids: selectedRoadIds, description: 'Road centerline and both pavement edges' }, { document })
  assert.deepEqual(selectionSet.payload.memberIds, selectedRoadIds)
  assert.deepEqual(group.payload.memberIds, selectedRoadIds)

  await sdk.executeCommand('MOVE', { ids: selectedRoadIds, dx: 5, dy: -2 }, { document })
  const moved = selectedRoadIds.map(id => document.getObject(id))
  assert.deepEqual(moved[0].payload.vertices[0].point, [500_015, 3_000_038, 0])
  assert.ok(moved.every(entity => entity.payload.layerId === roadLayer.id))
  assert.deepEqual(document.getObject(selectionSet.id).payload.memberIds, selectedRoadIds)
  assert.deepEqual(document.getObject(group.id).payload.memberIds, selectedRoadIds)

  await sdk.executeCommand('UNDO', {}, { document })
  assert.deepEqual(document.getObject('road-centerline').payload.vertices[0].point, [500_010, 3_000_040, 0])
  assert.deepEqual(document.getObject(selectionSet.id).payload.memberIds, selectedRoadIds)
  assert.deepEqual(document.getObject(group.id).payload.memberIds, selectedRoadIds)
  await sdk.executeCommand('REDO', {}, { document })
  verifySiteModel(document)

  const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'Site plan 1:500' }, { document })
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: {
    paperWidth: 841, paperHeight: 594, paperUnits: 1,
    marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10,
    originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
    plotType: 5, rotation: 0, flags: 0,
  } }, { document })
  await sdk.executeCommand('VIEWPORT', {
    layoutId: layout.id, center: [200, 150], width: 300, height: 200,
    viewCenter: [500_065, 3_000_040], viewHeight: 100,
  }, { document })
  await sdk.executeCommand('CREATE', {
    type: 'LWPOLYLINE',
    payload: { vertices: [[10, 10], [831, 10], [831, 584], [10, 584]], closed: true },
    options: { ownerId: layout.payload.blockRecordId, id: 'site-sheet-frame' },
  }, { document })

  const originalPlot = verifyPlot(document)
  assert.equal(document.validate().valid, true)

  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const kjdSdk = createKJDrawSDK()
  const kjdReopened = await kjdSdk.readDocument(kjd, { format: 'KJD' })
  verifySiteModel(kjdReopened)
  assert.deepEqual(kjdReopened.listObjects({ kind: 'group' }).map(record => [record.type, record.name, record.payload.memberIds]), [
    ['SELECTION_SET', 'Road property selection', selectedRoadIds],
    ['GROUP', 'Road work set', selectedRoadIds],
  ])
  assert.deepEqual(verifyPlot(kjdReopened).paper, originalPlot.paper)

  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const dxfSdk = createKJDrawSDK()
  const dxfReopened = await dxfSdk.readDocument(dxf, { format: 'DXF' })
  verifySiteModel(dxfReopened)
  verifyPlot(dxfReopened)
  assert.equal(dxfReopened.validate().valid, true)
})
