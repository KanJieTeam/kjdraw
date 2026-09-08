import { KJDocument } from './document.js';
import type { KJFileAdapter, KJFileAdapterOptions } from './file-adapters.js';
interface DxfReadLimits {
    maxBytes: number;
    maxTags: number;
    maxEntities: number;
}
interface DxfReadOptions extends KJFileAdapterOptions {
    limits?: Partial<DxfReadLimits>;
    signal?: AbortSignal;
    maxBytes?: number;
    maxTags?: number;
    maxEntities?: number;
}
interface DxfAdapterOptions extends DxfReadOptions {
    id?: string;
    priority?: number;
}
export declare const DXF_DEFAULT_READ_LIMITS: Readonly<DxfReadLimits>;
export declare function createDXFFileAdapter(options?: DxfAdapterOptions): Readonly<KJFileAdapter<KJDocument, string>>;
export {};
