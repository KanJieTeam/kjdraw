import { KJValidationError } from './errors.js'
import type { KJStandardEntityType } from './constants.js'
import type { KJObjectPayload, KJObjectSpec } from './schema.js'

export type KJDraftPoint = readonly [number, number]

export type KJDraftTool =
  | 'line'
  | 'polyline'
  | 'circle'
  | 'arc'
  | 'ellipse'
  | 'rectangle'
  | 'polygon'
  | 'point'
  | 'ray'
  | 'xline'
  | 'spline'
  | 'hatch'
  | 'dimension'

export type KJDraftCircleMode = 'center-radius' | '2-point' | '3-point'
export type KJDraftArcMode = 'center-start-end' | '3-point'
export type KJDraftDimensionType = 'ALIGNED' | 'ROTATED' | 'RADIUS' | 'DIAMETER'
export type KJDraftStatus = 'collecting' | 'complete' | 'cancelled'
export type KJDraftPointRole =
  | 'start'
  | 'end'
  | 'vertex'
  | 'position'
  | 'origin'
  | 'directionPoint'
  | 'center'
  | 'radiusPoint'
  | 'diameterPoint1'
  | 'diameterPoint2'
  | 'throughPoint'
  | 'majorAxisPoint'
  | 'minorAxisPoint'
  | 'firstCorner'
  | 'oppositeCorner'
  | 'controlPoint'
  | 'boundaryPoint'
  | 'extensionOrigin1'
  | 'extensionOrigin2'
  | 'placement'
  | 'oppositePoint'
  | 'pointOnCircle'

export interface KJDraftEntitySpec {
  type: KJStandardEntityType
  payload: KJObjectPayload
  options?: KJObjectSpec
}

export interface KJDraftingOptions {
  circleMode?: KJDraftCircleMode
  arcMode?: KJDraftArcMode
  sides?: number
  splineDegree?: number
  dimensionType?: KJDraftDimensionType
  rotation?: number
  textPosition?: KJDraftPoint
  textOverride?: string | null
  textHeight?: number
  styleName?: string
  patternName?: string
  patternScale?: number
  patternAngle?: number
  solid?: boolean
  payload?: KJObjectPayload
  entityOptions?: KJObjectSpec
  tolerance?: number
}

export interface KJDraftState {
  tool: KJDraftTool
  status: KJDraftStatus
  points: readonly KJDraftPoint[]
  minimumPoints: number
  maximumPoints: number | null
  nextPoint: KJDraftPointRole | null
  canFinish: boolean
  canClose: boolean
}

interface NormalizedOptions {
  circleMode: KJDraftCircleMode
  arcMode: KJDraftArcMode
  sides: number
  splineDegree: number
  dimensionType: KJDraftDimensionType
  rotation: number
  textPosition: KJDraftPoint | null
  textOverride: string | null
  textHeight: number | null
  styleName: string
  patternName: string
  patternScale: number
  patternAngle: number
  solid: boolean
  payload: KJObjectPayload
  entityOptions: KJObjectSpec | null
  tolerance: number
}

const TOOLS = new Set<KJDraftTool>(['line', 'polyline', 'circle', 'arc', 'ellipse', 'rectangle', 'polygon', 'point', 'ray', 'xline', 'spline', 'hatch', 'dimension'])
const CIRCLE_MODES = new Set<KJDraftCircleMode>(['center-radius', '2-point', '3-point'])
const ARC_MODES = new Set<KJDraftArcMode>(['center-start-end', '3-point'])
const DIMENSION_TYPES = new Set<KJDraftDimensionType>(['ALIGNED', 'ROTATED', 'RADIUS', 'DIAMETER'])
const TAU = Math.PI * 2

function finite(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new KJValidationError(`${label} must be finite`)
  return number
}

function positive(value: unknown, label: string): number {
  const number = finite(value, label)
  if (!(number > 0)) throw new KJValidationError(`${label} must be positive`)
  return number
}

function point2(value: unknown, label = 'point'): KJDraftPoint {
  if (!Array.isArray(value) || value.length < 2) throw new KJValidationError(`${label} must contain x and y`)
  return [finite(value[0], `${label}.x`), finite(value[1], `${label}.y`)]
}

