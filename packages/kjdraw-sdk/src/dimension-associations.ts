import { KJValidationError } from './errors.js'
import { projectDimension } from './geometry/annotation.js'
import type { KJObjectPayload, KJObjectRecord } from './schema.js'
import type { KJTransaction } from './transaction.js'
import { clone, stableHash } from './utils.js'

export type KJDimensionAssociationFeature =
  | 'start' | 'end' | 'center' | 'vertex'
  | 'left' | 'right' | 'top' | 'bottom' | 'curve'

export interface KJDimensionPointAssociation {
  definitionPointIndex: number
  entityId: string
  feature: KJDimensionAssociationFeature
  vertexIndex?: number
  angle?: number
}

const FEATURES = new Set<KJDimensionAssociationFeature>([
  'start', 'end', 'center', 'vertex', 'left', 'right', 'top', 'bottom', 'curve',
])

const fail = (message: string): never => { throw new KJValidationError(message) }

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`${name} must be finite`)
  return value
}

export function normalizeDimensionAssociations(value: unknown): KJDimensionPointAssociation[] {
  if (!Array.isArray(value) || !value.length || value.length > 4) return fail('Dimension associations require 1-4 point references')
  const result = value.map((candidate, offset) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return fail(`Dimension association ${offset} must be an object`)
    const item = candidate as Record<string, unknown>
    const allowed = new Set(['definitionPointIndex', 'entityId', 'feature', 'vertexIndex', 'angle'])
    if (Object.keys(item).some(key => !allowed.has(key))) return fail(`Dimension association ${offset} contains unsupported fields`)
    const definitionPointIndex = finite(item.definitionPointIndex, `Dimension association ${offset} point index`)
    if (!Number.isSafeInteger(definitionPointIndex) || definitionPointIndex < 0 || definitionPointIndex > 4) return fail(`Dimension association ${offset} point index is outside 0-4`)
    if (typeof item.entityId !== 'string' || !item.entityId.trim() || item.entityId.length > 512) return fail(`Dimension association ${offset} entityId is invalid`)
    if (typeof item.feature !== 'string' || !FEATURES.has(item.feature as KJDimensionAssociationFeature)) return fail(`Dimension association ${offset} feature is unsupported`)
    const feature = item.feature as KJDimensionAssociationFeature
    if (feature === 'vertex') {
      if (!Number.isSafeInteger(item.vertexIndex) || Number(item.vertexIndex) < 0 || Number(item.vertexIndex) > 4095 || item.angle !== undefined) return fail(`Dimension association ${offset} vertex index is invalid`)
    } else if (feature === 'curve') {
      finite(item.angle, `Dimension association ${offset} curve angle`)
      if (item.vertexIndex !== undefined) return fail(`Dimension association ${offset} curve cannot include a vertex index`)
    } else if (item.vertexIndex !== undefined || item.angle !== undefined) return fail(`Dimension association ${offset} feature has unexpected parameters`)
    return {
      definitionPointIndex,
      entityId: item.entityId,
      feature,
      ...(feature === 'vertex' ? { vertexIndex: Number(item.vertexIndex) } : {}),
      ...(feature === 'curve' ? { angle: Number(item.angle) } : {}),
    }
  })
  if (new Set(result.map(item => item.definitionPointIndex)).size !== result.length) return fail('Dimension associations must target unique definition points')
  return clone(result)
}

const point3 = (value: unknown, name: string): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || value.some(item => typeof item !== 'number' || !Number.isFinite(item)) || value[2] !== 0) return fail(`${name} must be a finite model-XY point`)
  return [value[0], value[1], value[2]]
}

const normalizedAngle = (value: number): number => ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

function curvePoint(entity: KJObjectRecord, angle: number): [number, number, number] {
  if (!['CIRCLE', 'ARC'].includes(entity.type)) return fail(`Dimension curve association requires CIRCLE or ARC: ${entity.id}`)
  const center = point3(entity.payload.center, `Dimension source ${entity.id} center`)
  const radius = finite(entity.payload.radius, `Dimension source ${entity.id} radius`)
  if (!(radius > 0)) return fail(`Dimension source ${entity.id} radius must be positive`)
  if (entity.type === 'ARC') {
    const start = finite(entity.payload.startAngle, `Dimension source ${entity.id} start angle`)
    const end = finite(entity.payload.endAngle, `Dimension source ${entity.id} end angle`)
    const direction = entity.payload.clockwise === true ? -1 : 1
    const span = normalizedAngle((end - start) * direction)
    const offset = normalizedAngle((angle - start) * direction)
    if (span < 1e-12 || offset > span + 1e-10 && 2 * Math.PI - offset > 1e-10) return fail(`Dimension curve association lies outside ARC ${entity.id}`)
  }
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), 0]
}

