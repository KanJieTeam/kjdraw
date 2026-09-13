/** Scalar DXF page configuration. Physical paper, margins and origin are in mm,
 * even when paperUnits is inches (0) or pixels (2). Window coordinates are drawing units.
 * Names identify external resources; KJDraw does not load printers or style files. */
export interface KJDxfPlotSettings {
    pageSetupName?: string;
    printerName?: string;
    paperName?: string;
    viewName?: string;
    marginLeft?: number;
    marginBottom?: number;
    marginRight?: number;
    marginTop?: number;
    paperWidth?: number;
    paperHeight?: number;
    originX?: number;
    originY?: number;
    windowMinX?: number;
    windowMinY?: number;
    windowMaxX?: number;
    windowMaxY?: number;
    scaleNumerator?: number;
    scaleDenominator?: number;
    flags?: number;
    paperUnits?: 0 | 1 | 2;
    rotation?: 0 | 1 | 2 | 3;
    plotType?: 0 | 1 | 2 | 3 | 4 | 5;
    styleSheet?: string;
    standardScaleType?: number;
    shadeMode?: 0 | 1 | 2 | 3;
    shadeResolution?: 0 | 1 | 2 | 3 | 4 | 5;
    shadeDpi?: number;
    unitFactor?: number;
    imageOriginX?: number;
    imageOriginY?: number;
}
export interface KJPhysicalPlotPaper {
    width: number;
    height: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    rotation: 0 | 1 | 2 | 3;
}
export interface KJResolvedPlotScale {
    /** Physical paper millimeters occupied by one drawing unit. */
    millimetersPerDrawingUnit: number;
    /** Placement inside the printable rectangle, measured from its lower-left corner. */
    originX: number;
    originY: number;
    mode: 'custom' | 'standard' | 'fit';
}
export interface KJPlotScaleContext {
    printableWidth: number;
    printableHeight: number;
    /** Required when fit or centered plotting needs a bounded source rectangle. */
    sourceWidth?: number | undefined;
    sourceHeight?: number | undefined;
    isModel: boolean;
}
/** Ratios from the DXF group-code 75 standard scale table. Numerators are
 * paper units and denominators are drawing units. Type 0 is fit-to-page and
 * therefore is resolved from a bounded source rectangle instead. */
export declare const DXF_STANDARD_PLOT_SCALES: Readonly<Record<number, readonly [number, number]>>;
/** Resolve only plot flags whose output semantics KJDraw implements exactly.
 * External plot styles, viewport ordering and lineweight switches remain
 * rejected by each strict exporter instead of being silently approximated. */
export declare function resolvePlotScale(settings: KJDxfPlotSettings, context: KJPlotScaleContext): KJResolvedPlotScale;
type Field = readonly [code: number, kind: 'string' | 'number' | 'integer' | 'positive', min?: number, max?: number];
export declare const PLOT_SETTING_FIELDS: Readonly<{
    [K in keyof KJDxfPlotSettings]-?: Field;
}>;
/** Shared commit/import/export validation; rejects malformed settings without coercion. */
export declare function validatePlotSettings(value: unknown): asserts value is KJDxfPlotSettings;
/** Resolve DXF plot rotation into the physical output page. DXF rotations 1
 * and 3 exchange the paper axes; every rotation carries the asymmetric
 * hardware margins to the corresponding physical edge. Drawing coordinates
 * then remain in the output page coordinate system used by print/PDF/PNG. */
export declare function resolvePhysicalPlotPaper(settings: KJDxfPlotSettings): KJPhysicalPlotPaper;
export {};
