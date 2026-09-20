import { test, expect } from '@playwright/test'

test('mechanical auxiliary solids stay pixel exact through KJD and DXF on a fixed canvas', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [{ createKJDrawSDK }, { buildAgentMechanicalFlangeCore }, { exportDrawingSvg }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/agent-mechanical-flange-core.js'), import('/packages/kjdraw-sdk/src/svg-export.js'),
    ])
    const sdk = createKJDrawSDK(), source = sdk.createDocument({ units: 'millimeter' }), layoutId = source.snapshot().spaces.layoutIds[0]
    await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: { paperWidth: 160, paperHeight: 100, paperUnits: 1, plotType: 4, flags: 0, windowMinX: 0, windowMinY: 0, windowMaxX: 160, windowMaxY: 100, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, originX: 0, originY: 0 } }, { document: source })
    const proposal = buildAgentMechanicalFlangeCore(source, {
      version: '1.0.0', expectedRevision: source.revision, units: 'millimeter', drawingId: 'PUBLIC-SOLID-PIXELS',
      endView: { center: [35, 50], ringRadii: [12] },
      auxiliarySolids: [
        { vertices: [[70, 30], [86, 38], [70, 46]], role: 'geometry' },
        { vertices: [[100, 30], [116, 38], [100, 46], [100, 46]], role: 'notes' },
      ],
      sheet: { origin: [0, 0], size: [160, 100], inset: 5 },
    })
    await sdk.executeCommand('CREATEBATCH', proposal.commandArgs, { document: source })
    const [kjd, dxf] = await Promise.all(['KJD', 'DXF'].map(async format => createKJDrawSDK().readDocument(await sdk.writeDocument(source, { format }), { format })))
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500; document.body.append(canvas)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const render = async drawing => {
      const output = exportDrawingSvg(drawing, { layoutId: drawing.snapshot().spaces.layoutIds[0], allowPartial: false })
      const image = await new Promise((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(output.svg)}` })
      context.clearRect(0, 0, 800, 500); context.drawImage(image, 0, 0, 800, 500)
      return { diagnostics: output.report.diagnostics.length, pixels: new Uint8ClampedArray(context.getImageData(0, 0, 800, 500).data) }
    }
    const expected = await render(source), reopened = [await render(kjd), await render(dxf)]
    const compare = actual => { let exact = 0; for (let index = 0; index < actual.pixels.length; index++) if (actual.pixels[index] === expected.pixels[index]) exact++; return { exact, channels: actual.pixels.length, diagnostics: actual.diagnostics } }
    canvas.remove()
    return { sourceDiagnostics: expected.diagnostics, kjd: compare(reopened[0]), dxf: compare(reopened[1]), sourceSolids: source.listEntities({ type: 'SOLID' }).length, kjdSolids: kjd.listEntities({ type: 'SOLID' }).length, dxfSolids: dxf.listEntities({ type: 'SOLID' }).length }
  })
  expect(result.sourceDiagnostics).toBe(0)
  expect(result.kjd).toEqual({ exact: 800 * 500 * 4, channels: 800 * 500 * 4, diagnostics: 0 })
  expect(result.dxf).toEqual(result.kjd)
  expect([result.sourceSolids, result.kjdSolids, result.dxfSolids]).toEqual([2, 2, 2])
})