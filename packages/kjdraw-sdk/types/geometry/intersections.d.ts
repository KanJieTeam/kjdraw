import { type KJTolerance } from './tolerance.js';
import { type Point2, type Point2Input } from './vector2.js';
export type LineDomain = 'line' | 'ray' | 'segment';
export type KJIntersectionKind = 'none' | 'point' | 'overlap';
export type Orientation = -1 | 0 | 1;
export interface LineLineIntersectionOptions {
    tolerance?: KJTolerance;
    modeA?: LineDomain;
    modeB?: LineDomain;
}
export interface LineCircleIntersectionOptions {
    tolerance?: KJTolerance;
    mode?: LineDomain;
}
export interface CircleCircleIntersectionOptions {
    tolerance?: KJTolerance;
}
export interface OrientationOptions {
    tolerance?: KJTolerance;
}
export interface KJIntersectionResult {
    kind: KJIntersectionKind;
    points: Point2[];
    parametersA: number[];
    parametersB: number[];
    infinite?: boolean;
}
export interface ClosestPointOnCircleResult {
    point: Point2;
    distance: number;
    angle: number;
}
export declare function orientation2(a: Point2Input, b: Point2Input, c: Point2Input, options?: OrientationOptions): Orientation;
export declare function intersectLineLine2(a0: Point2Input, a1: Point2Input, b0: Point2Input, b1: Point2Input, options?: LineLineIntersectionOptions): KJIntersectionResult;
export declare function intersectLineCircle2(start: Point2Input, end: Point2Input, center: Point2Input, radius: number, options?: LineCircleIntersectionOptions): KJIntersectionResult;
export declare function intersectCircleCircle2(centerA: Point2Input, radiusA: number, centerB: Point2Input, radiusB: number, options?: CircleCircleIntersectionOptions): KJIntersectionResult;
export declare function closestPointOnCircle2(point: Point2Input, center: Point2Input, radius: number, tolerance?: KJTolerance): ClosestPointOnCircleResult;
