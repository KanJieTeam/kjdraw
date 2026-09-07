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
import { clone, normalizeName } from './utils.js'

const TURN = Math.PI * 2

function positive(value, label) {
  value = Number(value)
  if (!Number.isFinite(value) || value <= 0) throw new KJValidationError(`${label} must be a positive finite number`)
  return value
}

function point3(value) { const point = vec2(value); return [point[0], point[1], Number(value?.[2] ?? value?.z ?? 0)] }
function positiveTurn(value) { value %= TURN; return value < 0 ? value + TURN : value }
function polar(center, radius, angle) { return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), center[2] ?? 0] }

function lineSide(payload, options) {
  const direction = subtract2(payload.end ?? add2(payload.origin, payload.direction), payload.start ?? payload.origin)
  const origin = payload.start ?? payload.origin
  if (options.sidePoint) return cross2(direction, subtract2(options.sidePoint, origin)) >= 0 ? 1 : -1
  const side = normalizeName(options.side ?? 'LEFT')
  if (!['LEFT', 'RIGHT'].includes(side)) throw new KJValidationError('Linear offset side must be left or right')
  return side === 'LEFT' ? 1 : -1
}

function radialSide(payload, options) {
  if (options.sidePoint) return distance2(options.sidePoint, payload.center) >= Number(payload.radius) ? 1 : -1
  const side = normalizeName(options.side ?? 'OUTWARD')
  if (!['OUTWARD', 'INWARD'].includes(side)) throw new KJValidationError('Circular offset side must be outward or inward')
  return side === 'OUTWARD' ? 1 : -1
}

export function offsetEntityPayload(entity, distance, options = {}) {
  distance = positive(distance, 'Offset distance')
  const payload = clone(entity?.payload ?? {}), type = normalizeName(entity?.type)
  if (['LINE', 'RAY', 'XLINE'].includes(type)) {
    const direction = type === 'LINE' ? subtract2(payload.end, payload.start) : payload.direction
    const normal = multiply2(normalize2(perpendicular2(direction)), distance * lineSide(payload, options))
    const move = point => [point[0] + normal[0], point[1] + normal[1], point[2] ?? 0]
    if (type === 'LINE') { payload.start = move(payload.start); payload.end = move(payload.end) }
    else payload.origin = move(payload.origin)
    return payload
  }
  if (['CIRCLE', 'ARC'].includes(type)) {
    payload.radius = Number(payload.radius) + radialSide(payload, options) * distance
    if (payload.radius <= 1e-12) throw new KJValidationError('Offset collapses the circular entity')
    return payload
  }
  throw new KJValidationError(`Exact offset is not implemented for ${type || 'unknown entity'}`)
}

function splitParameters(values) {
  const result = [...new Set(values.map(Number).filter(Number.isFinite).map(value => Math.max(0, Math.min(1, value))).filter(value => value > 1e-10 && value < 1 - 1e-10))].sort((a, b) => a - b)
  if (!result.length) throw new KJValidationError('Break point must lie inside the entity')
  return result
}

function lineBreakParameters(payload, options) {
  const direction = subtract2(payload.end, payload.start)
  const points = options.points ?? [options.firstPoint ?? options.point, options.secondPoint].filter(Boolean)
  return splitParameters(points.map(point => projectParameter2(point, payload.start, direction)))
}

function arcParameter(payload, point) {
  const angle = typeof point === 'number' ? point : Math.atan2(point[1] - payload.center[1], point[0] - payload.center[0])
  const sweep = arcSweep(payload)
  return sweep >= 0 ? positiveTurn(angle - payload.startAngle) / sweep : positiveTurn(payload.startAngle - angle) / -sweep
}

export function breakEntityPayloads(entity, options = {}) {
  const payload = clone(entity?.payload ?? {}), type = normalizeName(entity?.type)
  const points = options.points ?? [options.firstPoint ?? options.point, options.secondPoint].filter(value => value != null)
  if (type === 'LINE') {
    const parameters = lineBreakParameters(payload, { ...options, points })
    const pointAt = t => [payload.start[0] + (payload.end[0] - payload.start[0]) * t, payload.start[1] + (payload.end[1] - payload.start[1]) * t, (payload.start[2] ?? 0) + ((payload.end[2] ?? 0) - (payload.start[2] ?? 0)) * t]
    if (parameters.length === 1) {
      const point = pointAt(parameters[0])
      return [{ type, payload: { ...payload, start: payload.start, end: point } }, { type, payload: { ...payload, start: point, end: payload.end } }]
    }
    return [{ type, payload: { ...payload, start: payload.start, end: pointAt(parameters[0]) } }, { type, payload: { ...payload, start: pointAt(parameters.at(-1)), end: payload.end } }]
  }
  if (type === 'ARC') {
    const parameters = splitParameters(points.map(point => arcParameter(payload, point)))
    const sweep = arcSweep(payload), angleAt = t => payload.startAngle + sweep * t
    if (parameters.length === 1) {
      const angle = angleAt(parameters[0])
      return [{ type, payload: { ...payload, endAngle: angle } }, { type, payload: { ...payload, startAngle: angle } }]
    }
    return [{ type, payload: { ...payload, endAngle: angleAt(parameters[0]) } }, { type, payload: { ...payload, startAngle: angleAt(parameters.at(-1)) } }]
  }
  throw new KJValidationError(`Break is not implemented for ${type || 'unknown entity'}`)
}

function bulgeArc(start, end, bulge) {
  start = point3(start); end = point3(end); bulge = Number(bulge ?? 0)
  if (Math.abs(bulge) <= 1e-15) return null
  const chordVector = subtract2(end, start), chord = length2(chordVector), unit = normalize2(chordVector)
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge)
  const center2 = add2(midpoint2(start, end), multiply2(perpendicular2(unit), centerOffset))
  const center = [center2[0], center2[1], (start[2] + end[2]) / 2], startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  return { center, radius: distance2(center, start), startAngle, endAngle: startAngle + 4 * Math.atan(bulge), clockwise: bulge < 0, normal: [0, 0, 1] }
}

