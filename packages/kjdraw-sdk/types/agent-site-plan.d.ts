export declare const KJDRAW_SITE_PLAN_VERSION: '1.0.0';
export type KJAgentSiteUtilityKind = 'water' | 'drainage' | 'power' | 'gas' | 'telecom';
export interface KJAgentSiteRoad {
    name: string;
    width: number;
    centerline: [number, number][];
}
export interface KJAgentSiteBuilding {
    name: string;
    floors?: number;
    footprint: [number, number][];
}
export interface KJAgentSiteUtility {
    kind: KJAgentSiteUtilityKind;
    name: string;
    path: [number, number][];
    diameterMm?: number;
    nodeIndices?: number[];
}
export interface KJAgentSiteCoordinateReference {
    position: [number, number];
    easting: number;
    northing: number;
    crs: string;
}
export interface KJAgentSitePlanInput {
    version: typeof KJDRAW_SITE_PLAN_VERSION;
    expectedRevision: number;
    units: 'meter';
    drawingId: string;
    title: string;
    revision: string;
    boundary: [number, number][];
    roads: KJAgentSiteRoad[];
    buildings: KJAgentSiteBuilding[];
    utilities: KJAgentSiteUtility[];
    coordinateReference: KJAgentSiteCoordinateReference;
    northAngleDegrees?: number;
    scale: 500;
}
interface SitePlanDocument {
    id: string;
    revision: number;
    snapshot(): {
        header?: {
            units?: string;
        };
        objects?: Record<string, unknown>;
    };
}
type Point2 = [number, number];
type Point3 = [number, number, number];
type EntitySpec = {
    type: string;
    payload: Record<string, unknown>;
    options: {
        id: string;
    };
};
export declare function buildAgentSitePlan(document: SitePlanDocument, source: KJAgentSitePlanInput): {
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
                id: `${string}-layer-road-edge`;
                color: 8;
                linetypeId: string;
                lineweight: 35;
                name: string;
            } | {
                id: `${string}-layer-road-center`;
                color: 2;
                linetypeId: string;
                lineweight: 18;
                name: string;
            } | {
                id: `${string}-layer-building`;
                color: 1;
                linetypeId: string;
                lineweight: 50;
                name: string;
            } | {
                id: `${string}-layer-water`;
                color: 5;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-drainage`;
                color: 3;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-power`;
                color: 6;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-gas`;
                color: 30;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-telecom`;
                color: 4;
                linetypeId: string;
                lineweight: 18;
                name: string;
            } | {
                id: `${string}-layer-utility-node`;
                color: 7;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-annotation`;
                color: 7;
                linetypeId: string;
                lineweight: 18;
                name: string;
            } | {
                id: `${string}-layer-dimensions`;
                color: 2;
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
                scaleDenominator: number;
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
            marginsMm: {
                left: number;
                right: number;
                top: number;
                bottom: number;
            };
        };
        scaleNumerator: number;
        scaleDenominator: number;
        modelUnits: 'meter';
        viewport: {
            center: Point2;
            bounds: {
                minimum: Point2;
                maximum: Point2;
            };
            width: number;
            height: number;
        };
    };
    evidence: {
        drawingId: string;
        skillId: string;
        skillVersion: "1.0.0";
        units: 'meter';
        expectedRevision: number;
        modelEntityCount: number;
        entityCount: number;
        siteAreaSquareMeters: number;
        boundaryBounds: {
            minimum: Point2;
            maximum: Point2;
            width: number;
            height: number;
        };
        roadCount: number;
        roadCenterlineMeters: number;
        buildingCount: number;
        buildingAreasSquareMeters: {
            name: string;
            area: number;
        }[];
        utilityCount: number;
        utilityMeters: number;
        utilityNodeCount: number;
        coordinateReference: {
            position: Point2;
            easting: number;
            northing: number;
            crs: string;
        };
        output: {
            layoutName: string;
            paper: {
                standard: string;
                orientation: string;
                widthMm: number;
                heightMm: number;
                marginsMm: {
                    left: number;
                    right: number;
                    top: number;
                    bottom: number;
                };
            };
            scaleNumerator: number;
            scaleDenominator: number;
            modelUnits: 'meter';
            viewport: {
                center: Point2;
                bounds: {
                    minimum: Point2;
                    maximum: Point2;
                };
                width: number;
                height: number;
            };
        };
        limitations: string[];
    };
};
export {};
