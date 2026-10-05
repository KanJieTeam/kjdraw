import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { ROUND4_NATIVE_DESCRIPTORS, ROUND4_NATIVE_SCENARIO_IDS, assessRound4NativeReadiness,
  buildRound4NativeFixture, evaluateRound4NativeOracle, expectedRound4NativeAnswer, expectedRound4NativeOutcome,
  round4NativeAnswerFrame, round4NativeDescriptor, round4NativeInputBindings } from '../scripts/testing/helpers/geology-round4-native-oracles.mjs'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const byId = new Map(corpus.scenarios.map(scenario => [scenario.id, scenario]))
const clone = structuredClone

function traceFor(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}

async function collectEvidence(trace, fixture, scenario) {
  const descriptor = round4NativeDescriptor(scenario)
  const aliases = descriptor.intent === 'cad-query.endpoint-topology' ? ['LINE-A', 'LINE-B']
    : [descriptor.intent === 'cad-query.native-object' ? 'LINE-A'
      : descriptor.intent === 'cad-annotation.preserve-mtext-format' ? 'MTEXT-A' : 'NOTE-A']
  const ids = aliases.map(alias => fixture.identityAliases[alias].nativeId)
  await trace.call('cad_query_drawing', { expectedRevision: fixture.initialRevision, filters: { ids },
    offset: 0, layerOffset: 0, limit: 200, maxLayers: 100, maxBytes: 262144 })
  if (descriptor.intent === 'cad-query.endpoint-topology') await trace.call('cad_query_topology', {
    expectedRevision: fixture.initialRevision, units: 'millimeter', ids, tolerance: 0.01, maxBytes: 262144 })
  if (descriptor.kind === 'read-only') return null
  const gold = expectedRound4NativeOutcome(scenario, fixture)
  return trace.call('cad_propose_text_edit', { expectedRevision: fixture.initialRevision, units: 'millimeter',
    changes: [{ id: gold.targetId, expectedText: gold.before[0].payload.text, text: gold.after[0].payload.text }] })
}

test('round4 adds exactly four original families/24 variants, leaving other prerequisites unimplemented', () => {
  assert.equal(ROUND4_NATIVE_DESCRIPTORS.length, 4)
  assert.equal(ROUND4_NATIVE_SCENARIO_IDS.length, 24)
  assert.equal(new Set(ROUND4_NATIVE_SCENARIO_IDS).size, 24)
  const outside = corpus.scenarios.find(item => item.expected.intent === 'cad-query.named-selection')
  assert.equal(assessRound4NativeReadiness(outside).status, 'not-ready')
  assert.equal(assessRound4NativeReadiness(outside).scenarioPassed, null)
})

for (const id of ROUND4_NATIVE_SCENARIO_IDS) {
  const scenario = byId.get(id)
  test(`round4 actual SDK oracle selftest, not a model pass: ${id}`, async () => {
    const fixture = await buildRound4NativeFixture(scenario)
    try {
      assert.equal(fixture.document.validate().valid, true)
      assert.equal(fixture.artifact.format, 'DXF')
      assert.equal(fixture.scenarioExecuted, false)
      assert.equal(fixture.modelCalls, 0)
      assert.equal(fixture.conversationSeed.length, ['followup', 'correction'].includes(scenario.interaction) ? 1 : 0)
      const trace = traceFor(fixture), proposal = await collectEvidence(trace, fixture, scenario)
      const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls,
        answer: expectedRound4NativeAnswer(scenario, fixture), proposal, stage: 'pending-preview' }
      const initial = evaluateRound4NativeOracle(scenario, fixture, evidence)
      assert.equal(initial.status, 'satisfied', JSON.stringify(initial.assertions?.filter(item => !item.satisfied)))
      assert.equal(initial.scenarioPassed, null)
      assert.equal(initial.scenarioExecuted, false)
      assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
      if (proposal) {
        const tampered = clone(proposal)
        tampered.preview.after[0].payload.text += ' unrequested'
        assert.equal(evaluateRound4NativeOracle(scenario, fixture, { ...evidence, proposal: tampered }).status, 'failed')
        const approvalReceipt = await trace.session.approve(proposal.planId, 'native-round4-selftest')
        assert.equal(approvalReceipt.ok, true, JSON.stringify(approvalReceipt.error))
        const committed = evaluateRound4NativeOracle(scenario, fixture, { ...evidence, stage: 'committed',
          approvalReceipt, approvedPlanId: proposal.planId })
        assert.equal(committed.status, 'satisfied', JSON.stringify(committed.assertions?.filter(item => !item.satisfied)))
        assert.equal(committed.scenarioPassed, null)
        const actualHostEvidence = { ...evidence, stage: 'committed', approvalReceipt: approvalReceipt.value,
          approvedPlanId: proposal.planId, hostApprovalApplied: true }
        assert.equal(evaluateRound4NativeOracle(scenario, fixture, actualHostEvidence).status, 'satisfied')
        assert.equal(evaluateRound4NativeOracle(scenario, fixture, { ...actualHostEvidence, hostApprovalApplied: false }).status, 'failed')
        assert.equal(evaluateRound4NativeOracle(scenario, fixture, { ...actualHostEvidence, approvedPlanId: 'wrong-plan' }).status, 'failed')
        for (const receipt of [{ ...approvalReceipt.value, status: 'rejected' },
          { ...approvalReceipt.value, status: undefined }, { ...approvalReceipt.value, planId: 'foreign-plan' }]) {
          assert.equal(evaluateRound4NativeOracle(scenario, fixture, { ...actualHostEvidence, approvalReceipt: receipt }).status, 'failed')
        }
        const edited = fixture.document.fingerprint(), editedState = fixtureStateSignature(fixture.document)
        assert.equal((await trace.session.approve(proposal.planId, 'native-round4-selftest')).ok, false)
        assert.equal(fixtureStateSignature(fixture.document), editedState)
        const undoHistory = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
        const undo = await trace.call('cad_propose_undo', { expectedRevision: fixture.document.revision, units: 'millimeter',
          targetHistoryId: undoHistory.history.undoTarget.id })
        assert.equal(fixtureStateSignature(fixture.document), editedState)
        assert.equal((await trace.session.approve(undo.planId, 'native-round4-history-selftest')).ok, true)
        assert.equal(fixture.document.fingerprint(), fixture.oracleBaselineDocument.fingerprint())
        const redoHistory = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
        const redo = await trace.call('cad_propose_redo', { expectedRevision: fixture.document.revision, units: 'millimeter',
          targetHistoryId: redoHistory.history.redoTarget.id })
        assert.equal((await trace.session.approve(redo.planId, 'native-round4-history-selftest')).ok, true)
        assert.equal(fixture.document.fingerprint(), edited)
      } else {
        assert.equal(evaluateRound4NativeOracle(scenario, fixture, { ...evidence, answer: {} }).status, 'failed')
        assert.equal(evaluateRound4NativeOracle(scenario, fixture, { ...evidence, toolCalls: [] }).status, 'failed')
        assert.equal(evaluateRound4NativeOracle(scenario, fixture, { ...evidence, origin: 'real-model', rawFinalAnswer: 'I checked.' }).status, 'not-evaluated')
      }
    } finally { fixture.dispose() }
  })
}

