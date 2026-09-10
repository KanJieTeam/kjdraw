import type { KJModelProtocol } from './model-adapters.js'
import { KJValidationError } from './errors.js'
import { deepFreeze } from './utils.js'

export type KJModelUsageSource = 'reported' | 'sum-components' | null
export interface KJModelUsage {
  readonly protocol: KJModelProtocol
  /** Inclusive input, including cache reads and writes. Null means unavailable or invalid. */
  readonly inputTokens: number | null
  /** Inclusive output, including reasoning. Null means unavailable or invalid. */
  readonly outputTokens: number | null
  readonly totalTokens: number | null
  readonly inputTokensSource: KJModelUsageSource
  readonly outputTokensSource: KJModelUsageSource
  readonly totalTokensSource: KJModelUsageSource
  /** Original provider counters: Anthropic input excludes caches; Gemini output excludes thoughts. */
  readonly reportedInputTokens: number | null
  readonly reportedOutputTokens: number | null
  readonly reportedTotalTokens: number | null
  readonly cacheReadInputTokens: number | null
  /** Explicitly reported uncached input (DeepSeek Chat); never inferred by subtraction. */
  readonly cacheMissInputTokens: number | null
  readonly cacheWriteInputTokens: number | null
  readonly reasoningOutputTokens: number | null
  /** Gemini's separately reported tool-use prompt count; never added to input a second time. */
  readonly toolUsePromptTokens: number | null
  /** Host-observed transport-call wall time, including network/server work but excluding CAD execution. */
  readonly latencyMs: number | null
  readonly latencyScope: 'transport-wall' | null
  /** Known field paths with invalid types, unsafe values, overflow or inconsistent totals. No payloads. */
  readonly invalidFields: readonly string[]
}

