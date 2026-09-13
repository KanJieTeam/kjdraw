export declare const KJDRAW_MANUFACTURING_SHEET_VERSION: '1.0.0';
export interface KJAgentManufacturingHolePattern {
    rows: number;
    columns: number;
    origin: [number, number];
    spacing: [number, number];
    throughDiameter: number;
    counterboreDiameter?: number;
    counterboreDepth?: number;
}
export interface KJAgentManufacturingSlot {
    center: [number, number];
    length: number;
    width: number;
    orientationDegrees: 0 | 90;
}
export interface KJAgentManufacturingSheetInput {
    version: typeof KJDRAW_MANUFACTURING_SHEET_VERSION;
    expectedRevision: number;
    units: 'millimeter';
    drawingId: string;
    title: string;
    revision: string;
    material: string;
    quantity: number;
    length: number;
    width: number;
    thickness: number;
    holePatterns?: KJAgentManufacturingHolePattern[];
    slots?: KJAgentManufacturingSlot[];
    sheet: {
        origin: [number, number];
        size: [number, number];
    };
    textHeight: number;
}
interface ManufacturingDocument {
    id: string;
    revision: number;
    snapshot(): {
        header?: {
            units?: string;
        };
    };
}
type EntitySpec = {
    type: string;
    payload: Record<string, unknown>;
    options: {
        id: string;
    };
};
export declare function buildAgentManufacturingSheet(document: ManufacturingDocument, source: KJAgentManufacturingSheetInput): {
    commandArgs: {
        entities: EntitySpec[];
        resources: {
            linetypes: {
                id: string;
                name: string;
                pattern: number[];
            }[];
            layers: ({
                id: `${string}-layer-object`;
                color: 7;
                linetypeId: string;
                lineweight: 35;
                name: string;
            } | {
                id: `${string}-layer-center`;
                color: 3;
                linetypeId: string;
                lineweight: 18;
                name: string;
            } | {
                id: `${string}-layer-hidden`;
                color: 8;
                linetypeId: string;
                lineweight: 18;
                name: string;
            } | {
                id: `${string}-layer-dim`;
                color: 2;
                linetypeId: string;
                lineweight: 18;
                name: string;
            } | {
                id: `${string}-layer-frame`;
                color: 7;
                linetypeId: string;
                lineweight: 25;
                name: string;
            } | {
                id: `${string}-layer-text`;
                color: 7;
                linetypeId: string;
                lineweight: 18;
                name: string;
            })[];
        };
    };
    evidence: {
        drawingId: string;
        skillId: string;
        skillVersion: "1.0.0";
        units: string;
        expectedRevision: number;
        entityCount: number;
        bounds: {
            min: [number, number];
            max: [number, number];
            width: number;
            height: number;
        };
        parameters: {
            title: string;
            revision: string;
            material: string;
            quantity: number;
            length: number;
            width: number;
            thickness: number;
            holePatternCount: number;
            holeCount: number;
            slotCount: number;
            sheet: {
                origin: [number, number];
                size: [number, number];
            };
            textHeight: number;
            viewScale: number;
        };
        limitations: string[];
    };
};
export {};
