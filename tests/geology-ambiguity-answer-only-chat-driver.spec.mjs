import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  runAmbiguityAnswerOnlyChatWorkflow,
  ambiguityAnswerOnlyResponseFrame,
  AMBIGUITY_MODEL_INSTRUCTIONS,
  AMBIGUITY_MODEL_BUDGETS,
  AMBIGUITY_FROZEN_ORACLE_SOURCE_SHA256,
  AMBIGUITY_ANSWER_ONLY_CHAT_PROTOCOL,
  AMBIGUITY_ANSWER_ONLY_CHAT_PROTOCOL_SHA256,
} from '../scripts/testing/helpers/geology-ambiguity-answer-only-chat-driver.mjs'
import {
  resolveAmbiguityScenario, ambiguityResponseFrame, AMBIGUITY_PUBLIC_RESPONSE_SCHEMA,
  AMBIGUITY_PUBLIC_FACT_VOCABULARY, AMBIGUITY_PUBLIC_PURPOSE_VOCABULARY,
  AMBIGUITY_PUBLIC_KIND_VOCABULARY, AMBIGUITY_PUBLIC_DECISION_VOCABULARY,
} from '../scripts/testing/helpers/geology-ambiguity-oracles-v2-frozen.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const variants = ['zh-direct', 'zh-casual', 'en-direct', 'mixed', 'zh-followup', 'zh-correction']
const duplicateIds = variants.map(suffix => 'GUS1-ambiguity.duplicate-hole-labels-' + suffix)
const callerMarker = 'Declared caller context (not execution evidence):\n'
const clone = structuredClone

// Handwritten synthetic provider-wire controls only. They inspect public
// messages and actual returned native receipts, never fixture internals,
// private oracle expectations, selftest references, credentials or a provider.
function wire(calls = [], content = '') {
  return { model: 'offline-scripted-wire-not-a-provider', choices: [{
    finish_reason: calls.length ? 'tool_calls' : 'stop',
    message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) },
  }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }
}
function call(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}
function caller(body) {
  const text = body.messages[0].content, offset = text.indexOf(callerMarker)
  assert.ok(offset >= 0)
  return JSON.parse(text.slice(offset + callerMarker.length)).callerBindings
}
function receipt(body) {
  return JSON.parse(body.messages.filter(message => message.role === 'tool').at(-1).content)
}
function answer(bindings, matches, language) {
  return { documentId: bindings.documentId, revision: bindings.revision, decision: 'clarification-required',
    missingFacts: ['target.entityIds', 'operation.kind'],
    questions: language === 'en' ? [
      { fact: 'target.entityIds', purpose: 'identify-target', text: 'Which exact target object ID do you mean?' },
      { fact: 'operation.kind', purpose: 'resolve-scope', text: 'What edit operation do you want?' },
    ] : [
      { fact: 'target.entityIds', purpose: 'identify-target', text: '请明确目标对象 ID，是哪一个对象？' },
      { fact: 'operation.kind', purpose: 'resolve-scope', text: '请说明要进行哪一种修改操作？' },
    ],
    ambiguities: [{ kind: 'native-text-candidates', identifiers: matches.map(match => match.id) }] }
}
async function duplicateWorkflow(options = {}) {
  const scenarioId = options.scenarioId ?? duplicateIds[0]
  let ordinal = 0, bindings, drawing, first, second
  const observedRequests = []
  const result = await runAmbiguityAnswerOnlyChatWorkflow({
    scenarioId, protocol: 'chat-completions', model: 'offline-scripted-wire-not-a-provider',
    ...(options.evidenceOrigin ? { evidenceOrigin: options.evidenceOrigin } : {}),
    request: async request => {
      observedRequests.push(clone(request.body))
      ordinal++
      assert.deepEqual(request.body.response_format, { type: 'json_object' })
      assert.equal(request.body.tool_choice, 'auto')
      if (ordinal === 1) {
        bindings = caller(request.body)
        return wire([call('read-current', 'cad_read_drawing', {})])
      }
      if (ordinal === 2) {
        drawing = receipt(request.body).value
        return wire([call('find-page-0', 'cad_find_text', {
          expectedRevision: drawing.revision, search: 'TEST-A', match: 'exact', caseSensitive: true,
          includeHidden: options.includeHidden !== false, spaceId: drawing.spaceId,
          offset: 0, limit: 1, maxBytes: 65536,
        })])
      }
      if (ordinal === 3) {
        first = receipt(request.body).value
        if (!options.partial) return wire([call('find-page-1', 'cad_find_text', {
          expectedRevision: first.revision, search: first.search, match: first.match,
          caseSensitive: first.caseSensitive, includeHidden: options.includeHidden !== false,
          spaceId: first.spaceId, offset: first.nextOffset, limit: 1, maxBytes: 65536,
        })])
      } else second = receipt(request.body).value
      const matches = [...first.matches, ...(second?.matches ?? [])]
      const final = answer(bindings, matches, scenarioId.endsWith('en-direct') ? 'en' : 'zh')
      options.alterAnswer?.(final)
      return wire([], options.finalText ? options.finalText(final) : JSON.stringify(final))
    },
  })
  return { result, observedRequests }
}

