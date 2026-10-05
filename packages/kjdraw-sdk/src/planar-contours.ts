import { KJRevisionConflictError, KJValidationError } from './errors.js'
import { createCommandEditScope } from './edit-policy.js'
import { clone, deepFreeze, stableHash } from './utils.js'
import { KJ_CONTOUR_WASM_ABI, runContourWasm, type KJContourBackendOptions } from './geometry/contour-wasm.js'
import type { KJDocument } from './document.js'
import type { KJCommandEnvelopeContext } from './commands.js'
import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js'

export type { KJContourBackendOptions } from './geometry/contour-wasm.js'
export type KJPlanarContourOperation = 'offset' | 'union' | 'intersection' | 'difference'

export interface KJPlanarContourVertex {
  readonly point: readonly [number, number, number]
  /** Native DXF bulge. Major arcs are split into native arcs by the kernel. */
  readonly bulge?: number
}

export interface KJPlanarContour {
  readonly closed: true
  readonly vertices: readonly KJPlanarContourVertex[]
}

export interface KJPlanarContourRequest {
  readonly operation: KJPlanarContourOperation
  /** Offset: CCW exterior rings and CW holes. Boolean: exactly two simple regions. */
  readonly contours: readonly KJPlanarContour[]
  /** Signed drawing-unit distance. Positive expands the filled region; negative erodes it. */
  readonly distance?: number
  /** Absolute drawing-unit tolerance; defaults to 1e-7. */
  readonly tolerance?: number
}

export interface KJPlanarContourResult extends KJPlanarContour {
  readonly area: number
  readonly hole: boolean
}

export interface KJPlanarContourReceipt {
  readonly schema: 'kjdraw.planar-contours.v1'
  readonly backend: 'cavalier-contours-wasm'
  readonly abi: string
  readonly operation: KJPlanarContourOperation
  /** Total caller-requested absolute boundary tolerance, including source conversion. */
  readonly tolerance: number
  /** Conservative boundary error from converting source CIRCLE entities to native arcs. */
  readonly sourceBoundaryError: number
  /** Remaining absolute tolerance passed to the native kernel. */
  readonly backendTolerance: number
  /** Stable change-detection hashes, not signatures or publisher authentication. */
  readonly inputDigest: string
  readonly geometryDigest: string
  readonly resultCount: number
}

export interface KJPlanarContourGeometry {
  readonly contours: readonly KJPlanarContourResult[]
  readonly area: number
  readonly receipt: KJPlanarContourReceipt
}

export interface KJPlanarContourEditRequest {
  readonly operation: KJPlanarContourOperation
  readonly ids: readonly string[]
  readonly units: string
  readonly expectedRevision: number
  readonly distance?: number
  readonly tolerance?: number
  /** Bind a commit to a previously reviewed geometry receipt. */
  readonly expectedGeometryDigest?: string
}

export interface KJPlanarContourPreview extends KJPlanarContourGeometry {
  readonly sourceIds: readonly string[]
  readonly sourceDigest: string
  readonly units: string
  readonly revisionBefore: number
}

export interface KJPlanarContourEditResult extends KJPlanarContourPreview {
  readonly resultIds: readonly string[]
  readonly revisionAfter: number
}

export interface KJPlanarContourApplyOptions extends KJContourBackendOptions {
  readonly author?: unknown
  /** Host-supplied provenance only; it cannot replace the operation or geometry receipt. */
  readonly commandEnvelope?: KJCommandEnvelopeContext | null
}

const OPERATIONS = ['offset', 'union', 'intersection', 'difference'] as const
const MAX_CONTOURS = 64
const MAX_VERTICES = 4096
const MAX_RESULT_CONTOURS = 256
const MAX_RESULT_VERTICES = 32768
const MAX_COORDINATE = 1e9
const STYLE_KEYS = ['layerId', 'color', 'trueColor', 'linetypeId', 'linetypeName', 'linetypeScale', 'lineweight', 'transparency', 'visible'] as const

