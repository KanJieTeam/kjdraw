// Reproducible live-model README capture. The runner records evidence in a new
// directory and never reads provider credentials; /api/model is owned by the host.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJProjectSession } from '../packages/kjdraw-sdk/src/project-session.js'
import { extractKJModelUsage } from '../packages/kjdraw-sdk/src/model-usage.js'
import { independentValidation } from './benchmarks/paired-model-benchmark.mjs'
import { manufacturingDrawingRequirements } from './benchmarks/manufacturing-drawing-tasks.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const repositoryRoot = resolve(dirname(scriptPath), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const captureSourcePaths = Object.freeze([
  'apps/playground',
  'packages/kjdraw-sdk/src',
  'web/public/kjcore',
  'scripts/serve.mjs',
  'scripts/model-proxy.mjs',
  'scripts/capture-live-readme-workflow.mjs',
  'scripts/capture-readme-demo.py',
  'scripts/benchmarks/paired-model-benchmark.mjs',
  'scripts/benchmarks/manufacturing-model-validator.py',
  'scripts/benchmarks/manufacturing-drawing-tasks.mjs',
])
const locales = new Set(['en', 'zh-CN'])
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])
const prompts = Object.freeze({
  en: 'Create an editable ISO A2 landscape manufacturing drawing JIG-300-180-A, revision A, titled HIGH-DENSITY MODULAR FIXTURE PLATE, material MIC6 CAST ALUMINIUM TOOLING PLATE, quantity 1. The plate is 300 × 180 × 12 mm. Add an 8 × 12 grid of Ø5 through holes starting at (30,30), with X/Y pitch 22/17; four 2 × 2 mounting holes starting at (15,15), pitch 270/150, Ø8.5 through with Ø14 counterbores depth 7; and two horizontal 40 × 10 through slots centered at (75,165) and (225,165). Include 1:1 top/front views, standard layers, center/hidden lines, native dimensions, title block and machining notes. Keep everything editable and show the complete preview before applying.',
  'zh-CN': '绘制一张 ISO A2 横向制造工程图：图号 JIG-300-180-A，修订 A，标题 HIGH-DENSITY MODULAR FIXTURE PLATE，材料 MIC6 CAST ALUMINIUM TOOLING PLATE，数量 1。板件 300×180×12 mm；8×12 个 Ø5 通孔，首孔 (30,30)，X/Y 间距 22/17；四个 2×2 安装孔，首孔 (15,15)，X/Y 间距 270/150，Ø8.5 通孔、Ø14 沉孔深 7；两个 40×10 水平通槽，中心 (75,165) 和 (225,165)。包含 1:1 顶视图/前视图、标准图层、中心线/隐藏线、原生尺寸、标题栏和加工说明。全部可编辑，先完整预览再应用。',
})
const movePrompts = Object.freeze({
  en: 'Move only the currently selected REV: A note exactly 5 millimeters to the right. Use one cad_propose_move proposal with dx 5 and dy 0. Keep all other objects unchanged.',
  'zh-CN': '仅将当前选中的 REV: A 说明文字向右精确移动 5 毫米。只使用一次 cad_propose_move 提案，dx 为 5、dy 为 0，其余对象保持不变。',
})

function argumentMap(argv) {
  const result = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const equal = token.indexOf('=')
    const key = token.slice(2, equal < 0 ? undefined : equal)
    if (!key || result.has(key)) throw new Error(`Duplicate or empty option: ${token}`)
    if (equal >= 0) result.set(key, token.slice(equal + 1))
    else {
      const next = argv[index + 1]
      if (next && !next.startsWith('--')) { result.set(key, next); index++ }
      else result.set(key, true)
    }
  }
  return result
}

