import { KJValidationError } from './errors.js'
import {
  add2,
  arcSweep,
  cross2,
  distance2,
  dot2,
  intersectCircleCircle2,
  intersectLineCircle2,
  intersectLineLine2,
  length2,
  midpoint2,
  multiply2,
  normalize2,
  perpendicular2,
  projectParameter2,
  subtract2,
  vec2,
} from './geometry/index.js'
import type { ArcDefinition, LineDomain, Point2, Point2Input, Point3 } from './geometry/index.js'
import type { KJObjectPayload } from './schema.js'
import { clone, normalizeName } from './utils.js'
import type { ReadonlyDeep } from './utils.js'

const TURN = Math.PI * 2

export interface KJEditingEntity {
  readonly type?: unknown
  readonly payload?: ReadonlyDeep<KJObjectPayload>
}

export interface KJOffsetOptions {
  readonly side?: unknown
  readonly sidePoint?: unknown
}

export interface KJBreakOptions {
  readonly point?: unknown
  readonly firstPoint?: unknown
  readonly secondPoint?: unknown
  readonly points?: readonly unknown[]
}

export interface KJLinePairOptions {
  readonly pickPoint1?: unknown
  readonly pickPoint2?: unknown
  readonly distance?: unknown
  readonly distance1?: unknown
  readonly distance2?: unknown
  readonly radius?: unknown
}

export interface KJDerivedEntityPayload {
  type: string
  payload: KJObjectPayload
}

export interface KJLineConnector {
  type: 'LINE'
  payload: KJObjectPayload & { start: Point3; end: Point3 }
}

export interface KJArcConnector {
  type: 'ARC'
  payload: KJObjectPayload & {
    center: Point3
    radius: number
    startAngle: number
    endAngle: number
    clockwise: boolean
    normal: Point3
  }
}

export interface KJLinePairEditResult {
  first: KJObjectPayload
  second: KJObjectPayload
  connector: KJLineConnector | KJArcConnector
}

function pointInput(value: unknown): Point2Input {
  return value as Point2Input
}

function payloadOf(entity: KJEditingEntity | null | undefined): KJObjectPayload {
  return clone(entity?.payload ?? {}) as KJObjectPayload
}

function positive(value: unknown, label: string): number {
  const result = Number(value)
  if (!Number.isFinite(result) || result <= 0) throw new KJValidationError(`${label} must be a positive finite number`)
  return result
}

function point3(value: unknown): Point3 {
  const point = vec2(pointInput(value))
  const source = value as { readonly [index: number]: unknown; readonly z?: unknown } | null | undefined
  return [point[0], point[1], Number(source?.[2] ?? source?.z ?? 0)]
}

function positiveTurn(value: number): number {
  const normalized = value % TURN
  return normalized < 0 ? normalized + TURN : normalized
}

function polar(center: Point3, radius: number, angle: number): Point3 {
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), center[2] ?? 0]
}

function lineSide(payload: KJObjectPayload, options: KJOffsetOptions): 1 | -1 {
  const direction = subtract2(
    pointInput(payload.end ?? add2(pointInput(payload.origin), pointInput(payload.direction))),
    pointInput(payload.start ?? payload.origin),
  )
  const origin = pointInput(payload.start ?? payload.origin)
  if (options.sidePoint) return cross2(direction, subtract2(pointInput(options.sidePoint), origin)) >= 0 ? 1 : -1
  const side = normalizeName(options.side ?? 'LEFT')
  if (!['LEFT', 'RIGHT'].includes(side)) throw new KJValidationError('Linear offset side must be left or right')
  return side === 'LEFT' ? 1 : -1
}

function radialSide(payload: KJObjectPayload, options: KJOffsetOptions): 1 | -1 {
  if (options.sidePoint) return distance2(pointInput(options.sidePoint), pointInput(payload.center)) >= Number(payload.radius) ? 1 : -1
  const side = normalizeName(options.side ?? 'OUTWARD')
  if (!['OUTWARD', 'INWARD'].includes(side)) throw new KJValidationError('Circular offset side must be outward or inward')
  return side === 'OUTWARD' ? 1 : -1
}

