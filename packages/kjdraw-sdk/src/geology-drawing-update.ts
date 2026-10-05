import type { KJDocument } from './document.js'
import { KJValidationError } from './errors.js'
import { createCommandEditScope } from './edit-policy.js'
import { compileGeologyColumn, compileGeologySection } from './geology-engineering.js'
import type { KJGeologyColumnInput, KJGeologySectionInput } from './geology-engineering.js'
import type { KJKnowledgeCompileResult } from './knowledge-compiler.js'
import { createObjectRecord } from './schema.js'
import type { KJObjectRecord } from './schema.js'
import { normalizeStandardEntityPayload } from './standard-entities.js'
import { canonicalStringify, deepFreeze, stableHash, type ReadonlyDeep } from './utils.js'

export type KJGeologyDrawingSource =
  | { kind: 'column'; input: KJGeologyColumnInput }
  | { kind: 'section'; input: KJGeologySectionInput }

/** Host-owned source facts, not facts inferred from imported CAD annotations. */
export interface KJGeologyDrawingRecipe {
  schema: 'com.kanjie.kjdraw.geology-drawing-recipe'
  version: 1
  compilerVersion: 1
  documentId: string
  drawingId: string
  source: KJGeologyDrawingSource
  entityIds: string[]
  resourceRoot: string
  textStyleId: string
}

export interface KJGeologyDrawingRevisionOptions { expectedRevision: number }
/** Read-only diagnostic, never approval or authority to overwrite manual edits. */
export interface KJGeologyDrawingInspection {
  documentId: string
  revision: number
  drawingId: string
  recipe: ReadonlyDeep<KJGeologyDrawingRecipe>
  sourceGeometryConsistent: boolean
  conflicts: { kind: 'resource' | 'entity'; id: string; reason: 'missing' | 'owner-membership' | 'record-changed' }[]
  conflictTypes: { id: string; generatedType: string; actualType: string | null }[]
}
export interface KJGeologyDrawingRevision {
  recipe: ReadonlyDeep<KJGeologyDrawingRecipe>
  previousRevision: number
  revision: number
  createdIds: string[]
  removedIds: string[]
  unchangedIds: string[]
  before: KJObjectRecord[]
  after: KJObjectRecord[]
  evidence: ReadonlyDeep<KJKnowledgeCompileResult['evidence']>
}

function fail(message: string): never { throw new KJValidationError(`Geology drawing update: ${message}`) }
const equal = (a: unknown, b: unknown): boolean => canonicalStringify(a) === canonicalStringify(b)
const recipeKey = (id: string): string => `geology-drawing-recipe:${id}`

// Validate before cloning: reject getters, cycles, nonfinite values and excessive
// data, including embedded style/hatch packs. These are data, never executable code.
function snapshot<T>(input: T): T {
  let nodes = 0, characters = 0
  const path = new Set<object>()
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 150000 || depth > 32) fail('source data budget exceeded')
    if (value === null || typeof value === 'boolean') return
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('nonfinite source value'); return }
    if (typeof value === 'string') { if ((characters += value.length) > 2000000) fail('source text budget exceeded'); return }
    if (!value || typeof value !== 'object' || path.has(value)) fail('source must be finite acyclic plain data')
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) fail('source arrays must be dense plain data')
    } else if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('source must be plain data')
    path.add(value)
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor.enumerable || !('value' in descriptor)) fail('accessors and non-data properties are forbidden')
      if (Array.isArray(value) && (String(Number(key)) !== key || !Number.isSafeInteger(Number(key)) || Number(key) < 0 || Number(key) >= value.length)) fail('source arrays must contain indexed data only')
      visit(descriptor.value, depth + 1)
    }
    path.delete(value)
  }
  visit(input, 0)
  return structuredClone(input)
}

function compile(source: KJGeologyDrawingSource): ReadonlyDeep<KJKnowledgeCompileResult> {
  if (!source || !equal(Object.keys(source).sort(), ['input', 'kind'])) fail('source requires kind and input only')
  if (source.kind === 'column') return compileGeologyColumn(source.input)
  if (source.kind === 'section') return compileGeologySection(source.input)
  return fail('only explicit column or section source facts are supported')
}

