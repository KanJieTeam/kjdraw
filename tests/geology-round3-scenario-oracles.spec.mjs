import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { ROUND3_SCENARIO_DESCRIPTORS, ROUND3_ORACLE_SCENARIO_IDS, ROUND3_PRODUCT_GAPS,
  assessRound3ScenarioReadiness, buildRound3ScenarioFixture, round3ScenarioDescriptor, round3ScenarioAnswerFrame,
  round3ScenarioFixtureInputBindings, expectedRound3ScenarioAnswer, expectedRound3ScenarioOutcome,
  evaluateRound3ScenarioOracle } from '../scripts/testing/helpers/geology-round3-scenario-oracles.mjs'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologySection, compileGeologyColumn } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = new Map(corpus.scenarios.map(scenario => [scenario.id, scenario]))
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const direct = intent => corpus.scenarios.find(scenario => scenario.expected.intent === intent && scenario.language === 'zh-CN' && scenario.interaction === 'direct')

function traceFor(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args, expectedOk = true) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, expectedOk, JSON.stringify(result.error))
    return expectedOk ? result.value : result.error
  } }
}

async function sourceEvidence(trace, fixture, descriptor) {
  if (descriptor.fixtureBranch === 'actual-generated-line-manual-drift') {
    await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: '', maxBytes: 262144 })
    const error = await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 }, false)
    assert.ok(fixture.oracleDriftedEntityIds.every(id => error.message.includes(id)))
    return
  }
  await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 })
}

async function proposalEvidence(trace, fixture, gold) {
  const before = gold.beforeSource.input.hole, after = gold.afterSource.input.hole
  const update = { holeId: after.id }
  for (const field of Object.keys(after)) if (field !== 'id' && !same(before[field], after[field])) update[field] = clone(after[field])
  return trace.call('cad_propose_geology_revision', { expectedRevision: fixture.initialRevision, units: 'millimeter', drawingId: fixture.drawingId, updates: [update] })
}

function semanticReferences(value, document) {
  if (Array.isArray(value)) return value.map(item => semanticReferences(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, semanticReferences(item, document)]))
  const referenced = typeof value === 'string' ? document.getObject(value) : null
  if (!referenced) return value
  // DXF table IDs/handles are reallocated; entity handles are retained. Compare
  // resource identity by type/name AND separately compare every resource field.
  return referenced.kind === 'entity' ? { entityHandle: referenced.handle } : { resourceType: referenced.type, resourceName: referenced.name }
}