export function offsetEntityPayload(entity: KJEditingEntity | null | undefined, distance: unknown, options: KJOffsetOptions = {}): KJObjectPayload {
  const offsetDistance = positive(distance, 'Offset distance')
  const payload = payloadOf(entity), type = normalizeName(entity?.type)
  if (['LINE', 'RAY', 'XLINE'].includes(type)) {
    const direction = type === 'LINE'
      ? subtract2(pointInput(payload.end), pointInput(payload.start))
      : pointInput(payload.direction)
    const normal = multiply2(normalize2(perpendicular2(direction)), offsetDistance * lineSide(payload, options))
    const move = (point: unknown): Point3 => {
      const value = point3(point)
      return [value[0] + normal[0], value[1] + normal[1], value[2] ?? 0]
    }
    if (type === 'LINE') { payload.start = move(payload.start); payload.end = move(payload.end) }
    else payload.origin = move(payload.origin)
    return payload
  }
  if (['CIRCLE', 'ARC'].includes(type)) {
    const radius = Number(payload.radius) + radialSide(payload, options) * offsetDistance
    payload.radius = radius
    if (radius <= 1e-12) throw new KJValidationError('Offset collapses the circular entity')
    return payload
  }
  throw new KJValidationError(`Exact offset is not implemented for ${type || 'unknown entity'}`)
}

function splitParameters(values: readonly unknown[]): number[] {
  const result = [...new Set(values.map(Number).filter(Number.isFinite).map(value => Math.max(0, Math.min(1, value))).filter(value => value > 1e-10 && value < 1 - 1e-10))].sort((a, b) => a - b)
  if (!result.length) throw new KJValidationError('Break point must lie inside the entity')
  return result
}

function lineBreakParameters(payload: KJObjectPayload, options: KJBreakOptions): number[] {
  const direction = subtract2(pointInput(payload.end), pointInput(payload.start))
  const points = options.points ?? [options.firstPoint ?? options.point, options.secondPoint].filter(Boolean)
  return splitParameters(points.map(point => projectParameter2(pointInput(point), pointInput(payload.start), direction)))
}

function arcParameter(payload: KJObjectPayload, point: unknown): number {
  const angle = typeof point === 'number' ? point : (() => {
    const center = point3(payload.center), value = point3(point)
    return Math.atan2(value[1] - center[1], value[0] - center[0])
  })()
  const sweep = arcSweep(payload as ArcDefinition)
  const startAngle = Number(payload.startAngle)
  return sweep >= 0 ? positiveTurn(angle - startAngle) / sweep : positiveTurn(startAngle - angle) / -sweep
}

export function breakEntityPayloads(entity: KJEditingEntity | null | undefined, options: KJBreakOptions = {}): KJDerivedEntityPayload[] {
  const payload = payloadOf(entity), type = normalizeName(entity?.type)
  const points = options.points ?? [options.firstPoint ?? options.point, options.secondPoint].filter(value => value != null)
  if (type === 'LINE') {
    const parameters = lineBreakParameters(payload, { ...options, points })
    const start = point3(payload.start), end = point3(payload.end)
    const pointAt = (parameter: number): Point3 => [
      start[0] + (end[0] - start[0]) * parameter,
      start[1] + (end[1] - start[1]) * parameter,
      start[2] + (end[2] - start[2]) * parameter,
    ]
    if (parameters.length === 1) {
      const point = pointAt(parameters[0]!)
      return [{ type, payload: { ...payload, start: payload.start, end: point } }, { type, payload: { ...payload, start: point, end: payload.end } }]
    }
    return [{ type, payload: { ...payload, start: payload.start, end: pointAt(parameters[0]!) } }, { type, payload: { ...payload, start: pointAt(parameters.at(-1)!), end: payload.end } }]
  }
  if (type === 'ARC') {
    const parameters = splitParameters(points.map(point => arcParameter(payload, point)))
    const sweep = arcSweep(payload as ArcDefinition), angleAt = (parameter: number): number => Number(payload.startAngle) + sweep * parameter
    if (parameters.length === 1) {
      const angle = angleAt(parameters[0]!)
      return [{ type, payload: { ...payload, endAngle: angle } }, { type, payload: { ...payload, startAngle: angle } }]
    }
    return [{ type, payload: { ...payload, endAngle: angleAt(parameters[0]!) } }, { type, payload: { ...payload, startAngle: angleAt(parameters.at(-1)!) } }]
  }
  throw new KJValidationError(`Break is not implemented for ${type || 'unknown entity'}`)
}