// Provider semantics verified 2026-09-10 against these official references:
// https://developers.openai.com/api/reference/cli/resources/responses/methods/create
// https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions/methods/create
// https://platform.claude.com/docs/en/build-with-claude/prompt-caching
// https://platform.claude.com/docs/en/api/messages/create
// https://ai.google.dev/api/generate-content#UsageMetadata
// https://api-docs.deepseek.com/guides/kv_cache/
// This extracts non-streaming response counters; it does not estimate tokens, price or server latency.
export function extractKJModelUsage(
  protocol: KJModelProtocol,
  response: unknown,
  { latencyMs = null }: { latencyMs?: number | null } = {},
): KJModelUsage {
  if (!['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content'].includes(protocol)) throw new KJValidationError('Unsupported model usage protocol')
  if (latencyMs !== null && (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > Number.MAX_SAFE_INTEGER)) throw new KJValidationError('Transport latency must be finite, nonnegative milliseconds')
  const invalid = new Set<string>()
  // Read only a fixed set of own data properties: never invoke getters or traverse output text.
  const field = (path: string): unknown => {
    let value: unknown = response, visited = ''
    for (const key of path.split('.')) {
      if (value === null || value === undefined) return undefined
      if (typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) { invalid.add(visited || 'response'); return undefined }
      visited = visited ? `${visited}.${key}` : key
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) return undefined
      if (!('value' in descriptor) || !descriptor.enumerable) { invalid.add(visited); return undefined }
      value = descriptor.value
    }
    return value
  }
  const count = (path: string): number | null => {
    const value = field(path)
    if (value === null || value === undefined) return null
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) { invalid.add(path); return null }
    return value
  }
  const sum = (values: readonly (number | null)[], label: string): number | null => {
    if (values.some(value => value === null)) return null
    const result = values.reduce<number>((total, value) => total + value!, 0)
    if (!Number.isSafeInteger(result)) { invalid.add(label); return null }
    return result
  }
  const gemini = protocol === 'gemini-generate-content', anthropic = protocol === 'anthropic-messages', chat = protocol === 'chat-completions'
  const inputPath = gemini ? 'usageMetadata.promptTokenCount' : chat ? 'usage.prompt_tokens' : 'usage.input_tokens'
  const outputPath = gemini ? 'usageMetadata.candidatesTokenCount' : chat ? 'usage.completion_tokens' : 'usage.output_tokens'
  const totalPath = gemini ? 'usageMetadata.totalTokenCount' : 'usage.total_tokens'
  const readPath = gemini ? 'usageMetadata.cachedContentTokenCount' : anthropic ? 'usage.cache_read_input_tokens' : chat ? 'usage.prompt_tokens_details.cached_tokens' : 'usage.input_tokens_details.cached_tokens'
  const reasoningPath = gemini ? 'usageMetadata.thoughtsTokenCount' : anthropic ? 'usage.output_tokens_details.thinking_tokens' : chat ? 'usage.completion_tokens_details.reasoning_tokens' : 'usage.output_tokens_details.reasoning_tokens'
  const reportedInputTokens = count(inputPath), reportedOutputTokens = count(outputPath)
  // Anthropic does not define total_tokens: do not consume a lookalike extension field.
  const reportedTotalTokens = anthropic ? null : count(totalPath)
  let cacheReadInputTokens = count(readPath)
  let cacheMissInputTokens: number | null = null
  let effectiveReadPath = readPath
  if (chat) {
    const hitPath = 'usage.prompt_cache_hit_tokens', missPath = 'usage.prompt_cache_miss_tokens'
    const reportedHit = count(hitPath)
    cacheMissInputTokens = count(missPath)
    const invalidPath = (path: string): boolean => [...invalid].some(entry => path === entry || path.startsWith(`${entry}.`))
    // These are documented aliases, not model-name heuristics. Reject contradictory evidence.
    if (invalidPath(readPath) || invalidPath(hitPath)) cacheReadInputTokens = null
    else if (cacheReadInputTokens !== null && reportedHit !== null && cacheReadInputTokens !== reportedHit) {
      invalid.add(readPath); invalid.add(hitPath); cacheReadInputTokens = null
    } else if (cacheReadInputTokens === null && reportedHit !== null) {
      cacheReadInputTokens = reportedHit; effectiveReadPath = hitPath
    }
    if (cacheMissInputTokens !== null && reportedInputTokens !== null && cacheMissInputTokens > reportedInputTokens) {
      invalid.add(missPath); cacheMissInputTokens = null
    }
    if (cacheReadInputTokens !== null && cacheMissInputTokens !== null) {
      const splitTotal = cacheReadInputTokens + cacheMissInputTokens
      if (!Number.isSafeInteger(splitTotal) || (reportedInputTokens !== null && splitTotal !== reportedInputTokens)) {
        invalid.add(effectiveReadPath); invalid.add(missPath)
        cacheReadInputTokens = null; cacheMissInputTokens = null
      }
    }
  }
  let cacheWriteInputTokens = anthropic ? count('usage.cache_creation_input_tokens') : protocol === 'responses' ? count('usage.input_tokens_details.cache_write_tokens') : null
  let reasoningOutputTokens = count(reasoningPath)
  const toolUsePromptTokens = gemini ? count('usageMetadata.toolUsePromptTokenCount') : null
  if (!anthropic && cacheReadInputTokens !== null && reportedInputTokens !== null && cacheReadInputTokens > reportedInputTokens) { invalid.add(effectiveReadPath); cacheReadInputTokens = null }
  if (!gemini && reasoningOutputTokens !== null && reportedOutputTokens !== null && reasoningOutputTokens > reportedOutputTokens) { invalid.add(reasoningPath); reasoningOutputTokens = null }
  if (protocol === 'responses' && cacheWriteInputTokens !== null && reportedInputTokens !== null && cacheWriteInputTokens > reportedInputTokens) { invalid.add('usage.input_tokens_details.cache_write_tokens'); cacheWriteInputTokens = null }
  const inputTokens = anthropic ? sum([reportedInputTokens, cacheReadInputTokens, cacheWriteInputTokens], 'normalized.inputTokens') : reportedInputTokens
  const outputTokens = gemini ? sum([reportedOutputTokens, reasoningOutputTokens], 'normalized.outputTokens') : reportedOutputTokens
  const calculatedTotal = sum([inputTokens, outputTokens], 'normalized.totalTokens')
  let totalTokens = reportedTotalTokens, totalTokensSource: KJModelUsageSource = totalTokens === null ? null : 'reported'
  if (invalid.has('normalized.totalTokens')) {
    totalTokens = null; totalTokensSource = null
  } else if (reportedTotalTokens !== null && calculatedTotal !== null && reportedTotalTokens !== calculatedTotal) {
    invalid.add(totalPath); totalTokens = null; totalTokensSource = null
  } else if (reportedTotalTokens === null && !invalid.has(totalPath) && calculatedTotal !== null) {
    totalTokens = calculatedTotal; totalTokensSource = 'sum-components'
  }
  return deepFreeze({ protocol, inputTokens, outputTokens, totalTokens,
    inputTokensSource: inputTokens === null ? null : anthropic ? 'sum-components' : 'reported',
    outputTokensSource: outputTokens === null ? null : gemini ? 'sum-components' : 'reported',
    totalTokensSource, reportedInputTokens, reportedOutputTokens, reportedTotalTokens,
    cacheReadInputTokens, cacheMissInputTokens, cacheWriteInputTokens, reasoningOutputTokens, toolUsePromptTokens,
    latencyMs, latencyScope: latencyMs === null ? null : 'transport-wall', invalidFields: [...invalid] })
}
