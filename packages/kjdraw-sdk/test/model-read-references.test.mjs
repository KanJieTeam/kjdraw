import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJModelAdapter, KJModelError } from '../src/model-adapters.js'
import { runKJAgentTask } from '../src/agent-runner.js'

const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const signal = () => new AbortController().signal
function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
function wire(protocol, id, name = 'cad_read_drawing', args = {}) {
  if (protocol === 'responses') return { status: 'completed', output: id ? [
    { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) },
  ] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }] }
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: id ? 'tool_calls' : 'stop',
    message: { role: 'assistant', content: id ? null : 'Done.', ...(id ? { tool_calls: [
      { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ] } : {}) } }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: id ? 'tool_use' : 'end_turn',
    content: id ? [{ type: 'tool_use', id, name, input: args }] : [{ type: 'text', text: 'Done.' }] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: id ? [
    { functionCall: { id, name, args } },
  ] : [{ text: 'Done.' }] } }] }
}
function receipts(protocol, body) {
  if (protocol === 'responses') return body.input.filter(item => item.type === 'function_call_output')
    .map(item => ({ id: item.call_id, result: JSON.parse(item.output) }))
  if (protocol === 'chat-completions') return body.messages.filter(item => item.role === 'tool')
    .map(item => ({ id: item.tool_call_id, result: JSON.parse(item.content) }))
  if (protocol === 'anthropic-messages') return body.messages.flatMap(item => Array.isArray(item.content)
    ? item.content.filter(part => part.type === 'tool_result').map(part => ({ id: part.tool_use_id, result: JSON.parse(part.content) })) : [])
  return body.contents.flatMap(item => item.parts.filter(part => part.functionResponse)
    .map(part => ({ id: part.functionResponse.id, result: part.functionResponse.response })))
}

for (const protocol of protocols) {
  test(`${protocol}: repeated native reads use an explicit reference only when opted in, retaining original receipt and host outputs`, async () => {
    for (const reuseReadResultReferences of [undefined, false, true]) {
      const { document, session } = fixture(), before = document.serialize(), requests = []
      const model = createKJModelAdapter({ protocol, model: 'offline-read-reference', reuseReadResultReferences,
        request: async ({ body }) => { requests.push(body); return wire(protocol, requests.length < 3 ? `read-${requests.length}` : null) } })
      const result = await runKJAgentTask({ session, model, prompt: 'Read twice without modifying anything.', toolNames: ['cad_read_drawing'] })
      assert.equal(result.status, 'responded')
      const history = receipts(protocol, requests[2])
      assert.equal(history.length, 2)
      assert.deepEqual(history[0].result, result.outputs[0].result)
      assert.deepEqual(result.outputs[0].result, result.outputs[1].result, 'both host outputs remain complete actual native results')
      if (reuseReadResultReferences) {
        assert.equal(history[1].result.value.status, 'unchanged-read-result')
        assert.equal(history[1].result.value.originalToolCallId, 'read-1')
        assert.equal(history[1].result.value.toolName, 'cad_read_drawing')
        assert.match(history[1].result.value.instruction, /not approval/)
      } else assert.deepEqual(history[1].result, result.outputs[1].result)
      assert.equal(document.serialize(), before)
    }
  })

  test(`${protocol}: failed reads, changed arguments, changed data and proposal receipts are never replaced`, async () => {
    for (const kind of ['failed-read', 'changed-args', 'changed-result', 'proposal']) {
      const { session } = fixture(), requests = [], name = kind === 'proposal' ? 'cad_propose_circles' : 'cad_read_drawing'
      // Wire conformance fixtures do not approve or execute any proposal.
      const first = kind === 'failed-read' ? { ok: false, error: { code: 'KJDOCUMENT_INVALID', message: 'Rejected.' } }
        : kind === 'proposal' ? { ok: true, value: { status: 'awaiting-host-approval', planId: 'unapproved-wire-fixture' } }
          : await session.call('cad_read_drawing', {})
      const second = kind === 'changed-result' ? { ...first, value: { ...first.value, revision: first.value.revision + 1 } } : first
      const model = createKJModelAdapter({ protocol, model: 'offline-reference-guards', reuseReadResultReferences: true,
        request: async ({ body }) => { requests.push(body); return wire(protocol, requests.length < 3 ? `id-${requests.length}` : null,
          name, kind === 'changed-args' && requests.length === 2 ? { extra: true } : {}) } })
      const conversation = model.createConversation({ instructions: 'Wire conformance only.', tools: session.definitions })
      let turn = await conversation.next({ kind: 'prompt', text: 'Inspect.' }, signal())
      turn = await conversation.next({ kind: 'tool-results', results: [{ id: turn.calls[0].id, name, result: first }] }, signal())
      await conversation.next({ kind: 'tool-results', results: [{ id: turn.calls[0].id, name, result: second }] }, signal())
      assert.deepEqual(receipts(protocol, requests[2]).map(item => item.result), [first, second], kind)
    }
  })
}

