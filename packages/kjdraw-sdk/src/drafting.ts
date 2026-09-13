import { KJValidationError } from './errors.js'
import { projectDimension } from './geometry/annotation.js'
import { normalizeDimensionAssociations, type KJDimensionPointAssociation } from './dimension-associations.js'
import type { KJStandardEntityType } from './constants.js'
import type { KJObjectPayload, KJObjectSpec } from './schema.js'

export type KJDraftPoint = readonly [number, number]
export type KJDraftPointReference = Omit<KJDimensionPointAssociation, 'definitionPointIndex'>

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
  | 'leader'

export type KJDraftCircleMode = 'center-radius' | '2-point' | '3-point' | 'tangent-tangent-radius'
export type KJDraftArcMode = 'center-start-end' | '3-point'
export type KJDraftEllipseMode = 'full' | 'arc'
export type KJDraftPolygonMode = 'inscribed' | 'circumscribed' | 'edge'
export type KJDraftDimensionType = 'ALIGNED' | 'ROTATED' | 'RADIUS' | 'DIAMETER' | 'ANGULAR_3_POINT'
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
  | 'solutionPoint'
  | 'majorAxisPoint'
  | 'minorAxisPoint'
  | 'ellipseArcStart'
  | 'ellipseArcEnd'
  | 'polygonVertex'
  | 'polygonSideMidpoint'
  | 'edgeStart'
  | 'edgeEnd'
  | 'firstCorner'
  | 'oppositeCorner'
  | 'controlPoint'
  | 'boundaryPoint'
  | 'extensionOrigin1'
  | 'extensionOrigin2'
  | 'placement'
  | 'oppositePoint'
  | 'pointOnCircle'
  | 'angleVertex'
  | 'firstRayPoint'
  | 'secondRayPoint'
  | 'angularPlacement'
  | 'arrowPoint'
  | 'leaderVertex'

export interface KJDraftEntitySpec {
  type: KJStandardEntityType
  payload: KJObjectPayload
  options?: KJObjectSpec
}

export interface KJDraftLineInput {
  start: KJDraftPoint
  end: KJDraftPoint
}

export interface KJDraftTangentCircle {
  center: KJDraftPoint
  radius: number
  tangentPoints: readonly [KJDraftPoint, KJDraftPoint]
}

export interface KJDraftingOptions {
  circleMode?: KJDraftCircleMode
  circleTangentLines?: readonly [KJDraftLineInput, KJDraftLineInput]
  circleRadius?: number
  arcMode?: KJDraftArcMode
  ellipseMode?: KJDraftEllipseMode
  polygonMode?: KJDraftPolygonMode
  sides?: number
  splineDegree?: number
  dimensionType?: KJDraftDimensionType
  rotation?: number
  textPosition?: KJDraftPoint
  textOverride?: string | null
  textHeight?: number
  styleId?: string | null
  styleName?: string
  precision?: number | null
  overallScale?: number | null
  leaderText?: string
  arrowEnabled?: boolean
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
  circleTangentLines: readonly [KJDraftLineInput, KJDraftLineInput] | null
  circleRadius: number | null
  arcMode: KJDraftArcMode
  ellipseMode: KJDraftEllipseMode
  polygonMode: KJDraftPolygonMode
  sides: number
  splineDegree: number
  dimensionType: KJDraftDimensionType
  rotation: number
  textPosition: KJDraftPoint | null
  textOverride: string | null
  textHeight: number | null
  styleId: string | null
  styleName: string
  precision: number | null
  overallScale: number | null
  leaderText: string
  arrowEnabled: boolean
  patternName: string
  patternScale: number
  patternAngle: number
  solid: boolean
  payload: KJObjectPayload
  entityOptions: KJObjectSpec | null
  tolerance: number
}

const TOOLS = new Set<KJDraftTool>(['line', 'polyline', 'circle', 'arc', 'ellipse', 'rectangle', 'polygon', 'point', 'ray', 'xline', 'spline', 'hatch', 'dimension', 'leader'])
const CIRCLE_MODES = new Set<KJDraftCircleMode>(['center-radius', '2-point', '3-point', 'tangent-tangent-radius'])
const ARC_MODES = new Set<KJDraftArcMode>(['center-start-end', '3-point'])
const ELLIPSE_MODES = new Set<KJDraftEllipseMode>(['full', 'arc'])
const POLYGON_MODES = new Set<KJDraftPolygonMode>(['inscribed', 'circumscribed', 'edge'])
const DIMENSION_TYPES = new Set<KJDraftDimensionType>(['ALIGNED', 'ROTATED', 'RADIUS', 'DIAMETER', 'ANGULAR_3_POINT'])
const TAU = Math.PI * 2
const MAX_DRAFT_COORDINATE = 1e12

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

