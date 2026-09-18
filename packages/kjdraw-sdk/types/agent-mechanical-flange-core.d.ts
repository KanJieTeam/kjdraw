export declare const KJDRAW_MECHANICAL_FLANGE_CORE_VERSION: '1.0.0';
type Point2 = [number, number];
type Entity = {
    type: 'LINE' | 'CIRCLE';
    payload: Record<string, unknown>;
    options: {
        id: string;
    };
};
interface Document {
    id: string;
    revision: number;
    snapshot(): {
        header?: {
            units?: string;
        };
    };
}
export interface KJFlangeTitleGrid {
    origin: Point2;
    size: Point2;
    /** Full-height column boundaries measured from the grid's left edge. */
    columns: number[];
    /** Column boundaries that stop below the grid's top edge. */
    partialColumns?: {
        offset: number;
        height: number;
    }[];
    /** Row boundaries measured from the bottom; breaks split one row into segments. */
    rows: {
        offset: number;
        breaks?: number[];
    }[];
    diagonalHeader?: {
        width: number;
        drop: number;
    };
}
/** One source-measured meridian of an axially symmetric side view.
 *  Stations are absolute drawing X coordinates and radii are positive
 *  distances from the side-view axis. Repeated stations express shoulders.
 */
export interface KJFlangeSymmetricProfile {
    vertices: {
        station: number;
        radius: number;
    }[];
    endCaps?: 'none' | 'start' | 'end' | 'both';
}
export interface KJAgentMechanicalFlangeCoreInput {
    version: typeof KJDRAW_MECHANICAL_FLANGE_CORE_VERSION;
    expectedRevision: number;
    units: 'millimeter';
    drawingId: string;
    endView: {
        center: Point2;
        ringRadii: number[];
        squareHoles: {
            pitch: number;
            radius: number;
        };
    };
    sideViewAxis?: {
        xRange: Point2;
        symmetricProfiles?: KJFlangeSymmetricProfile[];
    };
    sheet: {
        origin: Point2;
        size: Point2;
        inset: number;
        titleGrid?: KJFlangeTitleGrid;
    };
}
/** Compile reusable flange and sheet facts; incomplete views remain incomplete. */
export declare function buildAgentMechanicalFlangeCore(document: Document, source: KJAgentMechanicalFlangeCoreInput): {
    commandArgs: {
        entities: Entity[];
        resources: {
            linetypes: {
                id: string;
                name: string;
                pattern: never[];
            }[];
            layers: {
                id: string;
                name: string;
                color: number;
                linetypeId: string;
                lineweight: number;
            }[];
        };
    };
    evidence: {
        knowledgePackId: string;
        knowledgePackVersion: string;
        expectedRevision: number;
        entityCount: number;
        parameters: {
            ringCount: number;
            squareHolePitch: number;
            squareHoleRadius: number;
            titleGrid: boolean;
            sideViewAxis: boolean;
            symmetricProfileCount: number;
        };
        limitations: string[];
    };
};
export {};
