import { KJValidationError } from './errors.js'
import { deepFreeze, stableHash, type ReadonlyDeep } from './utils.js'

export const KJDRAW_KNOWLEDGE_PACK_SCHEMA = 'kjdraw.knowledge-pack.v1' as const
export const KJDRAW_SEMANTIC_IR_SCHEMA = 'kjdraw.semantic-ir.v1' as const

export interface KJKnowledgePackSource {
  id: string
  title: string
  license: string
  contentHash: string
  uri?: string
}

export interface KJKnowledgePack {
  schema: typeof KJDRAW_KNOWLEDGE_PACK_SCHEMA
  id: string
  version: string
  title: string
  domain: string
  license: { spdx: string; redistributable: boolean; trainingAllowed: boolean }
  sources: KJKnowledgePackSource[]
  ontology: { objectKinds: string[]; relationKinds: string[] }
  templates?: Record<string, unknown>
  rules?: Record<string, unknown>
}

export interface KJSemanticDrawingIntent {
  schema: typeof KJDRAW_SEMANTIC_IR_SCHEMA
  packId: string
  packVersion: string
  drawing: { kind: string; title: string; units: 'millimeter' | 'meter' }
  objects: { id: string; kind: string; properties: Record<string, unknown> }[]
  relations: { kind: string; from: string; to: string; properties?: Record<string, unknown> }[]
}

const fail = (message: string): never => { throw new KJValidationError(`Knowledge pack: ${message}`) }
const idPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
const hashPattern = /^[a-f0-9]{16,128}$/i
const forbiddenKeys = new Set(['rawDrawing', 'dwg', 'dxf', 'binary', 'entities'])

