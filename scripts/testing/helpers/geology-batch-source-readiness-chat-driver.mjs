import { createHash } from 'node:crypto'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { runKJAgentTask } from '../../../packages/kjdraw-sdk/src/agent-runner.js'
import { createKJModelAdapter } from '../../../packages/kjdraw-sdk/src/model-adapters.js'
import { canonicalStringify, deepFreeze } from '../../../packages/kjdraw-sdk/src/utils.js'
import { BATCH_SOURCE_READINESS_INTENT, batchSourceReadinessScenario,
  buildBatchSourceReadinessFixture, batchSourceReadinessWorkspaceInventory, batchSourceReadinessReadsComplete,
  evaluateBatchSourceReadinessOracle } from './geology-batch-source-readiness-oracles.mjs'

const clone = structuredClone, signature = document => canonicalStringify(document.snapshot())
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalStringify(value)).digest('hex')
const readToolNames = KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name)
export const BATCH_SOURCE_READINESS_CHAT_PROTOCOL = deepFreeze({
  version: 'batch-source-readiness-native-read-only-v2-answer-only', supportedIntent: BATCH_SOURCE_READINESS_INTENT,
  inputStart: 'BATCH_SOURCE_READINESS_INPUT_BEGIN\n', inputEnd: '\nBATCH_SOURCE_READINESS_INPUT_END',
  adapterOrigins: ['fixture-oracle-selftest', 'real-model'], readToolNames,
  defaultBudgets: { maxRequests: 20, maxToolCalls: 24, maxTurnsPerDocument: 4, maxBytes: 1048576 },
  answerProtocol: 'one-answer-instance-exact-documents-key-no-instruction-metadata',
  scope: 'Four actual reopened public synthetic documents; native source availability, explicit optional absence, complete state preservation.',
  hostPolicy: 'Read-only document-bound SDK sessions. No automatically supplied reads, answer completion, proposals, approvals or mutations.',
})
export const BATCH_SOURCE_READINESS_CHAT_PROTOCOL_SHA256 = hash(BATCH_SOURCE_READINESS_CHAT_PROTOCOL)
const fail = code => { const error = new Error(code); error.code = code; throw error }
function bounded(value, maximum) {
  const result = value ?? maximum
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail('INVALID_BATCH_SOURCE_READINESS_BUDGET')
  return result
}
export function batchSourceReadinessChatInputs(value, fixture, documentIndex) {
  const scenario = batchSourceReadinessScenario(value), inventory = batchSourceReadinessWorkspaceInventory(fixture)
  const input = { protocol: BATCH_SOURCE_READINESS_CHAT_PROTOCOL.version, originalRequest: scenario.prompt,
    workspaceInventory: inventory,
    conversationContext: scenario.prerequisites.includes('conversation:prior-request-not-approved')
      ? 'Earlier conversational instructions were not approved or executed; this complete request supersedes them.'
      : 'No workspace drawing is pending, approved or edited for this read-only request.' }
  if (documentIndex === null) return { ...input, phase: 'final-read-only-answer' }
  if (!Number.isSafeInteger(documentIndex) || !fixture.workspaceMembers[documentIndex]) fail('INVALID_BATCH_DOCUMENT_INDEX')
  const member = fixture.workspaceMembers[documentIndex]
  return { ...input, phase: 'read-one-native-document', documentIndex, currentDocument: {
    documentId: member.document.id, revision: member.initialRevision }, requiredReadPolicy: {
      sourceTool: 'cad_read_geology_source', listWithEmptyDrawingId: true, readEveryListedDrawing: true, maxBytes: 262144,
      noCrossDocumentIdentitySubstitution: true, noMissingFactDefaults: true } }
}
export function frameBatchSourceReadinessChatInputs(input) {
  return 'Original frozen request:\n' + input.originalRequest + '\n\n' + (input.phase === 'final-read-only-answer'
    ? 'Return exactly one JSON answer object, with exactly one top-level key: documents. No Markdown, explanation, instruction metadata or extra keys. '
      + 'documents is an array containing every original workspace document exactly once. Each document object has exactly documentId, revision, sourceAvailable and drawings. Use the exact native documentId/revision and source availability from successful current native source-list receipts, not names, labels or file extensions. '
      + 'drawings contains every drawingId listed for that document; sourceAvailable:false has drawings:[]. Each drawing object has exactly drawingId, kind and holes. kind is the actual native column or section. Each holes object has exactly holeId and missingFields; include every hole from that drawing\'s actual native source facts. '
      + 'missingFields is the COMPLETE absent-field audit for that hole: independently test initialWaterDepth, stableWaterDepth and observations, AND test description on EVERY stratum interval. A field is absent only when it is not present in the actual source object; zero, an empty array and a supplied empty string are present values, not absence. For each absent interval description include a string formed as strata. + its exact native intervalId + .description. Do not stop after the water fields or omit interval paths. Do not add other field names or duplicate paths. A hole with no audited absences has missingFields:[]. '
      + 'Use only the complete original workspace inventory and actual successful native read receipts supplied below. Never invent source facts, certify measurements, omit a document, substitute identities across documents or use tools in this final phase. '
    : 'This read-only host session is bound to currentDocument.documentId. First call cad_read_geology_source with drawingId:"", expectedRevision:currentDocument.revision and maxBytes:262144. Then read EVERY drawingId returned by that actual list with its current revision. Read-only native tools cannot switch documents. After the required reads, return a short completion. Native source presence means sourceAvailable; optional absent water/observations/description facts remain missing and do not erase the source capability. Zero and [] are present facts. No proposal, approval, creation, edit or success claim is permitted. ')
    + BATCH_SOURCE_READINESS_CHAT_PROTOCOL.inputStart + JSON.stringify(input) + BATCH_SOURCE_READINESS_CHAT_PROTOCOL.inputEnd
}
function rawResponse(response, model) {
  const usage = response?.usage
  return { model: response?.model ?? model, choices: [{ message: { role: 'assistant', content: response?.content ?? '',
    tool_calls: response?.toolCalls ?? [] }, finish_reason: response?.finishReason ?? (response?.toolCalls?.length ? 'tool_calls' : 'stop') }],
    ...(usage ? { usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens } } : {}) }
}

