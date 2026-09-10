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
    report: KJSvgExportReport;
}
/** Editable vector output with explicit physical paper units. No raster fallback, network resources or implicit fit-to-paper. */
export declare function exportDrawingSvg(document: KJDocument, options: KJSvgExportOptions): KJSvgDrawingExport;
