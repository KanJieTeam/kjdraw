import { KJDocument } from './document.js'
import { KJDrawError, KJRevisionConflictError, KJValidationError } from './errors.js'
import { deepFreeze } from './utils.js'
import type { ReadonlyDeep } from './utils.js'
import type { KJDocumentState, KJReadonlyObjectRecord } from './schema.js'

/** Internal native read utility, not an agent tool or whole-drawing extent API.
 * Autodesk DXF LWPOLYLINE 42 is tan(signed included angle / 4), 70 has only
 * Closed=1/Plinegen=128. The last vertex bulge is not an edge in an open curve.
 * https://help.autodesk.com/cloudhelp/2026/ENU/OARX-ManagedRefGuide/files/OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_Polyline_GetBulgeAt_int.html
 * https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm
 */
export interface KJNativePolylineQueryOptions {
  documentId: string
  expectedRevision: number
  ownerId: string
  units: string
  ownerPolicy: 'model-space-only'
  visibility: 'include-hidden' | 'visible-only'
  typeScope: 'all-owner-entities' | 'lwpolyline-centerline-only'
  unsupportedPolicy: 'reject' | 'diagnostics'
  closedPolicy: 'native-closed-flag'
  widthPolicy: 'centerline-only'
  offset: number
  limit: number
  /** Entire live model owner, including hidden and type-excluded entities. */
  maxEntities: number
  /** Total edges of the declared visible/type-eligible polyline scope. */
  maxEdges: number
  maxBytes: number
}
export interface KJNativePolylineNeighborhoodOptions extends KJNativePolylineQueryOptions {
  anchorId: string
  radius: number
  metric: 'text-insertion-to-finite-native-xy-polyline'
  boundary: 'inclusive'
}
export interface KJNativePolylineXYBounds { min: readonly [number, number]; max: readonly [number, number] }
export interface KJNativePolylineDiagnostic { id: string; handle: string; type: string; reason: string }
export interface KJNativePolylineRow {
  id: string
  handle: string
  ownerId: string
  layerId: string
  type: 'LWPOLYLINE'
  visible: boolean
  closed: boolean
  vertexCount: number
  edgeCount: number
  arcEdgeCount: number
  openTerminalBulgeIgnored: boolean
  widthPolicy: 'centerline-only'
  bounds: KJNativePolylineXYBounds
}
export interface KJNativePolylineDistanceRow extends KJNativePolylineRow {
  distance: number
  /** Null when different closest native points, or an entire arc, tie. */
  closestPoint: readonly [number, number] | null
  closestPointUnique: boolean
  closestEdgeIndices: readonly number[]
}
export interface KJNativePolylineQueryPage<Row extends KJNativePolylineRow> {
  kind: 'native-polyline-bounds' | 'native-polyline-neighborhood'
  documentId: string
  revision: number
  ownerId: string
  units: string
  ownerPolicy: 'model-space-only'
  visibility: KJNativePolylineQueryOptions['visibility']
  typeScope: KJNativePolylineQueryOptions['typeScope']
  closedPolicy: 'native-closed-flag'
  widthPolicy: 'centerline-only'
  method: 'native-analytic-owner-xy-polyline-centerline-v1'
  numericalPolicy: 'binary64-analytic-no-selection-tolerance'
  inspectedOwnerEntityCount: number
  inspectedPolylineEdgeCount: number
  eligiblePolylineCount: number
  excludedCounts: { hidden: number; otherTypes: number; anchor: number }
  scopeComplete: boolean
  /** Complete only for an offset-zero response containing all scope rows. */
  complete: boolean
  offset: number
  nextOffset: number | null
  totalResultCount: number | null
  rows: readonly Row[]
  diagnostics: readonly KJNativePolylineDiagnostic[]
}
export interface KJNativePolylineBoundsPage extends KJNativePolylineQueryPage<KJNativePolylineRow> {
  /** Full declared centerline scope only; excludes stroke, glyphs and 3D. */
  bounds: KJNativePolylineXYBounds | null
}
export interface KJNativePolylineNeighborhoodPage extends KJNativePolylineQueryPage<KJNativePolylineDistanceRow> {
  anchor: { id: string; handle: string; ownerId: string; type: 'TEXT'; position: readonly [number, number]; visible: boolean }
  radius: number
  metric: 'text-insertion-to-finite-native-xy-polyline'
  boundary: 'inclusive'
}

