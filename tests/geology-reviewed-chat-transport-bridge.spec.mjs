import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { benchmarkSettingsFromReviewedChat, callReviewedChatBenchmarkModel } from '../scripts/testing/helpers/geology-reviewed-chat-transport-bridge.mjs'
import { callBenchmarkModel } from '../scripts/benchmarks/token-provider-transport.mjs'
import { runRound8ReviewedChatWorkflow } from '../scripts/testing/helpers/geology-round8-reviewed-chat-driver.mjs'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'

const messages = [{ role: 'user', content: 'Use caller-supplied facts only. No engineering data may be guessed.' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'public-call', type: 'function', function: {
    name: 'cad_propose_geology_revision', arguments: '{ "expectedRevision": 4, "updates": [{ "holeId": "TEST-A", "stableWaterDepth": 4.5 }] }' } }] },
  { role: 'tool', tool_call_id: 'public-call', content: '{"ok":false,"error":{"code":"PUBLIC_TEST_REJECTION"}}' }]
const tools = [{ type: 'function', function: { name: 'cad_read_geology_source',
  description: 'Read native source data at the actual current revision.',
  parameters: { type: 'object', properties: { expectedRevision: { type: 'integer' } }, required: ['expectedRevision'] } } }]

test('bridge deletes only explicit stream:false and preserves all other settings and nested identities', () => {
  const settings = { stream: false, tools, tool_choice: 'auto', temperature: 0,
    response_format: { type: 'json_object' }, max_tokens: 4096, enable_thinking: false }
  const before = structuredClone(settings)
  const normalized = benchmarkSettingsFromReviewedChat(settings)
  assert.equal(Object.hasOwn(normalized, 'stream'), false)
  assert.equal(normalized.tools, tools)
  assert.equal(normalized.response_format, settings.response_format)
  assert.deepEqual(normalized, Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'stream')))
  assert.deepEqual(settings, before, 'caller settings are never mutated')
  const absent = { tools, max_tokens: 4096 }
  assert.deepEqual(benchmarkSettingsFromReviewedChat(absent), absent)
  assert.equal(benchmarkSettingsFromReviewedChat(absent).tools, tools)
  const frozen = Object.freeze({ stream: false, tools: Object.freeze(tools) })
  assert.equal(benchmarkSettingsFromReviewedChat(frozen).tools, frozen.tools)
})

for (const stream of [true, null, undefined, 'false', 0, 1, {}]) test(`bridge rejects explicit stream=${String(stream)} instead of silently coercing it`, () => {
  assert.throws(() => benchmarkSettingsFromReviewedChat({ stream, tools }), error => error.code === 'INVALID_REVIEWED_CHAT_STREAM')
})

test('accessor/inherited/non-data settings are rejected without executing a stream getter', () => {
  let reads = 0
  const input = { tools }
  Object.defineProperty(input, 'stream', { enumerable: true, get() { reads++; return false } })
  assert.throws(() => benchmarkSettingsFromReviewedChat(input), error => error.code === 'INVALID_REVIEWED_CHAT_SETTINGS')
  assert.equal(reads, 0)
  for (const invalid of [null, [], 'settings', Object.create({ stream: false })])
    assert.throws(() => benchmarkSettingsFromReviewedChat(invalid), error => error.code === 'INVALID_REVIEWED_CHAT_SETTINGS')
})

test('bridge delegates unchanged messages and normalized settings and returns actual provider object/usage unchanged', async () => {
  const response = Object.freeze({ content: 'Actual provider result', toolCalls: [], finishReason: 'stop',
    model: 'public-provider-response-fixture', elapsedMs: 23,
    usage: Object.freeze({ inputTokens: 17, outputTokens: 11, totalTokens: 28, cacheReadInputTokens: 5, reasoningOutputTokens: 3 }) })
  let invocations = 0
  const result = await callReviewedChatBenchmarkModel({ provider: 'deepseek', model: 'public-model-fixture',
    messages, settings: { stream: false, tools }, timeoutMs: 4321 }, input => {
    invocations++
    assert.equal(input.messages, messages)
    assert.equal(input.settings.tools, tools)
    assert.equal(input.settings.stream, undefined)
    assert.equal(Object.hasOwn(input.settings, 'stream'), false)
    assert.equal(input.timeoutMs, 4321)
    return response
  })
  assert.equal(invocations, 1)
  assert.equal(result, response)
  assert.equal(result.usage, response.usage)
  assert.equal(Object.hasOwn(result, 'networkAttempts'), false, 'an adapter invocation alone cannot fabricate a wire count')
  await assert.rejects(callReviewedChatBenchmarkModel({ messages, settings: { stream: false } }, async () => {
    const error = new Error('PUBLIC_PROVIDER_FAILURE'); error.code = 'PUBLIC_PROVIDER_FAILURE'; throw error
  }), error => error.code === 'PUBLIC_PROVIDER_FAILURE')
})