function remap(value: unknown, root: string, target: string): unknown {
  if (typeof value === 'string') return value.startsWith(`${root}-`) ? target + value.slice(root.length) : value
  if (Array.isArray(value)) return value.map(item => remap(item, root, target))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, root, target)]))
  return value
}

function records(document: KJDocument, result: ReadonlyDeep<KJKnowledgeCompileResult>, root: string, textStyleId: string, entityIds: readonly string[]) {
  if (result.commandArgs.entities.length > 8192 || entityIds.length !== result.commandArgs.entities.length || new Set(entityIds).size !== entityIds.length) fail('invalid generated entity identity map')
  const resources = result.commandArgs.resources as ReadonlyDeep<KJKnowledgeCompileResult['commandArgs']['resources']> & {
    textStyles?: readonly { id: string; name: string; payload: Record<string, unknown> }[]
  }
  const sourceRoot = result.evidence.rootObjectId
  const resourceRecords: KJObjectRecord[] = []
  for (const type of resources.linetypes) resourceRecords.push(createObjectRecord({
    id: String(remap(type.id, sourceRoot, root)), kind: 'table-record', type: 'LINETYPE',
    // Preserve the existing host resource name; only source facts may change.
    name: `GEO_${stableHash(root).toUpperCase()}_CONT`,
    payload: { description: '', pattern: [...type.pattern], totalPatternLength: type.pattern.reduce((sum, item) => sum + Math.abs(item), 0), dxfFlags: 0 },
  }))
  for (const layer of resources.layers) {
    const id = String(remap(layer.id, sourceRoot, root)), linetypeId = String(remap(layer.linetypeId, sourceRoot, root))
    resourceRecords.push(createObjectRecord({ id, kind: 'table-record', type: 'LAYER', name: layer.name,
      payload: { color: layer.color, linetypeId, linetypeName: resourceRecords.find(item => item.id === linetypeId)!.name,
        lineweight: layer.lineweight, visible: true, frozen: false, locked: false, plottable: true } }))
  }
  for (const style of resources.textStyles ?? []) resourceRecords.push(createObjectRecord({
    id: String(remap(style.id, sourceRoot, root)), kind: 'table-record', type: 'TEXT_STYLE', name: style.name, payload: structuredClone(style.payload),
  }))
  const entities = result.commandArgs.entities.map((spec, index) => {
    const payload = structuredClone(spec.payload) as Record<string, unknown>
    for (const key of ['layerId', 'linetypeId', 'styleId']) if (typeof payload[key] === 'string') payload[key] = remap(payload[key], sourceRoot, root)
    if (['TEXT', 'MTEXT'].includes(spec.type) && payload.styleId === undefined) payload.styleId = textStyleId
    return createObjectRecord({ id: entityIds[index]!, kind: 'entity', type: spec.type, ownerId: document.spaces.modelSpaceId,
      payload: normalizeStandardEntityPayload(spec.type, payload) })
  })
  return { entities, resources: resourceRecords }
}

function sameRecord(a: unknown, b: KJObjectRecord): boolean {
  return !!a && typeof a === 'object' && equal({ ...a, handle: '' }, b)
}

