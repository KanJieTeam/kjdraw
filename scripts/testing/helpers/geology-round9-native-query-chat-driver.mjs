import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { runKJAgentTask } from '../../../packages/kjdraw-sdk/src/agent-runner.js'
import { createKJModelAdapter } from '../../../packages/kjdraw-sdk/src/model-adapters.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'
import { fixtureStateSignature } from './geology-scenario-fixtures.mjs'
import { assessRound9NativeQueryReadiness, round9NativeQueryDescriptor, round9NativeQueryAnswerFrame,
  round9NativeQueryInputBindings, buildRound9NativeQueryFixture, evaluateRound9NativeQueryOracle,
} from './geology-round9-native-query-oracles.mjs'

const clone = structuredClone
const readNames = ['cad_read_layouts', 'cad_query_drawing', 'cad_read_drawing', 'cad_read_page']
for (const name of readNames) if (!KJDRAW_AGENT_TOOLS.some(tool => tool.name === name && tool.effect === 'read'))
  throw new Error('Round9 read-only native registry mismatch')
export const ROUND9_NATIVE_QUERY_CHAT_PROTOCOL = Object.freeze({
  version: 'round9-single-native-document-read-only-chat-v1',
  inputStart: 'ROUND9_NATIVE_QUERY_INPUTS_BEGIN\n', inputEnd: '\nROUND9_NATIVE_QUERY_INPUTS_END',
  toolNames: Object.freeze(readNames), adapterOrigins: Object.freeze(['fixture-oracle-selftest', 'real-model']),
  defaultBudgets: Object.freeze({ maxRequests: 16, maxToolCalls: 32, maxBytes: 1048576 }),
  approvalPolicy: 'no-proposal-no-approval-no-commit',
})
function fail(code) { const error = new Error(code); error.code = code; throw error }
function bounded(value, fallback, maximum) {
  const n = value ?? fallback
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) fail('INVALID_ROUND9_DRIVER_BUDGET')
  return n
}
export function round9NativeQueryChatInputs(scenario, fixture, options = {}) {
  const descriptor = round9NativeQueryDescriptor(scenario)
  if (!descriptor || scenario.sequence) fail('NO_ORIGINAL_ROUND9_QUERY_SCENARIO')
  return { protocol: ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.version, originalRequest: scenario.prompt,
    responseGrammar: round9NativeQueryAnswerFrame(scenario, options),
    currentDocument: { documentId: fixture.document.id, revision: fixture.initialRevision,
      units: fixture.document.snapshot().header.units },
    bindings: round9NativeQueryInputBindings(fixture),
    discussionOnlyPriorContext: clone(fixture.conversationSeed ?? []),
    readPolicy: { readOnly: true, actualCurrentDocumentReceiptsRequired: true,
      completePaginationRequired: true, everyAttemptedNativeReadMustSucceed: true,
      repairDoesNotEraseEarlierFailedReads: true, noAutomaticHostReadOrAnswerCompletion: true,
      recommendedMaxBytes: 262144 },
    ...(options.budgets ? { resourceBudgets: clone(options.budgets) } : {}) }
}
export function frameRound9NativeQueryChatInputs(input) {
  return 'Use the public native read tools to inspect the current drawing. The session is bound to this one document. '
    + 'Read all required pages; nextOffset is the actual continuation cursor, not permission to skip earlier pages. '
    + 'Produce only the requested final JSON from your actual successful current native read receipts. '
    + 'Previous discussion was not approved and did not modify the drawing. Do not propose, approve, modify, '
    + 'infer geological facts, substitute header bounds, or mix model and paper spaces. '
    + ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.inputStart + JSON.stringify(input) + ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.inputEnd
}
function rawResponse(response, model) {
  const usage = response?.usage
  return { model: response?.model ?? model,
    choices: [{ message: { role: 'assistant', content: response?.content ?? '', tool_calls: response?.toolCalls ?? [] },
      finish_reason: response?.finishReason ?? (response?.toolCalls?.length ? 'tool_calls' : 'stop') }],
    ...(usage && ['inputTokens', 'outputTokens', 'totalTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
      ? { usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens,
        ...(usage.cacheReadInputTokens == null ? {} : { prompt_tokens_details: { cached_tokens: usage.cacheReadInputTokens } }),
        ...(usage.reasoningOutputTokens == null ? {} : { completion_tokens_details: { reasoning_tokens: usage.reasoningOutputTokens } }) } } : {}) }
}

