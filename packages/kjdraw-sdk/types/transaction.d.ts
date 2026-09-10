import type { KJTableName } from './constants.js';
import type { KJDocumentState, KJObjectExtension, KJObjectPayload, KJObjectRecord, KJObjectSpec, KJResourceCollectionName } from './schema.js';
import type { ReadonlyDeep } from './utils.js';
export interface KJTransactionOperation extends Record<string, unknown> {
    type: string;
}
export interface KJTransactionOptions {
    label?: string;
    metadata?: Record<string, unknown>;
}
export interface KJObjectPatch extends Record<string, unknown> {
    id?: string;
    handle?: string;
    kind?: string;
    type?: string;
    ownerId?: string | null;
    name?: string | null;
    payload?: KJObjectPayload;
    extension?: Partial<KJObjectExtension>;
    erased?: boolean;
    source?: unknown;
}
export interface KJTableRecordInput extends KJObjectSpec {
    name?: string;
}
export interface KJLayoutOptions {
    name?: string;
    paper?: unknown;
    dxfPlotSettings?: import('./plot-settings.js').KJDxfPlotSettings;
}
export declare class KJTransaction {
    #private;
    readonly label: string;
    readonly metadata: Record<string, unknown>;
    constructor(state: KJDocumentState, { label, metadata }?: KJTransactionOptions);
    get operations(): KJTransactionOperation[];
    get operationCount(): number;
    get closed(): boolean;
    _draft(): ReadonlyDeep<KJDocumentState>;
    _close(): void;
    _revisionOperations(maxEmbeddedOperations?: number): KJTransactionOperation[];
    getObject(id: string): KJObjectRecord | null;
    createObject(spec?: KJObjectSpec): KJObjectRecord;
    createEntity(type: string, payload?: KJObjectPayload, options?: KJObjectSpec): KJObjectRecord;
    updateObject(id: string, patch?: KJObjectPatch): KJObjectRecord;
    reparentObject(id: string, ownerId: string | null): KJObjectRecord;
    eraseObject(id: string, { hard }?: {
        hard?: boolean;
    }): KJObjectRecord | null;
    restoreObject(id: string): KJObjectRecord;
    setHeader<T>(name: string, value: T): T;
    setSystemVariable<T>(name: string, value: T): T;
    upsertTableRecord(tableName: KJTableName, record?: KJTableRecordInput): KJObjectRecord;
    setCurrentTableRecord(tableName: KJTableName, id: string): KJObjectRecord;
    removeTableRecord(tableName: KJTableName, id: string): KJObjectRecord | null;
    setActiveLayout(id: string): KJObjectRecord;
    createLayout(options?: KJLayoutOptions): KJObjectRecord;
    putResource<T>(collection: KJResourceCollectionName, id: string, descriptor: T): T;
    removeResource(collection: KJResourceCollectionName, id: string): unknown;
    addDictionaryEntry(dictionaryId: string, key: string, targetId: string): KJObjectRecord;
    removeDictionaryEntry(dictionaryId: string, key: string): string | string[] | undefined;
    setXData<T>(id: string, applicationName: string, values: T): KJObjectRecord;
    putOpaquePayload<T>(id: string, payload: T): T;
}
