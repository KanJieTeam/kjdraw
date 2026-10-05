import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAiChatRuntime } from '../../apps/playground/ai/runtime.js'
import { callBenchmarkModel } from '../benchmarks/token-provider-transport.mjs'
import { FIXTURE_URL } from './generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, evaluateScenarioOracle, scenarioAnswerFrame, scenarioFixtureInputBindings } from './preflight-geology-user-scenarios.mjs'
import { isGeologyAnswerContractV4Scenario, createGeologyAnswerContractV4Context } from './helpers/geology-answer-contract-v4.mjs'
import { inspectGeologyModelToolCalls, geologyModelResponseDiagnostic } from './helpers/geology-model-output-diagnostics.mjs'
import { validateGeologyAnswerEncoding, createGeologyJsonObjectProtocol, geologyJsonObjectResponseFormat,
  captureGeologyFinalProviderMessage, geologyFinalProviderMessageEvidence, geologyJsonObjectResponseDiagnostic } from './helpers/geology-answer-encoding.mjs'
import { createGeologyScenarioRuntimeState, bindGeologyScenarioRuntimeHistory, reopenGeologyScenarioRuntimeState,
  geologyHistoryApprovalReceipt } from './helpers/geology-runner-history-transfer.mjs'
import { ROUND4_READ_ANSWER_POLICY_VERSION, ROUND4_READ_ANSWER_POLICY_INTENTS,
  round4ReadAnswerFrameWithPolicy } from './helpers/geology-read-answer-policy.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const sdkModules = (await readdir(new URL('../../packages/kjdraw-sdk/src/', import.meta.url), { recursive: true }))
  .map(path => path.replaceAll('\\', '/')).filter(path => path.endsWith('.js'))
  .map(path => 'packages/kjdraw-sdk/src/' + path)
const executionFiles = [...sdkModules, 'apps/playground/agent-chat.js', 'apps/playground/chat-model-settings.js',
  'apps/playground/chat-model-presets.js', 'apps/playground/ai/runtime.js', 'apps/playground/ai/scene-context.js',
  'scripts/benchmarks/token-provider-transport.mjs', 'scripts/testing/run-geology-user-scenarios.mjs',
  'scripts/testing/preflight-geology-user-scenarios.mjs', 'scripts/testing/helpers/geology-scenario-fixtures.mjs',
  'scripts/testing/helpers/geology-next-scenario-oracles.mjs', 'tests/geology-next-scenario-oracles.spec.mjs',
  'scripts/testing/helpers/geology-round3-scenario-oracles.mjs', 'tests/geology-round3-scenario-oracles.spec.mjs',
  'tests/geology-round3-preflight-integration.spec.mjs',
  'scripts/testing/helpers/geology-history-scenario-oracles.mjs', 'tests/geology-history-scenario-oracles.spec.mjs',
  'scripts/testing/helpers/geology-runner-history-transfer.mjs',
  'scripts/testing/helpers/geology-answer-encoding.mjs',
  'tests/geology-live-native-archive-transfer.spec.mjs', 'tests/geology-live-host-approval-accounting.spec.mjs',
  'tests/geology-history-preflight-integration.spec.mjs',
  'scripts/testing/helpers/geology-round4-native-oracles.mjs', 'tests/geology-round4-native-oracles.spec.mjs',
  'tests/geology-round4-preflight-integration.spec.mjs',
  'scripts/testing/helpers/geology-round5-inventory-oracles.mjs', 'tests/geology-round5-inventory-oracles.spec.mjs',
  'tests/geology-round5-preflight-integration.spec.mjs',
  'scripts/testing/helpers/geology-read-answer-policy.mjs', 'tests/geology-read-answer-policy.spec.mjs',
  'tests/geology-live-answer-policy.spec.mjs', 'tests/geology-live-supplied-creation.spec.mjs',
  'scripts/testing/helpers/geology-supplied-creation-oracles.mjs', 'tests/geology-supplied-creation-oracles.spec.mjs',
  'tests/geology-supplied-creation-preflight-integration.spec.mjs',
  'scripts/testing/helpers/geology-round6-source-workflow-oracles.mjs', 'tests/geology-round6-source-workflow-oracles.spec.mjs',
  'tests/geology-round6-preflight-integration.spec.mjs',
  'scripts/testing/helpers/geology-round7-point-plan-oracles.mjs', 'tests/geology-round7-point-plan-oracles.spec.mjs',
  'tests/geology-round7-preflight-integration.spec.mjs', 'tests/geology-live-point-plan.spec.mjs',
  'packages/kjdraw-sdk/test/agent-read-evidence.test.mjs', 'tests/ai-geology-creation-read-guard.spec.mjs'].sort()