type XY = [number, number]
type State = ReadonlyDeep<KJDocumentState>
interface Vertex { point: XY; bulge: number }
interface VertexDeclaration { source: unknown[]; closed: boolean; edgeCount: number }
interface LineEdge { kind: 'line'; start: XY; end: XY }
interface ArcEdge { kind: 'arc'; start: XY; end: XY; midpoint: XY; leftUnit: XY; offset: number; halfChord: number;
  center: XY; radius: number; startUnit: XY; endUnit: XY; sign: number; sweep: number }
type Edge = LineEdge | ArcEdge
interface Polyline { row: KJNativePolylineRow; edges: Edge[] }
interface Inspection { state: State; polylines: Polyline[]; diagnostics: KJNativePolylineDiagnostic[];
  count: number; edgeCount: number; excludedCounts: { hidden: number; otherTypes: number; anchor: number } }
interface Nearest { distance: number; closestPoint: XY | null; closestPointUnique: boolean }
const MAX_COORDINATE = 1e12, MAX_ENTITIES = 4096, MAX_EDGES = 4096, MAX_BYTES = 262144, TAU = Math.PI * 2
const encoder = new TextEncoder()
const commonKeys = ['documentId', 'expectedRevision', 'ownerId', 'units', 'ownerPolicy', 'visibility', 'typeScope',
  'unsupportedPolicy', 'closedPolicy', 'widthPolicy', 'offset', 'limit', 'maxEntities', 'maxEdges', 'maxBytes']

