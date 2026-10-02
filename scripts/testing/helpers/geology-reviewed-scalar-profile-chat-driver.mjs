import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createAiChatRuntime } from '../../../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS, KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { readGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify, deepFreeze } from '../../../packages/kjdraw-sdk/src/utils.js'
import { createGeologyScenarioRuntimeState } from './geology-runner-history-transfer.mjs'
import { round8ReviewedChatStageInputs } from './geology-round8-reviewed-chat-driver.mjs'
import { buildRound8ReviewedWorkflowFixture, round8ReviewedWorkflowDescriptor,
  expectedRound8ReviewedWorkflowOutcome, evaluateRound8ReviewedStepOracle,
  evaluateRound8ReviewedWorkflowOracle } from './geology-round8-reviewed-workflow-oracles.mjs'
import { round6SourceWorkflowPhysicalGeometryMatches } from './geology-round6-source-workflow-oracles.mjs'

const clone = structuredClone, same = (a,b) => canonicalStringify(a) === canonicalStringify(b)
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonicalStringify(value)).digest('hex')
const state = document => canonicalStringify(document.snapshot())
const scalar = 'cad_propose_geology_scalar_revision'
const reads = new Map(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => [tool.name,tool]))
const profileNames = new Set(KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES)
function nativeMillimetreProfileWire() {
  // Definitions bind units to the actual session. Registry metadata inspection
  // is not a drawing/source read executed on behalf of this workflow's model.
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
  try {return new KJAgentToolSession(sdk,document,{toolProfile:'geology-scalars-v1'}).definitions.map(tool =>
    ({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema}}))}
  finally {sdk.closeDocument(document.id)}
}
const profileWire = nativeMillimetreProfileWire()
const kinds = new Set(['source','mixed'])
const projection = snapshot => {
  const { revision, revisions, metadata, ...rest } = snapshot
  return { ...rest, metadata: { ...metadata, modifiedAt:null } }
}
const completeContent = document => projection(document.snapshot())
const entities = rows => rows.map(entity => ({id:entity.id,type:entity.type,payload:clone(entity.payload)})).sort((a,b) => a.id.localeCompare(b.id))
const sourceFacts = source => {
  const { columnStylePack, sectionStylePack, hatchPack, ...facts } = source.input
  return {kind:source.kind,facts}
}

export const REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL = deepFreeze({
  version:'reviewed-scalar-profile-chat-v1', toolProfile:'geology-scalars-v1',
  inputStart:'SCALAR_PROFILE_CALLER_INPUTS_BEGIN\n', inputEnd:'\nSCALAR_PROFILE_CALLER_INPUTS_END',
  supportedIntents:['source-section.mixed-source-and-manual-edit','batch-historical-workflow.selected-historical-source-revision'],
  evidenceOrigins:['fixture-oracle-selftest','real-model'],
  effectiveToolNames:[...KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES],
  effectiveWireDefinitionsSha256:hash(profileWire),
  sourceReadMaxBytes:262144, budgets:{maxRequests:16,maxToolCalls:32,maxApprovals:2},
  sourceOfInputs:'original-caller-declarations-and-real-native-identities-not-detached-expected-output',
  retainedReference:'unchanged-round8-detached-source-geometry-preservation-reference',
  scoring:'independent-native-scalar-receipt-contract; legacy-general-only-verdict-retained-unmodified',
  approvalContract:'reviewProposal({stageIndex,proposal,pendingVerdict,currentRevision}) returns exactly true',
  modelAdapterContract:'call({messages,settings,signal,stageIndex,requestIndex}) returns normalized Chat Completions response',
  boundary:'forward-only; separate explicit host approvals; no old-result-rescoring; no browser-refresh or persisted-task-approval claim',
})
export const REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL_SHA256 = hash(REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL)

