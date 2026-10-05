import { KJValidationError } from '../errors.js'
import { intersectEntityPair2 } from '../snapping.js'
import { clone } from '../utils.js'
import type { KJObjectPayload, KJReadonlyObjectRecord } from '../schema.js'

type Point = [number, number, number]
type Homogeneous = [number, number, number]
interface Definition {
  degree: number
  controls: Homogeneous[]
  knots: number[]
  rational: boolean
  start: number
  end: number
  payload: KJObjectPayload
  tolerance: number
  roundoff: number
}
interface Entity { readonly type?: unknown; readonly payload?: unknown }

export interface KJSplineBreakOptions {
  readonly point?: unknown
  readonly firstPoint?: unknown
  readonly secondPoint?: unknown
  readonly points?: readonly unknown[]
  /** Native knot-domain parameter(s), never a normalized length fraction. */
  readonly parameter?: unknown
  readonly parameters?: unknown
  readonly tolerance?: unknown
}

export interface KJSplineTrimOptions {
  readonly tolerance?: unknown
  /** Resolve a self-crossing pick in the native knot domain. */
  readonly pickParameter?: unknown
}

const fail = (message: string): never => { throw new KJValidationError(`Native SPLINE edit: ${message}`) }
const finite = (value: unknown, label: string, bound = 1e9): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > bound) fail(`${label} must be a finite number within +/-${bound}`)
  return value as number
}
const point = (value: unknown, label: string): Point => {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) fail(`${label} must be an XY point`)
  const values = value as unknown[]
  const result: Point = [finite(values[0], label), finite(values[1], label), values.length === 3 ? finite(values[2], label) : 0]
  if (result[2] !== 0) fail(`${label} must be in the zero-elevation XY plane`)
  return result
}
const editTolerance = (value: unknown): number => {
  const result = value === undefined ? 1e-7 : finite(value, 'tolerance', 1e-2)
  if (result < 1e-9) fail('tolerance must be between 1e-9 and 1e-2 drawing units')
  return result
}
const dense = (values: readonly unknown[], label: string): void => {
  for (let index = 0; index < values.length; index++) if (!Object.hasOwn(values, index)) fail(`${label} must be dense`)
}
const xyNormal = (payload: KJObjectPayload): void => {
  if (payload.normal !== undefined && (!Array.isArray(payload.normal) || payload.normal.length !== 3
    || payload.normal[0] !== 0 || payload.normal[1] !== 0 || payload.normal[2] !== 1)) fail('normal must be [0, 0, 1]')
  if (payload.elevation !== undefined && payload.elevation !== 0) fail('elevation must be zero')
}

