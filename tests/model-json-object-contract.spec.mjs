import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJModelAdapter } from '../packages/kjdraw-sdk/src/model-adapters.js'

const jsonWire = (content = '{"answer":"observed"}') => ({ choices: [{ finish_reason: 'stop',
  message: { role: 'assistant', content } }] })
const instructions = 'Return the requested answer as JSON from actual observations.'
const signal = () => new AbortController().signal
const prompt = { kind: 'prompt', text: 'Return a JSON observation, without CAD edits.' }

test('JSON output is an explicit host option; default Chat requests remain unchanged', async () => {
  for (const extensions of [undefined, {}, { response_format: { type: 'json_object' } }]) {
    let body
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-json-contract',
      ...(extensions === undefined ? {} : { chatRequestExtensions: extensions }),
      request: async request => { body = request.body; return jsonWire() },
    })
    const answer = await model.createConversation({ instructions, tools: [] }).next(prompt, signal())
    assert.equal(answer.text, '{"answer":"observed"}')
    if (extensions?.response_format) {
      assert.deepEqual(body.response_format, { type: 'json_object' })
      assert.equal(Object.isFrozen(body.response_format), true)
    } else assert.equal(Object.hasOwn(body, 'response_format'), false)
  }
})

test('the host JSON format is copied before provider or caller code can mutate it', async () => {
  const extensions = { response_format: { type: 'json_object' } }
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-json-mutation',
    chatRequestExtensions: extensions,
    request: async ({ body }) => { assert.deepEqual(body.response_format, { type: 'json_object' }); return jsonWire() },
  })
  extensions.response_format.type = 'text'
  extensions.response_format.schema = { forcedAnswer: true }
  await model.createConversation({ instructions, tools: [] }).next(prompt, signal())
})

for (const [name, format] of [
  ['null', null], ['undefined', undefined], ['array', []], ['text', { type: 'text' }],
  ['schema dialect', { type: 'json_schema', json_schema: {} }],
  ['extra answer', { type: 'json_object', answer: 'host-filled' }],
  ['inherited type', Object.create({ type: 'json_object' })],
  ['hidden type', Object.defineProperty({}, 'type', { value: 'json_object', enumerable: false })],
  ['symbol extension', { type: 'json_object', [Symbol('answer')]: 'untrusted' }],
]) {
  test(`invalid JSON output configuration rejects ${name} before transport`, () => {
    let calls = 0
    assert.throws(() => createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-invalid-json',
      chatRequestExtensions: { response_format: format }, request: async () => { calls++; return jsonWire() },
    }), error => error.code === 'KJMODEL_PROTOCOL')
    assert.equal(calls, 0)
  })
}

test('format accessors cannot run while validating host options', () => {
  let reads = 0
  for (const extensions of [
    Object.defineProperty({}, 'response_format', { enumerable: true, get() { reads++; return { type: 'json_object' } } }),
    { response_format: Object.defineProperty({}, 'type', { enumerable: true, get() { reads++; return 'json_object' } }) },
  ]) assert.throws(() => createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-json-accessor',
    chatRequestExtensions: extensions, request: async () => jsonWire(),
  }), error => error.code === 'KJMODEL_PROTOCOL')
  assert.equal(reads, 0)
})

test('a hidden host response format cannot be silently dropped during JSON copying', () => {
  assert.throws(() => createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-hidden-json',
    chatRequestExtensions: Object.defineProperty({}, 'response_format', { value: { type: 'json_object' } }),
    request: async () => jsonWire(),
  }), error => error.code === 'KJMODEL_PROTOCOL')
})

test('JSON output does not rewrite tool arguments, approve CAD or repair a provider answer', async () => {
  const call = { id: 'actual-read-call', type: 'function', function: {
    name: 'cad_read_drawing', arguments: '{"includeHidden":false}',
  } }
  const requests = []
  const rawFinal = 'Still not JSON; this response must remain visibly invalid to its caller.'
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-json-native-call',
    chatRequestExtensions: { response_format: { type: 'json_object' } }, request: async ({ body }) => {
      requests.push(body)
      return requests.length === 1 ? { choices: [{ finish_reason: 'tool_calls', message: {
        role: 'assistant', content: null, tool_calls: [call],
      } }] } : jsonWire(rawFinal)
    },
  })
  const conversation = model.createConversation({ instructions, tools: [{ name: 'cad_read_drawing', effect: 'read',
    description: 'Read supplied native drawing data.', inputSchema: { type: 'object', additionalProperties: false,
      properties: { includeHidden: { type: 'boolean' } }, required: [] } }] })
  const read = await conversation.next(prompt, signal())
  assert.deepEqual(read.calls, [{ id: call.id, name: 'cad_read_drawing', arguments: { includeHidden: false } }])
  const final = await conversation.next({ kind: 'tool-results', results: [{ id: call.id, name: 'cad_read_drawing',
    result: { ok: true, value: { documentId: 'actual-drawing', revision: 1 } } }] }, signal())
  assert.equal(final.text, rawFinal)
  assert.throws(() => JSON.parse(final.text))
  assert.deepEqual(requests[1].messages.find(message => message.role === 'assistant').tool_calls, [call])
  assert.deepEqual(requests.map(body => body.response_format), [{ type: 'json_object' }, { type: 'json_object' }])
})

for (const protocol of ['responses', 'anthropic-messages', 'gemini-generate-content']) {
  test(`${protocol} cannot silently accept a Chat-only JSON option`, () => {
    assert.throws(() => createKJModelAdapter({ protocol, model: 'offline-wrong-protocol',
      chatRequestExtensions: { response_format: { type: 'json_object' } }, request: async () => jsonWire(),
    }), error => error.code === 'KJMODEL_PROTOCOL')
  })
}