export function explodeEntity(entity) {
  const payload = entity?.payload ?? {}, type = normalizeName(entity?.type)
  if (!['LWPOLYLINE', 'POLYLINE', 'REVISION_CLOUD', 'WIPEOUT'].includes(type)) throw new KJValidationError(`Explode is not implemented for ${type || 'unknown entity'}`)
  const vertices = payload.vertices ?? [], count = payload.closed ? vertices.length : vertices.length - 1, result = []
  for (let index = 0; index < count; index += 1) {
    const vertex = vertices[index], next = vertices[(index + 1) % vertices.length], start = point3(vertex.point ?? vertex), end = point3(next.point ?? next)
    const arc = bulgeArc(start, end, vertex.bulge)
    result.push(arc ? { type: 'ARC', payload: arc } : { type: 'LINE', payload: { start, end } })
  }
  return result
}

function boundaryIntersections(target, boundary, targetMode = 'line') {
  const targetPayload = target.payload, boundaryPayload = boundary.payload
  if (boundary.type === 'LINE') return intersectLineLine2(targetPayload.start, targetPayload.end, boundaryPayload.start, boundaryPayload.end, { modeA: targetMode, modeB: 'segment' }).points
  if (boundary.type === 'CIRCLE') return intersectLineCircle2(targetPayload.start, targetPayload.end, boundaryPayload.center, boundaryPayload.radius, { mode: targetMode }).points
  if (boundary.type === 'ARC') {
    const points = intersectLineCircle2(targetPayload.start, targetPayload.end, boundaryPayload.center, boundaryPayload.radius, { mode: targetMode }).points
    const sweep = arcSweep(boundaryPayload)
    return points.filter(point => {
      const angle = Math.atan2(point[1] - boundaryPayload.center[1], point[0] - boundaryPayload.center[0])
      return sweep >= 0 ? positiveTurn(angle - boundaryPayload.startAngle) <= sweep + 1e-10 : positiveTurn(boundaryPayload.startAngle - angle) <= -sweep + 1e-10
    })
  }
  throw new KJValidationError(`Line boundary does not support ${boundary.type}`)
}

export function trimLinePayload(target, boundaries, pickPoint) {
  if (target?.type !== 'LINE') throw new KJValidationError('Trim currently requires a LINE target')
  const direction = subtract2(target.payload.end, target.payload.start), pickParameter = projectParameter2(pickPoint, target.payload.start, direction)
  const candidates = boundaries.flatMap(boundary => boundaryIntersections(target, boundary, 'segment'))
    .map(point => ({ point: point3(point), parameter: projectParameter2(point, target.payload.start, direction) }))
    .filter(value => value.parameter > 1e-10 && value.parameter < 1 - 1e-10)
    .sort((a, b) => Math.abs(a.parameter - pickParameter) - Math.abs(b.parameter - pickParameter))
  if (!candidates.length) throw new KJValidationError('No trim intersection lies on the target segment')
  const payload = clone(target.payload), intersection = candidates[0]
  if (pickParameter <= intersection.parameter) payload.start = intersection.point
  else payload.end = intersection.point
  return payload
}

export function extendLinePayload(target, boundaries, pickPoint) {
  if (target?.type !== 'LINE') throw new KJValidationError('Extend currently requires a LINE target')
  const direction = subtract2(target.payload.end, target.payload.start), pickParameter = projectParameter2(pickPoint, target.payload.start, direction), extendStart = pickParameter < 0.5
  const candidates = boundaries.flatMap(boundary => boundaryIntersections(target, boundary, 'line'))
    .map(point => ({ point: point3(point), parameter: projectParameter2(point, target.payload.start, direction) }))
    .filter(value => extendStart ? value.parameter < -1e-10 : value.parameter > 1 + 1e-10)
    .sort((a, b) => extendStart ? b.parameter - a.parameter : a.parameter - b.parameter)
  if (!candidates.length) throw new KJValidationError('No boundary is available in the selected extension direction')
  const payload = clone(target.payload)
  payload[extendStart ? 'start' : 'end'] = candidates[0].point
  return payload
}

function selectedRay(line, intersection, pickPoint) {
  const direction = normalize2(subtract2(line.payload.end, line.payload.start))
  let sign
  if (pickPoint) sign = dot2(subtract2(pickPoint, intersection), direction) >= 0 ? 1 : -1
  else sign = distance2(line.payload.end, intersection) >= distance2(line.payload.start, intersection) ? 1 : -1
  return { direction: multiply2(direction, sign), keepEnd: sign > 0 }
}

function trimmedLine(line, tangent, ray) {
  const payload = clone(line.payload)
  payload[ray.keepEnd ? 'start' : 'end'] = point3(tangent)
  return payload
}

function linePairContext(first, second, options) {
  if (first?.type !== 'LINE' || second?.type !== 'LINE') throw new KJValidationError('Operation requires two LINE entities')
  const intersectionResult = intersectLineLine2(first.payload.start, first.payload.end, second.payload.start, second.payload.end, { modeA: 'line', modeB: 'line' })
  const intersection = intersectionResult.points[0]
  if (!intersection) throw new KJValidationError('Lines are parallel and do not define a corner')
  return { intersection, firstRay: selectedRay(first, intersection, options.pickPoint1), secondRay: selectedRay(second, intersection, options.pickPoint2) }
}

export function chamferLinePair(first, second, options = {}) {
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

export function filletLinePair(first, second, options = {}) {
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
