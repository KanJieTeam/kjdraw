import { KJCommandRegistry, registerCoreCommands } from './commands.js'
import type { KJDocument } from './document.js'
import { KJValidationError } from './errors.js'
import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js'
import { canonicalStringify, deepFreeze, type ReadonlyDeep } from './utils.js'
import { projectDimension } from './geometry/annotation.js'
import { displayedEntityBounds } from './selection-geometry.js'
import { readDesignRelations, type KJDesignDefinition } from './design-relations.js'
import { captureAgentBlockDependencies, agentBlockDependenciesMatchDocument, type KJAgentBlockPreviewDependency } from './agent-preview-blocks.js'
export type { KJAgentBlockPreviewDependency } from './agent-preview-blocks.js'

export interface KJAgentPreviewEntity {
  readonly id: string
  readonly type: string
  readonly payload: ReadonlyDeep<KJObjectPayload>
}
export interface KJAgentPreviewResource {
  readonly id: string
  readonly type: string
  readonly name: string | null
  readonly payload: ReadonlyDeep<KJObjectPayload>
  /** Omitted for table records for backwards-compatible preview payloads. */
  readonly kind?: 'block-record'
}
export interface KJAgentGeometryPreview {
  readonly documentId: string
  readonly revision: number
  readonly resources?: readonly KJAgentPreviewResource[]
  /** Existing block definitions, descendant geometry and styles, captured at revision. */
  readonly blockDependencies?: readonly KJAgentBlockPreviewDependency[]
  readonly designChange?: { readonly id: string; readonly before: ReadonlyDeep<KJDesignDefinition>; readonly after: ReadonlyDeep<KJDesignDefinition>; readonly record: KJReadonlyObjectRecord; readonly members: readonly KJReadonlyObjectRecord[]; readonly dictionary: { readonly id: string; readonly key: string } }
  readonly command: 'CREATEBATCH' | 'COMPONENTINSERT' | 'MOVE' | 'ROTATE' | 'SCALE' | 'STRETCH' | 'LENGTHEN' | 'PEDIT' | 'DESIGNCREATE' | 'DESIGNUPDATE' | 'ROAD_DRAWING_UPDATE'
  readonly before: readonly KJAgentPreviewEntity[]
  readonly after: readonly KJAgentPreviewEntity[]
}
const project = (entity: KJReadonlyObjectRecord): KJAgentPreviewEntity => ({ id: entity.id, type: entity.type, payload: entity.payload })
const supported = ['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE']
export const KJDRAW_AGENT_MOVABLE_TYPES: readonly string[] = Object.freeze([...supported, 'ELLIPSE', 'XLINE', 'RAY', 'TEXT', 'DIMENSION', 'INSERT'])
const creatable = [...supported, 'TEXT', 'DIMENSION']
const stretchable = ['LINE', 'LWPOLYLINE', 'POLYLINE']

