import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { createModelProxy, modelProxyFromEnvironment } from '../../../scripts/model-proxy.mjs'
import { createKJModelAdapter } from '../src/model-adapters.js'

const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const body = { model: 'fixed-model', messages: [], max_tokens: 32, stream: false }
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
async function fixture(t, upstreamHandler, options = {}) {
  const upstream = createServer(upstreamHandler)
  const endpoint = `${await listen(upstream)}/model`
  let server
  t.after(async () => { if (server) await close(server); await close(upstream) })
  server = createServer(createModelProxy({ protocol: 'chat-completions', model: 'fixed-model', endpoint, apiKey: 'server-only-secret', ...options }))
  const origin = await listen(server)
  return { origin, post: (value = body, settings = {}) => fetch(`${origin}/api/model`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value), ...settings }) }
}
const json = (res, value, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
const textResponse = protocol => protocol === 'responses' ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'connected' }] }] }
  : protocol === 'chat-completions' ? { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'connected' } }] }
    : protocol === 'anthropic-messages' ? { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'connected' }] }
      : { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'connected' }] } }] }

test('local model proxy connects all four SDK model adapters over HTTP with server-owned credentials', async t => {
  for (const protocol of protocols) await t.test(protocol, async t => {
    const seen = []
    const app = await fixture(t, async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      seen.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) })
      json(res, textResponse(protocol))
    }, { protocol })
    const model = createKJModelAdapter({ protocol, model: 'fixed-model', request: async ({ body, signal }) => {
      const response = await app.post(body, { signal })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('access-control-allow-origin'), null)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const result = await response.json()
      assert.ok(!JSON.stringify(result).includes('server-only-secret'))
      return result
    } })
    const turn = await model.createConversation({ instructions: 'Read only.', tools: [] }).next({ kind: 'prompt', text: 'Hello CAD' }, new AbortController().signal)
    assert.equal(turn.text, 'connected')
    assert.deepEqual(turn.calls, [])
    assert.equal(turn.usage.protocol, protocol)
    assert.equal(turn.usage.latencyScope, 'transport-wall')
    assert.ok(Number.isFinite(turn.usage.latencyMs) && turn.usage.latencyMs >= 0)
    for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens']) assert.equal(turn.usage[field], null, field)
    assert.deepEqual(turn.usage.invalidFields, [])
    assert.equal(seen.length, 1)
    assert.equal(seen[0].headers.host.startsWith('127.0.0.1:'), true)
    assert.equal(seen[0].headers.origin, undefined)
    if (protocol === 'anthropic-messages') {
      assert.equal(seen[0].headers['x-api-key'], 'server-only-secret')
      assert.equal(seen[0].headers['anthropic-version'], '2023-06-01')
    } else if (protocol === 'gemini-generate-content') {
      assert.equal(seen[0].headers['x-goog-api-key'], 'server-only-secret')
      assert.equal(seen[0].body.model, undefined)
    } else assert.equal(seen[0].headers.authorization, 'Bearer server-only-secret')
  })
})