function point3(value: KJDraftPoint): [number, number, number] { return [value[0], value[1], 0] }
function distance(a: KJDraftPoint, b: KJDraftPoint): number { return Math.hypot(b[0] - a[0], b[1] - a[1]) }
function near(a: KJDraftPoint, b: KJDraftPoint, tolerance: number): boolean { return distance(a, b) <= tolerance }
function normalizedAngle(value: number): number { const angle = value % TAU; return angle < 0 ? angle + TAU : angle }
function ccwDelta(start: number, end: number): number { return normalizedAngle(end - start) }

function requireDistinct(a: KJDraftPoint, b: KJDraftPoint, tolerance: number, label: string): void {
  if (near(a, b, tolerance)) throw new KJValidationError(`${label} is degenerate`)
}

function requirePoints(points: readonly KJDraftPoint[], count: number, label: string): void {
  if (points.length < count) throw new KJValidationError(`${label} requires at least ${count} points`)
}

function clampedKnots(controlPointCount: number, degree: number): number[] {
  const last = controlPointCount - degree
  return Array.from({ length: controlPointCount + degree + 1 }, (_, index) => {
    if (index <= degree) return 0
    if (index >= controlPointCount) return last
    return index - degree
  })
}

function circumcircle(points: readonly [KJDraftPoint, KJDraftPoint, KJDraftPoint], tolerance: number): { center: KJDraftPoint; radius: number } {
  const [a, b, c] = points
  requireDistinct(a, b, tolerance, 'Circle points')
  requireDistinct(b, c, tolerance, 'Circle points')
  requireDistinct(a, c, tolerance, 'Circle points')
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - a[0], vy = c[1] - a[1]
  const denominator = 2 * (ux * vy - uy * vx)
  const scale = Math.max(1, Math.hypot(ux, uy) * Math.hypot(vx, vy))
  if (Math.abs(denominator) <= tolerance * scale) throw new KJValidationError('Three-point circle or arc cannot use collinear points')
  const u2 = ux * ux + uy * uy, v2 = vx * vx + vy * vy
  const center: KJDraftPoint = [a[0] + (vy * u2 - uy * v2) / denominator, a[1] + (ux * v2 - vx * u2) / denominator]
  return { center, radius: distance(center, a) }
}

function withoutClosingDuplicate(points: readonly KJDraftPoint[], tolerance: number): KJDraftPoint[] {
  const output = points.map(value => point2(value))
  if (output.length > 1 && near(output[0]!, output.at(-1)!, tolerance)) output.pop()
  return output
}

function polygonAreaTwice(points: readonly KJDraftPoint[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]!
    return area + point[0] * next[1] - next[0] * point[1]
  }, 0)
}

function validateClosedBoundary(points: readonly KJDraftPoint[], tolerance: number, label: string): KJDraftPoint[] {
  const output = withoutClosingDuplicate(points, tolerance)
  requirePoints(output, 3, label)
  const xs = output.map(point => point[0]), ys = output.map(point => point[1])
  const scale = Math.max(1, (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)))
  if (Math.abs(polygonAreaTwice(output)) <= tolerance * scale) throw new KJValidationError(`${label} boundary is degenerate`)
  return output
}

