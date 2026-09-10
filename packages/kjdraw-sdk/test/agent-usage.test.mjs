import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJModelAdapter } from '../src/model-adapters.js'
import { extractKJModelUsage } from '../src/model-usage.js'
import { runKJAgentTask } from '../src/agent-runner.js'

const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  return { document, session: new KJAgentToolSession(sdk, document), prompt: 'Read the drawing and describe the missing dimensions.' }
}
function usage(protocol) {
  if (protocol === 'responses') return { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } } }
  if (protocol === 'chat-completions') return { usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 60 }, completion_tokens_details: { reasoning_tokens: 5 } } }
  if (protocol === 'anthropic-messages') return { usage: { input_tokens: 40, cache_read_input_tokens: 60, cache_creation_input_tokens: 0, output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } } }
  return { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 15, thoughtsTokenCount: 5, cachedContentTokenCount: 60, totalTokenCount: 120 } }
}
function response(protocol, read = false, includeUsage = true) {
  let body
  if (protocol === 'responses') body = { status: 'completed', output: read ? [{ type: 'function_call', call_id: 'read', name: 'cad_read_drawing', arguments: '{}' }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Please provide the missing dimensions.' }] }] }
  else if (protocol === 'chat-completions') body = { choices: [{ finish_reason: read ? 'tool_calls' : 'stop', message: { role: 'assistant', content: read ? null : 'Please provide the missing dimensions.', tool_calls: read ? [{ type: 'function', id: 'read', function: { name: 'cad_read_drawing', arguments: '{}' } }] : [] } }] }
  else if (protocol === 'anthropic-messages') body = { role: 'assistant', stop_reason: read ? 'tool_use' : 'end_turn', content: read ? [{ type: 'tool_use', id: 'read', name: 'cad_read_drawing', input: {} }] : [{ type: 'text', text: 'Please provide the missing dimensions.' }] }
  else body = { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: read ? [{ functionCall: { id: 'read', name: 'cad_read_drawing', args: {} } }] : [{ text: 'Please provide the missing dimensions.' }] } }] }
  return { ...body, ...(includeUsage ? usage(protocol) : {}), privateDiagnostic: 'PRIVATE_PROVIDER_PAYLOAD' }
}

for (const protocol of protocols) test(`${protocol}: two real adapter responses accumulate once and retain transport timing separately from CAD`, async () => {
  const options = fixture(), before = options.document.serialize(), observed = []
  const original = options.session.call.bind(options.session)
  options.session.call = async (...args) => { await pause(20); return original(...args) }
  let calls = 0
  const model = createKJModelAdapter({ protocol, model: 'offline-usage-fixture', onUsage: record => observed.push(record), request: async () => { await pause(5); return response(protocol, calls++ === 0) } })
  const result = await runKJAgentTask({ ...options, model, toolNames: ['cad_read_drawing'] })
  assert.equal(result.status, 'responded')
  assert.equal(observed.length, 2)
  assert.equal(result.measurements.turns.length, 2)
  assert.deepEqual(result.measurements.turns.map(row => row.status), ['reported', 'reported'])
  assert.deepEqual(result.measurements.totals, { inputTokens: 200, outputTokens: 40, totalTokens: 240, cacheReadInputTokens: 120, cacheMissInputTokens: null, cacheWriteInputTokens: ['responses', 'anthropic-messages'].includes(protocol) ? 0 : null, reasoningOutputTokens: 10 })
  assert.equal(result.measurements.complete, true)
  assert.ok(result.measurements.transportWallMs >= 0)
  assert.ok(result.measurements.runWallMs >= result.measurements.transportWallMs + 10)
  assert.equal(result.measurements.turns[0].usage.latencyScope, 'transport-wall')
  assert.ok(Object.isFrozen(result.measurements.turns[0].usage))
  assert.doesNotMatch(JSON.stringify(result.measurements), /PRIVATE_PROVIDER_PAYLOAD|missing dimensions/)
  assert.equal(options.document.serialize(), before)
})

