import { KJValidationError } from '../errors.js'
import { invokeGeometryBackend } from './backend.js'
import { DEFAULT_TOLERANCE } from './tolerance.js'
import {
  add2,
  cross2,
  distance2,
  dot2,
  lengthSquared2,
  multiply2,
  subtract2,
  vec2,
} from './vector2.js'

function inDomain(parameter, mode, tolerance) {
  const epsilon = tolerance.distanceFor(parameter)
  if (mode === 'line') return true
  if (mode === 'ray') return parameter >= -epsilon
  if (mode === 'segment') return parameter >= -epsilon && parameter <= 1 + epsilon
  throw new KJValidationError(`Unknown line domain: ${mode}`)
}

const none = () => ({ kind: 'none', points: [], parametersA: [], parametersB: [] })

function intersectLineLineReference2(a0, a1, b0, b1, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const modeA = options.modeA ?? 'segment', modeB = options.modeB ?? 'segment'
  a0 = vec2(a0); a1 = vec2(a1); b0 = vec2(b0); b1 = vec2(b1)
  const r = subtract2(a1, a0), s = subtract2(b1, b0)
  const rr = lengthSquared2(r), ss = lengthSquared2(s)
  if (tolerance.zero(rr) || tolerance.zero(ss)) throw new KJValidationError('Line intersection requires non-zero directions')
  const denominator = cross2(r, s)
  const offset = subtract2(b0, a0)
  const scale = Math.sqrt(rr * ss)
  if (tolerance.zero(denominator, scale)) {
    if (!tolerance.zero(cross2(offset, r), Math.sqrt(rr) * Math.max(distance2(a0, b0), 1))) return none()
    if (modeA !== 'segment' || modeB !== 'segment') return { kind: 'overlap', points: [], parametersA: [], parametersB: [], infinite: true }
    const useX = Math.abs(r[0]) >= Math.abs(r[1])
    const axis = useX ? 0 : 1
    const t0 = (b0[axis] - a0[axis]) / r[axis]
    const t1 = (b1[axis] - a0[axis]) / r[axis]
    const start = Math.max(0, Math.min(t0, t1)), end = Math.min(1, Math.max(t0, t1))
    if (end < start - tolerance.distanceFor(start, end)) return none()
    const points = [add2(a0, multiply2(r, start))]
    if (!tolerance.equal(start, end)) points.push(add2(a0, multiply2(r, end)))
    return { kind: points.length === 1 ? 'point' : 'overlap', points, parametersA: points.length === 1 ? [start] : [start, end], parametersB: [] }
  }
  const parameterA = cross2(offset, s) / denominator
  const parameterB = cross2(offset, r) / denominator
  if (!inDomain(parameterA, modeA, tolerance) || !inDomain(parameterB, modeB, tolerance)) return none()
  return { kind: 'point', points: [add2(a0, multiply2(r, parameterA))], parametersA: [parameterA], parametersB: [parameterB] }
}

function intersectLineCircleReference2(start, end, center, radius, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const mode = options.mode ?? 'segment'
  start = vec2(start); end = vec2(end); center = vec2(center)
  radius = Number(radius)
  if (!Number.isFinite(radius) || radius < 0) throw new KJValidationError('Circle radius must be non-negative')
  const direction = subtract2(end, start)
  const a = lengthSquared2(direction)
  if (tolerance.zero(a)) throw new KJValidationError('Line-circle intersection requires a non-zero line')
  const relative = subtract2(start, center)
  const b = 2 * dot2(relative, direction)
  const c = lengthSquared2(relative) - radius * radius
  let discriminant = b * b - 4 * a * c
  const threshold = tolerance.distanceFor(b * b, 4 * a * c)
  if (discriminant < -threshold) return none()
  if (Math.abs(discriminant) <= threshold) discriminant = 0
  const root = Math.sqrt(Math.max(0, discriminant))
  const candidates = discriminant === 0 ? [-b / (2 * a)] : [(-b - root) / (2 * a), (-b + root) / (2 * a)]
  const parameters = candidates.filter(parameter => inDomain(parameter, mode, tolerance)).sort((x, y) => x - y)
  return parameters.length ? { kind: 'point', points: parameters.map(parameter => add2(start, multiply2(direction, parameter))), parametersA: parameters, parametersB: [] } : none()
}

