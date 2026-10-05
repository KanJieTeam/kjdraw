import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

if (process.env.KJDRAW_TEST_BASE_URL) test.use({ baseURL: process.env.KJDRAW_TEST_BASE_URL })
test.use({ viewport: { width: 1024, height: 768 } })

async function command(page, value) {
  await page.locator('#command-input').fill(value)
  await page.locator('#command-input').press('Enter')
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.workbench')).not.toHaveAttribute('data-last-error', /.+/)
}

test('annotation and fill menus create native entities and remain reachable at 1024px', async ({ page }) => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'annotation-fill', units: 'millimeter' })
  await page.addInitScript(() => localStorage.setItem('kjdraw.language', 'en'))
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'annotation-fill.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' })) })
  await page.locator('.ribbon-tabs [data-i18n="draw"]').click()

  const annotation = page.locator('#annotation-tool'), fill = page.locator('#fill-tool'), ribbon = page.locator('.ribbon-groups')
  await expect(annotation).toHaveAttribute('aria-label', 'Annotation tool')
  await expect(fill).toHaveAttribute('aria-label', 'Fill tool')
  await expect(annotation.locator('option')).toHaveCount(8)
  await expect(annotation.locator('option', { hasText: 'Arc length' })).toHaveCount(0)
  await fill.scrollIntoViewIfNeeded()
  expect(await ribbon.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollLeft > 0)).toBe(true)
  const fillBox = await fill.boundingBox(); expect(fillBox.x).toBeGreaterThanOrEqual(0); expect(fillBox.x + fillBox.width).toBeLessThanOrEqual(1024)

  await annotation.selectOption('aligned')
  await expect(page.locator('#dimension-type')).toHaveValue('ALIGNED')
  await expect(page.locator('#drawing-tool')).toHaveValue('dimension')
  for (const point of ['0,0', '30,0', '15,-8']) await command(page, point)
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  await page.keyboard.press('Escape')

  await page.locator('.ribbon-tabs [data-i18n="draw"]').click()
  await fill.scrollIntoViewIfNeeded(); await fill.selectOption('ANSI37')
  await expect(page.locator('#hatch-pattern')).toHaveValue('ANSI37')
  await expect(page.locator('#drawing-tool')).toHaveValue('hatch')
  for (const point of ['0,0', '30,0', '30,20', '0,20']) await command(page, point)
  await command(page, 'C')
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await page.keyboard.press('Escape')

  await command(page, 'SELECTALL')
  await page.locator('.ribbon-tabs [data-i18n="draw"]').click(); await fill.scrollIntoViewIfNeeded()
  await expect(fill.locator('option[value="edit"]')).toBeEnabled()
  await fill.selectOption('edit')
  await expect(page.locator('#app-dialog')).toBeVisible()
  await expect(page.locator('#dialog-title')).toHaveText('Edit hatch')
  await page.locator('#app-dialog button[value="cancel"]').click()

  await page.locator('#language').click()
  await expect(annotation).toHaveAttribute('aria-label', '注释工具')
  await expect(fill).toHaveAttribute('aria-label', '填充工具')
  await expect(annotation.locator('option[value="angular"]')).toHaveText('角度标注')
  await expect(fill.locator('option[value="SOLID"]')).toContainText('实心')

  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  const pending = page.waitForEvent('download'); await page.locator('#save').click(); const download = await pending
  const session = await KJProjectSession.open(await readFile(await download.path()), { sdk: createKJDrawSDK() })
  const dimension = session.activeDocument.listEntities({ type: 'DIMENSION' })[0], hatch = session.activeDocument.listEntities({ type: 'HATCH' })[0]
  expect(dimension.payload.dimensionType).toBe('ALIGNED')
  expect(hatch.payload.patternName).toBe('ANSI37')
  expect(hatch.payload.boundaryLoops).toHaveLength(1)
  session.destroy()
})
