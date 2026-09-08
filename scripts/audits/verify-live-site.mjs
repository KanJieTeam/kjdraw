import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

// Run after Pages succeeds, from the checkout that was deployed.
// Example: node scripts/audits/verify-live-site.mjs https://kanjieteam.github.io/kjdraw/
const root = new URL('../../', import.meta.url)
const base = new URL(process.argv[2] ?? 'https://kanjieteam.github.io/kjdraw/')
assert(['https:', 'http:'].includes(base.protocol), 'Use an HTTP(S) site URL')
if (!base.pathname.endsWith('/')) base.pathname += '/'
const output = new URL('.cache/live-site/', root)
await mkdir(output, { recursive: true })
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const browser = await chromium.launch({
  headless: true,
  ...(process.env.KJDRAW_CHROME_PATH ? { executablePath: process.env.KJDRAW_CHROME_PATH } : {}),
})
const checks = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' })
  const sha256 = value => createHash('sha256').update(value).digest('hex')
  for (const path of [
    'apps/playground/app.js', 'apps/playground/classic.css',
    'packages/kjdraw-sdk/src/editor.js', 'packages/kjdraw-sdk/src/workbench.js',
    'packages/kjdraw-sdk/src/canvas-renderer.js', 'packages/kjdraw-sdk/src/samples.js',
    'docs/latest/site-manifest.json', 'docs/latest/app.js',
    'docs/latest/api/editor-api.json', 'docs/latest/api/app.js',
    'docs/media/kjdraw-workflow.gif', 'docs/media/kjdraw-workflow-zh.gif',
  ]) {
    const url = new URL(path, base)
    url.searchParams.set('verify', String(Date.now()))
    const response = await context.request.get(url.href, { timeout: 30_000 })
    assert.equal(response.status(), 200, `${path}: HTTP status`)
    assert.equal(sha256(await response.body()), sha256(await readFile(new URL(path, root))), `${path}: deployed content differs from this checkout`)
  }
  checks.push('Deployed SDK, workbench, docs and GIF assets match this checkout')

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base.href)
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await expect(page.locator('#sample-select option')).toHaveCount(5)
  for (const id of ['sample-site-plan', 'sample-architecture', 'sample-road-profile', 'sample-mechanical']) {
    await page.locator('#sample-select').selectOption(id)
    await expect(page.locator('.document-tabs .active')).toHaveAttribute('data-document', id)
    await expect(page.locator('#entity-count')).not.toHaveText('0 entities')
  }
  await page.locator('#toggle-layers').click()
  await expect(page.locator('.left-panel')).toBeVisible()
  await page.screenshot({ path: fileURLToPath(new URL('workbench.png', output)) })
  checks.push('Industry drawings load and layer panels open')

  await page.locator('#sample-select').selectOption('sample-resilient-campus')
  await page.locator('#agent-tab').click()
  await page.locator('#plan').click()
  await expect(page.locator('#plan-state')).toContainText('NO MUTATION')
  await page.locator('#confirm').click()
  await expect(page.locator('#revision')).toHaveText('REV 14')
  await page.locator('#receipt-reopen').click()
  await expect(page.locator('#plan-state')).toContainText(/KJP reopen verified.*fingerprint match/)
  await page.locator('#receipt-undo').click()
  await expect(page.locator('#entity-count')).toHaveText('2,294 entities')
  checks.push('Agent preview, commit, KJP reopen and undo work on the deployed page')

  await page.goto(new URL('docs/latest/api/', base).href)
  await expect(page).toHaveTitle('Editor API · KJDraw')
  await expect(page.locator('#method-setoptions')).toContainText('setOptions')
  await page.screenshot({ path: fileURLToPath(new URL('editor-api.png', output)) })
  await page.locator('#api-search').fill('KJCanvasRenderer')
  await page.locator('#api-results a[href^="./reference/#"]').first().click()
  await expect(page.locator(':target')).toBeVisible()
  await page.goto(new URL('docs/latest/react/', base).href)
  await page.locator('#search-button').click()
  await page.locator('#search').fill('KJDrawEditor')
  await expect(page.locator('#results a[href*="/api/reference/#editor-class-kjdraweditor"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#search-dialog')).toBeHidden()
  await expect(page.locator('#search-button')).toBeFocused()
  await page.locator('#language').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  checks.push('Editor API, complete-reference links, guide search and Chinese switch work')
  assert.deepEqual(errors, [], 'Deployed pages must not raise JavaScript errors')
  console.log(JSON.stringify({ version: pkg.version, url: base.href, checks, screenshots: fileURLToPath(output) }, null, 2))
} finally {
  await browser.close()
}
