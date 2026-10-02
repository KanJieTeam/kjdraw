import assert from 'node:assert/strict'
import { createAiChatRuntime } from '../../../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'
import { createGeologyScenarioRuntimeState } from './geology-runner-history-transfer.mjs'
import { buildRound8ReviewedWorkflowFixture, round8ReviewedWorkflowDescriptor,
  round8ReviewedWorkflowInputBindings, evaluateRound8ReviewedStepOracle,
  evaluateRound8ReviewedWorkflowOracle } from './geology-round8-reviewed-workflow-oracles.mjs'

const clone = structuredClone
const signature = document => canonicalStringify(document.snapshot())
const INPUT_START = 'ROUND8_CALLER_INPUTS_BEGIN\n'
const INPUT_END = '\nROUND8_CALLER_INPUTS_END'
const supportedKinds = new Set(['mixed', 'source'])

export const ROUND8_REVIEWED_CHAT_PROTOCOL = Object.freeze({
  version: 'round8-sequential-reviewed-chat-v1',
  inputStart: INPUT_START, inputEnd: INPUT_END,
  supportedIntents: Object.freeze(['source-section.mixed-source-and-manual-edit',
    'batch-historical-workflow.selected-historical-source-revision']),
  evidenceOrigins: Object.freeze(['fixture-oracle-selftest', 'real-model']),
  sourceOfInputs: 'complete-caller-declarations-and-actual-native-identities-not-entity-gold',
  modelAdapterContract: 'call({messages,settings,signal,stageIndex,requestIndex}) returns normalized Chat Completions response',
  approvalContract: 'reviewProposal({stageIndex,proposal,pendingVerdict,currentRevision}) must return exactly true',
  workflowBoundary: 'separate explicit host approvals; not one atomic compound transaction; no browser-refresh claim',
})

/** Opt-in protocol clarification, not new CAD evidence or relaxed scoring. */
export const ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL = Object.freeze({
  version: 'round8-sequential-reviewed-chat-native-reads-v3',
  option: 'required-native-reads-v3',
  requiredReadToolNames: Object.freeze(['cad_read_geology_source']),
  scope: 'only-these-reviewed-workflows-with-an-actual-retained-native-source',
})

/** Forward-only source-read transport budget declaration. No returned source
 * facts or geometric expectations are supplied and old protocol bytes stay fixed. */
export const ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL = Object.freeze({
  version: 'round8-sequential-reviewed-chat-bounded-native-reads-v4',
  option: 'bounded-native-reads-v4',
  maxBytes: 262144,
  budgetSource: 'published-cad_read_geology_source-inputSchema-maximum',
})

function protocolFor(readProtocolVersion) {
  if (readProtocolVersion === 'legacy') return ROUND8_REVIEWED_CHAT_PROTOCOL.version
  if (readProtocolVersion === ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL.option) return ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL.version
  if (readProtocolVersion === ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.option) return ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.version
  throw new Error('Unknown reviewed-chat read protocol')
}

function declaredNativeReadContract(input, readProtocolVersion) {
  if (readProtocolVersion === 'legacy') return input
  const boundedRead = readProtocolVersion === ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.option
  return { ...input, protocol: protocolFor(readProtocolVersion),
    stagePolicy: { ...input.stagePolicy,
      requiredReadToolNames: [...ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL.requiredReadToolNames] },
    requiredNativeReadContract: {
      scope: ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL.scope,
      beforeAnyProposalIncludingManualGeometry: true,
      readMustBeExecutedInThisStage: true,
      requiredToolCalls: [{ name: 'cad_read_geology_source',
        arguments: { expectedRevision: input.callerInputs.revision, drawingId: input.callerInputs.drawingId,
          ...(boundedRead ? { maxBytes: ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.maxBytes } : {}) },
        optionalArgumentsUsePublishedToolSchema: true }],
      ...(boundedRead ? { sourceReadBudget: {
        maxBytes: ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.maxBytes,
        source: ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.budgetSource,
        appliesToEachRequiredSourceRead: true,
        oversizeSourceRejectedWithoutTruncation: true,
        everyActualNativeReadMustSucceed: true,
        noHostArgumentRewriteOrAutomaticRetry: true,
      } } : {}),
      requiredReceipt: { ok: true, documentId: input.callerInputs.documentId, revision: input.callerInputs.revision },
      generalDrawingQueryDoesNotSubstituteForNativeSourceRead: true,
      priorConversationOrPreviousStageReadDoesNotSubstitute: true,
      hostWillNotExecuteRequiredReadOnModelsBehalf: true,
    } }
}

