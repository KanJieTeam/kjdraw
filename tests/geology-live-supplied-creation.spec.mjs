import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runGeologyUserScenarios } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { SUPPLIED_CREATION_DESCRIPTORS, suppliedCreationDescriptor, suppliedCreationDocumentSemantics,
  suppliedCreationPhysicalGeometryMatches, evaluateSuppliedCreationOracle,
} from '../scripts/testing/helpers/geology-supplied-creation-oracles.mjs'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const sample = intent => corpus.scenarios.find(scenario => scenario.expected.intent === intent && scenario.id.endsWith('-zh-direct'))
const identityMarker = 'Public synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. '
const bindings = input => JSON.parse(input.messages.find(message => message.role === 'user').content.split(identityMarker).at(-1))
const call = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const response = (toolCalls = [], content = '') => ({ model: 'fixture-not-real-provider', content, toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 19, outputTokens: 7, totalTokens: 26 }, elapsedMs: 1 })

// The injected fixture caller copies explicitly supplied public facts only.
// It never accesses a generated gold object, expected scenario answer, output
// drawing ID, preview or compiler. Actual SDK tool calls create every result.
function creationCaller(scenario, mutate = () => {}) {
  const requests = [], descriptor = suppliedCreationDescriptor(scenario)
  return { requests, async modelCall(input) {
    requests.push(structuredClone(input))
    assert.equal(Object.hasOwn(input.settings, 'response_format'), false, 'Creation mutation requests never receive final-answer JSON mode')
    const bound = bindings(input)
    assert.equal(Object.keys(bound.aliases).length, 0)
    assert.doesNotMatch(JSON.stringify(bound), /"commandArgs"|"preview"|"payload"|"afterSource"|"gold"|"engineeringEvidence"|"drawingId"/)
    if (requests.length === 1) return response([
      call('cad_read_drawing', {}, 'actual-blank-drawing'),
      call('cad_read_geology_source', { expectedRevision: bound.revision, drawingId: '', maxBytes: 8192 }, 'actual-empty-recipes'),
    ])
    if (requests.length === 2) {
      const actualReads = input.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))
      assert.equal(actualReads.length, 2)
      assert.ok(actualReads.every(result => result.ok === true && result.value.documentId === bound.documentId && result.value.revision === bound.revision))
      assert.equal(actualReads[0].value.entities.length, 0)
      assert.equal(actualReads[1].value.sourceBacked, false)
      assert.deepEqual(actualReads[1].value.drawingIds, [])
      const args = { version: '1.0.0', expectedRevision: bound.revision, units: 'millimeter',
        ...structuredClone(bound.suppliedInputs.completeGeologyCreation.input) }
      mutate(args)
      return response([call(descriptor.proposalTool, args, 'actual-native-creation')])
    }
    // Only relevant for rejected malformed SDK arguments. Do not repair,
    // invent missing values or use another mutation to make a fixture pass.
    assert.ok(requests.length <= 3)
    return response([], 'The supplied mutation was rejected. The drawing is unchanged.')
  } }
}

async function runCreation(scenario, caller) {
  const events = []
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', answerPolicyVersion: 'native-policy-codes-v1',
    answerEncoding: 'json-object', scenarioIds: [scenario.id], maxScenarios: 1, maxRequests: 3, modelCall: caller.modelCall,
    onScenarioResult: event => events.push({ event, pendingStatus: event.oracle.status,
      pendingState: canonicalStringify(event.evidence.afterDocument.snapshot()),
      pendingUndoCount: event.evidence.afterDocument.history.undoCount,
      pendingHostApplied: event.evidence.hostApprovalApplied,
      pendingReceipt: event.evidence.approvalReceipt }) })
  assert.equal(report.evidenceOrigin, 'fixture-oracle-selftest')
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.passed, 0)
  assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.allSelectedPassed, false, 'A deterministic fixture is never counted as a real provider pass')
  return { report, events }
}

