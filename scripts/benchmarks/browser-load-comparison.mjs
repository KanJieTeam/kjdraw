import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { cpus, platform, arch } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const manifestPath = process.env.KJDRAW_COMPARE_MANIFEST
const deps = process.env.KJDRAW_COMPARE_DEPS
const font = process.env.KJDRAW_COMPARE_FONT
const output = process.env.KJDRAW_COMPARE_OUTPUT
if (!manifestPath || !deps || !font || !output) throw new Error('Set KJDRAW_COMPARE_MANIFEST, KJDRAW_COMPARE_DEPS, KJDRAW_COMPARE_FONT and KJDRAW_COMPARE_OUTPUT; see the comparison protocol')
const repeats = Number(process.env.KJDRAW_COMPARE_REPEATS ?? 3)
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('Repeats must be 1–10')
const cases = JSON.parse(await readFile(manifestPath, 'utf8'))
if (!Array.isArray(cases) || !cases.length || cases.length > 30 || cases.some(c => !/^[a-z0-9-]+$/.test(c.id) || typeof c.path !== 'string') || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Expected 1–30 unique {id,path} cases')
const files = new Map()
const metadata = []
for (const row of cases) {
  const bytes = await readFile(row.path)
  if (bytes.length > 32 * 1024 * 1024) throw new Error('First comparison supports files up to 32 MiB')
  files.set(`/drawing/${row.id}`, bytes)
  metadata.push({ id: row.id, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
files.set('/font', await readFile(font))
const versions = {}
for (const pkg of ['dxf-viewer', 'dxf-parser']) versions[pkg] = JSON.parse(await readFile(join(deps, 'node_modules', pkg, 'package.json'), 'utf8')).version
const built = await build({ entryPoints: [fileURLToPath(new URL('./browser-load-client.mjs', import.meta.url))], bundle: true, format: 'esm', write: false, alias: Object.fromEntries(['dxf-viewer','dxf-parser'].map(pkg => [pkg, join(resolve(deps), 'node_modules', pkg)])), logLevel: 'silent' })
files.set('/client.js', built.outputFiles[0].contents)
files.set('/', Buffer.from('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#drawing{width:1280px;height:800px}</style></head><body><div id="drawing"></div><script type="module" src="/client.js"></script></body></html>'))
const server = createServer((req, res) => {
  const data = req.method === 'GET' ? files.get(req.url) : null
  if (!data) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html' : req.url === '/client.js' ? 'text/javascript' : 'application/octet-stream', 'Cache-Control': 'no-store' })
  res.end(data)
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const origin = `http://127.0.0.1:${server.address().port}`
await mkdir(output, { recursive: true })
let browser
const runs = []
try {
  browser = await chromium.launch({ executablePath: process.env.KJDRAW_CHROME_PATH || undefined, headless: true })
  const report = { schemaVersion: 1, versions, bundleSha256: createHash('sha256').update(built.outputFiles[0].contents).digest('hex'), browser: browser.version(), node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, viewport: [1280,800], deviceScaleFactor: 1, repeats, cases: metadata, runs, scope: 'Exploratory warm-library/local-byte API loading. Fonts fetched before timer. KJDraw constructs editable state; dxf-viewer constructs a viewing scene; dxf-parser only parses. Scheduled frame is not proof of correct display. Fresh context per run; no worker on either side. No public performance superiority claim.' }
  for (const row of cases) for (let round = 0; round < repeats; round++) {
    const engines = round % 2 ? ['dxf-parser','dxf-viewer','kjdraw'] : ['kjdraw','dxf-viewer','dxf-parser']
    for (const engine of engines) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
      let warnings = 0, errors = 0, blockedRequests = 0
      await context.route('**/*', route => {
        const url = route.request().url()
        if (url.startsWith(`${origin}/`) || url.startsWith('blob:')) return route.continue()
        blockedRequests++; return route.abort()
      })
      const page = await context.newPage()
      page.on('console', event => { if (event.type() === 'warning') warnings++; if (event.type() === 'error') errors++ })
      const entry = { id: row.id, engine, round }
      try {
        await page.goto(origin)
        await page.waitForFunction(() => typeof window.runLoadComparison === 'function')
        let timer
        try {
          Object.assign(entry, await Promise.race([
            page.evaluate(({ engine, id }) => window.runLoadComparison(engine, id), { engine, id: row.id }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Comparison timed out after 90 seconds')), 90000) }),
          ]))
        } finally { clearTimeout(timer) }
        if (round === 0 && engine !== 'dxf-parser') await page.screenshot({ path: join(output, `${row.id}-${engine}.png`) })
      } catch (error) { entry.error = error.message }
      finally { await context.close() }
      Object.assign(entry, { warnings, errors, blockedRequests })
      runs.push(entry)
      await writeFile(join(output, 'report.private.json'), JSON.stringify(report, null, 2))
      console.log(JSON.stringify(entry))
    }
  }
} finally {
  await browser?.close()
  await new Promise(done => server.close(done))
}