/** Parse and validate CLI options without touching the filesystem or network. */
export function captureLiveReadmeConfiguration(argv = process.argv.slice(2)) {
  const args = argumentMap(argv)
  const allowed = new Set(['live', 'fixture', 'dry-run', 'base-url', 'model', 'locale', 'output', 'python', 'media-python', 'chrome', 'timeout-ms'])
  for (const key of args.keys()) if (!allowed.has(key)) throw new Error(`Unknown option --${key}`)
  const live = args.has('live'), fixture = args.has('fixture')
  if (live === fixture) throw new Error('Choose exactly one of --live or --fixture')
  for (const flag of ['live', 'fixture', 'dry-run']) if (args.has(flag) && args.get(flag) !== true) throw new Error(`--${flag} does not accept a value`)
  const locale = String(args.get('locale') ?? 'en')
  if (!locales.has(locale)) throw new Error('--locale must be en or zh-CN')
  const model = String(args.get('model') ?? '').trim()
  if (!model || model.length > 256 || /[\r\n]/.test(model)) throw new Error('Provide a bounded --model name')
  const rawBase = String(args.get('base-url') ?? '')
  let baseURL
  try { baseURL = new URL(rawBase) } catch { throw new Error('Provide a valid --base-url') }
  if (!['http:', 'https:'].includes(baseURL.protocol) || !loopback.has(baseURL.hostname) || baseURL.username || baseURL.password || baseURL.search || baseURL.hash) throw new Error('--base-url must be a credential-free loopback HTTP(S) URL')
  baseURL.pathname = baseURL.pathname.endsWith('/') ? baseURL.pathname : `${baseURL.pathname}/`
  const rawOutput = args.get('output')
  if (typeof rawOutput !== 'string' || !rawOutput.trim()) throw new Error('Provide a new --output directory')
  const timeoutMs = Number(args.get('timeout-ms') ?? 180000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30000 || timeoutMs > 300000) throw new Error('--timeout-ms must be an integer from 30000 to 300000')
  const python = String(args.get('python') ?? process.env.KJDRAW_PYTHON ?? (existsSync('D:/anaconda/python.exe') ? 'D:/anaconda/python.exe' : 'python'))
  const mediaPython = String(args.get('media-python') ?? process.env.KJDRAW_MEDIA_PYTHON ?? python)
  const chrome = String(args.get('chrome') ?? process.env.KJDRAW_CHROME_PATH ?? '') || undefined
  return Object.freeze({
    mode: live ? 'live' : 'fixture', dryRun: args.has('dry-run'), protocol: 'chat-completions',
    baseURL: baseURL.href, model, locale, output: resolve(String(rawOutput)), python, mediaPython, chrome, timeoutMs,
  })
}

export function liveReadmeCapturePlan(configuration) {
  return Object.freeze({
    schema: 'com.kanjie.kjdraw.readme-capture-plan@1', mode: configuration.mode,
    dryRun: true, networkRequests: 2, browser: 'chromium', source: 'blank-millimeter-drawing',
    workflow: ['semantic-manufacturing-proposal', 'host-preview', 'host-approval', 'select-existing-revision-note', 'strict-move-proposal', 'host-preview', 'host-approval', 'save-kjp', 'new-drawing', 'file-input-reopen', 'export-dxf', 'independent-manufacturing-validation', 'record-webm', 'assemble-gif', 'write-evidence'],
    protocol: configuration.protocol, baseOrigin: new URL(configuration.baseURL).origin,
    requestedModel: configuration.model, locale: configuration.locale, output: configuration.output,
    publishableModelEvidence: false, publicationReviewRequired: true,
    fixtureWarning: configuration.mode === 'fixture' ? 'LOCAL FIXTURE TRANSPORT. This run can test the capture path but must never be used in public model claims.' : null,
  })
}

async function waitForServer(baseURL, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 30000)
  while (Date.now() < deadline) {
    try { const response = await fetch(baseURL); if (response.ok) return } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
  throw new Error(`KJDraw server did not become ready at ${baseURL}`)
}

async function writeExclusive(path, value) {
  await writeFile(path, value, { flag: 'wx' })
}

async function writeAtomic(path, value) {
  const temporary = `${path}.next`
  await writeFile(temporary, value, { flag: 'wx' })
  await rename(temporary, path)
}

async function downloadBytes(page, action) {
  const pending = page.waitForEvent('download')
  await action()
  const download = await pending
  const path = await download.path()
  if (!path) throw new Error('Browser download has no local path')
  return readFile(path)
}

async function projectState(bytes) {
  const sdk = createKJDrawSDK()
  const project = await KJProjectSession.open(bytes, { sdk })
  const drawing = project.activeDocument
  const entities = drawing.listEntities({ ownerId: drawing.snapshot().spaces.modelSpaceId })
  return { sdk, project, drawing, entities }
}

