import type { KJDocument } from './document.js'
import type { KJObjectPayload } from './schema.js'
import { KJRevisionConflictError, KJValidationError } from './errors.js'
import { createId } from './ids.js'
import { deepFreeze, type ReadonlyDeep } from './utils.js'
import { normalizeStandardEntityPayload } from './standard-entities.js'
import { projectDimension } from './geometry/annotation.js'

export interface KJAnnotationPoint { x: number; y: number }
export interface KJAnnotationReference { source: 'document' | 'proposal'; id: string }
export interface KJAnnotationPointReference extends KJAnnotationReference {
  feature: 'start' | 'end' | 'center' | 'vertex' | 'left' | 'right' | 'top' | 'bottom'
  /** Required only for vertex references; zero based. */
  vertexIndex?: number
}
export interface KJAgentTextAnnotation { text: string; position: KJAnnotationPoint; height: number; rotationDegrees: number }
export type KJAgentDimensionAnnotation =
  | { type: 'ALIGNED'; from: KJAnnotationPointReference; to: KJAnnotationPointReference; position: KJAnnotationPoint; height: number }
  | { type: 'ROTATED'; from: KJAnnotationPointReference; to: KJAnnotationPointReference; position: KJAnnotationPoint; height: number; rotationDegrees: number }
  | { type: 'RADIUS'; source: KJAnnotationReference; directionDegrees: number; position: KJAnnotationPoint; height: number }
  | { type: 'DIAMETER'; source: KJAnnotationReference; directionDegrees: number; position: KJAnnotationPoint; height: number }
export interface KJAgentAnnotationInput { expectedRevision: number; units: string; texts: readonly KJAgentTextAnnotation[]; dimensions: readonly KJAgentDimensionAnnotation[] }
export interface KJAnnotationEntitySpec { type: string; payload: KJObjectPayload; options: { id: string; ownerId: string } }
export interface KJAgentAnnotationOptions {
  /** Trusted host mapping of semantic proposal references to the actual base entities being proposed. */
  baseEntities?: Readonly<Record<string, ReadonlyDeep<KJAnnotationEntitySpec>>>
}

const fail = (message: string): never => { throw new KJValidationError(message) }
// Copy descriptors, never invoking accessors, toJSON, or user-supplied conversion functions.
function jsonSnapshot(input: unknown, maxBytes: number): unknown {
  let nodes = 0, characters = 0
  const active = new Set<object>()
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 60000 || depth > 12) fail('Annotation input exceeds its structural budget')
    if (typeof value === 'string') { characters += value.length; if (characters > maxBytes) fail('Annotation input exceeds its byte budget'); return value }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value
    if (!value || typeof value !== 'object') return fail('Annotations require finite plain JSON values')
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) fail('Annotations require plain JSON objects')
    if (active.has(value)) fail('Annotation input must not contain cycles')
    const keys = Reflect.ownKeys(value)
    if (keys.length > 60000) fail('Annotation input exceeds its structural budget')
    const copy: Record<string, unknown> | unknown[] = array ? [] : Object.create(null)
    active.add(value)
    for (const key of keys) {
      if (array && key === 'length') continue
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || array && !/^(0|[1-9]\d*)$/.test(key)) fail('Unsafe annotation input property')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!descriptor.enumerable || !('value' in descriptor)) fail('Annotation input cannot contain accessors or hidden properties')
      ;(copy as Record<string, unknown>)[key as string] = visit(descriptor.value, depth + 1)
    }
    if (array && keys.length - 1 !== (value as unknown[]).length) fail('Annotation arrays cannot contain holes')
    active.delete(value)
    return copy
  }
  const result = visit(input, 0)
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maxBytes) fail('Annotation input exceeds its byte budget')
  return result
}
function record(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Annotation value must be an object')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(item, key))) fail('Annotation fields are missing or unsupported')
  return item
}
function number(value: unknown, label: string, min = -1e12, max = 1e12): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail(`${label} must be a finite number in [${min}, ${max}]`)
  return value
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return fail('Annotation reference IDs must be nonempty bounded text')
  return value
}
function xy(value: unknown): [number, number, number] {
  const point = record(value, ['x', 'y'])
  return [number(point.x, 'x'), number(point.y, 'y'), 0]
}
function nativePoint(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fail('Referenced entity must use native XYZ points')
  const point: [number, number, number] = [number(value[0], 'x'), number(value[1], 'y'), number(value[2], 'z')]
  if (point[2] !== 0) fail('Annotation references must lie on model XY at z=0')
  return point
}

