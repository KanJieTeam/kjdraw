import type { KJDocument } from './document.js'
import { normalizeDimensionAssociations, type KJDimensionPointAssociation } from './dimension-associations.js'
import { readDesignRelations } from './design-relations.js'
import { KJRevisionConflictError, KJValidationError } from './errors.js'
import type { KJReadonlyObjectRecord } from './schema.js'
import { displayedEntityBounds } from './selection-geometry.js'
import { deepFreeze, stableHash } from './utils.js'

export interface KJAgentTopologyQuery {
  expectedRevision: number
  units: string
  ids: string[]
  tolerance: number
  maxBytes: number
}

type Point3 = [number, number, number]
type ConnectionFeature = { entityId: string; feature: 'start' | 'end' | 'vertex'; vertexIndex?: number; point: Point3; ownerId: string; incidentSegmentCount: number }
type Omission = { kind: 'entity' | 'selection-set' | 'design' | 'annotation'; id: string; reason: string }
type HatchBoundarySource = { handle: string; status: 'matched' | 'missing' | 'owner-mismatch' | 'unsupported-type'; source: 'native'; entityId?: string; type?: string }
type AnnotationDependency = (KJDimensionPointAssociation & { kind: 'dimension-point' }) | { kind: 'leader-annotation'; entityId: string }

const MAX_TOPOLOGY_FEATURES = 8192
const MAX_TOPOLOGY_COMPARISONS = 500000
const encoder = new TextEncoder()

function fail(message: string): never { throw new KJValidationError(message) }
function jsonBytes(value: unknown): number { return encoder.encode(JSON.stringify(value)).length }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12 }
function point3(value: unknown): Point3 | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3 || !finite(value[0]) || !finite(value[1]) || (value[2] !== undefined && !finite(value[2]))) return null
  return [value[0], value[1], value[2] ?? 0]
}
function defaultPlane(payload: Readonly<Record<string, unknown>>): boolean {
  const vector = payload.normal ?? payload.extrusionDirection
  if (vector !== undefined) {
    const normal = point3(vector)
    if (!normal || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1) return false
  }
  return payload.thickness === undefined || payload.thickness === 0
}
function entityFeatures(entity: KJReadonlyObjectRecord): { features: ConnectionFeature[]; omittedReason?: string } {
  const payload = entity.payload
  if (!defaultPlane(payload)) return { features: [], omittedReason: 'non-default-coordinate-plane' }
  const feature = (name: 'start' | 'end', value: unknown): ConnectionFeature | null => {
    const point = point3(value)
    return point ? { entityId: entity.id, feature: name, point, ownerId: String(entity.ownerId), incidentSegmentCount: 1 } : null
  }
  if (entity.type === 'LINE') {
    const start = feature('start', payload.start), end = feature('end', payload.end)
    return start && end ? { features: [start, end] } : { features: [], omittedReason: 'unsupported-data' }
  }
  if (entity.type === 'ARC') {
    const center = point3(payload.center), radius = payload.radius, startAngle = payload.startAngle, endAngle = payload.endAngle
    if (!center || !finite(radius) || radius <= 0 || !finite(startAngle) || !finite(endAngle)) return { features: [], omittedReason: 'unsupported-data' }
    if (Math.abs(endAngle - startAngle) >= Math.PI * 2 - 1e-12) return { features: [], omittedReason: 'closed-curve-has-no-endpoint' }
    return { features: [
      { entityId: entity.id, feature: 'start', ownerId: String(entity.ownerId), point: [center[0] + radius * Math.cos(startAngle), center[1] + radius * Math.sin(startAngle), center[2]], incidentSegmentCount: 1 },
      { entityId: entity.id, feature: 'end', ownerId: String(entity.ownerId), point: [center[0] + radius * Math.cos(endAngle), center[1] + radius * Math.sin(endAngle), center[2]], incidentSegmentCount: 1 },
    ] }
  }
  if (entity.type === 'ELLIPSE') {
    const center = point3(payload.center), axis = point3(payload.majorAxis), ratio = payload.ratio, start = payload.startParameter ?? 0, end = payload.endParameter ?? Math.PI * 2
    if (!center || !axis || axis[2] !== 0 || !finite(ratio) || ratio <= 0 || ratio > 1 || !finite(start) || !finite(end) || Math.hypot(axis[0], axis[1]) <= 1e-12) return { features: [], omittedReason: 'unsupported-data' }
    if (Math.abs(end - start) >= Math.PI * 2 - 1e-12) return { features: [], omittedReason: 'closed-curve-has-no-endpoint' }
    const at = (parameter: number): Point3 => [center[0] + axis[0] * Math.cos(parameter) - axis[1] * ratio * Math.sin(parameter), center[1] + axis[1] * Math.cos(parameter) + axis[0] * ratio * Math.sin(parameter), center[2]]
    return { features: [
      { entityId: entity.id, feature: 'start', ownerId: String(entity.ownerId), point: at(start), incidentSegmentCount: 1 },
      { entityId: entity.id, feature: 'end', ownerId: String(entity.ownerId), point: at(end), incidentSegmentCount: 1 },
    ] }
  }
  if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
    if (!Array.isArray(payload.vertices) || payload.vertices.length < 2 || payload.vertices.length > 4096) return { features: [], omittedReason: 'unsupported-data' }
    const features: ConnectionFeature[] = []
    for (let vertexIndex = 0; vertexIndex < payload.vertices.length; vertexIndex++) {
      const raw = payload.vertices[vertexIndex]
      const point = point3(raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { point?: unknown }).point : raw)
      if (!point) return { features: [], omittedReason: 'unsupported-data' }
      features.push({ entityId: entity.id, feature: 'vertex', vertexIndex, point, ownerId: String(entity.ownerId), incidentSegmentCount: payload.closed === true || vertexIndex > 0 && vertexIndex < payload.vertices.length - 1 ? 2 : 1 })
    }
    return { features }
  }
  if (entity.type === 'INSERT') return { features: [], omittedReason: 'block-instance-not-expanded' }
  if (entity.type === 'HATCH') return { features: [], omittedReason: 'region-fill-not-connectivity' }
  if (entity.type === 'CIRCLE' || entity.type === 'RAY' || entity.type === 'XLINE') return { features: [], omittedReason: 'entity-has-no-finite-endpoints' }
  return { features: [], omittedReason: 'unsupported-type' }
}

