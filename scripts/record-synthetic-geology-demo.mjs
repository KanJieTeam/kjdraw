import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, relative, isAbsolute, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { chromium } from '@playwright/test'
import { exportSyntheticGeologyDemo, SYNTHETIC_GEOLOGY_PROVENANCE, SYNTHETIC_GEOLOGY_SCENARIOS } from '../examples/synthetic-geology-demo.mjs'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { readGeologyDrawingRecipe, prepareGeologyDrawingRevision } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { extractKJModelUsage } from '../packages/kjdraw-sdk/src/model-usage.js'
import { readAiModelResponse } from '../apps/playground/ai/model-response.js'
import { createModelProxy } from './model-proxy.mjs'
import { createBenchmarkProxyAgent } from './benchmarks/token-provider-transport.mjs'

// Default: prepare public synthetic files only. --live calls the real DeepSeek
// endpoint; --diagnostic explicitly records a NON-MODEL engineering workflow.
// Neither mode reads a caller/private drawing or simulates model responses.
const root = fileURLToPath(new URL('../', import.meta.url))
export async function runSyntheticGeologyRecording(argv = process.argv.slice(2)) {
const args = new Map()
for (let index = 0; index < argv.length; index++) {
  const key = argv[index]
  if (!key.startsWith('--')) throw new Error('Use named recording options')
  const next = argv[index + 1]
  if (args.has(key.slice(2))) throw new Error('Duplicate recording option')
  args.set(key.slice(2), next && !next.startsWith('--') ? argv[++index] : true)
}
const allowed = new Set(['live', 'diagnostic', 'prepare-only', 'output', 'scenarios', 'port', 'base-url', 'no-server', 'model', 'timeout-ms', 'ffmpeg'])
if ([...args.keys()].some(key => !allowed.has(key))) throw new Error('Unknown recording option')
if (args.has('live') && (args.has('diagnostic') || args.has('prepare-only'))) throw new Error('Choose exactly one recording mode')
for (const name of ['live', 'diagnostic', 'prepare-only', 'no-server']) if (args.has(name) && args.get(name) !== true) throw new Error(`--${name} is a flag`)
const output = resolve(root, args.get('output') || `.cache/synthetic-geology-demo/recording-${Date.now()}`)
const relativeOutput = relative(root, output)
if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith('..\\') || relativeOutput.startsWith('../') || isAbsolute(relativeOutput)) {
  throw new Error('--output must name a dedicated directory inside this checkout')
}
const selected = String(args.get('scenarios') || 'collar,depth,stable-water,lithology-pattern,sample-add,split-layer').split(',')
if (selected.some(id => !SYNTHETIC_GEOLOGY_SCENARIOS.some(scenario => scenario.id === id))) throw new Error('Unknown synthetic scenario')
if (args.has('live')) {
  if (process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT) throw new Error('Disable benchmark fixture endpoints before --live')
  if (!process.env.KJDRAW_DEEPSEEK_API_KEY || /[\r\n]/.test(process.env.KJDRAW_DEEPSEEK_API_KEY)) throw new Error('LIVE_CREDENTIAL_REQUIRED: load the existing project key into KJDRAW_DEEPSEEK_API_KEY; no model run occurred')
}
if ((args.has('live') || args.has('diagnostic')) && existsSync(output)) throw new Error('Record into a new directory; preserve prior success and failure evidence')
await mkdir(output, { recursive: true })
const prepared = await exportSyntheticGeologyDemo(output)
if (args.has('live')) {
  await recordLiveSyntheticGeology({ args, output })
} else if (args.has('prepare-only') || !args.has('diagnostic')) {
  console.log(JSON.stringify({ status: 'prepared', ...prepared.manifest }))
} else {
  const port = Number(args.get('port') || 43210)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be 1024-65535')
  const baseURL = String(args.get('base-url') || `http://127.0.0.1:${port}`)
  const parsedURL = new URL(baseURL)
  if (!['127.0.0.1', 'localhost'].includes(parsedURL.hostname) || parsedURL.protocol !== 'http:') throw new Error('Recording requires a local HTTP demo server')
  const candidates = [process.env.KJDRAW_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)
  const executablePath = candidates.find(path => existsSync(path))
  let server, browser, context
  const captures = [], facts = []
  try {
    if (!args.has('no-server')) server = spawn(process.execPath, ['scripts/serve.mjs'], {
      cwd: root, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: 'ignore',
    })
    let ready = false
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${baseURL}/ai/`)).ok) { ready = true; break } } catch {}
      await new Promise(resolveWait => setTimeout(resolveWait, 250))
    }
    if (!ready) throw new Error('Local synthetic recording server did not become ready')
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
    context = await browser.newContext({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1,
      locale: 'zh-CN', reducedMotion: 'reduce', bypassCSP: true, recordVideo: { dir: resolve(output, 'raw-video'), size: { width: 1440, height: 920 } } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${baseURL}/ai/`, { waitUntil: 'networkidle' })
    await page.evaluate(async () => {
      const { createSyntheticGeologyDemo, proposeSyntheticGeologyScenario, SYNTHETIC_GEOLOGY_SCENARIOS } = await import('/examples/synthetic-geology-demo.mjs')
      const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
      const { readGeologyDrawingRecipe } = await import('/packages/kjdraw-sdk/src/geology-drawing-update.js')
      const fixture = await createSyntheticGeologyDemo()
      document.title = 'Synthetic CAD workflow — no model invocation'
      document.body.innerHTML = `<style>
        *{box-sizing:border-box}body{margin:0;background:#edf1f5;color:#223044;font:15px "Microsoft YaHei",sans-serif}
        .demo{height:100vh;display:grid;grid-template-rows:88px 1fr 36px}header{padding:17px 26px;background:#13253b;color:#fff;display:flex;justify-content:space-between;align-items:center}
        h1{margin:0;font-size:24px;letter-spacing:.3px}.subtitle{margin-top:8px;color:#b9c9dc;font-size:13px}.badge{border:1px solid #7890a7;border-radius:20px;padding:8px 15px;color:#d9e7f4}
        main{display:grid;grid-template-columns:340px 1fr;gap:18px;padding:18px;min-height:0}aside,.sheet{background:white;border:1px solid #d2dce6;border-radius:12px;overflow:hidden}
        aside{padding:23px;display:flex;flex-direction:column;gap:20px}.label{color:#6c7d91;font-size:12px;letter-spacing:1.4px}.request{font-size:19px;line-height:1.7;margin-top:9px}
        .status{background:#eff6ff;color:#155d96;border-radius:8px;padding:14px;line-height:1.8}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px}.metric{background:#f3f6f8;border-radius:8px;padding:13px}.metric strong{display:block;font-size:24px;margin-top:4px}
        .legend{line-height:2.1;font-size:13px;color:#607288}.small{font-size:12px;line-height:1.8;color:#78889a}.sheet{display:flex;flex-direction:column}.sheet-head{padding:13px 17px;border-bottom:1px solid #dce4ea;display:flex;justify-content:space-between;color:#526982;font-size:13px}
        .sheet-view{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#fff}canvas{width:1024px;height:680px}.footer{padding:8px 26px;background:#e3eaf1;font-size:12px;color:#607185}
        .pill{padding:2px 8px;border-radius:5px;background:#e8f4ee;color:#276b4b}.orange{color:#d97706}.blue{color:#2563eb}
      </style><div class="demo"><header><div><h1>复杂勘察剖面 · Synthetic CAD</h1><div class="subtitle">8 孔 × 6 层 · 原生填充 · 源事实与图形一同更新</div></div><div class="badge">合成示例 / 无模型调用</div></header>
      <main><aside><div><div class="label">明确的工程需求</div><div class="request" id="demo-request">完全合成的 8 孔工程地质剖面，所有数据与孔号均为示例。</div></div>
      <div class="status" id="demo-status">已加载原创合成源事实与实际 CAD 图纸。</div><div class="metrics"><div class="metric">钻孔<strong id="demo-holes">8</strong></div><div class="metric">分层<strong id="demo-strata">48</strong></div><div class="metric">原生填充<strong id="demo-hatches">90</strong></div><div class="metric">CAD 版本<strong id="demo-revision"></strong></div></div>
      <div class="legend"><span class="orange">● 橙色：修改前</span><br><span class="blue">● 蓝色：待审阅结果</span><br>批准前，实际图纸保持不变。</div>
      <div class="small" id="demo-route">现有 SDK 确定性工作流。<br>录屏中的审批由示例主机脚本执行；不代表真实模型或人工验收。</div></aside>
      <section class="sheet"><div class="sheet-head"><span id="demo-title">Synthetic 示例剖面 A-A</span><span class="pill" id="demo-stage">实际 CAD</span></div><div class="sheet-view"><canvas id="demo-canvas" width="1024" height="680"></canvas></div></section></main>
      <div class="footer">全部孔号、层序、取样和数值均为原创合成事实；Apache-2.0 原创填充。无单位、人员、原图或服务商密钥。</div></div>`
      const canvas = document.getElementById('demo-canvas')
      let renderer = new KJCanvasRenderer(canvas, { document: fixture.document, theme: 'light', grid: false, background: '#fff', pixelRatio: 1 })
      const text = (id, value) => { document.getElementById(id).textContent = value }
      const render = (preview = null, cad = fixture.document) => {
        renderer.dispose(); renderer = new KJCanvasRenderer(canvas, { document: cad, theme: 'light', grid: false, background: '#fff', pixelRatio: 1 })
        renderer.resize(1024, 680); Object.assign(renderer.camera, { centerX: 210, centerY: 148.5, scale: 2.15 })
        renderer.render()
        if (preview) { renderer.drawPreview(preview.before, '#d97706'); renderer.drawPreview(preview.after, '#2563eb') }
        text('demo-revision', cad.revision); text('demo-hatches', cad.listEntities({ type: 'HATCH' }).length)
        if (cad === fixture.document) {
          const source = readGeologyDrawingRecipe(cad, fixture.drawingId).source
          text('demo-holes', source.input.holes.length); text('demo-strata', source.input.holes.reduce((sum, hole) => sum + hole.strata.length, 0))
          text('demo-title', source.input.title)
        }
      }
      render()
      window.syntheticDemo = { fixture, render, text, scenarios: SYNTHETIC_GEOLOGY_SCENARIOS, propose: proposeSyntheticGeologyScenario, pending: null, baseline: null }
    })
    async function capture(name, hold = 1200) {
      if (errors.length) throw new Error(`Synthetic browser error: ${errors[0]}`)
      await page.waitForTimeout(hold)
      const file = `${String(captures.length + 1).padStart(2, '0')}-${name}.png`
      await page.screenshot({ path: resolve(output, file) })
      captures.push({ file, durationMs: hold })
    }
    await capture('synthetic-baseline', 1600)
    for (const id of selected) {
      const result = await page.evaluate(async scenarioId => {
        const demo = window.syntheticDemo, scenario = demo.scenarios.find(item => item.id === scenarioId)
        demo.text('demo-request', scenario.request)
        demo.baseline = demo.fixture.document.fingerprint()
        const pending = await demo.propose(demo.fixture, scenarioId)
        if (demo.fixture.document.fingerprint() !== demo.baseline) throw new Error('Review mutated the live drawing')
        demo.pending = pending
        demo.text('demo-status', '源事实已读取，真实 CAD 提案已生成。\n等待示例主机审阅；图纸未修改。')
        demo.text('demo-stage', '待审阅提案')
        demo.render(pending.preview)
        return { scenarioId, route: pending.route, beforeRevision: demo.fixture.document.revision,
          changedBefore: pending.preview.before.length, changedAfter: pending.preview.after.length }
      }, id)
      facts.push(result)
      await capture(`${id}-review`, 1500)
      await page.evaluate(async () => {
        const demo = window.syntheticDemo
        await demo.pending.approve()
        if (demo.fixture.document.fingerprint() === demo.baseline) throw new Error('Approved scenario did not change drawing content')
        if (JSON.stringify(demo.fixture.document.getObject(demo.fixture.manual.id)) !== JSON.stringify(demo.fixture.manual)) throw new Error('Unrelated reference changed')
        demo.text('demo-status', '示例主机批准：源事实与原生 CAD 已一起提交。\n全部未涉及内容保持。')
        demo.text('demo-stage', '实际已提交')
        demo.render()
      })
      await capture(`${id}-committed`, 1150)
    }
    await page.evaluate(async () => {
      const demo = window.syntheticDemo
      demo.afterLast = demo.fixture.document.fingerprint()
      await demo.fixture.document.undo()
      if (demo.fixture.document.fingerprint() !== demo.baseline) throw new Error('Undo did not restore exact prior CAD/source state')
      demo.text('demo-request', '撤销最后一次修订：完整恢复上一版源事实与图纸。')
      demo.text('demo-status', '实际引擎 UNDO 已完成；源配方身份保持。'); demo.text('demo-stage', '已撤销'); demo.render()
    })
    await capture('native-undo', 1500)
    await page.evaluate(async () => {
      const demo = window.syntheticDemo
      await demo.fixture.document.redo()
      if (demo.fixture.document.fingerprint() !== demo.afterLast) throw new Error('Redo did not restore exact edited CAD/source state')
      demo.text('demo-request', '重做最后一次修订：恢复刚才批准的源事实与原生几何。')
      demo.text('demo-status', '实际引擎 REDO 已完成；不存在文字推测的逆操作。'); demo.text('demo-stage', '已重做'); demo.render()
    })
    await capture('native-redo', 1500)
    const final = await page.evaluate(async () => {
      const demo = window.syntheticDemo, { sdk, document: cad } = demo.fixture
      const dxf = await sdk.writeDocument(cad, { format: 'DXF' })
      const reopened = await sdk.readDocument(dxf, { format: 'DXF' })
      if (!reopened.validate().valid || reopened.listEntities().length !== cad.listEntities().length) throw new Error('DXF reopen closure failed')
      const original = new Map(cad.listEntities().map(entity => [entity.handle, entity]))
      for (const entity of reopened.listEntities()) if (original.get(entity.handle)?.type !== entity.type) throw new Error('DXF lost a native entity handle/type')
      demo.text('demo-request', '导出真实 DXF 并重新打开，检查原生对象、文字、填充与图形结构。')
      demo.text('demo-status', '真实 DXF 已导出并重开，结构校验通过。\nDXF 保留图形；KJD 保留源配方。')
      demo.text('demo-stage', 'DXF 已重开'); demo.render(null, reopened)
      return { dxf, kjd: await sdk.writeDocument(cad, { format: 'KJD' }), entityCount: reopened.listEntities().length,
        hatchCount: reopened.listEntities({ type: 'HATCH' }).length, sourceDrawingId: demo.fixture.drawingId }
    })
    await capture('dxf-reopened', 1800)
    await writeFile(resolve(output, 'synthetic-final.dxf'), final.dxf)
    await writeFile(resolve(output, 'synthetic-final.kjd'), final.kjd)
    const video = page.video()
    await context.close(); context = null
    await video.saveAs(resolve(output, 'synthetic-cad-workflow.webm'))
    const ffmpeg = String(args.get('ffmpeg') || process.env.KJDRAW_FFMPEG_PATH || 'ffmpeg')
    let gif = null
    const conversion = spawnSync(ffmpeg, ['-y', '-i', resolve(output, 'synthetic-cad-workflow.webm'), '-vf',
      'fps=8,scale=1152:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer',
      '-loop', '0', resolve(output, 'synthetic-cad-workflow.gif')], { windowsHide: true, stdio: 'ignore' })
    if (conversion.status === 0) gif = 'synthetic-cad-workflow.gif'
    const manifest = { ...SYNTHETIC_GEOLOGY_PROVENANCE, captures, scenarios: facts,
      final: { entityCount: final.entityCount, hatchCount: final.hatchCount, sourceDrawingId: final.sourceDrawingId },
      video: 'synthetic-cad-workflow.webm', gif, noPrivateFilesRead: true,
      approval: 'scripted-example-host-review-not-live-human-acceptance' }
    await writeFile(resolve(output, 'recording-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(JSON.stringify({ status: 'recorded', output, video: manifest.video, gif, modelInvocations: 0, scenarios: facts.length }))
  } finally {
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    if (server) server.kill()
  }
}
}

