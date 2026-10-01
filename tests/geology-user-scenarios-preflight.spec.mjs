import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { INITIAL_BATCH_SCENARIO_IDS, VERIFIED_SCENARIO_IDS, assessScenarioReadiness, buildScenarioFixture, expectedScenarioAnswer,
  expectedScenarioOutcome, evaluateScenarioOracle, runGeologyScenarioPreflight, scenarioAnswerFrame } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { PUBLIC_FIXTURE_IDS, buildPublicScenarioFixture, fixtureStateSignature, scenarioFixtureInputBindings } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarioById = new Map(corpus.scenarios.map(scenario => [scenario.id, scenario]))
const clone = structuredClone

// These explicit SDK commands test fixtures/oracles, not natural-language model ability.
// Nothing in this file executes a prompt, calls a model, or produces a user-scenario pass.
function selftestSession(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}

async function collectReads(scenario, fixture, trace) {
  const rev = fixture.initialRevision, intent = scenario.expected.intent
  if (intent.startsWith('invalid-source.') || intent === 'ambiguity.thickness-target-unspecified' || intent === 'source-section.no-op-redraw') {
    await trace.call('cad_read_geology_source', { expectedRevision: rev, drawingId: fixture.drawingId, maxBytes: 262144 })
    return
  }
  if (intent.startsWith('source-query.')) {
    await trace.call('cad_read_geology_source', { expectedRevision: rev,
      drawingId: intent === 'source-query.list-source-recipes' ? '' : fixture.drawingId, maxBytes: 262144 })
    return
  }
  if (intent === 'cad-query.inventory') {
    let offset = 0
    do {
      const result = await trace.call('cad_query_drawing', { expectedRevision: rev, filters: {}, offset, layerOffset: 0, limit: 4, maxLayers: 100, maxBytes: 262144 })
      offset = result.nextOffset
    } while (offset !== null)
  } else if (intent === 'cad-query.raw-mtext') {
    await trace.call('cad_query_drawing', { expectedRevision: rev, filters: { ids: [fixture.identityAliases['MTEXT-A'].nativeId] }, offset: 0, layerOffset: 0, limit: 20, maxLayers: 100, maxBytes: 262144 })
  } else {
    let offset = 0
    do {
      const result = await trace.call('cad_find_text', { expectedRevision: rev, search: intent === 'cad-query.exact-hole-label' ? 'TEST-A' : scenario.language === 'en' ? 'groundwater' : '地下水',
        match: intent === 'cad-query.exact-hole-label' ? 'exact' : 'contains', caseSensitive: false, offset, limit: 1, maxBytes: 262144 })
      offset = result.nextOffset
    } while (offset !== null)
  }
}

