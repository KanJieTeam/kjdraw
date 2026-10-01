import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAiChatRuntime } from '../../apps/playground/ai/runtime.js'
import { callBenchmarkModel } from '../benchmarks/token-provider-transport.mjs'
import { FIXTURE_URL } from './generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, evaluateScenarioOracle, scenarioAnswerFrame, scenarioFixtureInputBindings } from './preflight-geology-user-scenarios.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const sdkModules = (await readdir(new URL('../../packages/kjdraw-sdk/src/', import.meta.url), { recursive: true }))
  .map(path => path.replaceAll('\\', '/')).filter(path => path.endsWith('.js'))
  .map(path => 'packages/kjdraw-sdk/src/' + path)
const executionFiles = [...sdkModules, 'apps/playground/agent-chat.js', 'apps/playground/chat-model-settings.js',
  'apps/playground/chat-model-presets.js', 'apps/playground/ai/runtime.js', 'apps/playground/ai/scene-context.js',
  'scripts/benchmarks/token-provider-transport.mjs', 'scripts/testing/run-geology-user-scenarios.mjs',
  'scripts/testing/preflight-geology-user-scenarios.mjs', 'scripts/testing/helpers/geology-scenario-fixtures.mjs',
  'scripts/testing/helpers/geology-next-scenario-oracles.mjs', 'tests/geology-next-scenario-oracles.spec.mjs'].sort()
// Capture the checked-out executable surface before making any model request.
// Records are source hashes only: never include local credentials or DXF paths.
const executionSurface = Object.freeze(Object.fromEntries(await Promise.all(executionFiles.map(async path =>
  [path, createHash('sha256').update(await readFile(new URL('../../' + path, import.meta.url))).digest('hex')]))))
const endpoints = Object.freeze({
  deepseek: 'https://api.deepseek.com/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
})
export const geologyLiveProtocol = Object.freeze({
  version: 'geology-user-scenarios-live-v3',
  scope: 'Public synthetic drawings and frozen human-style questions; independent native object/source oracles. Not a private-drawing benchmark or evidence of token savings.',
  approval: 'Programmatic approval only after exact pending-preview oracle; not independent human acceptance.',
  readAnswerFrame: 'Read-only requests append a response-shape instruction with field names, never expected values. Mutation requests retain the frozen original prompt.',
  answerUnits: 'Normalize only equivalent m/meter/metre and mm/millimeter/millimetre spellings in units/sourceUnits/cadUnits fields; never normalize numeric quantities or other source text. SourceConvention copies the exact native depthConvention code.',
  invalidSourceAnswer: 'Predeclare generic decision/constraint grammar and native revision schema field paths; no hidden verdict-token vocabulary. All prior v1/v2 failures remain archived and are not rescored.',
  fixtureIdentityFrame: 'The complete public synthetic fixture alias-to-native-ID/handle inventory and any explicitly caller-declared source replacement tables are supplied to bind frozen questions. No target-only inventory, hidden coordinates, stored text or expected outcomes are supplied.',
  maxRequestsPerScenario: 12,
  timeoutMs: 60000,
})

const safeFailureCodes = new Set([
  'SCENARIO_EXECUTION_FAILURE', 'MODEL_REQUEST_BUDGET', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMIT',
  'PROVIDER_AUTH_FAILURE', 'PROVIDER_PAYMENT_REQUIRED', 'PROVIDER_RESOURCE_UNAVAILABLE',
  'PROVIDER_TRANSIENT_FAILURE', 'PROVIDER_HTTP_FAILURE', 'PROVIDER_REFLECTED_CREDENTIAL',
  'TRANSPORT_FAILURE', 'RESPONSE_TOO_LARGE', 'REQUEST_TOO_LARGE', 'INVALID_PROVIDER_JSON',
  'INVALID_PROVIDER_RESPONSE', 'INCOMPLETE_PROVIDER_USAGE', 'MISSING_API_KEY',
  'KJMODEL_REQUEST_FAILED', 'KJMODEL_OUTPUT_LIMIT', 'KJAGENT_REPAIR_LIMIT',
  'AI_REQUEST_FAILED', 'AI_LIMIT_REACHED', 'AI_CONTEXT_LIMIT', 'AI_MODEL_REQUIRED',
])
const providerBlockingCodes = new Set(['PROVIDER_PAYMENT_REQUIRED', 'PROVIDER_AUTH_FAILURE', 'MISSING_API_KEY'])
function safeCode(error) { return safeFailureCodes.has(error?.code) ? error.code : 'SCENARIO_EXECUTION_FAILURE' }

