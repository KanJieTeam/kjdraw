import type { KJDocument } from './document.js'
import { KJRevisionConflictError, KJValidationError } from './errors.js'
import type { KJReadonlyObjectRecord } from './schema.js'
import { deepFreeze } from './utils.js'
import { classifyEntityInBox } from './selection-geometry.js'

export interface KJDrawingContextOptions {
  /** Exact object IDs; duplicates are ignored. Filters are combined with AND. */
  ids?: readonly string[]
  /** Case-insensitive native entity types, for example LINE or ARC. */
  types?: readonly string[]
  layerIds?: readonly string[]
  /** A live block record; defaults to model space. INSERTs are not expanded. */
  spaceId?: string
  /** Hidden and frozen entities are excluded by default. Locked entities remain visible. */
  includeHidden?: boolean
  /** Crossing rectangle [minX,minY,maxX,maxY] in owner XY. Unclassified geometry is retained and marked. */
  bounds?: readonly [number, number, number, number]
  expectedRevision?: number
  /** Matching entity offset. Continuations require expectedRevision and the same filters. */
  offset?: number
  /** Registered layer offset, after layerIds filtering. */
  layerOffset?: number
  /** 0 disables entities; default 50, maximum 200. */
  limit?: number
  /** 0 disables the layer catalog; default 50, maximum 100. */
  maxLayers?: number
  /** Maximum UTF-8 bytes of JSON.stringify(result); default 65536, range 1024..262144. */
  maxBytes?: number
}

/** Explicit recursion keeps geometry property access usable without a deep mapped type. */
export type KJDrawingContextValue = null | boolean | number | string | readonly KJDrawingContextValue[] | { readonly [key: string]: KJDrawingContextValue }
export type KJDrawingGeometryOmittedReason = 'unsupported-type' | 'unsupported-data' | 'geometry-budget' | 'response-budget'
export type KJDrawingContextTruncationReason = 'entity-limit' | 'layer-limit' | 'response-budget' | 'geometry-budget' | 'unsupported-geometry'

export interface KJDrawingContextLayer {
  readonly id: string
  readonly name: string | null
  readonly visible: boolean
  readonly frozen: boolean
  readonly locked: boolean
  /** Visibility and locking eligibility only; this is not an authorization decision. */
  readonly editable: boolean
}

export interface KJDrawingContextEntity {
  readonly id: string
  readonly type: string
  readonly ownerId: string | null
  readonly layerId: string | null
  readonly visible: boolean
  /** Visibility and locking eligibility only; command support is not implied. */
  readonly editable: boolean
  /** Allowlisted stored geometry; coordinates may be OCS or block-local, with native units/angles. */
  readonly geometry: { readonly [key: string]: KJDrawingContextValue } | null
  readonly geometryOmittedReason: KJDrawingGeometryOmittedReason | null
  readonly spatialMatch?: 'intersects' | 'unclassified'
}

export interface KJDrawingContext {
  readonly documentId: string
  readonly revision: number
  readonly units: string
  readonly spaceId: string
  readonly spatialQuery?: { readonly bounds: readonly [number, number, number, number]; readonly coordinates: 'owner-xy'; readonly mode: 'crossing'; readonly unclassifiedIncluded: true }
  readonly layers: readonly KJDrawingContextLayer[]
  readonly entities: readonly KJDrawingContextEntity[]
  /** True when either collection or any requested native geometry was omitted. */
  readonly truncated: boolean
  readonly truncationReasons: readonly KJDrawingContextTruncationReason[]
  readonly nextOffset: number | null
  readonly nextLayerOffset: number | null
  readonly limits: { readonly limit: number; readonly maxLayers: number; readonly maxBytes: number; readonly maxGeometryBytes: number }
}

interface DrawingContextBuilder extends KJDrawingContext {
  layers: KJDrawingContextLayer[]
  entities: KJDrawingContextEntity[]
  truncated: boolean
  truncationReasons: KJDrawingContextTruncationReason[]
  nextOffset: number | null
  nextLayerOffset: number | null
}

