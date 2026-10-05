import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { ROUND6_SOURCE_WORKFLOW_DESCRIPTORS, ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS, assessRound6SourceWorkflowReadiness,
  round6SourceWorkflowDescriptor, round6SourceWorkflowCallerInputs, buildRound6SourceWorkflowFixture,
  round6SourceWorkflowInputBindings, expectedRound6SourceWorkflowOutcome, evaluateRound6SourceWorkflowOracle,
  round6SourceWorkflowPhysicalGeometryMatches } from '../scripts/testing/helpers/geology-round6-source-workflow-oracles.mjs'
import { suppliedCreationDocumentSemantics } from '../scripts/testing/helpers/geology-supplied-creation-oracles.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const byId = new Map(corpus.scenarios.map(item => [item.id, item]))
const clone = structuredClone
const sample = intent => corpus.scenarios.find(item => item.expected.intent === intent && item.id.endsWith('-zh-direct'))
const long = 'geological-presentation.declared-long-column-sheet'
const many = 'geological-presentation.many-lithology-classes'
const water = 'batch-historical-workflow.batch-multi-hole-update'
const boundary = 'batch-historical-workflow.historical-kjd-source-recovery'
function traceFor(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}
async function nativeInputs(fixture, scenario, trace) {
  const descriptor = round6SourceWorkflowDescriptor(scenario)
  if (descriptor.kind === 'creation') {
    await trace.call('cad_read_drawing', {})
    const empty = await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: '', maxBytes: 262144 })
    assert.equal(empty.sourceBacked, false)
    assert.deepEqual(empty.drawingIds, [])
    return { version: '1.0.0', expectedRevision: fixture.initialRevision, units: 'millimeter',
      ...clone(fixture.suppliedInputs.completeColumnCreation.input) }
  }
  const current = await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision,
    drawingId: fixture.drawingId, maxBytes: 262144 })
  assert.equal(current.sourceBacked, true)
  assert.equal(current.sourceUnits, 'meter')
  const updates = fixture.suppliedInputs.confirmedMultiHoleWaterTable
    ? clone(fixture.suppliedInputs.confirmedMultiHoleWaterTable.rows)
    : [...new Set(fixture.suppliedInputs.confirmedBoundaryTable.rows.map(row => row.holeId))].map(holeId => {
      const strata = clone(current.facts.holes.find(hole => hole.id === holeId).strata)
      for (const row of fixture.suppliedInputs.confirmedBoundaryTable.rows.filter(row => row.holeId === holeId)) {
        const interval = strata.find(interval => interval.intervalId === row.intervalId)
        interval.top = row.top; interval.bottom = row.bottom
      }
      return { holeId, strata }
    })
  return { expectedRevision: fixture.initialRevision, units: 'millimeter', drawingId: fixture.drawingId, updates }
}
async function propose(fixture, scenario, trace, mutate = () => {}) {
  const args = await nativeInputs(fixture, scenario, trace)
  mutate(args)
  return trace.call(round6SourceWorkflowDescriptor(scenario).proposalTool, args)
}
const evidenceFor = (fixture, trace, proposal, extra = {}) => ({ origin: 'fixture-oracle-selftest', afterDocument: fixture.document,
  toolCalls: trace.calls, proposal, stage: 'pending-preview', ...extra })

test('exactly four existing intent families and 24 variants, all prerequisites genuinely built and no missing-data family claimed ready', () => {
  assert.equal(ROUND6_SOURCE_WORKFLOW_DESCRIPTORS.length, 4)
  assert.equal(ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS.length, 24)
  assert.equal(new Set(ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS).size, 24)
  assert.equal(new Set(ROUND6_SOURCE_WORKFLOW_DESCRIPTORS.map(descriptor => descriptor.fixtureBranch)).size, 4)
  for (const descriptor of ROUND6_SOURCE_WORKFLOW_DESCRIPTORS) {
    assert.equal(ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS.filter(id => byId.get(id).expected.intent === descriptor.intent).length, 6)
    assert.equal(descriptor.proposalTool, descriptor.kind === 'creation' ? 'cad_propose_geology_column' : 'cad_propose_geology_revision')
  }
  const missing = corpus.scenarios.find(item => item.expected.intent === 'investigation-preparation.required-field-completeness')
  assert.equal(assessRound6SourceWorkflowReadiness(missing).status, 'not-ready')
  assert.equal(assessRound6SourceWorkflowReadiness(missing).scenarioPassed, null)
  const unknownPrerequisite = clone(sample(long))
  unknownPrerequisite.prerequisites.push('source:missing-depth')
  assert.equal(assessRound6SourceWorkflowReadiness(unknownPrerequisite).status, 'not-ready')
})

