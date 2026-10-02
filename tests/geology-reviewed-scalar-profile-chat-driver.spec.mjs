import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL as PROTOCOL, REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL_SHA256,
  reviewedScalarProfileStageInputs,frameReviewedScalarProfileStage,evaluateReviewedScalarProfileStep,
  evaluateReviewedScalarProfileWorkflow,runReviewedScalarProfileChatWorkflow } from '../scripts/testing/helpers/geology-reviewed-scalar-profile-chat-driver.mjs'
import { ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS,buildRound8ReviewedWorkflowFixture,
  expectedRound8ReviewedWorkflowOutcome,round8ReviewedWorkflowInputBindings } from '../scripts/testing/helpers/geology-round8-reviewed-workflow-oracles.mjs'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession,KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { suppliedCreationDocumentSemantics } from '../scripts/testing/helpers/geology-supplied-creation-oracles.mjs'

const corpus=JSON.parse(await readFile(FIXTURE_URL,'utf8')), clone=structuredClone
const selected=corpus.scenarios.filter(s => !s.sequence && ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS.includes(s.id) && PROTOCOL.supportedIntents.includes(s.expected.intent))
const [MIXED,HISTORICAL]=PROTOCOL.supportedIntents
const sample=intent => selected.find(s => s.expected.intent === intent && s.id.endsWith('-zh-direct'))
const state=document => canonicalStringify(document.snapshot())
const hash=text => createHash('sha256').update(text).digest('hex')
const content=document => {
  const {revision,revisions,metadata,...rest}=document.snapshot()
  return {...rest,metadata:{...metadata,modifiedAt:null}}
}
function callerInput(messages) {
  const current=messages.filter(message => message.role === 'user' && typeof message.content === 'string' && message.content.includes(PROTOCOL.inputStart)).at(-1).content
  const start=current.lastIndexOf(PROTOCOL.inputStart), end=current.indexOf(PROTOCOL.inputEnd,start)
  assert.ok(start >= 0 && end > start)
  return JSON.parse(current.slice(start+PROTOCOL.inputStart.length,end))
}
const receipt=(messages,id) => {
  const item=messages.find(message => message.role === 'tool' && message.tool_call_id === id)
  return item ? JSON.parse(item.content):null
}

/** Scripted public selftest, consumes only public caller declarations and the
 * actual wire receipts. No detached gold or fake real-model origin is used.
 */
