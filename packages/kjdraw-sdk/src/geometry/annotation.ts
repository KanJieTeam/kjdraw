type Point = readonly [number, number]
export interface KJDimensionArcProjection { center: Point; radius: number; startAngle: number; endAngle: number }
export interface KJDimensionProjection {
  /** Circular arcs use CCW radians; endAngle is greater than startAngle. */
  arcs: KJDimensionArcProjection[]
  lines: Array<readonly [Point, Point]>
  arrows: Point[][]
  label: { position: Point; text: string; height: number; rotation: number }
  /** Angular dimensions use degrees; other dimensions use drawing length units. */
  measurement: number
}
const finite = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) && value != null ? Number(value) : fallback
const point = (value: unknown): Point | null => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(v => Number.isFinite(Number(v))) ? [Number(value[0]), Number(value[1])] : null
const plus = (a: Point, b: Point, factor = 1): Point => [a[0] + b[0] * factor, a[1] + b[1] * factor]
const delta = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1]
const length = (v: Point): number => Math.hypot(v[0], v[1])

/** Internal shared resolution for native projection and DXF DSTYLE persistence.
 * Returned lengths are unscaled; apply overallScale exactly once. */
export function resolveDimensionAnnotationStyle(payload: Readonly<Record<string, unknown>>, style: Readonly<Record<string, unknown>> = {}): { overallScale: number; textHeight: number; arrowSize: number; extensionOffset: number; extensionBeyond: number } {
  const overallScale = Math.max(1e-9, finite(payload.overallScale ?? style.overallScale, 1))
  const height = Math.max(1e-9, finite(payload.textHeight ?? style.textHeight, 2.5) * overallScale)
  return {
    overallScale,
    textHeight: height / overallScale,
    arrowSize: Math.max(1e-9, finite(payload.arrowSize ?? style.arrowSize, height * .7 / overallScale) * overallScale) / overallScale,
    extensionOffset: Math.max(0, finite(payload.extensionOffset ?? style.extensionOffset, height * .2 / overallScale) * overallScale) / overallScale,
    extensionBeyond: Math.max(0, finite(payload.extensionBeyond ?? style.extensionBeyond, height * .35 / overallScale) * overallScale) / overallScale,
  }
}

