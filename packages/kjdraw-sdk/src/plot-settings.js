// Generated from plot-settings.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
export const DXF_STANDARD_PLOT_SCALES = Object.freeze({
    1: [
        1 / 128,
        12
    ],
    2: [
        1 / 64,
        12
    ],
    3: [
        1 / 32,
        12
    ],
    4: [
        1 / 16,
        12
    ],
    5: [
        3 / 32,
        12
    ],
    6: [
        1 / 8,
        12
    ],
    7: [
        3 / 16,
        12
    ],
    8: [
        1 / 4,
        12
    ],
    9: [
        3 / 8,
        12
    ],
    10: [
        1 / 2,
        12
    ],
    11: [
        3 / 4,
        12
    ],
    12: [
        1,
        12
    ],
    13: [
        3,
        12
    ],
    14: [
        6,
        12
    ],
    15: [
        12,
        12
    ],
    16: [
        1,
        1
    ],
    17: [
        1,
        2
    ],
    18: [
        1,
        4
    ],
    19: [
        1,
        8
    ],
    20: [
        1,
        10
    ],
    21: [
        1,
        16
    ],
    22: [
        1,
        20
    ],
    23: [
        1,
        30
    ],
    24: [
        1,
        40
    ],
    25: [
        1,
        50
    ],
    26: [
        1,
        100
    ],
    27: [
        2,
        1
    ],
    28: [
        4,
        1
    ],
    29: [
        8,
        1
    ],
    30: [
        10,
        1
    ],
    31: [
        100,
        1
    ],
    32: [
        1000,
        1
    ]
});
export function resolvePlotScale(settings, context) {
    validatePlotSettings(settings);
    const { printableWidth, printableHeight, sourceWidth, sourceHeight, isModel } = context;
    if (!(printableWidth > 0) || !(printableHeight > 0) || ![
        printableWidth,
        printableHeight
    ].every(Number.isFinite)) throw new KJValidationError('Plot scale requires a finite positive printable area');
    const flags = Number(settings.flags ?? 0), unsupportedFlags = flags & ~(4 | 16 | 1024);
    if (unsupportedFlags !== 0) throw new KJValidationError(`Plot flags 0x${unsupportedFlags.toString(16)} are unsupported by strict output`);
    if ((flags & 1024) !== 0 && !isModel) throw new KJValidationError('The DXF model-type plot flag is invalid for a paper layout');
    const centered = (flags & 4) !== 0, standard = (flags & 16) !== 0;
    const bounded = sourceWidth !== undefined || sourceHeight !== undefined;
    if (bounded && (!(sourceWidth > 0) || !(sourceHeight > 0) || ![
        sourceWidth,
        sourceHeight
    ].every(Number.isFinite))) throw new KJValidationError('Plot scale source rectangle must have finite positive dimensions');
    const configuredX = Number(settings.originX ?? 0), configuredY = Number(settings.originY ?? 0);
    if (![
        configuredX,
        configuredY
    ].every(Number.isFinite)) throw new KJValidationError('Plot origin must be finite');
    let mode = 'custom', scale;
    if (standard) {
        const type = Number(settings.standardScaleType ?? 16);
        if (type === 0) {
            if (!bounded) throw new KJValidationError('Fit plotting requires an explicit bounded plot window');
            const availableWidth = centered ? printableWidth : printableWidth - configuredX;
            const availableHeight = centered ? printableHeight : printableHeight - configuredY;
            if (!(availableWidth > 0) || !(availableHeight > 0) || !centered && (configuredX < 0 || configuredY < 0)) throw new KJValidationError('Fit plot origin lies outside the printable area');
            scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
            mode = 'fit';
        } else {
            const ratio = DXF_STANDARD_PLOT_SCALES[type];
            if (!ratio) throw new KJValidationError(`Unsupported DXF standard scale type ${type}`);
            const paperUnitMillimeters = Number(settings.paperUnits ?? 1) === 0 ? 25.4 : 1;
            scale = ratio[0] / ratio[1] * paperUnitMillimeters;
            mode = 'standard';
        }
    } else {
        const paperUnitMillimeters = Number(settings.paperUnits ?? 1) === 0 ? 25.4 : 1;
        scale = Number(settings.scaleNumerator ?? 1) / Number(settings.scaleDenominator ?? 1) * paperUnitMillimeters;
    }
    if (!(scale > 0) || !Number.isFinite(scale)) throw new KJValidationError('Resolved plot scale must be positive and finite');
    let originX = configuredX, originY = configuredY;
    if (centered) {
        if (!bounded) throw new KJValidationError('Centered plotting requires an explicit bounded plot window');
        originX = (printableWidth - sourceWidth * scale) / 2;
        originY = (printableHeight - sourceHeight * scale) / 2;
    }
    if (bounded && (originX < -1e-9 || originY < -1e-9 || originX + sourceWidth * scale > printableWidth + 1e-9 || originY + sourceHeight * scale > printableHeight + 1e-9)) throw new KJValidationError('Plot window does not fit the printable area at the resolved scale and origin');
    return Object.freeze({
        millimetersPerDrawingUnit: scale,
        originX: Math.max(0, originX),
        originY: Math.max(0, originY),
        mode
    });
}
export const PLOT_SETTING_FIELDS = Object.freeze({
    pageSetupName: [
        1,
        'string'
    ],
    printerName: [
        2,
        'string'
    ],
    paperName: [
        4,
        'string'
    ],
    viewName: [
        6,
        'string'
    ],
    marginLeft: [
        40,
        'number',
        0
    ],
    marginBottom: [
        41,
        'number',
        0
    ],
    marginRight: [
        42,
        'number',
        0
    ],
    marginTop: [
        43,
        'number',
        0
    ],
    paperWidth: [
        44,
        'number',
        0
    ],
    paperHeight: [
        45,
        'number',
        0
    ],
    originX: [
        46,
        'number'
    ],
    originY: [
        47,
        'number'
    ],
    windowMinX: [
        48,
        'number'
    ],
    windowMinY: [
        49,
        'number'
    ],
    windowMaxX: [
        140,
        'number'
    ],
    windowMaxY: [
        141,
        'number'
    ],
    scaleNumerator: [
        142,
        'positive'
    ],
    scaleDenominator: [
        143,
        'positive'
    ],
    flags: [
        70,
        'integer',
        0,
        65535
    ],
    paperUnits: [
        72,
        'integer',
        0,
        2
    ],
    rotation: [
        73,
        'integer',
        0,
        3
    ],
    plotType: [
        74,
        'integer',
        0,
        5
    ],
    styleSheet: [
        7,
        'string'
    ],
    standardScaleType: [
        75,
        'integer',
        0,
        32
    ],
    shadeMode: [
        76,
        'integer',
        0,
        3
    ],
    shadeResolution: [
        77,
        'integer',
        0,
        5
    ],
    shadeDpi: [
        78,
        'integer',
        100,
        32767
    ],
    unitFactor: [
        147,
        'positive'
    ],
    imageOriginX: [
        148,
        'number'
    ],
    imageOriginY: [
        149,
        'number'
    ]
});
export function validatePlotSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![
        Object.prototype,
        null
    ].includes(Object.getPrototypeOf(value))) throw new KJValidationError('Layout plotSettings must be a plain object');
    for (const [key, v] of Object.entries(value)){
        if (!Object.hasOwn(PLOT_SETTING_FIELDS, key)) throw new KJValidationError(`Unknown layout plotSettings field: ${key}`);
        const [, kind, min, max] = PLOT_SETTING_FIELDS[key];
        const valid = kind === 'string' ? typeof v === 'string' && !/[\r\n\0]/.test(v) : typeof v === 'number' && Number.isFinite(v) && (kind !== 'integer' || Number.isInteger(v)) && (kind !== 'positive' || v > 0) && (min === undefined || v >= min) && (max === undefined || v <= max);
        if (!valid) throw new KJValidationError(`Invalid layout plotSettings.${key}`);
    }
}
export function resolvePhysicalPlotPaper(settings) {
    validatePlotSettings(settings);
    const width = Number(settings.paperWidth), height = Number(settings.paperHeight);
    const left = Number(settings.marginLeft ?? 0), right = Number(settings.marginRight ?? 0);
    const top = Number(settings.marginTop ?? 0), bottom = Number(settings.marginBottom ?? 0);
    const rotation = Number(settings.rotation ?? 0);
    if (![
        width,
        height,
        left,
        right,
        top,
        bottom
    ].every(Number.isFinite) || width <= 0 || height <= 0) {
        throw new KJValidationError('Physical plot paper requires positive finite dimensions and finite margins');
    }
    if (rotation === 1) return {
        width: height,
        height: width,
        left: top,
        right: bottom,
        top: right,
        bottom: left,
        rotation
    };
    if (rotation === 2) return {
        width,
        height,
        left: right,
        right: left,
        top: bottom,
        bottom: top,
        rotation
    };
    if (rotation === 3) return {
        width: height,
        height: width,
        left: bottom,
        right: top,
        top: left,
        bottom: right,
        rotation
    };
    return {
        width,
        height,
        left,
        right,
        top,
        bottom,
        rotation
    };
}
