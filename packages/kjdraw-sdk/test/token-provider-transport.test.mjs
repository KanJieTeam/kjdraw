import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import https from 'node:https'
import { once } from 'node:events'
import { callBenchmarkModel, createBenchmarkProxyAgent } from '../../../scripts/benchmarks/token-provider-transport.mjs'

const keys = ['KJDRAW_DEEPSEEK_API_KEY', 'KJDRAW_QWEN_API_KEY', 'KJDRAW_GLM_API_KEY', 'KJDRAW_BENCH_FIXTURE_ENDPOINT', 'KJDRAW_BENCH_PROXY']
const fixtureKey = 'synthetic-fixture-key-never-publish'
const successful = { model: 'fixture-served-model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'CAD fixture reply' } }],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_cache_hit_tokens: 2, prompt_cache_miss_tokens: 9 } }
const input = provider => ({ provider, model: 'fixture-requested-model', messages: [{ role: 'user', content: 'draw fixture' }], settings: { temperature: 0, max_tokens: 4096 }, timeoutMs: 1000 })
async function server(t, handler) {
  const app = createServer(handler)
  app.listen(0, '127.0.0.1'); await once(app, 'listening')
  t.after(() => new Promise(resolve => app.close(resolve)))
  return `http://127.0.0.1:${app.address().port}/chat/completions`
}
function environment(t) {
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  t.after(() => { for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key] })
  for (const key of keys) delete process.env[key]
  for (const key of keys.slice(0, 3)) process.env[key] = fixtureKey
}

test('DeepSeek, Qwen and GLM use environment keys and return strict provider usage from local mock', async t => {
  environment(t)
  const requests = []
  process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT = await server(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    requests.push({ authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(successful))
  })
  for (const provider of ['deepseek', 'qwen', 'glm']) {
    const result = await callBenchmarkModel(input(provider))
    assert.equal(result.content, 'CAD fixture reply')
    assert.deepEqual({ inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens }, { inputTokens: 11, outputTokens: 7, totalTokens: 18 })
    assert.equal(result.usage.cacheReadInputTokens, 2)
    assert.equal(result.model, 'fixture-served-model')
    assert.ok(result.elapsedMs >= 0)
    assert.equal(JSON.stringify(result).includes(fixtureKey), false)
  }
  assert.equal(requests.length, 3)
  assert.ok(requests.every(request => request.authorization === `Bearer ${fixtureKey}`))
  assert.ok(requests.every(request => request.body.stream === false && request.body.max_tokens === 4096))
})

test('missing, inconsistent and provider-reflected usage are rejected with fixed secret-free codes', async t => {
  environment(t)
  let response = { ...successful, usage: { prompt_tokens: 11, completion_tokens: 7 } }
  process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT = await server(t, (req, res) => { req.resume(); res.end(JSON.stringify(response)) })
  await assert.rejects(callBenchmarkModel(input('deepseek')), error => error.code === 'INCOMPLETE_PROVIDER_USAGE' && !error.message.includes(fixtureKey))
  response = { ...successful, usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 19 } }
  await assert.rejects(callBenchmarkModel(input('qwen')), error => error.code === 'INCOMPLETE_PROVIDER_USAGE')
  response = { ...successful, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: fixtureKey } }] }
  await assert.rejects(callBenchmarkModel(input('glm')), error => error.code === 'PROVIDER_REFLECTED_CREDENTIAL' && !error.message.includes(fixtureKey))
})

test('HTTP status failures expose only fixed codes and never provider body or credentials', async t => {
  environment(t)
  let status = 429
  const privateBody = `provider-private-error ${fixtureKey}`
  process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT = await server(t, (req, res) => {
    req.resume(); res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end(privateBody)
  })
  for (const [httpStatus, code] of [
    [429, 'PROVIDER_RATE_LIMIT'], [401, 'PROVIDER_AUTH_FAILURE'], [403, 'PROVIDER_AUTH_FAILURE'],
    [402, 'PROVIDER_PAYMENT_REQUIRED'], [500, 'PROVIDER_TRANSIENT_FAILURE'],
    [503, 'PROVIDER_TRANSIENT_FAILURE'], [400, 'PROVIDER_HTTP_FAILURE'],
  ]) {
    status = httpStatus
    await assert.rejects(callBenchmarkModel(input('deepseek')), error =>
      error.code === code && error.message === code &&
      !error.message.includes(privateBody) && !error.message.includes(fixtureKey))
  }
})

test('GLM resource error 1113 is not mislabeled as request-rate limiting', async t => {
  environment(t)
  const privateBody = JSON.stringify({ error: { code: '1113', message: `private ${fixtureKey}` } })
  process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT = await server(t, (req, res) => {
    req.resume(); res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(privateBody)
  })
  await assert.rejects(callBenchmarkModel(input('glm')), error =>
    error.code === 'PROVIDER_RESOURCE_UNAVAILABLE' && error.message === error.code &&
    !error.message.includes(privateBody) && !error.message.includes(fixtureKey))
})

test('bounded request, response and elapsed timeout fail closed', async t => {
  environment(t)
  let kind = 'large'
  process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT = await server(t, (req, res) => {
    req.resume()
    if (kind === 'large') res.end('x'.repeat(2 * 1024 * 1024 + 1))
    else setTimeout(() => res.end(JSON.stringify(successful)), 250)
  })
  await assert.rejects(callBenchmarkModel(input('deepseek')), error => error.code === 'RESPONSE_TOO_LARGE')
  await assert.rejects(callBenchmarkModel({ ...input('deepseek'), messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }] }), error => error.code === 'REQUEST_TOO_LARGE')
  kind = 'slow'
  await assert.rejects(callBenchmarkModel({ ...input('deepseek'), timeoutMs: 100 }), error => error.code === 'PROVIDER_TIMEOUT')
})

test('bad provider, missing key and malformed proxy fail before network', async t => {
  environment(t)
  process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT = await server(t, (req, res) => { req.resume(); res.end(JSON.stringify(successful)) })
  await assert.rejects(callBenchmarkModel(input('other')), error => error.code === 'INVALID_PROVIDER')
  delete process.env.KJDRAW_DEEPSEEK_API_KEY
  await assert.rejects(callBenchmarkModel(input('deepseek')), error => error.code === 'MISSING_API_KEY')
  process.env.KJDRAW_BENCH_PROXY = 'http://user:password@127.0.0.1:7890'
  await assert.rejects(callBenchmarkModel(input('qwen')), error => error.code === 'INVALID_PROXY' && !error.message.includes('password'))
})

test('explicit HTTP proxy creates a CONNECT tunnel without contacting a provider', async t => {
  const proxy = createServer()
  let target = null
  proxy.on('connect', (req, socket) => { target = req.url; socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n') })
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
  t.after(() => new Promise(resolve => proxy.close(resolve)))
  const agent = createBenchmarkProxyAgent(new URL(`http://127.0.0.1:${proxy.address().port}`))
  t.after(() => agent.destroy())
  const request = https.request('https://fixture.invalid/chat/completions', { agent, method: 'POST' })
  request.end('{}')
  await assert.rejects(once(request, 'response'), /PROXY_CONNECT_FAILURE/)
  assert.equal(target, 'fixture.invalid:443')
})
