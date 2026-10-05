import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, KJDocument, KJValidationError } from '../src/index.js'
import {
  KJDRAW_ARCHITECTURE_PLAN_VERSION,
  buildAgentArchitecturePlan,
} from '../src/agent-architecture-plan.js'
import { exportDrawingSvg } from '../src/svg-export.js'

function practicalInput(overrides = {}) {
  return {
    version: KJDRAW_ARCHITECTURE_PLAN_VERSION,
    expectedRevision: 0,
    units: 'millimeter',
    drawingId: 'ARCH-A3-101',
    title: 'TWO ROOM OFFICE PLAN',
    width: 10_000,
    depth: 8_000,
    wallThickness: 200,
    exteriorOpenings: [
      { wall: 'south', offset: 1_200, width: 900, kind: 'door' },
      { wall: 'north', offset: 3_000, width: 1_500, kind: 'window' },
      { wall: 'east', offset: 3_000, width: 1_500, kind: 'window' },
    ],
    partitions: [
      { id: 'P1', axis: 'vertical', position: 5_000, start: 200, end: 7_800, openings: [{ offset: 3_100, width: 900, kind: 'door' }] },
    ],
    rooms: [
      { id: 'R101', name: 'MEETING', bounds: [200, 200, 4_700, 7_600] },
      { id: 'R102', name: 'STUDIO', bounds: [5_100, 200, 4_700, 7_600] },
    ],
    textHeight: 250,
    ...overrides,
  }
}

function polylineBounds(entity) {
  const points = entity.payload.vertices.map(vertex => Array.isArray(vertex) ? vertex : vertex.point)
  return {
    minX: Math.min(...points.map(point => point[0])),
    minY: Math.min(...points.map(point => point[1])),
    maxX: Math.max(...points.map(point => point[0])),
    maxY: Math.max(...points.map(point => point[1])),
  }
}

test('architecture compiler deterministically emits bounded native walls, reusable openings, rooms, dimensions and A3 frame', () => {
  const document = KJDocument.create({ documentId: 'architecture-compile', units: 'millimeter' })
  const first = buildAgentArchitecturePlan(document, practicalInput())
  const second = buildAgentArchitecturePlan(document, practicalInput())

  assert.deepEqual(first, second)
  assert.equal(first.evidence.skillVersion, '1.0.0')
  assert.equal(first.evidence.parameters.partitionCount, 1)
  assert.equal(first.evidence.parameters.openingCount, 4)
  assert.equal(first.evidence.parameters.roomCount, 2)
  assert.deepEqual(first.evidence.parameters.roomAreasSquareMeters, { R101: 35.72, R102: 35.72 })
  assert.equal(first.evidence.parameters.sheet.paper, 'A3')
  assert.equal(first.evidence.parameters.sheet.scale, '1:100')
  assert.match(first.evidence.parameters.sheet.layoutName, /^KJ_ARCH_[A-F0-9]+_A3$/)
  assert.deepEqual(first.evidence.parameters.sheet.modelFrame, { origin: [-3_000, -4_500], size: [42_000, 29_700] })
  assert.deepEqual(first.evidence.validation, {
    blankDocument: true, wallBounds: true, openingBounds: true, openingSeparation: true,
    roomBounds: true, roomOverlap: false, roomPartitionIntersections: false,
  })

  assert.deepEqual(Object.keys(first.commandArgs.resources), ['linetypes', 'layers', 'blocks'])
  assert.equal(first.commandArgs.resources.blocks.length, 2)
  const door = first.commandArgs.resources.blocks.find(block => block.name === 'KJ_ARCH_DOOR_900')
  const window = first.commandArgs.resources.blocks.find(block => block.name === 'KJ_ARCH_WINDOW_1500')
  assert.ok(door && window)
  assert.equal(door.entities.length, 2)
  assert.deepEqual(door.entities.map(entity => entity.type), ['LINE', 'ARC'])
  assert.equal(window.entities.length, 3)
  assert.deepEqual(window.entities.map(entity => entity.type), ['LINE', 'LINE', 'LINE'])
  const inserts = first.commandArgs.entities.filter(entity => entity.type === 'INSERT')
  assert.equal(inserts.length, 4)
  assert.equal(inserts.filter(entity => entity.payload.blockRecordId === door.id).length, 2)
  assert.equal(inserts.filter(entity => entity.payload.blockRecordId === window.id).length, 2)
  assert.ok(inserts.every(entity => first.commandArgs.resources.blocks.some(block => block.id === entity.payload.blockRecordId)))
  assert.equal(new Set([
    ...first.commandArgs.entities.map(entity => entity.options.id),
    ...first.commandArgs.resources.blocks.flatMap(block => block.entities.map(entity => entity.options.id)),
  ]).size, first.evidence.entityCount - 1)

  const layerByName = Object.fromEntries(first.commandArgs.resources.layers.map(layer => [layer.name, layer.id]))
  const walls = first.commandArgs.entities.filter(entity => entity.type === 'LWPOLYLINE' && entity.payload.layerId === layerByName['A-WALL'])
  assert.equal(walls.length, 9)
  const bounds = walls.map(polylineBounds)
  assert.ok(bounds.some(box => box.minX === 0 && box.maxX === 1_200 && box.minY === 0 && box.maxY === 200))
  assert.ok(bounds.some(box => box.minX === 2_100 && box.maxX === 10_000 && box.minY === 0 && box.maxY === 200))
  assert.ok(bounds.some(box => box.minX === 4_900 && box.maxX === 5_100 && box.minY === 200 && box.maxY === 3_300))
  assert.ok(bounds.some(box => box.minX === 4_900 && box.maxX === 5_100 && box.minY === 4_200 && box.maxY === 7_800))
  assert.equal(first.commandArgs.entities.filter(entity => entity.type === 'DIMENSION').length, 2)
  assert.equal(first.commandArgs.entities.filter(entity => entity.type === 'TEXT' && /m2$/.test(entity.payload.text)).length, 2)
  assert.ok(first.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text === 'SCALE 1:100 / mm'))
  assert.equal(first.evidence.entityCount, first.evidence.modelEntityCount + first.evidence.blockMemberCount + 1)
  assert.equal(first.commandArgs.layout.viewport.height / first.commandArgs.layout.viewport.viewHeight, 0.01)
  assert.equal(first.commandArgs.layout.viewport.scaleDenominator, 100)
  assert.ok(first.evidence.entityCount <= 512)
})

