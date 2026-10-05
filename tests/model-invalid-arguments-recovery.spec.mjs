import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJModelAdapter } from '../packages/kjdraw-sdk/src/model-adapters.js'
import { runKJAgentTask } from '../packages/kjdraw-sdk/src/agent-runner.js'
import { inspectGeologyModelToolCalls, geologyModelResponseDiagnostic } from '../scripts/testing/helpers/geology-model-output-diagnostics.mjs'

// Exact returned bytes from PUBLIC synthetic v5 Qwen calls. These offline
// fixtures never make a provider request or establish an actual HTTP status.
const publicMalformed = [
  ['clear-initial missing outer brace', '{"drawingId": "geo-7f6d0843312be117", "expectedRevision": 3, "units": "millimeter", "updates": [{"holeId": "TEST-A", "clearFields": ["initialWaterDepth"]}]', 155,
    '2ef3131b8f3e36140060edfe2c4bd4ad8d8021da127caf1208eb5475dc0b5854'],
  ['clear-stable missing outer brace', '{"drawingId": "geo-7f6d0843312be117", "expectedRevision": 3, "units": "millimeter", "updates": [{"holeId": "TEST-A", "clearFields": ["stableWaterDepth"]}]', 154,
    '23a6571ffc955a890ab8abf9d3d65cbe32e704559e5d69f28b82329d8606e088'],
  ['collar-elevation missing outer brace', '{"drawingId": "geo-7f6d0843312be117", "expectedRevision": 3, "units": "millimeter", "updates": [{"holeId": "TEST-A", "collarElevation": 107}]', 141,
    'ac385bb9bef176a38357f588d55aad2ba5f299b246031c55a983ca1e072bcb6f'],
  ['clear-initial extra brace and prose', '{"drawingId": "geo-7f6d0843312be117", "expectedRevision": 3, "units": "millimeter", "updates": [{"holeId": "TEST-A", "clearFields": ["initialWaterDepth"]}]}}\n\nThe result will be:\n- TEST-A\'s initial water depth record completely removed (becomes unknown/undefined)\n- Stable water depth remains unchanged at 4 meters\n- All other borehole data (collar elevation, depth, strata, observations) remains exactly as before\n- The drawing will be updated to reflect that initial water depth is no longer recorded for TEST-A\n\nThis is the precise action requested - removing the initial water depth record to indicate it\'s unknown, while preserving the stable water depth value.', 666,
    'a639e612c122b5232d866ca7314f60cf83683a4f1a34e4c88c1b40de95dbbaa3'],
  ['shorten-depth wrong nesting', '{"drawingId": "geo-7f6d0843312be117", "expectedRevision": 3, "units": "millimeter", "updates": [{"holeId": "TEST-A", "depth": 15, "strata": [{"bottom": 3, "code": "1", "intervalId": "I-FILL", "lithology": "fill", "name": "填土", "top": 0}, {"bottom": 10, "code": "2", "intervalId": "I-CLAY", "lithology": "clay", "name": "黏土", "top": 3}, {"bottom": 15, "code": "3", "intervalId": "I-SAND", "lithology": "sand", "name": "砂土", "top": 10}], "observations": [{"depth": 5, "id": "S-A", "kind": "sample"}, {"depth": 12, "id": "N-A", "kind": "spt", "value": 15}]}}]}', 569,
    '0278f9be7293c11864ffd164ee68f0441deda33efff51db55969dae1cc2610db'],
]
const signal = () => new AbortController().signal
const rawCall = (id, name, raw) => ({ id, type: 'function', function: { name, arguments: raw } })
const usage = { prompt_tokens: 17, completion_tokens: 3, total_tokens: 20 }
const wire = (tool_calls = [], content = null, extra = {}) => ({ choices: [{ finish_reason: tool_calls.length ? 'tool_calls' : 'stop',
  message: { role: 'assistant', content, ...(tool_calls.length ? { tool_calls } : {}), ...extra } }], usage })
