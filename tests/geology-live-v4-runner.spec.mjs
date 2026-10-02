import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { GEOLOGY_V4_SCENARIO_IDS, geologyLiveProtocol, geologyLiveProtocolV4, frameScenarioPrompt, runGeologyUserScenarios } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { buildScenarioFixture, scenarioAnswerFrame, scenarioFixtureInputBindings } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { inspectGeologyModelToolCalls, geologyModelResponseDiagnostic } from '../scripts/testing/helpers/geology-model-output-diagnostics.mjs'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const scenario = intent => corpus.scenarios.find(item => !item.sequence && item.expected.intent === intent)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const usage = { inputTokens: 17, outputTokens: 3, totalTokens: 20 }
const response = (toolCalls = [], content = null) => ({ model: 'fixture-returned-model', finishReason: toolCalls.length ? 'tool_calls' : 'stop', toolCalls, content, usage, elapsedMs: 1 })
const call = (name, args, id = 'fixture-tool') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const inputBindings = input => {
  const text = input.messages.find(item => item.role === 'user').content
  const marker = 'Public synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. '
  return JSON.parse(text.slice(text.lastIndexOf(marker) + marker.length).split('\n\nFor automated review,')[0])
}

test('v4 is explicit and dry-run exposes exactly 72 IDs without changing the v3 protocol digest or making requests', async () => {
  const v3 = spawnSync(process.execPath, ['scripts/testing/run-geology-user-scenarios.mjs'], { encoding: 'utf8', windowsHide: true })
  const v4 = spawnSync(process.execPath, ['scripts/testing/run-geology-user-scenarios.mjs', '--answer-contract-version', 'v4'], { encoding: 'utf8', windowsHide: true })
  assert.equal(v3.status, 0, v3.stderr); assert.equal(v4.status, 0, v4.stderr)
  const old = JSON.parse(v3.stdout), opted = JSON.parse(v4.stdout)
  assert.equal(old.version, 'geology-user-scenarios-live-v3'); assert.equal(old.v4ScenarioIds, undefined)
  assert.equal(opted.version, 'geology-user-scenarios-live-v4'); assert.equal(opted.modelCalls, 0)
  assert.equal(GEOLOGY_V4_SCENARIO_IDS.length, 72); assert.deepEqual(opted.v4ScenarioIds, [...GEOLOGY_V4_SCENARIO_IDS])
  assert.notEqual(hash(geologyLiveProtocol), hash(geologyLiveProtocolV4))
  let requests = 0
  await assert.rejects(runGeologyUserScenarios({ answerContractVersion: 'v6', modelCall: async () => { requests++ } }), /v3, v4 or v5/)
  await assert.rejects(runGeologyUserScenarios({ onModelResponse: true, modelCall: async () => { requests++ } }), /callback/)
  assert.equal(requests, 0)
})

test('all 72 v4 response frames are bounded and preserve the literal prompt without source/gold values', async () => {
  const fixtures = new Map()
  try {
    for (const id of GEOLOGY_V4_SCENARIO_IDS) {
      const s = corpus.scenarios.find(item => item.id === id)
      let fixture = fixtures.get(s.expected.intent)
      if (!fixture) { fixture = await buildScenarioFixture(s); fixtures.set(s.expected.intent, fixture) }
      const frame = scenarioAnswerFrame(s, { answerContractVersion: 'v4' })
      assert.ok(frame.length < 8000)
      const prompt = frameScenarioPrompt(s, scenarioFixtureInputBindings(fixture), { answerContractVersion: 'v4' })
      assert.ok(prompt.startsWith(s.prompt)); assert.ok(prompt.length < 10000)
      assert.equal(frame.includes(fixture.drawingId), false)
      assert.equal(frame.includes('I-CLAY'), false); assert.equal(frame.includes('106.5'), false)
      assert.equal(frame.includes('previousBottom=nextTop'), false)
      assert.equal(frameScenarioPrompt(s, undefined), frameScenarioPrompt(s, undefined, { answerContractVersion: 'v3' }))
    }
  } finally { for (const fixture of fixtures.values()) fixture.dispose() }
})

test('opt-in source inventory uses actual SDK listing and v4 evaluator, while default v3 and injected evidence remain distinct', async () => {
  const s = scenario('source-query.list-source-recipes'), diagnostics = [], events = []
  let requests = 0
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v4', scenarioIds: [s.id], maxScenarios: 1, maxRequests: 4,
    modelCall: async input => {
      requests++; assert.ok(input.messages.find(item => item.role === 'user').content.length <= 16000)
      if (requests === 1) return response([call('cad_read_geology_source', { expectedRevision: inputBindings(input).revision, drawingId: '', maxBytes: 262144 })])
      const actual = JSON.parse(input.messages.at(-1).content); assert.equal(actual.ok, true)
      return response([], JSON.stringify({ drawingIds: actual.value.drawingIds, sourceBacked: actual.value.sourceBacked }))
    }, onModelResponse: diagnostic => { diagnostics.push(diagnostic) }, onScenarioResult: event => { events.push(event) },
  })
  assert.equal(report.requests, 2); assert.equal(report.realProviderRequests, 0); assert.equal(report.passed, 0)
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify(report.scenarios[0])); assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.protocolSha256, hash(geologyLiveProtocolV4)); assert.equal(report.protocol.answerContractVersion, 'v4')
  assert.equal(report.executionSurface['scripts/testing/helpers/geology-answer-contract-v4.mjs'].length, 64)
  assert.equal(events[0].oracle.fixtureSatisfied, true)
  assert.ok(events[0].oracle.assertions.every(item => item.kind && item.name && item.id.includes(':')))
  assert.equal(diagnostics.length, 2); assert.equal(diagnostics[0].evidenceOrigin, 'fixture-oracle-selftest')
  assert.equal(diagnostics[0].assistant.tool_calls[0].function.arguments, JSON.stringify({ expectedRevision: 3, drawingId: '', maxBytes: 262144 }))
  assert.equal(JSON.stringify(report).includes('assistant'), false)
})

