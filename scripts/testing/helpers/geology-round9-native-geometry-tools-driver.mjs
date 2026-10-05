import { createHash } from 'node:crypto'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { runKJAgentTask } from '../../../packages/kjdraw-sdk/src/agent-runner.js'
import { createKJModelAdapter } from '../../../packages/kjdraw-sdk/src/model-adapters.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'
import { fixtureStateSignature } from './geology-scenario-fixtures.mjs'
import { round9NativeQueryChatInputs } from './geology-round9-native-query-chat-driver.mjs'
import { round9TwoPhaseFinalOutputContract } from './geology-round9-native-query-two-phase-driver.mjs'
import { assessRound9NativeQueryReadiness, round9NativeQueryDescriptor, buildRound9NativeQueryFixture,
  evaluateRound9NativeQueryOracle } from './geology-round9-native-query-oracles.mjs'

const clone = structuredClone, same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const hash = text => createHash('sha256').update(text).digest('hex')
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length
const names = ['cad_read_layouts', 'cad_query_drawing', 'cad_read_drawing', 'cad_read_page',
  'cad_query_curve_bounds', 'cad_query_curve_neighborhood']
const origins = ['fixture-oracle-selftest', 'real-model']
const finalOnly = new Set(['completed-answer-not-runtime-error', 'exact-independent-native-answer',
  'actual-final-model-answer-provenance', 'model-paper-space-separated', 'spatial-candidates-not-geological-facts'])
