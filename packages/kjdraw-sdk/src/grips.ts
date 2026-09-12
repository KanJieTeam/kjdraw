import { KJValidationError } from './errors.js'
import { arcSweep, distance2, midpoint2, translation3, transformEntityPayload, vec2 } from './geometry/index.js'
import { clone } from './utils.js'
import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js'

const TAU = Math.PI * 2

export type KJGripPoint = [number, number, number]
export type KJPointInput = readonly number[] | { x: number; y: number; z?: number }

export interface KJEntityGrip extends Record<string, unknown> {
  id: string
  entityId: string
  role: string
  point: readonly [number, number, number]
  vertexIndex?: number
  segmentIndex?: number
  controlPointIndex?: number
  fitPointIndex?: number
  definitionPointIndex?: number
  angle?: number
}

interface KJGripVertex extends Record<string, unknown> {
  point: KJPointInput
}

interface KJGripPayload extends KJObjectPayload {
  start: KJPointInput
  end: KJPointInput
  origin: KJPointInput
  direction: KJPointInput
  position: KJPointInput
  center: KJPointInput
  radius: number
  startAngle: number
  endAngle: number
  clockwise?: boolean
  vertices: Array<KJPointInput | KJGripVertex>
  closed?: boolean
  majorAxis: KJPointInput
  ratio: number
  startParameter?: number
  endParameter?: number
  degree: number
  knots?: number[]
  weights?: number[]
  periodic?: boolean
  controlPoints?: KJPointInput[]
  fitPoints?: KJPointInput[]
  alignmentPoint?: KJPointInput
  uVector: KJPointInput
  vVector: KJPointInput
  textPosition?: KJPointInput
  definitionPoints?: KJPointInput[]
}

function point3(value: KJPointInput, label = 'grip point'): KJGripPoint {
  const [x, y] = vec2(value, label)
  const record = value as { z?: number }
  const z = Number(Array.isArray(value) ? value[2] ?? 0 : record.z ?? 0)
  if (!Number.isFinite(z)) throw new KJValidationError(`${label}.z must be finite`)
  return [x, y, z]
}

function polar(center: KJPointInput, radius: number, angle: number): KJGripPoint {
  const value = point3(center)
  return [value[0] + radius * Math.cos(angle), value[1] + radius * Math.sin(angle), value[2]]
}

function ellipsePoint(payload: KJGripPayload, parameter: number): KJGripPoint {
  const center = point3(payload.center), major = point3(payload.majorAxis), ratio = Number(payload.ratio)
  return [
    center[0] + major[0] * Math.cos(parameter) - major[1] * ratio * Math.sin(parameter),
    center[1] + major[1] * Math.cos(parameter) + major[0] * ratio * Math.sin(parameter),
    center[2] + major[2] * Math.cos(parameter),
  ]
}

function ellipseParameter(payload: KJGripPayload, target: KJGripPoint): number {
  const center = point3(payload.center), major = point3(payload.majorAxis), ratio = Number(payload.ratio)
  const majorLength = Math.hypot(major[0], major[1])
  if (!(majorLength > 1e-12) || !(ratio > 1e-12)) throw new KJValidationError('ELLIPSE axes must be non-degenerate')
  const dx = target[0] - center[0], dy = target[1] - center[1]
  const alongMajor = (dx * major[0] + dy * major[1]) / (majorLength * majorLength)
  const alongMinor = (-dx * major[1] + dy * major[0]) / (majorLength * majorLength * ratio)
  if (Math.hypot(alongMajor, alongMinor) <= 1e-12) throw new KJValidationError('Elliptical arc endpoint cannot be placed at its center')
  return Math.atan2(alongMinor, alongMajor)
}

function ccwSweep(start: number, end: number): number {
  const sweep = ((end - start) % TAU + TAU) % TAU
  if (sweep <= 1e-10 || TAU - sweep <= 1e-10) throw new KJValidationError('Elliptical arc endpoints must define a non-zero partial sweep')
  return sweep
}

