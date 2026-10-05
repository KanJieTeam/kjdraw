import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { SUPPLIED_CREATION_DESCRIPTORS, SUPPLIED_CREATION_SCENARIO_IDS, assessSuppliedCreationReadiness,
  suppliedCreationDescriptor, suppliedCreationCallerFacts, buildSuppliedCreationFixture, suppliedCreationInputBindings,
  expectedSuppliedCreationOutcome, evaluateSuppliedCreationOracle, suppliedCreationDocumentSemantics,
  suppliedCreationPhysicalGeometryMatches,
} from '../scripts/testing/helpers/geology-supplied-creation-oracles.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const byId = new Map(corpus.scenarios.map(item => [item.id, item]))
const clone = structuredClone
const sample = intent => corpus.scenarios.find(item => item.expected.intent === intent && item.id.endsWith('-zh-direct'))

function nativeTrace(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}
async function propose(trace, fixture, scenario, mutate = () => {}) {
  await trace.call('cad_read_drawing', {})
  const listing = await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: '', maxBytes: 8192 })
  assert.equal(listing.sourceBacked, false)
  assert.deepEqual(listing.drawingIds, [])
  const args = { version: '1.0.0', expectedRevision: fixture.initialRevision, units: 'millimeter',
    ...clone(fixture.suppliedInputs.completeGeologyCreation.input) }
  mutate(args)
  return trace.call(suppliedCreationDescriptor(scenario).proposalTool, args)
}
function evidence(fixture, trace, proposal, extra = {}) {
  return { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls,
    proposal, stage: 'pending-preview', ...extra }
}

test('exactly four frozen creation families/24 variants; no other or missing-fact family is claimed ready', () => {
  assert.equal(SUPPLIED_CREATION_DESCRIPTORS.length, 4)
  assert.equal(SUPPLIED_CREATION_SCENARIO_IDS.length, 24)
  assert.equal(new Set(SUPPLIED_CREATION_SCENARIO_IDS).size, 24)
  assert.equal(new Set(SUPPLIED_CREATION_DESCRIPTORS.map(descriptor => descriptor.fixtureBranch)).size, 4)
  for (const descriptor of SUPPLIED_CREATION_DESCRIPTORS) {
    assert.equal(SUPPLIED_CREATION_SCENARIO_IDS.filter(id => byId.get(id).expected.intent === descriptor.intent).length, 6)
    assert.equal(descriptor.command, 'CREATEBATCH')
    assert.equal(descriptor.requiresBlankDocument, true)
    assert.equal(descriptor.fixtureBranch, `supplied-creation-${descriptor.intent}`)
  }
  const missing = corpus.scenarios.find(item => item.expected.intent === 'ambiguous-source.cross-hole-correlation-unsupplied')
    ?? corpus.scenarios.find(item => item.expected.clarification.required)
  assert.equal(assessSuppliedCreationReadiness(missing).status, 'not-ready')
  assert.equal(assessSuppliedCreationReadiness(missing).scenarioPassed, null)
  const inventedPrerequisite = clone(sample('source-section.create-supplied-section'))
  inventedPrerequisite.prerequisites.push('source:missing-collar-elevation')
  assert.equal(assessSuppliedCreationReadiness(inventedPrerequisite).status, 'not-ready')
})

