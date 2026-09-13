import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true, viewport: { width: 1400, height: 900 } })

test('Workbench page rotation commits through UI and creates the matching physical print sheet', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'rotated-print-editor'; host.style.cssText = 'width:1360px;height:840px'; document.body.append(host)
    const [{ createKJDrawSDK }, { createKJDrawEditor }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/editor.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    const layoutId = drawing.snapshot().spaces.layoutIds[1], layout = drawing.getObject(layoutId)
    await sdk.executeCommand('PAGESETUP', { layoutId, dxf: {
      paperWidth: 420, paperHeight: 297, paperUnits: 1, rotation: 0, plotType: 5, flags: 0,
      marginLeft: 10, marginRight: 20, marginTop: 30, marginBottom: 40,
      originX: 5, originY: 7, scaleNumerator: 1, scaleDenominator: 1,
    } })
    await drawing.transact('paper line', transaction => transaction.createEntity('LINE', {
      start: [0, 0], end: [100, 0], trueColor: 0xff0000, lineweight: 50,
    }, { ownerId: layout.payload.blockRecordId }))
    const workbench = createKJDrawEditor(host, { sdk, document: drawing, locale: 'en', grid: false, layers: false, properties: false })
    await workbench.ready
    window.rotatedPrint = { sdk, drawing, workbench, layoutId }
  })

  const root = '#rotated-print-editor', before = await page.evaluate(() => ({ revision: rotatedPrint.drawing.revision, settings: structuredClone(rotatedPrint.drawing.getObject(rotatedPrint.layoutId).payload.dxfPlotSettings) }))
  await page.locator(`${root} [data-action="page-setup"]`).click()
  await expect(page.locator(`${root} [data-page-dialog]`)).toBeVisible()
  await page.locator(`${root} [data-page-sheet]`).selectOption({ label: 'Layout1' })
  await page.locator(`${root} [data-page-field="rotation"]`).selectOption('1')
  await page.locator(`${root} [data-action="apply-page"]`).click()
  await expect(page.locator(`${root} [data-page-dialog]`)).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => ({ revision: rotatedPrint.drawing.revision, rotation: rotatedPrint.drawing.getObject(rotatedPrint.layoutId).payload.dxfPlotSettings.rotation })))
    .toEqual({ revision: before.revision + 1, rotation: 1 })

  await page.locator(`${root} [data-action="undo"]`).click()
  await expect.poll(() => page.evaluate(() => rotatedPrint.drawing.getObject(rotatedPrint.layoutId).payload.dxfPlotSettings.rotation)).toBe(0)
  await page.locator(`${root} [data-action="redo"]`).click()
  await expect.poll(() => page.evaluate(() => rotatedPrint.drawing.getObject(rotatedPrint.layoutId).payload.dxfPlotSettings.rotation)).toBe(1)
  await page.evaluate(async () => {
    const [{ createDrawingPrintHtml }, { resolveDrawingPngPlot }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/print-export.js'), import('/packages/kjdraw-sdk/src/drawing-image.js'),
    ])
    const state = window.rotatedPrint
    state.source = state.drawing.serialize()
    state.print = createDrawingPrintHtml(state.drawing, { layoutId: state.layoutId })
    state.png = resolveDrawingPngPlot(state.drawing, { layoutId: state.layoutId })
    const frame = document.createElement('iframe'); frame.id = 'print-frame'; frame.srcdoc = state.print.html; document.body.append(frame)
  })
  const frame = page.frameLocator('#print-frame')
  await expect(frame.locator('.kj-print-sheet')).toBeVisible()
  const result = await frame.locator('.kj-print-sheet').evaluate(sheet => {
    const svg = sheet.querySelector('svg'), box = sheet.getBoundingClientRect()
    return { width: box.width, height: box.height, svgWidth: svg.getAttribute('width'), svgHeight: svg.getAttribute('height'), note: document.querySelector('.kj-print-note').textContent, scripts: document.scripts.length }
  })
  expect(result.width).toBeCloseTo(297 * 96 / 25.4, 1); expect(result.height).toBeCloseTo(420 * 96 / 25.4, 1)
  expect(result.svgWidth).toBe('297mm'); expect(result.svgHeight).toBe('420mm'); expect(result.note).toContain('297 × 420 mm')
  expect(result.scripts).toBe(0)
  expect(await page.evaluate(() => ({ unchanged: rotatedPrint.source === rotatedPrint.drawing.serialize(), paper: [rotatedPrint.png.paper.widthMm, rotatedPrint.png.paper.heightMm] })))
    .toEqual({ unchanged: true, paper: [297, 420] })
})
