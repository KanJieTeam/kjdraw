export declare const KJDRAW_MECHANICAL_FLANGE_CORE_VERSION: '1.0.0';
type Point2 = [number, number];
type Point3 = [number, number, number];
type Point2Or3 = Point2 | Point3;
type Entity = {
    type: 'LINE' | 'CIRCLE' | 'ARC' | 'ELLIPSE' | 'LWPOLYLINE' | 'SPLINE' | 'SOLID' | 'LEADER' | 'TEXT' | 'MTEXT' | 'ATTDEF' | 'DIMENSION' | 'TOLERANCE' | 'HATCH' | 'INSERT';
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
    columns: (number | {
        offset: number;
        styleKey?: string;
    })[];
    /** Column boundaries that stop below the grid's top edge. */
    partialColumns?: {
        offset: number;
        height: number;
        styleKey?: string;
    }[];
    /** Row boundaries measured from the bottom; breaks split one row into segments. */
    rows: {
        offset: number;
        breaks?: number[];
        styleKey?: string;
    }[];
    /** Bounded horizontal rules measured from the grid's bottom and left edges. */
    horizontalSegments?: {
        offset: number;
        start: number;
        end: number;
        styleKey?: string;
    }[];
    /** Bounded vertical rules measured from the grid's left and bottom edges. */
    verticalSegments?: {
        offset: number;
        start: number;
        end: number;
        styleKey?: string;
    }[];
    topStyleKey?: string;
    diagonalHeader?: {
        width: number;
        drop: number;
        styleKey?: string;
    };
}
/** One source-measured meridian of an axially symmetric side view.
 *  Stations are absolute drawing X coordinates and radii are positive
 *  distances from the side-view axis. Repeated stations express shoulders.
 */
export type KJFlangeLineDirection = 'forward' | 'reverse';
export interface KJFlangeSymmetricProfile {
    vertices: {
        station: number;
        radius: number;
    }[];
    endCaps?: 'none' | 'start' | 'end' | 'both';
    segmentDirections?: {
        upper?: KJFlangeLineDirection;
        lower?: KJFlangeLineDirection;
    }[];
    startCapDirection?: KJFlangeLineDirection;
    endCapDirection?: KJFlangeLineDirection;
    styleKey?: string;
    startCapStyleKey?: string;
    endCapStyleKey?: string;
}
/** Source-measured side-view geometry. Stations follow the configured
 *  projection axis; offsets are measured perpendicular to that axis. */
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
    styleKey?: string;
} | {
    kind: 'arc';
    center: {
        station: number;
        offset: number;
    };
    radius: number;
    startAngle: number;
    endAngle: number;
    styleKey?: string;
} | {
    kind: 'circle';
    center: {
        station: number;
        offset: number;
    };
    radius: number;
    styleKey?: string;
};
/** One explicit, source-measured line family in a section pattern. */
export interface KJFlangeHatchPatternLine {
    angle: number;
    base: Point2;
    offset: Point2;
    dashes?: number[];
}
/** A source-measured cut face in the side view. Boundary coordinates are
 *  relative to the projection axis. Pattern geometry is represented as
 *  bounded semantic line families, never as raw DXF tags. */
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
    /** Solid fills do not accept pattern-line fields. */
    solid?: boolean;
    /** Defaults to SOLID for solid fills and ANSI31 for patterned fills. */
    patternName?: string;
    /** Legacy one-family shorthand retained for existing callers. */
    lineAngle?: number;
    lineSpacing?: number;
    patternOrigin?: Point2;
    /** Exact bounded line families for patterns such as ANSI32. */
    patternLines?: KJFlangeHatchPatternLine[];
    styleKey?: string;
}
/** An independent source-measured hatch in absolute drawing coordinates.
 *  Use this for detached sections, auxiliary views and sheet marks that do
 *  not share the side-view projection axis. */
