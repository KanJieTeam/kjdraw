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
import { manufacturingDrawingTasks, manufacturingDrawingScope } from './manufacturing-drawing-tasks.mjs'
import { manufacturingTaskSuite, manufacturingTaskSuiteScope } from './manufacturing-task-suite.mjs'
import { releaseHoldoutDrawingTool, releaseHoldoutGenerationTasks, releaseHoldoutTaskSuiteScope } from './release-holdout-task-suite.mjs'
import { parametricDrawingTasks } from './parametric-drawing-tasks.mjs'
import { spawnSyncWithFileStdin } from '../spawn-file-stdin.mjs'
import { readChatModelResponse } from '../../apps/playground/chat-model-settings.js'

const protocol = 'chat-completions'
const arms = ['kjdraw-tool', 'direct-dxf']
const drawingTools = ['cad_propose_drawing', 'cad_propose_drawing_compact', 'cad_propose_drawing_pattern', 'cad_propose_drawing_annotated', 'cad_propose_manufacturing_sheet', 'cad_propose_architecture_plan', 'cad_propose_site_plan']
const taskSuites = { pilot: pilotTasks, parametric: parametricDrawingTasks, engineering: engineeringDrawingTasks.map(({ id, prompt, requirements }) => ({ id, prompt, expected: requirements })), manufacturing: manufacturingDrawingTasks, 'manufacturing-30': manufacturingTaskSuite, 'release-holdout-generation': releaseHoldoutGenerationTasks }
const validatorScript = fileURLToPath(new URL('./paired-model-validator.py', import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const byteLength = value => Buffer.byteLength(JSON.stringify(value))
class BenchmarkFailure extends Error {
  constructor(code, stop = false, httpStatus = null) { super(code); this.code = code; this.stop = stop; this.httpStatus = httpStatus }
}
const fail = (code, stop = false, status = null) => { throw new BenchmarkFailure(code, stop, status) }

export function benchmarkProviderSettings({ chatTokenParameter = 'max_tokens', maxOutputTokens = 4096, temperature = 0, stream = false, thinkingMode, enableThinking, reasoningEffort } = {}) {
  if (!['max_tokens', 'max_completion_tokens'].includes(chatTokenParameter)) throw new Error('chatTokenParameter must be max_tokens or max_completion_tokens')
  if (temperature !== null && (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)) throw new Error('temperature must be null (omit) or a finite number from 0 to 2')
  if (typeof stream !== 'boolean') throw new Error('stream must be boolean')
  if (thinkingMode !== undefined && !['disabled', 'enabled'].includes(thinkingMode)) throw new Error('thinkingMode must be disabled or enabled')
  if (enableThinking !== undefined && typeof enableThinking !== 'boolean') throw new Error('enableThinking must be boolean')
  if (thinkingMode !== undefined && enableThinking !== undefined) throw new Error('Configure only one thinking format')
  if (reasoningEffort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) throw new Error('reasoningEffort must be low, medium, high, xhigh or max')
  if (reasoningEffort !== undefined && (thinkingMode === 'disabled' || enableThinking === false)) throw new Error('reasoningEffort conflicts with disabled thinking')
  return { ...(temperature === null ? {} : { temperature }), [chatTokenParameter]: maxOutputTokens, stream, ...(stream ? { stream_options: { include_usage: true } } : {}), ...(thinkingMode !== undefined ? { thinking: { type: thinkingMode } } : {}), ...(enableThinking !== undefined ? { enable_thinking: enableThinking } : {}), ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}) }
}

export function benchmarkPricing(value) {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Benchmark pricing must be an object')
  const keys = Object.keys(value).sort()
  if (keys.join(',') !== 'cachedInputPerMillion,currency,inputPerMillion,outputPerMillion') throw new Error('Benchmark pricing requires currency and exact per-million input, cached-input and output rates')
  if (typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) throw new Error('Benchmark pricing currency must be a three-letter uppercase code')
  for (const name of ['inputPerMillion', 'cachedInputPerMillion', 'outputPerMillion']) if (typeof value[name] !== 'number' || !Number.isFinite(value[name]) || value[name] < 0 || value[name] > 1_000_000) throw new Error(`Benchmark pricing ${name} must be a finite nonnegative number`)
  return Object.freeze({ currency: value.currency, inputPerMillion: value.inputPerMillion, cachedInputPerMillion: value.cachedInputPerMillion, outputPerMillion: value.outputPerMillion })
}

