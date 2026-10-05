import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJModelAdapter } from '../src/model-adapters.js'

// Public offline protocol fixtures only: no provider, native CAD dispatch or acceptance count.
const MiB = 1048576, bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8')
const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const streamingOption = protocol => ({ responses: 'responsesStreaming', 'chat-completions': 'chatStreaming',
  'anthropic-messages': 'anthropicStreaming', 'gemini-generate-content': 'geminiStreaming' })[protocol]
const chat = (delta = {}, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] })
const signal = () => new AbortController().signal
const streamed = events => ({ async *[Symbol.asyncIterator]() { yield* events } })
const textResponse = (protocol, text = 'Done.') => protocol === 'responses'
  ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }
  : protocol === 'chat-completions' ? { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] }
    : protocol === 'anthropic-messages' ? { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] }
      : { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }] }
function conversation(protocol, request, options = {}) {
  return createKJModelAdapter({ protocol, model: 'public-offline-sse-fixture', [streamingOption(protocol)]: true,
    request, ...options }).createConversation({ instructions: 'Public offline wire conformance only.', tools: [] })
}
const ask = model => model.next({ kind: 'prompt', text: 'Read-only wire fixture.' }, signal())
function idleEvent(protocol, index, envelope = '') {
  const event = protocol === 'responses' ? { type: 'response.in_progress', sequence_number: index }
    : protocol === 'chat-completions' ? chat({ content: '' })
      : protocol === 'anthropic-messages' ? { type: 'ping' } : { candidates: [] }
  return { ...event, id: 'public-envelope-' + index, model: 'public-offline', system_fingerprint: envelope }
}
function toolEvents(protocol, start = 0, args = { publicSynthetic: true }) {
  const name = 'cad_read_drawing', id = 'public-read', argText = JSON.stringify(args)
  if (protocol === 'responses') return [{ type: 'response.completed', sequence_number: start, response: {
    status: 'completed', output: [
      { id: 'reasoning', type: 'reasoning', encrypted_content: 'public-opaque-reasoning' },
      { id: 'call-item', type: 'function_call', call_id: id, name, arguments: argText },
    ], usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 },
  } }]
  if (protocol === 'chat-completions') return [chat({ role: 'assistant', content: 'Ready.',
    reasoning_content: 'Public synthetic reasoning.', encrypted_content: 'public-encrypted-block',
    tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: argText } }] }, 'tool_calls')]
  if (protocol === 'anthropic-messages') return [
    { type: 'message_start', message: { role: 'assistant', content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'Public thinking.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'public-signed-thinking' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'public-redacted-block' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id, name, input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: argText } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ]
  return [{ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [
    { text: 'Public thinking.', thought: true, thoughtSignature: 'public-thought-signature' },
    { functionCall: { id, name, args }, thoughtSignature: 'public-call-signature' },
  ] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4, totalTokenCount: 24 } }]
}
function logicalOversize(protocol) {
  const text = 'x'.repeat(16384), count = 65
  if (protocol === 'responses') return [{ type: 'response.completed', sequence_number: 0,
    response: textResponse(protocol, text.repeat(count)) }]
  if (protocol === 'chat-completions') return [...Array.from({ length: count }, () => chat({ content: text })), chat({}, 'stop')]
  if (protocol === 'anthropic-messages') return [
    { type: 'message_start', message: { role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...Array.from({ length: count }, () => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }, { type: 'message_stop' },
  ]
  return Array.from({ length: count }, (_, index) => ({ candidates: [{ index: 0,
    content: { role: 'model', parts: [{ text }] }, ...(index === count - 1 ? { finishReason: 'STOP' } : {}) }] }))
}
function opaqueLogicalOversize(protocol) {
  const opaque = 'x'.repeat(600000)
  if (protocol === 'responses') return [{ type: 'response.completed', sequence_number: 0, response: {
    status: 'completed', output: [{ type: 'reasoning', encrypted_content: opaque + opaque }],
  } }]
  if (protocol === 'chat-completions') return [chat({ reasoning_content: opaque }), chat({ encrypted_content: opaque }), chat({ content: 'Done.' }, 'stop')]
  if (protocol === 'anthropic-messages') return [
    { type: 'message_start', message: { role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: opaque, signature: 'public-signature' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: opaque } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }, { type: 'message_stop' },
  ]
  return [{ candidates: [{ content: { role: 'model', parts: [{ text: 'Public thinking.', thought: true, thoughtSignature: opaque }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'Done.', thoughtSignature: opaque }] } }] }]
}
const sizeError = (phase, maximum) => error => {
  assert.equal(error.code, 'KJMODEL_SIZE_LIMIT'); assert.equal(error.details.phase, phase)
  assert.equal(error.details.maxBytes, maximum); assert.ok(error.details.actualBytes > maximum)
  assert.deepEqual(Object.keys(error.details).sort(), ['actualBytes', 'maxBytes', 'phase'])
  return true
}

test('fragmented 1.3 MiB Chat envelopes retain exactly 7071 UTF-8 tool-argument bytes and every semantic field', async () => {
  const prefix = JSON.stringify({ publicSynthetic: 'x' })
  const args = { publicSynthetic: 'x'.repeat(7071 - Buffer.byteLength(prefix) + 1) }, argText = JSON.stringify(args)
  assert.equal(Buffer.byteLength(argText), 7071)
  const header = { id: 'chatcmpl-public-synthetic-byte-budget-fixture', object: 'chat.completion.chunk',
    created: 1, model: 'public-synthetic-offline-stream-fixture', system_fingerprint: 'f'.repeat(128) }
  const events = [chat({ role: 'assistant', content: 'Visible.', reasoning_content: 'Public reasoning.', encrypted_content: 'public-opaque-block' })]
  for (let index = 0; index < argText.length; index += 2) events.push({ ...header, ...chat({ tool_calls: [{ index: 0,
    ...(index === 0 ? { id: 'public-read', type: 'function' } : {}), function: {
      ...(index === 0 ? { name: 'cad_read_drawing' } : {}), arguments: argText.slice(index, index + 2),
    } }] }) })
  events.push(chat({}, 'tool_calls'))
  const envelopeBytes = events.reduce((total, event) => total + bytes(event), 0)
  assert.ok(envelopeBytes > 1300000 && envelopeBytes < 2 * MiB)
  const requests = [], deltas = []
  const model = conversation('chat-completions', async ({ body }) => { requests.push(body)
    return requests.length === 1 ? streamed(events) : textResponse('chat-completions') }, { onTextDelta: delta => deltas.push(delta) })
  const turn = await ask(model)
  assert.equal(turn.text, 'Visible.'); assert.deepEqual(turn.calls, [{ id: 'public-read', name: 'cad_read_drawing', arguments: args }])
  await model.next({ kind: 'tool-results', results: [{ id: 'public-read', name: 'cad_read_drawing',
    result: { ok: false, error: { code: 'OFFLINE_WIRE_ONLY', message: 'No native tool was executed.' } } }] }, signal())
  const assistant = requests[1].messages.find(message => message.role === 'assistant')
  assert.equal(assistant.reasoning_content, 'Public reasoning.'); assert.equal(assistant.encrypted_content, 'public-opaque-block')
  assert.equal(assistant.tool_calls[0].function.arguments, argText)
  assert.equal(deltas.join(''), 'Visible.Done.')
})

for (const protocol of protocols) {
  test(`${protocol}: >1 MiB repeated envelopes do not erase semantic arguments, thinking or signatures`, async () => {
    const events = [...Array.from({ length: 700 }, (_, index) => idleEvent(protocol, index, 'e'.repeat(2000))), ...toolEvents(protocol, 700)]
    assert.ok(events.reduce((sum, event) => sum + bytes(event), 0) > 1300000)
    assert.ok(events.every(event => bytes(event) < MiB))
    const requests = []
    const model = conversation(protocol, async ({ body }) => { requests.push(body)
      return requests.length === 1 ? streamed(events) : textResponse(protocol) })
    const turn = await ask(model)
    assert.deepEqual(turn.calls, [{ id: 'public-read', name: 'cad_read_drawing', arguments: { publicSynthetic: true } }])
    await model.next({ kind: 'tool-results', results: [{ id: 'public-read', name: 'cad_read_drawing',
      result: { ok: false, error: { code: 'OFFLINE_WIRE_ONLY', message: 'No native tool was executed.' } } }] }, signal())
    const history = protocol === 'responses' ? requests[1].input : protocol === 'gemini-generate-content' ? requests[1].contents : requests[1].messages
    const semantic = JSON.stringify(history)
    assert.match(semantic, /publicSynthetic/)
    if (protocol === 'responses') assert.match(semantic, /public-opaque-reasoning/)
    if (protocol === 'chat-completions') { assert.match(semantic, /Public synthetic reasoning/); assert.match(semantic, /public-encrypted-block/) }
    if (protocol === 'anthropic-messages') { assert.match(semantic, /public-signed-thinking/); assert.match(semantic, /public-redacted-block/) }
    if (protocol === 'gemini-generate-content') { assert.match(semantic, /public-thought-signature/); assert.match(semantic, /public-call-signature/) }
  })
  test(`${protocol}: complete logical JSON still cannot exceed the unchanged 1 MiB cap`, async () => {
    await assert.rejects(ask(conversation(protocol, async () => streamed(logicalOversize(protocol)))), sizeError(protocol === 'responses' ? 'stream' : 'response', MiB))
  })
  test(`${protocol}: reasoning, encrypted or signed fields count toward the unchanged complete logical cap`, async () => {
    await assert.rejects(ask(conversation(protocol, async () => streamed(opaqueLogicalOversize(protocol)))), sizeError(protocol === 'responses' ? 'stream' : 'response', MiB))
  })
  test(`${protocol}: a single oversized parsed event is rejected despite the separate 8 MiB envelope budget`, async () => {
    const event = idleEvent(protocol, 0, 'x'.repeat(MiB))
    await assert.rejects(ask(conversation(protocol, async () => streamed([event]))), sizeError('stream', MiB))
  })
  test(`${protocol}: 8 MiB envelope flood closes the iterator before an untrusted terminal/call`, async () => {
    let pulls = 0, closed = false
    const flood = { async *[Symbol.asyncIterator]() { try { while (true) yield idleEvent(protocol, pulls++, 'e'.repeat(16384)) }
      finally { closed = true } } }
    await assert.rejects(ask(conversation(protocol, async () => flood)), sizeError('stream', 8 * MiB))
    assert.equal(closed, true); assert.ok(pulls < 600)
  })
  test(`${protocol}: nonstream response cap is unchanged even with the separate stream budget configured`, async () => {
    const model = createKJModelAdapter({ protocol, model: 'public-offline-nonstream', maxStreamBytes: 8 * MiB,
      request: async () => textResponse(protocol, 'x'.repeat(MiB)) }).createConversation({ instructions: 'Offline.', tools: [] })
    await assert.rejects(ask(model), sizeError('response', MiB))
  })
}

test('aggregate stream budget has an exact UTF-8 boundary and never measures characters instead of bytes', async () => {
  const events = [chat({ content: '公开合成' }), chat({}, 'stop')], maximum = events.reduce((sum, event) => sum + bytes(event), 0)
  assert.equal((await ask(conversation('chat-completions', async () => streamed(events), { maxStreamBytes: maximum }))).text, '公开合成')
  await assert.rejects(ask(conversation('chat-completions', async () => streamed(events), { maxStreamBytes: maximum - 1 })), sizeError('stream', maximum - 1))
})
test('separate stream byte options remain integer-bounded and cannot disable the 8 MiB flood guard', () => {
  for (const maxStreamBytes of [0, -1, 1.5, NaN, Infinity, 8 * MiB + 1]) assert.throws(() => conversation('chat-completions', async () => ({}), { maxStreamBytes }), /limit/)
})
test('malformed parsed event, truncated stream and length-limited JSON remain proper failures, not partial calls', async () => {
  for (const protocol of protocols) await assert.rejects(ask(conversation(protocol, async () => streamed(['{"incomplete":']))), error => error.code === 'KJMODEL_PROTOCOL')
  await assert.rejects(ask(conversation('chat-completions', async () => streamed([chat({ tool_calls: [{ index: 0,
    id: 'public-read', type: 'function', function: { name: 'cad_read_drawing', arguments: '{' } }] })]))), error => error.code === 'KJMODEL_INCOMPLETE')
  await assert.rejects(ask(conversation('chat-completions', async () => streamed([chat({ tool_calls: [{ index: 0,
    id: 'public-read', type: 'function', function: { name: 'cad_read_drawing', arguments: '{' } }] }, 'length')]))), error => error.code === 'KJMODEL_INCOMPLETE')
  const invalidAnthropic = toolEvents('anthropic-messages')
  invalidAnthropic.find(event => event.delta?.type === 'input_json_delta').delta.partial_json = '{'
  await assert.rejects(ask(conversation('anthropic-messages', async () => streamed(invalidAnthropic))), error => error.code === 'KJMODEL_PROTOCOL')
})
test('flood cleanup cannot delay the budget rejection even when iterator.return throws, rejects or never settles', async () => {
  for (const returnMode of ['throw', 'reject', 'never']) {
    let returned = false
    const source = { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: idleEvent('chat-completions', 0, 'x'.repeat(200)) } },
      return() { returned = true; if (returnMode === 'throw') throw new Error('public-fixture-cleanup'); if (returnMode === 'reject') return Promise.reject(new Error('public-fixture-cleanup')); return new Promise(() => {}) } } } }
    await assert.rejects(ask(conversation('chat-completions', async () => source, { maxStreamBytes: 100 })), sizeError('stream', 100))
    assert.equal(returned, true)
  }
})