export const SYNTHETIC_LIVE_ROUNDS = Object.freeze([
  ['collar', '将 SYN-03 孔口高程提高 0.65 m，重算由它决定的图形和标注，其他源事实与对象不变。'],
  ['depth', '把 SYN-08 延深 2 m，只延长最底部风化岩层，其他分层、取样、标贯、水位和层间关联全部保留。'],
  ['stable-water', '将 SYN-02 稳定水位改为孔口以下 4.90 m；初见水位和土层不要改。'],
  ['boundary', 'SYN-04 黏土层底界下移 0.80 m，下一层粉质黏土的顶界同步，保持连续分层，其他层界不动。'],
  ['lithology-pattern', '八个孔的第一层都改成示例耕植土，更新源土类、原生填充花纹和图例，深度、描述、层号及关联不变。'],
  ['sample-add', '在 SYN-05 的 11.25 m 处新增独立取样：记录编号 SYN-05-SNEW，显示 S5-NEW，实心圆标记。保留该孔已有的全部观测。'],
  ['spt-update', 'SYN-03 第二个标贯记录 SYN-03-N2 的击数改成 32，深度仍为 16.50 m，其他记录不要改。'],
  ['sample-remove', '删除 SYN-06 的 SYN-06-S2 取样记录和对应标记，它的深度是 21.30 m；只删除这一条。'],
  ['station', 'SYN-05 里程改成 85.50 m，保留孔口高程、总深、分层、观测与原有层间关联。'],
  ['water-unknown', '撤回 SYN-04 稳定水位这个源事实，改为未知并移除该稳定水位标记；初见水位和其他孔的水位都保留。'],
].map(([id, prompt]) => Object.freeze({ id, prompt: `${prompt} 请先读取并核对这张合成示例剖面的当前源事实，保留同一源配方，只生成待审阅提案，不要直接提交。` })))

