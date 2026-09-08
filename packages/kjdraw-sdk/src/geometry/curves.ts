import { KJValidationError } from '../errors.js'
import { invokeGeometryBackend } from './backend.js'
import { distance2, vec2, type Point2, type Point2Input } from './vector2.js'

export interface EllipseDefinition {
  majorAxis?: readonly unknown[]
  majorRadius?: number
  majorAxisLength?: number
  ratio?: number
  startParameter?: number
  endParameter?: number
}

export interface EllipseRadii {
  major: number
  minor: number
}

export interface EllipseArcLengthOptions {
  tolerance?: number
}

export interface SplineDefinition {
  degree?: number
  controlPoints?: readonly Point2Input[]
  knots?: readonly number[]
  weights?: readonly number[]
}

export interface NormalizedSplineDefinition {
  degree: number
  controlPoints: Point2[]
  knots: number[]
  weights: number[]
}

export interface SplineLengthOptions {
  tolerance?: number
}

export interface SplineBackendOptions extends SplineLengthOptions {
  degree: number
  knots: readonly number[]
  weights: readonly number[]
}

function positive(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new KJValidationError(`${label} must be a positive finite number`)
  }
  return number
}

function adaptiveSimpson(
  fn: (parameter: number) => number,
  start: number,
  end: number,
  tolerance: number,
  depth = 24,
): number {
  const simpson = (a: number, b: number, fa: number, fm: number, fb: number): number => (
    (b - a) * (fa + 4 * fm + fb) / 6
  )
  const recurse = (
    a: number,
    b: number,
    fa: number,
    fm: number,
    fb: number,
    whole: number,
    budget: number,
    remaining: number,
  ): number => {
    const middle = (a + b) / 2
    const leftMiddle = (a + middle) / 2
    const rightMiddle = (middle + b) / 2
    const flm = fn(leftMiddle)
    const frm = fn(rightMiddle)
    const left = simpson(a, middle, fa, flm, fm)
    const right = simpson(middle, b, fm, frm, fb)
    const delta = left + right - whole
    if (remaining <= 0 || Math.abs(delta) <= 15 * budget) return left + right + delta / 15
    return recurse(a, middle, fa, flm, fm, left, budget / 2, remaining - 1)
      + recurse(middle, b, fm, frm, fb, right, budget / 2, remaining - 1)
  }
  const middle = (start + end) / 2
  const fa = fn(start)
  const fm = fn(middle)
  const fb = fn(end)
  return recurse(start, end, fa, fm, fb, simpson(start, end, fa, fm, fb), tolerance, depth)
}

export function ellipseRadii(payload: EllipseDefinition = {}): EllipseRadii {
  const axis = payload.majorAxis
  const major = Array.isArray(axis)
    ? Math.hypot(Number(axis[0]) || 0, Number(axis[1]) || 0, Number(axis[2]) || 0)
    : Number(payload.majorRadius ?? payload.majorAxisLength)
  const ratio = Number(payload.ratio ?? 1)
  if (
    !Number.isFinite(major)
    || major <= 0
    || !Number.isFinite(ratio)
    || ratio <= 0
    || ratio > 1
  ) throw new KJValidationError('Ellipse requires a valid major axis and ratio')
  return { major, minor: major * ratio }
}

function ellipseArcLengthReference(
  payload: EllipseDefinition,
  options: EllipseArcLengthOptions = {},
): number {
  const { major, minor } = ellipseRadii(payload)
  let start = Number(payload.startParameter ?? 0)
  let end = Number(payload.endParameter ?? Math.PI * 2)
  if (![start, end].every(Number.isFinite)) {
    throw new KJValidationError('Ellipse parameters must be finite')
  }
  if (start === end) return 0
  if (start > end) [start, end] = [end, start]
  const tolerance = positive(
    options.tolerance ?? Math.max(major, minor, 1) * 1e-11,
    'Ellipse length tolerance',
  )
  return adaptiveSimpson(
    parameter => Math.hypot(major * Math.sin(parameter), minor * Math.cos(parameter)),
    start,
    end,
    tolerance,
  )
}

export function ellipseArcLength2(
  payload: EllipseDefinition,
  options: EllipseArcLengthOptions = {},
): number {
  const { major, minor } = ellipseRadii(payload)
  const start = Number(payload.startParameter ?? 0)
  const end = Number(payload.endParameter ?? Math.PI * 2)
  const tolerance = positive(
    options.tolerance ?? Math.max(major, minor, 1) * 1e-11,
    'Ellipse length tolerance',
  )
  return invokeGeometryBackend(
    'ellipseArcLength2',
    [major, minor, start, end, { tolerance }],
    () => ellipseArcLengthReference(payload, { tolerance }),
  )
}

export function clampedUniformKnots(pointCount: number, degree: number): number[] {
  const resolvedPointCount = Number(pointCount)
  const resolvedDegree = Number(degree)
  if (
    !Number.isInteger(resolvedPointCount)
    || !Number.isInteger(resolvedDegree)
    || resolvedDegree < 1
    || resolvedPointCount < resolvedDegree + 1
  ) throw new KJValidationError('Invalid spline point count or degree')
  const n = resolvedPointCount - 1
  const last = n + resolvedDegree + 1
  return Array.from({ length: last + 1 }, (_, index) => {
    if (index <= resolvedDegree) return 0
    if (index >= n + 1) return 1
    return (index - resolvedDegree) / (n - resolvedDegree + 1)
  })
}

