import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJModelAdapter } from '../packages/kjdraw-sdk/src/model-adapters.js'

const prompt = { kind: 'prompt', text: 'Inspect native evidence, do not change the drawing.' }
const signal = () => new AbortController().signal
const wire = protocol => protocol === 'chat-completions'
  ? { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Unverified model text.' } }] }
  : protocol === 'responses'
    ? { id: 'response-fixture', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Unverified model text.' }] }] }
    : protocol === 'anthropic-messages'
      ? { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Unverified model text.' }], stop_reason: 'end_turn' }
      : { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'Unverified model text.' }] } }] }

for (const protocol of ['chat-completions', 'responses', 'anthropic-messages', 'gemini-generate-content']) {
  for (const [label, options, limit] of [
    ['default single', { allowTextContinuation: true }, 1],
    ['explicit two', { allowTextContinuation: true, maxTextContinuations: 2 }, 2],
    ['disabled', { maxTextContinuations: 2 }, 0],
    ['zero', { allowTextContinuation: true, maxTextContinuations: 0 }, 0],
  ]) test(`${protocol}: ${label} captures a bounded host continuation policy`, async () => {
    let calls = 0
    const model = createKJModelAdapter({ protocol, model: 'offline-budget-fixture', request: async () => { calls++; return wire(protocol) } })
    const originalOptions = { instructions: 'Use native tools, not fabricated receipts.', tools: [], ...options }
    const conversation = model.createConversation(originalOptions)
    originalOptions.maxTextContinuations = 32
    originalOptions.allowTextContinuation = true
    for (let index = 0; index <= limit; index++) assert.equal((await conversation.next(prompt, signal())).text, 'Unverified model text.')
    await assert.rejects(conversation.next(prompt, signal()), error => error.code === 'KJMODEL_PROTOCOL')
    assert.equal(calls, 1 + limit)
  })

  test(`${protocol}: transport failure remains terminal even with two continuations`, async () => {
    let calls = 0
    const model = createKJModelAdapter({ protocol, model: 'offline-failure-fixture', request: async () => { calls++; throw new Error('private failure') } })
    const conversation = model.createConversation({ instructions: 'Read.', tools: [], allowTextContinuation: true, maxTextContinuations: 2 })
    await assert.rejects(conversation.next(prompt, signal()))
    await assert.rejects(conversation.next(prompt, signal()), error => error.code === 'KJMODEL_PROTOCOL')
    assert.equal(calls, 1)
  })
}

for (const limit of [-1, 33, 0.1, Infinity, NaN, '2', null]) test(`invalid continuation budget before transport: ${String(limit)}`, () => {
  let calls = 0
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-invalid-budget', request: async () => { calls++; return wire('chat-completions') } })
  assert.throws(() => model.createConversation({ instructions: 'Read.', tools: [], allowTextContinuation: true, maxTextContinuations: limit }), error => error.code === 'KJMODEL_PROTOCOL')
  assert.equal(calls, 0)
})