export function reviewedScalarProfileStageInputs(scenario,fixture,stageIndex,{revision,previousApproval}={}) {
  const input = round8ReviewedChatStageInputs(scenario,fixture,stageIndex,
    {revision,previousApproval,readProtocolVersion:'bounded-native-reads-v4'})
  return {...input,protocol:REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.version,toolProfile:REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.toolProfile,
    stagePolicy:{...input.stagePolicy,requiredProposalToolName:stageIndex === 0 ? scalar:'cad_propose_move',
      onlyCallerDeclaredChanges:true,retainEveryUnrequestedSourceFieldAndNativeObject:true}}
}
export function frameReviewedScalarProfileStage(input) {
  assert.equal(input.protocol,REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.version)
  return 'Forward-only caller-selected geology-scalars-v1 protocol. The immutable runtime session offers its exact registered tool profile; do not change or widen it. '
    + 'Before ANY proposal in THIS stage, including manual MOVE, execute cad_read_geology_source using this stage callerInputs drawingId and revision and maxBytes:262144. '
    + 'Inspect its successful exact current source receipt. Other geometry/history reads and previous-stage reads do not substitute. Every actual read must succeed; a repaired failed read remains failed evidence. '
    + 'Use the stagePolicy.requiredProposalToolName for exactly the caller-declared current stage. Scalar schema excludes complete replacement lists; never add correlations, uncorrelatedOccurrences, strata or observations. '
    + 'Prepare exactly one pending proposal; the host reviews it separately. Do not approve, execute, redo an already committed step, guess source facts or claim success without a real host receipt. '
    + 'The host will not read, rewrite your arguments, remove arrays, or grant approval on your behalf. Caller source/identities are supplied inputs, not expected entity output.\n'
    + REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.inputStart+JSON.stringify(input)+REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.inputEnd
}

/** Uses the unchanged detached engineering reference but checks actual scalar
 * receipts directly. It never renames a call for the legacy general-only oracle.
 */
