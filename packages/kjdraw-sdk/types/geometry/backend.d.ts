import type { EllipseArcLengthOptions, SplineBackendOptions } from './curves.js';
import type { CircleCircleIntersectionOptions, KJIntersectionResult, LineCircleIntersectionOptions, LineLineIntersectionOptions, Orientation, OrientationOptions } from './intersections.js';
import type { PolylineMeasureOptions } from './measure.js';
import type { Point2Input } from './vector2.js';
export declare const REQUIRED_GEOMETRY_OPERATIONS: readonly ["intersectLineLine2", "intersectLineCircle2", "intersectCircleCircle2", "orientation2"];
export type RequiredGeometryOperation = typeof REQUIRED_GEOMETRY_OPERATIONS[number];
export interface KJGeometryBackendIdentity {
    readonly id: string;
    readonly abi: string;
    readonly version: string;
    readonly authoritative: boolean;
}
export interface KJGeometryBackendFailure {
    readonly message: string;
    readonly at: string;
}
export interface KJGeometryBackend {
    id?: unknown;
    abi?: unknown;
    version?: unknown;
    authoritative?: boolean;
    intersectLineLine2(a0: Point2Input, a1: Point2Input, b0: Point2Input, b1: Point2Input, options?: LineLineIntersectionOptions): KJIntersectionResult;
    intersectLineCircle2(start: Point2Input, end: Point2Input, center: Point2Input, radius: number, options?: LineCircleIntersectionOptions): KJIntersectionResult;
    intersectCircleCircle2(centerA: Point2Input, radiusA: number, centerB: Point2Input, radiusB: number, options?: CircleCircleIntersectionOptions): KJIntersectionResult;
    orientation2(a: Point2Input, b: Point2Input, c: Point2Input, options?: OrientationOptions): Orientation;
    polylineLength2?(vertices: readonly Point2Input[], options?: PolylineMeasureOptions): number;
    polylineArea2?(vertices: readonly Point2Input[]): number;
    ellipseArcLength2?(major: number, minor: number, start: number, end: number, options?: EllipseArcLengthOptions): number;
    splineLength2?(controlPoints: readonly Point2Input[], options: SplineBackendOptions): number;
    [operation: string]: unknown;
}
export type RegisteredGeometryBackend = Readonly<KJGeometryBackend & {
    identity: KJGeometryBackendIdentity;
}>;
export interface KJGeometryBackendStatus {
    readonly mode: 'native' | 'reference';
    readonly authoritative: boolean;
    readonly backend: KJGeometryBackendIdentity;
    readonly operations: readonly string[];
    readonly lastFailure: KJGeometryBackendFailure | null;
}
export declare function registerGeometryBackend(backend: KJGeometryBackend): KJGeometryBackendIdentity;
export declare function unregisterGeometryBackend(): void;
export declare function recordGeometryBackendFailure(error: unknown): void;
export declare function getGeometryBackendStatus(): KJGeometryBackendStatus;
export declare function requireAuthoritativeGeometryBackend(): KJGeometryBackendIdentity;
/**
 * Invokes an optional backend operation and trusts the registered ABI's result
 * shape. The cast is isolated here so geometry callers remain fully typed.
 */
export declare function invokeGeometryBackend<Result>(operation: string, args: readonly unknown[], fallback: () => Result): Result;
