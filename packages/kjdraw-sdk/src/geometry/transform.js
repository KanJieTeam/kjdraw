import { KJValidationError } from '../errors.js'
import { clone } from '../utils.js'
import { determinant3, similarityScale3, transformPoint3, transformVector3 } from './matrix3.js'

function angleOf(vector) { return Math.atan2(vector[1], vector[0]) }
function transformAngle(matrix, angle) { return angleOf(transformVector3(matrix, [Math.cos(angle), Math.sin(angle)])) }

function transformVertex(matrix, vertex, mirrored, scale) {
  if (Array.isArray(vertex)) return transformPoint3(matrix, vertex)
  return {
    ...clone(vertex),
    point: transformPoint3(matrix, vertex.point),
    bulge: mirrored ? -(Number(vertex.bulge ?? 0)) : Number(vertex.bulge ?? 0),
    startWidth: vertex.startWidth == null ? undefined : Number(vertex.startWidth) * scale,
    endWidth: vertex.endWidth == null ? undefined : Number(vertex.endWidth) * scale,
  }
}

function transformLoops(matrix, loops, mirrored, scale) {
  return (loops ?? []).map(loop => ({
    ...clone(loop),
    vertices: loop.vertices?.map(vertex => transformVertex(matrix, vertex, mirrored, scale)),
    edges: loop.edges?.map(edge => transformEdge(matrix, edge, mirrored, scale)),
  }))
}

function transformEdge(matrix, edge, mirrored, scale) {
  const type = String(edge.type ?? '').toUpperCase()
  if (type === 'LINE') return { ...clone(edge), start: transformPoint3(matrix, edge.start), end: transformPoint3(matrix, edge.end) }
  if (type === 'ARC') return { ...clone(edge), center: transformPoint3(matrix, edge.center), radius: Number(edge.radius) * scale, startAngle: transformAngle(matrix, edge.startAngle), endAngle: transformAngle(matrix, edge.endAngle), clockwise: mirrored ? !edge.clockwise : edge.clockwise }
  throw new KJValidationError(`Unsupported hatch edge transform: ${type}`)
}

export function transformEntityPayload(type, source, matrix) {
  type = String(type ?? '').toUpperCase()
  const payload = clone(source ?? {})
  const mirrored = determinant3(matrix) < 0
  let resolvedScale = null
  const scale = () => (resolvedScale ??= similarityScale3(matrix))
  switch (type) {
    case 'LINE': return { ...payload, start: transformPoint3(matrix, payload.start), end: transformPoint3(matrix, payload.end) }
    case 'RAY':
    case 'XLINE': return { ...payload, origin: transformPoint3(matrix, payload.origin), direction: transformVector3(matrix, payload.direction) }
    case 'POINT': return { ...payload, position: transformPoint3(matrix, payload.position) }
    case 'CIRCLE': return { ...payload, center: transformPoint3(matrix, payload.center), radius: Number(payload.radius) * scale() }
    case 'ARC': return { ...payload, center: transformPoint3(matrix, payload.center), radius: Number(payload.radius) * scale(), startAngle: transformAngle(matrix, payload.startAngle), endAngle: transformAngle(matrix, payload.endAngle), clockwise: mirrored ? !payload.clockwise : payload.clockwise }
    case 'LWPOLYLINE':
    case 'POLYLINE':
    case 'WIPEOUT':
    case 'REVISION_CLOUD': return { ...payload, vertices: (payload.vertices ?? payload.points ?? []).map(vertex => transformVertex(matrix, vertex, mirrored, scale())) }
    case 'SPLINE': return { ...payload, controlPoints: (payload.controlPoints ?? []).map(point => transformPoint3(matrix, point)), fitPoints: payload.fitPoints?.map(point => transformPoint3(matrix, point)) }
    case 'ELLIPSE': return { ...payload, center: transformPoint3(matrix, payload.center), majorAxis: transformVector3(matrix, payload.majorAxis), majorRadius: payload.majorRadius == null ? undefined : Number(payload.majorRadius) * scale(), majorAxisLength: payload.majorAxisLength == null ? undefined : Number(payload.majorAxisLength) * scale(), clockwise: mirrored ? !payload.clockwise : payload.clockwise }
    case 'TEXT':
    case 'MTEXT':
    case 'ATTDEF':
    case 'ATTRIB': return { ...payload, position: transformPoint3(matrix, payload.position), alignmentPoint: payload.alignmentPoint && transformPoint3(matrix, payload.alignmentPoint), height: payload.height == null ? undefined : Number(payload.height) * scale(), rotation: transformAngle(matrix, payload.rotation ?? 0), mirrored: mirrored ? !payload.mirrored : payload.mirrored }
    case 'INSERT': return { ...payload, position: transformPoint3(matrix, payload.position), rotation: transformAngle(matrix, payload.rotation ?? 0), scale: Array.isArray(payload.scale) ? payload.scale.map(value => Number(value) * scale()) : Number(payload.scale ?? 1) * scale(), mirrored: mirrored ? !payload.mirrored : payload.mirrored }
    case 'IMAGE': return { ...payload, position: transformPoint3(matrix, payload.position), uVector: transformVector3(matrix, payload.uVector), vVector: transformVector3(matrix, payload.vVector) }
    case 'HATCH': return { ...payload, boundaryLoops: transformLoops(matrix, payload.boundaryLoops, mirrored, scale()), patternScale: payload.patternScale == null ? undefined : Number(payload.patternScale) * scale(), patternAngle: transformAngle(matrix, payload.patternAngle ?? 0) }
    case 'LEADER':
    case 'MLEADER': return { ...payload, vertices: (payload.vertices ?? []).map(point => transformPoint3(matrix, point)), textPosition: payload.textPosition && transformPoint3(matrix, payload.textPosition) }
    case 'DIMENSION': return { ...payload, definitionPoints: (payload.definitionPoints ?? []).map(point => transformPoint3(matrix, point)), textPosition: payload.textPosition && transformPoint3(matrix, payload.textPosition), rotation: transformAngle(matrix, payload.rotation ?? 0) }
    case 'VIEWPORT': return { ...payload, center: transformPoint3(matrix, payload.center), viewCenter: transformPoint3(matrix, payload.viewCenter), width: Number(payload.width) * scale(), height: Number(payload.height) * scale(), viewHeight: Number(payload.viewHeight) * scale(), twistAngle: transformAngle(matrix, payload.twistAngle ?? 0) }
    case 'SOLID':
    case 'TRACE': return { ...payload, vertices: (payload.vertices ?? []).map(point => transformPoint3(matrix, point)) }
    case 'TABLE': return { ...payload, position: transformPoint3(matrix, payload.position), rowHeights: payload.rowHeights.map(value => Number(value) * scale()), columnWidths: payload.columnWidths.map(value => Number(value) * scale()) }
    default:
      if (Array.isArray(payload.points)) return { ...payload, points: payload.points.map(point => transformPoint3(matrix, point)) }
      throw new KJValidationError(`Transform is not implemented for ${type || 'unknown entity'}`)
  }
}
