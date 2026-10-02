import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { ROUND7_POINT_PLAN_DESCRIPTORS, ROUND7_POINT_PLAN_SCENARIO_IDS, round7PointPlanDescriptor,
  assessRound7PointPlanReadiness, round7PointPlanCallerInputs, buildRound7PointPlanFixture,
  round7PointPlanInputBindings, expectedRound7PointPlanOutcome, evaluateRound7PointPlanOracle,
  round7PointPlanPhysicalGeometryMatches, round7PointPlanDxfPhysicalSemantics,
  POINT_PLAN_NON_DXF_APPLICATION_FIELDS } from '../scripts/testing/helpers/geology-round7-point-plan-oracles.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { exportDrawingSvg } from '../packages/kjdraw-sdk/src/svg-export.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8')), byId = new Map(corpus.scenarios.map(scenario => [scenario.id, scenario]))
const clone = structuredClone
const sample = intent => corpus.scenarios.find(scenario => scenario.expected.intent === intent && scenario.id.endsWith('-zh-direct'))
const supplied = 'investigation-point-layout.supplied-point-plan', chinese = 'investigation-point-layout.chinese-point-plan'
const route = 'investigation-point-layout.explicit-section-route'
function traceFor(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}
async function argsFor(fixture, trace) {
  const drawing = await trace.call('cad_read_drawing', {})
  assert.equal(drawing.units, 'millimeter')
  assert.deepEqual(drawing.entities, [])
  const source = await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: '', maxBytes: 262144 })
  assert.equal(source.sourceBacked, false)
  assert.deepEqual(source.drawingIds, [])
  return { ...clone(fixture.suppliedInputs.completePointLocationInput.input), expectedRevision: fixture.initialRevision }
}
async function propose(fixture, trace, change = () => {}) {
  const args = await argsFor(fixture, trace); change(args)
  return trace.call('cad_propose_geology_plan', args)
}
const evidenceFor = (fixture, trace, proposal, extra = {}) => ({ origin: 'fixture-oracle-selftest', afterDocument: fixture.document,
  proposal, toolCalls: trace.calls, stage: 'pending-preview', ...extra })

test('three existing frozen point-plan families supply exactly 18 variants, not invented questions or live-model passes', () => {
  assert.equal(ROUND7_POINT_PLAN_DESCRIPTORS.length, 3)
  assert.equal(ROUND7_POINT_PLAN_SCENARIO_IDS.length, 18)
  assert.equal(new Set(ROUND7_POINT_PLAN_SCENARIO_IDS).size, 18)
  for (const descriptor of ROUND7_POINT_PLAN_DESCRIPTORS) {
    assert.equal(ROUND7_POINT_PLAN_SCENARIO_IDS.filter(id => byId.get(id).expected.intent === descriptor.intent).length, 6)
    assert.equal(descriptor.requiresBlankDocument, true)
    assert.equal(descriptor.retainedGeologyRecipe, false)
    assert.equal(descriptor.requiresHostProposalTool, 'cad_propose_geology_plan')
  }
  for (const id of ROUND7_POINT_PLAN_SCENARIO_IDS) {
    const readiness = assessRound7PointPlanReadiness(id)
    assert.equal(readiness.status, 'runnable')
    assert.equal(readiness.executionStatus, 'not-run')
    assert.equal(readiness.scenarioPassed, null)
    assert.equal(readiness.hostToolExposureVerified, false, 'SDK fixture readiness does not certify current online AI tool exposure')
  }
  const absent = sample('investigation-point-layout.unsupported-point-source-revision')
  assert.equal(assessRound7PointPlanReadiness(absent).status, 'not-ready')
  const unknown = clone(sample(supplied)); unknown.prerequisites.push('source:unsupplied-measured-coordinate-system')
  assert.equal(assessRound7PointPlanReadiness(unknown).status, 'not-ready')
})