function bulgeArc(startInput: unknown, endInput: unknown, bulgeInput: unknown): KJArcConnector['payload'] | null {
  const start = point3(startInput), end = point3(endInput), bulge = Number(bulgeInput ?? 0)
  if (Math.abs(bulge) <= 1e-15) return null
  if (Math.abs(start[2] - end[2]) > 1e-10) throw new KJValidationError('Explode requires bulge arc endpoints in one XY plane')
  const chordVector = subtract2(end, start), chord = length2(chordVector), unit = normalize2(chordVector)
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge)
  const center2 = add2(midpoint2(start, end), multiply2(perpendicular2(unit), centerOffset))
  const center: Point3 = [center2[0], center2[1], start[2]]
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  return { center, radius: distance2(center, start), startAngle, endAngle: startAngle + 4 * Math.atan(bulge), clockwise: bulge < 0, normal: [0, 0, 1] }
}

export function explodeEntity(entity: KJEditingEntity | null | undefined): KJDerivedEntityPayload[] {
  const payload = entity?.payload ?? {}, type = normalizeName(entity?.type)
  if (!['LWPOLYLINE', 'POLYLINE', 'REVISION_CLOUD', 'WIPEOUT'].includes(type)) throw new KJValidationError(`Explode is not implemented for ${type || 'unknown entity'}`)
  const vertices = (payload.vertices ?? []) as readonly unknown[]
  // Derived primitives keep drawing properties, not the source object's identity
  // or polyline-specific topology. Ownership remains a createEntity option.
  const drawingProperties: KJObjectPayload = {}
  for (const key of ['layerId', 'color', 'trueColor', 'linetypeId', 'linetypeName', 'linetypeScale', 'lineweight', 'transparency', 'visible', 'thickness', 'normal', 'elevation', 'materialId', 'plotStyleId']) {
    if (Object.hasOwn(payload, key)) drawingProperties[key] = clone(payload[key])
  }
  if (payload.normal != null) {
    const normal = point3(payload.normal)
    if (Math.abs(normal[0]) > 1e-12 || Math.abs(normal[1]) > 1e-12 || normal[2] <= 0) throw new KJValidationError('Explode currently requires a positive XY extrusion normal')
  }
  const points = vertices.map(vertex => point3((vertex as { readonly point?: unknown }).point ?? vertex))
  const elevation = Number(payload.elevation ?? 0)
  if (!Number.isFinite(elevation)) throw new KJValidationError('Polyline elevation must be finite')
  // Imported lightweight/2D polylines can store their plane only in elevation;
  // legacy or 3D vertices already carrying Z must never receive it twice.
  const useElevation = ['LWPOLYLINE', 'POLYLINE'].includes(type) && !(Number(payload.dxfFlags ?? 0) & 8)
    && elevation !== 0 && points.every(point => point[2] === 0)
  if (useElevation) for (const point of points) point[2] = elevation
  const count = payload.closed ? vertices.length : vertices.length - 1
  const result: KJDerivedEntityPayload[] = []
  for (let index = 0; index < count; index += 1) {
    const vertexRecord = vertices[index] as { readonly bulge?: unknown }
    const start = points[index]!, end = points[(index + 1) % points.length]!
    const arc = bulgeArc(start, end, vertexRecord.bulge)
    result.push(arc
      ? { type: 'ARC', payload: { ...clone(drawingProperties), ...arc } }
      : { type: 'LINE', payload: { ...clone(drawingProperties), start, end } })
  }
  return result
}

