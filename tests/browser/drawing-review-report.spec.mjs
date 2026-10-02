import { test, expect } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { reviewDrawingFiles, writeReviewReport } from '../../examples/drawing-review/report.mjs'

test('self-contained drawing report locates actual SDK groups, resets and filters with CSP enabled', async ({ page }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kjdraw-report-browser-'))
  try {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    await document.transact('Browser sample', tx => {
      const defaultLayer = document.getTable('layers').records[0]
      const layer = tx.upsertTableRecord('layers', { name: '</script><script>globalThis.PWNED=1</script>', payload: structuredClone(defaultLayer.payload) })
      tx.createEntity('LINE', { start: [5, 5, 0], end: [5, 5, 0], layerId: layer.id })
      tx.createEntity('TEXT', { position: [10, 20, 0], text: '<img src=x onerror="globalThis.PWNED=1">', height: 3 })
    })
    const before = path.join(directory, 'a.kjd')
    await writeFile(before, await sdk.writeDocument(document, { format: 'KJD' }), 'utf8')
    const report = await reviewDrawingFiles({ before, units: 'millimeter', scope: 'model', identity: 'semantic', window: [-10, -10, 50, 50] })
    expect(report.drawings[0].previews[0].report.diagnostics).toEqual([])
    const output = await writeReviewReport(report, path.join(directory, 'review'))
    const failures = [], requests = []
    page.on('pageerror', error => failures.push(error.message))
    page.on('request', request => { if (/^https?:/u.test(request.url())) requests.push(request.url()) })
    await page.goto(pathToFileURL(output).href)
    await expect(page.locator('svg')).toHaveCount(1)
    const initial = await page.locator('svg').getAttribute('viewBox')
    await page.getByRole('button', { name: 'Locate', exact: true }).first().click()
    await expect(page.locator('#focus-status')).toContainText('Highlighted 1 rendered groups')
    await expect(page.locator('svg .selected')).toHaveCount(1)
    await expect(page.locator('svg .focus-marker')).toHaveCount(1)
    expect(await page.locator('svg').getAttribute('viewBox')).not.toBe(initial)
    await page.getByRole('button', { name: 'Reset previews' }).click()
    await expect(page.locator('svg .selected')).toHaveCount(0)
    await expect(page.locator('svg .focus-marker')).toHaveCount(0)
    expect(await page.locator('svg').getAttribute('viewBox')).toBe(initial)
    await page.locator('#filter').fill('no matching observation')
    await expect(page.locator('tbody tr:visible')).toHaveCount(0)
    await page.locator('#filter').fill('zero-length')
    await expect(page.locator('tbody tr:visible')).toHaveCount(1)
    await page.setViewportSize({ width: 375, height: 812 })
    const mobile = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(mobile.content).toBeLessThanOrEqual(mobile.viewport)
    await page.getByRole('button', { name: 'Locate', exact: true }).first().click()
    await expect(page.locator('#focus-status')).toContainText('Highlighted 1 rendered groups')
    expect(await page.evaluate(() => globalThis.PWNED)).toBeUndefined()
    expect(failures).toEqual([])
    expect(requests).toEqual([])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
