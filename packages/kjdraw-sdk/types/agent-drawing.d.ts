import type { KJObjectPayload } from './schema.js';
export interface KJAgentPoint {
    x: number;
    y: number;
}
export interface KJAgentDrawingInput {
    expectedRevision: number;
    units: string;
    lines: {
        start: KJAgentPoint;
        end: KJAgentPoint;
    }[];
    circles: {
        center: KJAgentPoint;
        radius: number;
    }[];
    /** Counterclockwise arcs. Angles in degrees, measured from positive X. */
    arcs: {
        center: KJAgentPoint;
        radius: number;
        startDegrees: number;
        endDegrees: number;
    }[];
    /** Straight-segment polylines. Do not repeat the first vertex to close. */
    polylines: {
        vertices: KJAgentPoint[];
        closed: boolean;
    }[];
}
/** Input is validated against the tool's JSON schema before normalization. */
export declare function buildAgentDrawingEntities(input: KJAgentDrawingInput, ownerId: string): {
    type: string;
    payload: KJObjectPayload;
    options: {
        id: string;
        ownerId: string;
    };
}[];
