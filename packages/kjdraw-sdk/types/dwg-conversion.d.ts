import { KJDocument } from './document.js';
import type { KJFileAdapter, KJFileAdapterOptions } from './file-adapters.js';
import type { ReadonlyDeep } from './utils.js';
export type KJDwgConversionTarget = 'DXF' | 'KJD';
export type KJDwgConversionLocality = 'local' | 'self-hosted' | 'cloud';
export interface KJDwgConversionLimits {
    maxSourceBytes: number;
    maxResultBytes: number;
}
export interface KJDwgConversionProgress {
    phase: 'validate' | 'upload' | 'convert' | 'download';
    completed: number;
    total?: number;
    unit: 'bytes' | 'percent' | 'steps';
}
export interface KJDwgConversionSource {
    /** A bounded display name. It is not a path and must not be treated as one. */
    name: string;
    /** A private copy of the source bytes. KJDraw does not retain these in the document. */
    bytes: Uint8Array;
    sha256: string;
    dwgVersion: string;
}
export interface KJDwgConversionRequest {
    source: KJDwgConversionSource;
    target: KJDwgConversionTarget;
    signal?: AbortSignal;
    onProgress?: (progress: Readonly<KJDwgConversionProgress>) => void;
}
export interface KJDwgConversionResult {
    format: KJDwgConversionTarget;
    data: string | Uint8Array | ArrayBuffer | Blob;
    /** When supplied, these digests are verified before parsing. */
    sourceSha256?: string;
    sha256?: string;
    providerVersion?: string;
    warnings?: readonly unknown[];
    approximations?: readonly unknown[];
}
export interface KJDwgConversionProvider {
    id: string;
    version?: string;
    locality: KJDwgConversionLocality;
    outputFormats: readonly KJDwgConversionTarget[];
    limits: Readonly<KJDwgConversionLimits>;
    convert(request: Readonly<KJDwgConversionRequest>): KJDwgConversionResult | Promise<KJDwgConversionResult>;
}
export interface KJDwgConversionProvenance {
    schema: 'kjdraw.dwg-import';
    schemaVersion: 1;
    provider: {
        id: string;
        version: string | null;
        locality: KJDwgConversionLocality;
    };
    sourceSha256: string;
    sourceName: string;
    sourceBytes: number;
    sourceVersion: string;
    target: KJDwgConversionTarget;
    targetSha256: string;
    targetBytes: number;
    warnings: readonly string[];
    approximations: readonly string[];
}
export interface KJDwgConversionReadOptions extends KJFileAdapterOptions {
    fileName?: string;
    targetFormat?: KJDwgConversionTarget;
    limits?: Partial<KJDwgConversionLimits>;
    onConversionProgress?: (progress: Readonly<KJDwgConversionProgress>) => void;
}
export interface KJDwgConversionAdapterOptions {
    provider: KJDwgConversionProvider;
    id?: string;
    priority?: number;
}
export declare const KJ_DWG_CONVERSION_DEFAULT_LIMITS: Readonly<KJDwgConversionLimits>;
/** Returns the bounded import record persisted in KJD metadata, when present. */
export declare function getDwgConversionProvenance(document: KJDocument): ReadonlyDeep<KJDwgConversionProvenance> | null;
/**
 * Creates a read-only DWG boundary. KJDraw never embeds a converter, endpoint,
 * credential, or source DWG in the document; the host owns that policy.
 */
export declare function createDwgConversionFileAdapter(options: KJDwgConversionAdapterOptions): Readonly<KJFileAdapter<KJDocument, never>>;
