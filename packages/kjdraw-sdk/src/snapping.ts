import { KJValidationError } from './errors.js'
import {
  add2,
  arcSweep,
  closestPointOnCircle2,
  closestPointOnSegment2,
  distance2,
  intersectCircleCircle2,
  intersectLineCircle2,
  intersectLineLine2,
  lengthSquared2,
  lerp2,
  midpoint2,
  multiply2,
  perpendicular2,
  projectParameter2,
  subtract2,
  vec2,
} from './geometry/index.js'
import type { KJDocument } from './document.js'
import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js'

export const KJ_SNAP_MODES = Object.freeze([
  'endpoint', 'midpoint', 'center', 'quadrant', 'insertion', 'node', 'nearest', 'intersection',
] as const)

export type KJSnapMode = typeof KJ_SNAP_MODES[number]
export type KJSnapPointInput = readonly number[] | { x: number; y: number; z?: number }
export type KJSnapPoint = [number, number, number]

export interface KJSnapCandidate extends Record<string, unknown> {
  mode: KJSnapMode
  point: readonly [number, number, number]
  entityIds: readonly string[]
  distance: number
  role?: string
  vertexIndex?: number
  segmentIndex?: number
  parameter?: number
  angle?: number
}

export interface KJSnapOptions {
  radius?: number
  modes?: readonly string[]
  entityIds?: readonly string[]
  maxIntersectionPairs?: number
}

interface SnapVertex extends Record<string, unknown> {
  point: KJSnapPointInput
  bulge?: number
}

interface SnapPayload extends KJObjectPayload {
  start: KJSnapPointInput
  end: KJSnapPointInput
  origin: KJSnapPointInput
  direction: KJSnapPointInput
  center: KJSnapPointInput
  position: KJSnapPointInput
  radius: number
  startAngle: number
  endAngle: number
  clockwise?: boolean
  vertices?: Array<KJSnapPointInput | SnapVertex>
  closed?: boolean
  fitPoints?: KJSnapPointInput[]
  controlPoints?: KJSnapPointInput[]
}

type LineMode = 'segment' | 'ray' | 'line'

interface LinePrimitive {
  kind: 'line'
  start: KJSnapPointInput
  end: KJSnapPointInput
  mode: LineMode
  entityId: string
  segmentIndex?: number
}

interface CirclePrimitive {
  kind: 'circle'
  center: KJSnapPointInput
  radius: number
  entityId: string
  segmentIndex?: number
}

interface ArcPrimitive {
  kind: 'arc'
  center: KJSnapPointInput
  radius: number
  startAngle: number
  sweep: number
  entityId: string
  segmentIndex?: number
}

type SnapPrimitive = LinePrimitive | CirclePrimitive | ArcPrimitive

interface NearestPoint {
  point: KJSnapPointInput
  distance: number
  parameter?: number
  angle?: number
}

interface PrimitiveIntersection {
  kind: string
  points: KJSnapPointInput[]
  infinite?: boolean
}

interface MutableSnapCandidate extends Record<string, unknown> {
  mode: KJSnapMode
  point: KJSnapPoint
  entityIds: string[]
  distance?: number
  role?: string
  vertexIndex?: number
  segmentIndex?: number
  parameter?: number
  angle?: number
}

const TURN = Math.PI * 2

const point3 = (point: KJSnapPointInput): KJSnapPoint => {
  const record = point as { x: number; y: number; z?: number }
  const value = Array.isArray(point) ? point : [record.x, record.y, record.z ?? 0]
  return [Number(value[0]), Number(value[1]), Number(value[2] ?? 0)]
}

const pointAt = (center: KJSnapPointInput, radius: number, angle: number): KJSnapPoint => {
  const value = point3(center)
  return [value[0] + radius * Math.cos(angle), value[1] + radius * Math.sin(angle), value[2]]
}

function positiveTurn(value: number): number {
  value %= TURN
  return value < 0 ? value + TURN : value
}

function angleOnArc(angle: number, arc: ArcPrimitive, epsilon = 1e-10): boolean {
  const sweep = arc.sweep
  return sweep >= 0
    ? positiveTurn(angle - arc.startAngle) <= sweep + epsilon
    : positiveTurn(arc.startAngle - angle) <= -sweep + epsilon
}

