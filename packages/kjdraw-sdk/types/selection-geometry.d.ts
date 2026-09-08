import type { KJDocument } from './document.js';
import type { KJReadonlyObjectRecord } from './schema.js';
type Point = readonly [number, number];
export type KJBoxSelectionMode = 'window' | 'crossing';
export interface KJSpatialSelectionOptions {
    /** Defaults to the document model space. */
    spaceId?: string;
    /** Locked layers remain available to inspection tools when explicitly requested. */
    includeLocked?: boolean;
    /** Model-space tolerance. The Canvas adapter supplies a sub-pixel tolerance. */
    tolerance?: number;
}
/** One shared visibility/locking rule for picking, region queries and editable grips. */
export declare function isEntitySelectable(document: KJDocument, entity: KJReadonlyObjectRecord, options?: KJSpatialSelectionOptions): boolean;
/** Select complete geometry (window) or geometry touching the box (crossing), in model coordinates. Does not mutate selection/history. */
export declare function selectEntitiesInBox(document: KJDocument, first: Point, second: Point, mode?: KJBoxSelectionMode, options?: KJSpatialSelectionOptions): readonly string[];
/** Select geometry intersecting an open fence polyline. This is not a polygon/window query. */
export declare function selectEntitiesByFence(document: KJDocument, vertices: readonly Point[], options?: KJSpatialSelectionOptions): readonly string[];
export {};