export const ROUND9_NATIVE_GEOMETRY_TOOLS_PROTOCOL = Object.freeze({
  version: 'round9-actual-native-geometry-tools-then-final-json-v4',
  toolNames: Object.freeze(names),
  inputStart: 'ROUND9_NATIVE_GEOMETRY_INPUTS_BEGIN\n', inputEnd: '\nROUND9_NATIVE_GEOMETRY_INPUTS_END',
  finalInputStart: 'ROUND9_NATIVE_GEOMETRY_FINAL_INPUTS_BEGIN\n', finalInputEnd: '\nROUND9_NATIVE_GEOMETRY_FINAL_INPUTS_END',
  defaultBudgets: Object.freeze({ maxRequests: 16, maxToolCalls: 32, maxBytes: 1048576, timeoutMs: 120000 }),
  readPhaseMaximumRequests: 15, reservedFinalRequests: 1,
  readMode: 'actual-sdk-read-tools-no-provider-json-format', finalMode: 'model-only-json-object-no-tools',
  geometryScope: 'explicit-model-owner-native-xy-line-circle-curves-not-all-drawing-xyz-or-paper-extents',
  oldEvidencePolicy: 'forward-only-new-protocol; original-questions-and-detached-oracle-unchanged; no-old-report-rescoring',
  approvalPolicy: 'no-proposal-no-approval-no-commit',
})
function fail(code) { const error = new Error(code); error.code = code; throw error }
function bounded(value, fallback, minimum = 1) {
  const actual = value ?? fallback
  if (!Number.isSafeInteger(actual) || actual < minimum || actual > fallback) fail('INVALID_ROUND9_GEOMETRY_DRIVER_BUDGET')
  return actual
}
function validateOptions(options) {
  const allowed = new Set(['modelAdapter', 'fixture', 'neighborhoodPolicy', 'maxRequests', 'maxToolCalls', 'maxBytes', 'timeoutMs', 'signal'])
  if (!options || typeof options !== 'object' || Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail('UNKNOWN_ROUND9_GEOMETRY_DRIVER_OPTION')
  for (const key of Reflect.ownKeys(options)) {
    const property = Object.getOwnPropertyDescriptor(options, key)
    if (typeof key !== 'string' || !allowed.has(key) || !property.enumerable || !Object.hasOwn(property, 'value')) fail('UNKNOWN_ROUND9_GEOMETRY_DRIVER_OPTION')
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('INVALID_ROUND9_GEOMETRY_DRIVER_SIGNAL')
  if (Object.hasOwn(options, 'fixture') && !options.fixture) fail('INVALID_ROUND9_GEOMETRY_DRIVER_FIXTURE')
}
export function round9NativeGeometryToolInputs(scenario, fixture, options = {}) {
  const descriptor = round9NativeQueryDescriptor(scenario)
  if (!descriptor || scenario.sequence) fail('NO_ORIGINAL_ROUND9_GEOMETRY_SCENARIO')
  return { ...round9NativeQueryChatInputs(scenario, fixture, options), protocol: ROUND9_NATIVE_GEOMETRY_TOOLS_PROTOCOL.version,
    phase: 'native-reads', geometryReadContract: {
      requiredToolName: descriptor.intent === 'cad-query.model-extents' ? 'cad_query_curve_bounds' : 'cad_query_curve_neighborhood',
      ownerIdSource: 'actual-current-model-owner-identity-from-native-layout-or-drawing-receipts',
      ownerPolicy: 'model-space-only', visibility: 'include-hidden', typeScope: 'finite-line-circle-only', unsupportedPolicy: 'reject',
      completeNativePaginationRequired: true, firstOffset: 0, maximumLimit: 200, maxEntities: 4096, maxBytes: 262144,
      ...(descriptor.intent === 'cad-query.label-neighborhood' ? {
        anchorIdSource: 'caller-TEXT-A-native-identity-read-from-current-native-drawing',
        metric: 'text-insertion-to-finite-native-xy-curve', boundary: 'inclusive',
        radiusSource: 'explicit-caller-neighborhoodQueryContract-not-an-inferred-default',
      } : {}),
      scopeBoundary: 'Curve tools return native analytic XY LINE/CIRCLE results only. Other native types, Z and paper owners still require original drawing/layout reads; never substitute curve-only bounds for whole-drawing XYZ extents.',
    } }
}
const readInstructions = 'Native read phase, not the final JSON answer. Issue actual supplied tool calls; JSON text describing calls is not execution. '
  + 'Execute geometryReadContract.requiredToolName with current documentId/revision, actual model owner, exact drawing units and every explicit policy. '
  + 'Traverse every native geometry-tool page from offset 0 to nextOffset:null without skipping. Use the caller-supplied neighborhood radius/anchor, never guess them. '
  + 'Also complete the original native drawing/layout/anchor reads and pagination. Curve-only XY bounds exclude other types and are not complete drawing XYZ or paper extents. '
  + 'Only cad_query_drawing/read/layouts can supply remaining types or paper data; the host will not read or compute your answer. '
  + 'Every read attempt must succeed; later repairs do not erase earlier failures. No proposals, approvals or changes. '
  + 'After the actual native reads finish, return a short acknowledgement. A separate final-only JSON phase will receive every actual receipt.'
const finalInstructions = 'Return exactly one JSON object matching responseSchema and responseGrammar, without prose, fences or extra fields. '
  + 'This final-only phase has no tools or CAD execution. Use only actual successful native receipts from this same document and revision. '
  + 'Native curve tools certify only their explicit LINE/CIRCLE owner-XY scope; compose complete model XYZ bounds from all actual drawing types, '
  + 'and obtain separate paper-owner data from the actual original layout/drawing receipts. Do not mix model/paper, fabricate unused paper zero extents, '
  + 'invent geological meanings, or simulate missing calls. The host does not read or fill answers. Schema supplies syntax only, not coordinates or candidate answers.'
export function frameRound9NativeGeometryToolInputs(input) {
  return readInstructions + '\n' + ROUND9_NATIVE_GEOMETRY_TOOLS_PROTOCOL.inputStart + JSON.stringify(input) + ROUND9_NATIVE_GEOMETRY_TOOLS_PROTOCOL.inputEnd
}

/** Coverage checks consume actual model-issued receipts only. They perform no
 * geometry calculation and never read a native object on the model's behalf. */
export function evaluateRound9NativeGeometryToolCoverage(scenario, input, calls) {
  const descriptor = round9NativeQueryDescriptor(scenario), assertions = []
  const check = (id, value) => assertions.push({ id, satisfied: !!value })
  const requiredName = input.geometryReadContract.requiredToolName, selected = calls.filter(call => call.name === requiredName)
  const current = input.currentDocument
  const modelOwner = calls.flatMap(call => call.result?.ok === true && call.name === 'cad_read_layouts' ? call.result.value.layouts ?? [] : [])
    .find(layout => layout.model === true)?.spaceId ?? calls.find(call => call.result?.ok === true &&
      ['cad_read_drawing', 'cad_read_page', 'cad_query_drawing'].includes(call.name) && !Object.hasOwn(call.args?.filters ?? {}, 'spaceId'))?.result.value.spaceId
  const policy = input.bindings.suppliedInputs?.neighborhoodQueryContract
  check('required-actual-native-geometry-tool-invoked', selected.length > 0)
  check('native-model-owner-observed-in-real-receipt', typeof modelOwner === 'string' && modelOwner.length > 0)
  const valid = call => {
    const args = call.args, value = call.result?.value
    const common = call.result?.ok === true && args?.documentId === current.documentId && args.expectedRevision === current.revision &&
      args.ownerId === modelOwner && args.units === current.units && args.ownerPolicy === 'model-space-only' &&
      args.visibility === 'include-hidden' && args.typeScope === 'finite-line-circle-only' && args.unsupportedPolicy === 'reject' &&
      value?.documentId === current.documentId && value.revision === current.revision && value.ownerId === modelOwner && value.units === current.units &&
      value.ownerPolicy === args.ownerPolicy && value.visibility === args.visibility && value.typeScope === args.typeScope &&
      value.method === 'native-analytic-owner-xy-centerline-curves-v1' && value.numericalPolicy === 'binary64-no-selection-tolerance' &&
      value.scopeComplete === true && Array.isArray(value.diagnostics) && value.diagnostics.length === 0 &&
      value.offset === args.offset && Array.isArray(value.rows) && Number.isSafeInteger(value.totalResultCount) && value.totalResultCount >= 0 &&
      Number.isSafeInteger(args.limit) && args.limit >= 1 && args.limit <= 200 && value.rows.length <= args.limit &&
      Number.isSafeInteger(args.maxEntities) && args.maxEntities >= 1 && args.maxEntities <= 4096 &&
      Number.isSafeInteger(args.maxBytes) && args.maxBytes >= 1024 && args.maxBytes <= 262144
    if (!common) return false
    if (descriptor.intent === 'cad-query.model-extents') return value.kind === 'native-curve-bounds'
    return value.kind === 'native-curve-neighborhood' && policy && args.radius === policy.radius && value.radius === policy.radius &&
      args.anchorId === input.bindings.aliases['TEXT-A'].nativeId && value.anchor?.id === args.anchorId && value.anchor.ownerId === modelOwner &&
      args.metric === 'text-insertion-to-finite-native-xy-curve' && value.metric === args.metric && args.boundary === 'inclusive' && value.boundary === args.boundary
  }
  check('each-geometry-receipt-exact-current-caller-scope', selected.length > 0 && selected.every(valid))
  const groups = new Map()
  for (const call of selected.filter(valid)) {
    const { offset, ...rest } = call.args, key = canonicalStringify(rest)
    const list = groups.get(key) ?? []; list.push(call); groups.set(key, list)
  }
  let full = false, rows = []
  for (const list of groups.values()) {
    const pages = new Map(list.map(call => [call.args.offset, call]))
    let offset = 0, total, scopeMetadata, count = 0, visited = new Set(), ids = new Set(), found = []
    while (pages.has(offset) && !visited.has(offset)) {
      visited.add(offset)
      const call = pages.get(offset), value = call.result.value
      if (total === undefined) total = value.totalResultCount
      const metadata = canonicalStringify({ eligibleCurveCount: value.eligibleCurveCount, inspectedOwnerEntityCount: value.inspectedOwnerEntityCount,
        excludedCounts: value.excludedCounts, ...(value.kind === 'native-curve-bounds' ? { bounds: value.bounds } : { anchor: value.anchor }) })
      scopeMetadata ??= metadata
      if (value.totalResultCount !== total || value.complete !== (offset === 0 && value.nextOffset === null) ||
        metadata !== scopeMetadata || new Set(value.rows.map(row => row.id)).size !== value.rows.length ||
        value.rows.some(row => typeof row.id !== 'string' || typeof row.handle !== 'string' || ids.has(row.id) ||
          !['LINE', 'CIRCLE'].includes(row.type) || row.ownerId !== modelOwner || typeof row.layerId !== 'string' || typeof row.visible !== 'boolean' ||
          !['min', 'max'].every(key => Array.isArray(row.bounds?.[key]) && row.bounds[key].length === 2 && row.bounds[key].every(Number.isFinite)) ||
          row.bounds.min.some((coordinate, axis) => coordinate > row.bounds.max[axis]) ||
          value.kind === 'native-curve-neighborhood' && (!Number.isFinite(row.distance) || row.distance < 0 || row.distance > policy.radius))) break
      value.rows.forEach(row => { ids.add(row.id); found.push(row) }); count += value.rows.length
      if (value.nextOffset === null) { if (count === total) { full = true; rows = found }; break }
      if (!Number.isSafeInteger(value.nextOffset) || value.nextOffset !== offset + value.rows.length || value.nextOffset <= offset) break
      offset = value.nextOffset
    }
  }
  check('complete-actual-native-geometry-tool-pagination', full)
  const observed = calls.filter(call => call.result?.ok === true).flatMap(call => call.result.value.entities ?? [])
  const declaredIdentities = Object.values(input.bindings.aliases)
  check('geometry-native-identities-also-read-by-original-native-query', full && rows.every(row => observed.some(entity =>
    entity.id === row.id && entity.ownerId === row.ownerId && entity.type === row.type) &&
    declaredIdentities.some(identity => identity.nativeId === row.id && identity.handle === row.handle)))
  return { status: assertions.every(row => row.satisfied) ? 'satisfied' : 'failed', assertions }
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

/** A forward-only provider-reusable driver. The SDK executes every native
 * model-issued read; final JSON is separately produced by the model. */
export async function runRound9NativeGeometryToolsWorkflow(scenario, options = {}) {
  validateOptions(options)
  const descriptor = round9NativeQueryDescriptor(scenario), adapter = options.modelAdapter
  if (!descriptor || scenario.sequence) fail('NO_ORIGINAL_ROUND9_GEOMETRY_SCENARIO')
  if (!adapter || typeof adapter.call !== 'function' || !origins.includes(adapter.origin)) fail('EXPLICIT_ROUND9_GEOMETRY_ADAPTER_REQUIRED')
  const defaults = ROUND9_NATIVE_GEOMETRY_TOOLS_PROTOCOL.defaultBudgets
  const budgets = { maxRequests: bounded(options.maxRequests, defaults.maxRequests, 2), maxToolCalls: bounded(options.maxToolCalls, defaults.maxToolCalls),
    maxBytes: bounded(options.maxBytes, defaults.maxBytes), timeoutMs: bounded(options.timeoutMs, defaults.timeoutMs) }
  const readiness = assessRound9NativeQueryReadiness(scenario, { neighborhoodPolicy: options.neighborhoodPolicy })
  const report = { protocol: ROUND9_NATIVE_GEOMETRY_TOOLS_PROTOCOL.version, originalQuestionHash: hash(scenario.prompt), scenarioId: scenario.id,
    origin: adapter.origin, fixtureOnly: adapter.origin !== 'real-model', readiness, budgets, status: 'not-run',
    requests: 0, adapterInvocations: 0, modelCalls: 0, realProviderAdapterInvocations: 0, scriptedResponseRequests: 0, networkRequestsVerified: null,
    requestRecords: [], responseUsage: [], requestBytesTotal: 0, responseBytesTotal: 0, calls: [], toolCalls: 0, toolAttempts: 0, finalRequests: 0,
    proposals: 0, approvals: 0, scenarioExecuted: false, scenarioPassed: null, verifiedWorkflowExecutions: 0 }
  if (readiness.status !== 'runnable') { report.status = 'not-ready'; return report }
  if (names.some(name => !KJDRAW_AGENT_TOOLS.some(tool => tool.name === name && tool.effect === 'read'))) fail('ROUND9_NATIVE_GEOMETRY_REGISTRY_NOT_READY')
  const started = performance.now(), timeoutController = new AbortController(), controller = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(new Error('ROUND9_GEOMETRY_TIMEOUT')), budgets.timeoutMs)
  const signal = AbortSignal.any([timeoutController.signal, controller.signal, ...(options.signal ? [options.signal] : [])])
  const abortCode = () => options.signal?.aborted ? 'ROUND9_GEOMETRY_CANCELLED' : timeoutController.signal.aborted ? 'ROUND9_GEOMETRY_TIMEOUT' : 'ROUND9_GEOMETRY_ABORTED'
  const issued = new Set()
  let fixture, ownsFixture = false
  async function invoke(phase, messages, settings) {
    signal.throwIfAborted()
    if (report.requests >= budgets.maxRequests || phase === 'native-reads' && report.requests >= budgets.maxRequests - 1) fail('ROUND9_GEOMETRY_REQUEST_BUDGET_EXHAUSTED')
    if (Object.hasOwn(settings, 'stream')) fail('ROUND9_GEOMETRY_TRANSPORT_STREAM_SETTING_REJECTED')
    if (phase === 'native-reads' && Object.hasOwn(settings, 'response_format')) fail('ROUND9_GEOMETRY_READ_JSON_FORMAT_REJECTED')
    if (phase === 'final-only-json' && !same(settings.response_format, { type: 'json_object' })) fail('ROUND9_GEOMETRY_FINAL_FORMAT_REQUIRED')
    const requestBytes = bytes({ messages, settings })
    if (requestBytes > budgets.maxBytes) fail('ROUND9_GEOMETRY_REQUEST_BYTES_EXHAUSTED')
    const record = { requestIndex: ++report.requests, phase, messages: clone(messages), settings: clone(settings), requestBytes, status: 'requested' }
    report.requestRecords.push(record); report.requestBytesTotal += requestBytes
    try {
      const response = await withAbort(Promise.resolve().then(() => {
        signal.throwIfAborted(); record.adapterInvoked = true; report.adapterInvocations++
        if (phase === 'final-only-json') report.finalRequests++
        if (adapter.origin === 'real-model') { report.modelCalls++; report.realProviderAdapterInvocations++ } else report.scriptedResponseRequests++
        return adapter.call({ messages: clone(messages), settings: clone(settings), signal, phase, requestIndex: record.requestIndex })
      }), signal)
      record.response = clone(response); record.responseBytes = bytes(response); report.responseBytesTotal += record.responseBytes
      report.responseUsage.push({ requestIndex: record.requestIndex, phase, usage: clone(response?.usage ?? null) })
      if (record.responseBytes > budgets.maxBytes) fail('ROUND9_GEOMETRY_RESPONSE_BYTES_EXHAUSTED')
      signal.throwIfAborted(); record.status = 'responded'
      return response
    } catch (error) { record.status = signal.aborted ? 'aborted' : 'failed'; record.errorCode = signal.aborted ? abortCode() : error.code ?? 'ROUND9_GEOMETRY_ADAPTER_FAILED'; throw error }
  }
  try {
    signal.throwIfAborted()
    fixture = options.fixture ?? await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: options.neighborhoodPolicy }); ownsFixture = !options.fixture
    if (fixture.round9NativeQueryOracleId !== descriptor.id || fixtureStateSignature(fixture.document) !== fixture.initialState ||
      fixture.document.revision !== fixture.initialRevision || !same(fixture.neighborhoodPolicy ?? null,
        descriptor.intent === 'cad-query.label-neighborhood' ? options.neighborhoodPolicy : null)) fail('ROUND9_GEOMETRY_FIXTURE_IDENTITY_OR_POLICY_MISMATCH')
    const input = round9NativeGeometryToolInputs(scenario, fixture, { neighborhoodPolicy: options.neighborhoodPolicy, budgets })
    report.prompt = frameRound9NativeGeometryToolInputs(input)
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: adapter.model ?? 'declared-round9-native-geometry-adapter',
      maxHistoryBytes: budgets.maxBytes, maxResponseBytes: budgets.maxBytes, request: async ({ body }) => {
        const { model: _model, messages, stream, ...settings } = body
        if (stream !== false) fail('ROUND9_GEOMETRY_STREAMING_NOT_SUPPORTED')
        const response = await invoke('native-reads', messages, settings)
        for (const call of response?.toolCalls ?? []) {
          if (issued.has(call.id)) fail('ROUND9_GEOMETRY_DUPLICATE_MODEL_CALL_ID')
          issued.add(call.id); let args = null
          try { args = JSON.parse(call.function?.arguments) } catch { /* Preserve raw malformed arguments, no repair. */ }
          report.calls.push({ requestIndex: report.requests, id: call.id, name: call.function?.name, args, rawArguments: call.function?.arguments })
        }
        return responseWire(response, adapter.model ?? 'declared-round9-native-geometry-adapter')
      } })
    const run = await runKJAgentTask({ session: new KJAgentToolSession(fixture.sdk, fixture.document), model,
      prompt: report.prompt, toolNames: names, expectReadEvidence: true, maxTurns: budgets.maxRequests - 1,
      maxToolCalls: budgets.maxToolCalls, maxRepairAttempts: 1, timeoutMs: budgets.timeoutMs, signal,
      onProgress: progress => { if (progress.phase === 'tool-start') report.toolAttempts++; else if (progress.phase === 'tool-complete') report.toolCalls++ } })
    const actualCalls = []
    for (const output of run.outputs) {
      const call = report.calls.find(call => call.id === output.id && call.name === output.name)
      if (!call) fail('ROUND9_GEOMETRY_RECEIPT_WITHOUT_BOUND_MODEL_CALL')
      call.result = output.result; actualCalls.push({ name: call.name, args: clone(call.args), result: output.result })
    }
    report.runtimeStatus = run.status; report.readPhaseRawText = run.text; report.readMeasurements = run.measurements
    let firstAnswer; try { firstAnswer = JSON.parse(run.text) } catch { /* The acknowledgement is deliberately not final scoring. */ }
    report.firstPhaseEvidence = { origin: adapter.origin, afterDocument: fixture.document, toolCalls: clone(actualCalls),
      answer: firstAnswer, rawFinalAnswer: run.text, executionStatus: run.status,
      ...((run.error || firstAnswer === undefined) ? { error: run.error ?? { code: 'ROUND9_GEOMETRY_READ_ACK_NOT_FINAL_JSON' } } : {}) }
    report.readPhaseOriginalVerdict = evaluateRound9NativeQueryOracle(scenario, fixture, report.firstPhaseEvidence)
    report.readGateAssertions = report.readPhaseOriginalVerdict.assertions.filter(row => row.kind === 'native-query-assertion' && !finalOnly.has(row.id))
    report.geometryCoverage = evaluateRound9NativeGeometryToolCoverage(scenario, input, actualCalls)
    signal.throwIfAborted()
    if (run.status !== 'responded' || !actualCalls.length || actualCalls.some(call => call.result?.ok !== true) ||
      !report.readGateAssertions.length || report.readGateAssertions.some(row => row.satisfied !== true)) fail(run.error?.code ?? 'ROUND9_GEOMETRY_NATIVE_READS_INCOMPLETE')
    if (report.geometryCoverage.status !== 'satisfied') fail('ROUND9_GEOMETRY_REQUIRED_TOOL_EVIDENCE_INCOMPLETE')
    const finalInput = { ...input, phase: 'final-only-json', responseSchema: round9TwoPhaseFinalOutputContract(scenario),
      actualSuccessfulNativeReadReceipts: clone(actualCalls), noAutomaticHostReadOrAnswerCompletion: true }
    report.finalPrompt = ROUND9_NATIVE_GEOMETRY_TOOLS_PROTOCOL.finalInputStart + JSON.stringify(finalInput) + ROUND9_NATIVE_GEOMETRY_TOOLS_PROTOCOL.finalInputEnd
    let finalUsage
    const finalModel = createKJModelAdapter({ protocol: 'chat-completions', model: adapter.model ?? 'declared-round9-native-geometry-adapter',
      chatRequestExtensions: { response_format: { type: 'json_object' } }, maxHistoryBytes: budgets.maxBytes, maxResponseBytes: budgets.maxBytes,
      request: async ({ body }) => {
        const { model: _model, messages, stream, ...settings } = body
        if (stream !== false) fail('ROUND9_GEOMETRY_STREAMING_NOT_SUPPORTED')
        return responseWire(await invoke('final-only-json', messages, settings), adapter.model ?? 'declared-round9-native-geometry-adapter')
      } })
    const conversation = finalModel.createConversation({ instructions: finalInstructions, tools: [], onUsage: usage => { finalUsage = usage } })
    const turn = await conversation.next({ kind: 'prompt', text: report.finalPrompt }, signal)
    report.rawFinalAnswer = turn.text; report.finalNormalizedUsage = clone(finalUsage ?? null)
    if (turn.calls.length) fail('ROUND9_GEOMETRY_FINAL_TOOL_CALL_NOT_ALLOWED')
    try { report.answer = JSON.parse(turn.text) } catch { fail('ROUND9_GEOMETRY_FINAL_ANSWER_NOT_JSON') }
    signal.throwIfAborted()
    if (hash(scenario.prompt) !== report.originalQuestionHash) fail('ROUND9_GEOMETRY_ORIGINAL_QUESTION_CHANGED')
    report.evidence = { origin: adapter.origin, afterDocument: fixture.document, toolCalls: clone(actualCalls),
      answer: clone(report.answer), rawFinalAnswer: report.rawFinalAnswer, executionStatus: 'responded' }
    report.verdict = evaluateRound9NativeQueryOracle(scenario, fixture, report.evidence)
    report.status = report.verdict.status === 'satisfied' ? 'completed' : 'failed'
    if (report.status !== 'completed') report.errorCode = 'ROUND9_FROZEN_NATIVE_ORACLE_FAILED'
  } catch (error) { report.status = options.signal?.aborted ? 'cancelled' : 'failed'; report.errorCode = signal.aborted ? abortCode() : error.code ?? 'ROUND9_GEOMETRY_DRIVER_FAILED' }
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