const hatchTransportCodes = new Set([5, 330, 100, 8, 10, 20, 30, 2, 70, 71, 91, 92, 72, 73, 93, 97, 75, 76, 52, 41, 77, 78, 53, 43, 44, 45, 46, 79, 49])
function geometryByHandle(document) {
  return document.listEntities().map(entity => {
    const payload = clone(entity.payload)
    if (entity.type === 'HATCH') {
      // Raw tags are imported transport evidence, not an extra geometric field.
      // Fail on any code outside this fixture's explicit supported DXF grammar.
      if (payload.rawTags) assert.ok(payload.rawTags.every(tag => hatchTransportCodes.has(tag.code)), 'Undeclared HATCH tag cannot be dropped from round-trip evidence')
      delete payload.rawTags
      payload.associative ??= false
      payload.boundaryLoops = payload.boundaryLoops.map(loop => ({ ...loop, flags: loop.flags ?? (2 | (loop.external ? 1 : 0)) }))
      payload.patternLines = payload.patternLines?.map(line => ({ ...line,
        // A whole-turn rotation is equivalent. Precision is bounded only for
        // this angle representation, never coordinates, elevations or spacing.
        angle: Number((((line.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toFixed(12)),
      }))
    }
    return { handle: entity.handle, type: entity.type, payload: semanticReferences(payload, document) }
  }).sort((a, b) => a.handle.localeCompare(b.handle))
}

function resourcesByName(document) {
  return ['layers', 'textStyles', 'linetypes'].map(table => ({ table,
    records: document.getTable(table).records.map(record => ({ type: record.type, name: record.name, payload: semanticReferences(record.payload, document) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

function geometryDifferences(before, after) {
  const byHandle = new Map(before.map(entity => [entity.handle, entity]))
  const differences = after.flatMap(entity => {
    const previous = byHandle.get(entity.handle)
    if (!previous) return [{ handle: entity.handle, issue: 'unexpected-entity-handle' }]
    const fields = [...new Set([...Object.keys(previous.payload), ...Object.keys(entity.payload)])]
      .filter(field => !same(previous.payload[field], entity.payload[field]))
      .map(field => ({ field, before: previous.payload[field], after: entity.payload[field] }))
    return previous.type !== entity.type || fields.length ? [{ handle: entity.handle, type: entity.type, fields }] : []
  })
  if (before.length !== after.length) differences.push({ issue: 'entity-count-changed', before: before.length, after: after.length })
  return differences
}

test('round3 covers 8 previously unimplemented frozen families and 48 original variants, not a live model pass', () => {
  assert.equal(ROUND3_SCENARIO_DESCRIPTORS.length, 8)
  assert.equal(ROUND3_ORACLE_SCENARIO_IDS.length, 48)
  assert.equal(new Set(ROUND3_ORACLE_SCENARIO_IDS).size, 48)
  assert.ok(ROUND3_ORACLE_SCENARIO_IDS.every(id => assessRound3ScenarioReadiness(id).status === 'runnable'))
  assert.ok(ROUND3_PRODUCT_GAPS.every(gap => gap.status.includes('missing') || gap.status.includes('rejects')))
  assert.equal(round3ScenarioDescriptor('unknown.intent'), null)
  assert.equal(assessRound3ScenarioReadiness(corpus.scenarios.find(scenario => scenario.sequence)).status, 'not-ready')
})

// Native engine self-tests use explicit input records, never interpret prose,
// call a provider, or add to real-model userScenarioPasses.
for (const id of ROUND3_ORACLE_SCENARIO_IDS) {
  const scenario = scenarios.get(id), descriptor = round3ScenarioDescriptor(scenario)
  test(`round3 exact native fixture/oracle self-test, zero model calls: ${id}`, async () => {
    const fixture = await buildRound3ScenarioFixture(scenario)
    try {
      assert.equal(fixture.modelCalls, 0)
      assert.equal(fixture.scenarioExecuted, false)
      assert.equal(fixture.document.validate().valid, true)
      assert.ok(fixture.document.listEntities({ type: 'HATCH' }).length > 0)
      const expectedSeedCount = ['followup', 'correction'].includes(scenario.interaction) ? 1 : 0
      assert.equal(fixture.conversationSeed.length, expectedSeedCount)
      if (expectedSeedCount) {
        assert.ok(fixture.conversationSeed[0].content.includes(fixture.document.id))
        assert.ok(fixture.conversationSeed[0].content.includes(`revision ${fixture.initialRevision}`))
      }
      const trace = traceFor(fixture), gold = expectedRound3ScenarioOutcome(scenario, fixture)
      await sourceEvidence(trace, fixture, descriptor)
      const base = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls }
      if (descriptor.kind === 'read-only') {
        const evidence = { ...base, answer: expectedRound3ScenarioAnswer(scenario, fixture) }
        const verdict = evaluateRound3ScenarioOracle(scenario, fixture, evidence)
        assert.equal(verdict.status, 'satisfied', JSON.stringify(verdict.assertions.filter(item => !item.satisfied)))
        assert.equal(verdict.scenarioPassed, null)
        assert.equal(verdict.scenarioExecuted, false)
        assert.equal(evaluateRound3ScenarioOracle(scenario, fixture, { ...evidence, answer: {} }).status, 'failed')
        assert.equal(evaluateRound3ScenarioOracle(scenario, fixture, { ...evidence, toolCalls: [] }).status, 'not-evaluated')
        assert.equal(evaluateRound3ScenarioOracle(scenario, fixture, { ...evidence, origin: 'real-model', rawFinalAnswer: 'Looks fine.' }).status, 'not-evaluated')
      } else {
        const proposal = await proposalEvidence(trace, fixture, gold)
        const evidence = { ...base, proposal, stage: 'pending-preview' }
        const pending = evaluateRound3ScenarioOracle(scenario, fixture, evidence)
        assert.equal(pending.status, 'satisfied', JSON.stringify(pending.assertions.filter(item => !item.satisfied)))
        assert.equal(pending.scenarioPassed, null)
        assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
        const tampered = clone(proposal)
        tampered.preview.after[0].payload.oracleTamper = true
        assert.equal(evaluateRound3ScenarioOracle(scenario, fixture, { ...evidence, proposal: tampered }).status, 'failed')
        const receipt = await trace.session.approve(proposal.planId, 'native-round3-fixture-selftest')
        assert.equal(receipt.ok, true, JSON.stringify(receipt.error))
        const committed = { ...evidence, stage: 'committed', approvalReceipt: receipt, approvedPlanId: proposal.planId }
        const verdict = evaluateRound3ScenarioOracle(scenario, fixture, committed)
        assert.equal(verdict.status, 'satisfied', JSON.stringify(verdict.assertions.filter(item => !item.satisfied)))
        assert.equal(verdict.scenarioPassed, null)
        assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, gold.afterSource)
        assert.equal(fixture.document.history.undoCount, 1)
        const approvedState = fixtureStateSignature(fixture.document), editedFingerprint = fixture.document.fingerprint()
        assert.equal((await trace.session.approve(proposal.planId, 'native-round3-replay-selftest')).ok, false)
        assert.equal(fixtureStateSignature(fixture.document), approvedState)
        const undoRead = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
        const undo = await trace.call('cad_propose_undo', { expectedRevision: fixture.document.revision, units: 'millimeter', targetHistoryId: undoRead.history.undoTarget.id })
        assert.equal(fixtureStateSignature(fixture.document), approvedState)
        assert.equal((await trace.session.approve(undo.planId, 'native-round3-history-selftest')).ok, true)
        assert.equal(fixture.document.fingerprint(), fixture.oracleBaselineDocument.fingerprint())
        assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
        const redoRead = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
        const redo = await trace.call('cad_propose_redo', { expectedRevision: fixture.document.revision, units: 'millimeter', targetHistoryId: redoRead.history.redoTarget.id })
        assert.equal((await trace.session.approve(redo.planId, 'native-round3-history-selftest')).ok, true)
        assert.equal(fixture.document.fingerprint(), editedFingerprint)
        for (const alias of ['CIRCLE-MANUAL', 'NOTE-MANUAL']) assert.deepEqual(fixture.document.getObject(alias), fixture.oracleBaselineDocument.getObject(alias))
      }
      const bytes = await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })
      const recovered = await fixture.sdk.readDocument(bytes, { format: 'KJD' })
      assert.equal(canonicalStringify(recovered.snapshot()), canonicalStringify(fixture.document.snapshot()), 'KJD recovers every serialized native state field')
    } finally { fixture.dispose() }
  })
}

for (const descriptor of ROUND3_SCENARIO_DESCRIPTORS) {
  test(`round3 complete native DXF geometry/handle recovery: ${descriptor.intent}`, async () => {
    const scenario = direct(descriptor.intent), fixture = await buildRound3ScenarioFixture(scenario)
    try {
      if (descriptor.kind === 'source') {
        const trace = traceFor(fixture), gold = expectedRound3ScenarioOutcome(scenario, fixture)
        await sourceEvidence(trace, fixture, descriptor)
        const proposal = await proposalEvidence(trace, fixture, gold)
        assert.equal((await trace.session.approve(proposal.planId, 'native-round3-dxf-selftest')).ok, true)
      }
      const bytes = await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' })
      const recovered = await fixture.sdk.readDocument(bytes, { format: 'DXF' })
      assert.equal(recovered.validate().valid, true)
      assert.equal(recovered.listEntities({ type: 'HATCH' }).length, fixture.document.listEntities({ type: 'HATCH' }).length)
      const geometryDiff = geometryDifferences(geometryByHandle(fixture.document), geometryByHandle(recovered))
      assert.deepEqual(geometryDiff, [], 'Every supported entity payload/reference must match by original entity handle and explicit DXF semantic defaults; UUIDs/table handles are not compared')
      assert.equal(canonicalStringify(resourcesByName(recovered)), canonicalStringify(resourcesByName(fixture.document)),
        'All resource names, layer protections, linetypes, text styles and resolved references remain exact')
    } finally { fixture.dispose() }
  })
}

test('round3 input bindings contain whole raw caller tables but no expected answers or oracle reference states', async () => {
  for (const descriptor of ROUND3_SCENARIO_DESCRIPTORS) {
    const scenario = direct(descriptor.intent), fixture = await buildRound3ScenarioFixture(scenario)
    try {
      const bindings = round3ScenarioFixtureInputBindings(fixture)
      for (const key of ['expected', 'gold', 'answer', 'oracleExpectedCommittedState', 'oracleDriftedEntityIds', 'round3OracleDescriptorId']) {
        assert.equal(Object.hasOwn(bindings, key), false)
        assert.equal(Object.keys(fixture).includes(key), false)
      }
      if (descriptor.kind === 'source') {
        assert.equal(round3ScenarioAnswerFrame(scenario), null)
        assert.equal(typeof evaluateRound3ScenarioOracle(scenario, fixture, null)?.then, 'undefined')
      }
      if (descriptor.intent === 'geological-presentation.source-pattern-label') assert.ok(!JSON.stringify(bindings).includes('粉质黏土'))
      if (bindings.suppliedInputs?.sptRecordTable) {
        assert.equal(bindings.suppliedInputs.sptRecordTable.rows.length, 2)
        assert.equal(Object.hasOwn(bindings.suppliedInputs.sptRecordTable.rows[1], 'value'), false)
        assert.equal(fixture.source.input.holes[1].observations.some(item => item.kind === 'spt'), false)
      }
      if (bindings.suppliedInputs?.locationTable) assert.equal(bindings.suppliedInputs.locationTable.rows.length, 2)
    } finally { fixture.dispose() }
  }
})

test('hatch visibility preserves rock facts while pattern labels use declared rendering styles, not lithology replacement', async () => {
  for (const intent of ['geological-presentation.declared-hatch-visibility', 'geological-presentation.source-pattern-label']) {
    const fixture = await buildRound3ScenarioFixture(direct(intent))
    try {
      const gold = expectedRound3ScenarioOutcome(direct(intent), fixture)
      const stripped = source => source.input.hole.strata.map(({ patternVisibility, patternLabel, ...facts }) => facts)
      assert.deepEqual(stripped(gold.afterSource), stripped(gold.beforeSource))
      if (intent.endsWith('declared-hatch-visibility')) {
        assert.equal(gold.beforeSource.input.hole.strata[2].patternVisibility, 'boundary-only')
        assert.equal(gold.afterSource.input.hole.strata[2].patternVisibility, 'filled')
        assert.equal(gold.after.filter(entity => entity.type === 'HATCH').length, 1)
      } else assert.equal(gold.after.filter(entity => entity.type === 'TEXT' && entity.payload.text === '粉质黏土').length, 1)
    } finally { fixture.dispose() }
  }
})

test('read audits accept row order and unit spelling only, rejecting missing counts filled with zero or numeric rescaling', async () => {
  for (const intent of ['investigation-preparation.layer-thickness-audit', 'investigation-preparation.source-unit-audit', 'investigation-preparation.spt-record-completeness']) {
    const scenario = direct(intent), fixture = await buildRound3ScenarioFixture(scenario)
    try {
      const trace = traceFor(fixture)
      await sourceEvidence(trace, fixture, round3ScenarioDescriptor(scenario))
      const answer = expectedRound3ScenarioAnswer(scenario, fixture), reordered = clone(answer)
      if (reordered.holes) { reordered.holes.reverse(); reordered.holes.forEach(hole => hole.strata.reverse()); reordered.units = 'metre' }
      if (reordered.records) { reordered.records.reverse(); reordered.units = 'm' }
      if (reordered.conflicts) { reordered.conflicts.reverse(); reordered.sourceUnits = 'metre'; reordered.cadUnits = 'mm' }
      const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls, answer: reordered }
      assert.equal(evaluateRound3ScenarioOracle(scenario, fixture, evidence).status, 'satisfied')
      const wrong = clone(answer)
      if (wrong.records) wrong.records[1].value = 0
      else if (wrong.holes) wrong.holes[0].totalThickness *= 1000
      else wrong.conflicts[0].value /= 1000
      assert.equal(evaluateRound3ScenarioOracle(scenario, fixture, { ...evidence, answer: wrong }).status, 'failed')
    } finally { fixture.dispose() }
  }
})

test('source/series/date/layout product gaps are demonstrated by actual schemas and compilers, not marked supported', async () => {
  const revision = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_geology_revision').inputSchema
  for (const field of ['horizontalScaleDenominator', 'verticalScaleDenominator', 'datumElevation']) assert.equal(Object.hasOwn(revision.properties, field), false)
  const hole = revision.properties.updates.items.properties
  for (const field of ['startDate', 'endDate']) assert.equal(Object.hasOwn(hole, field), false)
  for (const field of ['rangeTop', 'rangeBottom', 'measurements']) assert.equal(Object.hasOwn(hole.observations.items.properties, field), false)
  const fixture = await buildRound3ScenarioFixture(direct('investigation-preparation.layer-thickness-audit'))
  try {
    const input = clone(fixture.source.input)
    input.holes[0].groundwaterObservations = [{ depth: 4.5, elevation: 102, observedOn: '2026-09-02', marker: 'filled-down-triangle' }]
    assert.throws(() => compileGeologySection(input), /groundwater.*column layouts/i)
    const column = { expectedRevision: 0, units: 'millimeter', hole: clone(fixture.source.input.holes[0]) }
    delete column.hole.groundwaterObservations
    delete column.hole.observations.find(item => item.kind === 'spt').value
    assert.throws(() => compileGeologyColumn(column), /SPT needs a nonnegative measured result/)
  } finally { fixture.dispose() }
})

test('exact source commit rejects unrequested manual changes and any generated drift without crashing the batch', async () => {
  const scenario = direct('geological-presentation.declared-hatch-visibility'), fixture = await buildRound3ScenarioFixture(scenario)
  try {
    const trace = traceFor(fixture), gold = expectedRound3ScenarioOutcome(scenario, fixture)
    await sourceEvidence(trace, fixture, round3ScenarioDescriptor(scenario))
    const proposal = await proposalEvidence(trace, fixture, gold)
    const receipt = await trace.session.approve(proposal.planId, 'native-round3-adversarial-selftest')
    assert.equal(receipt.ok, true)
    const evidence = { origin: 'fixture-oracle-selftest', toolCalls: trace.calls, proposal, stage: 'committed',
      approvalReceipt: receipt, approvedPlanId: proposal.planId, afterDocument: fixture.document }
    assert.equal(evaluateRound3ScenarioOracle(scenario, fixture, evidence).status, 'satisfied')
    for (const target of ['NOTE-MANUAL', gold.nextRecipe.entityIds.find(id => fixture.document.getObject(id).type === 'TEXT')]) {
      const state = clone(fixture.document.snapshot())
      state.objects[target].payload.text += ' unrequested change'
      const changed = await fixture.sdk.readDocument(JSON.stringify(state), { format: 'KJD' })
      const verdict = evaluateRound3ScenarioOracle(scenario, fixture, { ...evidence, afterDocument: changed })
      assert.equal(verdict.status, 'failed')
      assert.ok(verdict.assertions.some(item => item.id === 'exact-full-native-state-after-commit' && !item.satisfied))
    }
  } finally { fixture.dispose() }
})
