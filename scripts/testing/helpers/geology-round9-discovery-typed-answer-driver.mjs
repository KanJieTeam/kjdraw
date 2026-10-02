import { createHash } from 'node:crypto'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { runKJAgentTask } from '../../../packages/kjdraw-sdk/src/agent-runner.js'
import { createKJModelAdapter } from '../../../packages/kjdraw-sdk/src/model-adapters.js'
import { canonicalStringify, deepFreeze } from '../../../packages/kjdraw-sdk/src/utils.js'
import { fixtureStateSignature } from './geology-scenario-fixtures.mjs'
import { round9NativeGeometryToolInputs, evaluateRound9NativeGeometryToolCoverage } from './geology-round9-native-geometry-tools-driver.mjs'
import { round9TwoPhaseFinalOutputContract } from './geology-round9-native-query-two-phase-driver.mjs'
import { assessRound9NativeQueryReadiness, round9NativeQueryDescriptor, buildRound9NativeQueryFixture,
  evaluateRound9NativeQueryOracle } from './geology-round9-native-query-oracles.mjs'

const clone = structuredClone, same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalStringify(value)).digest('hex')
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length
const names = ['cad_read_layouts', 'cad_query_drawing', 'cad_read_drawing', 'cad_read_page',
  'cad_query_curve_bounds', 'cad_query_curve_neighborhood']
const answerName = 'submit_native_query_answer', discoveryName = 'cad_read_layouts'
const namedChoice = name => ({ type: 'function', function: { name } })
const finalOnly = new Set(['completed-answer-not-runtime-error', 'exact-independent-native-answer',
  'actual-final-model-answer-provenance', 'model-paper-space-separated', 'spatial-candidates-not-geological-facts'])
