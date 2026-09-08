import type { KJObjectKind, KJTableName } from './constants.js';
import { KJTransaction } from './transaction.js';
import type { KJDocumentOptions, KJDocumentState, KJLegacyScene, KJReadonlyObjectRecord, KJRevisionRecord, KJValidationResult } from './schema.js';
import type { ReadonlyDeep } from './utils.js';
export interface KJDocumentHistory {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
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
    get id(): string;
    get revision(): number;
    get schemaVersion(): number;
    get hasAuthoritativeBackend(): boolean;
    get history(): Readonly<KJDocumentHistory>;
    on<Name extends keyof KJDocumentEvents>(name: Name, listener: (payload: KJDocumentEvents[Name]) => void, options?: {
        signal?: AbortSignal;
    }): () => boolean;
    once<Name extends keyof KJDocumentEvents>(name: Name, listener: (payload: KJDocumentEvents[Name]) => void, options?: {
        signal?: AbortSignal;
    }): () => boolean;
    snapshot(): ReadonlyDeep<KJDocumentState>;
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