function expectedRecipeRecords(document: KJDocument, recipe: KJGeologyDrawingRecipe) {
  const keys = ['schema', 'version', 'compilerVersion', 'documentId', 'drawingId', 'source', 'entityIds', 'resourceRoot', 'textStyleId']
  if (!equal(Object.keys(recipe).sort(), keys.sort()) || recipe.schema !== 'com.kanjie.kjdraw.geology-drawing-recipe' || recipe.version !== 1 || recipe.compilerVersion !== 1) fail('unsupported recipe format')
  if (recipe.documentId !== document.id || document.snapshot().header.units !== 'millimeter') fail('recipe document or units do not match')
  const textStyle = document.getObject(recipe.textStyleId)
  if (!/^geo-[a-zA-Z0-9_-]{1,100}$/.test(recipe.drawingId) || recipe.resourceRoot !== recipe.drawingId ||
    !textStyle || textStyle.erased || textStyle.kind !== 'table-record' || textStyle.type !== 'TEXT_STYLE' ||
    !document.snapshot().tables.textStyles.recordIds.includes(recipe.textStyleId)) fail('invalid recipe identity or text style')
  if (!Array.isArray(recipe.entityIds) || recipe.entityIds.some(id => typeof id !== 'string' || !id.startsWith(`${recipe.drawingId}-entity-`) || id.length > 200)) fail('invalid recipe entity IDs')
  const compiled = compile(recipe.source)
  const expected = records(document, compiled, recipe.resourceRoot, recipe.textStyleId, recipe.entityIds)
  const state = document.snapshot(), model = new Set(state.objects[document.spaces.modelSpaceId]!.payload.entityIds)
  return { expected, state, model }
}

function validateRecipe(document: KJDocument, recipe: KJGeologyDrawingRecipe) {
  const { expected, state, model } = expectedRecipeRecords(document, recipe)
  for (const record of expected.resources) {
    const table = record.type === 'LAYER' ? state.tables.layers : record.type === 'LINETYPE' ? state.tables.linetypes : state.tables.textStyles
    if (!table.recordIds.includes(record.id) || !sameRecord(document.getObject(record.id), record)) fail(`generated resource changed: ${record.id}`)
  }
  for (const entity of expected.entities) if (!model.has(entity.id) || !sameRecord(document.getObject(entity.id), entity)) fail(`generated object changed: ${entity.id}; reconcile manual edits before rebuilding`)
  return expected
}

/** Bind supplied source facts to an existing, exactly matching compiler drawing. */
export function createGeologyDrawingRecipe(document: KJDocument, source: KJGeologyDrawingSource): ReadonlyDeep<KJGeologyDrawingRecipe> {
  const input = snapshot(source), compiled = compile(input), root = compiled.evidence.rootObjectId
  const textStyleId = document.getTable('textStyles')?.currentId
  if (!textStyleId) fail('current text style is missing')
  const recipe: KJGeologyDrawingRecipe = { schema: 'com.kanjie.kjdraw.geology-drawing-recipe', version: 1, compilerVersion: 1,
    documentId: document.id, drawingId: root, resourceRoot: root, textStyleId, source: input,
    entityIds: compiled.commandArgs.entities.map(spec => spec.options.id) }
  validateRecipe(document, recipe)
  return deepFreeze(recipe)
}

/** Explicit host registration. The source data travels with KJD and undo history. */
export async function registerGeologyDrawingRecipe(document: KJDocument, source: KJGeologyDrawingSource, options: KJGeologyDrawingRevisionOptions): Promise<ReadonlyDeep<KJGeologyDrawingRecipe>> {
  const safeOptions = snapshot(options)
  if (!equal(Object.keys(safeOptions), ['expectedRevision']) || !Number.isSafeInteger(safeOptions.expectedRevision) || safeOptions.expectedRevision < 0) fail('registration requires an explicit nonnegative expectedRevision')
  const recipe = createGeologyDrawingRecipe(document, source)
  await document.transact('Register geology source facts', tx => {
    if (Object.hasOwn(document.snapshot().opaquePayloads, recipeKey(recipe.drawingId))) fail('source recipe is already registered')
    tx.putOpaquePayload(recipeKey(recipe.drawingId), recipe)
  }, { expectedRevision: safeOptions.expectedRevision, source: 'geology-source-registration' })
  return recipe
}

