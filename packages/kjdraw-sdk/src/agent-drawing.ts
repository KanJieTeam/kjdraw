import { createId } from './ids.js'
import { KJValidationError } from './errors.js'
import type { KJObjectPayload } from './schema.js'

export interface KJAgentPoint { x: number; y: number }
export interface KJAgentDrawingInput {
  expectedRevision: number
  units: string
  lines: { start: KJAgentPoint; end: KJAgentPoint }[]
  circles: { center: KJAgentPoint; radius: number }[]
  /** Counterclockwise arcs. Angles in degrees, measured from positive X. */
  arcs: { center: KJAgentPoint; radius: number; startDegrees: number; endDegrees: number }[]
  /** Straight-segment polylines. Do not repeat the first vertex to close. */
  polylines: { vertices: KJAgentPoint[]; closed: boolean }[]
}

const xyz = (point: KJAgentPoint): [number, number, number] => [point.x, point.y, 0]
const same = (a: KJAgentPoint, b: KJAgentPoint): boolean => a.x === b.x && a.y === b.y

/** Input is validated against the tool's JSON schema before normalization. */
export function buildAgentDrawingEntities(input: KJAgentDrawingInput, ownerId: string) {
  const total = input.lines.length + input.circles.length + input.arcs.length + input.polylines.length
  if (total < 1 || total > 64) throw new KJValidationError('A drawing proposal requires 1–64 total entities across all groups')
  const entity = (type: string, payload: KJObjectPayload) => ({ type, payload, options: { id: createId('entity'), ownerId } })
  return [
    ...input.lines.map(line => {
      if (same(line.start, line.end)) throw new KJValidationError('A line requires distinct endpoints')
      return entity('LINE', { start: xyz(line.start), end: xyz(line.end) })
    }),
    ...input.circles.map(circle => entity('CIRCLE', { center: xyz(circle.center), radius: circle.radius })),
    ...input.arcs.map(arc => {
      if ((arc.endDegrees - arc.startDegrees) % 360 === 0) throw new KJValidationError('An arc requires a nonzero sweep smaller than a full circle; use circles for full circles')
      return entity('ARC', { center: xyz(arc.center), radius: arc.radius, startAngle: arc.startDegrees * Math.PI / 180, endAngle: arc.endDegrees * Math.PI / 180, clockwise: false })
    }),
    ...input.polylines.map(polyline => {
      const points = polyline.vertices
      if (polyline.closed && points.length < 3) throw new KJValidationError('A closed polyline requires at least three vertices')
      if (points.some((point, index) => index > 0 && same(point, points[index - 1]!)) || (polyline.closed && same(points[0]!, points[points.length - 1]!))) throw new KJValidationError('Polyline vertices must not create zero-length segments; closed polylines close automatically')
      return entity('LWPOLYLINE', { vertices: points.map(xyz), closed: polyline.closed })
    }),
  ]
}
