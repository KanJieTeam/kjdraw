import assert from 'node:assert/strict'
import test from 'node:test'
import { extractKJModelUsage } from '../src/model-usage.js'

test('Responses and Chat counters retain inclusive totals without adding cache or reasoning twice', () => {
  for (const [protocol, response] of [
    ['responses', { usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130, input_tokens_details: { cached_tokens: 70, cache_write_tokens: 10 }, output_tokens_details: { reasoning_tokens: 20 } } }],
    ['chat-completions', { usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 70 }, completion_tokens_details: { reasoning_tokens: 20 } } }],
  ]) {
    const result = extractKJModelUsage(protocol, response, { latencyMs: 12.75 })
    assert.equal(result.inputTokens, 100); assert.equal(result.outputTokens, 30); assert.equal(result.totalTokens, 130)
    assert.equal(result.cacheReadInputTokens, 70); assert.equal(result.reasoningOutputTokens, 20)
    assert.equal(result.cacheWriteInputTokens, protocol === 'responses' ? 10 : null)
    assert.equal(result.inputTokensSource, 'reported'); assert.equal(result.outputTokensSource, 'reported'); assert.equal(result.totalTokensSource, 'reported')
    assert.equal(result.latencyMs, 12.75); assert.equal(result.latencyScope, 'transport-wall')
    assert.deepEqual(result.invalidFields, [])
  }
})

test('Anthropic sums uncached input, cache read and cache creation only when all are reported', () => {
  const response = { usage: { input_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 80, output_tokens_details: { thinking_tokens: 30 }, total_tokens: 99999 } }
  const result = extractKJModelUsage('anthropic-messages', response)
  assert.equal(result.reportedInputTokens, 50); assert.equal(result.inputTokens, 1250)
  assert.equal(result.inputTokensSource, 'sum-components'); assert.equal(result.outputTokens, 80)
  assert.equal(result.reasoningOutputTokens, 30); assert.equal(result.totalTokens, 1330)
  assert.equal(result.reportedTotalTokens, null); assert.equal(result.totalTokensSource, 'sum-components')
  delete response.usage.cache_creation_input_tokens
  const partial = extractKJModelUsage('anthropic-messages', response)
  assert.equal(partial.reportedInputTokens, 50); assert.equal(partial.cacheReadInputTokens, 1000)
  assert.equal(partial.inputTokens, null); assert.equal(partial.totalTokens, null)
  assert.equal(partial.cacheWriteInputTokens, null)
})

test('Gemini keeps candidates and thoughts separate while normalizing complete output counts', () => {
  const raw = { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, cachedContentTokenCount: 60, toolUsePromptTokenCount: 10, totalTokenCount: 150 } }
  const result = extractKJModelUsage('gemini-generate-content', raw)
  assert.equal(result.inputTokens, 100); assert.equal(result.reportedOutputTokens, 20)
  assert.equal(result.outputTokens, 50); assert.equal(result.outputTokensSource, 'sum-components')
  assert.equal(result.reasoningOutputTokens, 30); assert.equal(result.cacheReadInputTokens, 60)
  assert.equal(result.totalTokens, 150); assert.equal(result.toolUsePromptTokens, 10)
  assert.equal(result.cacheWriteInputTokens, null)
  delete raw.usageMetadata.thoughtsTokenCount
  const partial = extractKJModelUsage('gemini-generate-content', raw)
  assert.equal(partial.outputTokens, null); assert.equal(partial.reportedOutputTokens, 20)
  assert.equal(partial.reasoningOutputTokens, null); assert.equal(partial.totalTokens, 150)
})