function normalizeOptions(options: KJDraftingOptions): NormalizedOptions {
  const circleMode = options.circleMode ?? 'center-radius'
  if (!CIRCLE_MODES.has(circleMode)) throw new KJValidationError(`Unsupported circle mode: ${String(circleMode)}`)
  const arcMode = options.arcMode ?? 'center-start-end'
  if (!ARC_MODES.has(arcMode)) throw new KJValidationError(`Unsupported arc mode: ${String(arcMode)}`)
  const dimensionType = String(options.dimensionType ?? 'ALIGNED').toUpperCase() as KJDraftDimensionType
  if (!DIMENSION_TYPES.has(dimensionType)) throw new KJValidationError(`Unsupported dimension type: ${String(options.dimensionType)}`)
  const sides = Number(options.sides ?? 6)
  if (!Number.isInteger(sides) || sides < 3 || sides > 1024) throw new KJValidationError('Polygon sides must be an integer from 3 to 1024')
  const splineDegree = Number(options.splineDegree ?? 3)
  if (!Number.isInteger(splineDegree) || splineDegree < 1 || splineDegree > 10) throw new KJValidationError('Spline degree must be an integer from 1 to 10')
  const tolerance = positive(options.tolerance ?? 1e-9, 'tolerance')
  const rotation = finite(options.rotation ?? 0, 'rotation')
  const textHeight = options.textHeight == null ? null : positive(options.textHeight, 'textHeight')
  const patternScale = positive(options.patternScale ?? 1, 'patternScale')
  const patternAngle = finite(options.patternAngle ?? 0, 'patternAngle')
  const patternName = String(options.patternName ?? 'SOLID').trim().toUpperCase()
  if (!patternName) throw new KJValidationError('patternName cannot be empty')
  const styleName = String(options.styleName ?? 'STANDARD').trim()
  if (!styleName) throw new KJValidationError('styleName cannot be empty')
  return {
    circleMode,
    arcMode,
    sides,
    splineDegree,
    dimensionType,
    rotation,
    textPosition: options.textPosition == null ? null : point2(options.textPosition, 'textPosition'),
    textOverride: options.textOverride == null ? null : String(options.textOverride),
    textHeight,
    styleName,
    patternName,
    patternScale,
    patternAngle,
    solid: options.solid ?? patternName === 'SOLID',
    payload: { ...(options.payload ?? {}) },
    entityOptions: options.entityOptions == null ? null : { ...options.entityOptions },
    tolerance,
  }
}

function pointCounts(tool: KJDraftTool, options: NormalizedOptions): { minimum: number; maximum: number | null } {
  if (tool === 'point') return { minimum: 1, maximum: 1 }
  if (tool === 'polyline') return { minimum: 2, maximum: null }
  if (tool === 'spline') return { minimum: options.splineDegree + 1, maximum: null }
  if (tool === 'hatch') return { minimum: 3, maximum: null }
  if (tool === 'circle') { const count = options.circleMode === '3-point' ? 3 : 2; return { minimum: count, maximum: count } }
  if (tool === 'arc' || tool === 'ellipse') return { minimum: 3, maximum: 3 }
  if (tool === 'dimension') { const count = ['ALIGNED', 'ROTATED'].includes(options.dimensionType) ? 3 : 2; return { minimum: count, maximum: count } }
  return { minimum: 2, maximum: 2 }
}

function nextPointRole(tool: KJDraftTool, count: number, options: NormalizedOptions): KJDraftPointRole {
  if (tool === 'line') return count === 0 ? 'start' : 'end'
  if (tool === 'polyline') return 'vertex'
  if (tool === 'point') return 'position'
  if (tool === 'ray' || tool === 'xline') return count === 0 ? 'origin' : 'directionPoint'
  if (tool === 'rectangle') return count === 0 ? 'firstCorner' : 'oppositeCorner'
  if (tool === 'polygon') return count === 0 ? 'center' : 'vertex'
  if (tool === 'spline') return 'controlPoint'
  if (tool === 'hatch') return 'boundaryPoint'
  if (tool === 'ellipse') return (['center', 'majorAxisPoint', 'minorAxisPoint'] as const)[Math.min(count, 2)]!
  if (tool === 'arc') return options.arcMode === '3-point'
    ? (['start', 'throughPoint', 'end'] as const)[Math.min(count, 2)]!
    : (['center', 'start', 'end'] as const)[Math.min(count, 2)]!
  if (tool === 'circle') {
    if (options.circleMode === 'center-radius') return count === 0 ? 'center' : 'radiusPoint'
    if (options.circleMode === '2-point') return count === 0 ? 'diameterPoint1' : 'diameterPoint2'
    return (['start', 'throughPoint', 'end'] as const)[Math.min(count, 2)]!
  }
  if (options.dimensionType === 'ALIGNED' || options.dimensionType === 'ROTATED') return (['extensionOrigin1', 'extensionOrigin2', 'placement'] as const)[Math.min(count, 2)]!
  if (options.dimensionType === 'RADIUS') return count === 0 ? 'center' : 'pointOnCircle'
  return count === 0 ? 'oppositePoint' : 'pointOnCircle'
}

