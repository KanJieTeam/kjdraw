// Explicit paired live experiment. Default CLI execution only prints a dry-run plan.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJModelAdapter } from '../../packages/kjdraw-sdk/src/model-adapters.js'
import { extractKJModelUsage } from '../../packages/kjdraw-sdk/src/model-usage.js'
import { pilotTasks } from './model-drawing-pilot.mjs'

const protocol = 'chat-completions'
const arms = ['kjdraw-tool', 'direct-dxf']
const validatorScript = fileURLToPath(new URL('./paired-model-validator.py', import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const byteLength = value => Buffer.byteLength(JSON.stringify(value))
class BenchmarkFailure extends Error {
  constructor(code, stop = false, httpStatus = null) { super(code); this.code = code; this.stop = stop; this.httpStatus = httpStatus }
}
const fail = (code, stop = false, status = null) => { throw new BenchmarkFailure(code, stop, status) }

export function pairedModelPlan({ repetitions = 5, maxRequests = 30 } = {}) {
  if (!Number.isSafeInteger(repetitions) || repetitions < 5 || repetitions > 30) throw new Error('Choose 5–30 repetitions')
  const plannedRequests = pilotTasks.length * arms.length * repetitions
  if (!Number.isSafeInteger(maxRequests) || maxRequests < plannedRequests || maxRequests > 180) throw new Error('Explicit request budget must cover the complete paired plan and be at most 180')
  return { mode: 'dry-run', protocol, repetitions, maxRequests, plannedRequests, actualRequests: 0, tasks: pilotTasks.map(task => ({ id: task.id, prompt: task.prompt })), arms, settings: { temperature: 0, max_tokens: 4096, stream: false }, scope: 'Three simple fully specified synthetic tasks, repeated one-shot generation. This is not a complex autonomous CAD evaluation.' }
}

export function liveModelConfiguration(env = process.env) {
  if (env.KJDRAW_BENCH_PROTOCOL !== protocol || !env.KJDRAW_BENCH_MODEL || !env.KJDRAW_BENCH_ENDPOINT || !env.KJDRAW_BENCH_API_KEY) throw new Error('Set explicit KJDRAW_BENCH_PROTOCOL, KJDRAW_BENCH_MODEL, KJDRAW_BENCH_ENDPOINT and KJDRAW_BENCH_API_KEY')
  const thinkingMode = env.KJDRAW_BENCH_THINKING
  if (thinkingMode !== undefined && !['disabled', 'enabled'].includes(thinkingMode)) throw new Error('KJDRAW_BENCH_THINKING must be disabled or enabled when configured')
  return { mode: 'live', protocol, model: env.KJDRAW_BENCH_MODEL, endpoint: env.KJDRAW_BENCH_ENDPOINT, apiKey: env.KJDRAW_BENCH_API_KEY, ...(thinkingMode !== undefined ? { thinkingMode } : {}) }
}

export function independentValidation({ python = process.env.KJDRAW_PYTHON ?? 'python', dxf, expected, timeoutMs = 30000 } = {}) {
  const result = spawnSync(python, ['-B', validatorScript, ...(dxf === undefined ? ['--probe'] : [])], { input: dxf === undefined ? undefined : JSON.stringify({ dxf, expected }), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 65536, windowsHide: true })
  if (result.status !== 0 || result.error) throw new BenchmarkFailure('INDEPENDENT_VALIDATOR_UNAVAILABLE', true)
  let value
  try { value = JSON.parse(result.stdout) } catch { throw new BenchmarkFailure('INDEPENDENT_VALIDATOR_INVALID', true) }
  if (value.validator !== 'ezdxf' || typeof value.version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(value.version) || (dxf !== undefined && typeof value.passed !== 'boolean')) throw new BenchmarkFailure('INDEPENDENT_VALIDATOR_INVALID', true)
  return value
}

function configuration(options) {
  const plan = pairedModelPlan(options)
  if (options.thinkingMode !== undefined && !['disabled', 'enabled'].includes(options.thinkingMode)) throw new Error('thinkingMode must be disabled or enabled')
  if (options.thinkingMode !== undefined) plan.settings.thinking = { type: options.thinkingMode }
  if (!['live', 'fixture'].includes(options.mode) || options.protocol !== protocol || typeof options.model !== 'string' || !options.model.trim() || options.model.length > 256) throw new Error('Select an explicit live or fixture chat-completions configuration')
  let url
  try { url = new URL(options.endpoint) } catch { throw new Error('Invalid explicit benchmark endpoint') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || (options.mode === 'live' ? url.protocol !== 'https:' || loopback : url.protocol !== 'http:' || !loopback)) throw new Error('Live requires a remote HTTPS endpoint; fixture mode requires HTTP loopback. URL credentials, queries and fragments are forbidden.')
  if (options.mode === 'live' && (typeof options.apiKey !== 'string' || !options.apiKey)) throw new Error('Live mode requires a server-side API key')
  if (options.apiKey !== undefined && (typeof options.apiKey !== 'string' || /[\r\n]/.test(options.apiKey))) throw new Error('Invalid benchmark API key')
  if (options.apiKey && (options.model.includes(options.apiKey) || url.href.includes(options.apiKey))) throw new Error('Benchmark credentials must not appear in public model or endpoint metadata')
  const timeoutMs = options.timeoutMs ?? 60000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120000) throw new Error('Choose an HTTP timeout between 10 and 120000 milliseconds')
  if (typeof options.output !== 'string' || !options.output.trim()) throw new Error('Choose a new report directory')
  return { ...plan, mode: options.mode, model: options.model, endpoint: url.href, apiKey: options.apiKey, timeoutMs, output: resolve(options.output), python: options.python ?? process.env.KJDRAW_PYTHON ?? 'python' }
}

function toolDefinition() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const definition = new KJAgentToolSession(sdk, document).definitions.find(tool => tool.name === 'cad_propose_drawing')
  return { type: 'function', function: { name: definition.name, description: definition.description, parameters: definition.inputSchema } }
}