for (const id of ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS) test(`round6 complete native source/workflow selftest, not a model pass: ${id}`, async () => {
  const scenario = byId.get(id), fixture = await buildRound6SourceWorkflowFixture(scenario)
  try {
    const descriptor = round6SourceWorkflowDescriptor(scenario), baseline = fixture.document.fingerprint()
    assert.equal(fixture.fixtureBranch, descriptor.fixtureBranch)
    assert.equal(fixture.modelCalls, 0)
    assert.equal(fixture.scenarioExecuted, false)
    assert.equal(fixture.conversationSeed.length, ['followup', 'correction'].includes(scenario.interaction) ? 1 : 0)
    const bindings = round6SourceWorkflowInputBindings(fixture)
    assert.doesNotMatch(JSON.stringify(bindings), /"commandArgs"|"preview"|"afterSource"|"engineeringEvidence"|"gold"/)
    if (descriptor.kind === 'creation') {
      assert.equal(fixture.document.listEntities().length, 0)
      assert.equal(fixture.sourceRecipePresent, false)
      assert.equal(Object.hasOwn(bindings, 'drawingId'), false)
      assert.equal(bindings.suppliedInputs.completeColumnCreation.input.pageHeightMillimeters, 500)
    } else {
      assert.equal(bindings.drawingId, fixture.drawingId)
      assert.equal(fixture.artifact.format, 'KJD')
      assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
      assert.ok(fixture.document.getObject('NOTE-MANUAL'))
    }
    const trace = traceFor(fixture), proposal = await propose(fixture, scenario, trace)
    const pending = evaluateRound6SourceWorkflowOracle(scenario, fixture, evidenceFor(fixture, trace, proposal))
    assert.equal(pending.status, 'satisfied', JSON.stringify(pending.assertions.filter(item => !item.satisfied)))
    assert.equal(pending.scenarioPassed, null)
    assert.equal(pending.scenarioExecuted, false)
    assert.equal(canonicalStringify(fixture.document.snapshot()), fixture.initialState)
    const gold = expectedRound6SourceWorkflowOutcome(scenario, fixture), tampered = clone(proposal)
    tampered.preview.after[0].payload = {}
    assert.equal(evaluateRound6SourceWorkflowOracle(scenario, fixture, evidenceFor(fixture, trace, tampered)).status, 'failed')
    const approvalReceipt = await trace.session.approve(proposal.planId, 'round6-real-native-selftest-reviewer')
    assert.equal(approvalReceipt.ok, true, JSON.stringify(approvalReceipt.error))
    const committedEvidence = evidenceFor(fixture, trace, proposal, { stage: 'committed', approvalReceipt, approvedPlanId: proposal.planId })
    const committed = evaluateRound6SourceWorkflowOracle(scenario, fixture, committedEvidence)
    assert.equal(committed.status, 'satisfied', JSON.stringify(committed.assertions.filter(item => !item.satisfied)))
    assert.equal(committed.scenarioPassed, null)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, gold.drawingId).source, gold.afterSource)
    assert.equal(round6SourceWorkflowPhysicalGeometryMatches(fixture.document.listEntities(), gold.afterSource), true)
    for (const identity of Object.values(fixture.identityAliases))
      assert.deepEqual(fixture.document.getObject(identity.nativeId), fixture.oracleBaselineDocument.getObject(identity.nativeId))
    for (const unchangedId of gold.unchangedIds)
      assert.deepEqual(fixture.document.getObject(unchangedId), fixture.oracleBaselineDocument.getObject(unchangedId))
    const content = fixture.document.fingerprint()
    assert.equal((await trace.session.approve(proposal.planId, 'round6-real-native-selftest-reviewer')).ok, false)
    assert.equal(fixture.document.fingerprint(), content)
    for (const [action, expectedFingerprint] of [['undo', baseline], ['redo', content]]) {
      const history = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
      const historyProposal = await trace.call(`cad_propose_${action}`, { expectedRevision: fixture.document.revision,
        units: 'millimeter', targetHistoryId: history.history[`${action}Target`].id })
      assert.equal((await trace.session.approve(historyProposal.planId, 'round6-history-selftest-reviewer')).ok, true)
      assert.equal(fixture.document.fingerprint(), expectedFingerprint)
      if (action === 'undo') {
        if (descriptor.kind === 'creation') assert.equal(Object.keys(fixture.document.snapshot().opaquePayloads).length, 0)
        else assert.deepEqual(readGeologyDrawingRecipe(fixture.document, gold.drawingId).source, gold.beforeSource)
      }
    }
    const reopened = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }), { format: 'KJD' })
    assert.equal(canonicalStringify(reopened.snapshot()), canonicalStringify(fixture.document.snapshot()))
    assert.deepEqual(readGeologyDrawingRecipe(reopened, gold.drawingId).source, gold.afterSource)
    const dxf = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(reopened, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(dxf.validate().valid, true)
    assert.equal(canonicalStringify(suppliedCreationDocumentSemantics(dxf)), canonicalStringify(suppliedCreationDocumentSemantics(reopened)),
      'full native handles, coordinates, HATCH patterns/loops and layer/text-style/linetype semantics survive actual DXF reopening')
    assert.throws(() => readGeologyDrawingRecipe(dxf, gold.drawingId), /source|recipe|drawing/i,
      'DXF exchanges native geometry, not retained geology source recipes')
  } finally { fixture.dispose() }
})

