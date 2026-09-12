import { KJValidationError } from './errors.js'
import type { KJDocument } from './document.js'
import type { KJObjectPayload, KJObjectRecord, KJReadonlyObjectRecord } from './schema.js'
import type { KJTransaction } from './transaction.js'
import { clone, deepFreeze, normalizeName, stableHash } from './utils.js'
import { createId } from './ids.js'

export const KJDRAW_COMPONENT_CATALOG_VERSION = '1.0.0'
export const KJDRAW_COMPONENT_SEARCH_MAX_LIMIT = 50
export const KJDRAW_COMPONENT_DEFINITION_MAX_ENTITIES = 64

export type KJComponentCategory = 'mechanical' | 'architecture' | 'electrical'
export type KJComponentLocale = 'en' | 'zh-CN'
export interface KJComponentLocalizedText { readonly en: string; readonly zh: string }
export interface KJComponentLicense { readonly spdx: 'Apache-2.0'; readonly source: string; readonly sourceUrl: string }
export interface KJComponentParameterDefinition {
  readonly name: string; readonly label: KJComponentLocalizedText; readonly default: number
  readonly minimum: number; readonly maximum: number; readonly integer?: boolean
  readonly unit: 'millimeter' | 'count' | 'degree'
}
export interface KJComponentCatalogEntry {
  readonly id: string; readonly version: string; readonly category: KJComponentCategory
  readonly title: KJComponentLocalizedText; readonly description: KJComponentLocalizedText
  readonly keywords: { readonly en: readonly string[]; readonly zh: readonly string[] }
  readonly nativeUnits: 'millimeter'; readonly license: KJComponentLicense
  readonly parameters: readonly KJComponentParameterDefinition[]
}
export interface KJComponentSearchInput { query?: unknown; category?: unknown; locale?: unknown; limit?: unknown; cursor?: unknown }
export interface KJComponentSearchResult {
  readonly catalogVersion: string; readonly query: string; readonly category: KJComponentCategory | null
  readonly locale: KJComponentLocale; readonly total: number; readonly limit: number
  readonly cursor: string | null; readonly nextCursor: string | null; readonly items: readonly KJComponentCatalogEntry[]
}
export interface KJComponentInsertInput {
  componentId?: unknown; version?: unknown; units?: unknown; parameters?: unknown; position?: unknown
  scale?: unknown; rotation?: unknown; layerId?: unknown; ownerId?: unknown; maxDefinitionEntities?: unknown; identity?: unknown
}
export interface KJComponentInsertIdentity { readonly definitionId: string; readonly memberIds: readonly string[]; readonly insertId: string }
export interface KJComponentInsertResult {
  readonly catalogVersion: string; readonly component: KJComponentCatalogEntry
  readonly parameters: Readonly<Record<string, number>>; readonly units: string
  readonly definitionId: string; readonly definitionName: string; readonly definitionReused: boolean
  readonly definitionEntityCount: number; readonly insert: KJReadonlyObjectRecord
}
interface KJComponentEntitySpec { type: string; payload: KJObjectPayload }
interface KJComponentDefinition extends KJComponentCatalogEntry {
  build(parameters: Readonly<Record<string, number>>, millimetersToDrawingUnits: number): readonly KJComponentEntitySpec[]
}

const LICENSE: KJComponentLicense = {
  spdx: 'Apache-2.0', source: 'KJDraw original component catalog', sourceUrl: 'https://github.com/KanJieTeam/kjdraw',
}
const line = (x1: number, y1: number, x2: number, y2: number): KJComponentEntitySpec => ({ type: 'LINE', payload: { start: [x1, y1, 0], end: [x2, y2, 0] } })
const circle = (x: number, y: number, radius: number): KJComponentEntitySpec => ({ type: 'CIRCLE', payload: { center: [x, y, 0], radius } })

