import test from 'node:test'
import assert from 'node:assert/strict'
import { ROUND4_NATIVE_SCENARIO_IDS, round4NativeAnswerFrame, round4NativeDescriptor, buildRound4NativeFixture,
  expectedRound4NativeAnswer, evaluateRound4NativeOracle } from '../scripts/testing/helpers/geology-round4-native-oracles.mjs'
import { ROUND4_READ_ANSWER_POLICY_VERSION, ROUND4_READ_ANSWER_POLICY_INTENTS,
  round4ReadAnswerPolicyInstructions, round4ReadAnswerFrameWithPolicy } from '../scripts/testing/helpers/geology-read-answer-policy.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'

const optIn = { answerPolicyVersion: ROUND4_READ_ANSWER_POLICY_VERSION }

test('legacy defaults preserve every original R4 read frame byte-for-byte', () => {
  for (const id of ROUND4_NATIVE_SCENARIO_IDS) {
    assert.equal(round4ReadAnswerFrameWithPolicy(id), round4NativeAnswerFrame(id))
    assert.equal(round4ReadAnswerFrameWithPolicy(id, { answerPolicyVersion: 'legacy' }), round4NativeAnswerFrame(id))
    assert.equal(round4ReadAnswerPolicyInstructions(id), null)
  }
})

test('opt-in field policy adds vocabulary for only the two R4 read-only families, never CAD edits', () => {
  assert.deepEqual(ROUND4_READ_ANSWER_POLICY_INTENTS, ['cad-query.native-object', 'cad-query.endpoint-topology'])
  let changed = 0
  for (const id of ROUND4_NATIVE_SCENARIO_IDS) {
    const descriptor = round4NativeDescriptor(id), instructions = round4ReadAnswerPolicyInstructions(id, optIn)
    const original = round4NativeAnswerFrame(id), framed = round4ReadAnswerFrameWithPolicy(id, optIn)
    if (descriptor.kind !== 'read-only') {
      assert.equal(instructions, null)
      assert.equal(framed, original)
      continue
    }
    changed++
    assert.ok(framed.startsWith(`${original}\n`), 'original field grammar remains intact')
    assert.ok(framed.endsWith(instructions))
    assert.match(instructions, /"owner-local" means native definition coordinates/)
    assert.match(instructions, /ownerId as the separate native identity field/)
    assert.match(instructions, /actual current drawing/)
    assert.doesNotMatch(instructions, /\d|true|false|TEST-|LINE-|drawing-|entity-|\[[^\]]*\]|gold|fixture|connected\s*[=:]/,
      'added policy text contains no actual numbers, result booleans, fixture identities or data-shaped answers')
    if (descriptor.intent === 'cad-query.endpoint-topology') {
      assert.match(instructions, /"none" means only native endpoint\/vertex distance and owner identity/)
      assert.match(instructions, /makes no claim about whether.*connected/)
    } else assert.doesNotMatch(instructions, /semanticInference/)
  }
  assert.equal(changed, 12)
})

test('policy definitions are independent of language, variant, fixture and native output', () => {
  for (const intent of ROUND4_READ_ANSWER_POLICY_INTENTS) {
    const instructions = ROUND4_NATIVE_SCENARIO_IDS.filter(id => round4NativeDescriptor(id).intent === intent)
      .map(id => round4ReadAnswerPolicyInstructions(id, optIn))
    assert.equal(new Set(instructions).size, 1)
    assert.equal(round4ReadAnswerPolicyInstructions(intent, optIn), instructions[0])
  }
  assert.equal(round4ReadAnswerPolicyInstructions('cad-annotation.append-review-note', optIn), null)
})

test('unknown policy versions fail closed rather than silently changing archived frames', () => {
  assert.throws(() => round4ReadAnswerFrameWithPolicy('cad-query.native-object', { answerPolicyVersion: 'invented-policy' }),
    /Unsupported R4 read answer policy/)
})

test('native topology API itself declares these exact public policy codes; no oracle facts are supplied by the frame', async () => {
  const id = 'GUS1-cad-query.endpoint-topology-zh-direct', fixture = await buildRound4NativeFixture(id)
  try {
    const session = new KJAgentToolSession(fixture.sdk, fixture.document)
    const result = await session.call('cad_query_topology', { expectedRevision: fixture.initialRevision, units: 'millimeter',
      ids: ['LINE-A', 'LINE-B'].map(alias => fixture.identityAliases[alias].nativeId), tolerance: 0.01, maxBytes: 262144 })
    assert.equal(result.ok, true)
    assert.equal(result.value.coordinateSpace, 'owner-local')
    assert.equal(result.value.semanticInference, 'none')
    const instructions = round4ReadAnswerPolicyInstructions(id, optIn)
    assert.ok(instructions.includes(JSON.stringify(result.value.coordinateSpace)))
    assert.ok(instructions.includes(JSON.stringify(result.value.semanticInference)))
    for (const entity of result.value.entities) assert.ok(!instructions.includes(entity.id))
  } finally { fixture.dispose() }
})

test('opt-in changes only public vocabulary, never normalizes a wrong actual answer or geometry into a pass', async () => {
  const id = 'GUS1-cad-query.native-object-zh-direct', fixture = await buildRound4NativeFixture(id)
  try {
    const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
    const args = { expectedRevision: fixture.initialRevision, filters: { ids: [fixture.identityAliases['LINE-A'].nativeId] },
      offset: 0, layerOffset: 0, limit: 200, maxLayers: 100, maxBytes: 262144 }
    calls.push({ name: 'cad_query_drawing', args, result: await session.call('cad_query_drawing', args) })
    const answer = expectedRound4NativeAnswer(id, fixture)
    const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: calls, answer }
    assert.equal(evaluateRound4NativeOracle(id, fixture, evidence).status, 'satisfied')
    for (const policyAlias of ['model', 'native-owner']) {
      const wrong = structuredClone(answer)
      wrong.entity.coordinateSpace = policyAlias
      assert.equal(evaluateRound4NativeOracle(id, fixture, { ...evidence, answer: wrong }).status, 'failed')
    }
    const moved = structuredClone(answer)
    moved.entity.end[0] += 0.01
    assert.equal(evaluateRound4NativeOracle(id, fixture, { ...evidence, answer: moved }).status, 'failed')
    assert.equal(round4ReadAnswerFrameWithPolicy(id, optIn).startsWith(round4NativeAnswerFrame(id)), true)
    assert.equal(evaluateRound4NativeOracle(id, fixture, evidence).scenarioPassed, null, 'native selftest is not a model pass')
  } finally { fixture.dispose() }
})
