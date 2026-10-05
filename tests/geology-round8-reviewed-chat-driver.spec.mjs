import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { ROUND8_REVIEWED_CHAT_PROTOCOL, round8ReviewedChatStageInputs,
  frameRound8ReviewedChatStage, runRound8ReviewedChatWorkflow } from '../scripts/testing/helpers/geology-round8-reviewed-chat-driver.mjs'
import { ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS, buildRound8ReviewedWorkflowFixture,
  round8ReviewedWorkflowInputBindings, expectedRound8ReviewedWorkflowOutcome,
  evaluateRound8ReviewedWorkflowOracle } from '../scripts/testing/helpers/geology-round8-reviewed-workflow-oracles.mjs'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { suppliedCreationDocumentSemantics } from '../scripts/testing/helpers/geology-supplied-creation-oracles.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const selected = corpus.scenarios.filter(s => ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS.includes(s.id) &&
  ROUND8_REVIEWED_CHAT_PROTOCOL.supportedIntents.includes(s.expected.intent))
const MIXED = ROUND8_REVIEWED_CHAT_PROTOCOL.supportedIntents[0]
const HISTORICAL = ROUND8_REVIEWED_CHAT_PROTOCOL.supportedIntents[1]
const sample = intent => selected.find(s => s.expected.intent === intent && s.id.endsWith('-zh-direct'))
const clone = structuredClone
const state = document => canonicalStringify(document.snapshot())
function completeContent(document) {
  const { revision, revisions, metadata, ...rest } = document.snapshot()
  return { ...rest, metadata: { ...metadata, modifiedAt: null } }
}
function callerInput(messages) {
  const current = messages.filter(message => message.role === 'user' &&
    typeof message.content === 'string' && message.content.includes(ROUND8_REVIEWED_CHAT_PROTOCOL.inputStart)).at(-1).content
  const begin = current.lastIndexOf(ROUND8_REVIEWED_CHAT_PROTOCOL.inputStart)
  const end = current.indexOf(ROUND8_REVIEWED_CHAT_PROTOCOL.inputEnd, begin)
  assert.ok(begin >= 0 && end > begin)
  return JSON.parse(current.slice(begin + ROUND8_REVIEWED_CHAT_PROTOCOL.inputStart.length, end))
}
function toolReceipt(messages, id) {
  const item = messages.find(message => message.role === 'tool' && message.tool_call_id === id)
  return item ? JSON.parse(item.content) : null
}

/** Deliberately scripted fixture adapter. It consumes caller inputs and actual
 * native tool messages, never fixture instances or detached expected outputs.
 * Its successful transport requests must never be counted as model passes.
 */