export function normalizeSplineDefinition(payload: SplineDefinition = {}): NormalizedSplineDefinition {
  const degree = Math.trunc(positive(payload.degree, 'Spline degree'))
  const controlPoints = (payload.controlPoints ?? []).map((point, index) => (
    vec2(point, `controlPoints[${index}]`)
  ))
  if (controlPoints.length < degree + 1) {
    throw new KJValidationError('Spline requires at least degree + 1 control points')
  }
  const knots = payload.knots?.length
    ? payload.knots.map(Number)
    : clampedUniformKnots(controlPoints.length, degree)
  if (
    knots.length !== controlPoints.length + degree + 1
    || knots.some((value, index) => (
      !Number.isFinite(value) || (index > 0 && value < knots[index - 1]!)
    ))
  ) throw new KJValidationError('Spline knot vector is invalid')
  const weights = payload.weights?.length
    ? payload.weights.map((value, index) => positive(value, `weights[${index}]`))
    : []
  if (weights.length && weights.length !== controlPoints.length) {
    throw new KJValidationError('Spline weights must match control points')
  }
  if (!(knots[controlPoints.length]! > knots[degree]!)) {
    throw new KJValidationError('Spline knot domain is empty')
  }
  return { degree, controlPoints, knots, weights }
}

export function splinePoint2(
  payload: SplineDefinition | NormalizedSplineDefinition,
  parameter: number,
): Point2 {
  const { degree, controlPoints, knots, weights } = normalizeSplineDefinition(payload)
  const n = controlPoints.length - 1
  const start = knots[degree]!
  const end = knots[n + 1]!
  const resolvedParameter = Math.max(start, Math.min(end, Number(parameter)))
  if (!Number.isFinite(resolvedParameter)) throw new KJValidationError('Spline parameter must be finite')
  const span = resolvedParameter >= end
    ? n
    : Array.from({ length: n - degree + 1 }, (_, index) => degree + index)
      .find(index => resolvedParameter >= knots[index]! && resolvedParameter < knots[index + 1]!) ?? n
  const values: [number, number, number][] = Array.from({ length: degree + 1 }, (_, index) => {
    const controlIndex = span - degree + index
    const weight = weights[controlIndex] ?? 1
    const point = controlPoints[controlIndex]!
    return [point[0] * weight, point[1] * weight, weight]
  })
  for (let level = 1; level <= degree; level += 1) {
    for (let index = degree; index >= level; index -= 1) {
      const knotIndex = span - degree + index
      const denominator = knots[knotIndex + degree + 1 - level]! - knots[knotIndex]!
      const alpha = Math.abs(denominator) <= Number.EPSILON
        ? 0
        : (resolvedParameter - knots[knotIndex]!) / denominator
      const previous = values[index - 1]!
      const current = values[index]!
      values[index] = [
        previous[0] * (1 - alpha) + current[0] * alpha,
        previous[1] * (1 - alpha) + current[1] * alpha,
        previous[2] * (1 - alpha) + current[2] * alpha,
      ]
    }
  }
  const result = values[degree]!
  return [result[0] / result[2], result[1] / result[2]]
}

function splineLengthReference(
  payload: SplineDefinition | NormalizedSplineDefinition,
  options: SplineLengthOptions = {},
): number {
  const definition = normalizeSplineDefinition(payload)
  const start = definition.knots[definition.degree]!
  const end = definition.knots[definition.controlPoints.length]!
  const tolerance = positive(options.tolerance ?? 1e-8, 'Spline length tolerance')
  const pointAt = (parameter: number): Point2 => splinePoint2(definition, parameter)
  const recurse = (
    a: number,
    b: number,
    pa: Point2,
    pb: Point2,
    budget: number,
    depth: number,
  ): number => {
    const middle = (a + b) / 2
    const pm = pointAt(middle)
    const chord = distance2(pa, pb)
    const polygon = distance2(pa, pm) + distance2(pm, pb)
    if (depth <= 0 || polygon - chord <= budget) return (polygon + chord) / 2
    return recurse(a, middle, pa, pm, budget / 2, depth - 1)
      + recurse(middle, b, pm, pb, budget / 2, depth - 1)
  }
  return recurse(start, end, pointAt(start), pointAt(end), tolerance, 24)
}

export function splineLength2(
  payload: SplineDefinition,
  options: SplineLengthOptions = {},
): number {
  const definition = normalizeSplineDefinition(payload)
  const tolerance = positive(options.tolerance ?? 1e-8, 'Spline length tolerance')
  const backendOptions: SplineBackendOptions = {
    degree: definition.degree,
    knots: definition.knots,
    weights: definition.weights,
    tolerance,
  }
  return invokeGeometryBackend(
    'splineLength2',
    [definition.controlPoints, backendOptions],
    () => splineLengthReference(definition, { tolerance }),
  )
}