export function benchmarkRunCost(usage, pricing) {
  if (!pricing) return null
  const normalized = benchmarkPricing(pricing)
  const inputTokens = usage?.inputTokens, outputTokens = usage?.outputTokens, cachedInputTokens = usage?.cacheReadInputTokens
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) return null
  if ((!Number.isSafeInteger(cachedInputTokens) || cachedInputTokens < 0 || cachedInputTokens > inputTokens) && normalized.cachedInputPerMillion !== normalized.inputPerMillion) return null
  const cached = Number.isSafeInteger(cachedInputTokens) && cachedInputTokens >= 0 && cachedInputTokens <= inputTokens ? cachedInputTokens : 0
  const uncached = inputTokens - cached
  const amount = (uncached * normalized.inputPerMillion + cached * normalized.cachedInputPerMillion + outputTokens * normalized.outputPerMillion) / 1_000_000
  return { currency: normalized.currency, amount: Number(amount.toFixed(12)), uncachedInputTokens: uncached, cachedInputTokens: cached, outputTokens, ratesPerMillion: normalized }
}

export function pairedModelPlan({ repetitions = 5, maxRequests = 30, taskSuite = 'pilot', drawingTool, maxOutputTokens = 4096, exploratory = false, chatTokenParameter = 'max_tokens', temperature = 0, stream = false, thinkingMode, enableThinking, reasoningEffort } = {}) {
  if (typeof exploratory !== 'boolean') throw new Error('Exploratory mode must be explicit boolean')
  if (!Object.hasOwn(taskSuites, taskSuite)) throw new Error('Choose an explicit supported task suite')
  const perTaskTools = taskSuite === 'release-holdout-generation'
  if (perTaskTools && drawingTool !== undefined) throw new Error(`${taskSuite} selects the declared tool and units independently for every task`)
  const requiredDrawingTool = taskSuite === 'manufacturing-30' ? 'cad_propose_manufacturing_sheet' : null
  const selectedDrawingTool = drawingTool ?? requiredDrawingTool ?? 'cad_propose_drawing'
  if (!perTaskTools && !drawingTools.includes(selectedDrawingTool)) throw new Error('Unsupported explicit drawing tool')
  if (requiredDrawingTool && selectedDrawingTool !== requiredDrawingTool) throw new Error(`${taskSuite} requires ${requiredDrawingTool}`)
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 4096 || maxOutputTokens > 32768) throw new Error('Choose an output cap from 4096 to 32768 tokens')
  const tasks = taskSuites[taskSuite]
  if (!Number.isSafeInteger(repetitions) || repetitions < (exploratory ? 1 : 5) || repetitions > 30) throw new Error('Choose 5–30 repetitions, or explicitly exploratory 1–30')
  const plannedRequests = tasks.length * arms.length * repetitions
  if (!Number.isSafeInteger(maxRequests) || maxRequests < plannedRequests || maxRequests > 1800) throw new Error('Explicit request budget must cover the complete paired plan and be at most 1800')
  return { mode: 'dry-run', exploratory, protocol, repetitions, maxRequests, plannedRequests, actualRequests: 0, tasks: tasks.map(task => ({ id: task.id, prompt: task.prompt, ...(task.version ? { version: task.version } : {}), ...(task.category ? { category: task.category } : {}), ...(task.drawingTool ? { drawingTool: task.drawingTool } : {}), ...(task.units ? { units: task.units } : {}), ...(task.inputSha256 ? { inputSha256: task.inputSha256 } : {}), ...(task.referenceInputSha256 ? { referenceInputSha256: task.referenceInputSha256 } : {}), ...(task.acceptanceSha256 ? { acceptanceSha256: task.acceptanceSha256 } : {}), ...(task.budget ? { budget: structuredClone(task.budget) } : {}) })), taskSuite, drawingTool: perTaskTools ? releaseHoldoutDrawingTool : selectedDrawingTool, arms, chatTokenParameter, settings: benchmarkProviderSettings({ chatTokenParameter, maxOutputTokens, temperature, stream, thinkingMode, enableThinking, reasoningEffort }), scope: taskSuite === 'engineering' ? engineeringDrawingScope : taskSuite === 'manufacturing' ? manufacturingDrawingScope : taskSuite === 'manufacturing-30' ? manufacturingTaskSuiteScope : taskSuite === 'release-holdout-generation' ? releaseHoldoutTaskSuiteScope : taskSuite === 'pilot' ? 'Three simple fully specified synthetic tasks, repeated one-shot generation. This is not a complex autonomous CAD evaluation.' : 'Three fully specified synthetic 2D geometry tasks with repeated patterns, repeated one-shot generation. No dimensions, annotations, complete drawing sheets or autonomous design are evaluated.' }
}

