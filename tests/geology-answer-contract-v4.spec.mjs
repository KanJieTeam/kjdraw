import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { buildScenarioFixture } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { declaredGeologyScenarioRequestV4, createGeologyAnswerContractV4Context, geologyAnswerContractV4Frame,
  evaluateGeologyAnswerContractV4, isGeologyAnswerContractV4Scenario } from '../scripts/testing/helpers/geology-answer-contract-v4.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8')), clone = value => structuredClone(value)
const scenario = (intent, interaction = 'direct', language = 'zh-CN') => corpus.scenarios.find(item => !item.sequence && item.expected.intent === intent && item.interaction === interaction && item.language === language)
const ref = (holeId, path, basis = 'requested') => ({ holeId, path, basis })
const operand = (holeId, path, value) => ({ ref: ref(holeId, path), value })
async function sourceEvidence(fixture, drawingIds = [fixture.drawingId]) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  for (const drawingId of drawingIds) {
    const args = { expectedRevision: fixture.initialRevision, drawingId, maxBytes: 262144 }, result = await session.call('cad_read_geology_source', args)
    assert.equal(result.ok, true); calls.push({ name: 'cad_read_geology_source', args, result })
  }
  // Reimport into a separate actual SDK so repeated evidence reads do not
  // replace the fixture's attached document with a same-ID reopened object.
  const reader = createKJDrawSDK()
  const afterDocument = await reader.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }), { format: 'KJD' })
  return { origin: 'fixture-oracle-selftest', afterDocument, toolCalls: calls, executionStatus: 'message', proposal: null, approvalReceipt: null }
}
function evaluate(s, fixture, evidence, answer, context) {
  const combined = { ...evidence, answer, rawFinalAnswer: JSON.stringify(answer) }
  return evaluateGeologyAnswerContractV4({ scenario: s, fixture, evidence: combined, context })
}
function pass(s, fixture, evidence, answer, context) { const result = evaluate(s, fixture, evidence, answer, context); assert.equal(result.fixtureSatisfied, true, JSON.stringify(result)); assert.equal(result.scenarioPassed, null); assert.equal(result.scenarioExecuted, false); return result }
function fail(s, fixture, evidence, answer, context) { const result = evaluate(s, fixture, evidence, answer, context); assert.equal(result.fixtureSatisfied, false, JSON.stringify(result)); return result }
function blocked(context, violation, refs = violation.operands.map(item => item.ref)) {
  return { documentId: context.documentId, revision: context.revision, decision: 'blocked', violations: [violation], missingFields: [],
    questions: [{ purpose: 'correct-invalid', refs, text: 'Please provide corrected native source facts for these fields before any edit.' }] }
}

test('all 60 existing invalid/ambiguity/missing-source questions have explicit caller manifests and no fabricated duplicate updates', async () => {
  const intents = new Set(['ambiguity.thickness-target-unspecified', 'source-query.read-missing-source-fields']), selected = corpus.scenarios.filter(item => !item.sequence && (item.expected.intent.startsWith('invalid-source.') && isGeologyAnswerContractV4Scenario(item) || intents.has(item.expected.intent)))
  assert.equal(selected.length, 60)
  const fixtures = new Map()
  try {
    for (const s of selected) {
      let fixture = fixtures.get(s.expected.intent)
      if (!fixture) { fixture = await buildScenarioFixture(s); fixtures.set(s.expected.intent, fixture) }
      const request = declaredGeologyScenarioRequestV4(s), context = createGeologyAnswerContractV4Context({ scenario: s, fixture, requestedChanges: request })
      assert.equal(request.provenance, 'caller-declared-frozen-user-request')
      if (request.kind === 'identity-multiplicity') { assert.deepEqual(context.requestedUpdates, []); assert.equal(request.atLeast, 2); assert.equal(request.value, 'I-CLAY') }
      if (request.kind === 'invalid-request') assert.ok(context.requestedUpdates.length)
      const frame = geologyAnswerContractV4Frame(s)
      assert.equal(frame.includes(fixture.document.id), false); assert.equal(frame.includes(fixture.drawingId), false)
      assert.equal(frame.includes('I-CLAY'), false); assert.equal(frame.includes('106.5'), false)
    }
  } finally { for (const fixture of fixtures.values()) fixture.dispose() }
})

