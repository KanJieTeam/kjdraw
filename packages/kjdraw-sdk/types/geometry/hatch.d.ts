type Point = readonly [number, number];
export interface KJHatchPatternLine {
    angle: number;
    base: Point;
    offset: Point;
    dashes: readonly number[];
}
/** Actual OCS line families, with global scale/angle already applied exactly once. */
export declare function hatchPatternLines(payload: Readonly<Record<string, unknown>>): readonly KJHatchPatternLine[];
export interface KJHatchStrokes {
    segments: Array<readonly [Point, Point]>;
    dots: Point[];
    limited: boolean;
    work: number;
}
/** Clip line families to a visible rectangle while retaining each row's dash origin.
 * Bound row and primitive work; never enlarge spacing or substitute a pattern. */
export declare function hatchStrokes(lines: readonly KJHatchPatternLine[], bounds: readonly [number, number, number, number], budget?: number): KJHatchStrokes;
export {};
