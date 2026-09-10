export type KJPatternPoint = readonly [number, number, number];
export type KJPatternEntity = {
    type: 'LINE';
    payload: {
        start: KJPatternPoint;
        end: KJPatternPoint;
    };
} | {
    type: 'CIRCLE';
    payload: {
        center: KJPatternPoint;
        radius: number;
    };
} | {
    type: 'ARC';
    payload: {
        center: KJPatternPoint;
        radius: number;
        startAngle: number;
        endAngle: number;
        clockwise: boolean;
    };
} | {
    type: 'LWPOLYLINE';
    payload: {
        vertices: readonly KJPatternPoint[];
        closed: boolean;
    };
};
export interface KJRectangularDrawingPattern {
    rows: number;
    columns: number;
    dx: number;
    dy: number;
}
export interface KJDrawingPatternBudget {
    maxEntities?: number;
    maxPoints?: number;
}
/** Pure translation of native XY geometry; no document access, IDs, commands or evaluation.
 * Includes the source position and emits row, column, then source order. dx is column
 * spacing and dy is row spacing, matching ARRAYRECT. Every output owns its geometry.
 * Only straight, zero-width polylines and native z=0 geometry are supported. Arcs use
 * radians. All cardinality, point-work and translated-coordinate checks precede expansion.
 */
export declare function expandRectangularDrawingPattern(entities: readonly KJPatternEntity[], pattern: KJRectangularDrawingPattern, budget?: KJDrawingPatternBudget): KJPatternEntity[];
