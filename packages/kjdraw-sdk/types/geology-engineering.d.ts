import { type ReadonlyDeep } from './utils.js';
import type { KJKnowledgeCompileResult } from './knowledge-compiler.js';
import { type KJKnowledgePack } from './knowledge-pack.js';
/** Engineering facts, not CAD coordinates. Depths/stations/elevations are metres. */
export interface KJGeologyStratum {
    /** Exact interval identity when one layer code appears more than once in a hole. */
    intervalId?: string;
    /** Explicit source-backed continuous major group; never inferred from lithology or band thickness. */
    groupId?: string;
    /** Principal strata define the major group label; lenses keep exact sublayer geometry. */
    groupRole?: 'principal' | 'lens';
    code: string;
    name: string;
    /** Source-backed geologic notation displayed with the stratum name; qualifiers are never inferred. */
    stratigraphicNotation?: {
        symbol: string;
        subscript?: string;
        superscript?: string;
    };
    top: number;
    bottom: number;
    lithology: 'fill' | 'cultivated-soil' | 'clay' | 'silty-clay' | 'silt' | 'sand' | 'gravel' | 'rock' | 'weathered-rock' | 'loess' | 'loess-collapsible' | 'loess-like' | 'paleosol' | 'calcareous-nodule';
    /** Semantic pattern role in a licensed pack, e.g. fine-sand versus medium-sand. */
    patternKey?: string;
    /** Source-backed display fact: omit or filled draws the hatch; boundary-only preserves the interval without inventing fill. */
    patternVisibility?: 'filled' | 'boundary-only';
    /** Exact source-visible label printed inside this interval's pattern lane. */
    patternLabel?: string;
    /** Exact source visibility of this interval's bottom rule in independently
     * rendered depth/pattern fields. Depth facts and closed fill boundaries remain. */
    bottomBoundaryLineVisibility?: {
        depth: 'visible' | 'hidden';
        pattern: 'visible' | 'hidden';
    };
    description?: string;
    /** Interval text is never merged; a project layer definition may repeat through lenses. */
    descriptionSource?: 'interval' | 'layer-definition';
    /** Optional source-measured paragraph anchor for this principal stratum.
     * The boundary role is explicit; the compiler never derives it from layer thickness. */
    descriptionPlacement?: {
        boundaryRole: 'top' | 'bottom' | 'midpoint';
        offsetMm: number;
    };
}
export interface KJGeologyBorehole {
    id: string;
    collarElevation: number;
    depth: number;
    x?: number;
    y?: number;
    startDate?: string;
    endDate?: string;
    /** Measured groundwater depth first observed while drilling; distinct from the later stable level. */
    initialWaterDepth?: number;
    /** Measured stable groundwater depth; never inferred from another hole. */
    stableWaterDepth?: number;
    /** Independent down-hole groundwater readings. These are never copied from summary header values. */
    groundwaterObservations?: KJGeologyGroundwaterObservation[];
    station?: number;
    strata: KJGeologyStratum[];
    observations?: KJGeologyObservation[];
}
export interface KJGeologyGroundwaterObservation {
    /** Measured depth below the collar in metres. */
    depth: number;
    /** Independently supplied absolute groundwater elevation in metres. */
    elevation: number;
    /** Source-recorded observation date or timestamp. */
    observedOn: string;
    /** Source-recorded water-level symbol. */
    marker: 'filled-down-triangle';
}
export interface KJGeologyObservation {
    kind: 'sample' | 'spt';
    id: string;
    depth: number;
    value?: number;
    /** Short visible text; id remains the exact stable observation identity. */
    displayLabel?: string;
    /** Source-recorded specimen marker; its visible glyph and spacing remain a versioned layout choice. */
    sampleMarker?: 'filled-circle' | 'open-circle';
    /** Direct numeric laboratory facts keyed by a host-selected, versioned field grid. */
    measurements?: Record<string, number>;
    /** Exact source-supplied interval for a sampled specimen; never inferred from the point depth. */
    rangeTop?: number;
    rangeBottom?: number;
}
/** Source-backed rendering facts for measured sample intervals. The default
 * remains two collision-safe endpoint rules; a style pack may request the
 * exact continuous boundary line present in its licensed source template. */
