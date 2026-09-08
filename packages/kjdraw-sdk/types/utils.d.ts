export type ReadonlyDeep<T> = T extends (...arguments_: never[]) => unknown ? T : T extends readonly unknown[] ? {
    readonly [Key in keyof T]: ReadonlyDeep<T[Key]>;
} : T extends object ? {
    readonly [Key in keyof T]: ReadonlyDeep<T[Key]>;
} : T;
export type KJClockConstructor = new () => {
    toISOString(): string;
};
export declare function clone<T>(value: T): T;
export declare function deepFreeze<T>(value: T, seen?: WeakSet<object>): ReadonlyDeep<T>;
export declare function assertPlainObject<T extends object>(value: T, label: string): T & Record<string, unknown>;
export declare function assertPlainObject(value: unknown, label: string): Record<string, unknown>;
export declare function normalizeName(value: unknown): string;
export declare function canonicalize(value: unknown): unknown;
export declare function canonicalStringify(value: unknown, space?: number | string): string | undefined;
export declare function fnv1a64(text: unknown): string;
export declare function stableHash(value: unknown): string;
export type KJHandleSource = string | number | bigint | boolean;
export declare function toHexHandle(value: KJHandleSource): string;
export declare function fromHexHandle(value: unknown): bigint;
export declare function nowIso(clock?: KJClockConstructor): string;