/** Public task decomposition follows the caller's explicit review policy, not
 * a hidden phrase-to-command table. No expected geometry is passed to a model.
 * The remaining manual step excludes already-completed source changes so the
 * existing host tool router can offer general CAD tools without redoing them.
 */
export function round8ReviewedChatStageInputs(scenario, fixture, stageIndex,
  { revision, previousApproval, readProtocolVersion = 'legacy' } = {}) {
  const descriptor = round8ReviewedWorkflowDescriptor(scenario)
  if (!descriptor || !supportedKinds.has(descriptor.kind) || !Number.isInteger(stageIndex) ||
    stageIndex < 0 || stageIndex >= (descriptor.kind === 'mixed' ? 2 : 1)) throw new Error('Unsupported reviewed-chat stage')
  assert.equal(Number.isInteger(revision), true)
  const bindings = round8ReviewedWorkflowInputBindings(fixture)
  if (stageIndex === 0) return declaredNativeReadContract({
    protocol: ROUND8_REVIEWED_CHAT_PROTOCOL.version, stageIndex, originalRequest: scenario.prompt,
    callerInputs: { ...bindings, revision },
    stagePolicy: { onlyFirstDeclaredReviewStep: descriptor.kind === 'mixed',
      onePendingProposal: true, readCurrentNativeSourceBeforeActing: true,
      noAutomaticApproval: true, independentlySelectedDocumentOnly: descriptor.kind === 'source' },
  }, readProtocolVersion)
  const declaration = fixture.suppliedInputs.confirmedMixedChanges
  assert.ok(previousApproval && previousApproval.status === 'committed' && previousApproval.afterRevision === revision,
    'The next stage cannot run before the actual first host commit')
  return declaredNativeReadContract({
    protocol: ROUND8_REVIEWED_CHAT_PROTOCOL.version, stageIndex,
    callerInputs: { provenance: bindings.provenance, documentId: bindings.documentId,
      revision, drawingId: bindings.drawingId, identityStrategy: bindings.identityStrategy,
      aliases: clone(bindings.aliases),
      remainingManualDisplacement: { provenance: declaration.provenance,
        units: declaration.drawingUnits, ...clone(declaration.manualDisplacement) } },
    actualPreviousHostApproval: clone(previousApproval),
    stagePolicy: { onlyRemainingDeclaredManualDisplacement: true, onePendingProposal: true,
      readCurrentNativeSourceBeforeActing: true, noAutomaticApproval: true,
      preserveEveryOtherObjectAndAllRetainedData: true },
  }, readProtocolVersion)
}

export function frameRound8ReviewedChatStage(input) {
  const boundedRead = input.protocol === ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.version
  const requiredReads = input.protocol === ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL.version || boundedRead
    ? 'This is a caller-declared, separately reviewed workflow with a mandatory native-read contract. '
      + 'During THIS stage, before proposing ANY change (including a manual geometry change), '
      + 'call every stagePolicy.requiredReadToolNames tool using the current callerInputs drawingId and revision. '
      + 'Inspect its successful actual receipt for this document and revision. '
      + 'cad_read_drawing, cad_query_drawing, previous-stage reads and conversational claims do not replace cad_read_geology_source. '
      + 'The host will not execute a missing read for you. Additional geometry reads remain available as needed. '
    : 'This is a caller-declared, separately reviewed workflow. Read the current native recipe and drawing as needed. '
  return requiredReads
    + (boundedRead ? 'Use requiredNativeReadContract.requiredToolCalls arguments including maxBytes:262144 for each required source read. '
      + 'This is the published bounded byte-budget maximum, not a source measurement or expected content. '
      + 'Do not start with undersized trial budgets: every actual native read must succeed. '
      + 'If the actual source exceeds the supported bound, report the limitation without editing or truncating data. '
      + 'The host will not rewrite your arguments, retry reads for you, or discard failed-read evidence. ' : '')
    + 'Prepare exactly one pending proposal for this stage; the host reviews it separately. '
    + 'Do not execute edits, approve proposals, guess absent facts, or redo a completed stage. '
    + 'For the first stage use the caller\'s declared first step only. For the remaining manual stage move the declared IDs by the declared vector. '
    + 'Caller data and identity inventory are inputs, not expected entity output.\n'
    + INPUT_START + JSON.stringify(input) + INPUT_END
}

