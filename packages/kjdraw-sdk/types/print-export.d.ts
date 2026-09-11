import type { KJDocument } from './document.js';
import { type KJSvgDrawingExport } from './svg-export.js';
export interface KJDrawingPrintOptions {
    layoutId: string;
    maxEntities?: number;
    title?: string;
    locale?: 'en' | 'zh-CN';
}
export interface KJDrawingPrintHtml extends Omit<KJSvgDrawingExport, 'svg' | 'mimeType'> {
    html: string;
    mimeType: 'text/html';
}
export interface KJDrawingPrintWindowOptions extends KJDrawingPrintOptions {
    /** Window receiving the user gesture; defaults to the current browser window. */
    ownerWindow?: Window;
    /** Host identity guard, checked before opening and after fonts are ready. */
    isCurrent?: () => boolean;
}
/** Strict, read-only vector print document. This returns HTML, never PDF bytes. */
export declare function createDrawingPrintHtml(document: KJDocument, options: KJDrawingPrintOptions): KJDrawingPrintHtml;
/** Open a user-initiated print dialog after verifying the snapshot and local fonts. No automatic PDF download. */
export declare function openDrawingPrintWindow(document: KJDocument, options: KJDrawingPrintWindowOptions): Promise<KJDrawingPrintHtml>;
