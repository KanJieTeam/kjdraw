import type { KJDocument } from './document.js';
import type { KJObjectRecord, KJReadonlyObjectRecord } from './schema.js';
import type { KJSpatialSelectionOptions } from './selection-geometry.js';
export { isEntitySelectable, selectEntitiesInBox, selectEntitiesByFence } from './selection-geometry.js';
export type { KJBoxSelectionMode, KJSpatialSelectionOptions } from './selection-geometry.js';
export type KJEntityReference = string | {
    id: string;
};
export type KJSelectionReason = 'add' | 'remove' | 'clear' | 'replace';
export interface KJSelectionChange {
    reason: KJSelectionReason;
    changedIds: readonly string[];
    ids: readonly string[];
    size: number;
}
export interface KJSelectionMutationOptions {
    silent?: boolean;
}
export interface KJNamedSelectionSet {
    id: string;
    name: string | null;
    description: unknown;
    memberIds: readonly string[];
}
export interface KJSaveSelectionOptions {
    ids?: readonly KJEntityReference[];
    description?: unknown;
}
export declare const KJ_SELECTION_PROPERTIES: readonly ["id", "type", "name", "layer", "color", "linetype", "lineweight"];
export type KJSelectionProperty = typeof KJ_SELECTION_PROPERTIES[number];
export type KJSelectionPropertyOperator = 'equals' | 'not-equals';
export interface KJPropertySelectionQuery {
    property: KJSelectionProperty;
    value: string | number;
    operator?: KJSelectionPropertyOperator;
}
/** Select visible, editable entities by a bounded set of canonical CAD properties. Does not mutate document history. */
export declare function selectEntitiesByProperty(document: KJDocument, query: KJPropertySelectionQuery, options?: KJSpatialSelectionOptions): readonly string[];
export declare class KJSelectionSet {
    #private;
    constructor(document: KJDocument, ids?: readonly KJEntityReference[]);
    get size(): number;
    get ids(): readonly string[];
    get objects(): ReadonlyArray<KJReadonlyObjectRecord>;
    has(value: KJEntityReference): boolean;
    onChange(listener: (change: KJSelectionChange) => void, options?: {
        signal?: AbortSignal;
    }): () => void;
    add(values: KJEntityReference | readonly KJEntityReference[], { silent }?: KJSelectionMutationOptions): this;
    remove(values: KJEntityReference | readonly KJEntityReference[], { silent }?: KJSelectionMutationOptions): this;
    toggle(value: KJEntityReference): this;
    clear({ silent }?: KJSelectionMutationOptions): this;
    replace(values?: readonly KJEntityReference[], { silent }?: KJSelectionMutationOptions): this;
    selectWhere(predicate: (entity: KJReadonlyObjectRecord, index: number) => boolean, { append }?: {
        append?: boolean;
    }): this;
    prune(): string[];
}
export declare class KJSelectionManager {
    #private;
    readonly active: KJSelectionSet;
    constructor(document: KJDocument);
    dispose(): void;
    listNamed(): KJNamedSelectionSet[];
    getNamed(name: string): KJReadonlyObjectRecord | null;
    loadNamed(name: string, { append }?: {
        append?: boolean;
    }): KJSelectionSet;
    saveNamed(name: string, options?: KJSaveSelectionOptions): Promise<KJObjectRecord>;
    deleteNamed(name: string): Promise<boolean>;
}