for (const id of ROUND7_POINT_PLAN_SCENARIO_IDS) test(`round7 actual supplied-plan SDK journey, not a model pass: ${id}`, async () => {
  const scenario = byId.get(id), fixture = await buildRound7PointPlanFixture(scenario)
  try {
    const descriptor = round7PointPlanDescriptor(scenario), initial = fixture.document.fingerprint(), trace = traceFor(fixture)
    assert.equal(fixture.fixtureBranch, descriptor.fixtureBranch)
    assert.equal(fixture.modelCalls, 0)
    assert.equal(fixture.sourceRecipePresent, false)
    assert.equal(fixture.document.listEntities().length, 0)
    assert.equal(fixture.conversationSeed.length, ['followup', 'correction'].includes(scenario.interaction) ? 1 : 0)
    const bindings = round7PointPlanInputBindings(fixture)
    assert.doesNotMatch(JSON.stringify(bindings), /"commandArgs"|"preview"|"engineeringEvidence"|"gold"/)
    assert.equal(Object.hasOwn(bindings, 'drawingId'), false, 'declared drawingId is input, never a fictitious retained recipe identity')
    const proposal = await propose(fixture, trace), gold = expectedRound7PointPlanOutcome(scenario, fixture)
    const pending = evaluateRound7PointPlanOracle(scenario, fixture, evidenceFor(fixture, trace, proposal))
    assert.equal(pending.status, 'satisfied', JSON.stringify(pending.assertions.filter(assertion => !assertion.satisfied)))
    assert.equal(pending.scenarioPassed, null)
    assert.equal(pending.scenarioExecuted, false)
    assert.equal(canonicalStringify(fixture.document.snapshot()), fixture.initialState)
    assert.equal(proposal.arguments.layout.viewport.modelUnits, 'millimeter')
    assert.equal(proposal.arguments.layout.viewport.scaleDenominator, 1000)
    assert.equal(proposal.arguments.layout.viewport.viewHeight / proposal.arguments.layout.viewport.height, 1000)
    for (const hole of gold.input.boreholes) {
      const point = proposal.preview.after.find(entity => entity.type === 'CIRCLE' && entity.payload.sourceId === hole.id)
      assert.deepEqual(point.payload.center, [...hole.position.map(value => value * 1000), 0])
    }
    const tampered = clone(proposal); tampered.arguments.layout.viewport.viewHeight++
    assert.equal(evaluateRound7PointPlanOracle(scenario, fixture, evidenceFor(fixture, trace, tampered)).status, 'failed')
    const approval = await trace.session.approve(proposal.planId, 'round7-real-native-selftest-reviewer')
    assert.equal(approval.ok, true, JSON.stringify(approval.error))
    const committed = evaluateRound7PointPlanOracle(scenario, fixture,
      evidenceFor(fixture, trace, proposal, { stage: 'committed', approval, approvedPlanId: proposal.planId }))
    assert.equal(committed.status, 'satisfied', JSON.stringify(committed.assertions.filter(assertion => !assertion.satisfied)))
    assert.equal(committed.scenarioPassed, null)
    const after = fixture.document.fingerprint()
    assert.equal(round7PointPlanPhysicalGeometryMatches(fixture.document, gold.input), true)
    assert.deepEqual(fixture.document.snapshot().opaquePayloads, {})
    const noRecipe = await trace.call('cad_read_geology_source', { expectedRevision: fixture.document.revision, drawingId: '', maxBytes: 262144 })
    assert.deepEqual(noRecipe.drawingIds, [])
    assert.equal(noRecipe.sourceBacked, false)
    assert.throws(() => readGeologyDrawingRecipe(fixture.document, gold.input.drawingId), /source|recipe|drawing/i)
    assert.equal((await trace.session.approve(proposal.planId, 'round7-real-native-selftest-reviewer')).ok, false)
    assert.equal(fixture.document.fingerprint(), after)
    for (const [action, fingerprint] of [['undo', initial], ['redo', after]]) {
      const history = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
      const plan = await trace.call(`cad_propose_${action}`, { expectedRevision: fixture.document.revision, units: 'millimeter',
        targetHistoryId: history.history[`${action}Target`].id })
      assert.equal((await trace.session.approve(plan.planId, 'round7-history-reviewer')).ok, true)
      assert.equal(fixture.document.fingerprint(), fingerprint)
    }
    const reopened = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }), { format: 'KJD' })
    assert.equal(canonicalStringify(reopened.snapshot()), canonicalStringify(fixture.document.snapshot()), 'native KJD preserves full app metadata and layout identities')
    const dxf = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(reopened, { format: 'DXF', version: '2018' }), { format: 'DXF' })
    assert.equal(dxf.validate().valid, true)
    assert.equal(canonicalStringify(round7PointPlanDxfPhysicalSemantics(dxf)), canonicalStringify(round7PointPlanDxfPhysicalSemantics(reopened)),
      'complete DXF-exchangeable native geometry/handles/style resources/plot settings/actual viewport owners survive')
    assert.equal(round7PointPlanPhysicalGeometryMatches(dxf, gold.input), true)
    assert.equal(dxf.listEntities().some(entity => Object.hasOwn(entity.payload, 'semanticRole')), false,
      'DXF does not preserve application-only geology-point roles')
    const layoutId = dxf.snapshot().spaces.layoutIds.find(id => dxf.getObject(id).name === proposal.arguments.layout.name)
    assert.ok(layoutId)
    assert.deepEqual(dxf.getObject(layoutId).payload.viewportIds, [], 'known non-restored native cache is not falsely reported retained')
    assert.equal(dxf.listEntities({ type: 'VIEWPORT' }).filter(entity => entity.ownerId === dxf.getObject(layoutId).payload.blockRecordId).length, 1)
    assert.equal(exportDrawingSvg(dxf, { layoutId }).report.diagnostics.length, 0)
  } finally { fixture.dispose() }
})