// Capture the checked-out executable surface before making any model request.
// Records are source hashes only: never include local credentials or DXF paths.
const executionSurface = Object.freeze(Object.fromEntries(await Promise.all(executionFiles.map(async path =>
  [path, createHash('sha256').update(await readFile(new URL('../../' + path, import.meta.url))).digest('hex')]))))
const v4ExecutionFiles = ['scripts/testing/helpers/geology-answer-contract-v4.mjs',
  'scripts/testing/helpers/geology-fail-closed-contract.mjs', 'scripts/testing/helpers/geology-model-output-diagnostics.mjs']
const v4ExecutionSurface = Object.freeze({ ...executionSurface, ...Object.fromEntries(await Promise.all(v4ExecutionFiles.map(async path =>
  [path, createHash('sha256').update(await readFile(new URL('../../' + path, import.meta.url))).digest('hex')]))) })
const jsonObjectExecutionFile = 'scripts/testing/helpers/geology-answer-encoding.mjs'
const jsonObjectExecutionSurface = Object.freeze({ ...v4ExecutionSurface,
  [jsonObjectExecutionFile]: createHash('sha256').update(await readFile(new URL('../../' + jsonObjectExecutionFile, import.meta.url))).digest('hex') })
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
export const geologyLiveProtocolV4 = Object.freeze({ ...geologyLiveProtocol,
  version: 'geology-user-scenarios-live-v4',
  answerContractVersion: 'v4',
  invalidSourceAnswer: 'Opt-in native source predicates over literal caller-declared requests and retained source facts; quantified duplicate identities do not fabricate indices. Complete native source listing OR exact full reads of every retained recipe. Complete effective insensitive text query tolerates redundant reads. Legacy v3 evidence remains archived and is not rescored.',
})
export const geologyLiveProtocolV5 = Object.freeze({ ...geologyLiveProtocolV4,
  version: 'geology-user-scenarios-live-v5',
  answerContractVersion: 'v5',
  readAnswerFrame: 'Opt-in v5 uses the v4 response grammar. Return only its responseSchema answer instance; outer version/responseSchema/nativePaths/rules are protocol documentation, not answer fields. Other read frames retain their declared answer properties. Never supply expected values.',
  round3ReadEvidence: 'All publicly declared effect=read tools require successful current document/revision receipts. Each actual retained-recipe generated-drift rejection is separately admitted only at its declared drawingId/current revision and exact actual generated identity. No extra recipe-listing call is required. Exact complete answers, full unchanged native state and no pending plan or approval remain mandatory. Archived v3/v4 results are not rescored.',
})
export const geologyLiveProtocolV5JsonObject = createGeologyJsonObjectProtocol(geologyLiveProtocolV5)
const nativePolicyFrame = 'Opt-in public output-field vocabulary only for cad-query.native-object and cad-query.endpoint-topology: coordinateSpace owner-local means native definition coordinates in each entity owner basis, without world/viewport transformation; semanticInference none means no industry meaning is inferred from native connectivity. This declares policy codes, not identities, coordinates, distances or connection answers. Frozen original questions, caller facts and exact native value oracles are unchanged; archived legacy evidence is never rescored.'
export const geologyLiveProtocolV5NativePolicy = Object.freeze({ ...geologyLiveProtocolV5,
  version: 'geology-user-scenarios-live-v5-native-policy-codes-v1',
  answerEncoding: 'text',
  answerPolicyVersion: ROUND4_READ_ANSWER_POLICY_VERSION,
  publicAnswerPolicyFrame: nativePolicyFrame,
})
export const geologyLiveProtocolV5JsonObjectNativePolicy = Object.freeze({ ...geologyLiveProtocolV5JsonObject,
  version: 'geology-user-scenarios-live-v5-json-object-native-policy-codes-v1',
  answerPolicyVersion: ROUND4_READ_ANSWER_POLICY_VERSION,
  publicAnswerPolicyFrame: nativePolicyFrame,
})
export const GEOLOGY_V4_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(isGeologyAnswerContractV4Scenario).map(scenario => scenario.id))

