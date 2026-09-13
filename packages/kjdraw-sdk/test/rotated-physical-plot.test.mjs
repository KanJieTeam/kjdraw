import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK } from '../src/sdk.js'
import { resolveDrawingPngPlot } from '../src/drawing-image.js'
import { createDrawingPrintHtml } from '../src/print-export.js'
import { exportDrawingSvg } from '../src/svg-export.js'

const rotations = [
  { rotation: 0, paper: [420, 297], margins: [10, 20, 30, 40] },
  { rotation: 1, paper: [297, 420], margins: [30, 40, 20, 10] },
  { rotation: 2, paper: [420, 297], margins: [20, 10, 40, 30] },
  { rotation: 3, paper: [297, 420], margins: [40, 30, 10, 20] },
]

async function fixture(rotation) {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const layoutId = drawing.snapshot().spaces.layoutIds[1]
  await sdk.executeCommand('PAGESETUP', { layoutId, dxf: {
    paperWidth: 420, paperHeight: 297, paperUnits: 1, rotation, plotType: 5, flags: 0,
    marginLeft: 10, marginRight: 20, marginTop: 30, marginBottom: 40,
    originX: 5, originY: 7, scaleNumerator: 1, scaleDenominator: 1,
  } })
  const ownerId = drawing.getObject(layoutId).payload.blockRecordId
  await drawing.transact('paper geometry', transaction => transaction.createEntity('LINE', { start: [0, 0], end: [100, 0], lineweight: 50 }, { ownerId }))
  return { sdk, drawing, layoutId }
}

for (const expected of rotations) test(`DXF plot rotation ${expected.rotation} resolves physical paper, margins and scale consistently`, async () => {
  const { sdk, drawing, layoutId } = await fixture(expected.rotation)
  const source = drawing.serialize(), svg = exportDrawingSvg(drawing, { layoutId }), png = resolveDrawingPngPlot(drawing, { layoutId })
  assert.equal(drawing.serialize(), source)
  const [width, height] = expected.paper, [left, right, top, bottom] = expected.margins
  assert.deepEqual(svg.paper, { widthMm: width, heightMm: height, millimetersPerDrawingUnit: 1 })
  assert.deepEqual(svg.plot.printableAreaMm, {
    minimum: [left, bottom], maximum: [width - right, height - top],
    width: width - left - right, height: height - top - bottom,
  })
  assert.deepEqual(svg.plot.plotOriginMm, [left + 5, bottom + 7])
  assert.deepEqual(svg.plot.drawingToPaperMatrix, [1, 0, 0, -1, left + 5, height - bottom - 7])
  assert.deepEqual(svg.plot.sourceRange, {
    kind: 'layout', minimum: [-5, -7], maximum: [width - left - right - 5, height - top - bottom - 7],
  })
  assert.match(svg.svg, new RegExp(`width="${width}mm" height="${height}mm"`))
  assert.match(createDrawingPrintHtml(drawing, { layoutId }).html, new RegExp(`@page\\{size:${width}mm ${height}mm`))

  assert.equal(png.paper.widthMm, width); assert.equal(png.paper.heightMm, height)
  const ppm = png.paper.pixelsPerMillimeter, normalized = png.plot.drawingToPixelMatrix.map(value => value / ppm)
  assert.deepEqual(normalized.map(value => Math.abs(value) < 1e-12 ? 0 : value), [1, 0, 0, -1, left + 5, height - bottom - 7])
  assert.deepEqual(png.plot.plotOriginPixels.map(value => value / ppm), [left + 5, height - bottom - 7])

  const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
  const kjdReopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  assert.deepEqual(exportDrawingSvg(kjdReopened, { layoutId }).plot, svg.plot)
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const dxfReopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const reopenedLayout = dxfReopened.listObjects({ kind: 'layout' }).find(layout => layout.name === 'Layout1')
  assert.ok(reopenedLayout)
  const roundTrip = exportDrawingSvg(dxfReopened, { layoutId: reopenedLayout.id })
  assert.deepEqual(roundTrip.paper, svg.paper); assert.deepEqual(roundTrip.plot, svg.plot)
})

test('official ezdxf independently reopens every native plot rotation and asymmetric margin', async t => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  for (const { rotation } of rotations) {
    const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: `Rot${rotation}` })
    await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: {
      paperWidth: 420, paperHeight: 297, paperUnits: 1, rotation, plotType: 5, flags: 0,
      marginLeft: 10, marginRight: 20, marginTop: 30, marginBottom: 40,
      originX: 5, originY: 7, scaleNumerator: 1, scaleDenominator: 1,
    } })
  }
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH'); source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source)); audit=d.audit(); out={}
for name in ['Rot0','Rot1','Rot2','Rot3']:
 l=d.layouts.get(name); out[name]=[l.dxf.plot_rotation,l.dxf.paper_width,l.dxf.paper_height,l.dxf.left_margin,l.dxf.right_margin,l.dxf.top_margin,l.dxf.bottom_margin]
print(json.dumps({'errors':len(audit.errors),'fixes':len(audit.fixes),'layouts':out}))`
  const run = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (run.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(run.stderr)) {
    if (process.env.KJDRAW_REQUIRE_DXF_INTEGRATION === '1') assert.fail(run.stderr || run.error.message)
    t.skip('official ezdxf is required'); return
  }
  assert.equal(run.status, 0, run.stderr); const actual = JSON.parse(run.stdout)
  assert.deepEqual({ errors: actual.errors, fixes: actual.fixes }, { errors: 0, fixes: 0 })
  for (const { rotation } of rotations) assert.deepEqual(actual.layouts[`Rot${rotation}`], [rotation, 420, 297, 10, 20, 30, 40])
})
