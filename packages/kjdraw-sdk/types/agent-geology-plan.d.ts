export declare const KJDRAW_GEOLOGY_PLAN_VERSION: '1.0.0';
type Point2 = [number, number];
type Point3 = [number, number, number];
type ScaleDenominator = 50 | 100 | 200 | 500 | 1000 | 2000;
export interface KJGeologyPlanBorehole {
    id: string;
    position: Point2;
    collarElevation: number;
    depth?: number;
    kind?: 'borehole' | 'test-pit' | 'in-situ-test';
}
export interface KJGeologyPlanSectionLine {
    id: string;
    holeIds: string[];
    label: string;
    endpointLabels?: [string, string];
    markerClearance?: [number, number];
    endpointTailLengths?: [number, number];
    endpointLabelPositions?: [Point2, Point2];
}
export interface KJGeologyPlanCoordinateGrid {
    origin: Point2;
    spacing: number;
}
export interface KJGeologyPlanBuildingFootprint {
    id: string;
    outline: Point2[];
}
export type KJGeologyPlanRoadSegment = {
    kind: 'line';
    end: Point2;
} | {
    kind: 'arc';
    center: Point2;
    end: Point2;
    clockwise?: boolean;
};
export interface KJGeologyPlanRoadPath {
    id: string;
    start: Point2;
    segments: KJGeologyPlanRoadSegment[];
    closed?: boolean;
}
export interface KJAgentGeologyPlanInput {
    version: typeof KJDRAW_GEOLOGY_PLAN_VERSION;
    expectedRevision: number;
    units: 'meter';
    locale?: 'zh-CN' | 'en';
    drawingId: string;
    title?: string;
    revision?: string;
    scale: ScaleDenominator;
    boundary: Point2[];
    boreholes: KJGeologyPlanBorehole[];
    sectionLines: KJGeologyPlanSectionLine[];
    coordinateGrid: KJGeologyPlanCoordinateGrid;
    buildingFootprints?: KJGeologyPlanBuildingFootprint[];
    roadPaths?: KJGeologyPlanRoadPath[];
    northAngleDegrees?: number;
}
interface GeologyPlanDocument {
    id: string;
    revision: number;
    snapshot(): {
        header?: {
            units?: string;
        };
        objects?: Record<string, unknown>;
    };
}
type EntitySpec = {
    type: string;
    payload: Record<string, unknown>;
    options: {
        id: string;
    };
};
export declare function buildAgentGeologyPlan(document: GeologyPlanDocument, source: KJAgentGeologyPlanInput): {
    commandArgs: {
        entities: EntitySpec[];
        resources: {
            linetypes: {
                id: string;
                name: string;
                pattern: number[];
            }[];
            layers: ({
                id: `${string}-layer-boundary`;
                color: 7;
                linetypeId: string;
                lineweight: 50;
                name: string;
            } | {
                id: `${string}-layer-buildings`;
                color: 8;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-roads`;
                color: 3;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-grid`;
                color: 8;
                linetypeId: string;
                lineweight: 13;
                name: string;
            } | {
                id: `${string}-layer-points`;
                color: 1;
                linetypeId: string;
                lineweight: 35;
                name: string;
            } | {
                id: `${string}-layer-sections`;
                color: 2;
                linetypeId: string;
                lineweight: 35;
                name: string;
            } | {
                id: `${string}-layer-annotation`;
                color: 7;
                linetypeId: string;
                lineweight: 18;
                name: string;
            })[];
        };
        layout: {
            id: string;
            blockRecordId: string;
            name: string;
            dxfPlotSettings: {
                paperWidth: number;
                paperHeight: number;
                marginLeft: number;
                marginBottom: number;
                marginRight: number;
                marginTop: number;
                originX: number;
                originY: number;
                scaleNumerator: number;
                scaleDenominator: number;
                flags: number;
                paperUnits: 1;
                rotation: 0;
                plotType: 5;
            };
            viewport: {
                id: string;
                center: Point3;
                width: number;
                height: number;
                viewCenter: Point3;
                viewHeight: number;
                twistAngle: number;
                modelUnits: 'meter';
                scaleDenominator: ScaleDenominator;
            };
        };
    };
    outputConfig: {
        layoutName: string;
        paper: {
            standard: string;
            orientation: string;
            widthMm: number;
            heightMm: number;
        };
        scaleNumerator: number;
        scaleDenominator: ScaleDenominator;
        modelUnits: 'meter';
        viewport: {
            center: Point2;
            width: number;
            height: number;
        };
    };
    evidence: {
        drawingId: string;
        skillId: string;
        skillVersion: "1.0.0";
        expectedRevision: number;
        units: 'meter';
        modelEntityCount: number;
        entityCount: number;
        boreholeCount: number;
        sectionLineCount: number;
        buildingFootprintCount: number;
        roadPathCount: number;
        roadSegmentCount: number;
        sectionReferences: {
            id: string;
            label: string;
            holeIds: string[];
            endpointLabels: string[];
            markerClearance: number[] | undefined;
            endpointTailLengths: number[] | undefined;
            endpointLabelPositions: number[][] | undefined;
            segmentCount: number | undefined;
        }[];
        gridLineCount: number;
        coordinateBounds: {
            minimum: Point2;
            maximum: Point2;
        };
        scaleDenominator: ScaleDenominator;
        northAngleDegrees: number;
        externalBaseMapDependencies: string[];
        limitations: string[];
    };
};
export {};