test('context uses declared request facts and retained native data without reading previous answer/outcome fields', async () => {
  const s = scenario('invalid-source.interval-gap'), fixture = await buildScenarioFixture(s)
  try {
    for (const name of ['expectedScenarioAnswer', 'expectedScenarioOutcome', 'expectedOutcome', 'oracleExpectedSource', 'oracleExpectedGeometry']) Object.defineProperty(fixture, name, { get() { throw new Error('GOLD_ACCESS') } })
    const request = declaredGeologyScenarioRequestV4(s), before = fixture.document.serialize(), context = createGeologyAnswerContractV4Context({ scenario: s, fixture, requestedChanges: request })
    const supplied = context.requestedUpdates[0].strata.find(interval => interval.intervalId === 'I-CLAY')
    assert.equal(supplied.top, 4); assert.equal(supplied.bottom, fixture.source.input.hole.strata.find(interval => interval.intervalId === 'I-CLAY').bottom)
    assert.equal(fixture.document.serialize(), before)
    assert.throws(() => createGeologyAnswerContractV4Context({ scenario: { ...s, prompt: s.prompt + ' now change something else' }, fixture }), /FROZEN_ORIGINAL_QUESTION_REQUIRED/)
    assert.throws(() => createGeologyAnswerContractV4Context({ scenario: s, fixture, requestedChanges: { ...request, originalPromptSha256: 'wrong' } }), /CALLER_REQUEST_BINDING_REQUIRED/)
  } finally { fixture.dispose() }
})

test('native negative/gap answers pass only with truthful measured units, operands, source reads and corrective questions', async () => {
  for (const intent of ['invalid-source.negative-water-depth', 'invalid-source.interval-gap']) {
    const s = scenario(intent), fixture = await buildScenarioFixture(s)
    try {
      const context = createGeologyAnswerContractV4Context({ scenario: s, fixture }), evidence = await sourceEvidence(fixture)
      const violation = intent.endsWith('negative-water-depth') ? { operator: 'range', operands: [operand('TEST-A', ['initialWaterDepth'], -2)], minimum: 0, units: 'meter' } :
        { operator: 'eq', operands: [operand('TEST-A', ['strata', { intervalId: 'I-CLAY' }, 'top'], 4), operand('TEST-A', ['strata', { intervalId: 'I-FILL' }, 'bottom'], 3)], units: 'meter' }
      const answer = blocked(context, violation); pass(s, fixture, evidence, answer, context)
      const falseUnit = clone(answer); falseUnit.violations[0].units = 'millimeter'; fail(s, fixture, evidence, falseUnit, context)
      const noQuestion = clone(answer); noQuestion.questions = []; fail(s, fixture, evidence, noQuestion, context)
      const wrongValue = clone(answer); wrongValue.violations[0].operands[0].value = 99; fail(s, fixture, evidence, wrongValue, context)
      const committed = { ...evidence, approvalReceipt: { status: 'committed' }, executionStatus: 'committed' }; fail(s, fixture, committed, answer, context)
    } finally { fixture.dispose() }
  }
})

test('quantified duplicate identities are rejected without guessing which two intervals the user meant', async () => {
  const s = scenario('invalid-source.duplicate-interval-identity'), fixture = await buildScenarioFixture(s)
  try {
    const context = createGeologyAnswerContractV4Context({ scenario: s, fixture }), evidence = await sourceEvidence(fixture)
    assert.deepEqual(context.requestedUpdates, [])
    const identity = ref('TEST-A', ['strata', '*', 'intervalId']), answer = blocked(context, { operator: 'unique', operands: [{ ref: identity, value: { value: 'I-CLAY', atLeast: 2 } }] }, [identity])
    pass(s, fixture, evidence, answer, context)
    for (const mutate of [a => { a.questions = [] }, a => { a.violations = [] }, a => { a.violations[0].operands[0].value.atLeast = 1 },
      a => { a.violations[0].operands[0].value.value = 'UNSUPPLIED-ID' }, a => { a.violations[0].operands[0].value = ['I-FILL', 'I-CLAY', 'I-CLAY'] },
      a => { a.violations[0].operands[0].ref.path[1] = { index: 2 } }]) { const bad = clone(answer); mutate(bad); fail(s, fixture, evidence, bad, context) }
  } finally { fixture.dispose() }
})