test('Gemini omitted provider IDs never become unresolvable read-result references', async () => {
  const { session } = fixture(), requests = []
  const model = createKJModelAdapter({ protocol: 'gemini-generate-content', model: 'offline-no-provider-id', reuseReadResultReferences: true,
    request: async ({ body }) => {
      requests.push(body)
      const response = wire('gemini-generate-content', requests.length < 3 ? `read-${requests.length}` : null)
      if (requests.length < 3) delete response.candidates[0].content.parts[0].functionCall.id
      return response
    } })
  const result = await runKJAgentTask({ session, model, prompt: 'Read twice.', toolNames: ['cad_read_drawing'] })
  assert.equal(result.status, 'responded')
  const history = receipts('gemini-generate-content', requests[2])
  assert.deepEqual(history.map(item => item.result), result.outputs.map(item => item.result))
  assert.ok(history.every(item => item.id === undefined))
})

test('a cross-turn reused call ID cannot be referenced ambiguously', async () => {
  const { session } = fixture(), native = await session.call('cad_read_drawing', {}), requests = []
  const outcomes = [native, { ...native, value: { ...native.value, revision: native.value.revision + 1 } }, native]
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-reused-id', reuseReadResultReferences: true,
    request: async ({ body }) => { requests.push(body); return wire('chat-completions', ['x', 'x', 'y', null][requests.length - 1]) } })
  const conversation = model.createConversation({ instructions: 'Wire ID conformance.', tools: session.definitions })
  let turn = await conversation.next({ kind: 'prompt', text: 'Inspect.' }, signal())
  for (const result of outcomes) turn = await conversation.next({ kind: 'tool-results', results: [
    { id: turn.calls[0].id, name: 'cad_read_drawing', result },
  ] }, signal())
  assert.deepEqual(receipts('chat-completions', requests[3]).map(item => item.result), outcomes)
})

test('read references do not cross conversations', async () => {
  const { session } = fixture(), requests = []
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-separate-conversations', reuseReadResultReferences: true,
    request: async ({ body }) => { requests.push(body); return wire('chat-completions', requests.length % 2 ? 'read' : null) } })
  for (let index = 0; index < 2; index++) {
    const result = await runKJAgentTask({ session, model, prompt: 'Read.', toolNames: ['cad_read_drawing'] })
    assert.equal(result.status, 'responded')
    assert.deepEqual(receipts('chat-completions', requests[index * 2 + 1])[0].result, result.outputs[0].result)
  }
})

