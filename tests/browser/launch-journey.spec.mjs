import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { openKjpPackage } from '../../packages/kjdraw-sdk/src/index.js'

function observe(page) {
  const problems = { page: [], console: [], dialogs: [], external: [] }
  page.on('pageerror', error => problems.page.push(error.message))
  page.on('console', entry => {
    if (['error', 'warning'].includes(entry.type())) problems.console.push(entry.text())
  })
  page.on('dialog', dialog => {
    problems.dialogs.push(dialog.type())
    void dialog.dismiss()
  })
  page.on('request', request => {
    const url = new URL(request.url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) problems.external.push(request.url())
  })
  return problems
}

test('2,294-entity Agent launch journey is deterministic and reversible', async ({ page }, testInfo) => {
  const problems = observe(page)
  await page.goto('/')
  if ((await page.locator('html').getAttribute('lang'))?.startsWith('zh')) await page.locator('#language').click()

  await expect(page.locator('#sample-select')).toHaveValue('sample-site-plan')
  await page.locator('#sample-select').selectOption('sample-resilient-campus')
  await expect(page.locator('#entity-count')).toHaveText('2,294 entities')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await expect(page.locator('#inspector')).toContainText('Rust / WASM')
  await expect(page.locator('#undo')).toBeDisabled()

  await page.locator('#agent-tab').click()
  await page.locator('#plan').click()
  await expect(page.locator('#plan-state')).toContainText('NO MUTATION')
  await expect(page.locator('#plan-steps')).toContainText('MOVE 33')
  await expect(page.locator('#plan-steps')).toContainText('ERASE 13')
  await expect(page.locator('#plan-steps')).toContainText('CREATE 21')
  await expect(page.locator('#revision')).toHaveText('REV 13')
  await expect(page.locator('#canvas-diff')).toBeVisible()

  await page.locator('#confirm').click()
  await expect(page.locator('#revision')).toHaveText('REV 14')
  await expect(page.locator('#entity-count')).toHaveText('2,302 entities')
  await expect(page.locator('#receipt-timeline')).toContainText('Human approval')
  await expect(page.locator('#receipt-timeline')).toContainText('Atomic transaction committed')

  const waiting = page.waitForEvent('download')
  await page.locator('#save').click()
  const download = await waiting
  const saved = testInfo.outputPath(`committed-${testInfo.project.name}.kjp`)
  await download.saveAs(saved)
  const project = await openKjpPackage(await readFile(saved))
  expect(project.activeDocument.listEntities()).toHaveLength(2302)

  await page.locator('#receipt-reopen').click()
  await expect(page.locator('#plan-state')).toContainText(/KJP reopen verified.*fingerprint match/)
  await page.locator('#receipt-undo').click()
  await expect(page.locator('#revision')).toHaveText('REV 15')
  await expect(page.locator('#entity-count')).toHaveText('2,294 entities')

  await page.locator('#language').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('#open')).toHaveText('打开')

  expect(problems.dialogs).toEqual([])
  expect(problems.page).toEqual([])
  expect(problems.console).toEqual([])
  expect(problems.external).toEqual([])
})

test('industry sample library switches complete drawings and keeps CAD panels separate', async ({ page }) => {
  const problems = observe(page)
  await page.goto('/')
  if ((await page.locator('html').getAttribute('lang'))?.startsWith('zh')) await page.locator('#language').click()

  await expect(page.locator('#sample-select option')).toHaveCount(5)
  await expect(page.locator('#sample-select')).toHaveValue('sample-site-plan')
  await expect(page.locator('#drawing-discipline')).toContainText('CIVIL')
  await expect(page.locator('#layers .layer')).toHaveCount(11)
  await expect(page.locator('.toolbar')).toHaveCount(0)

  for (const [id, discipline, layerCount] of [
    ['sample-architecture', 'ARCHITECTURE', 11],
    ['sample-road-profile', 'TRANSPORTATION', 10],
    ['sample-mechanical', 'MECHANICAL', 9],
  ]) {
    await page.locator('#sample-select').selectOption(id)
    await expect(page.locator('#drawing-discipline')).toContainText(discipline)
    await expect(page.locator('#layers .layer')).toHaveCount(layerCount)
    await expect(page.locator('#entity-count')).not.toHaveText('0 entities')
  }

  await expect(page.locator('[data-panel-view="properties"]')).toBeVisible()
  await expect(page.locator('[data-panel-view="agent"]')).toBeHidden()
  await page.locator('#agent-tab').click()
  await expect(page.locator('[data-panel-view="properties"]')).toBeHidden()
  await expect(page.locator('[data-panel-view="agent"]')).toBeVisible()
  await expect(page.locator('#plan')).toBeDisabled()

  await page.locator('#toggle-layers').click()
  await expect(page.locator('.left-panel')).toBeVisible()
  await page.locator('#close-layers').click()
  await expect(page.locator('.left-panel')).toBeHidden()

  expect(problems.dialogs).toEqual([])
  expect(problems.page).toEqual([])
  expect(problems.console).toEqual([])
  expect(problems.external).toEqual([])
})

test('workbench remains usable at a narrow viewport with accessible dialogs', async ({ page }) => {
  const problems = observe(page)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.locator('.right-panel')).toBeHidden()
  await expect(page.locator('.left-panel')).toBeHidden()

  const namedButtons = await page.locator('button:visible').evaluateAll(buttons => buttons.map(button => ({
    id: button.id,
    name: button.getAttribute('aria-label') || button.textContent?.trim() || button.getAttribute('title'),
  })))
  expect(namedButtons.filter(button => !button.name)).toEqual([])

  await page.locator('#new-drawing').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input[name="name"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(problems.dialogs).toEqual([])
  expect(problems.page).toEqual([])
  expect(problems.console).toEqual([])
  expect(problems.external).toEqual([])
})
