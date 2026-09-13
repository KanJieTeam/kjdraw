import type { KJDocument } from './document.js';
import type { KJTransaction } from './transaction.js';
export type KJDrawingValidationFeature = 'start' | 'end' | 'center' | 'origin' | 'vertex';
export interface KJDrawingValidationPointReference {
    objectId: string;
    feature: KJDrawingValidationFeature;
    vertexIndex?: number;
}
export type KJDrawingValidationCheck = {
    id: string;
    kind: 'line-length' | 'circle-radius' | 'ellipse-major-radius' | 'ellipse-minor-radius' | 'spline-length' | 'dimension-measurement';
    objectId: string;
    expected: number;
    tolerance: number;
} | {
    id: string;
    kind: 'point-distance';
    from: KJDrawingValidationPointReference;
    to: KJDrawingValidationPointReference;
    expected: number;
    tolerance: number;
} | {
    id: string;
    kind: 'polyline-closed';
    objectId: string;
    expected: boolean;
    tolerance: 0;
} | {
    id: string;
    kind: 'polyline-vertex-count';
    objectId: string;
    expected: number;
    tolerance: 0;
} | {
    id: string;
    kind: 'polyline-segment-bulge';
    objectId: string;
    segmentIndex: number;
    expected: number;
    tolerance: number;
};
export interface KJDrawingValidationInput {
    expectedRevision: number;
    units: string;
    checks: readonly KJDrawingValidationCheck[];
}
export interface KJDrawingValidationReference {
    readonly objectId: string;
    readonly ownerId: string;
    readonly feature?: KJDrawingValidationFeature;
    readonly vertexIndex?: number;
    readonly segmentIndex?: number;
}
export interface KJDrawingValidationCheckResult {
    readonly id: string;
    readonly kind: KJDrawingValidationCheck['kind'];
    readonly actual: number | boolean;
    readonly expected: number | boolean;
    readonly error: number;
    readonly tolerance: number;
    readonly passed: boolean;
    readonly references: readonly KJDrawingValidationReference[];
}
export interface KJDrawingValidationResult {
    readonly documentId: string;
    readonly revision: number;
    readonly units: string;
    readonly passed: boolean;
    readonly checks: readonly KJDrawingValidationCheckResult[];
}
/** Check explicit requirements against actual native geometry. No edits, inferred constraints or INSERT expansion. */
export declare function validateDrawingGeometry(document: KJDocument, input: KJDrawingValidationInput): KJDrawingValidationResult;
/** Trusted transaction-only validation of the candidate revision before it is committed. */
export declare function validateDrawingGeometryTransaction(document: KJDocument, tx: KJTransaction, input: KJDrawingValidationInput): KJDrawingValidationResult;