function fixtureAdapter({ fault, stageFault = 0, onRequest = () => {} } = {}) {
  const counters = new Map(), issued = new Map()
  return { origin: 'fixture-oracle-selftest', model: 'public-scripted-reviewed-chat-fixture',
    async call(request) {
      const { messages, settings, stageIndex } = request
      const input = callerInput(messages), declaration = input.callerInputs
      onRequest(request, input)
      const index = counters.get(stageIndex) ?? 0
      counters.set(stageIndex, index + 1)
      if (fault === 'transport' && stageIndex === stageFault) throw new Error('Sensitive transport details must not be echoed')
      const id = `round8-stage-${stageIndex}-response-${index}`
      const result = (name, args, extra = []) => {
        assert.ok(settings.tools.some(tool => tool.function.name === name), `${name} must be offered by the real host`)
        issued.set(stageIndex, id)
        return { model: this.model, content: '', finishReason: 'tool_calls',
          toolCalls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ...extra],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, elapsedMs: 0 }
      }
      if (fault === 'ambiguity' && stageIndex === stageFault)
        return { model: this.model, content: 'The requested identity is ambiguous; clarify without changing the drawing.', toolCalls: [], finishReason: 'stop' }
      const targetStageFault = stageIndex === stageFault
      if (index === 0 && !(fault === 'omit-source-read' && targetStageFault))
        return result('cad_read_geology_source', { expectedRevision: declaration.revision,
          drawingId: declaration.drawingId, maxBytes: 262144 })
      const last = toolReceipt(messages, issued.get(stageIndex))
      if (last && !last.ok) return { model: this.model, content: 'The native operation failed; no changes were approved.', toolCalls: [], finishReason: 'stop' }
      if (last?.value?.kind) {
        assert.equal(last.value.documentId, declaration.documentId)
        assert.equal(last.value.revision, declaration.revision)
        assert.equal(last.value.sourceUnits, 'meter')
        assert.ok(last.value.facts.holes.length)
      }
      if (stageIndex === 1 && index === 1)
        return result('cad_query_drawing', { expectedRevision: declaration.revision,
          filters: { ids: clone(declaration.remainingManualDisplacement.ids) }, offset: 0, layerOffset: 0,
          limit: 10, maxLayers: 100, maxBytes: 262144 })
      if (last?.value?.entities && stageIndex === 1) {
        assert.equal(last.value.revision, declaration.revision)
        assert.deepEqual(last.value.entities.map(entity => entity.id), declaration.remainingManualDisplacement.ids)
      }
      const declared = declaration.suppliedInputs?.confirmedMixedChanges ?? declaration.suppliedInputs?.confirmedSelectedWaterTable
      const args = stageIndex === 0
        ? { expectedRevision: declaration.revision, drawingId: declaration.drawingId,
          units: declared.drawingUnits, updates: clone(declared.waterTable ?? declared.rows) }
        : { expectedRevision: declaration.revision, ...clone(declaration.remainingManualDisplacement) }
      if (stageIndex === 1) delete args.provenance
      if (fault === 'stale-revision' && targetStageFault) args.expectedRevision--
      if (fault === 'foreign-drawing' && targetStageFault)
        args.drawingId = declaration.suppliedInputs.selectedHistoricalContext.unselectedDocuments[0].drawingId + '-foreign'
      if (fault === 'wrong-data' && targetStageFault) args.updates[0].stableWaterDepth += 0.25
      if (fault === 'wrong-vector' && targetStageFault) args.dx += 1
      if (fault === 'foreign-document-field' && targetStageFault)
        args.documentId = declaration.suppliedInputs.selectedHistoricalContext.unselectedDocuments[0].documentId
      const name = stageIndex === 0 ? 'cad_propose_geology_revision' : 'cad_propose_move'
      const additional = fault === 'two-proposals' && targetStageFault
        ? [{ id: `${id}-second`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] : []
      return result(name, args, additional)
    } }
}