export const ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL = deepFreeze({
  version: 'round9-layout-discovery-native-reads-typed-answer-v5', toolNames: names,
  inputStart: 'ROUND9_DISCOVERY_TYPED_READ_INPUTS_BEGIN\n', inputEnd: '\nROUND9_DISCOVERY_TYPED_READ_INPUTS_END',
  finalInputStart: 'ROUND9_DISCOVERY_TYPED_FINAL_INPUTS_BEGIN\n', finalInputEnd: '\nROUND9_DISCOVERY_TYPED_FINAL_INPUTS_END',
  defaultBudgets: { maxRequests: 16, maxToolCalls: 32, maxBytes: 1048576, timeoutMs: 120000 },
  readPhaseMaximumRequests: 15, reservedFinalRequests: 1, reservedFinalAnswerCalls: 1,
  providerRequestTimeoutMs: 60000, byteBudgetScope: 'each complete outbound request and inbound response; cumulative bytes reported separately',
  firstRequestToolChoice: namedChoice(discoveryName), finalRequestToolChoice: namedChoice(answerName),
  readMode: 'actual-sdk-six-native-read-tools-with-first-layout-discovery',
  finalMode: 'sole-model-data-function-no-cad-dispatch-no-json-object-response-format',
  answerFunction: answerName, answerSchemaSource: 'unchanged-round9TwoPhaseFinalOutputContract',
  finalAnswerSource: 'complete-original-provider-function-arguments-string-with-empty-content-and-exactly-one-specified-call',
  finalIdentityPolicy: 'nonempty unique final function call ID, not reused from native model-call IDs',
  thinkingPolicy: 'Trusted provider transport must use a documented non-thinking configuration for named tool_choice; no SDK/global/default provider change.',
  geometryScope: 'explicit-model-owner-native-xy-line-circle-curves-not-all-drawing-xyz-or-paper-extents',
  approvalPolicy: 'no-proposal-no-approval-no-commit-no-answer-function-execution',
  oldEvidencePolicy: 'forward-only-new-protocol; original-question-and-detached-oracle-unchanged; no-old-report-rescoring',
})
export const ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL_SHA256 = hash(ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL)
function fail(code) { const error = new Error(code); error.code = code; throw error }
function bounded(value, fallback, minimum = 1) {
  const actual = value ?? fallback
  if (!Number.isSafeInteger(actual) || actual < minimum || actual > fallback) fail('INVALID_ROUND9_TYPED_ANSWER_BUDGET')
  return actual
}
function validateOptions(options) {
  const allowed = new Set(['modelAdapter', 'fixture', 'neighborhoodPolicy', 'maxRequests', 'maxToolCalls', 'maxBytes', 'timeoutMs', 'signal'])
  if (!options || typeof options !== 'object' || Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail('UNKNOWN_ROUND9_TYPED_ANSWER_OPTION')
  for (const key of Reflect.ownKeys(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)
    if (typeof key !== 'string' || !allowed.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('UNKNOWN_ROUND9_TYPED_ANSWER_OPTION')
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('INVALID_ROUND9_TYPED_ANSWER_SIGNAL')
  if (Object.hasOwn(options, 'fixture') && !options.fixture) fail('INVALID_ROUND9_TYPED_ANSWER_FIXTURE')
}
function captureAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') fail('EXPLICIT_ROUND9_TYPED_ANSWER_ADAPTER_REQUIRED')
  const get = (key, required = true) => {
    const descriptor = Object.getOwnPropertyDescriptor(adapter, key)
    if (!descriptor) { if (required || key in adapter) fail('EXPLICIT_ROUND9_TYPED_ANSWER_ADAPTER_REQUIRED'); return undefined }
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('EXPLICIT_ROUND9_TYPED_ANSWER_ADAPTER_REQUIRED')
    return descriptor.value
  }
  const origin = get('origin'), model = get('model', false), call = get('call')
  if (!['fixture-oracle-selftest', 'real-model'].includes(origin) || typeof call !== 'function' ||
    model !== undefined && (typeof model !== 'string' || !model.trim() || model.length > 256)) fail('EXPLICIT_ROUND9_TYPED_ANSWER_ADAPTER_REQUIRED')
  return Object.freeze({ origin, model, call: call.bind(adapter) })
}
export function round9DiscoveryTypedAnswerInputs(scenario, fixture, options = {}) {
  return { ...round9NativeGeometryToolInputs(scenario, fixture, options), protocol: ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL.version,
    phase: 'native-reads', discoveryContract: { firstActualToolName: discoveryName, firstRequestToolChoice: namedChoice(discoveryName),
      firstActualReadMustSucceed: true, completeLayoutPaginationRequired: true,
      argumentsSource: 'model-issued explicit parameters under actual native schema; host does not fill them',
      identitySource: 'real current native layout receipts; never guessed owner IDs' } }
}
const readInstructions = 'Read-only native discovery phase, not the final answer. The first request requires an actual cad_read_layouts call; '
  + 'supply its real current revision and explicit pagination/budget arguments yourself. The host does not fill parameters or read for you. '
  + 'Use observed exact model/paper owner identities from successful layout receipts, never invented space IDs. Complete every required layout, '
  + 'original drawing and native geometry-tool page at the same document/revision/units. Execute geometryReadContract.requiredToolName with every '
  + 'explicit caller policy; native curve-only XY results do not cover all types, Z or paper extents. Every attempted read must succeed; later '
  + 'repairs cannot erase failures. No proposals, approvals, changes or simulated calls. After reading, return a short acknowledgement. '
  + 'A separate final data function will receive the actual successful receipts.'
const finalInstructions = 'Submit exactly one submit_native_query_answer function call with arguments matching its closed schema and the original '
  + 'responseGrammar. Assistant content must be empty, without prose or fences. This is a data submission, not a CAD command; the function is '
  + 'never dispatched or approved. Use only the actual successful same-document/revision native receipts. Compose complete model XYZ bounds '
  + 'from all read native types; curve-only XY bounds cannot replace other geometry or separate paper owners. Include paperSpaces only when '
  + 'the function schema declares it; when declared, include every actual nonempty paper owner. Report all actual excluded paper IDs when requested. '
  + 'Do not infer geological meaning, fabricate zero extents, invent IDs, fill missing reads or add undeclared fields. The schema supplies syntax, '
  + 'not values or expected answers; the host does not compute or complete your answer.'
export function frameRound9DiscoveryTypedAnswerInputs(input) {
  return readInstructions + '\n' + ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL.inputStart + JSON.stringify(input) + ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL.inputEnd
}
export function round9DiscoveryTypedAnswerFunction(scenario) {
  return deepFreeze({ name: answerName, effect: 'read', description: 'Submit the final native read-only query answer as data only. '
    + 'No CAD operation, approval or state change is executed. Supply exactly the original closed answer shape from actual native receipts.',
    inputSchema: round9TwoPhaseFinalOutputContract(scenario) })
}
function schemaValid(schema, value) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
    const properties = schema.properties ?? {}
    return (schema.required ?? []).every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key =>
      Object.hasOwn(properties, key) && schemaValid(properties[key], value[key]))
  }
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0) &&
    value.length <= (schema.maxItems ?? Infinity) && value.every(item => schemaValid(schema.items, item))
  if (schema.type === 'string') return typeof value === 'string' && (!schema.enum || schema.enum.includes(value))
  if (schema.type === 'boolean') return typeof value === 'boolean'
  if (schema.type === 'number' || schema.type === 'integer') return typeof value === 'number' && Number.isFinite(value) &&
    (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity)
  return false
}
function completeLayoutDiscovery(calls, current) {
  const groups = new Map()
  for (const call of calls.filter(call => call.name === discoveryName && call.result?.ok === true)) {
    const { offset, ...rest } = call.args, key = canonicalStringify(rest)
    const pages = groups.get(key) ?? new Map(); pages.set(offset, call); groups.set(key, pages)
  }
  for (const pages of groups.values()) {
    let offset = 0, modelObserved = false, visited = new Set(), ids = new Set()
    while (pages.has(offset) && !visited.has(offset)) {
      visited.add(offset)
      const call = pages.get(offset), value = call.result.value
      if (call.args.expectedRevision !== current.revision || value.documentId !== current.documentId || value.revision !== current.revision ||
        !Array.isArray(value.layouts) || value.layouts.some(row => typeof row.id !== 'string' || typeof row.spaceId !== 'string' ||
          typeof row.model !== 'boolean' || ids.has(row.id)) || new Set(value.layouts.map(row => row.id)).size !== value.layouts.length) break
      value.layouts.forEach(row => { ids.add(row.id); modelObserved ||= row.model === true })
      if (value.nextOffset === null) { if (modelObserved) return true; break }
      if (!Number.isSafeInteger(value.nextOffset) || value.nextOffset !== offset + value.layouts.length || value.nextOffset <= offset) break
      offset = value.nextOffset
    }
  }
  return false
}
function responseWire(response, model) {
  const usage = response?.usage
  return { model: response?.model ?? model, choices: [{ message: { role: 'assistant', content: response?.content ?? '', tool_calls: response?.toolCalls ?? [] },
    finish_reason: response?.finishReason ?? (response?.toolCalls?.length ? 'tool_calls' : 'stop') }],
    ...(usage && ['inputTokens', 'outputTokens', 'totalTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
      ? { usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens } } : {}) }
}
async function withAbort(promise, signal) {
  signal.throwIfAborted(); let listener
  const aborted = new Promise((_, reject) => { listener = () => reject(signal.reason); signal.addEventListener('abort', listener, { once: true }) })
  try { return await Promise.race([promise, aborted]) } finally { signal.removeEventListener('abort', listener) }
}