function plainData(value: unknown): void {
  let nodes = 0
  const visit = (entry: unknown, depth: number): void => {
    if (++nodes > 100000 || depth > 12) throw new KJValidationError('Contour input exceeds the data traversal budget')
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry))) return
    if (!entry || typeof entry !== 'object') throw new KJValidationError('Contours require finite JSON data')
    const array = Array.isArray(entry)
    if (array ? Object.getPrototypeOf(entry) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(entry))) throw new KJValidationError('Contours require plain objects and arrays')
    for (const key of Reflect.ownKeys(entry)) {
      if (array && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(entry, key)!
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !('value' in descriptor) || !descriptor.enumerable) throw new KJValidationError('Contours reject accessors, symbols and hidden fields')
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= (entry as unknown[]).length)) throw new KJValidationError('Contour arrays reject custom properties')
      visit(descriptor.value, depth + 1)
    }
    if (array) for (let index = 0; index < (entry as unknown[]).length; index++) if (!Object.hasOwn(entry, index)) throw new KJValidationError('Contour arrays must be dense')
  }
  visit(value, 0)
}

function keys(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new KJValidationError(`${label} contains unsupported fields or is not an object`)
}

function finite(value: unknown, label: string, bound = MAX_COORDINATE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > bound) throw new KJValidationError(`${label} must be finite and within +/-${bound}`)
  return Object.is(value, -0) ? 0 : value
}

function operation(value: unknown): KJPlanarContourOperation {
  if (!OPERATIONS.includes(value as KJPlanarContourOperation)) throw new KJValidationError('Contour operation must be offset, union, intersection or difference')
  return value as KJPlanarContourOperation
}

function tolerance(value: unknown): number {
  const result = value === undefined ? 1e-7 : finite(value, 'Contour tolerance', 1e-2)
  if (result < 1e-9) throw new KJValidationError('Contour tolerance must be between 1e-9 and 1e-2 drawing units')
  return result
}

// Round a positive budget outwards/inwards by one binary64 step. This prevents
// subtraction rounding from granting more total tolerance than the caller gave.
function adjacentPositive(value: number, upwards: boolean): number {
  if (value === 0) return upwards ? Number.MIN_VALUE : 0
  const bytes = new DataView(new ArrayBuffer(8))
  bytes.setFloat64(0, value)
  bytes.setBigUint64(0, bytes.getBigUint64(0) + (upwards ? 1n : -1n))
  return bytes.getFloat64(0)
}

// Knuth TwoSum: the residual recovers the exact rounding error of a + b.
// Subtracting the source center from the rounded endpoint can lose this error
// again when a small center is combined with a much larger radius.
function additionResidual(a: number, b: number, sum: number): number {
  const roundedB = sum - a, roundedA = sum - roundedB
  return (a - roundedA) + (b - roundedB)
}

function normalizeVertices(value: unknown, maximum = MAX_VERTICES): KJPlanarContourVertex[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > maximum) throw new KJValidationError(`A contour requires between 2 and ${maximum} vertices`)
  return value.map((entry, index) => {
    keys(entry, ['point', 'bulge'], `Contour vertex ${index}`)
    const point = entry.point
    if (!Array.isArray(point) || point.length !== 3 || point[2] !== 0) throw new KJValidationError('Contours require XY points [x, y, 0]')
    const bulge = entry.bulge === undefined ? 0 : finite(entry.bulge, 'Contour bulge', 1e6)
    return { point: [finite(point[0], 'Contour x'), finite(point[1], 'Contour y'), 0], bulge }
  })
}

