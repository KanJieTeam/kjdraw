import type { KJDocument } from './document.js';
import { type AffineMatrix3 } from './geometry/matrix3.js';
export interface KJSvgExportOptions {
    layoutId: string;
    allowPartial?: boolean;
    maxEntities?: number;
}
export interface KJSvgDiagnostic {
    entityId: string;
    type: string;
    reason: string;
}
export interface KJSvgExportReport {
    status: 'complete' | 'approximate' | 'partial';
    rendered: number;
    hidden: number;
    diagnostics: KJSvgDiagnostic[];
    approximations: KJSvgDiagnostic[];
    viewports: {
        entityId: string;
        millimetersPerModelUnit: number;
        matrix: AffineMatrix3;
    }[];
}
export interface KJSvgDrawingExport {
    svg: string;
    mimeType: 'image/svg+xml';
    documentId: string;
    revision: number;
    layoutId: string;
    paper: {
        widthMm: number;
        heightMm: number;
        millimetersPerDrawingUnit: number;
    };
    plot: {
        /** Physical printable rectangle in a lower-left paper coordinate system. */
        printableAreaMm: {
            minimum: readonly [number, number];
            maximum: readonly [number, number];
            width: number;
            height: number;
        };
        /** Drawing origin measured from the lower-left paper edge. */
        plotOriginMm: readonly [number, number];
        /** Exact source coordinates admitted by the physical page and selected plot range. */
        sourceRange: {
            kind: 'layout' | 'layout-limits' | 'window' | 'view';
            minimum: readonly [number, number];
            maximum: readonly [number, number];
        };
        /** Drawing XY to SVG paper millimeters, whose origin is the page's upper-left corner. */
        drawingToPaperMatrix: AffineMatrix3;
    };
    report: KJSvgExportReport;
}
/** Editable vector output with explicit physical paper units. No raster fallback, network resources or implicit fit-to-paper. */
export declare function exportDrawingSvg(document: KJDocument, options: KJSvgExportOptions): KJSvgDrawingExport;