test('architecture plan localizes generated sheet labels for Chinese requests', () => {
  const document = KJDocument.create({ documentId: 'architecture-zh', units: 'millimeter' })
  const input = practicalInput({ locale: 'zh-CN', title: '办公室建筑平面图', rooms: [
    { id: 'R101', name: '会议室', bounds: [200, 200, 4_700, 7_600] },
    { id: 'R102', name: '工作室', bounds: [5_100, 200, 4_700, 7_600] },
  ] })
  const texts = buildAgentArchitecturePlan(document, input).commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['图号 ARCH-A3-101', '比例 1:100 / mm', '35.72 m²']) assert.ok(texts.includes(expected), expected)
  assert.ok(!texts.some(value => /DRAWING|SCALE/u.test(value)))
})

test('architecture plan commits atomically and retains native blocks through undo, redo, KJD and DXF reopening', async () => {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({documentId:'architecture-roundtrip',units:'millimeter'})
  const initialLayoutCount=document.snapshot().spaces.layoutIds.length
  const compiled=buildAgentArchitecturePlan(document,practicalInput())
  const created=await sdk.executeCommand('CREATEBATCH',compiled.commandArgs,{document})
  assert.equal(created.length,compiled.evidence.entityCount)
  assert.equal(document.revision,1)
  assert.equal(document.listEntities({type:'INSERT'}).length,4)
  assert.equal(document.getTable('blockRecords').records.filter(record=>record.name.startsWith('KJ_ARCH_')).length,2)
  let layout=document.snapshot().spaces.layoutIds.map(id=>document.getObject(id)).find(record=>record?.name===compiled.commandArgs.layout.name)
  assert.ok(layout)
  assert.equal(layout.payload.dxfPlotSettings.paperWidth,420)
  assert.equal(layout.payload.dxfPlotSettings.paperHeight,297)
  assert.equal(exportDrawingSvg(document,{layoutId:layout.id}).report.diagnostics.length,0)
  await sdk.executeCommand('UNDO',{}, {document})
  assert.equal(document.listEntities().length,0)
  assert.equal(document.getTable('blockRecords').records.some(record=>record.name.startsWith('KJ_ARCH_')),false)
  assert.equal(document.snapshot().spaces.layoutIds.length,initialLayoutCount)
  await sdk.executeCommand('REDO',{}, {document})
  for(const format of ['KJD','DXF']){
    const reopened=await sdk.readDocument(await sdk.writeDocument(document,{format}),{format})
    assert.equal(reopened.listEntities({type:'INSERT'}).length,4)
    const blocks=reopened.getTable('blockRecords').records.filter(record=>record.name.startsWith('KJ_ARCH_'))
    assert.equal(blocks.length,2)
    assert.deepEqual(blocks.map(block=>block.payload.entityIds.length).sort((a,b)=>a-b),[2,3])
    layout=reopened.snapshot().spaces.layoutIds.map(id=>reopened.getObject(id)).find(record=>record?.name===compiled.commandArgs.layout.name)
    assert.ok(layout)
    const viewport=reopened.listEntities({ownerId:layout.payload.blockRecordId,type:'VIEWPORT'})[0]
    assert.ok(viewport)
    assert.ok(Math.abs(viewport.payload.height/viewport.payload.viewHeight-0.01)<1e-12)
    assert.equal(exportDrawingSvg(reopened,{layoutId:layout.id}).report.diagnostics.length,0)
    assert.equal(reopened.listEntities({type:'PROXY_ENTITY'}).length,0)
  }
})

