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
/** Explicit host-provided attachment. Wire support does not imply the selected model supports vision. */
export type KJModelImage = {
    readonly dataUrl: string;
} | {
    readonly mimeType: 'image/png' | 'image/jpeg';
    readonly base64: string;
};
export type KJModelInput = {
    readonly kind: 'prompt';
    readonly text: string;
    readonly images?: readonly KJModelImage[];
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
    /** Visible text fragments from a configured streaming response. Observer failures are isolated. */
    readonly onTextDelta?: (delta: string) => void;
    /** One observation per completed model turn, even when response parsing later fails. Exceptions are isolated. */
    readonly onUsage?: (usage: KJModelUsage) => void;
    /** Host may append exactly one prompt after a successful text-only turn. Defaults to false; never resumes after transport/protocol failure or while tool results are pending. */
    readonly allowTextContinuation?: boolean;
}
export interface KJModelRequest {
    readonly protocol: KJModelProtocol;
    readonly model: string;
    /** REST JSON body. Gemini's model belongs in the URL, not this body. */
    readonly body: Readonly<Record<string, unknown>>;
    /** Select a streaming transport operation. Gemini hosts use this to choose streamGenerateContent because its request body is unchanged. */
    readonly streaming: boolean;
    readonly signal: AbortSignal;
}
/** Bounded OpenAI-compatible request fields used by domestic model profiles. Reserved CAD/tool fields cannot be overridden. */
export interface KJChatRequestExtensions {
    /** Explicit host opt-in for compatible providers. Valid JSON is not evidence of answer correctness. */
    readonly response_format?: {
        readonly type: 'json_object';
    };
    readonly thinking?: {
        readonly type: 'enabled' | 'disabled';
        readonly keep?: 'all' | null;
    };
    readonly reasoning_effort?: 'low' | 'high' | 'max';
    readonly enable_thinking?: boolean;
    readonly tool_choice?: 'auto' | 'none' | 'required';
    readonly parallel_tool_calls?: boolean;
    readonly prompt_cache_key?: string;
    readonly safety_identifier?: string;
}
export interface KJModelAdapterOptions {
    protocol: KJModelProtocol;
    model: string;
    /** Trusted host transport owns credentials, endpoint allowlisting and HTTP errors; return parsed JSON or parsed JSON events for configured streaming. */
    request: (request: KJModelRequest) => Promise<unknown | AsyncIterable<unknown>>;
    maxOutputTokens?: number;
    /** Compatible endpoints differ; choose the field accepted by the selected model. */
    chatTokenParameter?: 'max_tokens' | 'max_completion_tokens';
    /** Strictly allowlisted provider fields. Model, messages, tools, token limits and streaming remain adapter-owned. */
    chatRequestExtensions?: KJChatRequestExtensions;
    /** Request and strictly assemble Chat Completions deltas. The transport parses SSE and yields each JSON data object. */
    chatStreaming?: boolean;
    /** Request and strictly assemble Responses API events. The transport parses SSE and yields each JSON data object. */
    responsesStreaming?: boolean;
    /** Request and strictly assemble Anthropic Messages events. The transport parses SSE and yields each JSON data object. */
    anthropicStreaming?: boolean;
    /** Strictly assemble Gemini streamGenerateContent responses. The host transport selects the streaming endpoint. */
    geminiStreaming?: boolean;
    /** Ask compatible endpoints for a final usage chunk; keep disabled for endpoints that reject stream_options. */
    chatStreamIncludeUsage?: boolean;
    /** Send tool_stream=true for compatible endpoints that require it for incremental tool arguments. */
    chatStreamToolCalls?: boolean;
    /** Maximum JSON bytes for a complete logical response and for each parsed streaming event. */
    maxResponseBytes?: number;
    /** Independent aggregate UTF-8 JSON budget for parsed streaming event envelopes; defaults to 8 MiB and cannot exceed 8 MiB. The host transport must separately bound raw SSE framing. */
    maxStreamBytes?: number;
    /** Maximum parsed events or chunks accepted for one streamed response. */
    maxStreamEvents?: number;
    maxHistoryBytes?: number;
    /** Opt-in wire-only reuse of byte-identical successful read receipts with identical arguments in this conversation. The first complete receipt and all host tool outputs are retained. Never deduplicates proposals, errors or changed read results. */
    reuseReadResultReferences?: boolean;
    /** Adapter-wide visible text observer, including runs created through runKJAgentTask. Exceptions are isolated. */
    onTextDelta?: (delta: string) => void;
    /** Host-only observer; contains counters and timing, never response text or credentials. Exceptions are isolated. */
    onUsage?: (usage: KJModelUsage) => void;
}
/** Safe budget diagnostics. Does not contain model text, drawing data or transport credentials. */
export interface KJModelSizeLimitDetails {
    readonly phase: 'request-extensions' | 'tool-schema' | 'request' | 'response' | 'stream' | 'image';
    readonly actualBytes: number;
    readonly maxBytes: number;
}
export declare class KJModelError extends KJDrawError {
    constructor(code: string, message: string, details?: KJModelSizeLimitDetails);
}
/** Four wire formats, one CAD tool schema. This adapter never fetches, approves edits or selects a model. */
export declare function createKJModelAdapter(options: KJModelAdapterOptions): KJAgentModel;