interface DrawingContextEntityBuilder extends KJDrawingContextEntity {
  geometry: KJDrawingContextEntity['geometry']
  geometryOmittedReason: KJDrawingGeometryOmittedReason | null
}

const MAX_GEOMETRY_BYTES = 8192
const REASONS: KJDrawingContextTruncationReason[] = ['entity-limit', 'layer-limit', 'response-budget', 'geometry-budget', 'unsupported-geometry']
const OPTION_KEYS = new Set(['ids', 'types', 'layerIds', 'spaceId', 'includeHidden', 'bounds', 'expectedRevision', 'offset', 'layerOffset', 'limit', 'maxLayers', 'maxBytes'])
const encoder = new TextEncoder()

type Shape = 'scalar' | 'hatch-edge' | readonly [Shape] | { readonly [key: string]: Shape }
const scalar = 'scalar' as const
const point: Shape = [scalar]
const vertex: Shape = { point, bulge: scalar, startWidth: scalar, endWidth: scalar }
const polyline: Shape = { vertices: [vertex], closed: scalar, elevation: scalar }
const textGeometry: Shape = { position: point, alignmentPoint: point, text: scalar, height: scalar, rotation: scalar, mirrored: scalar, styleId: scalar, horizontalAlignment: scalar, verticalAlignment: scalar, width: scalar, attachmentPoint: scalar }
const lineEdge: Shape = { type: scalar, start: point, end: point }
const arcEdge: Shape = { type: scalar, center: point, radius: scalar, startAngle: scalar, endAngle: scalar, clockwise: scalar, counterClockwise: scalar }

// Every nested object has an explicit shape. In particular vertex/cell metadata,
// proxy payloads, raw DXF tags, attributes and resource bytes never enter context.
const GEOMETRY: Readonly<Record<string, Shape>> = {
  LINE: { start: point, end: point, degenerate: scalar },
  RAY: { origin: point, direction: point },
  XLINE: { origin: point, direction: point },
  POINT: { position: point },
  CIRCLE: { center: point, radius: scalar, normal: point },
  ARC: { center: point, radius: scalar, startAngle: scalar, endAngle: scalar, clockwise: scalar, normal: point },
  LWPOLYLINE: polyline,
  POLYLINE: polyline,
  WIPEOUT: polyline,
  REVISION_CLOUD: polyline,
  ELLIPSE: { center: point, majorAxis: point, ratio: scalar, startParameter: scalar, endParameter: scalar, clockwise: scalar },
  SPLINE: { degree: scalar, controlPoints: [point], fitPoints: [point], weights: [scalar], knots: [scalar], closed: scalar, periodic: scalar },
  TEXT: textGeometry,
  MTEXT: textGeometry,
  ATTDEF: { ...textGeometry as Record<string, Shape>, tag: scalar, prompt: scalar, flags: scalar, lockPosition: scalar },
  ATTRIB: { ...textGeometry as Record<string, Shape>, tag: scalar, prompt: scalar, flags: scalar, lockPosition: scalar },
  INSERT: { blockRecordId: scalar, position: point, scale: point, rotation: scalar, mirrored: scalar },
  IMAGE: { imageResourceId: scalar, position: point, uVector: point, vVector: point, clipBoundary: [point] },
  HATCH: { boundaryLoops: [{ external: scalar, closed: scalar, vertices: [vertex], edges: ['hatch-edge'] }], patternName: scalar, patternScale: scalar, patternAngle: scalar, solid: scalar },
  LEADER: { vertices: [point], textPosition: point, annotationId: scalar },
  MLEADER: { vertices: [point], textPosition: point, annotationId: scalar },
  DIMENSION: { dimensionType: scalar, definitionPoints: [point], textPosition: point, textOverride: scalar, styleId: scalar, styleName: scalar, blockName: scalar, measurement: scalar, dxfDimensionType: scalar, rotation: scalar },
  VIEWPORT: { center: point, width: scalar, height: scalar, viewCenter: point, viewHeight: scalar, twistAngle: scalar, frozenLayerIds: [scalar] },
  SOLID: { vertices: [point] },
  TRACE: { vertices: [point] },
  SOLID3D: { vertices: [point], triangles: [point], kernelAuthority: scalar, solidModelVersion: scalar },
  TABLE: { position: point, rows: scalar, columns: scalar, cells: [[{ text: scalar }]], rowHeights: [scalar], columnWidths: [scalar], styleId: scalar },
}

