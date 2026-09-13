export declare const KJDRAW_ARCHITECTURE_PLAN_VERSION: '1.0.0';
export type KJArchitectureWallReference = 'north' | 'south' | 'east' | 'west' | string;
export type KJArchitectureOpeningKind = 'door' | 'window';
export interface KJAgentArchitectureOpening {
    wall: KJArchitectureWallReference;
    offset: number;
    width: number;
    kind: KJArchitectureOpeningKind;
}
export interface KJAgentArchitecturePartitionOpening {
    offset: number;
    width: number;
    kind: KJArchitectureOpeningKind;
}
export interface KJAgentArchitecturePartition {
    id: string;
    axis: 'horizontal' | 'vertical';
    position: number;
    start: number;
    end: number;
    openings?: KJAgentArchitecturePartitionOpening[];
}
export interface KJAgentArchitectureRoom {
    id: string;
    name: string;
    bounds: [number, number, number, number];
}
export interface KJAgentArchitecturePlanInput {
    version: typeof KJDRAW_ARCHITECTURE_PLAN_VERSION;
    expectedRevision: number;
    units: 'millimeter';
    drawingId: string;
    title: string;
    width: number;
    depth: number;
    wallThickness: number;
    exteriorOpenings?: KJAgentArchitectureOpening[];
    partitions?: KJAgentArchitecturePartition[];
    rooms: KJAgentArchitectureRoom[];
    textHeight?: number;
}
interface ArchitectureDocument {
    id: string;
    revision: number;
    snapshot(): {
        header?: {
            units?: string;
        };
    };
    listEntities(): readonly unknown[];
}
type Point3 = [number, number, number];
type EntitySpec = {
    type: string;
    payload: Record<string, unknown>;
    options: {
        id: string;
    };
};
type BlockSpec = {
    id: string;
    name: string;
    basePoint: Point3;
    entities: EntitySpec[];
};
export declare function buildAgentArchitecturePlan(document: ArchitectureDocument, source: KJAgentArchitecturePlanInput): {
    commandArgs: {
        entities: EntitySpec[];
        resources: {
            linetypes: {
                id: string;
                name: string;
                pattern: number[];
            }[];
            layers: ({
                id: `${string}-layer-wall`;
                color: 7;
                linetypeId: string;
                lineweight: 50;
                name: string;
            } | {
                id: `${string}-layer-door`;
                color: 1;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-window`;
                color: 5;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-anno`;
                color: 3;
                linetypeId: string;
                lineweight: 18;
                name: string;
            } | {
                id: `${string}-layer-dims`;
                color: 2;
                linetypeId: string;
                lineweight: 18;
                name: string;
            } | {
                id: `${string}-layer-sheet`;
                color: 8;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-room`;
                color: 4;
                linetypeId: string;
                lineweight: 13;
                name: string;
            })[];
            blocks: BlockSpec[];
        };
    };
    evidence: {
        drawingId: string;
        skillId: string;
        skillVersion: "1.0.0";
        units: string;
        expectedRevision: number;
        entityCount: number;
        modelEntityCount: number;
        blockDefinitionCount: number;
        blockMemberCount: number;
        parameters: {
            title: string;
            width: number;
            depth: number;
            wallThickness: number;
            partitionCount: number;
            openingCount: number;
            roomCount: number;
            roomAreasSquareMeters: {
                [k: string]: number;
            };
            sheet: {
                paper: string;
                scale: string;
                modelFrame: {
                    origin: number[];
                    size: number[];
                };
            };
        };
        validation: {
            blankDocument: boolean;
            wallBounds: boolean;
            openingBounds: boolean;
            openingSeparation: boolean;
            roomBounds: boolean;
            roomOverlap: boolean;
            roomPartitionIntersections: boolean;
        };
        limitations: string[];
    };
};
export {};