class UnionFind {
  readonly parent: number[]
  constructor(length: number) { this.parent = Array.from({ length }, (_, index) => index) }
  find(index: number): number { const parent = this.parent[index]!; if (parent === index) return index; return this.parent[index] = this.find(parent) }
  union(a: number, b: number): void { const left = this.find(a), right = this.find(b); if (left !== right) this.parent[Math.max(left, right)] = Math.min(left, right) }
}

interface ConnectionSite { ownerId: string; point: Point3; features: ConnectionFeature[] }

function connectFeatureSites(features: readonly ConnectionFeature[], tolerance: number): { groups: ConnectionFeature[][]; comparisons: number } {
  const siteByPoint = new Map<string, ConnectionSite>()
  for (const feature of features) {
    const normalized = feature.point.map(value => Object.is(value, -0) ? 0 : value) as Point3
    const key = `${feature.ownerId}\u0000${normalized[0]}\u0000${normalized[1]}\u0000${normalized[2]}`
    const site = siteByPoint.get(key)
    if (site) site.features.push(feature)
    else siteByPoint.set(key, { ownerId: feature.ownerId, point: normalized, features: [feature] })
  }
  const sites = [...siteByPoint.values()].sort((a, b) => a.ownerId.localeCompare(b.ownerId) || a.point[0] - b.point[0] || a.point[1] - b.point[1] || a.point[2] - b.point[2])
  const sets = new UnionFind(sites.length), toleranceSquared = tolerance * tolerance
  let comparisons = 0
  const compare = (left: number, right: number): boolean => {
    if (++comparisons > MAX_TOPOLOGY_COMPARISONS) fail(`Topology comparison budget exceeded (${MAX_TOPOLOGY_COMPARISONS}); query fewer IDs or use a smaller tolerance`)
    const a = sites[left]!.point, b = sites[right]!.point
    if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 > toleranceSquared) return false
    sets.union(left, right); return true
  }
  let ownerStart = 0
  while (ownerStart < sites.length) {
    let ownerEnd = ownerStart + 1
    while (ownerEnd < sites.length && sites[ownerEnd]!.ownerId === sites[ownerStart]!.ownerId) ownerEnd++
    const origin: Point3 = [Math.min(...sites.slice(ownerStart, ownerEnd).map(site => site.point[0])), Math.min(...sites.slice(ownerStart, ownerEnd).map(site => site.point[1])), Math.min(...sites.slice(ownerStart, ownerEnd).map(site => site.point[2]))]
    const cellSize = tolerance / 2
    const coordinates = sites.slice(ownerStart, ownerEnd).map(site => site.point.map((value, axis) => Math.floor((value - origin[axis]!) / cellSize)) as Point3)
    const safeGrid = cellSize > 0 && Number.isFinite(cellSize) && coordinates.every(point => point.every(Number.isSafeInteger))
    if (safeGrid) {
      const buckets = new Map<string, number[]>()
      const key = (x: number, y: number, z: number): string => `${x},${y},${z}`
      for (let localIndex = 0; localIndex < coordinates.length; localIndex++) {
        const siteIndex = ownerStart + localIndex, point = sites[siteIndex]!.point, cell = coordinates[localIndex]!
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
          const candidateCell: Point3 = [cell[0] + dx, cell[1] + dy, cell[2] + dz]
          const bucket = buckets.get(key(...candidateCell)); if (!bucket) continue
          let minSquared = 0, maxSquared = 0
          for (let axis = 0; axis < 3; axis++) {
            const low = origin[axis]! + candidateCell[axis]! * cellSize, high = low + cellSize, coordinate = point[axis]!
            const nearest = coordinate < low ? low - coordinate : coordinate > high ? coordinate - high : 0
            const farthest = Math.max(Math.abs(coordinate - low), Math.abs(coordinate - high))
            minSquared += nearest * nearest; maxSquared += farthest * farthest
          }
          if (minSquared > toleranceSquared) continue
          if (maxSquared <= toleranceSquared) { sets.union(siteIndex, bucket[0]!); continue }
          for (const candidate of bucket) if (compare(siteIndex, candidate)) break
        }
        const bucketKey = key(...cell), bucket = buckets.get(bucketKey)
        if (bucket) { sets.union(siteIndex, bucket[0]!); bucket.push(siteIndex) } else buckets.set(bucketKey, [siteIndex])
      }
    } else {
      for (let left = ownerStart; left < ownerEnd; left++) for (let right = left + 1; right < ownerEnd && sites[right]!.point[0] - sites[left]!.point[0] <= tolerance; right++) compare(left, right)
    }
    ownerStart = ownerEnd
  }
  const groups = new Map<number, ConnectionFeature[]>()
  for (let index = 0; index < sites.length; index++) { const root = sets.find(index), group = groups.get(root) ?? []; group.push(...sites[index]!.features); groups.set(root, group) }
  return { groups: [...groups.values()], comparisons }
}