async function collectProposal(scenario, fixture, trace, gold) {
  const base = { expectedRevision: fixture.initialRevision, units: 'millimeter' }, intent = scenario.expected.intent
  if (gold.kind === 'source') {
    await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 })
    const beforeHoles = gold.beforeSource.kind === 'column' ? [gold.beforeSource.input.hole] : gold.beforeSource.input.holes
    const afterHoles = gold.afterSource.kind === 'column' ? [gold.afterSource.input.hole] : gold.afterSource.input.holes
    const updates = afterHoles.flatMap(hole => {
      const before = beforeHoles.find(item => item.id === hole.id), update = { holeId: hole.id }
      for (const key of Object.keys(hole)) if (key !== 'id' && canonicalStringify(hole[key]) !== canonicalStringify(before[key])) update[key] = clone(hole[key])
      const clearFields = Object.keys(before).filter(key => key !== 'id' && !Object.hasOwn(hole, key))
      if (clearFields.length) update.clearFields = clearFields
      return Object.keys(update).length > 1 ? [update] : []
    })
    const sectionChanges = {}
    if (gold.afterSource.kind === 'section') for (const key of ['correlations', 'uncorrelatedOccurrences']) {
      if (canonicalStringify(gold.afterSource.input[key]) !== canonicalStringify(gold.beforeSource.input[key])) sectionChanges[key] = clone(gold.afterSource.input[key])
    }
    // The API requires at least one declared hole update, even for a link-only revision.
    if (!updates.length && Object.keys(sectionChanges).length) updates.push({ holeId: afterHoles[0].id, strata: clone(afterHoles[0].strata) })
    return trace.call('cad_propose_geology_revision', { ...base, drawingId: fixture.drawingId, updates, ...sectionChanges })
  }
  await trace.call('cad_query_drawing', { expectedRevision: fixture.initialRevision, filters: { ids: gold.targetIds }, offset: 0, layerOffset: 0, limit: 64, maxLayers: 100, maxBytes: 262144 })
  if (intent.startsWith('cad-annotation.')) return trace.call('cad_propose_text_edit', { ...base, changes: gold.after.map(entity => ({ id: entity.id,
    expectedText: gold.before.find(item => item.id === entity.id).payload.text, text: entity.payload.text })) })
  if (intent === 'cad-transform.move-exact-objects') return trace.call('cad_propose_move', { ...base, ids: gold.targetIds, dx: 10, dy: 0 })
  if (intent === 'geological-presentation.manual-title-layout-change') return trace.call('cad_propose_move', { ...base, ids: gold.targetIds, dx: 0, dy: 5 })
  if (intent === 'cad-transform.rotate-selected-detail') return trace.call('cad_propose_rotate', { ...base, ids: gold.targetIds, center: { x: 0, y: 0 }, angleDegrees: 90 })
  if (intent === 'cad-transform.circle-radius') return trace.call('cad_propose_set_circle_radius', { ...base, id: gold.targetIds[0], radius: 6 })
  if (intent === 'cad-transform.crossing-window-stretch') return trace.call('cad_propose_stretch', { ...base, ids: gold.targetIds, crossingStart: { x: 8, y: -1 }, crossingEnd: { x: 12, y: 11 }, dx: 3, dy: 0 })
  if (intent === 'cad-structure.relayer-confirmed-objects') return trace.call('cad_propose_relayer', { ...base, ids: gold.targetIds, layerId: gold.after[0].payload.layerId, maxBytes: 262144 })
  if (intent === 'cad-structure.insert-polyline-vertex') return trace.call('cad_propose_polyline_edit', { ...base, id: gold.targetIds[0], operation: 'INSERT', segmentIndex: 0, point: { x: 5, y: 0 } })
  if (intent === 'cad-structure.edit-polyline-bulge') return trace.call('cad_propose_polyline_edit', { ...base, id: gold.targetIds[0], operation: 'SET_BULGE', segmentIndex: 0, sweepDegrees: 45 })
  if (intent === 'cad-structure.edit-polyline-width') return trace.call('cad_propose_polyline_edit', { ...base, id: gold.targetIds[0], operation: 'SET_WIDTH', segmentIndex: 0, startWidth: 0.5, endWidth: 1 })
  throw new Error(`No explicit fixture-selftest command: ${intent}`)
}

test('1080-row read-only preflight probes every declared verified fixture branch without claiming model execution', async () => {
  const report = await runGeologyScenarioPreflight()
  assert.equal(report.total, 1080)
  const declaredRunnable = VERIFIED_SCENARIO_IDS.filter(id => assessScenarioReadiness(id).status === 'runnable')
  assert.deepEqual(report.scenarios.filter(item => item.status === 'runnable').map(item => item.id), declaredRunnable)
  assert.equal(report.runnable, declaredRunnable.length)
  assert.equal(report.notReady, report.total - declaredRunnable.length)
  assert.ok(report.runnable >= 174, 'existing fully specified families must not regress')
  assert.equal(report.modelCalls, 0)
  assert.equal(report.userScenarioExecutions, 0)
  assert.equal(report.userScenarioPasses, null)
  assert.equal(report.executionStatus, 'not-run')
  assert.deepEqual(report.fixtureProbes.filter(item => !item.branch).map(item => item.actualReadFormat), ['DXF', 'KJD', 'KJD'])
  assert.equal(report.fixtureProbes.filter(item => item.branch).length, 15)
  assert.ok(report.fixtureProbes.every(item => item.status === 'built-and-validated'))
})

