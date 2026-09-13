import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { independentlyInspectProductionDxf } from './production-workflow-independent.mjs'

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const point = (matrix, value) => [
  matrix[0] * value[0] + matrix[2] * value[1] + matrix[4],
  matrix[1] * value[0] + matrix[3] * value[1] + matrix[5],
]
const multiply = (left, right) => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
]
const physicalLength = (matrix, start, end) => {
  const a = point(matrix, start), b = point(matrix, end)
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

const rectangle = (name, layerId, x1, y1, x2, y2) => ({
  type: 'LWPOLYLINE',
  payload: { layerId, vertices: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], closed: true },
  options: { name },
})

test('cad.production-workflows completes an editable architectural drawing from blank document through scaled delivery', async t => {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'architecture-production-chain', title: 'Two-room architectural plan', units: 'millimeter' })
  assert.equal(drawing.revision, 0)
  assert.equal(drawing.snapshot().header.units, 'millimeter')
  assert.equal(drawing.listEntities().length, 0)
  const modelSpaceId = drawing.snapshot().spaces.modelSpaceId

  const layers = {}
  for (const [name, color, lineweight, plottable] of [
    ['A-WALL', 7, 50, true],
    ['A-ROOM', 3, 18, true],
    ['A-DOOR', 1, 25, true],
    ['A-WINDOW', 5, 25, true],
    ['A-OPENING', 2, 13, false],
  ]) {
    layers[name] = await sdk.executeCommand('LAYERNEW', { name, color, lineweight, plottable }, { document: drawing })
  }

  const walls = await sdk.executeCommand('CREATEBATCH', { entities: [
    rectangle('WALL-SOUTH-WEST', layers['A-WALL'].id, 0, 0, 1200, 200),
    rectangle('WALL-SOUTH-EAST', layers['A-WALL'].id, 2100, 0, 10000, 200),
    rectangle('WALL-NORTH-WEST', layers['A-WALL'].id, 0, 7800, 3000, 8000),
    rectangle('WALL-NORTH-EAST', layers['A-WALL'].id, 4500, 7800, 10000, 8000),
    rectangle('WALL-WEST', layers['A-WALL'].id, 0, 200, 200, 7800),
    rectangle('WALL-EAST-SOUTH', layers['A-WALL'].id, 9800, 200, 10000, 3000),
    rectangle('WALL-EAST-NORTH', layers['A-WALL'].id, 9800, 4500, 10000, 7800),
    rectangle('WALL-PARTITION-SOUTH', layers['A-WALL'].id, 4900, 200, 5100, 3300),
    rectangle('WALL-PARTITION-NORTH', layers['A-WALL'].id, 4900, 4200, 5100, 7800),
  ] }, { document: drawing })
  assert.equal(walls.every(wall => wall.ownerId === modelSpaceId && wall.payload.layerId === layers['A-WALL'].id), true)

  const rooms = await sdk.executeCommand('CREATEBATCH', { entities: [
    rectangle('ROOM-101', layers['A-ROOM'].id, 200, 200, 4900, 7800),
    rectangle('ROOM-102', layers['A-ROOM'].id, 5100, 200, 9800, 7800),
  ] }, { document: drawing })
  const [roomWidth, roomDepth] = await Promise.all([
    sdk.executeCommand('DISTANCE', { firstPoint: [200, 200], secondPoint: [4900, 200] }, { document: drawing }),
    sdk.executeCommand('DISTANCE', { firstPoint: [200, 200], secondPoint: [200, 7800] }, { document: drawing }),
  ])
  assert.equal(roomWidth.distance, 4700)
  assert.equal(roomDepth.distance, 7600)
  const roomArea = await sdk.executeCommand('AREA', { id: rooms[0].id }, { document: drawing })
  assert.equal(roomArea[0].value, 35_720_000)

  const openings = await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LINE', payload: { layerId: layers['A-OPENING'].id, start: [1200, 200], end: [2100, 200] }, options: { name: 'OPENING-DOOR-SOUTH' } },
    { type: 'LINE', payload: { layerId: layers['A-OPENING'].id, start: [4900, 3300], end: [4900, 4200] }, options: { name: 'OPENING-DOOR-PARTITION' } },
    { type: 'LINE', payload: { layerId: layers['A-OPENING'].id, start: [9800, 3000], end: [9800, 4500] }, options: { name: 'OPENING-WINDOW-EAST' } },
    { type: 'LINE', payload: { layerId: layers['A-OPENING'].id, start: [3000, 7800], end: [4500, 7800] }, options: { name: 'OPENING-WINDOW-NORTH' } },
  ] }, { document: drawing })
  const openingLengths = await sdk.executeCommand('LENGTH', { ids: openings.map(opening => opening.id) }, { document: drawing })
  assert.deepEqual(openingLengths.map(result => result.value), [900, 900, 1500, 1500])
  assert.equal(openings.every(opening => opening.ownerId === modelSpaceId && opening.payload.layerId === layers['A-OPENING'].id), true)

  const doorSource = await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LINE', payload: { layerId: layers['A-DOOR'].id, start: [0, 0], end: [900, 0] }, options: { name: 'DOOR-LEAF' } },
    { type: 'ARC', payload: { layerId: layers['A-DOOR'].id, center: [0, 0], radius: 900, startAngle: 0, endAngle: Math.PI / 2 }, options: { name: 'DOOR-SWING' } },
  ] }, { document: drawing })
  const doorDefinition = await sdk.executeCommand('BLOCKCREATE', { name: 'A-DOOR-0900', ids: doorSource.map(entity => entity.id), basePoint: [0, 0], description: 'Reusable 900 mm single door' }, { document: drawing })
  await sdk.executeCommand('PROPERTIES', { id: doorDefinition.insert.id, patch: { payload: { layerId: layers['A-DOOR'].id } } }, { document: drawing })
  await sdk.executeCommand('MOVE', { id: doorDefinition.insert.id, from: [0, 0], to: [1200, 200] }, { document: drawing })
  const internalDoor = await sdk.executeCommand('BLOCKINSERT', { name: 'A-DOOR-0900', position: [4900, 3300], rotation: Math.PI / 2, layerId: layers['A-DOOR'].id }, { document: drawing })

  const windowSource = await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LINE', payload: { layerId: layers['A-WINDOW'].id, start: [0, 0], end: [1500, 0] }, options: { name: 'WINDOW-FRAME-1' } },
    { type: 'LINE', payload: { layerId: layers['A-WINDOW'].id, start: [0, 200], end: [1500, 200] }, options: { name: 'WINDOW-FRAME-2' } },
    { type: 'LINE', payload: { layerId: layers['A-WINDOW'].id, start: [750, 0], end: [750, 200] }, options: { name: 'WINDOW-MULLION' } },
  ] }, { document: drawing })
  const windowMullionId = windowSource[2].id
  const windowDefinition = await sdk.executeCommand('BLOCKCREATE', { name: 'A-WINDOW-1500', ids: windowSource.map(entity => entity.id), basePoint: [0, 0], description: 'Reusable 1500 mm window' }, { document: drawing })
  await sdk.executeCommand('PROPERTIES', { id: windowDefinition.insert.id, patch: { payload: { layerId: layers['A-WINDOW'].id } } }, { document: drawing })

  await sdk.executeCommand('MOVE', { id: windowDefinition.insert.id, dx: 9800, dy: 3000 }, { document: drawing })
  assert.deepEqual(drawing.getObject(windowDefinition.insert.id).payload.position, [9800, 3000, 0])
  await sdk.executeCommand('UNDO', {}, { document: drawing })
  assert.deepEqual(drawing.getObject(windowDefinition.insert.id).payload.position, [0, 0, 0])
  await sdk.executeCommand('REDO', {}, { document: drawing })
  assert.deepEqual(drawing.getObject(windowDefinition.insert.id).payload.position, [9800, 3000, 0])
  await sdk.executeCommand('ROTATE', { id: windowDefinition.insert.id, center: [9800, 3000], angleDegrees: 90 }, { document: drawing })
  const northWindow = await sdk.executeCommand('BLOCKINSERT', { name: 'A-WINDOW-1500', position: [3000, 7800], rotation: 0, layerId: layers['A-WINDOW'].id }, { document: drawing })

  await sdk.executeCommand('GRIPEDIT', { id: windowMullionId, gripId: 'end', point: [750, 220] }, { document: drawing })
  assert.deepEqual(drawing.getObject(windowMullionId).payload.end, [750, 220, 0])
  await sdk.executeCommand('UNDO', {}, { document: drawing })
  assert.deepEqual(drawing.getObject(windowMullionId).payload.end, [750, 200, 0])
  await sdk.executeCommand('REDO', {}, { document: drawing })
  assert.deepEqual(drawing.getObject(windowMullionId).payload.end, [750, 220, 0])

  for (const [definition, expectedMembers, inserts] of [
    [doorDefinition.block, 2, [doorDefinition.insert, internalDoor]],
    [windowDefinition.block, 3, [windowDefinition.insert, northWindow]],
  ]) {
    const memberIds = drawing.getObject(definition.id).payload.entityIds
    assert.equal(memberIds.length, expectedMembers)
    assert.equal(memberIds.every(id => drawing.getObject(id).ownerId === definition.id), true)
    assert.equal(inserts.every(insert => drawing.getObject(insert.id).ownerId === modelSpaceId && drawing.getObject(insert.id).payload.blockRecordId === definition.id), true)
  }
  assert.equal(drawing.getObject(doorDefinition.insert.id).payload.layerId, layers['A-DOOR'].id)
  assert.equal(drawing.getObject(internalDoor.id).payload.layerId, layers['A-DOOR'].id)
  assert.equal(drawing.getObject(windowDefinition.insert.id).payload.layerId, layers['A-WINDOW'].id)
  assert.equal(drawing.getObject(northWindow.id).payload.layerId, layers['A-WINDOW'].id)

  const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'A3 ARCH 1-100', paper: { width: 420, height: 297, unit: 'mm' } }, { document: drawing })
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: {
    paperWidth: 420, paperHeight: 297, paperUnits: 1, rotation: 0, flags: 0, plotType: 5,
    marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10,
    originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
    standardScaleType: 0, printerName: '', styleSheet: '', shadeMode: 0,
  } }, { document: drawing })
  const viewport = await sdk.executeCommand('VIEWPORT', {
    layoutId: layout.id, center: [210, 148.5], width: 100, height: 80,
    viewCenter: [5000, 4000], viewHeight: 8000, frozenLayerIds: [],
  }, { document: drawing })
  assert.equal(viewport.ownerId, layout.payload.blockRecordId)
  assert.ok(drawing.getObject(layout.id).payload.viewportIds.includes(viewport.id))

  const svg = exportDrawingSvg(drawing, { layoutId: layout.id })
  assert.equal(svg.paper.widthMm, 420)
  assert.equal(svg.paper.heightMm, 297)
  assert.equal(svg.report.viewports.length, 1)
  near(svg.report.viewports[0].millimetersPerModelUnit, 0.01)
  const modelToPaper = multiply(svg.plot.drawingToPaperMatrix, svg.report.viewports[0].matrix)
  near(physicalLength(modelToPaper, [1200, 200], [2100, 200]), 9)
  near(physicalLength(modelToPaper, [3000, 7800], [4500, 7800]), 15)
  assert.match(svg.svg, /width="420mm" height="297mm"/)
  assert.match(svg.svg, new RegExp(`data-entity-id="${walls[0].id}"`))
  assert.match(svg.svg, new RegExp(`data-entity-id="${walls[1].id}"`))
  assert.doesNotMatch(svg.svg, new RegExp(`data-entity-id="${openings[0].id}"`), 'non-plot opening gauges stay out of production output')

  const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
  const reopenedKjd = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  const reopenedKjdLayout = reopenedKjd.getObject(layout.id)
  assert.equal(reopenedKjd.getObject(windowMullionId).ownerId, windowDefinition.block.id)
  assert.deepEqual(reopenedKjd.getObject(windowMullionId).payload.end, [750, 220, 0])
  assert.equal(reopenedKjd.getObject(doorDefinition.insert.id).payload.blockRecordId, doorDefinition.block.id)
  near(exportDrawingSvg(reopenedKjd, { layoutId: reopenedKjdLayout.id }).report.viewports[0].millimetersPerModelUnit, 0.01)

  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const external = independentlyInspectProductionDxf('architecture', dxf)
  if (external) {
    assert.equal(external.units, 4); assert.equal(external.doors, 2); assert.equal(external.windows, 2)
    assert.equal(external.doorMembers, 2); assert.equal(external.windowMembers, 3)
    for (const name of ['A-WALL', 'A-ROOM', 'A-DOOR', 'A-WINDOW', 'A-OPENING']) assert.ok(external.layers.includes(name))
    near(external.paper[0], 420); near(external.paper[1], 297)
    assert.equal(external.errors, 0); assert.equal(external.fixes, 0)
  } else t.diagnostic('Independent ezdxf unavailable; candidate CI must provide KJDRAW_PYTHON')
  const reopenedDxf = await createKJDrawSDK().readDocument(dxf, { format: 'DXF', version: '2018' })
  const dxfLayout = reopenedDxf.snapshot().spaces.layoutIds.map(id => reopenedDxf.getObject(id)).find(candidate => candidate.name === 'A3 ARCH 1-100')
  const dxfDoor = reopenedDxf.getTable('blockRecords').records.find(record => record.name === 'A-DOOR-0900')
  const dxfWindow = reopenedDxf.getTable('blockRecords').records.find(record => record.name === 'A-WINDOW-1500')
  assert.ok(dxfLayout && dxfDoor && dxfWindow)
  assert.equal(reopenedDxf.listEntities({ ownerId: dxfDoor.id }).length, 2)
  assert.equal(reopenedDxf.listEntities({ ownerId: dxfWindow.id }).length, 3)
  const dxfInserts = reopenedDxf.listEntities({ type: 'INSERT' })
  assert.equal(dxfInserts.filter(insert => insert.payload.blockRecordId === dxfDoor.id).length, 2)
  assert.equal(dxfInserts.filter(insert => insert.payload.blockRecordId === dxfWindow.id).length, 2)
  const dxfViewport = reopenedDxf.listEntities({ ownerId: dxfLayout.payload.blockRecordId, type: 'VIEWPORT' }).find(entity => entity.payload.viewportId !== 1)
  assert.ok(dxfViewport)
  assert.equal(reopenedDxf.getObject(dxfViewport.payload.layerId).type, 'LAYER')
  near(exportDrawingSvg(reopenedDxf, { layoutId: dxfLayout.id }).report.viewports[0].millimetersPerModelUnit, 0.01)
})