test('actual frozen reviewed-chat driver supplies stream:false to its explicit fixture adapter', async () => {
  const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
  const scenario = corpus.scenarios.find(item => item.id === 'GUS1-batch-historical-workflow.selected-historical-source-revision-zh-direct')
  let adapterCalls = 0
  const report = await runRound8ReviewedChatWorkflow(scenario, {
    modelAdapter: { origin: 'fixture-oracle-selftest', model: 'public-bridge-settings-inspection',
      async call({ messages: bodyMessages, settings }) {
        adapterCalls++
        assert.equal(Object.hasOwn(settings, 'stream'), true)
        assert.equal(settings.stream, false)
        assert.equal(Object.hasOwn(settings, 'model'), false)
        assert.equal(Object.hasOwn(settings, 'messages'), false)
        const normalized = benchmarkSettingsFromReviewedChat(settings)
        assert.equal(normalized.tools, settings.tools)
        assert.ok(bodyMessages.some(item => item.role === 'user'))
        return { model: 'public-bridge-settings-inspection', content: 'Clarification required; no edit or approval.',
          toolCalls: [], finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
      } }, reviewProposal: () => { throw new Error('There is no proposal to approve') } })
  assert.ok(adapterCalls >= 1)
  assert.equal(report.requests, adapterCalls)
  assert.equal(report.approvals, 0)
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.modelCalls, 0)
  assert.equal(report.scenarioPassed, null)
})

test('actual benchmark transport proves INVALID_REQUEST precedes all HTTP, and corrected bridge preserves real wire/usage', async t => {
  const envNames = ['KJDRAW_BENCH_FIXTURE_ENDPOINT', 'KJDRAW_BENCH_PROXY', 'KJDRAW_DEEPSEEK_API_KEY']
  const prior = envNames.map(name => [name, Object.hasOwn(process.env, name), process.env[name]])
  let received = 0, mode = 'success'
  const bodies = []
  const server = http.createServer((request, response) => {
    received++
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (mode === 'http-error') { response.writeHead(429, { 'Content-Type': 'application/json' }); response.end('{"error":{"code":"public-fixture-rate-limit"}}'); return }
      const value = { model: 'actual-loopback-transport-fixture-response', choices: [{
        message: { role: 'assistant', content: 'Actual local HTTP response; this is not a model acceptance run.' }, finish_reason: 'stop' }] }
      if (mode !== 'missing-usage') value.usage = { prompt_tokens: 17, completion_tokens: 11, total_tokens: 28,
        prompt_tokens_details: { cached_tokens: 5 }, completion_tokens_details: { reasoning_tokens: 3 } }
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value))
    })
  })
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT = `http://127.0.0.1:${server.address().port}/public-transport-fixture`
    delete process.env.KJDRAW_BENCH_PROXY
    process.env.KJDRAW_DEEPSEEK_API_KEY = 'public-loopback-auth-fixture-not-a-provider-key'
    const input = { provider: 'deepseek', model: 'public-loopback-request-model', messages,
      settings: { stream: false, tools, tool_choice: 'auto', temperature: 0 }, timeoutMs: 5000 }
    await t.test('v1-shaped direct invocation fails before HTTP, including before key validation', async () => {
      await assert.rejects(callBenchmarkModel(input), error => error.code === 'INVALID_REQUEST')
      assert.equal(received, 0)
      delete process.env.KJDRAW_DEEPSEEK_API_KEY
      await assert.rejects(callBenchmarkModel(input), error => error.code === 'INVALID_REQUEST')
      assert.equal(received, 0)
      process.env.KJDRAW_DEEPSEEK_API_KEY = 'public-loopback-auth-fixture-not-a-provider-key'
    })
    await t.test('only stream:false removal reaches actual HTTP; CAD/messages/tool definitions are unchanged', async () => {
      const response = await callReviewedChatBenchmarkModel(input)
      assert.equal(received, 1)
      assert.deepEqual(bodies[0], { model: input.model, messages,
        tools, tool_choice: 'auto', temperature: 0, stream: false })
      assert.equal(bodies[0].messages[1].tool_calls[0].function.arguments, messages[1].tool_calls[0].function.arguments)
      assert.equal(response.model, 'actual-loopback-transport-fixture-response')
      assert.equal(response.content, 'Actual local HTTP response; this is not a model acceptance run.')
      assert.equal(response.usage.inputTokens, 17)
      assert.equal(response.usage.outputTokens, 11)
      assert.equal(response.usage.totalTokens, 28)
      assert.equal(response.usage.cacheReadInputTokens, 5)
      assert.equal(response.usage.reasoningOutputTokens, 3)
      assert.ok(Number.isFinite(response.elapsedMs) && response.elapsedMs >= 0)
    })
    await t.test('stream:true and still-forbidden owned settings do not reach HTTP', async () => {
      await assert.rejects(async () => callReviewedChatBenchmarkModel({ ...input, settings: { ...input.settings, stream: true } }),
        error => error.code === 'INVALID_REVIEWED_CHAT_STREAM')
      assert.equal(received, 1)
      await assert.rejects(callReviewedChatBenchmarkModel({ ...input, settings: { ...input.settings, model: 'forbidden-model' } }),
        error => error.code === 'INVALID_REQUEST')
      assert.equal(received, 1)
    })
    await t.test('a real HTTP response missing usage is rejected, never replaced with zero estimates', async () => {
      mode = 'missing-usage'
      await assert.rejects(callReviewedChatBenchmarkModel(input), error => error.code === 'INCOMPLETE_PROVIDER_USAGE')
      assert.equal(received, 2)
    })
    await t.test('HTTP provider failure counts as actual network but does not fabricate successful response or usage', async () => {
      mode = 'http-error'
      await assert.rejects(callReviewedChatBenchmarkModel(input), error => error.code === 'PROVIDER_RATE_LIMIT')
      assert.equal(received, 3)
    })
  } finally {
    for (const [name, existed, value] of prior) { if (existed) process.env[name] = value; else delete process.env[name] }
    server.close(); await once(server, 'close')
  }
})