function isPartialEllipse(payload: KJGripPayload): boolean {
  const span = Number(payload.endParameter ?? TAU) - Number(payload.startParameter ?? 0)
  return Number.isFinite(span) && Math.abs(span) > 1e-10 && Math.abs(span) < TAU - 1e-10
}

function fitSplineProblem(payload: KJGripPayload): string | null {
  const fitPoints = payload.fitPoints ?? [], degree = Number(payload.degree)
  if (!fitPoints.length) return 'SPLINE has no fit points'
  if (payload.closed || payload.periodic) return 'Closed or periodic SPLINE fit-point editing is not supported'
  if (payload.weights?.length) return 'Rational SPLINE fit-point editing is not supported'
  if (!Number.isInteger(degree) || degree < 1 || degree > 32) return 'SPLINE fit-point editing requires degree 1 through 32'
  if (fitPoints.length < degree + 1) return 'SPLINE fit-point editing requires at least degree + 1 fit points'
  if (fitPoints.length > 128) return 'SPLINE fit-point editing exceeds the 128-point interactive budget'
  return null
}

function splineBasisRow(parameter: number, degree: number, knots: readonly number[], count: number): number[] {
  const last = count - 1
  let span = last
  if (parameter < knots[last + 1]!) {
    let low = degree, high = last + 1
    while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (parameter < knots[middle]!) high = middle; else low = middle }
    span = low
  }
  const basis = Array(degree + 1).fill(0), left = Array(degree + 1).fill(0), right = Array(degree + 1).fill(0)
  basis[0] = 1
  for (let column = 1; column <= degree; column += 1) {
    left[column] = parameter - knots[span + 1 - column]!
    right[column] = knots[span + column]! - parameter
    let carried = 0
    for (let row = 0; row < column; row += 1) {
      const denominator = right[row + 1]! + left[column - row]!
      const term = Math.abs(denominator) <= Number.EPSILON ? 0 : basis[row]! / denominator
      basis[row] = carried + right[row + 1]! * term
      carried = left[column - row]! * term
    }
    basis[column] = carried
  }
  const result = Array(count).fill(0)
  for (let index = 0; index <= degree; index += 1) result[span - degree + index] = basis[index]!
  return result
}

function solveSplineControls(matrix: number[][], values: KJGripPoint[]): KJGripPoint[] {
  const size = matrix.length, rows = matrix.map((row, index) => [...row, ...values[index]!])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row
    if (Math.abs(rows[pivot]![column]!) <= 1e-12) throw new KJValidationError('SPLINE fit points produce a singular interpolation system')
    ;[rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!]
    const divisor = rows[column]![column]!
    for (let index = column; index < size + 3; index += 1) rows[column]![index] = rows[column]![index]! / divisor
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = rows[row]![column]!
      for (let index = column; index < size + 3; index += 1) rows[row]![index] = rows[row]![index]! - factor * rows[column]![index]!
    }
  }
  return rows.map(row => [row[size]!, row[size + 1]!, row[size + 2]!])
}

function interpolateSplineFitPoints(payload: KJGripPayload, values: KJGripPoint[]): { controlPoints: KJGripPoint[]; knots: number[] } {
  const problem = fitSplineProblem({ ...payload, fitPoints: values })
  if (problem) throw new KJValidationError(problem)
  const degree = Number(payload.degree), distances = values.slice(1).map((point, index) => distance2(values[index]!, point))
  if (distances.some(distance => distance <= 1e-12)) throw new KJValidationError('SPLINE fit points must not contain adjacent duplicates')
  const total = distances.reduce((sum, distance) => sum + distance, 0), parameters = [0]
  for (const distance of distances) parameters.push(parameters.at(-1)! + distance / total)
  parameters[parameters.length - 1] = 1
  const count = values.length, knots = Array(count + degree + 1).fill(0)
  for (let index = count; index < knots.length; index += 1) knots[index] = 1
  for (let index = 1; index <= count - degree - 1; index += 1) {
    let sum = 0
    for (let offset = 0; offset < degree; offset += 1) sum += parameters[index + offset]!
    knots[index + degree] = sum / degree
  }
  return { controlPoints: solveSplineControls(parameters.map(parameter => splineBasisRow(parameter, degree, knots, count)), values), knots }
}