function fixtureAdapter({fault,stageFault=0,onRequest=()=>{}}={}) {
  const counters=new Map(), issued=new Map()
  return {origin:'fixture-oracle-selftest',model:'public-scalar-driver-fixture-not-provider',async call(request) {
    const {messages,settings,stageIndex}=request, input=callerInput(messages), declaration=input.callerInputs
    onRequest(request,input)
    assert.deepEqual(settings.tools.map(tool => tool.function.name),[...KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES])
    const index=counters.get(stageIndex) ?? 0; counters.set(stageIndex,index+1)
    const target=stageIndex === stageFault, id='scalar-stage-'+stageIndex+'-request-'+index
    const result=(name,args,extra=[]) => {
      issued.set(stageIndex,id)
      return {model:this.model,content:'',finishReason:'tool_calls',toolCalls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}},...extra],
        usage:{inputTokens:3,outputTokens:2,totalTokens:5},elapsedMs:0}
    }
    if (fault === 'transport' && target) throw new Error('Sensitive credential-shaped details must not be copied into reports')
    if (fault === 'cancel' && target) return {model:this.model,content:'No proposal.',toolCalls:[],finishReason:'stop'}
    const readSkipped=target && fault === 'missing-read'
    if (index === 0 && !readSkipped) return result('cad_read_geology_source',{expectedRevision:declaration.revision-(target && ['stale-read','failed-read-repaired'].includes(fault) ? 1:0),
      drawingId:target && fault === 'wrong-read' ? 'FOREIGN-RECIPE':declaration.drawingId,maxBytes:262144})
    if (target && fault === 'failed-read-repaired' && index === 1) return result('cad_read_geology_source',
      {expectedRevision:declaration.revision,drawingId:declaration.drawingId,maxBytes:262144})
    const last=receipt(messages,issued.get(stageIndex))
    if (last && !last.ok) return {model:this.model,content:'Actual native call failed; no approved edit exists.',toolCalls:[],finishReason:'stop'}
    if (last?.value?.kind) {
      assert.equal(last.value.documentId,declaration.documentId);assert.equal(last.value.revision,declaration.revision)
      assert.equal(last.value.sourceUnits,'meter');assert.ok(last.value.facts.holes.length)
    }
    if (stageIndex === 1 && index === 1 && !readSkipped) return result('cad_query_drawing',
      {expectedRevision:declaration.revision,filters:{ids:clone(declaration.remainingManualDisplacement.ids)},offset:0,layerOffset:0,limit:10,maxLayers:100,maxBytes:262144})
    if (last?.value?.entities && stageIndex === 1) assert.deepEqual(last.value.entities.map(entity => entity.id),declaration.remainingManualDisplacement.ids)
    const supplied=declaration.suppliedInputs?.confirmedMixedChanges ?? declaration.suppliedInputs?.confirmedSelectedWaterTable
    const args=stageIndex === 0 ? {expectedRevision:declaration.revision,units:supplied.drawingUnits,drawingId:declaration.drawingId,updates:clone(supplied.waterTable ?? supplied.rows)}
      : {expectedRevision:declaration.revision,...clone(declaration.remainingManualDisplacement)}
    if (stageIndex === 1) delete args.provenance
    if (target && fault === 'wrong-data') args.updates[0].stableWaterDepth+=0.25
    if (target && fault === 'extra-scalar') args.updates[0].initialWaterDepth=1.5
    if (target && fault === 'extra-array') args.uncorrelatedOccurrences=[]
    if (target && fault === 'stale-proposal') args.expectedRevision--
    if (target && fault === 'wrong-vector') args.dx++
    const name=stageIndex === 0 ? (target && fault === 'general-tool' ? 'cad_propose_geology_revision':'cad_propose_geology_scalar_revision'):'cad_propose_move'
    const extra=target && fault === 'two-proposals' ? [{id:id+'-second',type:'function',function:{name,arguments:JSON.stringify(args)}}]:[]
    return result(name,args,extra)
  }}
}

async function historyAndDxf(fixture,report) {
  const sdk=createKJDrawSDK()
  try {
    const current=await sdk.readDocument(report.finalLocalState.drawing,{format:'KJD'})
    assert.equal(state(current),state(report.evidence.afterDocument));assert.equal(current.history.undoCount,0)
    await current.restoreHistory(clone(report.finalLocalState.drawingHistory),{expectedRevision:current.revision})
    assert.equal(current.history.undoCount,report.approvals)
    const original=content(current), expected=expectedRound8ReviewedWorkflowOutcome(selected.find(s => s.id === report.scenarioId),fixture)
    assert.deepEqual(readGeologyDrawingRecipe(current,fixture.drawingId).source,expected.afterSource)
    const dxf=await sdk.readDocument(await sdk.writeDocument(current,{format:'DXF'}),{format:'DXF'})
    assert.equal(dxf.validate().valid,true)
    assert.equal(canonicalStringify(suppliedCreationDocumentSemantics(dxf)),canonicalStringify(suppliedCreationDocumentSemantics(current)))
    assert.throws(() => readGeologyDrawingRecipe(dxf,fixture.drawingId),/source|recipe|drawing/i)
    const session=new KJAgentToolSession(sdk,current,{toolProfile:PROTOCOL.toolProfile})
    // Separate native verification, not hidden work counted as model execution.
    for (const action of ['undo','redo']) {
      for (let index=0;index < report.approvals;index++) {
        const before=state(current), read=await session.call('cad_read_history',{expectedRevision:current.revision})
        assert.equal(read.ok,true)
        const proposed=await session.call('cad_propose_'+action,{expectedRevision:current.revision,units:'millimeter',targetHistoryId:read.value.history[action+'Target'].id})
        assert.equal(proposed.ok,true);assert.equal(state(current),before)
        assert.equal((await session.approve(proposed.value.planId,'public-native-history-verifier')).ok,true)
      }
      assert.deepEqual(content(current),action === 'undo' ? content(fixture.oracleBaselineDocument):original)
    }
  } finally {for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id)}
}

