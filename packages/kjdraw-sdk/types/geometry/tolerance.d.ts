export interface KJToleranceOptions {
    absolute?: number;
    relative?: number;
    angular?: number;
}
export declare class KJTolerance {
    readonly absolute: number;
    readonly relative: number;
    readonly angular: number;
    constructor({ absolute, relative, angular }?: KJToleranceOptions);
    distanceFor(...values: readonly number[]): number;
    equal(a: number, b: number): boolean;
    zero(value: number, scale?: number): boolean;
    angleEqual(a: number, b: number): boolean;
}
export declare function normalizeAngle(value: number): number;
export declare const DEFAULT_TOLERANCE: KJTolerance;
