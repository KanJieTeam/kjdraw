import { type KJTolerance } from './tolerance.js';
export interface XYCoordinates {
    readonly x?: unknown;
    readonly y?: unknown;
}
export interface XYZCoordinates extends XYCoordinates {
    readonly z?: unknown;
}
export type Point2Input = readonly unknown[] | XYCoordinates;
export type Point3Input = readonly unknown[] | XYZCoordinates;
export type Point2 = [number, number];
export type Point3 = [number, number, number];
export interface ClosestPoint2 {
    point: Point2;
    parameter: number;
    distance: number;
}
export declare function vec2(value: Point2Input, label?: string): Point2;
export declare function add2(a: Point2Input, b: Point2Input): Point2;
export declare function subtract2(a: Point2Input, b: Point2Input): Point2;
export declare function multiply2(a: Point2Input, scalar: number): Point2;
export declare function dot2(a: Point2Input, b: Point2Input): number;
export declare function cross2(a: Point2Input, b: Point2Input): number;
export declare const lengthSquared2: (value: Point2Input) => number;
export declare const length2: (value: Point2Input) => number;
export declare const distanceSquared2: (a: Point2Input, b: Point2Input) => number;
export declare const distance2: (a: Point2Input, b: Point2Input) => number;
export declare const perpendicular2: (value: Point2Input) => Point2;
export declare const midpoint2: (a: Point2Input, b: Point2Input) => Point2;
export declare function normalize2(value: Point2Input, tolerance?: KJTolerance): Point2;
export declare function angle2(value: Point2Input): number;
export declare function signedAngle2(from: Point2Input, to: Point2Input): number;
export declare function lerp2(a: Point2Input, b: Point2Input, t: number): Point2;
export declare function equal2(a: Point2Input, b: Point2Input, tolerance?: KJTolerance): boolean;
export declare function projectParameter2(point: Point2Input, origin: Point2Input, direction: Point2Input, tolerance?: KJTolerance): number;
export declare function closestPointOnSegment2(point: Point2Input, start: Point2Input, end: Point2Input, tolerance?: KJTolerance): ClosestPoint2;
