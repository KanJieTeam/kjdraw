import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { buildRound3ScenarioFixture, expectedRound3ScenarioAnswer, evaluateRound3ScenarioOracle,
  round3ScenarioFixtureInputBindings } from '../scripts/testing/helpers/geology-round3-scenario-oracles.mjs'
import { createSourceDriftInspectionV6Context, evaluateSourceDriftInspectionV6Oracle,
  runSourceDriftInspectionV6Scenarios, SOURCE_DRIFT_INSPECTION_V6_PROTOCOL,
  SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS } from '../scripts/testing/helpers/geology-source-drift-inspection-v6-oracles.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = new Map(corpus.scenarios.map(row => [row.id, row]))
const firstId = SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS[0]
const clone = structuredClone

async function evidenceFor(id = firstId) {
  const fixture = await buildRound3ScenarioFixture(id)
  const context = createSourceDriftInspectionV6Context(id, fixture)
  const session = new KJAgentToolSession(fixture.sdk, fixture.document)
  const args = { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144, includeInspection: true }
  const result = await session.call('cad_read_geology_source', args)
  assert.equal(result.ok, true, JSON.stringify(result.error))
  const answer = expectedRound3ScenarioAnswer(id, fixture)
  const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document,
    toolCalls: [{ id: 'native-inspection', name: 'cad_read_geology_source', args, result }],
    answer, rawFinalAnswer: JSON.stringify(answer), executionStatus: 'message', hostApprovalApplied: false }
  return { fixture, context, session, evidence }
}

test('v6 adds exactly six frozen questions; old v5 text and public input bindings remain unchanged', async () => {
  assert.equal(SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS.length, 6)
  assert.equal(new Set(SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS).size, 6)
  const legacy = await readFile(new URL('../scripts/testing/helpers/geology-round3-scenario-oracles.mjs', import.meta.url))
  assert.equal(createHash('sha256').update(legacy).digest('hex'), '3ce157207475615d9b8a023e13efaeba69cb72c192f82cbe872516d52142baf9')
  const { fixture, context } = await evidenceFor()
  try {
    assert.deepEqual(Object.keys(context), ['version', 'scenarioId'])
    const bindings = round3ScenarioFixtureInputBindings(fixture)
    for (const key of ['sourceBacked', 'expected', 'answer', 'conflicts', 'oracleDriftedEntityIds', 'sourceGeometryConsistent'])
      assert.equal(Object.hasOwn(bindings, key), false)
    assert.equal(SOURCE_DRIFT_INSPECTION_V6_PROTOCOL.transportAnswerContractVersion, 'v5')
  } finally { fixture.dispose() }
})

for (const id of SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS) {
  test(`actual native inspection v6 fixture selftest, zero paid/model passes: ${id}`, async () => {
    const { fixture, context, evidence } = await evidenceFor(id)
    try {
      const verdict = evaluateSourceDriftInspectionV6Oracle(id, fixture, evidence, { context })
      assert.equal(verdict.status, 'satisfied', JSON.stringify(verdict.assertions))
      assert.equal(verdict.scenarioPassed, null)
      assert.equal(verdict.scenarioExecuted, false)
      assert.equal(fixture.modelCalls, 0)
      assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
      assert.deepEqual(evidence.answer.conflicts.map(row => row.type), ['LINE'])
      // The old protocol still rejects successful inspection receipts; its
      // historical results must not acquire a new meaning through this helper.
      assert.equal(evaluateRound3ScenarioOracle(id, fixture, evidence, { answerContractVersion: 'v5' }).status, 'failed')
      const args = { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 }
      const legacyResult = await new KJAgentToolSession(fixture.sdk, fixture.document).call('cad_read_geology_source', args)
      assert.equal(legacyResult.ok, false)
      const legacyEvidence = { ...evidence, toolCalls: [{ name: 'cad_read_geology_source', args, result: legacyResult }] }
      const compatible = evaluateSourceDriftInspectionV6Oracle(id, fixture, legacyEvidence, { context })
      assert.equal(compatible.status, 'satisfied')
      assert.equal(compatible.acceptedEvidencePath, 'legacy-v5-validator-rejection')
      assert.equal(compatible.scenarioPassed, null)
    } finally { fixture.dispose() }
  })
}

