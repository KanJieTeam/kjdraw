/** Raw JSON ABI for the separately licensed native arc contour kernel. */
export declare const KJ_CONTOUR_WASM_ABI = "kanjie.kjcontour.wasm.v1";
export interface KJContourBackendOptions {
    /** Local bytes avoid URL loading altogether. Supply either bytes or a URL. */
    readonly wasmBytes?: Uint8Array | ArrayBuffer;
    /** Explicit asset URL. The default is the SDK's bundled local asset. */
    readonly wasmUrl?: string | URL;
}
/** Internal native boundary. Inputs and outputs are further validated by the public API. */
export declare function runContourWasm(request: unknown, options?: KJContourBackendOptions): Promise<unknown>;
