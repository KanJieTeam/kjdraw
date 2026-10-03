import { type KJContourBackendOptions } from './geometry/contour-wasm.js';
import type { KJDocument } from './document.js';
import type { KJCommandEnvelopeContext } from './commands.js';
export type { KJContourBackendOptions } from './geometry/contour-wasm.js';
export type KJPlanarContourOperation = 'offset' | 'union' | 'intersection' | 'difference';
export interface KJPlanarContourVertex {
    readonly point: readonly [number, number, number];
    /** Native DXF bulge. Major arcs are split into native arcs by the kernel. */
    readonly bulge?: number;
}
export interface KJPlanarContour {
    readonly closed: true;
    readonly vertices: readonly KJPlanarContourVertex[];
}
export interface KJPlanarContourRequest {
    readonly operation: KJPlanarContourOperation;
    /** Offset: CCW exterior rings and CW holes. Boolean: exactly two simple regions. */
    readonly contours: readonly KJPlanarContour[];
    /** Signed drawing-unit distance. Positive expands the filled region; negative erodes it. */
    readonly distance?: number;
    /** Absolute drawing-unit tolerance; defaults to 1e-7. */
    readonly tolerance?: number;
}
export interface KJPlanarContourResult extends KJPlanarContour {
    readonly area: number;
    readonly hole: boolean;
}
export interface KJPlanarContourReceipt {
    readonly schema: 'kjdraw.planar-contours.v1';
    readonly backend: 'cavalier-contours-wasm';
    readonly abi: string;
    readonly operation: KJPlanarContourOperation;
    /** Total caller-requested absolute boundary tolerance, including source conversion. */
    readonly tolerance: number;
    /** Conservative boundary error from converting source CIRCLE entities to native arcs. */
    readonly sourceBoundaryError: number;
    /** Remaining absolute tolerance passed to the native kernel. */
    readonly backendTolerance: number;
    /** Stable change-detection hashes, not signatures or publisher authentication. */
    readonly inputDigest: string;
    readonly geometryDigest: string;
    readonly resultCount: number;
}
export interface KJPlanarContourGeometry {
    readonly contours: readonly KJPlanarContourResult[];
    readonly area: number;
    readonly receipt: KJPlanarContourReceipt;
}
export interface KJPlanarContourEditRequest {
    readonly operation: KJPlanarContourOperation;
    readonly ids: readonly string[];
    readonly units: string;
    readonly expectedRevision: number;
    readonly distance?: number;
    readonly tolerance?: number;
    /** Bind a commit to a previously reviewed geometry receipt. */
    readonly expectedGeometryDigest?: string;
}
export interface KJPlanarContourPreview extends KJPlanarContourGeometry {
    readonly sourceIds: readonly string[];
    readonly sourceDigest: string;
    readonly units: string;
    readonly revisionBefore: number;
}
export interface KJPlanarContourEditResult extends KJPlanarContourPreview {
    readonly resultIds: readonly string[];
    readonly revisionAfter: number;
}
export interface KJPlanarContourApplyOptions extends KJContourBackendOptions {
    readonly author?: unknown;
    /** Host-supplied provenance only; it cannot replace the operation or geometry receipt. */
    readonly commandEnvelope?: KJCommandEnvelopeContext | null;
}
/** Pure native contour computation. It never reads or modifies a document. */
export declare function computePlanarContours(input: KJPlanarContourRequest, options?: KJContourBackendOptions): Promise<KJPlanarContourGeometry>;
/** Read-only preview: source records, revision, serialization and undo history are unchanged. */
export declare function previewPlanarContourEdit(document: KJDocument, request: KJPlanarContourEditRequest, options?: KJContourBackendOptions): Promise<KJPlanarContourPreview>;
/** Preserve every source; create all result rings as native bulged polylines in one transaction. */
export declare function applyPlanarContourEdit(document: KJDocument, input: KJPlanarContourEditRequest, options?: KJPlanarContourApplyOptions): Promise<KJPlanarContourEditResult>;
