import { type KJContourBackendOptions } from './geometry/contour-wasm.js';
import type { KJDocument } from './document.js';
import type { KJObjectPayload } from './schema.js';
import type { KJPlanarContour } from './planar-contours.js';
export interface KJPlanarBoundaryRequest {
    readonly ids: readonly string[];
    readonly units: string;
    readonly expectedRevision: number;
    /** Absolute ambiguity/geometry tolerance, in drawing units. No gap is snapped. */
    readonly tolerance?: number;
}
export type KJPlanarBoundaryDiagnosticCode = 'open-chain' | 'branch' | 'near-endpoint' | 'self-intersection' | 'boundary-intersection' | 'incompatible-style' | 'precision';
export interface KJPlanarBoundaryDiagnostic {
    readonly code: KJPlanarBoundaryDiagnosticCode;
    readonly sourceIds: readonly string[];
    readonly message: string;
    readonly points: readonly (readonly [number, number, number])[];
}
/** One entry per output segment. A reversed entry traverses the source backwards. */
export interface KJPlanarBoundarySegment {
    readonly sourceId: string;
    readonly sourceSegmentIndex: number;
    readonly reversed: boolean;
}
export interface KJPlanarBoundary extends KJPlanarContour {
    readonly area: number;
    readonly hole: boolean;
    readonly depth: number;
    readonly sourceIds: readonly string[];
    readonly segments: readonly KJPlanarBoundarySegment[];
    readonly ownerId: string | null;
    readonly style: Readonly<KJObjectPayload>;
    /** Boundary error bound for ARC/CIRCLE-to-bulge conversion, not an offset budget. */
    readonly sourceBoundaryError: number;
}
export interface KJPlanarBoundaryPreview {
    readonly contours: readonly KJPlanarBoundary[];
    readonly diagnostics: readonly KJPlanarBoundaryDiagnostic[];
    /** False if any selected geometry was unresolved. Never apply a partial selection implicitly. */
    readonly complete: boolean;
    readonly area: number;
    readonly sourceIds: readonly string[];
    readonly sourceDigest: string;
    readonly units: string;
    readonly revisionBefore: number;
    readonly receipt: {
        readonly schema: 'kjdraw.planar-boundaries.v1';
        readonly tolerance: number;
        readonly inputDigest: string;
        readonly geometryDigest: string;
        readonly sourceBoundaryError: number;
    };
}
/** Read-only extraction. Exact endpoints connect; near endpoints are reported, never moved. */
export declare function previewPlanarBoundaries(document: KJDocument, input: KJPlanarBoundaryRequest, options?: KJContourBackendOptions): Promise<KJPlanarBoundaryPreview>;