test('frozen strict oracle is the unchanged v2 source; frozen original bank is preserved', async () => {
  const oracleBytes = await readFile(new URL('../scripts/testing/helpers/geology-ambiguity-oracles-v2-frozen.mjs', import.meta.url))
  assert.equal(hash(oracleBytes), AMBIGUITY_FROZEN_ORACLE_SOURCE_SHA256)
  assert.equal(AMBIGUITY_FROZEN_ORACLE_SOURCE_SHA256, 'ebd007056e2f96efa70f6e4653694bef7350547cc6c834bb5d459a32c670d114')
  const corpusBytes = await readFile(new URL('../tests/fixtures/geology-user-scenarios-v1.json', import.meta.url))
  assert.equal(hash(corpusBytes), '5b87d94884d24f375b04d98f485fe11aaf3768776f38f73df3a748ca6e616d0c')
  assert.equal(JSON.parse(corpusBytes).scenarios.length, 1080)
})

test('answer-only contract shares complete syntax and vocabulary without an answer or gold subset', () => {
  const frame = ambiguityAnswerOnlyResponseFrame()
  assert.deepEqual(AMBIGUITY_ANSWER_ONLY_CHAT_PROTOCOL.answerProperties,
    ['documentId', 'revision', 'decision', 'missingFacts', 'questions', 'ambiguities'])
  assert.equal(AMBIGUITY_ANSWER_ONLY_CHAT_PROTOCOL_SHA256.length, 64)
  assert.match(AMBIGUITY_MODEL_INSTRUCTIONS, /answer instance only/)
  assert.match(AMBIGUITY_MODEL_INSTRUCTIONS, /read every pagination offset/)
  assert.ok(frame.includes(JSON.stringify(AMBIGUITY_PUBLIC_RESPONSE_SCHEMA)))
  for (const values of [AMBIGUITY_PUBLIC_FACT_VOCABULARY, AMBIGUITY_PUBLIC_PURPOSE_VOCABULARY,
    AMBIGUITY_PUBLIC_KIND_VOCABULARY, AMBIGUITY_PUBLIC_DECISION_VOCABULARY]) {
    for (const [key, description] of Object.entries(values)) assert.ok(frame.includes(key + ': ' + description))
  }
  for (const marker of ['GUS1-', 'TEST-A', 'expectedFacts', 'expectedVerdict', 'selftestReference', '请选择准确的对象 ID？']) {
    assert.equal(frame.includes(marker), false)
  }
})