test('new scalar driver declares a forward-only protocol and exactly12 unchanged original questions with no old results overwritten',() => {
  assert.equal(selected.length,12);assert.equal(new Set(selected.map(s => s.id)).size,12)
  assert.equal(PROTOCOL.toolProfile,'geology-scalars-v1');assert.equal(PROTOCOL.sourceReadMaxBytes,262144)
  assert.deepEqual(PROTOCOL.budgets,{maxRequests:16,maxToolCalls:32,maxApprovals:2})
  assert.match(PROTOCOL.boundary,/forward-only/);assert.match(PROTOCOL.scoring,/legacy-general-only-verdict-retained-unmodified/)
  assert.equal(REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL_SHA256,hash(canonicalStringify(PROTOCOL)))
})
for (const scenario of selected) test('actual native scalar-profile workflow, fixture not model pass: '+scenario.id,async () => {
  const fixture=await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const requests=[],reviews=[]
    const report=await runReviewedScalarProfileChatWorkflow(scenario,{fixture,
      modelAdapter:fixtureAdapter({onRequest:(request,input) => requests.push({request,input})}),reviewProposal:input => {reviews.push(input);return true}})
    assert.equal(report.status,'completed',JSON.stringify({status:report.status,errorCode:report.errorCode,checks:report.steps.map(step => ({pending:step.pendingVerdict?.assertions.filter(a => !a.satisfied),committed:step.committedVerdict?.assertions.filter(a => !a.satisfied)}))}))
    assert.equal(report.verdict.status,'satisfied');assert.equal(report.legacyVerdict.status,'failed','general-only original verdict is preserved, not reinterpreted as old-protocol pass')
    const count=scenario.expected.intent === MIXED ? 2:1
    assert.equal(report.approvals,count);assert.equal(reviews.length,count);assert.equal(report.steps.length,count)
    assert.equal(report.requests,count === 2 ? 5:2);assert.equal(report.toolCalls,count === 2 ? 7:3)
    assert.equal(report.hostVerificationReads,count);assert.equal(report.realProviderRequests,0);assert.equal(report.modelCalls,0)
    assert.equal(report.scriptedResponseRequests,report.requests);assert.equal(report.scenarioPassed,null);assert.equal(report.scenarioExecuted,false)
    assert.equal(report.modelWorkflowPassed,null);assert.equal(report.realModelAttempted,false)
    assert.equal(report.questionSha256,hash(scenario.prompt));assert.equal(report.protocolSha256,REVIEWED_SCALAR_PROFILE_CHAT_PROTOCOL_SHA256)
    assert.equal(callerInput([{role:'user',content:report.prompts[0]}]).originalRequest,scenario.prompt)
    report.prompts.forEach((prompt,index) => assert.equal(report.promptHashes[index],hash(prompt)))
    for (const step of report.steps) {
      assert.equal(step.pendingVerdict.status,'satisfied');assert.equal(step.committedVerdict.status,'satisfied')
      assert.equal(step.toolCalls[0].name,'cad_read_geology_source');assert.equal(step.toolCalls[0].args.maxBytes,262144)
      assert.equal(step.toolCalls[0].result.value.revision,step.proposal.expectedRevision)
      assert.equal(step.toolCalls.at(-1).name,'cad_read_history')
    }
    assert.equal(report.steps[0].toolCalls[1].name,'cad_propose_geology_scalar_revision')
    assert.equal(report.steps[0].legacyPendingVerdict.status,'failed')
    assert.equal(report.steps[0].legacyCommittedVerdict.status,'failed')
    assert.deepEqual(report.unselectedFinalStates,report.unselectedInitialStates)
    assert.equal(state(fixture.document),fixture.initialState)
    assert.equal(requests[0].input.originalRequest,scenario.prompt)
    assert.deepEqual(requests[0].input.callerInputs.suppliedInputs,round8ReviewedWorkflowInputBindings(fixture).suppliedInputs)
    for (const response of report.responses) {
      assert.equal(response.modelReturned,'public-scalar-driver-fixture-not-provider')
      assert.deepEqual(response.usage,{inputTokens:3,outputTokens:2,totalTokens:5})
    }
    if (count === 2) {
      const second=requests.find(item => item.request.stageIndex === 1).input
      assert.equal(second.callerInputs.revision,fixture.initialRevision+1)
      assert.equal(Object.hasOwn(second.callerInputs,'suppliedInputs'),false)
      assert.equal(second.stagePolicy.requiredProposalToolName,'cad_propose_move')
    }
    await historyAndDxf(fixture,report)
  } finally {fixture.dispose()}
})

