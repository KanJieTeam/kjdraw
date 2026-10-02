import { createHash } from 'node:crypto'
import { createKJModelAdapter } from '../../../packages/kjdraw-sdk/src/model-adapters.js'
import { fixtureStateSignature } from './geology-scenario-fixtures.mjs'
import { runRound9NativeQueryChatWorkflow, round9NativeQueryChatInputs } from './geology-round9-native-query-chat-driver.mjs'
import { assessRound9NativeQueryReadiness, round9NativeQueryDescriptor, buildRound9NativeQueryFixture,
  evaluateRound9NativeQueryOracle } from './geology-round9-native-query-oracles.mjs'

const clone = structuredClone, bytes = value => new TextEncoder().encode(JSON.stringify(value)).length
const questionHash = prompt => createHash('sha256').update(prompt).digest('hex')
const origins = ['fixture-oracle-selftest', 'real-model']
const finalOnlyAssertions = new Set(['completed-answer-not-runtime-error', 'exact-independent-native-answer',
  'actual-final-model-answer-provenance', 'model-paper-space-separated', 'spatial-candidates-not-geological-facts'])
export const ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL = Object.freeze({
  version: 'round9-native-reads-then-final-only-json-v1',
  defaultBudgets: Object.freeze({ maxRequests: 16, maxToolCalls: 32, maxBytes: 1048576, timeoutMs: 120000 }),
  readPhaseMaximumRequests: 15, reservedFinalRequests: 1,
  finalInputStart: 'ROUND9_TWO_PHASE_FINAL_INPUTS_BEGIN\n', finalInputEnd: '\nROUND9_TWO_PHASE_FINAL_INPUTS_END',
  readMode: 'actual-native-tools-no-provider-json-format', finalMode: 'provider-json-object-no-tools',
  approvalPolicy: 'no-proposal-no-approval-no-commit',
  oldEvidencePolicy: 'Preserve original first-phase raw text and oracle verdict; never repair or rescore prior protocol reports.',
})
const readInstructions = 'This is the native-read phase of a two-phase read-only query. '
  + 'Use the actual supplied native tools, not JSON text that describes hypothetical calls. '
  + 'Read current document/revision/units and every required geometry/layout page. '
  + 'After all required native reads have succeeded, respond with a short completion acknowledgement. '
  + 'A separate final-only JSON phase will receive these actual receipts. Your acknowledgement is not a final answer. '
  + 'No host reads, geometry calculations, approvals or edits will complete missing work for you.'
const finalInstructions = 'Output exactly one JSON object matching the closed responseSchema and responseGrammar, '
  + 'without prose, markdown fences or extra fields. This final-only phase has no tools, approval or CAD execution. '
  + 'Use only the supplied actual successful native receipts from this same current document/revision. '
  + 'Do not describe hypothetical tool calls as evidence. Compute the answer yourself; the host does not fill it. '
  + 'Do not include paperSpaces unless responseSchema lists it; when listed, report only nonempty paper owners. '
  + 'Include all actual paper owner IDs in excludedPaperSpaceIds when that field is requested. '
  + 'Schema types describe syntax only, not measured coordinates, candidate identities or expected answers.'
