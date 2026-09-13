import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, KJValidationError } from '../src/index.js'
import { exportDrawingSvg } from '../src/svg-export.js'

function a1SiteLayout(overrides = {}) {
  return {
    id: 'site-a1-layout',
    blockRecordId: 'site-a1-paper-space',
    name: 'SITE PLAN A1',
    dxfPlotSettings: {
      paperWidth: 841, paperHeight: 594,
      marginLeft: 20, marginBottom: 35, marginRight: 20, marginTop: 15,
      originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
      flags: 0, paperUnits: 1, rotation: 0, plotType: 5,
    },
    viewport: {
      id: 'site-a1-viewport', center: [420.5, 307, 0], width: 801, height: 544,
      viewCenter: [1135, 2110, 0], viewHeight: 272, twistAngle: 0,
      modelUnits: 'meter', scaleDenominator: 500,
    },
    ...overrides,
  }
}

test('CREATEBATCH atomically creates a physical paper layout and exact-scale viewport', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'batch-physical-site', units: 'meter' })
  const initialLayoutCount = document.snapshot().spaces.layoutIds.length
  const result = await sdk.executeCommand('CREATEBATCH', {
    entities: [{ type: 'LWPOLYLINE', payload: { vertices: [[1000, 2000, 0], [1270, 2000, 0], [1270, 2220, 0], [1000, 2220, 0]], closed: true }, options: { id: 'site-boundary' } }],
    layout: a1SiteLayout(),
  }, { document })

  assert.equal(result.length, 2, 'model geometry and paper viewport commit together')
  assert.equal(document.revision, 1)
  assert.equal(document.snapshot().spaces.layoutIds.length, initialLayoutCount + 1)
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.name === 'SITE PLAN A1')
  assert.ok(layout)
  assert.deepEqual(layout.payload.paper, { width: 841, height: 594, unit: 'mm' })
  assert.equal(layout.payload.dxfPlotSettings.paperWidth, 841)
  assert.equal(layout.payload.dxfPlotSettings.scaleDenominator, 1)
  assert.deepEqual(layout.payload.viewportIds, ['site-a1-viewport'])
  const viewport = document.getObject('site-a1-viewport')
  assert.equal(viewport.ownerId, layout.payload.blockRecordId)
  assert.equal(viewport.payload.height / viewport.payload.viewHeight, 2, 'one meter occupies two paper millimeters at 1:500')
  const output = exportDrawingSvg(document, { layoutId: layout.id })
  assert.match(output.svg, /data-entity-id="site-boundary"/)
  assert.equal(output.report.diagnostics.length, 0)

  await sdk.executeCommand('UNDO', {}, { document })
  assert.equal(document.listEntities().length, 0)
  assert.equal(document.snapshot().spaces.layoutIds.length, initialLayoutCount)
  await sdk.executeCommand('REDO', {}, { document })
  assert.equal(document.getObject('site-a1-viewport')?.type, 'VIEWPORT')
  assert.equal(document.snapshot().spaces.layoutIds.length, initialLayoutCount + 1)
})

test('CREATEBATCH physical layouts survive KJD and DXF reopening with scale authority', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'batch-layout-roundtrip', units: 'meter' })
  await sdk.executeCommand('CREATEBATCH', {
    entities: [{ type: 'LINE', payload: { start: [1000, 2000, 0], end: [1200, 2200, 0] }, options: { id: 'site-diagonal' } }],
    layout: a1SiteLayout(),
  }, { document })

  for (const [format, version] of [['KJD', '1'], ['DXF', '2018']]) {
    const data = await sdk.writeDocument(document, { format, version })
    const reopened = await sdk.readDocument(data, { format, version })
    const layout = reopened.snapshot().spaces.layoutIds.map(id => reopened.getObject(id)).find(record => record?.name === 'SITE PLAN A1')
    assert.ok(layout, `${format} preserves the named paper layout`)
    assert.equal(layout.payload.dxfPlotSettings.paperWidth, 841)
    assert.equal(layout.payload.dxfPlotSettings.paperHeight, 594)
    const viewport = reopened.listEntities({ ownerId: layout.payload.blockRecordId, type: 'VIEWPORT' }).find(entity => Math.abs(entity.payload.height - 544) < 1e-9)
    assert.ok(viewport, `${format} preserves the paper viewport`)
    assert.equal(viewport.payload.height / viewport.payload.viewHeight, 2)
    const output = exportDrawingSvg(reopened, { layoutId: layout.id })
    assert.match(output.svg, /data-entity-type="LINE"/)
    assert.equal(output.report.diagnostics.length, 0)
  }
})

test('CREATEBATCH rejects misleading or unsafe physical layout declarations before commit', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'batch-layout-invalid', units: 'meter' })
  const input = layout => sdk.executeCommand('CREATEBATCH', {
    entities: [{ type: 'POINT', payload: { position: [0, 0, 0] }, options: { id: 'point' } }], layout,
  }, { document })
  const rejects = async (layout, pattern) => assert.rejects(input(layout), error => error instanceof KJValidationError && pattern.test(error.message))

  await rejects(a1SiteLayout({ surprise: true }), /fields do not match/)
  await rejects(a1SiteLayout({ dxfPlotSettings: { ...a1SiteLayout().dxfPlotSettings, plotType: 4 } }), /plot the paper layout/)
  await rejects(a1SiteLayout({ viewport: { ...a1SiteLayout().viewport, center: [10, 10, 0] } }), /fit inside the printable/)
  await rejects(a1SiteLayout({ viewport: { ...a1SiteLayout().viewport, viewHeight: 300 } }), /declared physical scale/)
  await rejects(a1SiteLayout({ viewport: { ...a1SiteLayout().viewport, modelUnits: 'millimeter' } }), /modelUnits must match/)
  await rejects(a1SiteLayout({ viewport: { ...a1SiteLayout().viewport, id: 'point' } }), /globally unique/)
  assert.equal(document.revision, 0)
  assert.equal(document.listEntities().length, 0)
  assert.equal(document.snapshot().spaces.layoutIds.some(id => document.getObject(id)?.name === 'SITE PLAN A1'), false)
})

test('explicit layout identities preserve legacy creation and reject collisions in the transaction boundary', async () => {
  const sdk = createKJDrawSDK(), legacy = sdk.createDocument({ documentId: 'legacy-layout' })
  const legacyLayout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'Legacy sheet' }, { document: legacy })
  assert.equal(legacyLayout.name, 'Legacy sheet')
  assert.ok(legacyLayout.id)
  assert.ok(legacyLayout.payload.blockRecordId)

  const duplicate = sdk.createDocument({ documentId: 'explicit-layout-duplicate' })
  await assert.rejects(duplicate.transact('duplicate identities', transaction => transaction.createLayout({ name: 'Bad', id: 'same-id', blockRecordId: 'same-id' })), /must be distinct/)
  assert.equal(duplicate.revision, 0)

  const collision = sdk.createDocument({ documentId: 'explicit-layout-collision' })
  await collision.transact('reserve id', transaction => transaction.createEntity('POINT', { position: [0, 0, 0] }, { id: 'reserved-layout-id' }))
  await assert.rejects(collision.transact('colliding layout', transaction => transaction.createLayout({ name: 'Bad', id: 'reserved-layout-id', blockRecordId: 'new-paper-id' })), /Duplicate object id/)
  assert.equal(collision.snapshot().spaces.layoutIds.some(id => collision.getObject(id)?.name === 'Bad'), false)
})