function bulgeArc(startInput: KJSnapPointInput, endInput: KJSnapPointInput, bulgeInput: number | undefined, entityId: string, segmentIndex: number): ArcPrimitive | null {
  const start = point3(startInput), end = point3(endInput), bulge = Number(bulgeInput ?? 0)
  if (!Number.isFinite(bulge) || Math.abs(bulge) <= 1e-15) return null
  const chordVector = subtract2(end, start)
  const chord = Math.sqrt(lengthSquared2(chordVector))
  if (chord <= 1e-15) return null
  const unit = multiply2(chordVector, 1 / chord)
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge)
  const center2 = add2(midpoint2(start, end), multiply2(perpendicular2(unit), centerOffset))
  const center: KJSnapPoint = [center2[0], center2[1], (start[2] + end[2]) / 2]
  const sweep = 4 * Math.atan(bulge)
  return { kind: 'arc', center, radius: distance2(center, start), startAngle: Math.atan2(start[1] - center[1], start[0] - center[0]), sweep, entityId, segmentIndex }
}

function vertexPoint(vertex: KJSnapPointInput | SnapVertex): KJSnapPointInput {
  return Array.isArray(vertex) || !('point' in vertex) ? vertex as KJSnapPointInput : vertex.point
}

function primitiveSegments(entity: KJReadonlyObjectRecord): SnapPrimitive[] {
  const payload = entity.payload as unknown as SnapPayload, id = entity.id
  switch (entity.type) {
    case 'LINE': return [{ kind: 'line', start: payload.start, end: payload.end, mode: 'segment', entityId: id }]
    case 'RAY': return [{ kind: 'line', start: payload.origin, end: add2(payload.origin, payload.direction), mode: 'ray', entityId: id }]
    case 'XLINE': return [{ kind: 'line', start: payload.origin, end: add2(payload.origin, payload.direction), mode: 'line', entityId: id }]
    case 'CIRCLE': return [{ kind: 'circle', center: payload.center, radius: payload.radius, entityId: id }]
    case 'ARC': return [{ kind: 'arc', center: payload.center, radius: payload.radius, startAngle: payload.startAngle, sweep: arcSweep(payload), entityId: id }]
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vertices = payload.vertices ?? [], count = payload.closed ? vertices.length : vertices.length - 1
      const result: SnapPrimitive[] = []
      for (let index = 0; index < count; index += 1) {
        const vertex = vertices[index]!, next = vertices[(index + 1) % vertices.length]!
        const start = vertexPoint(vertex), end = vertexPoint(next)
        const bulge = Array.isArray(vertex) ? undefined : (vertex as SnapVertex).bulge
        result.push(bulgeArc(start, end, bulge, id, index) ?? { kind: 'line', start, end, mode: 'segment', entityId: id, segmentIndex: index })
      }
      return result
    }
    case 'SOLID':
    case 'TRACE': {
      const vertices = payload.vertices ?? [], result: SnapPrimitive[] = []
      for (let index = 0; index < vertices.length; index += 1) result.push({ kind: 'line', start: vertexPoint(vertices[index]!), end: vertexPoint(vertices[(index + 1) % vertices.length]!), mode: 'segment', entityId: id, segmentIndex: index })
      return result
    }
    default: return []
  }
}

function arcEndpoints(arc: ArcPrimitive): [KJSnapPoint, KJSnapPoint] {
  return [pointAt(arc.center, arc.radius, arc.startAngle), pointAt(arc.center, arc.radius, arc.startAngle + arc.sweep)]
}

function nearestOnLine(cursor: KJSnapPointInput, primitive: LinePrimitive): NearestPoint {
  if (primitive.mode === 'segment') return closestPointOnSegment2(cursor, primitive.start, primitive.end)
  const direction = subtract2(primitive.end, primitive.start)
  let parameter = projectParameter2(cursor, primitive.start, direction)
  if (primitive.mode === 'ray') parameter = Math.max(0, parameter)
  const point = add2(primitive.start, multiply2(direction, parameter))
  return { point, parameter, distance: distance2(cursor, point) }
}

function nearestOnPrimitive(cursor: KJSnapPointInput, primitive: SnapPrimitive): NearestPoint {
  if (primitive.kind === 'line') return nearestOnLine(cursor, primitive)
  const radial = closestPointOnCircle2(cursor, primitive.center, primitive.radius)
  if (primitive.kind === 'circle' || angleOnArc(radial.angle, primitive)) return radial
  const nearest = arcEndpoints(primitive).map(point => ({ point, distance: distance2(cursor, point) })).sort((a, b) => a.distance - b.distance)[0]
  if (!nearest) throw new KJValidationError('Arc has no endpoints')
  return nearest
}