function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  return { sdk, document, session: new KJAgentToolSession(sdk, document), dispose: () => sdk.closeDocument(document.id) }
}
function assertChatPairs(body) {
  const calls = [], results = []
  for (const message of body.messages) {
    if (message.role === 'assistant' && Object.hasOwn(message, 'tool_calls')) {
      assert.ok(Array.isArray(message.tool_calls) && message.tool_calls.length)
      for (const call of message.tool_calls) {
        const args = JSON.parse(call.function.arguments)
        assert.ok(args && typeof args === 'object' && !Array.isArray(args))
        calls.push(call.id)
      }
    }
    if (message.role === 'tool') results.push(message.tool_call_id)
  }
  assert.deepEqual(calls, results, 'Every retained valid historical call has exactly one corresponding tool result in original order')
}

for (const [label, raw, bytes, sha256] of publicMalformed) test(`offline actual Qwen raw bytes: ${label} remain rejected; regenerated calls use clean paired wire`, async () => {
  assert.equal(Buffer.byteLength(raw), bytes)
  assert.equal(createHash('sha256').update(raw).digest('hex'), sha256)
  assert.throws(() => JSON.parse(raw))
  const f = fixture(), before = f.document.serialize(), requests = [], original = wire([rawCall('bad-public-call', 'cad_propose_geology_revision', raw)])
  const originalCopy = structuredClone(original)
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-public-fixture', request: async ({ body }) => {
      requests.push(body)
      if (requests.length === 1) return original
      assertChatPairs(body)
      assert.equal(body.messages.some(item => item.tool_call_id === 'bad-public-call' || item.tool_calls?.some(call => call.id === 'bad-public-call')), false)
      assert.equal(JSON.stringify(body).includes(raw), false)
      if (requests.length === 2) {
        const correction = JSON.parse(body.messages.at(-1).content)
        assert.equal(body.messages.at(-1).role, 'user')
        assert.equal(correction.ok, false); assert.equal(correction.error.code, 'KJDOCUMENT_INVALID')
        assert.deepEqual(correction.rejectedCalls, [{ id: 'bad-public-call', name: 'cad_propose_geology_revision', errorCode: 'KJDOCUMENT_INVALID' }])
        return wire([rawCall('new-model-read', 'cad_read_drawing', '{}')])
      }
      assert.equal(JSON.parse(body.messages.at(-1).content).ok, true)
      return wire([], 'Public synthetic data reviewed without edits.')
    } })
    const result = await runKJAgentTask({ session: f.session, model, prompt: 'Read the public synthetic drawing.',
      toolNames: ['cad_propose_geology_revision', 'cad_read_drawing'] })
    assert.equal(result.status, 'responded'); assert.equal(requests.length, 3)
    assert.equal(result.repairAttempts, 1); assert.equal(result.failedToolCalls, 1)
    assert.equal(result.outputs[0].result.ok, false); assert.equal(result.outputs[1].result.ok, true)
    assert.equal(result.measurements.totals.totalTokens, 60); assert.equal(result.measurements.complete, true)
    assert.deepEqual(original, originalCopy, 'The returned model response is never rewritten')
    const captured = geologyModelResponseDiagnostic({ toolCalls: original.choices[0].message.tool_calls,
      model: 'offline-public-fixture', finishReason: 'tool_calls', content: null }, { scenarioId: 'public-byte-fixture', request: 1, evidenceOrigin: 'fixture-oracle-selftest' })
    assert.equal(captured.assistant.tool_calls[0].function.arguments, raw)
    assert.equal(inspectGeologyModelToolCalls(captured.assistant.tool_calls).issues[0].code, 'MODEL_TOOL_ARGUMENTS_INVALID_JSON')
    assert.equal(f.document.serialize(), before)
  } finally { f.dispose() }
})