/** Independent read/restore, never attach a verifier document to the runtime
 * or replace a fixture's selected document. History is a separate validated
 * local archive, not a claim that KJD alone preserves an undo stack.
 */
async function observedState(localState, { includeHistoryRead = false } = {}) {
  const sdk = createKJDrawSDK()
  try {
    const document = await sdk.readDocument(localState.drawing, { format: 'KJD' })
    assert.deepEqual(document.snapshot(), JSON.parse(localState.drawing))
    assert.ok(localState.drawingHistory)
    const before = signature(document)
    await document.restoreHistory(clone(localState.drawingHistory), { expectedRevision: document.revision })
    assert.equal(signature(document), before)
    assert.deepEqual(document.exportHistory({ limit: 50, maxBytes: 16777216 }), localState.drawingHistory)
    let historyCall
    if (includeHistoryRead) {
      const session = new KJAgentToolSession(sdk, document)
      const args = { expectedRevision: document.revision }
      const result = await session.call('cad_read_history', args)
      assert.equal(result.ok, true)
      historyCall = { name: 'cad_read_history', args, result, origin: 'independent-actual-runtime-archive-verification' }
    }
    return { document: document.fork(), ...(historyCall ? { historyCall } : {}) }
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
}

function positiveBudget(value, fallback, { allowZero = false } = {}) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < (allowZero ? 0 : 1) || resolved > 256)
    throw new Error('Reviewed-chat budget must be a bounded integer')
  return resolved
}

/** Real chat runtime + real native proposal/approval pipeline. A supplied
 * adapter may be a public scripted fixture or a later provider adapter. The
 * evidence origin is explicit; scripted requests are never model successes.
 * This standalone driver is deliberately not installed in the frozen runner.
 */