test('received refused, truncated and oversized responses preserve accounting before protocol rejection', async () => {
  for (const [body, extra, code] of [
    [{ ...response('responses'), status: 'incomplete' }, {}, 'KJMODEL_INCOMPLETE'],
    [{ ...response('responses'), output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'private refusal' }] }] }, {}, 'KJMODEL_REFUSED'],
    [{ ...response('responses'), output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(2000) }] }] }, { maxResponseBytes: 500 }, 'KJMODEL_SIZE_LIMIT'],
  ]) {
    const options = fixture(), observed = []
    const model = createKJModelAdapter({ protocol: 'responses', model: 'offline-rejection', request: async () => body, onUsage: item => observed.push(item), ...extra })
    const result = await runKJAgentTask({ ...options, model })
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, code)
    assert.equal(observed.length, 1); assert.equal(result.measurements.totals.totalTokens, 120)
    assert.equal(result.measurements.complete, true)
    assert.equal(result.toolCalls, 0)
  }
})

test('missing and invalid usage do not become zero or a complete total, while unrelated valid counters remain available', async () => {
  let calls = 0
  const result = await runKJAgentTask({ ...fixture(), model: createKJModelAdapter({ protocol: 'responses', model: 'offline-missing', request: async () => response('responses', calls === 0, calls++ === 0) }) })
  assert.equal(result.status, 'responded'); assert.equal(result.measurements.totals.inputTokens, null)
  assert.equal(result.measurements.turns[0].usage.inputTokens, 100); assert.equal(result.measurements.turns[1].usage.inputTokens, null)
  assert.equal(result.measurements.complete, false); assert.ok(result.measurements.transportWallMs >= 0)
  const body = response('responses'); body.usage.total_tokens = 999
  const invalid = await runKJAgentTask({ ...fixture(), model: createKJModelAdapter({ protocol: 'responses', model: 'offline-invalid', request: async () => body }) })
  assert.equal(invalid.measurements.totals.inputTokens, 100); assert.equal(invalid.measurements.totals.totalTokens, null)
  assert.equal(invalid.measurements.complete, false)
})

test('synchronous and asynchronous observer exceptions do not change successful CAD proposal behavior', async () => {
  for (const onUsage of [() => { throw new Error('PRIVATE_OBSERVER_FAILURE') }, async () => { throw new Error('PRIVATE_ASYNC_FAILURE') }]) {
    const options = fixture(), before = options.document.serialize()
    const body = { ...usage('responses'), status: 'completed', output: [{ type: 'function_call', call_id: 'proposal', name: 'cad_propose_lines', arguments: JSON.stringify({ expectedRevision: 0, units: 'millimeter', lines: [{ start: { x: 0, y: 0 }, end: { x: 30, y: 0 } }] }) }] }
    const model = createKJModelAdapter({ protocol: 'responses', model: 'offline-observer', request: async () => body, onUsage })
    const result = await runKJAgentTask({ ...options, model })
    assert.equal(result.status, 'awaiting-approval'); assert.equal(result.measurements.totals.totalTokens, 120)
    assert.equal(options.document.serialize(), before)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/)
    await pause(0)
  }
  const adapter = createKJModelAdapter({ protocol: 'responses', model: 'offline-observer', request: async () => response('responses') })
  const turn = await adapter.createConversation({ instructions: 'Inspect.', tools: [], onUsage: () => { throw new Error('Ignore this observer') } }).next({ kind: 'prompt', text: 'Inspect.' }, new AbortController().signal)
  assert.equal(turn.usage.totalTokens, 120)
})

