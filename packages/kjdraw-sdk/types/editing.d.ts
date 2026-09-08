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
export declare function offsetEntityPayload(entity: KJEditingEntity | null | undefined, distance: unknown, options?: KJOffsetOptions): KJObjectPayload;
export declare function breakEntityPayloads(entity: KJEditingEntity | null | undefined, options?: KJBreakOptions): KJDerivedEntityPayload[];
export declare function explodeEntity(entity: KJEditingEntity | null | undefined): KJDerivedEntityPayload[];
/** Remove the picked LINE interval, preserving both sides of an interior cut. */
export declare function trimLinePayloads(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload[];
/** Single-result compatibility helper; use trimLinePayloads for interior cuts. */
export declare function trimLinePayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload;
export declare function extendLinePayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload;
export declare function chamferLinePair(first: KJEditingEntity, second: KJEditingEntity, options?: KJLinePairOptions): KJLinePairEditResult;
export declare function filletLinePair(first: KJEditingEntity, second: KJEditingEntity, options?: KJLinePairOptions): KJLinePairEditResult;
