import type { KJDocument } from './document.js';
import type { KJDxfPlotSettings } from './plot-settings.js';
type Point2 = readonly [number, number];
export type KJResolvedPlotSource = Readonly<{
    kind: 'layout';
    bounded: false;
}> | Readonly<{
    kind: 'layout-limits' | 'window' | 'view';
    bounded: true;
    minimum: Point2;
    maximum: Point2;
    width: number;
    height: number;
}>;
/** Resolve only plot sources whose coordinates are explicit and persistent.
 * Layout mode uses AcDbLayout limits only for fit; custom and fixed scales
 * retain their physical-page-derived range. Named views require a planar WCS
 * top view; perspective, clipping, UCS and twist require a different matrix. */
export declare function resolveDxfPlotSource(document: KJDocument, layoutId: string, settings: KJDxfPlotSettings, isModel: boolean): KJResolvedPlotSource;
export {};
