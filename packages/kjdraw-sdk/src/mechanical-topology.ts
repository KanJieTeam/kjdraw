/**
 * Recognize an end-view *topology*, not a complete manufacturing drawing.
 * This intentionally abstains when dimensions or ownership are ambiguous;
 * recognition alone is never evidence of generative or 1:1 coverage.
 */
export interface KJMechanicalTopologyEntity {
  type: string
  payload: Readonly<Record<string, unknown>>
}

export interface KJMechanicalBearingSeatEndView {
  center: readonly [number, number]
  crownRadius: number
  housingDiameter: number
  boreDiameter: number
  mountingHoleDiameter: number
  mountingHoleSpacing: number
}

export interface KJMechanicalBearingSeatDetection {
  status: 'match' | 'none' | 'ambiguous'
  candidates: readonly KJMechanicalBearingSeatEndView[]
}

type Circle = { x: number; y: number; radius: number }
type Arc = Circle & { start: number; end: number }
const tolerance = 1e-4
const near = (a: number, b: number): boolean => Math.abs(a - b) <= tolerance
const point = (value: unknown): readonly [number, number] | null =>
  Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1_000_000)
    ? [value[0], value[1]] : null
const scalar = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000 ? value : null

function circle(entity: KJMechanicalTopologyEntity): Circle | null {
  const payload = entity?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const center = point(payload.center), radius = scalar(payload.radius)
  return center && radius != null ? { x: center[0], y: center[1], radius } : null
}

function arc(entity: KJMechanicalTopologyEntity): Arc | null {
  const base = circle(entity)
  if (!base) return null
  const start = entity.payload.startAngle, end = entity.payload.endAngle
  return typeof start === 'number' && Number.isFinite(start) && typeof end === 'number' && Number.isFinite(end)
    ? { ...base, start, end } : null
}

function middleAngle(value: Arc): number {
  const turn = Math.PI * 2
  const start = ((value.start % turn) + turn) % turn
  const sweep = (((value.end - value.start) % turn) + turn) % turn
  return start + sweep / 2
}

function crownArc(value: Arc, housingRadius: number, upper: boolean): boolean {
  const midpoint = middleAngle(value)
  if ((Math.sin(midpoint) > 0) !== upper || Math.abs(Math.cos(midpoint)) > 0.1) return false
  const endpoints = [value.start, value.end].map(angle => ({
    x: value.radius * Math.cos(angle), y: value.radius * Math.sin(angle),
  }))
  const expectedY = Math.sqrt(value.radius ** 2 - housingRadius ** 2)
  return endpoints.every(({ x, y }) => near(Math.abs(x), housingRadius) && near(y, upper ? expectedY : -expectedY))
    && endpoints[0]!.x * endpoints[1]!.x < 0
}

/**
 * Expects the caller's model-space primitive entities. It does not copy,
 * convert, or infer annotations, side views, material, or title blocks.
 */
export function detectMechanicalBearingSeatEndView(entities: readonly KJMechanicalTopologyEntity[]): KJMechanicalBearingSeatDetection {
  if (!Array.isArray(entities) || entities.length > 100_000) return { status: 'none', candidates: [] }
  const circles = entities.filter(entity => entity?.type === 'CIRCLE').map(circle).filter((value): value is Circle => value != null)
  const arcs = entities.filter(entity => entity?.type === 'ARC').map(arc).filter((value): value is Arc => value != null)
  // Every arc pair may scan every circle. Refuse inputs above a fixed work
  // budget before the quadratic loop so adversarial drawings cannot cause a
  // multi-billion-comparison search. All known local candidates fit below it.
  const pairCount = arcs.length * (arcs.length - 1) / 2
  if (pairCount * Math.max(circles.length, 1) > 2_000_000) return { status: 'none', candidates: [] }
  const found: KJMechanicalBearingSeatEndView[] = []
  for (let first = 0; first < arcs.length; first++) for (let second = first + 1; second < arcs.length; second++) {
    const a = arcs[first]!, b = arcs[second]!
    if (!near(a.x, b.x) || !near(a.y, b.y) || !near(a.radius, b.radius)) continue
    const concentric = circles.filter(item => near(item.x, a.x) && near(item.y, a.y)).sort((left, right) => left.radius - right.radius)
    if (concentric.length !== 2) continue
    const bore = concentric[0]!, housing = concentric[1]!
    if (near(bore.radius, housing.radius) || housing.radius >= a.radius) continue
    if (!(crownArc(a, housing.radius, true) && crownArc(b, housing.radius, false))
      && !(crownArc(b, housing.radius, true) && crownArc(a, housing.radius, false))) continue
    const holes = circles.filter(item => near(item.x, a.x) && !near(item.y, a.y) && item.radius < housing.radius)
    const pairs: [Circle, Circle][] = []
    for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
      const lower = holes[i]!.y < holes[j]!.y ? holes[i]! : holes[j]!
      const upper = holes[i]!.y < holes[j]!.y ? holes[j]! : holes[i]!
      if (lower.y < a.y && upper.y > a.y && near(lower.radius, upper.radius)
        && near((lower.y + upper.y) / 2, a.y)
        && upper.y - lower.y >= 2 * upper.radius
        && upper.y - a.y + upper.radius <= a.radius + tolerance) pairs.push([lower, upper])
    }
    if (pairs.length !== 1) continue
    const [lower, upper] = pairs[0]!
    found.push({ center: [a.x, a.y], crownRadius: a.radius,
      housingDiameter: housing.radius * 2, boreDiameter: bore.radius * 2,
      mountingHoleDiameter: lower.radius * 2, mountingHoleSpacing: upper.y - lower.y })
  }
  const unique = found.filter((item, index) => found.findIndex(other => near(item.center[0], other.center[0]) && near(item.center[1], other.center[1]) && near(item.crownRadius, other.crownRadius)) === index)
  return { status: unique.length === 0 ? 'none' : unique.length === 1 ? 'match' : 'ambiguous', candidates: unique }
}
