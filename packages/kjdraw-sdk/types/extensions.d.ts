import { type ReadonlyDeep } from './utils.js';
export declare const KJ_EXTENSION_POINTS: readonly ["entity-type", "object-type", "geometry-kernel", "renderer", "file-adapter", "command", "tool", "snap-provider", "property-provider", "workspace", "survey-package"];
export type KJExtensionPoint = typeof KJ_EXTENSION_POINTS[number];
export interface KJExtensionDefinition extends Record<string, unknown> {
    id?: unknown;
}
export type KJRegisteredExtension = ReadonlyDeep<Record<string, unknown> & {
    id: string;
    owner: string;
}>;
export interface KJExtensionRegistrationOptions {
    owner?: string;
    replace?: boolean;
}
export declare class KJExtensionRegistry {
    #private;
    constructor(points?: readonly string[]);
    register(point: string, definition: KJExtensionDefinition, { owner, replace }?: KJExtensionRegistrationOptions): () => boolean;
    get(point: string, id: unknown): KJRegisteredExtension | null;
    has(point: string, id: unknown): boolean;
    list(point: string): KJRegisteredExtension[];
    removeOwner(owner: unknown): number;
}
