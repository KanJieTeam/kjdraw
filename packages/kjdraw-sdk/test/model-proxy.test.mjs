import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { createModelProxy, modelProxyFromEnvironment } from '../../../scripts/model-proxy.mjs'
import { createKJModelAdapter } from '../src/model-adapters.js'
import { readChatModelResponse } from '../../../apps/playground/chat-model-settings.js'

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

test('model proxy rejects cross-origin, missing-origin, DNS-rebinding and invalid requests before upstream access', async t => {
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
    [{ body: JSON.stringify({ ...body, stream: 'true' }) }, 400],
    [{ body: JSON.stringify({ ...body, tool_stream: true }) }, 400],
    [{ body: JSON.stringify({ ...body, max_tokens: 999999 }) }, 400],
    [{ body: JSON.stringify({ model: 'fixed-model', messages: [] }) }, 400],
  ]
  for (const [settings, status] of invalid) assert.equal((await app.post(body, settings)).status, status)
  assert.equal(requests, 0)
})

test('model proxy streams OpenAI-compatible SSE into the SDK without exposing credentials', async t => {
  const seen=[]
  const app=await fixture(t,async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);seen.push({headers:req.headers,body:JSON.parse(Buffer.concat(chunks))})
    res.writeHead(200,{'Content-Type':'text/event-stream'})
    res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"CAD "}}]}\n\n')
    await new Promise(resolve=>setTimeout(resolve,10))
    res.write('data: {"choices":[{"index":0,"delta":{"content":"ready"},"finish_reason":"stop"}]}\n\n')
    res.end('data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\ndata: [DONE]\n\n')
  },{chatStreamToolCalls:true})
  const deltas=[]
  const model=createKJModelAdapter({protocol:'chat-completions',model:'fixed-model',chatStreaming:true,chatStreamIncludeUsage:true,onTextDelta:delta=>deltas.push(delta),request:async({body,signal})=>{
    const response=await app.post(body,{signal});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/event-stream/);assert.equal(response.headers.get('access-control-allow-origin'),null)
    return readChatModelResponse(response)
  }})
  const turn=await model.createConversation({instructions:'Read only.',tools:[]}).next({kind:'prompt',text:'Hello'},new AbortController().signal)
  assert.equal(turn.text,'CAD ready');assert.deepEqual(deltas,['CAD ','ready']);assert.equal(turn.usage.totalTokens,5)
  assert.equal(seen.length,1);assert.equal(seen[0].headers.authorization,'Bearer server-only-secret');assert.equal(seen[0].body.stream,true);assert.equal(seen[0].body.stream_options.include_usage,true);assert.equal(seen[0].body.tool_stream,true)
})

test('model proxy streams Responses API events, function arguments and terminal usage',async t=>{
 const seen=[]
 const app=await fixture(t,async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);seen.push({headers:req.headers,body:JSON.parse(Buffer.concat(chunks))})
  const item={type:'function_call',id:'item-read',call_id:'read',name:'cad_read_drawing',arguments:'{}',status:'completed'}
  const events=[
   {type:'response.function_call_arguments.delta',sequence_number:0,item_id:'item-read',output_index:0,delta:'{'},
   {type:'response.function_call_arguments.delta',sequence_number:1,item_id:'item-read',output_index:0,delta:'}'},
   {type:'response.function_call_arguments.done',sequence_number:2,item_id:'item-read',output_index:0,name:'cad_read_drawing',arguments:'{}'},
   {type:'response.completed',sequence_number:3,response:{status:'completed',output:[item],usage:{input_tokens:9,output_tokens:2,total_tokens:11}}},
  ]
  res.writeHead(200,{'Content-Type':'text/event-stream'});for(const event of events)res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);res.end()
 },{protocol:'responses'})
 const model=createKJModelAdapter({protocol:'responses',model:'fixed-model',responsesStreaming:true,request:async({body,signal})=>readChatModelResponse(await app.post(body,{signal}))})
 const definition={name:'cad_read_drawing',description:'Read',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}}
 const turn=await model.createConversation({instructions:'Read.',tools:[definition]}).next({kind:'prompt',text:'Inspect.'},new AbortController().signal)
 assert.deepEqual(turn.calls,[{id:'read',name:'cad_read_drawing',arguments:{}}]);assert.equal(turn.usage.totalTokens,11)
 assert.equal(seen.length,1);assert.equal(seen[0].headers.authorization,'Bearer server-only-secret');assert.equal(seen[0].body.stream,true);assert.equal(seen[0].body.store,false);assert.equal('tool_stream' in seen[0].body,false)
})