test('caller facts are complete, public and explicit; absent descriptions stay absent and eight classes are not compacted', () => {
  const deep = round6SourceWorkflowCallerInputs(sample(long)).completeColumnCreation
  assert.equal(deep.input.hole.depth, 60)
  assert.equal(deep.input.hole.strata.length, 3)
  assert.equal(deep.input.verticalScaleDenominator, 200)
  assert.deepEqual(deep.templateDeclaration.declaredPageHeightsMillimeters, [297, 500, 841])
  const eight = round6SourceWorkflowCallerInputs(sample(many)).completeColumnCreation
  assert.equal(eight.input.hole.depth, 48)
  assert.equal(new Set(eight.input.hole.strata.map(layer => layer.intervalId)).size, 8)
  assert.equal(new Set(eight.input.hole.strata.map(layer => layer.lithology)).size, 8)
  for (const table of [deep, eight]) {
    assert.equal(table.sourceUnits, 'meter')
    assert.equal(table.drawingUnits, 'millimeter')
    assert.equal(table.provenance, 'caller-declared-public-synthetic-not-measurement-certified')
    for (const interval of table.input.hole.strata) assert.equal(Object.hasOwn(interval, 'description'), false)
  }
})

test('an actually valid but wrong class list, source value, extra fact or partially completed batch never satisfies the original request', async () => {
  for (const [intent, mutate] of [
    [long, args => { args.hole.collarElevation++ }],
    [many, args => { args.hole.strata.pop(); args.hole.depth = 42 }],
    [many, args => { args.hole.strata[0].description = 'Invented description' }],
    [water, args => { args.updates.splice(1) }],
    [water, args => { args.updates[1].stableWaterDepth = 5.5 }],
    [boundary, args => { args.updates[0].strata[1].bottom = 9.25; args.updates[0].strata[2].top = 9.25 }],
  ]) {
    const scenario = sample(intent), fixture = await buildRound6SourceWorkflowFixture(scenario)
    try {
      const trace = traceFor(fixture), proposal = await propose(fixture, scenario, trace, mutate)
      assert.equal(evaluateRound6SourceWorkflowOracle(scenario, fixture, evidenceFor(fixture, trace, proposal)).status, 'failed', intent)
      assert.equal(canonicalStringify(fixture.document.snapshot()), fixture.initialState)
    } finally { fixture.dispose() }
  }
})

