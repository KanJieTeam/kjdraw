import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { geologyLiveProtocol, geologyLiveProtocolV4, geologyLiveProtocolV5 } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { geologyModelResponseDiagnostic } from '../scripts/testing/helpers/geology-model-output-diagnostics.mjs'
import { GEOLOGY_JSON_OBJECT_PROTOCOL_VERSION, validateGeologyAnswerEncoding, createGeologyJsonObjectProtocol,
  geologyJsonObjectResponseFormat, captureGeologyFinalProviderMessage, geologyFinalProviderMessageEvidence,
  geologyJsonObjectResponseDiagnostic } from '../scripts/testing/helpers/geology-answer-encoding.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const response = (content, extra = {}) => ({ model: 'public-fixture-model', content, toolCalls: [], finishReason: 'stop', ...extra })

test('all archived text protocols retain their exact digests and JSON encoding has its own fixed version', () => {
  assert.equal(hash(geologyLiveProtocol), 'd920bcd844b88a7bdedb38d51283c96f3d39b97da4eaef795c91f12fcf73a069')
  assert.equal(hash(geologyLiveProtocolV4), 'ef8864b22c671e59e9e9198e59c094f816034b4011842f116d21b1ffef45f0a2')
  assert.equal(hash(geologyLiveProtocolV5), '2f9b6b87e850c744acc35741d822d1ecd371258e06ae255125c3a2242fb6cecb')
  const protocol = createGeologyJsonObjectProtocol(geologyLiveProtocolV5)
  assert.equal(protocol.version, GEOLOGY_JSON_OBJECT_PROTOCOL_VERSION)
  assert.equal(protocol.answerEncoding, 'json-object')
  assert.equal(Object.isFrozen(protocol), true)
  assert.equal(Object.isFrozen(protocol.responseFormat), true)
  assert.equal(protocol.maxRequestsPerScenario, 12)
  assert.equal(protocol.timeoutMs, 60_000)
  assert.notEqual(hash(protocol), hash(geologyLiveProtocolV5))
  assert.equal(Object.hasOwn(geologyLiveProtocolV5, 'answerEncoding'), false)
  assert.throws(() => createGeologyJsonObjectProtocol(geologyLiveProtocolV4))
})

test('JSON encoding requires explicit v5, while every prior version still accepts text', () => {
  for (const version of ['v3', 'v4', 'v5']) assert.doesNotThrow(() => validateGeologyAnswerEncoding(version, 'text'))
  assert.doesNotThrow(() => validateGeologyAnswerEncoding('v5', 'json-object'))
  for (const version of ['v3', 'v4']) assert.throws(() => validateGeologyAnswerEncoding(version, 'json-object'), /requires.*v5/)
  for (const encoding of [null, undefined, 'json', 'json-schema', '', {}, ['text']]) assert.throws(() => validateGeologyAnswerEncoding('v5', encoding), /text or json-object/)
})

test('only an actual declared read-answer frame opts into provider JSON object syntax', () => {
  assert.deepEqual(geologyJsonObjectResponseFormat({ answerEncoding: 'json-object', answerFrame: '{"declaredField":0}' }), { type: 'json_object' })
  for (const answerFrame of [null, undefined, '', 0]) assert.equal(geologyJsonObjectResponseFormat({ answerEncoding: 'json-object', answerFrame }), null)
  assert.equal(geologyJsonObjectResponseFormat({ answerEncoding: 'text', answerFrame: '{"declaredField":0}' }), null)
})

test('final provider content keeps whitespace and literal bytes without answer extraction', () => {
  const raw = ' \r\n{"text":"literal 中文 \\n","value":3.5}\n '
  const original = response(raw), captured = captureGeologyFinalProviderMessage(original)
  original.content = 'changed after capture'
  assert.equal(captured.content, raw)
  assert.equal(Object.isFrozen(captured), true)
  const evidence = geologyFinalProviderMessageEvidence(captured, 'message')
  assert.equal(evidence.rawFinalAnswer, raw)
  assert.deepEqual(evidence.answer, JSON.parse(raw))
  assert.equal(evidence.finalMessageValid, true)
})

