import { KJValidationError } from '../errors.js'
import { DEFAULT_TOLERANCE, type KJTolerance } from './tolerance.js'

export interface XYCoordinates {
  readonly x?: unknown
  readonly y?: unknown
}

export interface XYZCoordinates extends XYCoordinates {
  readonly z?: unknown
}

export type Point2Input = readonly unknown[] | XYCoordinates
export type Point3Input = readonly unknown[] | XYZCoordinates
export type Point2 = [number, number]
export type Point3 = [number, number, number]

export interface ClosestPoint2 {
  point: Point2
  parameter: number
  distance: number
}

export function vec2(value: Point2Input, label = 'point'): Point2 {
  const record = value !== null && typeof value === 'object' ? value as XYCoordinates : null
  const x = Array.isArray(value) ? value[0] : record?.x
  const y = Array.isArray(value) ? value[1] : record?.y
  const result: Point2 = [Number(x), Number(y)]
  if (!result.every(Number.isFinite)) {
    throw new KJValidationError(`${label} must contain finite x/y coordinates`, { value })
  }
  return result
}

export function add2(a: Point2Input, b: Point2Input): Point2 {
  const left = vec2(a)
  const right = vec2(b)
  return [left[0] + right[0], left[1] + right[1]]
}

export function subtract2(a: Point2Input, b: Point2Input): Point2 {
  const left = vec2(a)
  const right = vec2(b)
  return [left[0] - right[0], left[1] - right[1]]
}

export function multiply2(a: Point2Input, scalar: number): Point2 {
  const vector = vec2(a)
  const factor = Number(scalar)
  return [vector[0] * factor, vector[1] * factor]
}

export function dot2(a: Point2Input, b: Point2Input): number {
  const left = vec2(a)
  const right = vec2(b)
  return left[0] * right[0] + left[1] * right[1]
}

export function cross2(a: Point2Input, b: Point2Input): number {
  const left = vec2(a)
  const right = vec2(b)
  return left[0] * right[1] - left[1] * right[0]
}

export const lengthSquared2 = (value: Point2Input): number => dot2(value, value)
export const length2 = (value: Point2Input): number => {
  const [x, y] = vec2(value)
  return Math.hypot(x, y)
}
export const distanceSquared2 = (a: Point2Input, b: Point2Input): number => lengthSquared2(subtract2(a, b))
export const distance2 = (a: Point2Input, b: Point2Input): number => Math.sqrt(distanceSquared2(a, b))
export const perpendicular2 = (value: Point2Input): Point2 => {
  const vector = vec2(value)
  return [-vector[1], vector[0]]
}
export const midpoint2 = (a: Point2Input, b: Point2Input): Point2 => multiply2(add2(a, b), 0.5)

export function normalize2(value: Point2Input, tolerance: KJTolerance = DEFAULT_TOLERANCE): Point2 {
  const vector = vec2(value, 'vector')
  const magnitude = length2(vector)
  if (tolerance.zero(magnitude)) throw new KJValidationError('Cannot normalize a zero-length vector')
  return [vector[0] / magnitude, vector[1] / magnitude]
}

export function angle2(value: Point2Input): number {
  const vector = vec2(value, 'vector')
  return Math.atan2(vector[1], vector[0])
}

export function signedAngle2(from: Point2Input, to: Point2Input): number {
  const normalizedFrom = normalize2(from)
  const normalizedTo = normalize2(to)
  return Math.atan2(cross2(normalizedFrom, normalizedTo), dot2(normalizedFrom, normalizedTo))
}

export function lerp2(a: Point2Input, b: Point2Input, t: number): Point2 {
  const start = vec2(a)
  const end = vec2(b)
  const parameter = Number(t)
  return [start[0] + (end[0] - start[0]) * parameter, start[1] + (end[1] - start[1]) * parameter]
}

export function equal2(a: Point2Input, b: Point2Input, tolerance: KJTolerance = DEFAULT_TOLERANCE): boolean {
  const left = vec2(a)
  const right = vec2(b)
  return distance2(left, right) <= tolerance.distanceFor(...left, ...right)
}

export function projectParameter2(
  point: Point2Input,
  origin: Point2Input,
  direction: Point2Input,
  tolerance: KJTolerance = DEFAULT_TOLERANCE,
): number {
  const resolvedPoint = vec2(point)
  const resolvedOrigin = vec2(origin)
  const resolvedDirection = vec2(direction, 'direction')
  const denominator = lengthSquared2(resolvedDirection)
  if (tolerance.zero(denominator)) throw new KJValidationError('Projection direction cannot be zero')
  return dot2(subtract2(resolvedPoint, resolvedOrigin), resolvedDirection) / denominator
}

export function closestPointOnSegment2(
  point: Point2Input,
  start: Point2Input,
  end: Point2Input,
  tolerance: KJTolerance = DEFAULT_TOLERANCE,
): ClosestPoint2 {
  const resolvedStart = vec2(start)
  const resolvedEnd = vec2(end)
  const direction = subtract2(resolvedEnd, resolvedStart)
  if (tolerance.zero(lengthSquared2(direction))) {
    return { point: resolvedStart, parameter: 0, distance: distance2(point, resolvedStart) }
  }
  const parameter = Math.max(0, Math.min(1, projectParameter2(point, resolvedStart, direction, tolerance)))
  const closest = lerp2(resolvedStart, resolvedEnd, parameter)
  return { point: closest, parameter, distance: distance2(point, closest) }
}