for (const raw of ['null', '[]', '[{}]', '0', 'true', '"text"']) test(`chat JSON ${raw}: never coerced to a legal CAD parameter object`, async () => {
  const f = fixture(), before = f.document.serialize(), requests = []
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-nonobject', request: async ({ body }) => {
      requests.push(body)
      if (requests.length === 1) return wire([rawCall('bad', 'cad_read_drawing', raw)])
      assertChatPairs(body)
      assert.equal(body.messages.some(item => item.tool_calls || item.tool_call_id), false)
      assert.equal(JSON.parse(body.messages.at(-1).content).ok, false)
      return wire([], 'Parameters must be regenerated.')
    } })
    const conversation = model.createConversation({ instructions: 'Do not modify data.', tools: f.session.definitions })
    const turn = await conversation.next({ kind: 'prompt', text: 'Inspect only.' }, signal())
    assert.deepEqual(turn.calls[0].arguments, JSON.parse(raw))
    const result = await f.session.call(turn.calls[0].name, turn.calls[0].arguments)
    assert.equal(result.ok, false); assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
    await conversation.next({ kind: 'tool-results', results: [{ id: 'bad', name: 'cad_read_drawing', result }] }, signal())
    assert.equal(requests.length, 2); assert.equal(f.document.serialize(), before)
  } finally { f.dispose() }
})

test('mixed valid read + invalid call retains the exact valid ID/result, provider fields and real receipt while dropping only invalid pairs', async () => {
  const f = fixture(), before = f.document.serialize(), requests = []
  const first = wire([rawCall('read-good', 'cad_read_drawing', '{ }'), rawCall('read-bad', 'cad_read_history', '{broken')], 'Actual model text.',
    { reasoning_content: 'opaque-public-reasoning', provider_extension: { signature: 'original-provider-field' } })
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-mixed', request: async ({ body }) => {
      requests.push(body)
      if (requests.length === 1) return first
      assertChatPairs(body)
      const assistant = body.messages.find(message => message.role === 'assistant')
      assert.deepEqual(assistant.tool_calls, [first.choices[0].message.tool_calls[0]])
      assert.equal(assistant.content, 'Actual model text.')
      assert.equal(assistant.reasoning_content, first.choices[0].message.reasoning_content)
      assert.deepEqual(assistant.provider_extension, first.choices[0].message.provider_extension)
      const receipt = body.messages.find(message => message.role === 'tool')
      assert.equal(receipt.tool_call_id, 'read-good'); assert.equal(JSON.parse(receipt.content).value.documentId, f.document.id)
      assert.equal(body.messages.some(message => message.tool_call_id === 'read-bad'), false)
      assert.equal(JSON.parse(body.messages.at(-1).content).rejectedCalls[0].id, 'read-bad')
      return wire([], 'Read only.')
    } })
    const result = await runKJAgentTask({ session: f.session, model, prompt: 'Inspect only.' })
    assert.equal(result.status, 'responded'); assert.equal(result.toolCalls, 2); assert.equal(result.failedToolCalls, 1)
    assert.equal(requests.length, 2); assert.equal(result.measurements.totals.totalTokens, 40)
    assert.equal(f.document.serialize(), before); assert.equal(first.choices[0].message.tool_calls.length, 2)
  } finally { f.dispose() }
})

test('an invalid-only assistant with real text retains that text/provider metadata without empty tool_calls', async () => {
  const f = fixture(), requests = []
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-text', request: async ({ body }) => {
      requests.push(body)
      if (requests.length === 1) return wire([rawCall('bad', 'cad_read_drawing', '{broken')], 'Actual explanatory text.', { reasoning_content: 'original' })
      const assistant = body.messages.find(message => message.role === 'assistant')
      assert.equal(assistant.content, 'Actual explanatory text.'); assert.equal(assistant.reasoning_content, 'original')
      assert.equal(Object.hasOwn(assistant, 'tool_calls'), false)
      return wire([], 'No edits.')
    } })
    assert.equal((await runKJAgentTask({ session: f.session, model, prompt: 'Inspect.' })).status, 'responded')
    assert.equal(requests.length, 2)
  } finally { f.dispose() }
})

