// Generated from plot-settings.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
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