function intersectCircleCircleReference2(centerA, radiusA, centerB, radiusB, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  centerA = vec2(centerA); centerB = vec2(centerB)
  radiusA = Number(radiusA); radiusB = Number(radiusB)
  if (![radiusA, radiusB].every(value => Number.isFinite(value) && value >= 0)) throw new KJValidationError('Circle radii must be non-negative')
  const difference = subtract2(centerB, centerA)
  const distance = Math.sqrt(lengthSquared2(difference))
  const epsilon = tolerance.distanceFor(distance, radiusA, radiusB)
  if (distance <= epsilon && Math.abs(radiusA - radiusB) <= epsilon) return { kind: 'overlap', points: [], parametersA: [], parametersB: [], infinite: true }
  if (distance > radiusA + radiusB + epsilon || distance < Math.abs(radiusA - radiusB) - epsilon || distance <= epsilon) return none()
  const along = (radiusA * radiusA - radiusB * radiusB + distance * distance) / (2 * distance)
  let heightSquared = radiusA * radiusA - along * along
  if (heightSquared < 0 && Math.abs(heightSquared) <= epsilon * epsilon) heightSquared = 0
  if (heightSquared < 0) return none()
  const unit = multiply2(difference, 1 / distance)
  const base = add2(centerA, multiply2(unit, along))
  if (heightSquared === 0) return { kind: 'point', points: [base], parametersA: [], parametersB: [] }
  const normal = [-unit[1], unit[0]], height = Math.sqrt(heightSquared)
  return { kind: 'point', points: [add2(base, multiply2(normal, height)), add2(base, multiply2(normal, -height))], parametersA: [], parametersB: [] }
}

function orientationReference2(a, b, c, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  a = vec2(a); b = vec2(b); c = vec2(c)
  const ab = subtract2(b, a), ac = subtract2(c, a)
  const determinant = cross2(ab, ac)
  const scale = Math.sqrt(lengthSquared2(ab) * lengthSquared2(ac))
  return tolerance.zero(determinant, scale) ? 0 : determinant > 0 ? 1 : -1
}

export function orientation2(a, b, c, options = {}) {
  return invokeGeometryBackend('orientation2', [a, b, c, options], () => orientationReference2(a, b, c, options))
}

export function intersectLineLine2(a0, a1, b0, b1, options = {}) {
  return invokeGeometryBackend('intersectLineLine2', [a0, a1, b0, b1, options], () => intersectLineLineReference2(a0, a1, b0, b1, options))
}

export function intersectLineCircle2(start, end, center, radius, options = {}) {
  return invokeGeometryBackend('intersectLineCircle2', [start, end, center, radius, options], () => intersectLineCircleReference2(start, end, center, radius, options))
}

export function intersectCircleCircle2(centerA, radiusA, centerB, radiusB, options = {}) {
  return invokeGeometryBackend('intersectCircleCircle2', [centerA, radiusA, centerB, radiusB, options], () => intersectCircleCircleReference2(centerA, radiusA, centerB, radiusB, options))
}

export function closestPointOnCircle2(point, center, radius, tolerance = DEFAULT_TOLERANCE) {
  point = vec2(point); center = vec2(center); radius = Number(radius)
  const radial = subtract2(point, center)
  const magnitude = Math.sqrt(lengthSquared2(radial))
  const unit = tolerance.zero(magnitude) ? [1, 0] : multiply2(radial, 1 / magnitude)
  const closest = add2(center, multiply2(unit, radius))
  return { point: closest, distance: distance2(point, closest), angle: Math.atan2(unit[1], unit[0]) }
}
