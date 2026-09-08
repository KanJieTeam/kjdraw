import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

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
  ...(process.env.KJDRAW_HTTP_PROXY ? { proxy: { server: process.env.KJDRAW_HTTP_PROXY } } : {}),
})
const checks = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' })
  const sha256 = value => createHash('sha256').update(value).digest('hex')
  for (const path of [
    'apps/playground/app.js', 'apps/playground/precision.css', 'apps/playground/theme-tokens.css', 'packages/kjdraw-sdk/src/theme.js',
    'packages/kjdraw-sdk/src/editor.js', 'packages/kjdraw-sdk/src/workbench.js', 'packages/kjdraw-sdk/src/layout.js',
    'packages/kjdraw-sdk/src/drafting.js', 'packages/kjdraw-sdk/src/modification-controls.js', 'packages/kjdraw-sdk/src/canvas-renderer.js', 'packages/kjdraw-sdk/src/dxf-adapter.js',
    'packages/kjdraw-sdk/src/selection-geometry.js', 'packages/kjdraw-sdk/src/edit-policy.js', 'packages/kjdraw-sdk/src/grips.js',
    'packages/kjdraw-sdk/src/react.js', 'packages/kjdraw-sdk/src/vue.js',
    'packages/kjdraw-sdk/src/geometry/annotation.js', 'packages/kjdraw-sdk/src/samples.js',
    'docs/latest/site-manifest.json', 'docs/latest/app.js', 'docs/latest/search-index.json', 'docs/latest/workbench/index.html',
    'docs/latest/api/search-index.json',
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

  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'live-move-verification', units: 'millimeter' })
  await drawing.transact('Verification line', tx => tx.createEntity('LINE', { start: [0, 0], end: [20, 0] }, { id: 'moving-line' }))
  await drawing.transact('Reference line', tx => tx.createEntity('LINE', { start: [0, 30], end: [20, 30] }, { id: 'reference-line' }))
  await page.locator('#file-input').setInputFiles({ name: 'verify.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' })) })
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  const box = await page.locator('#canvas').boundingBox()
  const scale = Math.min((box.width - 164) / 20, (box.height - 164) / 30)
  const at = (x, y) => ({ x: box.x + box.width / 2 + (x - 10) * scale, y: box.y + box.height / 2 - (y - 15) * scale })
  await page.locator('#move-selection').click()
  for (const position of [at(10, 0), at(10, 0), at(15, 5)]) await page.mouse.click(position.x, position.y)
  await expect(page.locator('#revision')).toHaveText('REV 3')
  for (const layout of ['compact', 'focus', 'classic']) {
    await page.locator('#layout-select').selectOption(layout)
    await expect(page.locator('.workbench')).toHaveAttribute('data-layout', layout)
    await expect(page.locator('#nav-fit')).toBeVisible()
    await expect(page.locator('#revision')).toHaveText('REV 3')
    assert((await page.locator('#canvas').boundingBox()).height > 300, `${layout}: canvas remains usable`)
  }
  const saved = page.waitForEvent('download')
  await page.locator('#save').click()
  const project = await KJProjectSession.open(await readFile(await (await saved).path()), { sdk: createKJDrawSDK() })
  const start = project.activeDocument.snapshot().objects['moving-line'].payload.start
  assert(Math.abs(start[0] - 5) < .2 && Math.abs(start[1] - 5) < .2, 'Saved coordinates reflect mouse movement')
  project.destroy()
  await page.locator('#undo').click()
  await expect(page.locator('#revision')).toHaveText('REV 4')
  checks.push('Mouse movement, three layouts, KJP saved coordinates and Undo work on the deployed page')

  await page.locator('#new-drawing').click()
  await page.locator('#dialog-fields input[name="name"]').fill('Release verification — workshop detail')
  await page.locator('#dialog-fields select[name="units"]').selectOption('millimeter')
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  const command = async value => {
    await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
    await page.locator('#command-input').fill(value)
    await page.locator('#command-input').press('Enter')
    await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
    assert.equal(await page.locator('.workbench').getAttribute('data-last-error'), null)
  }
  for (const steps of [
    ['RECTANGLE', '0,0', '180,120'],
    ['CIRCLE3P', '70,60', '90,80', '110,60'],
    ['ELLIPSE', '140,60', '160,60', '140,68'],
    ['DIMALIGNED', '0,0', '180,0', '90,-15'],
    ['DIMDIAMETER', '70,60', '110,60'],
  ]) {
    for (const value of steps) await command(value)
    await page.locator('#command-input').press('Escape')
  }
  await command('FIT')
  await expect(page.locator('#entity-count')).toHaveText('5 entities')
  const workshopDownload = page.waitForEvent('download')
  await page.locator('#save').click()
  const workshopBytes = await readFile(await (await workshopDownload).path())
  const workshop = await KJProjectSession.open(workshopBytes, { sdk: createKJDrawSDK() })
  const workshopObjects = workshop.activeDocument.snapshot().objects
  const workshopEntities = workshop.activeDocument.listEntities()
  assert.equal(workshop.activeDocument.snapshot().header.units, 'millimeter')
  assert.equal(workshopEntities.length, 5)
  assert.equal(workshopEntities.find(entity => entity.type === 'CIRCLE').payload.radius, 20)
  assert.equal(workshopEntities.find(entity => entity.type === 'ELLIPSE').payload.ratio, .4)
  assert.equal(workshopEntities.filter(entity => entity.type === 'DIMENSION').length, 2)
  workshop.destroy()
  await page.screenshot({ path: fileURLToPath(new URL('new-drawing.png', output)) })
  await page.locator('#file-input').setInputFiles({ name: 'workshop.kjp', mimeType: 'application/zip', buffer: workshopBytes })
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  const reopenedDownload = page.waitForEvent('download')
  await page.locator('#save').click()
  const reopened = await KJProjectSession.open(await readFile(await (await reopenedDownload).path()), { sdk: createKJDrawSDK() })
  assert.deepEqual(reopened.activeDocument.snapshot().objects, workshopObjects)
  reopened.destroy()
  checks.push('A new millimeter drawing accepts exact circle/ellipse/dimension construction, saves and reopens without geometry changes')

  await page.goto(new URL('docs/latest/api/', base).href)
  await expect(page).toHaveTitle('Editor API · KJDraw')
  await expect(page.locator('#method-setoptions')).toContainText('setOptions')
  await expect(page.locator('#method-setlayout')).toContainText('setLayout')
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