function entityTypeCounts(entities) {
  const counts = {}
  for (const entity of entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function changedEntities(before, after) {
  const previous = new Map(before.map(entity => [entity.id, entity]))
  const current = new Map(after.map(entity => [entity.id, entity]))
  const ids = new Set([...previous.keys(), ...current.keys()])
  return [...ids].filter(id => JSON.stringify(previous.get(id)?.payload) !== JSON.stringify(current.get(id)?.payload)).sort()
}

async function screenPoint(page, point, bounds = [0, 0, 594, 420]) {
  const box = await page.locator('#canvas').boundingBox()
  if (!box) throw new Error('Drawing canvas is unavailable')
  const width = bounds[2] - bounds[0], height = bounds[3] - bounds[1]
  const scale = Math.min((box.width - 164) / width, (box.height - 164) / height)
  return {
    x: box.x + box.width / 2 + (point[0] - (bounds[0] + bounds[2]) / 2) * scale,
    y: box.y + box.height / 2 - (point[1] - (bounds[1] + bounds[3]) / 2) * scale,
  }
}

async function selectRevisionText(page, target) {
  await page.locator('#properties-tab').click()
  for (const offset of [[1, 1], [3, 1], [5, 1], [2, -1], [6, -1]]) {
    await page.keyboard.press('Escape')
    const point = await screenPoint(page, [target.payload.position[0] + offset[0], target.payload.position[1] + offset[1]])
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(100)
    if ((await page.locator('#selection-count').textContent())?.startsWith('1 ') && (await page.locator('#inspector').textContent())?.includes('REV: A')) return
  }
  throw new Error('Could not select the REV: A TEXT through the visible canvas')
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0 || !/^[a-f0-9]{40}$/.test(result.stdout.trim())) throw new Error('Cannot bind capture to git HEAD')
  return result.stdout.trim()
}

function sourceCommitBinding(mode) {
  const head = gitHead()
  if (mode !== 'live') return head
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...captureSourcePaths], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('Cannot verify capture/runtime source state')
  if (result.stdout.trim()) throw new Error(`Live README evidence requires committed, clean capture/runtime sources:\n${result.stdout.trim()}`)
  return head
}

