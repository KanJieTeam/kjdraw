import type { KJObjectPayload } from '../schema.js';
interface Entity {
    readonly type?: unknown;
    readonly payload?: unknown;
}
export interface KJSplineBreakOptions {
    readonly point?: unknown;
    readonly firstPoint?: unknown;
    readonly secondPoint?: unknown;
    readonly points?: readonly unknown[];
    /** Native knot-domain parameter(s), never a normalized length fraction. */
    readonly parameter?: unknown;
    readonly parameters?: unknown;
    readonly tolerance?: unknown;
}
export interface KJSplineTrimOptions {
    readonly tolerance?: unknown;
    /** Resolve a self-crossing pick in the native knot domain. */
    readonly pickParameter?: unknown;
}
export declare function breakNativeSplinePayloads(input: unknown, options?: KJSplineBreakOptions): KJObjectPayload[];
export declare function trimNativeSplinePayloads(input: unknown, boundaries: readonly Entity[], pickPoint: unknown, options?: KJSplineTrimOptions): KJObjectPayload[];
export {};