for (const id of VERIFIED_SCENARIO_IDS) {
  const scenario = scenarioById.get(id)
  test(`exact executable fixture/oracle selftest, never a model pass: ${scenario.id}`, async () => {
    if (assessScenarioReadiness(scenario).status === 'not-ready') {
      assert.equal(scenario.expected.intent, 'cad-annotation.printed-water-labels')
      assert.ok(assessScenarioReadiness(scenario).reasons.some(item => item.code === 'task-literal-target-semantics-unconfirmed'))
      return
    }
    const fixture = await buildScenarioFixture(scenario)
    try {
      const trace = selftestSession(fixture), gold = expectedScenarioOutcome(scenario, fixture)
      assert.equal(fixture.scenarioExecuted, false)
      assert.equal(fixture.conversationSeed.length, ['followup', 'correction'].includes(scenario.interaction) ? 1 : 0)
      if (fixture.conversationSeed.length) {
        assert.ok(fixture.conversationSeed[0].content.includes(fixture.document.id))
        assert.ok(fixture.conversationSeed[0].content.includes(`revision ${fixture.initialRevision}`))
        assert.ok(fixture.conversationSeed[0].content.includes(scenario.interaction === 'correction' ? 'Do NOT execute' : 'No action has been executed'))
      }
      if (gold.kind === 'read-only') {
        await collectReads(scenario, fixture, trace)
        const answer = expectedScenarioAnswer(scenario, fixture)
        if (answer.decision && answer.missingFields) answer.questions = answer.missingFields.map(field => ({ field, question: `Please supply ${field}.` }))
        const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls, answer }
        const result = evaluateScenarioOracle(scenario, fixture, evidence)
        assert.equal(result.status, 'satisfied', JSON.stringify(result.assertions.filter(item => !item.satisfied)))
        assert.equal(result.scenarioPassed, null)
        assert.equal(result.scenarioExecuted, false)
        const wrong = { ...evidence, answer: { incorrectSyntheticAnswer: true } }
        assert.equal(evaluateScenarioOracle(scenario, fixture, wrong).status, 'failed')
        assert.equal(evaluateScenarioOracle(scenario, fixture, { ...evidence, toolCalls: [] }).status, 'not-evaluated')
      } else {
        const proposal = await collectProposal(scenario, fixture, trace, gold)
        const pending = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, proposal, stage: 'pending-preview', toolCalls: trace.calls }
        const before = evaluateScenarioOracle(scenario, fixture, pending)
        assert.equal(before.status, 'satisfied', JSON.stringify(before.assertions.filter(item => !item.satisfied)))
        assert.equal(before.scenarioPassed, null)
        assert.equal(fixtureStateSignature(fixture.document), fixture.initialState, 'pending preview must not execute the task')
        const altered = clone(proposal)
        if (altered.preview.after.length) altered.preview.after[0].payload.fixtureOracleTamper = true
        else altered.preview.after.push({ id: 'UNREQUESTED-ORACLE-TAMPER', type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 1 } })
        assert.equal(evaluateScenarioOracle(scenario, fixture, { ...pending, proposal: altered }).status, 'failed', 'exact oracle rejects a wrong full preview')
        assert.equal(evaluateScenarioOracle(scenario, fixture, { ...pending, toolCalls: [] }).status, 'failed', 'a description alone is not actual SDK evidence')
        const approvalReceipt = await trace.session.approve(proposal.planId, 'public-fixture-oracle-selftest')
        assert.equal(approvalReceipt.ok, true, JSON.stringify(approvalReceipt.error))
        const after = evaluateScenarioOracle(scenario, fixture, { ...pending, stage: 'committed', approvalReceipt, approvedPlanId: proposal.planId })
        assert.equal(after.status, 'satisfied', JSON.stringify(after.assertions.filter(item => !item.satisfied)))
        assert.equal(after.scenarioPassed, null, 'synthetic SDK oracle selftest cannot masquerade as a real model result')
        assert.equal(fixture.document.validate().valid, true)
        if (gold.kind === 'source') assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, gold.afterSource)
      }
    } finally { fixture.dispose() }
  })
}