test('model proxy terminates an SSE event that completes a reflected credential',async t=>{
 const app=await fixture(t,async(req,res)=>{req.resume();res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"server-only-"}}]}\n\n');await new Promise(resolve=>setTimeout(resolve,10));res.end('data: {"choices":[{"delta":{"content":"secret"},"finish_reason":"stop"}]}\n\n')})
 const response=await app.post({...body,stream:true});assert.equal(response.status,502)
 const received=await response.text()
 assert.ok(!received.includes('server-only-'));assert.ok(!received.includes('server-only-secret'))
})

test('model proxy releases real tool-call endings and usage with an sk-style credential', async t => {
  const app = await fixture(t, (req, res) => {
    req.resume()
    const events = [
      { model: 'models', choices: [{ index: 0, delta: { content: 'Read the patterns', tool_calls: [{ index: 0, id: 'call-patterns', type: 'function', function: { name: 'cad_read_hatch_patterns', arguments: '{' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
    ]
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
    res.end('data: [DONE]\n\n')
  }, { apiKey: 'sk-public-fixture-not-a-real-provider-secret' })
  const response = await app.post({ ...body, stream: true })
  assert.equal(response.status, 200)
  const frames = []
  for await (const event of await readChatModelResponse(response)) frames.push(event)
  assert.equal(frames.length, 3)
  assert.equal(frames[1].choices[0].finish_reason, 'tool_calls')
  assert.equal(frames[2].usage.total_tokens, 5)
})

test('model proxy permits a harmless final credential-prefix character only after choice completion', async t => {
  const app = await fixture(t, (req, res) => {
    req.resume()
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('data: {"choices":[{"index":0,"delta":{"content":"Draw holes"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  }, { apiKey: 'sk-public-fixture-not-a-real-provider-secret' })
  const response = await app.post({ ...body, stream: true })
  assert.equal(response.status, 200)
  const received = await response.text()
  assert.match(received, /Draw holes/)
  assert.match(received, /\[DONE\]/)
})

test('model proxy blocks reflected tool arguments even when sparse tool indices change array position', async t => {
  const app = await fixture(t, (req, res) => {
    req.resume()
    const events = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '{"label":"sk-fixture-' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }, { index: 1, function: { arguments: 'private"}' } }] }, finish_reason: 'tool_calls' }] },
    ]
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
    res.end('data: [DONE]\n\n')
  }, { apiKey: 'sk-fixture-private' })
  const response = await app.post({ ...body, stream: true })
  assert.equal(response.status, 502)
  const received = await response.text()
  assert.ok(!received.includes('sk-fixture-'))
  assert.ok(!received.includes('sk-fixture-private'))
})

test('model proxy blocks split Responses deltas and never releases an unfinished credential prefix', async t => {
  for (const behavior of ['split', 'truncated']) await t.test(behavior, async t => {
    const app = await fixture(t, (req, res) => {
      req.resume()
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const first = { type: 'response.output_text.delta', item_id: 'item-1', content_index: 0, delta: 'sk-fixture-' }
      res.write(`data: ${JSON.stringify(first)}\n\n`)
      if (behavior === 'split') {
        const second = { ...first, delta: 'private' }
        res.write(`data: ${JSON.stringify(second)}\n\n`)
      }
      res.end()
    }, { protocol: 'responses', apiKey: 'sk-fixture-private' })
    const response = await app.post({ model: 'fixed-model', input: [], max_output_tokens: 32, stream: true })
    assert.equal(response.status, 502)
    assert.ok(!(await response.text()).includes('sk-fixture-'))
  })
})

test('model proxy never forwards fragments after a completed chat choice or Responses response', async t => {
  for (const protocol of ['chat-completions', 'responses']) await t.test(protocol, async t => {
    const app = await fixture(t, async (req, res) => {
      req.resume()
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const first = protocol === 'chat-completions'
        ? { choices: [{ index: 0, delta: { content: 'sk-fixture-' }, finish_reason: 'stop' }] }
        : { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'sk-fixture-' }] }] } }
      const second = protocol === 'chat-completions'
        ? { choices: [{ index: 0, delta: { content: 'private' }, finish_reason: 'stop' }] }
        : { type: 'response.output_text.delta', item_id: 'item-1', content_index: 0, delta: 'private' }
      res.write(`data: ${JSON.stringify(first)}\n\n`)
      await new Promise(resolve => setTimeout(resolve, 20))
      res.end(`data: ${JSON.stringify(second)}\n\ndata: [DONE]\n\n`)
    }, { protocol, apiKey: 'sk-fixture-private' })
    const request = protocol === 'chat-completions'
      ? { ...body, stream: true }
      : { model: 'fixed-model', input: [], max_output_tokens: 32, stream: true }
    const response = await app.post(request)
    assert.equal(response.status, 200)
    const reader = response.body.getReader(), chunks = []
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      assert.fail('invalid post-terminal fragments must close the browser stream')
    } catch (error) {
      assert.notEqual(error.code, 'ERR_ASSERTION')
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    const received = Buffer.concat(chunks).toString('utf8')
    assert.match(received, /sk-fixture-/)
    assert.ok(!received.includes('private'))
    assert.ok(!received.includes('[DONE]'))
  })
})

