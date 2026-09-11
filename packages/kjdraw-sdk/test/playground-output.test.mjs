import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { buildOutputPageSettings } from '../../../apps/playground/output-controls.js'

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