function validateMovableAnnotation(document: KJDocument, entity: KJReadonlyObjectRecord): void {
  if (entity.type === 'ELLIPSE') { validateTransformGeometry(document, entity); return }
  if (entity.type !== 'TEXT' && entity.type !== 'DIMENSION') return
  const payload = entity.payload
  for (const field of ['normal', 'extrusionDirection']) {
    const normal = payload[field]
    if (normal !== undefined && normal !== null && (!Array.isArray(normal) || normal.length !== 3 || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) throw new KJValidationError('Annotation move preview requires the default +Z plane')
  }
  const points = entity.type === 'TEXT' ? [payload.position, ...(payload.alignmentPoint ? [payload.alignmentPoint] : [])] : [...(Array.isArray(payload.definitionPoints) ? payload.definitionPoints : []), ...(payload.textPosition ? [payload.textPosition] : [])]
  if (!points.length || points.some(point => !Array.isArray(point) || point.length !== 3 || point.some(value => typeof value !== 'number' || !Number.isFinite(value)) || point[2] !== 0)) throw new KJValidationError('Annotation move preview requires complete model XY geometry at z=0')
  if (entity.type === 'DIMENSION' && !projectDimension(payload, document.getObject(String(payload.styleId ?? ''))?.payload)) throw new KJValidationError('Annotation move preview requires supported nondegenerate native dimension geometry')
}

/** Rotation/scaling cannot silently drop a third dimension or unsupported width semantics. */
function validateTransformGeometry(document: KJDocument, entity: KJReadonlyObjectRecord): void {
  const payload = entity.payload
  const bounded = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12
  const point = (value: unknown): boolean => Array.isArray(value) && value.length === 3 && value.every(bounded) && value[2] === 0
  for (const key of ['normal', 'extrusionDirection']) {
    const normal = payload[key]
    if (normal != null && (!Array.isArray(normal) || normal.length !== 3 || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) throw new KJValidationError('Transform preview requires default +Z geometry')
  }
  for (const key of ['elevation', 'thickness']) if (payload[key] != null && payload[key] !== 0) throw new KJValidationError('Transform preview does not support elevation or thickness')
  let points: unknown[] = []
  if (entity.type === 'LINE') points = [payload.start, payload.end]
  else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
    points = [payload.center]
    if (!bounded(payload.radius) || payload.radius <= 1e-12) throw new KJValidationError('Transform preview requires a bounded nondegenerate radius')
    if (entity.type === 'ARC' && (!bounded(payload.startAngle) || !bounded(payload.endAngle))) throw new KJValidationError('Transform preview requires finite arc angles')
  } else if (entity.type === 'ELLIPSE') {
    points = [payload.center, payload.majorAxis]
    const axis = payload.majorAxis
    if (!Array.isArray(axis) || axis.length !== 3 || Math.hypot(Number(axis[0]), Number(axis[1])) <= 1e-12 || !bounded(payload.ratio) || payload.ratio <= 1e-12 || payload.ratio > 1 || !bounded(payload.startParameter ?? 0) || !bounded(payload.endParameter ?? Math.PI * 2)) throw new KJValidationError('Transform preview requires a bounded nondegenerate native ellipse')
  } else if (entity.type === 'XLINE' || entity.type === 'RAY') {
    points = [payload.origin, payload.direction]
    if (!Array.isArray(payload.direction) || Math.hypot(Number(payload.direction[0]), Number(payload.direction[1])) <= 1e-12) throw new KJValidationError('Transform preview requires a nonzero XY guide direction')
  } else if (entity.type === 'TEXT' || entity.type === 'INSERT') {
    points = [payload.position, ...(payload.alignmentPoint ? [payload.alignmentPoint] : [])]
    if (!bounded(payload.rotation)) throw new KJValidationError('Transform preview requires finite rotation')
    if (entity.type === 'TEXT' && (typeof payload.text !== 'string' || !payload.text.trim() || !bounded(payload.height) || payload.height <= 1e-12)) throw new KJValidationError('Transform preview requires visible bounded text')
  } else if (entity.type === 'DIMENSION') {
    points = [...(Array.isArray(payload.definitionPoints) ? payload.definitionPoints : []), ...(payload.textPosition ? [payload.textPosition] : [])]
    validateMovableAnnotation(document, entity)
    const projection = projectDimension(payload, document.getObject(String(payload.styleId ?? ''))?.payload)!
    const visiblePoints = [...projection.lines.flat(), ...projection.arrows.flat(), projection.label.position, ...projection.arcs.map(arc => arc.center)]
    if (!visiblePoints.every(p => p.every(bounded)) || !bounded(projection.measurement) || !bounded(projection.label.height) || projection.arcs.some(arc => !bounded(arc.radius))) throw new KJValidationError('Transform annotation projection exceeds its finite coordinate budget')
  } else if (entity.type === 'LWPOLYLINE') {
    for (const key of ['constantWidth', 'width', 'defaultStartWidth', 'defaultEndWidth']) if (payload[key] != null && payload[key] !== 0) throw new KJValidationError('Transform preview does not support wide polylines')
    if (!Array.isArray(payload.vertices) || payload.vertices.length < 2 || payload.vertices.length > 4096) throw new KJValidationError('Transform preview requires 2–4096 polyline vertices')
    points = payload.vertices.map(vertex => {
      const record = vertex as Readonly<Record<string, unknown>>
      if (record.startWidth && record.startWidth !== 0 || record.endWidth && record.endWidth !== 0) throw new KJValidationError('Transform preview does not support wide polylines')
      if (record.bulge != null && !bounded(record.bulge)) throw new KJValidationError('Transform preview requires bounded bulges')
      return record.point
    })
  }
  if (!points.length || !points.every(point)) throw new KJValidationError('Transform preview requires complete finite XY geometry at z=0 within ±1e12')
  if ((entity.type === 'LINE' || entity.type === 'LWPOLYLINE') && points.every(value => canonicalStringify(value) === canonicalStringify(points[0]))) throw new KJValidationError('Transform preview requires nondegenerate geometry')
}

function validateTransformArguments(command: 'ROTATE' | 'SCALE', args: Record<string, unknown>): void {
  const keys = command === 'ROTATE' ? ['ids', 'center', 'angleDegrees'] : ['ids', 'center', 'factor']
  if (Object.keys(args).some(key => !keys.includes(key))) throw new KJValidationError('Unexpected transform preview argument')
  if (!Array.isArray(args.center) || args.center.length !== 2 || args.center.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12)) throw new KJValidationError('Transform preview requires an explicit bounded XY center')
  if (command === 'ROTATE') {
    if (typeof args.angleDegrees !== 'number' || !Number.isFinite(args.angleDegrees) || args.angleDegrees === 0 || Math.abs(args.angleDegrees) >= 360) throw new KJValidationError('Rotation must be nonzero degrees strictly between -360 and 360')
  } else if (typeof args.factor !== 'number' || !Number.isFinite(args.factor) || args.factor < 1e-6 || args.factor > 1e6 || args.factor === 1) throw new KJValidationError('Scale must be positive and between 0.000001 and 1000000, excluding 1')
}

