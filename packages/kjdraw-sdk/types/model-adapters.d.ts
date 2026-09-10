import type { KJAgentToolDefinition, KJAgentToolResult } from './agent-tools.js';
import { KJDrawError } from './errors.js';
import { type KJModelUsage } from './model-usage.js';
export type KJModelProtocol = 'responses' | 'chat-completions' | 'anthropic-messages' | 'gemini-generate-content';
export interface KJModelToolCall {
    readonly id: string;
    readonly name: string;
    readonly arguments: unknown;
}
export interface KJModelToolOutput {
    readonly id: string;
    readonly name: string;
    readonly result: KJAgentToolResult;
}
export interface KJModelTurn {
    readonly text: string;
    readonly calls: readonly KJModelToolCall[];
    readonly usage?: KJModelUsage;
}
export type KJModelInput = {
    readonly kind: 'prompt';
    readonly text: string;
} | {
    readonly kind: 'tool-results';
    readonly results: readonly KJModelToolOutput[];
};
export interface KJModelConversation {
    next(input: KJModelInput, signal: AbortSignal): Promise<KJModelTurn>;
}
/** Custom models and framework/harness bridges implement this interface; no vendor SDK is required. */
export interface KJAgentModel {
    createConversation(options: KJModelConversationOptions): KJModelConversation;
}
export interface KJModelConversationOptions {
    readonly instructions: string;
    readonly tools: readonly KJAgentToolDefinition[];
    /** One observation per received transport response, even when response parsing later fails. Exceptions are isolated. */
    readonly onUsage?: (usage: KJModelUsage) => void;
}
export interface KJModelRequest {
    readonly protocol: KJModelProtocol;
    readonly model: string;
    /** REST JSON body. Gemini's model belongs in the URL, not this body. */
    readonly body: Readonly<Record<string, unknown>>;
    readonly signal: AbortSignal;
}
export interface KJModelAdapterOptions {
    protocol: KJModelProtocol;
    model: string;
    /** Trusted host transport owns credentials, endpoint allowlisting and HTTP errors; return parsed, non-streaming JSON. */
    request: (request: KJModelRequest) => Promise<unknown>;
    maxOutputTokens?: number;
    /** Compatible endpoints differ; choose the field accepted by the selected model. */
    chatTokenParameter?: 'max_tokens' | 'max_completion_tokens';
    maxResponseBytes?: number;
    maxHistoryBytes?: number;
    /** Host-only observer; contains counters and timing, never response text or credentials. Exceptions are isolated. */
    onUsage?: (usage: KJModelUsage) => void;
}
export declare class KJModelError extends KJDrawError {
    constructor(code: string, message: string);
}
/** Four wire formats, one CAD tool schema. This adapter never fetches, approves edits or selects a model. */
export declare function createKJModelAdapter(options: KJModelAdapterOptions): KJAgentModel;