/** Constrain a pointer-derived point to the dominant axis through an exact base point. */
export function constrainOrthogonalDraftPoint(value: KJDraftPoint, base: KJDraftPoint): KJDraftPoint {
  const point = point2(value), origin = point2(base, 'base')
  const dx = Math.abs(point[0] - origin[0]), dy = Math.abs(point[1] - origin[1])
  return dx >= dy ? [point[0], origin[1]] : [origin[0], point[1]]
}

/** Project a pointer-derived point onto the nearest polar tracking ray. */
export function constrainPolarDraftPoint(value: KJDraftPoint, base: KJDraftPoint, angleIncrement = 45): KJDraftPoint {
  const point = point2(value), origin = point2(base, 'base')
  const increment = positive(angleIncrement, 'angleIncrement')
  if (increment > 180) throw new KJValidationError('angleIncrement must be at most 180 degrees')
  const dx = point[0] - origin[0], dy = point[1] - origin[1]
  if (dx === 0 && dy === 0) return [point[0], point[1]]
  const radians = increment * Math.PI / 180
  const trackedAngle = Math.round(Math.atan2(dy, dx) / radians) * radians
  const direction: KJDraftPoint = [Math.cos(trackedAngle), Math.sin(trackedAngle)]
  const distance = dx * direction[0] + dy * direction[1]
  return [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance]
}

function point3(value: KJDraftPoint): [number, number, number] { return [value[0], value[1], 0] }
function distance(a: KJDraftPoint, b: KJDraftPoint): number { return Math.hypot(b[0] - a[0], b[1] - a[1]) }
function near(a: KJDraftPoint, b: KJDraftPoint, tolerance: number): boolean { return distance(a, b) <= tolerance }
function normalizedAngle(value: number): number { const angle = value % TAU; return angle < 0 ? angle + TAU : angle }
function ccwDelta(start: number, end: number): number { return normalizedAngle(end - start) }

interface DraftEllipse {
  center: [number, number, number]
  majorAxis: [number, number, number]
  ratio: number
}

function draftEllipse(center: KJDraftPoint, axisPoint: KJDraftPoint, minorPoint: KJDraftPoint, tolerance: number): DraftEllipse {
  requireDistinct(center, axisPoint, tolerance, 'Ellipse major axis')
  const ax = axisPoint[0] - center[0], ay = axisPoint[1] - center[1], axisLength = Math.hypot(ax, ay)
  const signedMinor = (ax * (minorPoint[1] - center[1]) - ay * (minorPoint[0] - center[0])) / axisLength
  const minorLength = Math.abs(signedMinor)
  if (!(minorLength > tolerance)) throw new KJValidationError('Ellipse minor axis is degenerate')
  const perpendicular: KJDraftPoint = [-ay / axisLength * signedMinor, ax / axisLength * signedMinor]
  const majorAxis = minorLength > axisLength ? perpendicular : ([ax, ay] as const)
  return {
    center: point3(center),
    majorAxis: point3(majorAxis),
    ratio: Math.min(axisLength, minorLength) / Math.max(axisLength, minorLength),
  }
}

function ellipseParameter(ellipse: DraftEllipse, value: KJDraftPoint, tolerance: number, label: string): number {
  const center = ellipse.center, u = ellipse.majorAxis
  const dx = value[0] - center[0], dy = value[1] - center[1]
  if (Math.hypot(dx, dy) <= tolerance) throw new KJValidationError(`${label} must differ from the ellipse center`)
  const v: KJDraftPoint = [-u[1] * ellipse.ratio, u[0] * ellipse.ratio]
  const u2 = u[0] * u[0] + u[1] * u[1], v2 = v[0] * v[0] + v[1] * v[1]
  return normalizedAngle(Math.atan2((dx * v[0] + dy * v[1]) / v2, (dx * u[0] + dy * u[1]) / u2))
}

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