function invalid(message: string): never { throw new KJValidationError(message) }
function unsupported(message: string, code: string): never { throw new KJDrawError(message, { code }) }
function numerical(message: string): never { return unsupported(message, 'KJNATIVE_POLYLINE_NUMERICAL_UNSUPPORTED') }
function own(value: unknown, key: string, required = true): unknown {
  if (!value || typeof value !== 'object') invalid('Native polyline data must be an object')
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor) { if (required || key in value) invalid(`Native polyline requires own data field ${key}`); return undefined }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(`Native polyline ${key} must be enumerable data`)
  return descriptor.value
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) invalid(`${label} must be bounded nonempty data`)
  return value
}
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(`${label} must be an integer from ${minimum} to ${maximum}`)
  return value
}
function finite(value: unknown, label: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE || positive && value <= 0) invalid(`${label} must be finite numeric native data within ${MAX_COORDINATE}`)
  return value
}
function tuple(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 3 || Reflect.ownKeys(value).length !== 4) invalid(`${label} must be a plain native XYZ tuple`)
  return [0, 1, 2].map(axis => finite(own(value, String(axis)), label))
}
function xy(value: unknown, label: string): XY { const p = tuple(value, label); return [p[0]!, p[1]!] }
function orientation(payload: unknown): void {
  for (const key of ['normal', 'extrusionDirection']) {
    const value = own(payload, key, false)
    if (value !== undefined) {
      const p = tuple(value, key)
      if (p[0] !== 0 || p[1] !== 0 || p[2] !== 1) unsupported('Nondefault OCS orientation is outside native XY polyline scope', 'KJNATIVE_POLYLINE_UNSUPPORTED_ORIENTATION')
    }
  }
  const thickness = own(payload, 'thickness', false)
  if (thickness !== undefined && finite(thickness, 'thickness') !== 0) unsupported('Extruded thickness is not a native XY centerline', 'KJNATIVE_POLYLINE_UNSUPPORTED_THICKNESS')
}
function validateOptions(value: unknown, neighborhood: boolean): asserts value is KJNativePolylineQueryOptions & Partial<KJNativePolylineNeighborhoodOptions> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Native polyline options must be plain own data')
  const keys = [...commonKeys, ...(neighborhood ? ['anchorId', 'radius', 'metric', 'boundary'] : [])]
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) invalid('Unknown native polyline option')
  keys.forEach(key => own(value, key))
  for (const key of ['documentId', 'ownerId', 'units']) identifier(own(value, key), key)
  integer(own(value, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'expectedRevision')
  integer(own(value, 'offset'), 0, MAX_ENTITIES, 'offset'); integer(own(value, 'limit'), 1, 200, 'limit')
  integer(own(value, 'maxEntities'), 1, MAX_ENTITIES, 'maxEntities'); integer(own(value, 'maxEdges'), 1, MAX_EDGES, 'maxEdges')
  integer(own(value, 'maxBytes'), 1024, MAX_BYTES, 'maxBytes')
  if (own(value, 'ownerPolicy') !== 'model-space-only') invalid('Explicit ownerPolicy must be model-space-only')
  if (!['include-hidden', 'visible-only'].includes(own(value, 'visibility') as string)) invalid('Explicit visibility policy is required')
  if (!['all-owner-entities', 'lwpolyline-centerline-only'].includes(own(value, 'typeScope') as string)) invalid('Explicit polyline type scope is required')
  if (!['reject', 'diagnostics'].includes(own(value, 'unsupportedPolicy') as string)) invalid('Explicit unsupported policy is required')
  if (own(value, 'closedPolicy') !== 'native-closed-flag' || own(value, 'widthPolicy') !== 'centerline-only') invalid('Explicit native closure and centerline width policies are required')
  if (neighborhood) {
    identifier(own(value, 'anchorId'), 'anchorId'); finite(own(value, 'radius'), 'radius', true)
    if (own(value, 'metric') !== 'text-insertion-to-finite-native-xy-polyline' || own(value, 'boundary') !== 'inclusive') invalid('Explicit finite polyline XY metric and inclusive boundary are required')
  }
}
function capture(document: KJDocument, options: KJNativePolylineQueryOptions): State {
  if (!(document instanceof KJDocument)) invalid('Native polyline query requires an actual KJDocument')
  const state = KJDocument.prototype.snapshot.call(document)
  if (state.documentId !== options.documentId) unsupported('Native document identity mismatch', 'KJNATIVE_POLYLINE_DOCUMENT_MISMATCH')
  if (state.revision !== options.expectedRevision) throw new KJRevisionConflictError(options.expectedRevision, state.revision)
  if (state.header.units !== options.units) unsupported('Units must match native model units exactly', 'KJNATIVE_POLYLINE_UNITS_MISMATCH')
  const owner = Object.hasOwn(state.objects, options.ownerId) ? state.objects[options.ownerId] : undefined
  if (!owner || owner.erased || owner.kind !== 'block-record' || owner.type !== 'BLOCK_RECORD' ||
    options.ownerId !== state.spaces.modelSpaceId || !state.tables.blockRecords.recordIds.includes(options.ownerId))
    unsupported('Only the selected live native model owner is supported; no paper/block expansion', 'KJNATIVE_POLYLINE_OWNER_UNSUPPORTED')
  return state
}
function visible(state: State, entity: KJReadonlyObjectRecord): boolean {
  const layerId = identifier(own(entity.payload, 'layerId'), 'native layerId'), layer = Object.hasOwn(state.objects, layerId) ? state.objects[layerId] : undefined
  if (!layer || layer.erased || layer.kind !== 'table-record' || layer.type !== 'LAYER' || !state.tables.layers.recordIds.includes(layerId)) invalid('Exact native live registered layer is required')
  const flags = [own(entity.payload, 'visible', false), own(layer.payload, 'visible', false), own(layer.payload, 'frozen', false)]
  for (const flag of flags) if (flag !== undefined && typeof flag !== 'boolean') invalid('Native visibility flags must be booleans')
  return flags[0] !== false && flags[1] !== false && flags[2] !== true
}
function flags(payload: unknown, closed: boolean): void {
  for (const key of ['dxfFlags', 'flags']) {
    const raw = own(payload, key, false)
    if (raw === undefined) continue
    const value = integer(raw, 0, 65535, key)
    if ((value & ~129) !== 0 || Boolean(value & 1) !== closed) unsupported('Unsupported or conflicting native LWPOLYLINE flags', 'KJNATIVE_POLYLINE_UNSUPPORTED_FLAGS')
  }
}
function declaredVertices(payload: unknown, remainingEdges: number): VertexDeclaration {
  const closed = own(payload, 'closed')
  if (typeof closed !== 'boolean') invalid('Native closed flag must be boolean')
  const source = own(payload, 'vertices')
  if (!Array.isArray(source) || Object.getPrototypeOf(source) !== Array.prototype || source.length < 2) invalid('Native LWPOLYLINE needs at least two plain vertices')
  const edgeCount = source.length - 1 + Number(closed)
  if (edgeCount > remainingEdges) unsupported('Whole declared polyline edge work exceeds maxEdges', 'KJNATIVE_POLYLINE_EDGE_LIMIT')
  return { source, closed, edgeCount }
}
function vertices(payload: unknown, declaration: VertexDeclaration): Vertex[] {
  const { source, closed } = declaration
  flags(payload, closed)
  const elevation = own(payload, 'elevation', false)
  if (elevation !== undefined) finite(elevation, 'elevation')
  for (const key of ['constantWidth', 'width']) {
    const width = own(payload, key, false)
    if (width !== undefined && finite(width, key) < 0) invalid('Native width cannot be negative')
  }
  if (Reflect.ownKeys(source).length !== source.length + 1) invalid('Native vertices cannot be sparse or contain extra fields')
  const values = Array.from({ length: source.length }, (_, index): Vertex => {
    const value = own(source, String(index))
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Native vertices must be normalized own-data objects')
    const point = xy(own(value, 'point'), 'native vertex point'), rawBulge = own(value, 'bulge', false)
    const bulge = rawBulge === undefined ? 0 : finite(rawBulge, 'native vertex bulge')
    for (const key of ['startWidth', 'endWidth']) {
      const width = own(value, key, false)
      if (width !== undefined && finite(width, key) < 0) invalid('Native vertex width cannot be negative')
    }
    for (const key of ['dxfFlags', 'flags']) {
      const flag = own(value, key, false)
      if (flag !== undefined && integer(flag, 0, 65535, key) !== 0) unsupported('Flagged legacy vertices are outside LWPOLYLINE scope', 'KJNATIVE_POLYLINE_UNSUPPORTED_FLAGS')
    }
    return { point, bulge }
  })
  return values
}
function unit(dx: number, dy: number): XY {
  const scale = Math.max(Math.abs(dx), Math.abs(dy))
  if (!Number.isFinite(scale) || scale === 0) numerical('Native arc radial direction cannot be represented')
  const sx = dx / scale, sy = dy / scale, norm = Math.hypot(sx, sy)
  return [sx / norm, sy / norm]
}
function samePoint(a: XY, b: XY): boolean { return a[0] === b[0] && a[1] === b[1] }
function directedAngle(start: XY, target: XY, sign: number): number {
  let angle = Math.atan2(start[0] * target[1] - start[1] * target[0], start[0] * target[0] + start[1] * target[1]) * sign
  if (angle < 0) angle += TAU
  return angle === 0 ? 0 : angle
}
function binary64Spacing(value: number): number {
  // Representational spacing, not a geometry/selection tolerance. Subnormal
  // values have the fixed smallest-double spacing.
  return value === 0 ? Number.MIN_VALUE : Math.max(Number.MIN_VALUE, 2 ** (Math.floor(Math.log2(Math.abs(value))) - 52))
}
function edge(start: Vertex, end: Vertex): Edge {
  if (start.bulge === 0) return { kind: 'line', start: start.point, end: end.point }
  const dx = end.point[0] - start.point[0], dy = end.point[1] - start.point[1], chord = Math.hypot(dx, dy), b = start.bulge
  if (chord === 0) numerical('A nonzero bulge with coincident endpoints does not define a finite circle')
  const offset = chord * ((1 / b - b) / 4), radius = chord * ((Math.abs(b) + 1 / Math.abs(b)) / 4)
  const chordUnit = unit(dx, dy), leftUnit: XY = [-chordUnit[1], chordUnit[0]], halfChord = chord / 2
  const midpoint: XY = [start.point[0] + dx / 2, start.point[1] + dy / 2]
  const center: XY = [midpoint[0] + leftUnit[0] * offset, midpoint[1] + leftUnit[1] * offset]
  const sweep = Math.abs(4 * Math.atan(b)), sign = b > 0 ? 1 : -1
  if (!Number.isFinite(offset) || !Number.isFinite(radius) || radius <= 0 || radius > MAX_COORDINATE ||
    center.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) || !Number.isFinite(sweep) || sweep <= 0 || sweep >= TAU)
    numerical('Derived native bulge circle/sweep is outside finite bounded binary64 support; it was not replaced by a line')
  // Cancellation in radius-|offset| can erase or severely quantize the real
  // nonzero sagitta. The exact bulge identity for that difference is
  // chord/2 * min(|b|, 1/|b|). This implementation refuses circles whose
  // difference has fewer than eight representable gaps in the derived data.
  // It never applies a selection epsilon or substitutes a straight edge.
  const sagittaDifference = chord * (Math.min(Math.abs(b), 1 / Math.abs(b)) / 2)
  if (radius === Math.abs(offset) || sagittaDifference <= 8 * Math.max(binary64Spacing(radius), binary64Spacing(offset)))
    numerical('Native bulge radius/offset difference is not sufficiently representable; no straight-edge approximation was returned')
  const startUnit = unit(start.point[0] - center[0], start.point[1] - center[1]), endUnit = unit(end.point[0] - center[0], end.point[1] - center[1])
  if (samePoint(startUnit, endUnit) || directedAngle(startUnit, endUnit, sign) === 0)
    numerical('Nonzero native bulge endpoint directions collapsed numerically; no approximation was returned')
  return { kind: 'arc', start: start.point, end: end.point, midpoint, leftUnit, offset, halfChord, center, radius, startUnit, endUnit, sign, sweep }
}
function cardinalPoint(value: ArcEdge, direction: XY): XY {
  const point: XY = [...value.center]
  const axis = direction[0] === 0 ? 1 : 0, other = axis === 0 ? 1 : 0, sign = direction[axis]!
  const component = value.leftUnit[axis]! * value.offset
  if (component !== 0 && Math.sign(component) !== sign) {
    // R^2 - component^2 = halfChord^2 + otherOffsetComponent^2.
    // Rationalizing avoids erasing the small, genuine extremum of a thin arc.
    const numeratorRoot = Math.hypot(value.halfChord, value.leftUnit[other]! * value.offset)
    const difference = numeratorRoot * (numeratorRoot / (value.radius + Math.abs(component)))
    point[axis] = value.midpoint[axis]! + sign * difference
  } else point[axis] = value.center[axis]! + sign * value.radius
  return point
}
function edgeBounds(value: Edge): KJNativePolylineXYBounds {
  const points = [value.start, value.end]
  if (value.kind === 'arc') for (const direction of [[1, 0], [0, 1], [-1, 0], [0, -1]] as XY[]) {
    if (directedAngle(value.startUnit, direction, value.sign) <= value.sweep) {
      const point = cardinalPoint(value, direction)
      if (point.some(coordinate => !Number.isFinite(coordinate))) numerical('Native analytic arc extremum overflowed')
      points.push(point)
    }
  }
  return { min: [Math.min(...points.map(point => point[0])), Math.min(...points.map(point => point[1]))],
    max: [Math.max(...points.map(point => point[0])), Math.max(...points.map(point => point[1]))] }
}
function mergedBounds(bounds: readonly KJNativePolylineXYBounds[]): KJNativePolylineXYBounds {
  return { min: [Math.min(...bounds.map(value => value.min[0])), Math.min(...bounds.map(value => value.min[1]))],
    max: [Math.max(...bounds.map(value => value.max[0])), Math.max(...bounds.map(value => value.max[1]))] }
}
function polyline(entity: KJReadonlyObjectRecord, isVisible: boolean, declaration: VertexDeclaration): Polyline {
  orientation(entity.payload)
  const values = vertices(entity.payload, declaration), closed = declaration.closed, edges: Edge[] = []
  for (let index = 0; index < values.length - 1; index++) edges.push(edge(values[index]!, values[index + 1]!))
  if (closed) edges.push(edge(values.at(-1)!, values[0]!))
  return { row: { id: identifier(entity.id, 'native id'), handle: identifier(entity.handle, 'native handle'),
    ownerId: identifier(entity.ownerId, 'native owner'), layerId: identifier(own(entity.payload, 'layerId'), 'native layerId'),
    type: 'LWPOLYLINE', visible: isVisible, closed, vertexCount: values.length, edgeCount: edges.length,
    arcEdgeCount: edges.filter(value => value.kind === 'arc').length,
    openTerminalBulgeIgnored: !closed && values.at(-1)!.bulge !== 0, widthPolicy: 'centerline-only',
    bounds: mergedBounds(edges.map(edgeBounds)) }, edges }
}
function diagnostic(entity: KJReadonlyObjectRecord, reason: string): KJNativePolylineDiagnostic {
  return { id: identifier(entity.id, 'native id'), handle: identifier(entity.handle, 'native handle'), type: identifier(entity.type, 'native type'), reason }
}
function inspect(state: State, options: KJNativePolylineQueryOptions, anchorId?: string): Inspection {
  const inspection: Inspection = { state, polylines: [], diagnostics: [], count: 0, edgeCount: 0, excludedCounts: { hidden: 0, otherTypes: 0, anchor: 0 } }
  for (const id in state.objects) {
    if (!Object.hasOwn(state.objects, id)) continue
    const entity = state.objects[id]!
    if (entity.kind === 'entity' && !entity.erased && entity.ownerId === options.ownerId && ++inspection.count > options.maxEntities)
      unsupported('Entire live owner exceeds maxEntities; no partial answer', 'KJNATIVE_POLYLINE_ENTITY_LIMIT')
  }
  for (const id in state.objects) {
    if (!Object.hasOwn(state.objects, id)) continue
    const entity = state.objects[id]!
    if (entity.kind !== 'entity' || entity.erased || entity.ownerId !== options.ownerId) continue
    try {
      const isVisible = visible(state, entity)
      if (options.visibility === 'visible-only' && !isVisible) { inspection.excludedCounts.hidden++; continue }
      if (entity.id === anchorId) { inspection.excludedCounts.anchor++; continue }
      if (entity.type !== 'LWPOLYLINE') {
        if (options.typeScope === 'lwpolyline-centerline-only') inspection.excludedCounts.otherTypes++
        else inspection.diagnostics.push(diagnostic(entity, 'unsupported-native-entity-type'))
        continue
      }
      const declaration = declaredVertices(entity.payload, options.maxEdges - inspection.edgeCount)
      // Debit declared work before flags, coordinates or arc parsing. Even a
      // malformed/numerically unsupported later edge has consumed that work;
      // diagnostics must not let the next object reuse the same edge budget.
      inspection.edgeCount += declaration.edgeCount
      inspection.polylines.push(polyline(entity, isVisible, declaration))
    } catch (error) {
      if (error instanceof KJDrawError && error.code === 'KJNATIVE_POLYLINE_EDGE_LIMIT') throw error
      inspection.diagnostics.push(diagnostic(entity, error instanceof KJDrawError ? error.code : 'invalid-native-polyline'))
    }
  }
  if (inspection.diagnostics.length && options.unsupportedPolicy === 'reject') {
    const details = { diagnostics: inspection.diagnostics }
    if (encoder.encode(JSON.stringify(details)).length > options.maxBytes) unsupported('Native diagnostics exceed maxBytes', 'KJNATIVE_POLYLINE_BYTE_LIMIT')
    throw new KJDrawError('Declared native scope contains unsupported geometry; no partial answer', { code: 'KJNATIVE_POLYLINE_SCOPE_UNSUPPORTED', details })
  }
  return inspection
}
function finish<T>(document: KJDocument, options: KJNativePolylineQueryOptions, state: State, result: T): ReadonlyDeep<T> {
  const current = KJDocument.prototype.snapshot.call(document)
  if (current !== state) throw new KJRevisionConflictError(options.expectedRevision, current.revision)
  if (encoder.encode(JSON.stringify(result)).length > options.maxBytes) unsupported('Entire native response exceeds maxBytes; no truncation', 'KJNATIVE_POLYLINE_BYTE_LIMIT')
  return deepFreeze(result)
}
function page<Row extends KJNativePolylineRow>(inspection: Inspection, options: KJNativePolylineQueryOptions,
  kind: KJNativePolylineQueryPage<Row>['kind'], rows: Row[]): KJNativePolylineQueryPage<Row> {
  const scopeComplete = inspection.diagnostics.length === 0
  if (!scopeComplete && options.offset !== 0) invalid('Unsupported scope has no continuation')
  if (scopeComplete && options.offset > rows.length) invalid('Offset cannot skip beyond the complete result')
  const selected = scopeComplete ? rows.slice(options.offset, options.offset + options.limit) : []
  const nextOffset = scopeComplete && options.offset + selected.length < rows.length ? options.offset + selected.length : null
  return { kind, documentId: inspection.state.documentId, revision: inspection.state.revision, ownerId: options.ownerId, units: options.units,
    ownerPolicy: options.ownerPolicy, visibility: options.visibility, typeScope: options.typeScope, closedPolicy: options.closedPolicy,
    widthPolicy: options.widthPolicy, method: 'native-analytic-owner-xy-polyline-centerline-v1', numericalPolicy: 'binary64-analytic-no-selection-tolerance',
    inspectedOwnerEntityCount: inspection.count, inspectedPolylineEdgeCount: inspection.edgeCount, eligiblePolylineCount: inspection.polylines.length,
    excludedCounts: inspection.excludedCounts, scopeComplete, complete: scopeComplete && options.offset === 0 && nextOffset === null,
    offset: options.offset, nextOffset, totalResultCount: scopeComplete ? rows.length : null, rows: selected, diagnostics: inspection.diagnostics }
}

