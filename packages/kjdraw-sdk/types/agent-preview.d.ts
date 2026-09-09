import { KJDocument } from './document.js';
import type { KJObjectPayload } from './schema.js';
import { type ReadonlyDeep } from './utils.js';
export interface KJAgentPreviewEntity {
    readonly id: string;
    readonly type: string;
    readonly payload: ReadonlyDeep<KJObjectPayload>;
}
export interface KJAgentGeometryPreview {
    readonly documentId: string;
    readonly revision: number;
    readonly command: 'CREATEBATCH' | 'MOVE';
    readonly before: readonly KJAgentPreviewEntity[];
    readonly after: readonly KJAgentPreviewEntity[];
}
/** Run bounded core geometry on a detached document. No host plugins, authority, network or source history is invoked. */
export declare function createAgentGeometryPreview(document: KJDocument, command: 'CREATEBATCH' | 'MOVE', args: Record<string, unknown>): Promise<KJAgentGeometryPreview>;
export declare function agentPreviewMatchesDocument(document: KJDocument, preview: KJAgentGeometryPreview): boolean;