for (const fault of ['transport','missing-read','stale-read','wrong-read','stale-proposal','wrong-data','extra-scalar','extra-array','general-tool','two-proposals','failed-read-repaired'])
  test('strict scalar workflow rejects '+fault+' without approval, lost errors or changed document',async () => {
    const scenario=sample(HISTORICAL),fixture=await buildRound8ReviewedWorkflowFixture(scenario)
    try {
      let reviews=0
      const report=await runReviewedScalarProfileChatWorkflow(scenario,{fixture,modelAdapter:fixtureAdapter({fault}),reviewProposal:() => {reviews++;return true}})
      assert.notEqual(report.status,'completed');assert.equal(report.approvals,0);assert.equal(reviews,0)
      assert.equal(state(report.evidence.afterDocument),fixture.initialState);assert.equal(report.verdict.status,'failed')
      assert.equal(report.scenarioPassed,null);assert.deepEqual(report.unselectedFinalStates,report.unselectedInitialStates)
      assert.equal(JSON.stringify(report).includes('Sensitive credential-shaped details'),false)
      if (fault === 'extra-array') {
        const actual=report.calls.find(call => call.name === 'cad_propose_geology_scalar_revision')
        assert.equal(actual.result.ok,false);assert.match(actual.result.error.message,/unknown property/)
        assert.deepEqual(actual.args.uncorrelatedOccurrences,[]);assert.deepEqual(JSON.parse(actual.rawArguments).uncorrelatedOccurrences,[])
      }
      if (fault === 'failed-read-repaired') {
        const read=report.calls.filter(call => call.name === 'cad_read_geology_source')
        assert.equal(read.length,2);assert.equal(read[0].result.ok,false);assert.equal(read[1].result.ok,true)
        assert.equal(report.steps[0].pendingVerdict.assertions.find(a => a.id === 'every-actual-read-successful-current-and-public').satisfied,false)
      }
    } finally {fixture.dispose()}
  })

for (const fault of ['missing-read','wrong-vector','two-proposals']) test('manual second-stage '+fault+' preserves only the actual first scalar approval',async () => {
  const scenario=sample(MIXED),fixture=await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report=await runReviewedScalarProfileChatWorkflow(scenario,{fixture,modelAdapter:fixtureAdapter({fault,stageFault:1}),reviewProposal:() => true})
    assert.notEqual(report.status,'completed');assert.equal(report.approvals,1)
    assert.equal(report.evidence.afterDocument.revision,fixture.initialRevision+1)
    assert.deepEqual(report.evidence.afterDocument.getObject('CIRCLE-MANUAL'),fixture.document.getObject('CIRCLE-MANUAL'))
    assert.equal(report.steps[0].committedVerdict.status,'satisfied');assert.equal(report.verdict.status,'failed')
  } finally {fixture.dispose()}
})

for (const decision of [false,undefined,'approve',{approved:true}]) test('host approval must be exactly true, not '+JSON.stringify(decision),async () => {
  const scenario=sample(MIXED),fixture=await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report=await runReviewedScalarProfileChatWorkflow(scenario,{fixture,modelAdapter:fixtureAdapter(),reviewProposal:() => decision})
    assert.equal(report.status,'not-approved');assert.equal(report.approvals,0);assert.equal(state(report.evidence.afterDocument),fixture.initialState)
    assert.equal(report.verdict.status,'failed')
  } finally {fixture.dispose()}
})
for (const [options,approvals,code] of [[{maxRequests:1},0,'REQUEST_BUDGET_EXHAUSTED'],[{maxToolCalls:1},0,'TOOL_BUDGET_EXHAUSTED'],
  [{maxToolCalls:2},0,'TOOL_BUDGET_EXHAUSTED'],[{maxApprovals:0},0,'APPROVAL_BUDGET_EXHAUSTED'],[{maxApprovals:1},1,'APPROVAL_BUDGET_EXHAUSTED']])
  test('fixed protocol budget '+JSON.stringify(options)+' is never exceeded or overclaimed',async () => {
    const scenario=sample(MIXED),fixture=await buildRound8ReviewedWorkflowFixture(scenario)
    try {
      const report=await runReviewedScalarProfileChatWorkflow(scenario,{fixture,modelAdapter:fixtureAdapter(),reviewProposal:() => true,...options})
      assert.equal(report.status,'budget-exhausted');assert.equal(report.errorCode,code);assert.equal(report.approvals,approvals)
      assert.ok(report.requests <= report.budgets.maxRequests);assert.ok(report.toolCalls <= report.budgets.maxToolCalls)
      assert.equal(report.evidence.afterDocument.revision,fixture.initialRevision+approvals);assert.equal(report.verdict.status,'failed')
    } finally {fixture.dispose()}
  })