function definition(input: unknown, tolerance: number): Definition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('a complete control-point definition is required')
  const payload = clone(input) as KJObjectPayload
  xyNormal(payload)
  if (payload.closed !== undefined && typeof payload.closed !== 'boolean' || payload.periodic !== undefined && typeof payload.periodic !== 'boolean') fail('closed and periodic flags must be boolean')
  if (payload.closed === true || payload.periodic === true) fail('closed and periodic splines are unsupported')
  if (payload.fitPoints !== undefined && !Array.isArray(payload.fitPoints)) fail('fit data must be an array')
  if (Array.isArray(payload.fitPoints) && payload.fitPoints.length) fail('fit data is unsupported; use a control-point-only spline')
  if (payload.startTangent !== undefined || payload.endTangent !== undefined) fail('fit tangents are unsupported')
  const degree = finite(payload.degree, 'degree', 8)
  if (!Number.isInteger(degree) || degree < 1) fail('degree must be an integer from 1 to 8')
  if (!Array.isArray(payload.controlPoints) || payload.controlPoints.length < degree + 1 || payload.controlPoints.length > 256) fail('requires degree + 1 to 256 explicit control points; fit-only is unsupported')
  dense(payload.controlPoints as unknown[], 'control points')
  const controls = (payload.controlPoints as unknown[]).map((value, index) => point(value, `control point ${index}`))
  if (!Array.isArray(payload.knots) || payload.knots.length !== controls.length + degree + 1) fail('requires a complete explicit native knot vector')
  dense(payload.knots as unknown[], 'knots')
  const knots = (payload.knots as unknown[]).map(value => finite(value, 'knot'))
  if (knots.some((value, index) => index > 0 && value < knots[index - 1]!)) fail('knots must be nondecreasing')
  const start = knots[degree]!, end = knots[controls.length]!
  if (!(end > start) || knots.slice(0, degree + 1).some(value => value !== start)
    || knots.slice(controls.length).some(value => value !== end)) fail('requires a clamped nonempty knot domain')
  const distinct = [...new Set(knots)]
  if (distinct.slice(1).some((value, index) => value - distinct[index]! <= Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(distinct[index]!)) * 128)) fail('knot spans cannot be resolved reliably')
  for (const knot of distinct.slice(1, -1)) if (knots.filter(value => value === knot).length > degree) fail('discontinuous interior knots are unsupported')
  const rational = Array.isArray(payload.weights) && payload.weights.length > 0
  if (payload.weights !== undefined && !Array.isArray(payload.weights)) fail('weights must be an array')
  if (rational && (payload.weights as unknown[]).length !== controls.length) fail('weights must match the control points')
  if (rational) dense(payload.weights as unknown[], 'weights')
  const weights = rational ? (payload.weights as unknown[]).map(value => finite(value, 'weight', 1e12)) : controls.map(() => 1)
  const minimum = Math.min(...weights), maximum = Math.max(...weights)
  // Absolute bounds matter as well as the ratio: subnormal homogeneous
  // products can lose geometry while an equal-weight ratio still looks safe.
  if (minimum < 1e-12 || maximum / minimum > 1e8) fail('weights must be between 1e-12 and 1e12 with a ratio no greater than 1e8')
  // Conservative accumulated arithmetic budget for bounded homogeneous knot
  // insertion, subdivision and parameter recovery. Refuse rather than claim
  // sub-ULP precision for large coordinates or badly conditioned weights.
  const scale = Math.max(1, ...controls.flatMap(value => [Math.abs(value[0]), Math.abs(value[1])]))
  const roundoff = Number.EPSILON * scale * (maximum / minimum) * 512 * degree * (controls.length + degree + 1)
  if (roundoff > tolerance / 8) fail('coordinate/weight precision cannot meet the requested tolerance')
  const curve: Definition = { degree, controls: controls.map((value, index) => [value[0] * weights[index]!, value[1] * weights[index]!, weights[index]!]), knots, rational, start, end, payload, tolerance, roundoff }
  for (const piece of bezierPieces(curve)) {
    const values = piece.controls.map(value => [value[0] / value[2], value[1] / value[2]])
    if (Math.hypot(Math.max(...values.map(value => value[0]!)) - Math.min(...values.map(value => value[0]!)), Math.max(...values.map(value => value[1]!)) - Math.min(...values.map(value => value[1]!))) <= tolerance) fail('constant or tolerance-sized knot spans are not reliable edit targets')
  }
  return curve
}

function homogeneousAt(curve: Pick<Definition, 'degree' | 'controls' | 'knots'>, parameter: number): Homogeneous {
  const { degree, controls, knots } = curve, n = controls.length - 1
  let span = n
  if (parameter < knots[n + 1]!) for (let index = degree; index <= n; index++) if (parameter >= knots[index]! && parameter < knots[index + 1]!) { span = index; break }
  const work = controls.slice(span - degree, span + 1).map(value => [...value] as Homogeneous)
  for (let level = 1; level <= degree; level++) for (let index = degree; index >= level; index--) {
    const knotIndex = span - degree + index, denominator = knots[knotIndex + degree + 1 - level]! - knots[knotIndex]!
    const alpha = denominator === 0 ? 0 : (parameter - knots[knotIndex]!) / denominator
    const previous = work[index - 1]!, current = work[index]!
    work[index] = [previous[0] * (1 - alpha) + current[0] * alpha, previous[1] * (1 - alpha) + current[1] * alpha, previous[2] * (1 - alpha) + current[2] * alpha]
  }
  return work[degree]!
}
const at = (curve: Definition, parameter: number): Point => {
  const value = homogeneousAt(curve, parameter)
  return [value[0] / value[2], value[1] / value[2], 0]
}