test('DXF construction actually reopens and rebinds handles rather than assuming UUID retention', async () => {
  const fixture = await buildPublicScenarioFixture(PUBLIC_FIXTURE_IDS[0])
  try {
    assert.equal(fixture.artifact.format, 'DXF')
    assert.equal(fixture.sourceRecipePresent, false)
    assert.equal(fixture.document.listEntities().length, 13)
    for (const alias of Object.values(fixture.identityAliases)) {
      assert.equal(fixture.document.getObject(alias.nativeId).handle, alias.handle)
      assert.notEqual(alias.nativeId, alias.originalId)
    }
    const session = new KJAgentToolSession(fixture.sdk, fixture.document)
    const source = await session.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: '', maxBytes: 262144 })
    assert.equal(source.ok, true)
    assert.equal(source.value.drawingIds.length, 0, 'printed geological labels do not fabricate a source recipe')
    assert.equal(source.value.sourceBacked, false)
  } finally { fixture.dispose() }
})

test('missing precondition branches and browser lifecycle adapters remain honestly not-ready', async () => {
  const notReady = corpus.scenarios.filter(item => assessScenarioReadiness(item).status === 'not-ready')
  assert.equal(notReady.length, corpus.scenarios.length - VERIFIED_SCENARIO_IDS.filter(id => assessScenarioReadiness(id).status === 'runnable').length)
  const missingBranch = notReady.find(item => assessScenarioReadiness(item).reasons.some(reason => reason.code === 'prerequisite-branch-not-built'))
  assert.ok(missingBranch)
  await assert.rejects(buildScenarioFixture(missingBranch), /Unimplemented prerequisite branches/)
  assert.ok(notReady.some(item => assessScenarioReadiness(item).reasons.some(reason => reason.code === 'host-session-export-action-not-available')))
  assert.ok(notReady.every(item => assessScenarioReadiness(item).reasons.some(reason => ['exact-outcome-oracle-not-implemented', 'task-literal-target-semantics-unconfirmed'].includes(reason.code))))
})

test('no actual execution evidence or mismatched raw model answer can count as a pass', async () => {
  const scenario = scenarioById.get(INITIAL_BATCH_SCENARIO_IDS[0]), fixture = await buildScenarioFixture(scenario)
  try {
    assert.equal(evaluateScenarioOracle(scenario, fixture, null).status, 'not-evaluated')
    const trace = selftestSession(fixture)
    await collectReads(scenario, fixture, trace)
    const answer = expectedScenarioAnswer(scenario, fixture)
    assert.equal(evaluateScenarioOracle(scenario, fixture, { origin: 'real-model', afterDocument: fixture.document, toolCalls: trace.calls,
      answer, rawFinalAnswer: 'These look correct.' }).status, 'not-evaluated')
  } finally { fixture.dispose() }
})

test('native initial discovery is valid read evidence, not a synthetic question answer', async () => {
  const scenario = scenarioById.get(INITIAL_BATCH_SCENARIO_IDS[0]), fixture = await buildScenarioFixture(scenario)
  try {
    const trace = selftestSession(fixture)
    await trace.call('cad_read_drawing', {})
    const result = evaluateScenarioOracle(scenario, fixture, { origin: 'fixture-oracle-selftest', afterDocument: fixture.document,
      toolCalls: trace.calls, answer: expectedScenarioAnswer(scenario, fixture) })
    assert.equal(result.status, 'satisfied')
    assert.equal(result.scenarioPassed, null)
  } finally { fixture.dispose() }
})