test('model proxy rejects cross-origin, missing-origin, DNS-rebinding, wrong-model and streaming requests before upstream access', async t => {
  let requests = 0
  const app = await fixture(t, (req, res) => { requests++; req.resume(); json(res, {}) })
  const invalid = [
    [{ headers: { 'Content-Type': 'application/json' } }, 403],
    [{ headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' } }, 403],
    [{ headers: { Origin: 'http://untrusted.example', Host: 'untrusted.example', 'Content-Type': 'application/json' } }, 403],
    [{ headers: { Origin: app.origin, 'Content-Type': 'text/plain' } }, 415],
    [{ method: 'GET', body: undefined }, 405],
    [{ body: '{broken' }, 400],
    [{ body: JSON.stringify({ ...body, model: 'other-model' }) }, 400],
    [{ body: JSON.stringify({ ...body, stream: true }) }, 400],
    [{ body: JSON.stringify({ ...body, stream: 'true' }) }, 400],
    [{ body: JSON.stringify({ ...body, max_tokens: 999999 }) }, 400],
    [{ body: JSON.stringify({ model: 'fixed-model', messages: [] }) }, 400],
  ]
  for (const [settings, status] of invalid) assert.equal((await app.post(body, settings)).status, status)
  assert.equal(requests, 0)
})

test('model proxy enforces both declared and chunked request byte limits', async t => {
  let requests = 0
  const app = await fixture(t, (req, res) => { requests++; req.resume(); json(res, {}) }, { maxRequestBytes: 128 })
  assert.equal((await app.post({ ...body, messages: ['x'.repeat(256)] })).status, 413)
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(`${app.origin}/api/model`, { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject)
    req.write('{"messages":"'); req.write('x'.repeat(256)); req.end('"}')
  })
  assert.equal(response, 413)
  assert.equal(requests, 0)
})

test('model proxy bounds responses and hides provider failures, malformed JSON and redirects', async t => {
  for (const behavior of ['large', 'error', 'malformed', 'redirect', 'reflected-key']) await t.test(behavior, async t => {
    let requests = 0
    const app = await fixture(t, (req, res) => {
      requests++; req.resume()
      if (behavior === 'large') json(res, { value: 'x'.repeat(256) })
      if (behavior === 'error') json(res, { error: 'server-only-secret internal-provider-debug' }, 401)
      if (behavior === 'malformed') res.end('server-only-secret internal-provider-debug')
      if (behavior === 'redirect') res.writeHead(302, { Location: '/redirect-target' }).end()
      if (behavior === 'reflected-key') json(res, { value: 'server-only-secret' })
    }, { maxResponseBytes: 128 })
    const response = await app.post()
    assert.equal(response.status, 502)
    const text = await response.text()
    assert.ok(!text.includes('server-only-secret'))
    assert.ok(!text.includes('internal-provider-debug'))
    assert.equal(requests, 1)
  })
})

test('model proxy timeout terminates upstream request', async t => {
  let disconnected
  const closed = new Promise(resolve => { disconnected = resolve })
  const app = await fixture(t, (req, res) => { req.resume(); res.on('close', disconnected) }, { timeoutMs: 300 })
  const response = await app.post()
  assert.equal(response.status, 504)
  assert.equal((await response.json()).error.code, 'MODEL_TIMEOUT')
  await closed
})

test('cancelling the browser HTTP request cancels the upstream request', async t => {
  let connected, disconnected
  const started = new Promise(resolve => { connected = resolve })
  const closed = new Promise(resolve => { disconnected = resolve })
  const app = await fixture(t, (req, res) => { req.resume(); res.on('close', disconnected); connected() }, { timeoutMs: 3000 })
  const controller = new AbortController()
  const response = app.post(body, { signal: controller.signal })
  const rejected = assert.rejects(response, { name: 'AbortError' })
  await started
  controller.abort()
  await rejected
  await closed
})

test('proxy configuration is optional and rejects unsafe or incomplete upstream settings', () => {
  assert.equal(modelProxyFromEnvironment({}), null)
  assert.throws(() => modelProxyFromEnvironment({ KJDRAW_MODEL_API_KEY: 'secret' }), /Set KJDRAW_MODEL_PROTOCOL/)
  const defaults = { protocol: 'chat-completions', model: 'fixed-model', apiKey: 'secret' }
  for (const endpoint of ['http://remote.example/model', 'https://user:password@remote.example/model', 'https://remote.example/model?key=secret', 'https://remote.example/model#fragment', 'invalid']) assert.throws(() => createModelProxy({ ...defaults, endpoint }))
  assert.throws(() => createModelProxy({ ...defaults, endpoint: 'https://remote.example/model', apiKey: undefined }))
  assert.equal(typeof modelProxyFromEnvironment({ KJDRAW_MODEL_PROTOCOL: 'chat-completions', KJDRAW_MODEL_NAME: 'fixed-model', KJDRAW_MODEL_ENDPOINT: 'http://127.0.0.1:11434/v1/chat/completions' }), 'function')
})

test('actual development server keeps static defaults and enables the fixed model route only with environment configuration', async t => {
  const names = ['PORT', 'KJDRAW_MODEL_PROTOCOL', 'KJDRAW_MODEL_NAME', 'KJDRAW_MODEL_ENDPOINT', 'KJDRAW_MODEL_API_KEY']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const upstream = createServer((req, res) => { req.resume(); json(res, textResponse('chat-completions')) })
  const endpoint = `${await listen(upstream)}/model`
  t.after(async () => { await close(upstream) })
  try {
    for (const configured of [false, true]) {
      for (const name of names) delete process.env[name]
      process.env.PORT = '0'
      if (configured) {
        process.env.KJDRAW_MODEL_PROTOCOL = 'chat-completions'
        process.env.KJDRAW_MODEL_NAME = 'fixed-model'
        process.env.KJDRAW_MODEL_ENDPOINT = endpoint
      }
      const { server } = await import(`../../../scripts/serve.mjs?model-proxy-test=${configured}`)
      try {
        if (!server.listening) await once(server, 'listening')
        const origin = `http://127.0.0.1:${server.address().port}`
        assert.equal(server.address().address, '127.0.0.1')
        assert.equal((await fetch(origin)).status, 200)
        const response = await fetch(`${origin}/api/model`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        assert.equal(response.status, configured ? 200 : 405)
        if (configured) assert.deepEqual(await response.json(), textResponse('chat-completions'))
      } finally { await close(server) }
    }
  } finally {
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name] }
  }
})

test('model proxy environment exposes an explicit bounded output-token ceiling without changing the default',async t=>{
 const env={KJDRAW_MODEL_PROTOCOL:'chat-completions',KJDRAW_MODEL_NAME:'fixed-model',KJDRAW_MODEL_ENDPOINT:'http://127.0.0.1:1/model'}
 for(const value of ['', '0','131073','1.5','NaN','Infinity','0x8000',' 32768','32768 '])assert.throws(()=>modelProxyFromEnvironment({...env,KJDRAW_MODEL_MAX_OUTPUT_TOKENS:value}))
 let upstreamCalls=0
 const upstream=createServer((req,res)=>{upstreamCalls++;req.resume();json(res,textResponse('chat-completions'))}),endpoint=await listen(upstream),servers=[]
 t.after(async()=>{for(const server of servers)await close(server);await close(upstream)})
 for(const limit of [undefined,'32768','131072']){
  const server=createServer(modelProxyFromEnvironment({...env,KJDRAW_MODEL_ENDPOINT:endpoint+'/model',...(limit?{KJDRAW_MODEL_MAX_OUTPUT_TOKENS:limit}:{})}));servers.push(server);const origin=await listen(server)
  const post=tokens=>fetch(origin+'/api/model',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({...body,max_tokens:tokens})})
  const maximum=Number(limit??16384)
  assert.equal((await post(maximum)).status,200)
  const denied=await post(maximum+1);assert.equal(denied.status,400);assert.equal((await denied.json()).error.code,'MODEL_TOKEN_LIMIT')
 }
 assert.equal(upstreamCalls,3)
})
