import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { multiply3, transformPoint3 } from '../src/geometry/matrix3.js'

const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

async function mechanicalA3Fixture() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'a3-mechanical-plot', units: 'millimeter' })
  const modelId = drawing.snapshot().spaces.modelSpaceId
  const shaft = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [200, 0, 0], trueColor: 0xff0000 }, options: { ownerId: modelId } })
  await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [[0, -20], [200, -20], [200, 20], [0, 20]], closed: true }, options: { ownerId: modelId } })
  const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'A3 mechanical shaft 1:2' })
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: {
    paperWidth: 420, paperHeight: 297, paperUnits: 1,
    marginLeft: 10, marginRight: 15, marginTop: 12, marginBottom: 8,
    originX: 5, originY: 7, scaleNumerator: 1, scaleDenominator: 1,
    plotType: 5, rotation: 0, flags: 0,
  } })
  const viewport = await sdk.executeCommand('VIEWPORT', { layoutId: layout.id, center: [160, 120], width: 180, height: 120, viewCenter: [100, 0], viewHeight: 240 })
  await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [[20, 20], [400, 20], [400, 277], [20, 277]], closed: true }, options: { ownerId: layout.payload.blockRecordId } })
  return { sdk, drawing, layoutId: layout.id, shaftId: shaft.id, viewportId: viewport.id }
}

function projectedModelLength(output, viewportId, start, end) {
  const viewport = output.report.viewports.find(row => row.entityId === viewportId)
  assert.ok(viewport, 'viewport must be represented in the physical plot report')
  const matrix = multiply3(output.plot.drawingToPaperMatrix, viewport.matrix)
  return distance(transformPoint3(matrix, start), transformPoint3(matrix, end))
}

test('A3 mechanical layout exposes an independently measurable physical plot and survives KJD reopen', async () => {
  const { sdk, drawing, layoutId, viewportId } = await mechanicalA3Fixture()
  const before = drawing.serialize(), output = exportDrawingSvg(drawing, { layoutId })
  assert.equal(drawing.serialize(), before)
  assert.deepEqual(output.paper, { widthMm: 420, heightMm: 297, millimetersPerDrawingUnit: 1 })
  assert.deepEqual(output.plot, {
    printableAreaMm: { minimum: [10, 8], maximum: [405, 285], width: 395, height: 277 },
    plotOriginMm: [15, 15],
    sourceRange: { kind: 'layout', minimum: [-5, -7], maximum: [390, 270] },
    drawingToPaperMatrix: [1, 0, 0, -1, 15, 282],
  })
  assert.equal(projectedModelLength(output, viewportId, [0, 0], [200, 0]), 100)
  assert.equal(output.report.viewports[0].millimetersPerModelUnit, .5)

  const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
  const reopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD', documentId: 'a3-mechanical-reopened' })
  const reopenedOutput = exportDrawingSvg(reopened, { layoutId })
  assert.deepEqual(reopenedOutput.paper, output.paper)
  assert.deepEqual(reopenedOutput.plot, output.plot)
  assert.equal(projectedModelLength(reopenedOutput, viewportId, [0, 0], [200, 0]), 100)
})

test('explicit model windows refuse clipping at their physical scale and origin', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' }), layoutId = drawing.snapshot().spaces.layoutIds[0]
  const setup = patch => sdk.executeCommand('PAGESETUP', { layoutId, dxf: {
    paperWidth: 420, paperHeight: 297, paperUnits: 1,
    marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10,
    originX: 0, originY: 0, scaleNumerator: 1, scaleDenominator: 1,
    plotType: 4, rotation: 0, flags: 0,
    windowMinX: 0, windowMinY: 0, windowMaxX: 400, windowMaxY: 277,
    ...patch,
  } })
  await setup({})
  const exact = exportDrawingSvg(drawing, { layoutId })
  assert.deepEqual(exact.plot.sourceRange, { kind: 'window', minimum: [0, 0], maximum: [400, 277] })
  assert.deepEqual(exact.plot.drawingToPaperMatrix, [1, 0, 0, -1, 10, 287])

  const beforeOversize = structuredClone(drawing.getObject(layoutId).payload.dxfPlotSettings)
  await setup({ windowMaxX: 400.001 })
  const invalidState = drawing.serialize()
  assert.throws(() => exportDrawingSvg(drawing, { layoutId }), /does not fit the printable area/)
  assert.equal(drawing.serialize(), invalidState)
  assert.equal(drawing.getObject(layoutId).payload.dxfPlotSettings.windowMaxX, 400.001)
  await sdk.executeCommand('UNDO', {}, { document: drawing })
  assert.deepEqual(drawing.getObject(layoutId).payload.dxfPlotSettings, beforeOversize)

  await setup({ originX: -0.001 })
  assert.throws(() => exportDrawingSvg(drawing, { layoutId }), /does not fit the printable area/)
})