test('a valid JSON object with a native schema error remains an actual call/result pair; arguments are never normalized or operation-selected', async () => {
  const f = fixture(), requests = [], raw = '{ "expectedRevision": 999 }'
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-valid-object', request: async ({ body }) => {
      requests.push(body)
      if (requests.length === 1) return wire([rawCall('bad-schema', 'cad_read_history', raw)])
      assertChatPairs(body)
      assert.equal(body.messages.at(-2).tool_calls[0].function.arguments, raw)
      assert.equal(body.messages.at(-1).role, 'tool'); assert.equal(body.messages.at(-1).tool_call_id, 'bad-schema')
      assert.equal(JSON.parse(body.messages.at(-1).content).ok, false)
      assert.equal(body.messages.some(message => message.role === 'user' && message.content.includes('rejectedCalls')), false)
      return wire([], 'Revision must be current.')
    } })
    assert.equal((await runKJAgentTask({ session: f.session, model, prompt: 'Inspect.' })).status, 'responded')
    assert.equal(requests.length, 2)
  } finally { f.dispose() }
})

test('mixed successful proposal + invalid arguments remains incomplete: no extra model request, no approval or drawing mutation', async () => {
  for (const invalidFirst of [false, true]) {
    const f = fixture(), before = f.document.serialize()
    let requests = 0
    try {
      const valid = rawCall('proposal-good', 'cad_propose_circles', JSON.stringify({ expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 2, y: 3 }, radius: 4 }] }))
      const invalid = rawCall('proposal-bad', 'cad_propose_circles', '{broken')
      const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-proposal-batch', request: async () => {
        requests++; return wire(invalidFirst ? [invalid, valid] : [valid, invalid])
      } })
      const result = await runKJAgentTask({ session: f.session, model, prompt: 'Prepare circles for review.' })
      assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'KJAGENT_INCOMPLETE_BATCH')
      assert.equal(requests, 1); assert.deepEqual(result.proposalIds, [])
      const proposed = result.outputs.find(output => output.result.ok && output.result.value.status === 'awaiting-host-approval')
      assert.ok(proposed)
      const rejectedApproval = await f.session.approve(proposed.result.value.planId, 'fixture-explicit-host-review')
      assert.equal(rejectedApproval.ok, false, 'Existing runner rejected every incomplete-batch plan')
      assert.match(rejectedApproval.error.message, /unavailable/)
      assert.equal(f.document.serialize(), before)
    } finally { f.dispose() }
  }
})

test('a legal proposal alone stops for host review; wire recovery never makes extra requests or commits it', async () => {
  const f = fixture(), before = f.document.serialize()
  let requests = 0
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-proposal', request: async () => {
      requests++; return wire([rawCall('proposal', 'cad_propose_circles', JSON.stringify({ expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 2, y: 3 }, radius: 4 }] }))])
    } })
    const result = await runKJAgentTask({ session: f.session, model, prompt: 'Prepare circles for review.' })
    assert.equal(result.status, 'awaiting-approval'); assert.equal(requests, 1); assert.equal(result.proposalIds.length, 1)
    assert.equal(f.document.serialize(), before); assert.equal(f.session.reject(result.proposalIds[0], 'fixture-host').ok, true)
  } finally { f.dispose() }
})