export function liveModelConfiguration(env = process.env) {
  if (env.KJDRAW_BENCH_PROTOCOL !== protocol || !env.KJDRAW_BENCH_MODEL || !env.KJDRAW_BENCH_ENDPOINT || !env.KJDRAW_BENCH_API_KEY) throw new Error('Set explicit KJDRAW_BENCH_PROTOCOL, KJDRAW_BENCH_MODEL, KJDRAW_BENCH_ENDPOINT and KJDRAW_BENCH_API_KEY')
  const drawingTool = env.KJDRAW_BENCH_DRAWING_TOOL ?? 'cad_propose_drawing'
  if (!drawingTools.includes(drawingTool)) throw new Error('Unsupported explicit drawing tool')
  const thinkingMode = env.KJDRAW_BENCH_THINKING
  if (thinkingMode !== undefined && !['disabled', 'enabled'].includes(thinkingMode)) throw new Error('KJDRAW_BENCH_THINKING must be disabled or enabled when configured')
  const toolChoiceMode = env.KJDRAW_BENCH_TOOL_CHOICE ?? 'forced'
  if (!['auto', 'forced', 'required'].includes(toolChoiceMode)) throw new Error('KJDRAW_BENCH_TOOL_CHOICE must be auto, forced or required')
  const enableThinking = env.KJDRAW_BENCH_ENABLE_THINKING
  if (enableThinking !== undefined && !['true', 'false'].includes(enableThinking)) throw new Error('KJDRAW_BENCH_ENABLE_THINKING must be true or false when configured')
  if (thinkingMode !== undefined && enableThinking !== undefined) throw new Error('Configure only one thinking format')
  const chatTokenParameter = env.KJDRAW_BENCH_CHAT_TOKEN_PARAMETER ?? 'max_tokens'
  const reasoningEffort = env.KJDRAW_BENCH_REASONING_EFFORT
  const temperatureValue = env.KJDRAW_BENCH_TEMPERATURE
  if (temperatureValue !== undefined && temperatureValue !== 'omit' && (typeof temperatureValue !== 'string' || !temperatureValue.trim())) throw new Error('KJDRAW_BENCH_TEMPERATURE must be omit or a number from 0 to 2')
  const temperature = temperatureValue === 'omit' ? null : temperatureValue === undefined ? 0 : Number(temperatureValue)
  const streamValue = env.KJDRAW_BENCH_STREAM ?? 'false'
  if (!['true', 'false'].includes(streamValue)) throw new Error('KJDRAW_BENCH_STREAM must be true or false')
  const explicit = { chatTokenParameter, temperature, stream: streamValue === 'true', ...(thinkingMode !== undefined ? { thinkingMode } : {}), ...(enableThinking !== undefined ? { enableThinking: enableThinking === 'true' } : {}), ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) }
  benchmarkProviderSettings(explicit)
  let pricing = null
  if (env.KJDRAW_BENCH_PRICING_JSON !== undefined) {
    try { pricing = benchmarkPricing(JSON.parse(env.KJDRAW_BENCH_PRICING_JSON)) } catch (error) { throw new Error(`Invalid KJDRAW_BENCH_PRICING_JSON: ${error instanceof Error ? error.message : 'unknown error'}`) }
  }
  return { mode: 'live', protocol, model: env.KJDRAW_BENCH_MODEL, endpoint: env.KJDRAW_BENCH_ENDPOINT, apiKey: env.KJDRAW_BENCH_API_KEY, toolChoiceMode, drawingTool, pricing, ...explicit }
}

export function independentValidation({ python = process.env.KJDRAW_PYTHON ?? 'python', dxf, expected, timeoutMs = 30000, taskSuite = 'pilot', validatorKind } = {}) {
  const kind = validatorKind ?? (taskSuite === 'engineering' ? 'engineering' : taskSuite === 'manufacturing' || taskSuite === 'manufacturing-30' ? 'manufacturing' : 'generic')
  const script = kind === 'engineering' ? fileURLToPath(new URL('./engineering-model-validator.py', import.meta.url)) : kind === 'manufacturing' ? fileURLToPath(new URL('./manufacturing-model-validator.py', import.meta.url)) : kind === 'release-holdout' ? fileURLToPath(new URL('./release-holdout-validator.py', import.meta.url)) : validatorScript
  const result = spawnSyncWithFileStdin(python, ['-B', script, ...(dxf === undefined ? ['--probe'] : [])], dxf === undefined ? undefined : JSON.stringify({ dxf, expected }), { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 65536, windowsHide: true })
  if (result.status !== 0 || result.error) throw new BenchmarkFailure('INDEPENDENT_VALIDATOR_UNAVAILABLE', true)
  let value
  try { value = JSON.parse(result.stdout) } catch { throw new BenchmarkFailure('INDEPENDENT_VALIDATOR_INVALID', true) }
  const expectedValidator = kind === 'engineering' ? 'ezdxf-engineering' : kind === 'manufacturing' ? 'ezdxf-manufacturing' : kind === 'release-holdout' ? 'ezdxf-release-holdout' : 'ezdxf'
  if (value.validator !== expectedValidator || typeof value.version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(value.version) || (dxf !== undefined && typeof value.passed !== 'boolean')) throw new BenchmarkFailure('INDEPENDENT_VALIDATOR_INVALID', true)
  return value
}

