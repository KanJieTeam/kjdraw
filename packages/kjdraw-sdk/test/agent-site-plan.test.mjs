import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, KJDocument, KJValidationError } from '../src/index.js'
import { KJDRAW_SITE_PLAN_VERSION, buildAgentSitePlan } from '../src/agent-site-plan.js'
import { exportDrawingSvg } from '../src/svg-export.js'

function practicalInput(overrides = {}) {
  return {
    version: KJDRAW_SITE_PLAN_VERSION,
    expectedRevision: 0,
    units: 'meter',
    drawingId: 'SITE-GENERAL-001',
    title: 'MIXED-USE CAMPUS GENERAL SITE PLAN',
    revision: 'C3',
    boundary: [[1000, 2000], [1260, 2000], [1270, 2120], [1220, 2220], [1000, 2200]],
    roads: [
      { name: 'MAIN ACCESS ROAD', width: 8, centerline: [[990, 2020], [1080, 2020], [1160, 2060], [1280, 2060]] },
      { name: 'SERVICE ROAD', width: 6, centerline: [[1110, 1990], [1110, 2140], [1220, 2180]] },
    ],
    buildings: [
      { name: 'ADMINISTRATION', floors: 4, footprint: [[1025, 2040], [1080, 2040], [1080, 2080], [1025, 2080]] },
      { name: 'WORKSHOP', floors: 2, footprint: [[1140, 2080], [1230, 2080], [1230, 2140], [1140, 2140]] },
      { name: 'WAREHOUSE', footprint: [[1035, 2120], [1125, 2120], [1125, 2180], [1035, 2180]] },
    ],
    utilities: [
      { kind: 'water', name: 'DOMESTIC WATER', diameterMm: 200, path: [[1005, 2028], [1090, 2028], [1170, 2070], [1240, 2070]], nodeIndices: [0, 1, 2, 3] },
      { kind: 'drainage', name: 'STORM DRAIN', diameterMm: 600, path: [[1010, 2190], [1080, 2160], [1160, 2160], [1250, 2120]], nodeIndices: [0, 1, 2, 3] },
      { kind: 'power', name: '11kV POWER', path: [[1005, 2010], [1100, 2010], [1180, 2050]], nodeIndices: [0, 2] },
    ],
    coordinateReference: { position: [1010, 2010], easting: 385000.125, northing: 3452000.75, crs: 'EPSG:32650' },
    northAngleDegrees: -8,
    scale: 500,
    ...overrides,
  }
}