for (const id of SUPPLIED_CREATION_SCENARIO_IDS) test(`real native supplied-creation selftest, never a model pass: ${id}`, async () => {
  const scenario = byId.get(id), fixture = await buildSuppliedCreationFixture(scenario)
  try {
    assert.equal(fixture.document.listEntities().length, 0)
    assert.equal(fixture.sourceRecipePresent, false)
    assert.equal(fixture.fixtureBranch, suppliedCreationDescriptor(scenario).fixtureBranch)
    assert.equal(fixture.modelCalls, 0)
    assert.equal(fixture.scenarioExecuted, false)
    assert.equal(fixture.conversationSeed.length, ['followup', 'correction'].includes(scenario.interaction) ? 1 : 0)
    const bindings = suppliedCreationInputBindings(fixture), facts = bindings.suppliedInputs.completeGeologyCreation
    assert.equal(facts.sourceUnits, 'meter')
    assert.equal(facts.drawingUnits, 'millimeter')
    assert.equal(facts.provenance, 'caller-declared-public-synthetic-not-measurement-certified')
    assert.doesNotMatch(JSON.stringify(bindings), /"commandArgs"|"preview"|"payload"|"afterSource"|"gold"|"engineeringEvidence"/)
    assert.equal(Object.hasOwn(bindings, 'drawingId'), false, 'generated root IDs are not input facts')
    const trace = nativeTrace(fixture), proposal = await propose(trace, fixture, scenario)
    const pending = evaluateSuppliedCreationOracle(scenario, fixture, evidence(fixture, trace, proposal))
    assert.equal(pending.status, 'satisfied', JSON.stringify(pending.assertions.filter(item => !item.satisfied)))
    assert.equal(pending.scenarioPassed, null)
    assert.equal(pending.scenarioExecuted, false)
    assert.equal(canonicalStringify(fixture.document.snapshot()), fixture.initialState)
    const gold = expectedSuppliedCreationOutcome(scenario, fixture)
    const tampered = clone(proposal)
    tampered.arguments.geologySource.input[gold.source.kind === 'column' ? 'hole' : 'holes'] = null
    assert.equal(evaluateSuppliedCreationOracle(scenario, fixture, evidence(fixture, trace, tampered)).status, 'failed')
    const approvalReceipt = await trace.session.approve(proposal.planId, 'supplied-creation-selftest-reviewer')
    assert.equal(approvalReceipt.ok, true, JSON.stringify(approvalReceipt.error))
    const committed = evaluateSuppliedCreationOracle(scenario, fixture, evidence(fixture, trace, proposal, {
      stage: 'committed', approvalReceipt, approvedPlanId: proposal.planId,
    }))
    assert.equal(committed.status, 'satisfied', JSON.stringify(committed.assertions.filter(item => !item.satisfied)))
    assert.equal(committed.scenarioPassed, null)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, gold.drawingId).source, gold.source)
    assert.equal(suppliedCreationPhysicalGeometryMatches(fixture.document.listEntities(), gold.source), true)
    assert.ok(fixture.document.listEntities({ type: 'HATCH' }).length > 0)
    const content = fixture.document.fingerprint()
    assert.equal((await trace.session.approve(proposal.planId, 'supplied-creation-selftest-reviewer')).ok, false)
    assert.equal(fixture.document.fingerprint(), content)
    for (const [action, expectedFingerprint] of [['undo', fixture.oracleBaselineDocument.fingerprint()], ['redo', content]]) {
      const history = await trace.call('cad_read_history', { expectedRevision: fixture.document.revision })
      const historyProposal = await trace.call(`cad_propose_${action}`, { expectedRevision: fixture.document.revision,
        units: 'millimeter', targetHistoryId: history.history[`${action}Target`].id })
      assert.equal((await trace.session.approve(historyProposal.planId, 'supplied-creation-history-reviewer')).ok, true)
      assert.equal(fixture.document.fingerprint(), expectedFingerprint)
      if (action === 'undo') assert.equal(Object.keys(fixture.document.snapshot().opaquePayloads).length, 0, 'source recipe and geometry undo together')
    }
    const reopened = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }), { format: 'KJD' })
    assert.equal(canonicalStringify(reopened.snapshot()), canonicalStringify(fixture.document.snapshot()))
    assert.deepEqual(readGeologyDrawingRecipe(reopened, gold.drawingId).source, gold.source)
    const dxf = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(reopened, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(dxf.validate().valid, true)
    assert.equal(canonicalStringify(suppliedCreationDocumentSemantics(dxf)), canonicalStringify(suppliedCreationDocumentSemantics(reopened)),
      'complete handles, payloads, coordinates, HATCH and resources; an explicit undefined optional field has no JSON/DXF representation')
    assert.throws(() => readGeologyDrawingRecipe(dxf, gold.drawingId), /source|recipe|drawing/i)
  } finally { fixture.dispose() }
})

test('Chinese headings are native visible output even for the frozen English request, not language inferred from the question', async () => {
  const scenario = corpus.scenarios.find(item => item.expected.intent === 'geological-presentation.chinese-column-headings' && item.language === 'en')
  const fixture = await buildSuppliedCreationFixture(scenario)
  try {
    assert.equal(suppliedCreationCallerFacts(scenario).input.locale, 'zh-CN')
    const trace = nativeTrace(fixture), proposal = await propose(trace, fixture, scenario)
    assert.equal((await trace.session.approve(proposal.planId, 'supplied-language-reviewer')).ok, true)
    const texts = fixture.document.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
    for (const label of ['地层', '编号', '名称', '柱状图图例', '取样', '标贯']) assert.ok(texts.includes(label), label)
    assert.ok(texts.some(text => text.includes('稳定水位')))
    assert.ok(texts.some(text => text.includes('初见水位')))
  } finally { fixture.dispose() }
})

