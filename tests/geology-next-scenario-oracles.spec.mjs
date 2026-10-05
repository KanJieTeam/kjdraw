import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { NEXT_SCENARIO_DESCRIPTORS, NEXT_ORACLE_SCENARIO_IDS, NEXT_REMAINING_BOUNDARIES,
  assessNextScenarioReadiness, buildNextScenarioFixture, evaluateNextScenarioOracle,
  expectedNextScenarioAnswer, expectedNextScenarioOutcome, nextScenarioAnswerFrame,
  nextScenarioFixtureInputBindings } from '../scripts/testing/helpers/geology-next-scenario-oracles.mjs'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = new Map(corpus.scenarios.map(scenario => [scenario.id, scenario]))
const clone = structuredClone
const equal = (a, b) => canonicalStringify(a) === canonicalStringify(b)

// Explicit SDK self-tests prove fixture/oracle executability, not interpretation
// of any user sentence. They make zero model calls and never yield scenarioPassed.
function traceFor(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}

async function readSource(trace, fixture) {
  return trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 })
}

async function collectNativeProposal(trace, fixture, gold) {
  const base = { expectedRevision: fixture.initialRevision, units: 'millimeter' }
  await readSource(trace, fixture)
  if (gold.kind === 'cad') {
    await trace.call('cad_query_drawing', { expectedRevision: fixture.initialRevision, filters: { ids: gold.targetIds },
      offset: 0, layerOffset: 0, limit: 20, maxLayers: 50, maxBytes: 262144 })
    return trace.call('cad_propose_move', { ...base, ids: gold.targetIds, dx: 0, dy: 5 })
  }
  const before = gold.beforeSource.kind === 'column' ? [gold.beforeSource.input.hole] : gold.beforeSource.input.holes
  const after = gold.afterSource.kind === 'column' ? [gold.afterSource.input.hole] : gold.afterSource.input.holes
  const updates = after.flatMap(hole => {
    const previous = before.find(item => item.id === hole.id), update = { holeId: hole.id }
    for (const key of Object.keys(hole)) if (key !== 'id' && !equal(hole[key], previous[key])) update[key] = clone(hole[key])
    return Object.keys(update).length > 1 ? [update] : []
  })
  const correlations = {}
  if (gold.kind === 'source' && gold.afterSource.kind === 'section') {
    for (const key of ['correlations', 'uncorrelatedOccurrences']) if (!equal(gold.beforeSource.input[key], gold.afterSource.input[key])) correlations[key] = clone(gold.afterSource.input[key])
    if (!updates.length && Object.keys(correlations).length) updates.push({ holeId: after[0].id, strata: clone(after[0].strata) })
  }
  return trace.call('cad_propose_geology_revision', { ...base, drawingId: fixture.drawingId, updates, ...correlations })
}

test('next descriptors cover only 8 declared frozen families, leaving unsupported routes explicit', () => {
  assert.equal(NEXT_SCENARIO_DESCRIPTORS.length, 8)
  assert.equal(NEXT_ORACLE_SCENARIO_IDS.length, 48)
  assert.ok(NEXT_ORACLE_SCENARIO_IDS.every(id => assessNextScenarioReadiness(scenarios.get(id)).status === 'runnable'))
  assert.ok(NEXT_REMAINING_BOUNDARIES.every(item => item.status.startsWith('unsupported') || item.status.includes('not-implemented')))
  const unknown = corpus.scenarios.find(scenario => scenario.expected.intent === 'source-section.mixed-source-and-manual-edit')
  assert.equal(assessNextScenarioReadiness(unknown).status, 'not-ready')
  assert.equal(assessNextScenarioReadiness(unknown).scenarioPassed, null)
})

