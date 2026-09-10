import {
  multiply3,
  rotation3,
  scale3,
  transformEntityPayload,
  translation3,
} from './geometry/index.js'
import { nearestPointOnEntity2 } from './snapping.js'
import { normalizeSplineDefinition, splinePoint2 } from './geometry/curves.js'
import { projectDimension } from './geometry/annotation.js'
import { hatchPatternLines, hatchStrokes, type KJHatchPatternLine } from './geometry/hatch.js'
import { createHatchStrokeCoverage, type KJHatchCoverageReason } from './geometry/hatch-coverage.js'
import { getEntityGrips, type KJEntityGrip } from './grips.js'
import { isEntitySelectable, selectEntitiesInBox, selectEntitiesByFence, type KJBoxSelectionMode } from './selection-geometry.js'
import type { KJDocument } from './document.js'
import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js'

export type KJCanvasTheme = 'dark' | 'light'

export interface KJCanvasRendererOptions {
  document?: KJDocument | null
  spaceId?: string | null
  theme?: KJCanvasTheme
  grid?: boolean
  pixelRatio?: number
  padding?: number
  background?: string
  selectionColor?: string
  showLineweights?: boolean
  sceneProvider?: KJCanvasSceneProvider | null
}

export interface KJCanvasSceneQuery {
  document: KJDocument
  spaceId: string
}

/** Replaceable scene-query seam for spatial indexes, workers or streamed tiles. */
export interface KJCanvasSceneProvider {
  listEntities(query: KJCanvasSceneQuery): ReadonlyArray<KJReadonlyObjectRecord>
  hitCandidates?(query: KJCanvasSceneQuery & { point: Point2; radius: number }): ReadonlyArray<KJReadonlyObjectRecord>
}

export interface KJCanvasCamera {
  centerX: number
  centerY: number
  scale: number
}

export interface KJCanvasRenderReport {
  viewportDiagnostics?: readonly KJCanvasViewportDiagnostic[]
  hatchDiagnostics?: readonly { entityId: string; reason: 'budget' | 'unsupported-pattern' | 'unsupported-boundary'; samplingReason?: KJHatchCoverageReason | 'pixel-budget' | 'canvas-unavailable' }[]
  total: number
  rendered: number
  approximated: number
  hidden: number
  unsupported: number
  approximateTypes: readonly string[]
  unsupportedTypes: readonly string[]
  width: number
  height: number
  scale: number
}
export interface KJCanvasViewportDiagnostic {
  entityId: string
  rendered: number
  hidden: number
  approximated: number
  unsupported: number
  reason?: 'invalid-view' | 'unsupported-view' | 'not-paper-space' | 'budget'
}

export interface KJCanvasHit {
  entity: KJReadonlyObjectRecord
  distance: number
  point: readonly [number, number, number]
}

export interface KJCanvasSelectionOptions { includeLocked?: boolean }
export interface KJCanvasBoxSelectionOptions extends KJCanvasSelectionOptions { mode?: KJBoxSelectionMode }

export interface KJCanvasPreviewEntity {
  type: string
  payload: Readonly<Record<string, unknown>>
}

export interface KJCanvasPreviewResource { readonly id: string; readonly payload: Readonly<Record<string, unknown>> }

type Point2 = readonly [number, number]
type Point3 = readonly [number, number, number]
type HatchRaster = { source: HTMLCanvasElement | OffscreenCanvas | null; x: number; y: number; width: number; height: number; reason?: KJHatchCoverageReason | 'pixel-budget' | 'canvas-unavailable' }
type HatchRasterCacheEntry = { payload: Readonly<Record<string, unknown>>; key: string; raster: HatchRaster; bytes: number }
type HatchProjectionIdentity = { payload: Readonly<Record<string, unknown>>; instanceKey: string; dimension?: ReturnType<typeof projectDimension> }
const HATCH_RASTER_PIXEL_LIMIT = 1048576
const HATCH_RASTER_FRAME_WORK = 4000000
const HATCH_RASTER_CACHE_BYTES = 32 * 1024 * 1024

const DARK_PALETTE = Object.freeze([
  '#d8e6f3', '#ff767d', '#f2d46f', '#7ce38b', '#62d8e8', '#75a7ff', '#c997ff', '#f29fd1', '#9fb4c8',
])
const LIGHT_PALETTE = Object.freeze([
  '#23364a', '#c52f3a', '#9b7416', '#247a39', '#147383', '#2a5fc4', '#7441a4', '#9d3d78', '#53687d',
])
const APPROXIMATE_TYPES = new Set(['SPLINE', 'TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB', 'HATCH', 'LEADER', 'MLEADER', 'DIMENSION', 'TABLE', 'IMAGE', 'SOLID3D'])

function hsv(hue: number, saturation: number, value: number): string {
  const chroma = value * saturation
  const section = ((hue % 360) + 360) % 360 / 60
  const second = chroma * (1 - Math.abs(section % 2 - 1))
  const [r1, g1, b1] = section < 1 ? [chroma, second, 0] : section < 2 ? [second, chroma, 0] : section < 3 ? [0, chroma, second] : section < 4 ? [0, second, chroma] : section < 5 ? [second, 0, chroma] : [chroma, 0, second]
  const match = value - chroma
  const valueOf = (component: number) => Math.round((component + match) * 255).toString(16).padStart(2, '0')
  return `#${valueOf(r1)}${valueOf(g1)}${valueOf(b1)}`
}