test('an actually valid wrong fact, datum, locale or omitted optional record is not accepted as the requested creation', async () => {
  for (const [intent, mutate] of [
    ['source-section.create-supplied-column', args => { args.hole.collarElevation++ }],
    ['source-section.create-supplied-column', args => { delete args.hole.observations }],
    ['source-section.create-supplied-column', args => { args.hole.strata[0].description = 'Invented description' }],
    ['geological-presentation.supplied-section-datum', args => { args.datumElevation = 84 }],
    ['geological-presentation.chinese-column-headings', args => { args.locale = 'en' }],
  ]) {
    const scenario = sample(intent), fixture = await buildSuppliedCreationFixture(scenario)
    try {
      const trace = nativeTrace(fixture), proposal = await propose(trace, fixture, scenario, mutate)
      const verdict = evaluateSuppliedCreationOracle(scenario, fixture, evidence(fixture, trace, proposal))
      assert.equal(verdict.status, 'failed', `${intent}: a valid engine proposal is not automatically the correct requested result`)
      assert.equal(canonicalStringify(fixture.document.snapshot()), fixture.initialState)
    } finally { fixture.dispose() }
  }
})

test('absent actual native blank/source reads, fake approval and arbitrary success text never become passes', async () => {
  const scenario = sample('source-section.create-supplied-section'), fixture = await buildSuppliedCreationFixture(scenario)
  try {
    const trace = nativeTrace(fixture), proposal = await propose(trace, fixture, scenario)
    assert.equal(evaluateSuppliedCreationOracle(scenario, fixture, { origin: 'real-model', answer: 'Done.' }).status, 'not-evaluated')
    for (const omitted of ['cad_read_drawing', 'cad_read_geology_source']) {
      const verdict = evaluateSuppliedCreationOracle(scenario, fixture, evidence(fixture, trace, proposal, {
        toolCalls: trace.calls.filter(call => call.name !== omitted),
      }))
      assert.equal(verdict.status, 'failed', omitted)
    }
    const fake = evaluateSuppliedCreationOracle(scenario, fixture, evidence(fixture, trace, proposal, {
      stage: 'committed', approvalReceipt: { ok: true, value: { command: 'CREATEBATCH', status: 'committed', beforeRevision: 0, afterRevision: 1 } }, approvedPlanId: proposal.planId,
    }))
    assert.equal(fake.status, 'failed', 'blank native geometry cannot be blessed by a fake success receipt')
  } finally { fixture.dispose() }
})

test('physical oracle independently detects a missing interval or off-centre section band, even if entity counts look plausible', async () => {
  for (const intent of ['source-section.create-supplied-column', 'source-section.create-supplied-section']) {
    const scenario = sample(intent), fixture = await buildSuppliedCreationFixture(scenario)
    try {
      const gold = expectedSuppliedCreationOutcome(scenario, fixture)
      assert.equal(suppliedCreationPhysicalGeometryMatches(gold.after, gold.source), true)
      const wrong = clone(gold.after)
      const hatch = wrong.find(entity => entity.type === 'HATCH')
      hatch.payload.boundaryLoops[0].vertices[0].point[0] += 0.01
      assert.equal(suppliedCreationPhysicalGeometryMatches(wrong, gold.source), false)
      assert.equal(suppliedCreationPhysicalGeometryMatches(gold.after.filter(entity => entity.id !== hatch.id), gold.source), false)
    } finally { fixture.dispose() }
  }
})

test('a committed native receipt requires actual host approval and the exact originating plan', async () => {
  const scenario = sample('source-section.create-supplied-section'), fixture = await buildSuppliedCreationFixture(scenario)
  try {
    const trace = nativeTrace(fixture), proposal = await propose(trace, fixture, scenario)
    const approved = await trace.session.approve(proposal.planId, 'supplied-runtime-shape-reviewer')
    assert.equal(approved.ok, true)
    const runtimeEvidence = evidence(fixture, trace, proposal, {
      stage: 'committed', approvalReceipt: approved.value, approvedPlanId: proposal.planId,
    })
    assert.equal(evaluateSuppliedCreationOracle(scenario, fixture, runtimeEvidence).status, 'failed',
      'a raw committed receipt does not prove that the host approved it')
    assert.equal(evaluateSuppliedCreationOracle(scenario, fixture, {
      ...runtimeEvidence, hostApprovalApplied: true,
    }).status, 'satisfied', 'actual runner raw receipt plus its explicit host-approved flag is accepted')
    assert.equal(evaluateSuppliedCreationOracle(scenario, fixture, {
      ...runtimeEvidence, hostApprovalApplied: true, approvedPlanId: 'foreign-pending-plan',
    }).status, 'failed', 'approval from another proposal is never borrowed')
    assert.equal(evaluateSuppliedCreationOracle(scenario, fixture, {
      ...runtimeEvidence, hostApprovalApplied: true,
      approvalReceipt: { ...approved.value, planId: 'foreign-receipt-plan' },
    }).status, 'failed', 'an inconsistent receipt plan is rejected even with a correct host plan')
  } finally { fixture.dispose() }
})