/** Parse CAD coordinates. Polar angles use degrees and increase counter-clockwise. */
export function parseDraftCoordinate(input: string, relativeBase?: KJDraftPoint): KJDraftPoint {
  const source = String(input).trim()
  if (!source) throw new KJValidationError('Coordinate cannot be empty')
  const relative = source.startsWith('@')
  const value = relative ? source.slice(1).trim() : source
  const base = relative ? point2(relativeBase, 'relativeBase') : ([0, 0] as const)
  if (value.includes('<')) {
    if (!relative) throw new KJValidationError('Polar coordinates must use @distance<angle')
    const pieces = value.split('<')
    if (pieces.length !== 2 || pieces.some(piece => !piece.trim())) throw new KJValidationError('Polar coordinate must use @distance<angle')
    const length = finite(pieces[0], 'distance')
    if (length < 0) throw new KJValidationError('distance must be non-negative')
    const radians = finite(pieces[1], 'angle') * Math.PI / 180
    return [base[0] + Math.cos(radians) * length, base[1] + Math.sin(radians) * length]
  }
  const pieces = value.split(',')
  if (pieces.length !== 2 || pieces.some(piece => !piece.trim())) throw new KJValidationError('Coordinate must use x,y or @dx,dy')
  const result: KJDraftPoint = [finite(pieces[0], relative ? 'dx' : 'x'), finite(pieces[1], relative ? 'dy' : 'y')]
  return relative ? [base[0] + result[0], base[1] + result[1]] : result
}

export class KJDraftingSession {
  readonly tool: KJDraftTool
  #options: NormalizedOptions
  #points: KJDraftPoint[] = []
  #status: KJDraftStatus = 'collecting'
  #result: KJDraftEntitySpec | null = null

  constructor(tool: KJDraftTool, options: KJDraftingOptions = {}) {
    if (!TOOLS.has(tool)) throw new KJValidationError(`Unsupported drafting tool: ${String(tool)}`)
    this.tool = tool
    this.#options = normalizeOptions(options)
  }