test('standalone conversation permits at most two real malformed-argument wire recoveries and sends no hidden fourth request', async () => {
  const f = fixture(), requests = [], observations = []
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-bounded', onUsage: value => observations.push(value), request: async ({ body }) => {
      requests.push(body); assertChatPairs(body)
      return wire([rawCall('bad-' + requests.length, 'cad_read_drawing', '{broken')])
    } })
    const conversation = model.createConversation({ instructions: 'Inspect only.', tools: f.session.definitions })
    let turn = await conversation.next({ kind: 'prompt', text: 'Inspect.' }, signal())
    for (let index = 0; index < 2; index++) {
      const call = turn.calls[0], result = await f.session.call(call.name, call.arguments)
      turn = await conversation.next({ kind: 'tool-results', results: [{ id: call.id, name: call.name, result }] }, signal())
    }
    const call = turn.calls[0], result = await f.session.call(call.name, call.arguments)
    await assert.rejects(conversation.next({ kind: 'tool-results', results: [{ id: call.id, name: call.name, result }] }, signal()),
      error => error.code === 'KJMODEL_PROTOCOL' && /recovery budget exhausted/.test(error.message))
    assert.equal(requests.length, 3); assert.equal(observations.length, 3)
    assert.equal(observations.reduce((sum, item) => sum + item.totalTokens, 0), 60)
    assert.equal(requests[2].messages.filter(message => message.role === 'user' && message.content.includes('rejectedCalls')).length, 2)
    await assert.rejects(conversation.next({ kind: 'prompt', text: 'Replay.' }, signal()), /has ended/)
    assert.equal(requests.length, 3)
  } finally { f.dispose() }
})

test('agent repair/turn/tool budgets remain authoritative and usage counts all attempted real fixture responses', async () => {
  for (const options of [{ maxRepairAttempts: 0 }, { maxTurns: 1 }, { maxToolCalls: 1 }, {}]) {
    const f = fixture(), before = f.document.serialize()
    let requests = 0
    try {
      const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-agent-budget', request: async () => {
        requests++; return wire([rawCall('bad-' + requests, 'cad_read_drawing', '{broken')])
      } })
      const result = await runKJAgentTask({ session: f.session, model, prompt: 'Inspect.', ...options })
      assert.equal(result.status, 'limit-reached')
      // The existing runner checks a returned batch against maxToolCalls after
      // the model responds. That second attempted response is fully counted,
      // but no second CAD call is dispatched. Repair/turn limits stop earlier.
      const expected = options.maxToolCalls ? 2 : Object.keys(options).length ? 1 : 3
      assert.equal(requests, expected); assert.equal(result.measurements.totals.totalTokens, expected * 20)
      if (options.maxToolCalls) assert.equal(result.toolCalls, 1)
      assert.equal(result.measurements.complete, true); assert.equal(f.document.serialize(), before)
    } finally { f.dispose() }
  }
})

test('removing invalid wire history does not reset agent call-ID replay protection', async () => {
  const f = fixture(), before = f.document.serialize()
  let requests = 0
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-replay', request: async () => {
      requests++; return wire([rawCall('same-call-id', 'cad_read_drawing', requests === 1 ? '{broken' : '{}')])
    } })
    const result = await runKJAgentTask({ session: f.session, model, prompt: 'Inspect.' })
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'KJMODEL_CALL_ID')
    assert.equal(requests, 2); assert.equal(result.toolCalls, 1); assert.equal(f.document.serialize(), before)
  } finally { f.dispose() }
})

test('recovery requires real failed receipts and exact original result IDs/names/order; mismatches never send another request', async () => {
  for (const corrupt of [
    results => { results[0].id = 'other' },
    results => { results[0].name = 'cad_read_history' },
    results => { results.reverse() },
    results => { results.pop() },
    results => { results[0].result = { ok: true, value: {} } },
  ]) {
    const f = fixture()
    let requests = 0
    try {
      const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-invalid-pair', request: async () => {
        requests++; return wire([rawCall('a', 'cad_read_drawing', '{broken'), rawCall('b', 'cad_read_history', 'null')])
      } })
      const conversation = model.createConversation({ instructions: 'Inspect.', tools: f.session.definitions })
      const turn = await conversation.next({ kind: 'prompt', text: 'Inspect.' }, signal())
      const results = []
      for (const call of turn.calls) results.push({ id: call.id, name: call.name, result: await f.session.call(call.name, call.arguments) })
      corrupt(results)
      await assert.rejects(conversation.next({ kind: 'tool-results', results }, signal()), { code: 'KJMODEL_PROTOCOL' })
      assert.equal(requests, 1)
    } finally { f.dispose() }
  }
})

