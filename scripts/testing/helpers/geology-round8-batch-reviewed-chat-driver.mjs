import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { runKJAgentTask } from '../../../packages/kjdraw-sdk/src/agent-runner.js'
import { createKJModelAdapter } from '../../../packages/kjdraw-sdk/src/model-adapters.js'
import { readGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../../../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'
import { suppliedCreationDocumentSemantics } from './geology-supplied-creation-oracles.mjs'
import { round6SourceWorkflowPhysicalGeometryMatches } from './geology-round6-source-workflow-oracles.mjs'
import { buildRound8ReviewedWorkflowFixture, round8ReviewedWorkflowDescriptor,
  evaluateRound8ReviewedWorkflowOracle } from './geology-round8-reviewed-workflow-oracles.mjs'

const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const signature = document => canonicalStringify(document.snapshot())
const digest = value => createHash('sha256').update(value).digest('hex')
const readToolNames = KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name)
const INPUT_START = 'ROUND8_BATCH_CALLER_INPUTS_BEGIN\n'
const INPUT_END = '\nROUND8_BATCH_CALLER_INPUTS_END'
export const ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL = Object.freeze({
  version: 'round8-independent-documents-read-only-plan-v1',
  supportedIntent: 'batch-historical-workflow.batch-distinct-drawings-staging',
  inputStart: INPUT_START, inputEnd: INPUT_END,
  requiredHostAction: 'multi-document-native-source-read-driver',
  scope: 'thirty-actual-native-document-bound-sessions-not-one-cross-document-sdk-session',
  readToolNames: Object.freeze(readToolNames),
  approvalPolicy: 'no-approval-granted-no-proposal-or-commit',
  adapterOrigins: Object.freeze(['fixture-oracle-selftest', 'real-model']),
  defaultBudgets: Object.freeze({ maxRequests: 64, maxToolCalls: 96, maxTurnsPerDocument: 3, maxBytes: 1048576 }),
})

function fail(code) { const error = new Error(code); error.code = code; throw error }
function limit(value, fallback, max) {
  const n = value ?? fallback
  if (!Number.isSafeInteger(n) || n < 1 || n > max) fail('INVALID_BATCH_DRIVER_BUDGET')
  return n
}
function requiredDescriptor(scenario) {
  const descriptor = round8ReviewedWorkflowDescriptor(scenario)
  if (!descriptor || scenario.sequence || descriptor.intent !== ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.supportedIntent)
    fail('NO_ORIGINAL_BATCH_STAGING_SCENARIO')
  return descriptor
}
function validateWorkspace(fixture, descriptor) {
  if (fixture.round8ReviewedWorkflowOracleId !== descriptor.id) fail('BATCH_FIXTURE_ORACLE_MISMATCH')
  const members = fixture.workspaceMembers, declaration = fixture.suppliedInputs?.declaredWorkspace
  if (!Array.isArray(members) || members.length !== 30 || !Array.isArray(declaration?.documents) || declaration.documents.length !== 30)
    fail('BATCH_COMPLETE_THIRTY_DOCUMENT_SOURCES_REQUIRED')
  for (const key of ['document', 'drawingId']) {
    const ids = members.map(member => key === 'document' ? member.document?.id : member[key])
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== 30) fail('BATCH_DUPLICATE_NATIVE_OWNERSHIP')
  }
  if (new Set(declaration.documents.map(row => row.documentId)).size !== 30) fail('BATCH_DUPLICATE_DECLARED_OWNERSHIP')
  for (const member of members) {
    const row = declaration.documents.find(row => row.documentId === member.document.id)
    const recipe = readGeologyDrawingRecipe(member.document, member.drawingId)
    if (!row || row.drawingId !== member.drawingId || row.artifactFormat !== 'KJD' || recipe.source.kind !== 'column' ||
      !same(recipe.source, member.source) || !same(row.completeDeclaredSource, member.completeDeclaredSource) ||
      !same(row.completeDeclaredSource?.source, recipe.source) || member.completeDeclaredSource?.sourceUnits !== 'meter' ||
      member.completeDeclaredSource?.drawingUnits !== 'millimeter' || signature(member.document) !== member.initialState)
      fail('BATCH_DECLARED_SOURCE_OWNERSHIP_MISMATCH')
  }
  const policy = fixture.suppliedInputs.callerBatchPolicy
  if (policy?.declaredDrawingCount !== 30 || policy.approvalGranted !== false || policy.compileNewDrawing !== false)
    fail('BATCH_READ_ONLY_CALLER_POLICY_REQUIRED')
}

