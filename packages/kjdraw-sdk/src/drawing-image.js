// Generated from drawing-image.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJCanvasRenderer } from './canvas-renderer.js';
import { KJRevisionConflictError, KJValidationError } from './errors.js';
import { resolvePhysicalPlotPaper, resolvePlotScale, validatePlotSettings } from './plot-settings.js';
import { resolveDxfPlotSource } from './plot-range.js';
import { deepFreeze } from './utils.js';
const MAX_DATA_URL_BYTES = 1024 * 1024;
function invalid(message) {
    throw new KJValidationError(`Drawing image: ${message}`);
}
async function captureDrawingViewInternal(drawing, options, projection) {
    if (!options || typeof options !== 'object') invalid('options are required');
    const { width, height, pixelRatio = 1, theme = 'dark' } = options;
    if (![
        width,
        height
    ].every((value)=>Number.isInteger(value) && value >= 1 && value <= 1600)) invalid('width and height must be integers from 1 to 1600');
    if (!Number.isFinite(pixelRatio) || pixelRatio < 1) invalid('pixelRatio must be finite and at least 1');
    const pixelWidth = Math.round(width * pixelRatio), pixelHeight = Math.round(height * pixelRatio);
    if (pixelWidth > 1600 || pixelHeight > 1600 || pixelWidth * pixelHeight > 2_000_000) invalid('physical image exceeds the 1600-pixel edge or 2,000,000-pixel budget');
    if (theme !== 'dark' && theme !== 'light') invalid('theme must be dark or light');
    if (!Array.isArray(options.bounds) || options.bounds.length !== 4) invalid('bounds must contain four finite coordinates');
    const bounds = [
        ...options.bounds
    ];
    if (!bounds.every(Number.isFinite)) invalid('bounds must contain four finite coordinates');
    const [minX, minY, maxX, maxY] = bounds;
    const spanX = maxX - minX, spanY = maxY - minY;
    if (!(spanX > 0 && spanY > 0 && Number.isFinite(spanX) && Number.isFinite(spanY))) invalid('bounds must have finite positive extents');
    const renderRatio = pixelWidth / width, renderHeight = pixelHeight / renderRatio;
    const scale = projection?.scale ?? Math.min(width / spanX, renderHeight / spanY);
    const centerX = projection?.centerX ?? minX + spanX / 2, centerY = projection?.centerY ?? minY + spanY / 2;
    const viewBounds = projection ? [
        ...projection.viewBounds
    ] : [
        centerX - width / scale / 2,
        centerY - renderHeight / scale / 2,
        centerX + width / scale / 2,
        centerY + renderHeight / scale / 2
    ];
    if (!Number.isFinite(scale) || scale <= 0 || !viewBounds.every(Number.isFinite)) invalid('bounds cannot form a finite viewport');
    if (!globalThis.document?.createElement) invalid('browser DOM canvas is required');
    const snapshot = drawing.snapshot(), documentId = drawing.id, revision = drawing.revision;
    const spaceId = options.spaceId ?? snapshot.spaces.modelSpaceId;
    const model = spaceId === snapshot.spaces.modelSpaceId;
    if (typeof spaceId !== 'string' || !model && !snapshot.spaces.paperSpaceIds.includes(spaceId)) invalid('spaceId must identify this document model or paper space');
    const space = snapshot.objects[spaceId];
    if (!space || space.erased || space.kind !== 'block-record' || space.payload.isSpace !== true) invalid('selected space is unavailable');
    const layout = !model ? Object.values(snapshot.objects).find((object)=>object.kind === 'layout' && !object.erased && object.payload.blockRecordId === spaceId) : null;
    const paperUnits = layout?.payload.dxfPlotSettings?.paperUnits ?? layout?.payload.plotSettings?.paperUnits;
    const legacyUnit = layout?.payload.paper?.unit;
    const units = model ? snapshot.header.units : paperUnits === 0 ? 'inch' : paperUnits === 1 ? 'millimeter' : paperUnits === 2 ? 'pixel' : legacyUnit === 'mm' ? 'millimeter' : legacyUnit === 'inch' ? 'inch' : 'unknown';
    const assertUnchanged = ()=>{
        if (drawing.id !== documentId || drawing.revision !== revision) throw new KJRevisionConflictError(revision, drawing.revision, {
            documentId,
            actualDocumentId: drawing.id
        });
    };
    const canvas = globalThis.document.createElement('canvas');
    const renderer = new KJCanvasRenderer(canvas, {
        pixelRatio: renderRatio,
        theme,
        grid: false,
        spaceId,
        showLineweights: true
    });
    let renderReport;
    try {
        renderer.resize(width, renderHeight);
        Object.assign(renderer.camera, {
            centerX,
            centerY,
            scale
        });
        renderer.setDocument(drawing);
        renderReport = renderer.report;
        assertUnchanged();
    } finally{
        renderer.dispose();
    }
    if (projection) {
        const [clipLeft, clipTop, clipRight, clipBottom] = projection.clipPixels;
        if (![
            clipLeft,
            clipTop,
            clipRight,
            clipBottom
        ].every(Number.isFinite) || clipLeft < 0 || clipTop < 0 || clipRight > width || clipBottom > renderHeight || clipRight < clipLeft || clipBottom < clipTop) invalid('physical clip is outside the raster page');
        const context = canvas.getContext('2d');
        context.save();
        context.setTransform(renderRatio, 0, 0, renderRatio, 0, 0);
        context.fillStyle = theme === 'dark' ? '#081016' : '#f8fafc';
        context.fillRect(0, 0, width, clipTop);
        context.fillRect(0, clipBottom, width, renderHeight - clipBottom);
        context.fillRect(0, clipTop, clipLeft, clipBottom - clipTop);
        context.fillRect(clipRight, clipTop, width - clipRight, clipBottom - clipTop);
        context.restore();
    }
    const blob = await new Promise((resolve, reject)=>{
        canvas.toBlob((value)=>value ? resolve(value) : reject(new KJValidationError('Drawing image: PNG encoding failed')), 'image/png');
    });
    assertUnchanged();
    if (22 + 4 * Math.ceil(blob.size / 3) > MAX_DATA_URL_BYTES) invalid('PNG data URL exceeds the 1 MiB budget');
    const dataUrl = await new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ()=>typeof reader.result === 'string' ? resolve(reader.result) : reject(new KJValidationError('Drawing image: PNG encoding failed'));
        reader.onerror = ()=>reject(reader.error ?? new KJValidationError('Drawing image: PNG encoding failed'));
        reader.readAsDataURL(blob);
    });
    assertUnchanged();
    if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > MAX_DATA_URL_BYTES) invalid('PNG data URL is invalid or exceeds the 1 MiB budget');
    return Object.freeze({
        dataUrl,
        mimeType: 'image/png',
        documentId,
        revision,
        units,
        documentUnits: snapshot.header.units,
        spaceId,
        coordinateSystem: model ? 'modelXY' : 'paperXY',
        bounds: Object.freeze(bounds),
        viewBounds: Object.freeze(viewBounds),
        width,
        height,
        pixelRatio,
        pixelWidth,
        pixelHeight,
        renderReport
    });
}
export async function captureDrawingView(drawing, options) {
    return captureDrawingViewInternal(drawing, options);
}
export function resolveDrawingPngPlot(drawing, options) {
    if (!options || typeof options.layoutId !== 'string') invalid('layoutId is required for PNG export');
    const maxEdge = options.maxEdge ?? 1400;
    if (!Number.isInteger(maxEdge) || maxEdge < 1 || maxEdge > 1600) invalid('maxEdge must be an integer from 1 to 1600');
    const source = drawing.snapshot(), layout = drawing.getObject(options.layoutId);
    if (!layout || layout.kind !== 'layout' || !source.spaces.layoutIds.includes(layout.id)) invalid('layoutId must identify a layout in this document');
    const spaceId = String(layout.payload.blockRecordId), model = spaceId === source.spaces.modelSpaceId;
    if (!model && !source.spaces.paperSpaceIds.includes(spaceId)) invalid('layout has no valid drawing space');
    const settings = layout.payload.dxfPlotSettings;
    if (!settings) invalid('configure PAGESETUP before PNG export');
    validatePlotSettings(settings);
    const rawPaperWidth = Number(settings.paperWidth), rawPaperHeight = Number(settings.paperHeight);
    if (!(rawPaperWidth > 0) || !(rawPaperHeight > 0) || rawPaperWidth > 10000 || rawPaperHeight > 10000) invalid('paper dimensions must be positive millimeters, at most 10000');
    if (settings.styleSheet || settings.printerName || Number(settings.shadeMode ?? 0) !== 0) invalid('external plot styles, printer configuration and shaded plotting are unsupported');
    const paperUnits = Number(settings.paperUnits ?? 1);
    if (paperUnits !== 0 && paperUnits !== 1) invalid('pixel paper units have no physical raster scale');
    const physical = resolvePhysicalPlotPaper(settings);
    const { width: paperWidth, height: paperHeight, left, right, top, bottom } = physical;
    const printableWidth = paperWidth - left - right, printableHeight = paperHeight - top - bottom;
    if (!(printableWidth > 0) || !(printableHeight > 0)) invalid('margins leave no printable area');
    let plotSource;
    try {
        plotSource = resolveDxfPlotSource(drawing, layout.id, settings, model);
    } catch (error) {
        invalid(error instanceof Error ? error.message : 'invalid plot source');
    }
    let x = 0, y = 0, maximumX = 0, maximumY = 0, minimumX = 0, minimumY = 0;
    let plotWidth, plotHeight;
    if (plotSource.bounded) {
        x = plotSource.minimum[0];
        y = plotSource.minimum[1];
        minimumX = x;
        minimumY = y;
        maximumX = plotSource.maximum[0];
        maximumY = plotSource.maximum[1];
        plotWidth = plotSource.width;
        plotHeight = plotSource.height;
    }
    let resolved;
    try {
        resolved = resolvePlotScale(settings, {
            printableWidth,
            printableHeight,
            sourceWidth: plotWidth,
            sourceHeight: plotHeight,
            isModel: model
        });
    } catch (error) {
        invalid(error instanceof Error ? error.message : 'invalid plot scale');
    }
    const scale = resolved.millimetersPerDrawingUnit, originX = resolved.originX, originY = resolved.originY;
    if (!plotSource.bounded) {
        minimumX = originX === 0 ? 0 : -originX / scale;
        minimumY = originY === 0 ? 0 : -originY / scale;
        maximumX = printableWidth / scale - originX / scale;
        maximumY = printableHeight / scale - originY / scale;
    }
    const paperAspect = paperWidth / paperHeight;
    const width = Math.max(1, Math.round(paperAspect >= 1 ? maxEdge : maxEdge * paperAspect));
    const height = Math.max(1, Math.round(paperAspect >= 1 ? maxEdge / paperAspect : maxEdge));
    const pixelsPerMillimeter = Math.min(width / paperWidth, height / paperHeight);
    const paperLeft = (width - paperWidth * pixelsPerMillimeter) / 2, paperTop = (height - paperHeight * pixelsPerMillimeter) / 2;
    const a = scale * pixelsPerMillimeter;
    const matrix = [
        a,
        0,
        0,
        -a,
        paperLeft + (left + originX - scale * x) * pixelsPerMillimeter,
        paperTop + (paperHeight - bottom - originY + scale * y) * pixelsPerMillimeter
    ];
    const centerX = (width / 2 - matrix[4]) / a, centerY = (matrix[5] - height / 2) / a;
    const viewBounds = [
        centerX - width / a / 2,
        centerY - height / a / 2,
        centerX + width / a / 2,
        centerY + height / a / 2
    ];
    const printableAreaPixels = {
        minimum: [
            paperLeft + left * pixelsPerMillimeter,
            paperTop + top * pixelsPerMillimeter
        ],
        maximum: [
            paperLeft + (paperWidth - right) * pixelsPerMillimeter,
            paperTop + (paperHeight - bottom) * pixelsPerMillimeter
        ]
    };
    return deepFreeze({
        layoutId: layout.id,
        spaceId,
        coordinateSystem: model ? 'modelXY' : 'paperXY',
        bounds: [
            minimumX,
            minimumY,
            maximumX,
            maximumY
        ],
        viewBounds,
        width,
        height,
        paper: {
            widthMm: paperWidth,
            heightMm: paperHeight,
            pixelsPerMillimeter,
            rasterAreaPixels: {
                minimum: [
                    paperLeft,
                    paperTop
                ],
                maximum: [
                    paperLeft + paperWidth * pixelsPerMillimeter,
                    paperTop + paperHeight * pixelsPerMillimeter
                ]
            }
        },
        plot: {
            printableAreaPixels,
            plotOriginPixels: [
                matrix[4] + a * x,
                matrix[5] - a * y
            ],
            sourceRange: {
                kind: plotSource.kind,
                minimum: [
                    minimumX,
                    minimumY
                ],
                maximum: [
                    maximumX,
                    maximumY
                ]
            },
            drawingToPixelMatrix: matrix
        }
    });
}
export async function exportDrawingPng(drawing, options) {
    if (!options || typeof options !== 'object') invalid('options are required for PNG export');
    if (options.allowPartial !== undefined && typeof options.allowPartial !== 'boolean') invalid('allowPartial must be boolean');
    const plan = resolveDrawingPngPlot(drawing, options);
    const matrix = plan.plot.drawingToPixelMatrix;
    const point = (x, y)=>[
            matrix[0] * x + matrix[2] * y + matrix[4],
            matrix[1] * x + matrix[3] * y + matrix[5]
        ];
    const [minimumX, minimumY] = plan.plot.sourceRange.minimum;
    const [maximumX, maximumY] = plan.plot.sourceRange.maximum;
    const clipPixels = plan.plot.sourceRange.kind !== 'layout' ? [
        ...point(minimumX, maximumY),
        ...point(maximumX, minimumY)
    ] : [
        ...plan.plot.printableAreaPixels.minimum,
        ...plan.plot.printableAreaPixels.maximum
    ];
    const projection = {
        centerX: (plan.viewBounds[0] + plan.viewBounds[2]) / 2,
        centerY: (plan.viewBounds[1] + plan.viewBounds[3]) / 2,
        scale: Math.abs(matrix[0]),
        viewBounds: plan.viewBounds,
        clipPixels
    };
    const result = await captureDrawingViewInternal(drawing, {
        spaceId: plan.spaceId,
        bounds: plan.bounds,
        width: plan.width,
        height: plan.height,
        pixelRatio: 1,
        theme: options.theme ?? 'light'
    }, projection);
    const report = result.renderReport;
    const viewportPartial = report.viewportDiagnostics?.some((item)=>item.unsupported > 0 || item.reason === 'budget') ?? false;
    const partial = report.unsupported > 0 || report.detailCulled > 0 || Boolean(report.hatchDiagnostics?.length) || viewportPartial;
    if (partial && options.allowPartial !== true) invalid(`PNG render is incomplete (${report.unsupported} unsupported, ${report.detailCulled} detail-budget omissions)`);
    return Object.freeze({
        ...result,
        layoutId: plan.layoutId,
        paper: plan.paper,
        plot: plan.plot
    });
}