function plain(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`)
  return value as Record<string, unknown>
}
function boundedText(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must be printable text`) 
  return String(value).trim()
}
function stringList(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== 'string' || !String(item).trim())) fail(`${label} must be a bounded string list`)
  const result = (value as unknown[]).map(item => String(item).trim())
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates`)
  return result
}
function scan(value: unknown, label: string, depth = 0, nodes = { count: 0 }): void {
  if (++nodes.count > 20_000 || depth > 12) fail(`${label} exceeds the data budget`)
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach((item, index) => scan(item, `${label}[${index}]`, depth + 1, nodes)); return }
  const record = plain(value, label)
  for (const key of Object.keys(record)) {
    if (forbiddenKeys.has(key)) fail(`${label}.${key} is not allowed in semantic knowledge`)
    scan(record[key], `${label}.${key}`, depth + 1, nodes)
  }
}

export function validateKnowledgePack(source: unknown): ReadonlyDeep<KJKnowledgePack> {
  const pack = plain(source, 'pack')
  scan(pack, 'pack')
  if (pack.schema !== KJDRAW_KNOWLEDGE_PACK_SCHEMA) fail(`schema must be ${KJDRAW_KNOWLEDGE_PACK_SCHEMA}`)
  const id = boundedText(pack.id, 'pack.id', 64), version = boundedText(pack.version, 'pack.version', 32)
  if (!idPattern.test(id)) fail('pack.id must be a stable lowercase identifier')
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) fail('pack.version must be semver-like')
  const license = plain(pack.license, 'pack.license')
  if (typeof license.redistributable !== 'boolean' || typeof license.trainingAllowed !== 'boolean') fail('pack.license must declare redistributable and trainingAllowed')
  const sourcesRaw = pack.sources
  if (!Array.isArray(sourcesRaw) || sourcesRaw.length < 1 || sourcesRaw.length > 256) fail('pack.sources must contain 1-256 entries')
  const sources = (sourcesRaw as unknown[]).map((raw: unknown, index: number) => {
    const row = plain(raw, `pack.sources[${index}]`), sourceId = boundedText(row.id, `pack.sources[${index}].id`, 64)
    if (!idPattern.test(sourceId)) fail(`pack.sources[${index}].id must be a stable lowercase identifier`)
    const contentHash = boundedText(row.contentHash, `pack.sources[${index}].contentHash`, 128)
    if (!hashPattern.test(contentHash)) fail(`pack.sources[${index}].contentHash must be a hex hash`)
    return { id: sourceId, title: boundedText(row.title, `pack.sources[${index}].title`), license: boundedText(row.license, `pack.sources[${index}].license`, 64), contentHash, ...(row.uri == null ? {} : { uri: boundedText(row.uri, `pack.sources[${index}].uri`, 512) }) }
  })
  if (new Set(sources.map(sourceRow => sourceRow.id)).size !== sources.length) fail('pack.sources IDs must be unique')
  const ontology = plain(pack.ontology, 'pack.ontology')
  const result: KJKnowledgePack = {
    schema: KJDRAW_KNOWLEDGE_PACK_SCHEMA, id, version, title: boundedText(pack.title, 'pack.title'), domain: boundedText(pack.domain, 'pack.domain', 64),
    license: { spdx: boundedText(license.spdx, 'pack.license.spdx', 64), redistributable: license.redistributable as boolean, trainingAllowed: license.trainingAllowed as boolean },
    sources, ontology: { objectKinds: stringList(ontology.objectKinds, 'pack.ontology.objectKinds', 512), relationKinds: stringList(ontology.relationKinds, 'pack.ontology.relationKinds', 512) },
    ...(pack.templates == null ? {} : { templates: plain(pack.templates, 'pack.templates') }), ...(pack.rules == null ? {} : { rules: plain(pack.rules, 'pack.rules') }),
  }
  scan(result, 'pack')
  return deepFreeze(result)
}

export function validateSemanticDrawingIntent(source: unknown, pack?: KJKnowledgePack): ReadonlyDeep<KJSemanticDrawingIntent> {
  const input = plain(source, 'intent')
  if (input.schema !== KJDRAW_SEMANTIC_IR_SCHEMA) fail(`intent.schema must be ${KJDRAW_SEMANTIC_IR_SCHEMA}`)
  const packId = boundedText(input.packId, 'intent.packId', 64), packVersion = boundedText(input.packVersion, 'intent.packVersion', 32)
  if (pack && (pack.id !== packId || pack.version !== packVersion)) fail('intent pack identity does not match the selected pack')
  const drawing = plain(input.drawing, 'intent.drawing')
  if (drawing.units !== 'millimeter' && drawing.units !== 'meter') fail('intent.drawing.units must be millimeter or meter')
  const objectsRaw = input.objects
  if (!Array.isArray(objectsRaw) || objectsRaw.length < 1 || objectsRaw.length > 2048) fail('intent.objects must contain 1-2048 semantic objects')
  const objects = (objectsRaw as unknown[]).map((raw: unknown, index: number) => {
    const row = plain(raw, `intent.objects[${index}]`), id = boundedText(row.id, `intent.objects[${index}].id`, 128), kind = boundedText(row.kind, `intent.objects[${index}].kind`, 96), properties = plain(row.properties, `intent.objects[${index}].properties`)
    if (!idPattern.test(id.replace(/:/g, '-'))) fail(`intent.objects[${index}].id must be stable`) 
    if (pack && !pack.ontology.objectKinds.includes(kind)) fail(`intent.objects[${index}].kind is not declared by the pack`)
    return { id, kind, properties }
  })
  if (new Set(objects.map(object => object.id)).size !== objects.length) fail('intent object IDs must be unique')
  const objectIds = new Set(objects.map(object => object.id)), relationsRaw = input.relations
  if (!Array.isArray(relationsRaw) || relationsRaw.length > 4096) fail('intent.relations must contain 0-4096 relations')
  const relations = (relationsRaw as unknown[]).map((raw: unknown, index: number) => {
    const row = plain(raw, `intent.relations[${index}]`), kind = boundedText(row.kind, `intent.relations[${index}].kind`, 96), from = boundedText(row.from, `intent.relations[${index}].from`, 128), to = boundedText(row.to, `intent.relations[${index}].to`, 128)
    if (!objectIds.has(from) || !objectIds.has(to)) fail(`intent.relations[${index}] references an unknown object`)
    if (pack && !pack.ontology.relationKinds.includes(kind)) fail(`intent.relations[${index}].kind is not declared by the pack`)
    return { kind, from, to, ...(row.properties == null ? {} : { properties: plain(row.properties, `intent.relations[${index}].properties`) }) }
  })
  const result: KJSemanticDrawingIntent = { schema: KJDRAW_SEMANTIC_IR_SCHEMA, packId, packVersion, drawing: { kind: boundedText(drawing.kind, 'intent.drawing.kind', 96), title: boundedText(drawing.title, 'intent.drawing.title', 256), units: drawing.units as 'millimeter' | 'meter' }, objects, relations }
  scan(result, 'intent')
  return deepFreeze(result)
}

export class KJKnowledgePackRegistry {
  readonly #packs = new Map<string, ReadonlyDeep<KJKnowledgePack>>()
  register(source: unknown): ReadonlyDeep<KJKnowledgePack> {
    const pack = validateKnowledgePack(source)
    if (!pack.license.redistributable) fail(`pack ${pack.id}@${pack.version} is not redistributable`) 
    const key = `${pack.id}@${pack.version}`
    if (this.#packs.has(key)) fail(`pack ${key} is already registered`)
    this.#packs.set(key, pack)
    return pack
  }
  get(id: string, version?: string): ReadonlyDeep<KJKnowledgePack> | undefined {
    const key = version ? `${id}@${version}` : [...this.#packs.keys()].filter(item => item.startsWith(`${id}@`)).sort().at(-1)
    return key ? this.#packs.get(key) : undefined
  }
  list(): readonly ReadonlyDeep<KJKnowledgePack>[] { return [...this.#packs.values()] }
  contentHash(): string { return stableHash(this.list()) }
}