const DEFINITIONS: readonly KJComponentDefinition[] = deepFreeze([
  {
    id: 'org.kjdraw.mechanical.four-hole-flange', version: '1.0.0', category: 'mechanical',
    title: { en: 'Four-hole mounting flange', zh: '四孔安装法兰' },
    description: { en: 'Parametric circular flange with bore and equally spaced mounting holes.', zh: '带中心孔和等距安装孔的参数化圆形法兰。' },
    keywords: { en: ['flange', 'mount', 'bearing', 'bolt circle', 'machine'], zh: ['法兰', '安装', '轴承', '螺栓孔', '机械'] },
    nativeUnits: 'millimeter', license: LICENSE,
    parameters: [
      { name: 'outerDiameter', label: { en: 'Outer diameter', zh: '外径' }, default: 120, minimum: 20, maximum: 5000, unit: 'millimeter' },
      { name: 'boreDiameter', label: { en: 'Bore diameter', zh: '中心孔径' }, default: 50, minimum: 1, maximum: 4000, unit: 'millimeter' },
      { name: 'boltCircleDiameter', label: { en: 'Bolt circle diameter', zh: '分度圆直径' }, default: 90, minimum: 5, maximum: 4500, unit: 'millimeter' },
      { name: 'holeDiameter', label: { en: 'Hole diameter', zh: '安装孔径' }, default: 12, minimum: .5, maximum: 500, unit: 'millimeter' },
      { name: 'holeCount', label: { en: 'Hole count', zh: '安装孔数量' }, default: 4, minimum: 3, maximum: 16, integer: true, unit: 'count' },
    ],
    build(p, factor) {
      const outer = p.outerDiameter! / 2 * factor, bore = p.boreDiameter! / 2 * factor
      const bolt = p.boltCircleDiameter! / 2 * factor, hole = p.holeDiameter! / 2 * factor
      const result = [circle(0, 0, outer), circle(0, 0, bore)]
      for (let index = 0; index < p.holeCount!; index++) {
        const angle = Math.PI * 2 * index / p.holeCount!
        result.push(circle(Math.cos(angle) * bolt, Math.sin(angle) * bolt, hole))
      }
      return result
    },
  },
  {
    id: 'org.kjdraw.architecture.single-swing-door', version: '1.0.0', category: 'architecture',
    title: { en: 'Single swing door', zh: '单扇平开门' },
    description: { en: 'Plan symbol with jambs, door leaf and exact swing arc.', zh: '包含门垛、门扇和精确开启弧线的平面符号。' },
    keywords: { en: ['door', 'single', 'swing', 'plan', 'architecture'], zh: ['门', '单扇', '平开门', '平面', '建筑'] },
    nativeUnits: 'millimeter', license: LICENSE,
    parameters: [
      { name: 'width', label: { en: 'Opening width', zh: '门洞宽度' }, default: 900, minimum: 400, maximum: 5000, unit: 'millimeter' },
      { name: 'wallThickness', label: { en: 'Wall thickness', zh: '墙厚' }, default: 200, minimum: 50, maximum: 2000, unit: 'millimeter' },
      { name: 'swingDegrees', label: { en: 'Swing angle', zh: '开启角度' }, default: 90, minimum: 15, maximum: 180, unit: 'degree' },
    ],
    build(p, factor) {
      const width = p.width! * factor, wall = p.wallThickness! * factor, angle = p.swingDegrees! * Math.PI / 180
      return [line(0, -wall / 2, 0, wall / 2), line(width, -wall / 2, width, wall / 2),
        line(0, 0, Math.cos(angle) * width, Math.sin(angle) * width),
        { type: 'ARC', payload: { center: [0, 0, 0], radius: width, startAngle: 0, endAngle: angle, clockwise: false } }]
    },
  },
  {
    id: 'org.kjdraw.electrical.duplex-receptacle', version: '1.0.0', category: 'electrical',
    title: { en: 'Duplex receptacle', zh: '双联电源插座' },
    description: { en: 'General electrical plan symbol for a duplex receptacle.', zh: '用于电气平面图的通用双联插座符号。' },
    keywords: { en: ['outlet', 'socket', 'receptacle', 'power', 'electrical'], zh: ['插座', '电源', '双联', '电气', '强电'] },
    nativeUnits: 'millimeter', license: LICENSE,
    parameters: [{ name: 'symbolDiameter', label: { en: 'Symbol diameter', zh: '符号直径' }, default: 8, minimum: 2, maximum: 200, unit: 'millimeter' }],
    build(p, factor) {
      const radius = p.symbolDiameter! / 2 * factor
      return [circle(0, 0, radius), line(-radius * .55, -radius * .55, -radius * .55, radius * .55),
        line(radius * .55, -radius * .55, radius * .55, radius * .55), line(-radius, 0, radius, 0)]
    },
  },
] satisfies readonly KJComponentDefinition[])