function boundaryIntersections(target: KJEditingEntity, boundary: KJEditingEntity, targetMode: LineDomain = 'line'): Point2[] {
  const targetPayload = target.payload ?? {}, boundaryPayload = boundary.payload ?? {}
  if (boundary.type === 'LINE') return intersectLineLine2(pointInput(targetPayload.start), pointInput(targetPayload.end), pointInput(boundaryPayload.start), pointInput(boundaryPayload.end), { modeA: targetMode, modeB: 'segment' }).points
  if (boundary.type === 'RAY' || boundary.type === 'XLINE') return intersectLineLine2(
    pointInput(targetPayload.start), pointInput(targetPayload.end), pointInput(boundaryPayload.origin),
    add2(pointInput(boundaryPayload.origin), pointInput(boundaryPayload.direction)),
    { modeA: targetMode, modeB: boundary.type === 'RAY' ? 'ray' : 'line' },
  ).points
  if (boundary.type === 'CIRCLE') return intersectLineCircle2(pointInput(targetPayload.start), pointInput(targetPayload.end), pointInput(boundaryPayload.center), Number(boundaryPayload.radius), { mode: targetMode }).points
  if (boundary.type === 'ARC') {
    const points = intersectLineCircle2(pointInput(targetPayload.start), pointInput(targetPayload.end), pointInput(boundaryPayload.center), Number(boundaryPayload.radius), { mode: targetMode }).points
    const sweep = arcSweep(boundaryPayload as ArcDefinition)
    const center = point3(boundaryPayload.center), startAngle = Number(boundaryPayload.startAngle)
    return points.filter(point => {
      const angle = Math.atan2(point[1] - center[1], point[0] - center[0])
      return sweep >= 0 ? positiveTurn(angle - startAngle) <= sweep + 1e-10 : positiveTurn(startAngle - angle) <= -sweep + 1e-10
    })
  }
  throw new KJValidationError(`Line boundary does not support ${String(boundary.type)}`)
}

function linePointAt(payload: KJObjectPayload | ReadonlyDeep<KJObjectPayload>, parameter: number): Point3 {
  const start = point3(payload.start), end = point3(payload.end)
  return [start[0] + (end[0] - start[0]) * parameter, start[1] + (end[1] - start[1]) * parameter, start[2] + (end[2] - start[2]) * parameter]
}

/** Remove the picked LINE interval, preserving both sides of an interior cut. */
export function trimLinePayloads(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload[] {
  if (target?.type !== 'LINE') throw new KJValidationError('Trim currently requires a LINE target')
  const targetPayload = payloadOf(target)
  const direction = subtract2(pointInput(targetPayload.end), pointInput(targetPayload.start))
  const pickParameter = projectParameter2(pointInput(pickPoint), pointInput(targetPayload.start), direction)
  const parameters = boundaries.flatMap(boundary => boundaryIntersections(target, boundary, 'segment'))
    .map(point => projectParameter2(point, pointInput(targetPayload.start), direction))
    .filter(value => value > 1e-10 && value < 1 - 1e-10)
    .sort((a, b) => a - b)
  const candidates = parameters.filter((value, index) => index === 0 || value - parameters[index - 1]! > 1e-10)
  if (!candidates.length) throw new KJValidationError('No trim intersection lies on the target segment')
  if (candidates.some(value => Math.abs(value - pickParameter) <= 1e-10)) throw new KJValidationError('Pick inside the interval to trim, not exactly on a cutting boundary')
  const lower = candidates.filter(value => value < pickParameter).at(-1) ?? 0
  const upper = candidates.find(value => value > pickParameter) ?? 1
  const pieces: KJObjectPayload[] = []
  if (lower > 0) pieces.push({ ...clone(targetPayload), start: linePointAt(targetPayload, 0), end: linePointAt(targetPayload, lower) })
  if (upper < 1) pieces.push({ ...clone(targetPayload), start: linePointAt(targetPayload, upper), end: linePointAt(targetPayload, 1) })
  return pieces
}

/** Single-result compatibility helper; use trimLinePayloads for interior cuts. */
export function trimLinePayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload {
  const pieces = trimLinePayloads(target, boundaries, pickPoint)
  if (pieces.length !== 1) throw new KJValidationError('Trim produces multiple line segments; use trimLinePayloads to preserve both sides')
  return pieces[0]!
}

export function extendLinePayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload {
  if (target?.type !== 'LINE') throw new KJValidationError('Extend currently requires a LINE target')
  const targetPayload = target.payload ?? {}
  const direction = subtract2(pointInput(targetPayload.end), pointInput(targetPayload.start))
  const pickParameter = projectParameter2(pointInput(pickPoint), pointInput(targetPayload.start), direction), extendStart = pickParameter < 0.5
  const candidates = boundaries.flatMap(boundary => boundaryIntersections(target, boundary, 'line'))
    .map(point => ({ parameter: projectParameter2(point, pointInput(targetPayload.start), direction) }))
    .filter(value => extendStart ? value.parameter < -1e-10 : value.parameter > 1 + 1e-10)
    .sort((a, b) => extendStart ? b.parameter - a.parameter : a.parameter - b.parameter)
  if (!candidates.length) throw new KJValidationError('No boundary is available in the selected extension direction')
  const payload = clone(targetPayload) as KJObjectPayload
  payload[extendStart ? 'start' : 'end'] = linePointAt(targetPayload, candidates[0]!.parameter)
  return payload
}

const EDIT_ANGLE_EPSILON = 1e-10
const EDIT_PLANE_EPSILON = 1e-8

interface CircularEditGeometry {
  payload: KJObjectPayload
  center: Point3
  radius: number
  start: number
  span: number
  direction: 1 | -1
  circle: boolean
}

function finiteEditPoint(value: unknown): Point3 {
  const point = point3(value)
  if (!point.every(Number.isFinite)) throw new KJValidationError('Editing coordinates must be finite')
  return point
}

function assertEditingXYPlane(payload: KJObjectPayload): void {
  const normal = finiteEditPoint(payload.normal ?? [0, 0, 1])
  if (Math.abs(normal[0]) > 1e-12 || Math.abs(normal[1]) > 1e-12 || normal[2] <= 0) {
    throw new KJValidationError('Circular editing requires a positive XY extrusion normal')
  }
}

function circularEditGeometry(entity: KJEditingEntity, boundary = false): CircularEditGeometry {
  const payload = payloadOf(entity), circle = entity.type === 'CIRCLE'
  assertEditingXYPlane(payload)
  const center = finiteEditPoint(payload.center), radius = positive(payload.radius, 'Circular radius')
  const start = circle ? 0 : Number(payload.startAngle), end = circle ? TURN : Number(payload.endAngle)
  if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs(end - start) > TURN + EDIT_ANGLE_EPSILON) {
    throw new KJValidationError('Circular editing requires finite angles spanning at most one turn')
  }
  const direction = !circle && payload.clockwise ? -1 : 1
  const span = circle ? TURN : Math.abs(arcSweep(payload as ArcDefinition))
  if (span <= EDIT_ANGLE_EPSILON || (!circle && !boundary && span >= TURN - EDIT_ANGLE_EPSILON)) {
    throw new KJValidationError('Arc editing requires a non-empty, less-than-full-circle sweep')
  }
  return { payload, center, radius, start, span, direction, circle }
}

