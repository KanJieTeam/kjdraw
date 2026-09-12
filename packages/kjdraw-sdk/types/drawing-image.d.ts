import type { KJCanvasRenderReport, KJCanvasTheme } from './canvas-renderer.js';
import type { KJDocument } from './document.js';
export interface KJDrawingViewOptions {
    /** Requested XY bounds in the selected space coordinate units. */
    bounds: readonly [number, number, number, number];
    /** Defaults to model space. Explicit paper spaces use the native viewport renderer. */
    spaceId?: string;
    /** Logical image width and height; no physical print size is implied. */
    width: number;
    height: number;
    /** Defaults to 1, independently of the browser/device DPR. */
    pixelRatio?: number;
    theme?: KJCanvasTheme;
}
export interface KJDrawingViewImage {
    readonly dataUrl: string;
    readonly mimeType: 'image/png';
    readonly documentId: string;
    readonly revision: number;
    readonly units: string;
    readonly documentUnits: string;
    readonly spaceId: string;
    readonly coordinateSystem: 'modelXY' | 'paperXY';
    readonly bounds: readonly [number, number, number, number];
    /** Actual viewport after fitting bounds without distorting geometry. */
    readonly viewBounds: readonly [number, number, number, number];
    readonly width: number;
    readonly height: number;
    readonly pixelRatio: number;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
    /** Renderer diagnostics include approximated/unsupported objects and paper viewports. */
    readonly renderReport: Readonly<KJCanvasRenderReport>;
}
export interface KJDrawingPngOptions {
    layoutId: string;
    /** Longest raster edge. Defaults to 1400 and is bounded by captureDrawingView. */
    maxEdge?: number;
    theme?: KJCanvasTheme;
    /** Opt in to output that renderer diagnostics identify as incomplete. */
    allowPartial?: boolean;
}
export interface KJDrawingPngExport extends KJDrawingViewImage {
    readonly layoutId: string;
}
/**
 * Capture a read-only XY space view using the same canvas renderer as the workbench.
 * Aspect-ratio differences expand viewBounds; geometry is never stretched.
 * This is a visual aid, not geometric verification: inspect renderReport for limitations.
 * Requires a browser DOM canvas. All sizes are bounded before canvas allocation.
 */
export declare function captureDrawingView(drawing: KJDocument, options: KJDrawingViewOptions): Promise<KJDrawingViewImage>;
/** Export one configured model or paper layout as a bounded PNG raster. */
export declare function exportDrawingPng(drawing: KJDocument, options: KJDrawingPngOptions): Promise<KJDrawingPngExport>;