test('byte-identical repeated large read receipts stay bounded without changing the configured request limit', async () => {
  const { session } = fixture(), native = await session.call('cad_read_drawing', {})
  // An explicit wire-size fixture, not a real-model or native-geometry correctness test.
  const big = { ...native, value: { ...native.value, wireFixture: 'x'.repeat(100000) } }
  const results = []
  for (const enabled of [false, true]) {
    let requests = 0, maxSentBytes = 0
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-budget-boundary', reuseReadResultReferences: enabled,
      maxHistoryBytes: 2097152, request: async ({ body }) => {
        requests++; maxSentBytes = Math.max(maxSentBytes, Buffer.byteLength(JSON.stringify(body)))
        return wire('chat-completions', requests <= 21 ? `read-${requests}` : null)
      } })
    const conversation = model.createConversation({ instructions: 'Explicit read-size fixture.', tools: session.definitions.filter(tool => tool.name === 'cad_read_drawing') })
    let turn = await conversation.next({ kind: 'prompt', text: 'Read repeated receipts.' }, signal()), failure
    for (let index = 0; index < 21; index++) {
      try { turn = await conversation.next({ kind: 'tool-results', results: [{ id: turn.calls[0].id, name: 'cad_read_drawing', result: big }] }, signal()) }
      catch (error) { failure = error; break }
    }
    if (!enabled) {
      assert.equal(failure.code, 'KJMODEL_SIZE_LIMIT')
      assert.equal(failure.details.phase, 'request')
      assert.equal(failure.details.maxBytes, 2097152)
      assert.ok(failure.details.actualBytes > failure.details.maxBytes)
    } else { assert.equal(failure, undefined); assert.equal(turn.text, 'Done.'); assert.equal(requests, 22) }
    results.push({ requests, maxSentBytes })
  }
  assert.ok(results[1].maxSentBytes < 120000)
  assert.ok(results[0].maxSentBytes > 2000000)
})

test('size-limit phases and byte counts are safe and distinguish schema, request, response and streaming gates', async () => {
  const { session } = fixture(), privateText = 'PRIVATE_DIAGNOSTIC_TEXT'
  for (const [phase, options, tools, prompt] of [
    ['tool-schema', { maxHistoryBytes: 1 }, session.definitions, 'Read.'],
    ['request', { maxHistoryBytes: 100 }, [], privateText.repeat(20)],
    ['response', { maxResponseBytes: 100 }, [], 'Read.'],
    ['stream', { maxResponseBytes: 100, chatStreaming: true }, [], 'Read.'],
  ]) {
    let requests = 0
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-phase', ...options,
      request: async () => { requests++; const response = wire('chat-completions', null); response.privateText = privateText.repeat(20)
        return options.chatStreaming ? { async *[Symbol.asyncIterator]() { yield response } } : response } })
    await assert.rejects(async () => {
      await model.createConversation({ instructions: 'Inspect.', tools }).next({ kind: 'prompt', text: prompt }, signal())
    }, error => {
      assert.equal(error.code, 'KJMODEL_SIZE_LIMIT'); assert.equal(error.details.phase, phase)
      assert.ok(error.details.actualBytes > error.details.maxBytes)
      assert.deepEqual(Object.keys(error.details).sort(), ['actualBytes', 'maxBytes', 'phase'])
      assert.doesNotMatch(JSON.stringify(error.details) + error.message, /PRIVATE_DIAGNOSTIC_TEXT/)
      return true
    })
    assert.equal(requests, ['response', 'stream'].includes(phase) ? 1 : 0)
  }
})

test('runner exposes only validated size-limit diagnostics, never arbitrary error details', async () => {
  for (const details of [
    { phase: 'request', actualBytes: 200, maxBytes: 100, privateText: 'SECRET' },
    { phase: 'untrusted', actualBytes: 200, maxBytes: 100 },
    { phase: 'request', actualBytes: 'SECRET', maxBytes: 100 },
    { phase: 'request', actualBytes: 200, maxBytes: 0 },
    { phase: 'request', actualBytes: 100, maxBytes: 200 },
  ]) {
    const { session } = fixture()
    const model = { createConversation() { return { async next() { throw new KJModelError('KJMODEL_SIZE_LIMIT', 'Bounded failure.', details) } } } }
    const result = await runKJAgentTask({ session, model, prompt: 'Inspect.' })
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'KJMODEL_SIZE_LIMIT')
    if (details.privateText) assert.deepEqual(result.error.details, { phase: 'request', actualBytes: 200, maxBytes: 100 })
    else assert.equal(result.error.details, undefined)
    assert.doesNotMatch(JSON.stringify(result.error), /SECRET|untrusted/)
  }
})

test('read-reference option rejects nonboolean policy values', () => {
  for (const reuseReadResultReferences of [1, 'yes', {}, []]) assert.throws(() => createKJModelAdapter({
    protocol: 'chat-completions', model: 'offline-options', request: async () => wire('chat-completions', null), reuseReadResultReferences,
  }), /must be a boolean/)
})
