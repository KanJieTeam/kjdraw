import type { KJModelProtocol } from './model-adapters.js';
export type KJModelUsageSource = 'reported' | 'sum-components' | null;
export interface KJModelUsage {
    readonly protocol: KJModelProtocol;
    /** Inclusive input, including cache reads and writes. Null means unavailable or invalid. */
    readonly inputTokens: number | null;
    /** Inclusive output, including reasoning. Null means unavailable or invalid. */
    readonly outputTokens: number | null;
    readonly totalTokens: number | null;
    readonly inputTokensSource: KJModelUsageSource;
    readonly outputTokensSource: KJModelUsageSource;
    readonly totalTokensSource: KJModelUsageSource;
    /** Original provider counters: Anthropic input excludes caches; Gemini output excludes thoughts. */
    readonly reportedInputTokens: number | null;
    readonly reportedOutputTokens: number | null;
    readonly reportedTotalTokens: number | null;
    readonly cacheReadInputTokens: number | null;
    /** Explicitly reported uncached input (DeepSeek Chat); never inferred by subtraction. */
    readonly cacheMissInputTokens: number | null;
    readonly cacheWriteInputTokens: number | null;
    readonly reasoningOutputTokens: number | null;
    /** Gemini's separately reported tool-use prompt count; never added to input a second time. */
    readonly toolUsePromptTokens: number | null;
    /** Host-observed transport-call wall time, including network/server work but excluding CAD execution. */
    readonly latencyMs: number | null;
    readonly latencyScope: 'transport-wall' | null;
    /** Known field paths with invalid types, unsafe values, overflow or inconsistent totals. No payloads. */
    readonly invalidFields: readonly string[];
}
export declare function extractKJModelUsage(protocol: KJModelProtocol, response: unknown, { latencyMs }?: {
    latencyMs?: number | null;
}): KJModelUsage;
