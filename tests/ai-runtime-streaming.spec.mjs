import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { readAiModelResponse } from '../apps/playground/ai/model-response.js'

// Network fixtures verify transport and CAD admission, not live-model acceptance.
const encoder = new TextEncoder()
const endpoint = 'https://stream-fixture.invalid/v1/chat/completions'
const chunk = (delta, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] })
const event = (value, newline = '\n') => `data: ${JSON.stringify(value)}${newline}${newline}`
const wire = (values, newline = '\n') => values.map(value => event(value, newline)).join('') + `data: [DONE]${newline}${newline}`
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function byteResponse(text, fragmentSize = 1) {
  const bytes = typeof text === 'string' ? encoder.encode(text) : text
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += fragmentSize) controller.enqueue(bytes.slice(offset, offset + fragmentSize))
    controller.close()
  } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}

function liveResponse() {
  let controller, cancellations = 0
  const response = new Response(new ReadableStream({
    start(value) { controller = value },
    cancel() { cancellations++ },
  }), { headers: { 'content-type': 'text/event-stream' } })
  return { response, append: text => controller.enqueue(encoder.encode(text)), close: () => controller.close(),
    get cancellations() { return cancellations } }
}

const patternArgs = { expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [] }
const proposalDelta = (args = patternArgs) => ({ tool_calls: [{ index: 0, id: 'stream-proposal', type: 'function',
  function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify(args) } }] })

test('real text arrives before the server closes its stream and before the send resolves', { timeout: 5000 }, async () => {
  const source = liveResponse(), first = deferred(), deltas = []
  let finished = false
  const chat = createAiChatRuntime({ endpoint, model: 'transport-fixture', fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, true)
    source.append(event(chunk({ role: 'assistant', content: '' })))
    source.append(event(chunk({ content: '正在' })))
    return source.response
  } })
  try {
    const running = chat.send('Hello', { onTextDelta: value => { deltas.push(value); first.resolve() } })
      .then(value => { finished = true; return value })
    await first.promise
    assert.equal(finished, false)
    assert.deepEqual(deltas, [{ delta: '正在', text: '正在', requestIndex: 0 }])
    assert.deepEqual((await chat.exportLocalState()).history, [])
    assert.equal(chat.revision, 0)
    source.append(event(chunk({ content: '回复。' })))
    source.append(event(chunk({}, 'stop')) + 'data: [DONE]\n\n')
    source.close()
    const result = await running
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(result.text, '正在回复。')
    assert.deepEqual(deltas.at(-1), { delta: '回复。', text: '正在回复。', requestIndex: 0 })
    assert.equal((await chat.exportLocalState()).history[0].assistant, result.text)
  } finally { chat.destroy() }
})

for (const newline of ['\n', '\r\n', '\r']) test(`SSE survives one-byte UTF-8 and ${JSON.stringify(newline)} line splits`, async () => {
  const deltas = []
  const text = '\uFEFF: keepalive' + newline + newline + 'event: message' + newline +
    wire([chunk({ role: 'assistant', content: '' }), chunk({ content: '素填土🙂' }), chunk({ content: '花纹' }), chunk({}, 'stop')], newline)
  const chat = createAiChatRuntime({ endpoint, model: 'transport-fixture', fetchImpl: async () => byteResponse(text) })
  try {
    const result = await chat.send('Hello', { onTextDelta: value => deltas.push(value) })
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(result.text, '素填土🙂花纹')
    assert.deepEqual(deltas.map(value => value.delta), ['素填土🙂', '花纹'])
    assert.equal(deltas.at(-1).text, result.text)
  } finally { chat.destroy() }
})

test('SSE joins multiple data lines and ignores comments and other event metadata', async () => {
  const expected = chunk({ content: '收到' }, 'stop')
  const source = ': ping\r\nid: 7\r\nevent: message\r\nretry: 1000\r\ndata: {\r\n' +
    `data: "choices":${JSON.stringify(expected.choices)}\r\ndata: }\r\n\r\ndata: [DONE]\r\n\r\n`
  const events = await readAiModelResponse(byteResponse(source))
  assert.deepEqual(await Array.fromAsync(events), [expected])
})