// Held-out oracle: it never enters model messages or builds a model response.
// Each check compares the actual current source to the actual prior source.
export function validateSyntheticLiveSource(id, before, actual) {
  const expected = structuredClone(before)
  const get = holeId => expected.input.holes.find(hole => hole.id === holeId)
  const decimal = value => Math.round(value * 100) / 100
  switch (id) {
    case 'collar': get('SYN-03').collarElevation = decimal(get('SYN-03').collarElevation + .65); break
    case 'depth': get('SYN-08').depth += 2; get('SYN-08').strata.at(-1).bottom = get('SYN-08').depth; break
    case 'stable-water': get('SYN-02').stableWaterDepth = 4.9; break
    case 'boundary': get('SYN-04').strata[1].bottom = decimal(get('SYN-04').strata[1].bottom + .8); get('SYN-04').strata[2].top = get('SYN-04').strata[1].bottom; break
    case 'lithology-pattern': for (const hole of expected.input.holes) { hole.strata[0].lithology = 'cultivated-soil'; hole.strata[0].name = '示例耕植土' } break
    case 'sample-add': get('SYN-05').observations.push({ kind: 'sample', id: 'SYN-05-SNEW', depth: 11.25, displayLabel: 'S5-NEW', sampleMarker: 'filled-circle' }); break
    case 'spt-update': get('SYN-03').observations.find(record => record.id === 'SYN-03-N2').value = 32; break
    case 'sample-remove': get('SYN-06').observations = get('SYN-06').observations.filter(record => record.id !== 'SYN-06-S2'); break
    case 'station': get('SYN-05').station = 85.5; break
    case 'water-unknown': delete get('SYN-04').stableWaterDepth; break
    default: throw new Error('No held-out oracle for this live round')
  }
  assert.deepEqual(actual, expected, 'exact target values and every unrequested source fact, identity, optional field and link must match')
  return true
}

// Match the existing SDK read/proposal wire contract: host-owned style and
// pattern resources are not exposed as editable facts (agent-tools.ts).
// This projection never changes the held-out desired facts or CAD oracle.
const hostSourcePackKeys = ['columnStylePack', 'sectionStylePack', 'hatchPack']
export function projectSyntheticLiveSourceFacts(source) {
  const { columnStylePack: _columnPack, sectionStylePack: _sectionPack, hatchPack: _hatchPack, ...facts } = source.input
  return structuredClone(facts)
}
export function validateSyntheticLiveWireSource(id, before, wire) {
  assert.ok(wire && typeof wire === 'object' && Object.keys(wire).sort().join(',') === 'facts,kind', 'exact SDK source-facts wire schema required')
  assert.ok(wire.facts && typeof wire.facts === 'object' && !Array.isArray(wire.facts), 'complete wire facts required')
  assert.ok(hostSourcePackKeys.every(key => !Object.hasOwn(wire.facts, key)), 'wire facts must never supply or replace host-owned packs')
  const input = structuredClone(wire.facts)
  for (const key of hostSourcePackKeys) if (Object.hasOwn(before.input, key)) input[key] = structuredClone(before.input[key])
  return validateSyntheticLiveSource(id, before, { kind: wire.kind, input })
}

