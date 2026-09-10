// Generated from drawing-image.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJCanvasRenderer } from './canvas-renderer.js';
import { KJRevisionConflictError, KJValidationError } from './errors.js';
const MAX_DATA_URL_BYTES = 1024 * 1024;
function invalid(message) {
    throw new KJValidationError(`Drawing image: ${message}`);
}
export async function captureDrawingView(drawing, options) {
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
    const scale = Math.min(width / spanX, renderHeight / spanY);
    const centerX = minX + spanX / 2, centerY = minY + spanY / 2;
    const viewBounds = [
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
    const paperUnits = layout?.payload.plotSettings?.paperUnits;
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