test('site plan compiler deterministically expands compact intent into useful native CAD geometry', () => {
  const document = KJDocument.create({ documentId: 'site-plan-deterministic', units: 'meter' })
  const first = buildAgentSitePlan(document, practicalInput())
  const second = buildAgentSitePlan(document, practicalInput())

  assert.deepEqual(first, second)
  assert.equal(first.evidence.skillId, 'site-plan')
  assert.equal(first.evidence.skillVersion, '1.0.0')
  assert.equal(first.evidence.units, 'meter')
  assert.equal(first.evidence.expectedRevision, 0)
  assert.equal(first.evidence.roadCount, 2)
  assert.equal(first.evidence.buildingCount, 3)
  assert.equal(first.evidence.utilityCount, 3)
  assert.equal(first.evidence.utilityNodeCount, 10)
  assert.ok(first.evidence.siteAreaSquareMeters > 50_000)
  assert.ok(first.evidence.roadCenterlineMeters > 500)
  assert.ok(first.evidence.utilityMeters > 600)
  assert.equal(first.evidence.modelEntityCount, first.commandArgs.entities.length)
  assert.equal(first.evidence.entityCount, first.commandArgs.entities.length + 1)
  assert.ok(first.evidence.entityCount < 100, 'compact intent should remain far smaller than an entity-by-entity model response')
  assert.ok(JSON.stringify(practicalInput()).length < 2_000, 'practical multi-discipline intent stays within a small model response')
  assert.ok(JSON.stringify(first.commandArgs).length > JSON.stringify(practicalInput()).length * 5, 'local compiler performs the high-volume geometry expansion')
  assert.equal(new Set(first.commandArgs.entities.map(entity => entity.options.id)).size, first.evidence.modelEntityCount)

  const layerNames = new Set(first.commandArgs.resources.layers.map(layer => layer.name))
  for (const name of ['SITE_BOUNDARY', 'ROAD_EDGE', 'ROAD_CENTER', 'BUILDING', 'WATER', 'DRAINAGE', 'POWER', 'UTILITY_NODE', 'ANNOTATION', 'DIMENSIONS']) assert.ok(layerNames.has(name), `missing ${name}`)
  assert.equal(first.commandArgs.entities.filter(entity => entity.type === 'DIMENSION').length, 2)
  assert.equal(first.commandArgs.entities.filter(entity => entity.type === 'CIRCLE').length, 10)
  assert.equal(first.commandArgs.entities.filter(entity => entity.type === 'LWPOLYLINE' && entity.payload.closed).length, 5)
  assert.ok(first.commandArgs.entities.some(entity => entity.type === 'TEXT' && /SCALE 1:500/.test(entity.payload.text)))
  assert.ok(first.commandArgs.entities.some(entity => entity.type === 'TEXT' && /EPSG:32650/.test(entity.payload.text)))
  assert.deepEqual(first.outputConfig.paper, {
    standard: 'ISO A1', orientation: 'landscape', widthMm: 841, heightMm: 594,
    marginsMm: { left: 20, right: 20, top: 15, bottom: 35 },
  })
  assert.equal(first.outputConfig.scaleDenominator, 500)
  assert.ok(first.outputConfig.viewport.width <= 400.5)
  assert.ok(first.outputConfig.viewport.height <= 272)
  assert.equal(first.commandArgs.layout.viewport.height / first.commandArgs.layout.viewport.viewHeight, 2)
  assert.equal(first.commandArgs.layout.viewport.modelUnits, 'meter')
})

test('site plan localizes compiler-generated annotations for Chinese requests', () => {
  const document = KJDocument.create({ documentId: 'site-plan-zh', units: 'meter' })
  const compiled = buildAgentSitePlan(document, practicalInput({ locale: 'zh-CN', title: '园区总平面图' }))
  const texts = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['图号 SITE-GENERAL-001', '版本 C3', '比例 1:500', '用地面积', '东坐标=', '北坐标=', '北']) assert.ok(texts.some(value => value.includes(expected)), expected)
  assert.ok(!texts.some(value => /DRAWING|REV |SCALE 1:500|SITE AREA/u.test(value)))
})

test('site plan compiles to one atomic CREATEBATCH and survives undo, redo, KJD and DXF reopening', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'site-plan-roundtrip', units: 'meter' })
  const compiled = buildAgentSitePlan(document, practicalInput())

  const result = await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  assert.equal(result.length, compiled.evidence.entityCount)
  assert.equal(document.revision, 1)
  assert.equal(document.listEntities().length, compiled.evidence.entityCount)
  assert.equal(document.getTable('layers').records.some(layer => layer.name === 'SITE_BOUNDARY'), true)
  assert.equal(document.listEntities({ type: 'DIMENSION' }).length, 2)
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.name === compiled.commandArgs.layout.name)
  assert.ok(layout)
  assert.equal(layout.payload.dxfPlotSettings.paperWidth, 841)
  assert.equal(layout.payload.dxfPlotSettings.paperHeight, 594)
  assert.equal(document.listEntities({ ownerId: layout.payload.blockRecordId, type: 'VIEWPORT' }).length, 1)
  assert.equal(exportDrawingSvg(document, { layoutId: layout.id }).report.diagnostics.length, 0)

  await sdk.executeCommand('UNDO', {}, { document })
  assert.equal(document.listEntities().length, 0)
  assert.equal(document.getTable('layers').records.some(layer => layer.name === 'SITE_BOUNDARY'), false)
  await sdk.executeCommand('REDO', {}, { document })
  assert.equal(document.listEntities().length, compiled.evidence.entityCount)

  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
  assert.equal(reopenedKjd.snapshot().header.units, 'meter')
  assert.equal(reopenedKjd.listEntities().length, compiled.evidence.entityCount)
  assert.deepEqual(reopenedKjd.listEntities().map(entity => entity.id), document.listEntities().map(entity => entity.id))

  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  const modelSpaceId = reopenedDxf.snapshot().spaces.modelSpaceId
  assert.equal(reopenedDxf.snapshot().header.units, 'meter')
  assert.equal(reopenedDxf.listEntities({ ownerId: modelSpaceId }).length, compiled.evidence.modelEntityCount)
  assert.equal(reopenedDxf.listEntities({ ownerId: modelSpaceId, type: 'DIMENSION' }).length, 2)
  const dxfLayout = reopenedDxf.snapshot().spaces.layoutIds.map(id => reopenedDxf.getObject(id)).find(record => record?.name === compiled.commandArgs.layout.name)
  assert.ok(dxfLayout)
  assert.equal(dxfLayout.payload.dxfPlotSettings.paperWidth, 841)
  const dxfViewport = reopenedDxf.listEntities({ ownerId: dxfLayout.payload.blockRecordId, type: 'VIEWPORT' })[0]
  assert.ok(dxfViewport)
  assert.equal(dxfViewport.payload.height / dxfViewport.payload.viewHeight, 2)
  assert.equal(reopenedDxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
})