test('cancellation retains earlier received usage and reports an unknown pending response without later mutation', async () => {
  const options = fixture(), controller = new AbortController()
  const observed = []
  let count = 0, release, enter
  const entered = new Promise(resolve => { enter = resolve })
  const model = createKJModelAdapter({ protocol: 'responses', model: 'offline-cancel', onUsage: usage => observed.push(usage), request: async () => {
    if (count++ === 0) return response('responses', true)
    enter(); return new Promise(resolve => { release = resolve })
  } })
  const running = runKJAgentTask({ ...options, model, signal: controller.signal })
  await entered; controller.abort()
  const result = await running, before = JSON.stringify(result.measurements)
  assert.equal(result.status, 'cancelled'); assert.equal(result.measurements.complete, false)
  assert.equal(result.measurements.turns[0].usage.totalTokens, 120)
  assert.equal(result.measurements.turns[1].status, 'missing')
  assert.equal(result.measurements.totals.totalTokens, null); assert.equal(result.measurements.transportWallMs, null)
  assert.equal(observed.length, 1)
  release(response('responses')); await pause(5)
  assert.equal(observed.length, 2)
  assert.equal(observed[1].totalTokens, 120)
  assert.equal(JSON.stringify(result.measurements), before)
  const failed = await runKJAgentTask({ ...fixture(), model: createKJModelAdapter({ protocol: 'responses', model: 'offline-error', request: async () => { throw new Error('PRIVATE_TRANSPORT') } }) })
  assert.equal(failed.status, 'failed'); assert.equal(failed.measurements.turns[0].usage, null)
  assert.equal(failed.measurements.totals.totalTokens, null)
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_TRANSPORT/)
})

test('custom bridges can return usage, while malformed or duplicate observations cannot fabricate totals or change the run', async () => {
  const observed = extractKJModelUsage('responses', usage('responses'), { latencyMs: 2 })
  const result = await runKJAgentTask({ ...fixture(), model: { createConversation: () => ({ next: async () => ({ text: 'Specify dimensions.', calls: [], usage: observed }) }) } })
  assert.equal(result.measurements.totals.totalTokens, 120)
  let invoked = 0
  const malformed = { ...observed }
  Object.defineProperty(malformed, 'inputTokens', { get() { invoked++; throw new Error('Must not execute') } })
  const invalid = await runKJAgentTask({ ...fixture(), model: { createConversation: () => ({ next: async () => ({ text: 'Specify dimensions.', calls: [], usage: malformed }) }) } })
  assert.equal(invoked, 0); assert.equal(invalid.status, 'responded'); assert.equal(invalid.measurements.turns[0].status, 'invalid')
  assert.equal(invalid.measurements.totals.totalTokens, null)
  const duplicate = await runKJAgentTask({ ...fixture(), model: { createConversation: ({ onUsage }) => ({ next: async () => { onUsage(observed); onUsage(observed); return { text: 'Specify dimensions.', calls: [], usage: observed } } }) } })
  assert.equal(duplicate.status, 'responded'); assert.equal(duplicate.measurements.turns[0].status, 'multiple-observations')
  assert.equal(duplicate.measurements.totals.totalTokens, null)
})

test('DeepSeek cache split survives the real adapter and runner without inflating total input', async () => {
  for (const conflicting of [false, true]) {
    let calls = 0
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-deepseek-fixture', request: async () => ({ ...response('chat-completions', calls++ === 0, false), usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: conflicting ? 39 : 40 } }) })
    const result = await runKJAgentTask({ ...fixture(), model, toolNames: ['cad_read_drawing'] })
    assert.equal(result.status, 'responded')
    assert.equal(result.measurements.totals.inputTokens, 200)
    assert.equal(result.measurements.totals.totalTokens, 240)
    assert.equal(result.measurements.totals.cacheReadInputTokens, conflicting ? null : 120)
    assert.equal(result.measurements.totals.cacheMissInputTokens, conflicting ? null : 80)
    assert.equal(result.measurements.totals.cacheWriteInputTokens, null)
    assert.equal(result.measurements.complete, !conflicting)
    if (conflicting) assert.ok(result.measurements.turns[0].usage.invalidFields.includes('usage.prompt_cache_miss_tokens'))
  }
})