test('missing source fields use absent native description refs and reject reporting existing names as absent', async () => {
  const s = scenario('source-query.read-missing-source-fields'), fixture = await buildScenarioFixture(s)
  try {
    const context = createGeologyAnswerContractV4Context({ scenario: s, fixture }), evidence = await sourceEvidence(fixture)
    const answer = { documentId: context.documentId, revision: context.revision, decision: 'read-only', violations: [], questions: [], missingFields: clone(context.readTargets) }
    pass(s, fixture, evidence, answer, context)
    const partial = clone(answer); partial.missingFields.pop(); fail(s, fixture, evidence, partial, context)
    const present = clone(answer); present.missingFields.push(ref('TEST-A', ['strata', { intervalId: 'I-CLAY' }, 'name'], 'retained')); fail(s, fixture, evidence, present, context)
  } finally { fixture.dispose() }
})

test('genuine thickness ambiguities require all three typed native questions and never legacy pseudo-fields', async () => {
  const s = scenario('ambiguity.thickness-target-unspecified'), fixture = await buildScenarioFixture(s)
  try {
    const context = createGeologyAnswerContractV4Context({ scenario: s, fixture }), evidence = await sourceEvidence(fixture)
    const answer = { documentId: context.documentId, revision: context.revision, decision: 'clarification-required', violations: [], missingFields: [], questions: [
      { purpose: 'identify-target', refs: [ref('TEST-A', ['strata', '*', 'intervalId'])], text: 'Which source interval should change?' },
      { purpose: 'supply-value', refs: [ref('TEST-A', ['strata', '*', 'bottom'])], text: 'What revised measured boundary is supplied?' },
      { purpose: 'resolve-adjacency', refs: [ref('TEST-A', ['strata', '*', 'top'])], text: 'How should adjoining boundaries be treated?' },
    ] }
    pass(s, fixture, evidence, answer, context)
    for (let i = 0; i < 3; i++) { const bad = clone(answer); bad.questions.splice(i, 1); fail(s, fixture, evidence, bad, context) }
  } finally { fixture.dispose() }
})

test('complete native listing passes, while an explicit additional inventory mock cannot be covered by one real recipe read', async () => {
  const s = scenario('source-query.list-source-recipes'), fixture = await buildScenarioFixture(s)
  try {
    const context = createGeologyAnswerContractV4Context({ scenario: s, fixture }), answer = { drawingIds: [fixture.drawingId], sourceBacked: true }
    const listing = await sourceEvidence(fixture, ['']); pass(s, fixture, listing, answer, context)
    const one = await sourceEvidence(fixture), fabricated = { ...one, toolCalls: clone(one.toolCalls) }
    fabricated.toolCalls[0].result.value.facts.hole.depth = 999; fail(s, fixture, fabricated, answer, context)
    fail(s, fixture, listing, { drawingIds: [...answer.drawingIds, 'geo-guess-from-title'], sourceBacked: true }, context)

    // Explicit evaluator-only adversarial mock, NOT a second executed engine
    // recipe. Current CREATEBATCH forbids the compiler's repeated GEO_* table
    // names, so do not fabricate a multi-recipe engine success.
    const retained = clone(fixture.document.snapshot()), extraId = 'geo-explicit-inventory-mock'
    retained.opaquePayloads['geology-drawing-recipe:' + extraId] = { fixtureMockOnly: true }
    const document = { id: fixture.document.id, revision: fixture.document.revision, spaces: fixture.document.spaces,
      snapshot: () => clone(retained), getObject: fixture.document.getObject.bind(fixture.document) }
    const mockFixture = { ...fixture, document }, mockContext = createGeologyAnswerContractV4Context({ scenario: s, fixture: mockFixture })
    const mockEvidence = { ...one, afterDocument: document }
    fail(s, mockFixture, mockEvidence, { drawingIds: [fixture.drawingId, extraId], sourceBacked: true }, mockContext)
    fail(s, mockFixture, mockEvidence, answer, mockContext)
  } finally { fixture.dispose() }
})

