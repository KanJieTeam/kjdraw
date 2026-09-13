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
export interface KJDrawingPngPlan {
    readonly layoutId: string;
    readonly spaceId: string;
    readonly coordinateSystem: 'modelXY' | 'paperXY';
    readonly bounds: readonly [number, number, number, number];
    readonly viewBounds: readonly [number, number, number, number];
    readonly width: number;
    readonly height: number;
    readonly paper: {
        readonly widthMm: number;
        readonly heightMm: number;
        readonly pixelsPerMillimeter: number;
        readonly rasterAreaPixels: {
            readonly minimum: readonly [number, number];
            readonly maximum: readonly [number, number];
        };
    };
    readonly plot: {
        readonly printableAreaPixels: {
            readonly minimum: readonly [number, number];
            readonly maximum: readonly [number, number];
        };
        readonly plotOriginPixels: readonly [number, number];
        readonly sourceRange: {
            readonly kind: 'layout' | 'window' | 'view';
            readonly minimum: readonly [number, number];
            readonly maximum: readonly [number, number];
        };
        readonly drawingToPixelMatrix: readonly [number, number, number, number, number, number];
    };
}
export interface KJDrawingPngExport extends KJDrawingViewImage {
    readonly layoutId: string;
    readonly paper: KJDrawingPngPlan['paper'];
    readonly plot: KJDrawingPngPlan['plot'];
}
/** Capture one bounded read-only XY view without changing the drawing or workbench camera. */
export declare function captureDrawingView(drawing: KJDocument, options: KJDrawingViewOptions): Promise<KJDrawingViewImage>;
/** Resolve the exact configured paper-to-raster transform without allocating a canvas. */
export declare function resolveDrawingPngPlot(drawing: KJDocument, options: Pick<KJDrawingPngOptions, 'layoutId' | 'maxEdge'>): KJDrawingPngPlan;
/** Export one configured model or paper layout as a bounded PNG raster. */
export declare function exportDrawingPng(drawing: KJDocument, options: KJDrawingPngOptions): Promise<KJDrawingPngExport>;