export function evaluateReviewedScalarProfileStep(scenario,fixture,index,evidence) {
  const expected = expectedRound8ReviewedWorkflowOutcome(scenario,fixture), step = expected.steps[index]
  if (!step || !evidence || !REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.evidenceOrigins.includes(evidence.origin))
    return {status:'not-evaluated',scenarioPassed:null,reason:'actual-scalar-step-evidence-missing'}
  const assertions = [], check = (id,ok) => assertions.push({id,satisfied:!!ok})
  const calls = evidence.toolCalls ?? [], proposal = evidence.proposal
  const toolName = step.kind === 'source' ? scalar:'cad_propose_move'
  const proposedIndex = calls.findIndex(call => call.name === toolName && call.result?.ok === true &&
    call.args?.expectedRevision === step.expectedRevision && same(call.result.value,proposal))
  const sourceIndex = calls.findIndex(call => call.name === 'cad_read_geology_source' && call.result?.ok === true &&
    call.args?.expectedRevision === step.expectedRevision && call.args?.drawingId === fixture.drawingId &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === step.expectedRevision &&
    call.result.value?.units === 'millimeter' && call.result.value?.sourceUnits === 'meter' &&
    same({kind:call.result.value.kind,facts:call.result.value.facts},sourceFacts(step.beforeSource)))
  check('actual-current-source-read-before-this-proposal',sourceIndex >= 0 && sourceIndex < proposedIndex)
  check('every-call-is-an-actual-profile-registry-name',calls.every(call => profileNames.has(call.name)))
  check('every-actual-read-successful-current-and-public',calls.filter(call => reads.has(call.name)).every(call => {
    const result = call.result?.value, revision = call.origin === 'independent-actual-runtime-archive-verification'
      ? step.expectedRevision + 1:step.expectedRevision
    return call.result?.ok === true && result?.documentId === fixture.document.id && result.revision === revision &&
      (!Object.hasOwn(call.args ?? {},'expectedRevision') || call.args.expectedRevision === revision)
  }))
  check('actual-profile-proposal-receipt',proposedIndex >= 0 && proposal?.documentId === fixture.document.id &&
    proposal.expectedRevision === step.expectedRevision && proposal.command === step.command &&
    calls.filter(call => call.result?.ok === true && call.result.value?.status === 'awaiting-host-approval').length === 1)
  check('exact-full-before-after-native-preview',proposal?.preview?.documentId === fixture.document.id &&
    proposal.preview.revision === step.expectedRevision && proposal.preview.command === step.command &&
    same(entities(proposal.preview.before ?? []),step.before) && same(entities(proposal.preview.after ?? []),step.after))
  const resources = proposal?.preview?.resources ?? []
  check('all-preview-resources-exact-and-unique',Array.isArray(resources) && new Set(resources.map(record => record.id)).size === resources.length && resources.every(record => {
    const expected = step.afterContent.objects[record.id] ?? step.beforeContent.objects[record.id]
    return expected && expected.kind === (record.kind ?? 'table-record') && expected.type === record.type &&
      expected.name === record.name && same(expected.payload,record.payload)
  }))
  if (step.kind === 'source') {
    check('scalar-source-complete-before-after-visible',same(proposal?.engineeringEvidence?.beforeSource,sourceFacts(step.beforeSource)) &&
      same(proposal?.engineeringEvidence?.afterSource,sourceFacts(step.afterSource)))
    check('exact-unchanged-native-identity-map',same([...(proposal?.unchangedIds ?? [])].sort(),[...step.unchangedIds].sort()))
    const declared = fixture.suppliedInputs.confirmedMixedChanges?.waterTable ?? fixture.suppliedInputs.confirmedSelectedWaterTable?.rows
    const args = calls[proposedIndex]?.args
    check('only-declared-scalar-arguments',args?.drawingId === fixture.drawingId && args.units === 'millimeter' &&
      same(args.updates,declared) && same(Object.keys(args).sort(),['expectedRevision','units','drawingId','updates'].sort()))
  } else {
    const change = fixture.suppliedInputs.confirmedMixedChanges.manualDisplacement
    check('manual-exact-ids-vector-and-no-source-rewrite',same(proposal?.arguments?.ids,change.ids) &&
      proposal?.arguments?.dx === change.dx && proposal?.arguments?.dy === change.dy && same(step.beforeSource,step.afterSource))
  }
  if (evidence.phase === 'pending') {
    check('preview-did-not-mutate-complete-state',evidence.afterDocument?.revision === step.expectedRevision &&
      same(completeContent(evidence.afterDocument),step.beforeContent) && state(evidence.afterDocument) === evidence.beforeState)
    check('pending-never-implies-host-approval',proposal?.status === 'awaiting-host-approval' && !evidence.approval && !evidence.hostApprovalApplied)
  } else {
    let before
    try { before = JSON.parse(evidence.beforeState) } catch { /* absent real state is rejected */ }
    check('before-state-exactly-bound',before?.documentId === fixture.document.id && before.revision === step.expectedRevision && same(projection(before),step.beforeContent))
    const receipt = evidence.approval?.value ?? evidence.approval
    check('exact-actual-host-commit-receipt',evidence.phase === 'committed' && evidence.hostApprovalApplied === true &&
      receipt?.status === 'committed' && receipt.command === step.command && receipt.beforeRevision === step.expectedRevision &&
      receipt.afterRevision === step.expectedRevision + 1 && evidence.approvedPlanId === proposal?.planId &&
      (!Object.hasOwn(receipt ?? {},'planId') || receipt.planId === proposal?.planId))
    check('exact-complete-native-content-after-commit',evidence.afterDocument?.revision === step.expectedRevision + 1 &&
      same(completeContent(evidence.afterDocument),step.afterContent))
    let source
    try { source = readGeologyDrawingRecipe(evidence.afterDocument,fixture.drawingId).source } catch { /* failed source is rejected */ }
    check('complete-retained-source-after-commit',same(source,step.afterSource))
    check('independent-physical-hatch-depth-water-geometry',evidence.afterDocument &&
      round6SourceWorkflowPhysicalGeometryMatches(evidence.afterDocument.listEntities(),step.afterSource))
    check('exact-one-real-history-operation',evidence.afterDocument?.history.undoCount === step.afterUndoCount &&
      evidence.afterDocument.history.redoCount === 0 && calls.some(call => call.name === 'cad_read_history' &&
        call.origin === 'independent-actual-runtime-archive-verification' && call.result?.ok === true &&
        call.args?.expectedRevision === step.expectedRevision + 1 && call.result.value?.documentId === fixture.document.id &&
        call.result.value?.revision === step.expectedRevision + 1 && call.result.value?.history?.undoCount === step.afterUndoCount &&
        call.result.value.history.redoCount === 0))
  }
  return {status:assertions.every(item => item.satisfied) ? 'satisfied':'failed',assertions,
    oracleId:REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.version+':step-'+index,scenarioPassed:null,scenarioExecuted:false}
}