function resolvePoint(transaction: KJTransaction, dimension: KJObjectRecord, association: KJDimensionPointAssociation): [number, number, number] {
  const source = transaction.getObject(association.entityId)
  if (!source || source.kind !== 'entity' || source.erased) return fail(`Dimension ${dimension.id} source is unavailable: ${association.entityId}`)
  if (source.ownerId !== dimension.ownerId) return fail(`Dimension ${dimension.id} source must share its drawing space`)
  const payload = source.payload
  switch (association.feature) {
    case 'start':
    case 'end':
      if (source.type === 'ARC') return curvePoint(source, finite(payload[association.feature === 'start' ? 'startAngle' : 'endAngle'], `Dimension source ${source.id} endpoint angle`))
      if (source.type !== 'LINE') return fail(`Dimension ${association.feature} association requires LINE or ARC`)
      return point3(payload[association.feature], `Dimension source ${source.id} ${association.feature}`)
    case 'center':
      if (!['CIRCLE', 'ARC'].includes(source.type)) return fail('Dimension center association requires CIRCLE or ARC')
      return point3(payload.center, `Dimension source ${source.id} center`)
    case 'left': return curvePoint(source, Math.PI)
    case 'right': return curvePoint(source, 0)
    case 'top': return curvePoint(source, Math.PI / 2)
    case 'bottom': return curvePoint(source, 3 * Math.PI / 2)
    case 'curve': return curvePoint(source, association.angle!)
    case 'vertex': {
      if (source.type !== 'LWPOLYLINE' || !Array.isArray(payload.vertices) || payload.vertices.length > 4096) return fail('Dimension vertex association requires a bounded LWPOLYLINE')
      const vertices = payload.vertices as Array<Record<string, unknown>>
      if (vertices.some(vertex => Number(vertex.bulge ?? 0) !== 0)) return fail('Dimension vertex associations require straight polyline segments')
      const vertex = vertices[association.vertexIndex!]
      if (!vertex) return fail(`Dimension vertex association is outside source ${source.id}`)
      return point3(vertex.point, `Dimension source ${source.id} vertex`)
    }
  }
}

/** Recompute native DIMENSION definition points after referenced geometry changed. */
export function refreshAssociativeDimensions(transaction: KJTransaction, changedEntityIds: Iterable<string>): KJObjectRecord[] {
  const changed = new Set([...changedEntityIds].map(String))
  if (!changed.size) return []
  const dimensions = Object.values(transaction._draft().objects).filter(object => object.kind === 'entity' && object.type === 'DIMENSION' && !object.erased && Array.isArray(object.payload.dimensionAssociations))
  const updated: KJObjectRecord[] = []
  for (const readonlyDimension of dimensions) {
    const associations = normalizeDimensionAssociations(readonlyDimension.payload.dimensionAssociations)
    if (!associations.some(item => changed.has(item.entityId))) continue
    const dimension = transaction.getObject(readonlyDimension.id)!
    const definitionPoints = Array.isArray(dimension.payload.definitionPoints) ? clone(dimension.payload.definitionPoints) as unknown[] : []
    for (const association of associations) {
      if (association.definitionPointIndex >= definitionPoints.length) return fail(`Dimension ${dimension.id} association targets a missing definition point`)
      definitionPoints[association.definitionPointIndex] = resolvePoint(transaction, dimension, association)
    }
    const payload: KJObjectPayload = { ...dimension.payload, definitionPoints, measurement: null, blockName: null }
    const style = dimension.payload.styleId ? transaction.getObject(String(dimension.payload.styleId))?.payload : undefined
    const projection = projectDimension(payload, style)
    if (!projection || !Number.isFinite(projection.measurement) || projection.measurement < 1e-8 || projection.measurement > 1e12) return fail(`${dimension.payload.dimensionType} dimension ${dimension.id} became degenerate or exceeded the geometry budget`)
    if (stableHash(dimension.payload.definitionPoints) === stableHash(definitionPoints) && dimension.payload.measurement == null && dimension.payload.blockName == null) continue
    updated.push(transaction.updateObject(dimension.id, { payload: { definitionPoints, measurement: null, blockName: null } }))
  }
  return updated
}