test('interleaved tool fragments assemble by index and each model round has its own visible reply', async () => {
  const deltas = [], requests = []
  const frames = [
    chunk({ content: '先检查。', tool_calls: [
      { index: 1, id: 'stream-history', type: 'function', function: { name: 'cad_read_', arguments: '{"expectedRevision":' } },
      { index: 0, id: 'stream-drawing', type: 'function', function: { name: 'cad_read_', arguments: '{' } },
    ] }),
    chunk({ tool_calls: [
      { index: 0, function: { name: 'drawing', arguments: '}' } },
      { index: 1, function: { name: 'history', arguments: '0}' } },
    ] }),
    chunk({}, 'tool_calls'),
  ]
  const chat = createAiChatRuntime({ endpoint, model: 'transport-fixture', captureToolOutputs: true,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      requests.push(body)
      if (requests.length === 1) return byteResponse(wire(frames), 7)
      assert.equal(requests.length, 2)
      const outputs = body.messages.filter(value => value.role === 'tool')
      assert.deepEqual(outputs.map(value => value.tool_call_id), ['stream-drawing', 'stream-history'])
      assert.ok(outputs.every(value => JSON.parse(value.content).ok === true))
      return byteResponse(wire([chunk({ content: '已检查。' }), chunk({}, 'stop')]), 5)
    },
  })
  try {
    const result = await chat.send('Read-only: inspect the blank drawing and its actual history.', { onTextDelta: value => deltas.push(value) })
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(result.text, '已检查。')
    assert.deepEqual(result.toolOutputs.map(value => value.name), ['cad_read_drawing', 'cad_read_history'])
    assert.deepEqual(deltas, [
      { delta: '先检查。', text: '先检查。', requestIndex: 0 },
      { delta: '已检查。', text: '已检查。', requestIndex: 1 },
    ])
    assert.equal(chat.entityCount, 0)
    assert.equal(chat.revision, 0)
  } finally { chat.destroy() }
})

test('complete streamed tool arguments remain undispatched until the validated finish, then await human approval', { timeout: 5000 }, async () => {
  const source = liveResponse(), first = deferred(), progress = []
  const args = JSON.stringify(patternArgs), split = Math.floor(args.length / 2)
  const chat = createAiChatRuntime({ endpoint, model: 'transport-fixture', captureToolOutputs: true, fetchImpl: async () => {
    source.append(event(chunk({ content: '准备提案。', tool_calls: [{ index: 0, id: 'stream-proposal', type: 'function',
      function: { name: 'cad_propose_drawing_', arguments: args.slice(0, split) } }] })))
    source.append(event(chunk({ tool_calls: [{ index: 0, function: { name: 'pattern', arguments: args.slice(split) } }] })))
    return source.response
  } })
  try {
    const running = chat.send('Draw a 20 mm line', { onProgress: value => progress.push(value), onTextDelta: () => first.resolve() })
    await first.promise
    assert.equal(progress.some(value => value.phase === 'tool-start'), false)
    assert.equal(chat.entityCount, 0)
    assert.equal(chat.revision, 0)
    source.append(event(chunk({}, 'tool_calls')) + 'data: [DONE]\n\n')
    source.close()
    const result = await running
    assert.equal(result.status, 'proposal', JSON.stringify(result.error))
    assert.equal(result.toolOutputs.length, 1)
    assert.equal(result.toolOutputs[0].name, 'cad_propose_drawing_pattern')
    assert.equal(result.proposal.status, 'awaiting-host-approval')
    assert.equal(chat.entityCount, 0)
    assert.equal(chat.revision, 0)
    assert.equal((await chat.approve(result.proposal.planId)).status, 'applied')
    assert.equal(chat.entityCount, 1)
    assert.equal(chat.revision, 1)
  } finally { chat.destroy() }
})

test('cancel aborts a blocked response reader and suppresses partial tools, history and later UI updates', { timeout: 5000 }, async () => {
  const source = liveResponse(), first = deferred(), deltas = [], signal = new AbortController()
  const chat = createAiChatRuntime({ endpoint, model: 'transport-fixture', captureToolOutputs: true, fetchImpl: async () => {
    source.append(event(chunk({ content: '正在准备。', ...proposalDelta() })))
    return source.response
  } })
  try {
    const running = chat.send('Draw a 20 mm line', { signal: signal.signal, onTextDelta: value => { deltas.push(value); first.resolve() } })
    await first.promise
    signal.abort()
    const result = await running
    assert.equal(result.status, 'cancelled')
    assert.equal(source.cancellations, 1, 'the underlying stalled network body is released')
    assert.equal(result.toolOutputs.length, 0)
    assert.equal(deltas.length, 1)
    assert.equal(chat.entityCount, 0)
    assert.equal(chat.revision, 0)
    assert.deepEqual((await chat.exportLocalState()).history, [])
    assert.equal((await chat.approve('invented-partial-plan')).status, 'error')
    chat.configure({ endpoint, model: 'transport-fixture' })
  } finally { chat.destroy() }
})

