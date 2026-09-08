import { type Point2, type Point2Input } from './vector2.js';
export interface EllipseDefinition {
    majorAxis?: readonly unknown[];
    majorRadius?: number;
    majorAxisLength?: number;
    ratio?: number;
    startParameter?: number;
    endParameter?: number;
}
export interface EllipseRadii {
    major: number;
    minor: number;
}
export interface EllipseArcLengthOptions {
    tolerance?: number;
}
export interface SplineDefinition {
    degree?: number;
    controlPoints?: readonly Point2Input[];
    knots?: readonly number[];
    weights?: readonly number[];
}
export interface NormalizedSplineDefinition {
    degree: number;
    controlPoints: Point2[];
    knots: number[];
    weights: number[];
}
export interface SplineLengthOptions {
    tolerance?: number;
}
export interface SplineBackendOptions extends SplineLengthOptions {
    degree: number;
    knots: readonly number[];
    weights: readonly number[];
}
export declare function ellipseRadii(payload?: EllipseDefinition): EllipseRadii;
export declare function ellipseArcLength2(payload: EllipseDefinition, options?: EllipseArcLengthOptions): number;
export declare function clampedUniformKnots(pointCount: number, degree: number): number[];
export declare function normalizeSplineDefinition(payload?: SplineDefinition): NormalizedSplineDefinition;
export declare function splinePoint2(payload: SplineDefinition | NormalizedSplineDefinition, parameter: number): Point2;
export declare function splineLength2(payload: SplineDefinition, options?: SplineLengthOptions): number;