export class SyntheticProviderEvidenceError extends Error {
  constructor(check, metadata) {
    super(check)
    this.name = 'SyntheticProviderEvidenceError'
    this.metadata = metadata
  }
}

export function createSyntheticCaptureClock(now = () => performance.now()) {
  const anchor = now()
  assert.ok(Number.isFinite(anchor), 'capture clock anchor must be finite')
  let previous = 0
  return () => {
    const elapsedMs = now() - anchor
    assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= previous, 'actual capture elapsed time must be finite and monotonic')
    previous = elapsedMs
    return elapsedMs
  }
}

export function validateSyntheticViewerObservations(observations) {
  assert.ok(Array.isArray(observations), 'actual browser viewer observations are required')
  assert.equal(observations.length, 0, 'actual drawing preview must never enter an unavailable state during the recorded workflow')
  return true
}

export function installSyntheticViewerObserver() {
  const observations = []
  Object.defineProperty(window, '__syntheticViewerObservations', { value: observations })
  const report = viewer => observations.push({ timeMs: performance.now(),
    mode: ['document', 'proposal'].includes(viewer.dataset.viewerMode) ? viewer.dataset.viewerMode : 'unknown' })
  const observe = element => {
    if (element?.nodeType !== 1) return
    for (const viewer of [element, ...element.querySelectorAll('[data-viewer-error="true"]')]) {
      if (viewer.dataset.viewerError === 'true') report(viewer)
    }
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        // Preserve same-task true -> cleared transitions, not just the final DOM.
        if (record.oldValue === 'true' || record.target.dataset.viewerError === 'true') report(record.target)
      } else for (const added of record.addedNodes) observe(added)
    }
  }).observe(document, { subtree: true, childList: true, attributes: true,
    attributeOldValue: true, attributeFilter: ['data-viewer-error'] })
}

export async function collectSyntheticModelEvidence(contentType, bytes) {
  const tools = new Map()
  let usage = null, model = null, finishReason = null, textDeltas = 0, eventCount = 0, toolFragmentCount = 0, argumentBytes = 0
  let stage = 'response-decoding'
  const streamed = /^text\/event-stream(?:\s*;|$)/i.test(contentType)
  try {
    const response = new Response(bytes, { headers: { 'content-type': contentType } })
    const parsed = await readAiModelResponse(response)
    const events = parsed?.[Symbol.asyncIterator] ? parsed : [parsed]
    for await (const event of events) {
      eventCount++
      // Failure evidence contains only bounded identifiers/counts, never raw SSE,
      // model prose, tool arguments or partially assembled JSON.
      if (typeof event.model === 'string' && /^[a-zA-Z0-9._:/-]{1,256}$/.test(event.model)) model = event.model
      if (event.usage) usage = extractKJModelUsage('chat-completions', event)
      const choice = event.choices?.[0]
      if (choice?.finish_reason) finishReason = ['stop', 'tool_calls', 'length', 'content_filter', 'function_call'].includes(choice.finish_reason) ? choice.finish_reason : 'unknown'
      const message = streamed ? choice?.delta : choice?.message
      if (typeof message?.content === 'string' && message.content) textDeltas++
      for (const [position, call] of (message?.tool_calls ?? []).entries()) {
        toolFragmentCount++
        const index = streamed ? call.index : position
        assert.ok(Number.isSafeInteger(index) && index >= 0, 'actual streamed tool index required')
        const item = tools.get(index) ?? { id: '', name: '', arguments: '' }
        if (call.id) item.id += call.id
        if (call.function?.name) item.name += call.function.name
        if (call.function?.arguments) { item.arguments += call.function.arguments; argumentBytes += Buffer.byteLength(call.function.arguments, 'utf8') }
        tools.set(index, item)
      }
    }
    stage = 'provider-metadata'
    assert.ok(model && usage && !usage.invalidFields.length, 'real provider model and valid usage receipt required')
    for (const field of ['inputTokens', 'outputTokens', 'totalTokens']) assert.ok(Number.isSafeInteger(usage[field]) && usage[field] > 0, `actual positive ${field} required`)
    assert.equal(usage.totalTokens, usage.inputTokens + usage.outputTokens, 'actual provider token totals must close')
    stage = 'finish-reason'
    assert.ok(['stop', 'tool_calls'].includes(finishReason), 'truncated/unknown model turn cannot pass capture')
    stage = 'tool-call-json'
    const toolCalls = [...tools.values()].map(call => {
      const args = JSON.parse(call.arguments)
      assert.ok(call.id && call.name && args && typeof args === 'object' && !Array.isArray(args), 'complete actual tool call required')
      return { id: call.id, name: call.name, arguments: args }
    })
    return { model, usage, finishReason, streamed, textDeltas, toolCalls }
  } catch (error) {
    const check = error instanceof assert.AssertionError ? error.message.split('\n')[0].slice(0, 200)
      : stage === 'tool-call-json' ? 'actual tool-call arguments are incomplete or invalid JSON'
        : 'actual response decoding/assembly failed; unsafe details withheld'
    throw new SyntheticProviderEvidenceError(check, { stage, model, usage, finishReason, streamed, textDeltas,
      eventCount, toolFragmentCount, toolCallCount: tools.size, argumentBytes, completeValidatedTurn: false })
  }
}

export function teeSyntheticProviderResponse(response, observe) {
  assert.ok(response.body, 'actual provider response body required')
  const [browserStream, evidenceStream] = response.body.tee()
  const init = { status: response.status, headers: response.headers }
  observe(new Response(evidenceStream, init))
  return new Response(browserStream, init)
}

export async function collectSyntheticProviderResponse(response, forbiddenValue = '') {
  assert.equal(response.status, 200, 'real provider HTTP response status must be 200')
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      assert.ok(size <= 2 * 1024 * 1024, 'actual provider evidence response exceeds the original two-MiB budget')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = Buffer.concat(chunks, size), wire = bytes.toString('utf8')
  assert.ok(!forbiddenValue || !wire.includes(forbiddenValue) && !wire.includes(JSON.stringify(forbiddenValue).slice(1, -1)), 'reflected credential is forbidden in actual provider evidence')
  return collectSyntheticModelEvidence(response.headers.get('content-type') || '', bytes)
}