function dependencyKey(value: KJDimensionPointAssociation): string {
  return `${value.entityId}\u0000${value.definitionPointIndex}\u0000${value.feature}\u0000${value.vertexIndex ?? ''}\u0000${value.angle ?? ''}`
}

function hatchLoopSourceHandles(payload: Readonly<Record<string, unknown>>): Map<number, string[]> {
  const result = new Map<number, string[]>()
  if (!Array.isArray(payload.rawTags)) return result
  const tags = payload.rawTags as readonly unknown[]
  let loopIndex = -1
  for (let index = 0; index < tags.length; index++) {
    const tag = tags[index]
    if (!tag || typeof tag !== 'object' || Array.isArray(tag)) continue
    if (Number((tag as { code?: unknown }).code) === 92) { loopIndex++; continue }
    if (Number((tag as { code?: unknown }).code) !== 97) continue
    const count = Number((tag as { value?: unknown }).value)
    if (!Number.isSafeInteger(count) || count < 1 || count > 4096) continue
    const next = tags[index + 1]
    if (!next || typeof next !== 'object' || Array.isArray(next) || Number((next as { code?: unknown }).code) !== 330) continue
    const handles: string[] = []
    for (let offset = 1; offset <= count; offset++) {
      const source = tags[index + offset]
      if (!source || typeof source !== 'object' || Array.isArray(source) || Number((source as { code?: unknown }).code) !== 330) break
      const handle = String((source as { value?: unknown }).value ?? '').trim().toUpperCase()
      if (/^[0-9A-F]+$/.test(handle)) handles.push(handle)
    }
    result.set(Math.max(loopIndex, 0), [...new Set(handles)].sort())
  }
  return result
}

