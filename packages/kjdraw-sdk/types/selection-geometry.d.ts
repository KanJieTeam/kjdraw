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
    /** Optional conservative candidate page supplied by a spatial index. */
    candidates?: ReadonlyArray<KJReadonlyObjectRecord>;
}
type DisplayBounds = readonly [number, number, number, number];
/** Conservative displayed XY bounds for viewport indexes. Null keeps an
 * unbounded or incompletely projected entity in every candidate page. */
export declare function displayedEntityBounds(document: KJDocument, entity: KJReadonlyObjectRecord, cache?: WeakMap<object, DisplayBounds | null>, depth?: number): DisplayBounds | null;
/** Conservative owner-XY query classification. Unknown geometry must remain visible to inspection callers. */
export declare function classifyEntityInBox(document: KJDocument, entity: KJReadonlyObjectRecord, bounds: readonly [number, number, number, number]): 'intersects' | 'outside' | 'unclassified';
/** Picking follows displayed label/curve extents, including approximate font metrics.
 * Unlike exact spatial query classification this does not claim CAD text outlines. */
export declare function hitTestDisplayedEntity(document: KJDocument, entity: KJReadonlyObjectRecord, at: Point, tolerance: number): boolean;
/** One shared visibility/locking rule for picking, region queries and editable grips. */
export declare function isEntitySelectable(document: KJDocument, entity: KJReadonlyObjectRecord, options?: KJSpatialSelectionOptions): boolean;
/** Select complete geometry (window) or geometry touching the box (crossing), in model coordinates. Does not mutate selection/history. */
export declare function selectEntitiesInBox(document: KJDocument, first: Point, second: Point, mode?: KJBoxSelectionMode, options?: KJSpatialSelectionOptions): readonly string[];
/** Select geometry intersecting an open fence polyline. This is not a polygon/window query. */
export declare function selectEntitiesByFence(document: KJDocument, vertices: readonly Point[], options?: KJSpatialSelectionOptions): readonly string[];
export {};