function insertOnce(curve: Definition, parameter: number): Definition {
  const { degree: p, controls: source, knots: u } = curve, n = source.length - 1
  const k = u.findLastIndex(value => value <= parameter), s = u.filter(value => value === parameter).length
  if (s >= p) return curve
  const controls: Homogeneous[] = new Array(n + 2)
  for (let i = 0; i <= k - p; i++) controls[i] = [...source[i]!] as Homogeneous
  for (let i = k - s; i <= n; i++) controls[i + 1] = [...source[i]!] as Homogeneous
  for (let i = k - p + 1; i <= k - s; i++) {
    const denominator = u[i + p]! - u[i]!, alpha = (parameter - u[i]!) / denominator
    if (!(denominator > 0) || alpha < 0 || alpha > 1 || !Number.isFinite(alpha)) fail('knot insertion cannot resolve its span')
    const a = source[i - 1]!, b = source[i]!
    controls[i] = [a[0] * (1 - alpha) + b[0] * alpha, a[1] * (1 - alpha) + b[1] * alpha, a[2] * (1 - alpha) + b[2] * alpha]
  }
  return { ...curve, controls, knots: [...u.slice(0, k + 1), parameter, ...u.slice(k + 1)] }
}

function split(curve: Definition, parameter: number): [Definition, Definition] {
  if (!(parameter > curve.start && parameter < curve.end)) fail('cut parameter must lie strictly inside the spline domain')
  let refined = curve
  while (refined.knots.filter(value => value === parameter).length < curve.degree) refined = insertOnce(refined, parameter)
  const k = refined.knots.findLastIndex(value => value === parameter), shared = k - curve.degree
  return [
    { ...refined, controls: refined.controls.slice(0, shared + 1), knots: [...refined.knots.slice(0, k + 1), parameter], end: parameter },
    { ...refined, controls: refined.controls.slice(shared), knots: [parameter, ...refined.knots.slice(k - curve.degree + 1)], start: parameter },
  ]
}

function portion(curve: Definition, start: number, end: number): Definition {
  if (!(end > start)) fail('retained interval is empty')
  let result = curve
  if (end !== result.end) result = split(result, end)[0]
  if (start !== result.start) result = split(result, start)[1]
  return result
}
function payloadFor(curve: Definition): KJObjectPayload {
  const controls = curve.controls.map(value => [value[0] / value[2], value[1] / value[2], 0])
  if (controls.some(value => value.some(coordinate => !Number.isFinite(coordinate) || Math.abs(coordinate) > 1e9))) fail('result control points exceed the finite coordinate budget')
  if (Math.hypot(Math.max(...controls.map(value => value[0]!)) - Math.min(...controls.map(value => value[0]!)), Math.max(...controls.map(value => value[1]!)) - Math.min(...controls.map(value => value[1]!))) <= curve.tolerance) fail('retained interval is too small to resolve within tolerance')
  const payload = { ...clone(curve.payload), degree: curve.degree, controlPoints: controls, knots: [...curve.knots],
    ...(curve.rational ? { weights: curve.controls.map(value => value[2]) } : {}) }
  // A cut can introduce a near-coincident knot or exhaust an input budget.
  // Validate every planned result before the command mutates the document,
  // so saved fragments remain edit targets at the requested tolerance.
  definition(payload, curve.tolerance)
  return payload
}