export function frameScenarioPrompt(scenario, bindings) {
  const shape = scenarioAnswerFrame(scenario)
  let prompt = scenario.prompt
  if (bindings) prompt += `\n\nPublic synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. ${JSON.stringify(bindings)}`
  if (shape) prompt += `\n\nFor automated review, return your final answer as strict JSON only, with this field structure (placeholder values are not answers): ${shape}. Read the actual native CAD data first. Do not change the drawing. Do not invent values or omit matching records. Do not use Markdown fences or add explanatory prose.`
  return prompt
}

function collectObservedResults(messages, calls) {
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const call = calls.find(item => item.id === message.tool_call_id)
    if (!call || call.result !== undefined) continue
    try { call.result = JSON.parse(message.content) } catch { call.result = { ok: false, error: { code: 'UNPARSEABLE_TOOL_RESULT' } } }
  }
}

function parseAnswer(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** Calls real model transport by default. An injected caller is fixture-only. */
export async function runGeologyUserScenarios({ provider = 'deepseek', model = 'deepseek-chat', scenarioIds,
  maxScenarios = 120, maxRequests = 500, modelCall = callBenchmarkModel, onProgress = () => {}, onScenarioResult, onCheckpoint } = {}) {
  if (!Object.hasOwn(endpoints, provider)) throw new Error('Use deepseek or qwen')
  if (!Number.isSafeInteger(maxScenarios) || maxScenarios < 1 || maxScenarios > 1080 ||
    !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 2000) throw new Error('Invalid bounded request budget')
  const origin = modelCall === callBenchmarkModel && !process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT ? 'real-model' : 'fixture-oracle-selftest'
  if (scenarioIds !== undefined && (!Array.isArray(scenarioIds) || scenarioIds.some(id => typeof id !== 'string' || !corpus.scenarios.some(item => item.id === id)))) throw new Error('Unknown frozen scenario ID')
  if (onCheckpoint !== undefined && typeof onCheckpoint !== 'function') throw new Error('Checkpoint callback must be a function')
  const selected = corpus.scenarios.filter(item => (!scenarioIds || scenarioIds.includes(item.id)) && assessScenarioReadiness(item).status === 'runnable').slice(0, maxScenarios)
  const report = {
    protocol: geologyLiveProtocol, protocolSha256: createHash('sha256').update(JSON.stringify(geologyLiveProtocol)).digest('hex'),
    corpusSha256: createHash('sha256').update(await readFile(FIXTURE_URL)).digest('hex'),
    executionSurface, executionSurfaceSha256: createHash('sha256').update(JSON.stringify(executionSurface)).digest('hex'),
    testedAt: new Date().toISOString(), provider, requestedModel: model, returnedModels: [],
    evidenceOrigin: origin, selected: selected.length, executed: 0, passed: 0, failed: 0, notEvaluated: 0,
    requests: 0, realProviderRequests: 0, totalTokens: 0, trace: [], transportFailures: [], scenarios: [], haltReason: null,
  }
  const returnedModels = new Set()
  for (const scenario of selected) {
    if (report.requests >= maxRequests || report.haltReason) break
    const row = { id: scenario.id, intent: scenario.expected.intent, originalPromptSha256: createHash('sha256').update(scenario.prompt).digest('hex'),
      status: 'not-evaluated', passed: null, requests: 0, assertions: [] }
    report.scenarios.push(row)
    let fixture, chat
    const calls = []
    const started = performance.now()
    try {
      fixture = await buildScenarioFixture(scenario)
      const framedPrompt = frameScenarioPrompt(scenario, scenarioFixtureInputBindings(fixture))
      row.promptSha256 = createHash('sha256').update(framedPrompt).digest('hex')
      chat = createAiChatRuntime({ provider, model, endpoint: endpoints[provider], protocol: 'chat-completions', apiKey: 'provider-transport-managed', captureToolOutputs: true,
        fetchImpl: async (_url, request) => {
          if (report.requests >= maxRequests || row.requests >= geologyLiveProtocol.maxRequestsPerScenario) {
            const error = new Error('MODEL_REQUEST_BUDGET'); error.code = 'MODEL_REQUEST_BUDGET'; throw error
          }
          const body = JSON.parse(request.body)
          collectObservedResults(body.messages, calls)
          const { messages, model: requestedModel, stream, ...settings } = body
          if (provider === 'deepseek') settings.thinking = { type: 'disabled' }
          else settings.enable_thinking = false
          report.requests++; row.requests++
          if (origin === 'real-model') report.realProviderRequests++
          let result
          try { result = await modelCall({ provider, model: requestedModel, messages, settings, timeoutMs: geologyLiveProtocol.timeoutMs }) }
          catch (error) {
            const code = safeCode(error)
            if (providerBlockingCodes.has(code)) report.haltReason = code
            report.transportFailures.push({ scenarioId: scenario.id, request: report.requests, code,
            offeredTools: body.tools?.length ?? null, toolChoice: body.tool_choice ?? null,
            messageRoles: messages.map(item => item.role), lastMessageRole: messages.at(-1)?.role ?? null }); throw error }
          returnedModels.add(result.model)
          for (const call of result.toolCalls) {
            let args
            try { args = JSON.parse(call.function.arguments) } catch { args = null }
            calls.push({ id: call.id, name: call.function.name, args })
          }
          report.trace.push({ scenarioId: scenario.id, request: report.requests, returnedModel: result.model,
            offeredTools: body.tools?.map(item => item.function.name) ?? [], tools: result.toolCalls.map(item => item.function.name),
            usage: result.usage, elapsedMs: Math.round(result.elapsedMs) })
          report.totalTokens += result.usage.totalTokens
          return Response.json({ model: result.model, choices: [{ message: { role: 'assistant', content: result.content, tool_calls: result.toolCalls }, finish_reason: result.finishReason }],
            usage: { prompt_tokens: result.usage.inputTokens, completion_tokens: result.usage.outputTokens, total_tokens: result.usage.totalTokens } })
        },
      })
      // The DXF fixture has already been independently written and imported.
      // Use its native local-state snapshot, so expected native IDs bind to the
      // actual imported objects rather than inventing ID aliases for the model.
      await chat.restoreLocalState({ drawing: await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }),
        sourceFormat: fixture.artifact.format, committed: false,
        history: fixture.conversationSeed.map(item => ({ user: item.content, assistant: '' })) })
      const result = await chat.send(framedPrompt)
      for (const output of result.toolOutputs ?? []) {
        const call = calls.find(item => item.id === output.id)
        if (call) call.result = output.result
      }
      const after = await fixture.sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
      const evidence = { origin, afterDocument: after, toolCalls: calls, answer: parseAnswer(result.text), rawFinalAnswer: result.text,
        proposal: result.proposal, executionStatus: result.status, approvalReceipt: null, stage: result.status === 'proposal' ? 'pending-preview' : 'completed-read' }
      let oracle = evaluateScenarioOracle(scenario, fixture, evidence)
      if (onScenarioResult) await onScenarioResult({ scenario, fixture, result, evidence, oracle })
      if (result.status === 'proposal') {
        // Never approve an unexpected/unverified operation merely to get a pass.
        if (oracle.status === 'satisfied' && result.proposals.length === 1) {
          const approval = await chat.approve(result.proposal.planId)
          evidence.approvalReceipt = approval.receipt
          evidence.approvedPlanId = result.proposal.planId
          evidence.executionStatus = approval.status
          evidence.stage = 'committed'
          evidence.afterDocument = await fixture.sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
          oracle = evaluateScenarioOracle(scenario, fixture, evidence)
        } else for (const proposal of result.proposals ?? []) chat.reject(proposal.planId)
      }
      row.status = oracle.status; row.passed = origin === 'real-model' ? oracle.scenarioPassed : null
      row.assertions = oracle.assertions ?? []; row.reason = oracle.reason ?? null
      row.runtimeStatus = result.status
      row.proposalRepairAttempts = result.proposalRepairAttempts ?? 0
      if (result.error) row.errorCode = safeCode(result.error)
      // A real attempted question with no verifiable outcome is a failed user
      // journey, even when a more specific CAD oracle cannot be evaluated.
      if (origin === 'real-model' && row.requests && row.passed === null) { row.passed = false; row.status = 'failed'; row.oracleStatus = oracle.status }
    } catch (error) {
      row.errorCode = safeCode(error)
      if (origin === 'real-model' && row.requests) { row.passed = false; row.status = 'failed' }
    }
    finally { chat?.destroy(); fixture?.dispose(); row.elapsedMs = Math.round(performance.now() - started) }
    if (row.requests) report.executed++
    if (row.passed === true) report.passed++
    else if (row.passed === false) report.failed++
    else report.notEvaluated++
    onProgress({ id: row.id, intent: row.intent, status: row.status, passed: row.passed, requests: row.requests, errorCode: row.errorCode,
      failedChecks: row.assertions.filter(item => !item.satisfied).map(item => item.id) })
    if (onCheckpoint) await onCheckpoint(structuredClone({ ...report, scenarios: [row],
      trace: report.trace.filter(item => item.scenarioId === row.id),
      transportFailures: report.transportFailures.filter(item => item.scenarioId === row.id),
      completedScenariosCount: report.scenarios.length, checkpointScope: 'one-completed-case-and-cumulative-totals',
      returnedModels: [...returnedModels], unexecuted: report.selected - report.executed, complete: false, allSelectedPassed: false }))
  }
  report.returnedModels = [...returnedModels]
  report.unexecuted = report.selected - report.executed
  report.allSelectedPassed = origin === 'real-model' && report.selected > 0 && report.passed === report.selected
  return report
}

