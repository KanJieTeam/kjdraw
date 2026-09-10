import type { KJDocument } from './document.js'
import type { KJRoadDesignInput } from './road-design.js'
import { buildRoadDrawing, type KJRoadDrawingOptions, type KJRoadDrawingResult } from './road-drawing.js'
import { KJRevisionConflictError, KJValidationError } from './errors.js'
import { deepFreeze, type ReadonlyDeep } from './utils.js'

export interface KJAgentRoadDrawingInput extends KJRoadDesignInput {
  expectedRevision: number
  drawingId: string
  title: string
  profileScale: KJRoadDrawingOptions['profileScale']
  sectionScale: KJRoadDrawingOptions['sectionScale']
  textHeight: number
  sectionColumns: number
  precision: number
}
export interface KJAgentRoadDrawingProposal {
  commandArgs: {
    entities: (KJRoadDrawingResult['entities'][number] & { options: { id: string; ownerId: string } })[]
    resources: KJRoadDrawingResult['resources']
  }
  evidence: {
    drawingId: string
    units: 'meter'
    expectedRevision: number
    entityCount: number
    /** Exact validated source parameters for host-managed recovery after approval. */
    designParameters: { input: KJRoadDesignInput; options: KJRoadDrawingOptions }
    calculation: KJRoadDrawingResult['calculation']
    frames: ReadonlyDeep<KJRoadDrawingResult['frames']>
    bounds: ReadonlyDeep<KJRoadDrawingResult['bounds']>
    projections: ReadonlyDeep<KJRoadDrawingResult['projections']>
    limitations: readonly string[]
  }
}

const fail = (message: string): never => { throw new KJValidationError(`Road proposal: ${message}`) }
const fields = ['expectedRevision', 'units', 'drawingId', 'title', 'startStation', 'alignment', 'profile', 'sections', 'pavement', 'slopes', 'profileScale', 'sectionScale', 'textHeight', 'sectionColumns', 'precision']

// Bound and snapshot untrusted tool input before reading its fields. Accessors, toJSON,
// sparse arrays and conversion hooks must never execute while compiling a proposal.
function snapshot(value: unknown): KJAgentRoadDrawingInput {
  let nodes = 0, characters = 0
  const active = new Set<object>()
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 30000 || depth > 12) fail('input traversal budget exceeded')
    if (typeof item === 'string') { if ((characters += item.length) > 1048576) fail('input text budget exceeded'); return item }
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item
    if (!item || typeof item !== 'object') return fail('input requires finite plain JSON data')
    const array = Array.isArray(item)
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype) && !(Object.getPrototypeOf(item) === null && !array)) fail('input requires plain objects and arrays')
    if (active.has(item)) fail('cyclic input')
    const keys = Reflect.ownKeys(item), result: Record<string, unknown> | unknown[] = array ? [] : {}
    if (keys.length > 30000) fail('input key budget exceeded')
    active.add(item)
    for (const key of keys) {
      if (array && key === 'length') continue
      const d = Object.getOwnPropertyDescriptor(item, key)!
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) || !d.enumerable || !('value' in d) || array && !/^(0|[1-9]\d*)$/.test(key)) fail('input contains unsafe properties or accessors')
      ;(result as Record<string, unknown>)[key as string] = visit(d.value, depth + 1)
    }
    if (array && keys.length - 1 !== (item as unknown[]).length) fail('input arrays must be dense')
    active.delete(item)
    return result
  }
  const copied = visit(value, 0)
  if (!copied || typeof copied !== 'object' || Array.isArray(copied) || Object.keys(copied).length !== fields.length || fields.some(field => !Object.hasOwn(copied, field))) fail('all specified road input fields are required; extra fields are forbidden')
  if (new TextEncoder().encode(JSON.stringify(copied)).length > 1048576) fail('input exceeds 1 MiB')
  return copied as KJAgentRoadDrawingInput
}

/** Pure revision-bound proposal compilation. No commands, document writes, preview approval,
 * terrain inference, network requests, or automatic associative updates are performed here.
 * A trusted host must preview the full CREATEBATCH and require approval before executing it.
 */
export function buildAgentRoadDrawing(document: KJDocument, input: KJAgentRoadDrawingInput): ReadonlyDeep<KJAgentRoadDrawingProposal> {
  const data = snapshot(input), state = document.snapshot()
  if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) fail('expectedRevision must be a nonnegative safe integer')
  if (document.revision !== data.expectedRevision) throw new KJRevisionConflictError(data.expectedRevision, document.revision)
  if (data.units !== 'meter' || state.header.units !== 'meter') fail('input and document must both use meter units')
  const ownerId = state.spaces.modelSpaceId, owner = state.objects[ownerId]
  if (!owner || owner.erased || owner.kind !== 'block-record' || owner.payload.isSpace !== true) fail('a valid document model space is required')
  if (!Array.isArray(data.sections) || data.sections.length < 2 || data.sections.length > 64) fail('supply 2–64 explicitly defined cross sections')
  if (data.sections.reduce((count, section) => count + (Array.isArray(section?.ground) ? section.ground.length : 4097), 0) > 4096) fail('ground data exceeds the 4096-point agent budget')
  // Drawing generation enforces exact model geometry, projected-coordinate and entity budgets.
  const { units, startStation, alignment, profile, sections, pavement, slopes, drawingId, title, profileScale, sectionScale, textHeight, sectionColumns, precision } = data
  const designParameters = { input: { units, startStation, alignment, profile, sections, pavement, slopes }, options: { drawingId, title, profileScale, sectionScale, textHeight, sectionColumns, precision, maxEntities: 512 } }
  const drawing = buildRoadDrawing(designParameters.input, designParameters.options)
  if (drawing.entities.length > 512) fail('proposal exceeds the 512 entity limit')
  const prefix = `road:${drawingId}:`
  if (Object.keys(state.objects).some(id => id.startsWith(prefix))) fail('drawingId already has document objects; choose a new drawingId for a new drawing')
  for (const table of ['linetypes', 'layers'] as const) {
    const existing = new Set(document.getTable(table)!.records.map(record => String(record.name).toUpperCase()))
    if (drawing.resources[table].some(resource => Object.hasOwn(state.objects, resource.id) || existing.has(resource.name.toUpperCase()))) fail('drawing resource IDs or names already exist')
  }
  const commandArgs = {
    entities: drawing.entities.map(entity => ({ ...structuredClone(entity), options: { id: entity.options.id, ownerId } })),
    resources: structuredClone(drawing.resources),
  } as KJAgentRoadDrawingProposal['commandArgs']
  const evidence: KJAgentRoadDrawingProposal['evidence'] = { drawingId, units, expectedRevision: data.expectedRevision, entityCount: drawing.entities.length, designParameters, calculation: drawing.calculation, frames: structuredClone(drawing.frames), bounds: [...drawing.bounds], projections: structuredClone(drawing.projections), limitations: drawing.limitations }
  if (new TextEncoder().encode(JSON.stringify(commandArgs)).length > 4194304) fail('command data exceeds 4 MiB')
  if (new TextEncoder().encode(JSON.stringify(evidence)).length > 262144) fail('calculation evidence exceeds 256 KiB')
  if (document.snapshot() !== state || document.revision !== data.expectedRevision) throw new KJRevisionConflictError(data.expectedRevision, document.revision)
  return deepFreeze({ commandArgs, evidence })
}
