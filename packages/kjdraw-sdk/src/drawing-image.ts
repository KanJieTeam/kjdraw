import { KJCanvasRenderer } from './canvas-renderer.js'
import type { KJCanvasRenderReport, KJCanvasTheme } from './canvas-renderer.js'
import type { KJDocument } from './document.js'
import { KJRevisionConflictError, KJValidationError } from './errors.js'
import { resolvePhysicalPlotPaper, resolvePlotScale, validatePlotSettings } from './plot-settings.js'
import { resolveDxfPlotSource } from './plot-range.js'
import { deepFreeze } from './utils.js'

export interface KJDrawingViewOptions {
  /** Requested XY bounds in the selected space coordinate units. */
  bounds: readonly [number, number, number, number]
  /** Defaults to model space. Explicit paper spaces use the native viewport renderer. */
  spaceId?: string
  /** Logical image width and height; no physical print size is implied. */
  width: number
  height: number
  /** Defaults to 1, independently of the browser/device DPR. */
  pixelRatio?: number
  theme?: KJCanvasTheme
}

export interface KJDrawingViewImage {
  readonly dataUrl: string
  readonly mimeType: 'image/png'
  readonly documentId: string
  readonly revision: number
  readonly units: string
  readonly documentUnits: string
  readonly spaceId: string
  readonly coordinateSystem: 'modelXY' | 'paperXY'
  readonly bounds: readonly [number, number, number, number]
  /** Actual viewport after fitting bounds without distorting geometry. */
  readonly viewBounds: readonly [number, number, number, number]
  readonly width: number
  readonly height: number
  readonly pixelRatio: number
  readonly pixelWidth: number
  readonly pixelHeight: number
  /** Renderer diagnostics include approximated/unsupported objects and paper viewports. */
  readonly renderReport: Readonly<KJCanvasRenderReport>
}

export interface KJDrawingPngOptions {
  layoutId: string
  /** Longest raster edge. Defaults to 1400 and is bounded by captureDrawingView. */
  maxEdge?: number
  theme?: KJCanvasTheme
  /** Opt in to output that renderer diagnostics identify as incomplete. */
  allowPartial?: boolean
}

export interface KJDrawingPngPlan {
  readonly layoutId: string
  readonly spaceId: string
  readonly coordinateSystem: 'modelXY' | 'paperXY'
  readonly bounds: readonly [number, number, number, number]
  readonly viewBounds: readonly [number, number, number, number]
  readonly width: number
  readonly height: number
  readonly paper: {
    readonly widthMm: number
    readonly heightMm: number
    readonly pixelsPerMillimeter: number
    readonly rasterAreaPixels: {
      readonly minimum: readonly [number, number]
      readonly maximum: readonly [number, number]
    }
  }
  readonly plot: {
    readonly printableAreaPixels: {
      readonly minimum: readonly [number, number]
      readonly maximum: readonly [number, number]
    }
    readonly plotOriginPixels: readonly [number, number]
    readonly sourceRange: {
      readonly kind: 'layout' | 'layout-limits' | 'window' | 'view'
      readonly minimum: readonly [number, number]
      readonly maximum: readonly [number, number]
    }
    readonly drawingToPixelMatrix: readonly [number, number, number, number, number, number]
  }
}

export interface KJDrawingPngExport extends KJDrawingViewImage {
  readonly layoutId: string
  readonly paper: KJDrawingPngPlan['paper']
  readonly plot: KJDrawingPngPlan['plot']
}

interface KJCaptureProjection {
  readonly centerX: number
  readonly centerY: number
  readonly scale: number
  readonly viewBounds: readonly [number, number, number, number]
  readonly clipPixels: readonly [number, number, number, number]
}

const MAX_DATA_URL_BYTES = 1024 * 1024

function invalid(message: string): never { throw new KJValidationError(`Drawing image: ${message}`) }

/**
 * Capture a read-only XY space view using the same canvas renderer as the workbench.
 * Aspect-ratio differences expand viewBounds; geometry is never stretched.
 * This is a visual aid, not geometric verification: inspect renderReport for limitations.
 * Requires a browser DOM canvas. All sizes are bounded before canvas allocation.
 */