function vertexPoint(vertex: KJPointInput | KJGripVertex): KJPointInput {
  return Array.isArray(vertex) || !('point' in vertex) ? vertex as KJPointInput : vertex.point
}

export function getEntityGrips(entity: KJReadonlyObjectRecord): readonly KJEntityGrip[] {
  if (!entity || entity.kind !== 'entity') throw new KJValidationError('Grip provider requires an entity')
  const payload = entity.payload as unknown as KJGripPayload, result: KJEntityGrip[] = []
  const add = (id: string, role: string, point: KJPointInput, detail: Record<string, unknown> = {}): void => {
    result.push(Object.freeze({ id, entityId: entity.id, role, point: Object.freeze(point3(point)), ...detail }))
  }
  switch (entity.type) {
    case 'LINE':
      add('start', 'endpoint', payload.start); add('mid', 'move', midpoint2(payload.start, payload.end)); add('end', 'endpoint', payload.end); break
    case 'RAY':
    case 'XLINE': {
      const origin = point3(payload.origin), direction = point3(payload.direction)
      add('origin', 'move', payload.origin); add('direction', 'direction', [origin[0] + direction[0], origin[1] + direction[1], origin[2] + direction[2]]); break
    }
    case 'POINT': add('position', 'move', payload.position); break
    case 'CIRCLE':
      add('center', 'move', payload.center)
      for (const [index, angle] of [0, Math.PI / 2, Math.PI, Math.PI * 1.5].entries()) add(`quadrant:${index}`, 'radius', polar(payload.center, payload.radius, angle), { angle })
      break
    case 'ARC': {
      const sweep = arcSweep(payload)
      add('center', 'move', payload.center)
      add('start', 'endpoint', polar(payload.center, payload.radius, payload.startAngle))
      add('mid', 'radius', polar(payload.center, payload.radius, payload.startAngle + sweep / 2))
      add('end', 'endpoint', polar(payload.center, payload.radius, payload.startAngle + sweep))
      break
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vertices = payload.vertices ?? []
      for (const [index, vertex] of vertices.entries()) add(`vertex:${index}`, 'vertex', vertexPoint(vertex), { vertexIndex: index })
      const count = payload.closed ? vertices.length : vertices.length - 1
      for (let index = 0; index < count; index += 1) {
        const vertex = vertices[index]!, a = point3(vertexPoint(vertex)), b = point3(vertexPoint(vertices[(index + 1) % vertices.length]!))
        const bulge = Array.isArray(vertex) ? 0 : Number((vertex as KJGripVertex).bulge ?? 0)
        add(`segment:${index}`, 'segment', [(a[0] + b[0]) / 2 + (b[1] - a[1]) * bulge / 2, (a[1] + b[1]) / 2 - (b[0] - a[0]) * bulge / 2, (a[2] + b[2]) / 2], { segmentIndex: index })
      }
      break
    }
    case 'SOLID':
    case 'TRACE': for (const [index, point] of payload.vertices.entries()) add(`vertex:${index}`, 'vertex', vertexPoint(point), { vertexIndex: index }); break
    case 'ELLIPSE': {
      const [mx, my] = vec2(payload.majorAxis), center = point3(payload.center), minor: [number, number] = [-my * payload.ratio, mx * payload.ratio]
      add('center', 'move', center)
      add('major:positive', 'major-radius', [center[0] + mx, center[1] + my, center[2]])
      add('major:negative', 'major-radius', [center[0] - mx, center[1] - my, center[2]])
      add('minor:positive', 'minor-radius', [center[0] + minor[0], center[1] + minor[1], center[2]])
      add('minor:negative', 'minor-radius', [center[0] - minor[0], center[1] - minor[1], center[2]])
      if (isPartialEllipse(payload)) {
        add('start-parameter', 'endpoint', ellipsePoint(payload, Number(payload.startParameter ?? 0)))
        add('end-parameter', 'endpoint', ellipsePoint(payload, Number(payload.endParameter ?? TAU)))
      }
      break
    }
    case 'SPLINE':
      if (payload.fitPoints?.length) {
        for (const [index, point] of payload.fitPoints.entries()) add(`fit:${index}`, 'fit-point', point, { fitPointIndex: index })
      } else {
        for (const [index, point] of (payload.controlPoints ?? []).entries()) add(`control:${index}`, 'control-point', point, { controlPointIndex: index })
      }
      break
    case 'TEXT':
    case 'MTEXT':
    case 'ATTDEF':
    case 'ATTRIB':
      add('position', 'move', payload.position)
      if (payload.alignmentPoint) add('alignment', 'alignment', payload.alignmentPoint)
      break
    case 'INSERT':
    case 'TABLE': add('position', 'move', payload.position); break
    case 'IMAGE': {
      const origin = point3(payload.position), u = point3(payload.uVector), v = point3(payload.vVector)
      add('position', 'move', origin)
      add('u', 'image-corner', [origin[0] + u[0], origin[1] + u[1], origin[2] + u[2]])
      add('v', 'image-corner', [origin[0] + v[0], origin[1] + v[1], origin[2] + v[2]])
      add('uv', 'image-corner', [origin[0] + u[0] + v[0], origin[1] + u[1] + v[1], origin[2] + u[2] + v[2]])
      break
    }
    case 'LEADER':
    case 'MLEADER':
      for (const [index, point] of (payload.vertices ?? []).entries()) add(`vertex:${index}`, 'vertex', vertexPoint(point), { vertexIndex: index })
      if (payload.textPosition) add('text', 'text-position', payload.textPosition)
      break
    case 'DIMENSION':
      for (const [index, point] of (payload.definitionPoints ?? []).entries()) add(`definition:${index}`, 'definition-point', point, { definitionPointIndex: index })
      if (payload.textPosition) add('text', 'text-position', payload.textPosition)
      break
  }
  return Object.freeze(result)
}

