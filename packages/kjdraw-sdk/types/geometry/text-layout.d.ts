import type { KJObjectPayload } from '../schema.js';
type Data = Readonly<Record<string, unknown>>;
type Point = readonly [number, number];
type MeasureText = (text: string, height: number, family: string) => number;
/** Safe local font-family mapping; no URL/file loading or embedded font claims. */
export declare function textFontFamily(style?: Data, fallback?: string): string;
/** CAD cap-height coordinates. Optional metrics are supplied by the rendering host;
 * geometry queries use explicitly approximate font-independent label extents. */
export declare function layoutCadText(payload: Readonly<KJObjectPayload> | Data, style?: Data, measure?: (text: string, height: number, family: string) => number): {
    text: string;
    family: string;
    height: number;
    left: number;
    bottom: number;
    width: number;
    matrix: readonly [number, number, number, number, number, number];
    corners: Point[];
};
/** Deterministic plain MTEXT layout. Keeps the source editable while exposing
 * bounded lines shared by Canvas hit testing and vector output. */
export declare function layoutCadMText(payload: Readonly<KJObjectPayload> | Data, style?: Data, measure?: MeasureText): {
    text: string;
    family: string;
    height: number;
    width: number;
    lineAdvance: number;
    lines: {
        text: string;
        width: number;
        left: number;
        baseline: number;
    }[];
    matrix: readonly [number, number, number, number, number, number];
    corners: Point[];
};
export {};
