import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

async function command(page, value) {
  await page.locator('#command-input').fill(value)
  await page.locator('#command-input').press('Enter')
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.workbench')).not.toHaveAttribute('data-last-error', /.+/)
}

test('MOVE and COPY accept absolute and relative points from the command line', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Focused playground interaction coverage runs once in Chromium')
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'translation-input', units: 'millimeter' })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } }, { document: drawing })
  await page.addInitScript(() => localStorage.setItem('kjdraw.language', 'en'))
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'translation-input.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' })) })

  await command(page, 'SELECTALL')
  await page.locator('.ribbon-tabs [data-i18n="modify"]').click()
  await page.locator('#move-selection').click()
  await command(page, '0,0')
  await expect(page.locator('#hint')).toContainText('target point')
  await command(page, '@10,0')
  await expect(page.locator('#entity-count')).toHaveText('1 entities')

  await command(page, 'SELECTALL')
  await page.locator('#copy-selection').click()
  await command(page, '10,0')
  await command(page, '@0,10')
  await expect(page.locator('#entity-count')).toHaveText('2 entities')

  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  const pending = page.waitForEvent('download'); await page.locator('#save').click(); const download = await pending
  const reopened = await KJProjectSession.open(await readFile(await download.path()), { sdk: createKJDrawSDK() })
  const segments = reopened.activeDocument.listEntities({ type: 'LINE' }).map(entity => [entity.payload.start, entity.payload.end]).sort((left, right) => left[0][1] - right[0][1])
  expect(segments).toEqual([[[10, 0, 0], [20, 0, 0]], [[10, 10, 0], [20, 10, 0]]])
  reopened.destroy()
})
