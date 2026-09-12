import { KJCanvasRenderer } from './canvas-renderer.js'
import type { KJCanvasRenderReport, KJCanvasTheme } from './canvas-renderer.js'
import type { KJDocument } from './document.js'
import { KJRevisionConflictError, KJValidationError } from './errors.js'

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

export interface KJDrawingPngExport extends KJDrawingViewImage { readonly layoutId: string }

const MAX_DATA_URL_BYTES = 1024 * 1024

function invalid(message: string): never { throw new KJValidationError(`Drawing image: ${message}`) }

/**
 * Capture a read-only XY space view using the same canvas renderer as the workbench.
 * Aspect-ratio differences expand viewBounds; geometry is never stretched.
 * This is a visual aid, not geometric verification: inspect renderReport for limitations.
 * Requires a browser DOM canvas. All sizes are bounded before canvas allocation.
 */
export async function captureDrawingView(drawing: KJDocument, options: KJDrawingViewOptions): Promise<KJDrawingViewImage> {
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
  const scale = Math.min(width / spanX, renderHeight / spanY)
  const centerX = minX + spanX / 2, centerY = minY + spanY / 2
  const viewBounds: [number, number, number, number] = [centerX - width / scale / 2, centerY - renderHeight / scale / 2, centerX + width / scale / 2, centerY + renderHeight / scale / 2]
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
  const renderer = new KJCanvasRenderer(canvas, { pixelRatio: renderRatio, theme, grid: false, spaceId, showLineweights: true })
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

/** Export one configured model or paper layout as a bounded PNG raster. */
export async function exportDrawingPng(drawing: KJDocument, options: KJDrawingPngOptions): Promise<KJDrawingPngExport> {
  if (!options || typeof options.layoutId !== 'string') invalid('layoutId is required for PNG export')
  if (options.allowPartial !== undefined && typeof options.allowPartial !== 'boolean') invalid('allowPartial must be boolean')
  const maxEdge = options.maxEdge ?? 1400
  if (!Number.isInteger(maxEdge) || maxEdge < 1 || maxEdge > 1600) invalid('maxEdge must be an integer from 1 to 1600')
  const source = drawing.snapshot(), layout = drawing.getObject(options.layoutId)
  if (!layout || layout.kind !== 'layout' || !source.spaces.layoutIds.includes(layout.id)) invalid('layoutId must identify a layout in this document')
  const spaceId = String(layout.payload.blockRecordId), model = spaceId === source.spaces.modelSpaceId
  if (!model && !source.spaces.paperSpaceIds.includes(spaceId)) invalid('layout has no valid drawing space')
  const settings = layout.payload.dxfPlotSettings
  if (!settings) invalid('configure PAGESETUP before PNG export')
  let bounds: [number, number, number, number]
  if (model) {
    if (settings.plotType !== 4) invalid('model PNG export requires an explicit plot window')
    bounds = [Number(settings.windowMinX), Number(settings.windowMinY), Number(settings.windowMaxX), Number(settings.windowMaxY)]
  } else {
    bounds = [0, 0, Number(settings.paperWidth), Number(settings.paperHeight)]
  }
  if (!bounds.every(Number.isFinite) || !(bounds[2] > bounds[0] && bounds[3] > bounds[1])) invalid('configured output bounds must have finite positive extents')
  const aspect = (bounds[2] - bounds[0]) / (bounds[3] - bounds[1])
  const width = Math.max(1, Math.round(aspect >= 1 ? maxEdge : maxEdge * aspect))
  const height = Math.max(1, Math.round(aspect >= 1 ? maxEdge / aspect : maxEdge))
  const result = await captureDrawingView(drawing, { spaceId, bounds, width, height, pixelRatio: 1, theme: options.theme ?? 'light' })
  const report = result.renderReport
  const viewportPartial = report.viewportDiagnostics?.some(item => item.unsupported > 0 || item.reason === 'budget') ?? false
  const partial = report.unsupported > 0 || report.detailCulled > 0 || Boolean(report.hatchDiagnostics?.length) || viewportPartial
  if (partial && options.allowPartial !== true) invalid(`PNG render is incomplete (${report.unsupported} unsupported, ${report.detailCulled} detail-budget omissions)`)
  return Object.freeze({ ...result, layoutId: layout.id })
}
