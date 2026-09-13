// Explicit paired live experiment. Default CLI execution only prints a dry-run plan.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJModelAdapter } from '../../packages/kjdraw-sdk/src/model-adapters.js'
import { extractKJModelUsage } from '../../packages/kjdraw-sdk/src/model-usage.js'
import { pilotTasks } from './model-drawing-pilot.mjs'
import { engineeringDrawingTasks, engineeringDrawingScope } from './engineering-drawing-tasks.mjs'
import { parametricDrawingTasks } from './parametric-drawing-tasks.mjs'
import { spawnSyncWithFileStdin } from '../spawn-file-stdin.mjs'

const protocol = 'chat-completions'
const arms = ['kjdraw-tool', 'direct-dxf']
const drawingTools = ['cad_propose_drawing', 'cad_propose_drawing_compact', 'cad_propose_drawing_pattern', 'cad_propose_drawing_annotated', 'cad_propose_manufacturing_sheet']
const taskSuites = { pilot: pilotTasks, parametric: parametricDrawingTasks, engineering: engineeringDrawingTasks.map(({ id, prompt, requirements }) => ({ id, prompt, expected: requirements })) }
const validatorScript = fileURLToPath(new URL('./paired-model-validator.py', import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const byteLength = value => Buffer.byteLength(JSON.stringify(value))
class BenchmarkFailure extends Error {
  constructor(code, stop = false, httpStatus = null) { super(code); this.code = code; this.stop = stop; this.httpStatus = httpStatus }
}
const fail = (code, stop = false, status = null) => { throw new BenchmarkFailure(code, stop, status) }

function providerSettings({ chatTokenParameter = 'max_tokens', maxOutputTokens = 4096, thinkingMode, enableThinking, reasoningEffort } = {}) {
  if (!['max_tokens', 'max_completion_tokens'].includes(chatTokenParameter)) throw new Error('chatTokenParameter must be max_tokens or max_completion_tokens')
  if (thinkingMode !== undefined && !['disabled', 'enabled'].includes(thinkingMode)) throw new Error('thinkingMode must be disabled or enabled')
  if (enableThinking !== undefined && typeof enableThinking !== 'boolean') throw new Error('enableThinking must be boolean')
  if (thinkingMode !== undefined && enableThinking !== undefined) throw new Error('Configure only one thinking format')
  if (reasoningEffort !== undefined && !['low', 'medium', 'high', 'xhigh'].includes(reasoningEffort)) throw new Error('reasoningEffort must be low, medium, high or xhigh')
  if (reasoningEffort !== undefined && (thinkingMode === 'disabled' || enableThinking === false)) throw new Error('reasoningEffort conflicts with disabled thinking')
  return { temperature: 0, [chatTokenParameter]: maxOutputTokens, stream: false, ...(thinkingMode !== undefined ? { thinking: { type: thinkingMode } } : {}), ...(enableThinking !== undefined ? { enable_thinking: enableThinking } : {}), ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}) }
}

export function pairedModelPlan({ repetitions = 5, maxRequests = 30, taskSuite = 'pilot', maxOutputTokens = 4096, exploratory = false, chatTokenParameter = 'max_tokens', thinkingMode, enableThinking, reasoningEffort } = {}) {
  if (typeof exploratory !== 'boolean') throw new Error('Exploratory mode must be explicit boolean')
  if (!Object.hasOwn(taskSuites, taskSuite)) throw new Error('Choose an explicit supported task suite')
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 4096 || maxOutputTokens > 32768) throw new Error('Choose an output cap from 4096 to 32768 tokens')
  const tasks = taskSuites[taskSuite]
  if (!Number.isSafeInteger(repetitions) || repetitions < (exploratory ? 1 : 5) || repetitions > 30) throw new Error('Choose 5–30 repetitions, or explicitly exploratory 1–30')
  const plannedRequests = tasks.length * arms.length * repetitions
  if (!Number.isSafeInteger(maxRequests) || maxRequests < plannedRequests || maxRequests > 180) throw new Error('Explicit request budget must cover the complete paired plan and be at most 180')
  return { mode: 'dry-run', exploratory, protocol, repetitions, maxRequests, plannedRequests, actualRequests: 0, tasks: tasks.map(task => ({ id: task.id, prompt: task.prompt })), taskSuite, arms, chatTokenParameter, settings: providerSettings({ chatTokenParameter, maxOutputTokens, thinkingMode, enableThinking, reasoningEffort }), scope: taskSuite === 'engineering' ? engineeringDrawingScope : taskSuite === 'pilot' ? 'Three simple fully specified synthetic tasks, repeated one-shot generation. This is not a complex autonomous CAD evaluation.' : 'Three fully specified synthetic 2D geometry tasks with repeated patterns, repeated one-shot generation. No dimensions, annotations, complete drawing sheets or autonomous design are evaluated.' }
}

