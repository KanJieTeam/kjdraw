import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

if (process.env.KJDRAW_TEST_BASE_URL) test.use({ baseURL: process.env.KJDRAW_TEST_BASE_URL })

test('invalid local drawing shows a localized accessible error and permits retry without replacing the drawing', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  if (await page.locator('html').getAttribute('lang') !== 'zh-CN') await page.locator('#language').click()

  const original = {
    title: await page.locator('#drawing-title').textContent(),
    entities: await page.locator('#entity-count').textContent(),
    revision: await page.locator('#revision').textContent(),
  }
  const invalid = { name: 'broken.kjd', mimeType: 'application/json', buffer: Buffer.from('{broken') }

  await page.locator('#file-input').setInputFiles(invalid)
  const alert = page.locator('#file-open-error')
  await expect(alert).toBeVisible()
  await expect(alert).toHaveAttribute('role', 'alert')
  await expect(alert).toContainText('无法打开“broken.kjd”')
  await expect(alert).toContainText('当前图纸未更改')
  await expect(page.locator('#status')).toContainText('当前图纸未更改')
  await expect(page.locator('#drawing-title')).toHaveText(original.title)
  await expect(page.locator('#entity-count')).toHaveText(original.entities)
  await expect(page.locator('#revision')).toHaveText(original.revision)
  await expect(page.locator('#file-input')).toHaveValue('')

  const retry = page.waitForEvent('filechooser')
  await page.locator('#file-open-retry').click()
  await (await retry).setFiles(invalid)
  await expect(alert).toBeVisible()
  await expect(page.locator('#file-input')).toHaveValue('')

  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ title: 'Retry succeeded', units: 'millimeter' })
  const valid = { name: 'valid-after-retry.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' })) }
  const validRetry = page.waitForEvent('filechooser')
  await page.locator('#file-open-retry').click()
  await (await validRetry).setFiles(valid)
  await expect(alert).toBeHidden()
  await expect(page.locator('#file-state')).toHaveText('已在本地打开')
  await expect(page.locator('#entity-count')).toHaveText('0 个对象')
})