const counterexamples = [
  ['unexecuted inspection call without native receipt', e => { delete e.toolCalls[0].result }],
  ['foreign request drawing', e => { e.toolCalls[0].args.drawingId = 'geo-foreign' }],
  ['stale requested revision', e => { e.toolCalls[0].args.expectedRevision-- }],
  ['foreign receipt document', e => { e.toolCalls[0].result.value.documentId = 'drawing-foreign' }],
  ['stale receipt revision', e => { e.toolCalls[0].result.value.revision-- }],
  ['foreign receipt drawing', e => { e.toolCalls[0].result.value.drawingId = 'geo-foreign' }],
  ['missing retained fact', e => { delete e.toolCalls[0].result.value.facts.hole.stableWaterDepth }],
  ['guessed retained measurement', e => { e.toolCalls[0].result.value.facts.hole.depth = 0 }],
  ['changed retained interval', e => { e.toolCalls[0].result.value.facts.hole.strata[0].bottom++ }],
  ['wrong source units', e => { e.toolCalls[0].result.value.sourceUnits = 'millimeter' }],
  ['wrong drawing units', e => { e.toolCalls[0].result.value.drawingUnits = 'meter' }],
  ['wrong depth convention', e => { e.toolCalls[0].result.value.depthConvention = 'elevation' }],
  ['false source availability', e => { e.toolCalls[0].result.value.sourceBacked = false }],
  ['invented measurement certification', e => { e.toolCalls[0].result.value.measurementsVerified = true }],
  ['missing inspection-only guarantee', e => { delete e.toolCalls[0].result.value.inspectionOnly }],
  ['false consistency', e => { e.toolCalls[0].result.value.sourceGeometryConsistent = true }],
  ['truncated source receipt', e => { e.toolCalls[0].result.value.truncated = true }],
  ['omitted actual conflict', e => { e.toolCalls[0].result.value.conflicts = [] }],
  ['missing native conflict type metadata', e => { delete e.toolCalls[0].result.value.conflictTypes }],
  ['wrong compiled generated type metadata', e => { e.toolCalls[0].result.value.conflictTypes[0].generatedType = 'CIRCLE' }],
  ['wrong actual native type metadata', e => { e.toolCalls[0].result.value.conflictTypes[0].actualType = 'CIRCLE' }],
  ['false missing actual native record metadata', e => { e.toolCalls[0].result.value.conflictTypes[0].actualType = null }],
  ['foreign conflict type identity', e => { e.toolCalls[0].result.value.conflictTypes[0].id = 'geo-foreign-entity' }],
  ['duplicated type metadata', e => { e.toolCalls[0].result.value.conflictTypes.push(clone(e.toolCalls[0].result.value.conflictTypes[0])) }],
  ['unrelated extra manual type metadata', e => { e.toolCalls[0].result.value.conflictTypes.push({ id: 'CIRCLE-MANUAL', generatedType: 'CIRCLE', actualType: 'CIRCLE' }) }],
  ['foreign document attribution in metadata', e => { e.toolCalls[0].result.value.conflictTypes[0].documentId = 'drawing-foreign' }],
  ['duplicated conflict', e => { e.toolCalls[0].result.value.conflicts.push(clone(e.toolCalls[0].result.value.conflicts[0])) }],
  ['unrelated manual circle reported as conflict', e => { e.toolCalls[0].result.value.conflicts.push({ kind: 'entity', id: 'CIRCLE-MANUAL', reason: 'record-changed' }) }],
  ['wrong conflict kind', e => { e.toolCalls[0].result.value.conflicts[0].kind = 'resource' }],
  ['wrong conflict reason', e => { e.toolCalls[0].result.value.conflicts[0].reason = 'missing' }],
  ['generic entity is not actual native LINE', e => { e.answer.conflicts[0].type = 'entity' }],
  ['unrelated manual note in final conflict answer', e => { e.answer.conflicts.push({ id: 'NOTE-MANUAL', type: 'TEXT' }) }],
  ['unrequested answer field', e => { e.answer.missingFields = [] }],
  ['mutation permission claim', e => { e.answer.mutationAllowed = true }],
  ['unexpected proposal', e => { e.proposal = { status: 'awaiting-host-approval' } }],
  ['unexpected second proposal', e => { e.proposals = [{ status: 'awaiting-host-approval' }] }],
  ['unexpected host approval', e => { e.hostApprovalApplied = true }],
  ['unrelated failed native read', e => { e.toolCalls.push({ name: 'cad_read_drawing', args: {}, result: { ok: false, error: { code: 'KJDOCUMENT_INVALID' } } }) }],
  ['non-read tool hidden in evidence', e => { e.toolCalls.push({ name: 'cad_propose_undo', args: {}, result: e.toolCalls[0].result }) }],
  ['stale extra read receipt', e => { const c = clone(e.toolCalls[0]); c.name = 'cad_read_drawing'; c.result.value.revision--; e.toolCalls.push(c) }],
  ['execution error cannot claim successful answer', e => { e.executionStatus = 'error' }],
]
for (const [name, tamper] of counterexamples) {
  test(`v6 strictly rejects ${name}, zero provider calls`, async () => {
    const { fixture, context, evidence } = await evidenceFor()
    try {
      const bad = { ...evidence, toolCalls: clone(evidence.toolCalls), answer: clone(evidence.answer) }
      tamper(bad)
      bad.rawFinalAnswer = JSON.stringify(bad.answer)
      assert.equal(evaluateSourceDriftInspectionV6Oracle(firstId, fixture, bad, { context }).status, 'failed')
    } finally { fixture.dispose() }
  })
}