function bezierPieces(curve: Definition): Definition[] {
  const cuts = [...new Set(curve.knots)].filter(value => value > curve.start && value < curve.end)
  const pieces: Definition[] = [], remaining = { ...curve }
  let rest = remaining
  for (const cut of cuts) { const [left, right] = split(rest, cut); pieces.push(left); rest = right }
  pieces.push(rest)
  return pieces
}

function bezierHalves(controls: Homogeneous[]): [Homogeneous[], Homogeneous[]] {
  let work = controls.map(value => [...value] as Homogeneous)
  const left = [work[0]!], right = [work.at(-1)!]
  while (work.length > 1) {
    work = work.slice(0, -1).map((value, index) => value.map((component, axis) => (component + work[index + 1]![axis]!) / 2) as Homogeneous)
    left.push(work[0]!); right.unshift(work.at(-1)!)
  }
  return [left, right]
}

// Positive rational Bezier weights make the Euclidean control hull an enclosure
// of the entire native span. This searches every surviving interval, rather
// than using the sampled nearest-point query to decide a destructive edit.
function parametersAtPoint(curve: Definition, target: Point): number[] {
  const hits: Array<[number, number]> = [], padding = curve.roundoff, resolution = curve.tolerance / 16
  let remaining = 65536
  const visit = (controls: Homogeneous[], lower: number, upper: number, depth: number): void => {
    if (--remaining < 0) fail('point parameter recovery exceeds its interval budget')
    const values = controls.map(value => [value[0] / value[2], value[1] / value[2]])
    const minX = Math.min(...values.map(value => value[0]!)), maxX = Math.max(...values.map(value => value[0]!))
    const minY = Math.min(...values.map(value => value[1]!)), maxY = Math.max(...values.map(value => value[1]!))
    const separation = Math.hypot(Math.max(minX - target[0], 0, target[0] - maxX), Math.max(minY - target[1], 0, target[1] - maxY))
    if (separation > curve.tolerance + padding) return
    if (Math.hypot(maxX - minX, maxY - minY) <= resolution) { hits.push([lower, upper]); return }
    const middle = (lower + upper) / 2
    if (depth === 60 || middle === lower || middle === upper) fail('point parameter recovery cannot resolve a unique bounded interval')
    const [left, right] = bezierHalves(controls)
    visit(left, lower, middle, depth + 1); visit(right, middle, upper, depth + 1)
  }
  for (const piece of bezierPieces(curve)) visit(piece.controls, piece.start, piece.end, 0)
  hits.sort((a, b) => a[0] - b[0])
  const clusters: Array<[number, number]> = []
  for (const hit of hits) {
    const previous = clusters.at(-1)
    if (previous && hit[0] <= previous[1]) previous[1] = Math.max(previous[1], hit[1])
    else clusters.push([...hit])
  }
  return clusters.map(([lower, upper]) => {
    // The accepted cluster is a complete near-point neighborhood, not one
    // sampled root. Constant spans and unresolved branches remain ambiguous.
    const nativeKnot = curve.knots.find(knot => knot >= lower && knot <= upper && Math.hypot(at(curve, knot)[0] - target[0], at(curve, knot)[1] - target[1]) <= curve.tolerance - curve.roundoff * 4)
    const parameter = nativeKnot ?? (lower + upper) / 2, value = at(curve, parameter)
    if (Math.hypot(value[0] - target[0], value[1] - target[1]) > curve.tolerance - curve.roundoff * 4) fail('point cannot be certified on the spline within tolerance')
    if (upper - lower > (curve.end - curve.start) * 1e-3) fail('point parameter is ambiguous on a stationary or degenerate span')
    return parameter
  })
}

