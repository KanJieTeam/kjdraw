import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { ROUND8_REVIEWED_WORKFLOW_DESCRIPTORS, ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS, ROUND8_TEN_REVIEWED_CHANGES,
  assessRound8ReviewedWorkflowReadiness, round8ReviewedWorkflowDescriptor, round8ReviewedWorkflowCallerInputs,
  buildRound8ReviewedWorkflowFixture, round8ReviewedWorkflowInputBindings, expectedRound8ReviewedWorkflowOutcome,
  evaluateRound8ReviewedStepOracle, evaluateRound8ReviewedWorkflowOracle,
  verifyRound8ArchiveArtifacts } from '../scripts/testing/helpers/geology-round8-reviewed-workflow-oracles.mjs'
import { suppliedCreationDocumentSemantics } from '../scripts/testing/helpers/geology-supplied-creation-oracles.mjs'
import { round6SourceWorkflowPhysicalGeometryMatches } from '../scripts/testing/helpers/geology-round6-source-workflow-oracles.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const byId = new Map(corpus.scenarios.map(item => [item.id, item]))
const clone = structuredClone
const signature = document => canonicalStringify(document.snapshot())
const content = document => {
  const { revision, revisions, metadata, ...s } = document.snapshot()
  return { ...s, metadata: { ...metadata, modifiedAt: null } }
}
const MIXED = 'source-section.mixed-source-and-manual-edit'
const SELECTED = 'batch-historical-workflow.selected-historical-source-revision'
const STAGING = 'batch-historical-workflow.batch-distinct-drawings-staging'
const ARCHIVE = 'batch-historical-workflow.repeated-edit-archive-reopen'
const sample = intent => corpus.scenarios.find(item => item.expected.intent === intent && item.id.endsWith('-zh-direct'))
const failed = verdict => JSON.stringify(verdict.assertions.filter(item => !item.satisfied))
function traceFor(fixture, document = fixture.document) {
  const session = new KJAgentToolSession(fixture.sdk, document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}
async function proposeStep(fixture, trace, index, mutate = () => {}) {
  const revision = fixture.document.revision
  await trace.call('cad_read_geology_source', { expectedRevision: revision, drawingId: fixture.drawingId, maxBytes: 262144 })
  let name, args
  if (index === 0) {
    name = 'cad_propose_geology_revision'
    args = { expectedRevision: revision, drawingId: fixture.drawingId, units: 'millimeter',
      updates: clone(fixture.suppliedInputs.confirmedMixedChanges?.waterTable ?? fixture.suppliedInputs.confirmedSelectedWaterTable.rows) }
  } else {
    await trace.call('cad_read_drawing', {})
    name = 'cad_propose_move'
    args = { expectedRevision: revision, units: 'millimeter', ...clone(fixture.suppliedInputs.confirmedMixedChanges.manualDisplacement) }
  }
  mutate(args)
  return trace.call(name, args)
}
async function commitStep(fixture, trace, proposal, beforeState) {
  const approval = await trace.session.approve(proposal.planId, 'round8-native-workflow-selftest-reviewer')
  assert.equal(approval.ok, true, JSON.stringify(approval.error))
  await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
  const fingerprint = fixture.document.fingerprint()
  assert.equal((await trace.session.approve(proposal.planId, 'round8-native-workflow-selftest-reviewer')).ok, false)
  assert.equal(fixture.document.fingerprint(), fingerprint)
  return { phase: 'committed', toolCalls: trace.calls, proposal, approval, approvedPlanId: proposal.planId,
    beforeState, afterDocument: fixture.document.fork() }
}
async function archivedEvidence(fixture) {
  const trace = traceFor(fixture)
  await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 })
  await trace.call('cad_read_history', { expectedRevision: fixture.initialRevision })
  const kjdBytes = await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })
  const dxfBytes = await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' })
  const historyArchive = fixture.document.exportHistory({ limit: 20, maxBytes: 16777216 })
  const archiveVerification = await verifyRound8ArchiveArtifacts(fixture, { kjdBytes, dxfBytes, historyArchive })
  return { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls, archiveVerification,
    answer: { archiveFormats: { KJD: 'native-source-backup', DXF: 'graphics-exchange-no-native-source', history: 'separate-local-history-archive' } } }
}
async function historyAction(fixture, trace, action) {
  const history = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
  const proposal = await trace.call(`cad_propose_${action}`, { expectedRevision: fixture.document.revision, units: 'millimeter',
    targetHistoryId: history.history[`${action}Target`].id })
  assert.equal((await trace.session.approve(proposal.planId, 'round8-real-history-selftest-reviewer')).ok, true)
}
async function assertRoundTrips(fixture, document, expectedSource) {
  const verifier = createKJDrawSDK()
  try {
    const reopened = await verifier.readDocument(await fixture.sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
    assert.equal(signature(reopened), signature(document))
    assert.deepEqual(readGeologyDrawingRecipe(reopened, fixture.drawingId).source, expectedSource)
    const dxf = await verifier.readDocument(await fixture.sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(dxf.validate().valid, true)
    assert.equal(canonicalStringify(suppliedCreationDocumentSemantics(dxf)), canonicalStringify(suppliedCreationDocumentSemantics(document)),
      'complete native physical entity/handle/HATCH/style/owner/resource semantics must survive actual DXF, not just counts')
    assert.throws(() => readGeologyDrawingRecipe(dxf, fixture.drawingId), /source|recipe|drawing/i)
  } finally { for (const id of [...verifier.documents.keys()]) verifier.closeDocument(id) }
}

test('Round8 prepares only 24 unchanged original IDs and explicitly leaves missing host drivers not-ready', () => {
  assert.equal(ROUND8_REVIEWED_WORKFLOW_DESCRIPTORS.length, 4)
  assert.equal(ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS.length, 24)
  assert.equal(new Set(ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS).size, 24)
  assert.equal(new Set(ROUND8_REVIEWED_WORKFLOW_DESCRIPTORS.map(item => item.fixtureBranch)).size, 4)
  for (const descriptor of ROUND8_REVIEWED_WORKFLOW_DESCRIPTORS) {
    assert.equal(ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS.filter(id => byId.get(id).expected.intent === descriptor.intent).length, 6)
    const readiness = assessRound8ReviewedWorkflowReadiness(sample(descriptor.intent))
    assert.equal(readiness.nativeFixtureAndOracleReady, true)
    assert.equal(readiness.status, 'not-ready')
    assert.deepEqual(readiness.missingHostActions, descriptor.requiredHostActions)
    assert.equal(readiness.scenarioPassed, null)
    assert.equal(readiness.modelCalls, 0)
    assert.equal(assessRound8ReviewedWorkflowReadiness(sample(descriptor.intent), { availableActions: descriptor.requiredHostActions }).status, 'runnable')
  }
  const missing = sample('investigation-preparation.required-field-completeness')
  assert.equal(assessRound8ReviewedWorkflowReadiness(missing).status, 'not-ready')
  const extra = clone(sample(MIXED)); extra.prerequisites.push('source:unknown-collar')
  assert.equal(assessRound8ReviewedWorkflowReadiness(extra, { availableActions: ROUND8_REVIEWED_WORKFLOW_DESCRIPTORS[0].requiredHostActions }).status, 'not-ready')
})

for (const id of ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS) test(`Round8 native reviewed-workflow fixture selftest, no model pass: ${id}`, async () => {
  const scenario = byId.get(id), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const descriptor = round8ReviewedWorkflowDescriptor(scenario), gold = expectedRound8ReviewedWorkflowOutcome(scenario, fixture)
    const bindings = round8ReviewedWorkflowInputBindings(fixture)
    assert.equal(fixture.fixtureBranch, descriptor.fixtureBranch)
    assert.equal(fixture.modelCalls, 0); assert.equal(fixture.scenarioExecuted, false)
    assert.doesNotMatch(JSON.stringify(bindings), /"afterContent"|"beforeContent"|"preview"|"afterSource"|"gold"|"commandArgs"/)
    assert.equal(fixture.conversationSeed.length, ['followup', 'correction'].includes(scenario.interaction) ? 1 : 0)
    if (descriptor.kind === 'source' || descriptor.kind === 'mixed') {
      const beforeContent = clone(content(fixture.document)), steps = [], trace = traceFor(fixture)
      for (let index = 0; index < gold.steps.length; index++) {
        const beforeState = signature(fixture.document), proposal = await proposeStep(fixture, trace, index)
        const pending = evaluateRound8ReviewedStepOracle(scenario, fixture, index, { origin: 'fixture-oracle-selftest',
          phase: 'pending', toolCalls: trace.calls, proposal, afterDocument: fixture.document })
        assert.equal(pending.status, 'satisfied', failed(pending))
        assert.equal(pending.scenarioPassed, null); assert.equal(pending.completeWorkflow, false)
        assert.equal(signature(fixture.document), beforeState)
        const step = await commitStep(fixture, trace, proposal, beforeState)
        const complete = evaluateRound8ReviewedStepOracle(scenario, fixture, index, { origin: 'fixture-oracle-selftest', ...step })
        assert.equal(complete.status, 'satisfied', failed(complete))
        steps.push(step)
        assert.deepEqual(content(fixture.document), gold.steps[index].afterContent)
        assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, gold.steps[index].afterSource)
        await assertRoundTrips(fixture, fixture.document, gold.steps[index].afterSource)
      }
      const verdict = evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { origin: 'fixture-oracle-selftest', steps,
        reviewPolicy: fixture.suppliedInputs.confirmedMixedChanges?.reviewPolicy, afterDocument: fixture.document })
      assert.equal(verdict.status, 'satisfied', failed(verdict))
      assert.equal(verdict.scenarioPassed, null); assert.equal(verdict.hostActionsVerified, false)
      assert.deepEqual(fixture.document.getObject('NOTE-MANUAL'), beforeContent.objects['NOTE-MANUAL'])
      if (descriptor.kind === 'source') {
        for (const member of fixture.unselectedWorkspaceMembers) assert.equal(signature(member.document), member.initialState)
        assert.equal(fixture.unselectedWorkspaceMembers[0].source.input.holes[0].id, 'TEST-A')
        assert.notEqual(fixture.unselectedWorkspaceMembers[0].document.id, fixture.document.id)
      } else assert.deepEqual(fixture.document.getObject('CIRCLE-MANUAL').payload.center, [100, 90, 0])
      for (let index = gold.steps.length - 1; index >= 0; index--) {
        await historyAction(fixture, trace, 'undo')
        assert.deepEqual(content(fixture.document), gold.steps[index].beforeContent)
      }
      assert.deepEqual(content(fixture.document), beforeContent)
      for (let index = 0; index < gold.steps.length; index++) {
        await historyAction(fixture, trace, 'redo')
        assert.deepEqual(content(fixture.document), gold.steps[index].afterContent)
      }
      await assertRoundTrips(fixture, fixture.document, gold.afterSource)
    } else if (descriptor.kind === 'read') {
      const calls = []
      for (const member of fixture.workspaceMembers) {
        const trace = traceFor(fixture, member.document)
        const list = await trace.call('cad_read_geology_source', { expectedRevision: member.document.revision, drawingId: '', maxBytes: 262144 })
        assert.deepEqual(list.drawingIds, [member.drawingId])
        await trace.call('cad_read_geology_source', { expectedRevision: member.document.revision, drawingId: member.drawingId, maxBytes: 262144 })
        calls.push(...trace.calls)
        await assertRoundTrips({ ...fixture, drawingId: member.drawingId }, member.document, member.source)
      }
      const answer = { batchPlan: { drawings: gold.stagingRows,
        batches: [0, 10, 20].map(offset => ({ documentIds: gold.stagingRows.slice(offset, offset + 10).map(item => item.documentId) })),
        requiresSeparateHostApproval: true } }
      const verdict = evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { origin: 'fixture-oracle-selftest',
        toolCalls: calls, answer, afterDocument: fixture.document })
      assert.equal(verdict.status, 'satisfied', failed(verdict))
      assert.equal(verdict.scenarioPassed, null)
      assert.equal(new Set(fixture.workspaceMembers.map(item => item.document.id)).size, 30)
      assert.equal(new Set(fixture.workspaceMembers.map(item => item.drawingId)).size, 30)
      assert.equal(new Set(fixture.workspaceMembers.map(item => item.source.input.hole.id)).size, 30)
    } else {
      assert.equal(fixture.actualHistoricalSetup.steps.length, 10)
      assert.equal(fixture.actualHistoricalSetup.historyArchive.undo.length, 10)
      assert.equal(fixture.document.history.undoCount, 10)
      assert.deepEqual(fixture.document.getObject('NOTE-MANUAL'), fixture.actualHistoricalSetup.baselineDocument.getObject('NOTE-MANUAL'))
      assert.deepEqual(fixture.document.getObject('CIRCLE-MANUAL').payload.center, [92, 90, 0])
      const evidence = await archivedEvidence(fixture), verdict = evaluateRound8ReviewedWorkflowOracle(scenario, fixture, evidence)
      assert.equal(verdict.status, 'satisfied', failed(verdict))
      assert.equal(verdict.scenarioPassed, null); assert.equal(verdict.hostActionsVerified, false)
      for (let index = 0; index < gold.steps.length; index++) {
        const actual = fixture.actualHistoricalSetup.steps[index]
        assert.equal(actual.modelCalls, 0)
        assert.deepEqual(content(actual.afterDocument), gold.steps[index].afterContent)
        await assertRoundTrips(fixture, actual.afterDocument, gold.steps[index].afterSource)
      }
      const trace = traceFor(fixture)
      for (let index = 9; index >= 0; index--) {
        await historyAction(fixture, trace, 'undo')
        assert.deepEqual(content(fixture.document), gold.steps[index].beforeContent)
      }
      assert.deepEqual(content(fixture.document), content(fixture.actualHistoricalSetup.baselineDocument))
      for (let index = 0; index < 10; index++) {
        await historyAction(fixture, trace, 'redo')
        assert.deepEqual(content(fixture.document), gold.steps[index].afterContent)
      }
      await assertRoundTrips(fixture, fixture.document, gold.afterSource)
    }
  } finally { fixture.dispose() }
})

