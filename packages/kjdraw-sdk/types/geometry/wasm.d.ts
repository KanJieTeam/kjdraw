import { type KJGeometryBackend, type KJGeometryBackendIdentity } from './backend.js';
import type { KJToleranceOptions } from './tolerance.js';
declare const EXPECTED_ABI = "kanjie.kjcore.wasm.v1";
declare const EXPECTED_ABI_MAGIC = 1263158017;
export interface WasmToleranceOptions {
    tolerance?: Partial<KJToleranceOptions>;
}
export interface KJCoreWasmInitializeOptions {
    wasmUrl?: string | URL;
    moduleUrl?: string;
    imports?: WebAssembly.Imports;
    strict?: boolean;
}
export declare function createWasmGeometryBackend(wasmModuleOrInstance: unknown): KJGeometryBackend;
export declare function instantiateKJCoreWasm(wasmUrl?: string | URL, imports?: WebAssembly.Imports): Promise<WebAssembly.WebAssemblyInstantiatedSource>;
export declare function initializeKJCoreWasm({ wasmUrl, moduleUrl, imports, strict, }?: KJCoreWasmInitializeOptions): Promise<KJGeometryBackendIdentity | null>;
export { EXPECTED_ABI as KJCORE_WASM_ABI, EXPECTED_ABI_MAGIC as KJCORE_WASM_ABI_MAGIC };
