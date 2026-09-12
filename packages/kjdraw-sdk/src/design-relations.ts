import { KJValidationError } from './errors.js'
import { clone, normalizeName, stableHash } from './utils.js'
import { normalizeStandardEntityPayload } from './standard-entities.js'
import { projectDimension } from './geometry/annotation.js'
import { displayedEntityBounds } from './selection-geometry.js'
import type { KJDocument } from './document.js'
import type { KJTransaction } from './transaction.js'
import type { KJObjectPayload, KJObjectRecord, KJReadonlyObjectRecord } from './schema.js'

/** Bounded affine expressions, without source code, evaluation or arbitrary paths. */
export interface KJDesignExpression { constant: number; terms: { parameter: string; coefficient: number }[] }
export interface KJDesignParameter { name: string; value: number; min: number; max: number }
export interface KJDerivedDesignParameter { name: string; expression: KJDesignExpression }
export interface KJDesignBinding { entityId: string; path: string; expression: KJDesignExpression }
export interface KJDesignRequirement { name: string; expression: KJDesignExpression; min: number; max: number }
export interface KJDesignDefinition {
  parameters: KJDesignParameter[]
  derived: KJDerivedDesignParameter[]
  bindings: KJDesignBinding[]
  requirements: KJDesignRequirement[]
}
export interface KJDesignRelationView {
  id: string; name: string; units: string; definition: KJDesignDefinition
  values: Record<string, number>; entityIds: string[]; driftedEntityIds: string[]
}
const TYPE = 'DESIGN_RELATIONS'
const LIMIT = 1e12
function fail(message: string): never { throw new KJValidationError(`Design relations: ${message}`) }
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LIMIT
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected a plain object')
  const keys = Object.keys(value as object)
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) fail(`expected fields ${fields.join(', ')}`)
  return value as Record<string, unknown>
}
function list(value: unknown, max: number, nonempty = false): unknown[] {
  if (!Array.isArray(value) || value.length > max || nonempty && !value.length) fail(`expected an array of ${nonempty ? '1' : '0'}–${max} items`)
  return value as unknown[]
}
function expression(input: unknown): KJDesignExpression {
  const value = object(input, ['constant', 'terms'])
  if (!number(value.constant)) fail('invalid expression constant')
  const used = new Set<string>()
  const terms = list(value.terms, 64).map(item => {
    const term = object(item, ['parameter', 'coefficient'])
    if (!identifier(term.parameter) || !number(term.coefficient) || used.has(term.parameter)) fail('invalid or duplicate expression term')
    used.add(term.parameter)
    return { parameter: term.parameter, coefficient: term.coefficient }
  })
  return { constant: value.constant as number, terms }
}
function range(input: Record<string, unknown>): { min: number; max: number } {
  if (!number(input.min) || !number(input.max) || input.min > input.max) fail('invalid parameter or requirement range')
  return { min: input.min as number, max: input.max as number }
}
function definition(input: unknown): KJDesignDefinition {
  const value = object(input, ['parameters', 'derived', 'bindings', 'requirements'])
  const names = new Set<string>()
  const name = (input: unknown): string => {
    if (!identifier(input) || names.has(input)) fail('invalid or duplicate parameter name')
    names.add(input); return input
  }
  const parameters = list(value.parameters, 64, true).map(item => {
    const parameter = object(item, ['name', 'value', 'min', 'max'])
    const bounds = range(parameter)
    if (!number(parameter.value) || parameter.value < bounds.min || parameter.value > bounds.max) fail('parameter is outside its range')
    return { name: name(parameter.name), value: parameter.value as number, ...bounds }
  })
  const derived = list(value.derived, 64).map(item => {
    const parameter = object(item, ['name', 'expression'])
    return { name: name(parameter.name), expression: expression(parameter.expression) }
  })
  const paths = new Set<string>()
  const bindings = list(value.bindings, 256, true).map(item => {
    const binding = object(item, ['entityId', 'path', 'expression'])
    if (typeof binding.entityId !== 'string' || !binding.entityId || binding.entityId.length > 256 || typeof binding.path !== 'string' || binding.path.length > 80) fail('invalid binding target')
    const key = JSON.stringify([binding.entityId, binding.path])
    if (paths.has(key)) fail('multiple expressions write the same geometry field')
    paths.add(key)
    return { entityId: binding.entityId, path: binding.path, expression: expression(binding.expression) }
  })
  if (new Set(bindings.map(binding => binding.entityId)).size > 64) fail('at most 64 entities per design')
  const requirementNames = new Set<string>()
  const requirements = list(value.requirements, 64).map(item => {
    const requirement = object(item, ['name', 'expression', 'min', 'max'])
    if (!identifier(requirement.name) || requirementNames.has(requirement.name)) fail('invalid or duplicate requirement name')
    requirementNames.add(requirement.name)
    return { name: requirement.name, expression: expression(requirement.expression), ...range(requirement) }
  })
  const declared = new Set(names)
  const requireDefined = (scope: string, expr: KJDesignExpression): void => {
    const missing = expr.terms.map(term => term.parameter).filter(parameter => !declared.has(parameter))
    if (missing.length) fail(`under-defined ${scope}: missing parameter${missing.length === 1 ? '' : 's'} ${missing.join(', ')}`)
  }
  for (const parameter of derived) requireDefined(`derived parameter ${parameter.name}`, parameter.expression)
  for (const binding of bindings) requireDefined(`binding ${binding.entityId}.${binding.path}`, binding.expression)
  for (const requirement of requirements) requireDefined(`requirement ${requirement.name}`, requirement.expression)
  return { parameters, derived, bindings, requirements }
}
function resolve(model: KJDesignDefinition): Record<string, number> {
  const values: Record<string, number> = Object.create(null) as Record<string, number>
  for (const parameter of model.parameters) values[parameter.name] = parameter.value
  const pending = new Map(model.derived.map(parameter => [parameter.name, parameter.expression]))
  while (pending.size) {
    let progressed = false
    for (const [name, expr] of pending) if (expr.terms.every(term => Object.hasOwn(values, term.parameter))) {
      values[name] = evaluate(expr, values); pending.delete(name); progressed = true
    }
    if (!progressed) fail(`derived parameter dependency cycle: ${[...pending.keys()].join(', ')}`)
  }
  for (const requirement of model.requirements) {
    const actual = evaluate(requirement.expression, values)
    if (actual < requirement.min || actual > requirement.max) fail(`requirement ${requirement.name} failed: ${actual} outside [${requirement.min}, ${requirement.max}]`)
  }
  return values
}
function evaluate(expr: KJDesignExpression, values: Record<string, number>): number {
  let result = expr.constant
  for (const term of expr.terms) {
    if (!Object.hasOwn(values, term.parameter)) fail(`missing parameter ${term.parameter}`)
    result += values[term.parameter]! * term.coefficient
    if (!number(result)) fail('expression exceeds the numeric budget')
  }
  return result
}
function geometry(entity: KJReadonlyObjectRecord): Record<string, unknown> {
  const p = entity.payload
  const keys = entity.type === 'LINE' ? ['start', 'end'] : entity.type === 'CIRCLE' ? ['center', 'radius']
    : entity.type === 'LWPOLYLINE' ? ['vertices', 'closed', 'bulges', 'startWidths', 'endWidths', 'constantWidth', 'elevation']
      : entity.type === 'DIMENSION' ? ['definitionPoints', 'dimensionType', 'rotation', 'textOverride', 'blockName', 'textPosition'] : []
  if (!keys.length) fail(`unsupported entity type ${entity.type}`)
  return { type: entity.type, handle: entity.handle, ownerId: entity.ownerId, ...Object.fromEntries([...keys, 'normal', 'extrusion', 'extrusionDirection', 'dxfDimensionType', 'thickness'].map(key => [key, p[key] ?? null])) }
}
function target(tx: KJTransaction, id: string): KJObjectRecord {
  const entity = tx.getObject(id), state = tx._draft()
  if (!entity || entity.erased || entity.kind !== 'entity' || entity.ownerId !== state.spaces.modelSpaceId) fail(`missing live model-space entity ${id}`)
  geometry(entity!)
  const p = entity!.payload, layer = state.objects[String(p.layerId)]
  if (p.visible === false || p.locked === true || p.frozen === true || layer?.payload.locked === true || layer?.payload.frozen === true || layer?.payload.visible === false) fail(`entity ${id} is protected or hidden`)
  for (const key of ['normal', 'extrusion', 'extrusionDirection']) if (p[key] != null && stableHash(p[key]) !== stableHash([0, 0, 1])) fail('only default +Z geometry is supported')
  if (p.thickness != null && p.thickness !== 0) fail('thick geometry is unsupported')
  if (entity!.type === 'LWPOLYLINE' && (!Array.isArray(p.vertices) || p.vertices.length > 4096)) fail('polyline exceeds the vertex budget')
  if (entity!.type === 'DIMENSION' && (!['ALIGNED', 'LINEAR', 'ROTATED'].includes(String(p.dimensionType)) || p.blockName != null || p.textOverride != null)) fail('only native linear dimensions without overrides or cached blocks are supported')
  if (entity!.type === 'DIMENSION' && p.dxfDimensionType != null) {
    const code = p.dxfDimensionType
    if (typeof code !== 'number' || !Number.isSafeInteger(code) || code < 0 || code > 255 || (code & 7) !== (p.dimensionType === 'ALIGNED' ? 1 : 0)) fail('native dimension subtype conflicts with its named dimension type')
  }
  if (entity!.type === 'DIMENSION' && ((p.definitionPoints as number[][]).some(point => point[2] !== 0) || Array.isArray(p.textPosition) && p.textPosition[2] !== 0)) fail('dimensions require the native XY plane')
  const points = entity!.type === 'LINE' ? [p.start, p.end] : entity!.type === 'CIRCLE' ? [p.center]
    : entity!.type === 'LWPOLYLINE' ? (p.vertices as { point: unknown }[]).map(vertex => vertex.point)
      : [...(p.definitionPoints as unknown[]), ...(p.textPosition ? [p.textPosition] : [])]
  if (points.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(number))) fail('geometry exceeds the coordinate budget')
  geometry(entity!)
  return entity!
}
function field(payload: KJObjectPayload, type: string, path: string): { container: number[] | Record<string, unknown>; key: string | number } {
  if (type === 'CIRCLE' && path === 'radius') return { container: payload, key: 'radius' }
  const simple = /^(start|end|center)\.([01])$/.exec(path)
  const indexed = /^(vertices|definitionPoints)\.(0|[1-9][0-9]{0,3})\.([01])$/.exec(path)
  let point: unknown, axis: number
  if (simple && (type === 'LINE' && ['start', 'end'].includes(simple[1]!) || type === 'CIRCLE' && simple[1] === 'center')) {
    point = payload[simple[1]!]; axis = Number(simple[2])
  } else if (indexed && (type === 'LWPOLYLINE' && indexed[1] === 'vertices' || type === 'DIMENSION' && indexed[1] === 'definitionPoints')) {
    const points = payload[indexed[1]!]
    point = Array.isArray(points) ? points[Number(indexed[2])] : null; axis = Number(indexed[3])
  } else return fail(`unsupported geometry path ${path} for ${type}`)
  if (type === 'LWPOLYLINE' && point && typeof point === 'object' && !Array.isArray(point)) {
    const vertex = point as Record<string, unknown>
    point = vertex.point
  }
  if (!Array.isArray(point) || point.length !== 3 || !point.every(number)) fail(`invalid geometry point at ${path}`)
  return { container: point as number[], key: axis }
}
function getField(item: ReturnType<typeof field>): number { return (item.container as Record<string | number, unknown>)[item.key] as number }
function setField(item: ReturnType<typeof field>, value: number): void { (item.container as Record<string | number, unknown>)[item.key] = value }
function plan(document: KJDocument, tx: KJTransaction, model: KJDesignDefinition, values: Record<string, number>, match: boolean): KJObjectRecord[] {
  const entities = new Map<string, KJObjectRecord>()
  for (const binding of model.bindings) {
    let entity = entities.get(binding.entityId)
    if (!entity) { entity = target(tx, binding.entityId); entities.set(entity.id, entity) }
    const location = field(entity.payload, entity.type, binding.path), value = evaluate(binding.expression, values)
    if (match && Math.abs(getField(location) - value) > 1e-8) fail(`initial geometry does not satisfy ${binding.entityId}.${binding.path}`)
    setField(location, value)
  }
  for (const entity of entities.values()) {
    const normalized = normalizeStandardEntityPayload(entity.type, entity.payload)
    if (entity.type === 'LINE' && stableHash(normalized.start) === stableHash(normalized.end)) fail('parameter change collapses a line')
    if (entity.type === 'CIRCLE') {
      const center = normalized.center as number[], radius = Number(normalized.radius)
      if (!(radius > 1e-12) || !number(radius) || !center.every(number) || ![center[0]! - radius, center[0]! + radius, center[1]! - radius, center[1]! + radius].every(number)) fail('circle collapses or exceeds the coordinate budget')
    }
    if (entity.type === 'LWPOLYLINE') {
      const vertices = normalized.vertices as { point: number[] }[]
      for (let i = 1; i < vertices.length + (normalized.closed ? 1 : 0); i++) {
        const a = vertices[i - 1]!, b = vertices[i % vertices.length]!
        if (a.point[0] === b.point[0] && a.point[1] === b.point[1]) fail('parameter change collapses a polyline edge')
      }
    }
    if (entity.type === 'DIMENSION') {
      const projected = projectDimension(normalized)
      if (!projected) fail('parameter change creates an invalid dimension')
      normalized.measurement = projected.measurement
    }
    entity.payload = normalized
    const bounds = displayedEntityBounds(document, entity)
    if (!bounds || !Object.values(bounds).every(number)) fail('dependent geometry exceeds the display coordinate budget')
  }
  return [...entities.values()]
}
function records(document: KJDocument): KJReadonlyObjectRecord[] { return Object.values(document.snapshot().objects).filter(item => !item.erased && item.kind === 'custom' && item.type === TYPE) }
/** Persist a relation over already-correct native geometry. It never creates replacement entities. */
export function createDesignRelations(document: KJDocument, tx: KJTransaction, name: string, input: unknown, id?: string): KJObjectRecord {
  if (typeof name !== 'string' || !name.trim() || name.length > 128) fail('a design name of 1–128 characters is required')
  name = name.trim()
  if (id != null && (typeof id !== 'string' || !id.trim() || id.length > 256)) fail('invalid design object ID')
  const dictionaryId = tx._draft().namedObjectsDictionaryId
  if (Object.hasOwn(tx._draft().objects[dictionaryId]!.payload.entries ?? {}, normalizeName(`KJDRAW_DESIGN:${name}`))) fail('design name already exists in the drawing dictionary')
  const model = definition(input), values = resolve(model), entities = plan(document, tx, model, values, true)
  for (const record of Object.values(tx._draft().objects).filter(item => !item.erased && item.kind === 'custom' && item.type === TYPE)) {
    if (normalizeName(record.name) === normalizeName(name)) fail('design name already exists')
    const other = definition(record.payload.definition)
    if (other.bindings.some(binding => entities.some(entity => entity.id === binding.entityId))) fail('an entity already belongs to another design')
  }
  const record = tx.createObject({ ...(id == null ? {} : { id }), kind: 'custom', type: TYPE, ownerId: document.snapshot().namedObjectsDictionaryId, name,
    payload: { contractVersion: 1, units: tx._draft().header.units, definition: model, geometry: Object.fromEntries(entities.map(entity => [entity.id, geometry(target(tx, entity.id))])) } })
  tx.addDictionaryEntry(document.snapshot().namedObjectsDictionaryId, `KJDRAW_DESIGN:${name}`, record.id)
  return record
}
/** Atomically update parameters and all bound geometry. Manual geometry drift is a conflict. */
export function updateDesignRelations(document: KJDocument, tx: KJTransaction, id: string, changes: unknown): KJObjectRecord {
  const record = tx.getObject(id)
  if (!record || record.erased || record.kind !== 'custom' || record.type !== TYPE || record.payload.contractVersion !== 1) fail('live version-1 design does not exist')
  if (record!.payload.units !== tx._draft().header.units) fail('drawing units changed; rebind explicitly')
  const model = definition(record!.payload.definition)
  const keys = model.parameters.map(parameter => parameter.name)
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || ![Object.prototype, null].includes(Object.getPrototypeOf(changes))) fail('parameter changes must be a plain object')
  const patch = changes as Record<string, unknown>
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !keys.includes(key))) fail('only existing independent parameters may be changed')
  for (const parameter of model.parameters) if (Object.hasOwn(patch, parameter.name)) {
    const value = patch[parameter.name]
    if (!number(value) || value < parameter.min || value > parameter.max) fail(`parameter ${parameter.name} is outside its range`)
    parameter.value = value
  }
  const saved = record!.payload.geometry as Record<string, unknown>
  for (const entityId of new Set(model.bindings.map(binding => binding.entityId))) if (stableHash(geometry(target(tx, entityId))) !== stableHash(saved?.[entityId])) fail(`geometry conflict at ${entityId}; rebind the manually edited design explicitly`)
  const entities = plan(document, tx, model, resolve(model), false)
  if (stableHash(model) === stableHash(record!.payload.definition)) fail('parameter update makes no change')
  for (const entity of entities) tx.updateObject(entity.id, { payload: entity.payload })
  return tx.updateObject(record!.id, { payload: { definition: model, geometry: Object.fromEntries(entities.map(entity => [entity.id, geometry(entity)])) } })
}
/** Read persisted design parameters, evaluated dependencies and explicit geometry conflict IDs. */
export function readDesignRelations(document: KJDocument, ids?: readonly string[]): KJDesignRelationView[] {
  return records(document).filter(record => ids == null || ids.includes(record.id)).map(record => {
    if (record.payload.contractVersion !== 1) fail('unsupported design contract version')
    const model = definition(record.payload.definition), values = resolve(model), saved = record.payload.geometry as Record<string, unknown>
    const entityIds = [...new Set(model.bindings.map(binding => binding.entityId))]
    return { id: record.id, name: record.name!, units: String(record.payload.units), definition: clone(model), values: { ...values }, entityIds,
      driftedEntityIds: entityIds.filter(id => { const entity = document.getObject(id); try { return !entity || entity.erased || stableHash(geometry(entity)) !== stableHash(saved?.[id]) } catch { return true } }) }
  })
}