  get points(): readonly KJDraftPoint[] { return this.#points.map(point => [point[0], point[1]] as const) }

  get state(): KJDraftState {
    const { minimum, maximum } = pointCounts(this.tool, this.#options)
    const collecting = this.#status === 'collecting'
    const closable = ['polyline', 'spline', 'hatch'].includes(this.tool)
    return {
      tool: this.tool,
      status: this.#status,
      points: this.points,
      minimumPoints: minimum,
      maximumPoints: maximum,
      nextPoint: collecting ? nextPointRole(this.tool, this.#points.length, this.#options) : null,
      canFinish: collecting && this.#points.length >= minimum,
      canClose: collecting && closable && this.#points.length >= (this.tool === 'spline' ? Math.max(3, minimum - 1) : 3),
    }
  }

  addPoint(value: KJDraftPoint): KJDraftEntitySpec | null {
    this.#assertCollecting()
    const { maximum } = pointCounts(this.tool, this.#options)
    if (maximum !== null && this.#points.length >= maximum) throw new KJValidationError(`${this.tool} already has all required points`)
    const point = point2(value, `points[${this.#points.length}]`)
    const previous = this.#points.at(-1)
    if (previous && near(previous, point, this.#options.tolerance)) throw new KJValidationError('Consecutive draft points must be distinct')
    this.#points.push(point)
    if (maximum === null || this.#points.length !== maximum) return null
    try { return this.#complete(this.#build(this.#points, false)) }
    catch (error) { this.#points.pop(); throw error }
  }

  addCoordinate(input: string, relativeBase: KJDraftPoint | undefined = this.#points.at(-1)): KJDraftEntitySpec | null {
    return this.addPoint(parseDraftCoordinate(input, relativeBase))
  }

  preview(cursor?: KJDraftPoint): KJDraftEntitySpec | null {
    if (this.#status === 'cancelled') return null
    if (this.#result) return this.#result
    const points = [...this.#points]
    if (cursor) {
      const point = point2(cursor, 'cursor')
      if (!points.length || !near(points.at(-1)!, point, this.#options.tolerance)) points.push(point)
    }
    if (!points.length) return null
    try {
      if (this.tool === 'polyline' && points.length >= 2) return this.#polyline(points, false)
      if (this.tool === 'spline' && points.length >= this.#options.splineDegree + 1) return this.#spline(points, false)
      if (this.tool === 'hatch' && points.length >= 3) return this.#hatch(points)
      const { maximum } = pointCounts(this.tool, this.#options)
      if (maximum !== null && points.length >= maximum) return this.#build(points.slice(0, maximum), false)
    } catch (error) {
      if (!(error instanceof KJValidationError)) throw error
    }
    if (points.length === 1) return this.#spec('POINT', { position: point3(points[0]!) })
    return this.#polyline(points, false)
  }

  finish(): KJDraftEntitySpec {
    if (this.#result) return this.#result
    this.#assertCollecting()
    return this.#complete(this.#build(this.#points, this.tool === 'hatch'))
  }

  close(): KJDraftEntitySpec {
    if (this.#result) return this.#result
    this.#assertCollecting()
    if (!['polyline', 'spline', 'hatch'].includes(this.tool)) throw new KJValidationError(`${this.tool} cannot be closed explicitly`)
    return this.#complete(this.#build(this.#points, true))
  }

  undoPoint(): KJDraftPoint | null {
    this.#assertCollecting()
    const removed = this.#points.pop()
    return removed ? [removed[0], removed[1]] : null
  }

  cancel(): void {
    this.#points = []
    this.#result = null
    this.#status = 'cancelled'
  }

  #assertCollecting(): void {
    if (this.#status !== 'collecting') throw new KJValidationError(`Draft is ${this.#status}`)
  }

  #complete(result: KJDraftEntitySpec): KJDraftEntitySpec {
    this.#result = result
    this.#status = 'complete'
    return result
  }

  #spec(type: KJStandardEntityType, payload: KJObjectPayload): KJDraftEntitySpec {
    const spec: KJDraftEntitySpec = { type, payload: { ...this.#options.payload, ...payload } }
    if (this.#options.entityOptions) spec.options = { ...this.#options.entityOptions }
    return spec
  }

  #polyline(source: readonly KJDraftPoint[], closed: boolean): KJDraftEntitySpec {
    const points = closed ? withoutClosingDuplicate(source, this.#options.tolerance) : source.map(value => point2(value))
    requirePoints(points, closed ? 3 : 2, 'Polyline')
    if (closed) validateClosedBoundary(points, this.#options.tolerance, 'Polyline')
    return this.#spec('LWPOLYLINE', { vertices: points.map(point => ({ point: point3(point) })), closed })
  }

  #spline(source: readonly KJDraftPoint[], closed: boolean): KJDraftEntitySpec {
    const points = source.map(value => point2(value))
    if (closed && points.length && !near(points[0]!, points.at(-1)!, this.#options.tolerance)) points.push(points[0]!)
    requirePoints(points, this.#options.splineDegree + 1, 'Spline')
    if (points.every(point => near(points[0]!, point, this.#options.tolerance))) throw new KJValidationError('Spline control points are degenerate')
    return this.#spec('SPLINE', {
      degree: this.#options.splineDegree,
      controlPoints: points.map(point3),
      knots: clampedKnots(points.length, this.#options.splineDegree),
      closed,
      periodic: false,
    })
  }

  #hatch(source: readonly KJDraftPoint[]): KJDraftEntitySpec {
    const points = validateClosedBoundary(source, this.#options.tolerance, 'Hatch')
    return this.#spec('HATCH', {
      boundaryLoops: [{ external: true, vertices: points.map(point => ({ point: point3(point) })) }],
      patternName: this.#options.patternName,
      patternScale: this.#options.patternScale,
      patternAngle: this.#options.patternAngle,
      solid: this.#options.solid,
    })
  }

  #dimension(points: readonly KJDraftPoint[]): KJDraftEntitySpec {
    const type = this.#options.dimensionType
    const payload: KJObjectPayload = { dimensionType: type, styleName: this.#options.styleName }
    if (type === 'ALIGNED' || type === 'ROTATED') {
      requirePoints(points, 3, `${type} dimension`)
      const [a, b, placement] = points as readonly [KJDraftPoint, KJDraftPoint, KJDraftPoint]
      requireDistinct(a, b, this.#options.tolerance, `${type} dimension origins`)
      const delta: KJDraftPoint = [b[0] - a[0], b[1] - a[1]]
      const measurement = type === 'ALIGNED'
        ? Math.hypot(delta[0], delta[1])
        : Math.abs(delta[0] * Math.cos(this.#options.rotation) + delta[1] * Math.sin(this.#options.rotation))
      if (!(measurement > this.#options.tolerance)) throw new KJValidationError(`${type} dimension measurement is degenerate`)
      payload.definitionPoints = [point3(placement), point3(a), point3(b)]
      payload.measurement = measurement
      if (type === 'ROTATED') payload.rotation = this.#options.rotation
    } else {
      requirePoints(points, 2, `${type} dimension`)
      const [first, pointOnCircle] = points as readonly [KJDraftPoint, KJDraftPoint]
      requireDistinct(first, pointOnCircle, this.#options.tolerance, `${type} dimension`)
      payload.definitionPoints = [point3(first), point3(pointOnCircle)]
      payload.measurement = distance(first, pointOnCircle)
    }
    if (this.#options.textPosition) payload.textPosition = point3(this.#options.textPosition)
    if (this.#options.textOverride !== null) payload.textOverride = this.#options.textOverride
    if (this.#options.textHeight !== null) payload.textHeight = this.#options.textHeight
    return this.#spec('DIMENSION', payload)
  }

  #build(source: readonly KJDraftPoint[], closed: boolean): KJDraftEntitySpec {
    const points = source.map(value => point2(value))
    const tolerance = this.#options.tolerance
    if (this.tool === 'point') { requirePoints(points, 1, 'Point'); return this.#spec('POINT', { position: point3(points[0]!) }) }
    if (this.tool === 'line') { requirePoints(points, 2, 'Line'); requireDistinct(points[0]!, points[1]!, tolerance, 'Line'); return this.#spec('LINE', { start: point3(points[0]!), end: point3(points[1]!) }) }
    if (this.tool === 'ray' || this.tool === 'xline') {
      requirePoints(points, 2, this.tool)
      requireDistinct(points[0]!, points[1]!, tolerance, this.tool)
      return this.#spec(this.tool === 'ray' ? 'RAY' : 'XLINE', { origin: point3(points[0]!), direction: [points[1]![0] - points[0]![0], points[1]![1] - points[0]![1], 0] })
    }
    if (this.tool === 'polyline') return this.#polyline(points, closed)
    if (this.tool === 'spline') return this.#spline(points, closed)
    if (this.tool === 'hatch') return this.#hatch(points)
    if (this.tool === 'rectangle') {
      requirePoints(points, 2, 'Rectangle')
      const [a, b] = points
      if (Math.abs(b![0] - a![0]) <= tolerance || Math.abs(b![1] - a![1]) <= tolerance) throw new KJValidationError('Rectangle is degenerate')
      return this.#polyline([a!, [b![0], a![1]], b!, [a![0], b![1]]], true)
    }
    if (this.tool === 'polygon') {
      requirePoints(points, 2, 'Polygon')
      const [center, vertex] = points
      requireDistinct(center!, vertex!, tolerance, 'Polygon radius')
      const radius = distance(center!, vertex!), startAngle = Math.atan2(vertex![1] - center![1], vertex![0] - center![0])
      const vertices = Array.from({ length: this.#options.sides }, (_, index): KJDraftPoint => [center![0] + Math.cos(startAngle + TAU * index / this.#options.sides) * radius, center![1] + Math.sin(startAngle + TAU * index / this.#options.sides) * radius])
      return this.#polyline(vertices, true)
    }
    if (this.tool === 'circle') {
      const required = this.#options.circleMode === '3-point' ? 3 : 2
      requirePoints(points, required, 'Circle')
      if (this.#options.circleMode === 'center-radius') {
        requireDistinct(points[0]!, points[1]!, tolerance, 'Circle radius')
        return this.#spec('CIRCLE', { center: point3(points[0]!), radius: distance(points[0]!, points[1]!) })
      }
      if (this.#options.circleMode === '2-point') {
        requireDistinct(points[0]!, points[1]!, tolerance, 'Circle diameter')
        const center: KJDraftPoint = [(points[0]![0] + points[1]![0]) / 2, (points[0]![1] + points[1]![1]) / 2]
        return this.#spec('CIRCLE', { center: point3(center), radius: distance(points[0]!, points[1]!) / 2 })
      }
      const circle = circumcircle(points.slice(0, 3) as [KJDraftPoint, KJDraftPoint, KJDraftPoint], tolerance)
      return this.#spec('CIRCLE', { center: point3(circle.center), radius: circle.radius })
    }
    if (this.tool === 'arc') {
      requirePoints(points, 3, 'Arc')
      if (this.#options.arcMode === 'center-start-end') {
        const [center, start, end] = points
        requireDistinct(center!, start!, tolerance, 'Arc radius')
        requireDistinct(center!, end!, tolerance, 'Arc endpoint')
        const startAngle = normalizedAngle(Math.atan2(start![1] - center![1], start![0] - center![0]))
        const endAngle = normalizedAngle(Math.atan2(end![1] - center![1], end![0] - center![0]))
        if (ccwDelta(startAngle, endAngle) <= tolerance) throw new KJValidationError('Arc sweep is degenerate')
        return this.#spec('ARC', { center: point3(center!), radius: distance(center!, start!), startAngle, endAngle, clockwise: false })
      }
      const [start, through, end] = points as [KJDraftPoint, KJDraftPoint, KJDraftPoint]
      const circle = circumcircle([start, through, end], tolerance)
      const angles = [start, through, end].map(point => normalizedAngle(Math.atan2(point[1] - circle.center[1], point[0] - circle.center[0])))
      const forwardContainsThrough = ccwDelta(angles[0]!, angles[1]!) < ccwDelta(angles[0]!, angles[2]!)
      return this.#spec('ARC', {
        center: point3(circle.center),
        radius: circle.radius,
        startAngle: forwardContainsThrough ? angles[0] : angles[2],
        endAngle: forwardContainsThrough ? angles[2] : angles[0],
        clockwise: false,
      })
    }
    if (this.tool === 'ellipse') {
      requirePoints(points, 3, 'Ellipse')
      const [center, axisPoint, minorPoint] = points
      requireDistinct(center!, axisPoint!, tolerance, 'Ellipse major axis')
      const ax = axisPoint![0] - center![0], ay = axisPoint![1] - center![1], majorLength = Math.hypot(ax, ay)
      const signedMinor = (ax * (minorPoint![1] - center![1]) - ay * (minorPoint![0] - center![0])) / majorLength
      const minorLength = Math.abs(signedMinor)
      if (!(minorLength > tolerance)) throw new KJValidationError('Ellipse minor axis is degenerate')
      const perpendicular: KJDraftPoint = [-ay / majorLength * signedMinor, ax / majorLength * signedMinor]
      const majorAxis: KJDraftPoint = minorLength > majorLength ? perpendicular : [ax, ay]
      const ratio = Math.min(majorLength, minorLength) / Math.max(majorLength, minorLength)
      return this.#spec('ELLIPSE', { center: point3(center!), majorAxis: point3(majorAxis), ratio, startParameter: 0, endParameter: TAU })
    }
    if (this.tool === 'dimension') return this.#dimension(points)
    throw new KJValidationError(`Unsupported drafting tool: ${this.tool}`)
  }
}

export function createDraftingSession(tool: KJDraftTool, options: KJDraftingOptions = {}): KJDraftingSession {
  return new KJDraftingSession(tool, options)
}