test('architecture compiler rejects stale, nonblank, malformed and geometrically invalid plans before proposal', async () => {
  const document = KJDocument.create({ documentId: 'architecture-invalid', units: 'millimeter' })
  const rejects = (patch, pattern) => assert.throws(
    () => buildAgentArchitecturePlan(document, practicalInput(patch)),
    error => error instanceof KJValidationError && pattern.test(error.message),
  )

  rejects({ version: '2.0.0' }, /version/)
  rejects({ expectedRevision: 1 }, /does not match document revision/)
  rejects({ units: 'inch' }, /units/)
  rejects({ surprise: true }, /unsupported field/)
  rejects({ wallThickness: 2_000 }, /wallThickness/)
  rejects({ exteriorOpenings: [{ wall: 'south', offset: 100, width: 900, kind: 'door' }] }, /leave wall material/)
  rejects({ exteriorOpenings: [
    { wall: 'south', offset: 1_000, width: 900, kind: 'door' },
    { wall: 'south', offset: 1_800, width: 1_500, kind: 'window' },
  ] }, /overlap or leave insufficient/)
  rejects({ partitions: [{ id: 'P1', axis: 'diagonal', position: 4_000, start: 200, end: 7_800 }] }, /axis/)
  rejects({ partitions: [
    { id: 'P1', axis: 'vertical', position: 5_000, start: 200, end: 7_800 },
    { id: 'p1', axis: 'horizontal', position: 4_000, start: 200, end: 9_800 },
  ] }, /duplicate id/)
  rejects({ rooms: [{ id: 'R1', name: 'OUTSIDE', bounds: [0, 200, 1_000, 1_000] }] }, /inner wall boundary/)
  rejects({ rooms: [
    { id: 'R1', name: 'ONE', bounds: [200, 200, 4_000, 4_000] },
    { id: 'R2', name: 'TWO', bounds: [3_000, 3_000, 4_000, 4_000] },
  ] }, /overlap/)
  rejects({ rooms: [{ id: 'R1', name: 'CROSSES PARTITION', bounds: [4_800, 200, 1_000, 2_000] }] }, /solid partition/)

  const manyOpenings = Array.from({ length: 17 }, (_, index) => ({
    wall: 'north', offset: 300 + index * 1_000, width: 600 + index, kind: 'door',
  }))
  rejects({ width: 34_000, exteriorOpenings: manyOpenings, partitions: [], rooms: [{ id: 'R1', name: 'OPEN', bounds: [200, 200, 30_000, 7_600] }] }, /block definitions; maximum is 16/)

  const nonblank = KJDocument.create({ documentId: 'architecture-nonblank', units: 'millimeter' })
  await nonblank.transact('seed', transaction => transaction.createEntity('LINE', { start: [0, 0], end: [1, 1] }))
  assert.throws(() => buildAgentArchitecturePlan(nonblank, practicalInput({ expectedRevision: 1 })), /blank document/)

  const inch = KJDocument.create({ documentId: 'architecture-inch', units: 'inch' })
  assert.throws(() => buildAgentArchitecturePlan(inch, practicalInput()), /millimeter document/)
})