for (const id of NEXT_ORACLE_SCENARIO_IDS) {
  const scenario = scenarios.get(id)
  test(`next native fixture/oracle self-test, never a model pass: ${id}`, async () => {
    const fixture = await buildNextScenarioFixture(scenario)
    try {
      assert.equal(fixture.scenarioExecuted, false)
      assert.equal(fixture.modelCalls, 0)
      assert.equal(fixture.document.validate().valid, true)
      assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
      const expectedSeedCount = ['followup', 'correction'].includes(scenario.interaction) ? 1 : 0
      assert.equal(fixture.conversationSeed.length, expectedSeedCount)
      if (expectedSeedCount) {
        assert.ok(fixture.conversationSeed[0].content.includes(fixture.document.id))
        assert.ok(fixture.conversationSeed[0].content.includes(`revision ${fixture.initialRevision}`))
      }
      const trace = traceFor(fixture), gold = expectedNextScenarioOutcome(scenario, fixture)
      if (gold.kind === 'read-only') {
        await readSource(trace, fixture)
        const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls,
          answer: expectedNextScenarioAnswer(scenario, fixture) }
        const verdict = await evaluateNextScenarioOracle(scenario, fixture, evidence)
        assert.equal(verdict.status, 'satisfied', JSON.stringify(verdict.assertions.filter(item => !item.satisfied)))
        assert.equal(verdict.scenarioPassed, null)
        assert.equal(verdict.scenarioExecuted, false)
        assert.equal((await evaluateNextScenarioOracle(scenario, fixture, { ...evidence, answer: {} })).status, 'failed')
        assert.equal((await evaluateNextScenarioOracle(scenario, fixture, { ...evidence, origin: 'real-model', rawFinalAnswer: 'I verified it.' })).status, 'not-evaluated')
      } else {
        const proposal = await collectNativeProposal(trace, fixture, gold)
        const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls,
          proposal, stage: 'pending-preview' }
        const pending = await evaluateNextScenarioOracle(scenario, fixture, evidence)
        assert.equal(pending.status, 'satisfied', JSON.stringify(pending.assertions.filter(item => !item.satisfied)))
        assert.equal(pending.scenarioPassed, null)
        assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
        const tampered = clone(proposal)
        if (tampered.preview.after.length) tampered.preview.after[0].payload.oracleTamper = true
        else tampered.preview.after.push({ id: 'UNREQUESTED-EXTRA', type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 1 } })
        assert.equal((await evaluateNextScenarioOracle(scenario, fixture, { ...evidence, proposal: tampered })).status, 'failed')
        const receipt = await trace.session.approve(proposal.planId, 'native-next-fixture-selftest')
        assert.equal(receipt.ok, true, JSON.stringify(receipt.error))
        const committed = await evaluateNextScenarioOracle(scenario, fixture, { ...evidence, stage: 'committed', approvalReceipt: receipt, approvedPlanId: proposal.planId })
        assert.equal(committed.status, 'satisfied', JSON.stringify(committed.assertions.filter(item => !item.satisfied)))
        assert.equal(committed.scenarioPassed, null)
        if (gold.kind === 'source') assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, gold.afterSource)
        assert.equal(fixture.document.history.undoCount, 1, 'source facts and geometry commit as one real undoable transaction')
        const editedFingerprint = fixture.document.fingerprint(), approvedState = fixtureStateSignature(fixture.document)
        assert.equal((await trace.session.approve(proposal.planId, 'native-next-fixture-selftest')).ok, false)
        assert.equal(fixtureStateSignature(fixture.document), approvedState, 'consumed approval cannot replay a mutation')
        const undoRead = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
        const undo = await trace.call('cad_propose_undo', { expectedRevision: fixture.document.revision, units: 'millimeter', targetHistoryId: undoRead.history.undoTarget.id })
        assert.equal(fixtureStateSignature(fixture.document), approvedState, 'history preview does not undo the edit')
        assert.equal((await trace.session.approve(undo.planId, 'native-next-history-selftest')).ok, true)
        assert.equal(fixture.document.fingerprint(), fixture.oracleBaselineDocument.fingerprint(), 'actual undo restores exact initial content')
        assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
        const redoRead = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
        const redo = await trace.call('cad_propose_redo', { expectedRevision: fixture.document.revision, units: 'millimeter', targetHistoryId: redoRead.history.redoTarget.id })
        assert.equal((await trace.session.approve(redo.planId, 'native-next-history-selftest')).ok, true)
        assert.equal(fixture.document.fingerprint(), editedFingerprint, 'actual redo restores exact approved content')
        if (scenario.interaction === 'direct' && scenario.language === 'zh-CN') {
          const kjd = await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })
          const recovered = await fixture.sdk.readDocument(kjd, { format: 'KJD' })
          assert.equal(canonicalStringify(recovered.snapshot()), canonicalStringify(fixture.document.snapshot()),
            'actual KJD reopen preserves every serialized state field; JSON omits undefined optional properties')
          const dxf = await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' })
          const graphics = await fixture.sdk.readDocument(dxf, { format: 'DXF' })
          assert.equal(graphics.validate().valid, true)
          assert.equal(graphics.listEntities().length, fixture.document.listEntities().length)
          assert.equal(graphics.listEntities({ type: 'HATCH' }).length, fixture.document.listEntities({ type: 'HATCH' }).length)
          const texts = document => document.listEntities().filter(entity => ['TEXT', 'MTEXT'].includes(entity.type)).map(entity => entity.payload.text).sort()
          assert.deepEqual(texts(graphics), texts(fixture.document), 'all visible text survives actual DXF reopen')
        }
      }
    } finally { fixture.dispose() }
  })
}

