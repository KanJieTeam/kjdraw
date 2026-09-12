import type { KJDrawSDK } from './sdk.js';
import type { KJDocument } from './document.js';
import { type KJDrawingContextOptions } from './drawing-context.js';
import { type KJAgentRoadDrawingInput } from './agent-road-drawing.js';
import { type KJRestoredRoadDrawingRecipe } from './road-drawing-recipe.js';
import { type KJAgentInputAssetDescriptor, type KJAgentInputAssetReference } from './input-assets.js';
export { KJDRAW_ROAD_INPUT_ASSET_SCHEMA } from './input-assets.js';
export type { KJAgentInputAssetDescriptor, KJAgentInputAssetReference, KJAgentInputAssetRegistration } from './input-assets.js';
export type KJAgentRoadDrawingFromAssetInput = Pick<KJAgentRoadDrawingInput, 'expectedRevision' | 'units' | 'drawingId' | 'title' | 'profileScale' | 'sectionScale' | 'textHeight' | 'sectionColumns' | 'precision'> & KJAgentInputAssetReference;
import type { ReadonlyDeep } from './utils.js';
export type { KJAgentRoadRevisionInput, KJAgentRoadRevisionProposal } from './agent-road-revision.js';
export type { KJAgentRoadDrawingInput } from './agent-road-drawing.js';
import { type KJAgentAnnotationInput } from './agent-annotations.js';
import { type KJAgentCompactDrawingInput } from './agent-drawing-compact.js';
import { type KJRectangularDrawingPattern } from './agent-drawing-patterns.js';
import { type KJDrawingValidationPointReference } from './drawing-validation.js';
export type { KJAgentDrawingInput, KJAgentPoint } from './agent-drawing.js';
export type { KJAgentCompactDrawingInput } from './agent-drawing-compact.js';
export type { KJAgentGeometryPreview, KJAgentPreviewEntity } from './agent-preview.js';
export interface KJAgentPatternDrawingInput extends KJAgentCompactDrawingInput {
    arrays: (KJRectangularDrawingPattern & {
        sources: string[];
    })[];
}
/** One reviewed batch of geometry, notes and kernel-measured native dimensions. */
export interface KJAgentAnnotatedDrawingInput extends KJAgentPatternDrawingInput {
    styles: {
        name: string;
        sources: string[];
        pattern: number[];
        color: number;
        lineweight: number;
    }[];
    texts: KJAgentAnnotationInput['texts'];
    alignedDimensions: Omit<Extract<KJAgentAnnotationInput['dimensions'][number], {
        type: 'ALIGNED';
    }>, 'type'>[];
    rotatedDimensions: Omit<Extract<KJAgentAnnotationInput['dimensions'][number], {
        type: 'ROTATED';
    }>, 'type'>[];
    radiusDimensions: Omit<Extract<KJAgentAnnotationInput['dimensions'][number], {
        type: 'RADIUS' | 'DIAMETER';
    }>, 'type'>[];
    diameterDimensions: Omit<Extract<KJAgentAnnotationInput['dimensions'][number], {
        type: 'RADIUS' | 'DIAMETER';
    }>, 'type'>[];
    /** Optional for existing callers. Position selects the native angular arc sector. */
    angularDimensions?: Omit<Extract<KJAgentAnnotationInput['dimensions'][number], {
        type: 'ANGULAR_3_POINT';
    }>, 'type'>[];
}
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
export interface KJAgentGeometryValidationInput {
    expectedRevision: number;
    units: string;
    lineLengths: {
        id: string;
        objectId: string;
        expected: number;
        tolerance: number;
    }[];
    circleRadii: {
        id: string;
        objectId: string;
        expected: number;
        tolerance: number;
    }[];
    pointDistances: {
        id: string;
        from: KJDrawingValidationPointReference;
        to: KJDrawingValidationPointReference;
        expected: number;
        tolerance: number;
    }[];
    polylineClosures: {
        id: string;
        objectId: string;
        expected: boolean;
    }[];
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
    /** Read-only identity used to bind persisted tasks to this exact drawing. */
    get documentId(): string;
    get revision(): number;
    get units(): string;
    /** Bind unit schemas to the drawing so models see its canonical unit name. */
    get definitions(): readonly KJAgentToolDefinition[];
    constructor(sdk: KJDrawSDK, document: KJDocument);
    /** Trusted host operation: verify saved parameters against all current generated objects.
     * Registration is bound to this exact document revision and is not model-callable. */
    registerRoadDrawingRecipe(recipe: unknown): Promise<ReadonlyDeep<KJRestoredRoadDrawingRecipe>>;
    /** Host-only registration of explicitly selected data. Assets belong to this
     * exact session/document instance; they are never loaded by model paths or URLs. */
    registerInputAsset(input: unknown): Promise<ReadonlyDeep<KJAgentInputAssetDescriptor>>;
    call(name: string, input: unknown): Promise<KJAgentToolResult>;
    /** Invoke only after an authenticated host collected review of these exact arguments. */
    approve(planId: string, reviewerId: string): Promise<KJAgentToolResult>;
    reject(planId: string, reviewerId: string): KJAgentToolResult;
}
