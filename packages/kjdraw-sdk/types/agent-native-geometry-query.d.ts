import { KJDocument } from './document.js';
import type { ReadonlyDeep } from './utils.js';
export type KJNativeCurveVisibility = 'include-hidden' | 'visible-only';
export type KJNativeCurveTypeScope = 'all-owner-entities' | 'finite-line-circle-only';
export type KJNativeCurveUnsupportedPolicy = 'reject' | 'diagnostics';
/** Internal read utility, not a registered agent tool. Units are the native
 * model-space document units; paper/block units are deliberately unsupported. */
export interface KJNativeCurveQueryOptions {
    documentId: string;
    expectedRevision: number;
    ownerId: string;
    units: string;
    ownerPolicy: 'model-space-only';
    visibility: KJNativeCurveVisibility;
    typeScope: KJNativeCurveTypeScope;
    unsupportedPolicy: KJNativeCurveUnsupportedPolicy;
    offset: number;
    limit: number;
    /** Entire live owner entity count, including explicitly excluded entities.
     * Bounds query work, not allocation performed by document.snapshot(). */
    maxEntities: number;
    maxBytes: number;
}
export interface KJNativeCurveNeighborhoodOptions extends KJNativeCurveQueryOptions {
    anchorId: string;
    radius: number;
    metric: 'text-insertion-to-finite-native-xy-curve';
    boundary: 'inclusive';
}
export interface KJNativeXYBounds {
    min: readonly [number, number];
    max: readonly [number, number];
}
export interface KJNativeCurveDiagnostic {
    id: string;
    handle: string;
    type: string;
    reason: string;
}
export interface KJNativeCurveRow {
    id: string;
    handle: string;
    ownerId: string;
    layerId: string;
    type: 'LINE' | 'CIRCLE';
    visible: boolean;
    bounds: KJNativeXYBounds;
}
export interface KJNativeCurveDistanceRow extends KJNativeCurveRow {
    distance: number;
    closestPoint: readonly [number, number] | null;
    closestPointUnique: boolean;
}
export interface KJNativeCurveQueryPage<Row extends KJNativeCurveRow> {
    kind: 'native-curve-bounds' | 'native-curve-neighborhood';
    documentId: string;
    revision: number;
    ownerId: string;
    units: string;
    ownerPolicy: 'model-space-only';
    visibility: KJNativeCurveVisibility;
    typeScope: KJNativeCurveTypeScope;
    method: 'native-analytic-owner-xy-centerline-curves-v1';
    numericalPolicy: 'binary64-no-selection-tolerance';
    inspectedOwnerEntityCount: number;
    eligibleCurveCount: number;
    excludedCounts: {
        hidden: number;
        otherTypes: number;
        anchor: number;
    };
    scopeComplete: boolean;
    /** True only when this response contains every result, from offset 0.
     * Otherwise traverse nextOffset at the exact same identity/revision/options. */
    complete: boolean;
    offset: number;
    nextOffset: number | null;
    totalResultCount: number | null;
    rows: readonly Row[];
    diagnostics: readonly KJNativeCurveDiagnostic[];
}
export interface KJNativeCurveBoundsPage extends KJNativeCurveQueryPage<KJNativeCurveRow> {
    /** Full declared curve scope bounds, never text/display/stroke/3D extents.
     * Null for an empty or unsupported scope; scopeComplete distinguishes them. */
    bounds: KJNativeXYBounds | null;
}
export interface KJNativeCurveNeighborhoodPage extends KJNativeCurveQueryPage<KJNativeCurveDistanceRow> {
    anchor: {
        id: string;
        handle: string;
        ownerId: string;
        type: 'TEXT';
        position: readonly [number, number];
        visible: boolean;
    };
    radius: number;
    metric: 'text-insertion-to-finite-native-xy-curve';
    boundary: 'inclusive';
}
/** Native analytic finite LINE/CIRCLE curve bounds, not displayed glyph/stroke
 * bounds or full-drawing/XYZ extents. Every selected owner is inspected before
 * paging, so unsupported geometry outside the returned page cannot hide. */
export declare function queryNativeCurveBounds(document: KJDocument, options: KJNativeCurveQueryOptions): ReadonlyDeep<KJNativeCurveBoundsPage>;
/** Exact declared binary64 owner-XY metric, no selection epsilon. Candidate
 * universe is explicit; no label is promoted into a borehole/industry fact. */
export declare function queryNativeCurveNeighborhood(document: KJDocument, options: KJNativeCurveNeighborhoodOptions): ReadonlyDeep<KJNativeCurveNeighborhoodPage>;