function normalizeRequest(input: KJPlanarContourRequest): { operation: KJPlanarContourOperation; contours: KJPlanarContour[]; distance?: number; tolerance: number } {
  plainData(input)
  keys(input, ['operation', 'contours', 'distance', 'tolerance'], 'Contour request')
  const op = operation(input.operation), tol = tolerance(input.tolerance)
  if (!Array.isArray(input.contours) || !input.contours.length || input.contours.length > MAX_CONTOURS || (op !== 'offset' && input.contours.length !== 2)) throw new KJValidationError('Offset requires 1-64 contours; boolean operations require exactly two simple closed contours')
  const contours = input.contours.map((entry: unknown) => {
    keys(entry, ['closed', 'vertices'], 'Contour')
    if (entry.closed !== true) throw new KJValidationError('Contours must be explicitly closed')
    return { closed: true as const, vertices: normalizeVertices(entry.vertices) }
  })
  if (contours.reduce((count, contour) => count + contour.vertices.length, 0) > MAX_VERTICES) throw new KJValidationError('Contour request exceeds 4096 total vertices')
  if (op !== 'offset' && input.distance !== undefined) throw new KJValidationError('Boolean contour operations do not accept a distance')
  const distance = op === 'offset' ? finite(input.distance, 'Contour offset distance') : undefined
  if (distance === 0) throw new KJValidationError('Contour offset distance must be nonzero')
  return { operation: op, contours, ...(distance === undefined ? {} : { distance }), tolerance: tol }
}

/** Pure native contour computation. It never reads or modifies a document. */
export async function computePlanarContours(input: KJPlanarContourRequest, options: KJContourBackendOptions = {}): Promise<KJPlanarContourGeometry> {
  const request = normalizeRequest(input)
  const raw = await runContourWasm({ ...request, contours: request.contours.map(contour => contour.vertices.map(vertex => [vertex.point[0], vertex.point[1], vertex.bulge ?? 0])) }, options)
  keys(raw, ['contours', 'area'], 'Native contour result')
  if (!Array.isArray(raw.contours) || raw.contours.length > MAX_RESULT_CONTOURS) throw new KJValidationError('Native contour result exceeds the 256 contour budget')
  const contours: KJPlanarContourResult[] = raw.contours.map((entry: unknown) => {
    keys(entry, ['vertices', 'area', 'hole'], 'Native contour')
    if (!Array.isArray(entry.vertices) || typeof entry.hole !== 'boolean') throw new KJValidationError('Native contour result is invalid')
    const vertices = normalizeVertices(entry.vertices.map((vertex: unknown) => {
      if (!Array.isArray(vertex) || vertex.length !== 3) throw new KJValidationError('Native contour vertex ABI is invalid')
      return { point: [vertex[0], vertex[1], 0], bulge: vertex[2] }
    }), MAX_RESULT_VERTICES)
    const area = finite(entry.area, 'Native contour area', 1e20)
    if (area === 0 || (entry.hole ? area >= 0 : area <= 0)) throw new KJValidationError('Native contour area disagrees with ring orientation')
    return { closed: true, vertices, area, hole: entry.hole }
  })
  if (contours.reduce((count, contour) => count + contour.vertices.length, 0) > MAX_RESULT_VERTICES) throw new KJValidationError('Native contour result exceeds 32768 total vertices')
  const area = finite(raw.area, 'Native filled area', 1e20)
  if (area < 0 || (!contours.length && area !== 0)) throw new KJValidationError('Native contour filled area is invalid')
  const summed = contours.reduce((sum, contour) => sum + contour.area, 0)
  if (Math.abs(summed - area) > Math.max(request.tolerance ** 2, Math.abs(area) * 1e-10)) throw new KJValidationError('Native contour ring areas do not match the filled area')
  const geometryDigest = stableHash({ contours, area })
  return deepFreeze({ contours, area, receipt: { schema: 'kjdraw.planar-contours.v1', backend: 'cavalier-contours-wasm', abi: KJ_CONTOUR_WASM_ABI, operation: request.operation, tolerance: request.tolerance, sourceBoundaryError: 0, backendTolerance: request.tolerance, inputDigest: stableHash(request), geometryDigest, resultCount: contours.length } }) as KJPlanarContourGeometry
}