test('cancellation from the first text callback stops even same-network-chunk trailing tool frames', async () => {
  const signal = new AbortController(), deltas = []
  const chat = createAiChatRuntime({ endpoint, model: 'transport-fixture', captureToolOutputs: true,
    fetchImpl: async () => byteResponse(wire([chunk({ content: '第一段' }), chunk({ content: '后续', ...proposalDelta() }), chunk({}, 'tool_calls')]), 8192),
  })
  try {
    const result = await chat.send('Draw a 20 mm line', { signal: signal.signal, onTextDelta: value => { deltas.push(value); signal.abort() } })
    assert.equal(result.status, 'cancelled')
    assert.equal(deltas.length, 1)
    assert.equal(result.toolOutputs.length, 0)
    assert.equal(chat.entityCount, 0)
    assert.equal(chat.revision, 0)
  } finally { chat.destroy() }
})

test('JSON-only compatible endpoints still return an atomic message and a single actual text update', async () => {
  const deltas = []
  const chat = createAiChatRuntime({ endpoint, model: 'transport-fixture', fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, true)
    return Response.json({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '完整回复' } }] })
  } })
  try {
    const result = await chat.send('Hello', { onTextDelta: value => deltas.push(value) })
    assert.equal(result.status, 'message')
    assert.equal(result.text, '完整回复')
    assert.deepEqual(deltas, [{ delta: '完整回复', text: '完整回复', requestIndex: 0 }])
  } finally { chat.destroy() }
})

test('Responses protocol also forwards validated real text events from browser SSE', async () => {
  const deltas = [], content = '收到回复'
  const fields = { item_id: 'response-message', output_index: 0, content_index: 0 }
  const frames = [
    { type: 'response.output_text.delta', sequence_number: 0, ...fields, delta: '收到' },
    { type: 'response.output_text.delta', sequence_number: 1, ...fields, delta: '回复' },
    { type: 'response.output_text.done', sequence_number: 2, ...fields, text: content },
    { type: 'response.completed', sequence_number: 3, response: { status: 'completed', output: [
      { type: 'message', id: fields.item_id, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: content, annotations: [] }] },
    ], usage: { input_tokens: 11, output_tokens: 2, total_tokens: 13 } } },
  ]
  const chat = createAiChatRuntime({ endpoint: 'https://stream-fixture.invalid/v1/responses', protocol: 'responses', model: 'transport-fixture',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.stream, true)
      assert.equal(body.messages, undefined)
      return byteResponse(frames.map(value => event(value)).join(''))
    },
  })
  try {
    const result = await chat.send('Hello', { onTextDelta: value => deltas.push(value) })
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(result.text, content)
    assert.deepEqual(deltas.map(value => value.delta), ['收到', '回复'])
    assert.equal(deltas.at(-1).text, content)
  } finally { chat.destroy() }
})

test('Anthropic protocol forwards text blocks while preserving its own streaming wire format', async () => {
  const deltas = []
  const frames = [
    { type: 'message_start', message: { id: 'anthropic-message', type: 'message', role: 'assistant', content: [], model: 'transport-fixture',
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 11 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '收到' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '回复' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ]
  const chat = createAiChatRuntime({ endpoint: 'https://stream-fixture.invalid/v1/messages', protocol: 'anthropic-messages', provider: 'anthropic', model: 'transport-fixture',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(body.stream, true)
      assert.ok(body.messages)
      assert.ok(body.system)
      return byteResponse(frames.map(value => event(value)).join(''))
    },
  })
  try {
    const result = await chat.send('Hello', { onTextDelta: value => deltas.push(value) })
    assert.equal(result.status, 'message', JSON.stringify(result.error))
    assert.equal(result.text, '收到回复')
    assert.deepEqual(deltas.map(value => value.delta), ['收到', '回复'])
  } finally { chat.destroy() }
})

for (const [name, text] of [
  ['missing finish reason', wire([chunk(proposalDelta())])],
  ['truncated final event', event(chunk(proposalDelta())) + `data: ${JSON.stringify(chunk({}, 'tool_calls'))}`],
  ['invalid JSON after a tool finish', event(chunk(proposalDelta())) + event(chunk({}, 'tool_calls')) + 'data: invalid\n\n'],
  ['changed tool identity', wire([chunk(proposalDelta()), chunk({ tool_calls: [{ index: 0, id: 'different-id' }] }), chunk({}, 'tool_calls')])],
  ['output budget finish', wire([chunk(proposalDelta()), chunk({}, 'length')])],
]) test(`${name} cannot dispatch or restore partial CAD proposals`, async () => {
  const chat = createAiChatRuntime({ endpoint, model: 'transport-fixture', captureToolOutputs: true, fetchImpl: async () => byteResponse(text, 9) })
  try {
    const result = await chat.send('Draw a 20 mm line')
    assert.equal(result.status, 'error', JSON.stringify(result))
    assert.equal(result.toolOutputs.length, 0)
    assert.equal(result.proposal, undefined)
    assert.equal(chat.revision, 0)
    assert.equal(chat.entityCount, 0)
    assert.deepEqual((await chat.exportLocalState()).history, [])
  } finally { chat.destroy() }
})

test('response readers enforce byte budgets, strict UTF-8 and JSON compatibility', async () => {
  await assert.rejects(readAiModelResponse(Response.json({ ok: true }), { maxBytes: 3 }), /budget/)
  const invalidBytes = Uint8Array.from([...encoder.encode('data: {"value":"'), 0xe7, 0xb4])
  const events = await readAiModelResponse(byteResponse(invalidBytes))
  await assert.rejects(Array.fromAsync(events))
  assert.deepEqual(await readAiModelResponse(Response.json({ value: 'JSON response' })), { value: 'JSON response' })
  await assert.rejects(readAiModelResponse(Response.json({ value: 'failed' }, { status: 502 })), /failed/)
  await assert.rejects(readAiModelResponse(Response.json({}), { maxBytes: 0 }), /budget/)
})

test('JSON fallback reading also cancels a stalled body and releases its reader', { timeout: 5000 }, async () => {
  let start, cancellations = 0
  const ready = new Promise(resolve => { start = resolve })
  const signal = new AbortController()
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('{"value":"partial')) },
    pull() { start() },
    cancel() { cancellations++ },
  }), { headers: { 'content-type': 'application/json' } })
  const reading = readAiModelResponse(response, { signal: signal.signal })
  await ready
  signal.abort()
  await assert.rejects(reading, error => error.name === 'AbortError')
  assert.equal(cancellations, 1)
  assert.equal(response.body.locked, false)
})