const PUBLIC_CATALOG: readonly KJComponentCatalogEntry[] = deepFreeze(DEFINITIONS.map(({ build: _build, ...entry }) => entry))
const BY_ID = new Map(DEFINITIONS.map(entry => [entry.id, entry]))
const DRAWING_UNITS_PER_MILLIMETER: Readonly<Record<string, number>> = Object.freeze({
  millimeter: 1, mm: 1, centimeter: .1, cm: .1, meter: .001, m: .001,
  inch: 1 / 25.4, foot: 1 / 304.8, 'us-survey-foot': 3937 / 1_200_000,
})
function fail(message: string): never { throw new KJValidationError(`COMPONENT: ${message}`) }
function finite(value: unknown, label: string, minimum = -1e12, maximum = 1e12): number {
  const result = Number(value)
  if (!Number.isFinite(result) || result < minimum || result > maximum) fail(`${label} must be finite from ${minimum} to ${maximum}`)
  return result
}
function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = finite(value, label, minimum, maximum)
  if (!Number.isInteger(result)) fail(`${label} must be an integer`)
  return result
}
function exactKeys(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (value == null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  const result = value as Record<string, unknown>, unknown = Object.keys(result).find(key => !allowed.includes(key))
  if (unknown) fail(`${label} contains unsupported field: ${unknown}`)
  return result
}

export function listComponentCatalog(): readonly KJComponentCatalogEntry[] { return PUBLIC_CATALOG }
export function searchComponentCatalog(input: KJComponentSearchInput = {}): KJComponentSearchResult {
  const query = String(input.query ?? '').trim()
  if (query.length > 128) fail('search query must contain at most 128 characters')
  const locale = input.locale == null ? 'en' : String(input.locale) as KJComponentLocale
  if (!['en', 'zh-CN'].includes(locale)) fail('locale must be en or zh-CN')
  const category = input.category == null || String(input.category).trim() === '' ? null : String(input.category).toLowerCase() as KJComponentCategory
  if (category !== null && !['mechanical', 'architecture', 'electrical'].includes(category)) fail('category must be mechanical, architecture or electrical')
  const limit = input.limit == null ? 20 : integer(input.limit, 'limit', 1, KJDRAW_COMPONENT_SEARCH_MAX_LIMIT)
  const cursor = input.cursor == null || input.cursor === '' ? 0 : integer(input.cursor, 'cursor', 0, Number.MAX_SAFE_INTEGER)
  const needle = query.toLocaleLowerCase()
  const matches = PUBLIC_CATALOG.filter(entry => (!category || entry.category === category) && (!needle ||
    [entry.id, entry.category, entry.title.en, entry.title.zh, entry.description.en, entry.description.zh, ...entry.keywords.en, ...entry.keywords.zh]
      .some(value => value.toLocaleLowerCase().includes(needle))))
  if (cursor > matches.length) fail('cursor is outside the result set')
  const items = matches.slice(cursor, cursor + limit), next = cursor + items.length
  return deepFreeze({ catalogVersion: KJDRAW_COMPONENT_CATALOG_VERSION, query, category, locale, total: matches.length, limit,
    cursor: cursor ? String(cursor) : null, nextCursor: next < matches.length ? String(next) : null, items })
}

function resolveComponent(input: KJComponentInsertInput): KJComponentDefinition {
  const id = String(input.componentId ?? '').trim(), result = BY_ID.get(id)
  if (!result) fail(`unknown component id: ${id || '(empty)'}`)
  const version = String(input.version ?? result.version)
  if (version !== result.version) fail(`component ${id} version ${version} is unavailable; available version is ${result.version}`)
  return result
}
function resolveParameters(definition: KJComponentDefinition, input: unknown): Readonly<Record<string, number>> {
  const supplied = exactKeys(input, definition.parameters.map(parameter => parameter.name), 'parameters'), values: Record<string, number> = {}
  for (const parameter of definition.parameters) {
    const value = finite(supplied[parameter.name] ?? parameter.default, `parameter ${parameter.name}`, parameter.minimum, parameter.maximum)
    if (parameter.integer && !Number.isInteger(value)) fail(`parameter ${parameter.name} must be an integer`)
    values[parameter.name] = value
  }
  if (definition.id.endsWith('four-hole-flange')) {
    if (!(values.boreDiameter! < values.boltCircleDiameter! && values.boltCircleDiameter! < values.outerDiameter!)) fail('flange diameters must satisfy bore < bolt circle < outer diameter')
    if (values.boltCircleDiameter! + values.holeDiameter! >= values.outerDiameter!) fail('flange holes must remain inside the outer diameter')
    if (values.boltCircleDiameter! - values.holeDiameter! <= values.boreDiameter!) fail('flange holes must remain outside the bore')
  }
  return Object.freeze(values)
}
function point3(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) fail('position must contain two or three coordinates')
  return [finite(value[0], 'position x'), finite(value[1], 'position y'), value.length === 3 ? finite(value[2], 'position z') : 0]
}
function definitionName(definition: KJComponentDefinition, units: string, values: Readonly<Record<string, number>>): string {
  const slug = definition.id.split('.').at(-1)!.replace(/[^a-z0-9]+/gi, '_').toUpperCase().slice(0, 40)
  return `KJCOMP_${slug}_${stableHash([definition.id, definition.version, units, values]).toUpperCase()}`
}
function componentMetadata(definition: KJComponentDefinition, units: string, values: Readonly<Record<string, number>>, entityCount: number): KJObjectPayload {
  return { contractVersion: 1, catalogVersion: KJDRAW_COMPONENT_CATALOG_VERSION, componentId: definition.id, componentVersion: definition.version,
    units, parameters: clone(values), license: clone(definition.license), entityCount }
}