async function actualHistoryAndArchiveChecks(fixture, report) {
  const sdk = createKJDrawSDK()
  try {
    const current = await sdk.readDocument(report.finalLocalState.drawing, { format: 'KJD' })
    assert.equal(state(current), state(report.evidence.afterDocument))
    assert.equal(current.history.undoCount, 0, 'KJD alone does not claim session-history retention')
    await current.restoreHistory(clone(report.finalLocalState.drawingHistory), { expectedRevision: current.revision })
    assert.equal(current.history.undoCount, report.approvals)
    const original = completeContent(current)
    const source = clone(readGeologyDrawingRecipe(current, fixture.drawingId).source)
    const expected = expectedRound8ReviewedWorkflowOutcome(selected.find(s => s.id === report.scenarioId), fixture)
    assert.deepEqual(source, expected.afterSource)
    const dxf = await sdk.readDocument(await sdk.writeDocument(current, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(dxf.validate().valid, true)
    assert.equal(canonicalStringify(suppliedCreationDocumentSemantics(dxf)), canonicalStringify(suppliedCreationDocumentSemantics(current)),
      'all actual physical geometry, handles, HATCH loops/patterns, text, owner and resources are compared')
    assert.throws(() => readGeologyDrawingRecipe(dxf, fixture.drawingId), /source|recipe|drawing/i)
    const session = new KJAgentToolSession(sdk, current)
    // History probes are separately declared native selftests, not hidden
    // commands executed on behalf of the workflow's model.
    for (const action of ['undo', 'redo']) {
      for (let index = 0; index < report.approvals; index++) {
        const before = state(current)
        const history = await session.call('cad_read_history', { expectedRevision: current.revision })
        assert.equal(history.ok, true)
        const proposed = await session.call(`cad_propose_${action}`, { expectedRevision: current.revision,
          units: 'millimeter', targetHistoryId: history.value.history[`${action}Target`].id })
        assert.equal(proposed.ok, true)
        assert.equal(state(current), before, 'native history proposal cannot edit before review')
        const receipt = await session.approve(proposed.value.planId, 'explicit-public-history-selftest-reviewer')
        assert.equal(receipt.ok, true)
        const committed = state(current)
        assert.equal((await session.approve(proposed.value.planId, 'explicit-public-history-selftest-reviewer')).ok, false)
        assert.equal(state(current), committed, 'consumed native approval must not replay')
      }
      if (action === 'undo') assert.deepEqual(completeContent(current), completeContent(fixture.oracleBaselineDocument))
      else assert.deepEqual(completeContent(current), original)
    }
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
}

test('standalone R8 reviewed-chat protocol supports exactly 12 unchanged originals, not staging/refresh', () => {
  assert.equal(selected.length, 12)
  assert.equal(new Set(selected.map(s => s.id)).size, 12)
  assert.equal(ROUND8_REVIEWED_CHAT_PROTOCOL.workflowBoundary.includes('no browser-refresh claim'), true)
})

for (const scenario of selected) test(`actual native reviewed-chat fixture workflow, no model pass: ${scenario.id}`, async () => {
  const fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const decisions = [], requests = []
    const report = await runRound8ReviewedChatWorkflow(scenario, { fixture,
      modelAdapter: fixtureAdapter({ onRequest: (request, input) => requests.push({ request, input }) }),
      reviewProposal: item => { decisions.push(item); return true } })
    assert.equal(report.status, 'completed', JSON.stringify({ status: report.status, errorCode: report.errorCode,
      calls: report.calls.map(call => ({ name: call.name, args: call.args, ok: call.result?.ok, error: call.result?.error })) }))
    assert.equal(report.verdict.status, 'satisfied', JSON.stringify(report.verdict.assertions.filter(a => !a.satisfied)))
    const count = scenario.expected.intent === MIXED ? 2 : 1
    assert.equal(report.approvals, count)
    assert.equal(report.steps.length, count)
    assert.equal(decisions.length, count)
    assert.deepEqual(decisions.map(item => item.currentRevision), Array.from({ length: count }, (_, index) => fixture.initialRevision + index))
    for (const step of report.steps) {
      assert.equal(step.pendingVerdict.status, 'satisfied')
      assert.equal(step.committedVerdict.status, 'satisfied')
      assert.equal(step.toolCalls[0].name, 'cad_read_geology_source')
      assert.equal(step.toolCalls[0].args.expectedRevision, step.proposal.expectedRevision)
      assert.equal(step.toolCalls[0].result.value.revision, step.proposal.expectedRevision)
      assert.equal(step.toolCalls.at(-1).name, 'cad_read_history')
    }
    assert.equal(report.realProviderRequests, 0)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.scriptedResponseRequests, count === 2 ? 5 : 2)
    assert.equal(report.requests, report.scriptedResponseRequests)
    assert.equal(report.toolCalls, count === 2 ? 7 : 3)
    assert.equal(report.hostVerificationReads, count)
    assert.equal(report.scenarioPassed, null)
    assert.equal(report.scenarioExecuted, false)
    assert.equal(report.realModelAttempted, false)
    assert.equal(report.modelWorkflowPassed, null)
    assert.equal(report.verdict.hostActionsVerified, true, 'actual host workflow is tested but not called a real model pass')
    assert.deepEqual(report.unselectedFinalStates, report.unselectedInitialStates)
    assert.equal(state(fixture.document), fixture.initialState, 'the runtime uses actual assigned KJD independently; source fixture stays immutable')
    assert.equal(requests[0].input.originalRequest, scenario.prompt)
    assert.deepEqual(requests[0].input.callerInputs.suppliedInputs, round8ReviewedWorkflowInputBindings(fixture).suppliedInputs)
    if (count === 2) {
      const second = requests.find(item => item.request.stageIndex === 1).input
      assert.equal(second.callerInputs.revision, fixture.initialRevision + 1)
      assert.equal(second.actualPreviousHostApproval.status, 'committed')
      assert.deepEqual(second.callerInputs.remainingManualDisplacement.ids, fixture.suppliedInputs.confirmedMixedChanges.manualDisplacement.ids)
      assert.equal(Object.hasOwn(second.callerInputs, 'suppliedInputs'), false, 'completed source changes are not silently replayed in the remaining manual task')
    } else {
      const context = requests[0].input.callerInputs.suppliedInputs.selectedHistoricalContext
      assert.equal(context.selectedDocumentId, fixture.document.id)
      assert.notEqual(context.selectedDocumentId, context.unselectedDocuments[0].documentId)
      assert.equal(context.unselectedDocuments[0].approvalGranted, false)
    }
    await actualHistoryAndArchiveChecks(fixture, report)
  } finally { fixture.dispose() }
})

for (const fault of ['transport', 'ambiguity', 'stale-revision', 'foreign-drawing', 'foreign-document-field', 'wrong-data', 'two-proposals', 'omit-source-read'])
  test(`R8 real runtime refuses ${fault} without approval or changed native state`, async () => {
    const scenario = sample(HISTORICAL), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
    try {
      let reviews = 0
      const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, modelAdapter: fixtureAdapter({ fault }),
        reviewProposal: () => { reviews++; return true } })
      assert.notEqual(report.status, 'completed')
      assert.equal(report.approvals, 0)
      assert.equal(reviews, 0)
      assert.equal(state(report.evidence.afterDocument), fixture.initialState)
      assert.deepEqual(report.unselectedFinalStates, report.unselectedInitialStates)
      assert.equal(report.scenarioPassed, null)
      assert.equal(report.verdict.status, 'failed')
      assert.equal(JSON.stringify(report).includes('Sensitive transport details'), false)
    } finally { fixture.dispose() }
  })

