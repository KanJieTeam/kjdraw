import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { resolveDrawingPngPlot } from '../src/drawing-image.js'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
const point = (matrix, value) => [matrix[0] * value[0] + matrix[2] * value[1] + matrix[4], matrix[1] * value[0] + matrix[3] * value[1] + matrix[5]]

async function fixture() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units:'millimeter' }), layoutId = drawing.spaces.activeLayoutId
  await sdk.executeCommand('PAGESETUP', { layoutId, dxf:{
    paperWidth:420, paperHeight:297, paperUnits:1, rotation:0, flags:0, plotType:4,
    scaleNumerator:1, scaleDenominator:2, marginLeft:10, marginRight:20, marginTop:15, marginBottom:5,
    originX:5, originY:10, printerName:'', styleSheet:'', shadeMode:0,
    windowMinX:100, windowMinY:200, windowMaxX:500, windowMaxY:400,
  } })
  return { sdk, drawing, layoutId }
}

test('configured A3 raster exposes exact source-to-pixel scale, margins and origin through KJD reopen', async () => {
  const { sdk, drawing, layoutId } = await fixture(), before = drawing.serialize()
  const plan = resolveDrawingPngPlot(drawing, { layoutId })
  assert.equal(drawing.serialize(), before)
  assert.equal(plan.width, 1400); assert.equal(plan.height, 990)
  assert.deepEqual(plan.bounds, [100,200,500,400]); assert.equal(plan.coordinateSystem, 'modelXY')
  assert.equal(plan.paper.widthMm, 420); assert.equal(plan.paper.heightMm, 297); near(plan.paper.pixelsPerMillimeter, 10 / 3)
  const matrix = plan.plot.drawingToPixelMatrix
  near(matrix[0], 5 / 3); near(matrix[3], -5 / 3); near(matrix[4], -350 / 3); near(matrix[5], 3820 / 3)
  const start = point(matrix, [100,300]), end = point(matrix, [500,300])
  near(Math.hypot(end[0]-start[0], end[1]-start[1]), 200 * 10 / 3)
  near(plan.plot.plotOriginPixels[0], 50); near(plan.plot.plotOriginPixels[1], 940)
  near(plan.plot.printableAreaPixels.minimum[0], 100 / 3); near(plan.plot.printableAreaPixels.minimum[1], 50)
  near(plan.plot.printableAreaPixels.maximum[0], 4000 / 3); near(plan.plot.printableAreaPixels.maximum[1], 2920 / 3)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format:'KJD' }), { format:'KJD' })
  assert.deepEqual(resolveDrawingPngPlot(reopened, { layoutId }), plan)
})

test('physical raster planning refuses silent scale clipping without mutating the drawing', async () => {
  const { sdk, drawing, layoutId } = await fixture()
  for (const patch of [{ windowMaxX:900 }, { originX:-1 }, { flags:32 }, { paperUnits:2 }]) {
    await sdk.executeCommand('PAGESETUP', { layoutId, dxf:patch })
    const before = drawing.serialize()
    assert.throws(() => resolveDrawingPngPlot(drawing, { layoutId }), /Drawing image:/)
    assert.equal(drawing.serialize(), before)
    await sdk.executeCommand('UNDO', {}, { document:drawing })
  }
})
