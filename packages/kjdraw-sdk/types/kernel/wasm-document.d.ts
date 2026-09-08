type WasmNumberFunction = (...values: number[]) => number | bigint;
export interface KJCoreDocumentExports {
    memory: WebAssembly.Memory;
    kjcore_abi_magic: WasmNumberFunction;
    kjcore_document_model_version: WasmNumberFunction;
    kjcore_alloc_u8: WasmNumberFunction;
    kjcore_free_u8: WasmNumberFunction;
    kjcore_document_open_kjd: WasmNumberFunction;
    kjcore_document_close: WasmNumberFunction;
    kjcore_document_validate: WasmNumberFunction;
    kjcore_document_revision: WasmNumberFunction;
    kjcore_document_serialize_kjd: WasmNumberFunction;
    kjcore_document_fingerprint: WasmNumberFunction;
    kjcore_document_commit_kjd: WasmNumberFunction;
    kjcore_byte_result_len: WasmNumberFunction;
    kjcore_byte_result_value: WasmNumberFunction;
    kjcore_last_error?: WasmNumberFunction;
}
export type KJCoreDocumentModule = KJCoreDocumentExports | {
    exports: KJCoreDocumentExports;
};
export type KJCoreDocumentInput = string | Record<string, unknown>;
export declare class KJCoreDocumentSession {
    #private;
    constructor(exports: KJCoreDocumentExports, handle: number);
    get closed(): boolean;
    get revision(): number;
    validate(): true;
    serialize(): string;
    fingerprint(): string;
    commit(source: KJCoreDocumentInput, expectedRevision?: number): string;
    close(): boolean;
}
export declare function openKJCoreDocumentSession(wasmModuleOrInstance: KJCoreDocumentModule | unknown, source: KJCoreDocumentInput): KJCoreDocumentSession;
export declare function canonicalizeKjdWithKJCore(wasmModuleOrInstance: KJCoreDocumentModule | unknown, source: KJCoreDocumentInput): string;
export interface KJCoreDocumentAuthority {
    readonly id: 'kanjie.kjcore.document-wasm';
    readonly authoritative: true;
    readonly modelVersion: number;
    open(source: KJCoreDocumentInput): KJCoreDocumentSession;
}
export declare function createKJCoreDocumentAuthority(wasmModuleOrInstance: KJCoreDocumentModule | unknown): Readonly<KJCoreDocumentAuthority>;
export declare const KJCORE_DOCUMENT_MODEL_VERSION = 1;
export {};