function normalizeEditRequest(input: KJPlanarContourEditRequest): KJPlanarContourEditRequest {
  plainData(input)
  keys(input, ['operation', 'ids', 'units', 'expectedRevision', 'distance', 'tolerance', 'expectedGeometryDigest'], 'Contour edit request')
  operation(input.operation)
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > MAX_CONTOURS || input.ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(input.ids).size !== input.ids.length) throw new KJValidationError('Contour edit requires distinct source entity IDs')
  if (typeof input.units !== 'string' || !input.units || input.units === 'unitless') throw new KJValidationError('Contour edit requires explicit drawing units')
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new KJValidationError('Contour edit requires a nonnegative integer expectedRevision')
  if (input.expectedGeometryDigest !== undefined && (typeof input.expectedGeometryDigest !== 'string' || !input.expectedGeometryDigest)) throw new KJValidationError('expectedGeometryDigest must be a nonempty string')
  return clone(input)
}

function sourceContour(entity: KJReadonlyObjectRecord, tol: number): { contour: KJPlanarContour; sourceBoundaryError: number } {
  if (entity.kind !== 'entity' || entity.erased || !['LWPOLYLINE', 'CIRCLE'].includes(entity.type)) throw new KJValidationError('Contour sources must be live LWPOLYLINE or CIRCLE entities')
  const payload = entity.payload
  if (payload.normal !== undefined && (!Array.isArray(payload.normal) || payload.normal.length !== 3 || payload.normal[0] !== 0 || payload.normal[1] !== 0 || payload.normal[2] !== 1)) throw new KJValidationError('Contour sources require the positive XY normal [0, 0, 1]')
  for (const key of ['thickness', 'elevation', 'constantWidth', 'width', 'startWidth', 'endWidth']) if (payload[key] !== undefined && payload[key] !== 0) throw new KJValidationError(`Contour sources do not support nonzero ${key}`)
  for (const key of ['materialId', 'plotStyleId', 'parentInsertId']) if (payload[key] != null) throw new KJValidationError(`Contour sources do not support ${key}`)
  if (payload.dxfFlags !== undefined && payload.dxfFlags !== 0 && payload.dxfFlags !== 1) throw new KJValidationError('Contour sources do not support fitted, spline or 3D polyline flags')
  if (entity.type === 'CIRCLE') {
    const center = payload.center
    if (!Array.isArray(center) || center.length !== 3 || center[2] !== 0) throw new KJValidationError('Contour circles require an XY center')
    const x = finite(center[0], 'Circle center x'), y = finite(center[1], 'Circle center y'), radius = finite(payload.radius, 'Circle radius')
    if (radius <= 0) throw new KJValidationError('Contour circles require a positive radius')
    const positiveX = x + radius, negativeX = x - radius
    // At large world coordinates, adding a small radius can round either endpoint.
    // The two horizontal endpoint errors bound circle Hausdorff distance:
    // |center drift| + |radius drift| equals max(|positive error|, |negative error|).
    const measuredRadialError = Math.max(Math.abs(additionResidual(x, radius, positiveX)), Math.abs(additionResidual(x, -radius, negativeX)))
    const radialError = measuredRadialError === 0 ? 0 : adjacentPositive(measuredRadialError, true)
    if (radialError > tol) throw new KJValidationError('Circle contour endpoints cannot preserve the source radius within the requested tolerance', { radius, tolerance: tol, radialError })
    return { contour: { closed: true, vertices: [{ point: [positiveX, y, 0], bulge: 1 }, { point: [negativeX, y, 0], bulge: 1 }] }, sourceBoundaryError: radialError }
  }
  if (payload.closed !== true || !Array.isArray(payload.vertices)) throw new KJValidationError('Contour polylines must be closed')
  const vertices = payload.vertices.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new KJValidationError('Contour source vertices require native point/bulge objects')
    const value = entry as Record<string, unknown>
    for (const key of ['startWidth', 'endWidth']) if (value[key] !== undefined && value[key] !== 0) throw new KJValidationError('Contour sources do not support polyline widths')
    return { point: value.point, ...(value.bulge === undefined ? {} : { bulge: value.bulge }) }
  })
  return { contour: { closed: true, vertices: normalizeVertices(vertices) }, sourceBoundaryError: 0 }
}

