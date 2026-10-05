import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { runGeologyUserScenarios, geologyLiveProtocolV5JsonObject, frameScenarioPrompt } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { buildScenarioFixture } from '../scripts/testing/preflight-geology-user-scenarios.mjs'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const inventory = corpus.scenarios.find(scenario => scenario.expected.intent === 'cad-query.inventory')
const textEdit = corpus.scenarios.find(scenario => scenario.expected.intent === 'cad-annotation.replace-native-text')
const usage = { inputTokens: 19, outputTokens: 7, totalTokens: 26 }
const identityMarker = 'Public synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. '
const bindings = input => JSON.parse(input.messages.find(message => message.role === 'user').content.split(identityMarker).at(-1).split('\n\nFor automated review,')[0])
const response = ({ content = '', toolCalls = [], finishReason = toolCalls.length ? 'tool_calls' : 'stop' } = {}) =>
  ({ model: 'fixture-not-real-provider', content, toolCalls, finishReason, usage, elapsedMs: 1 })
const call = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function inventoryCaller({ firstContent = 'Read the actual native drawing first.', final = answer => ` \r\n${JSON.stringify(answer)}\n `,
  finishReason = 'stop', throwAtFinal = false } = {}) {
  const requests = [], answers = []
  return { requests, answers, async modelCall(input) {
    requests.push(structuredClone(input))
    if (requests.length === 1) return response({ content: firstContent, toolCalls: [call('cad_query_drawing', {
      expectedRevision: bindings(input).revision, filters: {}, offset: 0, layerOffset: 0, limit: 64, maxLayers: 100, maxBytes: 262144,
    }, 'actual-inventory-read')] })
    assert.equal(requests.length, 2, 'No extra JSON-mode repair or provider retries')
    assert.equal(input.messages.at(-1).role, 'tool')
    const actual = JSON.parse(input.messages.at(-1).content)
    assert.equal(actual.ok, true)
    const entityCounts = {}
    for (const entity of actual.value.entities) entityCounts[entity.type] = (entityCounts[entity.type] ?? 0) + 1
    const answer = { entityCounts }
    answers.push(answer)
    if (throwAtFinal) throw Object.assign(new Error('untrusted-private-provider-error-body'), { code: 'PROVIDER_HTTP_FAILURE' })
    return response({ content: final(answer), finishReason })
  } }
}

async function runInventory(caller, extra = {}) {
  const events = [], diagnostics = []
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', answerEncoding: 'json-object',
    scenarioIds: [inventory.id], maxScenarios: 1, maxRequests: 5, modelCall: caller.modelCall,
    onScenarioResult: event => events.push(event), onModelResponse: diagnostic => diagnostics.push(diagnostic), ...extra })
  return { report, events, diagnostics }
}

test('JSON-mode CLI is an explicit zero-request dry run with a fixed independent protocol digest', () => {
  const run = spawnSync(process.execPath, ['scripts/testing/run-geology-user-scenarios.mjs', '--answer-contract-version', 'v5', '--answer-encoding', 'json-object'],
    { encoding: 'utf8', windowsHide: true })
  assert.equal(run.status, 0, run.stderr)
  const result = JSON.parse(run.stdout)
  assert.equal(result.modelCalls, 0)
  assert.equal(result.mode, 'dry-run')
  assert.equal(result.version, 'geology-user-scenarios-live-v5-json-object-v1')
  assert.equal(result.finalMessageSource, geologyLiveProtocolV5JsonObject.finalMessageSource)
  assert.equal(hash(geologyLiveProtocolV5JsonObject), 'd820c721a520251c74c4628e84d0a3b4c9802e3edcbe33265bc4f96bec4613e3')
  assert.equal(result.maxRequestsPerScenario, 12)
})