test('dated observation fixture declares layout and marker convention without leaking future gold values', async () => {
  const scenario = scenarios.get(NEXT_ORACLE_SCENARIO_IDS.find(id => id.endsWith('-zh-direct') && id.includes('dated-groundwater')))
  const fixture = await buildNextScenarioFixture(scenario)
  try {
    const binding = nextScenarioFixtureInputBindings(fixture)
    assert.deepEqual(binding.suppliedInputs.groundwaterMarkerConvention, {
      provenance: 'caller-declared-public-synthetic-not-measurement-certified', marker: 'filled-down-triangle', units: 'metre', observationDateFormat: 'YYYY-MM-DD',
    })
    assert.ok(!JSON.stringify(binding).includes('2026-09-02'))
    assert.equal(fixture.source.input.hole.groundwaterObservations.length, 1)
    const gold = expectedNextScenarioOutcome(scenario, fixture)
    assert.equal(gold.afterSource.input.hole.groundwaterObservations.length, 2)
    assert.deepEqual(gold.afterSource.input.hole.groundwaterObservations[0], fixture.source.input.hole.groundwaterObservations[0])
    assert.equal(gold.afterSource.input.hole.initialWaterDepth, 2)
    assert.equal(gold.afterSource.input.hole.stableWaterDepth, 4)
    assert.equal(gold.after.filter(entity => entity.type === 'TEXT' && entity.payload.text === '2026-09-02').length, 1)
    assert.equal(gold.after.filter(entity => entity.type === 'TEXT' && entity.payload.text === '▼').length, 1)
  } finally { fixture.dispose() }
})

test('duplicate section stations are rejected by the actual native proposal tool without partial mutation', async () => {
  const scenario = scenarios.get(NEXT_ORACLE_SCENARIO_IDS.find(id => id.endsWith('-zh-direct') && id.includes('duplicate-stations')))
  const fixture = await buildNextScenarioFixture(scenario)
  try {
    const session = new KJAgentToolSession(fixture.sdk, fixture.document)
    const result = await session.call('cad_propose_geology_revision', { expectedRevision: fixture.initialRevision, units: 'millimeter', drawingId: fixture.drawingId,
      updates: [{ holeId: 'TEST-A', station: 0 }, { holeId: 'TEST-B', station: 0 }] })
    assert.equal(result.ok, false)
    assert.match(JSON.stringify(result.error), /station|distinct|duplicate|increas/i)
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
  } finally { fixture.dispose() }
})

