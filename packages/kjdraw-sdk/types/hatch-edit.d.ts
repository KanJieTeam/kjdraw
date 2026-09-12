import type { KJDocument } from './document.js';
import type { KJObjectRecord } from './schema.js';
import type { KJTransaction } from './transaction.js';
export interface KJHatchEditInput {
    readonly operation: 'update-pattern' | 'add-island' | 'replace-island' | 'remove-island';
    readonly loopIndex?: unknown;
    readonly vertices?: unknown;
    readonly sourceIds?: unknown;
    readonly patternScale?: unknown;
    readonly patternAngle?: unknown;
}
export declare function editHatch(document: KJDocument, transaction: KJTransaction, id: unknown, input: KJHatchEditInput): KJObjectRecord;