/** Build an exact, bounded, immutable owner-local topology view without editing the document. */
export function createAgentTopologyContext(document: KJDocument, query: KJAgentTopologyQuery): Readonly<Record<string, unknown>> {
  if (!query || typeof query !== 'object' || Array.isArray(query)) fail('Topology query must be an object')
  const allowed = new Set(['expectedRevision', 'units', 'ids', 'tolerance', 'maxBytes'])
  if (Object.keys(query).some(key => !allowed.has(key))) fail('Topology query contains unsupported fields')
  if (!Number.isSafeInteger(query.expectedRevision) || query.expectedRevision < 0) fail('Topology query expectedRevision must be a nonnegative safe integer')
  if (document.revision !== query.expectedRevision) throw new KJRevisionConflictError(query.expectedRevision, document.revision)
  const state = document.snapshot()
  if (query.units !== state.header.units) fail('Unit mismatch; read the drawing units before calling this tool')
  if (!Array.isArray(query.ids) || query.ids.length < 1 || query.ids.length > 64 || query.ids.some(id => typeof id !== 'string' || !id || id.length > 256) || new Set(query.ids).size !== query.ids.length) fail('Topology query requires 1–64 unique bounded entity IDs')
  if (!finite(query.tolerance) || query.tolerance <= 0 || query.tolerance > 1e6) fail('Topology query tolerance must be greater than 0 and at most 1000000 drawing units')
  if (!Number.isSafeInteger(query.maxBytes) || query.maxBytes < 1024 || query.maxBytes > 262144) fail('Topology query maxBytes must be an integer from 1024 through 262144')

  const records = [...query.ids].sort().map(id => state.objects[id]).map((record, index) => {
    if (!record || record.erased || record.kind !== 'entity') fail(`Topology query entity does not exist: ${[...query.ids].sort()[index]}`)
    return record
  })
  const selectedIds = new Set(records.map(record => record.id))
  const entitiesByHandle = new Map<string, KJReadonlyObjectRecord[]>()
  for (const object of Object.values(state.objects)) if (!object.erased && object.kind === 'entity') {
    const list = entitiesByHandle.get(object.handle.toUpperCase()) ?? []
    list.push(object); entitiesByHandle.set(object.handle.toUpperCase(), list)
  }
  const insertCounts = new Map<string, number>()
  for (const object of Object.values(state.objects)) if (!object.erased && object.kind === 'entity' && object.type === 'INSERT' && typeof object.payload.blockRecordId === 'string') insertCounts.set(object.payload.blockRecordId, (insertCounts.get(object.payload.blockRecordId) ?? 0) + 1)
  const displayBoundsCache = new WeakMap<object, readonly [number, number, number, number] | null>()
  const selectionMembership = new Map<string, string[]>(), designMembership = new Map<string, string[]>()
  const associatedAnnotations = new Map<string, Set<string>>(), annotationDependencies = new Map<string, AnnotationDependency[]>()
  const omitted: Omission[] = []
  for (const selection of [...document.listObjects({ kind: 'group', type: 'SELECTION_SET' })].sort((a, b) => a.id.localeCompare(b.id))) {
    const members = selection.payload.memberIds
    if (!Array.isArray(members) || members.length < 1 || members.length > 64 || members.some(id => typeof id !== 'string' || !id || id.length > 256) || new Set(members).size !== members.length) {
      if (Array.isArray(members) && members.some(id => typeof id === 'string' && selectedIds.has(id))) omitted.push({ kind: 'selection-set', id: selection.id, reason: 'invalid-membership' })
      continue
    }
    for (const id of members) {
      const list = selectionMembership.get(id) ?? []
      list.push(selection.id); selectionMembership.set(id, list)
    }
  }
  for (const relation of [...document.listObjects({ type: 'DESIGN_RELATIONS' })].sort((a, b) => a.id.localeCompare(b.id))) {
    try {
      for (const id of readDesignRelations(document, [relation.id])[0]?.entityIds ?? []) {
        const list = designMembership.get(id) ?? []
        list.push(relation.id); designMembership.set(id, list)
      }
    } catch {
      const definition = relation.payload.definition
      const bindings = definition && typeof definition === 'object' && !Array.isArray(definition) ? (definition as { bindings?: unknown }).bindings : undefined
      if (Array.isArray(bindings) && bindings.some(binding => binding && typeof binding === 'object' && !Array.isArray(binding) && selectedIds.has(String((binding as { entityId?: unknown }).entityId ?? '')))) omitted.push({ kind: 'design', id: relation.id, reason: 'invalid-design-relation' })
    }
  }
  for (const annotation of [...document.listEntities()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (annotation.type === 'DIMENSION' && Array.isArray(annotation.payload.dimensionAssociations)) {
      try {
        const dependencies = normalizeDimensionAssociations(annotation.payload.dimensionAssociations).sort((a, b) => dependencyKey(a).localeCompare(dependencyKey(b)))
        annotationDependencies.set(annotation.id, dependencies.map(dependency => ({ kind: 'dimension-point', ...dependency })))
        for (const dependency of dependencies) {
          const ids = associatedAnnotations.get(dependency.entityId) ?? new Set<string>()
          ids.add(annotation.id); associatedAnnotations.set(dependency.entityId, ids)
        }
      } catch {
        if (selectedIds.has(annotation.id) || annotation.payload.dimensionAssociations.some(dependency => dependency && typeof dependency === 'object' && !Array.isArray(dependency) && selectedIds.has(String((dependency as { entityId?: unknown }).entityId ?? '')))) omitted.push({ kind: 'annotation', id: annotation.id, reason: 'invalid-dimension-associations' })
      }
    }
    if ((annotation.type === 'LEADER' || annotation.type === 'MLEADER') && typeof annotation.payload.annotationId === 'string' && annotation.payload.annotationId) {
      annotationDependencies.set(annotation.id, [{ kind: 'leader-annotation', entityId: annotation.payload.annotationId }])
      const ids = associatedAnnotations.get(annotation.payload.annotationId) ?? new Set<string>()
      ids.add(annotation.id); associatedAnnotations.set(annotation.payload.annotationId, ids)
    }
  }

  const features: ConnectionFeature[] = [], connectivity = new Map<string, { status: 'supported' | 'not-applicable' | 'omitted'; connectionFeatureCount: number; reason?: string }>()
  const notApplicableReasons = new Set(['block-instance-not-expanded', 'closed-curve-has-no-endpoint', 'entity-has-no-finite-endpoints', 'region-fill-not-connectivity'])
  for (const entity of records) {
    const extracted = entityFeatures(entity)
    if (extracted.omittedReason) {
      connectivity.set(entity.id, { status: notApplicableReasons.has(extracted.omittedReason) ? 'not-applicable' : 'omitted', connectionFeatureCount: 0, reason: extracted.omittedReason })
      omitted.push({ kind: 'entity', id: entity.id, reason: extracted.omittedReason })
    } else if (features.length + extracted.features.length > MAX_TOPOLOGY_FEATURES) {
      connectivity.set(entity.id, { status: 'omitted', connectionFeatureCount: 0, reason: 'topology-feature-budget' })
      omitted.push({ kind: 'entity', id: entity.id, reason: 'topology-feature-budget' })
    } else {
      connectivity.set(entity.id, { status: 'supported', connectionFeatureCount: extracted.features.length })
      features.push(...extracted.features)
    }
  }
  features.sort((a, b) => a.ownerId.localeCompare(b.ownerId) || a.point[0] - b.point[0] || a.point[1] - b.point[1] || a.point[2] - b.point[2] || a.entityId.localeCompare(b.entityId) || a.feature.localeCompare(b.feature) || (a.vertexIndex ?? -1) - (b.vertexIndex ?? -1))
  const connected = connectFeatureSites(features, query.tolerance)
  const connectionGroups = connected.groups.map(group => group.sort((a, b) => a.entityId.localeCompare(b.entityId) || a.feature.localeCompare(b.feature) || (a.vertexIndex ?? -1) - (b.vertexIndex ?? -1))).sort((a, b) => a[0]!.ownerId.localeCompare(b[0]!.ownerId) || a[0]!.point[0] - b[0]!.point[0] || a[0]!.point[1] - b[0]!.point[1] || a[0]!.point[2] - b[0]!.point[2] || a[0]!.entityId.localeCompare(b[0]!.entityId)).map((group, index) => ({
    id: `connection:${String(index + 1).padStart(4, '0')}`, ownerId: group[0]!.ownerId, point: group[0]!.point,
    members: group.map(({ entityId, feature, vertexIndex, incidentSegmentCount }) => ({ entityId, feature, incidentSegmentCount, ...(vertexIndex === undefined ? {} : { vertexIndex }) })),
  }))
  const entityIds = records.filter(entity => connectivity.get(entity.id)?.status === 'supported').map(entity => entity.id)
  const entityIndex = new Map(entityIds.map((id, index) => [id, index])), entitySets = new UnionFind(entityIds.length)
  for (const group of connectionGroups) {
    const ids = [...new Set(group.members.map(member => member.entityId))]
    for (let index = 1; index < ids.length; index++) entitySets.union(entityIndex.get(ids[0]!)!, entityIndex.get(ids[index]!)!)
  }
  const componentMap = new Map<number, string[]>()
  for (const id of entityIds) { const root = entitySets.find(entityIndex.get(id)!), list = componentMap.get(root) ?? []; list.push(id); componentMap.set(root, list) }
  const components = [...componentMap.values()].map(ids => ids.sort()).sort((a, b) => a[0]!.localeCompare(b[0]!)).map((ids, index) => ({ id: `component:${String(index + 1).padStart(4, '0')}`, entityIds: ids }))
  const branchNodes = connectionGroups.map(group => ({ connectionId: group.id, entityIds: [...new Set(group.members.map(member => member.entityId))].sort(), degree: group.members.reduce((sum, member) => sum + member.incidentSegmentCount, 0) })).filter(branch => branch.degree >= 3)
  const entities = records.map(entity => {
    const layerId = typeof entity.payload.layerId === 'string' ? entity.payload.layerId : null
    const layer = layerId ? state.objects[layerId] : undefined
    const visible = entity.payload.visible !== false && layer?.payload.visible !== false && layer?.payload.frozen !== true
    const layerVisible = layer?.payload.visible !== false && layer?.payload.frozen !== true
    let hatchBoundarySources: HatchBoundarySource[] | undefined
    const resolveHatchSource = (handle: string): HatchBoundarySource => {
      const matches = entitiesByHandle.get(handle) ?? []
      const sameOwner = matches.filter(candidate => candidate.ownerId === entity.ownerId)
      const source = sameOwner.length === 1 ? sameOwner[0] : matches.length === 1 ? matches[0] : undefined
      if (!source) return { handle, status: 'missing', source: 'native' }
      if (source.ownerId !== entity.ownerId) return { handle, status: 'owner-mismatch', source: 'native', entityId: source.id, type: source.type }
      if (!['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE'].includes(source.type)) return { handle, status: 'unsupported-type', source: 'native', entityId: source.id, type: source.type }
      return { handle, status: 'matched', source: 'native', entityId: source.id, type: source.type }
    }
    const hatchLoopSources = entity.type === 'HATCH' ? hatchLoopSourceHandles(entity.payload) : undefined
    if (hatchLoopSources) hatchBoundarySources = [...hatchLoopSources.values()].flatMap(handles => handles.map(resolveHatchSource))
    let insertReference: Record<string, unknown> | undefined
    if (entity.type === 'INSERT') {
      const blockRecordId = typeof entity.payload.blockRecordId === 'string' ? entity.payload.blockRecordId : null
      const definition = blockRecordId ? state.objects[blockRecordId] : undefined
      const memberIds = definition?.kind === 'block-record' && Array.isArray(definition.payload.entityIds) ? definition.payload.entityIds : []
      const typeCounts: Record<string, number> = {}
      let resolvedCount = 0
      for (const id of memberIds) {
        const member = state.objects[id]
        if (!member || member.erased || member.kind !== 'entity' || member.ownerId !== blockRecordId) continue
        typeCounts[member.type] = (typeCounts[member.type] ?? 0) + 1; resolvedCount++
      }
      const definitionTypes = Object.fromEntries(Object.entries(typeCounts).sort(([a], [b]) => a.localeCompare(b)))
      const status = !definition || definition.erased || definition.kind !== 'block-record' ? 'missing-definition' : resolvedCount !== memberIds.length ? 'incomplete-definition' : 'matched'
      insertReference = {
        source: 'native', status, blockRecordId, definitionName: definition?.name ?? null, definitionEntityCount: memberIds.length, resolvedEntityCount: resolvedCount,
        definitionTypes, typeCountSignature: stableHash({ definitionEntityCount: memberIds.length, definitionTypes }),
        position: point3(entity.payload.position), scale: Array.isArray(entity.payload.scale) ? entity.payload.scale.slice(0, 3) : null, rotation: finite(entity.payload.rotation) ? entity.payload.rotation : 0,
        repeat: { source: 'native', scope: 'document', sameDefinitionInstanceCount: blockRecordId ? insertCounts.get(blockRecordId) ?? 0 : 0 },
      }
    }
    const displayExtent = entity.type === 'INSERT' || entity.type === 'HATCH' ? displayedEntityBounds(document, entity, displayBoundsCache) : undefined
    return {
      id: entity.id, type: entity.type, ownerId: entity.ownerId,
      layer: { id: layerId, name: layer?.name ?? null, visible: layerVisible, frozen: layer?.payload.frozen === true, locked: layer?.payload.locked === true, editable: layerVisible && layer?.payload.locked !== true },
      visible, editable: visible && layer?.payload.locked !== true,
      selectionSetIds: [...(selectionMembership.get(entity.id) ?? [])].sort(), designIds: [...(designMembership.get(entity.id) ?? [])].sort(),
      associatedAnnotationIds: [...(associatedAnnotations.get(entity.id) ?? [])].sort(), annotationDependencies: annotationDependencies.get(entity.id) ?? [], connectivity: connectivity.get(entity.id),
      ...(hatchBoundarySources === undefined && insertReference === undefined ? {} : { nativeReferences: {
        structuralRole: entity.type === 'HATCH' ? 'region-fill' : 'block-instance',
        patternCandidate: { eligible: true, kind: entity.type === 'HATCH' ? 'region-fill' : 'symbol-candidate', source: 'native-entity-type', inferredRole: null, boundaryRole: 'unassigned' },
        displayExtent: displayExtent ? { source: 'native-projection', status: 'complete', bounds: displayExtent } : { source: 'native-projection', status: 'unavailable', bounds: null },
        ...(hatchBoundarySources === undefined ? {} : { hatch: {
          source: 'native', patternName: typeof entity.payload.patternName === 'string' ? entity.payload.patternName : null, solid: entity.payload.solid === true, associative: entity.payload.associative === true,
          patternScale: finite(entity.payload.patternScale) ? entity.payload.patternScale : null, patternAngle: finite(entity.payload.patternAngle) ? entity.payload.patternAngle : null,
          loops: Array.from({ length: Array.isArray(entity.payload.boundaryLoops) ? entity.payload.boundaryLoops.length : 0 }, (_, loopIndex) => ({ loopIndex, boundarySources: (hatchLoopSources?.get(loopIndex) ?? []).map(resolveHatchSource) })),
        } }),
        ...(insertReference === undefined ? {} : { insert: insertReference }),
      } }),
    }
  })
  const result = {
    documentId: state.documentId, revision: state.revision, units: state.header.units, tolerance: query.tolerance, coordinateSpace: 'owner-local', semanticInference: 'none',
    entities, connectionGroups, connectedComponents: components, branchNodes,
    unsupported: omitted.filter(item => item.kind === 'entity' && connectivity.get(item.id)?.status === 'omitted'),
    connectivityOmissions: omitted.filter(item => item.kind === 'entity'), omitted: omitted.filter(item => item.kind !== 'entity').sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason)),
    limits: { maxIds: 64, maxTopologyFeatures: MAX_TOPOLOGY_FEATURES, maxComparisons: MAX_TOPOLOGY_COMPARISONS, comparisons: connected.comparisons, maxBytes: query.maxBytes },
  }
  if (jsonBytes({ ok: true, value: result }) > query.maxBytes) fail('Topology query result exceeds maxBytes; query fewer IDs or increase maxBytes')
  if (document.revision !== state.revision) throw new KJRevisionConflictError(state.revision, document.revision)
  return deepFreeze(result)
}