test('SSE framing has its own bounded transport budget while each JSON event stays small', async () => {
  const payload = ': ' + 'f'.repeat(510) + '\n\n'
  const source = payload.repeat(5000) + wire([chunk({ content: 'Complete.' }), chunk({}, 'stop')])
  assert.ok(encoder.encode(source).byteLength > 2 * 1024 * 1024)
  const values = await readAiModelResponse(byteResponse(source, 65536))
  assert.deepEqual(await Array.fromAsync(values), [chunk({ content: 'Complete.' }), chunk({}, 'stop')])
  const limited = await readAiModelResponse(byteResponse(source, 65536), { maxBytes: 2 * 1024 * 1024 })
  await assert.rejects(Array.fromAsync(limited), /budget/)
})

test('SSE rejects a wire flood or an oversized event and releases the real reader', async () => {
  const flood = byteResponse((': ' + 'f'.repeat(510) + '\n\n').repeat(17000), 65536)
  await assert.rejects(Array.fromAsync(await readAiModelResponse(flood)), /budget/)
  assert.equal(flood.body.locked, false)
  const oversized = byteResponse(event({ value: 'x'.repeat(1024 * 1024) }), 65536)
  await assert.rejects(Array.fromAsync(await readAiModelResponse(oversized)), /budget/)
  assert.equal(oversized.body.locked, false)
})

test('nonstreaming JSON retains its original two-MiB default instead of inheriting the SSE budget', async () => {
  await assert.rejects(readAiModelResponse(Response.json({ value: 'x'.repeat(2 * 1024 * 1024) })), /budget/)
})

test('an exact one-MiB JSON event accepts a chunk split after its CR without counting the terminator as payload', async () => {
  const value = { value: 'x'.repeat(1024 * 1024 - 12) }
  assert.equal(encoder.encode(JSON.stringify(value)).byteLength, 1024 * 1024)
  const source = event(value, '\r\n') + 'data: [DONE]\r\n\r\n'
  const bytes = encoder.encode(source), split = source.indexOf('\r') + 1
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close()
  } }), { headers: { 'content-type': 'text/event-stream' } })
  assert.deepEqual(await Array.fromAsync(await readAiModelResponse(response)), [value])
  assert.equal(response.body.locked, false)
  assert.deepEqual(await Array.fromAsync(await readAiModelResponse(byteResponse(source, bytes.length))), [value])
})

test('an oversized SSE metadata line rejects independently of transport chunk boundaries', async () => {
  const source = ': ' + 'x'.repeat(3 * 1024 * 1024) + '\n\n'
  for (const size of [source.length, 65536]) {
    const response = byteResponse(source, size)
    await assert.rejects(Array.fromAsync(await readAiModelResponse(response)), /line exceeds budget/)
    assert.equal(response.body.locked, false)
  }
})
