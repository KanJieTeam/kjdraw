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
    top: number;
    bottom: number;
    lithology: 'fill' | 'clay' | 'silt' | 'sand' | 'gravel' | 'rock' | 'weathered-rock';
    /** Semantic pattern role in a licensed pack, e.g. fine-sand versus medium-sand. */
    patternKey?: string;
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
    /** Measured stable groundwater depth; never inferred from another hole. */
    stableWaterDepth?: number;
    station?: number;
    strata: KJGeologyStratum[];
    observations?: KJGeologyObservation[];
}
export interface KJGeologyObservation {
    kind: 'sample' | 'spt';
    id: string;
    depth: number;
    value?: number;
    /** Short visible text; id remains the exact stable observation identity. */
    displayLabel?: string;
    /** Direct numeric laboratory facts keyed by a host-selected, versioned field grid. */
    measurements?: Record<string, number>;
    /** Exact source-supplied interval for a sampled specimen; never inferred from the point depth. */
    rangeTop?: number;
    rangeBottom?: number;
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
    columnStylePack?: KJKnowledgePack;
    /** Optional licensed, versioned pattern knowledge; no purchased pattern is built into KJDraw. */
    hatchPack?: KJKnowledgePack;
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
    horizontalScaleDenominator: number;
    verticalScaleDenominator: number;
    datumElevation: number;
    surfaceRule: 'straight-between-supplied-collars';
    hatchPack?: KJKnowledgePack;
    expectedRevision: number;
    title?: string;
}
export declare function compileGeologyColumn(input: KJGeologyColumnInput): ReadonlyDeep<KJKnowledgeCompileResult>;
export declare function compileGeologySection(input: KJGeologySectionInput): ReadonlyDeep<KJKnowledgeCompileResult>;