export interface KJFlangeAuxiliaryHatch {
    edges: ({
        kind: 'line';
        start: Point2;
        end: Point2;
    } | {
        kind: 'arc';
        center: Point2;
        radius: number;
        startAngle: number;
        endAngle: number;
        counterClockwise?: boolean;
    })[];
    solid?: boolean;
    patternName?: string;
    lineAngle?: number;
    lineSpacing?: number;
    patternOrigin?: Point2;
    patternLines?: KJFlangeHatchPatternLine[];
    styleKey?: string;
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
    /** Per-entity linetype scale. The referenced linetype definition remains reusable. */
    linetypeScale?: number;
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
    custom?: ({
        key: string;
    } & KJFlangeStyleRole)[];
}
export type KJFlangeFrameSide = 'bottom' | 'right' | 'top' | 'left';
/** Bounded source-measured line facts that do not belong to a primary view
 *  profile (for example a projection aid or a local sheet rule). */
export interface KJFlangeAuxiliaryLine {
    start: Point2;
    end: Point2;
    role: 'geometry' | 'center' | 'hidden' | 'notes' | 'grid' | 'frame';
    styleKey?: string;
}
/** Bounded source-measured filled planar faces, including native CAD arrowheads. */
export interface KJFlangeAuxiliarySolid {
    vertices: Point2[];
    role: KJFlangeAuxiliaryLine['role'];
    styleKey?: string;
}
export type KJFlangeAuxiliaryCurve = {
    kind: 'arc';
    center: Point2;
    radius: number;
    startAngle: number;
    endAngle: number;
    clockwise?: boolean;
    role: KJFlangeAuxiliaryLine['role'];
    styleKey?: string;
} | {
    kind: 'ellipse';
    center: Point2;
    majorAxis: Point2;
    ratio: number;
    startParameter: number;
    endParameter: number;
    role: KJFlangeAuxiliaryLine['role'];
    styleKey?: string;
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
    styleKey?: string;
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
    styleKey?: string;
};
/** A reusable local symbol definition. Only visible native geometry and text
 * are accepted; source handles, block names and application metadata are not. */
