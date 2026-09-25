import { deepFreeze } from './utils.js'
import { createKJModelAdapter, KJModelError, type KJAgentModel, type KJChatRequestExtensions, type KJModelAdapterOptions } from './model-adapters.js'

export type KJDomesticModelProvider = 'deepseek' | 'kimi' | 'qwen' | 'doubao'
export type KJDomesticReasoningMode = 'provider-default' | 'enabled' | 'disabled'
export type KJDomesticReasoningEffort = 'low' | 'high' | 'max'

export interface KJDomesticModelProfile {
  readonly provider: KJDomesticModelProvider
  readonly profileVersion: '1.0.0'
  readonly protocol: 'chat-completions'
  readonly defaultBaseURL: string
  readonly chatCompletionsPath: '/chat/completions'
  readonly credentialEnvironmentVariable: string
  readonly chatTokenParameter: 'max_tokens' | 'max_completion_tokens'
  readonly supports: {
    readonly toolCalls: true
    readonly reasoningHistory: true
    readonly thinkingToggle: boolean
    readonly reasoningEffort: boolean
    readonly preservedThinkingSwitch: boolean
  }
}

export interface KJDomesticModelAdapterOptions extends Omit<KJModelAdapterOptions, 'protocol' | 'chatTokenParameter' | 'chatRequestExtensions'> {
  provider: KJDomesticModelProvider
  reasoning?: {
    mode?: KJDomesticReasoningMode
    effort?: KJDomesticReasoningEffort
    /** Kimi-only request for thinking.keep="all". KJDraw always preserves returned reasoning_content in tool conversations. */
    preserve?: boolean
  }
  toolChoice?: 'auto' | 'none' | 'required'
  parallelToolCalls?: boolean
  /** Optional opaque session key for providers that support prompt caching. Never put credentials or user PII here. */
  promptCacheKey?: string
  /** Optional host-generated pseudonymous user key; do not use a name or email address. */
  safetyIdentifier?: string
}

const profiles: Record<KJDomesticModelProvider, KJDomesticModelProfile> = {
  deepseek: {
    provider: 'deepseek', profileVersion: '1.0.0', protocol: 'chat-completions',
    defaultBaseURL: 'https://api.deepseek.com', chatCompletionsPath: '/chat/completions',
    credentialEnvironmentVariable: 'DEEPSEEK_API_KEY', chatTokenParameter: 'max_tokens',
    supports: { toolCalls: true, reasoningHistory: true, thinkingToggle: true, reasoningEffort: true, preservedThinkingSwitch: false },
  },
  kimi: {
    provider: 'kimi', profileVersion: '1.0.0', protocol: 'chat-completions',
    defaultBaseURL: 'https://api.moonshot.ai/v1', chatCompletionsPath: '/chat/completions',
    credentialEnvironmentVariable: 'MOONSHOT_API_KEY', chatTokenParameter: 'max_completion_tokens',
    supports: { toolCalls: true, reasoningHistory: true, thinkingToggle: true, reasoningEffort: true, preservedThinkingSwitch: true },
  },
  doubao: {
    provider: 'doubao', profileVersion: '1.0.0', protocol: 'chat-completions',
    defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3', chatCompletionsPath: '/chat/completions',
    credentialEnvironmentVariable: 'ARK_API_KEY', chatTokenParameter: 'max_tokens',
    supports: { toolCalls: true, reasoningHistory: true, thinkingToggle: true, reasoningEffort: true, preservedThinkingSwitch: false },
  },
  qwen: {
    provider: 'qwen', profileVersion: '1.0.0', protocol: 'chat-completions',
    defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', chatCompletionsPath: '/chat/completions',
    credentialEnvironmentVariable: 'DASHSCOPE_API_KEY', chatTokenParameter: 'max_tokens',
    supports: { toolCalls: true, reasoningHistory: true, thinkingToggle: true, reasoningEffort: false, preservedThinkingSwitch: false },
  },
}

export const KJDRAW_DOMESTIC_MODEL_PROFILES: Readonly<Record<KJDomesticModelProvider, KJDomesticModelProfile>> = deepFreeze(profiles)

function profileError(message: string): never { throw new KJModelError('KJMODEL_PROFILE', message) }