function validateAnswerPolicy(answerContractVersion, answerPolicyVersion) {
  if (!['legacy', ROUND4_READ_ANSWER_POLICY_VERSION].includes(answerPolicyVersion))
    throw new Error('Use answerPolicyVersion legacy or native-policy-codes-v1')
  if (answerPolicyVersion !== 'legacy' && answerContractVersion !== 'v5')
    throw new Error('answerPolicyVersion native-policy-codes-v1 requires answerContractVersion v5')
}

export function geologyScenarioAnswerFrame(scenario, { answerContractVersion = 'v3', answerPolicyVersion = 'legacy' } = {}) {
  validateAnswerPolicy(answerContractVersion, answerPolicyVersion)
  return answerPolicyVersion !== 'legacy' && ROUND4_READ_ANSWER_POLICY_INTENTS.includes(scenario.expected.intent)
    ? round4ReadAnswerFrameWithPolicy(scenario, { answerPolicyVersion })
    : scenarioAnswerFrame(scenario, { answerContractVersion })
}

function selectProtocol(answerContractVersion, answerEncoding, answerPolicyVersion) {
  if (answerPolicyVersion !== 'legacy') return answerEncoding === 'json-object'
    ? geologyLiveProtocolV5JsonObjectNativePolicy : geologyLiveProtocolV5NativePolicy
  return answerEncoding === 'json-object' ? geologyLiveProtocolV5JsonObject
    : answerContractVersion === 'v5' ? geologyLiveProtocolV5 : answerContractVersion === 'v4' ? geologyLiveProtocolV4 : geologyLiveProtocol
}

const safeFailureCodes = new Set([
  'SCENARIO_EXECUTION_FAILURE', 'MODEL_REQUEST_BUDGET', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMIT',
  'PROVIDER_AUTH_FAILURE', 'PROVIDER_PAYMENT_REQUIRED', 'PROVIDER_RESOURCE_UNAVAILABLE',
  'PROVIDER_TRANSIENT_FAILURE', 'PROVIDER_HTTP_FAILURE', 'PROVIDER_REFLECTED_CREDENTIAL',
  'TRANSPORT_FAILURE', 'RESPONSE_TOO_LARGE', 'REQUEST_TOO_LARGE', 'INVALID_PROVIDER_JSON',
  'INVALID_PROVIDER_RESPONSE', 'INCOMPLETE_PROVIDER_USAGE', 'MISSING_API_KEY',
  'KJMODEL_REQUEST_FAILED', 'KJMODEL_OUTPUT_LIMIT', 'KJAGENT_REPAIR_LIMIT',
  'KJAGENT_READ_REQUIRED', 'KJAGENT_INCOMPLETE_BATCH',
  'AI_REQUEST_FAILED', 'AI_LIMIT_REACHED', 'AI_CONTEXT_LIMIT', 'AI_MODEL_REQUIRED',
])
const providerBlockingCodes = new Set(['PROVIDER_PAYMENT_REQUIRED', 'PROVIDER_AUTH_FAILURE', 'MISSING_API_KEY'])
function safeCode(error) { return safeFailureCodes.has(error?.code) ? error.code : 'SCENARIO_EXECUTION_FAILURE' }