for (const raw of ['', ' ', '\n', 'prose {"value":3}', '```json\n{"value":3}\n```', '{"value":3} suffix', '{"value":3', 'null', '3', '[]', 'true']) {
  test(`raw final content ${JSON.stringify(raw)} is not stripped, repaired or rescued`, () => {
    const evidence = geologyFinalProviderMessageEvidence(captureGeologyFinalProviderMessage(response(raw)), 'message')
    assert.equal(evidence.rawFinalAnswer, raw)
    assert.equal(evidence.answer, null)
    assert.equal(evidence.finalMessageValid, false)
  })
}

for (const status of ['error', 'proposal', 'cancelled', 'applied', undefined]) {
  test(`runtime ${String(status)} cannot be rescued by a previously returned JSON object`, () => {
    const evidence = geologyFinalProviderMessageEvidence(captureGeologyFinalProviderMessage(response('{"validEarlierAnswer":true}')), status)
    assert.equal(evidence.answer, null)
    assert.equal(evidence.finalMessageValid, false)
  })
}

for (const finishReason of ['length', 'tool_calls', 'content_filter', null, undefined]) {
  test(`provider finish reason ${String(finishReason)} cannot become a valid final answer`, () => {
    const evidence = geologyFinalProviderMessageEvidence(captureGeologyFinalProviderMessage(response('{"value":3}', { finishReason })), 'message')
    assert.equal(evidence.answer, null)
    assert.equal(evidence.finalMessageValid, false)
  })
}

test('final tool-only output and missing/oversized content are ineligible even if they contain an earlier answer', () => {
  for (const result of [response('{"value":3}', { toolCalls: [{ id: 'actual-call' }] }), response(null), response(undefined), response('x'.repeat(1_048_577))]) {
    const evidence = geologyFinalProviderMessageEvidence(captureGeologyFinalProviderMessage(result), 'message')
    assert.equal(evidence.answer, null)
    assert.equal(evidence.finalMessageValid, false)
  }
})

test('JSON syntax validity is not a schema or factual-success verdict', () => {
  for (const raw of ['{"wrongField":999}', '{"value":999}', '{}']) {
    const evidence = geologyFinalProviderMessageEvidence(captureGeologyFinalProviderMessage(response(raw)), 'message')
    assert.equal(evidence.finalMessageValid, true, 'The independent existing oracle must still validate fields and values')
    assert.deepEqual(evidence.answer, JSON.parse(raw))
    assert.equal(Object.hasOwn(evidence, 'scenarioPassed'), false)
  }
})

test('raw-content diagnostic is bounded, public-synthetic only and copies no private request fields', () => {
  const secret = 'fixture-secret-shaped-request-header-never-copy', raw = ' \n{"value":3}\r\n'
  const original = response(raw, { requestHeaders: { Authorization: secret }, requestBody: secret, messages: [{ content: secret }] })
  const sanitized = geologyModelResponseDiagnostic(original, { scenarioId: 'PUBLIC', request: 2, evidenceOrigin: 'fixture-oracle-selftest', trace: { responseFormat: { type: 'json_object' } } })
  assert.equal(Object.hasOwn(sanitized.assistant, 'content'), false, 'Default diagnostics stay unchanged')
  const diagnostic = geologyJsonObjectResponseDiagnostic(original, sanitized)
  assert.equal(diagnostic.assistant.content, raw)
  assert.equal(JSON.stringify(diagnostic).includes(secret), false)
  diagnostic.assistant.content = 'changed'
  assert.equal(original.content, raw)
  assert.equal(Object.hasOwn(sanitized.assistant, 'content'), false)
  assert.throws(() => geologyJsonObjectResponseDiagnostic(original, { ...sanitized, scope: 'private-drawing' }), /public synthetic/)
  assert.equal(geologyJsonObjectResponseDiagnostic(response('x'.repeat(1_048_577)), sanitized).assistant.content, null)
})