export function readGeologyDrawingRecipe(document: KJDocument, drawingId: string): ReadonlyDeep<KJGeologyDrawingRecipe> {
  const recipe = snapshot(document.snapshot().opaquePayloads[recipeKey(drawingId)]) as KJGeologyDrawingRecipe
  if (!recipe) fail('no source-backed geology recipe; do not infer borehole facts from CAD text')
  if (recipe.drawingId !== drawingId) fail('recipe key and drawing identity do not match')
  validateRecipe(document, recipe)
  return deepFreeze(recipe)
}

/** Inspect all generated conflicts without treating unrelated manual CAD as source.
 * Malformed/foreign recipes still reject. Revision preparation retains its strict
 * validator and rejects drift even after this read-only diagnostic succeeds. */
export function inspectGeologyDrawingRecipe(document: KJDocument, drawingId: string, options: KJGeologyDrawingRevisionOptions): ReadonlyDeep<KJGeologyDrawingInspection> {
  const safeOptions = snapshot(options)
  if (!equal(Object.keys(safeOptions), ['expectedRevision']) || !Number.isSafeInteger(safeOptions.expectedRevision) || safeOptions.expectedRevision !== document.revision) fail('stale or invalid expected revision')
  const retained = document.snapshot().opaquePayloads[recipeKey(drawingId)]
  if (!retained) fail('no source-backed geology recipe; do not infer borehole facts from CAD text')
  const recipe = snapshot(retained) as KJGeologyDrawingRecipe
  if (recipe.drawingId !== drawingId) fail('recipe key and drawing identity do not match')
  const { expected, state, model } = expectedRecipeRecords(document, recipe)
  const conflicts: KJGeologyDrawingInspection['conflicts'] = []
  const conflictTypes: KJGeologyDrawingInspection['conflictTypes'] = []
  const addConflict = (kind: 'resource' | 'entity', record: KJObjectRecord, reason: 'missing' | 'owner-membership' | 'record-changed') => {
    conflicts.push({ kind, id: record.id, reason })
    const actual = state.objects[record.id]
    conflictTypes.push({ id: record.id, generatedType: record.type, actualType: actual && !actual.erased ? actual.type : null })
  }
  for (const record of expected.resources) {
    const table = record.type === 'LAYER' ? state.tables.layers : record.type === 'LINETYPE' ? state.tables.linetypes : state.tables.textStyles
    const actual = document.getObject(record.id)
    if (!actual) addConflict('resource', record, 'missing')
    else if (!table.recordIds.includes(record.id)) addConflict('resource', record, 'owner-membership')
    else if (!sameRecord(actual, record)) addConflict('resource', record, 'record-changed')
  }
  for (const record of expected.entities) {
    const actual = document.getObject(record.id)
    if (!actual) addConflict('entity', record, 'missing')
    else if (!model.has(record.id)) addConflict('entity', record, 'owner-membership')
    else if (!sameRecord(actual, record)) addConflict('entity', record, 'record-changed')
  }
  return deepFreeze({ documentId: document.id, revision: document.revision, drawingId,
    recipe, sourceGeometryConsistent: conflicts.length === 0, conflicts, conflictTypes })
}