/** Analytic LINE/bulge-ARC edges of genuine LWPOLYLINE records. Native XY
 * centerlines only: no geometry tessellation, stroke/glyph extents or industry facts. */
export function queryNativePolylineBounds(document: KJDocument, options: KJNativePolylineQueryOptions): ReadonlyDeep<KJNativePolylineBoundsPage> {
  validateOptions(options, false)
  const state = capture(document, options), inspection = inspect(state, options), rows = inspection.polylines.map(value => value.row)
  const bounds = !inspection.diagnostics.length && rows.length ? mergedBounds(rows.map(row => row.bounds)) : null
  return finish(document, options, state, { ...page(inspection, options, 'native-polyline-bounds', rows), bounds })
}
function pointDistance(anchor: XY, point: XY): Nearest {
  return { distance: Math.hypot(anchor[0] - point[0], anchor[1] - point[1]), closestPoint: point, closestPointUnique: true }
}
function lineDistance(anchor: XY, value: LineEdge): Nearest {
  const dx = value.end[0] - value.start[0], dy = value.end[1] - value.start[1], scale = Math.max(Math.abs(dx), Math.abs(dy))
  const ax = anchor[0] - value.start[0], ay = anchor[1] - value.start[1]
  let fraction = 0
  if (scale !== 0) {
    const sx = dx / scale, sy = dy / scale, norm = Math.hypot(sx, sy)
    fraction = ((ax / scale) * sx + (ay / scale) * sy) / (sx * sx + sy * sy)
    if (!Number.isFinite(fraction)) fraction = (ax * (sx / norm) + ay * (sy / norm)) / scale / norm
    if (Number.isNaN(fraction)) numerical('Finite native segment projection is numerically unsupported')
  }
  const parameter = Math.max(0, Math.min(1, fraction)), point: XY = [value.start[0] + dx * parameter, value.start[1] + dy * parameter]
  return pointDistance(anchor, point)
}
function best(values: Nearest[]): Nearest {
  const distance = Math.min(...values.map(value => value.distance)), closest = values.filter(value => value.distance === distance)
  if (!Number.isFinite(distance)) numerical('Native nearest distance overflowed')
  const point = closest[0]!.closestPoint
  const unique = point !== null && closest.every(value => value.closestPointUnique && value.closestPoint !== null && samePoint(value.closestPoint, point))
  return { distance, closestPoint: unique ? point : null, closestPointUnique: unique }
}
function arcDistance(anchor: XY, value: ArcEdge): Nearest {
  const dx = anchor[0] - value.center[0], dy = anchor[1] - value.center[1]
  if (dx === 0 && dy === 0) return { distance: value.radius, closestPoint: null, closestPointUnique: false }
  const direction = unit(dx, dy), radial = Math.hypot(dx, dy), candidates = [pointDistance(anchor, value.start), pointDistance(anchor, value.end)]
  const aligned = (target: XY): boolean => direction[0] * target[1] - direction[1] * target[0] === 0 && direction[0] * target[0] + direction[1] * target[1] > 0
  if (aligned(value.startUnit)) candidates.push(pointDistance(anchor, value.start))
  else if (aligned(value.endUnit)) candidates.push(pointDistance(anchor, value.end))
  else if (directedAngle(value.startUnit, direction, value.sign) <= value.sweep) {
    if ((direction[0] === 0 && Math.abs(direction[1]) === 1) || (direction[1] === 0 && Math.abs(direction[0]) === 1)) {
      candidates.push(pointDistance(anchor, cardinalPoint(value, direction)))
      return best(candidates)
    }
    // Compute D-R from the chord-local circle equation. The common offset^2
    // cancels symbolically before arithmetic, not after subtracting two large
    // radii. Normalize first so very small nonzero circles do not square to 0.
    const ax = anchor[0] - value.midpoint[0], ay = anchor[1] - value.midpoint[1]
    const scale = Math.max(Math.abs(ax), Math.abs(ay), Math.abs(value.offset), value.halfChord)
    const sx = ax / scale, sy = ay / scale, so = value.offset / scale, sh = value.halfChord / scale
    const equation = sx * sx + sy * sy - sh * sh - 2 * so * (value.leftUnit[0] * sx + value.leftUnit[1] * sy)
    const signedDistance = scale * (equation * (scale / (radial + value.radius)))
    if (!Number.isFinite(signedDistance)) numerical('Native chord-local arc distance overflowed')
    const point: XY = [0, 0]
    for (const axis of [0, 1] as const) {
      const radialTerm = direction[axis] * value.radius, correction = direction[axis] * signedDistance
      point[axis] = Math.max(Math.abs(value.center[axis]), Math.abs(radialTerm)) <= Math.max(Math.abs(anchor[axis]), Math.abs(correction))
        ? value.center[axis] + radialTerm : anchor[axis] - correction
    }
    if (point.some(coordinate => !Number.isFinite(coordinate))) numerical('Native arc closest point overflowed')
    candidates.push({ distance: Math.abs(signedDistance), closestPoint: point, closestPointUnique: true })
  }
  return best(candidates)
}
function polylineDistance(anchor: XY, value: Polyline): Pick<KJNativePolylineDistanceRow, 'distance' | 'closestPoint' | 'closestPointUnique' | 'closestEdgeIndices'> {
  const values = value.edges.map(item => item.kind === 'line' ? lineDistance(anchor, item) : arcDistance(anchor, item)), nearest = best(values)
  return { ...nearest, closestEdgeIndices: values.flatMap((item, index) => item.distance === nearest.distance ? [index] : []) }
}