/** All facts come from complete caller declarations and actual native identity;
 * expected CAD output and the oracle's stagingRows are never model inputs. */
export function round8BatchReviewedChatInputs(scenario, fixture, documentIndex) {
  requiredDescriptor(scenario)
  const members = fixture.workspaceMembers
  if (documentIndex === null) return {
    protocol: ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.version, phase: 'final-read-only-plan', originalRequest: scenario.prompt,
    callerBatchPolicy: clone(fixture.suppliedInputs.callerBatchPolicy),
    responseContract: clone(fixture.suppliedInputs.responseContract),
    declaredWorkspace: clone(fixture.suppliedInputs.declaredWorkspace),
    noAutomaticHostAnswerCompletion: true,
  }
  if (!Number.isInteger(documentIndex) || documentIndex < 0 || documentIndex >= members.length) fail('INVALID_BATCH_DOCUMENT_INDEX')
  const member = members[documentIndex]
  return { protocol: ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.version, phase: 'read-one-actual-native-document',
    originalRequest: scenario.prompt, documentIndex, documentCount: members.length,
    callerBatchPolicy: clone(fixture.suppliedInputs.callerBatchPolicy),
    currentDocument: { documentId: member.document.id, drawingId: member.drawingId, revision: member.document.revision,
      completeDeclaredSource: clone(member.completeDeclaredSource) },
    requiredNativeRead: { toolName: 'cad_read_geology_source',
      arguments: { drawingId: member.drawingId, expectedRevision: member.document.revision, maxBytes: 262144 },
      mustBeActualSuccessfulCurrentDocumentReceipt: true },
    crossDocumentCallsDoNotSwitchTheBoundSession: true,
    noProposalsOrApprovals: true,
  }
}
export function frameRound8BatchReviewedChatInputs(input) {
  return (input.phase === 'final-read-only-plan'
    ? 'Produce only a JSON object following responseContract from the declared inputs and successful actual native read receipts. '
      + 'Do not call tools, invent unread sources, omit/merge documents, grant approval, or imply any drawing was modified. '
    : 'This host session is bound to exactly currentDocument.documentId. Read this current native source using requiredNativeRead. '
      + 'Another drawing ID cannot switch documents. After the successful actual source read, return a short read-only completion. '
      + 'Do not propose edits, approve, create, or merge drawings. Later the model will prepare the complete batch plan. ')
    + INPUT_START + JSON.stringify(input) + INPUT_END
}
function rawResponse(response, model) {
  const usage = response?.usage
  return { model: response?.model ?? model, choices: [{ message: { role: 'assistant', content: response?.content ?? '',
    tool_calls: response?.toolCalls ?? [] }, finish_reason: response?.finishReason ?? ((response?.toolCalls?.length ?? 0) ? 'tool_calls' : 'stop') }],
    ...(usage && ['inputTokens', 'outputTokens', 'totalTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
      ? { usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens,
        ...(usage.cacheReadInputTokens == null ? {} : { prompt_tokens_details: { cached_tokens: usage.cacheReadInputTokens } }),
        ...(usage.reasoningOutputTokens == null ? {} : { completion_tokens_details: { reasoning_tokens: usage.reasoningOutputTokens } }) } } : {}) }
}
async function verifyArchive(member) {
  const sdk = createKJDrawSDK()
  try {
    const before = signature(member.document)
    const kjdBytes = await sdk.writeDocument(member.document, { format: 'KJD' })
    const native = await sdk.readDocument(kjdBytes, { format: 'KJD' })
    assert.equal(signature(native), before)
    assert.deepEqual(readGeologyDrawingRecipe(native, member.drawingId).source, member.source)
    const dxfBytes = await sdk.writeDocument(member.document, { format: 'DXF' })
    const graphics = await sdk.readDocument(dxfBytes, { format: 'DXF' })
    assert.equal(same(suppliedCreationDocumentSemantics(graphics), suppliedCreationDocumentSemantics(member.document)), true)
    // The source intentionally omits an optional paper height. Resolve only
    // the published default presentation policy for independent arithmetic;
    // never write this layout default into retained measured/caller facts.
    const physicalSource = round8BatchPhysicalValidationSource(member.source)
    assert.equal(round6SourceWorkflowPhysicalGeometryMatches(member.document.listEntities(), physicalSource), true)
    assert.equal(round6SourceWorkflowPhysicalGeometryMatches(graphics.listEntities(), physicalSource), true)
    assert.equal(signature(member.document), before)
    return { documentId: member.document.id, drawingId: member.drawingId, revision: member.document.revision,
      nativeSnapshotSha256: digest(before), kjdSha256: digest(kjdBytes), dxfSha256: digest(dxfBytes),
      nativeSourceRetained: true, fullPhysicalGeometryHatchesResourcesVerified: true,
      physicalValidationPaperHeightMillimeters: physicalSource.input.pageHeightMillimeters,
      physicalValidationPaperHeightOrigin: member.source.input.pageHeightMillimeters === undefined
        ? 'published-sdk-default-layout-policy' : 'caller-explicit-layout',
      dxfRole: 'graphics-exchange-no-native-source', hostValidationOnly: true }
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
}

/** Independent arithmetic resolves a documented optional layout default, not
 * a missing measurement. This projection is used only by host validation. */
export function round8BatchPhysicalValidationSource(source) {
  if (source?.kind !== 'column' || !source.input || source.input.columnStylePack)
    fail('BATCH_PHYSICAL_VALIDATOR_REQUIRES_DEFAULT_COLUMN_STYLE')
  const pageHeightMillimeters = source.input.pageHeightMillimeters ?? (source.input.locale === 'en'
    ? 297 : KJDRAW_GEOLOGY_KNOWLEDGE_PACK.rules['geology-column-layout'].paperHeight)
  if (![297, 500, 841].includes(pageHeightMillimeters)) fail('BATCH_PHYSICAL_VALIDATOR_UNSUPPORTED_PAPER_HEIGHT')
  return { ...clone(source), input: { ...clone(source.input), pageHeightMillimeters } }
}

/** Original six read-only staging tasks. Each of the thirty session-bound
 * reads is executed by runKJAgentTask, not supplied by the host. The final plan
 * must be generated by the adapter and pass the unchanged frozen R8 oracle. */
export async function runRound8BatchReviewedChatWorkflow(scenario, options = {}) {
  const descriptor = requiredDescriptor(scenario), adapter = options.modelAdapter
  if (!adapter || typeof adapter.call !== 'function' || !ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.adapterOrigins.includes(adapter.origin))
    fail('EXPLICIT_BATCH_MODEL_ADAPTER_REQUIRED')
  const defaults = ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.defaultBudgets
  const budgets = { maxRequests: limit(options.maxRequests, defaults.maxRequests, 256),
    maxToolCalls: limit(options.maxToolCalls, defaults.maxToolCalls, 256),
    maxTurnsPerDocument: limit(options.maxTurnsPerDocument, defaults.maxTurnsPerDocument, 8),
    maxBytes: limit(options.maxBytes, defaults.maxBytes, 16777216) }
  const fixture = options.fixture ?? await buildRound8ReviewedWorkflowFixture(scenario), ownsFixture = !options.fixture
  const report = { protocol: ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.version, scenarioId: scenario.id, origin: adapter.origin,
    fixtureOnly: adapter.origin !== 'real-model', budgets, status: 'not-run', requests: 0, adapterInvocations: 0,
    scriptedResponseRequests: 0, realProviderAdapterInvocations: 0, modelCalls: 0,
    networkRequestsVerified: null, toolCalls: 0, toolAttempts: 0, approvals: 0, proposals: 0,
    documentRuns: [], calls: [], prompts: [], responseUsage: [], archives: [], scenarioPassed: null, scenarioExecuted: false,
    verifiedWorkflowExecutions: 0 }
  let activeController, phase = 'read-one-actual-native-document', documentIndex = 0, budgetFailure
  const actualCalls = []
  try {
    try { validateWorkspace(fixture, descriptor) }
    catch (error) { report.status = 'not-ready'; report.errorCode = error.code ?? 'BATCH_SOURCE_NOT_READY'; return report }
    const states = fixture.workspaceMembers.map(member => member.initialState)
    const workspaceUnchanged = () => fixture.workspaceMembers.every((member, index) => signature(member.document) === states[index])
    const invoke = async ({ body, signal }) => {
      if (report.requests >= budgets.maxRequests) { budgetFailure = 'BATCH_REQUEST_BUDGET_EXHAUSTED'; fail(budgetFailure) }
      const { model: _model, messages, stream, ...settings } = body
      if (stream !== undefined && stream !== false) fail('BATCH_STREAMING_NOT_SUPPORTED')
      const wireBytes = new TextEncoder().encode(JSON.stringify({ messages, settings })).length
      if (wireBytes > budgets.maxBytes) { budgetFailure = 'BATCH_REQUEST_BYTES_EXHAUSTED'; fail(budgetFailure) }
      report.requests++; report.adapterInvocations++
      if (adapter.origin === 'real-model') { report.realProviderAdapterInvocations++; report.modelCalls++ }
      else report.scriptedResponseRequests++
      const response = await adapter.call({ messages: clone(messages), settings: clone(settings), signal,
        phase, documentIndex: phase === 'final-read-only-plan' ? null : documentIndex, requestIndex: report.requests })
      report.responseUsage.push({ requestIndex: report.requests, usage: clone(response?.usage ?? null) })
      for (const call of response?.toolCalls ?? []) {
        let args = null
        try { args = JSON.parse(call.function.arguments) } catch { /* actual adapter/runtime rejects malformed wire arguments */ }
        report.calls.push({ documentIndex, phase, requestIndex: report.requests, id: call.id, name: call.function?.name, args })
      }
      return rawResponse(response, adapter.model ?? 'declared-batch-adapter')
    }
    for (documentIndex = 0; documentIndex < fixture.workspaceMembers.length; documentIndex++) {
      if (options.signal?.aborted) { report.status = 'cancelled'; break }
      const member = fixture.workspaceMembers[documentIndex]
      const input = round8BatchReviewedChatInputs(scenario, fixture, documentIndex), prompt = frameRound8BatchReviewedChatInputs(input)
      report.prompts.push(prompt)
      activeController = new AbortController()
      const signal = options.signal ? AbortSignal.any([activeController.signal, options.signal]) : activeController.signal
      const session = new KJAgentToolSession(fixture.sdk, member.document)
      const model = createKJModelAdapter({ protocol: 'chat-completions', model: adapter.model ?? 'declared-batch-adapter',
        request: invoke, maxHistoryBytes: budgets.maxBytes, maxResponseBytes: budgets.maxBytes })
      const run = await runKJAgentTask({ session, model, prompt, toolNames: readToolNames,
        expectReadEvidence: true, maxTurns: budgets.maxTurnsPerDocument, maxToolCalls: Math.min(128, budgets.maxToolCalls),
        maxRepairAttempts: 1, signal, onProgress: progress => {
          if (progress.phase === 'tool-start') {
            report.toolAttempts++
            if (report.toolCalls >= budgets.maxToolCalls) { budgetFailure = 'BATCH_TOOL_BUDGET_EXHAUSTED'; activeController.abort() }
          } else if (progress.phase === 'tool-complete') report.toolCalls++
        } })
      const outputs = run.outputs.map(output => {
        const call = report.calls.find(call => call.phase === phase && call.documentIndex === documentIndex && call.id === output.id && call.name === output.name)
        if (!call) fail('BATCH_RECEIPT_WITHOUT_BOUND_MODEL_CALL')
        call.result = output.result
        const actual = { name: call.name, args: clone(call.args), result: output.result }
        actualCalls.push(actual)
        return actual
      })
      const currentRead = outputs.some(call => call.name === 'cad_read_geology_source' && call.result.ok === true &&
        call.args.expectedRevision === member.document.revision && call.args.drawingId === member.drawingId &&
        call.result.value.documentId === member.document.id && call.result.value.revision === member.document.revision)
      report.documentRuns.push({ documentIndex, documentId: member.document.id, drawingId: member.drawingId,
        currentRead, status: run.status, toolCalls: outputs, measurements: run.measurements,
        workspaceUnchanged: workspaceUnchanged(), errorCode: budgetFailure ?? run.error?.code ?? null })
      if (budgetFailure || !workspaceUnchanged() || run.status !== 'responded' || !currentRead || outputs.some(call => call.result.ok !== true)) {
        report.status = options.signal?.aborted ? 'cancelled' : 'failed'
        report.errorCode = budgetFailure ?? run.error?.code ?? (!workspaceUnchanged() ? 'BATCH_WORKSPACE_CHANGED' : 'BATCH_NATIVE_READ_INCOMPLETE')
        break
      }
      report.status = 'read-completed'
    }
    if (report.status === 'read-completed' && report.documentRuns.length === 30) {
      phase = 'final-read-only-plan'
      const input = round8BatchReviewedChatInputs(scenario, fixture, null)
      input.actualNativeReadReceipts = actualCalls.map(call => clone(call))
      const prompt = frameRound8BatchReviewedChatInputs(input)
      report.prompts.push(prompt)
      activeController = new AbortController()
      const signal = options.signal ? AbortSignal.any([activeController.signal, options.signal]) : activeController.signal
      const model = createKJModelAdapter({ protocol: 'chat-completions', model: adapter.model ?? 'declared-batch-adapter',
        request: invoke, maxOutputTokens: 8192, maxHistoryBytes: budgets.maxBytes, maxResponseBytes: budgets.maxBytes })
      const conversation = model.createConversation({ instructions: 'Produce the requested read-only JSON batchPlan using actual native read evidence. No tools or approval exist in this final stage.', tools: [] })
      const answer = await conversation.next({ kind: 'prompt', text: prompt }, signal)
      if (answer.calls.length) fail('BATCH_FINAL_STAGE_TOOL_CALL_NOT_ALLOWED')
      try { report.answer = JSON.parse(answer.text) } catch { fail('BATCH_FINAL_PLAN_NOT_JSON') }
      const evidence = { origin: adapter.origin, toolCalls: actualCalls, answer: report.answer, afterDocument: fixture.document,
        actualHostActions: [ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.requiredHostAction] }
      report.verdict = evaluateRound8ReviewedWorkflowOracle(scenario, fixture, evidence)
      if (report.verdict.status !== 'satisfied' || !workspaceUnchanged()) {
        report.status = 'invalid-workflow'; report.errorCode = 'BATCH_FROZEN_ORACLE_FAILED'
      } else {
        // Physical/archive verification is a host action, not a model read and
        // never a substituted plan. DXF is not claimed to retain source recipes.
        for (const member of fixture.workspaceMembers) report.archives.push(await verifyArchive(member))
        report.status = workspaceUnchanged() ? 'completed' : 'failed'
      }
    }
    report.evidence = { origin: adapter.origin, toolCalls: actualCalls, answer: report.answer, afterDocument: fixture.document,
      actualHostActions: report.status === 'completed' ? [ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.requiredHostAction] : [] }
    report.verdict = evaluateRound8ReviewedWorkflowOracle(scenario, fixture, report.evidence)
    report.scenarioPassed = report.status === 'completed' ? report.verdict.scenarioPassed : adapter.origin === 'real-model' && report.modelCalls ? false : null
    report.scenarioExecuted = adapter.origin === 'real-model' && report.modelCalls > 0
    report.workspaceUnchanged = workspaceUnchanged()
    report.verifiedWorkflowExecutions = report.status === 'completed' && report.verdict.scenarioPassed === true ? 1 : 0
    return report
  } catch (error) {
    report.status = options.signal?.aborted ? 'cancelled' : 'failed'; report.errorCode = budgetFailure ?? error.code ?? 'BATCH_DRIVER_FAILED'
    report.scenarioPassed = adapter.origin === 'real-model' && report.modelCalls ? false : null
    report.scenarioExecuted = adapter.origin === 'real-model' && report.modelCalls > 0
    report.verifiedWorkflowExecutions = 0
    return report
  } finally { activeController?.abort(); if (ownsFixture) fixture.dispose() }
}