export type KJFlangeSymbolMember = {
    kind: 'line';
    start: Point2;
    end: Point2;
    role: KJFlangeAuxiliaryLine['role'];
    entityStyleKey?: string;
} | {
    kind: 'circle';
    center: Point2;
    radius: number;
    role: KJFlangeAuxiliaryLine['role'];
    entityStyleKey?: string;
} | {
    kind: 'arc';
    center: Point2;
    radius: number;
    startAngle: number;
    endAngle: number;
    clockwise?: boolean;
    role: KJFlangeAuxiliaryLine['role'];
    entityStyleKey?: string;
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
    entityStyleKey?: string;
} | ({
    kind: 'attribute-definition';
} & KJFlangeSymbolAttribute) | {
    kind: 'instance';
    symbolKey: string;
    position: Point2Or3;
    scale?: Point2;
    rotation?: number;
    role: KJFlangeAuxiliaryLine['role'];
    entityStyleKey?: string;
};
export interface KJFlangeSymbolAttribute {
    text: string;
    tag: string;
    prompt?: string;
    position: Point2;
    alignmentPoint?: Point2;
    height: number;
    rotation?: number;
    widthFactor?: number;
    obliqueAngle?: number;
    horizontalAlignment?: number;
    verticalAlignment?: number;
    generationFlags?: number;
    flags?: number;
    lockPosition?: boolean;
    styleKey?: string;
    role: KJFlangeAuxiliaryLine['role'];
    entityStyleKey?: string;
}
export interface KJFlangeSymbolDefinition {
    key: string;
    basePoint: Point2;
    members: KJFlangeSymbolMember[];
}
export interface KJFlangeSymbolInstance {
    symbolKey: string;
    position: Point2Or3;
    scale?: Point2;
    rotation?: number;
    role: KJFlangeAuxiliaryLine['role'];
    styleKey?: string;
    attributes?: KJFlangeSymbolAttribute[];
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
    attachmentPoint?: number;
    styleKey?: string;
    entityStyleKey?: string;
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
    /** Native DXF leader annotation height/width (groups 40/41). */
    textHeight?: number;
    textWidth?: number;
    styleKey?: string;
}
export type KJFlangeGeometricCharacteristic = 'position' | 'concentricity' | 'symmetry' | 'parallelism' | 'perpendicularity' | 'angularity' | 'cylindricity' | 'flatness' | 'circularity' | 'straightness' | 'surface-profile' | 'line-profile' | 'circular-runout' | 'total-runout';
export type KJFlangeMaterialCondition = 'maximum' | 'least' | 'regardless';
export interface KJFlangeDatumReference {
    label: string;
    materialCondition?: KJFlangeMaterialCondition;
    slot?: number;
}
export interface KJFlangeFeatureControlFrame {
    position: Point2;
    rows: {
        characteristic: KJFlangeGeometricCharacteristic;
        tolerance: string;
        diameterZone?: boolean;
        materialCondition?: KJFlangeMaterialCondition;
        datumReferences?: KJFlangeDatumReference[];
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
    styleKey?: string;
} | {
    kind: 'arc';
    centerOffset: Point2;
    radius: number;
    startAngle: number;
    endAngle: number;
    styleKey?: string;
} | {
    kind: 'circle';
    centerOffset: Point2;
    radius: number;
    styleKey?: string;
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
    stemStyleKey?: string;
    tickStyleKey?: string;
    arrowheadStyleKey?: string;
}
/** A source-measured circular hole array. Angles are radians, counterclockwise
 *  from the positive X axis, and the pattern remains relative to endView.center. */
export interface KJFlangePolarHolePattern {
    count: number;
    pitchRadius: number;
    holeRadius: number;
    startAngle?: number;
    styleKey?: string;
}
export interface KJAgentMechanicalFlangeCoreInput {
    version: typeof KJDRAW_MECHANICAL_FLANGE_CORE_VERSION;
    expectedRevision: number;
    units: 'millimeter';
    drawingId: string;
    entityDrawOrder?: number[];
    endView: {
        center: Point2;
        ringRadii: number[];
        ringStyleKeys?: (string | null)[];
        squareHoles?: {
            pitch: number;
            radius: number;
        };
        holePatterns?: KJFlangePolarHolePattern[];
        outlineSegments?: KJFlangeEndViewOutlineSegment[];
        cuttingPlaneMarks?: KJFlangeCuttingPlaneMark[];
    };
    sideViewAxis?: {
        xRange?: Point2;
        stationRange?: Point2;
        orientation?: 'horizontal' | 'vertical';
        axisCoordinate?: number;
        axisVisible?: boolean;
        axisDirection?: 'forward' | 'reverse';
        axisStyleKey?: string;
        symmetricProfiles?: KJFlangeSymmetricProfile[];
        outlineSegments?: KJFlangeSideViewOutlineSegment[];
        sectionHatches?: KJFlangeSectionHatch[];
    };
    dimensions?: KJFlangeDimension[];
    leaders?: KJFlangeLeader[];
    featureControlFrames?: KJFlangeFeatureControlFrame[];
    auxiliaryLines?: KJFlangeAuxiliaryLine[];
    auxiliarySolids?: KJFlangeAuxiliarySolid[];
    auxiliaryCurves?: KJFlangeAuxiliaryCurve[];
    auxiliaryHatches?: KJFlangeAuxiliaryHatch[];
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
        outerFrameOffset?: Point2;
        outerFrameStyleKey?: string;
        insetFrameStyleKey?: string;
        outerFrameSides?: KJFlangeFrameSide[];
        insetFrameSides?: KJFlangeFrameSide[];
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
                    type: "ARC" | "ATTDEF" | "CIRCLE" | "INSERT" | "LINE" | "MTEXT";
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
            squareHolePitch: number | undefined;
            squareHoleRadius: number | undefined;
            holePatternCount: number;
            holeCount: number;
            titleGrid: boolean;
            sideViewAxis: boolean;
            sideViewOrientation: {};
            sideViewAxisVisible: boolean;
            outlineSegmentCount: number;
            cuttingPlaneMarkCount: number;
            symmetricProfileCount: number;
            sideOutlineSegmentCount: number;
            sectionHatchCount: number;
            auxiliaryHatchCount: number;
            auxiliaryLineCount: number;
            auxiliarySolidCount: number;
            auxiliaryCurveCount: number;
            symbolDefinitionCount: number;
            symbolInstanceCount: number;
            symbolAttributeCount: number;
            featureControlFrameCount: number;
            entityStyleCount: number;
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
