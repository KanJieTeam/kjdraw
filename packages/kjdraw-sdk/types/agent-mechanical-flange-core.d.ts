export declare const KJDRAW_MECHANICAL_FLANGE_CORE_VERSION: '1.0.0';
type Point2 = [number, number];
type Point3 = [number, number, number];
type Entity = {
    type: 'LINE' | 'CIRCLE' | 'ARC' | 'ELLIPSE' | 'LWPOLYLINE' | 'SPLINE' | 'SOLID' | 'LEADER' | 'TEXT' | 'MTEXT' | 'DIMENSION' | 'TOLERANCE' | 'HATCH' | 'INSERT';
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
    getTable?: (name: string) => {
        records: {
            id: string;
            name?: string;
            payload?: Record<string, unknown>;
        }[];
    } | undefined;
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
/** Source-measured side-view geometry. Stations use drawing X coordinates;
 *  offsets are measured from the shared projection axis. */
export type KJFlangeSideViewOutlineSegment = {
    kind: 'line';
    start: {
        station: number;
        offset: number;
    };
    end: {
        station: number;
        offset: number;
    };
} | {
    kind: 'arc';
    center: {
        station: number;
        offset: number;
    };
    radius: number;
    startAngle: number;
    endAngle: number;
} | {
    kind: 'circle';
    center: {
        station: number;
        offset: number;
    };
    radius: number;
};
/** A source-measured cut face in the side view. Boundary coordinates are
 *  relative to the projection axis; the pattern is generated, not copied
 *  from DXF tags or a private block definition. */
export interface KJFlangeSectionHatch {
    edges: ({
        kind: 'line';
        start: {
            station: number;
            offset: number;
        };
        end: {
            station: number;
            offset: number;
        };
    } | {
        kind: 'arc';
        center: {
            station: number;
            offset: number;
        };
        radius: number;
        startAngle: number;
        endAngle: number;
        counterClockwise?: boolean;
    })[];
    lineAngle: number;
    lineSpacing: number;
    patternOrigin?: Point2;
}
/** Drawing-style roles are caller-supplied facts. The compiler never embeds
 * a source application's layer or style catalogue; a caller may map its
 * local roles to these generic roles for faithful output. */
export interface KJFlangeStyleRole {
    layerName?: string;
    color?: number;
    lineweight?: number;
    linetypeName?: string;
    linetypePattern?: number[];
}
export interface KJFlangeStyleProfile {
    frame?: KJFlangeStyleRole;
    grid?: KJFlangeStyleRole;
    geometry?: KJFlangeStyleRole;
    center?: KJFlangeStyleRole;
    notes?: KJFlangeStyleRole;
    dimensions?: KJFlangeStyleRole;
    hatch?: KJFlangeStyleRole;
    hidden?: KJFlangeStyleRole;
}
/** Bounded source-measured line facts that do not belong to a primary view
 *  profile (for example a projection aid or a local sheet rule). */
export interface KJFlangeAuxiliaryLine {
    start: Point2;
    end: Point2;
    role: 'geometry' | 'center' | 'hidden' | 'notes' | 'grid' | 'frame';
}
export type KJFlangeAuxiliaryCurve = {
    kind: 'arc';
    center: Point2;
    radius: number;
    startAngle: number;
    endAngle: number;
    clockwise?: boolean;
    role: KJFlangeAuxiliaryLine['role'];
} | {
    kind: 'ellipse';
    center: Point2;
    majorAxis: Point2;
    ratio: number;
    startParameter: number;
    endParameter: number;
    role: KJFlangeAuxiliaryLine['role'];
} | {
    kind: 'polyline';
    vertices: {
        point: Point2;
        bulge?: number;
        startWidth?: number;
        endWidth?: number;
    }[];
    closed?: boolean;
    role: KJFlangeAuxiliaryLine['role'];
} | {
    kind: 'spline';
    degree: number;
    controlPoints: Point2[];
    knots: number[];
    fitPoints?: Point2[];
    weights?: number[];
    closed?: boolean;
    periodic?: boolean;
    role: KJFlangeAuxiliaryLine['role'];
};
/** A reusable local symbol definition. Only visible native geometry and text
 * are accepted; source handles, block names and application metadata are not. */
export type KJFlangeSymbolMember = {
    kind: 'line';
    start: Point2;
    end: Point2;
    role: KJFlangeAuxiliaryLine['role'];
} | {
    kind: 'circle';
    center: Point2;
    radius: number;
    role: KJFlangeAuxiliaryLine['role'];
} | {
    kind: 'arc';
    center: Point2;
    radius: number;
    startAngle: number;
    endAngle: number;
    clockwise?: boolean;
    role: KJFlangeAuxiliaryLine['role'];
} | {
    kind: 'multiline-text';
    text: string;
    position: Point2;
    height: number;
    rotation?: number;
    width?: number;
    attachmentPoint?: number;
    styleKey?: string;
    role: KJFlangeAuxiliaryLine['role'];
};
export interface KJFlangeSymbolDefinition {
    key: string;
    basePoint: Point2;
    members: KJFlangeSymbolMember[];
}
export interface KJFlangeSymbolInstance {
    symbolKey: string;
    position: Point2;
    scale?: Point2;
    rotation?: number;
    role: KJFlangeAuxiliaryLine['role'];
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
    styleKey?: string;
}
/** A bounded native mechanical dimension supplied as engineering annotation
 *  facts. Measurements are derived from definition points, never accepted. */
export interface KJFlangeDimension {
    kind: 'aligned' | 'rotated' | 'diameter' | 'radius' | 'angular';
    definitionPoints: Point2[];
    textPosition?: Point2;
    textOverride?: string;
    rotation?: number;
    styleKey?: string;
}
/** A source-measured native leader without private annotation handles. */
export interface KJFlangeLeader {
    vertices: Point2[];
    arrowEnabled?: boolean;
    pathType?: number;
    annotationType?: number;
    hookLineDirection?: number;
    hookLineEnabled?: boolean;
}
export type KJFlangeGeometricCharacteristic = 'position' | 'concentricity' | 'symmetry' | 'parallelism' | 'perpendicularity' | 'angularity' | 'cylindricity' | 'flatness' | 'circularity' | 'straightness' | 'surface-profile' | 'line-profile' | 'circular-runout' | 'total-runout';
export type KJFlangeMaterialCondition = 'maximum' | 'least' | 'regardless';
export interface KJFlangeFeatureControlFrame {
    position: Point2;
    rows: {
        characteristic: KJFlangeGeometricCharacteristic;
        tolerance: string;
        diameterZone?: boolean;
        materialCondition?: KJFlangeMaterialCondition;
        datumReferences?: {
            label: string;
            materialCondition?: KJFlangeMaterialCondition;
        }[];
    }[];
    xAxisDirection?: Point2;
    styleKey?: string;
    role: 'dimensions' | 'notes';
}
export interface KJFlangeTextStyleDefinition {
    key: string;
    name: string;
    fontFamily?: string | null;
    fontFile?: string | null;
    bigFontFile?: string | null;
    fixedHeight?: number;
    widthFactor?: number;
    obliqueAngle?: number;
    dxfFlags?: number;
    generationFlags?: number;
    lastHeight?: number;
}
export interface KJFlangeDimensionStyleDefinition {
    key: string;
    name: string;
    overallScale?: number;
    arrowSize?: number;
    extensionOffset?: number;
    baselineSpacing?: number;
    extensionBeyond?: number;
    rounding?: number;
    textHeight?: number;
    decimalPlaces?: number;
    angularDecimalPlaces?: number;
    angularUnits?: number;
    centerMarkSize?: number;
    textGap?: number;
    dxfFlags?: number;
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
} | {
    kind: 'circle';
    centerOffset: Point2;
    radius: number;
};
/** A source-positioned cutting-plane mark, relative to the end-view center.
 *  The stem and tick vectors retain the drafting direction of each mark. */
export interface KJFlangeCuttingPlaneMark {
    anchorOffset: Point2;
    stemVector: Point2;
    tickVector: Point2;
    arrowhead?: {
        length: number;
        width: number;
    };
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
        outlineSegments?: KJFlangeSideViewOutlineSegment[];
        sectionHatches?: KJFlangeSectionHatch[];
    };
    dimensions?: KJFlangeDimension[];
    leaders?: KJFlangeLeader[];
    featureControlFrames?: KJFlangeFeatureControlFrame[];
    auxiliaryLines?: KJFlangeAuxiliaryLine[];
    auxiliaryCurves?: KJFlangeAuxiliaryCurve[];
    symbols?: {
        definitions: KJFlangeSymbolDefinition[];
        instances: KJFlangeSymbolInstance[];
    };
    styleResources?: {
        textStyles: KJFlangeTextStyleDefinition[];
        dimensionStyles: KJFlangeDimensionStyleDefinition[];
    };
    styleProfile?: KJFlangeStyleProfile;
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
                pattern: number[];
            }[];
            layers: {
                id: string;
                name: string;
                color: number;
                linetypeId: string;
                lineweight: number;
            }[];
            textStyles?: {
                id: string;
                name: string;
                payload: Record<string, unknown>;
            }[];
            dimensionStyles?: {
                id: string;
                name: string;
                payload: Record<string, unknown>;
            }[];
            blocks?: {
                id: string;
                name: string;
                basePoint: Point3;
                entities: {
                    type: "ARC" | "CIRCLE" | "LINE" | "MTEXT";
                    payload: Record<string, unknown>;
                    options: {
                        id: string;
                    };
                }[];
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
            sideOutlineSegmentCount: number;
            sectionHatchCount: number;
            auxiliaryLineCount: number;
            auxiliaryCurveCount: number;
            symbolDefinitionCount: number;
            symbolInstanceCount: number;
            featureControlFrameCount: number;
            textStyleCount: number;
            dimensionStyleCount: number;
            noteCount: number;
            dimensionCount: number;
            leaderCount: number;
        };
        limitations: string[];
    };
};
export {};
