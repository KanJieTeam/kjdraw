import type { KJDocument } from './document.js';
import type { KJObjectPayload } from './schema.js';
import type { KJTransaction } from './transaction.js';
import { type ReadonlyDeep } from './utils.js';
import { type KJHatchPatternCatalog } from './hatch-pattern-catalog.js';
/** Complete line-family replacement. Never rename a pattern while retaining its old strokes. */
export declare function nativeHatchPattern(payload: Readonly<Record<string, unknown>>): KJObjectPayload;
export declare function hatchPatternFingerprint(payload: Readonly<Record<string, unknown>>): string;
export interface KJAgentHatchPatternEdit {
    id: string;
    expectedPatternHash: string;
    pattern: KJObjectPayload;
}
export declare function validateHatchPatternEdits(input: unknown): KJAgentHatchPatternEdit[];
/** Atomic geometry-only edit: IDs, boundaries, depths, notes, layers and associations stay untouched. */
export declare function applyHatchPatternEdits(document: KJDocument, transaction: KJTransaction, input: unknown): import("./schema.js").KJObjectRecord<KJObjectPayload>[];
/** Host catalogs are local immutable resources, never inferred from a model request. */
export declare function createAgentHatchPatternCatalog(document: KJDocument, catalogs?: readonly ReadonlyDeep<KJHatchPatternCatalog>[]): {
    entries: {
        patternId: string;
        name: string;
        source: string;
        pattern: KJObjectPayload;
        entityIds: string[];
        descriptions: string[];
        aliases: string[];
        catalogHashes: string[];
        catalogDefinitionMatch: boolean;
    }[];
    unsupported: {
        id: string;
        patternName: string;
        reason: string;
    }[];
};
export declare function readAgentHatchPatterns(document: KJDocument, input: {
    search?: string;
    offset?: number;
    limit?: number;
    maxBytes?: number;
}, catalogs?: readonly ReadonlyDeep<KJHatchPatternCatalog>[]): {
    readonly documentId: string;
    readonly revision: number;
    readonly units: string;
    readonly patterns: readonly {
        readonly patternId: string;
        readonly name: string;
        readonly source: string;
        readonly descriptions: readonly string[];
        readonly aliases: readonly string[];
        readonly catalogHashes: readonly string[];
        readonly matchKind: string;
        readonly catalogMetadataMatch: string;
        readonly lineFamilies: number;
        readonly entityCount: number;
        readonly entityIds: readonly string[];
        readonly entityIdsTruncated: boolean;
    }[];
    readonly totalMatches: number;
    readonly nextOffset: number | null;
    readonly unsupportedCount: number;
    readonly unsupported: readonly {
        readonly id: string;
        readonly patternName: string;
        readonly reason: string;
    }[];
    readonly unsupportedTruncated: boolean;
    readonly semantics: string;
};
export declare function prepareAgentHatchPatternEdit(document: KJDocument, input: {
    ids: string[];
    patternId: string;
    patternScale?: number;
    patternAngleDegrees?: number;
}, catalogs?: readonly ReadonlyDeep<KJHatchPatternCatalog>[]): {
    changes: KJAgentHatchPatternEdit[];
};