function parameterValue(curve: Definition, value: unknown, interior = true): number {
  const parameter = finite(value, 'native parameter')
  if (interior ? parameter <= curve.start || parameter >= curve.end : parameter < curve.start || parameter > curve.end) fail('parameter is outside the permitted spline domain')
  const guard = Number.EPSILON * Math.max(1, Math.abs(parameter), Math.abs(curve.start), Math.abs(curve.end)) * 128
  if (interior && Math.min(parameter - curve.start, curve.end - parameter) <= guard) fail('cut is too close to an endpoint to resolve reliably')
  return parameter
}
function pointParameter(curve: Definition, value: unknown, explicit?: unknown): number {
  const selected = point(value, 'pick point')
  if (explicit !== undefined) {
    const parameter = parameterValue(curve, explicit, false), projected = at(curve, parameter)
    if (Math.hypot(projected[0] - selected[0], projected[1] - selected[1]) > curve.tolerance - curve.roundoff * 4) fail('explicit parameter does not match the pick point within tolerance')
    return parameter
  }
  const parameters = parametersAtPoint(curve, selected)
  if (parameters.length !== 1) fail('point has no unique spline parameter; supply an explicit native parameter to resolve multiple branches')
  return parameters[0]!
}

export function breakNativeSplinePayloads(input: unknown, options: KJSplineBreakOptions = {}): KJObjectPayload[] {
  const curve = definition(input, editTolerance(options.tolerance))
  if (options.parameters !== undefined && !Array.isArray(options.parameters)) fail('parameters must be an array')
  if (options.parameters !== undefined && options.parameter !== undefined) fail('choose parameter or parameters, not both')
  if (options.points !== undefined && !Array.isArray(options.points)) fail('points must be an array')
  if (options.points !== undefined && [options.point, options.firstPoint, options.secondPoint].some(value => value !== undefined)) fail('choose points or point aliases, not both')
  if (options.point !== undefined && options.firstPoint !== undefined) fail('choose point or firstPoint, not both')
  const explicit = options.parameters as readonly unknown[] | undefined ?? (options.parameter === undefined ? undefined : [options.parameter])
  const points = options.points ?? [options.firstPoint ?? options.point, options.secondPoint].filter(value => value !== undefined && value !== null)
  if (explicit && points.length) fail('choose native parameters or curve points, not both')
  if ((explicit ?? points).length < 1 || (explicit ?? points).length > 2) fail('BREAK requires one or two interior native parameters or curve points')
  dense(explicit ?? points, 'cut parameters/points')
  const parameters = (explicit ?? points).map(value => explicit ? parameterValue(curve, value) : parameterValue(curve, pointParameter(curve, value))).sort((a, b) => a - b)
  if (parameters.length < 1 || parameters.length > 2) fail('BREAK requires one or two interior native parameters or curve points')
  if (parameters.length === 2 && parameters[1]! - parameters[0]! <= Number.EPSILON * Math.max(1, Math.abs(parameters[0]!), Math.abs(parameters[1]!)) * 128) fail('BREAK cuts must be distinct and resolvable')
  return [payloadFor(portion(curve, curve.start, parameters[0]!)), payloadFor(portion(curve, parameters.at(-1)!, curve.end))]
}

function derivative(curve: Definition, parameter: number): [number, number] {
  const p = curve.degree
  const controls = curve.controls.slice(0, -1).map((value, index) => {
    const denominator = curve.knots[index + p + 1]! - curve.knots[index + 1]!
    return value.map((component, axis) => denominator === 0 ? 0 : p * (curve.controls[index + 1]![axis]! - component) / denominator) as Homogeneous
  })
  const a = homogeneousAt(curve, parameter), b = homogeneousAt({ degree: p - 1, controls, knots: curve.knots.slice(1, -1) }, parameter)
  return [(b[0] - a[0] / a[2] * b[2]) / a[2], (b[1] - a[1] / a[2] * b[2]) / a[2]]
}