test('mixed change must show two real separate approvals and a fresh second revision, never claim a single atomic request', async () => {
  const scenario = sample(MIXED), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const trace = traceFor(fixture), beforeState = signature(fixture.document)
    const proposal = await proposeStep(fixture, trace, 0), first = await commitStep(fixture, trace, proposal, beforeState)
    const evidence = { origin: 'fixture-oracle-selftest', steps: [first], reviewPolicy: fixture.suppliedInputs.confirmedMixedChanges.reviewPolicy,
      afterDocument: fixture.document }
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, evidence).status, 'failed')
    const stale = await trace.session.call('cad_propose_move', { expectedRevision: fixture.initialRevision, units: 'millimeter',
      ids: ['CIRCLE-MANUAL'], dx: 10, dy: 0 })
    assert.equal(stale.ok, false)
    const stateAfterFirst = signature(fixture.document), secondProposal = await proposeStep(fixture, trace, 1)
    const second = await commitStep(fixture, trace, secondProposal, stateAfterFirst)
    const complete = { ...evidence, steps: [first, second] }
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, complete).status, 'satisfied')
    for (const edited of [
      { ...complete, steps: [second, first] },
      { ...complete, reviewPolicy: { ...complete.reviewPolicy, wholeRequestIsNotOneAtomicTransaction: false } },
      { ...complete, steps: [first, { ...second, approval: second.approval.value }] },
      { ...complete, steps: [first, { ...second, approval: second.approval.value, hostApprovalApplied: true, approvedPlanId: 'FOREIGN-PLAN' }] },
      { ...complete, steps: [first, { ...second, approval: { ...second.approval.value, planId: null }, hostApprovalApplied: true }] },
      { ...complete, steps: [first, { ...second, approval: { ...second.approval.value, planId: undefined }, hostApprovalApplied: true }] },
      { ...complete, steps: [first, { ...second, beforeState: 'not-the-current-native-state' }] },
      { ...complete, steps: [first, { ...second, toolCalls: second.toolCalls.filter(call => !(call.name === 'cad_read_geology_source' && call.args.expectedRevision === second.proposal.expectedRevision)) }] },
    ]) assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, edited).status, 'failed')
  } finally { fixture.dispose() }
})

