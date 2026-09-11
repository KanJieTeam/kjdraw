import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJProjectSession } from '../../packages/kjdraw-sdk/src/project-session.js'

async function openFixture(page) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ title: '道路详图 / output', units: 'meter' })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0,0], end: [2,0] } })
  await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [0,1], text: '道路工程图 / Road detail', height: .1 } })
  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({ name: 'road-detail.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(document, { format: 'KJD' })) })
  await expect(page.locator('#entity-count')).toContainText('2 ')
  return { document, layoutId: document.snapshot().spaces.layoutIds[0] }
}
async function setup(page, overrides = {}) {
  await page.locator('#page-setup').click()
  for (const [name,value] of Object.entries({ width:420,height:297,margin:10,denominator:100,x0:-1,y0:-1,x1:10,y1:10,...overrides })) await page.locator(`#dialog-fields [name="${name}"]`).fill(String(value))
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#app-dialog')).not.toBeVisible()
}
async function saved(page) {
  const pending = page.waitForEvent('download'); await page.locator('#save').click()
  return KJProjectSession.open(await readFile(await (await pending).path()), { sdk: createKJDrawSDK() })
}

test('main editor configures a real 1:100 model page, downloads SVG and keeps geometry through save and undo', async ({ page }) => {
  const { document, layoutId } = await openFixture(page)
  await page.locator('.ribbon-tabs [data-i18n="modify"]').click()
  await expect(page.locator('#move-selection')).toBeVisible(); await expect(page.locator('.ribbon-group [data-tool="line"]').first()).not.toBeVisible()
  await expect(page.locator('#toggle-layers')).toBeVisible(); await expect(page.locator('#export-svg')).not.toBeVisible()
  await page.locator('.ribbon-tabs [data-i18n="inspect"]').click()
  await expect(page.locator('#measure-entity')).toBeVisible(); await expect(page.locator('#move-selection')).not.toBeVisible()
  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  await page.locator('#page-setup').click(); await page.keyboard.press('Escape')
  await expect(page.locator('#revision')).toHaveText(`REV ${document.revision}`)
  await setup(page, { x1:100 })
  await expect(page.locator('#status')).toContainText('does not fit')
  await expect(page.locator('#revision')).toHaveText(`REV ${document.revision}`)
  await setup(page)
  await expect(page.locator('#revision')).toHaveText(`REV ${document.revision + 1}`)
  const pending = page.waitForEvent('download'); await page.locator('#export-svg').click()
  const download = await pending; expect(download.suggestedFilename()).toBe('drawing.svg')
  const svg = await readFile(await download.path(), 'utf8')
  expect(svg).toContain('width="420mm"'); expect(svg).toContain('height="297mm"'); expect(svg).toContain('matrix(10 0 0 -10 20 277)')
  expect(svg).toContain('道路工程图 / Road detail')
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

test('main editor Print / PDF opens the selected configured layout as a physical vector sheet under the actual CSP', async ({ page }, testInfo) => {
  await openFixture(page); await setup(page)
  const popupEvent = page.waitForEvent('popup'); await page.locator('#print-drawing').click(); const popup = await popupEvent
  await expect(popup.locator('.kj-print-sheet svg')).toBeVisible()
  await expect(popup.locator('.kj-print-sheet svg')).toHaveAttribute('width', '420mm')
  await expect(popup.locator('.kj-print-note')).toContainText('100%')
  await expect(page.locator('#status')).toContainText('Print opened')
  expect(await popup.evaluate(()=>window.opener)).toBe(null)
  expect(await popup.locator('.kj-print-sheet').evaluate(e=>e.getBoundingClientRect().width)).toBeCloseTo(420*96/25.4, 1)
  if (testInfo.project.name === 'chromium') {
    const bytes = await popup.pdf({ preferCSSPageSize:true, printBackground:true })
    expect(bytes.subarray(0,4).toString()).toBe('%PDF')
  }
  await popup.close()
})