test('native HATCH depth/position arithmetic detects an omitted class, wrong sheet or shifted section water marker independently of object counts', async () => {
  for (const intent of [long, many, water, boundary]) {
    const scenario = sample(intent), fixture = await buildRound6SourceWorkflowFixture(scenario)
    try {
      const gold = expectedRound6SourceWorkflowOutcome(scenario, fixture), trace = traceFor(fixture)
      const proposal = await propose(fixture, scenario, trace)
      assert.equal((await trace.session.approve(proposal.planId, 'round6-physical-selftest')).ok, true)
      const actual = clone(fixture.document.listEntities())
      assert.equal(round6SourceWorkflowPhysicalGeometryMatches(actual, gold.afterSource), true)
      const hatch = actual.find(entity => entity.type === 'HATCH')
      hatch.payload.boundaryLoops[0].vertices[0].point[1] += 0.01
      assert.equal(round6SourceWorkflowPhysicalGeometryMatches(actual, gold.afterSource), false)
      if (gold.afterSource.kind === 'section') {
        const moved = clone(fixture.document.listEntities()), hole = gold.afterSource.input.holes[0]
        const y = 43 + (hole.collarElevation - hole.stableWaterDepth - 85) * 5
        const marker = moved.find(entity => entity.type === 'LINE' && entity.payload.start[0] === 47 && entity.payload.start[1] === y && entity.payload.end[0] === 57)
        assert.ok(marker)
        marker.payload.start[1] += 0.01
        assert.equal(round6SourceWorkflowPhysicalGeometryMatches(moved, gold.afterSource), false)
      } else {
        const wrongSheet = clone(gold.afterSource)
        wrongSheet.input.pageHeightMillimeters = 297
        assert.equal(round6SourceWorkflowPhysicalGeometryMatches(fixture.document.listEntities(), wrongSheet), false)
      }
    } finally { fixture.dispose() }
  }
})

test('real-model labels alone, removed source reads and naked receipts cannot bless a result; runtime host-approved receipt is exact-plan-bound', async () => {
  for (const intent of [many, water]) {
    const scenario = sample(intent), fixture = await buildRound6SourceWorkflowFixture(scenario)
    try {
      const trace = traceFor(fixture), proposal = await propose(fixture, scenario, trace)
      assert.equal(evaluateRound6SourceWorkflowOracle(scenario, fixture, { origin: 'real-model', answer: 'Done' }).status, 'not-evaluated')
      const missing = evidenceFor(fixture, trace, proposal, { toolCalls: trace.calls.filter(call => call.name !== 'cad_read_geology_source') })
      assert.equal(evaluateRound6SourceWorkflowOracle(scenario, fixture, missing).status, 'failed')
      const approval = await trace.session.approve(proposal.planId, 'round6-host-proof-selftest')
      assert.equal(approval.ok, true)
      const committed = evidenceFor(fixture, trace, proposal, { stage: 'committed', approvalReceipt: approval.value, approvedPlanId: proposal.planId })
      assert.equal(evaluateRound6SourceWorkflowOracle(scenario, fixture, committed).status, 'failed')
      assert.equal(evaluateRound6SourceWorkflowOracle(scenario, fixture, { ...committed, hostApprovalApplied: true }).status, 'satisfied')
      assert.equal(evaluateRound6SourceWorkflowOracle(scenario, fixture, {
        ...committed, hostApprovalApplied: true, approvedPlanId: 'foreign-plan',
      }).status, 'failed')
      assert.equal(evaluateRound6SourceWorkflowOracle(scenario, fixture, {
        ...committed, hostApprovalApplied: true, approvalReceipt: { ...approval.value, planId: 'foreign-receipt' },
      }).status, 'failed')
    } finally { fixture.dispose() }
  }
})

