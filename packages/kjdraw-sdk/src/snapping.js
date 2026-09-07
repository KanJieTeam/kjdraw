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

export const KJ_SNAP_MODES = Object.freeze([
  'endpoint', 'midpoint', 'center', 'quadrant', 'insertion', 'node', 'nearest', 'intersection',
])

const TURN = Math.PI * 2
const point3 = point => [Number(point[0]), Number(point[1]), Number(point[2] ?? 0)]
const pointAt = (center, radius, angle) => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), center[2] ?? 0]

function positiveTurn(value) {
  value %= TURN
  return value < 0 ? value + TURN : value
}

function angleOnArc(angle, arc, epsilon = 1e-10) {
  const sweep = arc.sweep
  return sweep >= 0
    ? positiveTurn(angle - arc.startAngle) <= sweep + epsilon
    : positiveTurn(arc.startAngle - angle) <= -sweep + epsilon
}

function bulgeArc(start, end, bulge, entityId, segmentIndex) {
  start = point3(start); end = point3(end); bulge = Number(bulge ?? 0)
  if (!Number.isFinite(bulge) || Math.abs(bulge) <= 1e-15) return null
  const chordVector = subtract2(end, start)
  const chord = Math.sqrt(lengthSquared2(chordVector))
  if (chord <= 1e-15) return null
  const unit = multiply2(chordVector, 1 / chord)
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge)
  const center2 = add2(midpoint2(start, end), multiply2(perpendicular2(unit), centerOffset))
  const center = [center2[0], center2[1], (start[2] + end[2]) / 2]
  const sweep = 4 * Math.atan(bulge)
  return { kind: 'arc', center, radius: distance2(center, start), startAngle: Math.atan2(start[1] - center[1], start[0] - center[0]), sweep, entityId, segmentIndex }
}

function primitiveSegments(entity) {
  const payload = entity.payload ?? {}, id = entity.id
  switch (entity.type) {
    case 'LINE': return [{ kind: 'line', start: payload.start, end: payload.end, mode: 'segment', entityId: id }]
    case 'RAY': return [{ kind: 'line', start: payload.origin, end: add2(payload.origin, payload.direction), mode: 'ray', entityId: id }]
    case 'XLINE': return [{ kind: 'line', start: payload.origin, end: add2(payload.origin, payload.direction), mode: 'line', entityId: id }]
    case 'CIRCLE': return [{ kind: 'circle', center: payload.center, radius: payload.radius, entityId: id }]
    case 'ARC': return [{ kind: 'arc', center: payload.center, radius: payload.radius, startAngle: payload.startAngle, sweep: arcSweep(payload), entityId: id }]
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vertices = payload.vertices ?? [], count = payload.closed ? vertices.length : vertices.length - 1
      const result = []
      for (let index = 0; index < count; index += 1) {
        const vertex = vertices[index], next = vertices[(index + 1) % vertices.length]
        const start = vertex.point ?? vertex, end = next.point ?? next
        result.push(bulgeArc(start, end, vertex.bulge, id, index) ?? { kind: 'line', start, end, mode: 'segment', entityId: id, segmentIndex: index })
      }
      return result
    }
    case 'SOLID':
    case 'TRACE': {
      const vertices = payload.vertices ?? [], result = []
      for (let index = 0; index < vertices.length; index += 1) result.push({ kind: 'line', start: vertices[index], end: vertices[(index + 1) % vertices.length], mode: 'segment', entityId: id, segmentIndex: index })
      return result
    }
    default: return []
  }
}

function arcEndpoints(arc) {
  return [pointAt(arc.center, arc.radius, arc.startAngle), pointAt(arc.center, arc.radius, arc.startAngle + arc.sweep)]
}

function nearestOnLine(cursor, primitive) {
  if (primitive.mode === 'segment') return closestPointOnSegment2(cursor, primitive.start, primitive.end)
  const direction = subtract2(primitive.end, primitive.start)
  let parameter = projectParameter2(cursor, primitive.start, direction)
  if (primitive.mode === 'ray') parameter = Math.max(0, parameter)
  const point = add2(primitive.start, multiply2(direction, parameter))
  return { point, parameter, distance: distance2(cursor, point) }
}

function nearestOnPrimitive(cursor, primitive) {
  if (primitive.kind === 'line') return nearestOnLine(cursor, primitive)
  const radial = closestPointOnCircle2(cursor, primitive.center, primitive.radius)
  if (primitive.kind === 'circle' || angleOnArc(radial.angle, primitive)) return radial
  return arcEndpoints(primitive).map(point => ({ point, distance: distance2(cursor, point) })).sort((a, b) => a.distance - b.distance)[0]
}

