import { KJDocument } from './document.js'
import { KJDrawError, KJRevisionConflictError, KJValidationError } from './errors.js'
import { deepFreeze } from './utils.js'
import type { ReadonlyDeep } from './utils.js'
import type { KJDocumentState, KJReadonlyObjectRecord } from './schema.js'

export type KJNativeCurveVisibility = 'include-hidden' | 'visible-only'
export type KJNativeCurveTypeScope = 'all-owner-entities' | 'finite-line-circle-only'
export type KJNativeCurveUnsupportedPolicy = 'reject' | 'diagnostics'
/** Internal read utility, not a registered agent tool. Units are the native
 * model-space document units; paper/block units are deliberately unsupported. */
export interface KJNativeCurveQueryOptions {
  documentId: string
  expectedRevision: number
  ownerId: string
  units: string
  ownerPolicy: 'model-space-only'
  visibility: KJNativeCurveVisibility
  typeScope: KJNativeCurveTypeScope
  unsupportedPolicy: KJNativeCurveUnsupportedPolicy
  offset: number
  limit: number
  /** Entire live owner entity count, including explicitly excluded entities.
   * Bounds query work, not allocation performed by document.snapshot(). */
  maxEntities: number
  maxBytes: number
}
export interface KJNativeCurveNeighborhoodOptions extends KJNativeCurveQueryOptions {
  anchorId: string
  radius: number
  metric: 'text-insertion-to-finite-native-xy-curve'
  boundary: 'inclusive'
}
export interface KJNativeXYBounds { min: readonly [number, number]; max: readonly [number, number] }
export interface KJNativeCurveDiagnostic { id: string; handle: string; type: string; reason: string }
export interface KJNativeCurveRow {
  id: string
  handle: string
  ownerId: string
  layerId: string
  type: 'LINE' | 'CIRCLE'
  visible: boolean
  bounds: KJNativeXYBounds
}
export interface KJNativeCurveDistanceRow extends KJNativeCurveRow {
  distance: number
  closestPoint: readonly [number, number] | null
  closestPointUnique: boolean
}
export interface KJNativeCurveQueryPage<Row extends KJNativeCurveRow> {
  kind: 'native-curve-bounds' | 'native-curve-neighborhood'
  documentId: string
  revision: number
  ownerId: string
  units: string
  ownerPolicy: 'model-space-only'
  visibility: KJNativeCurveVisibility
  typeScope: KJNativeCurveTypeScope
  method: 'native-analytic-owner-xy-centerline-curves-v1'
  numericalPolicy: 'binary64-no-selection-tolerance'
  inspectedOwnerEntityCount: number
  eligibleCurveCount: number
  excludedCounts: { hidden: number; otherTypes: number; anchor: number }
  scopeComplete: boolean
  /** True only when this response contains every result, from offset 0.
   * Otherwise traverse nextOffset at the exact same identity/revision/options. */
  complete: boolean
  offset: number
  nextOffset: number | null
  totalResultCount: number | null
  rows: readonly Row[]
  diagnostics: readonly KJNativeCurveDiagnostic[]
}
export interface KJNativeCurveBoundsPage extends KJNativeCurveQueryPage<KJNativeCurveRow> {
  /** Full declared curve scope bounds, never text/display/stroke/3D extents.
   * Null for an empty or unsupported scope; scopeComplete distinguishes them. */
  bounds: KJNativeXYBounds | null
}
export interface KJNativeCurveNeighborhoodPage extends KJNativeCurveQueryPage<KJNativeCurveDistanceRow> {
  anchor: { id: string; handle: string; ownerId: string; type: 'TEXT'; position: readonly [number, number]; visible: boolean }
  radius: number
  metric: 'text-insertion-to-finite-native-xy-curve'
  boundary: 'inclusive'
}

const commonKeys = ['documentId', 'expectedRevision', 'ownerId', 'units', 'ownerPolicy', 'visibility', 'typeScope',
  'unsupportedPolicy', 'offset', 'limit', 'maxEntities', 'maxBytes']
const MAX_COORDINATE = 1e12
const MAX_ENTITIES = 4096
const MAX_BYTES = 262144
const encoder = new TextEncoder()
type XY = [number, number]
type State = ReadonlyDeep<KJDocumentState>
interface Curve { row: KJNativeCurveRow; start?: XY; end?: XY; center?: XY; radius?: number }
interface Inspection { state: State; curves: Curve[]; diagnostics: KJNativeCurveDiagnostic[];
  excludedCounts: { hidden: number; otherTypes: number; anchor: number }; count: number }