/** Project supported native DIMENSION semantics into model-space annotation geometry. */
export function projectDimension(payload: Readonly<Record<string, unknown>>, style: Readonly<Record<string, unknown>> = {}): KJDimensionProjection | null {
  const points = Array.isArray(payload.definitionPoints) ? payload.definitionPoints.map(point) : []
  const first = points[0], second = points[1]
  if (!first || !second) return null
  const type = String(payload.dimensionType ?? 'ALIGNED').toUpperCase()
  const resolved = resolveDimensionAnnotationStyle(payload, style)
  const height = resolved.textHeight * resolved.overallScale
  const arrowSize = resolved.arrowSize * resolved.overallScale
  const gap = resolved.extensionOffset * resolved.overallScale
  const beyond = resolved.extensionBeyond * resolved.overallScale
  const lines: KJDimensionProjection['lines'] = []
  const arrows: Point[][] = []
  const arcs: KJDimensionArcProjection[] = []
  const arrow = (tip: Point, direction: Point) => {
    const rear = plus(tip, direction, arrowSize), normal: Point = [-direction[1], direction[0]]
    arrows.push([tip, plus(rear, normal, arrowSize * .3), plus(rear, normal, -arrowSize * .3)])
  }
  let measurement: number, textPoint: Point, rotation = 0, prefix = ''
  if (type === 'ALIGNED' || type === 'ROTATED' || type === 'LINEAR') {
    const a = second, b = points[2]
    if (!b) return null
    const ab = delta(b, a), span = length(ab)
    if (span < 1e-12) return null
    const angle = type === 'ALIGNED' ? Math.atan2(ab[1], ab[0]) : finite(payload.rotation, 0)
    const u: Point = [Math.cos(angle), Math.sin(angle)], n: Point = [-u[1], u[0]]
    const d1 = dot(delta(first, a), n), d2 = dot(delta(first, b), n)
    const q1 = plus(a, n, d1), q2 = plus(b, n, d2), direction = delta(q2, q1), dimensionSpan = length(direction)
    if (dimensionSpan < 1e-12) return null
    const sign1 = Math.sign(d1) || 1, sign2 = Math.sign(d2) || 1
    lines.push([plus(a, n, sign1 * gap), plus(q1, n, sign1 * beyond)], [plus(b, n, sign2 * gap), plus(q2, n, sign2 * beyond)], [q1, q2])
    const inward: Point = [direction[0] / dimensionSpan, direction[1] / dimensionSpan]
    arrow(q1, inward); arrow(q2, [-inward[0], -inward[1]])
    measurement = dimensionSpan
    textPoint = plus([(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2], n, height * .65)
    rotation = angle

  } else if (type === 'ANGULAR' || type === 'ANGULAR_3_POINT') {
    if (payload.incompleteAngularDefinition === true) return null
    if ((payload.definitionPoints as unknown[]).some(value => !Array.isArray(value) || value.length > 2 && (!Number.isFinite(Number(value[2])) || Math.abs(Number(value[2])) > 1e-12))) return null
    for (const key of ['normal', 'extrusionDirection']) {
      const normal = payload[key]
      if (Array.isArray(normal) && (Math.abs(Number(normal[0])) > 1e-12 || Math.abs(Number(normal[1])) > 1e-12 || Math.abs(Number(normal[2]) - 1) > 1e-12)) return null
    }
    const third = points[2], fourth = points[3]
    if (!third || !fourth) return null
    let center: Point, u: Point, v: Point, location: Point, origin1: Point, origin2: Point
    if (type === 'ANGULAR') {
      location = points[4]!
      if (!location) return null
      const d1 = delta(third, second), d2 = delta(first, fourth), l1 = length(d1), l2 = length(d2)
      if (l1 < 1e-12 || l2 < 1e-12) return null
      u = [d1[0] / l1, d1[1] / l1]; v = [d2[0] / l2, d2[1] / l2]
      const cross = u[0] * v[1] - u[1] * v[0]
      if (Math.abs(cross) < 1e-12) return null
      const separation = delta(fourth, second), t = (separation[0] * v[1] - separation[1] * v[0]) / cross
      center = plus(second, u, t)
      origin1 = length(delta(second, center)) > 1e-12 ? second : third
      origin2 = length(delta(fourth, center)) > 1e-12 ? fourth : first
    } else {
      center = fourth; location = first; origin1 = second; origin2 = third
      const d1 = delta(second, center), d2 = delta(third, center), l1 = length(d1), l2 = length(d2)
      if (l1 < 1e-12 || l2 < 1e-12) return null
      u = [d1[0] / l1, d1[1] / l1]; v = [d2[0] / l2, d2[1] / l2]
    }
    const turn = Math.PI * 2, positive = (angle: number) => (angle % turn + turn) % turn
    const radius = length(delta(location, center)), placement = positive(Math.atan2(location[1] - center[1], location[0] - center[0]))
    let startAngle = positive(Math.atan2(u[1], u[0])), endAngle = positive(Math.atan2(v[1], v[0]))
    if (radius < 1e-12 || ![...center, radius, placement].every(Number.isFinite)) return null
    if (type === 'ANGULAR') {
      // Two undirected lines define four sectors. DXF group 16 selects the
      // adjacent sector containing the arc location; each is less than 180 deg.
      const rays = [startAngle, positive(startAngle + Math.PI), endAngle, positive(endAngle + Math.PI)].sort((a, b) => a - b)
      let selected = false
      for (let i = 0; i < rays.length; i++) {
        const a = rays[i]!, b = rays[(i + 1) % rays.length]!, offset = positive(placement - a), span = positive(b - a)
        if (offset > 1e-10 && offset < span - 1e-10) {
          const nextU: Point = [Math.cos(a), Math.sin(a)], nextV: Point = [Math.cos(b), Math.sin(b)]
          if (Math.abs(dot(nextU, u)) < 1 - 1e-9) [origin1, origin2] = [origin2, origin1]
          startAngle = a; endAngle = b; u = nextU; v = nextV; selected = true; break
        }
      }
      if (!selected) return null // The arc location lies on a line: no unique sector.
    } else {
      const span = positive(endAngle - startAngle), offset = positive(placement - startAngle)
      if (span < 1e-10 || offset < 1e-10 || Math.abs(offset - span) < 1e-10) return null
      if (offset > span) {
        [startAngle, endAngle] = [endAngle, startAngle]; [u, v] = [v, u]; [origin1, origin2] = [origin2, origin1]
      }
    }
    const sweep = positive(endAngle - startAngle)
    if (sweep < 1e-12) return null
    const q1 = plus(center, u, radius), q2 = plus(center, v, radius)
    for (const [origin, direction, q] of [[origin1, u, q1], [origin2, v, q2]] as const) {
      const sign = Math.sign(dot(delta(q, origin), direction)) || 1
      lines.push([plus(origin, direction, sign * gap), plus(q, direction, sign * beyond)])
    }
    arcs.push({ center, radius, startAngle, endAngle: startAngle + sweep })
    arrow(q1, [-u[1], u[0]]); arrow(q2, [v[1], -v[0]])
    measurement = sweep * 180 / Math.PI
    const mid = startAngle + sweep / 2, radial: Point = [Math.cos(mid), Math.sin(mid)]
    textPoint = plus(center, radial, radius + height * .65); rotation = mid - Math.PI / 2
  } else if (type === 'RADIUS' || type === 'DIAMETER') {
    // DXF: group 10 is center (radius) / first chord end (diameter), group 15 is the other point.
    const direction = delta(second, first), span = length(direction)
    if (span < 1e-12) return null
    const u: Point = [direction[0] / span, direction[1] / span]
    measurement = span; prefix = type === 'RADIUS' ? 'R' : '⌀'
    lines.push([first, second]); arrow(second, [-u[0], -u[1]])
    if (type === 'DIAMETER') arrow(first, u)
    textPoint = plus(second, u, height * 1.1)
  } else return null
  const angular = type === 'ANGULAR' || type === 'ANGULAR_3_POINT'
  if (angular && Number(payload.angularUnits ?? style.angularUnits ?? 0) !== 0) return null
  const stylePrecision = angular && Number(style.angularDecimalPlaces) >= 0 ? style.angularDecimalPlaces : style.decimalPlaces
  const precision = Math.max(0, Math.min(8, Math.trunc(finite(Number(payload.precision) === -1 ? payload.linearPrecision ?? style.decimalPlaces : payload.precision ?? stylePrecision, 2))))
  const measuredText = `${prefix}${measurement.toFixed(precision).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}`
  const suffix = type === 'ANGULAR' || type === 'ANGULAR_3_POINT' ? '°' : ''
  const override = payload.textOverride
  const text = override == null || override === '' ? measuredText + suffix : String(override).replaceAll('<>', measuredText + suffix)
  const overridePoint = point(payload.textPosition)
  if (overridePoint && (type === 'RADIUS' || type === 'DIAMETER')) lines.push([second, overridePoint])
  // Keep labels readable from the bottom/right without changing their geometry.
  if (rotation > Math.PI / 2 || rotation < -Math.PI / 2) rotation += Math.PI
  return { lines, arcs, arrows, label: { position: overridePoint ?? textPoint, text, height, rotation }, measurement }
}
