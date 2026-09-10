import type { KJDrawSDK } from './sdk.js';
import type { KJDocument } from './document.js';
import { type KJDrawingContextOptions } from './drawing-context.js';
export type { KJAgentDrawingInput, KJAgentPoint } from './agent-drawing.js';
export type { KJAgentGeometryPreview, KJAgentPreviewEntity } from './agent-preview.js';
export interface KJAgentDrawingQuery {
    expectedRevision: number;
    filters: Pick<KJDrawingContextOptions, 'ids' | 'types' | 'layerIds' | 'spaceId' | 'includeHidden' | 'bounds'>;
    offset: number;
    layerOffset: number;
    limit: number;
    maxLayers: number;
    maxBytes: number;
}
export interface KJAgentLayoutQuery {
    expectedRevision: number;
    offset: number;
    limit: number;
    maxBytes: number;
}
export interface KJAgentToolSchema {
    readonly type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
    readonly properties?: Readonly<Record<string, KJAgentToolSchema>>;
    readonly required?: readonly string[];
    readonly additionalProperties?: false;
    readonly items?: KJAgentToolSchema;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly exclusiveMinimum?: number;
    readonly minItems?: number;
    readonly maxItems?: number;
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly enum?: readonly string[];
}
export interface KJAgentToolDefinition {
    readonly name: string;
    readonly description: string;
    /** JSON Schema; provider adapters must preserve validation semantics. */
    readonly inputSchema: KJAgentToolSchema;
    readonly effect: 'read' | 'propose';
}
export type KJAgentToolResult = {
    readonly ok: true;
    readonly value: unknown;
} | {
    readonly ok: false;
    readonly error: {
        readonly code: string;
        readonly message: string;
    };
};
export declare const KJDRAW_AGENT_TOOLS: readonly KJAgentToolDefinition[];
/** Model-neutral starter tools. Bind one authorized document per session.
 * Only definitions/call belong in the model adapter. approve/reject are trusted
 * host operations, not model-callable tools and not authentication mechanisms.
 */
export declare class KJAgentToolSession {
    #private;
    /** Bind unit schemas to the drawing so models see its canonical unit name. */
    get definitions(): readonly KJAgentToolDefinition[];
    constructor(sdk: KJDrawSDK, document: KJDocument);
    call(name: string, input: unknown): Promise<KJAgentToolResult>;
    /** Invoke only after an authenticated host collected review of these exact arguments. */
    approve(planId: string, reviewerId: string): Promise<KJAgentToolResult>;
    reject(planId: string, reviewerId: string): KJAgentToolResult;
}