export type KJGeologySampleRangeBaselineStyle = {
    boundaries: ('top' | 'bottom')[];
    continuity: 'collision-safe' | 'continuous';
} & ({
    insetMm: number;
} | {
    fieldRole: 'sample';
    startInsetMm: number;
    endInsetMm: number;
});
/** Source-backed visible formatting for a measured sample interval. The
 * interval itself still comes only from rangeTop/rangeBottom observation facts. */
export interface KJGeologySampleRangeTextFormat {
    fieldRole: 'sample';
    prefix: string;
    separator: string;
    suffix: string;
    decimals: number;
    trailingZeros: 'preserve' | 'trim';
    anchor?: 'range-top' | 'range-midpoint' | 'range-bottom';
    placement?: KJGeologyFieldHeaderTextPlacement;
}
/** Source-backed layout for a measured groundwater annotation. The optional
 * guide is emitted only when a licensed source template declares it. */
export interface KJGeologyGroundwaterAnnotationStyle {
    fieldRole: 'pattern';
    textHeight: number;
    markerHeight: number;
    textWidthFactor: number;
    gap: number;
    valueOffset: number;
    markerOffset: number;
    dateOffset: number;
    guide?: 'field-top-to-reading';
    /** Source-measured delta from the field-right/exact-depth guide endpoint, in millimetres. */
    guideEndpointOffset?: [number, number];
    placements?: {
        depth: KJGeologyFieldHeaderTextPlacement;
        elevation: KJGeologyFieldHeaderTextPlacement;
        marker: KJGeologyFieldHeaderTextPlacement;
        observedOn: KJGeologyFieldHeaderTextPlacement;
    };
}
/** Optional source-backed linework attached to one title-margin fact. */
export interface KJGeologyTitleMarginDecoration {
    kind: 'top-edge-elbow-underline';
    elbowOffset: [number, number];
    horizontalEnd: 'frame-right';
}
/** Exact main-title placement measured from the physical frame's upper-left. */
export interface KJGeologyTitleTextStyle {
    anchor: 'frame-left-top';
    placement: KJGeologyFieldHeaderTextPlacement;
    rotationDegrees: number;
}
/** One source-backed local CAD text style for a column template. Font files are
 * referenced by safe local names only; KJDraw never embeds or downloads them. */
export interface KJGeologyDefaultTextStyle {
    name: string;
    fontFamily: string;
    fontFile: string;
    bigFontFile: string;
    fixedHeight: number;
    widthFactor: number;
    obliqueAngleDegrees: number;
    dxfFlags: number;
    generationFlags: number;
}
/** Optional source-backed local CAD text styles for semantic column roles. */
export interface KJGeologyRoleTextStyles {
    layerName?: KJGeologyDefaultTextStyle;
    patternLabel?: KJGeologyDefaultTextStyle;
}
/** Exact source-backed placement for one physical field-header line. Offsets
 * are millimetres from the field's lower-left corner. */
export interface KJGeologyFieldHeaderTextPlacement {
    offset: [number, number];
    height: number;
    textWidthFactor: number;
    horizontalAlignment: 'left' | 'center' | 'right';
    verticalAlignment: 'baseline' | 'middle';
}
type KJGeologySectionTextPlacement = Omit<KJGeologyFieldHeaderTextPlacement, 'horizontalAlignment'> & {
    horizontalAlignment: 'left' | 'center' | 'right' | 'middle';
};
/** A field header may contain one main line and, only when the field declares
 * a sublabel, one independently placed sub line. */
export interface KJGeologyFieldHeaderTextStyle {
    main: KJGeologyFieldHeaderTextPlacement;
    sub?: KJGeologyFieldHeaderTextPlacement;
}
/** Independent source-backed placements for one table-header fact's label and
 * value. Each offset is measured from its own physical lane's lower-left. */
export interface KJGeologyHeaderFactTextStyle {
    label: KJGeologyFieldHeaderTextPlacement;
    value: KJGeologyFieldHeaderTextPlacement;
}
/** Independent source-backed placements for one footer fact's label and
 * value. The value offset starts at an internal divider when one is declared. */