test('a foreign protocol completion event cannot clear live chat credential fragments', async t => {
  const app = await fixture(t, (req, res) => {
    req.resume()
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const events = [
      { choices: [{ index: 0, delta: { content: 'sk-fixture-' } }] },
      { type: 'response.completed', response: { status: 'completed' } },
      { choices: [{ index: 0, delta: { content: 'private' }, finish_reason: 'stop' }] },
    ]
    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
    res.end('data: [DONE]\n\n')
  }, { apiKey: 'sk-fixture-private' })
  const response = await app.post({ ...body, stream: true })
  assert.equal(response.status, 502)
  assert.ok(!(await response.text()).includes('sk-fixture-'))
})

test('model proxy rejects JSON-escaped credentials in complete and fragmented tool arguments', async t => {
  for (const protocol of ['chat-completions', 'responses']) for (const fragments of [['{"label":"\\u0073k-fixture-private"}'], ['{"label":"\\u00', '73k-fixture-', 'private"}']]) {
    await t.test(`${protocol}/${fragments.length}-fragments`, async t => {
      const app = await fixture(t, (req, res) => {
        req.resume()
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        fragments.forEach((argumentsFragment, index) => {
          const event = protocol === 'chat-completions'
            ? { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argumentsFragment } }] }, ...(index === fragments.length - 1 ? { finish_reason: 'tool_calls' } : {}) }] }
            : { type: 'response.function_call_arguments.delta', item_id: 'item-1', output_index: 0, delta: argumentsFragment }
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        })
        res.end('data: [DONE]\n\n')
      }, { protocol, apiKey: 'sk-fixture-private' })
      const request = protocol === 'chat-completions' ? { ...body, stream: true } : { model: 'fixed-model', input: [], max_output_tokens: 32, stream: true }
      const response = await app.post(request)
      assert.equal(response.status, 502)
      assert.ok(!(await response.text()).includes('fixture-'))
    })
  }
})

test('model proxy inspects completed Responses argument snapshots without double-decoding literal escapes', async t => {
  for (const reflected of [true, false]) await t.test(String(reflected), async t => {
    const args = reflected ? '{"label":"\\u0073k-fixture-private"}' : JSON.stringify({ label: '\\u0073k-fixture-private' })
    const app = await fixture(t, (req, res) => {
      req.resume()
      const event = { type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', name: 'cad_read_drawing', arguments: args }] } }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify(event)}\n\n`)
    }, { protocol: 'responses', apiKey: 'sk-fixture-private' })
    const response = await app.post({ model: 'fixed-model', input: [], max_output_tokens: 32, stream: true })
    assert.equal(response.status, reflected ? 502 : 200)
    if (!reflected) assert.ok((await response.text()).includes('response.completed'))
  })
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