function circularOffset(geometry: CircularEditGeometry, point: Point2 | Point3): number {
  const angle = Math.atan2(point[1] - geometry.center[1], point[0] - geometry.center[0])
  const offset = positiveTurn(geometry.direction * (angle - geometry.start))
  return TURN - offset <= EDIT_ANGLE_EPSILON ? 0 : offset
}

function circularPickOffset(geometry: CircularEditGeometry, pickPoint: unknown): number {
  const point = finiteEditPoint(pickPoint)
  if (distance2(point, geometry.center) <= Math.max(1e-10, geometry.radius * 1e-12)) {
    throw new KJValidationError('Pick a point on the circular portion, not its center')
  }
  const offset = circularOffset(geometry, point)
  if (!geometry.circle && offset > geometry.span + EDIT_ANGLE_EPSILON) {
    throw new KJValidationError('Pick must lie within the target arc sweep')
  }
  return !geometry.circle && Math.abs(offset - geometry.span) <= EDIT_ANGLE_EPSILON ? geometry.span : offset
}

function assertSameEditPlane(point: Point3, elevation: number): void {
  if (Math.abs(point[2] - elevation) > EDIT_PLANE_EPSILON) {
    throw new KJValidationError('Circular target and boundaries must lie in the same XY plane')
  }
}