/** modelAdapter.call receives {messages, settings, signal, phase, documentIndex,
 * requestIndex}. It returns the normalized provider response. Every tool call
 * is issued by that adapter and executed by the unchanged native SDK runner. */
export async function runBatchSourceReadinessChatWorkflow(value, options = {}) {
  const scenario = batchSourceReadinessScenario(value), adapter = options.modelAdapter
  if (!adapter || typeof adapter.call !== 'function' || !BATCH_SOURCE_READINESS_CHAT_PROTOCOL.adapterOrigins.includes(adapter.origin))
    fail('EXPLICIT_BATCH_SOURCE_READINESS_ADAPTER_REQUIRED')
  const budgets = Object.fromEntries(Object.entries(BATCH_SOURCE_READINESS_CHAT_PROTOCOL.defaultBudgets)
    .map(([key, maximum]) => [key, bounded(options[key], maximum)]))
  const fixture = options.fixture ?? await buildBatchSourceReadinessFixture(scenario), ownsFixture = !options.fixture
  const report = { protocol: BATCH_SOURCE_READINESS_CHAT_PROTOCOL.version, protocolSha256: BATCH_SOURCE_READINESS_CHAT_PROTOCOL_SHA256,
    scenarioId: scenario.id, questionSha256: hash(scenario.prompt), origin: adapter.origin, fixtureOnly: adapter.origin !== 'real-model',
    budgets, status: 'not-run', requests: 0, modelCalls: 0, realProviderAdapterInvocations: 0, scriptedResponseRequests: 0,
    networkRequestsVerified: null, toolCalls: 0, toolAttempts: 0, proposals: 0, approvals: 0, calls: [], prompts: [],
    responses: [], documentRuns: [], scenarioPassed: null, scenarioExecuted: false, verifiedWorkflowExecutions: 0 }
  const actualCalls = [], workspaceUnchanged = () => fixture.workspaceMembers.every(member => signature(member.document) === member.initialState)
  let documentIndex = 0, phase = 'read-one-native-document', activeController, budgetFailure
  const invoke = async ({ body, signal }) => {
    if (report.requests >= budgets.maxRequests) { budgetFailure = 'BATCH_REQUEST_BUDGET_EXHAUSTED'; fail(budgetFailure) }
    const { model: _model, messages, stream, ...settings } = body
    if (stream !== undefined && stream !== false) fail('BATCH_STREAMING_NOT_SUPPORTED')
    if (new TextEncoder().encode(JSON.stringify({ messages, settings })).length > budgets.maxBytes)
      fail('BATCH_REQUEST_BYTES_EXHAUSTED')
    report.requests++
    if (adapter.origin === 'real-model') { report.modelCalls++; report.realProviderAdapterInvocations++ }
    else report.scriptedResponseRequests++
    const response = await adapter.call({ messages: clone(messages), settings: clone(settings), signal, phase,
      documentIndex: phase === 'final-read-only-answer' ? null : documentIndex, requestIndex: report.requests })
    report.responses.push({ phase, documentIndex, requestIndex: report.requests, model: response?.model ?? null,
      usage: clone(response?.usage ?? null), rawContent: response?.content ?? null, finishReason: response?.finishReason ?? null })
    for (const call of response?.toolCalls ?? []) {
      let args = null
      try { args = JSON.parse(call.function?.arguments) } catch { /* Never repair model arguments. */ }
      report.calls.push({ phase, documentIndex, requestIndex: report.requests, id: call.id, name: call.function?.name,
        rawArguments: call.function?.arguments ?? null, args })
    }
    return rawResponse(response, adapter.model ?? 'declared-batch-source-adapter')
  }
  const modelForPhase = () => createKJModelAdapter({ protocol: 'chat-completions', model: adapter.model ?? 'declared-batch-source-adapter',
    request: invoke, maxHistoryBytes: budgets.maxBytes, maxResponseBytes: budgets.maxBytes, maxOutputTokens: 4096 })
  const signalForPhase = () => {
    activeController = new AbortController()
    return options.signal ? AbortSignal.any([activeController.signal, options.signal]) : activeController.signal
  }
  try {
    if (fixture.scenarioId !== scenario.id || fixture.workspaceMembers.length !== 4 || !workspaceUnchanged()) fail('BATCH_FIXTURE_IDENTITY_MISMATCH')
    for (documentIndex = 0; documentIndex < fixture.workspaceMembers.length; documentIndex++) {
      if (options.signal?.aborted) { report.status = 'cancelled'; break }
      const member = fixture.workspaceMembers[documentIndex], input = batchSourceReadinessChatInputs(scenario, fixture, documentIndex)
      const prompt = frameBatchSourceReadinessChatInputs(input); report.prompts.push(prompt)
      const session = new KJAgentToolSession(member.sdk, member.document)
      const run = await runKJAgentTask({ session, model: modelForPhase(), prompt, toolNames: readToolNames,
        expectReadEvidence: true, maxTurns: budgets.maxTurnsPerDocument, maxToolCalls: budgets.maxToolCalls,
        maxRepairAttempts: 1, signal: signalForPhase(), onProgress: progress => {
          if (progress.phase === 'tool-start') {
            report.toolAttempts++
            if (report.toolCalls >= budgets.maxToolCalls) { budgetFailure = 'BATCH_TOOL_BUDGET_EXHAUSTED'; activeController.abort() }
          } else if (progress.phase === 'tool-complete') report.toolCalls++
        } })
      for (const output of run.outputs) {
        const call = report.calls.find(call => call.phase === phase && call.documentIndex === documentIndex && call.id === output.id && call.name === output.name)
        if (!call) fail('BATCH_RECEIPT_WITHOUT_MODEL_CALL')
        call.result = output.result
        actualCalls.push({ boundDocumentId: member.document.id, name: call.name, args: clone(call.args), result: output.result })
      }
      const readsComplete = batchSourceReadinessReadsComplete(fixture, actualCalls, member.document.id)
      report.documentRuns.push({ documentIndex, documentId: member.document.id, revision: member.initialRevision,
        status: run.status, readsComplete, errorCode: run.error?.code ?? null })
      if (budgetFailure || run.status !== 'responded' || !readsComplete || !workspaceUnchanged() ||
        actualCalls.some(call => call.result?.ok !== true)) {
        report.status = options.signal?.aborted ? 'cancelled' : 'failed'
        report.errorCode = budgetFailure ?? run.error?.code ?? 'BATCH_NATIVE_READ_INCOMPLETE'; break
      }
      report.status = 'read-completed'
    }
    if (report.status === 'read-completed' && report.documentRuns.length === 4) {
      phase = 'final-read-only-answer'
      const input = batchSourceReadinessChatInputs(scenario, fixture, null)
      input.actualNativeReadReceipts = clone(actualCalls)
      const prompt = frameBatchSourceReadinessChatInputs(input); report.prompts.push(prompt)
      const conversation = modelForPhase().createConversation({ tools: [], instructions: 'Answer the original read-only batch request with exactly one JSON answer instance whose only top-level key is documents. Compute the complete water/observations AND every interval-description absence audit from actual native receipts. Do not reproduce instructions or add metadata. No tools or approval exist in this phase.' })
      const answer = await conversation.next({ kind: 'prompt', text: prompt }, signalForPhase())
      if (answer.calls.length) fail('BATCH_FINAL_TOOLS_FORBIDDEN')
      try { report.answer = JSON.parse(answer.text) } catch { fail('BATCH_FINAL_ANSWER_NOT_JSON') }
      report.status = 'completed'
    }
  } catch (error) {
    report.status = options.signal?.aborted ? 'cancelled' : 'failed'
    report.errorCode = budgetFailure ?? error.code ?? 'BATCH_SOURCE_READINESS_FAILED'
  } finally { activeController?.abort() }
  report.evidence = { origin: adapter.origin, toolCalls: actualCalls, answer: report.answer ?? null,
    approvals: report.approvals, proposals: report.proposals, realProviderAdapterInvocations: report.realProviderAdapterInvocations }
  report.verdict = evaluateBatchSourceReadinessOracle(scenario, fixture, report.evidence)
  if (report.status === 'completed' && report.verdict.status !== 'satisfied') report.status = 'invalid-workflow'
  report.workspaceUnchanged = workspaceUnchanged()
  report.scenarioExecuted = adapter.origin === 'real-model' && report.realProviderAdapterInvocations > 0
  report.scenarioPassed = report.scenarioExecuted ? report.status === 'completed' && report.verdict.scenarioPassed === true : null
  report.verifiedWorkflowExecutions = report.scenarioPassed === true ? 1 : 0
  report.workspaceInitialStates = fixture.workspaceMembers.map(member => member.initialState)
  report.workspaceFinalStates = fixture.workspaceMembers.map(member => signature(member.document))
  if (ownsFixture) fixture.dispose()
  return report
}