function boundaryTangent(boundary: Entity, target: Point, tolerance: number): [number, number] {
  const payload = clone(boundary.payload) as KJObjectPayload, type = String(boundary.type)
  if (!payload || typeof payload !== 'object') fail('boundary payload is required')
  xyNormal(payload)
  if (type !== 'SPLINE') {
    const coordinates = ['start', 'end', 'origin', 'center', 'majorAxis'].flatMap(key => Array.isArray(payload[key]) ? (payload[key] as unknown[]).slice(0, 2).map(value => finite(value, `boundary ${key}`)) : [])
    const scale = Math.max(1, ...coordinates.map(Math.abs), type === 'CIRCLE' || type === 'ARC' ? finite(payload.radius, 'boundary radius') : 1)
    const conditioning = type === 'ELLIPSE' ? 1 / finite(payload.ratio, 'boundary ellipse ratio', 1) : 1
    if (!Number.isFinite(conditioning) || Number.EPSILON * scale * conditioning * 512 > tolerance / 8) fail('boundary coordinate precision cannot meet the requested tolerance')
  }
  if (['LINE', 'RAY', 'XLINE'].includes(type)) {
    const start = point(type === 'LINE' ? payload.start : payload.origin, 'boundary origin')
    const direction = type === 'LINE' ? point(payload.end, 'boundary end').map((value, index) => value - start[index]!) : point(payload.direction, 'boundary direction')
    if (Math.hypot(direction[0]!, direction[1]!) <= tolerance) fail('boundary line is degenerate')
    return [direction[0]!, direction[1]!]
  }
  if (type === 'CIRCLE' || type === 'ARC') {
    const center = point(payload.center, 'boundary center'), radius = finite(payload.radius, 'boundary radius')
    if (!(radius > tolerance)) fail('boundary radius is degenerate')
    if (type === 'ARC') {
      finite(payload.startAngle, 'boundary start angle'); finite(payload.endAngle, 'boundary end angle')
      if (payload.clockwise !== undefined && typeof payload.clockwise !== 'boolean') fail('boundary clockwise flag must be boolean')
    }
    return [-(target[1] - center[1]), target[0] - center[0]]
  }
  if (type === 'ELLIPSE') {
    const center = point(payload.center, 'boundary center'), major = point(payload.majorAxis, 'boundary major axis')
    const radius = Math.hypot(major[0], major[1]), ratio = finite(payload.ratio, 'boundary ellipse ratio', 1)
    if (!(ratio > 0) || radius * ratio <= tolerance) fail('boundary ellipse is degenerate')
    const x = ((target[0] - center[0]) * major[0] + (target[1] - center[1]) * major[1]) / radius
    const y = (-(target[0] - center[0]) * major[1] + (target[1] - center[1]) * major[0]) / radius
    const gx = x, gy = y / (ratio * ratio)
    return [(-gy * major[0] - gx * major[1]) / radius, (-gy * major[1] + gx * major[0]) / radius]
  }
  if (type === 'SPLINE') {
    const curve = definition(payload, tolerance), parameters = parametersAtPoint(curve, target)
    if (parameters.length !== 1) fail('a spline boundary intersection has ambiguous parameter branches')
    return derivative(curve, parameters[0]!)
  }
  return fail('TRIM boundaries support LINE, RAY, XLINE, CIRCLE, ARC, ELLIPSE and supported SPLINE')
}