test('selected historical context rejects the foreign document, wrong water and unrequested same-name-hole changes', async () => {
  const scenario = sample(SELECTED), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const trace = traceFor(fixture), gold = expectedRound8ReviewedWorkflowOutcome(scenario, fixture)
    const wrong = await proposeStep(fixture, trace, 0, args => { args.updates[0].stableWaterDepth = 5 })
    const wrongPreview = evaluateRound8ReviewedStepOracle(scenario, fixture, 0, { origin: 'fixture-oracle-selftest', phase: 'pending',
      toolCalls: trace.calls, proposal: wrong, afterDocument: fixture.document })
    assert.equal(wrongPreview.status, 'failed')
    assert.equal(signature(fixture.document), fixture.initialState)
    const beforeState = signature(fixture.document), proposal = await proposeStep(fixture, trace, 0)
    const actual = await commitStep(fixture, trace, proposal, beforeState)
    const evidence = { origin: 'fixture-oracle-selftest', steps: [actual], afterDocument: fixture.document }
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, evidence).status, 'satisfied')
    const other = fixture.unselectedWorkspaceMembers[0]
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { ...evidence, afterDocument: other.document }).status, 'failed')
    await other.document.transact('Unrequested same-name document changed', tx => tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 1 }))
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, evidence).status, 'failed')
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, gold.afterSource)
  } finally { fixture.dispose() }
})

