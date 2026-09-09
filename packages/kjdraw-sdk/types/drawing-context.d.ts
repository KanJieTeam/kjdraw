import type { KJDocument } from './document.js';
export interface KJDrawingContextOptions {
    /** Exact object IDs; duplicates are ignored. Filters are combined with AND. */
    ids?: readonly string[];
    /** Case-insensitive native entity types, for example LINE or ARC. */
    types?: readonly string[];
    layerIds?: readonly string[];
    /** A live block record; defaults to model space. INSERTs are not expanded. */
    spaceId?: string;
    /** Hidden and frozen entities are excluded by default. Locked entities remain visible. */
    includeHidden?: boolean;
    expectedRevision?: number;
    /** Matching entity offset. Continuations require expectedRevision and the same filters. */
    offset?: number;
    /** Registered layer offset, after layerIds filtering. */
    layerOffset?: number;
    /** 0 disables entities; default 50, maximum 200. */
    limit?: number;
    /** 0 disables the layer catalog; default 50, maximum 100. */
    maxLayers?: number;
    /** Maximum UTF-8 bytes of JSON.stringify(result); default 65536, range 1024..262144. */
    maxBytes?: number;
}
/** Explicit recursion keeps geometry property access usable without a deep mapped type. */
export type KJDrawingContextValue = null | boolean | number | string | readonly KJDrawingContextValue[] | {
    readonly [key: string]: KJDrawingContextValue;
};
export type KJDrawingGeometryOmittedReason = 'unsupported-type' | 'unsupported-data' | 'geometry-budget' | 'response-budget';
export type KJDrawingContextTruncationReason = 'entity-limit' | 'layer-limit' | 'response-budget' | 'geometry-budget' | 'unsupported-geometry';
export interface KJDrawingContextLayer {
    readonly id: string;
    readonly name: string | null;
    readonly visible: boolean;
    readonly frozen: boolean;
    readonly locked: boolean;
    /** Visibility and locking eligibility only; this is not an authorization decision. */
    readonly editable: boolean;
}
export interface KJDrawingContextEntity {
    readonly id: string;
    readonly type: string;
    readonly ownerId: string | null;
    readonly layerId: string | null;
    readonly visible: boolean;
    /** Visibility and locking eligibility only; command support is not implied. */
    readonly editable: boolean;
    /** Allowlisted stored geometry; coordinates may be OCS or block-local, with native units/angles. */
    readonly geometry: {
        readonly [key: string]: KJDrawingContextValue;
    } | null;
    readonly geometryOmittedReason: KJDrawingGeometryOmittedReason | null;
}
export interface KJDrawingContext {
    readonly documentId: string;
    readonly revision: number;
    readonly units: string;
    readonly spaceId: string;
    readonly layers: readonly KJDrawingContextLayer[];
    readonly entities: readonly KJDrawingContextEntity[];
    /** True when either collection or any requested native geometry was omitted. */
    readonly truncated: boolean;
    readonly truncationReasons: readonly KJDrawingContextTruncationReason[];
    readonly nextOffset: number | null;
    readonly nextLayerOffset: number | null;
    readonly limits: {
        readonly limit: number;
        readonly maxLayers: number;
        readonly maxBytes: number;
        readonly maxGeometryBytes: number;
    };
}
/**
 * Build a model-neutral, immutable read result for a host's tool wrapper. This
 * reads a single KJDocument snapshot and never executes commands. The output
 * budget does not bound the document's initial snapshot allocation or scan time.
 * spaceId identifies the owner; stored coordinates may be OCS or block-local.
 * normal/extrusionDirection are retained without world-coordinate conversion.
 * No block expansion, viewport-specific visibility, semantic interpretation,
 * permission enforcement, or custom payload serialization is performed.
 */
export declare function createDrawingContext(document: KJDocument, options?: KJDrawingContextOptions): KJDrawingContext;