export function evaluateReviewedScalarProfileWorkflow(scenario,fixture,evidence) {
  const descriptor = round8ReviewedWorkflowDescriptor(scenario), expected = expectedRound8ReviewedWorkflowOutcome(scenario,fixture)
  if (!descriptor || !kinds.has(descriptor.kind) || !evidence?.afterDocument ||
    !REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.evidenceOrigins.includes(evidence.origin))
    return {status:'not-evaluated',scenarioPassed:null,scenarioExecuted:false}
  const assertions = [], check = (id,ok) => assertions.push({id,satisfied:!!ok})
  check('complete-declared-step-count',evidence.steps?.length === expected.steps.length)
  expected.steps.forEach((_step,index) => {
    const verdict = evaluateReviewedScalarProfileStep(scenario,fixture,index,evidence.steps?.[index])
    check('step-'+index+':actual-evidence-present',verdict.status !== 'not-evaluated')
    assertions.push(...(verdict.assertions ?? []).map(assertion => ({...assertion,id:'step-'+index+':'+assertion.id})))
  })
  check('complete-final-native-state',same(completeContent(evidence.afterDocument),expected.steps.at(-1).afterContent) &&
    evidence.afterDocument.revision === fixture.initialRevision + expected.steps.length)
  let source
  try {source=readGeologyDrawingRecipe(evidence.afterDocument,fixture.drawingId).source} catch { /* absent native source is failed evidence */ }
  check('exact-final-source',same(source,expected.afterSource))
  check('unselected-documents-remain-full-state-unchanged',(fixture.unselectedWorkspaceMembers ?? []).every(member => state(member.document) === member.initialState))
  check('selected-native-document-identity',evidence.afterDocument.id === fixture.document.id && (descriptor.kind !== 'source' ||
    evidence.afterDocument.id === fixture.suppliedInputs.selectedHistoricalContext.selectedDocumentId))
  check('explicit-separate-ordered-review-policy',descriptor.kind !== 'mixed' || same(evidence.reviewPolicy,fixture.suppliedInputs.confirmedMixedChanges.reviewPolicy))
  check('actual-host-actions-completed',descriptor.requiredHostActions.every(action => evidence.actualHostActions?.includes(action)))
  const satisfied = assertions.every(item => item.satisfied)
  return {status:satisfied ? 'satisfied':'failed',assertions,oracleId:REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.version,
    evidenceOrigin:evidence.origin,nativeContractSatisfied:satisfied,hostActionsVerified:satisfied,
    scenarioPassed:evidence.origin === 'real-model' ? satisfied:null,scenarioExecuted:evidence.origin === 'real-model' && satisfied}
}