function validatePolylineEditArguments(document: KJDocument, args: Record<string, unknown>): void {
  const entity = typeof args.id === 'string' ? document.getObject(args.id) : null
  if (!entity || !['LWPOLYLINE', 'POLYLINE'].includes(entity.type)) return
  if (args.operation === 'SET_BULGE') {
    if (args.bulge != null && (typeof args.bulge !== 'number' || !Number.isFinite(args.bulge) || Math.abs(args.bulge) > 32)) throw new KJValidationError('PEDIT preview bulge must be finite within ±32')
    if (args.sweepDegrees != null && (typeof args.sweepDegrees !== 'number' || !Number.isFinite(args.sweepDegrees) || Math.abs(args.sweepDegrees) > 350)) throw new KJValidationError('PEDIT preview sweep must be finite within ±350 degrees')
  }
  if (args.operation === 'SET_WIDTH' && [args.startWidth, args.endWidth].some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12)) throw new KJValidationError('PEDIT preview widths must be finite from 0 to 1000000000000')
  if (args.operation !== 'INSERT' || args.tolerance == null) return
  if (typeof args.tolerance !== 'number' || !Number.isFinite(args.tolerance) || args.tolerance < 0 || args.tolerance > 1000000) throw new KJValidationError('PEDIT preview tolerance must be finite from 0 to 1000000 drawing units')
  const vertices = Array.isArray(entity.payload.vertices) ? entity.payload.vertices : []
  const segmentIndex = Number(args.segmentIndex)
  const closed = entity.payload.closed === true || ((Number(entity.payload.flags ?? 0) & 1) === 1)
  const nextIndex = Number.isSafeInteger(segmentIndex) && segmentIndex >= 0 && segmentIndex + 1 < vertices.length ? segmentIndex + 1 : closed && segmentIndex === vertices.length - 1 ? 0 : -1
  const a = vertices[segmentIndex]?.point, b = vertices[nextIndex]?.point
  if (!Array.isArray(a) || !Array.isArray(b)) return
  const chord = Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1]))
  if (Number.isFinite(chord) && args.tolerance > Math.max(1e-9, chord * 1e-6)) throw new KJValidationError('PEDIT preview tolerance exceeds one millionth of the selected segment length')
}

function validateStretchArguments(args: Record<string, unknown>): void {
  if (Object.keys(args).some(key => !['ids', 'crossingStart', 'crossingEnd', 'dx', 'dy'].includes(key))) throw new KJValidationError('Unexpected STRETCH preview argument')
  const point = (value: unknown): value is readonly number[] => Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1e12)
  if (!point(args.crossingStart) || !point(args.crossingEnd)) throw new KJValidationError('STRETCH preview requires two bounded XY crossing-window corners')
  if (args.crossingStart[0] === args.crossingEnd[0] || args.crossingStart[1] === args.crossingEnd[1]) throw new KJValidationError('STRETCH crossing window must have positive width and height')
  if (typeof args.dx !== 'number' || typeof args.dy !== 'number' || !Number.isFinite(args.dx) || !Number.isFinite(args.dy) || Math.abs(args.dx) > 1e12 || Math.abs(args.dy) > 1e12 || args.dx === 0 && args.dy === 0) throw new KJValidationError('STRETCH preview requires a bounded nonzero XY displacement')
}

