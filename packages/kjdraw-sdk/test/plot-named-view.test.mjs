import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { resolveDrawingPngPlot } from '../src/drawing-image.js'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
const page = { paperWidth:210, paperHeight:100, paperUnits:1, rotation:0, flags:20, plotType:3, marginLeft:10, marginRight:10, marginTop:10, marginBottom:10, originX:0, originY:0, standardScaleType:0, printerName:'', styleSheet:'', shadeMode:0 }

async function fixture() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units:'millimeter' })
  await drawing.transact('named plot views', tx => {
    tx.upsertTableRecord('views', { name:'MODEL_DETAIL', type:'VIEW', payload:{ center:[50,60,0], target:[100,200,0], width:100, height:50, direction:[0,0,1], twistAngle:0, viewMode:0, renderMode:0, ucsAssociated:0 } })
    tx.upsertTableRecord('views', { name:'SHEET_DETAIL', type:'VIEW', payload:{ center:[100,50,0], target:[0,0,0], width:100, height:50, direction:[0,0,1], twistAngle:0, viewMode:0, renderMode:0, ucsAssociated:0 } })
  })
  const modelLayoutId = drawing.snapshot().spaces.layoutIds[0], paperLayoutId = drawing.snapshot().spaces.layoutIds[1]
  await sdk.executeCommand('PAGESETUP', { layoutId:modelLayoutId, dxf:{ ...page, viewName:'MODEL_DETAIL' } })
  await sdk.executeCommand('PAGESETUP', { layoutId:paperLayoutId, dxf:{ ...page, viewName:'SHEET_DETAIL' } })
  await sdk.executeCommand('CREATE', { type:'LINE', payload:{ start:[100,235], end:[200,235] } }, { document:drawing })
  await sdk.executeCommand('CREATE', { type:'LINE', payload:{ start:[50,25], end:[150,25] }, options:{ ownerId:drawing.getObject(paperLayoutId).payload.blockRecordId } }, { document:drawing })
  return { sdk, drawing, modelLayoutId, paperLayoutId }
}

function verify(output, minimum, maximum) {
  near(output.paper.millimetersPerDrawingUnit, 1.6)
  assert.deepEqual(output.plot.sourceRange, { kind:'view', minimum, maximum })
}

test('persistent named views provide exact fit ranges for model and paper SVG/PNG output', async () => {
  const { sdk, drawing, modelLayoutId, paperLayoutId } = await fixture(), before = drawing.serialize()
  for (const [layoutId, minimum, maximum] of [[modelLayoutId,[100,235],[200,285]],[paperLayoutId,[50,25],[150,75]]]) {
    const svg = exportDrawingSvg(drawing, { layoutId }), png = resolveDrawingPngPlot(drawing, { layoutId })
    verify(svg, minimum, maximum); verify({ paper:{ millimetersPerDrawingUnit:png.plot.drawingToPixelMatrix[0] / png.paper.pixelsPerMillimeter }, plot:png.plot }, minimum, maximum)
    assert.match(svg.svg, /clip-path="url\(#kj-plot-range\)"/)
  }
  assert.equal(drawing.serialize(), before)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format:'KJD' }), { format:'KJD' })
  verify(exportDrawingSvg(reopened, { layoutId:paperLayoutId }), [50,25], [150,75])
})

test('named-view PAGESETUP is atomic, undoable and independently interoperable through DXF', async t => {
  const { sdk, drawing, modelLayoutId } = await fixture()
  const original = drawing.getObject(modelLayoutId).payload.dxfPlotSettings
  const before = drawing.serialize()
  await assert.rejects(sdk.executeCommand('PAGESETUP', { layoutId:modelLayoutId, dxf:{ viewName:'MISSING' } }))
  assert.equal(drawing.serialize(), before)
  await sdk.executeCommand('PAGESETUP', { layoutId:modelLayoutId, dxf:{ viewName:'model_detail', flags:16, standardScaleType:17 } })
  near(exportDrawingSvg(drawing, { layoutId:modelLayoutId }).paper.millimetersPerDrawingUnit, .5)
  await sdk.executeCommand('UNDO', {}, { document:drawing }); assert.deepEqual(drawing.getObject(modelLayoutId).payload.dxfPlotSettings, original)
  await sdk.executeCommand('REDO', {}, { document:drawing }); assert.equal(drawing.getObject(modelLayoutId).payload.dxfPlotSettings.standardScaleType, 17)
  const dxf = await sdk.writeDocument(drawing, { format:'DXF', version:'2018' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format:'DXF' }), reopenedModelId = reopened.snapshot().spaces.layoutIds[0]
  const view = reopened.getTable('views').records.find(record => record.name === 'MODEL_DETAIL')
  assert.deepEqual({ center:view.payload.center, target:view.payload.target, width:view.payload.width, height:view.payload.height, direction:view.payload.direction, twistAngle:view.payload.twistAngle, viewMode:view.payload.viewMode, renderMode:view.payload.renderMode, ucsAssociated:view.payload.ucsAssociated }, { center:[50,60,0], target:[100,200,0], width:100, height:50, direction:[0,0,1], twistAngle:0, viewMode:0, renderMode:0, ucsAssociated:0 })
  const reopenedSvg = exportDrawingSvg(reopened, { layoutId:reopenedModelId })
  near(reopenedSvg.paper.millimetersPerDrawingUnit, .5)
  assert.deepEqual(reopenedSvg.plot.sourceRange, { kind:'view', minimum:[100,235], maximum:[200,285] })
  const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
d=ezdxf.read(io.StringIO(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read())); a=d.audit(); v=d.views.get('MODEL_DETAIL'); p=d.layouts.get('Model').dxf_layout.dxf
print(json.dumps({'center':list(v.dxf.center),'target':list(v.dxf.target),'width':v.dxf.width,'height':v.dxf.height,'direction':list(v.dxf.direction),'twist':v.dxf.view_twist,'view_mode':v.dxf.view_mode,'render_mode':v.dxf.render_mode,'ucs':v.dxf.ucs,'plot_type':p.plot_type,'plot_view':p.plot_view_name,'errors':len(a.errors),'fixes':len(a.fixes)}))
`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding:'utf8', timeout:30000, env:{ ...process.env, PYTHONIOENCODING:'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(result.stderr)) { if (process.env.KJDRAW_REQUIRE_DXF_INTEGRATION === '1') assert.fail(result.stderr || result.error.message); t.skip('ezdxf required'); return }
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.deepEqual(JSON.parse(result.stdout), { center:[50,60,0], target:[100,200,0], width:100, height:50, direction:[0,0,1], twist:0, view_mode:0, render_mode:0, ucs:0, plot_type:3, plot_view:'model_detail', errors:0, fixes:0 })
})

test('non-planar, twisted, perspective, rendered and UCS views are rejected without output mutation', async () => {
  for (const patch of [{ direction:[1,0,1] }, { twistAngle:.1 }, { viewMode:1 }, { renderMode:2 }, { ucsAssociated:1 }]) {
    const { drawing, modelLayoutId } = await fixture()
    const view = drawing.getTable('views').records.find(record => record.name === 'MODEL_DETAIL')
    await drawing.transact('unsupported view projection', tx => tx.updateObject(view.id, { payload:patch }))
    const before = drawing.serialize(), history = drawing.history
    assert.throws(() => exportDrawingSvg(drawing, { layoutId:modelLayoutId }), /SVG export: Named view MODEL_DETAIL/)
    assert.throws(() => resolveDrawingPngPlot(drawing, { layoutId:modelLayoutId }), /Drawing image: Named view MODEL_DETAIL/)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history)
  }
})