export function liveModelConfiguration(env = process.env) {
  if (env.KJDRAW_BENCH_PROTOCOL !== protocol || !env.KJDRAW_BENCH_MODEL || !env.KJDRAW_BENCH_ENDPOINT || !env.KJDRAW_BENCH_API_KEY) throw new Error('Set explicit KJDRAW_BENCH_PROTOCOL, KJDRAW_BENCH_MODEL, KJDRAW_BENCH_ENDPOINT and KJDRAW_BENCH_API_KEY')
  const drawingTool = env.KJDRAW_BENCH_DRAWING_TOOL ?? 'cad_propose_drawing'
  if (!drawingTools.includes(drawingTool)) throw new Error('Unsupported explicit drawing tool')
  const thinkingMode = env.KJDRAW_BENCH_THINKING
  if (thinkingMode !== undefined && !['disabled', 'enabled'].includes(thinkingMode)) throw new Error('KJDRAW_BENCH_THINKING must be disabled or enabled when configured')
  const toolChoiceMode = env.KJDRAW_BENCH_TOOL_CHOICE ?? 'forced'
  if (!['auto', 'forced'].includes(toolChoiceMode)) throw new Error('KJDRAW_BENCH_TOOL_CHOICE must be auto or forced')
  const enableThinking = env.KJDRAW_BENCH_ENABLE_THINKING
  if (enableThinking !== undefined && !['true', 'false'].includes(enableThinking)) throw new Error('KJDRAW_BENCH_ENABLE_THINKING must be true or false when configured')
  if (thinkingMode !== undefined && enableThinking !== undefined) throw new Error('Configure only one thinking format')
  const chatTokenParameter = env.KJDRAW_BENCH_CHAT_TOKEN_PARAMETER ?? 'max_tokens'
  const reasoningEffort = env.KJDRAW_BENCH_REASONING_EFFORT
  const explicit = { chatTokenParameter, ...(thinkingMode !== undefined ? { thinkingMode } : {}), ...(enableThinking !== undefined ? { enableThinking: enableThinking === 'true' } : {}), ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) }
  providerSettings(explicit)
  return { mode: 'live', protocol, model: env.KJDRAW_BENCH_MODEL, endpoint: env.KJDRAW_BENCH_ENDPOINT, apiKey: env.KJDRAW_BENCH_API_KEY, toolChoiceMode, drawingTool, ...explicit }
}

export function independentValidation({ python = process.env.KJDRAW_PYTHON ?? 'python', dxf, expected, timeoutMs = 30000, taskSuite = 'pilot' } = {}) {
  const script = taskSuite === 'engineering' ? fileURLToPath(new URL('./engineering-model-validator.py', import.meta.url)) : validatorScript
  const result = spawnSyncWithFileStdin(python, ['-B', script, ...(dxf === undefined ? ['--probe'] : [])], dxf === undefined ? undefined : JSON.stringify({ dxf, expected }), { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 65536, windowsHide: true })
  if (result.status !== 0 || result.error) throw new BenchmarkFailure('INDEPENDENT_VALIDATOR_UNAVAILABLE', true)
  let value
  try { value = JSON.parse(result.stdout) } catch { throw new BenchmarkFailure('INDEPENDENT_VALIDATOR_INVALID', true) }
  if (value.validator !== (taskSuite === 'engineering' ? 'ezdxf-engineering' : 'ezdxf') || typeof value.version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(value.version) || (dxf !== undefined && typeof value.passed !== 'boolean')) throw new BenchmarkFailure('INDEPENDENT_VALIDATOR_INVALID', true)
  return value
}