for (const [version, digest] of [
  ['v3', 'd920bcd844b88a7bdedb38d51283c96f3d39b97da4eaef795c91f12fcf73a069'],
  ['v4', 'ef8864b22c671e59e9e9198e59c094f816034b4011842f116d21b1ffef45f0a2'],
  ['v5', '2f9b6b87e850c744acc35741d822d1ecd371258e06ae255125c3a2242fb6cecb'],
]) test(`default ${version} retains original digest, wire settings, final text and ordinary diagnostic shape`, async () => {
  const caller = inventoryCaller(), { report, events, diagnostics } = await runInventory(caller, { answerContractVersion: version, answerEncoding: undefined })
  assert.equal(report.protocolSha256, digest)
  assert.equal(report.scenarios[0].status, 'satisfied')
  assert.ok(caller.requests.every(input => !Object.hasOwn(input.settings, 'response_format')))
  assert.ok(report.trace.every(trace => !Object.hasOwn(trace, 'responseFormat')))
  assert.ok(diagnostics.every(diagnostic => !Object.hasOwn(diagnostic.assistant, 'content')))
  assert.equal(events[0].evidence.rawFinalAnswer, events[0].result.text)
  assert.equal(Object.hasOwn(events[0].evidence, 'finalMessageValid'), false)
})

test('invalid JSON-mode version or encoding fails before invoking any provider', async () => {
  let invoked = 0
  for (const options of [{ answerContractVersion: 'v3', answerEncoding: 'json-object' }, { answerContractVersion: 'v4', answerEncoding: 'json-object' },
    { answerContractVersion: 'v5', answerEncoding: 'json-schema' }]) {
    await assert.rejects(runGeologyUserScenarios({ ...options, modelCall: async () => { invoked++; return response() } }))
  }
  assert.equal(invoked, 0)
})

for (const provider of ['deepseek', 'qwen']) test(`${provider} JSON-mode wire coexists with actual tools and exact final-message scoring, fixture-only`, async () => {
  const caller = inventoryCaller({ firstContent: '{"responseSchema":{"entityCounts":"protocol documentation, not an answer"}}' })
  const { report, events, diagnostics } = await runInventory(caller, { provider })
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify(report.scenarios[0]))
  assert.equal(report.requests, 2)
  assert.equal(report.totalTokens, 52)
  assert.equal(report.evidenceOrigin, 'fixture-oracle-selftest')
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.passed, 0)
  assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.allSelectedPassed, false)
  assert.ok(caller.requests.every(input => input.timeoutMs === 60000 && input.settings.response_format.type === 'json_object'))
  assert.ok(caller.requests[0].settings.tools.some(tool => tool.function.name === 'cad_query_drawing'))
  assert.ok(report.trace.every(trace => trace.responseFormat.type === 'json_object' && trace.usage.totalTokens === 26))
  assert.equal(events[0].evidence.rawFinalAnswer, ` \r\n${JSON.stringify(caller.answers[0])}\n `)
  assert.deepEqual(events[0].evidence.answer, caller.answers[0])
  assert.equal(events[0].evidence.finalMessageValid, true)
  assert.equal(events[0].evidence.afterDocument.revision, events[0].fixture.initialRevision)
  assert.equal(events[0].evidence.hostApprovalApplied, false)
  assert.equal(diagnostics[0].assistant.content, '{"responseSchema":{"entityCounts":"protocol documentation, not an answer"}}')
  assert.equal(diagnostics[1].assistant.content, events[0].evidence.rawFinalAnswer)
  const output = JSON.stringify(report)
  assert.equal(output.includes('protocol documentation, not an answer'), false)
  assert.equal(output.includes('rawFinalAnswer'), false)
  assert.equal(Object.hasOwn(report.executionSurface, 'scripts/testing/helpers/geology-answer-encoding.mjs'), true)
})