const negativeCases = [
  ['long sheet missing collar', long, args => { delete args.hole.collarElevation }],
  ['deep column forced into unfitting A4 instead of explicit long paper', long, args => { args.pageHeightMillimeters = 297 }],
  ['arbitrary undeclared page height', long, args => { args.pageHeightMillimeters = 501 }],
  ['eight class table with a gap', many, args => { args.hole.strata[1].top += 0.5 }],
  ['eight class table with a duplicate interval identity', many, args => { args.hole.strata[1].intervalId = args.hole.strata[0].intervalId }],
  ['valid first hole and invalid second water depth', water, args => { args.updates[1].stableWaterDepth = 19 }],
  ['water batch unknown hole identity', water, args => { args.updates[1].holeId = 'UNKNOWN-HOLE' }],
  ['water batch duplicate hole identity', water, args => { args.updates[1].holeId = 'TEST-A' }],
  ['historical boundary leaves a disconnected adjacent depth', boundary, args => { args.updates[0].strata[2].top = 10 }],
  ['historical source ID not found', boundary, args => { args.drawingId = 'UNKNOWN-SOURCE' }],
  ['historical source uses CAD metres instead of millimetres', boundary, args => { args.units = 'meter' }],
]
for (const [label, intent, mutate] of negativeCases) test(`${label}: rejected atomically, not interpreted as a completed task`, async () => {
  const scenario = sample(intent), fixture = await buildRound6SourceWorkflowFixture(scenario)
  try {
    const trace = traceFor(fixture), args = await nativeInputs(fixture, scenario, trace)
    mutate(args)
    const before = canonicalStringify(fixture.document.snapshot())
    const result = await trace.session.call(round6SourceWorkflowDescriptor(scenario).proposalTool, args)
    assert.equal(result.ok, false)
    assert.equal(canonicalStringify(fixture.document.snapshot()), before)
  } finally { fixture.dispose() }
})

test('stale approval after an unrelated manual edit cannot partly apply either a column creation or multi-hole source batch', async () => {
  for (const intent of [long, water]) {
    const scenario = sample(intent), fixture = await buildRound6SourceWorkflowFixture(scenario)
    try {
      const trace = traceFor(fixture), proposal = await propose(fixture, scenario, trace)
      await fixture.sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [450, 200, 0], radius: 3 } }, { document: fixture.document })
      const before = canonicalStringify(fixture.document.snapshot())
      assert.equal((await trace.session.approve(proposal.planId, 'round6-stale-selftest')).ok, false)
      assert.equal(canonicalStringify(fixture.document.snapshot()), before)
      if (fixture.sourceRecipePresent) assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
      else assert.equal(Object.keys(fixture.document.snapshot().opaquePayloads).length, 0)
    } finally { fixture.dispose() }
  }
})

test('source drift or a protected generated layer is never overwritten by recompiling a batch', async () => {
  for (const protection of ['manual-drift', 'layer-locked']) {
    const scenario = sample(water), fixture = await buildRound6SourceWorkflowFixture(scenario)
    try {
      const trace = traceFor(fixture), args = await nativeInputs(fixture, scenario, trace)
      const hatch = fixture.document.listEntities({ type: 'HATCH' })[0]
      if (protection === 'manual-drift') await fixture.document.transact('Public generated-geometry conflict', transaction => {
        const payload = clone(hatch.payload)
        payload.boundaryLoops[0].vertices[0].point[0] += 0.1
        transaction.updateObject(hatch.id, { payload })
      })
      else await fixture.document.transact('Public protected generated layer', transaction => {
        const layer = fixture.document.getObject(hatch.payload.layerId)
        transaction.updateObject(layer.id, { payload: { ...clone(layer.payload), locked: true } })
      })
      args.expectedRevision = fixture.document.revision
      const before = canonicalStringify(fixture.document.snapshot())
      const result = await trace.session.call('cad_propose_geology_revision', args)
      assert.equal(result.ok, false, protection)
      assert.equal(canonicalStringify(fixture.document.snapshot()), before)
    } finally { fixture.dispose() }
  }
})
