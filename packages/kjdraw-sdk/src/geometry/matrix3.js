import { KJValidationError } from '../errors.js'
import { clone } from '../utils.js'
import { DEFAULT_TOLERANCE } from './tolerance.js'
import { dot2, length2, normalize2, subtract2, vec2 } from './vector2.js'

// Affine matrix [a, b, c, d, e, f]:
// x' = a*x + c*y + e; y' = b*x + d*y + f.
export function matrix3(value = [1, 0, 0, 1, 0, 0]) {
  const result = [...value].map(Number)
  if (result.length !== 6 || !result.every(Number.isFinite)) throw new KJValidationError('Affine matrix must contain six finite numbers')
  return result
}

export const identity3 = () => [1, 0, 0, 1, 0, 0]
export const translation3 = (dx, dy) => [1, 0, 0, 1, Number(dx), Number(dy)]
export const scale3 = (sx, sy = sx) => [Number(sx), 0, 0, Number(sy), 0, 0]
export const rotation3 = angle => [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]

export function multiply3(left, right) {
  const [a1, b1, c1, d1, e1, f1] = matrix3(left)
  const [a2, b2, c2, d2, e2, f2] = matrix3(right)
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

export function aroundPoint3(transform, center) {
  center = vec2(center, 'transform center')
  return multiply3(translation3(...center), multiply3(transform, translation3(-center[0], -center[1])))
}

export const rotationAround3 = (angle, center = [0, 0]) => aroundPoint3(rotation3(Number(angle)), center)
export const scaleAround3 = (sx, sy = sx, center = [0, 0]) => aroundPoint3(scale3(sx, sy), center)

export function reflectionAcrossLine3(start, end) {
  start = vec2(start, 'mirror line start'); end = vec2(end, 'mirror line end')
  const [ux, uy] = normalize2(subtract2(end, start))
  const reflection = [ux * ux - uy * uy, 2 * ux * uy, 2 * ux * uy, uy * uy - ux * ux, 0, 0]
  return aroundPoint3(reflection, start)
}

export function determinant3(value) {
  const [a, b, c, d] = matrix3(value)
  return a * d - b * c
}

export function invert3(value, tolerance = DEFAULT_TOLERANCE) {
  const [a, b, c, d, e, f] = matrix3(value)
  const determinant = a * d - b * c
  if (tolerance.zero(determinant, Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)))) throw new KJValidationError('Affine matrix is singular')
  return [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, (b * e - a * f) / determinant]
}

export function transformPoint3(value, point) {
  const [a, b, c, d, e, f] = matrix3(value); const [x, y] = vec2(point)
  const transformed = [a * x + c * y + e, b * x + d * y + f]
  if (Array.isArray(point) && point.length > 2) transformed.push(...clone(point.slice(2)))
  return transformed
}

export function transformVector3(value, vector) {
  const [a, b, c, d] = matrix3(value); const [x, y] = vec2(vector, 'vector')
  const transformed = [a * x + c * y, b * x + d * y]
  if (Array.isArray(vector) && vector.length > 2) transformed.push(...clone(vector.slice(2)))
  return transformed
}

export function similarityScale3(value, tolerance = DEFAULT_TOLERANCE) {
  const [a, b, c, d] = matrix3(value)
  const xAxis = [a, b], yAxis = [c, d]
  const sx = length2(xAxis), sy = length2(yAxis)
  const threshold = tolerance.distanceFor(sx, sy)
  if (Math.abs(sx - sy) > threshold || Math.abs(dot2(xAxis, yAxis)) > threshold * Math.max(sx, sy, 1)) throw new KJValidationError('Operation would turn circular geometry into non-circular geometry')
  return (sx + sy) / 2
}
