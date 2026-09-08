import type { KJObjectKind, KJTableName } from './constants.js';
import type { ReadonlyDeep } from './utils.js';
export interface KJObjectExtension {
    xdata: Record<string, unknown>;
    xrecordIds: string[];
    reactorIds: string[];
    hyperlinks: unknown[];
}
export interface KJObjectPayload extends Record<string, unknown> {
    layerId?: string;
    contractVersion?: number;
    entityIds?: string[];
    blockRecordId?: string;
    viewportIds?: string[];
    entries?: Record<string, string | string[]>;
    memberIds?: string[];
}
export interface KJObjectRecord<TPayload extends KJObjectPayload = KJObjectPayload> {
    id: string;
    handle: string;
    kind: KJObjectKind;
    type: string;
    ownerId: string | null;
    name: string | null;
    payload: TPayload;
    extension: KJObjectExtension;
    erased: boolean;
    source: unknown;
}
/** Convenience view for entity records returned by CREATE and listEntities(). */
export type KJEntity<TPayload extends KJObjectPayload = KJObjectPayload> = KJObjectRecord<TPayload> & {
    kind: 'entity';
};
export type KJReadonlyObjectRecord<TPayload extends KJObjectPayload = KJObjectPayload> = ReadonlyDeep<KJObjectRecord<TPayload>>;
export interface KJObjectSpec<TPayload extends KJObjectPayload = KJObjectPayload> {
    id?: string;
    handle?: string;
    kind?: KJObjectKind;
    type?: string;
    ownerId?: string | null;
    name?: string | null;
    payload?: TPayload;
    extension?: Partial<KJObjectExtension>;
    erased?: boolean;
    source?: unknown;
}
export interface KJTableState {
    recordIds: string[];
    currentId: string | null;
}
export type KJDocumentTables = Record<KJTableName, KJTableState>;
export interface KJDocumentHeader extends Record<string, unknown> {
    authoringVersion: string;
    sourceFormat: string;
    sourceVersion: string;
    units: string;
    measurement: string;
    codePage: string;
    handseed: string;
    extents: unknown;
    limits: unknown;
    systemVariables: Record<string, unknown>;
}
export interface KJDocumentSpaces {
    modelSpaceId: string;
    paperSpaceIds: string[];
    layoutIds: string[];
    activeLayoutId: string;
}
export type KJResourceCollectionName = 'fonts' | 'images' | 'hatches' | 'materials' | 'binaries' | 'externalReferences' | 'plotStyles';
export type KJResourceCollection = Record<string, unknown>;
export type KJDocumentResources = Record<KJResourceCollectionName, KJResourceCollection>;
export interface KJRevisionRecord extends Record<string, unknown> {
    revision: number;
    kind: string;
    label: string;
    at: string;
    author: unknown;
    source: string;
    operationCount: number;
    operations: unknown[];
    fingerprint?: string;
    targetRevision?: number;
}
export interface KJDocumentMetadata extends Record<string, unknown> {
    title: string;
    createdAt: string;
    modifiedAt: string | null;
    createdBy: unknown;
    tags: unknown[];
    custom: Record<string, unknown>;
}
export interface KJDocumentState {
    schema: string;
    schemaVersion: number;
    documentId: string;
    revision: number;
    header: KJDocumentHeader;
    tables: KJDocumentTables;
    spaces: KJDocumentSpaces;
    namedObjectsDictionaryId: string;
    objects: Record<string, KJObjectRecord>;
    resources: KJDocumentResources;
    opaquePayloads: Record<string, unknown>;
    revisions: KJRevisionRecord[];
    metadata: KJDocumentMetadata;
}
export interface KJDocumentOptions {
    documentId?: string;
    id?: string;
    createdAt?: string;
    authoringVersion?: string;
    sourceFormat?: string;
    sourceVersion?: string;
    units?: string;
    measurement?: string;
    codePage?: string;
    extents?: unknown;
    limits?: unknown;
    systemVariables?: Record<string, unknown>;
    title?: string;
    createdBy?: unknown;
    tags?: unknown[];
    metadata?: Record<string, unknown>;
}
export interface KJValidationIssue {
    path: string;
    message: string;
}
export interface KJValidationResult {
    valid: boolean;
    issues: KJValidationIssue[];
}
export interface KJLegacyLayer extends Record<string, unknown> {
    id?: string;
    name?: string;
}
export interface KJLegacyEntity extends Record<string, unknown> {
    id?: string;
    entityId?: string;
    type?: string;
    layer?: string;
}
export interface KJLegacyScene extends Record<string, unknown> {
    id?: string;
    title?: string;
    layers?: KJLegacyLayer[];
    entities?: KJLegacyEntity[];
}
export declare function createObjectRecord<TPayload extends KJObjectPayload = KJObjectPayload>({ id, handle, kind, type, ownerId, name, payload, extension, erased, source, }?: KJObjectSpec<TPayload>): KJObjectRecord<TPayload>;
export declare function allocateHandle(state: KJDocumentState): string;
export declare function createEmptyDocumentState(options?: KJDocumentOptions): KJDocumentState;
export declare function validateDocumentState(input: unknown, { throwOnError, previousState }?: {
    throwOnError?: boolean;
    previousState?: KJDocumentState;
}): KJValidationResult;
export declare function migrateDocumentState(input: unknown): KJDocumentState;
export declare function importLegacyScene(legacy?: KJLegacyScene): KJDocumentState;
