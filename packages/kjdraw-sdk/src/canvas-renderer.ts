import {
  multiply3,
  rotation3,
  scale3,
  transformEntityPayload,
  translation3,
} from './geometry/index.js'
import { nearestPointOnEntity2 } from './snapping.js'
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

export interface KJCanvasHit {
  entity: KJReadonlyObjectRecord
  distance: number
  point: readonly [number, number, number]
}

type Point2 = readonly [number, number]
type Point3 = readonly [number, number, number]

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
    output.push(...points((loop as { vertices?: unknown }).vertices))
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
    this.#width = Math.max(1, finite(width, rect.width || this.canvas.clientWidth || 1))
    this.#height = Math.max(1, finite(height, rect.height || this.canvas.clientHeight || 1))
    const ratio = this.#pixelRatio ?? Math.max(1, globalThis.devicePixelRatio || 1)
    const targetWidth = Math.max(1, Math.round(this.#width * ratio))
    const targetHeight = Math.max(1, Math.round(this.#height * ratio))
    if (this.canvas.width !== targetWidth) this.canvas.width = targetWidth
    if (this.canvas.height !== targetHeight) this.canvas.height = targetHeight
    if (keepFitted && this.#document) return this.fit()
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
    const values = this.#entities()
      .filter(entity => {
        const layer = layers.get(String(entity.payload.layerId ?? ''))
        return layer?.visible !== false && layer?.frozen !== true
      })
      .flatMap(entity => this.#fitPoints(entity))
    if (!values.length) {
      this.camera.centerX = 50
      this.camera.centerY = 40
      this.camera.scale = 4
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

  hitTest(screenPoint: Point2, tolerancePixels = 8): KJCanvasHit | null {
    const document = this.#document
    if (!document) return null
    const point = this.screenToWorld(screenPoint)
    const layers = new Map(document.getTable('layers')?.records.map(layer => [layer.id, layer.payload]) ?? [])
    let best: KJCanvasHit | null = null
    const radius = tolerancePixels / this.camera.scale
    const query = { document, spaceId: this.#activeSpaceId(), point, radius }
    const candidates = this.#sceneProvider?.hitCandidates?.(query) ?? this.#entities()
    for (const entity of candidates) {
      const layer = layers.get(String(entity.payload.layerId ?? ''))
      if (layer?.visible === false || layer?.frozen === true) continue
      try {
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

  render(): Readonly<KJCanvasRenderReport> {
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
      if (layer?.visible === false || layer?.frozen === true) { hidden += 1; continue }
      const color = this.#selection.has(entity.id)
        ? this.#selectionColor ?? (this.#theme === 'dark' ? '#b9ff72' : '#0b67e3')
        : this.#color(entity, layer) ?? palette[colorIndex(layer?.color)]!
      if (this.#drawEntity(entity, color, 0)) {
        rendered += 1
        if (APPROXIMATE_TYPES.has(entity.type)) { approximated += 1; approximateTypes.add(entity.type) }
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
      width: this.#width,
      height: this.#height,
      scale: this.camera.scale,
    })
    return this.#report
  }

  dispose(): void {
    this.#disposeDocument?.()
    this.#disposeDocument = null
    this.#observer?.disconnect()
    this.#observer = null
    this.#document = null
    this.#selection.clear()
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

  #fitPoints(entity: KJReadonlyObjectRecord, depth = 0): Point2[] {
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
      if (layer?.visible === false || layer?.frozen === true) continue
      try { output.push(...this.#fitPoints({ ...child, payload: transformEntityPayload(child.type, structuredClone(child.payload) as KJObjectPayload, matrix) }, depth + 1)) }
      catch { output.push(position) }
    }
    return output.length ? output : [position]
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

  #drawEntity(entity: KJReadonlyObjectRecord, color: string, depth: number): boolean {
    if (depth > 12) return false
    const context = this.context, payload = entity.payload
    const layer = this.#document?.getObject(String(payload.layerId ?? ''))
    context.save()
    context.strokeStyle = color
    context.fillStyle = color
    const rawLineweight = finite(payload.lineweight ?? layer?.payload.lineweight, 0)
    const millimeters = rawLineweight > 5 ? rawLineweight / 100 : rawLineweight
    context.lineWidth = this.#selection.has(entity.id) ? 2 : this.#showLineweights && millimeters > 0 ? Math.max(0.5, Math.min(8, millimeters * 96 / 25.4)) : 1
    const transparency = finite(payload.transparency ?? layer?.payload.transparency, 0)
    context.globalAlpha = transparency > 1 ? Math.max(0.05, 1 - transparency / 255) : transparency > 0 ? Math.max(0.05, 1 - transparency) : 1
    const linetype = this.#document?.getObject(String(payload.linetypeId ?? layer?.payload.linetypeId ?? ''))
    const pattern = Array.isArray(linetype?.payload.patternSegments) ? linetype.payload.patternSegments : Array.isArray(linetype?.payload.pattern) ? linetype.payload.pattern : []
    const dash = pattern.map(value => Math.max(1, Math.abs(finite(value)) * this.camera.scale)).filter(value => value > 0)
    context.setLineDash(dash)
    let drawn = true
    if (entity.type === 'LINE') drawn = this.#strokePath(points([payload.start, payload.end]))
    else if (entity.type === 'RAY' || entity.type === 'XLINE') {
      const origin = point2(payload.origin), direction = point2(payload.direction)
      if (!origin || !direction) drawn = false
      else {
        const length = Math.hypot(direction[0], direction[1]) || 1
        const span = Math.max(this.#width, this.#height) * 2 / this.camera.scale
        const delta: Point2 = [direction[0] / length * span, direction[1] / length * span]
        const start: Point2 = entity.type === 'XLINE' ? [origin[0] - delta[0], origin[1] - delta[1]] : origin
        drawn = this.#strokePath([start, [origin[0] + delta[0], origin[1] + delta[1]]])
      }
    } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
      const center = point2(payload.center), radius = Math.abs(finite(payload.radius))
      if (!center || !(radius > 0)) drawn = false
      else {
        const start = entity.type === 'ARC' ? finite(payload.startAngle) : 0
        const sweep = entity.type === 'ARC' ? normalizeSweep(start, finite(payload.endAngle)) : Math.PI * 2
        const segments = Math.max(32, Math.ceil(sweep / (Math.PI / 36)))
        drawn = this.#strokePath(Array.from({ length: segments + 1 }, (_, index) => {
          const angle = start + sweep * index / segments
          return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius] as Point2
        }), entity.type === 'CIRCLE')
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
        drawn = this.#strokePath(Array.from({ length: 73 }, (_, index) => {
          const parameter = start + sweep * index / 72
          const x = Math.cos(parameter) * radius, y = Math.sin(parameter) * radius * ratio
          return [center[0] + x * Math.cos(rotation) - y * Math.sin(rotation), center[1] + x * Math.sin(rotation) + y * Math.cos(rotation)] as Point2
        }), sweep >= Math.PI * 2 - 1e-8)
      }
    } else if (entity.type === 'SPLINE') drawn = this.#strokePath(points(Array.isArray(payload.fitPoints) && payload.fitPoints.length ? payload.fitPoints : payload.controlPoints))
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
      drawn = loops.length > 0
      for (const loop of loops) {
        const values = points((loop as { vertices?: unknown }).vertices)
        if (!values.length) continue
        this.#strokePath(values, true)
        context.globalAlpha = payload.solid === true ? 0.16 : 0.07
        context.fill(); context.globalAlpha = 1
      }
    } else if (['LEADER', 'MLEADER', 'DIMENSION'].includes(entity.type)) {
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
          try {
            const transformed = { ...child, payload: transformEntityPayload(child.type, structuredClone(child.payload) as KJObjectPayload, matrix) }
            this.#drawEntity(transformed, color, depth + 1)
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
    return drawn
  }
}
