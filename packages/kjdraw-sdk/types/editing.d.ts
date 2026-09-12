import type { Point3 } from './geometry/index.js';
import type { KJObjectPayload } from './schema.js';
import type { ReadonlyDeep } from './utils.js';
export interface KJEditingEntity {
    readonly type?: unknown;
    readonly payload?: ReadonlyDeep<KJObjectPayload>;
}
export interface KJOffsetOptions {
    readonly side?: unknown;
    readonly sidePoint?: unknown;
}
export interface KJBreakOptions {
    readonly point?: unknown;
    readonly firstPoint?: unknown;
    readonly secondPoint?: unknown;
    readonly points?: readonly unknown[];
    readonly tolerance?: unknown;
}
export interface KJLinePairOptions {
    readonly pickPoint1?: unknown;
    readonly pickPoint2?: unknown;
    readonly distance?: unknown;
    readonly distance1?: unknown;
    readonly distance2?: unknown;
    readonly radius?: unknown;
}
export interface KJDerivedEntityPayload {
    type: string;
    payload: KJObjectPayload;
}
export interface KJLineConnector {
    type: 'LINE';
    payload: KJObjectPayload & {
        start: Point3;
        end: Point3;
    };
}
export interface KJArcConnector {
    type: 'ARC';
    payload: KJObjectPayload & {
        center: Point3;
        radius: number;
        startAngle: number;
        endAngle: number;
        clockwise: boolean;
        normal: Point3;
    };
}
export interface KJLinePairEditResult {
    first: KJObjectPayload;
    second: KJObjectPayload;
    connector: KJLineConnector | KJArcConnector;
}
export interface KJJoinEntity extends KJEditingEntity {
    readonly id?: unknown;
}
export interface KJJoinOptions {
    readonly tolerance?: unknown;
    readonly primaryId?: unknown;
}
export interface KJJoinResult extends KJDerivedEntityPayload {
    sourceIds: string[];
    closed: boolean;
}
export interface KJLengthenOptions {
    readonly mode?: unknown;
    readonly value?: unknown;
    readonly totalLength?: unknown;
    readonly delta?: unknown;
    readonly percent?: unknown;
    readonly endpoint?: unknown;
    readonly pickPoint?: unknown;
    readonly targetPoint?: unknown;
    readonly point?: unknown;
}
export interface KJStretchOptions {
    readonly crossingStart?: unknown;
    readonly crossingEnd?: unknown;
    readonly firstPoint?: unknown;
    readonly secondPoint?: unknown;
    readonly from?: unknown;
    readonly to?: unknown;
    readonly dx?: unknown;
    readonly dy?: unknown;
}
export interface KJPolylineEditOptions {
    readonly operation?: unknown;
    readonly segmentIndex?: unknown;
    readonly vertexIndex?: unknown;
    readonly point?: unknown;
    readonly tolerance?: unknown;
    readonly bulge?: unknown;
    readonly sweepDegrees?: unknown;
    readonly startWidth?: unknown;
    readonly endWidth?: unknown;
}
export interface KJPolylineEditLocation {
    readonly segmentIndex?: number;
    readonly vertexIndex?: number;
}
/** Join connected open linear/arc paths into one editable planar polyline. */
export declare function joinEntityPayloads(entities: readonly KJJoinEntity[], options?: KJJoinOptions): KJJoinResult;
export declare function offsetEntityPayload(entity: KJEditingEntity | null | undefined, distance: unknown, options?: KJOffsetOptions): KJObjectPayload;
export declare function breakEntityPayloads(entity: KJEditingEntity | null | undefined, options?: KJBreakOptions): KJDerivedEntityPayload[];
export declare function explodeEntity(entity: KJEditingEntity | null | undefined): KJDerivedEntityPayload[];
/** Remove the picked LINE interval, preserving both sides of an interior cut. */
export declare function trimLinePayloads(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload[];
/** Single-result compatibility helper; use trimLinePayloads for interior cuts. */
export declare function trimLinePayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload;
export declare function extendLinePayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload;
/** Remove the picked line/arc/polyline interval, or replace a cut CIRCLE with its remaining ARC. */
export declare function trimEntityPayloads(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJDerivedEntityPayload[];
/** Extend the picked end of a line, arc or open polyline to the nearest continuation boundary. */
export declare function extendEntityPayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload;
/** Change one endpoint while preserving a LINE direction or ARC radius and orientation. */
export declare function lengthenEntityPayload(target: KJEditingEntity | null | undefined, options?: KJLengthenOptions): KJObjectPayload;
/** Move only defining vertices inside a crossing window; return null when none are selected. */
export declare function stretchEntityPayload(target: KJEditingEntity | null | undefined, options?: KJStretchOptions): KJObjectPayload | null;
/** Edit one polyline topology element without replacing the entity identity. */
export declare function editPolylinePayload(target: KJEditingEntity | null | undefined, options?: KJPolylineEditOptions): KJObjectPayload;
/** Resolve a pointer-based PEDIT pick to the stable topology index used for association migration. */
export declare function resolvePolylineEditLocation(target: KJEditingEntity | null | undefined, options?: KJPolylineEditOptions): KJPolylineEditLocation;
export declare function chamferLinePair(first: KJEditingEntity, second: KJEditingEntity, options?: KJLinePairOptions): KJLinePairEditResult;
export declare function filletLinePair(first: KJEditingEntity, second: KJEditingEntity, options?: KJLinePairOptions): KJLinePairEditResult;