test('batch staging rejects missing/duplicate/merged identities, empty or oversized partitions, implicit approval and missing actual native reads', async () => {
  const scenario = sample(STAGING), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const gold = expectedRound8ReviewedWorkflowOutcome(scenario, fixture), calls = []
    for (const member of fixture.workspaceMembers) {
      const trace = traceFor(fixture, member.document)
      await trace.call('cad_read_geology_source', { expectedRevision: member.document.revision, drawingId: member.drawingId, maxBytes: 262144 })
      calls.push(...trace.calls)
    }
    const answer = { batchPlan: { drawings: clone(gold.stagingRows), requiresSeparateHostApproval: true,
      batches: [0, 10, 20].map(offset => ({ documentIds: gold.stagingRows.slice(offset, offset + 10).map(row => row.documentId) })) } }
    const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: calls, answer }
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, evidence).status, 'satisfied')
    for (const mutate of [
      a => a.batchPlan.drawings.pop(),
      a => { a.batchPlan.drawings[1] = clone(a.batchPlan.drawings[0]) },
      a => { a.batchPlan.drawings[0].drawingId = a.batchPlan.drawings[1].drawingId },
      a => { a.batchPlan.drawings[0].holeId = 'TEST-A' },
      a => { a.batchPlan.requiresSeparateHostApproval = false },
      a => { a.batchPlan.batches[0].documentIds.push(a.batchPlan.batches[1].documentIds.pop()) },
      a => { a.batchPlan.batches[1].documentIds[0] = a.batchPlan.batches[0].documentIds[0] },
      a => { a.batchPlan.batches[0].documentIds = [] },
    ]) {
      const edited = clone(answer); mutate(edited)
      assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { ...evidence, answer: edited }).status, 'failed')
    }
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { ...evidence, toolCalls: calls.slice(1) }).status, 'failed')
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { ...evidence, proposal: { status: 'awaiting-host-approval' } }).status, 'failed')
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { ...evidence,
      afterDocument: fixture.workspaceMembers[1].document }).status, 'failed')
    const validSmallerBatches = clone(answer)
    validSmallerBatches.batchPlan.batches = [0, 6, 12, 18, 24].map(offset => ({
      documentIds: gold.stagingRows.slice(offset, offset + 6).map(row => row.documentId) }))
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { ...evidence, answer: validSmallerBatches }).status, 'satisfied',
      'max batch size is a caller constraint, not a hidden requirement to choose the minimum number of batches')
    const actualExtra = traceFor(fixture, fixture.workspaceMembers[0].document)
    await actualExtra.call('cad_read_drawing', {})
    await actualExtra.call('cad_find_text', { expectedRevision: fixture.workspaceMembers[0].document.revision, search: 'TEST-',
      match: 'contains', caseSensitive: true, offset: 0, limit: 100, maxBytes: 262144 })
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { ...evidence,
      toolCalls: [...calls, ...actualExtra.calls] }).status, 'satisfied', 'legitimate additional public reads must stay allowed')
    for (const extra of [
      { name: 'cad_read_not_public', args: {}, result: { ok: false, error: { code: 'UNKNOWN_TOOL' } } },
      { name: 'cad_read_geology_source', args: clone(calls[0].args), result: { ok: false, error: { code: 'KJREVISION_CONFLICT' } } },
      { ...clone(calls[0]), args: { ...calls[0].args, expectedRevision: 0 } },
      { ...clone(calls[0]), result: { ok: true, value: { ...calls[0].result.value, documentId: 'foreign-document' } } },
      { ...clone(calls[0]), result: { ok: true, value: { ...calls[0].result.value, revision: 0 } } },
      { name: 'cad_read_not_public', args: {}, result: clone(calls[0].result) },
    ]) assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { ...evidence, toolCalls: [...calls, extra] }).status, 'failed')
  } finally { fixture.dispose() }
})

