import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { buildRound3ScenarioFixture, evaluateRound3ScenarioOracle, expectedRound3ScenarioAnswer } from '../scripts/testing/helpers/geology-round3-scenario-oracles.mjs'
import { buildScenarioFixture } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { geologyAnswerContractV4Frame, createGeologyAnswerContractV4Context } from '../scripts/testing/helpers/geology-answer-contract-v4.mjs'
import { normalizeGeologyFailClosedAnswer } from '../scripts/testing/helpers/geology-fail-closed-contract.mjs'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJModelAdapter } from '../packages/kjdraw-sdk/src/model-adapters.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const driftScenario = corpus.scenarios.find(item => item.id === 'GUS1-source-query.detect-source-graphic-drift-zh-direct')
const missingScenario = corpus.scenarios.find(item => item.id === 'GUS1-source-query.read-missing-source-fields-zh-direct')
async function driftEvidence(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), toolCalls = []
  for (const drawingId of ['', fixture.drawingId]) {
    const args = { drawingId, expectedRevision: fixture.initialRevision, maxBytes: 262144 }, result = await session.call('cad_read_geology_source', args)
    assert.equal(result.ok, drawingId === ''); toolCalls.push({ name: 'cad_read_geology_source', args, result })
  }
  const answer = expectedRound3ScenarioAnswer(driftScenario, fixture)
  return { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls, answer, rawFinalAnswer: JSON.stringify(answer) }
}
const assertion = (result, id) => result.assertions.find(item => item.id === id)?.satisfied

test('round3 drift IS satisfiable with actual complete listing plus one actual validator rejection, not a successful exact-source read', async () => {
  const fixture = await buildRound3ScenarioFixture(driftScenario)
  try {
    const before = fixture.document.serialize(), evidence = await driftEvidence(fixture), rejected = evidence.toolCalls[1].result
    assert.deepEqual(Object.keys(rejected).sort(), ['error', 'ok'])
    assert.deepEqual(Object.keys(rejected.error).sort(), ['code', 'message'])
    assert.equal(rejected.error.code, 'KJDOCUMENT_INVALID')
    assert.ok(fixture.oracleDriftedEntityIds.every(id => rejected.error.message.includes(`generated object changed: ${id};`)))
    assert.equal(rejected.sourceConsistency, undefined); assert.equal(rejected.conflicts, undefined)
    const result = evaluateRound3ScenarioOracle(driftScenario, fixture, evidence)
    assert.equal(result.status, 'satisfied', JSON.stringify(result)); assert.equal(result.scenarioPassed, null)
    assert.equal(fixture.document.serialize(), before)
  } finally { fixture.dispose() }
})

