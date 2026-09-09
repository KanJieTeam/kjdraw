import { KJValidationError } from '../errors.js'
import { clone } from '../utils.js'
import { hatchPatternLines } from './hatch.js'
import {
  determinant3,
  similarityScale3,
  transformPoint3,
  transformVector3,
  type AffineMatrix3Input,
} from './matrix3.js'
import type { Point2Input } from './vector2.js'

export type GeometryEntityPayload = Record<string, unknown>

function angleOf(vector: Point2Input): number {
  const record = vector as { readonly x?: unknown; readonly y?: unknown }
  const coordinates = Array.isArray(vector) ? vector : [record.x, record.y]
  return Math.atan2(Number(coordinates[1]), Number(coordinates[0]))
}

function transformAngle(matrix: AffineMatrix3Input, angle: unknown): number {
  const number = Number(angle)
  return angleOf(transformVector3(matrix, [Math.cos(number), Math.sin(number)]))
}

function transformVertex(
  matrix: AffineMatrix3Input,
  vertex: unknown,
  mirrored: boolean,
  scale: number,
): unknown {
  if (Array.isArray(vertex)) return transformPoint3(matrix, vertex)
  const record = vertex as Record<string, unknown>
  return {
    ...(clone(record)),
    point: transformPoint3(matrix, record.point as Point2Input),
    bulge: mirrored ? -(Number(record.bulge ?? 0)) : Number(record.bulge ?? 0),
    startWidth: record.startWidth == null ? undefined : Number(record.startWidth) * scale,
    endWidth: record.endWidth == null ? undefined : Number(record.endWidth) * scale,
  }
}

function transformLoops(
  matrix: AffineMatrix3Input,
  loops: unknown,
  mirrored: boolean,
  scale: number,
): unknown[] {
  return ((loops ?? []) as readonly unknown[]).map(loop => {
    const record = loop as Record<string, unknown>
    return {
      ...clone(record),
      vertices: record.vertices == null
        ? undefined
        : (record.vertices as readonly unknown[]).map(vertex => (
            transformVertex(matrix, vertex, mirrored, scale)
          )),
      edges: record.edges == null
        ? undefined
        : (record.edges as readonly unknown[]).map(edge => transformEdge(matrix, edge, mirrored, scale)),
    }
  })
}

function transformEdge(
  matrix: AffineMatrix3Input,
  edge: unknown,
  mirrored: boolean,
  scale: number,
): GeometryEntityPayload {
  const record = edge as Record<string, unknown>
  const type = String(record.type ?? '').toUpperCase()
  if (type === 'LINE') {
    return {
      ...clone(record),
      start: transformPoint3(matrix, record.start as Point2Input),
      end: transformPoint3(matrix, record.end as Point2Input),
    }
  }
  if (type === 'ARC') {
    const clockwise = record.clockwise === true || record.counterClockwise === false
    const transformedClockwise = mirrored ? !clockwise : clockwise
    return {
      ...clone(record),
      center: transformPoint3(matrix, record.center as Point2Input),
      radius: Number(record.radius) * scale,
      startAngle: transformAngle(matrix, record.startAngle),
      endAngle: transformAngle(matrix, record.endAngle),
      clockwise: transformedClockwise,
      ...(record.counterClockwise === undefined ? {} : { counterClockwise: !transformedClockwise }),
    }
  }
  throw new KJValidationError(`Unsupported hatch edge transform: ${type}`)
}