test('malformed tool argument JSON is preserved only in trusted diagnostics, classified as model output and never repaired or mislabeled transport', async () => {
  const s = scenario('source-query.list-source-recipes'), raw = '{"expectedRevision":3,"drawingId":', diagnostics = [], events = []
  let requests = 0
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v4', scenarioIds: [s.id], maxScenarios: 1, maxRequests: 3,
    modelCall: async input => {
      requests++
      if (requests === 1) return response([{ id: 'malformed-model-output', type: 'function', function: { name: 'cad_read_geology_source', arguments: raw } }])
      if (requests === 3) {
        assert.equal(input.messages.at(-1).role, 'user')
        assert.match(input.messages.at(-1).content, /no supplied CAD read tool has returned a successful result/)
        return response([], '{}')
      }
      const actual = JSON.parse(input.messages.at(-1).content)
      assert.equal(actual.ok, false); assert.equal(actual.error.code, 'KJDOCUMENT_INVALID')
      assert.match(actual.error.message, /plain object/)
      return response([], '{}')
    }, onModelResponse: diagnostic => {
      if (diagnostic.request === 1) assert.equal(diagnostic.assistant.tool_calls[0].function.arguments, raw)
      diagnostics.push(diagnostic); diagnostic.assistant.tool_calls.splice(0)
    }, onScenarioResult: event => { events.push(event) },
  })
  assert.equal(report.transportFailures.length, 0)
  assert.deepEqual(report.modelOutputFailures, [{ scenarioId: s.id, request: 1, index: 0, code: 'MODEL_TOOL_ARGUMENTS_INVALID_JSON' }])
  assert.equal(events[0].evidence.toolCalls[0].args, null)
  assert.equal(events[0].evidence.toolCalls[0].result.ok, false)
  assert.equal(report.scenarios[0].status, 'failed'); assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.scenarios[0].errorCode, 'KJAGENT_READ_REQUIRED')
  assert.equal(JSON.stringify(report).includes(raw), false)
  assert.equal(diagnostics[0].argumentIssues[0].code, 'MODEL_TOOL_ARGUMENTS_INVALID_JSON')
})

test('trusted response diagnostics contain no request headers, messages, final text or reflected exception text and cannot change outcomes', async () => {
  const s = scenario('source-query.list-source-recipes'), sentinel = 'private-credential-shaped-content-not-for-diagnostics'
  const result = { ...response([call('cad_read_geology_source', { drawingId: 'geo-public', expectedRevision: 0 })], sentinel), requestHeaders: { Authorization: sentinel }, messages: [{ content: sentinel }] }
  const raw = geologyModelResponseDiagnostic(result, { scenarioId: s.id, request: 1, evidenceOrigin: 'fixture-oracle-selftest', trace: { tools: ['cad_read_geology_source'] } })
  assert.equal(JSON.stringify(raw).includes(sentinel), false)
  assert.equal(raw.assistant.tool_calls[0].function.arguments, result.toolCalls[0].function.arguments)
  raw.assistant.tool_calls[0].function.arguments = 'altered'
  assert.notEqual(result.toolCalls[0].function.arguments, 'altered')
  const inspected = inspectGeologyModelToolCalls([call('native', null), call('native', []), { function: { arguments: {} } }])
  assert.deepEqual(inspected.issues.map(item => item.code), ['MODEL_TOOL_ARGUMENTS_NOT_OBJECT', 'MODEL_TOOL_ARGUMENTS_NOT_OBJECT', 'MODEL_TOOL_ARGUMENTS_NOT_STRING'])
  let requests = 0
  const report = await runGeologyUserScenarios({ scenarioIds: [s.id], maxScenarios: 1, maxRequests: 3,
    modelCall: async input => {
      requests++
      if (requests === 1) return response([call('cad_read_geology_source', { expectedRevision: inputBindings(input).revision, drawingId: '', maxBytes: 262144 })])
      const actual = JSON.parse(input.messages.at(-1).content).value
      return response([], JSON.stringify({ drawingIds: actual.drawingIds, sourceBacked: actual.sourceBacked }))
    }, onModelResponse: () => { throw new Error(sentinel) },
  })
  assert.equal(report.protocolSha256, hash(geologyLiveProtocol)); assert.equal(report.scenarios[0].status, 'satisfied')
  assert.equal(report.transportFailures.length, 0); assert.equal(report.diagnosticFailures.length, 2)
  assert.equal(JSON.stringify(report).includes(sentinel), false); assert.equal(report.passed, 0)
})