function requestBody(task, arm, config, tool) {
  const common = 'Create a 2D engineering drawing from the following fully specified synthetic request. All coordinates and lengths are millimeters, model XY at z=0. The drawing is empty, revision 0. No text, dimensions, hatch, construction lines or additional geometry. '
  const system = arm === 'kjdraw-tool'
    ? 'Use exactly one cad_propose_drawing tool call. The current units and revision have already been supplied. Return requested editable geometry for synthetic benchmark review.'
    : 'Return only a complete valid ASCII DXF file, no markdown or commentary. Use DXF AC1027 or newer and set $INSUNITS to 4 (millimeters). Use LINE, CIRCLE, ARC and/or straight LWPOLYLINE entities. Do not use any CAD library or tool.'
  return { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: common + task.prompt }], ...config.settings, ...(arm === 'kjdraw-tool' ? { tools: [tool], tool_choice: { type: 'function', function: { name: 'cad_propose_drawing' } } } : {}) }
}

async function transport(config, body) {
  const signal = AbortSignal.timeout(config.timeoutMs)
  try {
    const response = await fetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify(body), signal, redirect: 'error' })
    if (!response.ok) { await response.body?.cancel(); fail('PROVIDER_HTTP_FAILURE', true, response.status) }
    if (!response.body) fail('PROVIDER_EMPTY_RESPONSE', true)
    const reader = response.body.getReader(), chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2097152) fail('PROVIDER_RESPONSE_LIMIT', true)
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    let value
    try { value = JSON.parse(Buffer.concat(chunks, size).toString('utf8')) } catch { fail('PROVIDER_INVALID_JSON', true) }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('PROVIDER_INVALID_RESPONSE', true)
    return value
  } catch (error) {
    if (error instanceof BenchmarkFailure) throw error
    fail(signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_TRANSPORT_FAILURE', true)
  }
}

export function safeResponse(response, usage, key) {
  const choice = response.choices?.[0], message = choice?.message
  if (response.choices?.length !== 1 || !message || message.role !== 'assistant') fail('INVALID_MODEL_RESPONSE')
  if (message.refusal !== undefined && message.refusal !== null && message.refusal !== '') fail('MODEL_REFUSED')
  if ((message.content !== undefined && message.content !== null && typeof message.content !== 'string') || (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))) fail('INVALID_MODEL_RESPONSE')
  if (message.tool_calls?.some(call => !call || typeof call.id !== 'string' || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string')) fail('INVALID_MODEL_RESPONSE')
  const result = { model: typeof response.model === 'string' ? response.model.slice(0, 256) : null, usage, choices: [{ finish_reason: typeof choice.finish_reason === 'string' ? choice.finish_reason.slice(0, 64) : null, message: { role: 'assistant', content: typeof message.content === 'string' || message.content === null ? message.content : null, ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls.map(call => ({ id: call?.id, type: call?.type, function: { name: call?.function?.name, arguments: call?.function?.arguments } })) } : {}) } }] }
  if (key) {
    const encodedKey = JSON.stringify(key).slice(1, -1)
    const strings = [result.model, result.choices[0].finish_reason, result.choices[0].message.content, ...(result.choices[0].message.tool_calls ?? []).flatMap(call => [call.id, call.type, call.function.name, call.function.arguments])]
    if (strings.some(value => typeof value === 'string' && (value.includes(key) || value.includes(encodedKey)))) fail('PROVIDER_REFLECTED_CREDENTIAL', true)
  }
  return result
}