for (const descriptor of SUPPLIED_CREATION_DESCRIPTORS) test(`actual chat host approval, full archive, DXF and undo/redo: ${descriptor.intent}`, async () => {
  const scenario = sample(descriptor.intent), caller = creationCaller(scenario)
  const { report, events } = await runCreation(scenario, caller)
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify({ row: report.scenarios[0],
    actualRuntimeError: events[0]?.event.result.error,
    offeredTools: report.trace.map(trace => trace.offeredTools),
    actualOutputs: events[0]?.event.result.toolOutputs?.map(output => ({ name: output.name, ok: output.result.ok, error: output.result.error })) }))
  assert.equal(report.requests, 2)
  assert.equal(report.totalTokens, 52)
  assert.ok(caller.requests.every(request => request.settings.tools.some(tool => tool.function.name === descriptor.proposalTool)),
    'Actual host-selected tool policy must admit the native creation compiler; an SDK-only test is not end-to-end evidence')
  assert.equal(events.length, 1)
  const { event, pendingStatus, pendingState, pendingUndoCount, pendingHostApplied, pendingReceipt } = events[0]
  const { fixture, evidence } = event
  assert.equal(pendingStatus, 'satisfied')
  assert.equal(pendingState, fixture.initialState)
  assert.equal(pendingUndoCount, 0)
  assert.equal(pendingHostApplied, false)
  assert.equal(pendingReceipt, null)
  assert.equal(evidence.stage, 'committed')
  assert.equal(evidence.executionStatus, 'applied')
  assert.equal(evidence.hostApprovalApplied, true)
  assert.equal(evidence.approvedPlanId, evidence.proposal.planId)
  assert.equal(evidence.approvalReceipt.status, 'committed')
  assert.equal(evidence.approvalReceipt.command, 'CREATEBATCH')
  assert.equal(evidence.approvalReceipt.beforeRevision, 0)
  assert.equal(evidence.approvalReceipt.afterRevision, 1)
  assert.equal(evidence.afterDocument.revision, 1)
  assert.equal(evidence.afterDocument.history.undoCount, 1, 'The actual runtime archive is independently restored after KJD reopen')
  assert.equal(evidence.afterDocument.history.redoCount, 0)
  const source = evidence.proposal.arguments.geologySource, document = evidence.afterDocument
  const roots = Object.keys(document.snapshot().opaquePayloads)
  assert.equal(roots.length, 1)
  assert.ok(roots[0].startsWith('geology-drawing-recipe:'))
  const drawingId = roots[0].slice('geology-drawing-recipe:'.length)
  assert.deepEqual(readGeologyDrawingRecipe(document, drawingId).source, source)
  assert.equal(suppliedCreationPhysicalGeometryMatches(document.listEntities(), source), true,
    'Independent metre-to-page arithmetic validates every hatch and supplied section connection')
  assert.equal(document.validate().valid, true)
  const committedState = canonicalStringify(document.snapshot()), fingerprint = document.fingerprint()
  const archive = document.exportHistory()
  assert.equal(archive.documentFingerprint, fingerprint)
  assert.equal(archive.undo.length, 1)
  assert.equal(archive.redo.length, 0)
  const dxf = await fixture.sdk.writeDocument(document, { format: 'DXF' })
  const imported = await fixture.sdk.readDocument(dxf, { format: 'DXF' })
  assert.equal(imported.validate().valid, true)
  // KJD is JSON: absent optional TEXT alignmentPoint and an explicit importer
  // alignmentPoint:undefined serialize identically. Match the existing strict
  // native semantics contract; never normalize numbers, IDs or stored text.
  assert.equal(canonicalStringify(suppliedCreationDocumentSemantics(imported)), canonicalStringify(suppliedCreationDocumentSemantics(document)),
    'Actual DXF import must retain complete serialized entity handles, geometry, HATCH pattern semantics and named resources')
  assert.equal(canonicalStringify(document.snapshot()), committedState, 'DXF verification cannot mutate the authoritative approved document')
  assert.equal(evaluateSuppliedCreationOracle(scenario, fixture, evidence).status, 'satisfied')
  for (const tamper of [
    { hostApprovalApplied: false }, { approvedPlanId: 'not-actually-approved' },
    { approvalReceipt: { ...evidence.approvalReceipt, status: 'rejected' } },
    { approvalReceipt: { ...evidence.approvalReceipt, command: 'MOVE' } },
    { approvalReceipt: { ...evidence.approvalReceipt, beforeRevision: 1 } },
    { approvalReceipt: { ...evidence.approvalReceipt, afterRevision: 2 } },
    { approvalReceipt: { ...evidence.approvalReceipt, planId: 'foreign-plan' } },
  ]) assert.equal(evaluateSuppliedCreationOracle(scenario, fixture, { ...evidence, ...tamper }).status, 'failed',
    'A correct final drawing alone cannot prove that the declared exact proposal was host-approved')
  const undoTarget = document.history.undoTarget
  await fixture.sdk.executeCommand('UNDO', { targetHistoryId: undoTarget.id }, { document, expectedRevision: document.revision })
  assert.equal(document.fingerprint(), fixture.oracleBaselineDocument.fingerprint())
  assert.equal(document.listEntities().length, 0)
  assert.deepEqual(Object.keys(document.snapshot().opaquePayloads), [])
  assert.equal(document.history.redoTarget.id, undoTarget.id)
  await fixture.sdk.executeCommand('REDO', { targetHistoryId: document.history.redoTarget.id }, { document, expectedRevision: document.revision })
  assert.equal(document.fingerprint(), fingerprint)
  assert.deepEqual(readGeologyDrawingRecipe(document, drawingId).source, source)
})