/** AutoCAD Color Index projection including the 24 hue ramps and gray tail. */
export function aciColor(input: unknown, theme: KJCanvasTheme = 'dark'): string {
  const index = Math.max(0, Math.min(255, Math.trunc(finite(input, 7))))
  const basics = theme === 'dark'
    ? ['#d8e6f3', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff', '#808080', '#c0c0c0']
    : ['#23364a', '#ff0000', '#b59a00', '#008f19', '#008f8f', '#0000ff', '#c000c0', '#111111', '#808080', '#404040']
  if (index < 10) return basics[index]!
  if (index >= 250) return ['#333333', '#505050', '#696969', '#828282', '#bebebe', theme === 'dark' ? '#ffffff' : '#111111'][index - 250]!
  const ramp = (index - 10) % 10, hue = Math.floor((index - 10) / 10) * 15
  const values = [1, 1, 0.65, 0.65, 0.5, 0.5, 0.3, 0.3, 0.15, 0.15]
  return hsv(hue, ramp % 2 ? 0.5 : 1, values[ramp]!)
}

function explicitColor(input: unknown): string | null {
  if (typeof input === 'string' && /^(?:#[0-9a-f]{3,8}|rgb|hsl)/i.test(input.trim())) return input.trim()
  const value = Number(input)
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) return `#${value.toString(16).padStart(6, '0')}`
  return null
}

function point2(input: unknown): Point2 | null {
  if (!Array.isArray(input)) return null
  const x = Number(input[0]), y = Number(input[1])
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

function points(input: unknown): Point2[] {
  if (!Array.isArray(input)) return []
  return input.map(value => point2((value as { point?: unknown })?.point ?? value)).filter((value): value is Point2 => value !== null)
}

function finite(value: unknown, fallback = 0): number {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

function splineSamples(payload: Readonly<Record<string, unknown>>): Point2[] {
  const definition = normalizeSplineDefinition({
    degree: finite(payload.degree, 3), controlPoints: points(payload.controlPoints),
    ...(Array.isArray(payload.knots) ? { knots: payload.knots.map(Number) } : {}),
    ...(Array.isArray(payload.weights) ? { weights: payload.weights.map(Number) } : {}),
  })
  const knots = [...new Set(definition.knots.slice(definition.degree, definition.controlPoints.length + 1))]
  const result: Point2[] = []
  for (let span = 1; span < knots.length; span++) {
    const a = knots[span - 1]!, b = knots[span]!
    for (let step = span === 1 ? 0 : 1; step <= 24; step++) result.push(splinePoint2(definition, a + (b - a) * step / 24))
  }
  return result
}

function colorIndex(value: unknown): number {
  const index = Math.abs(Math.trunc(finite(value, 7)))
  return index % DARK_PALETTE.length
}

function normalizeSweep(start: number, end: number): number {
  let sweep = end - start
  while (sweep <= 0) sweep += Math.PI * 2
  return sweep
}

function bulgeSegment(start: Point2, end: Point2, bulge: number): Point2[] {
  if (Math.abs(bulge) < 1e-10) return [start, end]
  const dx = end[0] - start[0], dy = end[1] - start[1]
  const chord = Math.hypot(dx, dy)
  if (!(chord > 0)) return [start]
  const theta = 4 * Math.atan(bulge)
  const midpoint: Point2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  const offset = chord * (1 - bulge * bulge) / (4 * bulge)
  const center: Point2 = [midpoint[0] - dy / chord * offset, midpoint[1] + dx / chord * offset]
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const segments = Math.max(8, Math.ceil(Math.abs(theta) / (Math.PI / 18)))
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + theta * index / segments
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius] as Point2
  })
}

function polylineSamples(payload: Readonly<Record<string, unknown>>): Point2[] {
  const vertices = Array.isArray(payload.vertices) ? payload.vertices : []
  const output: Point2[] = []
  for (let index = 0; index < vertices.length; index += 1) {
    const source = vertices[index] as { point?: unknown; bulge?: unknown }
    const start = point2(source?.point ?? source)
    const nextSource = vertices[(index + 1) % vertices.length] as { point?: unknown }
    const end = point2(nextSource?.point ?? nextSource)
    if (!start) continue
    if (!end || index === vertices.length - 1 && payload.closed !== true) {
      if (!output.length || output.at(-1) !== start) output.push(start)
      continue
    }
    const sampled = bulgeSegment(start, end, finite(source?.bulge))
    output.push(...(output.length ? sampled.slice(1) : sampled))
  }
  return output
}

function entityPoints(entity: KJReadonlyObjectRecord): Point2[] {
  const payload = entity.payload
  const output: Point2[] = []
  if (entity.type === 'VIEWPORT') {
    const center = point2(payload.center), width = finite(payload.width), height = finite(payload.height)
    return center && width > 0 && height > 0 ? [[center[0] - width / 2, center[1] - height / 2], [center[0] + width / 2, center[1] + height / 2]] : []
  }
  for (const key of ['start', 'end', 'origin', 'position', 'center', 'textPosition', 'insertionPoint'] as const) {
    const value = point2(payload[key])
    if (value) output.push(value)
  }
  output.push(...points(payload.vertices), ...points(payload.controlPoints), ...points(payload.fitPoints), ...points(payload.definitionPoints))
  if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') output.push(...polylineSamples(payload))
  if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
    const center = point2(payload.center), radius = Math.abs(finite(payload.radius))
    if (center && radius) output.push([center[0] - radius, center[1] - radius], [center[0] + radius, center[1] + radius])
  }
  if (entity.type === 'ELLIPSE') {
    const center = point2(payload.center), axis = point2(payload.majorAxis)
    if (center && axis) {
      const radius = Math.hypot(axis[0], axis[1])
      output.push([center[0] - radius, center[1] - radius], [center[0] + radius, center[1] + radius])
    }
  }
  for (const loop of Array.isArray(payload.boundaryLoops) ? payload.boundaryLoops : []) {
    if (Array.isArray(loop.vertices)) output.push(...polylineSamples({ vertices: loop.vertices, closed: true }))
    for (const edge of Array.isArray(loop.edges) ? loop.edges : []) {
      if (edge.type === 'LINE') output.push(...points([edge.start, edge.end]))
      else if (edge.type === 'ARC') {
        const center = point2(edge.center), radius = Math.abs(finite(edge.radius))
        if (center && radius) output.push([center[0] - radius, center[1] - radius], [center[0] + radius, center[1] + radius])
      }
    }
  }
  return output
}

/**
 * Dependency-free Canvas 2D projection for KJDocument.
 *
 * The renderer never owns or mutates drawing truth. Applications can replace it
 * with WebGL/WebGPU while keeping the exact same document and command contract.
 */
export class KJCanvasRenderer {
  #viewportDiagnostics: KJCanvasViewportDiagnostic[] = []
  #viewportWorkRemaining = 100000
  #viewportState: { frozen: Set<string>; scale: number; diagnostic: KJCanvasViewportDiagnostic } | null = null
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly camera: KJCanvasCamera = { centerX: 50, centerY: 40, scale: 4 }
  #document: KJDocument | null = null
  #spaceId: string | null
  #selection = new Set<string>()
  #theme: KJCanvasTheme
  #grid: boolean
  #pixelRatio: number | null
  #padding: number
  #background: string | null
  #selectionColor: string | null
  #showLineweights: boolean
  #sceneProvider: KJCanvasSceneProvider | null
  #width = 1
  #height = 1
  #fittedCamera: KJCanvasCamera | null = null
  #disposeDocument: (() => void) | null = null
  #observer: ResizeObserver | null = null
  #hatchDiagnostics: NonNullable<KJCanvasRenderReport['hatchDiagnostics']>[number][] = []
  #hatchWorkRemaining = 100000
  #hatchSampleWorkRemaining = HATCH_RASTER_FRAME_WORK
  #hatchSamplePixelsRemaining = HATCH_RASTER_PIXEL_LIMIT
  #hatchRasterCache: HatchRasterCacheEntry[] = []
  #report: KJCanvasRenderReport = Object.freeze({ total: 0, rendered: 0, approximated: 0, hidden: 0, unsupported: 0, approximateTypes: Object.freeze([]), unsupportedTypes: Object.freeze([]), width: 1, height: 1, scale: 4 })

