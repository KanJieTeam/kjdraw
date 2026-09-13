type Point3 = readonly [number, number, number];
type Data = Readonly<Record<string, unknown>>;
export interface KJHatchSplineEdge extends Record<string, unknown> {
    readonly type: 'SPLINE';
    readonly degree: number;
    readonly controlPoints: readonly Point3[];
    readonly knots: readonly number[];
    readonly weights: readonly number[];
    readonly fitPoints: readonly Point3[];
    readonly periodic: boolean;
}
export interface KJHatchSplineConic {
    readonly center: Point3;
    readonly majorAxis: Point3;
    readonly ratio: number;
    readonly counterClockwise: boolean;
}
/** Structural DXF edge normalization. Exact topology support is deliberately narrower. */
export declare function normalizeHatchSplineEdge(source: Data, label?: string): KJHatchSplineEdge;
/** Recognize the exact four-span rational-quadratic representation of a closed ellipse. */
export declare function closedHatchSplineConic(source: Data): KJHatchSplineConic | null;
export declare function sampleHatchSpline(source: Data, stepsPerSpan?: number): readonly [number, number][];
export {};
