import { KJDocument } from './document.js';
import type { KJEventSubscriptionOptions } from './events.js';
import type { KjpCreateOptions, KjpEntryValue, KjpOpenOptions, KjpSource } from './project-package.js';
import type { ReadonlyDeep } from './utils.js';
declare const SNAPSHOT_SCHEMA = "com.kanjie.kjdraw.snapshot@1";
type KJOpenInput = Parameters<typeof KJDocument.open>[0];
type KJProjectState = 'unbound' | 'dirty' | 'saving' | 'saved' | 'error';
type KJDisposer = () => unknown;
export interface KJProjectCommandRecord {
    envelope: unknown;
    receipt: unknown;
}
export interface KJProjectSnapshotDocument {
    id: string;
    path: string;
    revision: number;
    fingerprint: string;
}
export interface KJProjectSnapshotRecord {
    schema: typeof SNAPSHOT_SCHEMA;
    id: string;
    label: string;
    at: string;
    activeDocumentId: string | null;
    documents: KJProjectSnapshotDocument[];
}
export interface KJProjectStateSnapshot {
    id: string;
    title: string;
    state: KJProjectState;
    dirty: boolean;
    activeDocumentId: string | null;
    modifiedAt: string;
    reason: string;
    error: string | null;
}
interface KJProjectEvents {
    'active-document': {
        documentId: string;
    };
    command: {
        envelope: unknown;
        receipt: unknown;
        documentId: string;
    };
    state: ReadonlyDeep<KJProjectStateSnapshot>;
}
interface KJCommandCommittedEvent {
    envelope: unknown;
    receipt: unknown;
    document?: KJDocument | null;
}
export interface KJProjectSDK {
    readonly documents: Map<string, KJDocument>;
    readonly events: {
        on(name: 'command:committed', listener: (value: KJCommandCommittedEvent) => void, options?: KJEventSubscriptionOptions): KJDisposer;
    };
    attachDocument(document: KJDocument): KJDocument;
    closeDocument(id: string): boolean;
    setActiveDocument(id: string): KJDocument | null;
}
export interface KJProjectSessionOptions {
    sdk?: KJProjectSDK;
    id?: string;
    title?: string;
    createdAt?: string;
    metadata?: Record<string, unknown>;
    migrations?: readonly unknown[];
}
export interface KJProjectCreateOptions extends KJProjectSessionOptions {
    documents?: ReadonlyMap<string, KJOpenInput | KJDocument> | readonly (KJOpenInput | KJDocument)[] | Readonly<Record<string, KJOpenInput | KJDocument>>;
    documentId?: string;
    activeDocumentId?: string;
}
export interface KJProjectOpenOptions extends KjpOpenOptions {
    sdk?: KJProjectSDK;
}
export interface KJProjectSnapshotOptions {
    id?: string;
    at?: string;
    limit?: number;
}
export interface KJProjectPackageOptions {
    modifiedAt?: string;
    writerVersion?: string;
    recovery?: KjpCreateOptions['recovery'];
    diagnostics?: KjpCreateOptions['diagnostics'];
}
/**
 * An in-memory project session. It owns KJD document membership, the command
 * journal and package metadata, while a platform file binding owns I/O.
 * Renderers and Vue stores are projections only and are deliberately absent.
 */
export declare class KJProjectSession {
    #private;
    readonly sdk: KJProjectSDK;
    readonly id: string;
    title: string;
    readonly createdAt: string;
    modifiedAt: string;
    metadata: Record<string, unknown>;
    migrations: unknown[];
    readonly documents: Map<string, KJDocument>;
    activeDocumentId: string | null;
    commands: ReadonlyDeep<KJProjectCommandRecord>[];
    assets: Map<string, KjpEntryValue>;
    snapshots: Map<string, KjpEntryValue>;
    snapshotLedger: ReadonlyDeep<KJProjectSnapshotRecord>[];
    dirty: boolean;
    state: KJProjectState;
    lastError: Error | null;
    constructor({ sdk, id, title, createdAt, metadata, migrations }?: KJProjectSessionOptions);
    static create(options: KJProjectCreateOptions & {
        sdk: KJProjectSDK;
    }): KJProjectSession;
    static open(source: KjpSource, options: KJProjectOpenOptions & {
        sdk: KJProjectSDK;
    }): Promise<KJProjectSession>;
    on<Name extends keyof KJProjectEvents>(name: Name, listener: (payload: KJProjectEvents[Name]) => void, options?: KJEventSubscriptionOptions): () => boolean;
    attachDocument(input: KJOpenInput | KJDocument): KJDocument;
    detachDocument(id: unknown): boolean;
    setActiveDocument(id: unknown): KJDocument;
    get activeDocument(): KJDocument | null;
    markDirty(reason?: string): void;
    snapshotState(reason?: string): ReadonlyDeep<KJProjectStateSnapshot>;
    fingerprint(): string;
    createSnapshot(label?: string, options?: KJProjectSnapshotOptions): ReadonlyDeep<KJProjectSnapshotRecord>;
    package(options?: KJProjectPackageOptions): Promise<Uint8Array>;
    beginSave(): void;
    markSaved(): void;
    markSaveError(error: unknown): void;
    hasChangedSinceSave(): boolean;
    destroy(): void;
}
export { SNAPSHOT_SCHEMA };
