import type { KJObjectPayload } from '../schema.js';
type Data = Readonly<Record<string, unknown>>;
type Point = readonly [number, number];
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
export {};