function assertRevision(document: KJDocument, revision: number): void {
  if (document.revision !== revision) throw new KJRevisionConflictError(revision, document.revision, { documentId: document.id })
}

function sources(document: KJDocument, request: KJPlanarContourEditRequest): { entities: KJReadonlyObjectRecord[]; contours: KJPlanarContour[]; style: KJObjectPayload; sourceBoundaryError: number; backendTolerance: number } {
  assertRevision(document, request.expectedRevision)
  const state = document.snapshot()
  if (state.header.units !== request.units) throw new KJValidationError('Contour edit units do not match the drawing', { expected: request.units, actual: state.header.units })
  const entities = request.ids.map(id => {
    const entity = document.getObject(id)
    if (!entity) throw new KJValidationError(`Contour source is missing or erased: ${id}`)
    return entity
  })
  const tol = tolerance(request.tolerance)
  const converted = entities.map(entity => sourceContour(entity, tol))
  const contours = converted.map(source => source.contour)
  const sourceBoundaryError = Math.max(...converted.map(source => source.sourceBoundaryError))
  if (sourceBoundaryError > 0) {
    // Intersections near tangency can amplify source quantization arbitrarily;
    // subtracting the input error from the backend budget cannot bound that.
    if (request.operation !== 'offset' || entities.length !== 1) throw new KJValidationError('Inexact CIRCLE conversion is supported only for a single-source offset; boolean and multi-source operations require exactly representable circle endpoints', { sourceBoundaryError, operation: request.operation, sourceCount: entities.length })
    const distance = finite(request.distance, 'Contour offset distance')
    const resultRadius = (entities[0]!.payload.radius as number) + distance
    if (distance < 0 && Math.abs(resultRadius) <= sourceBoundaryError) throw new KJValidationError('CIRCLE erosion is within the source conversion uncertainty at the disappearance threshold', { sourceBoundaryError, radius: entities[0]!.payload.radius, distance, resultRadius })
  }
  const backendTolerance = sourceBoundaryError === 0 ? tol : adjacentPositive(tol - sourceBoundaryError, false)
  if (backendTolerance < 1e-9) throw new KJValidationError('Source conversion leaves less than the minimum native tolerance budget', { tolerance: tol, sourceBoundaryError, backendTolerance })
  const styleOf = (entity: KJReadonlyObjectRecord): KJObjectPayload => Object.fromEntries(STYLE_KEYS.filter(key => entity.payload[key] !== undefined).map(key => [key, clone(entity.payload[key])]))
  const style = styleOf(entities[0]!)
  if (style.layerId === undefined && state.tables.layers.currentId) style.layerId = state.tables.layers.currentId
  if (!style.layerId) throw new KJValidationError('Contour source requires a valid drawing layer')
  const layer = document.getObject(style.layerId)
  if (!layer || layer.type !== 'LAYER' || layer.payload.locked === true || layer.payload.frozen === true || layer.payload.visible === false) throw new KJValidationError('Contour destination layer must exist and be visible, thawed and unlocked')
  for (const entity of entities) {
    const ownStyle = styleOf(entity)
    if (ownStyle.layerId === undefined && state.tables.layers.currentId) ownStyle.layerId = state.tables.layers.currentId
    if (entity.ownerId !== entities[0]!.ownerId || stableHash(ownStyle) !== stableHash(style)) throw new KJValidationError('Contour sources must have the same owner and compatible drawing styles')
  }
  return { entities, contours, style, sourceBoundaryError, backendTolerance }
}