export function validateSyntheticLiveCad(before, after, drawingId) {
  const oldRecipe = readGeologyDrawingRecipe(before, drawingId), recipe = readGeologyDrawingRecipe(after, drawingId)
  for (const field of ['drawingId', 'resourceRoot', 'documentId', 'textStyleId']) assert.equal(recipe[field], oldRecipe[field], 'source recipe identity must stay exact')
  assert.ok(after.validate().valid, 'actual committed CAD must validate')
  const compiled = prepareGeologyDrawingRevision(before, oldRecipe, recipe.source, { expectedRevision: before.revision })
  const untouched = new Set(compiled.unchangedIds)
  const beforeState = before.snapshot(), afterState = after.snapshot(), removed = new Set(compiled.removedIds), created = new Set(compiled.createdIds)
  assert.deepEqual(Object.keys(afterState.objects).sort(), [...Object.keys(beforeState.objects).filter(id => !removed.has(id)), ...created].sort(), 'exact native object inventory: no unrequested additions or deletions')
  assert.deepEqual(afterState.tables, beforeState.tables, 'all named resource tables remain exact')
  assert.deepEqual(afterState.resources, beforeState.resources, 'all resource definitions remain exact')
  assert.deepEqual(afterState.spaces, beforeState.spaces, 'native space and layout identities remain exact')
  assert.equal(afterState.namedObjectsDictionaryId, beforeState.namedObjectsDictionaryId)
  const ownRecipeKey = `geology-drawing-recipe:${drawingId}`
  const otherOpaque = state => Object.fromEntries(Object.entries(state.opaquePayloads).filter(([key]) => key !== ownRecipeKey))
  assert.deepEqual(otherOpaque(afterState), otherOpaque(beforeState), 'every unrelated opaque payload remains exact')
  const targetIds = new Set([...compiled.createdIds, ...compiled.removedIds])
  const owners = new Set([...compiled.before, ...compiled.after].map(entity => entity.ownerId))
  for (const [id, record] of Object.entries(beforeState.objects)) {
    if (targetIds.has(id)) continue
    const expected = structuredClone(record)
    if (owners.has(id)) expected.payload.entityIds = [...record.payload.entityIds.filter(entityId => !removed.has(entityId)), ...compiled.after.filter(entity => entity.ownerId === id).map(entity => entity.id)]
    assert.deepEqual(afterState.objects[id], expected, 'all untouched objects and owner memberships match the exact native replacement')
  }
  assert.deepEqual(recipe.entityIds, compiled.recipe.entityIds, 'actual generated entity ownership must match the independent compiler')
  for (const expected of compiled.after) {
    const actual = after.getObject(expected.id)
    assert.ok(actual, 'every independently compiled target object must exist')
    // Both browser receipts are durable KJD JSON. Undefined optional plotting
    // defaults have no serialized field; no geometry value is rounded/dropped.
    const durable = value => JSON.parse(JSON.stringify(value))
    assert.deepEqual(durable({ ...actual, handle: expected.handle }), durable(expected), 'actual changed native geometry/text/hatch must match the independent compiler exactly')
  }
  for (const id of compiled.removedIds) assert.equal(after.getObject(id, { includeErased: true }), null, 'each actual superseded target must be removed, including erased-object access')
  const owned = new Set(oldRecipe.entityIds)
  for (const entity of before.listEntities()) if (!owned.has(entity.id) || untouched.has(entity.id)) {
    assert.deepEqual(after.getObject(entity.id), entity, 'every declared unchanged and unrelated actual CAD entity stays exact')
  }
  assert.deepEqual(after.getObject('synthetic-unrelated-reference'), before.getObject('synthetic-unrelated-reference'))
  assert.notEqual(after.fingerprint(), before.fingerprint(), 'approved request must actually change CAD and source')
  return recipe
}

const sourceProposalNames = new Set(['cad_propose_geology_revision', 'cad_propose_geology_scalar_revision'])
const isProposalTool = name => typeof name === 'string' && name.startsWith('cad_propose_')

export function auditSyntheticLiveProposalAttempts(calls) {
  const ids = new Map(), attempts = []
  for (const [requestIndex, record] of calls.entries()) for (const call of record.toolCalls) {
    assert.ok(typeof call.id === 'string' && call.id && !ids.has(call.id), 'actual model tool-call IDs must be present and unique across the round')
    const entry = { call, requestIndex, record, receipts: [] }
    ids.set(call.id, entry)
    if (isProposalTool(call.name)) attempts.push(entry)
  }
  assert.ok(attempts.length, 'one actual proposal model response required')
  for (const [requestIndex, record] of calls.entries()) {
    const seen = new Set()
    for (const receipt of record.toolReceipts) {
      assert.ok(typeof receipt.id === 'string' && receipt.id && !seen.has(receipt.id), 'duplicate or missing tool-receipt ID in an actual provider request')
      seen.add(receipt.id)
      const attempted = ids.get(receipt.id)
      if (!isProposalTool(receipt.name) && !isProposalTool(attempted?.call.name)) continue
      assert.ok(attempted && isProposalTool(attempted.call.name) && receipt.name === attempted.call.name,
        'actual failed proposal receipt must match its exact prior tool-call ID and name')
      assert.ok(requestIndex > attempted.requestIndex, 'actual proposal result must be consumed by a later provider request, never predate its call')
      assert.ok(receipt.result?.ok === false && typeof receipt.result.error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(receipt.result.error.code) && receipt.result.value === undefined,
        'only an explicit host ok:false receipt with a safe error code can resolve a rejected attempt; a successful second proposal is forbidden')
      if (attempted.receipts.length) assert.deepEqual(receipt.result, attempted.receipts[0].result, 'repeated historical failed receipts must stay exact across provider requests')
      attempted.receipts.push(receipt)
    }
  }
  const final = attempts.at(-1), failed = attempts.slice(0, -1)
  assert.ok(sourceProposalNames.has(final.call.name), 'the one final pending proposal must use a supported source revision tool')
  assert.equal(final.receipts.length, 0, 'the one final actual pending proposal cannot be an already rejected or resolved attempt')
  assert.ok(failed.every(attempt => attempt.receipts.length), 'every earlier proposal attempt needs an actual later host failure receipt; unknown or unresolved attempts fail')
  return { totalAttempts: attempts.length, finalCallId: final.call.id, finalRequestIndex: final.requestIndex,
    failedAttempts: failed.map(attempt => ({ callId: attempt.call.id, toolName: attempt.call.name, code: attempt.receipts[0].result.error.code,
      modelRequestSequence: attempt.record.sequence ?? attempt.requestIndex, usage: attempt.record.usage ?? null })) }
}

export function validateSyntheticLiveReads(calls, { revision, documentId, drawingId, source }) {
  const audit = auditSyntheticLiveProposalAttempts(calls)
  const proposalIndex = audit.finalRequestIndex, proposal = calls[proposalIndex]
  const reads = new Map(calls.slice(0, proposalIndex).flatMap(record => record.toolCalls).filter(call => call.name === 'cad_read_geology_source' && call.arguments.expectedRevision === revision && call.arguments.drawingId === drawingId).map(call => [call.id, call]))
  const receipts = proposal.toolReceipts.filter(receipt => receipt.name === 'cad_read_geology_source' && reads.has(receipt.id) && receipt.result?.ok === true)
  const receipt = receipts.find(item => item.result.value?.sourceBacked === true && item.result.value.documentId === documentId &&
    item.result.value.revision === revision && item.result.value.drawingId === drawingId && item.result.value.kind === source.kind && item.result.value.facts)
  assert.ok(receipt, 'actual model must receive a successful full current source receipt before choosing its proposal; listings, wrong revisions and failed reads do not qualify')
  assert.deepEqual(receipt.result.value.facts, projectSyntheticLiveSourceFacts(source), 'actual read receipt must contain the exact current source facts')
  return true
}