test('site plan compiler rejects stale, non-meter, non-blank and unsafe geometry', async () => {
  const document = KJDocument.create({ documentId: 'site-plan-invalid', units: 'meter' })
  const rejects = (patch, pattern) => assert.throws(
    () => buildAgentSitePlan(document, practicalInput(patch)),
    error => error instanceof KJValidationError && pattern.test(error.message),
  )

  rejects({ version: '2.0.0' }, /version/)
  rejects({ expectedRevision: 1 }, /does not match document revision/)
  rejects({ units: 'millimeter' }, /units/)
  rejects({ scale: 1000 }, /scale must be 500/)
  rejects({ surprise: true }, /unsupported field/)
  rejects({ boundary: [[0, 0], [10, 10], [0, 10], [10, 0]] }, /self-intersect|enclose/)
  rejects({ buildings: [{ name: 'OUTSIDE', footprint: [[900, 1900], [910, 1900], [910, 1910], [900, 1910]] }] }, /inside the site boundary/)
  rejects({ roads: [{ name: 'REVERSAL', width: 6, centerline: [[1000, 2000], [1100, 2000], [1000, 2000]] }] }, /180-degree reversal/)
  rejects({ roads: [{ name: 'REMOTE', width: 6, centerline: [[0, 0], [100, 0]] }] }, /exceeds the A1 viewport/)
  rejects({ utilities: practicalInput().utilities.filter(utility => utility.kind !== 'water') }, /include water and drainage/)
  rejects({ utilities: [{ ...practicalInput().utilities[0], nodeIndices: [0, 0] }, practicalInput().utilities[1]] }, /must be unique/)
  rejects({ coordinateReference: { ...practicalInput().coordinateReference, position: [0, 0] } }, /must lie inside/)
  rejects({ boundary: [[0, 0], [500, 0], [500, 200], [0, 200]], coordinateReference: { ...practicalInput().coordinateReference, position: [10, 10] }, buildings: [{ name: 'B', footprint: [[10, 10], [20, 10], [20, 20], [10, 20]] }] }, /does not fit ISO A1/)

  const millimeterDocument = KJDocument.create({ documentId: 'site-plan-mm', units: 'millimeter' })
  assert.throws(() => buildAgentSitePlan(millimeterDocument, practicalInput()), /meter document/)

  const sdk = createKJDrawSDK(), nonBlank = sdk.createDocument({ documentId: 'site-plan-existing', units: 'meter' })
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [0, 0] } }, { document: nonBlank })
  assert.throws(() => buildAgentSitePlan(nonBlank, practicalInput({ expectedRevision: 1 })), /requires a blank document/)
})