async function prepare(document: KJDocument, input: KJPlanarContourEditRequest, options: KJContourBackendOptions): Promise<{ request: KJPlanarContourEditRequest; preview: KJPlanarContourPreview; entities: KJReadonlyObjectRecord[]; style: KJObjectPayload }> {
  const request = normalizeEditRequest(input), read = sources(document, request)
  const geometry = await computePlanarContours({ operation: request.operation, contours: read.contours, ...(request.distance === undefined ? {} : { distance: request.distance }), tolerance: read.backendTolerance }, options)
  assertRevision(document, request.expectedRevision)
  if (request.expectedGeometryDigest !== undefined && request.expectedGeometryDigest !== geometry.receipt.geometryDigest) throw new KJValidationError('Contour geometry differs from the reviewed preview')
  const receipt = { ...geometry.receipt, tolerance: tolerance(request.tolerance), sourceBoundaryError: read.sourceBoundaryError, backendTolerance: read.backendTolerance }
  const preview = deepFreeze({ ...geometry, receipt, sourceIds: [...request.ids], sourceDigest: stableHash(read.entities), units: request.units, revisionBefore: request.expectedRevision }) as KJPlanarContourPreview
  return { request, preview, ...read }
}

/** Read-only preview: source records, revision, serialization and undo history are unchanged. */
export async function previewPlanarContourEdit(document: KJDocument, request: KJPlanarContourEditRequest, options: KJContourBackendOptions = {}): Promise<KJPlanarContourPreview> {
  return (await prepare(document, request, options)).preview
}

/** Preserve every source; create all result rings as native bulged polylines in one transaction. */
export async function applyPlanarContourEdit(document: KJDocument, input: KJPlanarContourEditRequest, options: KJPlanarContourApplyOptions = {}): Promise<KJPlanarContourEditResult> {
  keys(options, ['wasmBytes', 'wasmUrl', 'author', 'commandEnvelope'], 'Contour apply options')
  const { author, commandEnvelope, ...backendOptions } = options
  if (commandEnvelope != null) keys(commandEnvelope, ['id', 'schema', 'schemaVersion', 'origin'], 'Contour command envelope provenance')
  const { request, preview, entities, style } = await prepare(document, input, backendOptions)
  if (preview.contours.length === 0) {
    assertRevision(document, request.expectedRevision)
    return deepFreeze({ ...preview, resultIds: [], revisionAfter: document.revision }) as KJPlanarContourEditResult
  }
  const commandId = request.operation === 'offset' ? 'CONTOUROFFSET' : 'CONTOURBOOLEAN'
  const resultIds = await document.transact('Create planar contour result', transaction => {
    const scope = createCommandEditScope(transaction, commandId)
    if (stableHash(request.ids.map(id => transaction.getObject(id))) !== preview.sourceDigest) throw new KJValidationError('Contour source records changed before commit')
    const ids = preview.contours.map(contour => scope.transaction.createEntity('LWPOLYLINE', {
      ...clone(style), closed: true, elevation: 0, normal: [0, 0, 1],
      vertices: contour.vertices.map(vertex => ({ point: [...vertex.point], bulge: vertex.bulge ?? 0, startWidth: 0, endWidth: 0 })),
    }, { ownerId: entities[0]!.ownerId, source: { derivedFromIds: [...request.ids], contourOperation: request.operation, geometryDigest: preview.receipt.geometryDigest } }).id)
    scope.validate()
    return ids
  }, {
    expectedRevision: request.expectedRevision, author, source: `command:${commandId}`,
    metadata: {
      commandId,
      commandEnvelopeId: commandEnvelope?.id ?? null,
      commandProtocol: commandEnvelope ? `${commandEnvelope.schema}@${commandEnvelope.schemaVersion}` : null,
      commandOrigin: commandEnvelope?.origin ?? null,
      sourceIds: [...request.ids], geometryReceipt: clone(preview.receipt),
    },
  })
  return deepFreeze({ ...preview, resultIds, revisionAfter: request.expectedRevision + 1 }) as KJPlanarContourEditResult
}