test('ordinary correction omits oversized/private-looking error messages and bounds copied codes without including malformed raw text', async () => {
  const f = fixture(), requests = [], sentinel = 'synthetic-private-error-message-never-for-wire'
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-bounded-error', request: async ({ body }) => {
      requests.push(body)
      if (requests.length === 1) return wire([rawCall('bad', 'cad_read_drawing', '{broken')])
      const correction = body.messages.at(-1).content
      assert.equal(correction.includes(sentinel), false); assert.equal(correction.includes('{broken'), false)
      assert.ok(correction.length < 1500)
      assert.equal(JSON.parse(correction).rejectedCalls[0].errorCode.length, 128)
      return wire([], 'No changes.')
    } })
    const conversation = model.createConversation({ instructions: 'Inspect.', tools: f.session.definitions })
    await conversation.next({ kind: 'prompt', text: 'Inspect.' }, signal())
    await conversation.next({ kind: 'tool-results', results: [{ id: 'bad', name: 'cad_read_drawing',
      result: { ok: false, error: { code: 'KJ' + 'A'.repeat(1000), message: sentinel.repeat(10000) } } }] }, signal())
    assert.equal(requests.length, 2)
  } finally { f.dispose() }
})

test('streamed Chat malformed arguments receive the same bounded cleanup after complete assembly, not during partial fragments', async () => {
  const f = fixture(), requests = []
  const stream = chunks => (async function* () { yield* chunks })()
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-stream', chatStreaming: true, request: async ({ body }) => {
      requests.push(body)
      if (requests.length === 1) return stream([
        { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'bad', type: 'function', function: { name: 'cad_read_drawing', arguments: '{' } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'broken' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage },
      ])
      assertChatPairs(body)
      assert.equal(body.messages.some(message => message.tool_call_id === 'bad' || message.tool_calls), false)
      return stream([{ choices: [{ index: 0, delta: { role: 'assistant', content: 'No edits.' }, finish_reason: 'stop' }] }, { choices: [], usage }])
    } })
    const result = await runKJAgentTask({ session: f.session, model, prompt: 'Inspect.' })
    assert.equal(result.status, 'responded'); assert.equal(requests.length, 2)
    assert.equal(result.measurements.totals.totalTokens, 40)
  } finally { f.dispose() }
})