test('output protocols are placeholders and unrelated/sequence cases stay not evaluated', async () => {
  const noOp = scenarios.get(NEXT_ORACLE_SCENARIO_IDS.find(id => id.includes('no-op-redraw')))
  assert.ok(nextScenarioAnswerFrame(noOp).includes('"sourceGeometryConsistent":false'))
  assert.ok(!nextScenarioAnswerFrame(noOp).includes('TEST-A'))
  const mutation = scenarios.get(NEXT_ORACLE_SCENARIO_IDS.find(id => id.includes('dated-groundwater')))
  assert.equal(nextScenarioAnswerFrame(mutation), null)
  const sequence = corpus.scenarios.find(scenario => scenario.sequence)
  assert.equal(assessNextScenarioReadiness(sequence).status, 'not-ready')
  await assert.rejects(buildNextScenarioFixture(sequence), /unsupported prerequisites/)
})

test('oracle reference geometry never appears in enumerable fixture or caller input bindings', async () => {
  const scenario = scenarios.get(NEXT_ORACLE_SCENARIO_IDS.find(id => id.endsWith('-zh-direct') && id.includes('dated-groundwater')))
  const fixture = await buildNextScenarioFixture(scenario)
  try {
    assert.ok(fixture.oracleExpectedCommittedState)
    assert.equal(Object.keys(fixture).includes('oracleExpectedCommittedState'), false)
    const binding = nextScenarioFixtureInputBindings(fixture)
    assert.equal(Object.keys(binding).includes('oracleExpectedCommittedState'), false)
    assert.ok(!JSON.stringify(binding).includes('2026-09-02'))
    assert.equal(typeof evaluateNextScenarioOracle(scenario, fixture, null)?.then, 'undefined', 'verdict is synchronous after the detached fixture build')
  } finally { fixture.dispose() }
})

test('exact committed oracle rejects changed unrequested geometry and reports source drift without crashing a batch', async () => {
  const scenario = scenarios.get(NEXT_ORACLE_SCENARIO_IDS.find(id => id.endsWith('-zh-direct') && id.includes('dated-groundwater')))
  const fixture = await buildNextScenarioFixture(scenario)
  try {
    const trace = traceFor(fixture), gold = expectedNextScenarioOutcome(scenario, fixture)
    const proposal = await collectNativeProposal(trace, fixture, gold)
    const receipt = await trace.session.approve(proposal.planId, 'native-next-adversarial-selftest')
    assert.equal(receipt.ok, true)
    const evidence = { origin: 'fixture-oracle-selftest', toolCalls: trace.calls, proposal, stage: 'committed',
      approvalReceipt: receipt, approvedPlanId: proposal.planId, afterDocument: fixture.document }
    assert.equal(evaluateNextScenarioOracle(scenario, fixture, evidence).status, 'satisfied')
    const unrequested = clone(fixture.document.snapshot())
    unrequested.objects['CIRCLE-MANUAL'].payload.radius = 9
    const wrongManual = await fixture.sdk.readDocument(JSON.stringify(unrequested), { format: 'KJD' })
    const manualVerdict = evaluateNextScenarioOracle(scenario, fixture, { ...evidence, afterDocument: wrongManual })
    assert.equal(manualVerdict.status, 'failed')
    assert.ok(manualVerdict.assertions.some(item => item.id === 'exact-full-native-state-after-commit' && !item.satisfied))
    const drifted = clone(fixture.document.snapshot())
    const generatedText = readGeologyDrawingRecipe(fixture.document, fixture.drawingId).entityIds.find(id => drifted.objects[id]?.type === 'TEXT')
    drifted.objects[generatedText].payload.text = 'Unrequested generated text drift'
    const wrongSource = await fixture.sdk.readDocument(JSON.stringify(drifted), { format: 'KJD' })
    const driftVerdict = evaluateNextScenarioOracle(scenario, fixture, { ...evidence, afterDocument: wrongSource })
    assert.equal(driftVerdict.status, 'failed')
    assert.ok(driftVerdict.assertions.some(item => item.id === 'exact-source-facts-and-generated-native-geometry' && !item.satisfied))
  } finally { fixture.dispose() }
})