export interface KJGeologyFooterFactTextStyle {
    label: KJGeologyFieldHeaderTextPlacement;
    value: KJGeologyFieldHeaderTextPlacement;
}
/** Source-backed placement for a sampled point's visible label and marker.
 * Offsets are millimetres from the sample field's lower-left at the selected
 * measured depth anchor. */
export interface KJGeologySampleAnnotationStyle {
    depthAnchor: 'observation-depth' | 'range-top' | 'range-bottom';
    label: KJGeologyFieldHeaderTextPlacement;
    marker: KJGeologyFieldHeaderTextPlacement;
}
/** Source-backed depth-lane placements relative to each real interval's
 * bottom boundary. Lens placement is explicit and never inferred by thickness. */
export interface KJGeologyIntervalDepthTextStyle {
    fieldRole: 'depth';
    principal: KJGeologyFieldHeaderTextPlacement;
    lens: KJGeologyFieldHeaderTextPlacement;
}
/** Source-backed placement for the four visible values that identify one
 * major stratum group. Offsets are measured from the group's geometric
 * midpoint and the lower-left corner of each declared physical field. */
export interface KJGeologyMajorGroupValueStyle {
    anchor: 'major-group-midpoint';
    layerNumber: KJGeologyFieldHeaderTextPlacement;
    layerName: KJGeologyFieldHeaderTextPlacement;
    baseElevation: KJGeologyFieldHeaderTextPlacement;
    thickness: KJGeologyFieldHeaderTextPlacement;
    /** Optional semantic override for the group touching the body top boundary. */
    topBoundary?: {
        layerName: KJGeologyFieldHeaderTextPlacement;
    };
    /** Physical radius used only with the explicit circular layer-number style. */
    layerNumberCircleRadius?: number;
}
/** Exact placements for the symbol and optional qualifiers of one
 * stratigraphic notation, relative to a major group's geometric midpoint. */
export interface KJGeologyStratigraphicNotationPlacementSet {
    symbol: KJGeologyFieldHeaderTextPlacement;
    superscript: KJGeologyFieldHeaderTextPlacement;
    subscript: KJGeologyFieldHeaderTextPlacement;
}
/** Source-backed stratigraphic notation style. Top-boundary placement is a
 * geometric role, not an interval index or a thickness heuristic. */
export interface KJGeologyStratigraphicNotationStyle {
    symbolHeight: number;
    qualifierHeight: number;
    placement?: {
        fieldRole: 'layerName';
        anchor: 'major-group-midpoint';
        principal: KJGeologyStratigraphicNotationPlacementSet;
        topBoundary: KJGeologyStratigraphicNotationPlacementSet;
    };
}
/** Source-backed paragraph placement enabled only for descriptions carrying
 * an explicit major-group boundary role and offset. */
export interface KJGeologyDescriptionTextStyle {
    fieldRole: 'description';
    anchor: 'declared-major-group-boundary';
    height: number;
    /** Optional source-declared MTEXT paragraph width in physical millimetres. */
    width?: number;
}
/** A source-backed cross-hole boundary supplied by an external data adapter.
 *  Depths are measured downwards from each hole collar in metres.  This is
 *  deliberately a neutral input contract: adapters may read MDB/DWG facts,
 *  but the compiler never invents a connection when one is absent.
 */
export interface KJGeologySectionConnection {
    fromHoleId: string;
    toHoleId: string;
    fromDepth: number;
    toDepth: number;
    kind?: 'continuity' | 'pinchout' | 'lens' | 'manualBoundary';
    layerCode?: string;
}
/** Explicit visible identifiers for the two ends of a geological section.
 * Values come from the caller; the compiler never infers an identifier. */
export interface KJGeologySectionReference {
    start: string;
    end: string;
}
/** Source-backed native geometry for measured observations in a section.
 * Every coordinate is a bounded millimetre offset from the supplied borehole
 * and observation depth. */
