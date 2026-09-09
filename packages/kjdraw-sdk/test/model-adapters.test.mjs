import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKJModelAdapter } from '../src/model-adapters.js'
import { runKJAgentTask } from '../src/agent-runner.js'
import { mountingProfile } from '../examples/fixtures/mounting-profile.mjs'

const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const args = { expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 20, y: 25 }, radius: 3 }] }
const call = (id, name, arguments_ = {}) => ({ id, name, arguments: arguments_ })
function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'model-conformance', units: 'millimeter' })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
function wire(protocol, calls = [], text = '') {
  if (protocol === 'responses') return { status: 'completed', output: [
    { type: 'reasoning', id: 'reasoning-item', encrypted_content: 'opaque-signed-reasoning' },
    ...calls.map(c => ({ type: 'function_call', id: `item-${c.id}`, call_id: c.id, name: c.name, arguments: JSON.stringify(c.arguments) })),
    ...(text ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] : []),
  ] }
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: text || null, reasoning_content: 'opaque-provider-reasoning', tool_calls: calls.map(c => ({ type: 'function', id: c.id, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: calls.length ? 'tool_use' : 'end_turn', content: [{ type: 'thinking', thinking: 'provider-thinking', signature: 'opaque-signature' }, ...calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments })), ...(text ? [{ type: 'text', text }] : [])] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'provider-thinking', thought: true, thoughtSignature: 'opaque-thought-signature' }, ...calls.map(c => ({ functionCall: { id: c.id, name: c.name, args: c.arguments } })), ...(text ? [{ text }] : [])] } }] }
}
function resultAtEnd(protocol, body) {
  if (protocol === 'responses') return JSON.parse(body.input.at(-1).output)
  if (protocol === 'chat-completions') return JSON.parse(body.messages.at(-1).content)
  if (protocol === 'anthropic-messages') return JSON.parse(body.messages.at(-1).content[0].content)
  return body.contents.at(-1).parts[0].functionResponse.response
}
function assertContinuation(protocol, body) {
  if (protocol === 'responses') {
    assert.ok(body.input.some(item => item.encrypted_content === 'opaque-signed-reasoning'))
    assert.equal(body.input.at(-1).call_id, 'read')
    assert.equal(body.store, false)
    assert.deepEqual(body.include, ['reasoning.encrypted_content'])
  } else if (protocol === 'chat-completions') {
    assert.equal(body.messages.at(-2).reasoning_content, 'opaque-provider-reasoning')
    assert.equal(body.messages.at(-1).tool_call_id, 'read')
  } else if (protocol === 'anthropic-messages') {
    assert.equal(body.messages.at(-2).content[0].signature, 'opaque-signature')
    assert.equal(body.messages.at(-1).content[0].tool_use_id, 'read')
    assert.equal(body.messages.at(-1).content[0].is_error, false)
  } else {
    assert.equal(body.contents.at(-2).parts[0].thoughtSignature, 'opaque-thought-signature')
    assert.equal(body.contents.at(-1).parts[0].functionResponse.id, 'read')
    assert.equal(body.model, undefined)
  }
}