test('ten-round archive cannot use old/current-mismatched KJD, wrong DXF, forged history or a fabricated verification receipt', async () => {
  const scenario = sample(ARCHIVE), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const evidence = await archivedEvidence(fixture)
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, evidence).status, 'satisfied')
    for (const edited of [
      { ...evidence, archiveVerification: { schema: 'round8-actual-archive-byte-verification-v1' } },
      { ...evidence, archiveVerification: null },
      { ...evidence, answer: { archiveFormats: { KJD: 'native-source-backup', DXF: 'native-source-backup', history: 'separate-local-history-archive' } } },
      { ...evidence, toolCalls: evidence.toolCalls.filter(call => call.name !== 'cad_read_geology_source') },
      { ...evidence, toolCalls: evidence.toolCalls.filter(call => call.name !== 'cad_read_history') },
    ]) assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, edited).status, 'failed')
    const currentKjd = await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })
    const currentDxf = await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' })
    const historyArchive = clone(fixture.actualHistoricalSetup.historyArchive)
    await assert.rejects(verifyRound8ArchiveArtifacts(fixture, { kjdBytes: fixture.artifact.bytes, dxfBytes: currentDxf, historyArchive }), /KJD|state|snapshot/)
    const wrongDxf = await fixture.sdk.writeDocument(fixture.actualHistoricalSetup.baselineDocument, { format: 'DXF' })
    await assert.rejects(verifyRound8ArchiveArtifacts(fixture, { kjdBytes: currentKjd, dxfBytes: wrongDxf, historyArchive }), /DXF|physical|geometry/)
    historyArchive.undo[0].after.objects['NOTE-MANUAL'].payload.text = 'FORGED'
    await assert.rejects(verifyRound8ArchiveArtifacts(fixture, { kjdBytes: currentKjd, dxfBytes: currentDxf, historyArchive }), /history|snapshot|chain/i)
  } finally { fixture.dispose() }
})