  constructor(canvas: HTMLCanvasElement, options: KJCanvasRendererOptions = {}) {
    if (!canvas?.getContext) throw new TypeError('KJCanvasRenderer requires an HTMLCanvasElement')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable')
    this.canvas = canvas
    this.context = context
    this.#spaceId = options.spaceId ?? null
    this.#theme = options.theme ?? 'dark'
    this.#grid = options.grid ?? true
    this.#pixelRatio = options.pixelRatio == null ? null : Math.max(1, finite(options.pixelRatio, 1))
    this.#padding = Math.max(0, finite(options.padding, 48))
    this.#background = options.background ?? null
    this.#selectionColor = options.selectionColor ?? null
    this.#showLineweights = options.showLineweights ?? false
    this.#sceneProvider = options.sceneProvider ?? null
    this.setDocument(options.document ?? null)
    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.resize())
      this.#observer.observe(canvas)
    }
    this.resize()
  }

  get document(): KJDocument | null { return this.#document }
  get spaceId(): string | null { return this.#spaceId }
  get theme(): KJCanvasTheme { return this.#theme }
  get grid(): boolean { return this.#grid }
  get selection(): readonly string[] { return Object.freeze([...this.#selection]) }
  get report(): Readonly<KJCanvasRenderReport> { return this.#report }

  setDocument(document: KJDocument | null): this {
    this.#disposeDocument?.()
    this.#disposeDocument = null
    this.#document = document
    this.#hatchRasterCache = []
    if (document) this.#disposeDocument = document.on('document:change', () => this.render())
    this.#selection.clear()
    this.render()
    return this
  }

  setTheme(theme: KJCanvasTheme): this { this.#theme = theme; this.render(); return this }
  setGrid(enabled: boolean): this { this.#grid = Boolean(enabled); this.render(); return this }
  setSelection(ids: readonly string[] = []): this { this.#selection = new Set(ids.map(String)); this.render(); return this }
  setSpace(spaceId: string | null): this { this.#spaceId = spaceId; this.#selection.clear(); this.render(); return this }
  setSceneProvider(provider: KJCanvasSceneProvider | null): this { this.#sceneProvider = provider; this.render(); return this }

  resize(width?: number, height?: number): this {
    const keepFitted = this.#fittedCamera !== null
      && this.camera.centerX === this.#fittedCamera.centerX
      && this.camera.centerY === this.#fittedCamera.centerY
      && this.camera.scale === this.#fittedCamera.scale
    const rect = this.canvas.getBoundingClientRect()
    const nextWidth = Math.max(1, finite(width, rect.width || this.canvas.clientWidth || 1))
    const nextHeight = Math.max(1, finite(height, rect.height || this.canvas.clientHeight || 1))
    const viewportChanged = nextWidth !== this.#width || nextHeight !== this.#height
    this.#width = nextWidth
    this.#height = nextHeight
    const ratio = this.#pixelRatio ?? Math.max(1, globalThis.devicePixelRatio || 1)
    const targetWidth = Math.max(1, Math.round(this.#width * ratio))
    const targetHeight = Math.max(1, Math.round(this.#height * ratio))
    if (this.canvas.width !== targetWidth) this.canvas.width = targetWidth
    if (this.canvas.height !== targetHeight) this.canvas.height = targetHeight
    // ResizeObserver may deliver its initial notification after edits or pointerdown.
    // An unchanged viewport must not refit changed geometry underneath that gesture.
    if (keepFitted && viewportChanged && this.#document) return this.fit()
    if (!keepFitted) this.#fittedCamera = null
    this.render()
    return this
  }

  worldToScreen(input: Point2): Point2 {
    return [
      (input[0] - this.camera.centerX) * this.camera.scale + this.#width / 2,
      this.#height / 2 - (input[1] - this.camera.centerY) * this.camera.scale,
    ]
  }

  screenToWorld(input: Point2): Point2 {
    return [
      (input[0] - this.#width / 2) / this.camera.scale + this.camera.centerX,
      (this.#height / 2 - input[1]) / this.camera.scale + this.camera.centerY,
    ]
  }

  panBy(screenDx: number, screenDy: number): this {
    this.#fittedCamera = null
    this.camera.centerX -= finite(screenDx) / this.camera.scale
    this.camera.centerY += finite(screenDy) / this.camera.scale
    this.render()
    return this
  }

  zoomAt(factor: number, screenPoint: Point2 = [this.#width / 2, this.#height / 2]): this {
    this.#fittedCamera = null
    const before = this.screenToWorld(screenPoint)
    this.camera.scale = Math.min(1e7, Math.max(1e-7, this.camera.scale * Math.max(0.01, finite(factor, 1))))
    const after = this.screenToWorld(screenPoint)
    this.camera.centerX += before[0] - after[0]
    this.camera.centerY += before[1] - after[1]
    this.render()
    return this
  }

  fit(): this {
    const document = this.#document
    if (!document) return this
    const layers = new Map(document.getTable('layers')?.records.map(layer => [layer.id, layer.payload]) ?? [])
    const unboundedOrigins: Point2[] = []
    const values = this.#entities()
      .filter(entity => {
        const layer = layers.get(String(entity.payload.layerId ?? ''))
        return entity.payload.visible !== false && layer?.visible !== false && layer?.frozen !== true
      })
      .flatMap(entity => this.#fitPoints(entity, 0, unboundedOrigins))
    if (!values.length) {
      // Infinite geometry has no finite extent. Center one visible guide without
      // changing zoom; its arbitrary origin must not shrink finite drawing content.
      this.camera.centerX = unboundedOrigins[0]?.[0] ?? 50
      this.camera.centerY = unboundedOrigins[0]?.[1] ?? 40
      if (!unboundedOrigins.length) this.camera.scale = 4
      this.#fittedCamera = { ...this.camera }
      return this.render(), this
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of values) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
    this.camera.centerX = (minX + maxX) / 2
    this.camera.centerY = (minY + maxY) / 2
    this.camera.scale = Math.max(1e-7, Math.min(
      Math.max(1, this.#width - this.#padding * 2) / Math.max(1e-9, maxX - minX),
      Math.max(1, this.#height - this.#padding * 2) / Math.max(1e-9, maxY - minY),
    ))
    this.#fittedCamera = { ...this.camera }
    this.render()
    return this
  }

  hitTest(screenPoint: Point2, tolerancePixels = 8, options: KJCanvasSelectionOptions = {}): KJCanvasHit | null {
    const document = this.#document
    if (!document) return null
    const point = this.screenToWorld(screenPoint)
    const layers = new Map(document.getTable('layers')?.records.map(layer => [layer.id, layer.payload]) ?? [])
    let best: KJCanvasHit | null = null
    const radius = tolerancePixels / this.camera.scale
    const query = { document, spaceId: this.#activeSpaceId(), point, radius }
    const candidates = this.#sceneProvider?.hitCandidates?.(query) ?? this.#entities()
    for (const entity of candidates) {
      if (!isEntitySelectable(document, entity, { ...options, spaceId: query.spaceId })) continue
      const layer = layers.get(String(entity.payload.layerId ?? ''))
      if (layer?.visible === false || layer?.frozen === true) continue
      try {
        if (entity.type === 'SPLINE') {
          const vertices = splineSamples(entity.payload).map(point => ({ point }))
          const nearest = nearestPointOnEntity2({ ...entity, type: 'LWPOLYLINE', payload: { vertices, closed: entity.payload.closed === true } }, point)
          if (nearest.distance <= radius && (!best || nearest.distance < best.distance)) best = { entity, distance: nearest.distance, point: nearest.point }
          continue
        }
        if (entity.type === 'DIMENSION') {
          const projected = projectDimension(entity.payload, this.#document?.getObject(String(entity.payload.styleId ?? ''))?.payload)
          if (projected) {
            for (const [start, end] of projected.lines) {
              const nearest = nearestPointOnEntity2({ ...entity, type: 'LINE', payload: { start, end } }, point)
              if (nearest.distance <= radius && (!best || nearest.distance < best.distance)) best = { entity, distance: nearest.distance, point: nearest.point }
            }
            continue
          }
        }
        const nearest = nearestPointOnEntity2(entity, point)
        if (nearest.distance * this.camera.scale <= tolerancePixels && (!best || nearest.distance < best.distance)) {
          best = { entity, distance: nearest.distance, point: nearest.point }
        }
      } catch {
        const samples = entityPoints(entity)
        const nearest = samples.map(value => ({ value, distance: Math.hypot(value[0] - point[0], value[1] - point[1]) })).sort((a, b) => a.distance - b.distance)[0]
        if (nearest && nearest.distance * this.camera.scale <= tolerancePixels && (!best || nearest.distance < best.distance)) {
          best = { entity, distance: nearest.distance, point: [nearest.value[0], nearest.value[1], 0] as Point3 }
        }
      }
    }
    return best ? Object.freeze({ ...best, point: Object.freeze(best.point) }) : null
  }

  /** Screen-coordinate box query. Left to right defaults to window; right to left to crossing. */
  selectBox(first: Point2, second: Point2, options: KJCanvasBoxSelectionOptions = {}): readonly string[] {
    if (!this.#document) return Object.freeze([])
    const sceneIds = new Set(this.#entities().map(entity => entity.id))
    return Object.freeze(selectEntitiesInBox(this.#document, this.screenToWorld(first), this.screenToWorld(second), options.mode ?? (second[0] >= first[0] ? 'window' : 'crossing'), { ...options, spaceId: this.#activeSpaceId(), tolerance: .25 / this.camera.scale }).filter(id => sceneIds.has(id)))
  }

  selectFence(points: readonly Point2[], options: KJCanvasSelectionOptions = {}): readonly string[] {
    if (!this.#document) return Object.freeze([])
    const sceneIds = new Set(this.#entities().map(entity => entity.id))
    return Object.freeze(selectEntitiesByFence(this.#document, points.map(point => this.screenToWorld(point)), { ...options, spaceId: this.#activeSpaceId(), tolerance: .25 / this.camera.scale }).filter(id => sceneIds.has(id)))
  }

  selectAll(options: KJCanvasSelectionOptions = {}): readonly string[] {
    const document = this.#document
    if (!document) return Object.freeze([])
    const query = { ...options, spaceId: this.#activeSpaceId() }
    return Object.freeze(this.#entities().filter(entity => isEntitySelectable(document, entity, query)).map(entity => entity.id))
  }

  /** Returns editable model-space handles without changing selection or document history. */
  getGrips(ids: readonly string[] = [...this.#selection]): readonly KJEntityGrip[] {
    const document = this.#document
    if (!document) return Object.freeze([])
    const result: KJEntityGrip[] = [], query = { spaceId: this.#activeSpaceId() }
    for (const id of ids) {
      const entity = document.getObject(id)
      if (!entity || !isEntitySelectable(document, entity, query)) continue
      try { result.push(...getEntityGrips(entity)) } catch { /* Unsupported geometry has no editable handle. */ }
    }
    return Object.freeze(result)
  }

  hitGrip(screenPoint: Point2, tolerancePixels = 7): KJEntityGrip | null {
    let best: KJEntityGrip | null = null, distance = tolerancePixels
    for (const grip of this.getGrips()) {
      const p = this.worldToScreen([grip.point[0], grip.point[1]]), d = Math.hypot(p[0] - screenPoint[0], p[1] - screenPoint[1])
      if (d <= distance) { best = grip; distance = d }
    }
    return best
  }

  /** Optional handle overlay; render() clears it, leaving inspect/read-only hosts in control. */
  drawGrips(hoverId?: string): this {
    const context = this.context
    context.save(); context.setLineDash([]); context.lineWidth = 1
    for (const grip of this.getGrips()) {
      const [x, y] = this.worldToScreen([grip.point[0], grip.point[1]])
      context.fillStyle = hoverId === `${grip.entityId}:${grip.id}` ? '#ffbf69' : '#2863df'
      context.strokeStyle = '#dceaff'; context.fillRect(x - 3.5, y - 3.5, 7, 7); context.strokeRect(x - 3.5, y - 3.5, 7, 7)
    }
    context.restore(); return this
  }

  render(): Readonly<KJCanvasRenderReport> {
    this.#viewportDiagnostics = []
    this.#viewportWorkRemaining = 100000
    this.#hatchDiagnostics = []
    this.#hatchWorkRemaining = 100000
    this.#hatchSampleWorkRemaining = HATCH_RASTER_FRAME_WORK
    this.#hatchSamplePixelsRemaining = HATCH_RASTER_PIXEL_LIMIT
    const context = this.context
    const ratio = this.canvas.width / Math.max(1, this.#width)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, this.#width, this.#height)
    context.fillStyle = this.#background ?? (this.#theme === 'dark' ? '#081016' : '#f8fafc')
    context.fillRect(0, 0, this.#width, this.#height)
    if (this.#grid) this.#drawGrid()

    const document = this.#document
    if (!document) {
      this.#report = Object.freeze({ total: 0, rendered: 0, approximated: 0, hidden: 0, unsupported: 0, approximateTypes: Object.freeze([]), unsupportedTypes: Object.freeze([]), width: this.#width, height: this.#height, scale: this.camera.scale })
      return this.#report
    }
    const entities = this.#entities()
    const layers = new Map(document.getTable('layers')?.records.map(layer => [layer.id, layer.payload]) ?? [])
    const palette = this.#theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
    let rendered = 0, approximated = 0, hidden = 0
    const approximateTypes = new Set<string>()
    const unsupported = new Set<string>()
    for (const entity of entities) {
      const layer = layers.get(String(entity.payload.layerId ?? ''))
      if (entity.payload.visible === false || layer?.visible === false || layer?.frozen === true) { hidden += 1; continue }
      const color = this.#selection.has(entity.id)
        ? this.#selectionColor ?? (this.#theme === 'dark' ? '#b9ff72' : '#0b67e3')
        : this.#color(entity, layer) ?? palette[colorIndex(layer?.color)]!
      if (this.#drawEntity(entity, color, 0, this.#selection.has(entity.id))) {
        rendered += 1
        if (APPROXIMATE_TYPES.has(entity.type) || entity.type === 'VIEWPORT' && this.#viewportDiagnostics.at(-1)?.approximated) { approximated += 1; approximateTypes.add(entity.type) }
      }
      else unsupported.add(entity.type)
    }
    this.#report = Object.freeze({
      total: entities.length,
      rendered,
      approximated,
      hidden,
      unsupported: entities.length - rendered - hidden,
      approximateTypes: Object.freeze([...approximateTypes].sort()),
      unsupportedTypes: Object.freeze([...unsupported].sort()),
      hatchDiagnostics: Object.freeze(this.#hatchDiagnostics.map(item => Object.freeze(item))),
      viewportDiagnostics: Object.freeze(this.#viewportDiagnostics.map(item => Object.freeze({ ...item }))),
      width: this.#width,
      height: this.#height,
      scale: this.camera.scale,
    })
    return this.#report
  }

  /** Paint temporary native geometry without inserting objects or changing history. Call render() to clear it. */
  #previewResources = new Map<string, KJCanvasPreviewResource>()

  drawPreview(entities: readonly KJCanvasPreviewEntity[], color = '#77a7ff', offset: Point2 = [0, 0], resources: readonly KJCanvasPreviewResource[] = []): this {
    const previous = this.#previewResources
    this.#previewResources = new Map(resources.map(item => [item.id, item]))
    try {
    for (const [index, spec] of entities.entries()) {
      let payload = structuredClone(spec.payload) as KJObjectPayload
      if (offset[0] || offset[1]) payload = transformEntityPayload(spec.type, payload, translation3(offset[0], offset[1]))
      this.#drawEntity({ id: `preview-${index}`, handle: '', kind: 'entity', type: spec.type, ownerId: null, name: null, payload, extension: { xdata: {}, xrecordIds: [], reactorIds: [], hyperlinks: [] }, erased: false, source: null }, color, 0, true)
    }
    return this
    } finally { this.#previewResources = previous }
  }

  dispose(): void {
    this.#disposeDocument?.()
    this.#disposeDocument = null
    this.#observer?.disconnect()
    this.#observer = null
    this.#document = null
    this.#selection.clear()
    this.#hatchRasterCache = []
  }

  #activeSpaceId(): string {
    const document = this.#document
    if (!document) return ''
    return this.#spaceId ?? document.snapshot().spaces.modelSpaceId
  }

  #color(entity: KJReadonlyObjectRecord, layer?: Readonly<Record<string, unknown>>): string {
    const ownTrueColor = entity.payload.trueColor == null ? null : explicitColor(entity.payload.trueColor)
    if (ownTrueColor) return ownTrueColor
    const color = entity.payload.color
    if (typeof color === 'string' && !/^(?:bylayer|byblock)$/i.test(color)) {
      const cssColor = /^(?:#|rgb|hsl)/i.test(color) ? explicitColor(color) : null
      if (cssColor) return cssColor
    }
    if (color != null && Number.isFinite(Number(color)) && Number(color) > 0 && Number(color) < 256) return aciColor(color, this.#theme)
    return (layer?.trueColor == null ? null : explicitColor(layer.trueColor))
      ?? (typeof layer?.color === 'string' && /^(?:#|rgb|hsl)/i.test(layer.color) ? explicitColor(layer.color) : null)
      ?? aciColor(layer?.color ?? 7, this.#theme)
  }

  #fitPoints(entity: KJReadonlyObjectRecord, depth = 0, unboundedOrigins: Point2[] = []): Point2[] {
    if (entity.type === 'XLINE' || entity.type === 'RAY') {
      const origin = point2(entity.payload.origin)
      if (origin) unboundedOrigins.push(origin)
      return []
    }
    if (entity.type !== 'INSERT' || depth > 12) return entityPoints(entity)
    const payload = entity.payload
    const blockId = String(payload.blockRecordId ?? '')
    const block = this.#document?.getObject(blockId)
    const position = point2(payload.position), base = point2(block?.payload.basePoint) ?? [0, 0]
    if (!position || !block) return entityPoints(entity)
    const inputScale = Array.isArray(payload.scale) ? payload.scale : [payload.scale ?? 1, payload.scale ?? 1]
    const matrix = multiply3(translation3(position[0], position[1]), multiply3(rotation3(finite(payload.rotation)), multiply3(scale3(finite(inputScale[0], 1), finite(inputScale[1], 1)), translation3(-base[0], -base[1]))))
    const output: Point2[] = []
    for (const child of this.#document?.listEntities({ ownerId: blockId }) ?? []) {
      const layer = this.#document?.getObject(String(child.payload.layerId ?? ''))?.payload
      if (child.payload.visible === false || layer?.visible === false || layer?.frozen === true) continue
      try { output.push(...this.#fitPoints({ ...child, payload: transformEntityPayload(child.type, structuredClone(child.payload) as KJObjectPayload, matrix) }, depth + 1, unboundedOrigins)) }
      catch { output.push(position) }
    }
    return output
  }

  #entities(): ReadonlyArray<KJReadonlyObjectRecord> {
    const document = this.#document
    if (!document) return []
    const query = { document, spaceId: this.#activeSpaceId() }
    return this.#sceneProvider?.listEntities(query) ?? document.listEntities({ ownerId: query.spaceId })
  }

  #drawGrid(): void {
    const context = this.context
    let spacing = 10
    while (spacing * this.camera.scale < 20) spacing *= 2
    while (spacing * this.camera.scale > 80) spacing /= 2
    const lower = this.screenToWorld([0, this.#height]), upper = this.screenToWorld([this.#width, 0])
    context.fillStyle = this.#theme === 'dark' ? '#23303b' : '#d8e0e8'
    for (let x = Math.ceil(lower[0] / spacing) * spacing; x < upper[0]; x += spacing) {
      for (let y = Math.ceil(lower[1] / spacing) * spacing; y < upper[1]; y += spacing) {
        const screen = this.worldToScreen([x, y])
        context.fillRect(Math.round(screen[0]), Math.round(screen[1]), 1, 1)
      }
    }
  }

  #strokePath(values: readonly Point2[], close = false): boolean {
    if (!values.length) return false
    const context = this.context
    context.beginPath()
    values.forEach((value, index) => {
      const screen = this.worldToScreen(value)
      if (index) context.lineTo(screen[0], screen[1])
      else context.moveTo(screen[0], screen[1])
    })
    if (close) context.closePath()
    context.stroke()
    return true
  }

  /** Physical-pixel fallback for otherwise unbounded row enumeration. A single unknown
   * subsample rejects the mask, retaining vector output and a partial-render diagnostic.
   * Two-by-two sampling approximates antialiasing, never the original dash lattice. */
  #denseHatchRaster(payload: Readonly<Record<string, unknown>>, lines: readonly KJHatchPatternLine[], bounds: readonly [number, number, number, number], color: string, create: boolean, projection?: HatchProjectionIdentity): HatchRaster | null {
    const ratio = this.canvas.width / Math.max(1, this.#width)
    const topLeft = this.worldToScreen([bounds[0], bounds[3]]), bottomRight = this.worldToScreen([bounds[2], bounds[1]])
    const x = Math.max(0, Math.floor(topLeft[0] * ratio)), y = Math.max(0, Math.floor(topLeft[1] * ratio))
    const width = Math.max(0, Math.min(this.canvas.width, Math.ceil(bottomRight[0] * ratio)) - x)
    const height = Math.max(0, Math.min(this.canvas.height, Math.ceil(bottomRight[1] * ratio)) - y)
    const key = [this.camera.centerX, this.camera.centerY, this.camera.scale, this.#width, this.#height, ratio, x, y, width, height, this.context.lineWidth, color, projection?.instanceKey ?? ''].join('|')
    const sourcePayload = projection?.payload ?? payload
    const index = this.#hatchRasterCache.findIndex(entry => entry.payload === sourcePayload && entry.key === key)
    if (index >= 0) {
      const entry = this.#hatchRasterCache.splice(index, 1)[0]!
      this.#hatchRasterCache.push(entry)
      return entry.raster
    }
    if (!create) return null
    const result: HatchRaster = { source: null, x: x / ratio, y: y / ratio, width: width / ratio, height: height / ratio }
    const pixels = width * height
    if (!pixels) return result
    if (!Number.isSafeInteger(pixels) || pixels > HATCH_RASTER_PIXEL_LIMIT || pixels > this.#hatchSamplePixelsRemaining) return { ...result, reason: 'pixel-budget' }
    this.#hatchSamplePixelsRemaining -= pixels
    const source = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : this.canvas.ownerDocument?.createElement('canvas')
    if (!source) return { ...result, reason: 'canvas-unavailable' }
    source.width = width; source.height = height
    const target = source.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!target) return { ...result, reason: 'canvas-unavailable' }
    const data = target.createImageData(width, height)
    const sampler = createHatchStrokeCoverage(lines, this.context.lineWidth / this.camera.scale)
    let reason: KJHatchCoverageReason | undefined
    sampling: for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        let covered = 0
        for (const dy of [.25, .75]) for (const dx of [.25, .75]) {
          if (this.#hatchSampleWorkRemaining < 1) { reason = 'budget'; break sampling }
          const point = this.screenToWorld([(x + column + dx) / ratio, (y + row + dy) / ratio])
          const sample = sampler.sample(point, Math.min(32, this.#hatchSampleWorkRemaining))
          this.#hatchSampleWorkRemaining -= Math.max(1, sample.work)
          if (sample.covered === null) { reason = sample.reason ?? 'budget'; break sampling }
          if (sample.covered) covered++
        }
        const offset = (row * width + column) * 4
        data.data[offset] = data.data[offset + 1] = data.data[offset + 2] = 255
        data.data[offset + 3] = Math.round(255 * covered / 4)
      }
    }
    if (reason) result.reason = reason
    else {
      target.putImageData(data, 0, 0)
      target.globalCompositeOperation = 'source-in'; target.fillStyle = color; target.fillRect(0, 0, width, height)
      result.source = source
    }
    // A per-frame budget failure may succeed in another frame; do not cache it.
    if (reason !== 'budget') {
      this.#hatchRasterCache.push({ payload: sourcePayload, key, raster: result, bytes: result.source ? pixels * 4 : 0 })
      while (this.#hatchRasterCache.length > 8 || this.#hatchRasterCache.reduce((sum, entry) => sum + entry.bytes, 0) > HATCH_RASTER_CACHE_BYTES) this.#hatchRasterCache.shift()
    }
    return result
  }

  #drawEntity(entity: KJReadonlyObjectRecord, color: string, depth: number, overrideColor = false, projection?: HatchProjectionIdentity): boolean {
    if (depth > 12) return false
    const context = this.context, payload = entity.payload
    const view = this.#viewportState
    if (view) {
      if (--this.#viewportWorkRemaining < 0) { view.diagnostic.reason = 'budget'; view.diagnostic.unsupported++; return false }
      if (view.frozen.has(String(payload.layerId ?? ''))) { view.diagnostic.hidden++; return true }
    }
    const layer = this.#previewResources.get(String(payload.layerId ?? '')) ?? this.#document?.getObject(String(payload.layerId ?? ''))
    context.save()
    context.strokeStyle = color
    context.fillStyle = color
    const rawLineweight = finite(payload.lineweight ?? layer?.payload.lineweight, 0)
    const millimeters = rawLineweight > 5 ? rawLineweight / 100 : rawLineweight
    context.lineWidth = this.#selection.has(entity.id) ? 2 : this.#showLineweights && millimeters > 0 ? Math.max(0.5, Math.min(8, millimeters * 96 / 25.4)) : 1
    const transparency = finite(payload.transparency ?? layer?.payload.transparency, 0)
    context.globalAlpha = transparency > 1 ? Math.max(0.05, 1 - transparency / 255) : transparency > 0 ? Math.max(0.05, 1 - transparency) : 1
    const linetypeId = String(payload.linetypeId ?? layer?.payload.linetypeId ?? '')
    const linetype = this.#previewResources.get(linetypeId) ?? this.#document?.getObject(linetypeId)
    const pattern = Array.isArray(linetype?.payload.patternSegments) ? linetype.payload.patternSegments : Array.isArray(linetype?.payload.pattern) ? linetype.payload.pattern : []
    const dash = pattern.map(value => Math.max(1, Math.abs(finite(value)) * this.camera.scale * (view?.scale ?? 1))).filter(value => value > 0)
    context.setLineDash(dash)
    let drawn = true
    if (entity.type === 'LINE') drawn = this.#strokePath(points([payload.start, payload.end]))
    else if (entity.type === 'RAY' || entity.type === 'XLINE') {
      const origin = point2(payload.origin), direction = point2(payload.direction)
      if (!origin || !direction) drawn = false
      else {
        const length = Math.hypot(direction[0], direction[1])
        if (!(length > 0)) drawn = false
        else {
          const p = this.worldToScreen(origin), u: Point2 = [direction[0] / length, -direction[1] / length]
          let lo = entity.type === 'RAY' ? 0 : -Infinity, hi = Infinity
          for (const [axis, extent] of [[0, this.#width], [1, this.#height]] as const) {
            if (u[axis] === 0) { if (p[axis] < 0 || p[axis] > extent) { lo = 1; hi = 0; break } }
            else {
              const a = -p[axis] / u[axis], b = (extent - p[axis]) / u[axis]
              lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b))
            }
          }
          // Exact viewport interval, independent of the distance to the origin.
          // A valid offscreen line is culled, not classified as unsupported.
          if (lo <= hi && Number.isFinite(lo) && Number.isFinite(hi)) {
            const at = (t: number): Point2 => [Math.max(0, Math.min(this.#width, p[0] + u[0] * t)), Math.max(0, Math.min(this.#height, p[1] + u[1] * t))]
            const a = at(lo), b = at(hi)
            const dashCycle = dash.reduce((sum, value) => sum + value, 0) * (dash.length % 2 ? 2 : 1)
            if (dashCycle > 0) context.lineDashOffset = lo % dashCycle
            context.beginPath(); context.moveTo(a[0], a[1]); context.lineTo(b[0], b[1]); context.stroke()
          }
        }
      }
    } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
      const center = point2(payload.center), radius = Math.abs(finite(payload.radius))
      if (!center || !(radius > 0)) drawn = false
      else {
        const start = entity.type === 'ARC' ? finite(payload.startAngle) : 0
        const end = finite(payload.endAngle)
        const sweep = entity.type !== 'ARC' ? Math.PI * 2 : payload.clockwise === true ? -normalizeSweep(end, start) : normalizeSweep(start, end)
        const screen = this.worldToScreen(center)
        context.beginPath(); context.arc(screen[0], screen[1], radius * this.camera.scale, -start, -(start + sweep), sweep > 0); context.stroke()
      }
    } else if (entity.type === 'POINT') {
      const value = point2(payload.position)
      if (!value) drawn = false
      else {
        const screen = this.worldToScreen(value)
        context.beginPath(); context.moveTo(screen[0] - 4, screen[1]); context.lineTo(screen[0] + 4, screen[1])
        context.moveTo(screen[0], screen[1] - 4); context.lineTo(screen[0], screen[1] + 4); context.stroke()
      }
    } else if (['LWPOLYLINE', 'POLYLINE'].includes(entity.type)) drawn = this.#strokePath(polylineSamples(payload), payload.closed === true)
    else if (entity.type === 'ELLIPSE') {
      const center = point2(payload.center), axis = point2(payload.majorAxis)
      if (!center || !axis) drawn = false
      else {
        const radius = Math.hypot(axis[0], axis[1]), ratio = Math.abs(finite(payload.ratio, 1))
        const rotation = Math.atan2(axis[1], axis[0]), start = finite(payload.startParameter), end = finite(payload.endParameter, Math.PI * 2)
        const sweep = normalizeSweep(start, end)
        const screen = this.worldToScreen(center)
        context.beginPath(); context.ellipse(screen[0], screen[1], radius * this.camera.scale, radius * ratio * this.camera.scale, -rotation, -start, -(start + sweep), true); context.stroke()
      }
    } else if (entity.type === 'SPLINE') {
      try { drawn = this.#strokePath(splineSamples(payload), payload.closed === true) }
      catch { drawn = false }
    }
    else if (['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(entity.type)) {
      const position = point2(payload.position)
      if (!position) drawn = false
      else {
        const screen = this.worldToScreen(position)
        context.translate(screen[0], screen[1]); context.rotate(-finite(payload.rotation))
        const screenHeight = Math.max(0.01, Math.abs(finite(payload.height, 2.5) * this.camera.scale))
        context.font = `${screenHeight}px ui-monospace, SFMono-Regular, Consolas, monospace`
        context.textBaseline = 'alphabetic'; context.fillText(String(payload.text ?? payload.defaultValue ?? ''), 0, 0)
      }
    } else if (entity.type === 'HATCH') {
      const loops = Array.isArray(payload.boundaryLoops) ? payload.boundaryLoops : []
      const unsupportedBoundary = loops.some(loop => Array.isArray(loop.edges) && loop.edges.some((edge: Record<string, unknown>) => !['LINE', 'ARC'].includes(String(edge.type).toUpperCase())))
      const paths = loops.map(loop => {
        const value = loop as Record<string, unknown>
        if (Array.isArray(value.vertices)) return polylineSamples({ vertices: value.vertices, closed: true })
        const result: Point2[] = []
        for (const edge of Array.isArray(value.edges) ? value.edges : []) {
          const e = edge as Record<string, unknown>, center = point2(e.center)
          if (center && finite(e.radius) > 0) {
            const a = finite(e.startAngle), b = finite(e.endAngle), clockwise = e.clockwise === true || e.counterClockwise === false
            const sweep = clockwise ? -normalizeSweep(b, a) : normalizeSweep(a, b)
            for (let step = 0; step <= 72; step++) { const angle = a + sweep * step / 72; result.push([center[0] + Math.cos(angle) * finite(e.radius), center[1] + Math.sin(angle) * finite(e.radius)]) }
          } else result.push(...points([e.start, e.end]))
        }
        return result
      }).filter(path => path.length >= 3)
      drawn = paths.length > 0 && !unsupportedBoundary
      if (unsupportedBoundary) this.#hatchDiagnostics.push({ entityId: entity.id, reason: 'unsupported-boundary' })
      if (drawn) {
        context.beginPath()
        for (const path of paths) {
          path.forEach((value, index) => { const p = this.worldToScreen(value); index ? context.lineTo(p[0], p[1]) : context.moveTo(p[0], p[1]) }); context.closePath()
        }
        const patternName = String(payload.patternName ?? 'ANSI31').toUpperCase()
        if (payload.solid === true || patternName === 'SOLID') context.fill('evenodd')
        else {
          try {
            const all = paths.flat(), lower = this.screenToWorld([0, this.#height]), upper = this.screenToWorld([this.#width, 0])
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
            for (const p of all) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]) }
            const bounds = [Math.max(x0, lower[0]), Math.max(y0, lower[1]), Math.min(x1, upper[0]), Math.min(y1, upper[1])] as const
            if (bounds[0] <= bounds[2] && bounds[1] <= bounds[3]) {
              const lines = hatchPatternLines(payload)
              let raster = this.#denseHatchRaster(payload, lines, bounds, color, false, projection)
              const strokes = raster?.source ? { segments: [], dots: [], limited: true, work: 0 } : this.#hatchWorkRemaining > 0 ? hatchStrokes(lines, bounds, Math.min(20000, this.#hatchWorkRemaining)) : { segments: [], dots: [], limited: true, work: 0 }
              this.#hatchWorkRemaining -= strokes.work
              if (strokes.limited && !raster) raster = this.#denseHatchRaster(payload, lines, bounds, color, true, projection)
              context.clip('evenodd'); context.setLineDash([]); context.lineCap = 'butt'
              if (raster?.source) {
                context.imageSmoothingEnabled = false
                context.drawImage(raster.source, raster.x, raster.y, raster.width, raster.height)
              } else {
                context.beginPath()
                for (const [a, b] of strokes.segments) { const p = this.worldToScreen(a), q = this.worldToScreen(b); context.moveTo(p[0], p[1]); context.lineTo(q[0], q[1]) }
                context.stroke()
                context.beginPath()
                for (const dot of strokes.dots) { const p = this.worldToScreen(dot), radius = Math.max(.75, context.lineWidth / 2); context.moveTo(p[0] + radius, p[1]); context.arc(p[0], p[1], radius, 0, Math.PI * 2) }
                context.fill()
                if (strokes.limited) this.#hatchDiagnostics.push({ entityId: entity.id, reason: 'budget', ...(raster?.reason ? { samplingReason: raster.reason } : {}) })
              }
            }
          } catch {
            context.stroke(); drawn = false
            this.#hatchDiagnostics.push({ entityId: entity.id, reason: 'unsupported-pattern' })
          }
        }
      }
    } else if (entity.type === 'DIMENSION') {
      const projected = projection?.dimension ?? projectDimension(payload, this.#document?.getObject(String(payload.styleId ?? ''))?.payload)
      drawn = projected !== null
      if (projected) {
        for (const segment of projected.lines) this.#strokePath(segment)
        for (const arrow of projected.arrows) { this.#strokePath(arrow, true); context.fill() }
        const label = projected.label, screen = this.worldToScreen(label.position)
        context.translate(screen[0], screen[1]); context.rotate(-label.rotation)
        context.font = `${Math.max(.01, label.height * this.camera.scale)}px "Segoe UI", "Microsoft YaHei", sans-serif`
        context.textAlign = 'center'; context.textBaseline = 'bottom'
        context.fillText(label.text, 0, 0)
      }
    } else if (['LEADER', 'MLEADER'].includes(entity.type)) {
      const values = points(Array.isArray(payload.vertices) && payload.vertices.length ? payload.vertices : payload.definitionPoints)
      drawn = this.#strokePath(values)
      const position = point2(payload.textPosition)
      if (position) {
        const screen = this.worldToScreen(position)
        const text = payload.textOverride ?? (payload.measurement == null ? '' : finite(payload.measurement).toFixed(2))
        context.fillText(String(text), screen[0], screen[1])
      }
    } else if (['SOLID', 'TRACE', 'WIPEOUT', 'REVISION_CLOUD'].includes(entity.type)) {
      const values = points(payload.vertices)
      drawn = this.#strokePath(values, true)
      if (drawn) { context.globalAlpha = 0.12; context.fill(); context.globalAlpha = 1 }
    } else if (entity.type === 'VIEWPORT') {
      const center = point2(payload.center), width = Math.abs(finite(payload.width)), height = Math.abs(finite(payload.height))
      if (!center || !width || !height) drawn = false
      else {
        drawn = this.#drawViewport(entity, depth)
        const screen = this.worldToScreen([center[0] - width / 2, center[1] + height / 2])
        context.strokeRect(screen[0], screen[1], width * this.camera.scale, height * this.camera.scale)
      }
    } else if (entity.type === 'TABLE') {
      const position = point2(payload.position)
      const columnWidths = Array.isArray(payload.columnWidths) ? payload.columnWidths.map(value => Math.abs(finite(value))) : []
      const rowHeights = Array.isArray(payload.rowHeights) ? payload.rowHeights.map(value => Math.abs(finite(value))) : []
      if (!position || !columnWidths.length || !rowHeights.length) drawn = false
      else {
        const totalWidth = columnWidths.reduce((sum, value) => sum + value, 0), totalHeight = rowHeights.reduce((sum, value) => sum + value, 0)
        const topLeft = this.worldToScreen([position[0], position[1]])
        context.strokeRect(topLeft[0], topLeft[1], totalWidth * this.camera.scale, totalHeight * this.camera.scale)
        let cursor = 0
        for (const width of columnWidths.slice(0, -1)) { cursor += width; const x = topLeft[0] + cursor * this.camera.scale; context.beginPath(); context.moveTo(x, topLeft[1]); context.lineTo(x, topLeft[1] + totalHeight * this.camera.scale); context.stroke() }
        cursor = 0
        for (const height of rowHeights.slice(0, -1)) { cursor += height; const y = topLeft[1] + cursor * this.camera.scale; context.beginPath(); context.moveTo(topLeft[0], y); context.lineTo(topLeft[0] + totalWidth * this.camera.scale, y); context.stroke() }
      }
    } else if (entity.type === 'IMAGE') {
      const position = point2(payload.position), width = Math.abs(finite(payload.width, 20)), height = Math.abs(finite(payload.height, 12))
      if (!position) drawn = false
      else {
        const topLeft = this.worldToScreen([position[0], position[1] + height])
        context.setLineDash([5, 4]); context.strokeRect(topLeft[0], topLeft[1], width * this.camera.scale, height * this.camera.scale)
        context.beginPath(); context.moveTo(topLeft[0], topLeft[1]); context.lineTo(topLeft[0] + width * this.camera.scale, topLeft[1] + height * this.camera.scale)
        context.moveTo(topLeft[0] + width * this.camera.scale, topLeft[1]); context.lineTo(topLeft[0], topLeft[1] + height * this.camera.scale); context.stroke()
      }
    } else if (entity.type === 'INSERT') {
      const blockRecordId = String(payload.blockRecordId ?? '')
      const block = this.#document?.getObject(blockRecordId)
      const position = point2(payload.position), base = point2(block?.payload.basePoint) ?? [0, 0]
      if (!block || !position) drawn = false
      else {
        const inputScale = Array.isArray(payload.scale) ? payload.scale : [payload.scale ?? 1, payload.scale ?? 1]
        const factorX = finite(inputScale[0], 1), factorY = finite(inputScale[1], factorX)
        const matrix = multiply3(
          translation3(position[0], position[1]),
          multiply3(rotation3(finite(payload.rotation)), multiply3(scale3(factorX, factorY), translation3(-base[0], -base[1]))),
        )
        const children = this.#document?.listEntities({ ownerId: blockRecordId }) ?? []
        drawn = children.length > 0
        for (const child of children) {
          if (view && this.#viewportWorkRemaining-- <= 0) { view.diagnostic.reason = 'budget'; drawn = false; break }
          const childLayer = this.#document?.getObject(String(child.payload.layerId ?? ''))
          if (child.payload.visible === false || childLayer?.payload.visible === false || childLayer?.payload.frozen === true) continue
          try {
            const transformed = { ...child, payload: transformEntityPayload(child.type, structuredClone(child.payload) as KJObjectPayload, matrix) }
            const byBlock = child.payload.trueColor == null && (child.payload.color === 0 || /^byblock$/i.test(String(child.payload.color)))
            const effectiveLayer = childLayer?.name === '0' ? layer?.payload : childLayer?.payload
            const childColor = overrideColor || byBlock ? color : this.#color(child, effectiveLayer)
            // Transformed payloads are transient. Preserve the immutable source and
            // complete matrix chain (bounded by recursion depth, without input IDs)
            // so separate inserts cannot share a stale phase or recompute each frame.
            const identity = { payload: child.payload, instanceKey: `${projection?.instanceKey ?? ''};${matrix.join(',')}`, ...(child.type === 'DIMENSION' && view ? { dimension: this.#dimensionInView(child, matrix) } : {}) }
            if (!this.#drawEntity(transformed, childColor, depth + 1, overrideColor, identity)) drawn = false
          } catch { drawn = false }
        }
      }
    } else if (entity.type === 'SOLID3D') {
      const values = points(payload.vertices)
      if (values.length < 2) drawn = false
      else {
        const minX = Math.min(...values.map(value => value[0])), maxX = Math.max(...values.map(value => value[0]))
        const minY = Math.min(...values.map(value => value[1])), maxY = Math.max(...values.map(value => value[1]))
        drawn = this.#strokePath([[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]], true)
      }
    } else drawn = false
    context.restore()
    if (view && entity.type !== 'INSERT') {
      if (drawn) { view.diagnostic.rendered++; if (APPROXIMATE_TYPES.has(entity.type)) view.diagnostic.approximated++ }
      else view.diagnostic.unsupported++
    }
    return drawn
  }

  /** Project annotation graphics after native measurement, so a 1:100 viewport never
   * changes a model dimension's displayed value from 100 to 1. */
  #dimensionInView(entity: KJReadonlyObjectRecord, matrix: readonly number[]): ReturnType<typeof projectDimension> {
    const original = projectDimension(entity.payload, this.#document?.getObject(String(entity.payload.styleId ?? ''))?.payload)
    if (!original) return null
    const point = (p: Point2): Point2 => [matrix[0]! * p[0] + matrix[2]! * p[1] + matrix[4]!, matrix[1]! * p[0] + matrix[3]! * p[1] + matrix[5]!]
    return { ...original, lines: original.lines.map(([a, b]) => [point(a), point(b)]), arrows: original.arrows.map(arrow => arrow.map(point)), label: { ...original.label, position: point(original.label.position), height: original.label.height * Math.hypot(matrix[0]!, matrix[1]!), rotation: original.label.rotation + Math.atan2(matrix[1]!, matrix[0]!) } }
  }

  #drawViewport(entity: KJReadonlyObjectRecord, depth: number): boolean {
    if (this.#viewportState) return false // Never recurse through model-space viewport records.
    const diagnostic: KJCanvasViewportDiagnostic = { entityId: entity.id, rendered: 0, hidden: 0, approximated: 0, unsupported: 0 }
    this.#viewportDiagnostics.push(diagnostic)
    const document = this.#document, p = entity.payload, center = point2(p.center), viewCenter = point2(p.viewCenter)
    const width = finite(p.width), height = finite(p.height), viewHeight = finite(p.viewHeight), twist = finite(p.twistAngle)
    if (!document || entity.ownerId === document.snapshot().spaces.modelSpaceId || entity.ownerId !== this.#activeSpaceId()) { diagnostic.reason = 'not-paper-space'; return false }
    if (!center || !viewCenter || width <= 0 || height <= 0 || viewHeight <= 0 || !Number.isFinite(height / viewHeight)) { diagnostic.reason = 'invalid-view'; return false }
    // The current native contract is orthographic XY with a rectangular clip. Reject
    // explicitly supplied advanced view controls rather than drawing a false top view.
    const target = p.viewTarget == null ? [0, 0] : point2(p.viewTarget)
    const direction = p.viewDirection
    const topView = direction == null || Array.isArray(direction) && direction[0] === 0 && direction[1] === 0 && direction[2] === 1
    const flags = finite(p.flags)
    // Native status -1 is ON but off-screen or beyond the saved host's MAXACTVP.
    // A new paper camera must be able to reveal it after fit/pan.
    if (p.status === 0 || (flags & 0x20000) !== 0 || p.viewportId === 1) { diagnostic.hidden++; return true }
    if (p.perspective === true || p.clipBoundaryId || p.clippingBoundaryId || !target || !topView || p.nonRectangularClip === true || (flags & (0x1 | 0x2 | 0x4 | 0x10 | 0x10000)) !== 0 || Array.isArray(p.unresolvedViewportReferences) && p.unresolvedViewportReferences.length > 0) { diagnostic.reason = 'unsupported-view'; return false }
    const scale = height / viewHeight
    // DXF viewCenter is in display coordinates, after twist, not a WCS pivot.
    // This matches the native top-view model-to-paper transformation independently
    // checked against ezdxf: P - scale*DCScenter + scale*R(twist)*(WCS-target).
    const matrix = multiply3(translation3(center[0] - scale * viewCenter[0], center[1] - scale * viewCenter[1]), multiply3(scale3(scale), multiply3(rotation3(twist), translation3(-target[0]!, -target[1]!))))
    if (!matrix.every(Number.isFinite)) { diagnostic.reason = 'invalid-view'; return false }
    const context = this.context, corners: Point2[] = [[center[0] - width / 2, center[1] - height / 2], [center[0] + width / 2, center[1] - height / 2], [center[0] + width / 2, center[1] + height / 2], [center[0] - width / 2, center[1] + height / 2]]
    context.save()
    const previous = this.#viewportState
    this.#viewportState = { frozen: new Set(Array.isArray(p.frozenLayerIds) ? p.frozenLayerIds.map(String) : []), scale, diagnostic }
    let complete = true
    try {
      context.beginPath()
      corners.forEach((point, i) => { const screen = this.worldToScreen(point); i ? context.lineTo(...screen) : context.moveTo(...screen) })
      context.closePath(); context.clip()
      const query = { document, spaceId: document.snapshot().spaces.modelSpaceId }
      for (const model of this.#sceneProvider?.listEntities(query) ?? document.listEntities({ ownerId: query.spaceId })) {
        if (this.#viewportWorkRemaining <= 0) { diagnostic.reason = 'budget'; complete = false; break }
        this.#viewportWorkRemaining--
        if (model.ownerId !== query.spaceId) continue
        const layer = document.getObject(String(model.payload.layerId ?? ''))?.payload
        if (model.payload.visible === false || layer?.visible === false || layer?.frozen === true || this.#viewportState.frozen.has(String(model.payload.layerId ?? ''))) { diagnostic.hidden++; continue }
        try {
          const transformed = { ...model, payload: transformEntityPayload(model.type, structuredClone(model.payload) as KJObjectPayload, matrix) }
          const identity: HatchProjectionIdentity = { payload: model.payload, instanceKey: `viewport:${entity.id};${matrix.join(',')}`, ...(model.type === 'DIMENSION' ? { dimension: this.#dimensionInView(model, matrix) } : {}) }
          const before = diagnostic.unsupported
          if (!this.#drawEntity(transformed, this.#color(model, layer), depth + 1, false, identity)) { complete = false; if (diagnostic.unsupported === before) diagnostic.unsupported++ }
        } catch { diagnostic.unsupported++; complete = false }
      }
    } finally { this.#viewportState = previous; context.restore() }
    return complete
  }
}