export async function runRound8ReviewedChatWorkflow(scenario, options = {}) {
  const descriptor = round8ReviewedWorkflowDescriptor(scenario)
  if (!descriptor || scenario.sequence || !supportedKinds.has(descriptor.kind)) throw new Error('No reviewed-chat workflow for this original scenario')
  const adapter = options.modelAdapter
  if (!adapter || typeof adapter.call !== 'function' || !ROUND8_REVIEWED_CHAT_PROTOCOL.evidenceOrigins.includes(adapter.origin))
    throw new Error('An explicitly classified model adapter is required')
  if (typeof options.reviewProposal !== 'function') throw new Error('An explicit host review callback is required')
  const maxRequests = positiveBudget(options.maxRequests, 16)
  const maxToolCalls = positiveBudget(options.maxToolCalls, 32)
  const maxApprovals = positiveBudget(options.maxApprovals, 2, { allowZero: true })
  const readProtocolVersion = options.readProtocolVersion ?? 'legacy'
  const protocol = protocolFor(readProtocolVersion)
  const fixture = options.fixture ?? await buildRound8ReviewedWorkflowFixture(scenario)
  const ownsFixture = !options.fixture
  if (fixture.round8ReviewedWorkflowOracleId !== descriptor.id) throw new Error('Fixture does not match the original scenario')
  const report = { protocol,
    ...(readProtocolVersion === 'legacy' ? {} : { readProtocolVersion }), scenarioId: scenario.id,
    origin: adapter.origin, fixtureOnly: adapter.origin !== 'real-model', requests: 0,
    realProviderRequests: 0, modelCalls: 0, scriptedResponseRequests: 0,
    toolCalls: 0, toolAttempts: 0, hostVerificationReads: 0, approvals: 0,
    approvalDecisions: 0, steps: [], prompts: [], calls: [],
    budgets: { maxRequests, maxToolCalls, maxApprovals },
    status: 'not-run', scenarioPassed: null, scenarioExecuted: false }
  let stageIndex = 0, activeController, budgetFailure, previousApproval
  const chat = createAiChatRuntime({ endpoint: 'https://public-fixture.invalid/chat/completions',
    model: adapter.model ?? 'declared-reviewed-workflow-adapter', captureToolOutputs: true,
    fetchImpl: async (_url, init) => {
      if (report.requests >= maxRequests) { budgetFailure = 'REQUEST_BUDGET_EXHAUSTED'; throw new Error(budgetFailure) }
      const body = JSON.parse(init.body)
      report.requests++
      if (adapter.origin === 'real-model') { report.realProviderRequests++; report.modelCalls++ }
      else report.scriptedResponseRequests++
      const { model: _model, messages, ...settings } = body
      const response = await adapter.call({ messages: clone(messages), settings: clone(settings),
        signal: init.signal, stageIndex, requestIndex: report.requests })
      const calls = response?.toolCalls ?? []
      for (const call of calls) {
        let args = null
        try { args = JSON.parse(call.function.arguments) } catch { /* native adapter rejects malformed arguments */ }
        report.calls.push({ stageIndex, requestIndex: report.requests, id: call.id, name: call.function?.name, args })
      }
      return Response.json({ model: response.model ?? adapter.model ?? 'declared-reviewed-workflow-adapter',
        choices: [{ message: { role: 'assistant', content: response.content ?? '', tool_calls: calls },
          finish_reason: response.finishReason ?? (calls.length ? 'tool_calls' : 'stop') }],
        usage: { prompt_tokens: response.usage?.inputTokens ?? 0, completion_tokens: response.usage?.outputTokens ?? 0,
          total_tokens: response.usage?.totalTokens ?? 0 } })
    } })
  try {
    await chat.restoreLocalState(await createGeologyScenarioRuntimeState(fixture))
    let after = await observedState(await chat.exportLocalState())
    assert.equal(signature(after.document), fixture.initialState)
    for (stageIndex = 0; stageIndex < (descriptor.kind === 'mixed' ? 2 : 1); stageIndex++) {
      if (options.signal?.aborted) { report.status = 'cancelled'; break }
      const beforeState = canonicalStringify(JSON.parse((await chat.exportLocalState()).drawing))
      const input = round8ReviewedChatStageInputs(scenario, fixture, stageIndex,
        { revision: chat.revision, previousApproval, readProtocolVersion })
      const prompt = frameRound8ReviewedChatStage(input)
      report.prompts.push(prompt)
      activeController = new AbortController()
      const signal = options.signal ? AbortSignal.any([activeController.signal, options.signal]) : activeController.signal
      const result = await chat.send(prompt, { signal, onProgress: progress => {
        if (progress.phase === 'tool-start') {
          report.toolAttempts++
          if (report.toolCalls >= maxToolCalls) { budgetFailure = 'TOOL_BUDGET_EXHAUSTED'; activeController.abort() }
        } else if (progress.phase === 'tool-complete') report.toolCalls++
      } })
      const toolCalls = []
      for (const output of result.toolOutputs ?? []) {
        const issued = report.calls.find(call => call.stageIndex === stageIndex && call.id === output.id && call.name === output.name)
        if (!issued) throw new Error('Actual tool receipt lacks a bound provider call')
        issued.result = output.result
        toolCalls.push({ name: issued.name, args: clone(issued.args), result: output.result })
      }
      after = await observedState(await chat.exportLocalState())
      const stage = { origin: adapter.origin, stageIndex, phase: 'pending', beforeState,
        toolCalls, proposal: result.proposal, afterDocument: after.document, chatStatus: result.status }
      report.steps.push(stage)
      if (budgetFailure) { report.status = 'budget-exhausted'; report.errorCode = budgetFailure; break }
      if (result.status !== 'proposal') {
        report.status = result.status === 'message' ? 'no-proposal' : result.status === 'cancelled' ? 'cancelled' : 'failed'
        report.errorCode = result.error?.code ?? null; break
      }
      if (result.proposals?.length !== 1) { for (const proposal of result.proposals ?? []) chat.reject(proposal.planId); report.status = 'ambiguous-proposals'; break }
      const pendingVerdict = evaluateRound8ReviewedStepOracle(scenario, fixture, stageIndex, stage)
      stage.pendingVerdict = pendingVerdict
      if (pendingVerdict.status !== 'satisfied') { chat.reject(result.proposal.planId); report.status = 'invalid-preview'; break }
      // Reserve the actual postcommit history read before approving any edit.
      if (report.approvals >= maxApprovals || report.toolCalls >= maxToolCalls) {
        chat.reject(result.proposal.planId); report.status = 'budget-exhausted'
        report.errorCode = report.approvals >= maxApprovals ? 'APPROVAL_BUDGET_EXHAUSTED' : 'TOOL_BUDGET_EXHAUSTED'; break
      }
      report.approvalDecisions++
      let decision
      try { decision = await options.reviewProposal({ stageIndex, proposal: clone(result.proposal), pendingVerdict: clone(pendingVerdict), currentRevision: chat.revision }) }
      catch { chat.reject(result.proposal.planId); report.status = 'review-failed'; report.errorCode = 'HOST_REVIEW_CALLBACK_FAILED'; break }
      if (decision !== true) { chat.reject(result.proposal.planId); report.status = 'not-approved'; break }
      const approval = await chat.approve(result.proposal.planId)
      if (approval.status !== 'applied') { report.status = 'approval-failed'; report.errorCode = approval.error?.code ?? null; break }
      report.approvals++
      previousApproval = clone(approval.receipt)
      const localState = await chat.exportLocalState()
      after = await observedState(localState, { includeHistoryRead: true })
      report.toolCalls++; report.hostVerificationReads++
      toolCalls.push(after.historyCall)
      Object.assign(stage, { phase: 'committed', approval: clone(approval.receipt), hostApprovalApplied: true,
        approvedPlanId: result.proposal.planId, afterDocument: after.document,
        actualLocalState: clone(localState) })
      stage.committedVerdict = evaluateRound8ReviewedStepOracle(scenario, fixture, stageIndex, stage)
      if (stage.committedVerdict.status !== 'satisfied') { report.status = 'invalid-commit'; break }
      report.status = 'completed'
    }
    const complete = report.status === 'completed' && report.steps.length === (descriptor.kind === 'mixed' ? 2 : 1)
    report.evidence = { origin: adapter.origin, steps: report.steps, afterDocument: after.document,
      ...(descriptor.kind === 'mixed' ? { reviewPolicy: clone(fixture.suppliedInputs.confirmedMixedChanges.reviewPolicy) } : {}),
      actualHostActions: complete ? [...descriptor.requiredHostActions] : [] }
    report.verdict = evaluateRound8ReviewedWorkflowOracle(scenario, fixture, report.evidence)
    if (report.status === 'completed' && report.verdict.status !== 'satisfied') report.status = 'invalid-workflow'
    report.scenarioPassed = report.verdict.scenarioPassed
    report.scenarioExecuted = report.verdict.scenarioExecuted
    report.realModelAttempted = report.realProviderRequests > 0
    report.modelWorkflowPassed = adapter.origin === 'real-model' && report.realModelAttempted
      ? report.status === 'completed' && report.verdict.scenarioPassed === true : null
    report.finalLocalState = await chat.exportLocalState()
    report.unselectedInitialStates = (fixture.unselectedWorkspaceMembers ?? []).map(member => member.initialState)
    report.unselectedFinalStates = (fixture.unselectedWorkspaceMembers ?? []).map(member => signature(member.document))
    return report
  } finally { activeController?.abort(); chat.destroy(); if (ownsFixture) fixture.dispose() }
}
