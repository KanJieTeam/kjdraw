import { KJValidationError } from './errors.js'
import {
  add2,
  arcSweep,
  cross2,
  distance2,
  dot2,
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
  const chordVector = subtract2(end, start), chord = length2(chordVector), unit = normalize2(chordVector)
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge)
  const center2 = add2(midpoint2(start, end), multiply2(perpendicular2(unit), centerOffset))
  const center: Point3 = [center2[0], center2[1], (start[2] + end[2]) / 2]
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  return { center, radius: distance2(center, start), startAngle, endAngle: startAngle + 4 * Math.atan(bulge), clockwise: bulge < 0, normal: [0, 0, 1] }
}

export function explodeEntity(entity: KJEditingEntity | null | undefined): KJDerivedEntityPayload[] {
  const payload = entity?.payload ?? {}, type = normalizeName(entity?.type)
  if (!['LWPOLYLINE', 'POLYLINE', 'REVISION_CLOUD', 'WIPEOUT'].includes(type)) throw new KJValidationError(`Explode is not implemented for ${type || 'unknown entity'}`)
  const vertices = (payload.vertices ?? []) as readonly unknown[]
  const count = payload.closed ? vertices.length : vertices.length - 1
  const result: KJDerivedEntityPayload[] = []
  for (let index = 0; index < count; index += 1) {
    const vertex = vertices[index]!, next = vertices[(index + 1) % vertices.length]!
    const vertexRecord = vertex as { readonly point?: unknown; readonly bulge?: unknown }
    const nextRecord = next as { readonly point?: unknown }
    const start = point3(vertexRecord.point ?? vertex), end = point3(nextRecord.point ?? next)
    const arc = bulgeArc(start, end, vertexRecord.bulge)
    result.push(arc ? { type: 'ARC', payload: arc } : { type: 'LINE', payload: { start, end } })
  }
  return result
}

function boundaryIntersections(target: KJEditingEntity, boundary: KJEditingEntity, targetMode: LineDomain = 'line'): Point2[] {
  const targetPayload = target.payload ?? {}, boundaryPayload = boundary.payload ?? {}
  if (boundary.type === 'LINE') return intersectLineLine2(pointInput(targetPayload.start), pointInput(targetPayload.end), pointInput(boundaryPayload.start), pointInput(boundaryPayload.end), { modeA: targetMode, modeB: 'segment' }).points
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

export function trimLinePayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload {
  if (target?.type !== 'LINE') throw new KJValidationError('Trim currently requires a LINE target')
  const targetPayload = target.payload ?? {}
  const direction = subtract2(pointInput(targetPayload.end), pointInput(targetPayload.start))
  const pickParameter = projectParameter2(pointInput(pickPoint), pointInput(targetPayload.start), direction)
  const candidates = boundaries.flatMap(boundary => boundaryIntersections(target, boundary, 'segment'))
    .map(point => ({ point: point3(point), parameter: projectParameter2(point, pointInput(targetPayload.start), direction) }))
    .filter(value => value.parameter > 1e-10 && value.parameter < 1 - 1e-10)
    .sort((a, b) => Math.abs(a.parameter - pickParameter) - Math.abs(b.parameter - pickParameter))
  if (!candidates.length) throw new KJValidationError('No trim intersection lies on the target segment')
  const payload = clone(targetPayload) as KJObjectPayload, intersection = candidates[0]!
  if (pickParameter <= intersection.parameter) payload.start = intersection.point
  else payload.end = intersection.point
  return payload
}

export function extendLinePayload(target: KJEditingEntity | null | undefined, boundaries: readonly KJEditingEntity[], pickPoint: unknown): KJObjectPayload {
  if (target?.type !== 'LINE') throw new KJValidationError('Extend currently requires a LINE target')
  const targetPayload = target.payload ?? {}
  const direction = subtract2(pointInput(targetPayload.end), pointInput(targetPayload.start))
  const pickParameter = projectParameter2(pointInput(pickPoint), pointInput(targetPayload.start), direction), extendStart = pickParameter < 0.5
  const candidates = boundaries.flatMap(boundary => boundaryIntersections(target, boundary, 'line'))
    .map(point => ({ point: point3(point), parameter: projectParameter2(point, pointInput(targetPayload.start), direction) }))
    .filter(value => extendStart ? value.parameter < -1e-10 : value.parameter > 1 + 1e-10)
    .sort((a, b) => extendStart ? b.parameter - a.parameter : a.parameter - b.parameter)
  if (!candidates.length) throw new KJValidationError('No boundary is available in the selected extension direction')
  const payload = clone(targetPayload) as KJObjectPayload
  payload[extendStart ? 'start' : 'end'] = candidates[0]!.point
  return payload
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