function invalid(message: string): never { throw new KJValidationError(message) }
function own(value: unknown, key: string, required = true): unknown {
  if (!value || typeof value !== 'object') invalid('Native query data must be an object')
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor) { if (required || key in value) invalid(`Native query requires own data field ${key}`); return undefined }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(`Native query field ${key} must be enumerable data`)
  return descriptor.value
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) invalid(`${label} must be a bounded nonempty data string`)
  return value
}
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(`${label} must be an integer from ${minimum} to ${maximum}`)
  return value
}
function finite(value: unknown, label: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE || positive && value <= 0) invalid(`${label} must be a ${positive ? 'positive ' : ''}finite numeric value within ${MAX_COORDINATE}`)
  return value
}
function numericPoint(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 3 || Reflect.ownKeys(value).length !== 4) invalid(`${label} must be a plain native XYZ tuple`)
  return [0, 1, 2].map(axis => finite(own(value, String(axis)), label))
}
function xy(value: unknown, label: string): XY { const p = numericPoint(value, label); return [p[0]!, p[1]!] }
function orientation(payload: unknown): void {
  for (const key of ['normal', 'extrusionDirection']) {
    const value = own(payload, key, false)
    if (value !== undefined) {
      const p = numericPoint(value, key)
      if (p[0] !== 0 || p[1] !== 0 || p[2] !== 1) throw new KJDrawError('Only default native XY orientation is supported', { code: 'KJNATIVE_GEOMETRY_UNSUPPORTED_ORIENTATION' })
    }
  }
  const thickness = own(payload, 'thickness', false)
  if (thickness !== undefined && finite(thickness, 'thickness') !== 0) throw new KJDrawError('Extruded thickness is not a finite native XY centerline curve', { code: 'KJNATIVE_GEOMETRY_UNSUPPORTED_THICKNESS' })
}
function validateOptions(value: unknown, neighborhood: boolean): asserts value is KJNativeCurveQueryOptions & Partial<KJNativeCurveNeighborhoodOptions> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Native query options must be plain data')
  const keys = [...commonKeys, ...(neighborhood ? ['anchorId', 'radius', 'metric', 'boundary'] : [])]
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) invalid('Unknown native query option')
  keys.forEach(key => own(value, key))
  identifier(own(value, 'documentId'), 'documentId'); identifier(own(value, 'ownerId'), 'ownerId'); identifier(own(value, 'units'), 'units')
  integer(own(value, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'expectedRevision')
  integer(own(value, 'offset'), 0, MAX_ENTITIES, 'offset'); integer(own(value, 'limit'), 1, 200, 'limit')
  integer(own(value, 'maxEntities'), 1, MAX_ENTITIES, 'maxEntities'); integer(own(value, 'maxBytes'), 1024, MAX_BYTES, 'maxBytes')
  if (own(value, 'ownerPolicy') !== 'model-space-only') invalid('Explicit ownerPolicy must be model-space-only; paper/block units are unsupported')
  if (!['include-hidden', 'visible-only'].includes(own(value, 'visibility') as string)) invalid('Explicit visibility policy is required')
  if (!['all-owner-entities', 'finite-line-circle-only'].includes(own(value, 'typeScope') as string)) invalid('Explicit native type scope is required')
  if (!['reject', 'diagnostics'].includes(own(value, 'unsupportedPolicy') as string)) invalid('Explicit unsupported geometry policy is required')
  if (neighborhood) {
    identifier(own(value, 'anchorId'), 'anchorId'); finite(own(value, 'radius'), 'radius', true)
    if (own(value, 'metric') !== 'text-insertion-to-finite-native-xy-curve' || own(value, 'boundary') !== 'inclusive') invalid('Explicit finite native XY metric and inclusive boundary are required')
  }
}
function capture(document: KJDocument, options: KJNativeCurveQueryOptions): State {
  if (!(document instanceof KJDocument)) invalid('Native query requires an actual KJDocument')
  // Use the native method, not a caller-replaced getObject/listEntities facade.
  const state = KJDocument.prototype.snapshot.call(document)
  if (state.documentId !== options.documentId) throw new KJDrawError('Native query document identity mismatch', { code: 'KJNATIVE_GEOMETRY_DOCUMENT_MISMATCH' })
  if (state.revision !== options.expectedRevision) throw new KJRevisionConflictError(options.expectedRevision, state.revision)
  if (state.header.units !== options.units) throw new KJDrawError('Native query units must match native model document units exactly', { code: 'KJNATIVE_GEOMETRY_UNITS_MISMATCH' })
  const owner = Object.hasOwn(state.objects, options.ownerId) ? state.objects[options.ownerId] : undefined
  if (!owner || owner.erased || owner.kind !== 'block-record' || owner.type !== 'BLOCK_RECORD' ||
    options.ownerId !== state.spaces.modelSpaceId || !state.tables.blockRecords.recordIds.includes(options.ownerId))
    throw new KJDrawError('Only the explicitly selected native model owner is supported; no paper projection or block expansion', { code: 'KJNATIVE_GEOMETRY_OWNER_UNSUPPORTED' })
  return state
}
function visible(state: State, entity: KJReadonlyObjectRecord): boolean {
  const layerId = identifier(own(entity.payload, 'layerId'), 'native layerId')
  const layer = Object.hasOwn(state.objects, layerId) ? state.objects[layerId] : undefined
  if (!layer || layer.erased || layer.kind !== 'table-record' || layer.type !== 'LAYER' || !state.tables.layers.recordIds.includes(layerId)) invalid('Native geometry requires its exact live registered layer')
  const entityVisible = own(entity.payload, 'visible', false), layerVisible = own(layer.payload, 'visible', false), frozen = own(layer.payload, 'frozen', false)
  for (const flag of [entityVisible, layerVisible, frozen]) if (flag !== undefined && typeof flag !== 'boolean') invalid('Native visibility flags must be booleans, never coerced values')
  return entityVisible !== false && layerVisible !== false && frozen !== true
}
function curve(entity: KJReadonlyObjectRecord, isVisible: boolean): Curve {
  orientation(entity.payload)
  const row = { id: identifier(entity.id, 'native id'), handle: identifier(entity.handle, 'native handle'), ownerId: identifier(entity.ownerId, 'native owner'),
    layerId: identifier(own(entity.payload, 'layerId'), 'native layerId'), type: entity.type as 'LINE' | 'CIRCLE', visible: isVisible }
  if (entity.type === 'LINE') {
    const start = xy(own(entity.payload, 'start'), 'LINE start'), end = xy(own(entity.payload, 'end'), 'LINE end')
    return { row: { ...row, bounds: { min: [Math.min(start[0], end[0]), Math.min(start[1], end[1])], max: [Math.max(start[0], end[0]), Math.max(start[1], end[1])] } }, start, end }
  }
  const center = xy(own(entity.payload, 'center'), 'CIRCLE center'), radius = finite(own(entity.payload, 'radius'), 'CIRCLE radius', true)
  return { row: { ...row, bounds: { min: [center[0] - radius, center[1] - radius], max: [center[0] + radius, center[1] + radius] } }, center, radius }
}
function diagnostic(entity: KJReadonlyObjectRecord, reason: string): KJNativeCurveDiagnostic {
  return { id: identifier(entity.id, 'native id'), handle: identifier(entity.handle, 'native handle'), type: identifier(entity.type, 'native type'), reason }
}
function inspect(state: State, options: KJNativeCurveQueryOptions, anchorId?: string): Inspection {
  const inspection: Inspection = { state, curves: [], diagnostics: [], excludedCounts: { hidden: 0, otherTypes: 0, anchor: 0 }, count: 0 }
  for (const id in state.objects) {
    if (!Object.hasOwn(state.objects, id)) continue
    const entity = state.objects[id]!
    if (entity.kind !== 'entity' || entity.erased || entity.ownerId !== options.ownerId) continue
    if (++inspection.count > options.maxEntities) throw new KJDrawError('Entire live owner entity count exceeds maxEntities; no partial query was produced', { code: 'KJNATIVE_GEOMETRY_ENTITY_LIMIT' })
  }
  for (const id in state.objects) {
    if (!Object.hasOwn(state.objects, id)) continue
    const entity = state.objects[id]!
    if (entity.kind !== 'entity' || entity.erased || entity.ownerId !== options.ownerId) continue
    try {
      const isVisible = visible(state, entity)
      if (options.visibility === 'visible-only' && !isVisible) { inspection.excludedCounts.hidden++; continue }
      if (entity.id === anchorId) { inspection.excludedCounts.anchor++; continue }
      if (!['LINE', 'CIRCLE'].includes(entity.type)) {
        if (options.typeScope === 'finite-line-circle-only') { inspection.excludedCounts.otherTypes++; continue }
        inspection.diagnostics.push(diagnostic(entity, 'unsupported-native-entity-type')); continue
      }
      inspection.curves.push(curve(entity, isVisible))
    } catch (error) {
      inspection.diagnostics.push(diagnostic(entity, error instanceof KJDrawError ? error.code : 'invalid-native-geometry'))
    }
  }
  if (inspection.diagnostics.length && options.unsupportedPolicy === 'reject') {
    const details = { diagnostics: inspection.diagnostics }
    if (encoder.encode(JSON.stringify(details)).length > options.maxBytes) throw new KJDrawError('Native geometry diagnostics exceed maxBytes', { code: 'KJNATIVE_GEOMETRY_BYTE_LIMIT' })
    throw new KJDrawError('Declared native scope contains unsupported or invalid geometry; no partial answer was produced', { code: 'KJNATIVE_GEOMETRY_SCOPE_UNSUPPORTED', details })
  }
  return inspection
}
function finish<T>(document: KJDocument, options: KJNativeCurveQueryOptions, state: State, result: T): ReadonlyDeep<T> {
  if (KJDocument.prototype.snapshot.call(document) !== state) throw new KJRevisionConflictError(options.expectedRevision, KJDocument.prototype.snapshot.call(document).revision)
  if (encoder.encode(JSON.stringify(result)).length > options.maxBytes) throw new KJDrawError('Complete native query response exceeds maxBytes; nothing was truncated', { code: 'KJNATIVE_GEOMETRY_BYTE_LIMIT' })
  return deepFreeze(result)
}
function page<Row extends KJNativeCurveRow>(inspection: Inspection, options: KJNativeCurveQueryOptions, kind: KJNativeCurveQueryPage<Row>['kind'], rows: Row[]): KJNativeCurveQueryPage<Row> {
  const scopeComplete = inspection.diagnostics.length === 0
  if (!scopeComplete && options.offset !== 0) invalid('An unsupported scope has no continuation page')
  if (scopeComplete && options.offset > rows.length) invalid('Native query offset cannot skip beyond the complete result list')
  const selected = scopeComplete ? rows.slice(options.offset, options.offset + options.limit) : []
  const nextOffset = scopeComplete && options.offset + selected.length < rows.length ? options.offset + selected.length : null
  return { kind, documentId: inspection.state.documentId, revision: inspection.state.revision, ownerId: options.ownerId, units: options.units,
    ownerPolicy: options.ownerPolicy, visibility: options.visibility, typeScope: options.typeScope,
    method: 'native-analytic-owner-xy-centerline-curves-v1', numericalPolicy: 'binary64-no-selection-tolerance',
    inspectedOwnerEntityCount: inspection.count, eligibleCurveCount: inspection.curves.length, excludedCounts: inspection.excludedCounts,
    scopeComplete, complete: scopeComplete && options.offset === 0 && nextOffset === null,
    offset: options.offset, nextOffset, totalResultCount: scopeComplete ? rows.length : null, rows: selected, diagnostics: inspection.diagnostics }
}