function circularBoundaryIntersections(target: CircularEditGeometry, boundary: KJEditingEntity): Point2[] {
  const payload = payloadOf(boundary), type = boundary.type
  if (type === 'LINE' || type === 'RAY' || type === 'XLINE') {
    const start = finiteEditPoint(type === 'LINE' ? payload.start : payload.origin)
    const direction = type === 'LINE' ? subtract2(pointInput(payload.end), start) : vec2(pointInput(payload.direction))
    assertSameEditPlane(start, target.center[2])
    if (type === 'LINE') assertSameEditPlane(finiteEditPoint(payload.end), target.center[2])
    else if (Math.abs(finiteEditPoint(payload.direction)[2]) > EDIT_PLANE_EPSILON) {
      throw new KJValidationError('Circular editing requires boundary directions in the XY plane')
    }
    assertEditingXYPlane(payload)
    const magnitude = Math.hypot(direction[0], direction[1])
    if (!Number.isFinite(magnitude) || magnitude === 0) throw new KJValidationError('Circular boundary requires a non-zero finite XY direction')
    const unit: Point2 = [direction[0] / magnitude, direction[1] / magnitude]
    // Solve near a unit circle rather than squaring enormous line endpoints or
    // interpreting a tiny RAY direction magnitude as a degenerate direction.
    const relative = subtract2(target.center, start)
    const signedDistance = cross2(unit, relative) / target.radius
    if (Math.abs(signedDistance) > 1 + EDIT_ANGLE_EPSILON) return []
    const nearest: Point2 = [unit[1] * signedDistance, -unit[0] * signedDistance]
    const intersections = intersectLineCircle2(nearest, add2(nearest, unit), [0, 0], 1, { mode: 'line' }).points
    return intersections.filter(point => {
      const along = dot2(relative, unit) + dot2(point, unit) * target.radius
      return type === 'XLINE' || (along >= -EDIT_PLANE_EPSILON && (type === 'RAY' || along <= magnitude + EDIT_PLANE_EPSILON))
    }).map(point => [target.center[0] + point[0] * target.radius, target.center[1] + point[1] * target.radius])
  }
  if (type === 'CIRCLE' || type === 'ARC') {
    const other = circularEditGeometry(boundary, true)
    assertSameEditPlane(other.center, target.center[2])
    const result = intersectCircleCircle2(target.center, target.radius, other.center, other.radius)
    if (result.kind === 'overlap') throw new KJValidationError('Coincident circular boundaries do not define an unambiguous cut')
    return other.circle ? result.points : result.points.filter(point => circularOffset(other, point) <= other.span + EDIT_ANGLE_EPSILON)
  }
  throw new KJValidationError(`Circular boundary does not support ${String(type)}`)
}

function circularCutOffsets(target: CircularEditGeometry, boundaries: readonly KJEditingEntity[]): number[] {
  const offsets = boundaries.flatMap(boundary => circularBoundaryIntersections(target, boundary))
    .map(point => circularOffset(target, point)).sort((a, b) => a - b)
  return offsets.filter((value, index) => index === 0 || value - offsets[index - 1]! > EDIT_ANGLE_EPSILON)
}

function rejectExactCircularCut(pick: number, cuts: readonly number[]): void {
  if (cuts.some(cut => Math.min(Math.abs(cut - pick), TURN - Math.abs(cut - pick)) <= EDIT_ANGLE_EPSILON)) {
    throw new KJValidationError('Pick inside the interval, not exactly on a cutting boundary')
  }
}

function circularResultPayload(geometry: CircularEditGeometry, first: number, last: number): KJObjectPayload {
  const payload = clone(geometry.payload)
  // Geometry has changed (and a circle may become an arc); old entity tags must
  // never replay the original full circle or stale angle records on export.
  for (const key of ['rawTags', 'rawData', 'originalType', 'fullCircle']) delete payload[key]
  return { ...payload, center: [...geometry.center], radius: geometry.radius,
    startAngle: positiveTurn(geometry.start + geometry.direction * first),
    endAngle: positiveTurn(geometry.start + geometry.direction * last), clockwise: geometry.direction < 0 }
}

function rejectAmbiguousLineBoundaries(target: KJEditingEntity, boundaries: readonly KJEditingEntity[], mode: LineDomain): void {
  const payload = payloadOf(target)
  for (const boundary of boundaries) {
    const other = payloadOf(boundary)
    if (boundary.type === 'CIRCLE' || boundary.type === 'ARC') assertEditingXYPlane(other)
    if (!['LINE', 'RAY', 'XLINE'].includes(String(boundary.type))) continue
    const start = boundary.type === 'LINE' ? pointInput(other.start) : pointInput(other.origin)
    const end = boundary.type === 'LINE' ? pointInput(other.end) : add2(start, pointInput(other.direction))
    const result = intersectLineLine2(pointInput(payload.start), pointInput(payload.end), start, end,
      { modeA: mode, modeB: boundary.type === 'LINE' ? 'segment' : boundary.type === 'RAY' ? 'ray' : 'line' })
    if (result.kind === 'overlap') {
      const direction = subtract2(pointInput(payload.end), pointInput(payload.start))
      const first = projectParameter2(start, pointInput(payload.start), direction)
      const last = projectParameter2(end, pointInput(payload.start), direction)
      const lower = boundary.type === 'XLINE' || (boundary.type === 'RAY' && last < first) ? -Infinity : Math.min(first, last)
      const upper = boundary.type === 'XLINE' || (boundary.type === 'RAY' && last > first) ? Infinity : Math.max(first, last)
      // The primitive reports collinear rays as infinite overlap. Intersect the
      // actual parameter domains before rejecting an unrelated, outward ray.
      const overlapStart = Math.max(mode === 'segment' ? 0 : -Infinity, boundary.type === 'RAY' && last > first ? first : lower)
      const overlapEnd = Math.min(mode === 'segment' ? 1 : Infinity, boundary.type === 'RAY' && last < first ? first : upper)
      if (overlapEnd - overlapStart > EDIT_ANGLE_EPSILON) throw new KJValidationError('Overlapping line boundaries do not define an unambiguous cut')
    }
  }
}

