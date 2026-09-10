import type { KJDocument } from './document.js';
import type { KJRoadDrawingResult } from './road-drawing.js';
import { type ReadonlyDeep } from './utils.js';
export interface KJRoadDrawingRevisionOptions {
    expectedRevision: number;
}
export interface KJRoadDrawingRevisionReceipt {
    documentId: string;
    drawingId: string;
    previousRevision: number;
    revision: number;
    updatedIds: string[];
    createdIds: string[];
    removedIds: string[];
    unchangedIds: string[];
}
/**
 * Apply a host-requested rebuild from buildRoadDrawing to the existing model space.
 * Both compiled results must use the same drawingId and unmodified semantic resources.
 * Refuses edits since the supplied previous result; no automatic listener or constraint solver.
 * Keep previous with the host document. Compiled results are data, not provenance credentials.
 */
export declare function applyRoadDrawingRevision(document: KJDocument, previous: ReadonlyDeep<KJRoadDrawingResult>, next: ReadonlyDeep<KJRoadDrawingResult>, options: KJRoadDrawingRevisionOptions): Promise<ReadonlyDeep<KJRoadDrawingRevisionReceipt>>;