export function validateSyntheticLiveDxf(before, reopened) {
  assert.ok(reopened.validate().valid)
  assert.equal(reopened.listEntities().length, before.listEntities().length)
  const normalized = payload => JSON.parse(JSON.stringify({ normal: [0, 0, 1], ...payload }, (key, value) => {
    if (key === 'rawTags' || key === 'contractVersion' || /Ids?$/.test(key)) return undefined
    if (typeof value === 'number' && /angle$/i.test(key)) value = ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    return typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value
  }))
  const byHandle = new Map(reopened.listEntities().map(entity => [entity.handle, entity]))
  for (const old of before.listEntities()) {
    const actual = byHandle.get(old.handle)
    assert.ok(actual); assert.equal(actual.type, old.type)
    const expected = structuredClone(old.payload), received = structuredClone(actual.payload)
    if (old.type === 'HATCH') for (const payload of [expected, received]) {
      payload.associative ??= false
      payload.hatchStyle ??= 0 // DXF group 75 omitted and explicit normal style are equivalent; nonzero stays exact.
      for (const loop of payload.boundaryLoops) loop.flags ??= 2 | (loop.external ? 1 : 0)
    }
    assert.deepEqual(normalized(received), normalized(expected), 'every DXF native geometry/text/pattern must reopen unchanged')
    for (const key of ['layerId', 'styleId', 'linetypeId']) assert.equal(reopened.getObject(received[key])?.name, before.getObject(expected[key])?.name)
  }
}

// Real HTTPS streaming transport. Reuses the repository benchmark CONNECT
// agent; the actual proxy continues to enforce origin/budgets/key filtering.
function realDeepSeekFetch(url, options, agent, observe) {
  assert.equal(new URL(url).href, 'https://api.deepseek.com/chat/completions')
  const body = JSON.parse(options.body)
  if (body.stream) body.stream_options = { ...body.stream_options, include_usage: true }
  const started = performance.now()
  return new Promise((resolveResponse, rejectResponse) => {
    const request = https.request(url, { method: 'POST', agent, headers: options.headers, signal: options.signal }, response => {
      response.once('error', () => rejectResponse(new Error('DEEPSEEK_STREAM_FAILURE')))
      const actual = new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers })
      resolveResponse(teeSyntheticProviderResponse(actual, evidence => observe(evidence, body, started)))
    })
    request.once('error', () => rejectResponse(new Error('DEEPSEEK_TRANSPORT_FAILURE')))
    request.end(JSON.stringify(body))
  })
}

