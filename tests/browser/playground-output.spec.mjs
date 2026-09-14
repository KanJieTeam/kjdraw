import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function closePrintPreview(popup) {
  await popup.locator('#kj-print-close').click().catch(error => { if (!popup.isClosed()) throw error })
  await expect.poll(() => popup.isClosed()).toBe(true)
}
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { resolveDrawingPngPlot } from '../../packages/kjdraw-sdk/src/drawing-image.js'
import { exportDrawingSvg } from '../../packages/kjdraw-sdk/src/svg-export.js'
import { KJProjectSession } from '../../packages/kjdraw-sdk/src/project-session.js'

if (process.env.KJDRAW_TEST_BASE_URL) test.use({ baseURL: process.env.KJDRAW_TEST_BASE_URL })

async function openFixture(page) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ title: '道路详图 / output', units: 'meter' })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0,0], end: [2,0] } })
  await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [0,1], text: '道路工程图 / Road detail', height: .1 } })
  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({ name: 'road-detail.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(document, { format: 'KJD' })) })
  await expect(page.locator('#top-file-name')).toHaveText('road-detail.kjd')
  await expect(page.locator('#drawing-title')).toHaveText('道路详图 / output')
  await expect(page.locator('#entity-count')).toContainText('2 ')
  return { document, layoutId: document.snapshot().spaces.layoutIds[0] }
}
async function setup(page, overrides = {}, { expectClose = true } = {}) {
  await page.locator('#page-setup').click()
  for (const [name,value] of Object.entries({ width:420,height:297,margin:10,scaleMode:'custom',denominator:100,x0:-1,y0:-1,x1:10,y1:10,...overrides })) {
    const control=page.locator(`#dialog-fields [name="${name}"]`)
    if(await control.evaluate(element=>element.tagName==='SELECT'))await control.selectOption(String(value));else await control.fill(String(value))
  }
  await page.locator('#dialog-submit').click()
  if (expectClose) await expect(page.locator('#app-dialog')).not.toBeVisible()
}
async function saved(page) {
  const pending = page.waitForEvent('download'); await page.locator('#save').click()
  return KJProjectSession.open(await readFile(await (await pending).path()), { sdk: createKJDrawSDK() })
}

test('main editor configures a real 1:100 model page, downloads SVG and PNG, and keeps geometry through save and undo', async ({ page }) => {
  const { document, layoutId } = await openFixture(page)
  await page.locator('.ribbon-tabs [data-i18n="modify"]').click()
  await expect(page.locator('#move-selection')).toBeVisible(); await expect(page.locator('.ribbon-group [data-tool="line"]').first()).not.toBeVisible()
  await expect(page.locator('#toggle-layers')).toBeVisible(); await expect(page.locator('#export-svg')).not.toBeVisible()
  await page.locator('.ribbon-tabs [data-i18n="inspect"]').click()
  await expect(page.locator('#measure-entity')).toBeVisible(); await expect(page.locator('#move-selection')).not.toBeVisible()
  const measureLayout=await page.evaluate(()=>Object.fromEntries(['measure-mode','measure-entity','fit-ribbon'].map(id=>{const box=document.getElementById(id).getBoundingClientRect();return[id,{x:box.x,y:box.y,width:box.width,height:box.height}]})))
  expect(measureLayout['measure-entity'].x).toBeGreaterThan(measureLayout['measure-mode'].x+measureLayout['measure-mode'].width)
  expect(measureLayout['fit-ribbon'].x).toBeCloseTo(measureLayout['measure-entity'].x,0)
  expect(measureLayout['fit-ribbon'].y).toBeGreaterThan(measureLayout['measure-entity'].y)
  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  await page.locator('#page-setup').click(); await page.keyboard.press('Escape')
  await expect(page.locator('#revision')).toHaveText(`REV ${document.revision}`)
  await setup(page, { x1:100 }, { expectClose:false })
  await expect(page.locator('#app-dialog')).toBeVisible()
  await expect(page.locator('#dialog-error')).toContainText('does not fit')
  await expect(page.locator('#revision')).toHaveText(`REV ${document.revision}`)
  await page.locator('#dialog-fields [name="x1"]').fill('10')
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#app-dialog')).not.toBeVisible()
  await expect(page.locator('#revision')).toHaveText(`REV ${document.revision + 1}`)
  const pending = page.waitForEvent('download'); await page.locator('#export-svg').click()
  const download = await pending; expect(download.suggestedFilename()).toBe('drawing.svg')
  const svg = await readFile(await download.path(), 'utf8')
  expect(svg).toContain('width="420mm"'); expect(svg).toContain('height="297mm"'); expect(svg).toContain('matrix(10 0 0 -10 20 277)')
  expect(svg).toContain('道路工程图 / Road detail')
  const revisionBeforePng = await page.locator('#revision').textContent()
  const pngPending = page.waitForEvent('download'); await page.locator('#export-png').click()
  const pngDownload = await pngPending; expect(pngDownload.suggestedFilename()).toBe('drawing.png')
  const png = await readFile(await pngDownload.path())
  expect([...png.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10])
  expect(png.readUInt32BE(16)).toBeGreaterThan(0); expect(png.readUInt32BE(16)).toBeLessThanOrEqual(1600)
  expect(png.readUInt32BE(20)).toBeGreaterThan(0); expect(png.readUInt32BE(20)).toBeLessThanOrEqual(1600)
  await expect(page.locator('#status')).toContainText('px · PNG')
  await expect(page.locator('#revision')).toHaveText(revisionBeforePng)
  const project = await saved(page), output = project.activeDocument
  // KJD/KJP canonicalize object key order and omit undefined fields; compare all persisted geometry by stable ID.
  const entities = drawing => JSON.parse(JSON.stringify(drawing.listEntities().map(e=>({id:e.id,handle:e.handle,ownerId:e.ownerId,type:e.type,payload:e.payload})))).sort((a,b)=>a.id.localeCompare(b.id))
  expect(entities(output)).toEqual(entities(document))
  expect(output.getObject(layoutId).payload.dxfPlotSettings.scaleNumerator).toBe(1000)
  expect(output.getObject(layoutId).payload.dxfPlotSettings.scaleDenominator).toBe(100)
  project.destroy()
  await page.locator('#undo').click()
  const restored = await saved(page); expect(restored.activeDocument.getObject(layoutId).payload.dxfPlotSettings).toBeUndefined(); restored.destroy()
  await page.locator('#redo').click(); await expect(page.locator('#status')).not.toContainText('does not fit')
})

test('page setup switches ISO presets and orientation without losing custom output values', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium integration check covers dialog field linkage')
  await openFixture(page)
  await setup(page, { width:333, height:222, margin:12, denominator:250, x0:-2, y0:-3, x1:11, y1:12 })
  await page.locator('#page-setup').click()
  const fields = page.locator('#dialog-fields')
  await expect(fields.locator('[name="paperPreset"]')).toHaveValue('custom')
  await expect(fields.locator('[name="paperOrientation"]')).toHaveValue('landscape')
  await fields.locator('[name="paperPreset"]').selectOption('A4')
  await expect(fields.locator('[name="width"]')).toHaveValue('297')
  await expect(fields.locator('[name="height"]')).toHaveValue('210')
  await expect(fields.locator('[name="margin"]')).toHaveValue('12')
  await expect(fields.locator('[name="denominator"]')).toHaveValue('250')
  await expect(fields.locator('[name="x0"]')).toHaveValue('-2')
  await expect(fields.locator('[name="y0"]')).toHaveValue('-3')
  await expect(fields.locator('[name="x1"]')).toHaveValue('11')
  await expect(fields.locator('[name="y1"]')).toHaveValue('12')
  await fields.locator('[name="paperOrientation"]').selectOption('portrait')
  await expect(fields.locator('[name="width"]')).toHaveValue('210')
  await expect(fields.locator('[name="height"]')).toHaveValue('297')
  await fields.locator('[name="paperPreset"]').selectOption('custom')
  await expect(fields.locator('[name="width"]')).toHaveValue('333')
  await expect(fields.locator('[name="height"]')).toHaveValue('222')
  await page.keyboard.press('Escape')
})

