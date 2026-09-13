import type { KJDocument } from './document.js';
import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js';
import { type ReadonlyDeep } from './utils.js';
import { type KJDesignDefinition } from './design-relations.js';
import { type KJAgentBlockPreviewDependency } from './agent-preview-blocks.js';
export type { KJAgentBlockPreviewDependency } from './agent-preview-blocks.js';
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
    /** Omitted for table records for backwards-compatible preview payloads. */
    readonly kind?: 'block-record';
}
export interface KJAgentGeometryPreview {
    readonly documentId: string;
    readonly revision: number;
    readonly resources?: readonly KJAgentPreviewResource[];
    /** Existing block definitions, descendant geometry and styles, captured at revision. */
    readonly blockDependencies?: readonly KJAgentBlockPreviewDependency[];
    readonly designChange?: {
        readonly id: string;
        readonly before: ReadonlyDeep<KJDesignDefinition>;
        readonly after: ReadonlyDeep<KJDesignDefinition>;
        readonly record: KJReadonlyObjectRecord;
        readonly members: readonly KJReadonlyObjectRecord[];
        readonly dictionary: {
            readonly id: string;
            readonly key: string;
        };
    };
    readonly command: 'CREATEBATCH' | 'COMPONENTINSERT' | 'MOVE' | 'COPY' | 'ROTATE' | 'SCALE' | 'OFFSET' | 'STRETCH' | 'LENGTHEN' | 'PEDIT' | 'DESIGNCREATE' | 'DESIGNUPDATE' | 'ROAD_DRAWING_UPDATE';
    readonly before: readonly KJAgentPreviewEntity[];
    readonly after: readonly KJAgentPreviewEntity[];
}
export declare const KJDRAW_AGENT_MOVABLE_TYPES: readonly string[];
/** Resolve a selected member of an owned native LEADER/MTEXT pair to both members. */
export declare function resolveAgentTransformEntityIds(document: KJDocument, sourceIds: readonly string[]): string[];
export interface KJAgentGeometryPreviewOptions {
    /** Trusted host creation budget; defaults to 64, hard maximum 512. Transforms remain limited to 64. */
    maxCreatedEntities?: number;
}
/** Run bounded core geometry on a detached document. No host plugins, authority, network or source history is invoked. */
export declare function createAgentGeometryPreview(document: KJDocument, command: 'CREATEBATCH' | 'COMPONENTINSERT' | 'MOVE' | 'COPY' | 'ROTATE' | 'SCALE' | 'OFFSET' | 'STRETCH' | 'LENGTHEN' | 'PEDIT' | 'DESIGNCREATE' | 'DESIGNUPDATE', args: Record<string, unknown>, options?: KJAgentGeometryPreviewOptions): Promise<KJAgentGeometryPreview>;
export declare function agentPreviewMatchesDocument(document: KJDocument, preview: KJAgentGeometryPreview): boolean;