function configuration(options) {
  const plan = pairedModelPlan(options)
  const drawingTool = plan.drawingTool
  plan.drawingTool = drawingTool
  const toolChoiceMode = options.toolChoiceMode ?? 'forced'
  if (!['auto', 'forced', 'required'].includes(toolChoiceMode)) throw new Error('toolChoiceMode must be auto, forced or required')
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
  return { ...plan, mode: options.mode, model: options.model, endpoint: url.href, apiKey: options.apiKey, timeoutMs, output: resolve(options.output), python: options.python ?? process.env.KJDRAW_PYTHON ?? 'python', pricing: benchmarkPricing(options.pricing) }
}

function toolDefinition(name, units = 'millimeter') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units })
  const definition = new KJAgentToolSession(sdk, document).definitions.find(tool => tool.name === name)
  return { type: 'function', function: { name: definition.name, description: definition.description, parameters: definition.inputSchema } }
}

function requestBody(task, arm, config, tool) {
  const drawingTool = task.drawingTool ?? config.drawingTool, units = task.units ?? 'millimeter'
  const completeDrawing = config.taskSuite === 'engineering' || config.taskSuite === 'manufacturing' || config.taskSuite === 'manufacturing-30' || config.taskSuite === 'release-holdout-generation'
  const common = completeDrawing ? `The drawing is empty, revision 0, units ${units}, model XY at z=0. Produce all geometry, dimensions, text and styles explicitly requested below. ` : 'Create a 2D engineering drawing from the following fully specified synthetic request. All coordinates and lengths are millimeters, model XY at z=0. The drawing is empty, revision 0. No text, dimensions, hatch, construction lines or additional geometry. '
  const system = arm === 'kjdraw-tool'
    ? `Use exactly one ${drawingTool} tool call. The current units and revision have already been supplied. Return requested editable geometry for synthetic benchmark review.`
    : `Return only a complete valid ASCII DXF file, no markdown or commentary. Use DXF AC1027 or newer and set $INSUNITS to ${units === 'meter' ? 6 : 4} (${units}). ${completeDrawing ? 'Use editable native CAD entities, layers, linetypes, blocks, text and dimensions as requested.' : 'Use LINE, CIRCLE, ARC and/or straight LWPOLYLINE entities.'} Do not use any CAD library or tool.`
  const settings = task.budget ? { ...config.settings, [config.chatTokenParameter]: Math.min(config.settings[config.chatTokenParameter], task.budget.maxOutputTokens) } : config.settings
  const toolChoice = config.toolChoiceMode === 'auto' ? 'auto' : config.toolChoiceMode === 'required' ? 'required' : { type: 'function', function: { name: drawingTool } }
  return { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: common + task.prompt }], ...settings, ...(arm === 'kjdraw-tool' ? { tools: [tool], tool_choice: toolChoice } : {}) }
}