async function main(args) {
  if (!args.includes('--run')) {
    console.log(JSON.stringify({ mode: 'dry-run', modelCalls: 0, ...geologyLiveProtocol,
      readyScenarios: corpus.scenarios.filter(item => assessScenarioReadiness(item).status === 'runnable').length }, null, 2))
    return
  }
  const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
  const output = option('--output')
  if (!output || !output.endsWith('.json')) throw new Error('Provide a new local JSON report path with --output')
  const checkpointDirectory = option('--checkpoint-dir')
  if (checkpointDirectory) {
    // A new directory is required. Never overwrite an earlier evidence archive.
    await mkdir(dirname(resolve(checkpointDirectory)), { recursive: true })
    await mkdir(resolve(checkpointDirectory))
  }
  const result = await runGeologyUserScenarios({ provider: option('--provider') ?? 'deepseek', model: option('--model') ?? 'deepseek-chat',
    maxScenarios: Number(option('--max-scenarios') ?? 120), maxRequests: Number(option('--max-requests') ?? 500),
    ...(checkpointDirectory ? { onCheckpoint: checkpoint => writeFile(resolve(checkpointDirectory,
      String(checkpoint.completedScenariosCount).padStart(4, '0') + '.json'), JSON.stringify(checkpoint, null, 2) + '\n', { flag: 'wx' }) } : {}),
    onProgress: item => console.log(JSON.stringify(item)) })
  await mkdir(dirname(resolve(output)), { recursive: true })
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ selected: result.selected, executed: result.executed, passed: result.passed, failed: result.failed,
    notEvaluated: result.notEvaluated, requests: result.requests, returnedModels: result.returnedModels, allSelectedPassed: result.allSelectedPassed }))
  if (!result.allSelectedPassed) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => {
  console.error(safeCode(error)); process.exitCode = 1
})