let sharedTools, sharedFrame
for (const scenarioId of duplicateIds) {
  test('wire-only complete native duplicate reads preserve clarification: ' + scenarioId, async () => {
    const { result, observedRequests } = await duplicateWorkflow({ scenarioId })
    const original = resolveAmbiguityScenario(scenarioId)
    assert.equal(result.originalPrompt, original.prompt)
    assert.equal(result.originalPromptSha256, hash(original.prompt))
    assert.equal(observedRequests[0].messages.at(-1).content, original.prompt)
    assert.equal(result.oraclePassed, true)
    assert.equal(result.oracle.oracleVersion, 'exact-native-clarification-oracle-v2')
    assert.equal(result.nativeToolCalls, 3)
    assert.equal(result.actualModelRequestAttempts, 4)
    assert.equal(result.authenticatedNativeEvents.length, 3)
    assert.equal(result.finalJsonParseError, null)
    assert.equal(result.finalJsonShapeError, null)
    assert.deepEqual(JSON.parse(result.finalRawText), result.finalJson)
    assert.deepEqual(Object.keys(result.finalJson).sort(), [...AMBIGUITY_ANSWER_ONLY_CHAT_PROTOCOL.answerProperties].sort())
    assert.equal(result.finalJson.ambiguities[0].identifiers.length, 2)
    assert.equal(result.authenticatedNativeEvents[1].args.includeHidden, true)
    assert.equal(result.authenticatedNativeEvents[2].args.offset, 1)
    assert.equal(result.authenticatedNativeEvents[2].result.value.nextOffset, null)
    assert.ok(Object.values(result.nativePreservation).every(Boolean))
    assert.equal(result.automaticNativeReads, 0)
    assert.equal(result.automaticArgumentRepairs, 0)
    assert.equal(result.transportRetryAttempts, 0)
    assert.equal(result.evidenceOrigin, 'fixture-oracle-selftest')
    assert.equal(result.fixtureOnly, true)
    assert.equal(result.userScenarioPassed, null, 'offline oracle pass is never user/model acceptance')
    assert.equal(result.providerRequestsVerified, null)
    assert.equal(result.usage.totals.totalTokens, 480)
    sharedTools ??= JSON.stringify(observedRequests[0].tools)
    assert.equal(JSON.stringify(observedRequests[0].tools), sharedTools)
    sharedFrame ??= result.sharedResponseFrame
    assert.equal(result.sharedResponseFrame, sharedFrame)
    assert.equal(result.outputProtocolSha256, AMBIGUITY_ANSWER_ONLY_CHAT_PROTOCOL_SHA256)
    const publicRequest = JSON.stringify(observedRequests[0])
    for (const marker of [scenarioId, 'selftestReference', 'selectedMissingFacts', 'expectedFacts',
      'expectedVerdict', 'oracleBaselineDocument', '请选择准确的对象 ID？']) assert.equal(publicRequest.includes(marker), false)
    assert.ok(observedRequests[0].tools.some(tool => tool.function.name === 'cad_propose_set_circle_radius'),
      'the shared tool table is not filtered to reads or a case-specific successful route')
  })
}

test('same public protocol also supports a different family without case-specific answers', async () => {
  let firstRequest
  const scenarioId = 'GUS1-ambiguity.water-depth-or-elevation-zh-direct'
  const result = await runAmbiguityAnswerOnlyChatWorkflow({ scenarioId, protocol: 'chat-completions', model: 'offline-wire',
    request: async request => {
      firstRequest = request.body
      const bindings = caller(request.body)
      return wire([], JSON.stringify({ documentId: bindings.documentId, revision: bindings.revision,
        decision: 'clarification-required', missingFacts: [], questions: [], ambiguities: [] }))
    } })
  assert.equal(JSON.stringify(firstRequest.tools), sharedTools)
  assert.equal(result.sharedResponseFrame, sharedFrame)
  assert.equal(result.oraclePassed, false)
  assert.equal(result.oracle.reason, 'NO_NATIVE_READ')
  assert.equal(result.userScenarioPassed, null)
})

for (const [label, finalText, expectedParseError, expectedShapeError] of [
  ['commentary before answer', final => 'I need clarification.\n' + JSON.stringify(final), 'AMBIGUITY_MODEL_FINAL_JSON', null],
  ['code fence around answer', final => '```json\n' + JSON.stringify(final) + '\n```', 'AMBIGUITY_MODEL_FINAL_JSON', null],
  ['contract plus second answer object', final => ambiguityResponseFrame() + '\n' + JSON.stringify(final), 'AMBIGUITY_MODEL_FINAL_JSON', null],
  ['contract fields merged into answer', final => JSON.stringify({ ...JSON.parse(ambiguityResponseFrame()), ...final }), null, 'AMBIGUITY_ANSWER_ONLY_RESPONSE_SHAPE'],
]) {
  test('contract-copy regression rejected without repair: ' + label, async () => {
    const { result } = await duplicateWorkflow({ finalText })
    assert.equal(result.oraclePassed, false)
    assert.equal(result.finalJsonParseError, expectedParseError)
    assert.equal(result.finalJsonShapeError, expectedShapeError)
    assert.equal(result.actualModelRequestAttempts, 4, 'no formatting retry or extracted fragment')
    assert.equal(result.userScenarioPassed, null)
    assert.ok(Object.values(result.nativePreservation).every(Boolean))
  })
}

