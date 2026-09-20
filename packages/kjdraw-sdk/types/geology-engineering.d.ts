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
    description?: string;
    /** Interval text is never merged; a project layer definition may repeat through lenses. */
    descriptionSource?: 'interval' | 'layer-definition';
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
export interface KJGeologySampleRangeBaselineStyle {
    boundaries: ('top' | 'bottom')[];
    continuity: 'collision-safe' | 'continuous';
    insetMm: number;
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
    /** Explicit source-backed boundaries are rendered before inferred correlations. */
    manualConnections?: KJGeologySectionConnection[];
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