function boundedDraftPoint(value: unknown, label: string): KJDraftPoint {
  const point = point2(value, label)
  if (Math.abs(point[0]) > MAX_DRAFT_COORDINATE || Math.abs(point[1]) > MAX_DRAFT_COORDINATE) throw new KJValidationError(`${label} exceeds the drafting coordinate limit`)
  return point
}

function normalizedDraftLine(value: unknown, label: string, tolerance: number): KJDraftLineInput {
  if (!value || typeof value !== 'object') throw new KJValidationError(`${label} must be a 2D line`)
  const source = value as Partial<KJDraftLineInput>
  const start = boundedDraftPoint(source.start, `${label}.start`), end = boundedDraftPoint(source.end, `${label}.end`)
  requireDistinct(start, end, tolerance, label)
  return { start, end }
}

/** Solve the finite-line TTR subset. The solution point selects one unique offset-line intersection. */
export function circleTangentToLines(
  firstValue: KJDraftLineInput,
  secondValue: KJDraftLineInput,
  radiusValue: number,
  solutionValue: KJDraftPoint,
  toleranceValue = 1e-9,
): KJDraftTangentCircle {
  const tolerance = positive(toleranceValue, 'tolerance')
  const radius = positive(radiusValue, 'circleRadius')
  if (radius > MAX_DRAFT_COORDINATE) throw new KJValidationError('circleRadius exceeds the drafting coordinate limit')
  const first = normalizedDraftLine(firstValue, 'circleTangentLines[0]', tolerance)
  const second = normalizedDraftLine(secondValue, 'circleTangentLines[1]', tolerance)
  const solution = boundedDraftPoint(solutionValue, 'solutionPoint')
  const dx1 = first.end[0] - first.start[0], dy1 = first.end[1] - first.start[1], length1 = Math.hypot(dx1, dy1)
  const dx2 = second.end[0] - second.start[0], dy2 = second.end[1] - second.start[1], length2 = Math.hypot(dx2, dy2)
  const ux1 = dx1 / length1, uy1 = dy1 / length1, ux2 = dx2 / length2, uy2 = dy2 / length2
  const determinant = ux1 * uy2 - uy1 * ux2
  if (Math.abs(determinant) <= tolerance) throw new KJValidationError('TTR lines must have one stable non-parallel intersection')
  const candidates: KJDraftTangentCircle[] = []
  for (const side1 of [-1, 1] as const) for (const side2 of [-1, 1] as const) {
    const offset1: KJDraftPoint = [first.start[0] - uy1 * radius * side1, first.start[1] + ux1 * radius * side1]
    const offset2: KJDraftPoint = [second.start[0] - uy2 * radius * side2, second.start[1] + ux2 * radius * side2]
    const qx = offset2[0] - offset1[0], qy = offset2[1] - offset1[1]
    const line1Parameter = (qx * uy2 - qy * ux2) / determinant
    const center: KJDraftPoint = [offset1[0] + ux1 * line1Parameter, offset1[1] + uy1 * line1Parameter]
    if (!center.every(Number.isFinite) || center.some(value => Math.abs(value) > MAX_DRAFT_COORDINATE)) continue
    const project = (line: KJDraftLineInput, dx: number, dy: number): { point: KJDraftPoint; parameter: number } => {
      const lengthSquared = dx * dx + dy * dy
      const parameter = ((center[0] - line.start[0]) * dx + (center[1] - line.start[1]) * dy) / lengthSquared
      return { point: [line.start[0] + dx * parameter, line.start[1] + dy * parameter], parameter }
    }
    const tangent1 = project(first, dx1, dy1), tangent2 = project(second, dx2, dy2)
    const parameterTolerance1 = tolerance / Math.max(1, length1), parameterTolerance2 = tolerance / Math.max(1, length2)
    if (tangent1.parameter < -parameterTolerance1 || tangent1.parameter > 1 + parameterTolerance1 || tangent2.parameter < -parameterTolerance2 || tangent2.parameter > 1 + parameterTolerance2) continue
    candidates.push({ center, radius, tangentPoints: [tangent1.point, tangent2.point] })
  }
  if (!candidates.length) throw new KJValidationError('No TTR circle is tangent within both finite line segments')
  candidates.sort((a, b) => distance(a.center, solution) - distance(b.center, solution) || a.center[0] - b.center[0] || a.center[1] - b.center[1])
  if (candidates.length > 1) {
    const firstDistance = distance(candidates[0]!.center, solution), secondDistance = distance(candidates[1]!.center, solution)
    if (Math.abs(secondDistance - firstDistance) <= tolerance * Math.max(1, firstDistance, secondDistance)) throw new KJValidationError('TTR solution point is ambiguous')
  }
  return candidates[0]!
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
  const ellipseMode = options.ellipseMode ?? 'full'
  if (!ELLIPSE_MODES.has(ellipseMode)) throw new KJValidationError(`Unsupported ellipse mode: ${String(ellipseMode)}`)
  const polygonMode = options.polygonMode ?? 'inscribed'
  if (!POLYGON_MODES.has(polygonMode)) throw new KJValidationError(`Unsupported polygon mode: ${String(polygonMode)}`)
  const dimensionType = String(options.dimensionType ?? 'ALIGNED').toUpperCase() as KJDraftDimensionType
  if (!DIMENSION_TYPES.has(dimensionType)) throw new KJValidationError(`Unsupported dimension type: ${String(options.dimensionType)}`)
  const sides = Number(options.sides ?? 6)
  if (!Number.isInteger(sides) || sides < 3 || sides > 1024) throw new KJValidationError('Polygon sides must be an integer from 3 to 1024')
  const splineDegree = Number(options.splineDegree ?? 3)
  if (!Number.isInteger(splineDegree) || splineDegree < 1 || splineDegree > 10) throw new KJValidationError('Spline degree must be an integer from 1 to 10')
  const tolerance = positive(options.tolerance ?? 1e-9, 'tolerance')
  let circleTangentLines: readonly [KJDraftLineInput, KJDraftLineInput] | null = null
  let circleRadius: number | null = null
  if (circleMode === 'tangent-tangent-radius') {
    if (!Array.isArray(options.circleTangentLines) || options.circleTangentLines.length !== 2) throw new KJValidationError('TTR circle requires exactly two finite 2D lines')
    circleTangentLines = [
      normalizedDraftLine(options.circleTangentLines[0], 'circleTangentLines[0]', tolerance),
      normalizedDraftLine(options.circleTangentLines[1], 'circleTangentLines[1]', tolerance),
    ]
    circleRadius = positive(options.circleRadius, 'circleRadius')
    if (circleRadius > MAX_DRAFT_COORDINATE) throw new KJValidationError('circleRadius exceeds the drafting coordinate limit')
  }
  const rotation = finite(options.rotation ?? 0, 'rotation')
  const textHeight = options.textHeight == null ? null : positive(options.textHeight, 'textHeight')
  const styleId = options.styleId == null ? null : String(options.styleId).trim()
  if (options.styleId != null && !styleId) throw new KJValidationError('styleId cannot be empty')
  const precision = options.precision == null ? null : finite(options.precision, 'precision')
  if (precision !== null && (!Number.isInteger(precision) || precision < -1 || precision > 8)) throw new KJValidationError('precision must be an integer from -1 to 8')
  const overallScale = options.overallScale == null ? null : positive(options.overallScale, 'overallScale')
  const patternScale = positive(options.patternScale ?? 1, 'patternScale')
  const patternAngle = finite(options.patternAngle ?? 0, 'patternAngle')
  const patternName = String(options.patternName ?? 'SOLID').trim().toUpperCase()
  if (!patternName) throw new KJValidationError('patternName cannot be empty')
  const styleName = String(options.styleName ?? 'STANDARD').trim()
  if (!styleName) throw new KJValidationError('styleName cannot be empty')
  const leaderText = String(options.leaderText ?? 'Note')
  if (!leaderText.trim() || leaderText.length > 16384 || /\u0000/.test(leaderText)) throw new KJValidationError('Leader text must be nonempty bounded Unicode text')
  return {
    circleMode,
    circleTangentLines,
    circleRadius,
    arcMode,
    ellipseMode,
    polygonMode,
    sides,
    splineDegree,
    dimensionType,
    rotation,
    textPosition: options.textPosition == null ? null : point2(options.textPosition, 'textPosition'),
    textOverride: options.textOverride == null ? null : String(options.textOverride),
    textHeight,
    styleId,
    styleName,
    precision,
    overallScale,
    leaderText,
    arrowEnabled: options.arrowEnabled !== false,
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
  if (tool === 'leader') return { minimum: 2, maximum: null }
  if (tool === 'circle') { const count = options.circleMode === 'tangent-tangent-radius' ? 1 : options.circleMode === '3-point' ? 3 : 2; return { minimum: count, maximum: count } }
  if (tool === 'arc') return { minimum: 3, maximum: 3 }
  if (tool === 'ellipse') { const count = options.ellipseMode === 'arc' ? 5 : 3; return { minimum: count, maximum: count } }
  if (tool === 'dimension') { const count = options.dimensionType === 'ANGULAR_3_POINT' ? 4 : ['ALIGNED', 'ROTATED'].includes(options.dimensionType) ? 3 : 2; return { minimum: count, maximum: count } }
  return { minimum: 2, maximum: 2 }
}

function nextPointRole(tool: KJDraftTool, count: number, options: NormalizedOptions): KJDraftPointRole {
  if (tool === 'line') return count === 0 ? 'start' : 'end'
  if (tool === 'polyline') return 'vertex'
  if (tool === 'point') return 'position'
  if (tool === 'ray' || tool === 'xline') return count === 0 ? 'origin' : 'directionPoint'
  if (tool === 'rectangle') return count === 0 ? 'firstCorner' : 'oppositeCorner'
  if (tool === 'polygon') {
    if (options.polygonMode === 'edge') return count === 0 ? 'edgeStart' : 'edgeEnd'
    return count === 0 ? 'center' : options.polygonMode === 'circumscribed' ? 'polygonSideMidpoint' : 'polygonVertex'
  }
  if (tool === 'spline') return 'controlPoint'
  if (tool === 'hatch') return 'boundaryPoint'
  if (tool === 'leader') return count === 0 ? 'arrowPoint' : 'leaderVertex'
  if (tool === 'ellipse') return options.ellipseMode === 'arc'
    ? (['center', 'majorAxisPoint', 'minorAxisPoint', 'ellipseArcStart', 'ellipseArcEnd'] as const)[Math.min(count, 4)]!
    : (['center', 'majorAxisPoint', 'minorAxisPoint'] as const)[Math.min(count, 2)]!
  if (tool === 'arc') return options.arcMode === '3-point'
    ? (['start', 'throughPoint', 'end'] as const)[Math.min(count, 2)]!
    : (['center', 'start', 'end'] as const)[Math.min(count, 2)]!
  if (tool === 'circle') {
    if (options.circleMode === 'tangent-tangent-radius') return 'solutionPoint'
    if (options.circleMode === 'center-radius') return count === 0 ? 'center' : 'radiusPoint'
    if (options.circleMode === '2-point') return count === 0 ? 'diameterPoint1' : 'diameterPoint2'
    return (['start', 'throughPoint', 'end'] as const)[Math.min(count, 2)]!
  }
  if (options.dimensionType === 'ANGULAR_3_POINT') return (['angleVertex', 'firstRayPoint', 'secondRayPoint', 'angularPlacement'] as const)[Math.min(count, 3)]!
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

const DRAFT_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

/** Return whether text is an exact coordinate or direct distance/angle draft input. */
export function isDraftPointInput(input: string): boolean {
  const source = String(input).trim()
  return DRAFT_NUMBER.test(source)
    || /^<[^<]+$/.test(source)
    || /^[^<]+<[^<]+$/.test(source)
    || /^@?[^,]+,[^,]+$/.test(source)
}

/**
 * Resolve command-line drafting input. Coordinates stay exact. A scalar uses
 * the current pointer direction, `<angle` keeps its distance, and
 * `distance<angle` supplies both values relative to the last accepted point.
 */
export function parseDraftPointInput(input: string, relativeBase?: KJDraftPoint, directionPoint?: KJDraftPoint): KJDraftPoint {
  const source = String(input).trim()
  if (!source) throw new KJValidationError('Draft input cannot be empty')
  if (source.startsWith('@') || source.includes(',')) return parseDraftCoordinate(source, relativeBase)
  const base = point2(relativeBase, 'relativeBase')
  const direction = directionPoint === undefined ? undefined : point2(directionPoint, 'directionPoint')
  if (source.includes('<')) {
    const pieces = source.split('<')
    if (pieces.length !== 2 || !pieces[1]?.trim()) throw new KJValidationError('Distance/angle input must use distance<angle or <angle')
    const angle = finite(pieces[1], 'angle') * Math.PI / 180
    const length = pieces[0]?.trim()
      ? finite(pieces[0], 'distance')
      : direction ? distance(base, direction) : Number.NaN
    if (!Number.isFinite(length)) throw new KJValidationError('Angle-only input requires a current pointer distance')
    if (length < 0) throw new KJValidationError('distance must be non-negative')
    return [base[0] + Math.cos(angle) * length, base[1] + Math.sin(angle) * length]
  }
  if (!DRAFT_NUMBER.test(source)) throw new KJValidationError('Draft input must use x,y, @dx,dy, @distance<angle, distance, distance<angle or <angle')
  const length = finite(source, 'distance')
  if (length < 0) throw new KJValidationError('distance must be non-negative')
  if (!direction) throw new KJValidationError('Direct distance input requires a current pointer direction')
  const dx = direction[0] - base[0], dy = direction[1] - base[1], magnitude = Math.hypot(dx, dy)
  if (!(magnitude > 0)) throw new KJValidationError('Move the pointer away from the last point before entering a distance')
  return [base[0] + dx / magnitude * length, base[1] + dy / magnitude * length]
}

export class KJDraftingSession {
  readonly tool: KJDraftTool
  #options: NormalizedOptions
  #points: KJDraftPoint[] = []
  #pointReferences: Array<KJDraftPointReference | null> = []
  #status: KJDraftStatus = 'collecting'
  #result: KJDraftEntitySpec | null = null

  constructor(tool: KJDraftTool, options: KJDraftingOptions = {}) {
    if (!TOOLS.has(tool)) throw new KJValidationError(`Unsupported drafting tool: ${String(tool)}`)
    this.tool = tool
    this.#options = normalizeOptions(options)
  }

  get points(): readonly KJDraftPoint[] { return this.#points.map(point => [point[0], point[1]] as const) }
  get pointReferences(): readonly (Readonly<KJDraftPointReference> | null)[] {
    return this.#pointReferences.map(reference => reference ? Object.freeze({ ...reference }) : null)
  }

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

  addPoint(value: KJDraftPoint, reference: KJDraftPointReference | null = null): KJDraftEntitySpec | null {
    this.#assertCollecting()
    const { maximum } = pointCounts(this.tool, this.#options)
    if (maximum !== null && this.#points.length >= maximum) throw new KJValidationError(`${this.tool} already has all required points`)
    const point = point2(value, `points[${this.#points.length}]`)
    const previous = this.#points.at(-1)
    if (previous && near(previous, point, this.#options.tolerance)) throw new KJValidationError('Consecutive draft points must be distinct')
    if (this.tool === 'dimension' && this.#options.dimensionType === 'ANGULAR_3_POINT' && this.#points.length === 2) requireDistinct(this.#points[0]!, point, this.#options.tolerance, 'Angular second ray and vertex')
    if (reference && this.tool !== 'dimension') throw new KJValidationError('Draft point references are only supported by dimensions')
    const normalizedReference = reference
      ? normalizeDimensionAssociations([{ definitionPointIndex: 0, ...reference }])[0]!
      : null
    this.#points.push(point)
    this.#pointReferences.push(normalizedReference ? {
      entityId: normalizedReference.entityId,
      feature: normalizedReference.feature,
      ...(normalizedReference.vertexIndex === undefined ? {} : { vertexIndex: normalizedReference.vertexIndex }),
      ...(normalizedReference.angle === undefined ? {} : { angle: normalizedReference.angle }),
    } : null)
    if (maximum === null || this.#points.length !== maximum) return null
    try { return this.#complete(this.#build(this.#points, false)) }
    catch (error) { this.#points.pop(); this.#pointReferences.pop(); throw error }
  }

  addCoordinate(input: string, relativeBase: KJDraftPoint | undefined = this.#points.at(-1)): KJDraftEntitySpec | null {
    return this.addPoint(parseDraftCoordinate(input, relativeBase))
  }

  addInput(input: string, directionPoint?: KJDraftPoint, relativeBase: KJDraftPoint | undefined = this.#points.at(-1)): KJDraftEntitySpec | null {
    const circleRadius = this.tool === 'circle' && this.#options.circleMode === 'center-radius' && this.#points.length === 1 && DRAFT_NUMBER.test(String(input).trim())
    const direction = circleRadius && relativeBase && (!directionPoint || near(relativeBase, directionPoint, this.#options.tolerance))
      ? [relativeBase[0] + 1, relativeBase[1]] as KJDraftPoint
      : directionPoint
    return this.addPoint(parseDraftPointInput(input, relativeBase, direction))
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
      // The first point establishes only the origin. While choosing direction,
      // show a finite guide; an infinite entity belongs to the committed result.
      if ((this.tool === 'ray' || this.tool === 'xline') && points.length >= 2) return this.#spec('LINE', { start: point3(points[0]!), end: point3(points[1]!) })
      if (this.tool === 'polyline' && points.length >= 2) return this.#polyline(points, false)
      if (this.tool === 'spline' && points.length >= this.#options.splineDegree + 1) return this.#spline(points, false)
      if (this.tool === 'hatch' && points.length >= 3) return this.#hatch(points)
      if (this.tool === 'leader' && points.length >= 2) return this.#leader(points)
      if (this.tool === 'ellipse' && this.#options.ellipseMode === 'arc' && points.length >= 3 && points.length < 5) {
        const ellipse = draftEllipse(points[0]!, points[1]!, points[2]!, this.#options.tolerance)
        return this.#spec('ELLIPSE', { ...ellipse, startParameter: 0, endParameter: TAU })
      }
      const { maximum } = pointCounts(this.tool, this.#options)
      if (maximum !== null && points.length >= maximum) return this.#build(points.slice(0, maximum), false)
    } catch (error) {
      if (!(error instanceof KJValidationError)) throw error
    }
    if (this.tool === 'dimension' && this.#options.dimensionType === 'ANGULAR_3_POINT' && points.length >= 3) return this.#polyline([points[1]!, points[0]!, points[2]!], false)
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
    this.#pointReferences.pop()
    return removed ? [removed[0], removed[1]] : null
  }

  cancel(): void {
    this.#points = []
    this.#pointReferences = []
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

  #leader(source: readonly KJDraftPoint[]): KJDraftEntitySpec {
    const points = source.map(value => point2(value))
    requirePoints(points, 2, 'Leader')
    for (let index = 1; index < points.length; index += 1) requireDistinct(points[index - 1]!, points[index]!, this.#options.tolerance, 'Leader segment')
    return this.#spec('LEADER', {
      vertices: points.map(point3), textPosition: point3(points.at(-1)!), text: this.#options.leaderText,
      textHeight: this.#options.textHeight ?? 2.5, ...(this.#options.styleId ? { styleId: this.#options.styleId } : {}), arrowEnabled: this.#options.arrowEnabled,
    })
  }

  #dimension(points: readonly KJDraftPoint[]): KJDraftEntitySpec {
    const type = this.#options.dimensionType
    const payload: KJObjectPayload = { dimensionType: type, styleName: this.#options.styleName }
    if (type === 'ANGULAR_3_POINT') {
      requirePoints(points, 4, 'Three-point angular dimension')
      const [center, first, second, placement] = points as readonly [KJDraftPoint, KJDraftPoint, KJDraftPoint, KJDraftPoint]
      requireDistinct(center, first, this.#options.tolerance, 'Angular first ray and vertex')
      requireDistinct(center, second, this.#options.tolerance, 'Angular second ray and vertex')
      requireDistinct(center, placement, this.#options.tolerance, 'Angular arc placement and vertex')
      payload.definitionPoints = [point3(placement), point3(first), point3(second), point3(center)]
      const projection = projectDimension(payload)
      if (!projection) throw new KJValidationError('Angular dimension has coincident rays or ambiguous arc placement; choose a point between the rays, including the reflex sector')
      payload.measurement = projection.measurement
    } else if (type === 'ALIGNED' || type === 'ROTATED') {
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
    if (this.#options.styleId !== null) payload.styleId = this.#options.styleId
    if (this.#options.precision !== null) payload.precision = this.#options.precision
    if (this.#options.overallScale !== null) payload.overallScale = this.#options.overallScale
    const indexMap = type === 'ANGULAR_3_POINT' ? [3, 1, 2, null] : type === 'ALIGNED' || type === 'ROTATED' ? [1, 2, null] : [0, 1]
    let associations = this.#pointReferences.flatMap((reference, index) => {
      const definitionPointIndex = indexMap[index]
      return reference && definitionPointIndex !== null && definitionPointIndex !== undefined
        ? [{ definitionPointIndex, ...reference }]
        : []
    })
    if ((type === 'RADIUS' || type === 'DIAMETER') && (associations.length !== 2 || associations[0]!.entityId !== associations[1]!.entityId)) associations = []
    if (associations.length) payload.dimensionAssociations = normalizeDimensionAssociations(associations)
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
    if (this.tool === 'leader') return this.#leader(points)
    if (this.tool === 'rectangle') {
      requirePoints(points, 2, 'Rectangle')
      const [a, b] = points
      if (Math.abs(b![0] - a![0]) <= tolerance || Math.abs(b![1] - a![1]) <= tolerance) throw new KJValidationError('Rectangle is degenerate')
      return this.#polyline([a!, [b![0], a![1]], b!, [a![0], b![1]]], true)
    }
    if (this.tool === 'polygon') {
      requirePoints(points, 2, 'Polygon')
      const [first, second] = points
      requireDistinct(first!, second!, tolerance, this.#options.polygonMode === 'edge' ? 'Polygon edge' : 'Polygon radius')
      const halfAngle = Math.PI / this.#options.sides
      let center: KJDraftPoint, radius: number, startAngle: number
      if (this.#options.polygonMode === 'edge') {
        const side = distance(first!, second!), dx = second![0] - first![0], dy = second![1] - first![1]
        const apothem = side / (2 * Math.tan(halfAngle))
        center = [(first![0] + second![0]) / 2 - dy * apothem / side, (first![1] + second![1]) / 2 + dx * apothem / side]
        radius = side / (2 * Math.sin(halfAngle))
        startAngle = Math.atan2(first![1] - center[1], first![0] - center[0])
      } else {
        center = first!
        const direction = Math.atan2(second![1] - center[1], second![0] - center[0])
        if (this.#options.polygonMode === 'circumscribed') {
          radius = distance(center, second!) / Math.cos(halfAngle)
          startAngle = direction - halfAngle
        } else {
          radius = distance(center, second!)
          startAngle = direction
        }
      }
      const vertices = Array.from({ length: this.#options.sides }, (_, index): KJDraftPoint => [center![0] + Math.cos(startAngle + TAU * index / this.#options.sides) * radius, center![1] + Math.sin(startAngle + TAU * index / this.#options.sides) * radius])
      return this.#polyline(vertices, true)
    }
    if (this.tool === 'circle') {
      const required = this.#options.circleMode === 'tangent-tangent-radius' ? 1 : this.#options.circleMode === '3-point' ? 3 : 2
      requirePoints(points, required, 'Circle')
      if (this.#options.circleMode === 'tangent-tangent-radius') {
        const circle = circleTangentToLines(this.#options.circleTangentLines![0], this.#options.circleTangentLines![1], this.#options.circleRadius!, points[0]!, tolerance)
        return this.#spec('CIRCLE', { center: point3(circle.center), radius: circle.radius })
      }
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
      const required = this.#options.ellipseMode === 'arc' ? 5 : 3
      requirePoints(points, required, this.#options.ellipseMode === 'arc' ? 'Elliptical arc' : 'Ellipse')
      const ellipse = draftEllipse(points[0]!, points[1]!, points[2]!, tolerance)
      if (this.#options.ellipseMode === 'full') return this.#spec('ELLIPSE', { ...ellipse, startParameter: 0, endParameter: TAU })
      const startParameter = ellipseParameter(ellipse, points[3]!, tolerance, 'Elliptical arc start')
      const end = ellipseParameter(ellipse, points[4]!, tolerance, 'Elliptical arc end')
      const sweep = ccwDelta(startParameter, end)
      if (sweep <= tolerance) throw new KJValidationError('Elliptical arc sweep is degenerate')
      return this.#spec('ELLIPSE', { ...ellipse, startParameter, endParameter: startParameter + sweep })
    }
    if (this.tool === 'dimension') return this.#dimension(points)
    throw new KJValidationError(`Unsupported drafting tool: ${this.tool}`)
  }
}

export function createDraftingSession(tool: KJDraftTool, options: KJDraftingOptions = {}): KJDraftingSession {
  return new KJDraftingSession(tool, options)
}