test('complete caller coordinates, holes, route and conventions are explicit; the declared A→B→C route differs from nearest-neighbour order', () => {
  const source = round7PointPlanCallerInputs(sample(route)).completePointLocationInput
  assert.equal(source.provenance, 'caller-declared-public-synthetic-not-measurement-certified')
  assert.deepEqual(source.coordinateReference.modelPositionOrder, ['easting', 'northing'])
  assert.deepEqual(source.coordinateReference.engineeringCoordinateLabels, { X: 'northing', Y: 'easting' })
  assert.equal(source.coordinateReference.northDirection, 'model-positive-Y')
  assert.equal(Object.hasOwn(source.coordinateReference, 'epsg'), false)
  const [a, b, c] = source.input.boreholes.map(hole => hole.position)
  assert.ok(Math.hypot(a[0] - c[0], a[1] - c[1]) < Math.hypot(a[0] - b[0], a[1] - b[1]))
  assert.deepEqual(source.input.sectionLines[0].holeIds, ['TEST-A', 'TEST-B', 'TEST-C'])
  assert.equal(source.input.coordinateCallouts.length, source.input.boreholes.length)
  assert.equal(Object.hasOwn(source.input, 'coordinateGrid'), false)
  for (const id of ROUND7_POINT_PLAN_SCENARIO_IDS.filter(id => byId.get(id).expected.intent === chinese))
    assert.equal(round7PointPlanCallerInputs(id).completePointLocationInput.input.locale, 'zh-CN')
})

test('native-valid but incorrect facts, proximity reordering, omitted points, angle or scale do not satisfy a supplied-data request', async () => {
  for (const change of [
    args => { args.sectionLines[0].holeIds = ['TEST-A', 'TEST-C', 'TEST-B'] },
    args => { args.boreholes[0].position[0]++ },
    args => { args.boreholes[1].collarElevation++ },
    args => { args.boreholes[2].depth++ },
    args => { args.boreholes.pop(); args.sectionLines[0].holeIds.pop(); args.coordinateCallouts.pop() },
    args => { args.coordinateCallouts[0].point[0]++ },
    args => { args.scale = 500 },
    args => { args.northAngleDegrees = 90 },
    args => { args.locale = 'en'; args.title = 'Investigation point plan' },
  ]) {
    const scenario = sample(chinese), fixture = await buildRound7PointPlanFixture(scenario)
    try {
      const trace = traceFor(fixture), proposal = await propose(fixture, trace, change)
      assert.equal(evaluateRound7PointPlanOracle(scenario, fixture, evidenceFor(fixture, trace, proposal)).status, 'failed')
      assert.equal(canonicalStringify(fixture.document.snapshot()), fixture.initialState)
    } finally { fixture.dispose() }
  }
})

test('independent physical checks detect changed centre, route endpoint, axis label, north arrow and viewport instead of relying on entity counts', async () => {
  const scenario = sample(supplied), fixture = await buildRound7PointPlanFixture(scenario)
  try {
    const trace = traceFor(fixture), proposal = await propose(fixture, trace), gold = expectedRound7PointPlanOutcome(scenario, fixture)
    assert.equal((await trace.session.approve(proposal.planId, 'round7-physical-reviewer')).ok, true)
    for (const change of [
      entities => { entities.find(entity => entity.type === 'CIRCLE').payload.center[0] += 0.01 },
      entities => { entities.find(entity => entity.payload.semanticRole === 'section-line').payload.vertices[1].point[1] += 0.01 },
      entities => { entities.find(entity => entity.payload.coordinateAxis === 'X').payload.text = 'X=1015.000' },
      entities => { entities.find(entity => entity.payload.semanticRole === 'north-arrow').payload.end[0] += 1 },
      entities => { entities.find(entity => entity.type === 'VIEWPORT').payload.viewHeight++ },
    ]) {
      const entities = clone(fixture.document.listEntities()); change(entities)
      assert.equal(round7PointPlanPhysicalGeometryMatches(entities, gold.input), false)
    }
    const before = round7PointPlanDxfPhysicalSemantics(fixture.document)
    const viewport = fixture.document.listEntities({ type: 'VIEWPORT' })[0]
    await fixture.document.transact('Deliberate public physical viewport difference', transaction => transaction.updateObject(viewport.id,
      { payload: { ...clone(viewport.payload), viewHeight: viewport.payload.viewHeight + 1 } }))
    assert.notEqual(canonicalStringify(round7PointPlanDxfPhysicalSemantics(fixture.document)), canonicalStringify(before))
    assert.equal(round7PointPlanPhysicalGeometryMatches(fixture.document, gold.input), false)
  } finally { fixture.dispose() }
})