for (const protocol of protocols) {
  test(`${protocol}: mixed drawing schema and proposal use the same core`, async () => {
    const { document, session } = fixture()
    const model = createKJModelAdapter({ protocol, model: 'offline-profile-fixture', request: async ({ body }) => {
      const definitions = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
      const definition = definitions.find(tool => (tool.function?.name ?? tool.name) === 'cad_propose_drawing')
      const schema = definition.function?.parameters ?? definition.parameters ?? definition.input_schema ?? definition.parametersJsonSchema
      assert.equal(schema.properties.polylines.items.properties.closed.type, 'boolean')
      assert.equal(schema.properties.arcs.minItems, 0)
      return wire(protocol, [call('profile', 'cad_propose_drawing', mountingProfile())])
    } })
    const result = await runKJAgentTask({ session, model, prompt: 'Draw the specified mounting profile for review.' })
    assert.equal(result.status, 'awaiting-approval', JSON.stringify(result))
    assert.equal(document.revision, 0)
    assert.equal(result.outputs[0].result.value.preview.after.length, 9)
    assert.equal((await session.approve(result.proposalIds[0], 'host-reviewer')).ok, true)
    assert.equal(document.listEntities().length, 9)
    assert.equal(document.revision, 1)
  })

  test(`${protocol}: read, repair a unit error, propose, host approve, save/reopen and undo`, async () => {
    const { sdk, document, session } = fixture()
    let requests = 0
    const model = createKJModelAdapter({ protocol, model: `host-selected-${protocol}`, request: async request => {
      assert.equal(request.protocol, protocol)
      assert.equal(request.model, `host-selected-${protocol}`)
      assert.ok(request.signal instanceof AbortSignal)
      assert.ok(Object.isFrozen(request.body))
      const body = request.body
      if (requests++ === 0) {
        const defs = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
        assert.equal(defs.length, 7)
        assert.ok(!JSON.stringify(defs).includes('execute_anything'))
        return wire(protocol, [call('read', 'cad_read_drawing')])
      }
      if (requests === 2) {
        assertContinuation(protocol, body)
        assert.equal(resultAtEnd(protocol, body).value.units, 'millimeter')
        return wire(protocol, [call('bad-units', 'cad_propose_circles', { ...args, units: 'meter' })])
      }
      assert.equal(resultAtEnd(protocol, body).ok, false)
      if (protocol === 'anthropic-messages') assert.equal(body.messages.at(-1).content[0].is_error, true)
      return wire(protocol, [call('corrected', 'cad_propose_circles', args)], 'Please review this circle.')
    } })
    const result = await runKJAgentTask({ session, model, prompt: 'Create the specified circle after checking the units.' })
    assert.equal(result.status, 'awaiting-approval', JSON.stringify(result))
    assert.equal(result.turns, 3)
    assert.equal(result.toolCalls, 3)
    assert.equal(requests, 3, 'no further model request after a proposal')
    assert.equal(document.revision, 0, 'model does not mutate the drawing')
    assert.equal(document.listEntities().length, 0)
    assert.equal((await session.approve(result.proposalIds[0], 'authenticated-host-user')).ok, true)
    assert.equal(document.listEntities()[0].payload.radius, 3)
    const saved = await sdk.writeDocument(document, { format: 'KJD' })
    const reopened = await createKJDrawSDK().readDocument(saved, { format: 'KJD' })
    assert.deepEqual(reopened.listEntities()[0].payload.center, [20, 25, 0])
    assert.equal((await session.approve(result.proposalIds[0], 'authenticated-host-user')).ok, false)
    await sdk.executeCommand('UNDO')
    assert.equal(document.listEntities().length, 0)
  })

  test(`${protocol}: truncated output cannot dispatch even a syntactically valid proposal`, async () => {
    const { session, document } = fixture()
    const response = wire(protocol, [call('unsafe', 'cad_propose_circles', args)])
    if (protocol === 'responses') response.status = 'incomplete'
    else if (protocol === 'chat-completions') response.choices[0].finish_reason = 'length'
    else if (protocol === 'anthropic-messages') response.stop_reason = 'max_tokens'
    else response.candidates[0].finishReason = 'MAX_TOKENS'
    const model = createKJModelAdapter({ protocol, model: 'fixture', request: async () => response })
    const result = await runKJAgentTask({ session, model, prompt: 'draw' })
    assert.equal(result.status, 'failed')
    assert.equal(result.error.code, 'KJMODEL_INCOMPLETE')
    assert.equal(result.toolCalls, 0)
    assert.equal(document.revision, 0)
    assert.deepEqual(result.proposalIds, [])
  })
}

test('malformed JSON arguments become tool errors and can be corrected without evaluating code', async () => {
  const { session } = fixture()
  let step = 0
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'fixture', request: async ({ body }) => {
    if (step++ === 0) {
      const response = wire('chat-completions', [call('bad', 'cad_read_drawing')])
      response.choices[0].message.tool_calls[0].function.arguments = 'not valid JSON'
      return response
    }
    assert.equal(resultAtEnd('chat-completions', body).ok, false)
    return wire('chat-completions', [], 'Please clarify the dimensions.')
  } })
  const result = await runKJAgentTask({ session, model, prompt: 'draw' })
  assert.equal(result.status, 'responded')
  assert.equal(result.text, 'Please clarify the dimensions.')
})

test('Gemini without provider call IDs uses local correlation but does not invent IDs on the wire', async () => {
  let step = 0
  const model = createKJModelAdapter({ protocol: 'gemini-generate-content', model: 'fixture', request: async ({ body }) => {
    if (step++ === 0) {
      const response = wire('gemini-generate-content', [call('remove-id', 'cad_read_drawing')])
      delete response.candidates[0].content.parts[1].functionCall.id
      return response
    }
    assert.equal(body.contents.at(-1).parts[0].functionResponse.id, undefined)
    return wire('gemini-generate-content', [], 'Read complete.')
  } })
  assert.equal((await runKJAgentTask({ session: fixture().session, model, prompt: 'inspect' })).status, 'responded')
})

test('conversation enforces call/result correlation, request limits and explicit model configuration', async () => {
  const session = fixture().session
  assert.throws(() => createKJModelAdapter({ protocol: 'unknown', model: 'x', request: async () => ({}) }))
  assert.throws(() => createKJModelAdapter({ protocol: 'responses', model: '', request: async () => ({}) }))
  assert.throws(() => createKJModelAdapter({ protocol: 'responses', model: 'x', maxOutputTokens: 0, request: async () => ({}) }))
  const model = createKJModelAdapter({ protocol: 'responses', model: 'fixture', request: async () => wire('responses', [call('read', 'cad_read_drawing')]) })
  const conversation = model.createConversation({ instructions: 'inspect', tools: session.definitions })
  await conversation.next({ kind: 'prompt', text: 'inspect' }, new AbortController().signal)
  await assert.rejects(conversation.next({ kind: 'tool-results', results: [{ id: 'wrong', name: 'cad_read_drawing', result: { ok: true, value: {} } }] }, new AbortController().signal), /call IDs/)
  const tiny = createKJModelAdapter({ protocol: 'responses', model: 'fixture', maxResponseBytes: 10, request: async () => wire('responses', [], 'hello') })
  const result = await runKJAgentTask({ session, model: tiny, prompt: 'inspect' })
  assert.equal(result.error.code, 'KJMODEL_SIZE_LIMIT')
})

