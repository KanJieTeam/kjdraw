import { KJValidationError } from '../errors.js'
import { invokeGeometryBackend } from './backend.js'
import {
  ellipseArcLength2,
  ellipseRadii,
  splineLength2,
  type EllipseDefinition,
  type SplineDefinition,
} from './curves.js'
import { normalizeAngle } from './tolerance.js'
import { distance2, vec2, type Point2, type Point2Input } from './vector2.js'

export interface BulgedPolylineVertex {
  point: Point2Input
  bulge?: number
  startWidth?: number
  endWidth?: number
  [property: string]: unknown
}

export type PolylineVertex = readonly unknown[] | BulgedPolylineVertex

export interface PolylineMeasureOptions {
  closed?: boolean
}

export interface BulgeSegmentMetrics {
  chord: number
  radius: number
  sweep: number
  length: number
  segmentArea: number
}

export interface ArcDefinition {
  startAngle?: number
  endAngle?: number
  clockwise?: boolean
  fullCircle?: boolean
  [property: string]: unknown
}

export interface GeometryEntityLike {
  type?: unknown
  payload?: Record<string, unknown>
  [property: string]: unknown
}

export interface EntityLengthMeasurement {
  value: number
  approximate: boolean
  algorithm?: 'adaptive-rational-bspline' | 'adaptive-quadrature'
}

export interface EntityAreaMeasurement {
  value: number
  signed: boolean
  approximate: boolean
}

function vertexPoint(vertex: PolylineVertex): Point2 {
  if (Array.isArray(vertex)) return vec2(vertex, 'polyline vertex')
  return vec2((vertex as BulgedPolylineVertex).point, 'polyline vertex')
}

function vertexBulge(vertex: PolylineVertex): number {
  return Array.isArray(vertex) ? 0 : Number((vertex as BulgedPolylineVertex).bulge ?? 0)
}

function polylineVertices(value: unknown): readonly PolylineVertex[] {
  return Array.isArray(value) ? value as PolylineVertex[] : []
}

export function bulgeSegmentMetrics(
  start: Point2Input,
  end: Point2Input,
  bulge = 0,
): BulgeSegmentMetrics {
  const resolvedStart = vec2(start)
  const resolvedEnd = vec2(end)
  const resolvedBulge = Number(bulge)
  const chord = distance2(resolvedStart, resolvedEnd)
  if (!Number.isFinite(resolvedBulge) || Math.abs(resolvedBulge) < 1e-15 || chord === 0) {
    return { chord, radius: Infinity, sweep: 0, length: chord, segmentArea: 0 }
  }
  const sweep = 4 * Math.atan(resolvedBulge)
  const radius = chord * (1 + resolvedBulge * resolvedBulge) / (4 * Math.abs(resolvedBulge))
  return {
    chord,
    radius,
    sweep,
    length: Math.abs(sweep) * radius,
    segmentArea: 0.5 * radius * radius * (sweep - Math.sin(sweep)),
  }
}

function polylineLengthReference2(
  vertices: readonly PolylineVertex[],
  { closed = false }: PolylineMeasureOptions = {},
): number {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0
  let length = 0
  const count = closed ? vertices.length : vertices.length - 1
  for (let index = 0; index < count; index += 1) {
    const current = vertices[index]
    const next = vertices[(index + 1) % vertices.length]
    length += bulgeSegmentMetrics(vertexPoint(current), vertexPoint(next), vertexBulge(current)).length
  }
  return length
}

export function polylineLength2(
  vertices: readonly PolylineVertex[] | null | undefined,
  { closed = false }: PolylineMeasureOptions = {},
): number {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0
  if (vertices.some(vertex => Math.abs(vertexBulge(vertex)) >= 1e-15)) {
    return polylineLengthReference2(vertices, { closed })
  }
  const points = vertices.map(vertexPoint)
  return invokeGeometryBackend(
    'polylineLength2',
    [points, { closed }],
    () => polylineLengthReference2(vertices, { closed }),
  )
}