function configuration(options) {
  const plan = pairedModelPlan(options)
  const drawingTool = options.drawingTool ?? 'cad_propose_drawing'
  if (!drawingTools.includes(drawingTool)) throw new Error('Unsupported explicit drawing tool')
  plan.drawingTool = drawingTool
  const toolChoiceMode = options.toolChoiceMode ?? 'forced'
  if (!['auto', 'forced'].includes(toolChoiceMode)) throw new Error('toolChoiceMode must be auto or forced')
  plan.toolChoiceMode = toolChoiceMode
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

function toolDefinition(name) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const definition = new KJAgentToolSession(sdk, document).definitions.find(tool => tool.name === name)
  return { type: 'function', function: { name: definition.name, description: definition.description, parameters: definition.inputSchema } }
}

function requestBody(task, arm, config, tool) {
  const engineering = config.taskSuite === 'engineering'
  const common = engineering ? 'The drawing is empty, revision 0, units millimeter, model XY at z=0. Produce all geometry, dimensions, text and styles explicitly requested below. ' : 'Create a 2D engineering drawing from the following fully specified synthetic request. All coordinates and lengths are millimeters, model XY at z=0. The drawing is empty, revision 0. No text, dimensions, hatch, construction lines or additional geometry. '
  const system = arm === 'kjdraw-tool'
    ? `Use exactly one ${config.drawingTool} tool call. The current units and revision have already been supplied. Return requested editable geometry for synthetic benchmark review.`
    : `Return only a complete valid ASCII DXF file, no markdown or commentary. Use DXF AC1027 or newer and set $INSUNITS to 4 (millimeters). ${engineering ? 'Use editable LINE, CIRCLE, ARC, straight LWPOLYLINE, TEXT and native DIMENSION entities, with valid dimension graphics blocks, layer and linetype tables as requested.' : 'Use LINE, CIRCLE, ARC and/or straight LWPOLYLINE entities.'} Do not use any CAD library or tool.`
  return { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: common + task.prompt }], ...config.settings, ...(arm === 'kjdraw-tool' ? { tools: [tool], tool_choice: config.toolChoiceMode === 'auto' ? 'auto' : { type: 'function', function: { name: config.drawingTool } } } : {}) }
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