test('main editor opens a vector print preview and prints only from its explicit PDF action', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Preview dispatch and actual PDF bytes are covered once in Chromium')
  await openFixture(page); await setup(page)
  await page.evaluate(()=>{const open=window.open.bind(window);window.previewPrints=0;window.open=(...args)=>{const popup=open(...args);if(popup){const print=popup.print.bind(popup);popup.print=()=>{window.previewPrints++;print()}}return popup}})
  const popupEvent = page.waitForEvent('popup'); await page.locator('#print-drawing').click(); const popup = await popupEvent
  await expect(popup.locator('.kj-print-sheet svg')).toBeVisible()
  await expect(popup.locator('.kj-print-sheet svg')).toHaveAttribute('width', '420mm')
  await expect(popup.locator('.kj-print-preview')).toContainText('420 × 297 mm')
  await expect(popup.locator('.kj-print-preview')).toContainText('Scale 1:100')
  await expect(popup.locator('.kj-print-preview')).toContainText('REV')
  await expect(popup.locator('.kj-print-status')).toContainText('actual size')
  await expect(page.locator('#status')).toContainText('Print preview opened')
  await expect(popup.locator('#kj-print-action')).toBeEnabled()
  await expect(popup.locator('#kj-print-action')).toHaveText('Print / Save PDF')
  expect(await page.evaluate(()=>window.previewPrints)).toBe(0)
  expect(await popup.evaluate(()=>window.opener)).toBe(null)
  expect(await popup.locator('.kj-print-sheet').evaluate(e=>e.getBoundingClientRect().width)).toBeCloseTo(420*96/25.4, 1)
  await popup.locator('#kj-print-action').click()
  await expect.poll(()=>page.evaluate(()=>window.previewPrints)).toBe(1)
  const bytes = await popup.pdf({ preferCSSPageSize:true, printBackground:true })
  expect(bytes.subarray(0,4).toString()).toBe('%PDF')
  await closePrintPreview(popup)
  await expect.poll(()=>popup.isClosed()).toBe(true)
})

