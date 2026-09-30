import type { KJDocument } from './document.js';
export interface KJDrawingTextQuery {
    expectedRevision: number;
    search: string;
    match?: 'contains' | 'exact';
    caseSensitive?: boolean;
    spaceId?: string;
    includeHidden?: boolean;
    offset?: number;
    limit?: number;
    maxBytes?: number;
}
/** Literal native text lookup. Returns complete stored text, never inferred engineering facts. */
export declare function findDrawingText(document: KJDocument, query: KJDrawingTextQuery): Readonly<Record<string, unknown>>;