test('missing usage remains null, explicit zero remains zero, and no text or byte estimates are created', () => {
  for (const protocol of ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']) {
    const result = extractKJModelUsage(protocol, { text: 'x'.repeat(5000) })
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'reportedInputTokens', 'cacheReadInputTokens', 'reasoningOutputTokens', 'latencyMs', 'latencyScope']) assert.equal(result[key], null)
    assert.deepEqual(result.invalidFields, [])
  }
  const result = extractKJModelUsage('responses', { usage: { input_tokens: 0, output_tokens: 0 } }, { latencyMs: 0 })
  assert.equal(result.inputTokens, 0); assert.equal(result.outputTokens, 0); assert.equal(result.totalTokens, 0)
  assert.equal(result.totalTokensSource, 'sum-components'); assert.equal(result.latencyMs, 0)
})

test('invalid numeric fields and inconsistent reported totals are explicit and never silently replaced', () => {
  for (const value of [-1, 1.5, NaN, Infinity, '10', true, Number.MAX_SAFE_INTEGER + 1]) {
    const result = extractKJModelUsage('responses', { usage: { input_tokens: value, output_tokens: 2 } })
    assert.equal(result.inputTokens, null); assert.equal(result.totalTokens, null)
    assert.ok(result.invalidFields.includes('usage.input_tokens'))
  }
  const mismatch = extractKJModelUsage('responses', { usage: { input_tokens: 10, output_tokens: 20, total_tokens: 99 } })
  assert.equal(mismatch.totalTokens, null); assert.equal(mismatch.reportedTotalTokens, 99)
  assert.equal(mismatch.totalTokensSource, null); assert.deepEqual(mismatch.invalidFields, ['usage.total_tokens'])
  const malformed = extractKJModelUsage('responses', { usage: { input_tokens: 10, output_tokens: 20, total_tokens: '30' } })
  assert.equal(malformed.totalTokens, null); assert.ok(malformed.invalidFields.includes('usage.total_tokens'))
  const breakdown = extractKJModelUsage('responses', { usage: { input_tokens: 10, output_tokens: 20, input_tokens_details: { cached_tokens: 11 }, output_tokens_details: { reasoning_tokens: 21 } } })
  assert.equal(breakdown.cacheReadInputTokens, null); assert.equal(breakdown.reasoningOutputTokens, null)
  assert.deepEqual(breakdown.invalidFields, ['usage.input_tokens_details.cached_tokens', 'usage.output_tokens_details.reasoning_tokens'])
})

test('arithmetic overflow is unavailable rather than an unsafe total', () => {
  const result = extractKJModelUsage('anthropic-messages', { usage: { input_tokens: Number.MAX_SAFE_INTEGER, cache_creation_input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } })
  assert.equal(result.inputTokens, null); assert.equal(result.totalTokens, null)
  assert.ok(result.invalidFields.includes('normalized.inputTokens'))
  const contradictory = extractKJModelUsage('responses', { usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1, total_tokens: Number.MAX_SAFE_INTEGER } })
  assert.equal(contradictory.totalTokens, null)
  assert.equal(contradictory.reportedTotalTokens, Number.MAX_SAFE_INTEGER)
  assert.ok(contradictory.invalidFields.includes('normalized.totalTokens'))
})

test('usage extraction does not execute getters, expose unrelated payloads or mutate response data', () => {
  let invoked = 0
  const response = { usage: { input_tokens: 10, output_tokens: 2 }, output: 'PRIVATE_BODY' }
  Object.defineProperty(response.usage, 'total_tokens', { enumerable: true, get() { invoked++; return 12 } })
  Object.defineProperty(response, 'unknown', { enumerable: true, get() { invoked++; return 'PRIVATE_HEADER' } })
  const result = extractKJModelUsage('responses', response)
  assert.equal(invoked, 0); assert.equal(result.totalTokens, null)
  assert.ok(result.invalidFields.includes('usage.total_tokens'))
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/)
  assert.ok(Object.isFrozen(result.invalidFields)); assert.ok(Object.isFrozen(result))
  response.usage.input_tokens = 99
  assert.equal(result.reportedInputTokens, 10)
  const invalidContainer = extractKJModelUsage('responses', { usage: [] })
  assert.ok(invalidContainer.invalidFields.includes('usage'))
})