test('JSON mode changes only wire syntax; frozen prompt and literal inputs are unchanged from v5 text', async () => {
  const plain = inventoryCaller(), json = inventoryCaller()
  const { report: plainReport } = await runInventory(plain, { answerEncoding: 'text' })
  const { report: jsonReport } = await runInventory(json)
  assert.equal(plainReport.scenarios[0].originalPromptSha256, jsonReport.scenarios[0].originalPromptSha256)
  // Each imported fixture has independently fresh native IDs. Verify the
  // whole exact frozen prompt with that actual run's complete identity input,
  // not a misleading equality between unrelated generated document IDs.
  for (const [caller, report] of [[plain, plainReport], [json, jsonReport]]) {
    const expected = frameScenarioPrompt(inventory, bindings(caller.requests[0]), { answerContractVersion: 'v5' })
    assert.equal(report.scenarios[0].promptSha256, createHash('sha256').update(expected).digest('hex'))
    assert.ok(caller.requests[0].messages.find(message => message.role === 'user').content.endsWith(expected))
  }
  const fixed = bindings(plain.requests[0])
  assert.equal(frameScenarioPrompt(inventory, fixed, { answerContractVersion: 'v5', answerEncoding: 'text' }),
    frameScenarioPrompt(inventory, fixed, { answerContractVersion: 'v5', answerEncoding: 'json-object' }))
  assert.notEqual(plainReport.protocolSha256, jsonReport.protocolSha256)
})

for (const [label, final, finishReason] of [
  ['prose after an earlier valid JSON object', () => 'Not a JSON answer.', 'stop'],
  ['Markdown fences', answer => '```json\n' + JSON.stringify(answer) + '\n```', 'stop'],
  ['empty final message', () => '', 'stop'],
  ['null final content', () => null, 'stop'],
  ['valid content with truncation', answer => JSON.stringify(answer), 'length'],
  ['JSON object with wrong values', () => '{"entityCounts":{"TEXT":999999}}', 'stop'],
  ['JSON object with missing required schema fields', () => '{}', 'stop'],
]) test(`JSON-mode strict oracle rejects ${label}, without answer repair or extra requests`, async () => {
  const caller = inventoryCaller({ firstContent: '{"entityCounts":{"TEXT":1}}', final, finishReason })
  const { report, events } = await runInventory(caller)
  assert.equal(report.requests, 2)
  assert.equal(report.totalTokens, 52)
  assert.notEqual(report.scenarios[0].status, 'satisfied')
  assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.passed, 0)
  const raw = final(caller.answers[0])
  assert.equal(events[0].evidence.rawFinalAnswer, typeof raw === 'string' ? raw : '')
  assert.equal(events[0].evidence.afterDocument.revision, events[0].fixture.initialRevision)
})

test('runtime transport failure cannot be rescued by an earlier valid JSON object, and secrets stay out of reports', async () => {
  const caller = inventoryCaller({ firstContent: '{"entityCounts":{"TEXT":1}}', throwAtFinal: true })
  const { report, events, diagnostics } = await runInventory(caller)
  assert.equal(report.requests, 2)
  assert.equal(report.totalTokens, 26, 'Usage only from an actually returned provider response')
  assert.equal(report.transportFailures[0].code, 'PROVIDER_HTTP_FAILURE')
  assert.deepEqual(report.transportFailures[0].responseFormat, { type: 'json_object' })
  assert.equal(events[0].result.status, 'error')
  assert.equal(events[0].evidence.answer, null)
  assert.equal(events[0].evidence.finalMessageValid, false)
  assert.notEqual(report.scenarios[0].status, 'satisfied')
  assert.equal(JSON.stringify({ report, diagnostics }).includes('untrusted-private-provider-error-body'), false)
})

