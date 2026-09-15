import { type KJAgentModel, type KJModelAdapterOptions } from './model-adapters.js';
export type KJDomesticModelProvider = 'deepseek' | 'kimi' | 'qwen';
export type KJDomesticReasoningMode = 'provider-default' | 'enabled' | 'disabled';
export type KJDomesticReasoningEffort = 'low' | 'high' | 'max';
export interface KJDomesticModelProfile {
    readonly provider: KJDomesticModelProvider;
    readonly profileVersion: '1.0.0';
    readonly protocol: 'chat-completions';
    readonly defaultBaseURL: string;
    readonly chatCompletionsPath: '/chat/completions';
    readonly credentialEnvironmentVariable: string;
    readonly chatTokenParameter: 'max_tokens' | 'max_completion_tokens';
    readonly supports: {
        readonly toolCalls: true;
        readonly reasoningHistory: true;
        readonly thinkingToggle: boolean;
        readonly reasoningEffort: boolean;
        readonly preservedThinkingSwitch: boolean;
    };
}
export interface KJDomesticModelAdapterOptions extends Omit<KJModelAdapterOptions, 'protocol' | 'chatTokenParameter' | 'chatRequestExtensions'> {
    provider: KJDomesticModelProvider;
    reasoning?: {
        mode?: KJDomesticReasoningMode;
        effort?: KJDomesticReasoningEffort;
        /** Kimi-only request for thinking.keep="all". KJDraw always preserves returned reasoning_content in tool conversations. */
        preserve?: boolean;
    };
    toolChoice?: 'auto' | 'none' | 'required';
    parallelToolCalls?: boolean;
    /** Optional opaque session key for providers that support prompt caching. Never put credentials or user PII here. */
    promptCacheKey?: string;
    /** Optional host-generated pseudonymous user key; do not use a name or email address. */
    safetyIdentifier?: string;
}
export declare const KJDRAW_DOMESTIC_MODEL_PROFILES: Readonly<Record<KJDomesticModelProvider, KJDomesticModelProfile>>;
export declare function getKJDomesticModelProfile(provider: KJDomesticModelProvider): KJDomesticModelProfile;
export type KJDomesticModelWireOptions = Pick<KJDomesticModelAdapterOptions, 'reasoning' | 'toolChoice' | 'parallelToolCalls' | 'promptCacheKey' | 'safetyIdentifier'> & {
    model?: string;
};
/** Pure wire configuration shared by SDK hosts and the browser workbench. */
export declare function getKJDomesticModelAdapterSettings(provider: KJDomesticModelProvider, options?: KJDomesticModelWireOptions): Pick<KJModelAdapterOptions, 'protocol' | 'chatTokenParameter' | 'chatRequestExtensions'>;
/** Create one common CAD agent adapter with only the provider-specific Chat fields changed. Credentials remain in the host transport. */
export declare function createKJDomesticModelAdapter(options: KJDomesticModelAdapterOptions): KJAgentModel;