function streamedChatCompletion(source) {
  return (async () => {
    const tools = new Map()
    let model = null, usage = null, content = '', finishReason = null, events = 0
    for await (const chunk of source) {
      if (++events > 65536 || !chunk || typeof chunk !== 'object' || Array.isArray(chunk)) fail('PROVIDER_INVALID_STREAM', true)
      if (chunk.error !== undefined && chunk.error !== null) fail('PROVIDER_STREAM_ERROR', true)
      if (chunk.model !== undefined) {
        if (typeof chunk.model !== 'string' || (model !== null && model !== chunk.model)) fail('PROVIDER_INVALID_STREAM', true)
        model = chunk.model
      }
      if (chunk.usage !== undefined && chunk.usage !== null) usage = chunk.usage
      if (!Array.isArray(chunk.choices)) fail('PROVIDER_INVALID_STREAM', true)
      if (!chunk.choices.length) continue
      if (chunk.choices.length !== 1 || finishReason !== null) fail('PROVIDER_INVALID_STREAM', true)
      const choice = chunk.choices[0], delta = choice?.delta
      if (choice?.index !== 0 || !delta || typeof delta !== 'object' || Array.isArray(delta)) fail('PROVIDER_INVALID_STREAM', true)
      if (choice.usage !== undefined && choice.usage !== null) usage = choice.usage
      if (delta.role !== undefined && delta.role !== null && delta.role !== 'assistant') fail('PROVIDER_INVALID_STREAM', true)
      if (delta.content !== undefined && delta.content !== null) {
        if (typeof delta.content !== 'string') fail('PROVIDER_INVALID_STREAM', true)
        content += delta.content
      }
      if (delta.refusal !== undefined && delta.refusal !== null && delta.refusal !== '') fail('MODEL_REFUSED')
      if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
        if (!Array.isArray(delta.tool_calls)) fail('PROVIDER_INVALID_STREAM', true)
        for (const fragment of delta.tool_calls) {
          if (!Number.isSafeInteger(fragment?.index) || fragment.index < 0 || fragment.index > 15) fail('PROVIDER_INVALID_STREAM', true)
          const current = tools.get(fragment.index) ?? { id: '', type: 'function', name: '', arguments: '' }
          if (fragment.id !== undefined && fragment.id !== null) {
            if (typeof fragment.id !== 'string' || !fragment.id || (current.id && current.id !== fragment.id)) fail('PROVIDER_INVALID_STREAM', true)
            current.id = fragment.id
          }
          if (fragment.type !== undefined && fragment.type !== null && fragment.type !== 'function') fail('PROVIDER_INVALID_STREAM', true)
          if (fragment.function !== undefined && fragment.function !== null) {
            if (!fragment.function || typeof fragment.function !== 'object' || Array.isArray(fragment.function)) fail('PROVIDER_INVALID_STREAM', true)
            if (fragment.function.name !== undefined && fragment.function.name !== null) current.name += typeof fragment.function.name === 'string' ? fragment.function.name : fail('PROVIDER_INVALID_STREAM', true)
            if (fragment.function.arguments !== undefined && fragment.function.arguments !== null) current.arguments += typeof fragment.function.arguments === 'string' ? fragment.function.arguments : fail('PROVIDER_INVALID_STREAM', true)
          }
          tools.set(fragment.index, current)
        }
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (typeof choice.finish_reason !== 'string' || !choice.finish_reason) fail('PROVIDER_INVALID_STREAM', true)
        finishReason = choice.finish_reason
      }
    }
    const indexes = [...tools.keys()].sort((left, right) => left - right)
    if (!events || finishReason === null || indexes.some((value, index) => value !== index)) fail('PROVIDER_INVALID_STREAM', true)
    const toolCalls = indexes.map(index => {
      const value = tools.get(index)
      if (!value.id || !value.name) fail('PROVIDER_INVALID_STREAM', true)
      return { id: value.id, type: 'function', function: { name: value.name, arguments: value.arguments } }
    })
    if (finishReason === 'tool_calls' && !toolCalls.length) fail('PROVIDER_INVALID_STREAM', true)
    return { model, usage, choices: [{ finish_reason: finishReason, message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } }] }
  })()
}

export async function readBenchmarkChatResponse(response) {
  const value = await readChatModelResponse(response, { maxBytes: 2097152 })
  return value && typeof value[Symbol.asyncIterator] === 'function' ? streamedChatCompletion(value) : value
}

async function transport(config, body) {
  const signal = AbortSignal.timeout(config.timeoutMs)
  try {
    const response = await fetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify(body), signal, redirect: 'error' })
    if (!response.ok) { await response.body?.cancel(); fail('PROVIDER_HTTP_FAILURE', true, response.status) }
    if (!response.body) fail('PROVIDER_EMPTY_RESPONSE', true)
    let value
    try { value = await readBenchmarkChatResponse(response) } catch (error) {
      if (error instanceof BenchmarkFailure) throw error
      fail(config.settings.stream ? 'PROVIDER_INVALID_STREAM' : 'PROVIDER_INVALID_JSON', true)
    }
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