for (const [label, intent, mutate] of [
  ['wrong complete supplied collar', 'source-section.create-supplied-column', args => { args.hole.collarElevation += 1 }],
  ['omitted supplied sample', 'source-section.create-supplied-column', args => { args.hole.observations = args.hole.observations.filter(record => record.kind !== 'sample') }],
  ['changed caller locale', 'geological-presentation.chinese-column-headings', args => { args.locale = 'en' }],
  ['wrong section datum', 'geological-presentation.supplied-section-datum', args => { args.datumElevation += 1 }],
]) test(`a valid native creation with ${label} is rejected before host commit`, async () => {
  const scenario = sample(intent), caller = creationCaller(scenario, mutate), { report, events } = await runCreation(scenario, caller)
  assert.equal(events.length, 1)
  const { evidence, result, fixture } = events[0].event
  assert.equal(result.status, 'proposal', 'The wrong but structurally valid facts must actually reach the native SDK; a host scope error cannot stand in for this test')
  assert.equal(events[0].pendingStatus, 'failed')
  assert.equal(report.scenarios[0].status, 'failed')
  assert.equal(report.scenarios[0].reason, 'host-approval-not-completed')
  assert.equal(evidence.hostApprovalApplied, false)
  assert.equal(evidence.approvalReceipt, null)
  assert.ok(evidence.rejectedPlans.every(plan => plan.status === 'rejected'))
  assert.equal(canonicalStringify(evidence.afterDocument.snapshot()), fixture.initialState)
  assert.equal(evidence.afterDocument.revision, 0)
  assert.equal(evidence.afterDocument.history.undoCount, 0)
  assert.equal(evidence.afterDocument.history.redoCount, 0)
  assert.deepEqual(Object.keys(evidence.afterDocument.snapshot().opaquePayloads), [])
})

for (const [label, mutate] of [
  ['missing required depth', args => { delete args.hole.depth }],
  ['wrong CAD units', args => { args.units = 'meter' }],
  ['invalid declared scale', args => { args.verticalScaleDenominator = 0 }],
]) test(`malformed ${label} is actually SDK-rejected with no proposal, source, history or commit`, async () => {
  const scenario = sample('source-section.create-supplied-column'), caller = creationCaller(scenario, mutate)
  const { report, events } = await runCreation(scenario, caller)
  assert.equal(events.length, 1)
  const { evidence, result, fixture } = events[0].event
  assert.ok(report.trace[0].offeredTools.includes('cad_propose_geology_column'), 'Test must not replace SDK argument validation with tool scope rejection')
  const actual = result.toolOutputs.find(output => output.name === 'cad_propose_geology_column')
  assert.ok(actual, 'The actual invalid request must have reached native argument validation')
  assert.equal(actual.result.ok, false)
  assert.notEqual(report.scenarios[0].status, 'satisfied')
  assert.equal(evidence.proposal, undefined)
  assert.equal(evidence.hostApprovalApplied, false)
  assert.equal(evidence.approvalReceipt, null)
  assert.equal(canonicalStringify(evidence.afterDocument.snapshot()), fixture.initialState)
  assert.equal(evidence.afterDocument.history.undoCount, 0)
  assert.equal(evidence.afterDocument.history.redoCount, 0)
  assert.equal(evidence.afterDocument.listEntities().length, 0)
})
