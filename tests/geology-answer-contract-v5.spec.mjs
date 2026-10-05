import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { buildRound3ScenarioFixture, evaluateRound3ScenarioOracle, expectedRound3ScenarioAnswer } from '../scripts/testing/helpers/geology-round3-scenario-oracles.mjs'
import { evaluateScenarioOracle, scenarioAnswerFrame } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { geologyLiveProtocol, geologyLiveProtocolV4, geologyLiveProtocolV5, GEOLOGY_V4_SCENARIO_IDS,
  frameScenarioPrompt, runGeologyUserScenarios } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const byIntent = intent => corpus.scenarios.find(item => !item.sequence && item.expected.intent === intent)
const driftScenario = byIntent('source-query.detect-source-graphic-drift')
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const has = (verdict, id) => verdict.assertions.find(item => item.id === id)?.satisfied
const score = (scenario, fixture, evidence, answerContractVersion = 'v5') =>
  evaluateScenarioOracle(scenario, fixture, evidence, { answerContractVersion })

async function actualEvidence(scenario, fixture, { repeats = 1, extraReads = [] } = {}) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), toolCalls = []
  for (let index = 0; index < repeats; index++) {
    const args = { drawingId: fixture.drawingId, expectedRevision: fixture.initialRevision, maxBytes: 262144 }
    const result = await session.call('cad_read_geology_source', args)
    assert.equal(result.ok, scenario.expected.intent !== driftScenario.expected.intent)
    toolCalls.push({ name: 'cad_read_geology_source', args, result })
  }
  for (const name of extraReads) {
    const args = { expectedRevision: fixture.initialRevision,
      ...(name === 'cad_read_layouts' ? { offset: 0, limit: 100, maxBytes: 262144 } : {}) }
    const result = await session.call(name, args)
    assert.equal(KJDRAW_AGENT_TOOLS.find(tool => tool.name === name).effect, 'read')
    assert.equal(result.ok, true, JSON.stringify(result))
    toolCalls.push({ name, args, result })
  }
  const answer = expectedRound3ScenarioAnswer(scenario, fixture)
  return { origin: 'fixture-oracle-selftest', toolCalls, afterDocument: fixture.document, answer,
    rawFinalAnswer: JSON.stringify(answer) }
}