export function transformEntityPayload(
  type: unknown,
  source: GeometryEntityPayload | null | undefined,
  matrix: AffineMatrix3Input,
): GeometryEntityPayload {
  const normalizedType = String(type ?? '').toUpperCase()
  const payload = clone(source ?? {})
  const mirrored = determinant3(matrix) < 0
  let resolvedScale: number | null = null
  const scale = (): number => (resolvedScale ??= similarityScale3(matrix))

  switch (normalizedType) {
    case 'LINE':
      return {
        ...payload,
        start: transformPoint3(matrix, payload.start as Point2Input),
        end: transformPoint3(matrix, payload.end as Point2Input),
      }
    case 'RAY':
    case 'XLINE':
      return {
        ...payload,
        origin: transformPoint3(matrix, payload.origin as Point2Input),
        direction: transformVector3(matrix, payload.direction as Point2Input),
      }
    case 'POINT':
      return { ...payload, position: transformPoint3(matrix, payload.position as Point2Input) }
    case 'CIRCLE':
      return {
        ...payload,
        center: transformPoint3(matrix, payload.center as Point2Input),
        radius: Number(payload.radius) * scale(),
      }
    case 'ARC':
      return {
        ...payload,
        center: transformPoint3(matrix, payload.center as Point2Input),
        radius: Number(payload.radius) * scale(),
        startAngle: transformAngle(matrix, payload.startAngle),
        endAngle: transformAngle(matrix, payload.endAngle),
        clockwise: mirrored ? !payload.clockwise : payload.clockwise,
      }
    case 'LWPOLYLINE':
    case 'POLYLINE':
    case 'WIPEOUT':
    case 'REVISION_CLOUD':
      return {
        ...payload,
        vertices: ((payload.vertices ?? payload.points ?? []) as readonly unknown[])
          .map(vertex => transformVertex(matrix, vertex, mirrored, scale())),
      }
    case 'SPLINE':
      return {
        ...payload,
        controlPoints: ((payload.controlPoints ?? []) as readonly unknown[])
          .map(point => transformPoint3(matrix, point as Point2Input)),
        fitPoints: payload.fitPoints == null
          ? undefined
          : (payload.fitPoints as readonly unknown[])
            .map(point => transformPoint3(matrix, point as Point2Input)),
      }
    case 'ELLIPSE':
      return {
        ...payload,
        center: transformPoint3(matrix, payload.center as Point2Input),
        majorAxis: transformVector3(matrix, payload.majorAxis as Point2Input),
        majorRadius: payload.majorRadius == null ? undefined : Number(payload.majorRadius) * scale(),
        majorAxisLength: payload.majorAxisLength == null
          ? undefined
          : Number(payload.majorAxisLength) * scale(),
        clockwise: mirrored ? !payload.clockwise : payload.clockwise,
      }
    case 'TEXT':
    case 'MTEXT':
    case 'ATTDEF':
    case 'ATTRIB':
      return {
        ...payload,
        position: transformPoint3(matrix, payload.position as Point2Input),
        alignmentPoint: payload.alignmentPoint
          && transformPoint3(matrix, payload.alignmentPoint as Point2Input),
        height: payload.height == null ? undefined : Number(payload.height) * scale(),
        rotation: transformAngle(matrix, payload.rotation ?? 0),
        mirrored: mirrored ? !payload.mirrored : payload.mirrored,
      }
    case 'INSERT': {
      const insertionScale = payload.scale
      return {
        ...payload,
        position: transformPoint3(matrix, payload.position as Point2Input),
        rotation: transformAngle(matrix, payload.rotation ?? 0),
        scale: Array.isArray(insertionScale)
          ? insertionScale.map((value: unknown) => Number(value) * scale())
          : Number(insertionScale ?? 1) * scale(),
        mirrored: mirrored ? !payload.mirrored : payload.mirrored,
      }
    }
    case 'IMAGE':
      return {
        ...payload,
        position: transformPoint3(matrix, payload.position as Point2Input),
        uVector: transformVector3(matrix, payload.uVector as Point2Input),
        vVector: transformVector3(matrix, payload.vVector as Point2Input),
      }
    case 'HATCH': {
      const patternScale = Number(payload.patternScale ?? 1) * scale(), patternAngle = transformAngle(matrix, payload.patternAngle ?? 0)
      const solid = payload.solid === true || String(payload.patternName).toUpperCase() === 'SOLID'
      const patternLines = solid ? undefined : hatchPatternLines(payload).map(line => {
        const base = transformPoint3(matrix, line.base), offset = transformVector3(matrix, line.offset)
        return { angle: transformAngle(matrix, line.angle), base: [base[0], base[1]], offset: [offset[0], offset[1]], dashes: line.dashes.map(d => d * scale()) }
      })
      return {
        ...payload,
        boundaryLoops: transformLoops(matrix, payload.boundaryLoops, mirrored, scale()),
        patternScale, patternAngle,
        ...(patternLines ? { patternLines, patternDefinitionScale: patternScale, patternDefinitionAngle: patternAngle } : {}),
      }
    }
    case 'LEADER':
    case 'MLEADER':
      return {
        ...payload,
        vertices: ((payload.vertices ?? []) as readonly unknown[])
          .map(point => transformPoint3(matrix, point as Point2Input)),
        textPosition: payload.textPosition
          && transformPoint3(matrix, payload.textPosition as Point2Input),
      }
    case 'DIMENSION':
      return {
        ...payload,
        definitionPoints: ((payload.definitionPoints ?? []) as readonly unknown[])
          .map(point => transformPoint3(matrix, point as Point2Input)),
        textPosition: payload.textPosition
          && transformPoint3(matrix, payload.textPosition as Point2Input),
        rotation: transformAngle(matrix, payload.rotation ?? 0),
      }
    case 'VIEWPORT':
      return {
        ...payload,
        center: transformPoint3(matrix, payload.center as Point2Input),
        viewCenter: transformPoint3(matrix, payload.viewCenter as Point2Input),
        width: Number(payload.width) * scale(),
        height: Number(payload.height) * scale(),
        viewHeight: Number(payload.viewHeight) * scale(),
        twistAngle: transformAngle(matrix, payload.twistAngle ?? 0),
      }
    case 'SOLID':
    case 'TRACE':
      return {
        ...payload,
        vertices: ((payload.vertices ?? []) as readonly unknown[])
          .map(point => transformPoint3(matrix, point as Point2Input)),
      }
    case 'TABLE':
      return {
        ...payload,
        position: transformPoint3(matrix, payload.position as Point2Input),
        rowHeights: (payload.rowHeights as readonly unknown[])
          .map(value => Number(value) * scale()),
        columnWidths: (payload.columnWidths as readonly unknown[])
          .map(value => Number(value) * scale()),
      }
    default:
      if (Array.isArray(payload.points)) {
        return {
          ...payload,
          points: payload.points.map((point: unknown) => (
            transformPoint3(matrix, point as Point2Input)
          )),
        }
      }
      throw new KJValidationError(`Transform is not implemented for ${normalizedType || 'unknown entity'}`)
  }
}