async function captureDrawingViewInternal(drawing: KJDocument, options: KJDrawingViewOptions, projection?: KJCaptureProjection): Promise<KJDrawingViewImage> {
  if (!options || typeof options !== 'object') invalid('options are required')
  const { width, height, pixelRatio = 1, theme = 'dark' } = options
  if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 1600)) invalid('width and height must be integers from 1 to 1600')
  if (!Number.isFinite(pixelRatio) || pixelRatio < 1) invalid('pixelRatio must be finite and at least 1')
  const pixelWidth = Math.round(width * pixelRatio), pixelHeight = Math.round(height * pixelRatio)
  if (pixelWidth > 1600 || pixelHeight > 1600 || pixelWidth * pixelHeight > 2_000_000) invalid('physical image exceeds the 1600-pixel edge or 2,000,000-pixel budget')
  if (theme !== 'dark' && theme !== 'light') invalid('theme must be dark or light')
  if (!Array.isArray(options.bounds) || options.bounds.length !== 4) invalid('bounds must contain four finite coordinates')
  const bounds = [...options.bounds] as [number, number, number, number]
  if (!bounds.every(Number.isFinite)) invalid('bounds must contain four finite coordinates')
  const [minX, minY, maxX, maxY] = bounds
  const spanX = maxX - minX, spanY = maxY - minY
  if (!(spanX > 0 && spanY > 0 && Number.isFinite(spanX) && Number.isFinite(spanY))) invalid('bounds must have finite positive extents')
  // Account for integer backing-store rounding while preserving one uniform XY scale.
  const renderRatio = pixelWidth / width, renderHeight = pixelHeight / renderRatio
  const scale = projection?.scale ?? Math.min(width / spanX, renderHeight / spanY)
  const centerX = projection?.centerX ?? minX + spanX / 2, centerY = projection?.centerY ?? minY + spanY / 2
  const viewBounds: [number, number, number, number] = projection ? [...projection.viewBounds] : [centerX - width / scale / 2, centerY - renderHeight / scale / 2, centerX + width / scale / 2, centerY + renderHeight / scale / 2]
  if (!Number.isFinite(scale) || scale <= 0 || !viewBounds.every(Number.isFinite)) invalid('bounds cannot form a finite viewport')
  if (!globalThis.document?.createElement) invalid('browser DOM canvas is required')
  const snapshot = drawing.snapshot(), documentId = drawing.id, revision = drawing.revision
  const spaceId = options.spaceId ?? snapshot.spaces.modelSpaceId
  const model = spaceId === snapshot.spaces.modelSpaceId
  if (typeof spaceId !== 'string' || (!model && !snapshot.spaces.paperSpaceIds.includes(spaceId))) invalid('spaceId must identify this document model or paper space')
  const space = snapshot.objects[spaceId]
  if (!space || space.erased || space.kind !== 'block-record' || space.payload.isSpace !== true) invalid('selected space is unavailable')
  const layout = !model ? Object.values(snapshot.objects).find(object => object.kind === 'layout' && !object.erased && object.payload.blockRecordId === spaceId) : null
  const paperUnits = (layout?.payload.dxfPlotSettings as Readonly<Record<string, unknown>> | undefined)?.paperUnits
    ?? (layout?.payload.plotSettings as Readonly<Record<string, unknown>> | undefined)?.paperUnits
  const legacyUnit = (layout?.payload.paper as Readonly<Record<string, unknown>> | undefined)?.unit
  // Paper coordinates must never be mislabeled with the model's meter/millimeter unit.
  const units = model ? snapshot.header.units : paperUnits === 0 ? 'inch' : paperUnits === 1 ? 'millimeter' : paperUnits === 2 ? 'pixel' : legacyUnit === 'mm' ? 'millimeter' : legacyUnit === 'inch' ? 'inch' : 'unknown'
  const assertUnchanged = (): void => {
    if (drawing.id !== documentId || drawing.revision !== revision) throw new KJRevisionConflictError(revision, drawing.revision, { documentId, actualDocumentId: drawing.id })
  }
  const canvas = globalThis.document.createElement('canvas')
  const renderer = new KJCanvasRenderer(canvas, { pixelRatio: renderRatio, theme, grid: false, spaceId, showLineweights: true, plotMode: projection !== undefined })
  let renderReport: Readonly<KJCanvasRenderReport>
  try {
    renderer.resize(width, renderHeight)
    Object.assign(renderer.camera, { centerX, centerY, scale })
    renderer.setDocument(drawing)
    renderReport = renderer.report
    assertUnchanged()
  } finally {
    // Disconnect before asynchronous encoding: detached ResizeObserver must not resize to 1x1.
    renderer.dispose()
  }
  if (projection) {
    const [clipLeft, clipTop, clipRight, clipBottom] = projection.clipPixels
    if (![clipLeft, clipTop, clipRight, clipBottom].every(Number.isFinite) || clipLeft < 0 || clipTop < 0 || clipRight > width || clipBottom > renderHeight || clipRight < clipLeft || clipBottom < clipTop) invalid('physical clip is outside the raster page')
    const context = canvas.getContext('2d')!
    context.save()
    context.setTransform(renderRatio, 0, 0, renderRatio, 0, 0)
    context.fillStyle = theme === 'dark' ? '#081016' : '#f8fafc'
    context.fillRect(0, 0, width, clipTop)
    context.fillRect(0, clipBottom, width, renderHeight - clipBottom)
    context.fillRect(0, clipTop, clipLeft, clipBottom - clipTop)
    context.fillRect(clipRight, clipTop, width - clipRight, clipBottom - clipTop)
    context.restore()
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new KJValidationError('Drawing image: PNG encoding failed')), 'image/png')
  })
  assertUnchanged()
  // Data URL overhead plus base64 expansion, checked before allocating the encoded string.
  if (22 + 4 * Math.ceil(blob.size / 3) > MAX_DATA_URL_BYTES) invalid('PNG data URL exceeds the 1 MiB budget')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new KJValidationError('Drawing image: PNG encoding failed'))
    reader.onerror = () => reject(reader.error ?? new KJValidationError('Drawing image: PNG encoding failed'))
    reader.readAsDataURL(blob)
  })
  assertUnchanged()
  if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > MAX_DATA_URL_BYTES) invalid('PNG data URL is invalid or exceeds the 1 MiB budget')
  return Object.freeze({ dataUrl, mimeType: 'image/png', documentId, revision, units, documentUnits: snapshot.header.units, spaceId, coordinateSystem: model ? 'modelXY' : 'paperXY', bounds: Object.freeze(bounds), viewBounds: Object.freeze(viewBounds), width, height, pixelRatio, pixelWidth, pixelHeight, renderReport })
}

