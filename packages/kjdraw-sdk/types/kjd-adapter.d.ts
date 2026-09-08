import { KJDocument } from './document.js';
import type { KJFileAdapter } from './file-adapters.js';
import type { KJDocumentState, KJLegacyScene } from './schema.js';
export type KJDSource = string | Uint8Array | ArrayBuffer | Blob | KJDocument | KJDocumentState | KJLegacyScene | Record<string, unknown>;
export interface KJDAdapterOptions extends KJDReadOptions {
    id?: string;
    priority?: number;
}
export interface KJDReadLimits {
    maxBytes: number;
    maxObjects: number;
}
export interface KJDReadOptions extends Record<string, unknown> {
    limits?: Partial<KJDReadLimits>;
    signal?: AbortSignal;
    maxBytes?: number;
    maxObjects?: number;
}
export declare const KJD_DEFAULT_READ_LIMITS: Readonly<KJDReadLimits>;
export declare function createKJDFileAdapter(options?: KJDAdapterOptions): Readonly<KJFileAdapter<KJDocument, string>>;