test('current round3 contract rejects an additional actual SDK effect-read history receipt despite exact unchanged drift evidence', async () => {
  const fixture = await buildRound3ScenarioFixture(driftScenario)
  try {
    const evidence = await driftEvidence(fixture), session = new KJAgentToolSession(fixture.sdk, fixture.document)
    const args = { expectedRevision: fixture.initialRevision }, result = await session.call('cad_read_history', args)
    assert.equal(KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_read_history').effect, 'read')
    assert.equal(result.ok, true)
    const verdict = evaluateRound3ScenarioOracle(driftScenario, fixture, { ...evidence, toolCalls: [...evidence.toolCalls, { name: 'cad_read_history', args, result }] })
    assert.equal(verdict.status, 'failed')
    assert.equal(assertion(verdict, 'exact-retained-source-actually-read'), true)
    assert.equal(assertion(verdict, 'exact-complete-answer-from-source-and-caller-tables'), true)
    assert.equal(assertion(verdict, 'read-only-state-unchanged'), true)
    assert.equal(assertion(verdict, 'native-read-evidence-only'), false)
    assert.equal(verdict.scenarioPassed, null, 'This documents a contract gap, never a live model pass')
  } finally { fixture.dispose() }
})

test('current round3 contract rejects repeating the same actual drift-validation read because only the first failed receipt is exempted', async () => {
  const fixture = await buildRound3ScenarioFixture(driftScenario)
  try {
    const evidence = await driftEvidence(fixture), session = new KJAgentToolSession(fixture.sdk, fixture.document)
    const args = structuredClone(evidence.toolCalls[1].args), result = await session.call('cad_read_geology_source', args)
    assert.equal(result.ok, false); assert.deepEqual(result, evidence.toolCalls[1].result)
    const verdict = evaluateRound3ScenarioOracle(driftScenario, fixture, { ...evidence, toolCalls: [...evidence.toolCalls, { name: 'cad_read_geology_source', args, result }] })
    assert.equal(assertion(verdict, 'exact-retained-source-actually-read'), true)
    assert.equal(assertion(verdict, 'read-only-state-unchanged'), true)
    assert.equal(assertion(verdict, 'native-read-evidence-only'), false)
  } finally { fixture.dispose() }
})

test('current drift contract requires an extra listing receipt even when the exact actual validator supplies the conflict identity', async () => {
  const fixture = await buildRound3ScenarioFixture(driftScenario)
  try {
    const evidence = await driftEvidence(fixture)
    const verdict = evaluateRound3ScenarioOracle(driftScenario, fixture, { ...evidence, toolCalls: [evidence.toolCalls[1]] })
    assert.equal(verdict.status, 'failed')
    assert.equal(assertion(verdict, 'native-read-evidence-only'), true)
    assert.equal(assertion(verdict, 'exact-complete-answer-from-source-and-caller-tables'), true)
    assert.equal(assertion(verdict, 'read-only-state-unchanged'), true)
    assert.equal(assertion(verdict, 'exact-retained-source-actually-read'), false)
  } finally { fixture.dispose() }
})

test('v5 observed protocol wrapper keys are NOT answer fields; strict valid native instances remain accepted', async () => {
  const fixture = await buildScenarioFixture(missingScenario)
  try {
    const context = createGeologyAnswerContractV4Context({ scenario: missingScenario, fixture })
    const frame = JSON.parse(geologyAnswerContractV4Frame(missingScenario))
    const instance = { documentId: context.documentId, revision: context.revision, decision: 'read-only', violations: [], missingFields: context.readTargets, questions: [] }
    assert.deepEqual(normalizeGeologyFailClosedAnswer(instance), instance)
    for (const wrapper of [{ version: frame.version }, { responseSchema: frame.responseSchema }, { ...frame }]) {
      assert.throws(() => normalizeGeologyFailClosedAnswer({ ...instance, ...wrapper }))
    }
    assert.equal(frame.responseSchema.additionalProperties, false)
    assert.equal(frame.responseSchema.properties.version, undefined)
    assert.equal(frame.responseSchema.properties.responseSchema, undefined)
  } finally { fixture.dispose() }
})

test('candidate v5 clarification disambiguates public protocol metadata from the answer instance without introducing source IDs, values or gold', () => {
  // PROPOSAL ONLY. The active frame, runner, preflight and old reports remain
  // untouched; no assertion here proves a real model understood this wording.
  const frame = geologyAnswerContractV4Frame(missingScenario)
  const candidate = 'Return ONLY one JSON answer instance that validates responseSchema. The outer protocol version, responseSchema, nativePaths and rules are documentation, NOT answer properties. Do not copy them into your answer. ' + frame
  assert.ok(candidate.includes('NOT answer properties'))
  assert.equal(candidate.includes('I-CLAY'), false); assert.equal(candidate.includes('106.5'), false)
  assert.ok(candidate.length < 8000)
})

test('actual v5 public malformed argument bytes remain invalid and rejected while recovered outbound history omits only the invalid wire pair', async () => {
  // Exact public synthetic byte sequence from v5 DeepSeek shard-2 wire-0066.
  // This is an offline adapter-wire reproduction, NOT an actual HTTP 400 or
  // evidence that Qwen rejected this response; DeepSeek later repaired it.
  const raw = '{"expectedRevision": 1, "filters": {"ids" string="false">["entity-821697af-71c2-484f-aefb-f29ccdb046b0"]}, "offset": 0, "layerOffset": 0, "limit": 1, "maxLayers": 0, "maxBytes": 262144}'
  assert.equal(Buffer.byteLength(raw), 185)
  assert.equal(createHash('sha256').update(raw).digest('hex'), '68bf791174de23b7c6b32f3a1395224e911086f538557a095dbb4455d105b284')
  assert.throws(() => JSON.parse(raw))
  const requests = [], sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const before = document.serialize()
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'fixture-only', request: async request => {
    requests.push(structuredClone(request.body))
    return { model: 'fixture-only', choices: [{ message: { role: 'assistant', content: requests.length === 1 ? null : 'Offline fixture completed',
      ...(requests.length === 1 ? { tool_calls: [{ id: 'public-malformed-call', type: 'function', function: { name: 'cad_query_drawing', arguments: raw } }] } : {}) },
      finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }
  } })
  const conversation = model.createConversation({ instructions: 'Public synthetic fixture test only', tools: session.definitions.filter(tool => tool.name === 'cad_query_drawing') })
  const signal = new AbortController().signal
  const first = await conversation.next({ kind: 'prompt', text: 'Read this public fixture without changing it.' }, signal)
  assert.equal(first.calls[0].arguments, null)
  const result = await session.call(first.calls[0].name, first.calls[0].arguments)
  assert.equal(result.ok, false); assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
  await conversation.next({ kind: 'tool-results', results: [{ id: first.calls[0].id, name: first.calls[0].name, result }] }, signal)
  assert.equal(requests[1].messages.some(message => message.tool_calls?.some(call => call.id === 'public-malformed-call')), false)
  assert.equal(requests[1].messages.some(message => message.tool_call_id === 'public-malformed-call'), false)
  const correction = JSON.parse(requests[1].messages.at(-1).content)
  assert.equal(correction.ok, false); assert.equal(correction.error.code, result.error.code)
  assert.equal(correction.rejectedCalls[0].id, 'public-malformed-call')
  assert.equal(JSON.stringify(requests[1]).includes(raw), false)
  assert.throws(() => JSON.parse(raw), 'Original provider bytes are never guessed into valid parameters')
  assert.equal(requests.length, 2); assert.equal(document.serialize(), before)
})
