import type { KJAgentDrawingInput } from './agent-drawing.js';
export interface KJAgentCompactDrawingInput {
    expectedRevision: number;
    units: string;
    lines: [number, number, number, number][];
    circles: [number, number, number][];
    /** Center XY, positive radius, then counterclockwise start/end angles in degrees. */
    arcs: [number, number, number, number, number][];
    /** Center XY, major-axis vector XY, ratio, then start/end parameters in degrees. */
    ellipses?: [number, number, number, number, number, number, number][];
    polylines: {
        points: [number, number][];
        closed: boolean;
    }[];
}
/** Decode only after compact schema validation; validate the result against the full drawing schema before building entities. */
export declare function decodeAgentCompactDrawing(input: KJAgentCompactDrawingInput): KJAgentDrawingInput;