/** Capture one bounded read-only XY view without changing the drawing or workbench camera. */
export async function captureDrawingView(drawing: KJDocument, options: KJDrawingViewOptions): Promise<KJDrawingViewImage> {
  return captureDrawingViewInternal(drawing, options)
}

/** Resolve the exact configured paper-to-raster transform without allocating a canvas. */
export function resolveDrawingPngPlot(drawing: KJDocument, options: Pick<KJDrawingPngOptions, 'layoutId' | 'maxEdge'>): KJDrawingPngPlan {
  if (!options || typeof options.layoutId !== 'string') invalid('layoutId is required for PNG export')
  const maxEdge = options.maxEdge ?? 1400
  if (!Number.isInteger(maxEdge) || maxEdge < 1 || maxEdge > 1600) invalid('maxEdge must be an integer from 1 to 1600')
  const source = drawing.snapshot(), layout = drawing.getObject(options.layoutId)
  if (!layout || layout.kind !== 'layout' || !source.spaces.layoutIds.includes(layout.id)) invalid('layoutId must identify a layout in this document')
  const spaceId = String(layout.payload.blockRecordId), model = spaceId === source.spaces.modelSpaceId
  if (!model && !source.spaces.paperSpaceIds.includes(spaceId)) invalid('layout has no valid drawing space')
  const settings = layout.payload.dxfPlotSettings
  if (!settings) invalid('configure PAGESETUP before PNG export')
  validatePlotSettings(settings)
  const rawPaperWidth = Number(settings.paperWidth), rawPaperHeight = Number(settings.paperHeight)
  if (!(rawPaperWidth > 0) || !(rawPaperHeight > 0) || rawPaperWidth > 10000 || rawPaperHeight > 10000) invalid('paper dimensions must be positive millimeters, at most 10000')
  if (settings.styleSheet || settings.printerName || Number(settings.shadeMode ?? 0) !== 0) invalid('external plot styles, printer configuration and shaded plotting are unsupported')
  const paperUnits = Number(settings.paperUnits ?? 1)
  if (paperUnits !== 0 && paperUnits !== 1) invalid('pixel paper units have no physical raster scale')
  const physical = resolvePhysicalPlotPaper(settings)
  const { width: paperWidth, height: paperHeight, left, right, top, bottom } = physical
  const printableWidth = paperWidth - left - right, printableHeight = paperHeight - top - bottom
  if (!(printableWidth > 0) || !(printableHeight > 0)) invalid('margins leave no printable area')
  let plotSource
  try { plotSource = resolveDxfPlotSource(drawing, layout.id, settings, model) }
  catch (error) { invalid(error instanceof Error ? error.message : 'invalid plot source') }
  let x = 0, y = 0, maximumX = 0, maximumY = 0, minimumX = 0, minimumY = 0
  let plotWidth: number | undefined, plotHeight: number | undefined
  if (plotSource.bounded) {
    x = plotSource.minimum[0]; y = plotSource.minimum[1]
    minimumX = x; minimumY = y; maximumX = plotSource.maximum[0]; maximumY = plotSource.maximum[1]
    plotWidth = plotSource.width; plotHeight = plotSource.height
  }
  let resolved
  try { resolved = resolvePlotScale(settings, { printableWidth, printableHeight, sourceWidth: plotWidth, sourceHeight: plotHeight, isModel: model }) }
  catch (error) { invalid(error instanceof Error ? error.message : 'invalid plot scale') }
  const scale = resolved.millimetersPerDrawingUnit, originX = resolved.originX, originY = resolved.originY
  if (!plotSource.bounded) {
    minimumX = originX === 0 ? 0 : -originX / scale; minimumY = originY === 0 ? 0 : -originY / scale
    maximumX = printableWidth / scale - originX / scale; maximumY = printableHeight / scale - originY / scale
  }
  const paperAspect = paperWidth / paperHeight
  const width = Math.max(1, Math.round(paperAspect >= 1 ? maxEdge : maxEdge * paperAspect))
  const height = Math.max(1, Math.round(paperAspect >= 1 ? maxEdge / paperAspect : maxEdge))
  const pixelsPerMillimeter = Math.min(width / paperWidth, height / paperHeight)
  const paperLeft = (width - paperWidth * pixelsPerMillimeter) / 2, paperTop = (height - paperHeight * pixelsPerMillimeter) / 2
  const a = scale * pixelsPerMillimeter
  const matrix: [number, number, number, number, number, number] = [a, 0, 0, -a, paperLeft + (left + originX - scale * x) * pixelsPerMillimeter, paperTop + (paperHeight - bottom - originY + scale * y) * pixelsPerMillimeter]
  const centerX = (width / 2 - matrix[4]) / a, centerY = (matrix[5] - height / 2) / a
  const viewBounds: [number, number, number, number] = [centerX - width / a / 2, centerY - height / a / 2, centerX + width / a / 2, centerY + height / a / 2]
  const printableAreaPixels = { minimum: [paperLeft + left * pixelsPerMillimeter, paperTop + top * pixelsPerMillimeter] as const, maximum: [paperLeft + (paperWidth - right) * pixelsPerMillimeter, paperTop + (paperHeight - bottom) * pixelsPerMillimeter] as const }
  return deepFreeze({
    layoutId: layout.id, spaceId, coordinateSystem: model ? 'modelXY' as const : 'paperXY' as const,
    bounds: [minimumX, minimumY, maximumX, maximumY] as const, viewBounds, width, height,
    paper: {
      widthMm: paperWidth,
      heightMm: paperHeight,
      pixelsPerMillimeter,
      rasterAreaPixels: {
        minimum: [paperLeft, paperTop] as const,
        maximum: [paperLeft + paperWidth * pixelsPerMillimeter, paperTop + paperHeight * pixelsPerMillimeter] as const,
      },
    },
    plot: {
      printableAreaPixels,
      plotOriginPixels: [matrix[4] + a * x, matrix[5] - a * y] as const,
      sourceRange: { kind: plotSource.kind, minimum: [minimumX, minimumY] as const, maximum: [maximumX, maximumY] as const },
      drawingToPixelMatrix: matrix,
    },
  }) as KJDrawingPngPlan
}

