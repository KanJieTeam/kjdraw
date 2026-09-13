import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { resolveDrawingPngPlot } from '../src/drawing-image.js'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
const paperByName = (document, name = 'Layout1') => document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(layout => layout.name === name)
const page = {
  paperWidth:210, paperHeight:100, paperUnits:1, rotation:0, plotType:5, flags:20, standardScaleType:0,
  marginLeft:10, marginRight:10, marginTop:15, marginBottom:5, originX:2, originY:3,
  scaleNumerator:1, scaleDenominator:1, printerName:'', styleSheet:'', shadeMode:0,
}

test('paper-layout fit uses persisted AcDbLayout limits identically in SVG and PNG and follows PAGESETUP history', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units:'millimeter' }), layout = paperByName(drawing)
  const original = layout.payload.dxfLayoutGeometry
  await sdk.executeCommand('PAGESETUP', { layoutId:layout.id, dxf:page }, { document:drawing })
  const expected = { limits:{ minimum:[-12,-8], maximum:[198,92] }, extents:null }
  assert.deepEqual(drawing.getObject(layout.id).payload.dxfLayoutGeometry, expected)
  const svg = exportDrawingSvg(drawing, { layoutId:layout.id }), png = resolveDrawingPngPlot(drawing, { layoutId:layout.id })
  near(svg.paper.millimetersPerDrawingUnit, .8)
  assert.deepEqual(svg.plot.plotOriginMm, [21,5])
  assert.deepEqual(svg.plot.sourceRange, { kind:'layout-limits', minimum:[-12,-8], maximum:[198,92] })
  assert.deepEqual(png.plot.sourceRange, svg.plot.sourceRange)
  near(png.plot.drawingToPixelMatrix[0] / png.paper.pixelsPerMillimeter, .8)
  assert.match(svg.svg, /clip-path="url\(#kj-plot-range\)"/)
  await sdk.executeCommand('UNDO', {}, { document:drawing }); assert.deepEqual(drawing.getObject(layout.id).payload.dxfLayoutGeometry, original)
  await sdk.executeCommand('REDO', {}, { document:drawing }); assert.deepEqual(drawing.getObject(layout.id).payload.dxfLayoutGeometry, expected)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format:'KJD' }), { format:'KJD' })
  assert.deepEqual(exportDrawingSvg(reopened, { layoutId:layout.id }).plot, svg.plot)
})

test('AcDbLayout limits and real-or-unset extents round-trip through DXF and official ezdxf without repairs', async t => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument(), layout = paperByName(drawing)
  await sdk.executeCommand('PAGESETUP', { layoutId:layout.id, dxf:page }, { document:drawing })
  await drawing.transact('known paper extents', tx => tx.updateObject(layout.id, { payload:{ dxfLayoutGeometry:{ limits:{ minimum:[-12,-8], maximum:[198,92] }, extents:{ minimum:[-10,-7,0], maximum:[150,80,4] } } } }))
  const dxf = await sdk.writeDocument(drawing, { format:'DXF', version:'2018' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format:'DXF' }), reopenedLayout = paperByName(reopened)
  assert.deepEqual(reopenedLayout.payload.dxfLayoutGeometry, drawing.getObject(layout.id).payload.dxfLayoutGeometry)
  assert.deepEqual(exportDrawingSvg(reopened, { layoutId:reopenedLayout.id }).plot.sourceRange, { kind:'layout-limits', minimum:[-12,-8], maximum:[198,92] })
  const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
d=ezdxf.read(io.StringIO(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read())); a=d.audit()
p=d.layouts.get('Layout1').dxf_layout.dxf; m=d.layouts.get('Model').dxf_layout.dxf
print(json.dumps({'limits':[list(p.limmin),list(p.limmax)],'extents':[list(p.extmin),list(p.extmax)],'model_extents':[list(m.extmin),list(m.extmax)],'errors':len(a.errors),'fixes':len(a.fixes)}))
`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding:'utf8', timeout:30000, env:{ ...process.env, PYTHONIOENCODING:'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(result.stderr)) { if (process.env.KJDRAW_REQUIRE_DXF_INTEGRATION === '1') assert.fail(result.stderr || result.error.message); t.skip('ezdxf required'); return }
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.deepEqual(JSON.parse(result.stdout), { limits:[[-12,-8,0],[198,92,0]], extents:[[-10,-7,0],[150,80,4]], model_extents:[[1e20,1e20,1e20],[-1e20,-1e20,-1e20]], errors:0, fixes:0 })
})

test('missing, partial or reversed layout ranges reject without output or import mutation', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument(), layout = paperByName(drawing)
  await sdk.executeCommand('PAGESETUP', { layoutId:layout.id, dxf:page }, { document:drawing })
  await drawing.transact('explicitly unknown layout range', tx => tx.updateObject(layout.id, { payload:{ dxfLayoutGeometry:{ limits:null, extents:null } } }))
  const before = drawing.serialize(), history = drawing.history
  assert.throws(() => exportDrawingSvg(drawing, { layoutId:layout.id }), /AcDbLayout limits/)
  assert.throws(() => resolveDrawingPngPlot(drawing, { layoutId:layout.id }), /AcDbLayout limits/)
  assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history)
  await assert.rejects(drawing.transact('invalid range', tx => tx.updateObject(layout.id, { payload:{ dxfLayoutGeometry:{ limits:{ minimum:[10,0], maximum:[0,10] }, extents:null } } })))
  assert.equal(drawing.serialize(), before)
  const input = tags => `0\nSECTION\n2\nOBJECTS\n0\nLAYOUT\n5\nB1\n100\nAcDbLayout\n1\nSheet\n70\n1\n71\n1\n${tags}330\nB0\n0\nENDSEC\n0\nEOF\n`
  await assert.rejects(createKJDrawSDK().readDocument(input('10\n0\n'), { format:'DXF' }), error => /incomplete limits/.test(String(error.cause)))
  await assert.rejects(createKJDrawSDK().readDocument(input('10\n10\n20\n0\n11\n0\n21\n10\n'), { format:'DXF' }), error => /positive width and height/.test(String(error.cause)))
})
