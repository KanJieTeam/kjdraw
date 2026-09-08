import { KJDocument } from './document.js';
export declare const KJP_MEDIA_TYPE = "application/vnd.kanjie.kjdraw-project+zip";
export declare const KJP_SCHEMA = "com.kanjie.kjdraw.project@1";
export declare const KJP_PACKAGE_VERSION = 1;
export type KjpSource = string | Uint8Array | ArrayBuffer | ArrayBufferView;
export type KjpEntryValue = string | Uint8Array | ArrayBuffer | ArrayBufferView | Record<string, unknown> | readonly unknown[] | null;
export interface KjpEntryRow {
    path: string;
    data: KjpEntryValue;
}
export type KjpEntryInput = ReadonlyMap<string, KjpEntryValue> | readonly KjpEntryRow[] | Readonly<Record<string, KjpEntryValue>>;
export interface KjpReadLimits {
    maxEntries: number;
    maxUncompressedBytes: number;
    maxEntryBytes: number;
    maxArchiveBytes: number;
}
export interface KjpOpenOptions {
    limits?: Partial<KjpReadLimits>;
    signal?: AbortSignal;
}
export declare const KJP_DEFAULT_READ_LIMITS: Readonly<KjpReadLimits>;
export interface KjpManifestDrawing {
    id: string;
    path: string;
    revision: number;
    sha256: string;
}
export interface KjpManifest {
    schema: typeof KJP_SCHEMA;
    packageVersion: typeof KJP_PACKAGE_VERSION;
    mediaType: typeof KJP_MEDIA_TYPE;
    projectId: string;
    title: string;
    activeDrawing: string;
    drawings: KjpManifestDrawing[];
    contentHashes: Record<string, string>;
    application: {
        name: 'KJDraw';
        minReaderVersion: string;
        writerVersion: string;
    };
    createdAt: string;
    modifiedAt: string;
    migrations: unknown[];
    metadata: Record<string, unknown>;
}
export type KjpDrawingSource = KJDocument | Parameters<typeof KJDocument.open>[0];
export interface KjpDrawingRow {
    id?: string;
    document?: KjpDrawingSource;
    data?: KjpDrawingSource;
}
export type KjpDrawingInput = ReadonlyMap<string, KjpDrawingSource> | readonly KjpDrawingRow[] | Readonly<Record<string, KjpDrawingSource>>;
export interface KjpCreateOptions {
    drawings?: KjpDrawingInput;
    activeDrawing?: string;
    commands?: readonly unknown[];
    assets?: ReadonlyMap<string, KjpEntryValue> | Readonly<Record<string, KjpEntryValue>>;
    snapshots?: ReadonlyMap<string, KjpEntryValue> | Readonly<Record<string, KjpEntryValue>>;
    recovery?: ReadonlyMap<string, KjpEntryValue> | Readonly<Record<string, KjpEntryValue>>;
    diagnostics?: ReadonlyMap<string, KjpEntryValue> | Readonly<Record<string, KjpEntryValue>>;
    projectId?: string;
    id?: string;
    title?: string;
    createdAt?: string;
    modifiedAt?: string;
    migrations?: readonly unknown[];
    metadata?: Record<string, unknown>;
    writerVersion?: string;
}
export interface KjpOpenResult {
    manifest: KjpManifest;
    drawings: Map<string, KJDocument>;
    activeDocument: KJDocument;
    commands: unknown[];
    entries: Map<string, Uint8Array>;
}
/** Always emits ZIP64 records, even for small projects, so package semantics do not change at 4 GiB. */
export declare function encodeZip64(input: KjpEntryInput): Uint8Array;
export declare function decodeZip64(source: KjpSource, inputLimits?: Partial<KjpReadLimits>, signal?: AbortSignal): Map<string, Uint8Array>;
export declare function createKjpPackage(options?: KjpCreateOptions): Promise<Uint8Array>;
export declare function openKjpPackage(source: KjpSource, options?: KjpOpenOptions): Promise<KjpOpenResult>;