/** Actual same-owner TEXT insertion point to the complete finite polyline
 * centerline. A closed outline is not treated as a filled region or hole fact. */
export function queryNativePolylineNeighborhood(document: KJDocument, options: KJNativePolylineNeighborhoodOptions): ReadonlyDeep<KJNativePolylineNeighborhoodPage> {
  validateOptions(options, true)
  const state = capture(document, options), anchor = Object.hasOwn(state.objects, options.anchorId) ? state.objects[options.anchorId] : undefined
  if (!anchor || anchor.erased || anchor.kind !== 'entity' || anchor.type !== 'TEXT' || anchor.ownerId !== options.ownerId)
    unsupported('Anchor must be exact live same-owner native TEXT insertion point', 'KJNATIVE_POLYLINE_ANCHOR_UNSUPPORTED')
  orientation(anchor.payload)
  const anchorVisible = visible(state, anchor)
  if (options.visibility === 'visible-only' && !anchorVisible) unsupported('Explicit visibility policy excludes hidden TEXT anchor', 'KJNATIVE_POLYLINE_ANCHOR_HIDDEN')
  const position = xy(own(anchor.payload, 'position'), 'native TEXT insertion'), inspection = inspect(state, options, anchor.id)
  const rows = inspection.diagnostics.length ? [] : inspection.polylines.map(value => ({ ...value.row, ...polylineDistance(position, value) })).filter(row => row.distance <= options.radius)
  return finish(document, options, state, { ...page(inspection, options, 'native-polyline-neighborhood', rows),
    anchor: { id: identifier(anchor.id, 'native anchor id'), handle: identifier(anchor.handle, 'native anchor handle'), ownerId: options.ownerId,
      type: 'TEXT' as const, position, visible: anchorVisible }, radius: options.radius, metric: options.metric, boundary: options.boundary })
}
