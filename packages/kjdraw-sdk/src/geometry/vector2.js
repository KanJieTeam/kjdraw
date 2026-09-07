import { KJValidationError } from '../errors.js'
import { DEFAULT_TOLERANCE } from './tolerance.js'

export function vec2(value, label = 'point') {
  const x = Array.isArray(value) ? value[0] : value?.x
  const y = Array.isArray(value) ? value[1] : value?.y
  const result = [Number(x), Number(y)]
  if (!result.every(Number.isFinite)) throw new KJValidationError(`${label} must contain finite x/y coordinates`, { value })
  return result
}

export const add2 = (a, b) => { a = vec2(a); b = vec2(b); return [a[0] + b[0], a[1] + b[1]] }
export const subtract2 = (a, b) => { a = vec2(a); b = vec2(b); return [a[0] - b[0], a[1] - b[1]] }
export const multiply2 = (a, scalar) => { a = vec2(a); scalar = Number(scalar); return [a[0] * scalar, a[1] * scalar] }
export const dot2 = (a, b) => { a = vec2(a); b = vec2(b); return a[0] * b[0] + a[1] * b[1] }
export const cross2 = (a, b) => { a = vec2(a); b = vec2(b); return a[0] * b[1] - a[1] * b[0] }
export const lengthSquared2 = a => dot2(a, a)
export const length2 = a => Math.hypot(...vec2(a))
export const distanceSquared2 = (a, b) => lengthSquared2(subtract2(a, b))
export const distance2 = (a, b) => Math.sqrt(distanceSquared2(a, b))
export const perpendicular2 = a => { a = vec2(a); return [-a[1], a[0]] }
export const midpoint2 = (a, b) => multiply2(add2(a, b), 0.5)

export function normalize2(value, tolerance = DEFAULT_TOLERANCE) {
  const vector = vec2(value, 'vector')
  const magnitude = length2(vector)
  if (tolerance.zero(magnitude)) throw new KJValidationError('Cannot normalize a zero-length vector')
  return [vector[0] / magnitude, vector[1] / magnitude]
}

export function angle2(value) {
  const vector = vec2(value, 'vector')
  return Math.atan2(vector[1], vector[0])
}

export function signedAngle2(from, to) {
  from = normalize2(from); to = normalize2(to)
  return Math.atan2(cross2(from, to), dot2(from, to))
}

export function lerp2(a, b, t) {
  a = vec2(a); b = vec2(b); t = Number(t)
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

export function equal2(a, b, tolerance = DEFAULT_TOLERANCE) {
  a = vec2(a); b = vec2(b)
  return distance2(a, b) <= tolerance.distanceFor(...a, ...b)
}

export function projectParameter2(point, origin, direction, tolerance = DEFAULT_TOLERANCE) {
  point = vec2(point); origin = vec2(origin); direction = vec2(direction, 'direction')
  const denominator = lengthSquared2(direction)
  if (tolerance.zero(denominator)) throw new KJValidationError('Projection direction cannot be zero')
  return dot2(subtract2(point, origin), direction) / denominator
}

export function closestPointOnSegment2(point, start, end, tolerance = DEFAULT_TOLERANCE) {
  start = vec2(start); end = vec2(end)
  const direction = subtract2(end, start)
  if (tolerance.zero(lengthSquared2(direction))) return { point: start, parameter: 0, distance: distance2(point, start) }
  const parameter = Math.max(0, Math.min(1, projectParameter2(point, start, direction, tolerance)))
  const closest = lerp2(start, end, parameter)
  return { point: closest, parameter, distance: distance2(point, closest) }
}