test('blank-only factual creation never overwrites unrelated existing geometry', async () => {
  const scenario = sample('source-section.create-supplied-section'), fixture = await buildSuppliedCreationFixture(scenario)
  try {
    await fixture.sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [450, 200, 0], radius: 3 } }, { document: fixture.document })
    const before = fixture.document.snapshot(), session = new KJAgentToolSession(fixture.sdk, fixture.document)
    const response = await session.call('cad_propose_geology_section', { version: '1.0.0', expectedRevision: fixture.document.revision,
      units: 'millimeter', ...clone(fixture.suppliedInputs.completeGeologyCreation.input) })
    assert.equal(response.ok, false)
    assert.match(response.error.message, /blank drawing/)
    assert.deepEqual(fixture.document.snapshot(), before)
  } finally { fixture.dispose() }
})

test('creation pending snapshot binds revision and original caller arrays; caller mutation cannot change approved source', async () => {
  const scenario = sample('source-section.create-supplied-column'), fixture = await buildSuppliedCreationFixture(scenario)
  try {
    const trace = nativeTrace(fixture), originalArgs = clone(fixture.suppliedInputs.completeGeologyCreation.input)
    await trace.call('cad_read_drawing', {})
    await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: '', maxBytes: 8192 })
    const args = { version: '1.0.0', expectedRevision: fixture.initialRevision, units: 'millimeter', ...originalArgs }
    const proposal = await trace.call('cad_propose_geology_column', args)
    const expected = expectedSuppliedCreationOutcome(scenario, fixture)
    args.hole.strata[0].bottom = 100
    args.hole.observations.splice(0)
    assert.equal((await trace.session.approve(proposal.planId, 'supplied-array-reviewer')).ok, true)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, expected.drawingId).source, expected.source)
  } finally { fixture.dispose() }
})

test('a later unrelated edit prevents pending creation approval, with no partial geometry or recipe', async () => {
  const scenario = sample('source-section.create-supplied-section'), fixture = await buildSuppliedCreationFixture(scenario)
  try {
    const trace = nativeTrace(fixture), proposal = await propose(trace, fixture, scenario)
    await fixture.sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [450, 200, 0], radius: 3 } }, { document: fixture.document })
    const before = fixture.document.snapshot()
    assert.equal((await trace.session.approve(proposal.planId, 'supplied-stale-reviewer')).ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(Object.keys(fixture.document.snapshot().opaquePayloads), [])
  } finally { fixture.dispose() }
})

const missingCases = [
  ['column missing collar elevation', 'source-section.create-supplied-column', args => { delete args.hole.collarElevation }],
  ['column missing full strata', 'source-section.create-supplied-column', args => { delete args.hole.strata }],
  ['column wrong CAD units', 'source-section.create-supplied-column', args => { args.units = 'meter' }],
  ['column invalid measured depth', 'source-section.create-supplied-column', args => { args.hole.depth = -1 }],
  ['section missing station', 'source-section.create-supplied-section', args => { delete args.holes[1].station }],
  ['section missing datum', 'source-section.create-supplied-section', args => { delete args.datumElevation }],
  ['section omitted adjacent coverage', 'source-section.create-supplied-section', args => { args.correlations.pop() }],
  ['section code-only continuity guess', 'source-section.create-supplied-section', args => {
    delete args.correlations[0].fromIntervalId; args.correlations[0].fromStratumCode = '1'
  }],
]
for (const [label, intent, mutate] of missingCases) test(`${label}: rejected atomically, not completed by the oracle`, async () => {
  const scenario = sample(intent), fixture = await buildSuppliedCreationFixture(scenario)
  try {
    const trace = nativeTrace(fixture)
    await trace.call('cad_read_drawing', {})
    await trace.call('cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: '', maxBytes: 8192 })
    const args = { version: '1.0.0', expectedRevision: fixture.initialRevision, units: 'millimeter', ...clone(fixture.suppliedInputs.completeGeologyCreation.input) }
    mutate(args)
    const before = fixture.document.snapshot()
    const result = await trace.session.call(suppliedCreationDescriptor(scenario).proposalTool, args)
    assert.equal(result.ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.equal(evaluateSuppliedCreationOracle(scenario, fixture, evidence(fixture, trace, null)).status, 'not-evaluated')
  } finally { fixture.dispose() }
})