function fail(code) { const error = new Error(code); error.code = code; throw error }
function bounded(value, fallback, maximum, minimum = 1) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) fail('INVALID_ROUND9_TWO_PHASE_BUDGET')
  return resolved
}
function validateOptions(options) {
  const allowed = new Set(['modelAdapter', 'fixture', 'neighborhoodPolicy', 'maxRequests', 'maxToolCalls', 'maxBytes', 'timeoutMs', 'signal'])
  if (!options || typeof options !== 'object' || Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail('UNKNOWN_ROUND9_TWO_PHASE_OPTION')
  for (const key of Reflect.ownKeys(options)) {
    const d = Object.getOwnPropertyDescriptor(options, key)
    if (typeof key !== 'string' || !allowed.has(key) || !d.enumerable || !Object.hasOwn(d, 'value')) fail('UNKNOWN_ROUND9_TWO_PHASE_OPTION')
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('INVALID_ROUND9_TWO_PHASE_SIGNAL')
  if (Object.hasOwn(options, 'fixture') && !options.fixture) fail('INVALID_ROUND9_TWO_PHASE_FIXTURE')
}
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
export function round9TwoPhaseFinalOutputContract(scenario) {
  const descriptor = round9NativeQueryDescriptor(scenario)
  if (!descriptor || scenario.sequence) fail('NO_ORIGINAL_ROUND9_QUERY_SCENARIO')
  const idSchema = { type: 'string' }, pointSchema = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
  const identity = { documentId: idSchema, revision: { type: 'integer', minimum: 0 }, units: idSchema }
  if (descriptor.intent === 'cad-query.label-neighborhood') return objectSchema({ ...identity,
    referenceId: idSchema, candidates: { type: 'array', items: objectSchema({ id: idSchema, type: { type: 'string', enum: ['LINE', 'CIRCLE'] } }) },
    geologicalMeaningAssigned: { type: 'boolean' } })
  const bounds = objectSchema({ spaceId: idSchema, min: pointSchema, max: pointSchema })
  return objectSchema({ ...identity, model: bounds, excludedPaperSpaceIds: { type: 'array', items: idSchema },
    ...(scenario.language === 'en' ? { paperSpaces: { type: 'array', items: bounds } } : {}) })
}
export function round9TwoPhaseFinalInputs(scenario, fixture, nativeCalls, options = {}) {
  return { ...round9NativeQueryChatInputs(scenario, fixture, options),
    protocol: ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.version, phase: 'final-only-json',
    responseSchema: round9TwoPhaseFinalOutputContract(scenario), actualSuccessfulNativeReadReceipts: clone(nativeCalls),
    noAutomaticHostReadOrAnswerCompletion: true }
}
function responseWire(response, model) {
  const usage = response?.usage
  return { model: response?.model ?? model,
    choices: [{ message: { role: 'assistant', content: response?.content ?? '', tool_calls: response?.toolCalls ?? [] },
      finish_reason: response?.finishReason ?? (response?.toolCalls?.length ? 'tool_calls' : 'stop') }],
    ...(usage && ['inputTokens', 'outputTokens', 'totalTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
      ? { usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens,
        ...(usage.cacheReadInputTokens == null ? {} : { prompt_tokens_details: { cached_tokens: usage.cacheReadInputTokens } }),
        ...(usage.reasoningOutputTokens == null ? {} : { completion_tokens_details: { reasoning_tokens: usage.reasoningOutputTokens } }) } } : {}) }
}
async function withAbort(promise, signal) {
  signal.throwIfAborted()
  let listener
  const cancelled = new Promise((_, reject) => { listener = () => reject(signal.reason); signal.addEventListener('abort', listener, { once: true }) })
  try { return await Promise.race([promise, cancelled]) } finally { signal.removeEventListener('abort', listener) }
}

/** Reuses the frozen one-phase driver for all actual SDK reads. The only new
 * execution is a model-only final conversation; it cannot dispatch CAD tools.
 * Scripted adapters stay fixture selftests, never real-provider passes. */
export async function runRound9NativeQueryTwoPhaseWorkflow(scenario, options = {}) {
  validateOptions(options)
  const descriptor = round9NativeQueryDescriptor(scenario), adapter = options.modelAdapter
  if (!descriptor || scenario.sequence) fail('NO_ORIGINAL_ROUND9_QUERY_SCENARIO')
  if (!adapter || typeof adapter.call !== 'function' || !origins.includes(adapter.origin)) fail('EXPLICIT_ROUND9_MODEL_ADAPTER_REQUIRED')
  const defaults = ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.defaultBudgets
  const budgets = { maxRequests: bounded(options.maxRequests, defaults.maxRequests, defaults.maxRequests, 2),
    maxToolCalls: bounded(options.maxToolCalls, defaults.maxToolCalls, defaults.maxToolCalls),
    maxBytes: bounded(options.maxBytes, defaults.maxBytes, defaults.maxBytes),
    timeoutMs: bounded(options.timeoutMs, defaults.timeoutMs, defaults.timeoutMs) }
  const readiness = assessRound9NativeQueryReadiness(scenario, { neighborhoodPolicy: options.neighborhoodPolicy })
  const report = { protocol: ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.version, scenarioId: scenario.id,
    originalQuestionHash: questionHash(scenario.prompt), origin: adapter.origin, fixtureOnly: adapter.origin !== 'real-model',
    budgets, readiness, status: 'not-run', requests: 0, adapterInvocations: 0, modelCalls: 0,
    scriptedResponseRequests: 0, realProviderAdapterInvocations: 0, networkRequestsVerified: null,
    requestRecords: [], responseUsage: [], requestBytesTotal: 0, responseBytesTotal: 0,
    calls: [], toolCalls: 0, toolAttempts: 0, finalRequests: 0, proposals: 0, approvals: 0,
    scenarioExecuted: false, scenarioPassed: null, verifiedWorkflowExecutions: 0 }
  if (readiness.status !== 'runnable') { report.status = 'not-ready'; return report }
  const started = performance.now(), timeoutController = new AbortController(), controller = new AbortController()
  const timeout = timeoutController.signal
  const timeoutTimer = setTimeout(() => timeoutController.abort(new Error('ROUND9_TWO_PHASE_TIMEOUT')), budgets.timeoutMs)
  const signal = AbortSignal.any([timeout, controller.signal, ...(options.signal ? [options.signal] : [])])
  let fixture, ownsFixture = false
  const abortCode = () => options.signal?.aborted ? 'ROUND9_TWO_PHASE_CANCELLED' : timeout.aborted ? 'ROUND9_TWO_PHASE_TIMEOUT' : 'ROUND9_TWO_PHASE_ABORTED'
  async function invoke(phase, messages, settings) {
    signal.throwIfAborted()
    if (report.requests >= budgets.maxRequests) fail('ROUND9_TWO_PHASE_REQUEST_BUDGET_EXHAUSTED')
    if (Object.hasOwn(settings, 'stream')) fail('ROUND9_TWO_PHASE_TRANSPORT_STREAM_SETTING_REJECTED')
    if (phase === 'native-reads' && Object.hasOwn(settings, 'response_format')) fail('ROUND9_TWO_PHASE_READ_JSON_FORMAT_REJECTED')
    if (phase === 'final-only-json' && JSON.stringify(settings.response_format) !== JSON.stringify({ type: 'json_object' })) fail('ROUND9_TWO_PHASE_FINAL_FORMAT_REQUIRED')
    const wireMessages = clone(messages)
    if (phase === 'native-reads') {
      if (wireMessages[0]?.role !== 'system' || typeof wireMessages[0].content !== 'string') fail('ROUND9_TWO_PHASE_READ_SYSTEM_REQUIRED')
      wireMessages[0].content += '\n\n' + readInstructions
    }
    const requestBytes = bytes({ messages: wireMessages, settings })
    if (requestBytes > budgets.maxBytes) fail('ROUND9_TWO_PHASE_REQUEST_BYTES_EXHAUSTED')
    const requestIndex = ++report.requests
    report.requestBytesTotal += requestBytes
    const record = { requestIndex, phase, messages: wireMessages, settings: clone(settings), requestBytes, status: 'requested' }
    report.requestRecords.push(record)
    try {
      const response = await withAbort(Promise.resolve().then(() => {
        signal.throwIfAborted()
        record.adapterInvoked = true
        report.adapterInvocations++
        if (phase === 'final-only-json') report.finalRequests++
        if (adapter.origin === 'real-model') { report.modelCalls++; report.realProviderAdapterInvocations++ }
        else report.scriptedResponseRequests++
        return adapter.call({ messages: clone(wireMessages), settings: clone(settings), signal, requestIndex, phase })
      }), signal)
      record.response = clone(response)
      record.responseBytes = bytes(response)
      report.responseBytesTotal += record.responseBytes
      report.responseUsage.push({ requestIndex, phase, usage: clone(response?.usage ?? null) })
      if (record.responseBytes > budgets.maxBytes) fail('ROUND9_TWO_PHASE_RESPONSE_BYTES_EXHAUSTED')
      signal.throwIfAborted()
      record.status = 'responded'
      return response
    } catch (error) { record.status = signal.aborted ? 'aborted' : 'failed'; record.errorCode = signal.aborted ? abortCode() : error.code ?? 'ROUND9_TWO_PHASE_ADAPTER_FAILED'; throw error }
  }
  try {
    signal.throwIfAborted()
    fixture = options.fixture ?? await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: options.neighborhoodPolicy })
    ownsFixture = !options.fixture
    signal.throwIfAborted()
    report.firstPhase = await runRound9NativeQueryChatWorkflow(scenario, { fixture,
      ...(options.neighborhoodPolicy ? { neighborhoodPolicy: options.neighborhoodPolicy } : {}),
      maxRequests: budgets.maxRequests - 1, maxToolCalls: budgets.maxToolCalls, maxBytes: budgets.maxBytes, signal,
      modelAdapter: { origin: adapter.origin, model: adapter.model, call: ({ messages, settings }) => invoke('native-reads', messages, settings) } })
    report.calls = clone(report.firstPhase.calls)
    report.toolCalls = report.firstPhase.toolCalls; report.toolAttempts = report.firstPhase.toolAttempts
    report.readPhaseRawText = report.firstPhase.rawFinalAnswer ?? null
    report.readPhaseOriginalVerdict = clone(report.firstPhase.verdict ?? null)
    report.readGateAssertions = (report.firstPhase.verdict?.assertions ?? []).filter(row => row.kind === 'native-query-assertion' && !finalOnlyAssertions.has(row.id))
    signal.throwIfAborted()
    if (report.firstPhase.runtimeStatus !== 'responded' || !report.firstPhase.evidence || !report.readGateAssertions.length ||
      report.readGateAssertions.some(row => row.satisfied !== true) || !report.calls.length || report.calls.some(call => call.result?.ok !== true))
      fail(report.firstPhase.errorCode && report.firstPhase.errorCode !== 'ROUND9_FINAL_ANSWER_NOT_JSON' && report.firstPhase.errorCode !== 'ROUND9_FROZEN_NATIVE_ORACLE_FAILED'
        ? report.firstPhase.errorCode : 'ROUND9_TWO_PHASE_NATIVE_READS_INCOMPLETE')
    const nativeCalls = report.firstPhase.evidence.toolCalls
    const input = round9TwoPhaseFinalInputs(scenario, fixture, nativeCalls, { neighborhoodPolicy: options.neighborhoodPolicy, budgets })
    report.finalPrompt = ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.finalInputStart + JSON.stringify(input) + ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.finalInputEnd
    let finalUsage
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: adapter.model ?? 'declared-round9-two-phase-adapter',
      chatRequestExtensions: { response_format: { type: 'json_object' } }, maxHistoryBytes: budgets.maxBytes, maxResponseBytes: budgets.maxBytes,
      request: async ({ body }) => {
        const { model: _model, messages, stream, ...settings } = body
        if (stream !== false) fail('ROUND9_TWO_PHASE_STREAMING_NOT_SUPPORTED')
        const response = await invoke('final-only-json', messages, settings)
        return responseWire(response, adapter.model ?? 'declared-round9-two-phase-adapter')
      } })
    const conversation = model.createConversation({ instructions: finalInstructions, tools: [], onUsage: usage => { finalUsage = usage } })
    const turn = await conversation.next({ kind: 'prompt', text: report.finalPrompt }, signal)
    report.rawFinalAnswer = turn.text
    report.finalNormalizedUsage = clone(finalUsage ?? null)
    if (turn.calls.length) fail('ROUND9_TWO_PHASE_FINAL_TOOL_CALL_NOT_ALLOWED')
    try { report.answer = JSON.parse(turn.text) } catch { fail('ROUND9_TWO_PHASE_FINAL_ANSWER_NOT_JSON') }
    signal.throwIfAborted()
    if (questionHash(scenario.prompt) !== report.originalQuestionHash) fail('ROUND9_TWO_PHASE_ORIGINAL_QUESTION_CHANGED')
    report.evidence = { origin: adapter.origin, afterDocument: fixture.document, toolCalls: clone(nativeCalls),
      answer: clone(report.answer), rawFinalAnswer: report.rawFinalAnswer, executionStatus: 'responded' }
    report.verdict = evaluateRound9NativeQueryOracle(scenario, fixture, report.evidence)
    report.status = report.verdict.status === 'satisfied' ? 'completed' : 'failed'
    if (report.status !== 'completed') report.errorCode = 'ROUND9_FROZEN_NATIVE_ORACLE_FAILED'
  } catch (error) {
    report.status = options.signal?.aborted ? 'cancelled' : 'failed'
    report.errorCode = signal.aborted ? abortCode() : error.code ?? 'ROUND9_TWO_PHASE_DRIVER_FAILED'
  } finally {
    report.elapsedMs = Math.max(0, performance.now() - started)
    if (fixture) report.stateUnchanged = fixtureStateSignature(fixture.document) === fixture.initialState
    report.scenarioExecuted = adapter.origin === 'real-model' && report.modelCalls > 0
    report.scenarioPassed = report.scenarioExecuted ? report.status === 'completed' && report.verdict?.scenarioPassed === true : null
    report.verifiedWorkflowExecutions = report.scenarioPassed === true ? 1 : 0
    clearTimeout(timeoutTimer)
    controller.abort()
    if (ownsFixture) fixture.dispose()
  }
  return report
}