test('unconfigured output actions fit A3 automatically while page setup keeps fixed scale optional and cancellable', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#language').click()
  const svgDownload=page.waitForEvent('download')
  await page.locator('#export-svg').click()
  expect((await svgDownload).suggestedFilename()).toBe('drawing.svg')
  await expect(page.locator('#app-dialog')).not.toBeVisible()

  await page.locator('#page-setup').click()
  await expect(page.locator('#dialog-fields [name="scaleMode"]')).toHaveValue('fit')
  await expect(page.locator('#dialog-fields [name="denominator"]')).toBeDisabled()
  await page.locator('#dialog-fields [name="scaleMode"]').selectOption('custom')
  const x0=await page.locator('#dialog-fields [name="x0"]').inputValue()
  await page.locator('#dialog-fields [name="x1"]').fill(x0)
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#dialog-error')).toBeVisible()
  await page.locator('#dialog-form button[value="cancel"]').click()
  await expect(page.locator('#app-dialog')).not.toBeVisible()

  await page.reload()
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const popupEvent=page.waitForEvent('popup')
  await page.locator('#print-drawing').click()
  const popup=await popupEvent
  await expect(popup.locator('#kj-print-action')).toBeEnabled()
  await closePrintPreview(popup)
})

test('first output centers the resilient campus from drawing geometry after the viewport is panned', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium check covers the shared SVG, PNG and print placement')
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#sample-select').selectOption('sample-resilient-campus')
  await expect(page.locator('#sample-select')).toHaveValue('sample-resilient-campus')

  const canvas = page.locator('#canvas'), box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2)
  await page.mouse.down({ button:'middle' })
  await page.mouse.move(box.x + box.width/2 + 260, box.y + box.height/2 - 150, { steps:4 })
  await page.mouse.up({ button:'middle' })

  const svgPending = page.waitForEvent('download')
  await page.locator('#export-svg').click()
  const downloadedSvg = await readFile(await (await svgPending).path(), 'utf8')
  const downloadedMatrix = downloadedSvg.match(/data-space-id="[^"]+" transform="matrix\(([^)]+)\)"/)?.[1]
  expect(downloadedMatrix).toBeTruthy()

  const project = await saved(page), drawing = project.activeDocument, layoutId = drawing.snapshot().spaces.layoutIds[0]
  const svg = exportDrawingSvg(drawing, { layoutId }), png = resolveDrawingPngPlot(drawing, { layoutId })
  expect(svg.plot.sourceRange).toEqual({ kind:'window', minimum:[-8,-14], maximum:[268,160] })
  const center = [130,73], transform = (matrix, point) => [matrix[0]*point[0]+matrix[2]*point[1]+matrix[4], matrix[1]*point[0]+matrix[3]*point[1]+matrix[5]]
  expect(transform(svg.plot.drawingToPaperMatrix, center)[0]).toBeCloseTo(210, 10)
  expect(transform(svg.plot.drawingToPaperMatrix, center)[1]).toBeCloseTo(148.5, 10)
  const pngCenter = transform(png.plot.drawingToPixelMatrix, center)
  expect(pngCenter[0]).toBeCloseTo(png.width/2, 8)
  expect(pngCenter[1]).toBeCloseTo(png.height/2, 8)
  expect(downloadedMatrix).toBe(svg.plot.drawingToPaperMatrix.join(' '))

  const pngPending = page.waitForEvent('download'); await page.locator('#export-png').click()
  expect((await pngPending).suggestedFilename()).toBe('drawing.png')
  const popupEvent = page.waitForEvent('popup'); await page.locator('#print-drawing').click(); const popup = await popupEvent
  await expect(popup.locator('[data-space-id]')).toHaveAttribute('transform', `matrix(${downloadedMatrix})`)
  await closePrintPreview(popup); project.destroy()
})

