import type { KJDocument } from './document.js';
import type { KJReadonlyObjectRecord } from './schema.js';
export declare const KJ_SNAP_MODES: readonly ["endpoint", "midpoint", "center", "quadrant", "insertion", "node", "nearest", "intersection"];
export type KJSnapMode = typeof KJ_SNAP_MODES[number];
export type KJSnapPointInput = readonly number[] | {
    x: number;
    y: number;
    z?: number;
};
export type KJSnapPoint = [number, number, number];
export interface KJSnapCandidate extends Record<string, unknown> {
    mode: KJSnapMode;
    point: readonly [number, number, number];
    entityIds: readonly string[];
    distance: number;
    role?: string;
    vertexIndex?: number;
    segmentIndex?: number;
    parameter?: number;
    angle?: number;
}
export interface KJSnapOptions {
    radius?: number;
    modes?: readonly string[];
    entityIds?: readonly string[];
    maxIntersectionPairs?: number;
}
export declare function findSnapCandidates(document: KJDocument, cursorInput: KJSnapPointInput, options?: KJSnapOptions): readonly Readonly<KJSnapCandidate>[];
export declare function findBestSnap(document: KJDocument, cursor: KJSnapPointInput, options?: KJSnapOptions): Readonly<KJSnapCandidate> | null;
export interface KJNearestPointResult {
    point: readonly [number, number, number];
    distance: number;
    parameter: number | null;
    segmentIndex: number | null;
}
export declare function nearestPointOnEntity2(entity: KJReadonlyObjectRecord, pointInput: KJSnapPointInput): Readonly<KJNearestPointResult>;
export interface KJEntityIntersectionResult {
    kind: 'none' | 'point' | 'overlap';
    points: ReadonlyArray<readonly [number, number, number]>;
    infinite: boolean;
}
export declare function intersectEntityPair2(first: KJReadonlyObjectRecord, second: KJReadonlyObjectRecord): Readonly<KJEntityIntersectionResult>;
