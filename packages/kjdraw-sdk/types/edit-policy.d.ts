import type { KJTransaction } from './transaction.js';
/** Resolve the layer used by command edit policy when an entity omits layerId. */
export declare function resolveCommandLayerId(layerId: unknown, currentLayerId: unknown): string;
/**
 * User-facing commands honor layer editing state. The underlying document
 * transaction API deliberately remains available to importers and migrations,
 * which must be able to reconstruct drawings containing protected layers.
 * This is an editing policy, not an authorization or plugin security boundary.
 */
export declare function createCommandEditScope(transaction: KJTransaction, commandId: string): {
    transaction: KJTransaction;
    validate(): void;
};