function updateVertex(vertex: KJPointInput | KJGripVertex, target: KJGripPoint): KJPointInput | KJGripVertex {
  return Array.isArray(vertex) ? target : { ...clone(vertex), point: target }
}

export function editEntityGrip(entity: KJReadonlyObjectRecord, gripId: string, targetPoint: KJPointInput): KJObjectPayload {
  if (!entity || entity.kind !== 'entity') throw new KJValidationError('Grip edit requires an entity')
  gripId = String(gripId); const target = point3(targetPoint), payload = clone(entity.payload) as unknown as KJGripPayload
  const currentGrip = getEntityGrips(entity).find(grip => grip.id === gripId)
  if (!currentGrip) throw new KJValidationError(`Grip does not exist on ${entity.type}: ${gripId}`)
  const moveWhole = (): KJObjectPayload => transformEntityPayload(entity.type, payload, translation3(target[0] - currentGrip.point[0], target[1] - currentGrip.point[1]))
  switch (entity.type) {
    case 'LINE':
      if (gripId === 'mid') return moveWhole()
      payload[gripId] = target; return payload
    case 'RAY':
    case 'XLINE': {
      if (gripId === 'origin') return moveWhole()
      const origin = point3(payload.origin)
      payload.direction = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]]; return payload
    }
    case 'POINT': payload.position = target; return payload
    case 'CIRCLE':
      if (gripId === 'center') return moveWhole()
      payload.radius = distance2(payload.center, target); return payload
    case 'ARC': {
      if (gripId === 'center') return moveWhole()
      if (gripId === 'mid') { payload.radius = distance2(payload.center, target); return payload }
      const center = point3(payload.center)
      if (gripId === 'start') payload.startAngle = Math.atan2(target[1] - center[1], target[0] - center[0])
      else payload.endAngle = Math.atan2(target[1] - center[1], target[0] - center[0])
      return payload
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vertices = [...payload.vertices]
      if (gripId.startsWith('vertex:')) {
        const index = Number(gripId.split(':')[1]); vertices[index] = updateVertex(vertices[index]!, target)
      } else {
        const index = Number(gripId.split(':')[1]), nextIndex = (index + 1) % vertices.length
        const dx = target[0] - currentGrip.point[0], dy = target[1] - currentGrip.point[1]
        for (const vertexIndex of [index, nextIndex]) {
          const point = point3(vertexPoint(vertices[vertexIndex]!)); vertices[vertexIndex] = updateVertex(vertices[vertexIndex]!, [point[0] + dx, point[1] + dy, point[2]])
        }
      }
      payload.vertices = vertices; return payload
    }
    case 'SOLID':
    case 'TRACE': {
      const index = Number(gripId.split(':')[1]); payload.vertices = [...payload.vertices]; payload.vertices[index] = target; return payload
    }
    case 'ELLIPSE': {
      if (gripId === 'center') return moveWhole()
      const center = point3(payload.center)
      if (gripId === 'start-parameter' || gripId === 'end-parameter') {
        if (!isPartialEllipse(payload)) throw new KJValidationError('Full ellipses do not have independently editable endpoints')
        const parameter = ellipseParameter(payload, target)
        if (gripId === 'start-parameter') {
          const end = Number(payload.endParameter); payload.startParameter = end - ccwSweep(parameter, end)
        } else {
          const start = Number(payload.startParameter); payload.endParameter = start + ccwSweep(start, parameter)
        }
      } else if (gripId.startsWith('major:')) {
        const sign = gripId.endsWith('negative') ? -1 : 1
        payload.majorAxis = [(target[0] - center[0]) * sign, (target[1] - center[1]) * sign, (target[2] - center[2]) * sign]
      } else payload.ratio = distance2(center, target) / Math.hypot(...vec2(payload.majorAxis))
      return payload
    }
    case 'SPLINE': {
      const [kind, rawIndex] = gripId.split(':'), key = kind === 'fit' ? 'fitPoints' : 'controlPoints'
      if (payload.fitPoints?.length && kind !== 'fit') throw new KJValidationError('Fit-point-defined SPLINE must be edited through fit-point grips')
      if (kind === 'fit') {
        const problem = fitSplineProblem(payload)
        if (problem) throw new KJValidationError(problem)
        const fitPoints = [...payload.fitPoints!].map(point => point3(point)), index = Number(rawIndex)
        if (!Number.isInteger(index) || index < 0 || index >= fitPoints.length) throw new KJValidationError(`SPLINE fit-point grip does not exist: ${gripId}`)
        fitPoints[index] = target
        const interpolation = interpolateSplineFitPoints(payload, fitPoints)
        payload.fitPoints = fitPoints; payload.controlPoints = interpolation.controlPoints; payload.knots = interpolation.knots
        return payload
      }
      payload[key] = [...(payload[key] ?? [])]; payload[key]![Number(rawIndex)] = target; return payload
    }
    case 'TEXT':
    case 'MTEXT':
    case 'ATTDEF':
    case 'ATTRIB':
      payload[gripId === 'alignment' ? 'alignmentPoint' : 'position'] = target; return payload
    case 'INSERT':
    case 'TABLE': payload.position = target; return payload
    case 'IMAGE': {
      if (gripId === 'position') return moveWhole()
      const origin = point3(payload.position), vector: KJGripPoint = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]]
      if (gripId === 'u') payload.uVector = vector
      else if (gripId === 'v') payload.vVector = vector
      else {
        const v = point3(payload.vVector)
        payload.uVector = [vector[0] - v[0], vector[1] - v[1], vector[2] - v[2]]
      }
      return payload
    }
    case 'LEADER':
    case 'MLEADER':
      if (gripId === 'text') payload.textPosition = target
      else { const index = Number(gripId.split(':')[1]); payload.vertices = [...payload.vertices]; payload.vertices[index] = target }
      return payload
    case 'DIMENSION':
      if (gripId === 'text') payload.textPosition = target
      else { const index = Number(gripId.split(':')[1]); payload.definitionPoints = [...(payload.definitionPoints ?? [])]; payload.definitionPoints[index] = target }
      return payload
    default: throw new KJValidationError(`Grip editing is not implemented for ${entity.type}`)
  }
}