function validateStretchGeometry(document: KJDocument, entity: KJReadonlyObjectRecord): void {
  const layer = document.getObject(String(entity.payload.layerId ?? ''))
  if (entity.ownerId !== document.spaces.modelSpaceId || entity.payload.visible === false || entity.payload.locked === true || entity.payload.frozen === true || layer?.payload.visible === false || layer?.payload.locked === true || layer?.payload.frozen === true) throw new KJValidationError('STRETCH preview requires visible editable model-space geometry')
  for (const key of ['normal', 'extrusionDirection']) {
    const normal = entity.payload[key]
    if (normal != null && (!Array.isArray(normal) || normal.length !== 3 || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) throw new KJValidationError('STRETCH preview requires default +Z geometry')
  }
  if (entity.payload.thickness != null && entity.payload.thickness !== 0) throw new KJValidationError('STRETCH preview does not support thickness')
  if (entity.type === 'POLYLINE' && (Number(entity.payload.flags ?? 0) & 126) !== 0) throw new KJValidationError('STRETCH preview rejects fitted, 3D, mesh and polyface POLYLINE data')
  const points = entity.type === 'LINE' ? [entity.payload.start, entity.payload.end] : Array.isArray(entity.payload.vertices) ? entity.payload.vertices.map(vertex => (vertex as { readonly point?: unknown }).point ?? vertex) : []
  if (points.length < 2 || points.length > 4096 || points.some(value => !Array.isArray(value) || value.length !== 3 || value.some(coordinate => typeof coordinate !== 'number' || !Number.isFinite(coordinate) || Math.abs(coordinate) > 1e12))) throw new KJValidationError('STRETCH preview requires 2–4096 finite vertices within ±1e12')
}

function validateLengthenPreview(document: KJDocument, args: Record<string, unknown>): void {
  const dynamic = args.mode === 'DYNAMIC'
  const allowed = ['id', 'endpoint', 'mode', dynamic ? 'targetPoint' : 'value']
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new KJValidationError('Unexpected LENGTHEN preview argument')
  if (!['TOTAL', 'DELTA', 'PERCENT', 'DYNAMIC'].includes(String(args.mode)) || !['start', 'end'].includes(String(args.endpoint))) throw new KJValidationError('LENGTHEN preview requires an explicit mode and start/end endpoint')
  if (dynamic) {
    if (!Array.isArray(args.targetPoint) || args.targetPoint.length !== 2 || args.targetPoint.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12)) throw new KJValidationError('LENGTHEN dynamic preview requires a bounded XY target point')
  } else if (typeof args.value !== 'number' || !Number.isFinite(args.value) || Math.abs(args.value) > 1e12) throw new KJValidationError('LENGTHEN preview requires a bounded numeric value')
  const entity = typeof args.id === 'string' ? document.getObject(args.id) : null
  if (!entity || !['LINE', 'ARC'].includes(entity.type)) throw new KJValidationError('LENGTHEN preview requires one LINE or ARC ID')
  if (entity.type === 'LINE') { validateStretchGeometry(document, entity); return }
  const layer = document.getObject(String(entity.payload.layerId ?? ''))
  if (entity.ownerId !== document.spaces.modelSpaceId || entity.payload.visible === false || entity.payload.locked === true || entity.payload.frozen === true || layer?.payload.visible === false || layer?.payload.locked === true || layer?.payload.frozen === true) throw new KJValidationError('LENGTHEN preview requires visible editable model-space geometry')
  for (const key of ['normal', 'extrusionDirection']) {
    const normal = entity.payload[key]
    if (normal != null && (!Array.isArray(normal) || normal.length !== 3 || normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1)) throw new KJValidationError('LENGTHEN preview requires default +Z geometry')
  }
  const payload = entity.payload
  if (payload.thickness != null && payload.thickness !== 0) throw new KJValidationError('LENGTHEN preview does not support thickness')
  if (!Array.isArray(payload.center) || payload.center.length !== 3 || payload.center.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) || typeof payload.radius !== 'number' || payload.radius <= 1e-12 || !Number.isFinite(payload.radius) || payload.radius > 1e12 || [payload.startAngle, payload.endAngle].some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new KJValidationError('LENGTHEN preview requires bounded nondegenerate native arc geometry')
}
export interface KJAgentGeometryPreviewOptions {
  /** Trusted host creation budget; defaults to 64, hard maximum 512. Transforms remain limited to 64. */
  maxCreatedEntities?: number
}