for (const decision of [false, undefined, 'approve', { approved: true }])
  test(`explicit approval is exactly true, not ${JSON.stringify(decision)}`, async () => {
    const scenario = sample(MIXED), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
    try {
      const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, modelAdapter: fixtureAdapter(), reviewProposal: () => decision })
      assert.equal(report.status, 'not-approved')
      assert.equal(report.steps.length, 1)
      assert.equal(report.approvals, 0)
      assert.equal(report.requests, 2)
      assert.equal(state(report.evidence.afterDocument), fixture.initialState)
    } finally { fixture.dispose() }
  })

test('second review refusal leaves only the actual first approval, not a compound success', async () => {
  const scenario = sample(MIXED), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, modelAdapter: fixtureAdapter(), reviewProposal: ({ stageIndex }) => stageIndex === 0 })
    assert.equal(report.status, 'not-approved')
    assert.equal(report.approvals, 1)
    assert.equal(report.evidence.afterDocument.revision, fixture.initialRevision + 1)
    assert.equal(report.steps[0].committedVerdict.status, 'satisfied')
    assert.equal(report.steps[1].pendingVerdict.status, 'satisfied')
    assert.equal(report.verdict.status, 'failed')
    assert.deepEqual(report.evidence.afterDocument.getObject('CIRCLE-MANUAL').payload, fixture.document.getObject('CIRCLE-MANUAL').payload)
  } finally { fixture.dispose() }
})

test('missing second-stage reread is rejected despite a correctly computed manual proposal', async () => {
  const scenario = sample(MIXED), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, modelAdapter: fixtureAdapter({ fault: 'omit-source-read', stageFault: 1 }), reviewProposal: () => true })
    assert.equal(report.approvals, 1)
    assert.notEqual(report.status, 'completed')
    assert.equal(report.verdict.status, 'failed')
    assert.equal(report.evidence.afterDocument.revision, fixture.initialRevision + 1)
  } finally { fixture.dispose() }
})

for (const fault of ['transport', 'stale-revision', 'wrong-vector', 'two-proposals'])
  test(`second-stage ${fault} cannot undo, repeat or overclaim the first reviewed commit`, async () => {
    const scenario = sample(MIXED), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
    try {
      const report = await runRound8ReviewedChatWorkflow(scenario, { fixture,
        modelAdapter: fixtureAdapter({ fault, stageFault: 1 }), reviewProposal: () => true })
      assert.notEqual(report.status, 'completed')
      assert.equal(report.approvals, 1)
      assert.equal(report.evidence.afterDocument.revision, fixture.initialRevision + 1)
      assert.equal(report.steps[0].committedVerdict.status, 'satisfied')
      assert.deepEqual(report.evidence.afterDocument.getObject('CIRCLE-MANUAL').payload, fixture.document.getObject('CIRCLE-MANUAL').payload)
      assert.equal(report.verdict.status, 'failed')
    } finally { fixture.dispose() }
  })

for (const when of ['before-send', 'during-adapter']) test(`external cancellation ${when} stops the actual runtime without edits`, async () => {
  const scenario = sample(MIXED), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  const controller = new AbortController()
  if (when === 'before-send') controller.abort()
  try {
    const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, signal: controller.signal,
      modelAdapter: fixtureAdapter({ onRequest: () => controller.abort() }), reviewProposal: () => true })
    assert.equal(report.status, 'cancelled')
    assert.equal(report.approvals, 0)
    assert.equal(report.toolCalls, 0)
    assert.equal(report.requests, when === 'before-send' ? 0 : 1)
    assert.equal(state(report.evidence.afterDocument), fixture.initialState)
  } finally { fixture.dispose() }
})

test('review callback receives a detached proposal copy, not authority to tamper native approved arguments', async () => {
  const scenario = sample(HISTORICAL), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, modelAdapter: fixtureAdapter(),
      reviewProposal: ({ proposal }) => { proposal.expectedRevision = -1; proposal.planId = 'foreign'; return true } })
    assert.equal(report.status, 'completed')
    assert.equal(report.verdict.status, 'satisfied')
    assert.equal(report.approvals, 1)
    assert.notEqual(report.steps[0].approvedPlanId, 'foreign')
    await actualHistoryAndArchiveChecks(fixture, report)
  } finally { fixture.dispose() }
})