/** Compile a data revision without changing the document or approving anything. */
export function prepareGeologyDrawingRevision(document: KJDocument, previous: ReadonlyDeep<KJGeologyDrawingRecipe>, next: KJGeologyDrawingSource, options: KJGeologyDrawingRevisionOptions): ReadonlyDeep<KJGeologyDrawingRevision> {
  const safe = snapshot({ previous, next, options })
  if (!equal(Object.keys(safe.options), ['expectedRevision']) || !Number.isSafeInteger(safe.options.expectedRevision) || safe.options.expectedRevision !== document.revision) fail('stale or invalid expected revision')
  const recipe = safe.previous as KJGeologyDrawingRecipe
  if (safe.next.kind !== recipe.source.kind) fail('drawing kind cannot change')
  if (equal(recipe.source, safe.next)) fail('source facts have not changed')
  const before = validateRecipe(document, recipe), compiled = compile(safe.next)
  // Freeze style/layout inputs: this API edits source facts, not resource styles.
  const temporaryIds = compiled.commandArgs.entities.map((_, index) => `${recipe.drawingId}-entity-r${document.revision + 1}-${index}`)
  const after = records(document, compiled, recipe.resourceRoot, recipe.textStyleId, temporaryIds)
  if (!equal(before.resources, after.resources)) fail('resource style changes require a separate explicit workflow')
  const available = new Map<string, KJObjectRecord[]>()
  const signature = (record: KJObjectRecord): string => canonicalStringify({ type: record.type, payload: record.payload })!
  for (const entity of before.entities) {
    const key = signature(entity), bucket = available.get(key) ?? []
    bucket.push(entity); available.set(key, bucket)
  }
  const unchangedIds: string[] = [], createdIds: string[] = [], retained = new Set<string>()
  for (const entity of after.entities) {
    const match = available.get(signature(entity))?.shift()
    if (match) { entity.id = match.id; unchangedIds.push(match.id); retained.add(match.id) }
    else {
      if (document.getObject(entity.id)) fail(`new generated ID collision: ${entity.id}`)
      createdIds.push(entity.id)
    }
  }
  // Only exact unchanged native objects keep their IDs. Changed generated objects
  // are explicitly removed/created, never assigned a guessed semantic identity.
  const removedIds = before.entities.filter(item => !retained.has(item.id)).map(item => item.id)
  if (!removedIds.length && !createdIds.length) fail('source change does not alter supported drawing output')
  const removed = new Set(removedIds), owned = new Set(recipe.entityIds)
  const refers = (value: unknown): boolean => typeof value === 'string' ? removed.has(value) : !!value && typeof value === 'object' && Object.values(value).some(refers)
  for (const object of document.listObjects()) {
    if (owned.has(object.id)) continue
    const payload = object.id === document.spaces.modelSpaceId ? Object.fromEntries(Object.entries(object.payload).filter(([key]) => key !== 'entityIds')) : object.payload
    if (refers([object.ownerId, payload, object.extension, object.source])) fail(`external object refers to changed geometry: ${object.id}`)
  }
  for (const [key, value] of Object.entries(document.snapshot().opaquePayloads)) if (key !== recipeKey(recipe.drawingId) && refers(value)) fail(`external payload refers to changed geometry: ${key}`)
  const stored = document.snapshot().opaquePayloads[recipeKey(recipe.drawingId)]
  if (stored !== undefined && !equal(stored, recipe)) fail('registered source facts have changed')
  const nextRecipe = { ...recipe, source: safe.next, entityIds: after.entities.map(item => item.id) } as KJGeologyDrawingRecipe
  return deepFreeze({ recipe: nextRecipe, previousRevision: document.revision, revision: document.revision + 1,
    createdIds, removedIds, unchangedIds, before: before.entities.filter(item => removed.has(item.id)),
    after: after.entities.filter(item => createdIds.includes(item.id)), evidence: compiled.evidence })
}

/** One source-and-geometry transaction, including native HATCH and undo history. */
export async function applyGeologyDrawingRevision(document: KJDocument, previous: ReadonlyDeep<KJGeologyDrawingRecipe>, next: KJGeologyDrawingSource, options: KJGeologyDrawingRevisionOptions): Promise<ReadonlyDeep<KJGeologyDrawingRevision>> {
  const result = prepareGeologyDrawingRevision(document, previous, next, options)
  await document.transact('Update geology source facts and drawing', native => {
    const scope = createCommandEditScope(native, 'GEOLOGY_DRAWING_UPDATE'), tx = scope.transaction
    for (const id of result.removedIds) tx.eraseObject(id, { hard: true })
    for (const entity of result.after) tx.createEntity(entity.type, structuredClone(entity.payload) as KJObjectRecord['payload'], { id: entity.id!, ownerId: entity.ownerId! })
    tx.putOpaquePayload(recipeKey(result.recipe.drawingId), result.recipe)
    scope.validate()
  }, { expectedRevision: options.expectedRevision, source: 'geology-drawing-update', metadata: { drawingId: result.recipe.drawingId } })
  return result
}