/** Export one configured model or paper layout as a bounded PNG raster. */
export async function exportDrawingPng(drawing: KJDocument, options: KJDrawingPngOptions): Promise<KJDrawingPngExport> {
  if (!options || typeof options !== 'object') invalid('options are required for PNG export')
  if (options.allowPartial !== undefined && typeof options.allowPartial !== 'boolean') invalid('allowPartial must be boolean')
  const plan = resolveDrawingPngPlot(drawing, options)
  const matrix = plan.plot.drawingToPixelMatrix
  const point = (x: number, y: number): [number, number] => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
  const [minimumX, minimumY] = plan.plot.sourceRange.minimum
  const [maximumX, maximumY] = plan.plot.sourceRange.maximum
  const clipPixels = plan.plot.sourceRange.kind !== 'layout'
    ? [...point(minimumX, maximumY), ...point(maximumX, minimumY)] as [number, number, number, number]
    : [...plan.plot.printableAreaPixels.minimum, ...plan.plot.printableAreaPixels.maximum] as [number, number, number, number]
  const projection: KJCaptureProjection = {
    centerX: (plan.viewBounds[0] + plan.viewBounds[2]) / 2,
    centerY: (plan.viewBounds[1] + plan.viewBounds[3]) / 2,
    scale: Math.abs(matrix[0]), viewBounds: plan.viewBounds, clipPixels,
  }
  const result = await captureDrawingViewInternal(drawing, { spaceId: plan.spaceId, bounds: plan.bounds, width: plan.width, height: plan.height, pixelRatio: 1, theme: options.theme ?? 'light' }, projection)
  const report = result.renderReport
  const viewportPartial = report.viewportDiagnostics?.some(item => item.unsupported > 0 || item.reason === 'budget') ?? false
  const partial = report.unsupported > 0 || report.detailCulled > 0 || Boolean(report.hatchDiagnostics?.length) || viewportPartial
  if (partial && options.allowPartial !== true) invalid(`PNG render is incomplete (${report.unsupported} unsupported, ${report.detailCulled} detail-budget omissions)`)
  return Object.freeze({ ...result, layoutId: plan.layoutId, paper: plan.paper, plot: plan.plot })
}