test('chat token-limit fields are host-selected without hardcoded model names', async () => {
  for (const chatTokenParameter of ['max_tokens', 'max_completion_tokens']) {
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'custom/local-model', chatTokenParameter, maxOutputTokens: 321, request: async ({ body }) => {
      assert.equal(body[chatTokenParameter], 321)
      assert.equal(body.model, 'custom/local-model')
      assert.equal(Object.keys(body).filter(key => key.startsWith('max_')).length, 1)
      return wire('chat-completions', [], 'Ready.')
    } })
    assert.equal((await runKJAgentTask({ session: fixture().session, model, prompt: 'inspect' })).status, 'responded')
  }
})

test('a custom framework/model bridge uses the same runner without any built-in protocol', async () => {
  const { session, document } = fixture()
  const model = { createConversation({ tools, instructions }) {
    assert.equal(tools.length, 7)
    assert.match(instructions, /untrusted/)
    return { async next() { return { text: 'Review before editing.', calls: [call('custom', 'cad_propose_circles', args)] } } }
  } }
  const result = await runKJAgentTask({ session, model, prompt: 'circle' })
  assert.equal(result.status, 'awaiting-approval')
  assert.equal(document.revision, 0)
})

test('duplicate calls and fabricated approval tools cannot mutate or self-approve', async () => {
  for (const calls of [[call('same', 'cad_read_drawing'), call('same', 'cad_propose_circles', args)], [call('approve', 'approve', { planId: 'fake', reviewerId: 'model' })]]) {
    const { session, document } = fixture()
    const model = { createConversation: () => ({ next: async () => ({ text: '', calls }) }) }
    const result = await runKJAgentTask({ session, model, prompt: 'draw', maxTurns: 1 })
    assert.ok(['failed', 'limit-reached'].includes(result.status))
    assert.equal(document.revision, 0)
    assert.deepEqual(result.proposalIds, [])
  }
})

test('turn and call budgets stop the loop without silently dropping part of a call batch', async () => {
  let counter = 0
  const model = { createConversation: () => ({ next: async () => ({ text: '', calls: [call(`read-${counter++}`, 'cad_read_drawing')] }) }) }
  const result = await runKJAgentTask({ session: fixture().session, model, prompt: 'inspect', maxTurns: 2 })
  assert.equal(result.status, 'limit-reached')
  assert.equal(result.toolCalls, 2)
  const batch = { createConversation: () => ({ next: async () => ({ text: '', calls: [call('a', 'cad_read_drawing'), call('b', 'cad_read_drawing')] }) }) }
  const blocked = await runKJAgentTask({ session: fixture().session, model: batch, prompt: 'inspect', maxToolCalls: 1 })
  assert.equal(blocked.status, 'limit-reached')
  assert.equal(blocked.toolCalls, 0)
})

test('transport errors do not leak raw credentials or backend bodies', async () => {
  const model = createKJModelAdapter({ protocol: 'responses', model: 'fixture', request: async () => { throw new Error('private transport diagnostic must stay private') } })
  const result = await runKJAgentTask({ session: fixture().session, model, prompt: 'inspect' })
  assert.equal(result.status, 'failed')
  assert.equal(result.error.code, 'KJMODEL_REQUEST_FAILED')
  assert.ok(!JSON.stringify(result).includes('private transport diagnostic'))
})

test('cancellation and timeout ignore late model calls, and concurrent runs cannot share a session', async () => {
  const { session, document } = fixture()
  let release, enter
  const entered = new Promise(resolve => { enter = resolve })
  const model = { createConversation: () => ({ next: async () => { enter(); return new Promise(resolve => { release = resolve }) } }) }
  const controller = new AbortController()
  const running = runKJAgentTask({ session, model, prompt: 'draw', signal: controller.signal })
  await entered
  await assert.rejects(runKJAgentTask({ session, model, prompt: 'overlap' }), /active agent run/)
  controller.abort()
  assert.equal((await running).status, 'cancelled')
  release({ text: '', calls: [call('late', 'cad_propose_circles', args)] })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(document.revision, 0)
  const timedOut = await runKJAgentTask({ session, prompt: 'inspect', timeoutMs: 10, model: { createConversation: () => ({ next: () => new Promise(() => {}) }) } })
  assert.equal(timedOut.status, 'cancelled')
})
