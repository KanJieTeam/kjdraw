import type { KJDocument } from './document.js';
import type { KJTransaction } from './transaction.js';
export interface KJTextEdit {
    id: string;
    expectedText: string;
    text: string;
}
/** Exact native text replacement, never a regex, generic property patch or dimension override. */
export declare function validateTextEdits(input: unknown): KJTextEdit[];
/** FULL Agent adapter only: explicit literal affixes become ordinary sealed
 * TEXTEDIT arguments. Never infer separators, targets or original contents.
 * The original command/schema and scalar-v1 profile remain unchanged.
 */
export declare function expandAgentTextAffixes(input: unknown): KJTextEdit[];
export declare function applyTextEdits(document: KJDocument, transaction: KJTransaction, input: unknown): import("./schema.js").KJObjectRecord<import("./schema.js").KJObjectPayload>[];