test('a fully correct earlier JSON answer from actual native counts cannot rescue final prose', async () => {
  const fixture = await buildScenarioFixture(inventory)
  let earlier
  try {
    const entityCounts = {}
    for (const entity of fixture.document.listEntities()) entityCounts[entity.type] = (entityCounts[entity.type] ?? 0) + 1
    earlier = { entityCounts }
  } finally { fixture.dispose() }
  const caller = inventoryCaller({ firstContent: JSON.stringify(earlier), final: () => 'The final response is explanatory prose.' })
  const { report, events, diagnostics } = await runInventory(caller)
  assert.deepEqual(earlier, caller.answers[0], 'Earlier answer is complete and factually correct, not a token placeholder')
  assert.equal(diagnostics[0].assistant.content, JSON.stringify(earlier))
  assert.equal(events[0].evidence.rawFinalAnswer, 'The final response is explanatory prose.')
  assert.equal(events[0].evidence.answer, null)
  assert.equal(events[0].evidence.finalMessageValid, false)
  assert.notEqual(report.scenarios[0].status, 'satisfied')
  assert.equal(report.requests, 2)
  assert.equal(report.realProviderRequests, 0)
})

test('a last actual tool-only message cannot become a final answer when global budget stops the next call', async () => {
  const caller = inventoryCaller({ firstContent: '{"entityCounts":{"TEXT":1}}' })
  const { report, events } = await runInventory(caller, { maxRequests: 1 })
  assert.equal(caller.requests.length, 1)
  assert.equal(report.requests, 1)
  assert.equal(report.totalTokens, 26)
  assert.equal(events[0].result.status, 'error')
  assert.equal(events[0].evidence.answer, null)
  assert.equal(events[0].evidence.finalMessageValid, false)
  assert.notEqual(report.scenarios[0].status, 'satisfied')
})

test('unframed mutation stays on unchanged native proposal/approval path and receives no JSON response format', async () => {
  const requests = [], events = []
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', answerEncoding: 'json-object',
    scenarioIds: [textEdit.id], maxScenarios: 1, maxRequests: 5, modelCall: async input => {
      requests.push(structuredClone(input))
      const bound = bindings(input)
      if (requests.length === 1) return response({ toolCalls: [call('cad_find_text', { expectedRevision: bound.revision, search: 'TEST-A', match: 'exact' }, 'actual-find-text')] })
      assert.equal(requests.length, 2)
      const actual = JSON.parse(input.messages.at(-1).content)
      assert.equal(actual.ok, true)
      const match = actual.value.matches[0]
      return response({ toolCalls: [call('cad_propose_text_edit', { expectedRevision: bound.revision, units: 'millimeter',
        changes: [{ id: match.id, expectedText: match.text, text: match.text + '复核' }] }, 'actual-propose-text')] })
    }, onScenarioResult: event => events.push(event) })
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify(report.scenarios[0]))
  assert.equal(report.requests, 2)
  assert.equal(report.realProviderRequests, 0)
  assert.ok(requests.every(input => !Object.hasOwn(input.settings, 'response_format')))
  assert.ok(report.trace.every(trace => trace.responseFormat === null))
  assert.equal(events[0].evidence.hostApprovalApplied, true)
  assert.equal(events[0].evidence.executionStatus, 'applied')
  assert.equal(events[0].evidence.stage, 'committed')
  assert.equal(events[0].evidence.afterDocument.revision, events[0].fixture.initialRevision + 1)
  assert.equal(Object.hasOwn(events[0].evidence, 'finalMessageValid'), false)
})

test('JSON-mode per-case loop and request usage remain bounded without hidden retries', async () => {
  const requests = []
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', answerEncoding: 'json-object',
    scenarioIds: [inventory.id], maxScenarios: 1, maxRequests: 100, modelCall: async input => {
      requests.push(input)
      return response({ toolCalls: [call('cad_query_drawing', { expectedRevision: bindings(input).revision, filters: {}, offset: 0,
        layerOffset: 0, limit: 64, maxLayers: 100, maxBytes: 262144 }, `read-${requests.length}`)] })
    } })
  assert.equal(report.requests, requests.length)
  assert.ok(report.requests > 0 && report.requests <= 12)
  assert.equal(report.totalTokens, requests.length * 26)
  assert.equal(report.scenarios[0].requests, requests.length)
  assert.notEqual(report.scenarios[0].status, 'satisfied')
  assert.equal(report.realProviderRequests, 0)
})