function componentIdentity(value: unknown, entityCount: number): KJComponentInsertIdentity | null {
  if (value == null) return null
  const source = exactKeys(value, ['definitionId', 'memberIds', 'insertId'], 'identity')
  const definitionId = String(source.definitionId ?? ''), insertId = String(source.insertId ?? ''), memberIds = source.memberIds
  if (!definitionId || !insertId || !Array.isArray(memberIds) || memberIds.length !== entityCount || memberIds.some(id => typeof id !== 'string' || !id)) fail('identity must contain a definition ID, insert ID and one member ID per definition entity')
  if (new Set([definitionId, insertId, ...memberIds]).size !== entityCount + 2) fail('identity IDs must be unique')
  return deepFreeze({ definitionId, memberIds: [...memberIds], insertId })
}

/** Allocate one stable internal identity before an AI proposal is previewed and approved. */
export function createCatalogComponentInsertIdentity(document: KJDocument, input: KJComponentInsertInput): KJComponentInsertIdentity {
  const definition = resolveComponent(input), state = document.snapshot(), units = String(input.units ?? '')
  if (!units || units !== state.header.units) fail('units must exactly match drawing units')
  const factor = DRAWING_UNITS_PER_MILLIMETER[normalizeName(units).toLowerCase()]
  if (!(factor != null && factor > 0)) fail(`drawing unit is not supported for physical components: ${units}`)
  const values = resolveParameters(definition, input.parameters), count = definition.build(values, factor).length
  if (!count || count > KJDRAW_COMPONENT_DEFINITION_MAX_ENTITIES) fail(`component definition requires ${count} entities`)
  const name = definitionName(definition, units, values)
  const existing = state.tables.blockRecords.recordIds.map(id => state.objects[id]).find(record => normalizeName(record?.name) === normalizeName(name))
  const memberIds = existing?.kind === 'block-record' && !existing.erased && Array.isArray(existing.payload.entityIds)
    ? existing.payload.entityIds.map(String)
    : Array.from({ length: count }, () => createId('entity'))
  return deepFreeze({ definitionId: existing?.id ?? createId('block'), memberIds, insertId: createId('entity') })
}