for (const [budget, options, approvals, code] of [
  ['request', { maxRequests: 1 }, 0, 'REQUEST_BUDGET_EXHAUSTED'],
  ['native read/propose', { maxToolCalls: 1 }, 0, 'TOOL_BUDGET_EXHAUSTED'],
  ['reserved history read', { maxToolCalls: 2 }, 0, 'TOOL_BUDGET_EXHAUSTED'],
  ['approval', { maxApprovals: 0 }, 0, 'APPROVAL_BUDGET_EXHAUSTED'],
  ['second approval', { maxApprovals: 1 }, 1, 'APPROVAL_BUDGET_EXHAUSTED'],
]) test(`R8 ${budget} budget never silently exceeds authorized work`, async () => {
  const scenario = sample(MIXED), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, modelAdapter: fixtureAdapter(), reviewProposal: () => true, ...options })
    assert.equal(report.status, 'budget-exhausted')
    assert.equal(report.errorCode, code)
    assert.equal(report.approvals, approvals)
    assert.ok(report.requests <= report.budgets.maxRequests)
    assert.ok(report.toolCalls <= report.budgets.maxToolCalls)
    assert.ok(report.approvals <= report.budgets.maxApprovals)
    assert.equal(report.evidence.afterDocument.revision, fixture.initialRevision + approvals)
    assert.equal(report.verdict.status, 'failed')
  } finally { fixture.dispose() }
})

test('review callback exceptions do not approve a valid model proposal', async () => {
  const scenario = sample(HISTORICAL), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, modelAdapter: fixtureAdapter(), reviewProposal: () => { throw new Error('private host detail') } })
    assert.equal(report.status, 'review-failed')
    assert.equal(report.errorCode, 'HOST_REVIEW_CALLBACK_FAILED')
    assert.equal(report.approvals, 0)
    assert.equal(state(report.evidence.afterDocument), fixture.initialState)
    assert.equal(JSON.stringify(report).includes('private host detail'), false)
  } finally { fixture.dispose() }
})

test('future provider interface requires explicit evidence origin and rejects wrong or unsupported fixtures', async () => {
  await assert.rejects(runRound8ReviewedChatWorkflow(sample(MIXED), { modelAdapter: { call() {} }, reviewProposal: () => true }), /classified/)
  await assert.rejects(runRound8ReviewedChatWorkflow(sample(MIXED), { modelAdapter: fixtureAdapter() }), /review callback/)
  await assert.rejects(runRound8ReviewedChatWorkflow(sample(MIXED), { modelAdapter: fixtureAdapter(), reviewProposal: () => true, maxRequests: 1000 }), /bounded/)
  const unsupported = corpus.scenarios.find(s => s.expected.intent === 'batch-historical-workflow.repeated-edit-archive-reopen')
  await assert.rejects(runRound8ReviewedChatWorkflow(unsupported, { modelAdapter: fixtureAdapter(), reviewProposal: () => true }), /No reviewed-chat/)
  const fixture = await buildRound8ReviewedWorkflowFixture(sample(HISTORICAL))
  try {
    await assert.rejects(runRound8ReviewedChatWorkflow(sample(MIXED), { fixture, modelAdapter: fixtureAdapter(), reviewProposal: () => true }), /does not match/)
    assert.throws(() => round8ReviewedChatStageInputs(sample(MIXED), fixture, 1, { revision: fixture.initialRevision }), /actual first host commit/)
  } finally { fixture.dispose() }
})

test('public stage frame contains exact caller facts but no independent expected entity projection', async () => {
  const scenario = sample(MIXED), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const input = round8ReviewedChatStageInputs(scenario, fixture, 0, { revision: fixture.initialRevision })
    const frame = frameRound8ReviewedChatStage(input)
    assert.equal(callerInput([{ role: 'user', content: frame }]).originalRequest, scenario.prompt)
    assert.deepEqual(input.callerInputs.suppliedInputs, fixture.suppliedInputs)
    for (const privateOracleField of ['beforeContent', 'afterContent', 'unchangedIds', 'afterSource', 'afterUndoCount'])
      assert.equal(frame.includes(`"${privateOracleField}"`), false)
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { origin: 'fixture-oracle-selftest', afterDocument: fixture.document }).status, 'failed')
  } finally { fixture.dispose() }
})