export function frameScenarioPrompt(scenario, bindings, { answerContractVersion = 'v3', answerPolicyVersion = 'legacy' } = {}) {
  const shape = geologyScenarioAnswerFrame(scenario, { answerContractVersion, answerPolicyVersion })
  let prompt = scenario.prompt
  if (bindings) prompt += `\n\nPublic synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. ${JSON.stringify(bindings)}`
  if (shape) {
    const instruction = answerContractVersion === 'v5'
      ? 'For automated review, return only one strict JSON answer instance. If the frame contains responseSchema, validate the answer against responseSchema. The outer version, responseSchema, nativePaths and rules are protocol documentation, NOT answer properties: do not copy them into your answer. Otherwise use only the declared answer fields. Placeholder values are not answers. Public answer frame: '
      : 'For automated review, return your final answer as strict JSON only, with this field structure (placeholder values are not answers): '
    prompt += `\n\n${instruction}${shape}. Read the actual native CAD data first. Do not change the drawing. Do not invent values or omit matching records. Do not use Markdown fences or add explanatory prose.`
  }
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

function hostApprovalNotCompleted(oracle, origin) {
  return { ...oracle, status: 'failed', scenarioPassed: origin === 'real-model' ? false : null,
    reason: 'host-approval-not-completed',
    assertions: [...(oracle.assertions ?? []), { id: 'host-approval-not-completed', satisfied: false }] }
}

function rejectActualPlans(chat, proposals, evidence) {
  evidence.rejectedPlans = (proposals ?? []).map(proposal => ({ planId: proposal.planId, ...chat.reject(proposal.planId) }))
}

/** Calls real model transport by default. An injected caller is fixture-only. */
export async function runGeologyUserScenarios({ provider = 'deepseek', model = 'deepseek-chat', scenarioIds,
  maxScenarios = 120, maxRequests = 500, modelCall = callBenchmarkModel, onProgress = () => {}, onScenarioResult, onCheckpoint,
  answerContractVersion = 'v3', answerEncoding = 'text', answerPolicyVersion = 'legacy', onModelResponse } = {}) {
  if (!Object.hasOwn(endpoints, provider)) throw new Error('Use deepseek or qwen')
  if (!['v3', 'v4', 'v5'].includes(answerContractVersion)) throw new Error('Use answerContractVersion v3, v4 or v5')
  validateGeologyAnswerEncoding(answerContractVersion, answerEncoding)
  validateAnswerPolicy(answerContractVersion, answerPolicyVersion)
  if (onModelResponse !== undefined && typeof onModelResponse !== 'function') throw new Error('Model response callback must be a function')
  if (!Number.isSafeInteger(maxScenarios) || maxScenarios < 1 || maxScenarios > 1080 ||
    !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 2000) throw new Error('Invalid bounded request budget')
  const origin = modelCall === callBenchmarkModel && !process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT ? 'real-model' : 'fixture-oracle-selftest'
  if (scenarioIds !== undefined && (!Array.isArray(scenarioIds) || scenarioIds.some(id => typeof id !== 'string' || !corpus.scenarios.some(item => item.id === id)))) throw new Error('Unknown frozen scenario ID')
  if (onCheckpoint !== undefined && typeof onCheckpoint !== 'function') throw new Error('Checkpoint callback must be a function')
  const selected = corpus.scenarios.filter(item => (!scenarioIds || scenarioIds.includes(item.id)) && assessScenarioReadiness(item).status === 'runnable').slice(0, maxScenarios)
  const protocol = selectProtocol(answerContractVersion, answerEncoding, answerPolicyVersion)
  const surface = answerEncoding === 'json-object' ? jsonObjectExecutionSurface : answerContractVersion !== 'v3' || onModelResponse ? v4ExecutionSurface : executionSurface
  const report = {
    protocol, protocolSha256: createHash('sha256').update(JSON.stringify(protocol)).digest('hex'),
    corpusSha256: createHash('sha256').update(await readFile(FIXTURE_URL)).digest('hex'),
    executionSurface: surface, executionSurfaceSha256: createHash('sha256').update(JSON.stringify(surface)).digest('hex'),
    testedAt: new Date().toISOString(), provider, requestedModel: model, returnedModels: [],
    evidenceOrigin: origin, selected: selected.length, executed: 0, passed: 0, failed: 0, notEvaluated: 0,
    requests: 0, realProviderRequests: 0, totalTokens: 0, trace: [], transportFailures: [], scenarios: [], haltReason: null,
    ...(answerContractVersion !== 'v3' || onModelResponse ? { modelOutputFailures: [], diagnosticFailures: [] } : {}),
  }
  const returnedModels = new Set()
  for (const scenario of selected) {
    if (report.requests >= maxRequests || report.haltReason) break
    const row = { id: scenario.id, intent: scenario.expected.intent, originalPromptSha256: createHash('sha256').update(scenario.prompt).digest('hex'),
      status: 'not-evaluated', passed: null, requests: 0, assertions: [] }
    report.scenarios.push(row)
    let fixture, chat, lastProviderMessage
    const calls = []
    const started = performance.now()
    try {
      fixture = await buildScenarioFixture(scenario)
      // Host-only source baseline MUST precede model execution and same-ID
      // reopen. Never append this context or its expanded updates to a prompt.
      const answerContext = answerContractVersion !== 'v3' && isGeologyAnswerContractV4Scenario(scenario)
        ? createGeologyAnswerContractV4Context({ scenario, fixture }) : undefined
      const answerFrame = geologyScenarioAnswerFrame(scenario, { answerContractVersion, answerPolicyVersion })
      const framedPrompt = frameScenarioPrompt(scenario, scenarioFixtureInputBindings(fixture), { answerContractVersion, answerPolicyVersion })
      const responseFormat = geologyJsonObjectResponseFormat({ answerEncoding, answerFrame })
      row.promptSha256 = createHash('sha256').update(framedPrompt).digest('hex')
      if (answerPolicyVersion !== 'legacy') {
        row.answerPolicyVersion = answerPolicyVersion
        row.answerFrameSha256 = answerFrame == null ? null : createHash('sha256').update(answerFrame).digest('hex')
      }
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
          if (responseFormat) settings.response_format = { ...responseFormat }
          report.requests++; row.requests++
          if (origin === 'real-model') report.realProviderRequests++
          let result
          try { result = await modelCall({ provider, model: requestedModel, messages, settings, timeoutMs: geologyLiveProtocol.timeoutMs }) }
          catch (error) {
            const code = safeCode(error)
            if (providerBlockingCodes.has(code)) report.haltReason = code
            report.transportFailures.push({ scenarioId: scenario.id, request: report.requests, code,
            offeredTools: body.tools?.length ?? null, toolChoice: body.tool_choice ?? null,
            messageRoles: messages.map(item => item.role), lastMessageRole: messages.at(-1)?.role ?? null,
            ...(answerEncoding === 'json-object' ? { responseFormat: settings.response_format ?? null } : {}) }); throw error }
          if (responseFormat) lastProviderMessage = captureGeologyFinalProviderMessage(result)
          returnedModels.add(result.model)
          const trace = { scenarioId: scenario.id, request: report.requests, returnedModel: result.model,
            offeredTools: body.tools?.map(item => item.function.name) ?? [], tools: result.toolCalls.map(item => item.function.name),
            usage: result.usage, elapsedMs: Math.round(result.elapsedMs),
            ...(answerEncoding === 'json-object' ? { responseFormat: settings.response_format ?? null } : {}) }
          if (answerContractVersion !== 'v3' || onModelResponse) {
            const inspected = inspectGeologyModelToolCalls(result.toolCalls)
            calls.push(...inspected.calls)
            report.modelOutputFailures.push(...inspected.issues.map(issue => ({ scenarioId: scenario.id, request: report.requests, ...issue })))
          } else for (const call of result.toolCalls) {
            let args
            try { args = JSON.parse(call.function.arguments) } catch { args = null }
            calls.push({ id: call.id, name: call.function.name, args })
          }
          report.trace.push(trace)
          report.totalTokens += result.usage.totalTokens
          if (onModelResponse) {
            try {
              const diagnostic = geologyModelResponseDiagnostic(result, { scenarioId: scenario.id,
                request: report.requests, evidenceOrigin: origin, trace })
              await onModelResponse(answerEncoding === 'json-object' ? geologyJsonObjectResponseDiagnostic(result, diagnostic) : diagnostic)
            }
            catch { report.diagnosticFailures.push({ scenarioId: scenario.id, request: report.requests, code: 'MODEL_DIAGNOSTIC_CALLBACK_FAILED' }) }
          }
          return Response.json({ model: result.model, choices: [{ message: { role: 'assistant', content: result.content, tool_calls: result.toolCalls }, finish_reason: result.finishReason }],
            usage: { prompt_tokens: result.usage.inputTokens, completion_tokens: result.usage.outputTokens, total_tokens: result.usage.totalTokens } })
        },
      })
      // The DXF fixture has already been independently written and imported.
      // Use its native local-state snapshot, so expected native IDs bind to the
      // actual imported objects rather than inventing ID aliases for the model.
      const initialState = await createGeologyScenarioRuntimeState(fixture)
      await chat.restoreLocalState(initialState)
      await bindGeologyScenarioRuntimeHistory(fixture, chat, initialState)
      const result = await chat.send(framedPrompt)
      for (const output of result.toolOutputs ?? []) {
        const call = calls.find(item => item.id === output.id)
        if (call) call.result = output.result
      }
      const after = await reopenGeologyScenarioRuntimeState(fixture, await chat.exportLocalState(), chat.drawingHistory)
      const finalAnswer = responseFormat ? geologyFinalProviderMessageEvidence(lastProviderMessage, result.status)
        : { answer: parseAnswer(result.text), rawFinalAnswer: result.text }
      const evidence = { origin, afterDocument: after.document,
        ...(fixture.historyOracleId ? { liveHistory: after.liveHistory, historyArchive: after.historyArchive } : {}),
        toolCalls: calls, ...finalAnswer,
        proposal: result.proposal, executionStatus: result.status, approvalReceipt: null, hostApprovalApplied: false,
        stage: result.status === 'proposal' ? 'pending-preview' : 'completed-read' }
      let oracle = evaluateScenarioOracle(scenario, fixture, evidence, { answerContractVersion, context: answerContext })
      if (onScenarioResult) await onScenarioResult({ scenario, fixture, result, evidence, oracle })
      if (result.status === 'proposal') {
        // Never approve an unexpected/unverified operation merely to get a pass.
        if (oracle.status === 'satisfied' && result.proposals.length === 1) {
          const approval = await chat.approve(result.proposal.planId)
          evidence.hostApprovalApplied = approval.status === 'applied'
          const receipt = approval.receipt
          const complete = evidence.hostApprovalApplied && receipt?.status === 'committed' && receipt.command === result.proposal.command &&
            receipt.beforeRevision === fixture.initialRevision && receipt.afterRevision === fixture.initialRevision + 1
          evidence.approvalReceipt = complete && fixture.historyOracleId ? geologyHistoryApprovalReceipt(approval, fixture, result.proposal) : receipt ?? null
          if (complete) evidence.approvedPlanId = result.proposal.planId
          evidence.executionStatus = approval.status
          evidence.stage = complete ? 'committed' : 'host-approval-not-completed'
          if (!complete) rejectActualPlans(chat, result.proposals, evidence)
          const committed = await reopenGeologyScenarioRuntimeState(fixture, await chat.exportLocalState(), chat.drawingHistory)
          evidence.afterDocument = committed.document
          if (fixture.historyOracleId) { evidence.liveHistory = committed.liveHistory; evidence.historyArchive = committed.historyArchive }
          oracle = complete ? evaluateScenarioOracle(scenario, fixture, evidence, { answerContractVersion, context: answerContext })
            : hostApprovalNotCompleted(oracle, origin)
        } else {
          rejectActualPlans(chat, result.proposals, evidence)
          evidence.executionStatus = 'rejected'
          evidence.stage = 'host-approval-not-completed'
          const rejected = await reopenGeologyScenarioRuntimeState(fixture, await chat.exportLocalState(), chat.drawingHistory)
          evidence.afterDocument = rejected.document
          if (fixture.historyOracleId) { evidence.liveHistory = rejected.liveHistory; evidence.historyArchive = rejected.historyArchive }
          // A correct pending preview is not an accepted/committed journey when
          // the host rejected the whole batch or could not approve one complete
          // proposal. Never reuse its earlier satisfied verdict after rejection.
          oracle = hostApprovalNotCompleted(oracle, origin)
        }
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
  const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
  const answerContractVersion = option('--answer-contract-version') ?? 'v3'
  const answerEncoding = option('--answer-encoding') ?? 'text'
  const answerPolicyVersion = option('--answer-policy-version') ?? 'legacy'
  if (!['v3', 'v4', 'v5'].includes(answerContractVersion)) throw new Error('Use answerContractVersion v3, v4 or v5')
  validateGeologyAnswerEncoding(answerContractVersion, answerEncoding)
  validateAnswerPolicy(answerContractVersion, answerPolicyVersion)
  if (!args.includes('--run')) {
    const protocol = selectProtocol(answerContractVersion, answerEncoding, answerPolicyVersion)
    console.log(JSON.stringify({ mode: 'dry-run', modelCalls: 0, ...protocol,
      ...(answerContractVersion !== 'v3' ? { v4ScenarioIds: GEOLOGY_V4_SCENARIO_IDS } : {}),
      readyScenarios: corpus.scenarios.filter(item => assessScenarioReadiness(item).status === 'runnable').length }, null, 2))
    return
  }
  const output = option('--output')
  if (!output || !output.endsWith('.json')) throw new Error('Provide a new local JSON report path with --output')
  const checkpointDirectory = option('--checkpoint-dir')
  if (checkpointDirectory) {
    // A new directory is required. Never overwrite an earlier evidence archive.
    await mkdir(dirname(resolve(checkpointDirectory)), { recursive: true })
    await mkdir(resolve(checkpointDirectory))
  }
  const result = await runGeologyUserScenarios({ provider: option('--provider') ?? 'deepseek', model: option('--model') ?? 'deepseek-chat',
    answerContractVersion, answerEncoding, answerPolicyVersion,
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