async function materialize(response, arm, modelName, name, units = 'millimeter') {
  const message = response.choices[0].message, finish = response.choices[0].finish_reason
  if (arm === 'direct-dxf') {
    if (finish !== 'stop' || typeof message.content !== 'string' || !message.content.trim() || message.content.includes('```') || message.tool_calls?.length) fail('INVALID_DIRECT_DXF_RESPONSE')
    return message.content
  }
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units })
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
const sumKnownFinite = values => values.length && values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) ? values.reduce((a, b) => a + b, 0) : null
const sumCosts = values => {
  if (!values.length || values.some(value => !value || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || typeof value.currency !== 'string')) return null
  const currencies = [...new Set(values.map(value => value.currency))]
  return currencies.length === 1 ? { currency: currencies[0], amount: Number(values.reduce((total, value) => total + value.amount, 0).toFixed(12)) } : null
}
function summary(runs) {
  return Object.fromEntries(arms.map(arm => {
    const selected = runs.filter(run => run.arm === arm)
    return [arm, { attempted: selected.length, passed: selected.filter(run => run.status === 'passed').length, failures: selected.filter(run => run.status !== 'passed').length, humanInterventionCount: selected.reduce((total, run) => total + run.humanInterventionCount, 0), transportLatencyMs: sumKnownFinite(selected.map(run => run.transportLatencyMs)), totalMs: sumKnownFinite(selected.map(run => run.totalMs)), inputTokens: sumKnown(selected.map(run => run.usage?.inputTokens)), outputTokens: sumKnown(selected.map(run => run.usage?.outputTokens)), totalTokens: sumKnown(selected.map(run => run.usage?.totalTokens)), cacheReadInputTokens: sumKnown(selected.map(run => run.usage?.cacheReadInputTokens)), cacheMissInputTokens: sumKnown(selected.map(run => run.usage?.cacheMissInputTokens)), reasoningOutputTokens: sumKnown(selected.map(run => run.usage?.reasoningOutputTokens)), cost: sumCosts(selected.map(run => run.cost)) }]
  }))
}

export function taskBudgetCompliance(run, budget) {
  const observed = { inputTokens: run.usage?.inputTokens ?? null, outputTokens: run.usage?.outputTokens ?? null, toolCalls: run.modelToolCallCount, wallTimeMs: run.totalMs, humanInterventions: run.humanInterventionCount }
  const reasons = []
  for (const [name, maximum] of [['inputTokens', budget.maxInputTokens], ['outputTokens', budget.maxOutputTokens], ['toolCalls', budget.maxToolCalls], ['wallTimeMs', budget.maxWallTimeMs], ['humanInterventions', budget.maxHumanInterventions]]) {
    if (typeof observed[name] !== 'number' || !Number.isFinite(observed[name])) reasons.push(`${name.toUpperCase()}_UNKNOWN`)
    else if (observed[name] > maximum) reasons.push(`${name.toUpperCase()}_EXCEEDED`)
  }
  return { passed: reasons.length === 0, reasons, observed }
}