test('host approval and exact originating plan remain mandatory; raw receipts or missing actual reads are not proof', async () => {
  const scenario = sample(route), fixture = await buildRound7PointPlanFixture(scenario)
  try {
    const trace = traceFor(fixture), proposal = await propose(fixture, trace)
    assert.equal(evaluateRound7PointPlanOracle(scenario, fixture, { origin: 'real-model', answer: 'done' }).status, 'not-evaluated')
    for (const missing of ['cad_read_drawing', 'cad_read_geology_source']) assert.equal(evaluateRound7PointPlanOracle(scenario, fixture,
      evidenceFor(fixture, trace, proposal, { toolCalls: trace.calls.filter(call => call.name !== missing) })).status, 'failed')
    const approval = await trace.session.approve(proposal.planId, 'round7-host-proof-reviewer')
    assert.equal(approval.ok, true)
    const committed = evidenceFor(fixture, trace, proposal, { stage: 'committed', approvalReceipt: approval.value, approvedPlanId: proposal.planId })
    assert.equal(evaluateRound7PointPlanOracle(scenario, fixture, committed).status, 'failed')
    assert.equal(evaluateRound7PointPlanOracle(scenario, fixture, { ...committed, hostApprovalApplied: true }).status, 'satisfied')
    assert.equal(evaluateRound7PointPlanOracle(scenario, fixture, { ...committed, hostApprovalApplied: true, approvedPlanId: 'foreign-plan' }).status, 'failed')
    assert.equal(evaluateRound7PointPlanOracle(scenario, fixture, { ...committed, hostApprovalApplied: true,
      approvalReceipt: { ...approval.value, planId: 'foreign-receipt' } }).status, 'failed')
    assert.deepEqual(POINT_PLAN_NON_DXF_APPLICATION_FIELDS, ['semanticRole', 'sourceId', 'sourceBacked', 'referencedHoleIds', 'pointKind',
      'endpoint', 'segmentRole', 'coordinateAxis', 'coordinateValue', 'coordinateConvention'])
  } finally { fixture.dispose() }
})

const negatives = [
  ['missing collar elevation', args => { delete args.boreholes[0].collarElevation }],
  ['missing point coordinate', args => { delete args.boreholes[0].position }],
  ['point outside caller boundary', args => { args.boreholes[0].position = [900, 2000] }],
  ['duplicate hole identity', args => { args.boreholes[1].id = 'TEST-A' }],
  ['route references unknown hole', args => { args.sectionLines[0].holeIds[1] = 'UNKNOWN-HOLE' }],
  ['route repeats hole identity', args => { args.sectionLines[0].holeIds[1] = 'TEST-A' }],
  ['no coordinate strategy', args => { delete args.coordinateCallouts }],
  ['ambiguous two coordinate strategies', args => { args.coordinateGrid = { origin: [1000, 2000], spacing: 20 } }],
  ['unfitting A3 scale', args => { args.scale = 100 }],
  ['arbitrary nonstandard drawing scale', args => { args.scale = 750 }],
  ['unsupported source millimetres', args => { args.units = 'millimeter' }],
  ['invented EPSG field in strict source schema', args => { args.epsg = 4326 }],
]
for (const [label, change] of negatives) test(`${label}: actual native proposal rejects atomically`, async () => {
  const fixture = await buildRound7PointPlanFixture(sample(supplied))
  try {
    const trace = traceFor(fixture), args = await argsFor(fixture, trace); change(args)
    const before = canonicalStringify(fixture.document.snapshot())
    assert.equal((await trace.session.call('cad_propose_geology_plan', args)).ok, false)
    assert.equal(canonicalStringify(fixture.document.snapshot()), before)
  } finally { fixture.dispose() }
})

test('stale approval after an unrelated edit rejects without overwriting current geometry or paper spaces', async () => {
  const fixture = await buildRound7PointPlanFixture(sample(route))
  try {
    const trace = traceFor(fixture), proposal = await propose(fixture, trace)
    await fixture.sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 3 } }, { document: fixture.document })
    const before = canonicalStringify(fixture.document.snapshot())
    assert.equal((await trace.session.approve(proposal.planId, 'round7-stale-reviewer')).ok, false)
    assert.equal(canonicalStringify(fixture.document.snapshot()), before)
  } finally { fixture.dispose() }
})