test('source pending isolation, source read provenance, exact manual preservation, undo/redo and artifact recovery', async () => {
  const scenario = scenarioById.get(INITIAL_BATCH_SCENARIO_IDS[10]), fixture = await buildScenarioFixture(scenario)
  try {
    const trace = selftestSession(fixture), gold = expectedScenarioOutcome(scenario, fixture)
    const proposal = await collectProposal(scenario, fixture, trace, gold)
    const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, proposal, phase: 'pending', toolCalls: trace.calls }
    const noSourceRead = evaluateScenarioOracle(scenario, fixture, { ...evidence, toolCalls: trace.calls.filter(call => call.name !== 'cad_read_geology_source') })
    assert.equal(noSourceRead.status, 'failed')
    assert.ok(noSourceRead.assertions.some(item => item.id === 'read-retained-source-before-revision' && !item.satisfied))
    const driftedPending = fixture.document.fork()
    await driftedPending.transact('Adversarial fixture-only drift', tx => tx.updateObject('CIRCLE-MANUAL', { payload: { ...driftedPending.getObject('CIRCLE-MANUAL').payload, radius: 8 } }))
    assert.equal(evaluateScenarioOracle(scenario, fixture, { ...evidence, afterDocument: driftedPending }).status, 'failed')
    const approval = await trace.session.approve(proposal.planId, 'public-fixture-oracle-selftest')
    const committed = { ...evidence, phase: 'committed', approvalReceipt: approval.value, approvedPlanId: proposal.planId }
    assert.equal(evaluateScenarioOracle(scenario, fixture, committed).status, 'satisfied', 'actual unwrapped runtime receipt is supported')
    assert.equal(evaluateScenarioOracle(scenario, fixture, { ...committed, approvedPlanId: 'not-the-approved-plan' }).status, 'failed')
    const driftedCommitted = fixture.document.fork()
    await driftedCommitted.transact('Adversarial fixture-only extra object', tx => tx.createEntity('CIRCLE', { center: [900, 900, 0], radius: 1 }, { id: 'UNREQUESTED-EXTRA' }))
    const rejectedExtra = evaluateScenarioOracle(scenario, fixture, { ...committed, afterDocument: driftedCommitted })
    assert.equal(rejectedExtra.status, 'failed')
    assert.ok(rejectedExtra.assertions.some(item => item.id === 'no-extra-or-missing-native-entities' && !item.satisfied))
    const missingTarget = fixture.document.fork()
    await missingTarget.transact('Adversarial fixture-only missing generated object', tx => tx.eraseObject(gold.createdIds[0], { hard: true }))
    assert.equal(evaluateScenarioOracle(scenario, fixture, { ...committed, afterDocument: missingTarget }).status, 'failed', 'missing geometry is failure, not an oracle exception')
    const afterEntities = clone(fixture.document.listEntities())
    for (const format of ['KJD', 'DXF']) {
      const reopened = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format }), { format })
      assert.equal(reopened.validate().valid, true)
      assert.equal(reopened.listEntities().length, afterEntities.length)
      assert.equal(reopened.listEntities({ type: 'HATCH' }).length, afterEntities.filter(entity => entity.type === 'HATCH').length)
      if (format === 'KJD') assert.deepEqual(readGeologyDrawingRecipe(reopened, fixture.drawingId).source, gold.afterSource)
      else {
        assert.equal(Object.hasOwn(reopened.snapshot().opaquePayloads, `geology-drawing-recipe:${fixture.drawingId}`), false)
        assert.throws(() => readGeologyDrawingRecipe(reopened, fixture.drawingId), { name: 'KJValidationError' })
      }
    }
    await fixture.sdk.executeCommand('UNDO', {}, { document: fixture.document })
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
    assert.deepEqual(fixture.document.listEntities(), fixture.initialEntities)
    await fixture.sdk.executeCommand('REDO', {}, { document: fixture.document })
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, gold.afterSource)
    assert.deepEqual(fixture.document.listEntities(), afterEntities)
  } finally { fixture.dispose() }
})