export function getKJDomesticModelProfile(provider: KJDomesticModelProvider): KJDomesticModelProfile {
  if (!Object.prototype.hasOwnProperty.call(KJDRAW_DOMESTIC_MODEL_PROFILES, provider)) profileError('Unknown domestic model provider')
  const profile = KJDRAW_DOMESTIC_MODEL_PROFILES[provider]
  return profile
}

export type KJDomesticModelWireOptions = Pick<KJDomesticModelAdapterOptions, 'reasoning' | 'toolChoice' | 'parallelToolCalls' | 'promptCacheKey' | 'safetyIdentifier'> & { model?: string }

/** Pure wire configuration shared by SDK hosts and the browser workbench. */
export function getKJDomesticModelAdapterSettings(provider: KJDomesticModelProvider, options: KJDomesticModelWireOptions = {}): Pick<KJModelAdapterOptions, 'protocol' | 'chatTokenParameter' | 'chatRequestExtensions'> {
  const { reasoning, toolChoice, parallelToolCalls, promptCacheKey, safetyIdentifier, model } = options
  const profile = getKJDomesticModelProfile(provider)
  const mode = reasoning?.mode ?? 'provider-default'
  const effort = reasoning?.effort
  const preserve = reasoning?.preserve ?? false
  if (!['provider-default', 'enabled', 'disabled'].includes(mode)) profileError('Invalid domestic model reasoning mode')
  if (effort !== undefined && !['low', 'high', 'max'].includes(effort)) profileError('Invalid domestic model reasoning effort')
  if (effort !== undefined && !profile.supports.reasoningEffort) profileError(`${provider} does not expose reasoning_effort through this profile`)
  if (effort !== undefined && mode === 'disabled') profileError('Reasoning effort cannot be set while thinking is disabled')
  if (preserve && !profile.supports.preservedThinkingSwitch) profileError(`${provider} does not expose a preserved-thinking switch through this profile`)
  if (preserve && mode === 'disabled') profileError('Preserved thinking cannot be requested while thinking is disabled')
  if (provider === 'kimi' && mode === 'disabled' && /^kimi-k3(?:$|-)/i.test(model?.trim() ?? '')) profileError('Kimi K3 always uses thinking; select provider-default or enabled')
  if (provider === 'qwen' && toolChoice === 'required' && mode !== 'disabled') profileError('Qwen toolChoice="required" requires explicitly disabled thinking')
  if (provider !== 'kimi' && (promptCacheKey !== undefined || safetyIdentifier !== undefined)) profileError('Prompt cache and safety identifiers are only exposed by the Kimi profile')

  const extensions: KJChatRequestExtensions = {
    ...(provider === 'qwen' && mode !== 'provider-default' ? { enable_thinking: mode === 'enabled' } : {}),
    ...(provider !== 'qwen' && (mode !== 'provider-default' || preserve) ? { thinking: { type: mode === 'disabled' ? 'disabled' as const : 'enabled' as const, ...(provider === 'kimi' && preserve ? { keep: 'all' as const } : {}) } } : {}),
    ...(effort === undefined ? {} : { reasoning_effort: effort }),
    ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
    ...(parallelToolCalls === undefined ? {} : { parallel_tool_calls: parallelToolCalls }),
    ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
    ...(safetyIdentifier === undefined ? {} : { safety_identifier: safetyIdentifier }),
  }
  return { protocol: profile.protocol, chatTokenParameter: profile.chatTokenParameter, ...(Object.keys(extensions).length ? { chatRequestExtensions: extensions } : {}) }
}

/** Create one common CAD agent adapter with only the provider-specific Chat fields changed. Credentials remain in the host transport. */
export function createKJDomesticModelAdapter(options: KJDomesticModelAdapterOptions): KJAgentModel {
  const { provider, reasoning, toolChoice, parallelToolCalls, promptCacheKey, safetyIdentifier, ...adapter } = options
  const wire = getKJDomesticModelAdapterSettings(provider, { model: adapter.model, ...(reasoning === undefined ? {} : { reasoning }), ...(toolChoice === undefined ? {} : { toolChoice }), ...(parallelToolCalls === undefined ? {} : { parallelToolCalls }), ...(promptCacheKey === undefined ? {} : { promptCacheKey }), ...(safetyIdentifier === undefined ? {} : { safetyIdentifier }) })
  return createKJModelAdapter({ ...adapter, ...wire })
}