function polylineAreaReference2(vertices: readonly PolylineVertex[]): number {
  // A closed CAD polyline may have only two vertices when one edge is a
  // bulge arc and the return edge is its chord (for example a semicircle).
  if (!Array.isArray(vertices) || vertices.length < 2) return 0
  let twiceArea = 0
  let arcArea = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]
    const next = vertices[(index + 1) % vertices.length]
    const a = vertexPoint(current)
    const b = vertexPoint(next)
    twiceArea += a[0] * b[1] - b[0] * a[1]
    arcArea += bulgeSegmentMetrics(a, b, vertexBulge(current)).segmentArea
  }
  return twiceArea / 2 + arcArea
}

export function polylineArea2(vertices: readonly PolylineVertex[] | null | undefined): number {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0
  if (vertices.some(vertex => Math.abs(vertexBulge(vertex)) >= 1e-15)) {
    return polylineAreaReference2(vertices)
  }
  const points = vertices.map(vertexPoint)
  return invokeGeometryBackend('polylineArea2', [points], () => polylineAreaReference2(vertices))
}

export function arcSweep(payload: ArcDefinition): number {
  const start = Number(payload.startAngle ?? 0)
  const end = Number(payload.endAngle ?? 0)
  let sweep = normalizeAngle(end - start)
  if (payload.clockwise && sweep > 0) sweep -= Math.PI * 2
  if (!payload.clockwise && sweep < 0) sweep += Math.PI * 2
  if (payload.fullCircle) sweep = payload.clockwise ? -Math.PI * 2 : Math.PI * 2
  return sweep
}

export function entityLength2(object: GeometryEntityLike | null | undefined): EntityLengthMeasurement {
  const type = String(object?.type ?? '').toUpperCase()
  const payload = (object?.payload ?? object ?? {}) as Record<string, unknown>
  switch (type) {
    case 'LINE':
      return { value: distance2(payload.start as Point2Input, payload.end as Point2Input), approximate: false }
    case 'RAY':
    case 'XLINE':
      return { value: Infinity, approximate: false }
    case 'CIRCLE':
      return { value: Math.PI * 2 * Number(payload.radius), approximate: false }
    case 'ARC':
      return {
        value: Math.abs(arcSweep(payload as ArcDefinition)) * Number(payload.radius),
        approximate: false,
      }
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return {
        value: polylineLength2(polylineVertices(payload.vertices ?? payload.points), {
          closed: Boolean(payload.closed),
        }),
        approximate: false,
      }
    case 'SOLID':
    case 'TRACE':
      return {
        value: polylineLength2(polylineVertices(payload.vertices), { closed: true }),
        approximate: false,
      }
    case 'SPLINE':
      return {
        value: splineLength2(payload as SplineDefinition),
        approximate: true,
        algorithm: 'adaptive-rational-bspline',
      }
    case 'ELLIPSE':
      return {
        value: ellipseArcLength2(payload as EllipseDefinition),
        approximate: true,
        algorithm: 'adaptive-quadrature',
      }
    default:
      throw new KJValidationError(`Length is not defined for ${type || 'unknown entity'}`)
  }
}

export function entityArea2(object: GeometryEntityLike | null | undefined): EntityAreaMeasurement {
  const type = String(object?.type ?? '').toUpperCase()
  const payload = (object?.payload ?? object ?? {}) as Record<string, unknown>
  switch (type) {
    case 'CIRCLE':
      return { value: Math.PI * Number(payload.radius) ** 2, signed: false, approximate: false }
    case 'ELLIPSE': {
      const { major, minor } = ellipseRadii(payload as EllipseDefinition)
      const start = Number(payload.startParameter ?? 0)
      const end = Number(payload.endParameter ?? Math.PI * 2)
      if (Math.abs(Math.abs(end - start) - Math.PI * 2) > 1e-10) {
        throw new KJValidationError('Area requires a complete ellipse')
      }
      return { value: Math.PI * major * minor, signed: false, approximate: false }
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (!payload.closed) throw new KJValidationError('Area requires a closed polyline')
      const value = polylineArea2(polylineVertices(payload.vertices ?? payload.points))
      return { value, signed: true, approximate: false }
    }
    case 'SOLID':
    case 'TRACE':
      return {
        value: polylineArea2(polylineVertices(payload.vertices)),
        signed: true,
        approximate: false,
      }
    default:
      throw new KJValidationError(`Area is not defined for ${type || 'unknown entity'}`)
  }
}
