import type { KJDocument } from './document.js';
export interface KJEraseImpactQuery {
    expectedRevision: number;
    units: string;
    operation: 'erase';
    ids: string[];
    tolerance: number;
    maxBytes: number;
}
export interface KJEraseImpactBlocker {
    kind: 'design-relation' | 'dimension-association' | 'hatch-source' | 'owned-leader-annotation' | 'attached-insert-record' | 'protected-entity';
    sourceId: string;
    dependentId: string | null;
    message: string;
    reason?: 'locked' | 'frozen' | 'hidden';
}
export interface KJEraseImpact {
    documentId: string;
    revision: number;
    units: string;
    operation: 'erase';
    requestedIds: readonly string[];
    eraseRootIds: readonly string[];
    effectiveEraseIds: readonly string[];
    canErase: boolean;
    blockers: readonly KJEraseImpactBlocker[];
    designRelations: readonly Readonly<Record<string, unknown>>[];
    dimensions: readonly Readonly<Record<string, unknown>>[];
    leaderPairs: readonly Readonly<Record<string, unknown>>[];
    hatchSourceReferences: readonly Readonly<Record<string, unknown>>[];
    selectionSets: readonly Readonly<Record<string, unknown>>[];
    insertAttachments: readonly Readonly<Record<string, unknown>>[];
    blockDefinitionInstances: readonly Readonly<Record<string, unknown>>[];
    nativeCandidates: readonly Readonly<Record<string, unknown>>[];
    connectivity: Readonly<Record<string, unknown>>;
    limits: Readonly<Record<string, number>>;
}
export interface KJEraseImpactOptions {
    maxIds?: number;
    maxBytesLimit?: number;
    maxObjectsLimit?: number;
    allowCompoundRecords?: boolean;
    analyzeConnectivity?: boolean;
    mode?: 'diagnostic' | 'decision';
}
export declare const KJDRAW_ERASE_IMPACT_LIMITS: Readonly<{
    maxObjects: 200000;
    maxReferences: 500000;
    maxConnectivityFeatures: 32768;
    maxConnectivityComparisons: 500000;
}>;
/** Analyze one exact ERASE operation without changing document, selection, history or revision. */
export declare function createEraseImpact(document: KJDocument, query: KJEraseImpactQuery, options?: KJEraseImpactOptions): Readonly<KJEraseImpact>;
