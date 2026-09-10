import type { KJDocument } from './document.js';
import type { KJObjectPayload } from './schema.js';
import { type ReadonlyDeep } from './utils.js';
export interface KJAgentPreviewEntity {
    readonly id: string;
    readonly type: string;
    readonly payload: ReadonlyDeep<KJObjectPayload>;
}
export interface KJAgentPreviewResource {
    readonly id: string;
    readonly type: string;
    readonly name: string | null;
    readonly payload: ReadonlyDeep<KJObjectPayload>;
}
export interface KJAgentGeometryPreview {
    readonly documentId: string;
    readonly revision: number;
    readonly resources?: readonly KJAgentPreviewResource[];
    readonly command: 'CREATEBATCH' | 'MOVE' | 'ROAD_DRAWING_UPDATE';
    readonly before: readonly KJAgentPreviewEntity[];
    readonly after: readonly KJAgentPreviewEntity[];
}
export interface KJAgentGeometryPreviewOptions {
    /** Trusted host creation budget; defaults to 64, hard maximum 512. MOVE remains limited to 64. */
    maxCreatedEntities?: number;
}
/** Run bounded core geometry on a detached document. No host plugins, authority, network or source history is invoked. */
export declare function createAgentGeometryPreview(document: KJDocument, command: 'CREATEBATCH' | 'MOVE', args: Record<string, unknown>, options?: KJAgentGeometryPreviewOptions): Promise<KJAgentGeometryPreview>;
export declare function agentPreviewMatchesDocument(document: KJDocument, preview: KJAgentGeometryPreview): boolean;