/** Native analytic finite LINE/CIRCLE curve bounds, not displayed glyph/stroke
 * bounds or full-drawing/XYZ extents. Every selected owner is inspected before
 * paging, so unsupported geometry outside the returned page cannot hide. */
export function queryNativeCurveBounds(document: KJDocument, options: KJNativeCurveQueryOptions): ReadonlyDeep<KJNativeCurveBoundsPage> {
  validateOptions(options, false)
  const state = capture(document, options), inspection = inspect(state, options), rows = inspection.curves.map(item => item.row)
  let bounds: KJNativeXYBounds | null = null
  if (!inspection.diagnostics.length && rows.length) bounds = {
    min: [Math.min(...rows.map(row => row.bounds.min[0])), Math.min(...rows.map(row => row.bounds.min[1]))],
    max: [Math.max(...rows.map(row => row.bounds.max[0])), Math.max(...rows.map(row => row.bounds.max[1]))],
  }
  return finish(document, options, state, { ...page(inspection, options, 'native-curve-bounds', rows), bounds })
}
function distance(anchor: XY, value: Curve): Pick<KJNativeCurveDistanceRow, 'distance' | 'closestPoint' | 'closestPointUnique'> {
  if (value.row.type === 'LINE') {
    const start = value.start!, end = value.end!, dx = end[0] - start[0], dy = end[1] - start[1]
    const scale = Math.max(Math.abs(dx), Math.abs(dy)), ax = anchor[0] - start[0], ay = anchor[1] - start[1]
    // No squared-length tolerance. Normalize before squaring so even a
    // subnormal nonzero segment is not collapsed or given a nonunit direction.
    let fraction = 0
    if (scale !== 0) {
      const sx = dx / scale, sy = dy / scale, norm = Math.hypot(sx, sy)
      fraction = ((ax / scale) * sx + (ay / scale) * sy) / (sx * sx + sy * sy)
      // Large anchor/segment ratios can overflow although native coordinates
      // are bounded. Compute the directional projection first in that case.
      if (!Number.isFinite(fraction)) fraction = (ax * (sx / norm) + ay * (sy / norm)) / scale / norm
      if (Number.isNaN(fraction)) throw new KJDrawError('Finite native segment projection is numerically unsupported', { code: 'KJNATIVE_GEOMETRY_NUMERICAL_UNSUPPORTED' })
    }
    const parameter = Math.max(0, Math.min(1, fraction))
    const closestPoint: XY = [start[0] + dx * parameter, start[1] + dy * parameter]
    return { distance: Math.hypot(anchor[0] - closestPoint[0], anchor[1] - closestPoint[1]), closestPoint, closestPointUnique: true }
  }
  const center = value.center!, radius = value.radius!, dx = anchor[0] - center[0], dy = anchor[1] - center[1]
  const scale = Math.max(Math.abs(dx), Math.abs(dy)), radial = Math.hypot(dx, dy)
  const norm = scale === 0 ? 1 : Math.hypot(dx / scale, dy / scale)
  return { distance: Math.abs(radial - radius), closestPoint: scale === 0 ? null : [center[0] + (dx / scale) / norm * radius, center[1] + (dy / scale) / norm * radius], closestPointUnique: scale !== 0 }
}