function integer(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new KJValidationError(`Drawing context ${name} must be an integer in ${min}..${max}`)
  }
  return value
}

function filterStrings(value: unknown, name: string, normalize = false): Set<string> | null {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length > 200) throw new KJValidationError(`Drawing context ${name} must be an array of at most 200 strings`)
  const result = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 512) throw new KJValidationError(`Drawing context ${name} entries must be non-empty strings of at most 512 characters`)
    result.add(normalize ? entry.trim().toUpperCase() : entry)
  }
  return result
}

class ProjectionFailure {
  constructor(readonly reason: 'geometry-budget' | 'unsupported-data') {}
}

class ProjectionBudget {
  remaining = MAX_GEOMETRY_BYTES
  charge(bytes: number): void {
    this.remaining -= bytes
    if (this.remaining < 0) throw new ProjectionFailure('geometry-budget')
  }
}

function project(value: unknown, shape: Shape, budget: ProjectionBudget): KJDrawingContextValue {
  if (value === null) { budget.charge(4); return null }
  if (shape === 'scalar') {
    if (typeof value === 'string') {
      // Check length before stringify/encode, so one enormous TEXT is never serialized.
      if (value.length > budget.remaining) throw new ProjectionFailure('geometry-budget')
    } else if (typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) {
      throw new ProjectionFailure('unsupported-data')
    }
    budget.charge(encoder.encode(JSON.stringify(value)).byteLength)
    return value as string | boolean | number
  }
  if (shape === 'hatch-edge') {
    const type = value && typeof value === 'object' ? (value as { type?: unknown }).type : null
    if (type !== 'LINE' && type !== 'ARC') throw new ProjectionFailure('unsupported-data')
    return project(value, type === 'LINE' ? lineEdge : arcEdge, budget)
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) throw new ProjectionFailure('unsupported-data')
    budget.charge(2)
    const result: KJDrawingContextValue[] = []
    for (const child of value) {
      if (result.length) budget.charge(1)
      result.push(project(child, shape[0]!, budget))
    }
    return result
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectionFailure('unsupported-data')
  budget.charge(2)
  const result: Record<string, KJDrawingContextValue> = {}
  for (const [key, childShape] of Object.entries(shape)) {
    const child = (value as Record<string, unknown>)[key]
    if (child === undefined) continue
    budget.charge((Object.keys(result).length ? 1 : 0) + key.length + 3)
    result[key] = project(child, childShape, budget)
  }
  return result
}

function nativeGeometry(entity: KJReadonlyObjectRecord): Pick<KJDrawingContextEntity, 'geometry' | 'geometryOmittedReason'> {
  const shape = Object.hasOwn(GEOMETRY, entity.type) ? GEOMETRY[entity.type] : undefined
  if (!shape) return { geometry: null, geometryOmittedReason: 'unsupported-type' }
  try {
    // DXF carries an OCS normal for every entity type. Preserve the stored
    // orientation without converting coordinates or assuming a world XY plane.
    const orientedShape: Shape = { ...shape as Record<string, Shape>, normal: point, extrusionDirection: point }
    return { geometry: project(entity.payload, orientedShape, new ProjectionBudget()) as Record<string, KJDrawingContextValue>, geometryOmittedReason: null }
  } catch (error) {
    if (!(error instanceof ProjectionFailure)) throw error
    return { geometry: null, geometryOmittedReason: error.reason }
  }
}

function jsonBytes(value: unknown): number { return encoder.encode(JSON.stringify(value)).byteLength }

function checkIdentity(value: string | null, maxBytes: number): void {
  if (value !== null && (typeof value !== 'string' || value.length > maxBytes)) {
    throw new KJValidationError('Drawing context identity or layer name cannot fit the response budget')
  }
}