/** Native reads run through the real SDK. Named tool choices are explicit
 * trusted transport policies only; neither fills parameters nor dispatches
 * the final model-only data function. Fixture runs never count as model passes. */
export async function runRound9DiscoveryTypedAnswerWorkflow(scenario, options = {}) {
  validateOptions(options)
  const descriptor = round9NativeQueryDescriptor(scenario), adapter = captureAdapter(options.modelAdapter)
  if (!descriptor || scenario.sequence) fail('NO_ORIGINAL_ROUND9_TYPED_ANSWER_SCENARIO')
  const defaults = ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL.defaultBudgets
  const budgets = { maxRequests: bounded(options.maxRequests, defaults.maxRequests, 2), maxToolCalls: bounded(options.maxToolCalls, defaults.maxToolCalls, 2),
    maxBytes: bounded(options.maxBytes, defaults.maxBytes), timeoutMs: bounded(options.timeoutMs, defaults.timeoutMs) }
  const readiness = assessRound9NativeQueryReadiness(scenario, { neighborhoodPolicy: options.neighborhoodPolicy })
  const report = { protocol: ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL.version, protocolSha256: ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL_SHA256,
    originalQuestionHash: hash(scenario.prompt), scenarioId: scenario.id, origin: adapter.origin, declaredModel: adapter.model ?? null,
    fixtureOnly: adapter.origin !== 'real-model',
    readiness, budgets, status: 'not-run', requests: 0, adapterInvocations: 0, modelCalls: 0, realProviderAdapterInvocations: 0,
    scriptedResponseRequests: 0, networkRequestsVerified: null, requestRecords: [], responseUsage: [], requestBytesTotal: 0, responseBytesTotal: 0,
    calls: [], nativeToolCalls: 0, nativeToolAttempts: 0, finalAnswerCalls: 0, toolCalls: 0, toolAttempts: 0, finalRequests: 0,
    proposals: 0, approvals: 0, answerFunctionExecuted: false, scenarioExecuted: false, scenarioPassed: null, verifiedWorkflowExecutions: 0 }
  if (readiness.status !== 'runnable') { report.status = 'not-ready'; return report }
  if (names.some(name => !KJDRAW_AGENT_TOOLS.some(tool => tool.name === name && tool.effect === 'read'))) fail('ROUND9_TYPED_ANSWER_REGISTRY_NOT_READY')
  const started = performance.now(), timeoutController = new AbortController(), controller = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(new Error('ROUND9_TYPED_ANSWER_TIMEOUT')), budgets.timeoutMs)
  const signal = AbortSignal.any([timeoutController.signal, controller.signal, ...(options.signal ? [options.signal] : [])])
  const abortCode = () => options.signal?.aborted ? 'ROUND9_TYPED_ANSWER_CANCELLED' : timeoutController.signal.aborted ? 'ROUND9_TYPED_ANSWER_TIMEOUT' : 'ROUND9_TYPED_ANSWER_ABORTED'
  const issued = new Set()
  let fixture, ownsFixture = false, finalResponse, protocolFailure
  const guardedRequest = operation => async request => {
    try { return await operation(request) } catch (error) { protocolFailure = error.code ?? 'ROUND9_TYPED_ANSWER_ADAPTER_FAILED'; throw error }
  }
  async function invoke(phase, messages, settings) {
    signal.throwIfAborted()
    if (report.requests >= budgets.maxRequests || phase === 'native-reads' && report.requests >= budgets.maxRequests - 1) fail('ROUND9_TYPED_ANSWER_REQUEST_BUDGET_EXHAUSTED')
    if (Object.hasOwn(settings, 'stream') || Object.hasOwn(settings, 'response_format')) fail('ROUND9_TYPED_ANSWER_UNDECLARED_TRANSPORT_SETTING')
    if (phase === 'final-only-typed-answer' && (!same(settings.tool_choice, namedChoice(answerName)) || settings.tools?.length !== 1 ||
      settings.tools[0].function?.name !== answerName)) fail('ROUND9_TYPED_ANSWER_FINAL_TOOL_POLICY_REQUIRED')
    const requestBytes = bytes({ messages, settings })
    if (requestBytes > budgets.maxBytes) fail('ROUND9_TYPED_ANSWER_REQUEST_BYTES_EXHAUSTED')
    const record = { requestIndex: ++report.requests, phase, messages: clone(messages), settings: clone(settings), requestBytes, status: 'requested' }
    report.requestRecords.push(record); report.requestBytesTotal += requestBytes
    const providerTimeout = AbortSignal.timeout(ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL.providerRequestTimeoutMs)
    const requestSignal = AbortSignal.any([signal, providerTimeout])
    try {
      const response = await withAbort(Promise.resolve().then(() => {
        requestSignal.throwIfAborted(); record.adapterInvoked = true; report.adapterInvocations++
        if (phase === 'final-only-typed-answer') report.finalRequests++
        if (adapter.origin === 'real-model') { report.modelCalls++; report.realProviderAdapterInvocations++ } else report.scriptedResponseRequests++
        return adapter.call({ messages: clone(messages), settings: clone(settings), signal: requestSignal, phase, requestIndex: record.requestIndex })
      }), requestSignal)
      record.response = clone(response); record.responseBytes = bytes(response); report.responseBytesTotal += record.responseBytes
      report.responseUsage.push({ requestIndex: record.requestIndex, phase, usage: clone(response?.usage ?? null) })
      if (record.responseBytes > budgets.maxBytes) fail('ROUND9_TYPED_ANSWER_RESPONSE_BYTES_EXHAUSTED')
      signal.throwIfAborted(); record.status = 'responded'
      return response
    } catch (error) {
      const code = signal.aborted ? abortCode() : providerTimeout.aborted ? 'ROUND9_TYPED_ANSWER_PROVIDER_TIMEOUT' : error.code ?? 'ROUND9_TYPED_ANSWER_ADAPTER_FAILED'
      record.status = requestSignal.aborted ? 'aborted' : 'failed'; record.errorCode = code
      if (requestSignal.aborted) fail(code)
      throw error
    }
  }
  try {
    signal.throwIfAborted()
    fixture = options.fixture ?? await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: options.neighborhoodPolicy }); ownsFixture = !options.fixture
    if (fixture.round9NativeQueryOracleId !== descriptor.id || fixtureStateSignature(fixture.document) !== fixture.initialState ||
      fixture.document.revision !== fixture.initialRevision || !same(fixture.neighborhoodPolicy ?? null,
        descriptor.intent === 'cad-query.label-neighborhood' ? options.neighborhoodPolicy : null)) fail('ROUND9_TYPED_ANSWER_FIXTURE_IDENTITY_OR_POLICY_MISMATCH')
    const input = round9DiscoveryTypedAnswerInputs(scenario, fixture, { neighborhoodPolicy: options.neighborhoodPolicy, budgets })
    report.prompt = frameRound9DiscoveryTypedAnswerInputs(input); report.framedPromptHash = hash(report.prompt)
    const session = new KJAgentToolSession(fixture.sdk, fixture.document)
    report.effectiveReadDefinitionsSha256 = hash(session.definitions.filter(tool => names.includes(tool.name)))
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: adapter.model ?? 'declared-round9-discovery-typed-adapter',
      maxHistoryBytes: budgets.maxBytes, maxResponseBytes: budgets.maxBytes, request: guardedRequest(async ({ body }) => {
        const { model: _model, messages, stream, ...settings } = body
        if (stream !== false) fail('ROUND9_TYPED_ANSWER_STREAMING_NOT_SUPPORTED')
        const first = report.requests === 0, effectiveSettings = first ? { ...settings, tool_choice: namedChoice(discoveryName) } : settings
        const response = await invoke('native-reads', messages, effectiveSettings)
        for (const call of response?.toolCalls ?? []) {
          if (issued.has(call.id)) fail('ROUND9_TYPED_ANSWER_DUPLICATE_MODEL_CALL_ID')
          issued.add(call.id); let args = null
          try { args = JSON.parse(call.function?.arguments) } catch { /* Raw malformed data are not repaired. */ }
          report.calls.push({ requestIndex: report.requests, id: call.id, name: call.function?.name, args, rawArguments: call.function?.arguments })
        }
        if (first && response?.toolCalls?.[0]?.function?.name !== discoveryName) fail('ROUND9_TYPED_ANSWER_FIRST_LAYOUT_CALL_REQUIRED')
        return responseWire(response, adapter.model ?? 'declared-round9-discovery-typed-adapter')
      }) })
    const run = await runKJAgentTask({ session, model, prompt: report.prompt, toolNames: names, expectReadEvidence: true,
      maxTurns: budgets.maxRequests - 1, maxToolCalls: budgets.maxToolCalls - 1, maxRepairAttempts: 1, timeoutMs: budgets.timeoutMs, signal,
      onProgress: progress => { if (progress.phase === 'tool-start') { report.nativeToolAttempts++; report.toolAttempts++ }
        else if (progress.phase === 'tool-complete') { report.nativeToolCalls++; report.toolCalls++ } } })
    const actualCalls = []
    for (const output of run.outputs) {
      const call = report.calls.find(call => call.id === output.id && call.name === output.name)
      if (!call) fail('ROUND9_TYPED_ANSWER_RECEIPT_WITHOUT_BOUND_MODEL_CALL')
      call.result = output.result; actualCalls.push({ name: call.name, args: clone(call.args), result: output.result })
    }
    report.runtimeStatus = run.status; report.readPhaseRawText = run.text; report.readMeasurements = run.measurements
    let firstAnswer; try { firstAnswer = JSON.parse(run.text) } catch { /* Acknowledgement is not scored as the final answer. */ }
    report.firstPhaseEvidence = { origin: adapter.origin, afterDocument: fixture.document, toolCalls: clone(actualCalls), answer: firstAnswer,
      rawFinalAnswer: run.text, executionStatus: run.status, ...((run.error || firstAnswer === undefined) ? {
        error: run.error ?? { code: 'ROUND9_TYPED_ANSWER_READ_ACK_NOT_FINAL_ANSWER' } } : {}) }
    report.readPhaseOriginalVerdict = evaluateRound9NativeQueryOracle(scenario, fixture, report.firstPhaseEvidence)
    report.readGateAssertions = report.readPhaseOriginalVerdict.assertions.filter(row => row.kind === 'native-query-assertion' && !finalOnly.has(row.id))
    report.geometryCoverage = evaluateRound9NativeGeometryToolCoverage(scenario, input, actualCalls)
    const firstCall = report.calls[0]
    report.discoverySucceeded = firstCall?.requestIndex === 1 && firstCall.name === discoveryName && firstCall.result?.ok === true &&
      firstCall.args?.expectedRevision === fixture.initialRevision && firstCall.args.offset === 0 &&
      firstCall.result.value.documentId === fixture.document.id && firstCall.result.value.revision === fixture.initialRevision
    report.completeLayoutDiscovery = completeLayoutDiscovery(actualCalls, input.currentDocument)
    signal.throwIfAborted()
    if (!report.discoverySucceeded) fail('ROUND9_TYPED_ANSWER_FIRST_LAYOUT_READ_NOT_SUCCESSFUL')
    if (!report.completeLayoutDiscovery) fail('ROUND9_TYPED_ANSWER_LAYOUT_PAGINATION_INCOMPLETE')
    if (run.status !== 'responded' || !actualCalls.length || report.calls.some(call => call.result?.ok !== true) ||
      !report.readGateAssertions.length || report.readGateAssertions.some(row => row.satisfied !== true)) fail(run.error?.code ?? 'ROUND9_TYPED_ANSWER_NATIVE_READS_INCOMPLETE')
    if (report.geometryCoverage.status !== 'satisfied') fail('ROUND9_TYPED_ANSWER_REQUIRED_GEOMETRY_EVIDENCE_INCOMPLETE')
    const answerFunction = round9DiscoveryTypedAnswerFunction(scenario)
    report.answerFunctionSchemaSha256 = hash(answerFunction.inputSchema)
    const finalInput = { ...input, phase: 'final-only-typed-answer', responseSchema: answerFunction.inputSchema,
      finalAnswerFunction: answerName, actualSuccessfulNativeReadReceipts: clone(actualCalls), noAutomaticHostReadOrAnswerCompletion: true }
    report.finalPrompt = ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL.finalInputStart + JSON.stringify(finalInput) + ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL.finalInputEnd
    report.finalFramedPromptHash = hash(report.finalPrompt)
    let finalUsage
    const finalModel = createKJModelAdapter({ protocol: 'chat-completions', model: adapter.model ?? 'declared-round9-discovery-typed-adapter',
      maxHistoryBytes: budgets.maxBytes, maxResponseBytes: budgets.maxBytes, request: guardedRequest(async ({ body }) => {
        const { model: _model, messages, stream, ...settings } = body
        if (stream !== false) fail('ROUND9_TYPED_ANSWER_STREAMING_NOT_SUPPORTED')
        finalResponse = await invoke('final-only-typed-answer', messages, { ...settings, tool_choice: namedChoice(answerName) })
        report.finalContentPresent = Object.hasOwn(finalResponse ?? {}, 'content'); report.rawFinalContent = finalResponse?.content
        report.finalAnswerCalls = Array.isArray(finalResponse?.toolCalls) ? finalResponse.toolCalls.length : 0
        report.toolCalls = report.nativeToolCalls + report.finalAnswerCalls; report.toolAttempts = report.nativeToolAttempts + report.finalAnswerCalls
        report.finalRawToolCalls = clone(finalResponse?.toolCalls ?? null)
        if (report.toolCalls > budgets.maxToolCalls) fail('ROUND9_TYPED_ANSWER_TOOL_BUDGET_EXHAUSTED')
        if (!report.finalContentPresent || ![null, ''].includes(finalResponse.content)) fail('ROUND9_TYPED_ANSWER_FINAL_CONTENT_NOT_EMPTY')
        if (report.finalAnswerCalls !== 1) fail('ROUND9_TYPED_ANSWER_SINGLE_FINAL_CALL_REQUIRED')
        const call = finalResponse.toolCalls[0]
        if (call.type !== 'function' || call.function?.name !== answerName) fail('ROUND9_TYPED_ANSWER_FINAL_CALL_NAME_INVALID')
        report.rawFinalAnswer = call.function.arguments
        report.finalAnswerCallId = call.id
        if (typeof call.id !== 'string' || !call.id.trim() || call.id.length > 256) fail('ROUND9_TYPED_ANSWER_FINAL_CALL_ID_INVALID')
        if (issued.has(call.id)) fail('ROUND9_TYPED_ANSWER_FINAL_CALL_ID_REUSED')
        if (typeof report.rawFinalAnswer !== 'string') fail('ROUND9_TYPED_ANSWER_FINAL_ARGUMENTS_NOT_JSON')
        try { report.answer = JSON.parse(report.rawFinalAnswer) } catch { fail('ROUND9_TYPED_ANSWER_FINAL_ARGUMENTS_NOT_JSON') }
        if (!schemaValid(answerFunction.inputSchema, report.answer)) fail('ROUND9_TYPED_ANSWER_FINAL_SCHEMA_INVALID')
        return responseWire(finalResponse, adapter.model ?? 'declared-round9-discovery-typed-adapter')
      }) })
    const conversation = finalModel.createConversation({ instructions: finalInstructions, tools: [answerFunction], onUsage: usage => { finalUsage = usage } })
    const turn = await conversation.next({ kind: 'prompt', text: report.finalPrompt }, signal)
    report.finalNormalizedUsage = clone(finalUsage ?? null)
    if (turn.text !== '' || turn.calls.length !== 1 || turn.calls[0].name !== answerName ||
      !same(turn.calls[0].arguments, report.answer)) fail('ROUND9_TYPED_ANSWER_NORMALIZED_FINAL_PROVENANCE_MISMATCH')
    signal.throwIfAborted()
    if (hash(scenario.prompt) !== report.originalQuestionHash) fail('ROUND9_TYPED_ANSWER_ORIGINAL_QUESTION_CHANGED')
    report.evidence = { origin: adapter.origin, afterDocument: fixture.document, toolCalls: clone(actualCalls), answer: clone(report.answer),
      rawFinalAnswer: report.rawFinalAnswer, executionStatus: 'responded' }
    report.verdict = evaluateRound9NativeQueryOracle(scenario, fixture, report.evidence)
    report.status = report.verdict.status === 'satisfied' ? 'completed' : 'failed'
    if (report.status !== 'completed') report.errorCode = 'ROUND9_FROZEN_NATIVE_ORACLE_FAILED'
  } catch (error) { report.status = options.signal?.aborted ? 'cancelled' : 'failed';
    report.errorCode = signal.aborted ? abortCode() : protocolFailure ?? error.code ?? 'ROUND9_TYPED_ANSWER_DRIVER_FAILED' }
  finally {
    clearTimeout(timer); controller.abort(); report.elapsedMs = Math.max(0, performance.now() - started)
    if (fixture) report.stateUnchanged = fixtureStateSignature(fixture.document) === fixture.initialState
    report.scenarioExecuted = adapter.origin === 'real-model' && report.modelCalls > 0
    report.scenarioPassed = report.scenarioExecuted ? report.status === 'completed' && report.verdict?.scenarioPassed === true : null
    report.verifiedWorkflowExecutions = report.scenarioPassed === true ? 1 : 0
    if (ownsFixture) fixture.dispose()
  }
  return report
}