async function materialize(response, arm, modelName) {
  const message = response.choices[0].message, finish = response.choices[0].finish_reason
  if (arm === 'direct-dxf') {
    if (finish !== 'stop' || typeof message.content !== 'string' || !message.content.trim() || message.content.includes('```') || message.tool_calls?.length) fail('INVALID_DIRECT_DXF_RESPONSE')
    return message.content
  }
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const model = createKJModelAdapter({ protocol, model: modelName, request: async () => response })
  let turn
  try { turn = await model.createConversation({ instructions: 'Materialize a captured synthetic benchmark proposal.', tools: [session.definitions.find(tool => tool.name === 'cad_propose_drawing')] }).next({ kind: 'prompt', text: 'Return one drawing proposal.' }, new AbortController().signal) } catch { fail('MODEL_TOOL_RESPONSE_REJECTED') }
  if (turn.calls.length !== 1 || turn.calls[0].name !== 'cad_propose_drawing') fail('MODEL_TOOL_RESPONSE_REJECTED')
  const proposal = await session.call(turn.calls[0].name, turn.calls[0].arguments)
  if (!proposal.ok) fail('MODEL_PROPOSAL_REJECTED')
  // Synthetic test documents only. This never approves an existing user document.
  const approved = await session.approve(proposal.value.planId, 'paired-synthetic-benchmark-reviewer')
  if (!approved.ok) fail('MODEL_APPROVAL_REJECTED')
  const data = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  return typeof data === 'string' ? data : new TextDecoder().decode(data)
}

const sumKnown = values => values.length && values.every(value => Number.isSafeInteger(value) && value >= 0) && Number.isSafeInteger(values.reduce((a, b) => a + b, 0)) ? values.reduce((a, b) => a + b, 0) : null
function summary(runs) {
  return Object.fromEntries(arms.map(arm => {
    const selected = runs.filter(run => run.arm === arm)
    return [arm, { attempted: selected.length, passed: selected.filter(run => run.validation?.passed).length, inputTokens: sumKnown(selected.map(run => run.usage?.inputTokens)), outputTokens: sumKnown(selected.map(run => run.usage?.outputTokens)), totalTokens: sumKnown(selected.map(run => run.usage?.totalTokens)), cacheReadInputTokens: sumKnown(selected.map(run => run.usage?.cacheReadInputTokens)), cacheMissInputTokens: sumKnown(selected.map(run => run.usage?.cacheMissInputTokens)), reasoningOutputTokens: sumKnown(selected.map(run => run.usage?.reasoningOutputTokens)), cost: null }]
  }))
}

