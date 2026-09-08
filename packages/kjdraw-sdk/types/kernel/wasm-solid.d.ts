type WasmNumberFunction = (...values: number[]) => number | bigint;
export interface KJCoreSolidExports {
    memory: WebAssembly.Memory;
    kjcore_abi_magic: WasmNumberFunction;
    kjcore_solid_model_version: WasmNumberFunction;
    kjcore_alloc_f64: WasmNumberFunction;
    kjcore_free_f64: WasmNumberFunction;
    kjcore_solid_open_mesh: WasmNumberFunction;
    kjcore_solid_box: WasmNumberFunction;
    kjcore_solid_cylinder: WasmNumberFunction;
    kjcore_solid_cone: WasmNumberFunction;
    kjcore_solid_sphere: WasmNumberFunction;
    kjcore_solid_sweep: WasmNumberFunction;
    kjcore_solid_loft: WasmNumberFunction;
    kjcore_solid_transform: WasmNumberFunction;
    kjcore_solid_boolean: WasmNumberFunction;
    kjcore_solid_validate: WasmNumberFunction;
    kjcore_solid_volume: WasmNumberFunction;
    kjcore_solid_serialize_json: WasmNumberFunction;
    kjcore_solid_close: WasmNumberFunction;
    kjcore_byte_result_len: WasmNumberFunction;
    kjcore_byte_result_value: WasmNumberFunction;
    kjcore_last_error?: WasmNumberFunction;
    [name: string]: unknown;
}
export type KJCoreSolidModule = KJCoreSolidExports | {
    exports: KJCoreSolidExports;
};
export type KJCorePoint3 = readonly [number, number, number] | readonly number[] | {
    x?: number;
    y?: number;
    z?: number;
};
export type KJCoreBooleanOperation = 'union' | 'intersection' | 'difference';
export interface KJCoreMeshInput {
    vertices?: readonly KJCorePoint3[];
    triangles?: readonly (readonly number[])[];
}
export interface KJCoreBoxOptions {
    center?: KJCorePoint3;
    size?: KJCorePoint3;
}
export interface KJCoreCylinderOptions {
    center?: KJCorePoint3;
    radius?: number;
    height?: number;
    segments?: number;
}
export interface KJCoreConeOptions {
    center?: KJCorePoint3;
    bottomRadius?: number;
    topRadius?: number;
    height?: number;
    segments?: number;
}
export interface KJCoreSphereOptions {
    center?: KJCorePoint3;
    radius?: number;
    segments?: number;
}
export interface KJCoreSweepOptions {
    profile?: readonly KJCorePoint3[];
    vector?: KJCorePoint3;
}
export interface KJCoreLoftOptions {
    bottom?: readonly KJCorePoint3[];
    top?: readonly KJCorePoint3[];
}
export interface KJCoreSerializedSolid extends Record<string, unknown> {
}
export declare class KJCoreSolidSession {
    #private;
    constructor(exports: KJCoreSolidExports, handle: number);
    get closed(): boolean;
    validate(): true;
    get volume(): number;
    serialize(): KJCoreSerializedSolid;
    transform(matrix: Iterable<number> | ArrayLike<number>): KJCoreSolidSession;
    boolean(other: KJCoreSolidSession, operation?: KJCoreBooleanOperation | string): KJCoreSolidSession;
    close(): boolean;
}
export interface KJCoreSolidBackend {
    readonly id: 'kanjie.kjcore.solid-wasm';
    readonly authoritative: true;
    readonly modelVersion: number;
    openMesh(mesh: KJCoreMeshInput): KJCoreSolidSession;
    box(options?: KJCoreBoxOptions): KJCoreSolidSession;
    cylinder(options?: KJCoreCylinderOptions): KJCoreSolidSession;
    cone(options?: KJCoreConeOptions): KJCoreSolidSession;
    sphere(options?: KJCoreSphereOptions): KJCoreSolidSession;
    sweep(options?: KJCoreSweepOptions): KJCoreSolidSession;
    loft(options?: KJCoreLoftOptions): KJCoreSolidSession;
}
export declare function createKJCoreSolidBackend(wasmModuleOrInstance: KJCoreSolidModule | unknown): Readonly<KJCoreSolidBackend>;
export declare const KJCORE_SOLID_MODEL_VERSION = 1;
export {};
