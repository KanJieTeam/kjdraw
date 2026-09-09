import type { KJDocument } from './document.js';
import { type KJDerivedEntityPayload } from './editing.js';
import type { KJCommandReceipt } from './product-contract.js';
import { type ReadonlyDeep } from './utils.js';
export type KJBoundaryEditOperation = 'trim' | 'extend';
export type KJBoundaryEditPhase = 'boundaries' | 'targets' | 'applying' | 'finished' | 'cancelled';
export interface KJBoundaryEditOptions {
    document: KJDocument;
    boundaryIds?: readonly string[];
    locale?: 'en' | 'zh';
    /** Hosts bind this to their mounted document/readonly state, not merely its ID. */
    isDocumentCurrent?: () => boolean;
}
export interface KJBoundaryEditState {
    readonly phase: KJBoundaryEditPhase;
    readonly operation: KJBoundaryEditOperation;
    readonly boundaryIds: readonly string[];
    readonly expectedRevision: number;
    readonly committedCount: number;
}
export interface KJBoundaryEditCommand {
    readonly command: 'TRIM' | 'EXTEND';
    readonly arguments: {
        readonly id: string;
        readonly boundaryIds: readonly string[];
        readonly pickPoint: readonly [number, number];
    };
    readonly expectedRevision: number;
}
export type KJBoundaryEditPreview = ReadonlyDeep<{
    documentId: string;
    revision: number;
    operation: KJBoundaryEditOperation;
    targetId: string;
    boundaryIds: string[];
    pickPoint: [number, number];
    pieces: KJDerivedEntityPayload[];
    command: KJBoundaryEditCommand;
}>;
/**
 * UI-neutral continuous trim/extend workflow. Geometry comes from the same
 * helpers as the core commands; the host executes the existing SDK envelope.
 * Previews are local one-shot objects, not authentication or serialized AI
 * approvals. Cross-process/model approval uses the SDK's reviewed agent plans.
 */
export declare class KJBoundaryEditSession {
    #private;
    constructor(operation: KJBoundaryEditOperation, options: KJBoundaryEditOptions);
    get state(): KJBoundaryEditState;
    get prompt(): string;
    setLocale(locale: 'en' | 'zh'): void;
    /** Does not silently rebase a session after undo, replacement or another edit. */
    isCurrent(): boolean;
    setBoundaries(ids: readonly string[]): void;
    confirmBoundaries(): void;
    /** Computes exact retained primitives without mutating the document or history. */
    preview(targetId: string, pickPoint: readonly [number, number]): KJBoundaryEditPreview;
    /**
     * Execute through the host's normal SDK command path. The callback must
     * propagate failures and return the SDK envelope receipt. The actual commit,
     * arguments and retained geometry must match the preview, not just revision +1.
     * Successful edits are separate undo steps. Cancel does not undo an already
     * dispatched transaction; it prevents the session from resuming afterwards.
     */
    apply<TResult extends Readonly<KJCommandReceipt>>(preview: KJBoundaryEditPreview, execute: (request: KJBoundaryEditCommand) => Promise<TResult>): Promise<TResult>;
    finish(): void;
    cancel(): void;
}
export declare function createBoundaryEditSession(operation: KJBoundaryEditOperation, options: KJBoundaryEditOptions): KJBoundaryEditSession;
