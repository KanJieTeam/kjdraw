import { KJValidationError } from '../errors.js'
import { clone } from '../utils.js'
import { DEFAULT_TOLERANCE, type KJTolerance } from './tolerance.js'
import {
  dot2,
  length2,
  normalize2,
  subtract2,
  vec2,
  type Point2Input,
} from './vector2.js'

/** Affine matrix [a, b, c, d, e, f]. */
export type AffineMatrix3 = [number, number, number, number, number, number]
export type AffineMatrix3Input = readonly unknown[]
export type TransformedPoint = [number, number, ...unknown[]]

export function matrix3(value: AffineMatrix3Input = [1, 0, 0, 1, 0, 0]): AffineMatrix3 {
  const result = [...value].map(Number)
  if (result.length !== 6 || !result.every(Number.isFinite)) {
    throw new KJValidationError('Affine matrix must contain six finite numbers')
  }
  return result as AffineMatrix3
}

export const identity3 = (): AffineMatrix3 => [1, 0, 0, 1, 0, 0]
export const translation3 = (dx: number, dy: number): AffineMatrix3 => [1, 0, 0, 1, Number(dx), Number(dy)]
export const scale3 = (sx: number, sy: number = sx): AffineMatrix3 => [Number(sx), 0, 0, Number(sy), 0, 0]
export const rotation3 = (angle: number): AffineMatrix3 => [
  Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0,
]

export function multiply3(left: AffineMatrix3Input, right: AffineMatrix3Input): AffineMatrix3 {
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

export function aroundPoint3(transform: AffineMatrix3Input, center: Point2Input): AffineMatrix3 {
  const resolvedCenter = vec2(center, 'transform center')
  return multiply3(
    translation3(...resolvedCenter),
    multiply3(transform, translation3(-resolvedCenter[0], -resolvedCenter[1])),
  )
}

export const rotationAround3 = (angle: number, center: Point2Input = [0, 0]): AffineMatrix3 => (
  aroundPoint3(rotation3(Number(angle)), center)
)
export const scaleAround3 = (
  sx: number,
  sy: number = sx,
  center: Point2Input = [0, 0],
): AffineMatrix3 => aroundPoint3(scale3(sx, sy), center)

export function reflectionAcrossLine3(start: Point2Input, end: Point2Input): AffineMatrix3 {
  const resolvedStart = vec2(start, 'mirror line start')
  const resolvedEnd = vec2(end, 'mirror line end')
  const [ux, uy] = normalize2(subtract2(resolvedEnd, resolvedStart))
  const reflection: AffineMatrix3 = [
    ux * ux - uy * uy,
    2 * ux * uy,
    2 * ux * uy,
    uy * uy - ux * ux,
    0,
    0,
  ]
  return aroundPoint3(reflection, resolvedStart)
}

export function determinant3(value: AffineMatrix3Input): number {
  const [a, b, c, d] = matrix3(value)
  return a * d - b * c
}

export function invert3(
  value: AffineMatrix3Input,
  tolerance: KJTolerance = DEFAULT_TOLERANCE,
): AffineMatrix3 {
  const [a, b, c, d, e, f] = matrix3(value)
  const determinant = a * d - b * c
  if (tolerance.zero(determinant, Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)))) {
    throw new KJValidationError('Affine matrix is singular')
  }
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ]
}

export function transformPoint3(value: AffineMatrix3Input, point: Point2Input): TransformedPoint {
  const [a, b, c, d, e, f] = matrix3(value)
  const [x, y] = vec2(point)
  const transformed: TransformedPoint = [a * x + c * y + e, b * x + d * y + f]
  if (Array.isArray(point) && point.length > 2) transformed.push(...clone(point.slice(2)))
  return transformed
}

export function transformVector3(value: AffineMatrix3Input, vector: Point2Input): TransformedPoint {
  const [a, b, c, d] = matrix3(value)
  const [x, y] = vec2(vector, 'vector')
  const transformed: TransformedPoint = [a * x + c * y, b * x + d * y]
  if (Array.isArray(vector) && vector.length > 2) transformed.push(...clone(vector.slice(2)))
  return transformed
}

export function similarityScale3(
  value: AffineMatrix3Input,
  tolerance: KJTolerance = DEFAULT_TOLERANCE,
): number {
  const [a, b, c, d] = matrix3(value)
  const xAxis: [number, number] = [a, b]
  const yAxis: [number, number] = [c, d]
  const sx = length2(xAxis)
  const sy = length2(yAxis)
  const threshold = tolerance.distanceFor(sx, sy)
  if (
    Math.abs(sx - sy) > threshold
    || Math.abs(dot2(xAxis, yAxis)) > threshold * Math.max(sx, sy, 1)
  ) {
    throw new KJValidationError('Operation would turn circular geometry into non-circular geometry')
  }
  return (sx + sy) / 2
}