/** Run bounded core geometry on a detached document. No host plugins, authority, network or source history is invoked. */
export async function createAgentGeometryPreview(document: KJDocument, command: 'CREATEBATCH' | 'COMPONENTINSERT' | 'MOVE' | 'ROTATE' | 'SCALE' | 'STRETCH' | 'LENGTHEN' | 'PEDIT' | 'DESIGNCREATE' | 'DESIGNUPDATE', args: Record<string, unknown>, options: KJAgentGeometryPreviewOptions = {}): Promise<KJAgentGeometryPreview> {
  if (!['CREATEBATCH', 'COMPONENTINSERT', 'MOVE', 'ROTATE', 'SCALE', 'STRETCH', 'LENGTHEN', 'PEDIT', 'DESIGNCREATE', 'DESIGNUPDATE'].includes(command)) throw new KJValidationError('Unsupported core preview command')
  let bindingIds: string[] | undefined
  if (command === 'DESIGNCREATE') {
    if (typeof args.id !== 'string' || !args.id.trim() || Object.keys(args).some(key => !['id', 'name', 'definition'].includes(key))) throw new KJValidationError('DESIGNCREATE preview requires a stable preallocated ID, name and definition')
    const bindings = (args.definition as { bindings?: unknown } | null)?.bindings
    if (!Array.isArray(bindings) || !bindings.length || bindings.length > 256 || bindings.some(binding => !binding || typeof binding.entityId !== 'string')) throw new KJValidationError('DESIGNCREATE requires 1–256 existing geometry bindings')
    bindingIds = [...new Set(bindings.map(binding => String(binding.entityId)))]
  }
  if (command === 'DESIGNUPDATE' && (typeof args.id !== 'string' || Object.keys(args).some(key => !['id', 'parameters'].includes(key)))) throw new KJValidationError('DESIGNUPDATE requires a design ID and independent parameter changes')
  const design = command === 'DESIGNUPDATE' ? readDesignRelations(document, [String(args.id)])[0] : undefined
  if (command === 'DESIGNUPDATE' && !design) throw new KJValidationError('DESIGNUPDATE requires an existing design')
  const affine = command === 'ROTATE' || command === 'SCALE'
  if (affine) validateTransformArguments(command, args)
  if (command === 'STRETCH') validateStretchArguments(args)
  if (command === 'LENGTHEN') validateLengthenPreview(document, args)
  const maxCreatedEntities = options.maxCreatedEntities ?? 64
  if (!Number.isSafeInteger(maxCreatedEntities) || maxCreatedEntities < 1 || maxCreatedEntities > 512) throw new KJValidationError('Preview creation budget must be an integer from 1 to 512')
  if (command === 'CREATEBATCH') {
    if (!Array.isArray(args.entities) || !args.entities.length || args.entities.length > maxCreatedEntities || args.entities.some(spec => !spec || typeof spec !== 'object' || !creatable.includes(String(spec.type)))) throw new KJValidationError(`Preview creation requires 1–${maxCreatedEntities} LINE/CIRCLE/ARC/LWPOLYLINE/TEXT/DIMENSION entities`)
  } else if (command !== 'COMPONENTINSERT') {
    const ids = bindingIds ?? (design ? design.entityIds : command === 'PEDIT' || command === 'LENGTHEN' ? [args.id] : args.ids)
    if (!Array.isArray(ids) || !ids.length || ids.length > 64) throw new KJValidationError('Preview requires 1–64 existing entity IDs')
    if (command === 'PEDIT') {
      if (typeof args.id !== 'string' || ids.length !== 1 || !['LWPOLYLINE', 'POLYLINE'].includes(document.getObject(args.id)?.type ?? '')) throw new KJValidationError('PEDIT preview requires one LWPOLYLINE or POLYLINE ID')
      const entity = document.getObject(args.id)!, layer = document.getObject(String(entity.payload.layerId ?? ''))
      if (entity.ownerId !== document.spaces.modelSpaceId || entity.payload.visible === false || entity.payload.locked === true || entity.payload.frozen === true || layer?.payload.visible === false || layer?.payload.locked === true || layer?.payload.frozen === true) throw new KJValidationError('PEDIT preview requires one visible editable model-space polyline')
      validatePolylineEditArguments(document, args)
    } else if (command === 'STRETCH') {
      if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new KJValidationError('STRETCH object IDs must be unique strings')
      if (ids.some(id => !stretchable.includes(document.getObject(String(id))?.type ?? ''))) throw new KJValidationError(`STRETCH preview requires 1–64 ${stretchable.join('/')} entities`)
      for (const id of ids) validateStretchGeometry(document, document.getObject(String(id))!)
    } else if (command !== 'LENGTHEN' && command !== 'DESIGNUPDATE' && command !== 'DESIGNCREATE') {
      if (ids.some(id => !KJDRAW_AGENT_MOVABLE_TYPES.includes(document.getObject(String(id))?.type ?? ''))) throw new KJValidationError(`Preview movement requires 1–64 ${KJDRAW_AGENT_MOVABLE_TYPES.join('/')} entities`)
      for (const id of ids) validateMovableAnnotation(document, document.getObject(String(id))!)
    }
    if (affine) {
      if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new KJValidationError('Object IDs must be unique strings')
      for (const id of ids) {
        const entity = document.getObject(String(id))!
        const layer = document.getObject(String(entity.payload.layerId ?? ''))
        if (entity.ownerId !== document.spaces.modelSpaceId || entity.payload.visible === false || entity.payload.locked === true || entity.payload.frozen === true || layer?.payload.visible === false || layer?.payload.locked === true || layer?.payload.frozen === true) throw new KJValidationError('Transform preview requires visible editable model-space entities')
        validateTransformGeometry(document, entity)
      }
    }
  }
  const source = document.snapshot(), revision = document.revision
  if (Object.keys(source.objects).length > 250000) throw new KJValidationError('Agent preview exceeds the 250000 object document limit')
  const ids = bindingIds ?? (design ? design.entityIds : command === 'CREATEBATCH' || command === 'COMPONENTINSERT' ? [] : command === 'PEDIT' || command === 'LENGTHEN' ? [String(args.id)] : args.ids as string[])
  const blockDependencies = ['MOVE', 'ROTATE', 'SCALE'].includes(command) ? captureAgentBlockDependencies(document, ids) : undefined
  const workingSet = command === 'CREATEBATCH' ? args.entities : command === 'COMPONENTINSERT' ? args : ids.map(id => document.getObject(id))
  if (new TextEncoder().encode(JSON.stringify({ args, workingSet, ...(design ? { design: document.getObject(design.id) } : {}) })).length > 4194304) throw new KJValidationError('Agent preview working set exceeds the 4 MiB limit')
  const draft = document.fork()
  const commands = new KJCommandRegistry()
  registerCoreCommands(commands)
  await commands.execute(command, { document: draft, expectedRevision: revision }, args)
  if (blockDependencies && canonicalStringify(captureAgentBlockDependencies(draft, ids)) !== canonicalStringify(blockDependencies)) throw new KJValidationError('Block definitions or styles changed during transform preview')
  if (document.revision !== revision || document.snapshot() !== source) throw new KJValidationError('Drawing changed while preparing the preview; propose again')
  const before: KJAgentPreviewEntity[] = [], after: KJAgentPreviewEntity[] = []
  const old = new Map(document.listEntities().map(entity => [entity.id, entity]))
  for (const entity of draft.listEntities()) {
    const previous = old.get(entity.id)
    if (!previous || canonicalStringify(project(previous)) !== canonicalStringify(project(entity))) {
      if (previous) before.push(project(previous))
      if (command === 'MOVE') validateMovableAnnotation(draft, entity)
      if (affine) validateTransformGeometry(draft, entity)
      if (command === 'LENGTHEN') validateLengthenPreview(draft, args)
      if (command === 'PEDIT' || command === 'STRETCH' || command === 'LENGTHEN') {
        const bounds = displayedEntityBounds(draft, entity)
        if (!bounds || bounds.some(value => !Number.isFinite(value) || Math.abs(value) > 1e12)) throw new KJValidationError(`${command} preview result exceeds the finite ±1e12 display budget`)
      }
      after.push(project(entity))
    }
    old.delete(entity.id)
  }
  for (const entity of old.values()) before.push(project(entity))
  if (affine && !after.length) throw new KJValidationError('Transform would leave the selected geometry unchanged')
  if (command === 'STRETCH' && !after.length) throw new KJValidationError('STRETCH would leave the selected geometry unchanged')
  if (command === 'LENGTHEN' && !after.length) throw new KJValidationError('LENGTHEN would leave the selected geometry unchanged')
  if (command === 'PEDIT' && !after.length) throw new KJValidationError('Polyline edit would leave the selected geometry unchanged')
  if (before.length > 64 || after.length > (command === 'CREATEBATCH' || command === 'COMPONENTINSERT' ? maxCreatedEntities : 64)) throw new KJValidationError('Preview exceeds the changed-entity limit')
  const resources = draft.listObjects().filter(item => (item.kind === 'table-record' || item.kind === 'block-record') && !document.getObject(item.id)).map(item => ({
    id: item.id, type: item.type, name: item.name, payload: item.payload, ...(item.kind === 'block-record' ? { kind: item.kind } : {}),
  }))
  if (resources.length > 32) throw new KJValidationError('Preview exceeds the 32 new resource limit')
  const designId = design?.id ?? (command === 'DESIGNCREATE' ? String(args.id) : undefined)
  const dictionaryId = draft.snapshot().namedObjectsDictionaryId
  const dictionaryKey = designId ? Object.entries(draft.getObject(dictionaryId)!.payload.entries ?? {}).find(([key, target]) => key.startsWith('KJDRAW_DESIGN:') && target === designId)?.[0] : undefined
  if (designId && !dictionaryKey) throw new KJValidationError('Design relation dictionary binding is missing')
  const designChange = designId ? { id: designId, before: design?.definition ?? { parameters: [], derived: [], bindings: [], requirements: [] }, after: readDesignRelations(draft, [designId])[0]!.definition, record: draft.getObject(designId)!, members: ids.map(id => draft.getObject(id)!), dictionary: { id: dictionaryId, key: dictionaryKey! } } : undefined
  const preview = { documentId: document.id, revision, command, before, after, ...(resources.length ? { resources } : {}), ...(blockDependencies ? { blockDependencies } : {}), ...(designChange ? { designChange } : {}) }
  if (new TextEncoder().encode(JSON.stringify(preview)).length > 262144) throw new KJValidationError('Agent geometry preview exceeds the 256 KiB output limit')
  return deepFreeze(preview) as KJAgentGeometryPreview
}