export async function runPairedModelBenchmark(options) {
  const config = configuration(options)
  await mkdir(dirname(config.output), { recursive: true }); await mkdir(config.output)
  const reportTasks = taskSuites[config.taskSuite].map(task => {
    const { referenceInput, ...record } = task
    return { ...record, fixtureSha256: hash(JSON.stringify(task.expected)), inputSha256: task.inputSha256 ?? null }
  })
  const report = { schema: 'com.kanjie.kjdraw.benchmark.paired-model@1', mode: config.mode, exploratory: config.exploratory, publishableModelEvidence: false, publicationReviewRequired: config.mode === 'live', status: 'preparing', createdAt: new Date().toISOString(), model: config.model, protocol, endpointOrigin: new URL(config.endpoint).origin, settings: config.settings, repetitions: config.repetitions, maxRequests: config.maxRequests, plannedRequests: config.plannedRequests, attemptedRequests: 0, unexecutedRequests: config.plannedRequests, timeoutMs: config.timeoutMs, pricing: config.pricing, cost: null, humanInterventionCount: 0, humanInterventionDefinition: 'Manual prompt edits, CAD corrections, retries or validation overrides performed after a benchmark request starts. Synthetic proposal approval by the harness is recorded separately and is not a human intervention.', humanInterventionSource: { kind: 'noninteractive-harness', evidence: 'After dispatch the runner has no interactive input path; requests, materialization, approval and validation execute automatically. Harness approvals are counted separately.' }, timingDefinition: 'totalMs begins immediately before the provider request and ends after response capture, CAD materialization, DXF serialization and independent validation for either arm.', latencyDefinition: 'transportLatencyMs measures only the matching HTTP provider request for either arm.', scope: config.scope, fixtureWarning: config.mode === 'fixture' ? 'LOCAL FAKE PROVIDER: transport/SDK/validator conformance only. Never use these simulated usage counters in public model rankings or savings claims.' : null, taskSuite: config.taskSuite, tasks: reportTasks, validator: null, source: {}, runs: [], summary: {} }
  report.toolChoiceMode = config.toolChoiceMode
  report.drawingTool = config.drawingTool
  report.chatTokenParameter = config.chatTokenParameter
  for (const name of ['paired-model-benchmark.mjs', 'paired-model-validator.py', 'model-drawing-pilot.mjs', 'deepseek-drawing-pilot.py', 'parametric-drawing-tasks.mjs', 'drawing-strategies.mjs', 'engineering-drawing-tasks.mjs', 'engineering-model-validator.py', 'manufacturing-drawing-tasks.mjs', 'manufacturing-task-suite.mjs', 'manufacturing-model-validator.py', 'release-holdout-task-suite.mjs', 'release-holdout-validator.py']) report.source[name] = hash(await readFile(new URL(name, import.meta.url)))
  report.source['chat-model-settings.js'] = hash(await readFile(new URL('../../apps/playground/chat-model-settings.js', import.meta.url)))
  report.source['model-usage.js'] = hash(await readFile(new URL('../../packages/kjdraw-sdk/src/model-usage.js', import.meta.url)))
  const sdkFolder = new URL('../../packages/kjdraw-sdk/src/', import.meta.url), sdkHash = createHash('sha256')
  for (const name of (await readdir(sdkFolder, { recursive: true })).map(name => name.replaceAll('\\', '/')).filter(name => name.endsWith('.js')).sort()) { sdkHash.update(name); sdkHash.update(await readFile(new URL(name, sdkFolder))) }
  report.source.sdkRuntimeSha256 = sdkHash.digest('hex')
  report.runtime = { node: process.version, platform: process.platform, architecture: process.arch }
  const persist = async () => {
    report.unexecutedRequests = report.plannedRequests - report.attemptedRequests
    report.summary = summary(report.runs)
    report.cost = sumCosts(report.runs.map(run => run.cost))
    report.humanInterventionCount = report.runs.reduce((total, run) => total + run.humanInterventionCount, 0)
    report.returnedModels = [...new Set(report.runs.map(run => run.returnedModel).filter(Boolean))]
    report.consistentReturnedModel = report.returnedModels.length === 1 && report.runs.every(run => typeof run.returnedModel === 'string' && run.returnedModel.length > 0)
    const temporary = resolve(config.output, 'report.next.json')
    await writeFile(temporary, JSON.stringify(report, null, 2), { flag: 'wx' })
    await rename(temporary, resolve(config.output, 'report.json'))
  }
  const tasks = taskSuites[config.taskSuite]
  try {
    const kinds = [...new Set(tasks.map(task => task.validatorKind).filter(Boolean))]
    report.validator = kinds.length ? Object.fromEntries(kinds.map(kind => [kind, independentValidation({ python: config.python, taskSuite: config.taskSuite, validatorKind: kind })])) : independentValidation({ python: config.python, taskSuite: config.taskSuite })
  } catch { report.status = 'setup-failed'; report.stopReason = 'INDEPENDENT_VALIDATOR_UNAVAILABLE'; await persist(); return report }
  report.status = 'running'; await persist()
  for (let repetition = 0; repetition < config.repetitions; repetition++) for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
    const task = tasks[taskIndex], order = (repetition + taskIndex) % 2 ? [...arms].reverse() : arms
    for (const arm of order) {
      const drawingTool = task.drawingTool ?? config.drawingTool, units = task.units ?? 'millimeter'
      const tool = arm === 'kjdraw-tool' ? toolDefinition(drawingTool, units) : null
      const body = requestBody(task, arm, config, tool)
      const prefix = `${task.id}-${arm}-${repetition + 1}`
      const requestText = JSON.stringify(body)
      await writeFile(resolve(config.output, `${prefix}-request.json`), requestText, { flag: 'wx' })
      const run = { taskId: task.id, taskVersion: task.version ?? null, taskCategory: task.category ?? null, inputSha256: task.inputSha256 ?? null, acceptanceSha256: task.acceptanceSha256 ?? null, budget: task.budget ? structuredClone(task.budget) : null, budgetCompliance: null, arm, repetition: repetition + 1, order: order.indexOf(arm), status: 'requesting', requestedModel: config.model, requestBytes: byteLength(body), requestSha256: hash(requestText), validation: { passed: false }, usage: null, failure: null, humanInterventionCount: 0, humanInterventionEvidence: 'noninteractive-harness', harnessProposalApprovalCount: 0, modelToolCallCount: null, cost: null, transportLatencyMs: null, totalMs: null, files: { request: `${prefix}-request.json` } }
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
        run.cost = benchmarkRunCost(run.usage, config.pricing)
        const safe = safeResponse(raw, run.usage, config.apiKey)
        run.modelToolCallCount = safe.choices[0].message.tool_calls?.length ?? 0
        run.returnedModel = safe.model
        run.finishReason = safe.choices[0].finish_reason
        const responseText = JSON.stringify(safe)
        run.files.response = `${prefix}-response.json`; run.responseSha256 = hash(responseText)
        await writeFile(resolve(config.output, run.files.response), responseText, { flag: 'wx' })
        const dxf = await materialize(safe, arm, config.model, drawingTool, units)
        if (arm === 'kjdraw-tool') run.harnessProposalApprovalCount = 1
        run.validation = independentValidation({ python: config.python, dxf, expected: task.expected, taskSuite: config.taskSuite, validatorKind: task.validatorKind })
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
      if (task.budget) {
        run.budgetCompliance = taskBudgetCompliance(run, task.budget)
        if (run.status === 'passed' && !run.budgetCompliance.passed) { run.status = 'budget-failed'; run.failure = 'TASK_BUDGET_EXCEEDED' }
      }
      await persist()
      if (stopped) return report
    }
  }
  report.status = 'complete'; await persist()
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(argument => argument !== '--live' && argument !== '--explore' && !/^--(?:output|repetitions|max-requests|timeout-ms|task-suite|max-output-tokens|chat-token-parameter|temperature|stream|reasoning-effort)=.+$/.test(argument))) throw new Error('Use --live only with explicit configuration; options: --output, --repetitions, --max-requests, --timeout-ms, --task-suite, --max-output-tokens, --chat-token-parameter, --temperature, --stream, --reasoning-effort')
  const value = (name, fallback) => args.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
  const exploratory = args.includes('--explore')
  const repetitions = Number(value('repetitions', 5)), maxRequests = Number(value('max-requests', 30)), taskSuite = value('task-suite', 'pilot'), maxOutputTokens = Number(value('max-output-tokens', 4096))
  const chatTokenParameter = value('chat-token-parameter', process.env.KJDRAW_BENCH_CHAT_TOKEN_PARAMETER ?? 'max_tokens'), reasoningEffort = value('reasoning-effort', process.env.KJDRAW_BENCH_REASONING_EFFORT)
  const temperatureValue = value('temperature', process.env.KJDRAW_BENCH_TEMPERATURE)
  const temperature = temperatureValue === 'omit' ? null : temperatureValue === undefined ? 0 : Number(temperatureValue)
  const streamValue = value('stream', process.env.KJDRAW_BENCH_STREAM ?? 'false')
  if (!['true', 'false'].includes(streamValue)) throw new Error('stream must be true or false')
  const stream = streamValue === 'true'
  const enableThinkingValue = process.env.KJDRAW_BENCH_ENABLE_THINKING
  if (enableThinkingValue !== undefined && !['true', 'false'].includes(enableThinkingValue)) throw new Error('KJDRAW_BENCH_ENABLE_THINKING must be true or false when configured')
  if (!args.includes('--live')) console.log(JSON.stringify(pairedModelPlan({ repetitions, maxRequests, taskSuite, maxOutputTokens, exploratory, chatTokenParameter, temperature, stream, reasoningEffort, thinkingMode: process.env.KJDRAW_BENCH_THINKING, ...(enableThinkingValue !== undefined ? { enableThinking: enableThinkingValue === 'true' } : {}) }), null, 2))
  else {
    const live = liveModelConfiguration()
    if ((taskSuite === 'manufacturing-30' || taskSuite === 'release-holdout-generation') && process.env.KJDRAW_BENCH_DRAWING_TOOL === undefined) delete live.drawingTool
    const report = await runPairedModelBenchmark({ ...live, repetitions, maxRequests, taskSuite, maxOutputTokens, exploratory, chatTokenParameter, temperature, stream, reasoningEffort, timeoutMs: Number(value('timeout-ms', 60000)), output: value('output') })
    console.log(JSON.stringify({ mode: report.mode, status: report.status, attemptedRequests: report.attemptedRequests, unexecutedRequests: report.unexecutedRequests, passed: report.runs.filter(run => run.status === 'passed').length, stopReason: report.stopReason ?? null }))
    if (report.status !== 'complete' || report.runs.some(run => run.status !== 'passed')) process.exitCode = 1
  }
}
