import { KJValidationError } from '../errors.js'
import { invokeGeometryBackend } from './backend.js'
import { ellipseArcLength2, ellipseRadii, splineLength2 } from './curves.js'
import { normalizeAngle } from './tolerance.js'
import { distance2, vec2 } from './vector2.js'

function vertexPoint(vertex) { return vec2(Array.isArray(vertex) ? vertex : vertex.point, 'polyline vertex') }
function vertexBulge(vertex) { return Array.isArray(vertex) ? 0 : Number(vertex.bulge ?? 0) }

export function bulgeSegmentMetrics(start, end, bulge = 0) {
  start = vec2(start); end = vec2(end); bulge = Number(bulge)
  const chord = distance2(start, end)
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-15 || chord === 0) return { chord, radius: Infinity, sweep: 0, length: chord, segmentArea: 0 }
  const sweep = 4 * Math.atan(bulge)
  const radius = chord * (1 + bulge * bulge) / (4 * Math.abs(bulge))
  return { chord, radius, sweep, length: Math.abs(sweep) * radius, segmentArea: 0.5 * radius * radius * (sweep - Math.sin(sweep)) }
}

function polylineLengthReference2(vertices, { closed = false } = {}) {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0
  let length = 0
  const count = closed ? vertices.length : vertices.length - 1
  for (let index = 0; index < count; index += 1) {
    const current = vertices[index], next = vertices[(index + 1) % vertices.length]
    length += bulgeSegmentMetrics(vertexPoint(current), vertexPoint(next), vertexBulge(current)).length
  }
  return length
}

export function polylineLength2(vertices, { closed = false } = {}) {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0
  if (vertices.some(vertex => Math.abs(vertexBulge(vertex)) >= 1e-15)) return polylineLengthReference2(vertices, { closed })
  const points = vertices.map(vertexPoint)
  return invokeGeometryBackend('polylineLength2', [points, { closed }], () => polylineLengthReference2(vertices, { closed }))
}

function polylineAreaReference2(vertices) {
  // A closed CAD polyline may have only two vertices when one edge is a
  // bulge arc and the return edge is its chord (for example a semicircle).
  if (!Array.isArray(vertices) || vertices.length < 2) return 0
  let twiceArea = 0, arcArea = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index], next = vertices[(index + 1) % vertices.length]
    const a = vertexPoint(current), b = vertexPoint(next)
    twiceArea += a[0] * b[1] - b[0] * a[1]
    arcArea += bulgeSegmentMetrics(a, b, vertexBulge(current)).segmentArea
  }
  return twiceArea / 2 + arcArea
}

export function polylineArea2(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0
  if (vertices.some(vertex => Math.abs(vertexBulge(vertex)) >= 1e-15)) return polylineAreaReference2(vertices)
  const points = vertices.map(vertexPoint)
  return invokeGeometryBackend('polylineArea2', [points], () => polylineAreaReference2(vertices))
}

export function arcSweep(payload) {
  const start = Number(payload.startAngle ?? 0), end = Number(payload.endAngle ?? 0)
  let sweep = normalizeAngle(end - start)
  if (payload.clockwise && sweep > 0) sweep -= Math.PI * 2
  if (!payload.clockwise && sweep < 0) sweep += Math.PI * 2
  if (payload.fullCircle) sweep = payload.clockwise ? -Math.PI * 2 : Math.PI * 2
  return sweep
}

export function entityLength2(object) {
  const type = String(object?.type ?? '').toUpperCase(), payload = object?.payload ?? object ?? {}
  switch (type) {
    case 'LINE': return { value: distance2(payload.start, payload.end), approximate: false }
    case 'RAY':
    case 'XLINE': return { value: Infinity, approximate: false }
    case 'CIRCLE': return { value: Math.PI * 2 * Number(payload.radius), approximate: false }
    case 'ARC': return { value: Math.abs(arcSweep(payload)) * Number(payload.radius), approximate: false }
    case 'LWPOLYLINE':
    case 'POLYLINE': return { value: polylineLength2(payload.vertices ?? payload.points, { closed: Boolean(payload.closed) }), approximate: false }
    case 'SOLID':
    case 'TRACE': return { value: polylineLength2(payload.vertices, { closed: true }), approximate: false }
    case 'SPLINE': return { value: splineLength2(payload), approximate: true, algorithm: 'adaptive-rational-bspline' }
    case 'ELLIPSE': return { value: ellipseArcLength2(payload), approximate: true, algorithm: 'adaptive-quadrature' }
    default: throw new KJValidationError(`Length is not defined for ${type || 'unknown entity'}`)
  }
}

export function entityArea2(object) {
  const type = String(object?.type ?? '').toUpperCase(), payload = object?.payload ?? object ?? {}
  switch (type) {
    case 'CIRCLE': return { value: Math.PI * Number(payload.radius) ** 2, signed: false, approximate: false }
    case 'ELLIPSE': {
      const { major, minor } = ellipseRadii(payload)
      const start = Number(payload.startParameter ?? 0), end = Number(payload.endParameter ?? Math.PI * 2)
      if (Math.abs(Math.abs(end - start) - Math.PI * 2) > 1e-10) throw new KJValidationError('Area requires a complete ellipse')
      return { value: Math.PI * major * minor, signed: false, approximate: false }
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (!payload.closed) throw new KJValidationError('Area requires a closed polyline')
      const value = polylineArea2(payload.vertices ?? payload.points)
      return { value, signed: true, approximate: false }
    }
    case 'SOLID':
    case 'TRACE': return { value: polylineArea2(payload.vertices), signed: true, approximate: false }
    default: throw new KJValidationError(`Area is not defined for ${type || 'unknown entity'}`)
  }
}