export function agentPreviewMatchesDocument(document: KJDocument, preview: KJAgentGeometryPreview): boolean {
  const retained = new Set(preview.after.map(entity => entity.id))
  return document.id === preview.documentId
    && (!preview.designChange || (() => { const actual = document.getObject(preview.designChange.id); return actual?.kind === 'custom' && !actual.erased && actual.type === 'DESIGN_RELATIONS' && canonicalStringify(actual) === canonicalStringify(preview.designChange.record) })())
    && (!preview.designChange || preview.designChange.members.every(expected => canonicalStringify(document.getObject(expected.id)) === canonicalStringify(expected)))
    && (!preview.designChange || (() => { const dictionary = document.getObject(preview.designChange.dictionary.id); return dictionary?.kind === 'dictionary' && dictionary.payload.entries?.[preview.designChange.dictionary.key] === preview.designChange.id })())
    && agentBlockDependenciesMatchDocument(document, preview.blockDependencies)
    && (preview.resources ?? []).every(expected => { const actual = document.getObject(expected.id); return actual?.kind === (expected.kind ?? 'table-record') && actual.type === expected.type && actual.name === expected.name && canonicalStringify(actual.payload) === canonicalStringify(expected.payload) })
    && preview.after.every(expected => {
      const actual = document.getObject(expected.id)
      return actual?.kind === 'entity' && canonicalStringify(project(actual)) === canonicalStringify(expected)
    })
    && preview.before.every(previous => retained.has(previous.id) || !document.getObject(previous.id))
}