/** The adapter must issue every native read itself and produce the final raw
 * JSON. This driver neither imports the expected answer nor auto-reads any
 * entity into evidence. Fixture adapters are explicitly not real-model passes. */
export async function runRound9NativeQueryChatWorkflow(scenario, options = {}) {
  const allowed = new Set(['modelAdapter', 'fixture', 'neighborhoodPolicy', 'maxRequests', 'maxToolCalls', 'maxBytes', 'signal'])
  if (Object.keys(options).some(key => !allowed.has(key))) fail('UNKNOWN_ROUND9_DRIVER_OPTION')
  const descriptor = round9NativeQueryDescriptor(scenario), adapter = options.modelAdapter
  if (!descriptor || scenario.sequence) fail('NO_ORIGINAL_ROUND9_QUERY_SCENARIO')
  if (!adapter || typeof adapter.call !== 'function' || !ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.adapterOrigins.includes(adapter.origin))
    fail('EXPLICIT_ROUND9_MODEL_ADAPTER_REQUIRED')
  const readiness = assessRound9NativeQueryReadiness(scenario, { neighborhoodPolicy: options.neighborhoodPolicy })
  const defaults = ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.defaultBudgets
  const budgets = { maxRequests: bounded(options.maxRequests, defaults.maxRequests, 32),
    maxToolCalls: bounded(options.maxToolCalls, defaults.maxToolCalls, 128),
    maxBytes: bounded(options.maxBytes, defaults.maxBytes, 16777216) }
  const report = { protocol: ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.version, scenarioId: scenario.id, origin: adapter.origin,
    fixtureOnly: adapter.origin !== 'real-model', budgets, readiness, status: 'not-run', requests: 0,
    adapterInvocations: 0, scriptedResponseRequests: 0, realProviderAdapterInvocations: 0, modelCalls: 0,
    networkRequestsVerified: null, toolCalls: 0, toolAttempts: 0, calls: [], responseUsage: [],
    proposals: 0, approvals: 0, scenarioExecuted: false, scenarioPassed: null, verifiedWorkflowExecutions: 0 }
  if (readiness.status !== 'runnable') { report.status = 'not-ready'; return report }
  const fixture = options.fixture ?? await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: options.neighborhoodPolicy })
  const ownsFixture = !options.fixture, controller = new AbortController(), actualCalls = [], modelCallIds = new Set()
  let budgetFailure
  try {
    if (fixture.round9NativeQueryOracleId !== descriptor.id || fixtureStateSignature(fixture.document) !== fixture.initialState ||
      fixture.document.revision !== fixture.initialRevision ||
      canonicalStringify(fixture.neighborhoodPolicy ?? null) !== canonicalStringify(descriptor.intent === 'cad-query.label-neighborhood' ? options.neighborhoodPolicy : null))
      fail('ROUND9_FIXTURE_IDENTITY_OR_CALLER_POLICY_MISMATCH')
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
    const input = round9NativeQueryChatInputs(scenario, fixture, { neighborhoodPolicy: options.neighborhoodPolicy, budgets })
    report.prompt = frameRound9NativeQueryChatInputs(input)
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: adapter.model ?? 'declared-round9-adapter',
      maxHistoryBytes: budgets.maxBytes, maxResponseBytes: budgets.maxBytes, request: async ({ body, signal }) => {
        if (report.requests >= budgets.maxRequests) { budgetFailure = 'ROUND9_REQUEST_BUDGET_EXHAUSTED'; fail(budgetFailure) }
        const { model: _model, messages, stream, ...settings } = body
        if (stream !== undefined && stream !== false) fail('ROUND9_STREAMING_NOT_SUPPORTED')
        if (new TextEncoder().encode(JSON.stringify({ messages, settings })).length > budgets.maxBytes) {
          budgetFailure = 'ROUND9_REQUEST_BYTES_EXHAUSTED'; fail(budgetFailure)
        }
        report.requests++; report.adapterInvocations++
        if (adapter.origin === 'real-model') { report.modelCalls++; report.realProviderAdapterInvocations++ }
        else report.scriptedResponseRequests++
        const response = await adapter.call({ messages: clone(messages), settings: clone(settings), signal, requestIndex: report.requests })
        report.responseUsage.push({ requestIndex: report.requests, usage: clone(response?.usage ?? null) })
        for (const call of response?.toolCalls ?? []) {
          if (modelCallIds.has(call.id)) fail('ROUND9_DUPLICATE_MODEL_CALL_ID')
          modelCallIds.add(call.id)
          let args = null
          try { args = JSON.parse(call.function?.arguments) } catch { /* Actual adapter validates unmodified wire arguments. */ }
          report.calls.push({ requestIndex: report.requests, id: call.id, name: call.function?.name, args })
        }
        return rawResponse(response, adapter.model ?? 'declared-round9-adapter')
      } })
    const run = await runKJAgentTask({ session: new KJAgentToolSession(fixture.sdk, fixture.document), model,
      prompt: report.prompt, toolNames: readNames, expectReadEvidence: true,
      maxTurns: budgets.maxRequests, maxToolCalls: budgets.maxToolCalls, maxRepairAttempts: 1, signal,
      onProgress: progress => {
        if (progress.phase === 'tool-start') {
          report.toolAttempts++
          if (report.toolCalls >= budgets.maxToolCalls) { budgetFailure = 'ROUND9_TOOL_BUDGET_EXHAUSTED'; controller.abort() }
        } else if (progress.phase === 'tool-complete') report.toolCalls++
      } })
    for (const output of run.outputs) {
      const call = report.calls.find(call => call.id === output.id && call.name === output.name)
      if (!call) fail('ROUND9_RECEIPT_WITHOUT_BOUND_MODEL_CALL')
      call.result = output.result
      actualCalls.push({ name: call.name, args: clone(call.args), result: output.result })
    }
    report.runtimeStatus = run.status
    report.measurements = run.measurements
    report.rawFinalAnswer = run.text
    try { report.answer = JSON.parse(run.text) } catch { report.answer = undefined }
    const error = budgetFailure ? { code: budgetFailure } : run.error ?? (report.answer === undefined ? { code: 'ROUND9_FINAL_ANSWER_NOT_JSON' } : undefined)
    report.evidence = { origin: adapter.origin, afterDocument: fixture.document, toolCalls: actualCalls,
      answer: report.answer, rawFinalAnswer: report.rawFinalAnswer, executionStatus: run.status, ...(error ? { error } : {}) }
    report.verdict = evaluateRound9NativeQueryOracle(scenario, fixture, report.evidence)
    report.stateUnchanged = fixtureStateSignature(fixture.document) === fixture.initialState
    report.status = options.signal?.aborted ? 'cancelled' : run.status === 'responded' && report.verdict.status === 'satisfied' ? 'completed' : 'failed'
    if (report.status !== 'completed') report.errorCode = error?.code ?? 'ROUND9_FROZEN_NATIVE_ORACLE_FAILED'
    report.scenarioExecuted = adapter.origin === 'real-model' && report.modelCalls > 0
    report.scenarioPassed = report.scenarioExecuted ? report.status === 'completed' && report.verdict.scenarioPassed === true : null
    report.verifiedWorkflowExecutions = report.scenarioPassed === true ? 1 : 0
    return report
  } catch (error) {
    report.status = options.signal?.aborted ? 'cancelled' : 'failed'
    report.errorCode = budgetFailure ?? error.code ?? 'ROUND9_DRIVER_FAILED'
    report.scenarioExecuted = adapter.origin === 'real-model' && report.modelCalls > 0
    report.scenarioPassed = report.scenarioExecuted ? false : null
    return report
  } finally { controller.abort(); if (ownsFixture) fixture.dispose() }
}