test('v5 is opt-in, has its own protocol hash and a zero-request dry-run; frozen v3/v4 protocol hashes stay exact', () => {
  assert.equal(hash(geologyLiveProtocol), 'd920bcd844b88a7bdedb38d51283c96f3d39b97da4eaef795c91f12fcf73a069')
  assert.equal(hash(geologyLiveProtocolV4), 'ef8864b22c671e59e9e9198e59c094f816034b4011842f116d21b1ffef45f0a2')
  assert.notEqual(hash(geologyLiveProtocolV5), hash(geologyLiveProtocolV4))
  assert.notEqual(hash(geologyLiveProtocolV5), hash(geologyLiveProtocol))
  const result = spawnSync(process.execPath, ['scripts/testing/run-geology-user-scenarios.mjs', '--answer-contract-version', 'v5'],
    { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.mode, 'dry-run'); assert.equal(report.modelCalls, 0)
  assert.equal(report.version, 'geology-user-scenarios-live-v5')
  assert.equal(report.answerContractVersion, 'v5')
  assert.deepEqual(report.v4ScenarioIds, [...GEOLOGY_V4_SCENARIO_IDS])
  assert.ok(report.readyScenarios >= 498)
})

test('v5 clarifies wrapper metadata versus answer instance without changing v4 response schemas or frozen literal questions', () => {
  for (const id of GEOLOGY_V4_SCENARIO_IDS) {
    const scenario = corpus.scenarios.find(item => item.id === id)
    const v4 = scenarioAnswerFrame(scenario, { answerContractVersion: 'v4' })
    const v5 = scenarioAnswerFrame(scenario, { answerContractVersion: 'v5' })
    assert.equal(v5, v4)
    const prompt = frameScenarioPrompt(scenario, undefined, { answerContractVersion: 'v5' })
    assert.ok(prompt.startsWith(scenario.prompt + '\n\n'))
    assert.match(prompt, /version, responseSchema, nativePaths and rules are protocol documentation, NOT answer properties/)
    assert.ok(prompt.length < 10000)
    assert.equal(v5.includes('I-CLAY'), false); assert.equal(v5.includes('106.5'), false)
    assert.doesNotMatch(frameScenarioPrompt(scenario, undefined, { answerContractVersion: 'v4' }), /NOT answer properties/)
    assert.equal(frameScenarioPrompt(scenario, undefined), frameScenarioPrompt(scenario, undefined, { answerContractVersion: 'v3' }))
  }
  const mutation = byIntent('source-water-depth.paired-water-revision')
  assert.equal(frameScenarioPrompt(mutation, undefined, { answerContractVersion: 'v5' }), mutation.prompt)
})

test('v5 accepts repeated actual generated-drift receipts and actual public read tools without a hidden listing, but never counts fixture execution as live', async () => {
  const fixture = await buildRound3ScenarioFixture(driftScenario)
  try {
    const before = fixture.document.serialize()
    const evidence = await actualEvidence(driftScenario, fixture, { repeats: 3, extraReads: ['cad_read_history', 'cad_read_layouts'] })
    const verdict = score(driftScenario, fixture, evidence)
    assert.equal(verdict.status, 'satisfied', JSON.stringify(verdict))
    assert.equal(verdict.scenarioPassed, null); assert.equal(verdict.scenarioExecuted, false)
    assert.equal(fixture.document.serialize(), before)
    assert.equal(has(verdict, 'exact-retained-source-actually-read'), true)
    assert.equal(has(verdict, 'native-read-evidence-only'), true)
    assert.equal(has(verdict, 'exact-complete-answer-from-source-and-caller-tables'), true)
    for (const version of ['v3', 'v4']) {
      const old = score(driftScenario, fixture, evidence, version)
      assert.equal(old.status, 'failed')
      assert.equal(has(old, 'exact-retained-source-actually-read'), false)
      assert.equal(has(old, 'native-read-evidence-only'), false)
      assert.equal(has(old, 'exact-complete-answer-from-source-and-caller-tables'), true)
    }
  } finally { fixture.dispose() }
})

test('v5 read admission also permits successful public read receipts in other R3 read tasks while v3/v4 retain old behavior', async () => {
  const scenario = byIntent('investigation-preparation.coordinate-reference-check')
  const fixture = await buildRound3ScenarioFixture(scenario)
  try {
    const evidence = await actualEvidence(scenario, fixture, { extraReads: ['cad_read_history', 'cad_read_layouts'] })
    assert.equal(score(scenario, fixture, evidence).status, 'satisfied')
    assert.equal(score(scenario, fixture, evidence, 'v4').status, 'failed')
    assert.equal(evaluateRound3ScenarioOracle(scenario, fixture, evidence).status, 'failed', 'Direct default remains the archived contract')
  } finally { fixture.dispose() }
})

test('v5 rejects a failed receipt lacking actual conflict ID, wrong recipe, stale revision, wrong error code or a non-validator message', async () => {
  const fixture = await buildRound3ScenarioFixture(driftScenario)
  try {
    const baseline = await actualEvidence(driftScenario, fixture)
    const corruptions = [
      call => { call.args.drawingId = 'another-recipe' },
      call => { call.args.expectedRevision-- },
      call => { call.result.error.code = 'PROVIDER_HTTP_FAILURE' },
      call => { call.result.error.message = call.result.error.message.replace(fixture.oracleDriftedEntityIds[0], 'NOTE-MANUAL') },
      call => { call.result.error.message += ' invented evidence' },
      call => { call.result = { ok: false, error: { code: 'KJDOCUMENT_INVALID', message: 'Source might be inconsistent' } } },
    ]
    for (const corrupt of corruptions) {
      const evidence = { ...baseline, toolCalls: structuredClone(baseline.toolCalls) }; corrupt(evidence.toolCalls[0])
      const verdict = score(driftScenario, fixture, evidence)
      assert.equal(verdict.status, 'failed', JSON.stringify(evidence.toolCalls))
      assert.equal(has(verdict, 'native-read-evidence-only'), false)
      assert.equal(has(verdict, 'exact-retained-source-actually-read'), false)
    }
  } finally { fixture.dispose() }
})

test('v5 validates EVERY drift rejection and EVERY success receipt; a good earlier read does not excuse subsequent errors, stale or foreign reads', async () => {
  const fixture = await buildRound3ScenarioFixture(driftScenario)
  try {
    const baseline = await actualEvidence(driftScenario, fixture, { repeats: 2, extraReads: ['cad_read_history'] })
    const corruptions = [
      calls => { calls[1].result.error.message = 'Geology drawing update: missing source recipe' },
      calls => { calls[2].result.ok = false },
      calls => { calls[2].result.value.documentId = 'foreign-document' },
      calls => { calls[2].result.value.revision-- },
      calls => { calls[2].args.expectedRevision-- },
      calls => { calls[2].name = 'cad_custom_fabricated_read' },
      calls => { calls[2].name = 'cad_propose_undo' },
      calls => { delete calls[2].result.value.revision },
    ]
    for (const corrupt of corruptions) {
      const evidence = { ...baseline, toolCalls: structuredClone(baseline.toolCalls) }; corrupt(evidence.toolCalls)
      const verdict = score(driftScenario, fixture, evidence)
      assert.equal(verdict.status, 'failed')
      assert.equal(has(verdict, 'exact-retained-source-actually-read'), true)
      assert.equal(has(verdict, 'native-read-evidence-only'), false)
    }
  } finally { fixture.dispose() }
})

test('v5 retains exact actual drift set, full answer fields, raw-answer provenance and no proposal/approval conditions', async () => {
  const fixture = await buildRound3ScenarioFixture(driftScenario)
  try {
    const baseline = await actualEvidence(driftScenario, fixture)
    for (const change of [
      answer => { answer.conflicts.push({ id: 'NOTE-MANUAL', type: 'TEXT' }) },
      answer => { answer.conflicts = [] },
      answer => { answer.conflicts[0].type = 'CIRCLE' },
      answer => { answer.sourceGeometryConsistent = true },
      answer => { answer.mutationAllowed = true },
      answer => { answer.revision-- },
      answer => { answer.documentId = 'foreign-document' },
      answer => { answer.version = 'not-an-answer-field' },
      answer => { delete answer.sourceBacked },
    ]) {
      const answer = structuredClone(baseline.answer); change(answer)
      const verdict = score(driftScenario, fixture, { ...baseline, answer, rawFinalAnswer: JSON.stringify(answer) })
      assert.equal(verdict.status, 'failed')
      assert.equal(has(verdict, 'exact-complete-answer-from-source-and-caller-tables'), false)
    }
    for (const field of ['proposal', 'approval', 'approvalReceipt']) {
      const verdict = score(driftScenario, fixture, { ...baseline, [field]: { status: 'unexpected' } })
      assert.equal(verdict.status, 'failed')
      assert.equal(has(verdict, 'no-pending-plan-or-approval-in-read-only-task'), false)
    }
    const mismatch = score(driftScenario, fixture, { ...baseline, origin: 'real-model', rawFinalAnswer: '{}' })
    assert.equal(mismatch.status, 'not-evaluated')
    assert.equal(mismatch.reason, 'raw-structured-model-answer-missing-or-mismatched')
  } finally { fixture.dispose() }
})

test('v5 rejects any actual mutation to unowned content, even with correct conflict answer and actual read evidence', async () => {
  const fixture = await buildRound3ScenarioFixture(driftScenario)
  try {
    const evidence = await actualEvidence(driftScenario, fixture)
    await fixture.sdk.executeCommand('MOVE', { ids: ['NOTE-MANUAL'], dx: 1, dy: 0 }, { document: fixture.document })
    const verdict = score(driftScenario, fixture, evidence)
    assert.equal(verdict.status, 'failed'); assert.equal(has(verdict, 'read-only-state-unchanged'), false)
  } finally { fixture.dispose() }
})

test('v5 runtime integration uses v4 native missing-fields evaluation and wrapper clarification; actual SDK receipts remain fixture-only', async () => {
  const scenario = byIntent('source-query.read-missing-source-fields')
  let requests = 0
  const response = (toolCalls = [], content = null) => ({ model: 'fixture-model-not-live', toolCalls, content,
    finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 }, elapsedMs: 1 })
  const call = (name, args) => ({ id: 'v5-fixture-' + requests, type: 'function', function: { name, arguments: JSON.stringify(args) } })
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', scenarioIds: [scenario.id], maxScenarios: 1, maxRequests: 4,
    modelCall: async input => {
      requests++
      const prompt = input.messages.find(item => item.role === 'user').content
      assert.match(prompt, /NOT answer properties/); assert.ok(prompt.length <= 16000)
      if (requests === 1) {
        const marker = 'Read native data at the current revision before acting. '
        const bindings = JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length).split('\n\nFor automated review,')[0])
        return response([call('cad_read_geology_source', { drawingId: '', expectedRevision: bindings.revision, maxBytes: 262144 })])
      }
      const receipt = JSON.parse(input.messages.at(-1).content)
      assert.equal(receipt.ok, true)
      if (requests === 2) return response([call('cad_read_geology_source', { drawingId: receipt.value.drawingIds[0], expectedRevision: receipt.value.revision, maxBytes: 262144 })])
      const hole = receipt.value.facts.hole
      const missingFields = ['initialWaterDepth', 'stableWaterDepth'].filter(field => !Object.hasOwn(hole, field))
        .map(field => ({ basis: 'retained', holeId: hole.id, path: [field] }))
      for (const layer of hole.strata) if (!Object.hasOwn(layer, 'description'))
        missingFields.push({ basis: 'retained', holeId: hole.id, path: ['strata', { intervalId: layer.intervalId }, 'description'] })
      return response([], JSON.stringify({ documentId: receipt.value.documentId, revision: receipt.value.revision,
        decision: 'read-only', violations: [], missingFields, questions: [] }))
    } })
  assert.equal(report.requests, 3); assert.equal(report.realProviderRequests, 0)
  assert.equal(report.protocolSha256, hash(geologyLiveProtocolV5))
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify(report.scenarios[0]))
  assert.equal(report.scenarios[0].passed, null); assert.equal(report.passed, 0)
  assert.equal(report.notEvaluated, 1); assert.equal(report.allSelectedPassed, false)
  assert.equal(report.transportFailures.length, 0)
  assert.ok(report.scenarios[0].assertions.every(item => item.kind && item.name))
})