for (const protocol of ['responses', 'anthropic-messages', 'gemini-generate-content']) test(`${protocol}: unrelated native wire/signature semantics stay unchanged after a real null-argument rejection`, async () => {
  const f = fixture(), requests = []
  let original
  try {
    const model = createKJModelAdapter({ protocol, model: 'offline-compatible', request: async ({ body }) => {
      requests.push(body)
      if (requests.length === 1) {
        if (protocol === 'responses') return original = { status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'signed' },
          { type: 'function_call', id: 'item-bad', call_id: 'bad', name: 'cad_read_drawing', arguments: 'null' }] }
        if (protocol === 'anthropic-messages') return original = { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'reasoning', signature: 'signed' },
          { type: 'tool_use', id: 'bad', name: 'cad_read_drawing', input: null }] }
        return original = { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'reasoning', thought: true, thoughtSignature: 'signed' },
          { functionCall: { id: 'bad', name: 'cad_read_drawing', args: null } }] } }] }
      }
      if (protocol === 'responses') {
        assert.equal(body.input[1].encrypted_content, 'signed'); assert.equal(body.input[2].arguments, 'null')
        assert.equal(body.input.at(-1).call_id, 'bad'); assert.equal(JSON.parse(body.input.at(-1).output).ok, false)
        return { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'No edits.' }] }] }
      }
      if (protocol === 'anthropic-messages') {
        assert.equal(body.messages[1].content[0].signature, 'signed'); assert.equal(body.messages[1].content[1].input, null)
        assert.equal(body.messages.at(-1).content[0].tool_use_id, 'bad'); assert.equal(body.messages.at(-1).content[0].is_error, true)
        return { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'No edits.' }] }
      }
      assert.equal(body.contents[1].parts[0].thoughtSignature, 'signed'); assert.equal(body.contents[1].parts[1].functionCall.args, null)
      assert.equal(body.contents.at(-1).parts[0].functionResponse.id, 'bad'); assert.equal(body.contents.at(-1).parts[0].functionResponse.response.ok, false)
      return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'No edits.' }] } }] }
    } })
    const before = f.document.serialize(), conversation = model.createConversation({ instructions: 'Inspect only.', tools: f.session.definitions })
    const turn = await conversation.next({ kind: 'prompt', text: 'Inspect.' }, signal())
    const rawTurn = JSON.stringify(original)
    assert.equal(turn.calls[0].arguments, null, 'No adapter coerces explicit null to a valid CAD argument object')
    const result = await f.session.call('cad_read_drawing', turn.calls[0].arguments)
    assert.equal(result.ok, false)
    await conversation.next({ kind: 'tool-results', results: [{ id: 'bad', name: 'cad_read_drawing', result }] }, signal())
    assert.equal(requests.length, 2); assert.equal(f.document.serialize(), before)
    assert.equal(JSON.stringify(original), rawTurn, 'Original returned provider bytes remain available unchanged to trusted host diagnostics')
  } finally { f.dispose() }
})

test('Gemini omitted args remain compatible with an actual successful no-argument CAD read; explicit null remains distinct', async () => {
  const f = fixture()
  try {
    const model = createKJModelAdapter({ protocol: 'gemini-generate-content', model: 'offline-gemini-omitted', request: async () => ({
      candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { id: 'read', name: 'cad_read_drawing' } }] } }],
    }) })
    const conversation = model.createConversation({ instructions: 'Inspect.', tools: f.session.definitions })
    const turn = await conversation.next({ kind: 'prompt', text: 'Inspect.' }, signal())
    assert.deepEqual(turn.calls[0].arguments, {})
    const result = await f.session.call(turn.calls[0].name, turn.calls[0].arguments)
    assert.equal(result.ok, true); assert.equal(result.value.documentId, f.document.id)
  } finally { f.dispose() }
})

test('a malformed proposal followed by newly generated valid parameters creates only a real host-review plan, never an automatic edit', async () => {
  const f = fixture(), before = f.document.serialize()
  let requests = 0
  try {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-regenerated-proposal', request: async ({ body }) => {
      requests++
      if (requests === 1) return wire([rawCall('bad-proposal', 'cad_propose_circles', '{broken')])
      assertChatPairs(body)
      return wire([rawCall('new-proposal', 'cad_propose_circles', JSON.stringify({ expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 2, y: 3 }, radius: 4 }] }))])
    } })
    const result = await runKJAgentTask({ session: f.session, model, prompt: 'Prepare one circle at (2,3), radius 4 mm for review.' })
    assert.equal(result.status, 'awaiting-approval'); assert.equal(requests, 2)
    assert.equal(result.failedToolCalls, 1); assert.equal(result.proposalIds.length, 1)
    assert.equal(result.outputs[0].result.ok, false); assert.equal(f.document.serialize(), before)
    const approved = await f.session.approve(result.proposalIds[0], 'fixture-explicit-host-review')
    assert.equal(approved.ok, true); assert.equal(f.document.revision, 1)
    const circle = f.document.listEntities()[0]
    assert.equal(circle.type, 'CIRCLE'); assert.deepEqual(circle.payload.center, [2, 3, 0]); assert.equal(circle.payload.radius, 4)
    assert.equal(requests, 2, 'Host approval is not another model request')
  } finally { f.dispose() }
})