function semantics(document) {
  const reference = value => {
    if (Array.isArray(value)) return value.map(reference)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, reference(item)]))
    const record = typeof value === 'string' && document.getObject(value)
    return record ? { type: record.type, name: record.name, ...(record.kind === 'entity' ? { handle: record.handle } : {}) } : value
  }
  return { entities: document.listEntities().map(entity => ({ type: entity.type, handle: entity.handle,
    payload: reference(entity.payload) })).sort((a, b) => a.handle.localeCompare(b.handle)),
  resources: ['layers', 'textStyles', 'linetypes'].map(table => ({ table, records: document.getTable(table).records.map(record => ({
    type: record.type, name: record.name, payload: reference(record.payload) })).sort((a, b) => a.name.localeCompare(b.name)) })) }
}

for (const descriptor of ROUND4_NATIVE_DESCRIPTORS) test(`round4 complete DXF semantics and actual KJD state: ${descriptor.intent}`, async () => {
  const scenario = corpus.scenarios.find(item => item.expected.intent === descriptor.intent && item.id.endsWith('-zh-direct'))
  const fixture = await buildRound4NativeFixture(scenario)
  try {
    const trace = traceFor(fixture), proposal = await collectEvidence(trace, fixture, scenario)
    if (proposal) assert.equal((await trace.session.approve(proposal.planId, 'native-round4-file-selftest')).ok, true)
    const kjd = await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })
    const recovered = await fixture.sdk.readDocument(kjd, { format: 'KJD' })
    assert.deepEqual(JSON.parse(JSON.stringify(recovered.snapshot())), JSON.parse(JSON.stringify(fixture.document.snapshot())))
    const dxf = await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' })
    const graphics = await fixture.sdk.readDocument(dxf, { format: 'DXF' })
    assert.equal(graphics.validate().valid, true)
    assert.deepEqual(semantics(graphics), semantics(fixture.document), 'All native handles, payloads and resource properties survive, not just entity counts')
  } finally { fixture.dispose() }
})

test('round4 publishes complete input identities/raw text but never gold substitutions or selected answers', async () => {
  for (const intent of ['cad-annotation.preserve-mtext-format', 'cad-annotation.append-review-note']) {
    const scenario = corpus.scenarios.find(item => item.expected.intent === intent && item.id.endsWith('-zh-direct'))
    const fixture = await buildRound4NativeFixture(scenario)
    try {
      const bindings = round4NativeInputBindings(fixture)
      assert.equal(Object.keys(bindings.aliases).length, 14)
      assert.ok(!JSON.stringify(bindings).includes('已核对'))
      assert.ok(!JSON.stringify(bindings).includes('仅供复核'))
    } finally { fixture.dispose() }
  }
  const frame = round4NativeAnswerFrame('cad-query.endpoint-topology')
  assert.ok(!frame.includes('20,0') && !frame.includes('0.01') && !frame.includes('connected":true'))
})