test('public fixture input alias bindings contain complete real identities and no expected answer data', async () => {
  const fixture = await buildPublicScenarioFixture(PUBLIC_FIXTURE_IDS[0])
  try {
    const bindings = scenarioFixtureInputBindings(fixture)
    assert.equal(Object.keys(bindings.aliases).length, 13)
    assert.equal(bindings.documentId, fixture.document.id)
    assert.equal(bindings.revision, fixture.initialRevision)
    for (const [alias, identity] of Object.entries(bindings.aliases)) {
      assert.deepEqual(Object.keys(identity), ['nativeId', 'handle'])
      assert.equal(fixture.document.getObject(identity.nativeId).handle, identity.handle)
      assert.equal(identity.nativeId, fixture.identityAliases[alias].nativeId)
    }
    assert.equal(JSON.stringify(bindings).includes('TEST-A复核'), false)
    assert.equal(Object.hasOwn(bindings, 'gold'), false)
    assert.equal(Object.hasOwn(bindings, 'expected'), false)
  } finally { fixture.dispose() }
})

test('new sample facts are independent of list position, while retained native identity and every record remain exact', async () => {
  const scenario = scenarioById.get(INITIAL_BATCH_SCENARIO_IDS[15])
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  for (const order of permutations) {
    const fixture = await buildScenarioFixture(scenario)
    try {
      const trace = selftestSession(fixture), gold = expectedScenarioOutcome(scenario, fixture)
      const observations = order.map(index => clone(gold.afterSource.input.hole.observations[index]))
      await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 })
      const proposal = await trace.call('cad_propose_geology_revision', { expectedRevision: fixture.initialRevision, units: 'millimeter',
        drawingId: fixture.drawingId, updates: [{ holeId: 'TEST-A', observations }] })
      const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, proposal, phase: 'pending', toolCalls: trace.calls }
      const pending = evaluateScenarioOracle(scenario, fixture, evidence)
      assert.equal(pending.status, 'satisfied', `${order}: ${JSON.stringify(pending.assertions.filter(item => !item.satisfied))}`)
      assert.equal(pending.scenarioPassed, null)
      assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
      assert.deepEqual([...proposal.unchangedIds].sort(), [...gold.unchangedIds].sort(), 'every previously unchanged native ID stays unchanged, regardless of observation list permutation')
      for (const mutate of [
        items => { items.find(item => item.id === 'S-B').depth = 6.1 },
        items => { items.find(item => item.id === 'S-A').depth = 5.1 },
        items => { items.find(item => item.id === 'N-A').value = 16 },
        items => { items.find(item => item.id === 'S-B').id = 'S-WRONG' },
        items => { items.push(clone(items[0])) },
        items => { items.splice(items.findIndex(item => item.id === 'N-A'), 1) },
      ]) {
        const wrong = clone(proposal)
        mutate(wrong.engineeringEvidence.afterSource.facts.hole.observations)
        const rejected = evaluateScenarioOracle(scenario, fixture, { ...evidence, proposal: wrong })
        assert.equal(rejected.status, 'failed')
        assert.ok(rejected.assertions.some(item => item.id === 'observation-facts-exact-order-independent' && !item.satisfied))
      }
      const approval = await trace.session.approve(proposal.planId, 'public-fixture-oracle-selftest')
      assert.equal(approval.ok, true)
      const committed = evaluateScenarioOracle(scenario, fixture, { ...evidence, phase: 'committed', approval, approvedPlanId: proposal.planId })
      assert.equal(committed.status, 'satisfied', `${order}: ${JSON.stringify(committed.assertions.filter(item => !item.satisfied))}`)
      const source = readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source
      assert.deepEqual(source.input.hole.observations, observations, 'actual accepted input ordering is retained in source recipe')
      for (const id of gold.unchangedIds) assert.deepEqual(fixture.document.getObject(id), fixture.initialEntities.find(item => item.id === id))
      assert.deepEqual(fixture.document.getObject('CIRCLE-MANUAL'), fixture.initialEntities.find(item => item.id === 'CIRCLE-MANUAL'))
    } finally { fixture.dispose() }
  }
})

