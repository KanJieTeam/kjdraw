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
    let circle
    await document.transact('Browser sample', tx => {
      const defaultLayer = document.getTable('layers').records[0]
      const layer = tx.upsertTableRecord('layers', { name: '</script><script>globalThis.PWNED=1</script>', payload: structuredClone(defaultLayer.payload) })
      tx.createEntity('LINE', { start: [5, 5, 0], end: [5, 5, 0], layerId: layer.id })
      tx.createEntity('TEXT', { position: [10, 20, 0], text: '<img src=x onerror="globalThis.PWNED=1">', height: 3 })
      circle = tx.createEntity('CIRCLE', { center: [20, 10, 0], radius: 2 })
    })
    const before = path.join(directory, 'a.kjd'), after = path.join(directory, 'b.kjd')
    await writeFile(before, await sdk.writeDocument(document, { format: 'KJD' }), 'utf8')
    await document.transact('Revised circle', tx => tx.updateObject(circle.id, { payload: { center: [30, 15, 0], radius: 3 } }))
    await writeFile(after, await sdk.writeDocument(document, { format: 'KJD' }), 'utf8')
    const report = await reviewDrawingFiles({ before, after, units: 'millimeter', scope: 'model', identity: 'same-lineage-handles', window: [-10, -10, 50, 50] })
    expect(report.drawings[0].previews[0].report.diagnostics).toEqual([])
    const output = await writeReviewReport(report, path.join(directory, 'review'))
    const failures = [], requests = []
    page.on('pageerror', error => failures.push(error.message))
    page.on('request', request => { if (/^https?:/u.test(request.url())) requests.push(request.url()) })
    await page.goto(pathToFileURL(output).href)
    await expect(page.locator('svg')).toHaveCount(2)
    const beforeSvg = page.locator('[data-side="before"] svg'), afterSvg = page.locator('[data-side="after"] svg')
    const initialBefore = await beforeSvg.getAttribute('viewBox'), initialAfter = await afterSvg.getAttribute('viewBox')
    await page.getByRole('button', { name: 'Locate', exact: true }).first().click()
    await expect(page.locator('#focus-status')).toContainText('Highlighted 1 rendered groups')
    await expect(page.locator('svg .selected')).toHaveCount(1)
    await expect(page.locator('svg .focus-marker')).toHaveCount(1)
    expect(await beforeSvg.getAttribute('viewBox')).not.toBe(initialBefore)
    await page.getByRole('button', { name: 'Reset previews' }).click()
    await expect(page.locator('svg .selected')).toHaveCount(0)
    await expect(page.locator('svg .focus-marker')).toHaveCount(0)
    expect(await beforeSvg.getAttribute('viewBox')).toBe(initialBefore)
    expect(await afterSvg.getAttribute('viewBox')).toBe(initialAfter)
    await page.locator('tbody tr').filter({ hasText: 'modified / both' }).getByRole('button', { name: 'Locate', exact: true }).click()
    await expect(page.locator('#focus-status')).toContainText('Highlighted 2 rendered groups')
    expect(await beforeSvg.getAttribute('viewBox')).not.toBe(initialBefore)
    expect(await afterSvg.getAttribute('viewBox')).not.toBe(initialAfter)
    await expect(beforeSvg.locator('.selected')).toHaveCount(1)
    await expect(afterSvg.locator('.selected')).toHaveCount(1)
    await page.getByRole('button', { name: 'Reset previews' }).click()
    expect(await beforeSvg.getAttribute('viewBox')).toBe(initialBefore)
    expect(await afterSvg.getAttribute('viewBox')).toBe(initialAfter)
    await page.locator('#filter').fill('no matching observation')
    await expect(page.locator('tbody tr:visible')).toHaveCount(0)
    await page.locator('#filter').fill('zero-length')
    await expect(page.locator('tbody tr:visible')).toHaveCount(2)
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

test('duplicate Locate zooms to the union of all rendered block instances and marks every zero target', async ({ page }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kjdraw-report-union-'))
  try {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), duplicateIds = []
    await document.transact('Repeated duplicate geometry', tx => {
      const block = tx.upsertTableRecord('blockRecords', { name: 'Original repeated sample', type: 'BLOCK_RECORD', payload: { basePoint: [0, 0, 0], isSpace: false } })
      for (let index = 0; index < 2; index++) duplicateIds.push(tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }, { ownerId: block.id }).id)
      tx.createEntity('LINE', { start: [5, 5, 0], end: [5, 5, 0] }, { ownerId: block.id })
      for (const position of [[0, 0, 0], [100, 30, 0]]) tx.createEntity('INSERT', { blockRecordId: block.id, position, scale: [1, 1, 1] })
    })
    const before = path.join(directory, 'a.kjd')
    await writeFile(before, await sdk.writeDocument(document, { format: 'KJD' }), 'utf8')
    const report = await reviewDrawingFiles({ before, units: 'millimeter', scope: 'all', identity: 'semantic', window: [-20, -20, 150, 80] })
    const output = await writeReviewReport(report, path.join(directory, 'review'))
    await page.goto(pathToFileURL(output).href)
    const modelSvg = page.locator('[data-side="before"] svg').first()
    const initial = await modelSvg.getAttribute('viewBox')
    const bounds = await modelSvg.evaluate((svg, ids) => {
      const points = []
      for (const element of svg.querySelectorAll('[data-entity-id]')) {
        if (!ids.includes(element.getAttribute('data-entity-id'))) continue
        const box = element.getBBox(), transform = svg.getScreenCTM().inverse().multiply(element.getScreenCTM())
        for (const [x, y] of [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]) points.push(new DOMPoint(x, y).matrixTransform(transform))
      }
      return { minX: Math.min(...points.map(point => point.x)), minY: Math.min(...points.map(point => point.y)), maxX: Math.max(...points.map(point => point.x)), maxY: Math.max(...points.map(point => point.y)) }
    }, duplicateIds)
    await page.locator('tbody tr').filter({ hasText: 'exact-duplicate / before' }).getByRole('button', { name: 'Locate', exact: true }).click()
    await expect(modelSvg.locator('.selected')).toHaveCount(4)
    const [x, y, width, height] = (await modelSvg.getAttribute('viewBox')).split(' ').map(Number)
    expect(x).toBeLessThan(bounds.minX)
    expect(y).toBeLessThan(bounds.minY)
    expect(x + width).toBeGreaterThan(bounds.maxX)
    expect(y + height).toBeGreaterThan(bounds.maxY)
    await page.getByRole('button', { name: 'Reset previews' }).click()
    expect(await modelSvg.getAttribute('viewBox')).toBe(initial)
    await page.locator('tbody tr').filter({ hasText: 'zero-length-line / before' }).getByRole('button', { name: 'Locate', exact: true }).click()
    await expect(modelSvg.locator('.selected')).toHaveCount(2)
    await expect(modelSvg.locator('.focus-marker')).toHaveCount(2)
    await page.getByRole('button', { name: 'Reset previews' }).click()
    await expect(modelSvg.locator('.focus-marker')).toHaveCount(0)
    expect(await modelSvg.getAttribute('viewBox')).toBe(initial)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
