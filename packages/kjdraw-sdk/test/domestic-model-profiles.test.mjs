import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDomesticModelAdapter, getKJDomesticModelProfile, KJDRAW_DOMESTIC_MODEL_PROFILES } from '../src/domestic-model-profiles.js'
import { createKJModelAdapter } from '../src/model-adapters.js'

const tool = { name: 'cad_read_drawing', description: 'Read', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } }
const result = { id: 'read-1', name: 'cad_read_drawing', result: { ok: true, value: { revision: 0 } } }

async function capture(provider, reasoning = undefined, extra = {}) {
  const bodies = []
  const model = createKJDomesticModelAdapter({
    provider, model: `${provider}-fixture`, reasoning, maxOutputTokens: 1234, ...extra,
    request: async ({ protocol, body }) => {
      assert.equal(protocol, 'chat-completions')
      bodies.push(body)
      if (bodies.length === 1) return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, reasoning_content: `${provider}-opaque-reasoning`, ...(provider === 'doubao' ? { encrypted_content: 'opaque-provider-block' } : {}), tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' } }] } }] }
      return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'done', reasoning_content: `${provider}-final-reasoning`, tool_calls: [] } }] }
    },
  })
  const conversation = model.createConversation({ instructions: 'Use tools.', tools: [tool] })
  const first = await conversation.next({ kind: 'prompt', text: 'Inspect the drawing.' }, new AbortController().signal)
  assert.equal(first.calls[0].name, 'cad_read_drawing')
  const second = await conversation.next({ kind: 'tool-results', results: [result] }, new AbortController().signal)
  assert.equal(second.text, 'done')
  assert.equal(bodies[1].messages.at(-2).reasoning_content, `${provider}-opaque-reasoning`)
  return bodies
}

test('profiles are immutable connection metadata and contain no credentials', () => {
  assert.deepEqual(Object.keys(KJDRAW_DOMESTIC_MODEL_PROFILES), ['deepseek', 'kimi', 'doubao', 'qwen'])
  assert.equal(getKJDomesticModelProfile('deepseek').defaultBaseURL, 'https://api.deepseek.com')
  assert.equal(getKJDomesticModelProfile('kimi').chatTokenParameter, 'max_completion_tokens')
  assert.equal(getKJDomesticModelProfile('qwen').credentialEnvironmentVariable, 'DASHSCOPE_API_KEY')
  assert.equal(getKJDomesticModelProfile('doubao').defaultBaseURL, 'https://ark.cn-beijing.volces.com/api/v3')
  assert.equal(getKJDomesticModelProfile('doubao').credentialEnvironmentVariable, 'ARK_API_KEY')
  assert.ok(Object.isFrozen(KJDRAW_DOMESTIC_MODEL_PROFILES.qwen.supports))
  assert.ok(!JSON.stringify(KJDRAW_DOMESTIC_MODEL_PROFILES).includes('sk-'))
})

test('DeepSeek profile adds bounded thinking fields and preserves reasoning across tool turns', async () => {
  const bodies = await capture('deepseek', { mode: 'enabled', effort: 'high' }, { toolChoice: 'auto', parallelToolCalls: true })
  assert.deepEqual(bodies[0].thinking, { type: 'enabled' })
  assert.equal(bodies[0].reasoning_effort, 'high')
  assert.equal(bodies[0].tool_choice, 'auto')
  assert.equal(bodies[0].parallel_tool_calls, true)
  assert.equal(bodies[0].max_tokens, 1234)
  assert.equal(bodies[0].max_completion_tokens, undefined)
})

test('Kimi profile uses current token field and explicit preserved thinking', async () => {
  const bodies = await capture('kimi', { mode: 'enabled', effort: 'max', preserve: true }, { promptCacheKey: 'cad-session-42', safetyIdentifier: 'sha256-user' })
  assert.deepEqual(bodies[0].thinking, { type: 'enabled', keep: 'all' })
  assert.equal(bodies[0].reasoning_effort, 'max')
  assert.equal(bodies[0].prompt_cache_key, 'cad-session-42')
  assert.equal(bodies[0].safety_identifier, 'sha256-user')
  assert.equal(bodies[0].max_completion_tokens, 1234)
  assert.equal(bodies[0].max_tokens, undefined)
})

test('Doubao profile uses Ark Chat fields and returns encrypted reasoning unchanged after a tool call', async () => {
  const bodies = await capture('doubao', { mode: 'enabled', effort: 'low' }, { toolChoice: 'auto' })
  assert.deepEqual(bodies[0].thinking, { type: 'enabled' })
  assert.equal(bodies[0].reasoning_effort, 'low')
  assert.equal(bodies[0].max_tokens, 1234)
  assert.equal(bodies[1].messages.at(-2).encrypted_content, 'opaque-provider-block')
})

test('Qwen profile maps its non-standard thinking toggle without leaking it into another protocol', async () => {
  const bodies = await capture('qwen', { mode: 'disabled' })
  assert.equal(bodies[0].enable_thinking, false)
  assert.equal(bodies[0].thinking, undefined)
  assert.equal(bodies[0].max_tokens, 1234)
})

test('profiles reject unsupported provider options before transport', () => {
  const request = async () => { throw new Error('must not run') }
  assert.throws(() => createKJDomesticModelAdapter({ provider: 'qwen', model: 'qwen-fixture', request, reasoning: { effort: 'high' } }), error => error.code === 'KJMODEL_PROFILE')
  assert.throws(() => createKJDomesticModelAdapter({ provider: 'deepseek', model: 'deepseek-fixture', request, reasoning: { preserve: true } }), error => error.code === 'KJMODEL_PROFILE')
  assert.throws(() => createKJDomesticModelAdapter({ provider: 'kimi', model: 'kimi-fixture', request, reasoning: { mode: 'disabled', preserve: true } }), error => error.code === 'KJMODEL_PROFILE')
  assert.throws(() => createKJDomesticModelAdapter({ provider: 'qwen', model: 'qwen-fixture', request, reasoning: { mode: 'enabled' }, toolChoice: 'required' }), error => error.code === 'KJMODEL_PROFILE')
  assert.throws(() => createKJDomesticModelAdapter({ provider: '__proto__', model: 'fixture', request }), error => error.code === 'KJMODEL_PROFILE')
  assert.throws(() => createKJDomesticModelAdapter({ provider: 'deepseek', model: 'deepseek-fixture', request, promptCacheKey: 'wrong-provider' }), error => error.code === 'KJMODEL_PROFILE')
})

test('generic request extensions reject reserved or cross-protocol fields', () => {
  const request = async () => { throw new Error('must not run') }
  assert.throws(() => createKJModelAdapter({ protocol: 'chat-completions', model: 'fixture', request, chatRequestExtensions: { model: 'override' } }), error => error.code === 'KJMODEL_PROTOCOL')
  assert.throws(() => createKJModelAdapter({ protocol: 'responses', model: 'fixture', request, chatRequestExtensions: { enable_thinking: true } }), error => error.code === 'KJMODEL_PROTOCOL')
  assert.throws(() => createKJModelAdapter({ protocol: 'chat-completions', model: 'fixture', request, chatRequestExtensions: { thinking: { type: 'enabled', arbitrary: true } } }), error => error.code === 'KJMODEL_PROTOCOL')
})
