import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { createDrawingPrintHtml } from '../src/print-export.js'

async function fixture() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' }), model = drawing.spaces.modelSpaceId
  let layout, boundary, viewport, upper, lower
  await drawing.transact('nonrectangular production viewport', tx => {
    upper = tx.createEntity('LINE', { start: [-30, 10, 0], end: [30, 10, 0], trueColor: 0x0000ff }, { ownerId: model })
    lower = tx.createEntity('LINE', { start: [-30, -10, 0], end: [30, -10, 0], trueColor: 0x00aa00 }, { ownerId: model })
    layout = tx.createLayout({ name: 'L detail sheet' })
    boundary = tx.createEntity('LWPOLYLINE', { vertices: [[30, 30, 0], [70, 30, 0], [70, 45, 0], [50, 45, 0], [50, 70, 0], [30, 70, 0]], closed: true }, { ownerId: layout.payload.blockRecordId })
    viewport = tx.createEntity('VIEWPORT', { center: [50, 50, 0], width: 40, height: 40, viewCenter: [0, 0, 0], viewHeight: 40, viewTarget: [0, 0, 0], viewDirection: [0, 0, 1], flags: 65536, clippingBoundaryId: boundary.id }, { ownerId: layout.payload.blockRecordId })
    tx.updateObject(layout.id, { payload: { viewportIds: [viewport.id] } })
  })
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 100, paperHeight: 100, paperUnits: 1, plotType: 5, flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, originX: 0, originY: 0, printerName: '', styleSheet: '', shadeMode: 0 } }, { document: drawing })
  return { sdk, drawing, layout, boundary, viewport, upper, lower }
}

function verify(output, ids) {
  assert.equal(output.report.status, 'complete')
  assert.equal(output.report.viewports.length, 1)
  assert.equal(output.report.diagnostics.length, 0)
  assert.match(output.svg, /<clipPath id="kj-viewport-\d+"[^>]*><path d="M 30 30 L 70 30 L 70 45 L 50 45 L 50 70 L 30 70(?: L 30 30)? Z"\/><\/clipPath>/)
  assert.match(output.svg, new RegExp(`data-entity-id="${ids.upper}"`))
  assert.match(output.svg, new RegExp(`data-entity-id="${ids.lower}"`))
}

test('closed polyline viewport clips editable model geometry in SVG and survives history plus KJD/DXF reopen', async () => {
  const f = await fixture(), before = f.drawing.serialize(), history = f.drawing.history
  verify(exportDrawingSvg(f.drawing, { layoutId: f.layout.id }), { upper: f.upper.id, lower: f.lower.id })
  const print = createDrawingPrintHtml(f.drawing, { layoutId: f.layout.id })
  assert.equal(print.report.status, 'complete'); assert.match(print.html, /<clipPath id="kj-viewport-\d+"/)
  assert.equal(f.drawing.serialize(), before); assert.deepEqual(f.drawing.history, history)

  await f.sdk.executeCommand('MOVE', { ids: [f.boundary.id], dx: 5, dy: 0 }, { document: f.drawing })
  assert.match(exportDrawingSvg(f.drawing, { layoutId: f.layout.id }).svg, /<path d="M 35 30 L 75 30/)
  await f.sdk.executeCommand('UNDO', {}, { document: f.drawing })
  assert.match(exportDrawingSvg(f.drawing, { layoutId: f.layout.id }).svg, /<path d="M 30 30 L 70 30/)
  await f.sdk.executeCommand('REDO', {}, { document: f.drawing })
  assert.match(exportDrawingSvg(f.drawing, { layoutId: f.layout.id }).svg, /<path d="M 35 30 L 75 30/)
  await f.sdk.executeCommand('UNDO', {}, { document: f.drawing })

  for (const format of ['KJD', 'DXF']) {
    const artifact = await f.sdk.writeDocument(f.drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await createKJDrawSDK().readDocument(artifact, { format })
    const layout = reopened.listObjects({ kind: 'layout' }).find(item => item.name === 'L detail sheet')
    const viewport = reopened.listEntities({ ownerId: layout.payload.blockRecordId, type: 'VIEWPORT' }).find(item => item.payload.viewportId !== 1)
    assert.equal(reopened.getObject(viewport.payload.clippingBoundaryId).type, 'LWPOLYLINE')
    verify(exportDrawingSvg(reopened, { layoutId: layout.id }), { upper: reopened.listEntities({ type: 'LINE' })[0].id, lower: reopened.listEntities({ type: 'LINE' })[1].id })
  }
})

test('unsupported, open, degenerate and cross-space viewport clips fail closed without exposing model content', async () => {
  for (const mode of ['circle', 'open', 'degenerate', 'cross-space']) {
    const f = await fixture(), ownerId = mode === 'cross-space' ? f.drawing.spaces.modelSpaceId : f.layout.payload.blockRecordId
    let replacement
    await f.drawing.transact(`invalid ${mode} clip`, tx => {
      replacement = mode === 'circle'
        ? tx.createEntity('CIRCLE', { center: [50, 50, 0], radius: 15 }, { ownerId })
        : tx.createEntity('LWPOLYLINE', { vertices: mode === 'degenerate' ? [[10, 10, 0], [20, 20, 0], [30, 30, 0]] : [[30, 30, 0], [70, 30, 0], [50, 70, 0]], closed: mode !== 'open' }, { ownerId })
      tx.updateObject(f.viewport.id, { payload: { clippingBoundaryId: replacement.id, flags: 65536 } })
    })
    const before = f.drawing.serialize()
    assert.throws(() => exportDrawingSvg(f.drawing, { layoutId: f.layout.id }), /visible geometry could not be represented/, mode)
    const partial = exportDrawingSvg(f.drawing, { layoutId: f.layout.id, allowPartial: true })
    assert.equal(partial.report.viewports.length, 0)
    assert.equal(partial.report.diagnostics[0].entityId, f.viewport.id)
    assert.doesNotMatch(partial.svg, new RegExp(`data-entity-id="${f.upper.id}"`))
    assert.equal(f.drawing.serialize(), before)
  }
})