test('the independent scalar oracle strictly rejects receipt/preview/history/complete-source tampering',async () => {
  const scenario=sample(HISTORICAL),fixture=await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report=await runReviewedScalarProfileChatWorkflow(scenario,{fixture,modelAdapter:fixtureAdapter(),reviewProposal:() => true}), step=report.steps[0]
    assert.equal(report.status,'completed')
    const variants=[
      {...step,hostApprovalApplied:false},
      {...step,approvedPlanId:'foreign'},
      {...step,approval:{...step.approval,planId:'foreign'}},
      {...step,approval:{...step.approval,status:'pending'}},
      {...step,proposal:{...step.proposal,preview:{...step.proposal.preview,after:step.proposal.preview.after.slice(1)}}},
      {...step,proposal:{...step.proposal,unchangedIds:step.proposal.unchangedIds.slice(1)}},
      {...step,toolCalls:step.toolCalls.filter(call => call.name !== 'cad_read_history')},
      {...step,toolCalls:step.toolCalls.map(call => call.name === 'cad_read_geology_source' ? {...call,args:{...call.args,expectedRevision:call.args.expectedRevision-1}}:call)},
    ]
    for (const evidence of variants) assert.equal(evaluateReviewedScalarProfileStep(scenario,fixture,0,evidence).status,'failed')
    const changed=step.afterDocument.fork()
    const sdk=createKJDrawSDK();sdk.attachDocument(changed)
    try {await sdk.executeCommand('MOVE',{ids:['CIRCLE-MANUAL'],dx:1,dy:1},{document:changed})}
    finally {sdk.closeDocument(changed.id)}
    assert.equal(evaluateReviewedScalarProfileStep(scenario,fixture,0,{...step,afterDocument:changed}).status,'failed')
    assert.equal(evaluateReviewedScalarProfileWorkflow(scenario,fixture,{...report.evidence,steps:[],afterDocument:changed}).status,'failed')
  } finally {fixture.dispose()}
})

test('public input frame and question hash expose no detached gold and require actual prior approval before stage2',async () => {
  const scenario=sample(MIXED),fixture=await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const input=reviewedScalarProfileStageInputs(scenario,fixture,0,{revision:fixture.initialRevision}),frame=frameReviewedScalarProfileStage(input)
    assert.equal(callerInput([{role:'user',content:frame}]).originalRequest,scenario.prompt)
    assert.deepEqual(input.callerInputs.suppliedInputs,fixture.suppliedInputs)
    for (const field of ['beforeContent','afterContent','unchangedIds','afterSource','afterUndoCount','expectedOutcome','oracleExpected']) assert.equal(frame.includes('"'+field+'"'),false)
    assert.equal(input.requiredNativeReadContract.requiredToolCalls[0].arguments.maxBytes,262144)
    assert.throws(() => reviewedScalarProfileStageInputs(scenario,fixture,1,{revision:fixture.initialRevision}),/actual first host commit/)
    assert.ok(frame.length < 16000)
  } finally {fixture.dispose()}
})

test('caller cannot disable profile, omit classified adapter/review or raise fixed public budgets',async () => {
  await assert.rejects(runReviewedScalarProfileChatWorkflow(sample(MIXED),{modelAdapter:{call(){}},reviewProposal:() => true}),/classified/)
  await assert.rejects(runReviewedScalarProfileChatWorkflow(sample(MIXED),{modelAdapter:fixtureAdapter()}),/review callback/)
  for (const limits of [{maxRequests:17},{maxToolCalls:33},{maxApprovals:3}])
    await assert.rejects(runReviewedScalarProfileChatWorkflow(sample(MIXED),{modelAdapter:fixtureAdapter(),reviewProposal:() => true,...limits}),/fixed public/)
  const unsupported=corpus.scenarios.find(s => s.expected.intent === 'batch-historical-workflow.repeated-edit-archive-reopen')
  await assert.rejects(runReviewedScalarProfileChatWorkflow(unsupported,{modelAdapter:fixtureAdapter(),reviewProposal:() => true}),/No scalar-profile/)
})
