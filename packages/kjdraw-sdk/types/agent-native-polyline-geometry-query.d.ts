import { KJDocument } from './document.js';
import type { ReadonlyDeep } from './utils.js';
/** Internal native read utility, not an agent tool or whole-drawing extent API.
 * Autodesk DXF LWPOLYLINE 42 is tan(signed included angle / 4), 70 has only
 * Closed=1/Plinegen=128. The last vertex bulge is not an edge in an open curve.
 * https://help.autodesk.com/cloudhelp/2026/ENU/OARX-ManagedRefGuide/files/OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Polyline_GetBulgeAt_int.html
 * https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm
 */
export interface KJNativePolylineQueryOptions {
    documentId: string;
    expectedRevision: number;
    ownerId: string;
    units: string;
    ownerPolicy: 'model-space-only';
    visibility: 'include-hidden' | 'visible-only';
    typeScope: 'all-owner-entities' | 'lwpolyline-centerline-only';
    unsupportedPolicy: 'reject' | 'diagnostics';
    closedPolicy: 'native-closed-flag';
    widthPolicy: 'centerline-only';
    offset: number;
    limit: number;
    /** Entire live model owner, including hidden and type-excluded entities. */
    maxEntities: number;
    /** Total edges of the declared visible/type-eligible polyline scope. */
    maxEdges: number;
    maxBytes: number;
}
export interface KJNativePolylineNeighborhoodOptions extends KJNativePolylineQueryOptions {
    anchorId: string;
    radius: number;
    metric: 'text-insertion-to-finite-native-xy-polyline';
    boundary: 'inclusive';
}
export interface KJNativePolylineXYBounds {
    min: readonly [number, number];
    max: readonly [number, number];
}
export interface KJNativePolylineDiagnostic {
    id: string;
    handle: string;
    type: string;
    reason: string;
}
export interface KJNativePolylineRow {
    id: string;
    handle: string;
    ownerId: string;
    layerId: string;
    type: 'LWPOLYLINE';
    visible: boolean;
    closed: boolean;
    vertexCount: number;
    edgeCount: number;
    arcEdgeCount: number;
    openTerminalBulgeIgnored: boolean;
    widthPolicy: 'centerline-only';
    bounds: KJNativePolylineXYBounds;
}
export interface KJNativePolylineDistanceRow extends KJNativePolylineRow {
    distance: number;
    /** Null when different closest native points, or an entire arc, tie. */
    closestPoint: readonly [number, number] | null;
    closestPointUnique: boolean;
    closestEdgeIndices: readonly number[];
}
export interface KJNativePolylineQueryPage<Row extends KJNativePolylineRow> {
    kind: 'native-polyline-bounds' | 'native-polyline-neighborhood';
    documentId: string;
    revision: number;
    ownerId: string;
    units: string;
    ownerPolicy: 'model-space-only';
    visibility: KJNativePolylineQueryOptions['visibility'];
    typeScope: KJNativePolylineQueryOptions['typeScope'];
    closedPolicy: 'native-closed-flag';
    widthPolicy: 'centerline-only';
    method: 'native-analytic-owner-xy-polyline-centerline-v1';
    numericalPolicy: 'binary64-analytic-no-selection-tolerance';
    inspectedOwnerEntityCount: number;
    inspectedPolylineEdgeCount: number;
    eligiblePolylineCount: number;
    excludedCounts: {
        hidden: number;
        otherTypes: number;
        anchor: number;
    };
    scopeComplete: boolean;
    /** Complete only for an offset-zero response containing all scope rows. */
    complete: boolean;
    offset: number;
    nextOffset: number | null;
    totalResultCount: number | null;
    rows: readonly Row[];
    diagnostics: readonly KJNativePolylineDiagnostic[];
}
export interface KJNativePolylineBoundsPage extends KJNativePolylineQueryPage<KJNativePolylineRow> {
    /** Full declared centerline scope only; excludes stroke, glyphs and 3D. */
    bounds: KJNativePolylineXYBounds | null;
}
export interface KJNativePolylineNeighborhoodPage extends KJNativePolylineQueryPage<KJNativePolylineDistanceRow> {
    anchor: {
        id: string;
        handle: string;
        ownerId: string;
        type: 'TEXT';
        position: readonly [number, number];
        visible: boolean;
    };
    radius: number;
    metric: 'text-insertion-to-finite-native-xy-polyline';
    boundary: 'inclusive';
}
/** Analytic LINE/bulge-ARC edges of genuine LWPOLYLINE records. Native XY
 * centerlines only: no geometry tessellation, stroke/glyph extents or industry facts. */
export declare function queryNativePolylineBounds(document: KJDocument, options: KJNativePolylineQueryOptions): ReadonlyDeep<KJNativePolylineBoundsPage>;
/** Actual same-owner TEXT insertion point to the complete finite polyline
 * centerline. A closed outline is not treated as a filled region or hole fact. */
export declare function queryNativePolylineNeighborhood(document: KJDocument, options: KJNativePolylineNeighborhoodOptions): ReadonlyDeep<KJNativePolylineNeighborhoodPage>;