test('one exact native recipe read is sufficient for a single stored recipe without pretending there was a listing call', async () => {
  const s = scenario('source-query.list-source-recipes'), fixture = await buildScenarioFixture(s)
  try {
    const evidence = await sourceEvidence(fixture), context = createGeologyAnswerContractV4Context({ scenario: s, fixture })
    assert.equal(evidence.toolCalls[0].result.value.drawingIds, undefined)
    pass(s, fixture, evidence, { drawingIds: [fixture.drawingId], sourceBacked: true }, context)
  } finally { fixture.dispose() }
})

test('Chinese redundant sensitive query is harmless after a proven complete insensitive query, but misses and wrong positions fail', async () => {
  const s = scenario('cad-query.partial-label'), fixture = await buildScenarioFixture(s)
  try {
    const session = new KJAgentToolSession(fixture.sdk, fixture.document), context = createGeologyAnswerContractV4Context({ scenario: s, fixture }), calls = []
    for (const caseSensitive of [false, true]) { const args = { expectedRevision: fixture.initialRevision, search: '地下水', caseSensitive, maxBytes: 262144 }, result = await session.call('cad_find_text', args); assert.equal(result.ok, true); calls.push({ name: 'cad_find_text', args, result }) }
    const project = m => ({ id: m.id, handle: m.handle, text: m.text, layerId: m.layerId, layerName: m.layerName, position: m.position })
    const answer = { matches: calls[0].result.value.matches.map(project) }, evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: calls, executionStatus: 'message' }
    pass(s, fixture, evidence, answer, context)
    fail(s, fixture, { ...evidence, toolCalls: [calls[1]] }, answer, context)
    fail(s, fixture, evidence, { matches: answer.matches.slice(1) }, context)
    const moved = clone(answer); moved.matches[0].position[0] += 1; fail(s, fixture, evidence, moved, context)
    const fakeReceipt = { ...evidence, toolCalls: clone(calls) }; fakeReceipt.toolCalls[0].result.value.matches.pop(); fail(s, fixture, fakeReceipt, answer, context)
    const report = fail(s, fixture, evidence, moved, context)
    assert.equal(report.assertions.find(item => item.id === 'base:read-only-state-unchanged').satisfied, true)
    assert.ok(report.assertions.some(item => item.kind === 'declared-contract' && !item.satisfied))
    assert.equal(new Set(report.assertions.map(item => item.id)).size, report.assertions.length)
  } finally { fixture.dispose() }
})

test('actual native full reads are revision bound, full-state protected, and fixture callers never become live evidence', async () => {
  const s = scenario('source-query.list-source-recipes'), fixture = await buildScenarioFixture(s)
  try {
    const context = createGeologyAnswerContractV4Context({ scenario: s, fixture }), evidence = await sourceEvidence(fixture), answer = { drawingIds: [fixture.drawingId], sourceBacked: true }
    const bad = { ...evidence, toolCalls: clone(evidence.toolCalls) }; bad.toolCalls[0].args.expectedRevision--; fail(s, fixture, bad, answer, context)
    const after = evidence.afterDocument
    await after.transact('Changed unrelated native object', tx => tx.createEntity('CIRCLE', { center: [900, 900, 0], radius: 1 }, { id: 'unapproved-change' }))
    fail(s, fixture, evidence, answer, context)
    const malformed = { ...evidence, afterDocument: fixture.document, toolCalls: [] }; fail(s, fixture, malformed, answer, context)
    const raw = { ...evidence, afterDocument: fixture.document, answer, rawFinalAnswer: 'private-secret-shaped text is not JSON' }
    const result = evaluateGeologyAnswerContractV4({ scenario: s, fixture, evidence: raw, context })
    assert.equal(JSON.stringify(result).includes('private-secret-shaped'), false)
    const recipe = readGeologyDrawingRecipe(fixture.document, fixture.drawingId); assert.equal(recipe.source.kind, 'column')
  } finally { fixture.dispose() }
})