/** Compile revision-bound native annotations. This reads references at proposal time; it does not create associative constraints or modify the document. */
export function buildAgentAnnotationEntities(document: KJDocument, input: KJAgentAnnotationInput, options: KJAgentAnnotationOptions = {}): readonly ReadonlyDeep<KJAnnotationEntitySpec>[] {
  const source = record(jsonSnapshot(input, 65536), ['expectedRevision', 'units', 'texts', 'dimensions'])
  if (!Number.isSafeInteger(source.expectedRevision) || (source.expectedRevision as number) < 0) fail('expectedRevision must be a nonnegative safe integer')
  if (source.expectedRevision !== document.revision) throw new KJRevisionConflictError(source.expectedRevision, document.revision)
  const state = document.snapshot(), ownerId = state.spaces.modelSpaceId
  if (id(source.units) !== state.header.units) fail('Annotation units must exactly match drawing units')
  if (!Array.isArray(source.texts) || !Array.isArray(source.dimensions) || source.texts.length + source.dimensions.length < 1 || source.texts.length + source.dimensions.length > 64) fail('Supply 1–64 total text and dimension annotations')
  const opts = record(jsonSnapshot(options, 4194304), ['baseEntities'], [])
  if (opts.baseEntities !== undefined && (!opts.baseEntities || typeof opts.baseEntities !== 'object' || Array.isArray(opts.baseEntities))) fail('baseEntities must be a plain object map')
  const bases = opts.baseEntities === undefined ? {} : record(opts.baseEntities, Object.keys(opts.baseEntities as object), [])
  if (Object.keys(bases).length > 512) fail('Annotation base context exceeds 512 entities')
  const staged = new Map<string, { type: string; payload: KJObjectPayload; ownerId: string }>(), allocated = new Set<string>()
  for (const [name, value] of Object.entries(bases)) {
    id(name)
    const spec = record(value, ['type', 'payload', 'options']), settings = record(spec.options, ['id', 'ownerId'])
    const entityId = id(settings.id)
    if (allocated.has(entityId) || document.getObject(entityId)) fail('Proposal base IDs must be new and unique')
    allocated.add(entityId)
    if (!['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE'].includes(spec.type as string)) fail('Unsupported proposal base entity type')
    if (id(settings.ownerId) !== ownerId) fail('Annotation base entities must belong to model space')
    if (!spec.payload || typeof spec.payload !== 'object' || Array.isArray(spec.payload)) fail('Proposal base payload must be an object')
    staged.set(name, { type: spec.type as string, payload: normalizeStandardEntityPayload(spec.type, spec.payload as Record<string, unknown>), ownerId })
  }
  const reference = (value: unknown, withFeature = false) => {
    const ref = record(value, withFeature ? ['source', 'id', 'feature', 'vertexIndex'] : ['source', 'id'], withFeature ? ['source', 'id', 'feature'] : ['source', 'id'])
    if (!['document', 'proposal'].includes(ref.source as string)) fail('Unknown annotation reference source')
    const key = id(ref.id), object = ref.source === 'proposal' ? staged.get(key) : document.getObject(key)
    if (!object || 'kind' in object && object.kind !== 'entity' || object.ownerId !== ownerId) return fail('Annotation reference must resolve to an existing entity in the same model space')
    if (!['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE'].includes(object.type)) fail('Unsupported annotation reference entity type')
    const payload = object.payload
    for (const field of ['normal', 'extrusionDirection']) {
      const normal = payload[field]
      if (normal !== undefined && normal !== null && (!Array.isArray(normal) || normal.length !== 3 || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) fail('Annotation references require the default +Z plane')
    }
    if (payload.elevation != null && payload.elevation !== 0) fail('Annotation references require zero elevation')
    return { ref, object }
  }
  const curvePoint = (object: { type: string; payload: ReadonlyDeep<KJObjectPayload> }, angle: number): [number, number, number] => {
    const center = nativePoint(object.payload.center), radius = number(object.payload.radius, 'Referenced radius', 1e-12, 1e12)
    if (object.type === 'ARC') {
      const start = number(object.payload.startAngle, 'Arc start'), end = number(object.payload.endAngle, 'Arc end')
      const direction = object.payload.clockwise === true ? -1 : 1, tau = 2 * Math.PI
      const normalize = (value: number) => ((value % tau) + tau) % tau
      const span = normalize((end - start) * direction), offset = normalize((angle - start) * direction)
      if (span < 1e-12 || offset > span + 1e-10 && tau - offset > 1e-10) fail('Annotation anchor must lie within the actual ARC sweep')
    }
    return nativePoint([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), 0])
  }
  const feature = (value: unknown): [number, number, number] => {
    const { ref, object } = reference(value, true), payload = object.payload
    if (ref.feature !== 'vertex' && 'vertexIndex' in ref) fail('vertexIndex is only valid for vertex references')
    if (ref.feature === 'start' || ref.feature === 'end') {
      if (object.type === 'ARC') return curvePoint(object, number(payload[ref.feature === 'start' ? 'startAngle' : 'endAngle'], 'Arc endpoint'))
      if (object.type !== 'LINE') fail('Start/end annotation references require LINE/ARC entities')
      return nativePoint(payload[ref.feature])
    }
    if (['left', 'right', 'top', 'bottom'].includes(ref.feature as string)) {
      if (!['CIRCLE', 'ARC'].includes(object.type)) fail('Quadrant references require CIRCLE/ARC entities')
      const angles = { right: 0, top: Math.PI / 2, left: Math.PI, bottom: 3 * Math.PI / 2 }
      return curvePoint(object, angles[ref.feature as keyof typeof angles])
    }
    if (ref.feature === 'center') {
      if (!['CIRCLE', 'ARC'].includes(object.type)) fail('Center annotation references require CIRCLE/ARC entities')
      return nativePoint(payload.center)
    }
    if (ref.feature === 'vertex') {
      if (object.type !== 'LWPOLYLINE' || !Number.isSafeInteger(ref.vertexIndex) || (ref.vertexIndex as number) < 0 || (ref.vertexIndex as number) > 4095 || !Array.isArray(payload.vertices) || payload.vertices.length > 4096) fail('Vertex references require a bounded native polyline vertex index')
      const vertices = payload.vertices as Array<Record<string, unknown>>
      if (vertices.some(vertex => vertex.bulge !== 0)) fail('Annotation vertex references currently require straight polylines')
      return nativePoint(vertices[ref.vertexIndex as number]?.point)
    }
    return fail('Unsupported annotation point feature')
  }
  const entities: KJAnnotationEntitySpec[] = []
  // Standard normalization includes optional undefined fields; proposal envelopes must remain pure JSON.
  const omitUndefined = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(omitUndefined)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, omitUndefined(child)]))
    return value
  }
  const append = (type: string, payload: KJObjectPayload) => {
    const entityId = createId('entity')
    entities.push({ type, payload: omitUndefined(normalizeStandardEntityPayload(type, payload)) as KJObjectPayload, options: { id: entityId, ownerId } })
  }
  for (const value of source.texts as unknown[]) {
    const item = record(value, ['text', 'position', 'height', 'rotationDegrees'])
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2048 || /[\u0000-\u001f\u007f]/.test(item.text)) fail('TEXT annotation must be nonempty single-line text of at most 2048 characters')
    append('TEXT', { text: item.text, position: xy(item.position), height: number(item.height, 'Text height', 1e-6, 1e6), rotation: number(item.rotationDegrees, 'Text angle', 0, 360) * Math.PI / 180 })
  }
  for (const value of source.dimensions as unknown[]) {
    const item = record(value, ['type', 'from', 'to', 'source', 'position', 'height', 'rotationDegrees', 'directionDegrees'], ['type', 'position', 'height'])
    const type = item.type
    if (!['ALIGNED', 'ROTATED', 'RADIUS', 'DIAMETER'].includes(type as string)) fail('Unsupported native dimension type')
    const position = xy(item.position), height = number(item.height, 'Dimension text height', 1e-6, 1e6)
    let definitionPoints: [number, number, number][], rotation = 0
    if (type === 'ALIGNED' || type === 'ROTATED') {
      record(item, type === 'ROTATED' ? ['type', 'from', 'to', 'position', 'height', 'rotationDegrees'] : ['type', 'from', 'to', 'position', 'height'])
      definitionPoints = [position, feature(item.from), feature(item.to)]
      if (type === 'ROTATED') rotation = number(item.rotationDegrees, 'Dimension rotation', 0, 360) * Math.PI / 180
    } else {
      record(item, ['type', 'source', 'position', 'height', 'directionDegrees'])
      const { object } = reference(item.source)
      if (type === 'DIAMETER' ? object.type !== 'CIRCLE' : !['CIRCLE', 'ARC'].includes(object.type)) fail('Radius requires a CIRCLE/ARC; diameter requires a CIRCLE')
      const center = nativePoint(object.payload.center), radius = number(object.payload.radius, 'Referenced radius', 1e-12, 1e12)
      const angle = number(item.directionDegrees, 'Radial direction', 0, 360) * Math.PI / 180
      const end = curvePoint(object, angle)
      definitionPoints = [type === 'RADIUS' ? center : [center[0] - radius * Math.cos(angle), center[1] - radius * Math.sin(angle), 0], end]
    }
    const payload: KJObjectPayload = { dimensionType: type, definitionPoints, ...((type === 'RADIUS' || type === 'DIAMETER') ? { textPosition: position } : {}), textHeight: height, rotation, precision: 8 }
    const projection = projectDimension(payload)
    if (!projection || !Number.isFinite(projection.measurement) || projection.measurement < 1e-8 || projection.measurement > 1e12) fail('Dimension references produce degenerate or out-of-budget measurements')
    for (const point of definitionPoints) nativePoint(point)
    append('DIMENSION', payload)
  }
  if (document.revision !== source.expectedRevision || document.snapshot() !== state) throw new KJRevisionConflictError(source.expectedRevision, document.revision)
  return deepFreeze(entities)
}