export interface KJGeologySectionObservationSymbolStyle {
    sample: {
        centerOffset: [number, number];
        radius: number;
        fill: 'solid' | 'none';
        labelPlacement?: KJGeologyFieldHeaderTextPlacement;
    };
    spt: {
        topRightOffset: [number, number];
        width: number;
        height: number;
        labelPlacement: KJGeologySectionTextPlacement;
        labelOverrides?: {
            holeId: string;
            observationId: string;
            placement: KJGeologySectionTextPlacement;
        }[];
    };
    groundwater?: {
        insertOffset: [number, number];
        lineSegments: [[number, number], [number, number]][];
        markerPolygon: [number, number][];
        fill: 'solid' | 'none';
        labelPlacement?: KJGeologyFieldHeaderTextPlacement;
        labelFormat?: 'role-depth' | 'depth-elevation';
        labelPrecision?: 0 | 1 | 2 | 3 | 4;
        labelOverrides?: {
            holeId: string;
            observationRole: 'stable-water';
            depth: number;
            elevation: number;
            placement: KJGeologyFieldHeaderTextPlacement;
        }[];
    };
}
export interface KJGeologyColumnInput {
    /** Visible generated labels. When omitted, Chinese source text selects zh-CN; otherwise en. */
    locale?: 'zh-CN' | 'en';
    hole: KJGeologyBorehole;
    projectName?: string;
    /** Exact source-backed document facts requested by a host-selected style pack; never inferred. */
    documentFacts?: Record<string, string>;
    /** Explicit source/template fact. Omit to select from the style pack's standard scales. */
    verticalScaleDenominator?: number;
    /** Physical long-log sheet or ordinary A4 sheet, in millimetres. */
    pageHeightMillimeters?: 297 | 841;
    /** Host-selected, versioned physical table geometry; independent of model text. */
    columnStylePack?: ReadonlyDeep<KJKnowledgePack>;
    /** Refuse a source-template mismatch or an unrenderable observation kind. This is a template gate, not 1:1 certification. */
    strictSourceTemplate?: boolean;
    /** Optional licensed, versioned pattern knowledge; no purchased pattern is built into KJDraw. */
    hatchPack?: ReadonlyDeep<KJKnowledgePack>;
    expectedRevision: number;
    title?: string;
}
export interface KJGeologySectionInput {
    /** Visible generated labels. When omitted, Chinese source text selects zh-CN; otherwise en. */
    locale?: 'zh-CN' | 'en';
    holes: KJGeologyBorehole[];
    /** Only explicitly correlated layers are drawn between holes. */
    correlations: {
        fromHoleId: string;
        toHoleId: string;
        fromStratumCode?: string;
        toStratumCode?: string;
        fromIntervalId?: string;
        toIntervalId?: string;
    }[];
    /** Explicit opt-in for source-declared group topology. The default keeps the
     * existing caller-supplied correlation contract unchanged. */
    correlationMode?: 'explicit-correlations' | 'source-group-topology';
    /** Caller-asserted complete adjacent-hole interval mapping; not source or 1:1 certification. */
    sourceFactMode?: 'illustrative' | 'complete-occurrence-map';
    /** Explicitly unlinked interval occurrences for a single adjacent-hole pair. */
    uncorrelatedOccurrences?: {
        holeId: string;
        adjacentHoleId: string;
        intervalId: string;
    }[];
    /** Explicit source-backed boundaries are rendered before inferred correlations. */
    manualConnections?: KJGeologySectionConnection[];
    /** Exact source-backed identifiers shown at the two ends of the section. */
    sectionReference?: KJGeologySectionReference;
    horizontalScaleDenominator: number;
    verticalScaleDenominator: number;
    datumElevation: number;
    surfaceRule: 'straight-between-supplied-collars';
    projectName?: string;
    /** Exact source-backed title-block facts; absent facts remain blank. */
    documentFacts?: Record<string, string>;
    /** Host-selected, versioned physical sheet geometry. Project-specific values stay in the pack. */
    sectionStylePack?: ReadonlyDeep<KJKnowledgePack>;
    hatchPack?: ReadonlyDeep<KJKnowledgePack>;
    expectedRevision: number;
    title?: string;
}
export declare function compileGeologyColumn(input: KJGeologyColumnInput): ReadonlyDeep<KJKnowledgeCompileResult>;
export declare function compileGeologySection(input: KJGeologySectionInput): ReadonlyDeep<KJKnowledgeCompileResult>;
export {};