async function observedState(localState,{includeHistoryRead=false}={}) {
  const sdk = createKJDrawSDK()
  try {
    const document = await sdk.readDocument(localState.drawing,{format:'KJD'})
    assert.deepEqual(document.snapshot(),JSON.parse(localState.drawing)); assert.ok(localState.drawingHistory)
    const before = state(document)
    await document.restoreHistory(clone(localState.drawingHistory),{expectedRevision:document.revision})
    assert.equal(state(document),before)
    assert.deepEqual(document.exportHistory({limit:50,maxBytes:16777216}),localState.drawingHistory)
    let historyCall
    if (includeHistoryRead) {
      const args = {expectedRevision:document.revision}, result = await new KJAgentToolSession(sdk,document,{toolProfile:REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.toolProfile}).call('cad_read_history',args)
      assert.equal(result.ok,true)
      historyCall = {name:'cad_read_history',args,result,origin:'independent-actual-runtime-archive-verification'}
    }
    // fork intentionally starts a new empty-history baseline. Preserve the
    // independently verified real archive in the detached evidence document
    // by the actual SDK restoration API, never by a fake history facade.
    const captured=document.fork()
    await captured.restoreHistory(clone(localState.drawingHistory),{expectedRevision:captured.revision})
    assert.equal(state(captured),before)
    assert.deepEqual(captured.exportHistory({limit:50,maxBytes:16777216}),localState.drawingHistory)
    return {document:captured,...(historyCall ? {historyCall}:{})}
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
}
function budget(value,fallback,{allowZero=false}={}) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < (allowZero ? 0:1) || resolved > fallback) throw new Error('Scalar-profile budget exceeds the fixed public protocol bounds')
  return resolved
}