function baseCandidates(entity: KJReadonlyObjectRecord, modes: ReadonlySet<KJSnapMode>, cursor: KJSnapPointInput): MutableSnapCandidate[] {
  const payload = entity.payload as unknown as SnapPayload, result: MutableSnapCandidate[] = []
  const add = (mode: KJSnapMode, point: KJSnapPointInput, detail: Record<string, unknown> = {}): void => {
    result.push({ mode, point: point3(point), entityIds: [entity.id], ...detail })
  }
  const primitives = primitiveSegments(entity)
  if (modes.has('endpoint')) {
    if (['LINE'].includes(entity.type)) { add('endpoint', payload.start, { role: 'start' }); add('endpoint', payload.end, { role: 'end' }) }
    if (['RAY', 'XLINE'].includes(entity.type)) add('endpoint', payload.origin, { role: 'origin' })
    if (entity.type === 'ARC') {
      const primitive = primitives[0]
      if (primitive?.kind === 'arc') { const [start, end] = arcEndpoints(primitive); add('endpoint', start, { role: 'start' }); add('endpoint', end, { role: 'end' }) }
    }
    if (['LWPOLYLINE', 'POLYLINE'].includes(entity.type)) for (const [index, vertex] of (payload.vertices ?? []).entries()) add('endpoint', vertexPoint(vertex), { vertexIndex: index })
    if (['SOLID', 'TRACE'].includes(entity.type)) for (const [index, point] of (payload.vertices ?? []).entries()) add('endpoint', vertexPoint(point), { vertexIndex: index })
    if (entity.type === 'SPLINE') {
      const points = payload.fitPoints?.length ? payload.fitPoints : payload.controlPoints
      if (points?.length) { add('endpoint', points[0]!, { role: 'start' }); add('endpoint', points.at(-1)!, { role: 'end' }) }
    }
  }
  if (modes.has('midpoint')) for (const primitive of primitives.filter(value => value.kind !== 'circle')) {
    const point = primitive.kind === 'line' ? midpoint2(primitive.start, primitive.end) : pointAt(primitive.center, primitive.radius, primitive.startAngle + primitive.sweep / 2)
    add('midpoint', point, { segmentIndex: primitive.segmentIndex })
  }
  if (modes.has('center') && ['CIRCLE', 'ARC', 'ELLIPSE'].includes(entity.type)) add('center', payload.center)
  if (modes.has('quadrant') && ['CIRCLE', 'ARC'].includes(entity.type)) for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const primitive = primitives[0]
    if (primitive?.kind === 'circle' || primitive?.kind === 'arc' && angleOnArc(angle, primitive)) add('quadrant', pointAt(payload.center, payload.radius, angle), { angle })
  }
  if (modes.has('insertion') && ['INSERT', 'TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB', 'IMAGE', 'TABLE'].includes(entity.type)) add('insertion', payload.position)
  if (modes.has('node') && entity.type === 'POINT') add('node', payload.position)
  if (modes.has('nearest')) {
    const nearest = primitives.map(primitive => ({ ...nearestOnPrimitive(cursor, primitive), primitive })).sort((a, b) => a.distance - b.distance)[0]
    if (nearest) add('nearest', nearest.point, { segmentIndex: nearest.primitive.segmentIndex, parameter: nearest.parameter })
  }
  return result
}

function accepts(primitive: SnapPrimitive, point: KJSnapPointInput): boolean {
  if (primitive.kind !== 'arc') return true
  const center = point3(primitive.center), value = point3(point)
  return angleOnArc(Math.atan2(value[1] - center[1], value[0] - center[0]), primitive)
}

function primitiveIntersection(a: SnapPrimitive, b: SnapPrimitive): PrimitiveIntersection {
  let result: PrimitiveIntersection
  if (a.kind === 'line' && b.kind === 'line') result = intersectLineLine2(a.start, a.end, b.start, b.end, { modeA: a.mode, modeB: b.mode })
  else if (a.kind === 'line' && (b.kind === 'circle' || b.kind === 'arc')) result = intersectLineCircle2(a.start, a.end, b.center, b.radius, { mode: a.mode })
  else if (b.kind === 'line' && (a.kind === 'circle' || a.kind === 'arc')) result = intersectLineCircle2(b.start, b.end, a.center, a.radius, { mode: b.mode })
  else {
    const left = a as CirclePrimitive | ArcPrimitive, right = b as CirclePrimitive | ArcPrimitive
    result = intersectCircleCircle2(left.center, left.radius, right.center, right.radius)
  }
  return {
    ...result,
    points: (result.points ?? []).filter(point => accepts(a, point) && accepts(b, point)),
  }
}

function intersectionCandidates(entities: ReadonlyArray<KJReadonlyObjectRecord>, cursor: KJSnapPointInput, maxPairs: number): MutableSnapCandidate[] {
  const primitives = entities.flatMap(primitiveSegments), result: MutableSnapCandidate[] = []
  let pairs = 0
  for (let left = 0; left < primitives.length; left += 1) for (let right = left + 1; right < primitives.length; right += 1) {
    const a = primitives[left]!, b = primitives[right]!
    if (a.entityId === b.entityId || ++pairs > maxPairs) continue
    for (const point of primitiveIntersection(a, b).points) result.push({ mode: 'intersection', point: point3(point), entityIds: [a.entityId, b.entityId], distance: distance2(cursor, point) })
  }
  return result
}