/**
 * Build a model-neutral, immutable read result for a host's tool wrapper. This
 * reads a single KJDocument snapshot and never executes commands. The output
 * budget does not bound the document's initial snapshot allocation or scan time.
 * spaceId identifies the owner; stored coordinates may be OCS or block-local.
 * normal/extrusionDirection are retained without world-coordinate conversion.
 * No block expansion, paper-viewport visibility, semantic interpretation,
 * permission enforcement, or custom payload serialization is performed.
 */
export function createDrawingContext(document: KJDocument, options: KJDrawingContextOptions = {}): KJDrawingContext {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new KJValidationError('Drawing context options must be an object')
  for (const key of Object.keys(options)) if (!OPTION_KEYS.has(key)) throw new KJValidationError('Unknown drawing context option')
  if (options.includeHidden !== undefined && typeof options.includeHidden !== 'boolean') throw new KJValidationError('Drawing context includeHidden must be boolean')
  const bounds = options.bounds
  if (bounds !== undefined && (!Array.isArray(bounds) || bounds.length !== 4 || [...bounds].some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e12) || bounds[0] > bounds[2] || bounds[1] > bounds[3])) throw new KJValidationError('Drawing context bounds must be ordered finite XY extents within +/-1e12')
  const limit = integer(options.limit, 50, 0, 200, 'limit')
  const maxLayers = integer(options.maxLayers, 50, 0, 100, 'maxLayers')
  const maxBytes = integer(options.maxBytes, 65536, 1024, 262144, 'maxBytes')
  const offset = integer(options.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset')
  const layerOffset = integer(options.layerOffset, 0, 0, Number.MAX_SAFE_INTEGER, 'layerOffset')
  const expectedRevision = options.expectedRevision === undefined ? undefined : integer(options.expectedRevision, 0, 0, Number.MAX_SAFE_INTEGER, 'expectedRevision')
  if ((offset > 0 || layerOffset > 0) && expectedRevision === undefined) throw new KJValidationError('Drawing context continuation requires expectedRevision')
  const ids = filterStrings(options.ids, 'ids')
  const types = filterStrings(options.types, 'types', true)
  const layerIds = filterStrings(options.layerIds, 'layerIds')
  if (options.spaceId !== undefined) filterStrings([options.spaceId], 'spaceId')
  if (!document || typeof document.snapshot !== 'function') throw new KJValidationError('Drawing context requires a KJDocument')
  // Reject stale reads before allocating a fresh document snapshot.
  if (expectedRevision !== undefined && document.revision !== expectedRevision) throw new KJRevisionConflictError(expectedRevision, document.revision)
  const state = document.snapshot()
  if (expectedRevision !== undefined && state.revision !== expectedRevision) throw new KJRevisionConflictError(expectedRevision, state.revision)
  const spaceId = options.spaceId ?? state.spaces.modelSpaceId
  const space = Object.hasOwn(state.objects, spaceId) ? state.objects[spaceId] : undefined
  if (!space || space.erased || space.kind !== 'block-record') throw new KJValidationError('Drawing context spaceId must identify a live block record')
  for (const value of [state.documentId, state.header.units, spaceId]) checkIdentity(value, maxBytes)
  const result: DrawingContextBuilder = {
    documentId: state.documentId, revision: state.revision, units: state.header.units, spaceId,
    ...(bounds ? { spatialQuery: { bounds: [...bounds] as [number, number, number, number], coordinates: 'owner-xy' as const, mode: 'crossing' as const, unclassifiedIncluded: true as const } } : {}),
    layers: [], entities: [], truncated: false, truncationReasons: [], nextOffset: null, nextLayerOffset: null,
    limits: { limit, maxLayers, maxBytes, maxGeometryBytes: MAX_GEOMETRY_BYTES },
  }
  // Reserve the worst-case completion envelope before admitting any item. This
  // includes UTF-8 escaping, truncation flags and both continuation offsets.
  let usedBytes = jsonBytes({ ...result, truncated: false, truncationReasons: REASONS, nextOffset: Number.MAX_SAFE_INTEGER, nextLayerOffset: Number.MAX_SAFE_INTEGER })
  if (usedBytes > maxBytes) throw new KJValidationError('Drawing context document identity cannot fit the response budget')
  const reasons = new Set<KJDrawingContextTruncationReason>()
  const addReason = (reason: KJDrawingGeometryOmittedReason | null): void => {
    if (reason) reasons.add(reason === 'unsupported-type' || reason === 'unsupported-data' ? 'unsupported-geometry' : reason)
  }
  let matched = 0
  if (limit > 0) for (const id of ids ?? space.payload.entityIds ?? []) {
    const entity = Object.hasOwn(state.objects, id) ? state.objects[id] : undefined
    if (!entity || entity.erased || entity.kind !== 'entity' || entity.ownerId !== spaceId) continue
    const layerId = entity.payload.layerId ?? null
    if (types && !types.has(entity.type) || layerIds && (layerId === null || !layerIds.has(layerId))) continue
    const layer = layerId !== null && Object.hasOwn(state.objects, layerId) ? state.objects[layerId] : undefined
    const visible = entity.payload.visible !== false && layer?.payload.visible !== false && layer?.payload.frozen !== true
    if (!visible && !options.includeHidden) continue
    const spatialMatch = bounds ? classifyEntityInBox(document, entity, bounds) : undefined
    if (spatialMatch === 'outside') continue
    if (matched++ < offset) continue
    if (result.entities.length >= limit) { result.nextOffset = matched - 1; reasons.add('entity-limit'); break }
    for (const value of [entity.id, entity.type, entity.ownerId, layerId]) checkIdentity(value, maxBytes)
    const item: DrawingContextEntityBuilder = { id: entity.id, type: entity.type, ownerId: entity.ownerId, layerId, visible, editable: visible && layer?.payload.locked !== true, ...nativeGeometry(entity), ...(spatialMatch ? { spatialMatch } : {}) }
    let bytes = jsonBytes(item) + (result.entities.length ? 1 : 0)
    if (usedBytes + bytes > maxBytes && item.geometry !== null) {
      item.geometry = null
      item.geometryOmittedReason = 'response-budget'
      bytes = jsonBytes(item) + (result.entities.length ? 1 : 0)
    }
    if (usedBytes + bytes > maxBytes) {
      if (!result.entities.length) throw new KJValidationError('Drawing context entity identity cannot fit the response budget')
      result.nextOffset = matched - 1; reasons.add('response-budget'); break
    }
    usedBytes += bytes
    result.entities.push(item)
    addReason(item.geometryOmittedReason)
  }
  let matchedLayers = 0
  if (maxLayers > 0) for (const id of state.tables.layers.recordIds) {
    const layer = state.objects[id]
    if (!layer || layer.erased || layerIds && !layerIds.has(id)) continue
    if (matchedLayers++ < layerOffset) continue
    if (result.layers.length >= maxLayers) { result.nextLayerOffset = matchedLayers - 1; reasons.add('layer-limit'); break }
    checkIdentity(layer.id, maxBytes)
    checkIdentity(layer.name, maxBytes)
    const visible = layer.payload.visible !== false && layer.payload.frozen !== true
    const item: KJDrawingContextLayer = { id: layer.id, name: layer.name, visible, frozen: layer.payload.frozen === true, locked: layer.payload.locked === true, editable: visible && layer.payload.locked !== true }
    const bytes = jsonBytes(item) + (result.layers.length ? 1 : 0)
    if (usedBytes + bytes > maxBytes) {
      if (!result.entities.length && !result.layers.length) throw new KJValidationError('Drawing context layer identity cannot fit the response budget')
      result.nextLayerOffset = matchedLayers - 1; reasons.add('response-budget'); break
    }
    usedBytes += bytes
    result.layers.push(item)
  }
  result.truncationReasons = REASONS.filter(reason => reasons.has(reason))
  result.truncated = result.truncationReasons.length > 0
  // Freeze the detached graph at runtime; the public types already express
  // recursive readonly values without instantiating ReadonlyDeep<JsonValue>.
  deepFreeze<object>(result)
  return result
}
