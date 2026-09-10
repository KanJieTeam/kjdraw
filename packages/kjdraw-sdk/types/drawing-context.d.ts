import type { KJDocument } from './document.js';
export interface KJLayoutContextOptions {
    expectedRevision?: number;
    offset?: number;
    /** Default 20, maximum 100 layouts per page. */
    limit?: number;
    /** UTF-8 JSON result budget; default 16384, range 1024..262144. */
    maxBytes?: number;
}
export interface KJLayoutContextEntry {
    readonly id: string;
    readonly name: string | null;
    /** Feed this exact owner ID to createDrawingContext/cad_query_drawing. */
    readonly spaceId: string;
    readonly model: boolean;
    readonly active: boolean;
    readonly tabOrder: number | null;
    /** Numeric DXF fields only; printer/style/setup/view resource names are excluded. */
    readonly pageSettings: Readonly<Record<string, number>> | null;
    readonly omitted: readonly ('name' | 'page-settings')[];
}
export interface KJLayoutContext {
    readonly documentId: string;
    readonly revision: number;
    readonly layouts: readonly KJLayoutContextEntry[];
    readonly nextOffset: number | null;
    readonly truncated: boolean;
    readonly pageSemantics: {
        readonly physicalUnits: 'millimeter';
        readonly rotation: 'quarter-turns-counterclockwise';
        readonly windowCoordinates: 'drawing-units';
        readonly resourceNamesIncluded: false;
    };
    readonly limits: {
        readonly limit: number;
        readonly maxBytes: number;
    };
}
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
    /** Crossing rectangle [minX,minY,maxX,maxY] in owner XY. Unclassified geometry is retained and marked. */
    bounds?: readonly [number, number, number, number];
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
    readonly spatialMatch?: 'intersects' | 'unclassified';
}
export interface KJDrawingContext {
    readonly documentId: string;
    readonly revision: number;
    readonly units: string;
    readonly spaceId: string;
    readonly spatialQuery?: {
        readonly bounds: readonly [number, number, number, number];
        readonly coordinates: 'owner-xy';
        readonly mode: 'crossing';
        readonly unclassifiedIncluded: true;
    };
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
/** Read a bounded layout catalog without exposing raw payloads, external resource
 * names or native output preferences. This does not expand/project viewports or
 * authorize edits. Limits cover output bytes, not snapshot allocation/scan time. */
export declare function createLayoutContext(document: KJDocument, options?: KJLayoutContextOptions): KJLayoutContext;
/**
 * Build a model-neutral, immutable read result for a host's tool wrapper. This
 * reads a single KJDocument snapshot and never executes commands. The output
 * budget does not bound the document's initial snapshot allocation or scan time.
 * spaceId identifies the owner; stored coordinates may be OCS or block-local.
 * normal/extrusionDirection are retained without world-coordinate conversion.
 * No block expansion, paper-viewport visibility, semantic interpretation,
 * permission enforcement, or custom payload serialization is performed.
 */
export declare function createDrawingContext(document: KJDocument, options?: KJDrawingContextOptions): KJDrawingContext;
