import type { KJDocument } from './document.js';
export interface KJAgentTopologyQuery {
    expectedRevision: number;
    units: string;
    ids: string[];
    tolerance: number;
    maxBytes: number;
}
/** Build an exact, bounded, immutable owner-local topology view without editing the document. */
export declare function createAgentTopologyContext(document: KJDocument, query: KJAgentTopologyQuery): Readonly<Record<string, unknown>>;