async function recordLiveSyntheticGeology({ args, output }) {
  if (args.has('base-url') || args.has('no-server') || args.has('scenarios')) throw new Error('--live uses its own real DeepSeek proxy and the fixed ten-round audit')
  if (process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT) throw new Error('Disable benchmark fixture endpoints before --live')
  const apiKey = process.env.KJDRAW_DEEPSEEK_API_KEY
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error('LIVE_CREDENTIAL_REQUIRED: load the existing project key into KJDRAW_DEEPSEEK_API_KEY; no model run occurred')
  const model = String(args.get('model') || 'deepseek-chat')
  if (!/^deepseek-[a-zA-Z0-9._/-]{1,80}$/.test(model)) throw new Error('Provide a bounded real DeepSeek model name')
  const port = Number(args.get('port') || 43210), timeoutMs = Number(args.get('timeout-ms') || 180000)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 30000 || timeoutMs > 300000) throw new Error('Invalid live port/timeout')
  const baseURL = `http://127.0.0.1:${port}`
  let proxyAgent = null
  if (process.env.KJDRAW_BENCH_PROXY) {
    const proxy = new URL(process.env.KJDRAW_BENCH_PROXY)
    if (proxy.protocol !== 'http:' || proxy.username || proxy.password || proxy.search || proxy.hash) throw new Error('Invalid project benchmark CONNECT proxy')
    proxyAgent = createBenchmarkProxyAgent(proxy)
  }
  const nativeFetch = globalThis.fetch
  globalThis.fetch = (url, options) => new URL(url).hostname === 'api.deepseek.com' ? realDeepSeekFetch(url, options, proxyAgent, observeProvider) : nativeFetch(url, options)
  const modelProxy = createModelProxy({ protocol: 'chat-completions', model, endpoint: 'https://api.deepseek.com/chat/completions', apiKey,
    maxOutputTokens: 16384, maxRequestBytes: 2 * 1024 * 1024, maxResponseBytes: 2 * 1024 * 1024, timeoutMs: 120000, chatStreamToolCalls: true })
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/api/model') { await modelProxy(request, response); return }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return }
      const pathname = decodeURIComponent(new URL(request.url, baseURL).pathname)
      const path = pathname === '/ai/' ? '/apps/playground/ai/index.html' : pathname
      if (!['/apps/playground/', '/packages/kjdraw-sdk/src/', '/web/public/kjcore/', '/examples/', '/docs/assets/'].some(prefix => path.startsWith(prefix))) { response.writeHead(404).end(); return }
      const target = resolve(root, `.${path}`), local = relative(root, target)
      if (local === '..' || local.startsWith(`..${sep}`) || local.split(sep).some(part => part.startsWith('.'))) { response.writeHead(403).end(); return }
      const bytes = await readFile(target)
      response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; frame-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" })
      response.end(request.method === 'HEAD' ? undefined : bytes)
    } catch { response.writeHead(404).end() }
  })
  let browser, context, video, round = null
  const captures = [], calls = [], outcomes = [], browserResponses = [], pendingResponses = new Set(), responseFailures = []
  const sdk = createKJDrawSDK()
  const manifest = { schema: 'com.kanjie.kjdraw.synthetic-live-capture@1', synthetic: true, measuredData: false,
    source: 'original-public-synthetic-facts', license: 'Apache-2.0', provider: 'deepseek', providerEndpoint: 'https://api.deepseek.com/chat/completions',
    requestedModel: model, initialCreation: 'trusted-host-compiler-not-model-creation', initialImportFormat: 'KJD',
    scope: 'source-backed synthetic drawing; arbitrary imported DXF source-fact regeneration is not claimed',
    phases: ['source-backed-synthetic-KJD-domain-revisions', 'export-and-reopen-DXF-graphics-only-no-source-recipe'], sameDrawingSequentialRounds: true,
    approval: 'actual-automated-reviewer-harness-not-human-review', modelInvocations: 0, verifiedModelReceipts: 0, providerResponsesObserved: 0,
    receiptCapture: 'bounded-tee-of-actual-DeepSeek-HTTPS-response-not-CDP-body',
    captureTiming: 'elapsed milliseconds since recorded browser context became ready; screenshot-request offsets, not synthetic frames',
    status: 'running', publishableModelEvidence: false, calls, browserResponses, responseFailures, outcomes, captures }
  const safeWriteManifest = async () => {
    const json = JSON.stringify(manifest, null, 2)
    assert.ok(!json.includes(apiKey) && !json.includes(JSON.stringify(apiKey).slice(1, -1)), 'credential must never enter recording evidence')
    await writeFile(resolve(output, 'live-recording-manifest.json'), json + '\n')
  }
  const observeProvider = (response, body, started) => {
    const captureRound = round, sequence = manifest.providerResponsesObserved++
    manifest.modelInvocations = manifest.providerResponsesObserved
    const task = (async () => {
      assert.equal(body.stream, true, 'actual model request must enable genuine streaming')
      const actual = await collectSyntheticProviderResponse(response, apiKey)
      assert.ok(actual.streamed, 'live browser capture requires actual provider SSE')
      const toolNames = new Map(body.messages.flatMap(message => message.tool_calls ?? []).map(call => [call.id, call.function.name]))
      const toolReceipts = body.messages.filter(message => message.role === 'tool').map(message => ({ id: message.tool_call_id,
        name: toolNames.get(message.tool_call_id), result: JSON.parse(message.content) }))
      const evidence = { sequence, round: captureRound, httpStatus: response.status, transportWallMs: performance.now() - started, ...actual, toolReceipts }
      assert.ok(!JSON.stringify(evidence).includes(apiKey), 'credential is forbidden in assembled actual provider evidence')
      calls.push(evidence); calls.sort((left, right) => left.sequence - right.sequence)
      manifest.verifiedModelReceipts = calls.length
    })().catch(error => {
      const check = error instanceof SyntheticProviderEvidenceError || error instanceof assert.AssertionError ? error.message.split('\n')[0].slice(0, 200) : 'actual response decoding/assembly failed; unsafe details withheld'
      responseFailures.push({ sequence, round: captureRound, httpStatus: response.status, contentType: response.headers.get('content-type'), check,
        ...(error instanceof SyntheticProviderEvidenceError ? { metadata: error.metadata } : {}) })
    }).finally(() => { void response.body.cancel().catch(() => {}); pendingResponses.delete(task) })
    pendingResponses.add(task)
  }
  try {
    await new Promise((resolveReady, rejectReady) => { server.once('error', rejectReady); server.listen(port, '127.0.0.1', resolveReady) })
    const executablePath = [process.env.KJDRAW_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(path => existsSync(path))
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
    context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN', recordVideo: { dir: resolve(output, 'live-raw-video'), size: { width: 1600, height: 1000 } } })
    const captureElapsed = createSyntheticCaptureClock()
    const page = await context.newPage(); video = page.video(); page.setDefaultTimeout(timeoutMs)
    page.on('response', response => {
      if (new URL(response.url()).pathname !== '/api/model') return
      const receipt = { round, httpStatus: response.status(), contentType: response.headers()['content-type'] || '', streamRequested: response.request().postDataJSON().stream === true }
      browserResponses.push(receipt)
      if (receipt.httpStatus !== 200 || !receipt.streamRequested || !/^text\/event-stream(?:\s*;|$)/i.test(receipt.contentType)) responseFailures.push({ ...receipt, check: 'actual browser must receive HTTP200 SSE for a true streaming request' })
    })
    const settle = async () => {
      while (pendingResponses.size) await Promise.all([...pendingResponses])
      assert.deepEqual(responseFailures, [], 'all actual provider and browser streaming receipts must validate')
      assert.equal(browserResponses.length, calls.length, 'each verified real provider response must correspond to an actual browser SSE response')
    }
    const state = () => page.evaluate(async () => { const record = await (await import('/apps/playground/ai/local-history.js')).loadLocalHistory(); return record?.sessions?.find(session => session.id === record.activeId) })
    const actualDrawing = async () => { const saved = await state(); assert.ok(saved?.state?.drawing); return { saved, document: await sdk.readDocument(saved.state.drawing, { format: 'KJD' }) } }
    const capture = async name => { const file = `${String(captures.length + 1).padStart(2, '0')}-${name}.png`, elapsedMs = captureElapsed()
      await page.screenshot({ path: resolve(output, file) }); captures.push({ file, elapsedMs }); await page.waitForTimeout(900) }
    await page.addInitScript(installSyntheticViewerObserver)
    await page.goto(`${baseURL}/ai/`, { waitUntil: 'networkidle' })
    if (await page.locator('#language-button').count()) {
      if ((await page.locator('#language-button').textContent()).includes('中文')) await page.locator('#language-button').click()
    }
    await page.getByTestId('drawing-file').setInputFiles(resolve(output, 'synthetic-geology-section.kjd'))
    await page.waitForFunction(() => document.querySelector('#drawing-name')?.textContent === 'synthetic-geology-section.kjd')
    await page.getByTestId('settings-open').click(); await page.getByTestId('settings-provider').selectOption('custom')
    await page.getByTestId('settings-endpoint').fill(`${baseURL}/api/model`); await page.getByTestId('settings-model').fill(model)
    await page.getByTestId('settings-key').fill(''); await page.getByTestId('settings-protocol').selectOption('chat-completions'); await page.getByTestId('settings-save').click()
    await page.waitForFunction(() => !document.querySelector('#settings-dialog')?.open)
    await page.evaluate(() => { const notice = document.createElement('p'); notice.id = 'synthetic-live-scope'; notice.className = 'disclaimer'; notice.textContent = 'Synthetic 源事实支持合成图（KJD）· 真实 DeepSeek · 自动化审阅器审批，非人工验收；不代表任意 DXF 可再生源数据'; document.querySelector('.composer').before(notice) })
    const initial = await actualDrawing(), recipeEntry = Object.entries(initial.document.snapshot().opaquePayloads).find(([key]) => key.startsWith('geology-drawing-recipe:'))
    assert.ok(recipeEntry); const drawingId = recipeEntry[1].drawingId, documentId = initial.document.id
    manifest.sourceDrawingId = drawingId
    await capture('live-synthetic-baseline')
    let lastBefore, lastAfter
    for (const scenario of SYNTHETIC_LIVE_ROUNDS) {
      round = scenario.id
      const before = await actualDrawing(), beforeRecipe = readGeologyDrawingRecipe(before.document, drawingId), startCalls = calls.length
      assert.equal(before.document.id, documentId, 'all ten rounds must edit the same actual drawing')
      await page.getByTestId('chat-input').fill(scenario.prompt); await page.getByTestId('chat-send').click()
      await page.getByTestId('chat-stop').waitFor({ state: 'visible' })
      await page.waitForFunction(() => !document.querySelector('#chat-stop') || document.querySelector('#chat-stop').hidden)
      await settle()
      const reviewed = await actualDrawing(), proposals = reviewed.saved.messages.flatMap(message => message.proposals ?? []).filter(proposal => proposal.uiState === 'pending')
      assert.equal(reviewed.document.fingerprint(), before.document.fingerprint(), 'model proposal must never mutate actual CAD before reviewer approval')
      assert.equal(proposals.length, 1, 'exactly one reviewable actual proposal required')
      const pending = proposals[0], evidence = pending.engineeringEvidence
      assert.equal(pending.command, 'GEOLOGY_DRAWING_UPDATE', 'source-backed engineering revision required')
      assert.ok(evidence?.afterSource?.facts); validateSyntheticLiveWireSource(scenario.id, beforeRecipe.source, evidence.afterSource)
      const currentCalls = calls.slice(startCalls), proposalAttempts = auditSyntheticLiveProposalAttempts(currentCalls)
      validateSyntheticLiveReads(currentCalls, { revision: before.document.revision, documentId, drawingId, source: beforeRecipe.source })
      await capture(`${scenario.id}-actual-model-review`)
      await page.getByTestId('proposal-approve').last().click()
      await page.waitForFunction(() => !document.querySelector('#chat-send')?.disabled)
      let committed
      for (let attempt = 0; attempt < 20; attempt++) { committed = await actualDrawing(); if (committed.document.revision > before.document.revision) break; await page.waitForTimeout(250) }
      assert.ok(committed.document.revision > before.document.revision, 'actual reviewer approval must commit')
      const afterRecipe = validateSyntheticLiveCad(before.document, committed.document, drawingId)
      validateSyntheticLiveSource(scenario.id, beforeRecipe.source, afterRecipe.source)
      if (scenario.id === 'lithology-pattern') {
        assert.ok(committed.document.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName === 'GEO_TOPSOIL'), 'actual original topsoil hatch template required')
        assert.ok(committed.document.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text.includes('示例耕植土')), 'actual updated native legend/name required')
      }
      outcomes.push({ round: scenario.id, prompt: scenario.prompt, status: 'passed', beforeRevision: before.document.revision, afterRevision: committed.document.revision,
        sourceFactsExact: true, unrequestedFactsExact: true, unchangedObjectsExact: true, targetGeometryMatchesIndependentCompiler: true,
        approval: 'actual-automated-reviewer-harness', planId: pending.planId, modelRequests: currentCalls.length, proposalAttempts,
        actualProposalReceipt: { planId: pending.planId, command: pending.command, expectedRevision: pending.expectedRevision,
          beforeObjectCount: pending.preview?.before?.length, afterObjectCount: pending.preview?.after?.length,
          engineeringEvidence: evidence } })
      lastBefore = before.document; lastAfter = committed.document
      await capture(`${scenario.id}-actual-approved`); await safeWriteManifest()
    }
    round = null
    await page.getByTestId('drawing-undo').click()
    for (let attempt = 0; attempt < 20; attempt++) { if ((await actualDrawing()).document.fingerprint() === lastBefore.fingerprint()) break; await page.waitForTimeout(250) }
    assert.equal((await actualDrawing()).document.fingerprint(), lastBefore.fingerprint(), 'actual UI undo restores exact CAD and recipe')
    await capture('live-native-undo'); await page.getByTestId('drawing-redo').click()
    for (let attempt = 0; attempt < 20; attempt++) { if ((await actualDrawing()).document.fingerprint() === lastAfter.fingerprint()) break; await page.waitForTimeout(250) }
    const final = await actualDrawing(); assert.equal(final.document.fingerprint(), lastAfter.fingerprint(), 'actual UI redo restores exact edited CAD and recipe')
    await capture('live-native-redo')
    const downloadPromise = page.waitForEvent('download'); await page.getByTestId('drawing-download').last().click(); const download = await downloadPromise
    await download.saveAs(resolve(output, 'synthetic-live-final.dxf'))
    const reopened = await sdk.readDocument(await readFile(resolve(output, 'synthetic-live-final.dxf')), { format: 'DXF' }); validateSyntheticLiveDxf(final.document, reopened)
    await writeFile(resolve(output, 'synthetic-live-final.kjd'), final.saved.state.drawing)
    await page.getByTestId('drawing-file').setInputFiles(resolve(output, 'synthetic-live-final.dxf'))
    await page.waitForFunction(() => document.querySelector('#drawing-name')?.textContent === 'synthetic-live-final.dxf')
    await page.evaluate(() => { document.getElementById('synthetic-live-scope').textContent = 'DXF 图形重开阶段 · 保留原生几何/文字/填充；DXF 不保留 KJD 源配方或文档 UUID，不声称任意 DXF 可再生源数据' })
    await capture('live-actual-dxf-reopened')
    const browserReopened = await actualDrawing(); validateSyntheticLiveDxf(final.document, browserReopened.document)
    assert.equal(browserReopened.saved.source.name, 'synthetic-live-final.dxf', 'actual browser reopened the downloaded DXF, not a prior session')
    assert.equal(browserReopened.saved.source.format, 'DXF', 'actual browser import format must be DXF')
    assert.equal(Object.keys(browserReopened.document.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false, 'browser-imported DXF carries no KJD source recipe')
    manifest.viewerErrorObservations = await page.evaluate(() => window.__syntheticViewerObservations)
    validateSyntheticViewerObservations(manifest.viewerErrorObservations)
    manifest.final = { entityCount: final.document.listEntities().length, hatchCount: final.document.listEntities({ type: 'HATCH' }).length,
      actualNativeUndoRedo: true, actualBrowserDxfReopen: true, sourceRecipePreservedInKjd: true, dxfCarriesGraphicsNotRecipe: true }
    manifest.status = 'passed'; manifest.publishableModelEvidence = true; manifest.publicationReviewRequired = true
    manifest.totals = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens'].map(field => [field, calls.reduce((sum, call) => sum + call.usage[field], 0)]))
    await settle(); await context.close(); context = null; await video.saveAs(resolve(output, 'synthetic-live-model-workflow.webm'))
    manifest.video = 'synthetic-live-model-workflow.webm'; await safeWriteManifest()
    console.log(JSON.stringify({ status: 'passed', mode: 'live', rounds: outcomes.length, modelInvocations: calls.length, video: manifest.video, tokens: manifest.totals }))
  } catch (error) {
    // A UI/runtime rejection can precede completion of the independent HTTPS
    // branch. Preserve every actual failed response receipt before closing it.
    while (pendingResponses.size) await Promise.all([...pendingResponses])
    if (context?.pages()[0]) {
      try { manifest.viewerErrorObservations = await context.pages()[0].evaluate(() => window.__syntheticViewerObservations ?? null) } catch { manifest.viewerErrorObservations = null }
    }
    const check = error instanceof assert.AssertionError ? error.message.split('\n')[0].slice(0, 200) : 'transport/browser/filesystem failure; unsafe details withheld'
    manifest.status = 'failed'; manifest.publishableModelEvidence = false; manifest.failure = { round, code: 'LIVE_WORKFLOW_INVARIANT_OR_TRANSPORT_FAILED', check }
    const usages = [...calls.map(call => call.usage), ...responseFailures.map(failure => failure.metadata?.usage)].filter(Boolean)
    manifest.observedReportedTokenTotals = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens'].map(field => [field,
      usages.filter(usage => Number.isSafeInteger(usage[field])).reduce((sum, usage) => sum + usage[field], 0)]))
    manifest.responsesWithReportedUsage = usages.length
    await safeWriteManifest()
    // Do not emit provider errors, full responses, keys or machine-private paths.
    throw new Error('LIVE_WORKFLOW_FAILED: inspect the sanitized manifest; no live acceptance claimed')
  } finally {
    try {
      if (context) await context.close().catch(() => {})
      if (video) {
        await video.saveAs(resolve(output, 'synthetic-live-model-workflow.webm')).then(() => { manifest.video = 'synthetic-live-model-workflow.webm' }).catch(() => {})
        await safeWriteManifest()
      }
    } finally {
      try { if (browser) await browser.close().catch(() => {}) } finally {
        try { await new Promise(resolveClosed => { server.close(resolveClosed); server.closeAllConnections?.() }) } finally {
          proxyAgent?.destroy(); globalThis.fetch = nativeFetch
          for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id)
        }
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runSyntheticGeologyRecording() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