/** Remove the picked LINE/ARC interval, or replace a cut CIRCLE with its remaining ARC. */
export function trimEntityPayloads(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJDerivedEntityPayload[] {
  if (target?.type === 'LINE') {
    rejectAmbiguousLineBoundaries(target, boundaries, 'segment')
    return trimLinePayloads(target, boundaries, pickPoint).map(payload => ({ type: 'LINE', payload }))
  }
  if (target?.type !== 'ARC' && target?.type !== 'CIRCLE') throw new KJValidationError('Trim requires a LINE, ARC or CIRCLE target')
  const geometry = circularEditGeometry(target), pick = circularPickOffset(geometry, pickPoint)
  const cuts = circularCutOffsets(geometry, boundaries)
  rejectExactCircularCut(pick, cuts)
  if (geometry.circle) {
    if (cuts.length < 2) throw new KJValidationError('Circle trim requires at least two distinct cutting points')
    const lower = cuts.filter(value => value < pick).at(-1) ?? cuts.at(-1)! - TURN
    const upper = cuts.find(value => value > pick) ?? cuts[0]! + TURN
    return [{ type: 'ARC', payload: circularResultPayload(geometry, upper, lower + TURN) }]
  }
  const interior = cuts.filter(value => value > EDIT_ANGLE_EPSILON && value < geometry.span - EDIT_ANGLE_EPSILON)
  if (!interior.length) throw new KJValidationError('No trim intersection lies inside the target arc')
  const lower = interior.filter(value => value < pick).at(-1) ?? 0
  const upper = interior.find(value => value > pick) ?? geometry.span
  const pieces: KJDerivedEntityPayload[] = []
  if (lower > EDIT_ANGLE_EPSILON) pieces.push({ type: 'ARC', payload: circularResultPayload(geometry, 0, lower) })
  if (upper < geometry.span - EDIT_ANGLE_EPSILON) pieces.push({ type: 'ARC', payload: circularResultPayload(geometry, upper, geometry.span) })
  return pieces
}

/** Extend the picked end of a LINE or ARC to the nearest boundary in its continuation domain. */
export function extendEntityPayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload {
  if (target?.type === 'LINE') {
    rejectAmbiguousLineBoundaries(target, boundaries, 'line')
    return extendLinePayload(target, boundaries, pickPoint)
  }
  if (target?.type !== 'ARC') throw new KJValidationError('Extend requires a LINE or ARC target')
  const geometry = circularEditGeometry(target), pick = circularPickOffset(geometry, pickPoint)
  if (Math.abs(pick - geometry.span / 2) <= EDIT_ANGLE_EPSILON) throw new KJValidationError('Pick closer to the arc end to extend, not its midpoint')
  const cuts = circularCutOffsets(geometry, boundaries)
  rejectExactCircularCut(pick, cuts)
  const outside = cuts.filter(value => value > geometry.span + EDIT_ANGLE_EPSILON && value < TURN - EDIT_ANGLE_EPSILON)
  if (!outside.length) throw new KJValidationError('No boundary is available before the arc reaches its opposite end')
  return pick < geometry.span / 2
    ? circularResultPayload(geometry, outside.at(-1)! - TURN, geometry.span)
    : circularResultPayload(geometry, 0, outside[0]!)
}

interface SelectedRay {
  direction: Point2
  keepEnd: boolean
}

function selectedRay(line: KJEditingEntity, intersection: Point2Input, pickPoint: unknown): SelectedRay {
  const payload = line.payload ?? {}
  const direction = normalize2(subtract2(pointInput(payload.end), pointInput(payload.start)))
  let sign: 1 | -1
  if (pickPoint) sign = dot2(subtract2(pointInput(pickPoint), intersection), direction) >= 0 ? 1 : -1
  else sign = distance2(pointInput(payload.end), intersection) >= distance2(pointInput(payload.start), intersection) ? 1 : -1
  return { direction: multiply2(direction, sign), keepEnd: sign > 0 }
}

function trimmedLine(line: KJEditingEntity, tangent: Point2Input, ray: SelectedRay): KJObjectPayload {
  const payload = payloadOf(line)
  payload[ray.keepEnd ? 'start' : 'end'] = point3(tangent)
  return payload
}

function linePairContext(first: KJEditingEntity | null | undefined, second: KJEditingEntity | null | undefined, options: KJLinePairOptions): { intersection: Point2; firstRay: SelectedRay; secondRay: SelectedRay } {
  if (first?.type !== 'LINE' || second?.type !== 'LINE') throw new KJValidationError('Operation requires two LINE entities')
  const firstPayload = first.payload ?? {}, secondPayload = second.payload ?? {}
  const intersectionResult = intersectLineLine2(pointInput(firstPayload.start), pointInput(firstPayload.end), pointInput(secondPayload.start), pointInput(secondPayload.end), { modeA: 'line', modeB: 'line' })
  const intersection = intersectionResult.points[0]
  if (!intersection) throw new KJValidationError('Lines are parallel and do not define a corner')
  return { intersection, firstRay: selectedRay(first, intersection, options.pickPoint1), secondRay: selectedRay(second, intersection, options.pickPoint2) }
}

export function chamferLinePair(first: KJEditingEntity, second: KJEditingEntity, options: KJLinePairOptions = {}): KJLinePairEditResult {
  const distance1 = Number(options.distance1 ?? options.distance ?? 0), distance2Value = Number(options.distance2 ?? options.distance ?? distance1)
  if (![distance1, distance2Value].every(value => Number.isFinite(value) && value >= 0)) throw new KJValidationError('Chamfer distances must be non-negative finite numbers')
  const context = linePairContext(first, second, options)
  const firstPoint = add2(context.intersection, multiply2(context.firstRay.direction, distance1))
  const secondPoint = add2(context.intersection, multiply2(context.secondRay.direction, distance2Value))
  return {
    first: trimmedLine(first, firstPoint, context.firstRay),
    second: trimmedLine(second, secondPoint, context.secondRay),
    connector: { type: 'LINE', payload: { start: point3(firstPoint), end: point3(secondPoint) } },
  }
}

export function filletLinePair(first: KJEditingEntity, second: KJEditingEntity, options: KJLinePairOptions = {}): KJLinePairEditResult {
  const radius = positive(options.radius, 'Fillet radius'), context = linePairContext(first, second, options)
  const cosine = Math.max(-1, Math.min(1, dot2(context.firstRay.direction, context.secondRay.direction)))
  const angle = Math.acos(cosine)
  if (angle <= 1e-8 || Math.abs(Math.PI - angle) <= 1e-8) throw new KJValidationError('Fillet requires two non-collinear rays')
  const tangentDistance = radius / Math.tan(angle / 2)
  const firstPoint = add2(context.intersection, multiply2(context.firstRay.direction, tangentDistance))
  const secondPoint = add2(context.intersection, multiply2(context.secondRay.direction, tangentDistance))
  const bisector = normalize2(add2(context.firstRay.direction, context.secondRay.direction))
  const center = add2(context.intersection, multiply2(bisector, radius / Math.sin(angle / 2)))
  const startAngle = Math.atan2(firstPoint[1] - center[1], firstPoint[0] - center[0]), endAngle = Math.atan2(secondPoint[1] - center[1], secondPoint[0] - center[0])
  return {
    first: trimmedLine(first, firstPoint, context.firstRay),
    second: trimmedLine(second, secondPoint, context.secondRay),
    connector: { type: 'ARC', payload: { center: point3(center), radius, startAngle, endAngle, clockwise: cross2(subtract2(firstPoint, center), subtract2(secondPoint, center)) < 0, normal: [0, 0, 1] } },
  }
}
