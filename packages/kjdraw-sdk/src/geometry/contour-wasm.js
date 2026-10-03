// Generated from contour-wasm.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from '../errors.js';
export const KJ_CONTOUR_WASM_ABI = 'kanjie.kjcontour.wasm.v1';
const ABI_VERSION = 1;
const MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_ASSET = new URL('../assets/kjcontour.wasm', import.meta.url);
let defaultBackend = null;
async function readAsset(options) {
    if (options.wasmBytes !== undefined && options.wasmUrl !== undefined) throw new KJValidationError('Contour backend accepts either wasmBytes or wasmUrl, not both');
    if (options.wasmBytes !== undefined) {
        if (!(options.wasmBytes instanceof Uint8Array) && !(options.wasmBytes instanceof ArrayBuffer)) throw new KJValidationError('Contour wasmBytes must be a Uint8Array or ArrayBuffer');
        const bytes = options.wasmBytes instanceof Uint8Array ? options.wasmBytes : new Uint8Array(options.wasmBytes);
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new KJValidationError('Contour WASM asset exceeds the 4 MiB budget or is empty');
        return bytes;
    }
    if (options.wasmUrl !== undefined && typeof options.wasmUrl !== 'string' && !(options.wasmUrl instanceof URL)) throw new KJValidationError('Contour wasmUrl must be a string or URL');
    const url = options.wasmUrl === undefined ? DEFAULT_ASSET : new URL(options.wasmUrl, import.meta.url);
    if (url.protocol === 'file:') {
        const fsModule = 'node:fs/promises';
        const fs = await import(fsModule);
        const bytes = await fs.readFile(url);
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new KJValidationError('Contour WASM asset exceeds the 4 MiB budget or is empty');
        return bytes;
    }
    if (![
        'https:',
        'http:'
    ].includes(url.protocol)) throw new KJValidationError('Contour WASM asset requires a file, HTTP or HTTPS URL');
    const response = await fetch(url);
    if (!response.ok) throw new KJValidationError(`Contour WASM asset request failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new KJValidationError('Contour WASM asset exceeds the 4 MiB budget or is empty');
    return bytes;
}
async function instantiate(options) {
    try {
        const bytes = await readAsset(options);
        const instance = await WebAssembly.instantiate(bytes, {});
        const exports = instance.instance.exports;
        for (const name of [
            'kjcontour_abi_version',
            'kjcontour_alloc',
            'kjcontour_free',
            'kjcontour_run',
            'kjcontour_result_ptr',
            'kjcontour_result_len'
        ]){
            if (typeof exports[name] !== 'function') throw new KJValidationError(`Contour WASM ABI is missing ${name}`);
        }
        if (!(exports.memory instanceof WebAssembly.Memory) || exports.kjcontour_abi_version() !== ABI_VERSION) throw new KJValidationError('Contour WASM ABI is incompatible');
        return exports;
    } catch (error) {
        if (error instanceof KJValidationError) throw error;
        throw new KJValidationError('Native contour backend is unavailable; no polyline approximation was applied', {
            cause: error instanceof Error ? error.message : String(error)
        });
    }
}
async function backend(options) {
    if (options.wasmBytes !== undefined || options.wasmUrl !== undefined) return instantiate(options);
    if (!defaultBackend) {
        defaultBackend = instantiate(options).catch((error)=>{
            defaultBackend = null;
            throw error;
        });
    }
    return defaultBackend;
}
export async function runContourWasm(request, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key)=>![
            'wasmBytes',
            'wasmUrl'
        ].includes(key))) throw new KJValidationError('Contour backend options support only wasmBytes or wasmUrl');
    const input = new TextEncoder().encode(JSON.stringify(request));
    if (input.byteLength === 0 || input.byteLength > MAX_BYTES) throw new KJValidationError('Contour request exceeds the 4 MiB native input budget');
    const exports = await backend(options);
    const pointer = exports.kjcontour_alloc(input.byteLength);
    if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + input.byteLength > exports.memory.buffer.byteLength) throw new KJValidationError('Contour WASM allocation is invalid');
    try {
        new Uint8Array(exports.memory.buffer, pointer, input.byteLength).set(input);
        const status = exports.kjcontour_run(pointer, input.byteLength);
        const resultPointer = exports.kjcontour_result_ptr(), length = exports.kjcontour_result_len();
        if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_BYTES || !Number.isSafeInteger(resultPointer) || resultPointer < 0 || resultPointer + length > exports.memory.buffer.byteLength) throw new KJValidationError('Contour WASM returned an invalid result buffer');
        let result;
        try {
            result = JSON.parse(new TextDecoder('utf-8', {
                fatal: true
            }).decode(new Uint8Array(exports.memory.buffer, resultPointer, length)));
        } catch  {
            throw new KJValidationError('Contour WASM returned invalid JSON');
        }
        if (result && typeof result === 'object' && 'error' in result) throw new KJValidationError(`Contour operation refused: ${String(result.error)}`);
        if (status !== 0) throw new KJValidationError(`Contour WASM failed with status ${status}`);
        return result;
    } catch (error) {
        if (error instanceof KJValidationError) throw error;
        throw new KJValidationError('Native contour operation failed; no geometry approximation was applied', {
            cause: error instanceof Error ? error.message : String(error)
        });
    } finally{
        exports.kjcontour_free(pointer, input.byteLength);
    }
}