function trackedCaptureSources() {
  const result = spawnSync('git', ['ls-files', '-z', '--', ...captureSourcePaths], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('Cannot enumerate capture/runtime sources')
  // The capture runner can be exercised in fixture mode before its first commit.
  // Keep it in the evidence even when git ls-files cannot see it yet.
  return [...new Set(['scripts/capture-live-readme-workflow.mjs', ...result.stdout.split('\0').filter(Boolean)])].sort()
}

/** Run the two-turn browser workflow against an already configured /api/model host. */
export async function runLiveReadmeWorkflow(configuration) {
  if (!configuration || !['live', 'fixture'].includes(configuration.mode)) throw new Error('Use captureLiveReadmeConfiguration first')
  if (configuration.dryRun) return liveReadmeCapturePlan(configuration)
  const sourceCommit = sourceCommitBinding(configuration.mode)
  await mkdir(dirname(configuration.output), { recursive: true })
  await mkdir(configuration.output) // Deliberately exclusive: an existing evidence directory is never reused.
  await waitForServer(configuration.baseURL, configuration.timeoutMs)

  const labels = configuration.locale === 'zh-CN'
    ? { connect: '连接模型', use: '使用此连接', preview: '在图中预览', apply: '应用修改' }
    : { connect: 'Connect model', use: 'Use this connection', preview: 'Preview on drawing', apply: 'Apply changes' }
  const prompt = prompts[configuration.locale], movePrompt = movePrompts[configuration.locale]
  const frames = [], calls = [], responseTasks = [], requestRecords = new WeakMap(), browserErrors = []
  const started = performance.now()
  let round = 'setup', browser, context, page, video, beforeState, finalState
  const launchOptions = { headless: true, ...(configuration.chrome ? { executablePath: configuration.chrome } : {}) }
  try {
    browser = await chromium.launch(launchOptions)
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 }, locale: configuration.locale === 'zh-CN' ? 'zh-CN' : 'en-US',
      deviceScaleFactor: 1, acceptDownloads: true, bypassCSP: true,
      recordVideo: { dir: configuration.output, size: { width: 1440, height: 900 } },
    })
    page = await context.newPage(); video = page.video(); page.setDefaultTimeout(configuration.timeoutMs)
    page.on('pageerror', error => browserErrors.push(String(error.message).slice(0, 500)))
    page.on('request', request => {
      if (new URL(request.url()).pathname !== '/api/model') return
      const body = request.postData() ?? ''
      const record = { round, sequence: calls.length + 1, requestBytes: Buffer.byteLength(body), requestSha256: hash(body), startedMs: performance.now() - started }
      calls.push(record); requestRecords.set(request, { record, startedAt: performance.now() })
    })
    page.on('response', response => {
      if (new URL(response.url()).pathname !== '/api/model') return
      const request = requestRecords.get(response.request())
      if (!request) return
      responseTasks.push((async () => {
        const bytes = await response.body(), elapsed = performance.now() - request.startedAt
        request.record.httpStatus = response.status(); request.record.responseBytes = bytes.length; request.record.responseSha256 = hash(bytes)
        request.record.transportWallMs = elapsed; request.record.finishedMs = performance.now() - started
        try {
          const json = JSON.parse(bytes.toString('utf8'))
          request.record.returnedModel = typeof json.model === 'string' ? json.model.slice(0, 256) : null
          request.record.usage = extractKJModelUsage('chat-completions', json, { latencyMs: elapsed })
        } catch { request.record.responseInvalid = true }
      })())
    })
    const settleResponses = async () => {
      for (;;) { const length = responseTasks.length; await Promise.all(responseTasks); if (length === responseTasks.length) return }
    }
    const capture = async (name, duration) => {
      const path = join(configuration.output, `${String(frames.length + 1).padStart(2, '0')}-${name}.png`)
      await page.screenshot({ path, animations: 'disabled' })
      frames.push({ path, duration })
    }
    const entityText = count => configuration.locale === 'zh-CN' ? `${count} 个对象` : `${count} entities`

    await page.goto(configuration.baseURL, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('.workbench')?.dataset.demoState === 'ready')
    const language = await page.locator('html').getAttribute('lang')
    if ((configuration.locale === 'zh-CN') !== language?.startsWith('zh')) await page.locator('#language').click()
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.chat-composer textarea{height:54px!important}.chat-data-attachment,.chat-attach-view,.chat-composer>small,#agent-examples{display:none!important}' })
    await page.locator('#new-drawing').click()
    await page.locator('#dialog-fields [name=name]').fill(configuration.locale === 'zh-CN' ? 'AI 高密度夹具板' : 'AI high-density fixture plate')
    await page.locator('#dialog-fields [name=units]').selectOption('millimeter'); await page.locator('#dialog-submit').click()
    await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('aria-busy') === 'false')
    if (!(await page.locator('#agent-tab').isVisible())) await page.locator('#toggle-inspector').click()
    await page.locator('#agent-tab').click(); await page.getByRole('button', { name: labels.connect, exact: true }).click()
    await page.locator('#chat-endpoint').fill('/api/model'); await page.locator('#chat-model').fill(configuration.model)
    await page.locator('#chat-protocol').selectOption('chat-completions'); await page.locator('#chat-max-output-tokens').selectOption('8192')
    await page.getByRole('button', { name: labels.use, exact: true }).click(); await capture('empty-ai-workspace', 900)

    round = 'generate'; await page.locator('#chat-input').fill(prompt); await capture('generation-prompt', 1500); await page.locator('#chat-send').click()
    await page.waitForTimeout(150); await capture('generation-working', 700)
    const firstEvidence = page.locator('.chat-manufacturing-evidence').last(); await firstEvidence.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelector('#chat-input')?.disabled === false); await settleResponses()
    if (await firstEvidence.getAttribute('data-entity-count') !== '409') throw new Error('Model did not propose the verified 409-entity manufacturing intent')
    if (await page.locator('#entity-count').textContent() !== entityText(0)) throw new Error('Generation proposal changed the drawing before approval')
    await capture('generation-proposal', 1500); await page.getByRole('button', { name: labels.preview, exact: true }).last().click(); await page.waitForTimeout(250)
    await capture('generation-preview', 1500); await page.getByRole('button', { name: labels.apply, exact: true }).last().click()
    await page.waitForFunction(text => document.querySelector('#entity-count')?.textContent === text, entityText(409)); await page.locator('#fit-ribbon').click(); await page.waitForTimeout(250)
    await capture('generated-sheet', 1800)

    const beforeBytes = await downloadBytes(page, () => page.locator('#save').click())
    await writeExclusive(join(configuration.output, 'before-move.kjp'), beforeBytes)
    beforeState = await projectState(beforeBytes)
    const target = beforeState.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === 'REV: A')
    if (!target) throw new Error('Generated drawing is missing the revision note target')
    await selectRevisionText(page, target); await page.locator('#agent-tab').click(); await capture('selected-revision-note', 1200)

    round = 'modify'; await page.locator('#chat-input').fill(movePrompt); await capture('move-prompt', 1500); await page.locator('#chat-send').click()
    await page.waitForTimeout(150); await capture('move-working', 700)
    const proposals = page.locator('.chat-proposal-state'); await proposals.last().waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelector('#chat-input')?.disabled === false); await settleResponses()
    await capture('move-proposal', 1400); await page.getByRole('button', { name: labels.preview, exact: true }).last().click(); await page.waitForTimeout(250)
    await capture('move-preview', 1400); await page.getByRole('button', { name: labels.apply, exact: true }).last().click()
    await page.waitForFunction(text => document.querySelector('#entity-count')?.textContent === text, entityText(409)); await page.locator('#fit-ribbon').click(); await page.waitForTimeout(250)
    await capture('move-applied', 1600)

    const finalBytes = await downloadBytes(page, () => page.locator('#save').click())
    await writeExclusive(join(configuration.output, 'workflow.kjp'), finalBytes)
    finalState = await projectState(finalBytes)
    const finalTarget = finalState.drawing.getObject(target.id), changed = changedEntities(beforeState.entities, finalState.entities)
    if (finalState.entities.length !== 409 || changed.length !== 1 || changed[0] !== target.id || finalTarget?.payload.text !== 'REV: A' || finalTarget.payload.position[0] !== target.payload.position[0] + 5 || finalTarget.payload.position[1] !== target.payload.position[1]) throw new Error('Strict move did not preserve the expected one-object geometry diff')

    await page.locator('#new-drawing').click(); await page.locator('#dialog-fields [name=name]').fill(configuration.locale === 'zh-CN' ? '重开验证' : 'Reopen check')
    await page.locator('#dialog-fields [name=units]').selectOption('millimeter'); await page.locator('#dialog-submit').click()
    await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('aria-busy') === 'false')
    await page.locator('#file-input').setInputFiles({ name: 'workflow.kjp', mimeType: 'application/zip', buffer: finalBytes })
    await page.waitForFunction(text => document.querySelector('#entity-count')?.textContent === text, entityText(409)); await page.locator('#fit-ribbon').click(); await page.waitForTimeout(250)
    await capture('reopened-project', 1800)
    const dxfBytes = await downloadBytes(page, () => page.locator('#export').click())
    await writeExclusive(join(configuration.output, 'workflow.dxf'), dxfBytes)
    const dxf = new TextDecoder().decode(dxfBytes)
    const validation = independentValidation({ python: configuration.python, dxf, expected: manufacturingDrawingRequirements(), taskSuite: 'manufacturing' })
    if (!validation.passed) throw new Error(`Independent manufacturing validation failed: ${validation.reason ?? 'unknown'}`)
    const validationText = `${JSON.stringify(validation, null, 2)}\n`
    await writeAtomic(join(configuration.output, 'validator.json'), validationText)
    await settleResponses()

    const mediaFrames = frames.map(frame => ({ ...frame, path: frame.path.slice(configuration.output.length + 1).replaceAll('\\', '/') }))
    await writeExclusive(join(configuration.output, 'manifest.json'), `${JSON.stringify({ locale: configuration.locale, width: 1120, frames: mediaFrames }, null, 2)}\n`)
    // Validation and media runtimes can be isolated installations. Do not leak a
    // validator PYTHONPATH into Pillow, where it could shadow native extensions.
    const mediaEnvironment = { ...process.env }
    delete mediaEnvironment.PYTHONPATH
    const pythonResult = spawnSync(configuration.mediaPython, [join(repositoryRoot, 'scripts/capture-readme-demo.py'), '--frames', configuration.output, '--output', join(configuration.output, 'workflow.gif')], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, env: mediaEnvironment })
    if (pythonResult.status !== 0) throw new Error(`${pythonResult.stdout ?? ''}${pythonResult.stderr ?? ''}`.trim() || 'GIF assembly failed')

    await context.close(); context = null
    const recordedPath = await video.path(), webmPath = join(configuration.output, 'workflow.webm')
    await rename(recordedPath, webmPath)
    await browser.close(); browser = null

    const sourceFiles = trackedCaptureSources()
    const sources = Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, hash(await readFile(join(repositoryRoot, name)))])))
    const artifacts = {}
    for (const name of ['before-move.kjp', 'workflow.kjp', 'workflow.dxf', 'validator.json', 'workflow.webm', 'workflow.gif']) {
      const bytes = await readFile(join(configuration.output, name)); artifacts[name] = { bytes: bytes.length, sha256: hash(bytes) }
    }
    const frameEvidence = await Promise.all(frames.map(async frame => { const bytes = await readFile(frame.path); return { file: frame.path.slice(configuration.output.length + 1).replaceAll('\\', '/'), durationMs: frame.duration, bytes: bytes.length, sha256: hash(bytes) } }))
    const generateCalls = calls.filter(call => call.round === 'generate'), modifyCalls = calls.filter(call => call.round === 'modify')
    if (!generateCalls.length || !modifyCalls.length || calls.some(call => call.httpStatus !== 200 || !call.usage || call.usage.invalidFields.length)) throw new Error('Complete provider usage evidence is required for every model request')
    const total = key => calls.reduce((sum, call) => sum + (call.usage[key] ?? 0), 0)
    const evidence = {
      schema: 'com.kanjie.kjdraw.readme-live-evidence@1', status: 'passed', mode: configuration.mode,
      publishableModelEvidence: configuration.mode === 'live', publicationReviewRequired: true,
      fixtureWarning: configuration.mode === 'fixture' ? 'LOCAL FIXTURE TRANSPORT. These model names, token counters and timings are simulated and must never be used in public claims.' : null,
      createdAt: new Date().toISOString(), gitHead: sourceCommit, sources,
      protocol: configuration.protocol, requestedModel: configuration.model,
      returnedModels: [...new Set(calls.map(call => call.returnedModel).filter(Boolean))], locale: configuration.locale,
      prompts: {
        generate: { text: prompt, utf8Bytes: Buffer.byteLength(prompt), sha256: hash(prompt) },
        modify: { text: movePrompt, utf8Bytes: Buffer.byteLength(movePrompt), sha256: hash(movePrompt) },
      },
      calls, totals: { requests: calls.length, inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), totalTokens: total('totalTokens'), transportWallMs: calls.reduce((sum, call) => sum + call.transportWallMs, 0), captureWallMs: performance.now() - started },
      geometry: {
        generation: { beforeRevision: 0, afterRevision: beforeState.drawing.revision, beforeEntityCount: 0, afterEntityCount: beforeState.entities.length, afterTypes: entityTypeCounts(beforeState.entities) },
        modification: { beforeRevision: beforeState.drawing.revision, afterRevision: finalState.drawing.revision, beforeEntityCount: beforeState.entities.length, afterEntityCount: finalState.entities.length, changedEntityIds: changed, target: { id: target.id, type: target.type, text: target.payload.text, beforePosition: target.payload.position, afterPosition: finalTarget.payload.position, delta: [5, 0, 0] } },
        independentValidation: validation,
      },
      reopen: { method: 'playground-file-input', entityCount: 409, revision: finalState.drawing.revision },
      artifacts, frames: frameEvidence, browserErrors,
    }
    if (browserErrors.length) throw new Error('Browser emitted page errors during capture')
    await writeAtomic(join(configuration.output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
    beforeState.project.destroy(); finalState.project.destroy()
    return evidence
  } finally {
    beforeState?.project?.destroy(); finalState?.project?.destroy()
    await context?.close().catch(() => {}); await browser?.close().catch(() => {})
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const configuration = captureLiveReadmeConfiguration()
  const result = configuration.dryRun ? liveReadmeCapturePlan(configuration) : await runLiveReadmeWorkflow(configuration)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
