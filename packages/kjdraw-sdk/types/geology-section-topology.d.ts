export interface KJSectionTopologyStratum {
    intervalId?: string;
    groupId?: string;
    groupRole?: 'principal' | 'lens';
    code: string;
    top: number;
    bottom: number;
}
export interface KJSectionTopologyHole {
    id: string;
    station: number;
    collarElevation: number;
    depth: number;
    strata: readonly KJSectionTopologyStratum[];
}
export interface KJSectionTopologyPoint {
    station: number;
    elevation: number;
}
export interface KJSectionTopologyCell {
    kind: 'main' | 'lens';
    identity: string;
    occurrence: number;
    leftHoleId: string;
    rightHoleId: string;
    points: KJSectionTopologyPoint[];
    source: KJSectionTopologyStratum;
    pinchout: boolean;
}
export interface KJSectionTopologyBoundary {
    identity: string;
    leftHoleId: string;
    rightHoleId: string;
    mode: 'known-known' | 'known-missing-midpoint' | 'missing-known-midpoint';
    points: [KJSectionTopologyPoint, KJSectionTopologyPoint];
}
export interface KJSectionTopologyResult {
    mainCells: KJSectionTopologyCell[];
    lensCells: KJSectionTopologyCell[];
    mainBoundaries: KJSectionTopologyBoundary[];
    mainIdentityCount: number;
    lensIdentityCount: number;
}
/**
 * Compile source-declared major groups and exact lens occurrences into section
 * cells. A final interval ending at exploration depth proves presence only; it
 * does not prove a geological bottom. No correlation is invented from names,
 * lithology or visual proximity.
 */
export declare function compileGeologySectionTopology(rawHoles: readonly KJSectionTopologyHole[]): KJSectionTopologyResult;