test('v6 rejects raw-answer rewriting, absent inspection, foreign context and post-read native changes', async () => {
  const { fixture, context, evidence } = await evidenceFor()
  try {
    assert.equal(evaluateSourceDriftInspectionV6Oracle(firstId, fixture, { ...evidence, rawFinalAnswer: '{}' }, { context }).status, 'failed')
    assert.equal(evaluateSourceDriftInspectionV6Oracle(firstId, fixture, { ...evidence, toolCalls: [] }, { context }).status, 'not-evaluated')
    assert.throws(() => evaluateSourceDriftInspectionV6Oracle(SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS[1], fixture, evidence, { context }), /CONTEXT_MISMATCH/)
    const after = fixture.document.fork()
    await fixture.sdk.executeCommand('MOVE', { ids: ['CIRCLE-MANUAL'], dx: 1, dy: 0 }, { document: after })
    const changed = evaluateSourceDriftInspectionV6Oracle(firstId, fixture, { ...evidence, afterDocument: after }, { context })
    assert.equal(changed.status, 'failed')
    assert.equal(changed.assertions.find(row => row.id === 'read-only-state-unchanged').satisfied, false)
  } finally { fixture.dispose() }
})

test('v6 does not change the missing-fields exact requested-set contract', async () => {
  const { createGeologyAnswerContractV4Context, evaluateGeologyAnswerContractV4 } = await import('../scripts/testing/helpers/geology-answer-contract-v4.mjs')
  const { buildScenarioFixture } = await import('../scripts/testing/preflight-geology-user-scenarios.mjs')
  const scenario = scenarios.get('GUS1-source-query.read-missing-source-fields-zh-direct')
  const fixture = await buildScenarioFixture(scenario)
  try {
    const context = createGeologyAnswerContractV4Context({ scenario, fixture })
    const result = await new KJAgentToolSession(fixture.sdk, fixture.document).call('cad_read_geology_source', {
      expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 })
    const answer = { documentId: fixture.document.id, revision: fixture.initialRevision, decision: 'read-only', violations: [], questions: [],
      missingFields: [['initialWaterDepth'], ['stableWaterDepth'], ...['I-FILL', 'I-CLAY', 'I-SAND'].map(intervalId => ['strata', { intervalId }, 'description'])]
        .map(path => ({ basis: 'retained', holeId: 'TEST-A', path })) }
    const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: [{ name: 'cad_read_geology_source',
      args: { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId }, result }], answer, rawFinalAnswer: JSON.stringify(answer) }
    assert.equal(evaluateGeologyAnswerContractV4({ scenario, fixture, evidence, context }).status, 'satisfied')
    const extra = clone(answer)
    extra.missingFields.push({ basis: 'retained', holeId: 'TEST-A', path: ['groundwaterObservations'] })
    assert.equal(evaluateGeologyAnswerContractV4({ scenario, fixture, context,
      evidence: { ...evidence, answer: extra, rawFinalAnswer: JSON.stringify(extra) } }).status, 'failed')
  } finally { fixture.dispose() }
})

