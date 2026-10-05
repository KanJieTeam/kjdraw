import { type KJPlanarBoundaryRequest, type KJPlanarBoundaryPreview } from './planar-boundaries.js';
import type { KJContourBackendOptions } from './geometry/contour-wasm.js';
import type { KJDocument } from './document.js';
import type { KJCommandEnvelopeContext } from './commands.js';
export interface KJPlanarBoundaryEditRequest extends KJPlanarBoundaryRequest {
    /** Required digest from the complete, read-only boundary preview. */
    readonly expectedGeometryDigest: string;
}
export interface KJPlanarBoundaryApplyOptions extends KJContourBackendOptions {
    readonly author?: unknown;
    readonly commandEnvelope?: KJCommandEnvelopeContext | null;
}
export interface KJPlanarBoundaryEditResult extends KJPlanarBoundaryPreview {
    readonly resultIds: readonly string[];
    readonly revisionAfter: number;
}
/** Create reviewed native boundaries, retaining every source entity unchanged. */
export declare function applyPlanarBoundaryExtraction(document: KJDocument, input: KJPlanarBoundaryEditRequest, options?: KJPlanarBoundaryApplyOptions): Promise<KJPlanarBoundaryEditResult>;