export async function runReviewedScalarProfileChatWorkflow(scenario,options={}) {
  const descriptor = round8ReviewedWorkflowDescriptor(scenario)
  if (!descriptor || scenario.sequence || !kinds.has(descriptor.kind)) throw new Error('No scalar-profile workflow for this original scenario')
  const adapter = options.modelAdapter
  if (!adapter || typeof adapter.call !== 'function' || !REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.evidenceOrigins.includes(adapter.origin)) throw new Error('An explicitly classified model adapter is required')
  if (typeof options.reviewProposal !== 'function') throw new Error('An explicit host review callback is required')
  const maxRequests = budget(options.maxRequests,16), maxToolCalls = budget(options.maxToolCalls,32)
  const maxApprovals = budget(options.maxApprovals,2,{allowZero:true})
  const fixture = options.fixture ?? await buildRound8ReviewedWorkflowFixture(scenario), ownsFixture = !options.fixture
  if (fixture.round8ReviewedWorkflowOracleId !== descriptor.id) { if (ownsFixture) fixture.dispose(); throw new Error('Fixture does not match original scenario') }
  const report = {protocol:REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.version,protocolSha256:REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL_SHA256,
    questionSha256:hash(scenario.prompt),scenarioId:scenario.id,toolProfile:REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.toolProfile,
    origin:adapter.origin,fixtureOnly:adapter.origin !== 'real-model',requests:0,realProviderRequests:0,modelCalls:0,scriptedResponseRequests:0,
    toolCalls:0,toolAttempts:0,hostVerificationReads:0,approvals:0,approvalDecisions:0,steps:[],prompts:[],promptHashes:[],calls:[],responses:[],
    budgets:{maxRequests,maxToolCalls,maxApprovals},status:'not-run',scenarioPassed:null,scenarioExecuted:false}
  let stageIndex=0,activeController,budgetFailure,previousApproval
  const chat = createAiChatRuntime({toolProfile:REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.toolProfile,
    endpoint:'https://public-fixture.invalid/chat/completions',model:adapter.model ?? 'declared-scalar-profile-adapter',captureToolOutputs:true,
    fetchImpl:async (_url,init) => {
      if (report.requests >= maxRequests) {budgetFailure='REQUEST_BUDGET_EXHAUSTED';throw new Error(budgetFailure)}
      const body = JSON.parse(init.body), names = body.tools.map(tool => tool.function.name)
      assert.deepEqual(names,[...KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES])
      assert.deepEqual(body.tools,profileWire,'Effective provider schemas must be the exact native session profile definitions')
      report.requests++
      if (adapter.origin === 'real-model') {report.realProviderRequests++;report.modelCalls++} else report.scriptedResponseRequests++
      const {model:_model,messages,...settings} = body
      const response = await adapter.call({messages:clone(messages),settings:clone(settings),signal:init.signal,stageIndex,requestIndex:report.requests})
      const calls = response?.toolCalls ?? []
      report.responses.push({stageIndex,requestIndex:report.requests,modelReturned:response.model ?? null,
        usage:clone(response.usage ?? null),finishReason:response.finishReason ?? null,rawContent:response.content ?? null})
      for (const call of calls) {
        let args = null
        const rawArguments = call.function?.arguments
        try {args=JSON.parse(rawArguments)} catch { /* do not repair malformed model JSON */ }
        report.calls.push({stageIndex,requestIndex:report.requests,id:call.id,name:call.function?.name,args,rawArguments})
      }
      return Response.json({...(response.model ? {model:response.model}:{}),
        choices:[{message:{role:'assistant',content:response.content ?? '',...(calls.length ? {tool_calls:calls}:{})},
          finish_reason:response.finishReason ?? (calls.length ? 'tool_calls':'stop')}],
        ...(response.usage ? {usage:{prompt_tokens:response.usage.inputTokens,completion_tokens:response.usage.outputTokens,total_tokens:response.usage.totalTokens}}:{})})
    }})
  try {
    await chat.restoreLocalState(await createGeologyScenarioRuntimeState(fixture))
    assert.equal(chat.toolProfile,REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL.toolProfile)
    let after = await observedState(await chat.exportLocalState()); assert.equal(state(after.document),fixture.initialState)
    for (stageIndex=0;stageIndex < (descriptor.kind === 'mixed' ? 2:1);stageIndex++) {
      if (options.signal?.aborted) {report.status='cancelled';break}
      const beforeState = canonicalStringify(JSON.parse((await chat.exportLocalState()).drawing))
      const input = reviewedScalarProfileStageInputs(scenario,fixture,stageIndex,{revision:chat.revision,previousApproval})
      const prompt = frameReviewedScalarProfileStage(input)
      report.prompts.push(prompt);report.promptHashes.push(hash(prompt))
      activeController = new AbortController()
      const signal = options.signal ? AbortSignal.any([activeController.signal,options.signal]):activeController.signal
      const result = await chat.send(prompt,{signal,onProgress:progress => {
        if (progress.phase === 'tool-start') {
          report.toolAttempts++
          if (report.toolCalls >= maxToolCalls) {budgetFailure='TOOL_BUDGET_EXHAUSTED';activeController.abort()}
        } else if (progress.phase === 'tool-complete') report.toolCalls++
      }})
      const toolCalls = []
      for (const output of result.toolOutputs ?? []) {
        const issued = report.calls.find(call => call.stageIndex === stageIndex && call.id === output.id && call.name === output.name)
        if (!issued) throw new Error('Actual native receipt lacks an exact model-issued call')
        issued.result=output.result;toolCalls.push({name:issued.name,args:clone(issued.args),result:output.result})
      }
      after = await observedState(await chat.exportLocalState())
      const stage = {origin:adapter.origin,stageIndex,phase:'pending',beforeState,toolCalls,proposal:result.proposal,afterDocument:after.document,chatStatus:result.status}
      report.steps.push(stage)
      if (budgetFailure) {report.status='budget-exhausted';report.errorCode=budgetFailure;break}
      if (result.status !== 'proposal') {
        report.status=result.status === 'message' ? 'no-proposal':result.status === 'cancelled' ? 'cancelled':'failed'
        report.errorCode=result.error?.code ?? null;break
      }
      if (result.proposals?.length !== 1) {for (const proposal of result.proposals ?? []) chat.reject(proposal.planId);report.status='ambiguous-proposals';break}
      stage.legacyPendingVerdict=evaluateRound8ReviewedStepOracle(scenario,fixture,stageIndex,stage)
      stage.pendingVerdict=evaluateReviewedScalarProfileStep(scenario,fixture,stageIndex,stage)
      if (stage.pendingVerdict.status !== 'satisfied') {chat.reject(result.proposal.planId);report.status='invalid-preview';break}
      if (report.approvals >= maxApprovals || report.toolCalls >= maxToolCalls) {
        chat.reject(result.proposal.planId);report.status='budget-exhausted';report.errorCode=report.approvals >= maxApprovals ? 'APPROVAL_BUDGET_EXHAUSTED':'TOOL_BUDGET_EXHAUSTED';break
      }
      report.approvalDecisions++
      let decision
      try {decision=await options.reviewProposal({stageIndex,proposal:clone(result.proposal),pendingVerdict:clone(stage.pendingVerdict),currentRevision:chat.revision})}
      catch {chat.reject(result.proposal.planId);report.status='review-failed';report.errorCode='HOST_REVIEW_CALLBACK_FAILED';break}
      if (decision !== true) {chat.reject(result.proposal.planId);report.status='not-approved';break}
      const approval=await chat.approve(result.proposal.planId)
      if (approval.status !== 'applied') {report.status='approval-failed';report.errorCode=approval.error?.code ?? null;break}
      report.approvals++;previousApproval=clone(approval.receipt)
      const localState=await chat.exportLocalState()
      after=await observedState(localState,{includeHistoryRead:true});report.toolCalls++;report.hostVerificationReads++
      toolCalls.push(after.historyCall)
      Object.assign(stage,{phase:'committed',approval:clone(approval.receipt),hostApprovalApplied:true,approvedPlanId:result.proposal.planId,
        afterDocument:after.document,actualLocalState:clone(localState)})
      stage.legacyCommittedVerdict=evaluateRound8ReviewedStepOracle(scenario,fixture,stageIndex,stage)
      stage.committedVerdict=evaluateReviewedScalarProfileStep(scenario,fixture,stageIndex,stage)
      if (stage.committedVerdict.status !== 'satisfied') {report.status='invalid-commit';break}
      report.status='completed'
    }
    const complete=report.status === 'completed' && report.steps.length === (descriptor.kind === 'mixed' ? 2:1)
    report.evidence={origin:adapter.origin,steps:report.steps,afterDocument:after.document,
      ...(descriptor.kind === 'mixed' ? {reviewPolicy:clone(fixture.suppliedInputs.confirmedMixedChanges.reviewPolicy)}:{}),
      actualHostActions:complete ? [...descriptor.requiredHostActions]:[]}
    report.legacyVerdict=evaluateRound8ReviewedWorkflowOracle(scenario,fixture,report.evidence)
    report.verdict=evaluateReviewedScalarProfileWorkflow(scenario,fixture,report.evidence)
    if (report.status === 'completed' && report.verdict.status !== 'satisfied') report.status='invalid-workflow'
    report.scenarioPassed=adapter.origin === 'real-model' && report.realProviderRequests > 0 ? report.verdict.scenarioPassed:null
    report.scenarioExecuted=report.verdict.scenarioExecuted
    report.realModelAttempted=report.realProviderRequests > 0
    report.modelWorkflowPassed=adapter.origin === 'real-model' && report.realModelAttempted ? report.status === 'completed' && report.scenarioPassed === true:null
    report.finalLocalState=await chat.exportLocalState()
    report.unselectedInitialStates=(fixture.unselectedWorkspaceMembers ?? []).map(member => member.initialState)
    report.unselectedFinalStates=(fixture.unselectedWorkspaceMembers ?? []).map(member => state(member.document))
    return report
  } finally {activeController?.abort();chat.destroy();if (ownsFixture) fixture.dispose()}
}