test('invalid source task fixtures are independently rejected by actual revision tools with no partial edit', async () => {
  const invalidIntents = ['negative-water-depth', 'inverted-interval', 'interval-gap', 'interval-overlap',
    'duplicate-interval-identity', 'hole-depth-mismatch', 'observation-outside-hole', 'clear-and-set-same-field']
  for (const suffix of invalidIntents) {
    const scenario = corpus.scenarios.find(item => item.expected.intent === `invalid-source.${suffix}` && item.interaction === 'direct' && item.language === 'zh-CN')
    const fixture = await buildScenarioFixture(scenario)
    try {
      const session = new KJAgentToolSession(fixture.sdk, fixture.document), hole = clone(fixture.source.input.hole), update = { holeId: hole.id }
      if (suffix === 'negative-water-depth') update.initialWaterDepth = -2
      else if (suffix === 'inverted-interval') { hole.strata[1].top = 10; hole.strata[1].bottom = 3; update.strata = hole.strata }
      else if (suffix === 'interval-gap') { hole.strata[1].top = 4; update.strata = hole.strata }
      else if (suffix === 'interval-overlap') { hole.strata[0].bottom = 5; update.strata = hole.strata }
      else if (suffix === 'duplicate-interval-identity') { hole.strata[0].intervalId = hole.strata[1].intervalId; update.strata = hole.strata }
      else if (suffix === 'hole-depth-mismatch') update.depth = 12
      else if (suffix === 'observation-outside-hole') { hole.observations.push({ kind: 'sample', id: 'S-OUT', depth: 25 }); update.observations = hole.observations }
      else { update.stableWaterDepth = 4.5; update.clearFields = ['stableWaterDepth'] }
      const result = await session.call('cad_propose_geology_revision', { expectedRevision: fixture.initialRevision, units: 'millimeter', drawingId: fixture.drawingId, updates: [update] })
      assert.equal(result.ok, false, suffix)
      assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
      assert.equal(Object.hasOwn(result, 'value'), false)
      assert.equal(fixtureStateSignature(fixture.document), fixture.initialState, suffix)
      assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
    } finally { fixture.dispose() }
  }
})

test('output frames expose only schema placeholders, while caller-declared split facts are complete input data', async () => {
  const split = corpus.scenarios.find(item => item.expected.intent === 'source-section.split-with-explicit-correlations' && item.interaction === 'direct')
  const fixture = await buildScenarioFixture(split)
  try {
    const bindings = scenarioFixtureInputBindings(fixture), table = bindings.suppliedInputs.confirmedSectionSplit
    assert.equal(table.units, 'metre')
    assert.equal(table.updates.length, 2)
    assert.equal(table.correlations.length, 4)
    assert.ok(table.updates.every(item => item.strata.length === 4))
    assert.equal(Object.hasOwn(bindings, 'expected'), false)
    assert.equal(Object.hasOwn(bindings, 'gold'), false)
    for (const id of VERIFIED_SCENARIO_IDS) {
      const frame = scenarioAnswerFrame(id)
      if (frame) {
        assert.equal(frame.includes(fixture.document.id), false)
        assert.equal(frame.includes(fixture.drawingId), false)
        assert.equal(frame.includes('106.5'), false)
        assert.equal(frame.includes('102.5'), false)
        if (id.startsWith('GUS1-invalid-source.') || id.startsWith('GUS1-ambiguity.')) {
          assert.ok(frame.includes('blocked or clarification-required'), 'grammar declares both decision alternatives, not the expected decision')
        } else {
          assert.equal(frame.includes('clarification-required'), false)
          assert.equal(frame.includes('blocked'), false)
        }
      }
    }
  } finally { fixture.dispose() }
})
