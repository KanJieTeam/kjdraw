import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'

test.use({ bypassCSP: true })

test('workbench downloads the selected A3 SVG with a real 1:100 viewport and unchanged CAD document', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  const ids = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { mountKJDrawWorkbench } = await import('/packages/kjdraw-sdk/src/workbench.js')
    document.body.replaceChildren(); document.body.style.margin = '0'
    const host = document.createElement('div'); host.style.cssText = 'width:1400px;height:900px'; document.body.append(host)
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'a3-svg-workbench', units: 'millimeter' })
    const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-500, 0, 0], end: [500, 0, 0], trueColor: 0xff0000 } })
    const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'A3 fabrication sheet' })
    await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 420, paperHeight: 297, paperUnits: 1, scaleNumerator: 1, scaleDenominator: 1, plotType: 5, rotation: 0 } })
    await sdk.executeCommand('VIEWPORT', { layoutId: layout.id, center: [100, 100], width: 180, height: 100, viewCenter: [0, 0], viewHeight: 10000 })
    const paper = await drawing.transact('paper geometry', tx => {
      const line = tx.createEntity('LINE', { start: [20, 20, 0], end: [120, 20, 0], trueColor: 0x0000ff }, { ownerId: layout.payload.blockRecordId })
      tx.createEntity('TEXT', { position: [20, 270, 0], text: 'A3 / 1:100 - editable vector output', height: 5 }, { ownerId: layout.payload.blockRecordId })
      return line
    })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', theme: 'light', grid: false })
    await workbench.ready
    window.svgWorkbench = { sdk, drawing, workbench, source: drawing.serialize(), history: JSON.stringify(drawing.history) }
    return { layout: layout.id, line: line.id, paper: paper.id }
  })
  const root = page.locator('.kjwb')
  await root.locator('[data-drawing-layout]').selectOption(ids.layout)
  await expect(root.locator('[data-action="save-svg"]')).toBeEnabled()
  const received = page.waitForEvent('download')
  await root.locator('[data-action="save-svg"]').click()
  const download = await received
  expect(download.suggestedFilename()).toMatch(/\.svg$/)
  await mkdir('.cache/svg-export', { recursive: true })
  await download.saveAs('.cache/svg-export/a3-workbench.svg')
  const svg = await readFile('.cache/svg-export/a3-workbench.svg', 'utf8')
  const result = await page.evaluate(({ svg, ids }) => {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    if (parsed.querySelector('parsererror')) throw Error('Downloaded SVG is invalid XML')
    const drawing = document.importNode(parsed.documentElement, true)
    drawing.style.cssText = 'width:840px;height:594px;background:white;display:block'
    const preview = document.createElement('div'); preview.id = 'svg-export-preview'; preview.style.cssText = 'position:fixed;inset:20px auto auto 20px;background:#ddd;padding:10px;z-index:10000'
    preview.append(drawing); document.body.append(preview)
    const length = id => {
      const line = drawing.querySelector('g[data-entity-id="' + id + '"] line')
      if (!line) throw Error('Exported line missing: ' + id)
      // Both matrices must share the screen coordinate system; Firefox
      // getCTM() handles the outer SVG viewport differently from child CTMs.
      const transform = drawing.getScreenCTM().inverse().multiply(line.getScreenCTM())
      const a = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(transform)
      const b = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(transform)
      return Math.hypot(b.x - a.x, b.y - a.y)
    }
    const report = JSON.parse(drawing.querySelector('metadata').textContent)
    const { drawing: original, source, history } = window.svgWorkbench
    return { width: drawing.getAttribute('width'), height: drawing.getAttribute('height'), modelLengthMm: length(ids.line), paperLengthMm: length(ids.paper), report, unchanged: source === original.serialize() && history === JSON.stringify(original.history) }
  }, { svg, ids })
  expect(result.width).toBe('420mm'); expect(result.height).toBe('297mm')
  // Browser SVG matrices may use float32; sub-micrometer paper precision is checked separately from exact SDK matrices.
  expect(result.modelLengthMm).toBeCloseTo(10, 5); expect(result.paperLengthMm).toBeCloseTo(100, 5)
  expect(result.report.diagnostics).toEqual([]); expect(result.report.viewports[0].millimetersPerModelUnit).toBeCloseTo(.01, 10)
  expect(result.unchanged).toBe(true)
  await page.locator('#svg-export-preview').screenshot({ path: '.cache/svg-export/a3-workbench.png' })
  await testInfo.attach('physical-a3-svg', { body: svg, contentType: 'image/svg+xml' })
  const raster = await page.evaluate(async svg => {
    const image = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    try {
      image.src = url; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = 840; canvas.height = 594
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 840, 594)
      const pixels = ctx.getImageData(0, 0, 840, 594).data
      let red = 0, blue = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 0) { if (pixels[i] > 180 && pixels[i + 1] < 80 && pixels[i + 2] < 80) red++; if (pixels[i + 2] > 180 && pixels[i] < 80 && pixels[i + 1] < 80) blue++ }
      return { red, blue }
    } finally { URL.revokeObjectURL(url) }
  }, svg)
  expect(raster.red).toBeGreaterThan(5); expect(raster.blue).toBeGreaterThan(50)
})
