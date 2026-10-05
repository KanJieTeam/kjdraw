import type { KJDocument } from './document.js';
import type { KJTransaction } from './transaction.js';
export interface KJTextEdit {
    id: string;
    expectedText: string;
    text: string;
}
/** Exact native text replacement, never a regex, generic property patch or dimension override. */
export declare function validateTextEdits(input: unknown): KJTextEdit[];
export declare function applyTextEdits(document: KJDocument, transaction: KJTransaction, input: unknown): import("./schema.js").KJObjectRecord<import("./schema.js").KJObjectPayload>[];