function baseCandidates(entity, modes, cursor) {
  const payload = entity.payload ?? {}, result = [], add = (mode, point, detail = {}) => result.push({ mode, point: point3(point), entityIds: [entity.id], ...detail })
  const primitives = primitiveSegments(entity)
  if (modes.has('endpoint')) {
    if (['LINE'].includes(entity.type)) { add('endpoint', payload.start, { role: 'start' }); add('endpoint', payload.end, { role: 'end' }) }
    if (['RAY', 'XLINE'].includes(entity.type)) add('endpoint', payload.origin, { role: 'origin' })
    if (entity.type === 'ARC') { const [start, end] = arcEndpoints(primitives[0]); add('endpoint', start, { role: 'start' }); add('endpoint', end, { role: 'end' }) }
    if (['LWPOLYLINE', 'POLYLINE'].includes(entity.type)) for (const [index, vertex] of (payload.vertices ?? []).entries()) add('endpoint', vertex.point ?? vertex, { vertexIndex: index })
    if (['SOLID', 'TRACE'].includes(entity.type)) for (const [index, point] of (payload.vertices ?? []).entries()) add('endpoint', point, { vertexIndex: index })
    if (entity.type === 'SPLINE') {
      const points = payload.fitPoints?.length ? payload.fitPoints : payload.controlPoints
      if (points?.length) { add('endpoint', points[0], { role: 'start' }); add('endpoint', points.at(-1), { role: 'end' }) }
    }
  }
  if (modes.has('midpoint')) for (const primitive of primitives.filter(value => value.kind !== 'circle')) {
    const point = primitive.kind === 'line' ? midpoint2(primitive.start, primitive.end) : pointAt(primitive.center, primitive.radius, primitive.startAngle + primitive.sweep / 2)
    add('midpoint', point, { segmentIndex: primitive.segmentIndex })
  }
  if (modes.has('center') && ['CIRCLE', 'ARC', 'ELLIPSE'].includes(entity.type)) add('center', payload.center)
  if (modes.has('quadrant') && ['CIRCLE', 'ARC'].includes(entity.type)) for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const primitive = primitives[0]
    if (primitive.kind === 'circle' || angleOnArc(angle, primitive)) add('quadrant', pointAt(payload.center, payload.radius, angle), { angle })
  }
  if (modes.has('insertion') && ['INSERT', 'TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB', 'IMAGE', 'TABLE'].includes(entity.type)) add('insertion', payload.position)
  if (modes.has('node') && entity.type === 'POINT') add('node', payload.position)
  if (modes.has('nearest')) {
    const nearest = primitives.map(primitive => ({ ...nearestOnPrimitive(cursor, primitive), primitive })).sort((a, b) => a.distance - b.distance)[0]
    if (nearest) add('nearest', nearest.point, { segmentIndex: nearest.primitive.segmentIndex, parameter: nearest.parameter })
  }
  return result
}

function accepts(primitive, point) {
  return primitive.kind !== 'arc' || angleOnArc(Math.atan2(point[1] - primitive.center[1], point[0] - primitive.center[0]), primitive)
}

function primitiveIntersection(a, b) {
  let result
  if (a.kind === 'line' && b.kind === 'line') result = intersectLineLine2(a.start, a.end, b.start, b.end, { modeA: a.mode, modeB: b.mode })
  else if (a.kind === 'line' && ['circle', 'arc'].includes(b.kind)) result = intersectLineCircle2(a.start, a.end, b.center, b.radius, { mode: a.mode })
  else if (b.kind === 'line' && ['circle', 'arc'].includes(a.kind)) result = intersectLineCircle2(b.start, b.end, a.center, a.radius, { mode: b.mode })
  else result = intersectCircleCircle2(a.center, a.radius, b.center, b.radius)
  return {
    ...result,
    points: (result.points ?? []).filter(point => accepts(a, point) && accepts(b, point)),
  }
}

function intersectionCandidates(entities, cursor, maxPairs) {
  const primitives = entities.flatMap(primitiveSegments), result = []
  let pairs = 0
  for (let left = 0; left < primitives.length; left += 1) for (let right = left + 1; right < primitives.length; right += 1) {
    const a = primitives[left], b = primitives[right]
    if (a.entityId === b.entityId || ++pairs > maxPairs) continue
    for (const point of primitiveIntersection(a, b).points) result.push({ mode: 'intersection', point: point3(point), entityIds: [a.entityId, b.entityId], distance: distance2(cursor, point) })
  }
  return result
}

export function findSnapCandidates(document, cursor, options = {}) {
  if (!document?.listEntities) throw new KJValidationError('Snapping requires a KJDocument')
  cursor = vec2(cursor, 'cursor')
  const radius = Number(options.radius ?? Infinity)
  if (!(radius > 0)) throw new KJValidationError('Snap radius must be positive')
  const modes = new Set((options.modes ?? KJ_SNAP_MODES).map(value => String(value).toLowerCase()))
  for (const mode of modes) if (!KJ_SNAP_MODES.includes(mode)) throw new KJValidationError(`Unsupported snap mode: ${mode}`)
  const allowed = options.entityIds ? new Set(options.entityIds.map(String)) : null
  const entities = document.listEntities().filter(entity => !allowed || allowed.has(entity.id))
  let candidates = entities.flatMap(entity => baseCandidates(entity, modes, cursor))
    .map(candidate => ({ ...candidate, distance: candidate.distance ?? distance2(cursor, candidate.point) }))
  if (modes.has('intersection')) candidates.push(...intersectionCandidates(entities, cursor, Number(options.maxIntersectionPairs ?? 10000)))
  candidates = candidates.filter(candidate => candidate.distance <= radius)
  candidates.sort((a, b) => a.distance - b.distance || KJ_SNAP_MODES.indexOf(a.mode) - KJ_SNAP_MODES.indexOf(b.mode))
  const unique = []
  for (const candidate of candidates) {
    const duplicate = unique.some(value => value.mode === candidate.mode && distance2(value.point, candidate.point) <= 1e-9 && value.entityIds.join('|') === candidate.entityIds.join('|'))
    if (!duplicate) unique.push(Object.freeze({ ...candidate, point: Object.freeze(candidate.point), entityIds: Object.freeze(candidate.entityIds) }))
  }
  return Object.freeze(unique)
}

export function findBestSnap(document, cursor, options = {}) { return findSnapCandidates(document, cursor, options)[0] ?? null }

export function nearestPointOnEntity2(entity, point) {
  point = vec2(point, 'point')
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

export function intersectEntityPair2(first, second) {
  if (!first || !second || first.id === second.id) throw new KJValidationError('Intersection query requires two different entities')
  const left = primitiveSegments(first), right = primitiveSegments(second)
  if (!left.length || !right.length) throw new KJValidationError(`Intersection query is not implemented for ${first.type}/${second.type}`)
  const points = []
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
