import { type Point2Input } from './vector2.js';
export interface BulgedPolylineVertex {
    point: Point2Input;
    bulge?: number;
    startWidth?: number;
    endWidth?: number;
    [property: string]: unknown;
}
export type PolylineVertex = readonly unknown[] | BulgedPolylineVertex;
export interface PolylineMeasureOptions {
    closed?: boolean;
}
export interface BulgeSegmentMetrics {
    chord: number;
    radius: number;
    sweep: number;
    length: number;
    segmentArea: number;
}
export interface ArcDefinition {
    startAngle?: number;
    endAngle?: number;
    clockwise?: boolean;
    fullCircle?: boolean;
    [property: string]: unknown;
}
export interface GeometryEntityLike {
    type?: unknown;
    payload?: Record<string, unknown>;
    [property: string]: unknown;
}
export interface EntityLengthMeasurement {
    value: number;
    approximate: boolean;
    algorithm?: 'adaptive-rational-bspline' | 'adaptive-quadrature';
}
export interface EntityAreaMeasurement {
    value: number;
    signed: boolean;
    approximate: boolean;
}
export declare function bulgeSegmentMetrics(start: Point2Input, end: Point2Input, bulge?: number): BulgeSegmentMetrics;
export declare function polylineLength2(vertices: readonly PolylineVertex[] | null | undefined, { closed }?: PolylineMeasureOptions): number;
export declare function polylineArea2(vertices: readonly PolylineVertex[] | null | undefined): number;
export declare function arcSweep(payload: ArcDefinition): number;
export declare function entityLength2(object: GeometryEntityLike | null | undefined): EntityLengthMeasurement;
export declare function entityArea2(object: GeometryEntityLike | null | undefined): EntityAreaMeasurement;