for (const [label, options, expectedReason] of [
  ['partial pagination', { partial: true }, 'DUPLICATE_NATIVE_READ_INCOMPLETE_OR_WRONG_SCOPE'],
  ['hidden candidates omitted', { includeHidden: false }, 'DUPLICATE_NATIVE_READ_INCOMPLETE_OR_WRONG_SCOPE'],
  ['stale final revision', { alterAnswer: value => value.revision++ }, 'ANSWER_CURRENT_IDENTITY'],
  ['native IDs replaced by aliases', { alterAnswer: value => value.ambiguities[0].identifiers = ['TEXT-A', 'TEXT-A-DUPLICATE'] }, 'AMBIGUITY_NOT_ACTUAL_NATIVE_IDENTITIES'],
  ['unrelated missing scope added', { alterAnswer: value => value.missingFacts.push('requested.editScope') }, 'MISSING_FACTS_NOT_EXACT'],
  ['target-selection promise', { alterAnswer: value => value.questions[0].text = 'Which exact target object ID? I will select the first automatically.' }, 'QUESTION_SEMANTICS'],
]) {
  test('unchanged strict oracle still rejects: ' + label, async () => {
    const { result } = await duplicateWorkflow(options)
    assert.equal(result.oraclePassed, false)
    assert.equal(result.oracle.reason, expectedReason)
    assert.equal(result.userScenarioPassed, null)
    assert.ok(Object.values(result.nativePreservation).every(Boolean))
  })
}

test('a declared real origin cannot establish provider transport or user acceptance', async () => {
  const { result } = await duplicateWorkflow({ evidenceOrigin: 'real-model' })
  assert.equal(result.oraclePassed, true)
  assert.equal(result.fixtureOnly, false)
  assert.equal(result.providerRequestsVerified, null)
  assert.equal(result.userScenarioPassed, null)
  assert.ok(result.requests.every(row => row.rawResponse.model === 'offline-scripted-wire-not-a-provider'))
})

test('pre-cancelled workflow starts no transport and preserves native state', async () => {
  const controller = new AbortController()
  controller.abort()
  let requests = 0
  const result = await runAmbiguityAnswerOnlyChatWorkflow({ scenarioId: duplicateIds[0],
    protocol: 'chat-completions', model: 'offline-wire', signal: controller.signal,
    request: async () => { requests++; return wire() } })
  assert.equal(requests, 0)
  assert.equal(result.actualModelRequestAttempts, 0)
  assert.equal(result.status, 'cancelled')
  assert.equal(result.oraclePassed, false)
  assert.equal(result.userScenarioPassed, null)
  assert.ok(Object.values(result.nativePreservation).every(Boolean))
})

test('caller cannot replace original prompts or smuggle an expected answer through options', async () => {
  const base = { scenarioId: duplicateIds[0], protocol: 'chat-completions', model: 'offline-wire', request: async () => wire() }
  for (const extra of [{ originalPrompt: 'rewritten' }, { expectedFacts: ['target.entityIds'] }, { expectedAnswer: {} }]) {
    await assert.rejects(runAmbiguityAnswerOnlyChatWorkflow({ ...base, ...extra }), { code: 'AMBIGUITY_MODEL_OPTION_KEY_OR_ACCESSOR' })
  }
  await assert.rejects(runAmbiguityAnswerOnlyChatWorkflow({ ...base, protocol: 'responses' }), { code: 'AMBIGUITY_ANSWER_ONLY_CHAT_PROTOCOL' })
  assert.deepEqual(AMBIGUITY_MODEL_BUDGETS, { maxModelRequests: 12, maxNativeToolCalls: 32,
    maxOutputTokens: 4096, maxResponseBytes: 1048576, maxHistoryBytes: 2097152, totalTimeoutMs: 120000 })
})
