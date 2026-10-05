import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { resolveDrawingPngPlot } from '../src/drawing-image.js'
import { createDrawingPrintHtml } from '../src/print-export.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import {
  OUTPUT_PAPER_PRESETS,
  buildOutputPageSettings,
  detectOutputPaper,
  outputPaperSize,
  resolveOutputModelBounds,
} from '../../../apps/playground/output-controls.js'

test('ISO paper presets resolve both orientations and leave unmatched dimensions custom', () => {
  const expected = {
    A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297],
  }
  assert.deepEqual(Object.fromEntries(Object.entries(OUTPUT_PAPER_PRESETS).map(([name, size]) => [name, [...size]])), expected)
  for (const [preset, [width, height]] of Object.entries(expected)) {
    assert.deepEqual(outputPaperSize(preset, 'portrait'), { width, height })
    assert.deepEqual(outputPaperSize(preset.toLowerCase(), 'landscape'), { width: height, height: width })
    assert.deepEqual(detectOutputPaper(width, height), { preset, orientation: 'portrait' })
    assert.deepEqual(detectOutputPaper(height, width), { preset, orientation: 'landscape' })
  }
  assert.equal(outputPaperSize('custom', 'portrait'), null)
  assert.deepEqual(detectOutputPaper(333, 222), { preset: 'custom', orientation: 'landscape' })
  assert.deepEqual(detectOutputPaper(222, 333), { preset: 'custom', orientation: 'portrait' })
  assert.throws(() => outputPaperSize('A4', 'diagonal'), /portrait or landscape/)
})

test('model page setup converts real units to explicit physical scale and persists as one undoable edit', async () => {
  for (const [units, length] of [['meter', 1], ['millimeter', 1000], ['inch', 1000 / 25.4]]) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units }), layoutId = document.snapshot().spaces.layoutIds[0]
    await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0,0], end: [length,0] } })
    const original = document.serialize(), settings = buildOutputPageSettings(document, layoutId, { width: 420, height: 297, margin: 10, denominator: 100, x0: 0, y0: 0, x1: length, y1: length })
    assert.equal(document.serialize(), original)
    await sdk.executeCommand('PAGESETUP', { layoutId, dxf: settings })
    const output = exportDrawingSvg(document, { layoutId })
    assert.ok(Math.abs(output.paper.millimetersPerDrawingUnit * length - 10) < 1e-10)
    assert.equal(output.paper.widthMm, 420)
    assert.equal((await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })).getObject(layoutId).payload.dxfPlotSettings.scaleDenominator, 100)
    await sdk.executeCommand('UNDO', {}, { document })
    assert.equal(document.getObject(layoutId).payload.dxfPlotSettings, undefined)
  }
})

test('page setup rejects implicit fitting, ambiguous units, invalid windows and margins without modifying CAD data', () => {
  for (const units of ['meter', 'unitless']) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units }), layoutId = document.snapshot().spaces.layoutIds[0], original = document.serialize()
    const values = { width: 420, height: 297, margin: 10, denominator: 100, x0: 0, y0: 0, x1: 10, y1: 10 }
    if (units === 'unitless') assert.throws(() => buildOutputPageSettings(document, layoutId, values), /supported drawing unit/)
    else {
      for (const patch of [{ x1: 100 }, { y1: 0 }, { margin: 149 }, { denominator: 0 }, { x0: NaN }, { width: 10001 }]) assert.throws(() => buildOutputPageSettings(document, layoutId, { ...values, ...patch }))
      const paperId = document.snapshot().spaces.layoutIds[1], paper = buildOutputPageSettings(document, paperId, { width: 420, height: 297, margin: 0 })
      assert.equal(paper.plotType, 5); assert.equal(paper.scaleNumerator / paper.scaleDenominator, 1)
    }
    assert.equal(document.serialize(), original)
  }
})

test('automatic model output centers nonzero negative geometry identically in landscape SVG, PNG and print', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units:'meter' }), layoutId = document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('CREATE', { type:'LINE', payload:{ start:[-80,-40], end:[220,110] } })
  const bounds = resolveOutputModelBounds(document, layoutId)
  assert.deepEqual(bounds, [-80,-40,220,110])
  await sdk.executeCommand('PAGESETUP', { layoutId, dxf:{
    paperWidth:420, paperHeight:297, paperUnits:1, rotation:0,
    marginLeft:11, marginRight:19, marginTop:17, marginBottom:7,
    flags:20, standardScaleType:0, plotType:4,
    windowMinX:bounds[0], windowMinY:bounds[1], windowMaxX:bounds[2], windowMaxY:bounds[3],
    originX:0, originY:0, printerName:'', styleSheet:'', shadeMode:0,
  } })
  const svg = exportDrawingSvg(document, { layoutId }), png = resolveDrawingPngPlot(document, { layoutId }), print = createDrawingPrintHtml(document, { layoutId })
  const sourceCenter = [(bounds[0]+bounds[2])/2, (bounds[1]+bounds[3])/2]
  const transform = (matrix, point) => [matrix[0]*point[0]+matrix[2]*point[1]+matrix[4], matrix[1]*point[0]+matrix[3]*point[1]+matrix[5]]
  const paperCenter = transform(svg.plot.drawingToPaperMatrix, sourceCenter)
  assert.ok(Math.abs(paperCenter[0] - (11 + (420-19))/2) < 1e-9)
  assert.ok(Math.abs(paperCenter[1] - (17 + (297-7))/2) < 1e-9)
  const ppm = png.paper.pixelsPerMillimeter, pngCenter = transform(png.plot.drawingToPixelMatrix, sourceCenter)
  assert.ok(Math.abs(pngCenter[0]/ppm - paperCenter[0]) < 1e-9)
  assert.ok(Math.abs(pngCenter[1]/ppm - paperCenter[1]) < 1e-9)
  assert.deepEqual(svg.plot.sourceRange, { kind:'window', minimum:[-80,-40], maximum:[220,110] })
  assert.deepEqual(print.plot, svg.plot)
  assert.match(print.html, new RegExp(`matrix\\(${svg.plot.drawingToPaperMatrix.join(' ')}\\)`))
})