test('Chinese desktop page setup keeps cancel and continue visible while fields scroll', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium desktop layout check covers the page setup action row')
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.addInitScript(() => localStorage.setItem('kjdraw.language', 'zh'))
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#page-setup').click()

  const layout = await page.evaluate(() => {
    const dialog = document.querySelector('#app-dialog')
    const fields = document.querySelector('#dialog-fields')
    const cancel = document.querySelector('#dialog-form button[value="cancel"]')
    const submit = document.querySelector('#dialog-submit')
    const rect = element => element.getBoundingClientRect()
    return {
      dialogBottom: rect(dialog).bottom,
      fieldsScrollable: fields.scrollHeight > fields.clientHeight,
      cancelBottom: rect(cancel).bottom,
      submitBottom: rect(submit).bottom,
      viewportHeight: innerHeight,
    }
  })
  expect(layout.dialogBottom).toBeLessThanOrEqual(layout.viewportHeight)
  expect(layout.fieldsScrollable).toBe(true)
  expect(layout.cancelBottom).toBeLessThanOrEqual(layout.viewportHeight)
  expect(layout.submitBottom).toBeLessThanOrEqual(layout.viewportHeight)
  await expect(page.locator('#dialog-form button[value="cancel"]')).toHaveText('取消')
  await page.locator('#dialog-form button[value="cancel"]').click()
  await expect(page.locator('#app-dialog')).not.toBeVisible()
})
