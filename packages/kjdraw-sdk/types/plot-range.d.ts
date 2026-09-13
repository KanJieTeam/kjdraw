import type { KJDocument } from './document.js';
import type { KJDxfPlotSettings } from './plot-settings.js';
type Point2 = readonly [number, number];
export type KJResolvedPlotSource = Readonly<{
    kind: 'layout';
}> | Readonly<{
    kind: 'window' | 'view';
    minimum: Point2;
    maximum: Point2;
    width: number;
    height: number;
}>;
/** Resolve only plot sources whose coordinates are explicit and persistent.
 * Layout mode is intentionally unbounded: its visible range depends on the
 * physical page. Named views are accepted only for an unambiguous planar WCS
 * top view; perspective, clipping, UCS and twist require a different matrix. */
export declare function resolveDxfPlotSource(document: KJDocument, settings: KJDxfPlotSettings, isModel: boolean): KJResolvedPlotSource;
export {};
