import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index]
  if (!value.startsWith('--')) continue
  const next = process.argv[index + 1]
  args.set(value.slice(2), next && !next.startsWith('--') ? (index += 1, next) : true)
}

const locale = args.get('locale') === 'zh-CN' ? 'zh-CN' : 'en'
const baseURL = String(args.get('base-url') || 'http://127.0.0.1:4173')
const framesDir = resolve(root, String(args.get('frames') || `.cache/readme-demo/${locale}`))
const output = resolve(root, String(args.get('output') || `docs/media/kjdraw-workflow${locale === 'zh-CN' ? '-zh' : ''}.gif`))
const shouldStartServer = !args.has('no-server')
// --frames may be customized, but cleanup must stay in this repository's cache.
const cacheRoot = resolve(root, '.cache')
const relativeFrames = relative(cacheRoot, framesDir)
if (!relativeFrames || relativeFrames === '..' || relativeFrames.startsWith(`..\\`) || relativeFrames.startsWith('../') || isAbsolute(relativeFrames)) {
  throw new Error('--frames must be a subdirectory of this repository\'s .cache directory')
}

const browserCandidates = [
  process.env.KJDRAW_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)
const executablePath = browserCandidates.find(candidate => existsSync(candidate))

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`KJDraw demo did not become ready at ${url}`)
}

let server
let browser
try {
  if (shouldStartServer) {
    server = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: root, stdio: 'ignore', windowsHide: true })
  }
  await waitForServer(baseURL)
  rmSync(framesDir, { recursive: true, force: true })
  mkdirSync(framesDir, { recursive: true })
  mkdirSync(dirname(output), { recursive: true })

  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: locale === 'zh-CN' ? 'zh-CN' : 'en-US', deviceScaleFactor: 1, bypassCSP: true })
  const page = await context.newPage()
  await page.goto(baseURL, { waitUntil: 'networkidle' })
  await page.locator('.workbench').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('data-demo-state') === 'ready')
  const language = await page.locator('html').getAttribute('lang')
  if ((locale === 'zh-CN') !== language?.startsWith('zh')) await page.locator('#language').click()

  await page.addStyleTag({ content: `
    *,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
    #readme-cursor{position:fixed;z-index:99999;width:18px;height:18px;border:3px solid #bcf878;border-radius:50%;box-shadow:0 0 0 5px #14212dcc,0 0 18px #bcf878;pointer-events:none;transform:translate(-50%,-50%)}
  ` })
  await page.evaluate(() => {
    const marker = document.createElement('div')
    marker.id = 'readme-cursor'
    document.body.append(marker)
  })

  const manifest = []
  async function placeCursor(selector, ratioX = 0.5, ratioY = 0.5) {
    const box = await page.locator(selector).boundingBox()
    if (!box) return
    await page.locator('#readme-cursor').evaluate((marker, point) => {
      marker.style.left = `${point.x}px`
      marker.style.top = `${point.y}px`
    }, { x: box.x + box.width * ratioX, y: box.y + box.height * ratioY })
  }
  async function capture(name, duration) {
    const path = resolve(framesDir, `${String(manifest.length + 1).padStart(2, '0')}-${name}.png`)
    await page.screenshot({ path, animations: 'disabled' })
    manifest.push({ path, duration })
  }

  await placeCursor('#canvas', 0.57, 0.48)
  await capture('site-plan', 1800)

  for (const id of ['sample-architecture', 'sample-road-profile', 'sample-mechanical']) {
    await page.locator('#sample-select').selectOption(id)
    await page.waitForFunction(value => document.querySelector('.document-tabs .active')?.getAttribute('data-document') === value, id)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await placeCursor('#canvas', 0.57, 0.48)
    await capture(id, 1700)
  }
  await page.locator('#sample-select').selectOption('sample-resilient-campus')
  await page.locator('.right-tabs [data-panel="agent"]').click()

  await placeCursor('#plan')
  await capture('describe-change', 850)
  await page.locator('#plan').click()
  await page.locator('#canvas-diff').waitFor({ state: 'visible' })
  await placeCursor('#confirm')
  await capture('review-diff', 1850)

  await page.locator('#confirm').click()
  await page.locator('#receipt-panel').waitFor({ state: 'visible' })
  await placeCursor('#receipt-reopen')
  await capture('commit-receipt', 1800)

  await page.locator('#receipt-reopen').click()
  await page.locator('#plan-state').filter({ hasText: locale === 'zh-CN' ? '指纹一致' : 'fingerprint match' }).waitFor()
  await placeCursor('#receipt-undo')
  await capture('verify-reopen', 1650)

  await page.locator('#receipt-undo').click()
  await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('data-demo-state') === 'undone')
  await placeCursor('#canvas', 0.57, 0.48)
  await capture('undo', 1600)

  // These frames use normal user controls, starting with a genuinely empty drawing.
  await page.locator('#new-drawing').click()
  await page.locator('#dialog-fields input[name="name"]').fill(locale === 'zh-CN' ? '安装板 · 精确绘图' : 'Mounting plate · precise drafting')
  await page.locator('#dialog-fields select[name="units"]').selectOption('millimeter')
  await page.locator('#dialog-submit').click()
  await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('aria-busy') === 'false')
  await page.locator('.right-tabs [data-panel="properties"]').click()
  async function command(value, { dialog = false } = {}) {
    await page.locator('#command-input').fill(value)
    await page.locator('#command-input').press('Enter')
    if (dialog) { await page.locator('#app-dialog').waitFor({ state: 'visible' }); return }
    await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('aria-busy') === 'false')
    const error = await page.locator('.workbench').getAttribute('data-last-error')
    if (error) throw new Error(`Readme capture command ${value}: ${error}`)
  }
  async function draw(tool, points) {
    await command(tool)
    for (const point of points) await command(point)
    await page.locator('#command-input').press('Escape')
  }
  await draw('RECTANGLE', ['0,0','180,120'])
  await draw('CIRCLE', ['90,60','22'])
  await draw('CIRCLE', ['130,60','5'])
  await command('FIT')
  await placeCursor('#canvas', .55, .5); await capture('draw-from-empty', 1400)
  const box = await page.locator('#canvas').boundingBox(), scale = Math.min((box.width - 164)/180, (box.height - 164)/120)
  await page.mouse.click(box.x + box.width/2 + 45*scale, box.y + box.height/2)
  await command('ARRAYPOLAR', { dialog: true })
  await page.locator('#dialog-submit').click()
  await command('90,60')
  await placeCursor('#canvas', .65, .5); await capture('polar-array', 1400)
  await draw('DIMALIGNED', ['0,0','180,0','90,-15'])
  await draw('DIMRADIUS', ['90,60','112,60'])
  await command('FIT')
  await placeCursor('#canvas', .5, .8); await capture('dimensioned-plate', 2000)

  writeFileSync(resolve(framesDir, 'manifest.json'), JSON.stringify({ locale, width: 1120, frames: manifest }, null, 2))
  await context.close()

  const python = process.env.PYTHON || 'python'
  const assembled = spawnSync(python, ['scripts/capture-readme-demo.py', '--frames', framesDir, '--output', output], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (assembled.status !== 0) {
    const reason = [assembled.stdout, assembled.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${reason}\nInstall the capture dependency with: python -m pip install Pillow`)
  }
  process.stdout.write(`${assembled.stdout.trim()}\n`)
} finally {
  await browser?.close().catch(() => {})
  server?.kill()
}