test('separate v6 driver runs six fixture conversations with actual reads, no paid calls or live passes', async () => {
  let request = 0
  const result = await runSourceDriftInspectionV6Scenarios({ modelCall: async ({ messages }) => {
    request++
    const receipts = messages.filter(row => row.role === 'tool').map(row => JSON.parse(row.content)).filter(row => row.ok).map(row => row.value)
    const text = messages.filter(row => row.role === 'user').map(row => row.content).join('\n')
    const revision = Number(text.match(/Host context: document [^;]+; revision (\d+)/)[1])
    const listing = receipts.find(row => Array.isArray(row.drawingIds))
    const inspection = receipts.find(row => row.inspectionOnly === true)
    const drawing = receipts.find(row => Array.isArray(row.entities))
    let name, args, content = ''
    if (!listing) { name = 'cad_read_geology_source'; args = { expectedRevision: revision, drawingId: '', maxBytes: 262144 } }
    else if (!inspection) { name = 'cad_read_geology_source'; args = { expectedRevision: revision, drawingId: listing.drawingIds[0], maxBytes: 262144, includeInspection: true } }
    else if (!drawing) { name = 'cad_read_drawing'; args = {} }
    else content = JSON.stringify({ documentId: inspection.documentId, revision: inspection.revision, drawingId: inspection.drawingId,
      sourceBacked: inspection.sourceBacked, sourceGeometryConsistent: inspection.sourceGeometryConsistent,
      conflicts: inspection.conflicts.map(row => ({ id: row.id, type: drawing.entities.find(entity => entity.id === row.id).type })), mutationAllowed: false })
    return { model: 'fixture-only', content, toolCalls: name ? [{ id: 'fixture-' + request, type: 'function', function: { name, arguments: JSON.stringify(args) } }] : [],
      finishReason: name ? 'tool_calls' : 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, elapsedMs: 0 }
  } })
  assert.equal(result.evidenceOrigin, 'fixture-oracle-selftest')
  assert.equal(result.realProviderRequests, 0)
  assert.equal(result.selected, 6)
  assert.equal(result.requests, 24)
  assert.equal(result.passed, 0)
  assert.equal(result.allSelectedPassed, false)
  assert.ok(result.scenarios.every(row => row.status === 'satisfied' && row.passed === null && row.acceptedEvidencePath === 'full-inspection-receipt'))
  assert.equal(result.protocol.version, SOURCE_DRIFT_INSPECTION_V6_PROTOCOL.version)
  assert.equal(result.executionSurface['tests/geology-source-drift-inspection-v6.spec.mjs'].length, 64)
})