test('native archive/history selftest is not a model or browser pass, even when labelled real-model', async () => {
  const scenario = sample(ARCHIVE), fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const evidence = await archivedEvidence(fixture)
    const real = evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { ...evidence, origin: 'real-model' })
    assert.equal(real.status, 'failed')
    assert.equal(real.scenarioPassed, null); assert.equal(real.scenarioExecuted, false)
    assert.equal(evaluateRound8ReviewedWorkflowOracle(scenario, fixture, { origin: 'real-model', answer: 'saved and reopened' }).status, 'not-evaluated')
  } finally { fixture.dispose() }
})

test('ten caller-declared daily edits preserve unrequested observations, interval identities and manual note; source facts are not CAD labels', () => {
  assert.equal(ROUND8_TEN_REVIEWED_CHANGES.length, 10)
  assert.equal(ROUND8_TEN_REVIEWED_CHANGES.filter(item => item.kind === 'manual').length, 3)
  assert.deepEqual(ROUND8_TEN_REVIEWED_CHANGES.map(item => item.index), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.deepEqual(round8ReviewedWorkflowCallerInputs(sample(ARCHIVE)).confirmedHistoricalChangeLedger.changes, ROUND8_TEN_REVIEWED_CHANGES)
  assert.equal(round8ReviewedWorkflowCallerInputs(sample(STAGING)).callerBatchPolicy.declaredDrawingCount, 30)
  assert.equal(round8ReviewedWorkflowCallerInputs(sample(MIXED)).confirmedMixedChanges.reviewPolicy.wholeRequestIsNotOneAtomicTransaction, true)
  const archiveContract = round8ReviewedWorkflowCallerInputs(sample(ARCHIVE)).responseContract
  assert.deepEqual(archiveContract.fields, ['KJD', 'DXF', 'history'])
  assert.deepEqual(Object.keys(archiveContract.roleCodeVocabulary).sort(),
    ['graphics-exchange-no-native-source', 'native-source-backup', 'separate-local-history-archive'])
})