/** Insert one catalog item through native BLOCK_RECORD members and INSERT in the caller's transaction. */
export function insertCatalogComponent(_document: KJDocument, transaction: KJTransaction, input: KJComponentInsertInput): KJComponentInsertResult {
  const definition = resolveComponent(input), state = transaction._draft(), units = String(input.units ?? '')
  if (!units || units !== state.header.units) fail('units must exactly match drawing units')
  const factor = DRAWING_UNITS_PER_MILLIMETER[normalizeName(units).toLowerCase()]
  if (!(factor != null && factor > 0)) fail(`drawing unit is not supported for physical components: ${units}`)
  const values = resolveParameters(definition, input.parameters), position = point3(input.position ?? [0, 0, 0])
  const scale = finite(input.scale ?? 1, 'scale', 1e-6, 1e6), rotation = finite(input.rotation ?? 0, 'rotation', -Math.PI * 2, Math.PI * 2)
  const budget = input.maxDefinitionEntities == null ? KJDRAW_COMPONENT_DEFINITION_MAX_ENTITIES : integer(input.maxDefinitionEntities, 'maxDefinitionEntities', 1, KJDRAW_COMPONENT_DEFINITION_MAX_ENTITIES)
  const ownerId = input.ownerId == null ? state.spaces.modelSpaceId : String(input.ownerId)
  if (ownerId !== state.spaces.modelSpaceId) fail('first component-library slice inserts into model space only')
  const layerId = input.layerId == null ? state.tables.layers.currentId : String(input.layerId), targetLayer = layerId == null ? null : transaction.getObject(layerId)
  if (!targetLayer || targetLayer.kind !== 'table-record' || targetLayer.type !== 'LAYER' || targetLayer.erased) fail('target layer must be a live layer')
  const targetLayerId = targetLayer.id
  const protectedReason = targetLayer.payload.locked === true ? 'locked' : targetLayer.payload.frozen === true ? 'frozen' : targetLayer.payload.visible === false ? 'hidden' : null
  if (protectedReason) fail(`target layer ${targetLayer.name ?? targetLayer.id} is ${protectedReason}`)
  const zeroLayerId = state.tables.layers.recordIds.find(id => normalizeName(state.objects[id]?.name) === '0')
  if (!zeroLayerId) fail('drawing has no Layer 0 for component definitions')
  const specs = definition.build(values, factor).map(spec => ({ type: spec.type, payload: { ...clone(spec.payload), layerId: zeroLayerId } }))
  if (!specs.length || specs.length > budget) fail(`component definition requires ${specs.length} entities but budget is ${budget}`)
  const identity = componentIdentity(input.identity, specs.length)
  const name = definitionName(definition, units, values), expectedMetadata = componentMetadata(definition, units, values, specs.length)
  const existing = state.tables.blockRecords.recordIds.map(id => transaction.getObject(id)).find(record => normalizeName(record?.name) === normalizeName(name)) ?? null
  let block: KJObjectRecord, reused = false
  if (existing) {
    if (existing.kind !== 'block-record' || existing.erased || existing.payload.isSpace === true || stableHash(existing.payload.component) !== stableHash(expectedMetadata)) fail(`block definition name collision: ${name}`)
    const members = existing.payload.entityIds ?? []
    if (members.length !== specs.length || members.some(id => !transaction.getObject(id) || transaction.getObject(id)?.erased)) fail(`component block definition is incomplete: ${name}`)
    if (identity && (identity.definitionId !== existing.id || identity.memberIds.some((id, index) => id !== members[index]))) fail('identity does not match the reusable component definition')
    block = existing; reused = true
  } else {
    block = transaction.upsertTableRecord('blockRecords', { ...(identity ? { id: identity.definitionId } : {}), name, type: 'BLOCK_RECORD', payload: { entityIds: [], isSpace: false, basePoint: [0, 0, 0], component: expectedMetadata } })
    for (const [index, spec] of specs.entries()) transaction.createEntity(spec.type, spec.payload, { ownerId: block.id, ...(identity ? { id: identity.memberIds[index]! } : {}) })
  }
  const insert = transaction.createEntity('INSERT', { blockRecordId: block.id, position, scale: [scale, scale, scale], rotation, attributes: {}, layerId: targetLayerId }, { ownerId, ...(identity ? { id: identity.insertId } : {}) })
  return deepFreeze({ catalogVersion: KJDRAW_COMPONENT_CATALOG_VERSION, component: PUBLIC_CATALOG.find(entry => entry.id === definition.id)!, parameters: values,
    units, definitionId: block.id, definitionName: name, definitionReused: reused, definitionEntityCount: specs.length, insert })
}