test('latency is supplied independently by the host and unsupported protocols are rejected', () => {
  for (const latencyMs of [-1, NaN, Infinity, '10']) assert.throws(() => extractKJModelUsage('responses', {}, { latencyMs }), /Transport latency/)
  assert.throws(() => extractKJModelUsage('vendor-name', {}), /Unsupported/)
  const result = extractKJModelUsage('responses', { latency: 999, created_at: 0, completed_at: 10 }, { latencyMs: 5 })
  assert.equal(result.latencyMs, 5)
  assert.equal('cost' in result, false)
})

test('DeepSeek Chat reports cache hits and misses without inferred counters or double counting', () => {
  const raw = { usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_cache_hit_tokens: 70, prompt_cache_miss_tokens: 30 } }
  const value = extractKJModelUsage('chat-completions', raw)
  assert.equal(value.cacheReadInputTokens, 70); assert.equal(value.cacheMissInputTokens, 30)
  assert.equal(value.inputTokens, 100); assert.equal(value.totalTokens, 130); assert.equal(value.cacheWriteInputTokens, null)
  assert.deepEqual(value.invalidFields, [])
  raw.usage.prompt_tokens_details = { cached_tokens: 70 }
  assert.deepEqual(extractKJModelUsage('chat-completions', raw), value)
  delete raw.usage.prompt_cache_miss_tokens
  assert.equal(extractKJModelUsage('chat-completions', raw).cacheMissInputTokens, null)
  assert.equal(extractKJModelUsage('responses', { usage: { prompt_cache_hit_tokens: 70, prompt_cache_miss_tokens: 30 } }).cacheMissInputTokens, null)
  const zero = extractKJModelUsage('chat-completions', { usage: { prompt_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0 } })
  assert.equal(zero.cacheReadInputTokens, 0); assert.equal(zero.cacheMissInputTokens, 0)
})

test('DeepSeek cache aliases reject contradictions, malformed counts and invalid getters', () => {
  const base = { prompt_tokens: 100, completion_tokens: 30, prompt_cache_hit_tokens: 70, prompt_cache_miss_tokens: 30 }
  for (const usage of [
    { ...base, prompt_tokens_details: { cached_tokens: 60 } },
    { ...base, prompt_cache_miss_tokens: 29 },
    { ...base, prompt_cache_hit_tokens: '70' },
    { ...base, prompt_tokens_details: { cached_tokens: '70' } },
    { ...base, prompt_cache_hit_tokens: 101, prompt_cache_miss_tokens: undefined },
  ]) {
    const value = extractKJModelUsage('chat-completions', { usage })
    assert.equal(value.cacheReadInputTokens, null)
    assert.ok(value.invalidFields.length > 0)
    assert.equal(value.inputTokens, 100); assert.equal(value.totalTokens, 130)
  }
  for (const miss of [-1, '30', 0.5, Number.MAX_SAFE_INTEGER + 1, 101]) {
    const value = extractKJModelUsage('chat-completions', { usage: { ...base, prompt_cache_miss_tokens: miss } })
    assert.equal(value.cacheMissInputTokens, null); assert.ok(value.invalidFields.includes('usage.prompt_cache_miss_tokens'))
  }
  let invoked = 0
  const usage = { ...base }
  Object.defineProperty(usage, 'prompt_cache_hit_tokens', { enumerable: true, get() { invoked++; return 70 } })
  const value = extractKJModelUsage('chat-completions', { usage })
  assert.equal(invoked, 0); assert.equal(value.cacheReadInputTokens, null)
  assert.ok(value.invalidFields.includes('usage.prompt_cache_hit_tokens'))
  const overflow = extractKJModelUsage('chat-completions', { usage: { prompt_cache_hit_tokens: Number.MAX_SAFE_INTEGER, prompt_cache_miss_tokens: 1 } })
  assert.equal(overflow.cacheReadInputTokens, null); assert.equal(overflow.cacheMissInputTokens, null)
})