async function materialize(response, arm, modelName, name) {
  const message = response.choices[0].message, finish = response.choices[0].finish_reason
  if (arm === 'direct-dxf') {
    if (finish !== 'stop' || typeof message.content !== 'string' || !message.content.trim() || message.content.includes('```') || message.tool_calls?.length) fail('INVALID_DIRECT_DXF_RESPONSE')
    return message.content
  }
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const model = createKJModelAdapter({ protocol, model: modelName, request: async () => response })
  let turn
  try { turn = await model.createConversation({ instructions: 'Materialize a captured synthetic benchmark proposal.', tools: [session.definitions.find(tool => tool.name === name)] }).next({ kind: 'prompt', text: 'Return one drawing proposal.' }, new AbortController().signal) } catch { fail('MODEL_TOOL_RESPONSE_REJECTED') }
  if (turn.calls.length !== 1 || turn.calls[0].name !== name) fail('MODEL_TOOL_RESPONSE_REJECTED')
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
  const report = { schema: 'com.kanjie.kjdraw.benchmark.paired-model@1', mode: config.mode, exploratory: config.exploratory, publishableModelEvidence: false, publicationReviewRequired: config.mode === 'live', status: 'preparing', createdAt: new Date().toISOString(), model: config.model, protocol, endpointOrigin: new URL(config.endpoint).origin, settings: config.settings, repetitions: config.repetitions, maxRequests: config.maxRequests, plannedRequests: config.plannedRequests, attemptedRequests: 0, unexecutedRequests: config.plannedRequests, timeoutMs: config.timeoutMs, cost: null, scope: config.scope, fixtureWarning: config.mode === 'fixture' ? 'LOCAL FAKE PROVIDER: transport/SDK/validator conformance only. Never use these simulated usage counters in public model rankings or savings claims.' : null, taskSuite: config.taskSuite, tasks: taskSuites[config.taskSuite].map(task => ({ ...task, fixtureSha256: hash(JSON.stringify(task.expected)) })), validator: null, source: {}, runs: [], summary: {} }
  report.toolChoiceMode = config.toolChoiceMode
  report.drawingTool = config.drawingTool
  report.chatTokenParameter = config.chatTokenParameter
  for (const name of ['paired-model-benchmark.mjs', 'paired-model-validator.py', 'model-drawing-pilot.mjs', 'deepseek-drawing-pilot.py', 'parametric-drawing-tasks.mjs', 'drawing-strategies.mjs', 'engineering-drawing-tasks.mjs', 'engineering-model-validator.py']) report.source[name] = hash(await readFile(new URL(name, import.meta.url)))
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
  try { report.validator = independentValidation({ python: config.python, taskSuite: config.taskSuite }) }
  catch { report.status = 'setup-failed'; report.stopReason = 'INDEPENDENT_VALIDATOR_UNAVAILABLE'; await persist(); return report }
  const tool = toolDefinition(config.drawingTool)
  const tasks = taskSuites[config.taskSuite]
  report.status = 'running'; await persist()
  for (let repetition = 0; repetition < config.repetitions; repetition++) for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
    const task = tasks[taskIndex], order = (repetition + taskIndex) % 2 ? [...arms].reverse() : arms
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
        const dxf = await materialize(safe, arm, config.model, config.drawingTool)
        run.validation = independentValidation({ python: config.python, dxf, expected: task.expected, taskSuite: config.taskSuite })
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
  if (args.some(argument => argument !== '--live' && argument !== '--explore' && !/^--(?:output|repetitions|max-requests|timeout-ms|task-suite|max-output-tokens|chat-token-parameter|reasoning-effort)=.+$/.test(argument))) throw new Error('Use --live only with explicit configuration; options: --output, --repetitions, --max-requests, --timeout-ms, --task-suite, --max-output-tokens, --chat-token-parameter, --reasoning-effort')
  const value = (name, fallback) => args.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
  const exploratory = args.includes('--explore')
  const repetitions = Number(value('repetitions', 5)), maxRequests = Number(value('max-requests', 30)), taskSuite = value('task-suite', 'pilot'), maxOutputTokens = Number(value('max-output-tokens', 4096))
  const chatTokenParameter = value('chat-token-parameter', process.env.KJDRAW_BENCH_CHAT_TOKEN_PARAMETER ?? 'max_tokens'), reasoningEffort = value('reasoning-effort', process.env.KJDRAW_BENCH_REASONING_EFFORT)
  const enableThinkingValue = process.env.KJDRAW_BENCH_ENABLE_THINKING
  if (enableThinkingValue !== undefined && !['true', 'false'].includes(enableThinkingValue)) throw new Error('KJDRAW_BENCH_ENABLE_THINKING must be true or false when configured')
  if (!args.includes('--live')) console.log(JSON.stringify(pairedModelPlan({ repetitions, maxRequests, taskSuite, maxOutputTokens, exploratory, chatTokenParameter, reasoningEffort, thinkingMode: process.env.KJDRAW_BENCH_THINKING, ...(enableThinkingValue !== undefined ? { enableThinking: enableThinkingValue === 'true' } : {}) }), null, 2))
  else {
    const report = await runPairedModelBenchmark({ ...liveModelConfiguration(), repetitions, maxRequests, taskSuite, maxOutputTokens, exploratory, chatTokenParameter, reasoningEffort, timeoutMs: Number(value('timeout-ms', 60000)), output: value('output') })
    console.log(JSON.stringify({ mode: report.mode, status: report.status, attemptedRequests: report.attemptedRequests, unexecutedRequests: report.unexecutedRequests, passed: report.runs.filter(run => run.validation.passed).length, stopReason: report.stopReason ?? null }))
    if (report.status !== 'complete' || report.runs.some(run => !run.validation.passed)) process.exitCode = 1
  }
}