function boundaryDistance(boundary: Entity, target: Point, tolerance: number): number {
  const payload = boundary.payload as KJObjectPayload, type = String(boundary.type)
  if (type === 'SPLINE') {
    const curve = definition(payload, tolerance / 2), parameters = parametersAtPoint(curve, target)
    if (parameters.length !== 1) fail('cut cannot be recovered uniquely on its spline boundary')
    const projected = at(curve, parameters[0]!)
    return Math.hypot(projected[0] - target[0], projected[1] - target[1]) + curve.roundoff * 4
  }
  if (['LINE', 'RAY', 'XLINE'].includes(type)) {
    const start = point(type === 'LINE' ? payload.start : payload.origin, 'boundary origin')
    const end = type === 'LINE' ? point(payload.end, 'boundary end') : point(payload.direction, 'boundary direction').map((value, index) => value + start[index]!)
    const dx = end[0]! - start[0], dy = end[1]! - start[1], squared = dx * dx + dy * dy
    let parameter = ((target[0] - start[0]) * dx + (target[1] - start[1]) * dy) / squared
    if (type !== 'XLINE') parameter = Math.max(0, parameter)
    if (type === 'LINE') parameter = Math.min(1, parameter)
    return Math.hypot(start[0] + parameter * dx - target[0], start[1] + parameter * dy - target[1])
  }
  const center = point(payload.center, 'boundary center'), turn = Math.PI * 2
  const positiveTurn = (value: number): number => (value % turn + turn) % turn
  let parameter: number, start: number, sweep: number, projected: Point
  if (type === 'CIRCLE' || type === 'ARC') {
    const radius = finite(payload.radius, 'boundary radius')
    parameter = Math.atan2(target[1] - center[1], target[0] - center[0])
    const clockwise = payload.clockwise === true
    start = type === 'ARC' ? finite(payload.startAngle, 'boundary start angle') : parameter
    sweep = type === 'ARC' ? positiveTurn((finite(payload.endAngle, 'boundary end angle') - start) * (clockwise ? -1 : 1)) : turn
    if (type === 'ARC' && positiveTurn((parameter - start) * (clockwise ? -1 : 1)) > sweep) {
      const end = start + (clockwise ? -sweep : sweep)
      parameter = Math.hypot(center[0] + radius * Math.cos(start) - target[0], center[1] + radius * Math.sin(start) - target[1])
        < Math.hypot(center[0] + radius * Math.cos(end) - target[0], center[1] + radius * Math.sin(end) - target[1]) ? start : end
    }
    projected = [center[0] + radius * Math.cos(parameter), center[1] + radius * Math.sin(parameter), 0]
  } else {
    const major = point(payload.majorAxis, 'boundary major axis'), radius = Math.hypot(major[0], major[1]), ratio = finite(payload.ratio, 'boundary ellipse ratio', 1)
    const x = ((target[0] - center[0]) * major[0] + (target[1] - center[1]) * major[1]) / radius
    const y = (-(target[0] - center[0]) * major[1] + (target[1] - center[1]) * major[0]) / radius
    parameter = Math.atan2(y / ratio, x); start = payload.startParameter === undefined ? 0 : finite(payload.startParameter, 'boundary start parameter')
    const end = payload.endParameter === undefined ? turn : finite(payload.endParameter, 'boundary end parameter')
    sweep = Math.abs(end - start) >= turn - 1e-12 ? turn : positiveTurn(end - start)
    const value = (angle: number): Point => [center[0] + major[0] * Math.cos(angle) - major[1] * ratio * Math.sin(angle), center[1] + major[1] * Math.cos(angle) + major[0] * ratio * Math.sin(angle), 0]
    if (positiveTurn(parameter - start) > sweep) {
      const a = value(start), b = value(start + sweep)
      parameter = Math.hypot(a[0] - target[0], a[1] - target[1]) < Math.hypot(b[0] - target[0], b[1] - target[1]) ? start : start + sweep
    }
    projected = value(parameter)
  }
  return Math.hypot(projected[0] - target[0], projected[1] - target[1])
}

