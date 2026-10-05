import type { KJObjectKind, KJTableName } from './constants.js';
import { KJTransaction } from './transaction.js';
import type { KJDocumentOptions, KJDocumentMetadata, KJDocumentSpaces, KJDocumentState, KJLegacyScene, KJReadonlyObjectRecord, KJRevisionRecord, KJValidationResult } from './schema.js';
import type { ReadonlyDeep } from './utils.js';
export interface KJDocumentHistory {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    undoCount: number;
    redoCount: number;
    undoTarget: Readonly<KJDocumentHistoryTarget> | null;
    redoTarget: Readonly<KJDocumentHistoryTarget> | null;
}
export interface KJDocumentHistoryTarget {
    id: string;
    label: string;
    revision: number;
    source: string;
}
export interface KJDocumentHistoryPreview {
    target: Readonly<KJDocumentHistoryTarget>;
    /** Detached content branch with no history or authority. */
    document: KJDocument;
}
export declare const KJ_DOCUMENT_HISTORY_ARCHIVE_SCHEMA: 'com.kanjie.kjdraw.document-history@1';
export declare const KJ_DOCUMENT_HISTORY_ARCHIVE_LIMIT = 50;
export declare const KJ_DOCUMENT_HISTORY_ARCHIVE_MAX_BYTES = 16777216;
export interface KJDocumentHistoryArchiveEntry {
    label: string;
    source: string;
    revision: number;
    before: KJDocumentState;
    after: KJDocumentState;
}
/** Optional local recovery data, separate from portable KJD/DXF content and approval plans. */
export interface KJDocumentHistoryArchive {
    schema: typeof KJ_DOCUMENT_HISTORY_ARCHIVE_SCHEMA;
    documentId: string;
    documentRevision: number;
    documentFingerprint: string;
    baselineRevision: number;
    undo: KJDocumentHistoryArchiveEntry[];
    redo: KJDocumentHistoryArchiveEntry[];
}
export interface KJDocumentHistoryArchiveOptions {
    /** Nearest undo/redo entries combined, at most 50. */
    limit?: number;
    maxBytes?: number;
}
export interface KJDocumentAuthority {
    commit(serialized: string, expectedRevision: number): Promise<string | KJDocumentState> | string | KJDocumentState;
    serialize(): string | KJDocumentState;
    close(): void;
}
export interface KJDocumentConstructorOptions {
    historyLimit?: number;
}
export interface KJDocumentQuery {
    kind?: KJObjectKind;
    type?: string;
    ownerId?: string;
    includeErased?: boolean;
}
export interface KJDocumentTransactionOptions {
    expectedRevision?: number;
    metadata?: Record<string, unknown>;
    at?: string;
    author?: unknown;
    source?: string;
}
export interface KJDocumentHistoryOptions {
    expectedRevision?: number;
    /** Exact next entry captured during review; checked inside the document queue. */
    targetHistoryId?: string;
    at?: string;
    author?: unknown;
    source?: string;
}
export interface KJDocumentTableView {
    currentId: string | null;
    records: ReadonlyArray<KJReadonlyObjectRecord>;
}
export type KJDocumentInput = KJDocumentOptions | KJDocumentState | KJLegacyScene | Record<string, unknown>;
export interface KJDocumentChangePayload {
    document: ReadonlyDeep<KJDocumentState>;
    revision: ReadonlyDeep<KJRevisionRecord> | undefined;
    history: Readonly<KJDocumentHistory>;
}
export interface KJDocumentBeforeCommitPayload {
    before: ReadonlyDeep<KJDocumentState>;
    after: ReadonlyDeep<KJDocumentState>;
    revision: ReadonlyDeep<KJRevisionRecord>;
}
interface KJDocumentEvents {
    'document:before-commit': KJDocumentBeforeCommitPayload;
    'document:after-commit': KJDocumentChangePayload;
    'document:change': KJDocumentChangePayload;
    'document:undo': KJDocumentChangePayload;
    'document:redo': KJDocumentChangePayload;
    'document:history': Readonly<KJDocumentHistory>;
}
export declare class KJDocument {
    #private;
    constructor(input?: KJDocumentInput, options?: KJDocumentConstructorOptions);
    static create(options?: KJDocumentOptions & KJDocumentConstructorOptions): KJDocument;
    static open(input: string | KJDocumentState | KJLegacyScene | Record<string, unknown>, options?: KJDocumentConstructorOptions): KJDocument;
    /** Detached copy-on-write branch at the current revision. Shares unchanged
     * internal records, never authority, listeners, queued work or undo history.
     * Edits on either branch still undergo normal document validation. */
    fork(): KJDocument;
    get id(): string;
    get revision(): number;
    get schemaVersion(): number;
    get hasAuthoritativeBackend(): boolean;
    get history(): Readonly<KJDocumentHistory>;
    /** Preview the actual next history snapshot without invoking or altering history. */
    previewHistory(kind: 'undo' | 'redo', options?: KJDocumentHistoryOptions): KJDocumentHistoryPreview;
    /** Establish an import/open baseline without changing content or audit records. Host-only. */
    clearHistory(options?: Pick<KJDocumentHistoryOptions, 'expectedRevision'>): Promise<Readonly<KJDocumentHistory>>;
    /** Export bounded engine snapshots for a trusted host's local session store. */
    exportHistory(options?: KJDocumentHistoryArchiveOptions): ReadonlyDeep<KJDocumentHistoryArchive>;
    /** Validate a local archive against current content, then install fresh history identities.
     * No geometry, document revision or saved approval registry is restored here. */
    restoreHistory(input: unknown, options?: Pick<KJDocumentHistoryOptions, 'expectedRevision'>): Promise<Readonly<KJDocumentHistory>>;
    on<Name extends keyof KJDocumentEvents>(name: Name, listener: (payload: KJDocumentEvents[Name]) => void, options?: {
        signal?: AbortSignal;
    }): () => boolean;
    once<Name extends keyof KJDocumentEvents>(name: Name, listener: (payload: KJDocumentEvents[Name]) => void, options?: {
        signal?: AbortSignal;
    }): () => boolean;
    snapshot(): ReadonlyDeep<KJDocumentState>;
    /** Lightweight immutable document metadata without cloning the object graph. */
    get metadata(): ReadonlyDeep<KJDocumentMetadata>;
    /** Lightweight immutable layout/space registry without cloning the object graph. */
    get spaces(): ReadonlyDeep<KJDocumentSpaces>;
    toJSON({ includeRevisions }?: {
        includeRevisions?: boolean;
    }): KJDocumentState;
    serialize({ pretty, includeRevisions }?: {
        pretty?: boolean;
        includeRevisions?: boolean;
    }): string;
    fingerprint(): string;
    validate(): KJValidationResult;
    bindAuthority(session: KJDocumentAuthority): this;
    unbindAuthority(): boolean;
    getObject(id: string, { includeErased }?: {
        includeErased?: boolean;
    }): KJReadonlyObjectRecord | null;
    listObjects({ kind, type, ownerId, includeErased }?: KJDocumentQuery): ReadonlyArray<KJReadonlyObjectRecord>;
    listEntities(options?: Omit<KJDocumentQuery, 'kind'>): ReadonlyArray<KJReadonlyObjectRecord>;
    getTable(name: KJTableName | string): Readonly<KJDocumentTableView> | null;
    getActiveLayout(): KJReadonlyObjectRecord | null;
    transact<TResult>(label: string, work: (transaction: KJTransaction) => TResult | Promise<TResult>, options?: KJDocumentTransactionOptions): Promise<TResult>;
    undo(options?: KJDocumentHistoryOptions): Promise<boolean>;
    redo(options?: KJDocumentHistoryOptions): Promise<boolean>;
}
export {};
