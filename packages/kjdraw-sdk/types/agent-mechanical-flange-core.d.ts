export declare const KJDRAW_MECHANICAL_FLANGE_CORE_VERSION: '1.0.0';
type Point2 = [number, number];
type Entity = {
    type: 'LINE' | 'CIRCLE' | 'ARC' | 'TEXT' | 'MTEXT' | 'DIMENSION';
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
    /** Bounded horizontal rules measured from the grid's bottom and left edges. */
    horizontalSegments?: {
        offset: number;
        start: number;
        end: number;
    }[];
    /** Bounded vertical rules measured from the grid's left and bottom edges. */
    verticalSegments?: {
        offset: number;
        start: number;
        end: number;
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
/** Source-supplied visible sheet text. Content remains input data and is not
 *  retained by the reusable knowledge pack. */
export interface KJFlangeSheetNote {
    kind: 'single-line' | 'multiline';
    text: string;
    position: Point2;
    height: number;
    rotation?: number;
    width?: number;
}
/** A bounded native mechanical dimension supplied as engineering annotation
 *  facts. Measurements are derived from definition points, never accepted. */
export interface KJFlangeDimension {
    kind: 'aligned' | 'rotated' | 'diameter' | 'radius' | 'angular';
    definitionPoints: Point2[];
    textPosition?: Point2;
    textOverride?: string;
    rotation?: number;
}
/** Source-measured visible end-view outline geometry, expressed relative to
 *  the end-view center so that the same rule remains position independent. */
export type KJFlangeEndViewOutlineSegment = {
    kind: 'line';
    startOffset: Point2;
    endOffset: Point2;
} | {
    kind: 'arc';
    centerOffset: Point2;
    radius: number;
    startAngle: number;
    endAngle: number;
};
/** A source-positioned cutting-plane mark, relative to the end-view center.
 *  The stem and tick vectors retain the drafting direction of each mark. */
export interface KJFlangeCuttingPlaneMark {
    anchorOffset: Point2;
    stemVector: Point2;
    tickVector: Point2;
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
        outlineSegments?: KJFlangeEndViewOutlineSegment[];
        cuttingPlaneMarks?: KJFlangeCuttingPlaneMark[];
    };
    sideViewAxis?: {
        xRange: Point2;
        symmetricProfiles?: KJFlangeSymmetricProfile[];
    };
    dimensions?: KJFlangeDimension[];
    sheet: {
        origin: Point2;
        size: Point2;
        inset: number;
        titleGrid?: KJFlangeTitleGrid;
        notes?: KJFlangeSheetNote[];
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
            outlineSegmentCount: number;
            cuttingPlaneMarkCount: number;
            symmetricProfileCount: number;
            noteCount: number;
            dimensionCount: number;
        };
        limitations: string[];
    };
};
export {};