export function trimNativeSplinePayloads(input: unknown, boundaries: readonly Entity[], pickPoint: unknown, options: KJSplineTrimOptions = {}): KJObjectPayload[] {
  const curve = definition(input, editTolerance(options.tolerance)), pick = pointParameter(curve, pickPoint, options.pickParameter)
  if (!Array.isArray(boundaries) || !boundaries.length || boundaries.length > 64) fail('TRIM requires 1-64 cutting boundaries')
  dense(boundaries, 'boundaries')
  const target = { id: '__native_spline_target__', type: 'SPLINE', payload: curve.payload } as unknown as KJReadonlyObjectRecord
  const cuts: number[] = []
  for (let index = 0; index < boundaries.length; index++) {
    const boundary = boundaries[index]!
    if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary)) fail('each boundary must be a complete entity')
    // Validate the full boundary plane before invoking an XY intersection.
    if (boundary.type === 'SPLINE') definition(boundary.payload, curve.tolerance)
    else boundaryTangent(boundary, at(curve, curve.start), curve.tolerance)
    const other = { id: `__native_spline_boundary_${index}__`, type: boundary.type, payload: boundary.payload } as unknown as KJReadonlyObjectRecord
    const result = intersectEntityPair2(target, other)
    if (result.kind === 'overlap' || result.infinite) fail('overlapping boundaries do not define an unambiguous trim interval')
    for (const location of result.points) {
      const parameters = parametersAtPoint(curve, [...location] as Point)
      if (!parameters.length) fail('intersection point cannot be recovered within the requested tolerance')
      for (const parameter of parameters) {
        if (parameter <= curve.start || parameter >= curve.end) continue
        const a = derivative(curve, parameter), b = boundaryTangent(boundary, at(curve, parameter), curve.tolerance)
        const product = Math.hypot(...a) * Math.hypot(...b), cross = a[0] * b[1] - a[1] * b[0]
        if (!(product > 0) || Math.abs(cross) <= product * 1e-6) fail('tangent or numerically uncertain intersection is not a reliable cutting boundary')
        const nearby = [...new Set(curve.knots)].filter(knot => knot !== parameter).map(knot => Math.abs(knot - parameter))
        const step = Math.min(parameter - curve.start, curve.end - parameter, ...nearby) * 1e-7
        const before = derivative(curve, parameter - step), after = derivative(curve, parameter + step)
        const leftCross = before[0] * b[1] - before[1] * b[0], rightCross = after[0] * b[1] - after[1] * b[0]
        if (!(step > 0) || leftCross * rightCross <= 0) fail('a corner contact does not define a reliable crossing')
        const cut = parameter
        if (boundaryDistance(boundary, at(curve, cut), curve.tolerance) + curve.roundoff * 4 > curve.tolerance) fail('intersection residual exceeds the requested absolute tolerance')
        const nearbyCut = cuts.find(value => Math.abs(value - cut) <= (curve.end - curve.start) * 1e-7 && Math.hypot(at(curve, value)[0] - location[0], at(curve, value)[1] - location[1]) <= curve.tolerance)
        if (nearbyCut !== undefined && Math.abs(nearbyCut - cut) > Number.EPSILON * Math.max(1, Math.abs(nearbyCut), Math.abs(cut)) * 1024) fail('nearby cutting points cannot be resolved as one or two distinct cuts')
        if (nearbyCut === undefined) cuts.push(cut)
      }
    }
  }
  cuts.sort((a, b) => a - b)
  if (!cuts.length) fail('no reliable trim intersection lies inside the target spline')
  if (cuts.some(value => Math.hypot(at(curve, value)[0] - at(curve, pick)[0], at(curve, value)[1] - at(curve, pick)[1]) <= curve.tolerance)) fail('pick lies on a cutting boundary; choose the interval to remove')
  const lower = cuts.filter(value => value < pick).at(-1) ?? curve.start, upper = cuts.find(value => value > pick) ?? curve.end
  const retained: KJObjectPayload[] = []
  if (lower > curve.start) retained.push(payloadFor(portion(curve, curve.start, lower)))
  if (upper < curve.end) retained.push(payloadFor(portion(curve, upper, curve.end)))
  if (!retained.length) fail('TRIM must retain at least one nonempty spline interval')
  return retained
}
