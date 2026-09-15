// Generated from domestic-model-profiles.ts by scripts/build-typescript.mjs. Do not edit directly.
import { deepFreeze } from './utils.js';
import { createKJModelAdapter, KJModelError } from './model-adapters.js';
const profiles = {
    deepseek: {
        provider: 'deepseek',
        profileVersion: '1.0.0',
        protocol: 'chat-completions',
        defaultBaseURL: 'https://api.deepseek.com',
        chatCompletionsPath: '/chat/completions',
        credentialEnvironmentVariable: 'DEEPSEEK_API_KEY',
        chatTokenParameter: 'max_tokens',
        supports: {
            toolCalls: true,
            reasoningHistory: true,
            thinkingToggle: true,
            reasoningEffort: true,
            preservedThinkingSwitch: false
        }
    },
    kimi: {
        provider: 'kimi',
        profileVersion: '1.0.0',
        protocol: 'chat-completions',
        defaultBaseURL: 'https://api.moonshot.ai/v1',
        chatCompletionsPath: '/chat/completions',
        credentialEnvironmentVariable: 'MOONSHOT_API_KEY',
        chatTokenParameter: 'max_completion_tokens',
        supports: {
            toolCalls: true,
            reasoningHistory: true,
            thinkingToggle: true,
            reasoningEffort: true,
            preservedThinkingSwitch: true
        }
    },
    qwen: {
        provider: 'qwen',
        profileVersion: '1.0.0',
        protocol: 'chat-completions',
        defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        chatCompletionsPath: '/chat/completions',
        credentialEnvironmentVariable: 'DASHSCOPE_API_KEY',
        chatTokenParameter: 'max_tokens',
        supports: {
            toolCalls: true,
            reasoningHistory: true,
            thinkingToggle: true,
            reasoningEffort: false,
            preservedThinkingSwitch: false
        }
    }
};
export const KJDRAW_DOMESTIC_MODEL_PROFILES = deepFreeze(profiles);
function profileError(message) {
    throw new KJModelError('KJMODEL_PROFILE', message);
}
export function getKJDomesticModelProfile(provider) {
    if (!Object.prototype.hasOwnProperty.call(KJDRAW_DOMESTIC_MODEL_PROFILES, provider)) profileError('Unknown domestic model provider');
    const profile = KJDRAW_DOMESTIC_MODEL_PROFILES[provider];
    return profile;
}
export function createKJDomesticModelAdapter(options) {
    const { provider, reasoning, toolChoice, parallelToolCalls, promptCacheKey, safetyIdentifier, ...adapter } = options;
    const profile = getKJDomesticModelProfile(provider);
    const mode = reasoning?.mode ?? 'provider-default';
    const effort = reasoning?.effort;
    const preserve = reasoning?.preserve ?? false;
    if (![
        'provider-default',
        'enabled',
        'disabled'
    ].includes(mode)) profileError('Invalid domestic model reasoning mode');
    if (effort !== undefined && ![
        'low',
        'high',
        'max'
    ].includes(effort)) profileError('Invalid domestic model reasoning effort');
    if (effort !== undefined && !profile.supports.reasoningEffort) profileError(`${provider} does not expose reasoning_effort through this profile`);
    if (effort !== undefined && mode === 'disabled') profileError('Reasoning effort cannot be set while thinking is disabled');
    if (preserve && !profile.supports.preservedThinkingSwitch) profileError(`${provider} does not expose a preserved-thinking switch through this profile`);
    if (preserve && mode === 'disabled') profileError('Preserved thinking cannot be requested while thinking is disabled');
    if (provider === 'qwen' && toolChoice === 'required' && mode !== 'disabled') profileError('Qwen toolChoice="required" requires explicitly disabled thinking');
    if (provider !== 'kimi' && (promptCacheKey !== undefined || safetyIdentifier !== undefined)) profileError('Prompt cache and safety identifiers are only exposed by the Kimi profile');
    const extensions = {
        ...provider === 'qwen' && mode !== 'provider-default' ? {
            enable_thinking: mode === 'enabled'
        } : {},
        ...provider !== 'qwen' && (mode !== 'provider-default' || preserve) ? {
            thinking: {
                type: mode === 'disabled' ? 'disabled' : 'enabled',
                ...provider === 'kimi' && preserve ? {
                    keep: 'all'
                } : {}
            }
        } : {},
        ...effort === undefined ? {} : {
            reasoning_effort: effort
        },
        ...toolChoice === undefined ? {} : {
            tool_choice: toolChoice
        },
        ...parallelToolCalls === undefined ? {} : {
            parallel_tool_calls: parallelToolCalls
        },
        ...promptCacheKey === undefined ? {} : {
            prompt_cache_key: promptCacheKey
        },
        ...safetyIdentifier === undefined ? {} : {
            safety_identifier: safetyIdentifier
        }
    };
    return createKJModelAdapter({
        ...adapter,
        protocol: profile.protocol,
        chatTokenParameter: profile.chatTokenParameter,
        chatRequestExtensions: extensions
    });
}