/** Exact declared binary64 owner-XY metric, no selection epsilon. Candidate
 * universe is explicit; no label is promoted into a borehole/industry fact. */
export function queryNativeCurveNeighborhood(document: KJDocument, options: KJNativeCurveNeighborhoodOptions): ReadonlyDeep<KJNativeCurveNeighborhoodPage> {
  validateOptions(options, true)
  const state = capture(document, options), anchor = Object.hasOwn(state.objects, options.anchorId) ? state.objects[options.anchorId] : undefined
  if (!anchor || anchor.erased || anchor.kind !== 'entity' || anchor.type !== 'TEXT' || anchor.ownerId !== options.ownerId) throw new KJDrawError('Anchor must be the exact live same-owner native TEXT insertion point', { code: 'KJNATIVE_GEOMETRY_ANCHOR_UNSUPPORTED' })
  orientation(anchor.payload)
  const anchorVisible = visible(state, anchor)
  if (options.visibility === 'visible-only' && !anchorVisible) throw new KJDrawError('Hidden anchor is excluded by the explicit visibility policy', { code: 'KJNATIVE_GEOMETRY_ANCHOR_HIDDEN' })
  const position = xy(own(anchor.payload, 'position'), 'TEXT native insertion point'), inspection = inspect(state, options, anchor.id)
  const rows = inspection.diagnostics.length ? [] : inspection.curves.map(item => ({ ...item.row, ...distance(position, item) }))
    .filter(row => row.distance <= options.radius)
  return finish(document, options, state, { ...page(inspection, options, 'native-curve-neighborhood', rows),
    anchor: { id: identifier(anchor.id, 'native anchor id'), handle: identifier(anchor.handle, 'native anchor handle'), ownerId: options.ownerId,
      type: 'TEXT' as const, position, visible: anchorVisible }, radius: options.radius, metric: options.metric, boundary: options.boundary })
}
