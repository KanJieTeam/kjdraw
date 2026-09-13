import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { resolveDrawingPngPlot } from '../src/drawing-image.js'
import { resolvePlotScale } from '../src/plot-settings.js'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

async function fixture(settings = {}) {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units:'millimeter' })
  const layoutId = drawing.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PAGESETUP', { layoutId, dxf:{
    paperWidth:210, paperHeight:100, paperUnits:1, rotation:0, flags:20, plotType:4,
    marginLeft:10, marginRight:10, marginTop:10, marginBottom:10,
    originX:0, originY:0, windowMinX:100, windowMinY:200, windowMaxX:200, windowMaxY:250,
    scaleNumerator:1, scaleDenominator:1, standardScaleType:0, printerName:'', styleSheet:'', shadeMode:0,
    ...settings,
  } })
  await sdk.executeCommand('CREATE', { type:'LINE', payload:{ start:[100,200], end:[200,200] } }, { document:drawing })
  return { sdk, drawing, layoutId }
}

test('DXF fit scale centers an explicit model window identically in SVG, PNG and KJD reopen', async () => {
  const { sdk, drawing, layoutId } = await fixture(), before = drawing.serialize()
  const svg = exportDrawingSvg(drawing, { layoutId }), png = resolveDrawingPngPlot(drawing, { layoutId })
  near(svg.paper.millimetersPerDrawingUnit, 1.6)
  assert.deepEqual(svg.plot.plotOriginMm, [25,10])
  assert.deepEqual(svg.plot.sourceRange, { kind:'window', minimum:[100,200], maximum:[200,250] })
  near(svg.plot.drawingToPaperMatrix[0], 1.6); near(svg.plot.drawingToPaperMatrix[4], -135); near(svg.plot.drawingToPaperMatrix[5], 410)
  const px = png.paper.pixelsPerMillimeter
  near(png.plot.drawingToPixelMatrix[0], 1.6 * px)
  near(png.plot.plotOriginPixels[0], png.paper.rasterAreaPixels.minimum[0] + 25 * px)
  near(png.plot.plotOriginPixels[1], png.paper.rasterAreaPixels.minimum[1] + 90 * px)
  assert.equal(drawing.serialize(), before)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format:'KJD' }), { format:'KJD' })
  assert.deepEqual(resolveDrawingPngPlot(reopened, { layoutId }), png)
})

test('DXF fixed standard scales resolve official ratios and preserve native flags', async t => {
  const imperial = resolvePlotScale({ flags:16, standardScaleType:12, paperUnits:0 }, { printableWidth:100, printableHeight:100, isModel:true })
  near(imperial.millimetersPerDrawingUnit, 25.4 / 12)
  const { sdk, drawing, layoutId } = await fixture({ flags:16 | 1024, standardScaleType:26, originX:5, originY:7 })
  const svg = exportDrawingSvg(drawing, { layoutId }), png = resolveDrawingPngPlot(drawing, { layoutId })
  near(svg.paper.millimetersPerDrawingUnit, .01)
  assert.deepEqual(svg.plot.plotOriginMm, [15,17]); near(png.plot.drawingToPixelMatrix[0], .01 * png.paper.pixelsPerMillimeter)
  await sdk.executeCommand('PAGESETUP', { layoutId, dxf:{ standardScaleType:17 } })
  near(exportDrawingSvg(drawing, { layoutId }).paper.millimetersPerDrawingUnit, .5)
  await sdk.executeCommand('UNDO', {}, { document:drawing }); near(exportDrawingSvg(drawing, { layoutId }).paper.millimetersPerDrawingUnit, .01)
  await sdk.executeCommand('REDO', {}, { document:drawing }); near(exportDrawingSvg(drawing, { layoutId }).paper.millimetersPerDrawingUnit, .5)
  const dxf = await sdk.writeDocument(drawing, { format:'DXF', version:'2018' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format:'DXF' })
  const reopenedModel = reopened.getObject(reopened.snapshot().spaces.layoutIds[0])
  assert.equal(reopenedModel.payload.dxfPlotSettings.flags, 1040)
  assert.equal(reopenedModel.payload.dxfPlotSettings.standardScaleType, 17)
  const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
d=ezdxf.read(io.StringIO(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read())); a=d.audit(); m=d.layouts.get('Model').dxf_layout.dxf
print(json.dumps({'flags':m.plot_layout_flags,'scale':m.standard_scale_type,'errors':len(a.errors),'fixes':len(a.fixes)}))
`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding:'utf8', timeout:30000, env:{ ...process.env, PYTHONIOENCODING:'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(result.stderr)) { if (process.env.KJDRAW_REQUIRE_DXF_INTEGRATION === '1') assert.fail(result.stderr || result.error.message); t.skip('ezdxf required'); return }
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.deepEqual(JSON.parse(result.stdout), { flags:1040, scale:17, errors:0, fixes:0 })
})

test('fit, centered and unsupported flag failures are read-only and explicit', async () => {
  for (const settings of [
    { flags:4, plotType:5 },
    { flags:32 },
    { flags:16, standardScaleType:26, windowMaxX:50000 },
  ]) {
    const { drawing, layoutId } = await fixture(settings), before = drawing.serialize(), history = drawing.history
    assert.throws(() => exportDrawingSvg(drawing, { layoutId }), /SVG export:/)
    assert.throws(() => resolveDrawingPngPlot(drawing, { layoutId }), /Drawing image:/)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history)
  }
})