export async function runPairedModelBenchmark(options) {
  const config = configuration(options)
  await mkdir(dirname(config.output), { recursive: true }); await mkdir(config.output)
  const report = { schema: 'com.kanjie.kjdraw.benchmark.paired-model@1', mode: config.mode, publishableModelEvidence: false, publicationReviewRequired: config.mode === 'live', status: 'preparing', createdAt: new Date().toISOString(), model: config.model, protocol, endpointOrigin: new URL(config.endpoint).origin, settings: config.settings, repetitions: config.repetitions, maxRequests: config.maxRequests, plannedRequests: config.plannedRequests, attemptedRequests: 0, unexecutedRequests: config.plannedRequests, timeoutMs: config.timeoutMs, cost: null, scope: config.scope, fixtureWarning: config.mode === 'fixture' ? 'LOCAL FAKE PROVIDER: transport/SDK/validator conformance only. Never use these simulated usage counters in public model rankings or savings claims.' : null, tasks: pilotTasks.map(task => ({ ...task, fixtureSha256: hash(JSON.stringify(task.expected)) })), validator: null, source: {}, runs: [], summary: {} }
  for (const name of ['paired-model-benchmark.mjs', 'paired-model-validator.py', 'model-drawing-pilot.mjs', 'deepseek-drawing-pilot.py']) report.source[name] = hash(await readFile(new URL(name, import.meta.url)))
  report.source['model-usage.js'] = hash(await readFile(new URL('../../packages/kjdraw-sdk/src/model-usage.js', import.meta.url)))
  const sdkFolder = new URL('../../packages/kjdraw-sdk/src/', import.meta.url), sdkHash = createHash('sha256')
  for (const name of (await readdir(sdkFolder, { recursive: true })).map(name => name.replaceAll('\\', '/')).filter(name => name.endsWith('.js')).sort()) { sdkHash.update(name); sdkHash.update(await readFile(new URL(name, sdkFolder))) }
  report.source.sdkRuntimeSha256 = sdkHash.digest('hex')
  report.runtime = { node: process.version, platform: process.platform, architecture: process.arch }
  const persist = async () => {
    report.unexecutedRequests = report.plannedRequests - report.attemptedRequests
    report.summary = summary(report.runs)
    report.returnedModels = [...new Set(report.runs.map(run => run.returnedModel).filter(Boolean))]
    report.consistentReturnedModel = report.returnedModels.length === 1 && report.runs.every(run => typeof run.returnedModel === 'string' && run.returnedModel.length > 0)
    const temporary = resolve(config.output, 'report.next.json')
    await writeFile(temporary, JSON.stringify(report, null, 2), { flag: 'wx' })
    await rename(temporary, resolve(config.output, 'report.json'))
  }
  try { report.validator = independentValidation({ python: config.python }) }
  catch { report.status = 'setup-failed'; report.stopReason = 'INDEPENDENT_VALIDATOR_UNAVAILABLE'; await persist(); return report }
  const tool = toolDefinition()
  report.status = 'running'; await persist()
  for (let repetition = 0; repetition < config.repetitions; repetition++) for (let taskIndex = 0; taskIndex < pilotTasks.length; taskIndex++) {
    const task = pilotTasks[taskIndex], order = (repetition + taskIndex) % 2 ? [...arms].reverse() : arms
    for (const arm of order) {
      const body = requestBody(task, arm, config, tool)
      const prefix = `${task.id}-${arm}-${repetition + 1}`
      const requestText = JSON.stringify(body)
      await writeFile(resolve(config.output, `${prefix}-request.json`), requestText, { flag: 'wx' })
      const run = { taskId: task.id, arm, repetition: repetition + 1, order: order.indexOf(arm), status: 'requesting', requestedModel: config.model, requestBytes: byteLength(body), requestSha256: hash(requestText), validation: { passed: false }, usage: null, cost: null, transportLatencyMs: null, totalMs: null, files: { request: `${prefix}-request.json` } }
      report.attemptedRequests++
      report.runs.push(run)
      // Persist intent before dispatch. An interrupted "requesting" record has unknown provider outcome;
      // do not silently replay it or count it as an unattempted request.
      await persist()
      const started = performance.now(), transportStarted = performance.now()
      let stopped = false
      try {
        let raw
        try { raw = await transport(config, body) } finally { run.transportLatencyMs = performance.now() - transportStarted }
        run.usage = extractKJModelUsage(protocol, raw, { latencyMs: run.transportLatencyMs })
        const safe = safeResponse(raw, run.usage, config.apiKey)
        run.returnedModel = safe.model
        run.finishReason = safe.choices[0].finish_reason
        const responseText = JSON.stringify(safe)
        run.files.response = `${prefix}-response.json`; run.responseSha256 = hash(responseText)
        await writeFile(resolve(config.output, run.files.response), responseText, { flag: 'wx' })
        const dxf = await materialize(safe, arm, config.model)
        run.validation = independentValidation({ python: config.python, dxf, expected: task.expected })
        run.status = run.validation.passed ? 'passed' : 'geometry-failed'
        run.files.dxf = `${prefix}.dxf`; run.dxfSha256 = hash(dxf)
        await writeFile(resolve(config.output, run.files.dxf), dxf, { flag: 'wx' })
      } catch (error) {
        run.status = 'failed'
        run.failure = error instanceof BenchmarkFailure ? error.code : 'BENCHMARK_EXECUTION_FAILED'
        if (error instanceof BenchmarkFailure && error.httpStatus !== null) run.httpStatus = error.httpStatus
        if (error instanceof BenchmarkFailure && error.stop) { stopped = true; report.status = 'stopped'; report.stopReason = run.failure }
      }
      run.totalMs = performance.now() - started
      await persist()
      if (stopped) return report
    }
  }
  report.status = 'complete'; await persist()
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(argument => argument !== '--live' && !/^--(?:output|repetitions|max-requests|timeout-ms)=.+$/.test(argument))) throw new Error('Use --live only with explicit configuration; options: --output, --repetitions, --max-requests, --timeout-ms')
  const value = (name, fallback) => args.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
  const repetitions = Number(value('repetitions', 5)), maxRequests = Number(value('max-requests', 30))
  if (!args.includes('--live')) console.log(JSON.stringify(pairedModelPlan({ repetitions, maxRequests }), null, 2))
  else {
    const report = await runPairedModelBenchmark({ ...liveModelConfiguration(), repetitions, maxRequests, timeoutMs: Number(value('timeout-ms', 60000)), output: value('output') })
    console.log(JSON.stringify({ mode: report.mode, status: report.status, attemptedRequests: report.attemptedRequests, unexecutedRequests: report.unexecutedRequests, passed: report.runs.filter(run => run.validation.passed).length, stopReason: report.stopReason ?? null }))
    if (report.status !== 'complete' || report.runs.some(run => !run.validation.passed)) process.exitCode = 1
  }
}
