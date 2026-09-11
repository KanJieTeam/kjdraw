import type { KJDocument } from './document.js';
import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js';
import { type ReadonlyDeep } from './utils.js';
/** Immutable native block graph and styles needed to interpret INSERT previews.
 * Coordinates remain local to ownerId; selected INSERT transforms are in before/after. */
export interface KJAgentBlockPreviewDependency {
    readonly id: string;
    readonly kind: KJReadonlyObjectRecord['kind'];
    readonly type: string;
    readonly ownerId: string | null;
    readonly name: string | null;
    readonly payload: ReadonlyDeep<KJObjectPayload>;
}
/** Captures dependencies without changing a document or consulting external resources.
 * Instance work is counted before deduplication, so repeated nested INSERTs cannot
 * bypass the geometry budget by referring to a small number of shared definitions. */
export declare function captureAgentBlockDependencies(document: KJDocument, ids: readonly string[]): readonly KJAgentBlockPreviewDependency[] | undefined;
export declare function agentBlockDependenciesMatchDocument(document: KJDocument, expected?: readonly KJAgentBlockPreviewDependency[]): boolean;
