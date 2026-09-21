export declare const KJDRAW_GEOLOGY_PLAN_VERSION: '1.0.0';
type Point2 = [number, number];
type Point3 = [number, number, number];
type ScaleDenominator = 50 | 100 | 200 | 500 | 1000 | 2000;
export interface KJGeologyPlanBoreholeLabelLayout {
    idPosition: Point2;
    collarElevationPosition: Point2;
    depthPosition?: Point2;
    textHeight?: number;
    rotationDegrees?: number;
    precision?: number;
}
export interface KJGeologyPlanBorehole {
    id: string;
    position: Point2;
    collarElevation: number;
    depth?: number;
    kind?: 'borehole' | 'test-pit' | 'in-situ-test';
    labelLayout?: KJGeologyPlanBoreholeLabelLayout;
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
export interface KJGeologyPlanCoordinateCallout {
    id: string;
    point: Point2;
    elbow: Point2;
    landingEnd: Point2;
    xLabelPosition: Point2;
    yLabelPosition: Point2;
    precision?: number;
    textHeight?: number;
}
export interface KJGeologyPlanAlignedDimension {
    id: string;
    dimensionLinePoint: Point2;
    firstExtensionOrigin: Point2;
    secondExtensionOrigin: Point2;
    textPosition?: Point2;
    displayValue: number;
    precision?: number;
    unitSuffix?: 'none' | 'm' | 'M';
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
export interface KJGeologyPlanBaseMapStyle {
    id: string;
    color: number;
    lineweight: number;
    pattern: number[];
}
export interface KJGeologyPlanBaseMapTextStyle {
    id: string;
    fontFamily?: string | null;
    fontFile?: string | null;
    bigFontFile?: string | null;
    fixedHeight?: number;
    widthFactor?: number;
    obliqueAngleDegrees?: number;
    dxfFlags?: number;
    generationFlags?: number;
    lastHeight?: number;
}
export interface KJGeologyPlanBaseMapAttribute {
    id: string;
    styleId: string;
    textStyleId: string;
    tag: string;
    text: string;
    position: Point3;
    alignmentPoint?: Point3;
    height: number;
    rotationDegrees: number;
    widthFactor: number;
    obliqueAngleDegrees: number;
    horizontalAlignment: number;
    verticalAlignment: number;
    generationFlags: number;
    flags: number;
    lockPosition: boolean;
    extrusion: Point3;
}
export interface KJGeologyPlanBaseMapAttributeDefinition extends KJGeologyPlanBaseMapAttribute {
    kind: 'attributeDefinition';
    prompt: string;
}
export interface KJGeologyPlanBaseMapHatch {
    id: string;
    styleId: string;
    kind: 'hatch';
    patternName: string;
    solid: boolean;
    associative: boolean;
    patternAngleDegrees: number;
    patternScale: number;
    patternLines: {
        angleDegrees: number;
        base: Point2;
        offset: Point2;
        dashes: number[];
    }[];
    seedPoints: Point2[];
    boundaryLoops: {
        external: boolean;
        flags: number;
        closed: true;
        vertices: {
            point: Point2;
            bulge: number;
        }[];
        sourceMemberIds: string[];
    }[];
}
export type KJGeologyPlanBaseMapLinework = {
    id: string;
    styleId: string;
    kind: 'line';
    start: Point2;
    end: Point2;
} | {
    id: string;
    styleId: string;
    kind: 'arc';
    center: Point2;
    radius: number;
    startAngleDegrees: number;
    endAngleDegrees: number;
    clockwise?: boolean;
} | {
    id: string;
    styleId: string;
    kind: 'circle';
    center: Point2;
    radius: number;
} | {
    id: string;
    styleId: string;
    kind: 'polyline';
    points: Point2[];
    closed?: boolean;
    bulges?: number[];
    startWidths?: number[];
    endWidths?: number[];
} | {
    id: string;
    styleId: string;
    kind: 'legacyPolyline';
    legacyPoints: Point3[];
    closed: boolean;
    elevation: number;
    dxfFlags: number;
    vertexFlags: number[];
    bulges: number[];
    startWidths: number[];
    endWidths: number[];
};
export interface KJGeologyPlanBaseMapInsert {
    id: string;
    styleId: string;
    blockId: string;
    position: Point2;
    scale: Point3;
    rotationDegrees: number;
}
export interface KJGeologyPlanBaseMapBlock {
    id: string;
    extrusion?: Point3;
    attributes?: KJGeologyPlanBaseMapAttribute[];
    basePoint: Point2;
    entities: (KJGeologyPlanBaseMapLinework | KJGeologyPlanBaseMapHatch | KJGeologyPlanBaseMapAttributeDefinition | KJGeologyPlanBaseMapInsert)[];
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
    coordinateGrid?: KJGeologyPlanCoordinateGrid;
    coordinateCallouts?: KJGeologyPlanCoordinateCallout[];
    dimensions?: KJGeologyPlanAlignedDimension[];
    buildingFootprints?: KJGeologyPlanBuildingFootprint[];
    roadPaths?: KJGeologyPlanRoadPath[];
    baseMapStyles?: KJGeologyPlanBaseMapStyle[];
    baseMapTextStyles?: KJGeologyPlanBaseMapTextStyle[];
    baseMapLinework?: KJGeologyPlanBaseMapLinework[];
    baseMapBlocks?: KJGeologyPlanBaseMapBlock[];
    baseMapInserts?: KJGeologyPlanBaseMapInsert[];
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
    attributeSequence?: {
        attributes: {
            id: string;
            payload: Record<string, unknown>;
        }[];
        sequenceEnd: {
            id: string;
            dxfOwnerMode: 'insert' | 'space';
            layerId?: string;
        };
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
            layers: {
                id: string;
                name: string;
                color: number;
                linetypeId: string;
                lineweight: number;
            }[];
            textStyles: {
                id: string;
                name: string;
                payload: {
                    [k: string]: string | number | null | undefined;
                };
            }[];
            blocks: {
                id: string;
                name: string;
                basePoint: Point3;
                entities: EntitySpec[];
            }[];
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
        alignedDimensionCount: number;
        buildingFootprintCount: number;
        roadPathCount: number;
        roadSegmentCount: number;
        baseMapStyleCount: number;
        baseMapTextStyleCount: number;
        baseMapLineworkCount: number;
        baseMapAttributeDefinitionCount: number;
        baseMapAttributeCount: number;
        baseMapHatchCount: number;
        baseMapLineworkTypeCounts: {
            [k: string]: number;
        };
        baseMapBlockCount: number;
        baseMapBlockMemberCount: number;
        baseMapInsertCount: number;
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
        coordinateCalloutCount: number;
        coordinateConvention: 'engineering X=northing, Y=easting';
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
