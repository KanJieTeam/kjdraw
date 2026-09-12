import type { KJObjectRecord } from './schema.js';
import type { KJTransaction } from './transaction.js';
export type KJDimensionAssociationFeature = 'start' | 'end' | 'center' | 'vertex' | 'left' | 'right' | 'top' | 'bottom' | 'curve';
export interface KJDimensionPointAssociation {
    definitionPointIndex: number;
    entityId: string;
    feature: KJDimensionAssociationFeature;
    vertexIndex?: number;
    angle?: number;
}
export declare function normalizeDimensionAssociations(value: unknown): KJDimensionPointAssociation[];
/** Reject topology edits that would leave existing dimension references dangling or ambiguously rebound. */
export declare function requireAssociativeDimensionSourceIdentity(transaction: KJTransaction, sourceId: string, operation: string): void;
/** Recompute native DIMENSION definition points after referenced geometry changed. */
export declare function refreshAssociativeDimensions(transaction: KJTransaction, changedEntityIds: Iterable<string>): KJObjectRecord[];