export function findSnapCandidates(document: KJDocument, cursorInput: KJSnapPointInput, options: KJSnapOptions = {}): readonly Readonly<KJSnapCandidate>[] {
  if (!document?.listEntities) throw new KJValidationError('Snapping requires a KJDocument')
  const cursor = vec2(cursorInput, 'cursor')
  const radius = Number(options.radius ?? Infinity)
  if (!(radius > 0)) throw new KJValidationError('Snap radius must be positive')
  const modes = new Set((options.modes ?? KJ_SNAP_MODES).map(value => String(value).toLowerCase() as KJSnapMode))
  for (const mode of modes) if (!KJ_SNAP_MODES.includes(mode)) throw new KJValidationError(`Unsupported snap mode: ${mode}`)
  const allowed = options.entityIds ? new Set(options.entityIds.map(String)) : null
  const entities = document.listEntities().filter(entity => !allowed || allowed.has(entity.id))
  let candidates = entities.flatMap(entity => baseCandidates(entity, modes, cursor))
    .map(candidate => ({ ...candidate, distance: candidate.distance ?? distance2(cursor, candidate.point) }))
  if (modes.has('intersection')) candidates.push(...intersectionCandidates(entities, cursor, Number(options.maxIntersectionPairs ?? 10000)).map(candidate => ({ ...candidate, distance: candidate.distance ?? distance2(cursor, candidate.point) })))
  candidates = candidates.filter(candidate => candidate.distance <= radius)
  candidates.sort((a, b) => a.distance - b.distance || KJ_SNAP_MODES.indexOf(a.mode) - KJ_SNAP_MODES.indexOf(b.mode))
  const unique: Readonly<KJSnapCandidate>[] = []
  for (const candidate of candidates) {
    const duplicate = unique.some(value => value.mode === candidate.mode && distance2(value.point, candidate.point) <= 1e-9 && value.entityIds.join('|') === candidate.entityIds.join('|'))
    if (!duplicate) unique.push(Object.freeze({ ...candidate, point: Object.freeze(candidate.point), entityIds: Object.freeze(candidate.entityIds) }))
  }
  return Object.freeze(unique)
}

export function findBestSnap(document: KJDocument, cursor: KJSnapPointInput, options: KJSnapOptions = {}): Readonly<KJSnapCandidate> | null { return findSnapCandidates(document, cursor, options)[0] ?? null }

export interface KJNearestPointResult {
  point: readonly [number, number, number]
  distance: number
  parameter: number | null
  segmentIndex: number | null
}

export function nearestPointOnEntity2(entity: KJReadonlyObjectRecord, pointInput: KJSnapPointInput): Readonly<KJNearestPointResult> {
  const point = vec2(pointInput, 'point')
  const candidates = primitiveSegments(entity).map(primitive => ({ ...nearestOnPrimitive(point, primitive), primitive }))
  candidates.sort((a, b) => a.distance - b.distance)
  const nearest = candidates[0]
  if (!nearest) throw new KJValidationError(`Nearest-point query is not implemented for ${entity?.type ?? 'unknown entity'}`)
  return Object.freeze({
    point: Object.freeze(point3(nearest.point)),
    distance: nearest.distance,
    parameter: nearest.parameter ?? null,
    segmentIndex: nearest.primitive.segmentIndex ?? null,
  })
}

export interface KJEntityIntersectionResult {
  kind: 'none' | 'point' | 'overlap'
  points: ReadonlyArray<readonly [number, number, number]>
  infinite: boolean
}

export function intersectEntityPair2(first: KJReadonlyObjectRecord, second: KJReadonlyObjectRecord): Readonly<KJEntityIntersectionResult> {
  if (!first || !second || first.id === second.id) throw new KJValidationError('Intersection query requires two different entities')
  const left = primitiveSegments(first), right = primitiveSegments(second)
  if (!left.length || !right.length) throw new KJValidationError(`Intersection query is not implemented for ${first.type}/${second.type}`)
  const points: KJSnapPoint[] = []
  let overlap = false, infinite = false
  for (const a of left) for (const b of right) {
    const result = primitiveIntersection(a, b)
    overlap ||= result.kind === 'overlap'
    infinite ||= Boolean(result.infinite)
    for (const point of result.points) if (!points.some(candidate => distance2(candidate, point) <= 1e-9)) points.push(point3(point))
  }
  return Object.freeze({
    kind: overlap ? 'overlap' : points.length ? 'point' : 'none',
    points: Object.freeze(points.map(point => Object.freeze(point))),
    infinite,
  })
}
