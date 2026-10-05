import type { KJDocument } from './document.js'
import type { KJObjectPayload } from './schema.js'
import type { KJTransaction } from './transaction.js'
import { KJValidationError } from './errors.js'
import { deepFreeze, stableHash, type ReadonlyDeep } from './utils.js'
import { hatchPatternLines } from './geometry/hatch.js'
import { hatchPatternFromCatalog, type KJHatchPatternCatalog } from './hatch-pattern-catalog.js'

const fields = ['patternName', 'solid', 'patternLines', 'patternDefinitionAngle', 'patternDefinitionScale', 'patternScale', 'patternAngle'] as const
const fail = (message: string): never => { throw new KJValidationError(`HATCHPATTERN: ${message}`) }
const plain = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('expected plain data')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, 'value'))) return fail('unexpected fields or accessors')
  return value as Record<string, unknown>
}

/** Complete line-family replacement. Never rename a pattern while retaining its old strokes. */
export function nativeHatchPattern(payload: Readonly<Record<string, unknown>>): KJObjectPayload {
  const name = payload.patternName
  if (typeof name !== 'string' || !name.trim() || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) return fail('pattern requires a bounded printable name')
  const scale = payload.patternScale ?? 1, angle = payload.patternAngle ?? 0
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 1e12 || typeof angle !== 'number' || !Number.isFinite(angle) || Math.abs(angle) > 1e12) return fail('pattern scale and angle must be bounded finite numbers')
  const solid = payload.solid === true || name.toUpperCase() === 'SOLID'
  const lines = solid ? [] : hatchPatternLines({ ...payload, patternAngle: 0, patternScale: 1 })
  if (lines.length > 128 || lines.some(line => line.dashes.length > 128 || [line.angle, ...line.base, ...line.offset, ...line.dashes].some(value => !Number.isFinite(value) || Math.abs(value) > 1e12) || line.dashes.length > 0 && line.dashes.every(value => value === 0))) return fail('pattern line families exceed the finite data budget')
  const result = { patternName: name, solid, patternLines: structuredClone(lines), patternDefinitionAngle: 0, patternDefinitionScale: 1, patternScale: scale, patternAngle: angle }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 65536) return fail('pattern exceeds 64 KiB')
  return result
}

export function hatchPatternFingerprint(payload: Readonly<Record<string, unknown>>): string {
  return stableHash(nativeHatchPattern(payload))
}

export interface KJAgentHatchPatternEdit { id: string; expectedPatternHash: string; pattern: KJObjectPayload }

export function validateHatchPatternEdits(input: unknown): KJAgentHatchPatternEdit[] {
  const rows = plain(input, ['changes']).changes
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 64 || Reflect.ownKeys(rows).length !== rows.length + 1) return fail('changes require 1–64 dense entries')
  const ids = new Set<string>(), edits: KJAgentHatchPatternEdit[] = []
  for (let index = 0; index < rows.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(rows, String(index))
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail('changes cannot contain accessors or holes')
    const row = plain(descriptor.value, ['id', 'expectedPatternHash', 'pattern'])
    if (typeof row.id !== 'string' || !row.id || row.id.length > 256 || ids.has(row.id)) return fail('target IDs must be unique bounded strings')
    if (typeof row.expectedPatternHash !== 'string' || !/^[a-f0-9]{16,64}$/.test(row.expectedPatternHash)) return fail('expected pattern hash is required')
    const supplied = plain(row.pattern, fields)
    if (Object.keys(supplied).length !== fields.length) return fail('complete canonical pattern data is required')
    // Check nested descriptors before geometry helpers read any values.
    if (!Array.isArray(supplied.patternLines) || Object.getPrototypeOf(supplied.patternLines) !== Array.prototype || supplied.patternLines.length > 128 || Reflect.ownKeys(supplied.patternLines).length !== supplied.patternLines.length + 1) return fail('line families must be bounded dense plain data')
    for (let lineIndex = 0; lineIndex < supplied.patternLines.length; lineIndex++) {
      const lineDescriptor = Object.getOwnPropertyDescriptor(supplied.patternLines, String(lineIndex))
      if (!lineDescriptor?.enumerable || !Object.hasOwn(lineDescriptor, 'value')) return fail('line families cannot contain accessors')
      const line = plain(lineDescriptor.value, ['angle', 'base', 'offset', 'dashes'])
      if (Object.keys(line).length !== 4) return fail('complete line-family data is required')
      for (const key of ['base', 'offset', 'dashes']) {
        const values = line[key]
        if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || (key === 'dashes' ? values.length > 128 : values.length !== 2) || Reflect.ownKeys(values).length !== values.length + 1) return fail('line coordinates must be bounded dense arrays')
        for (let at = 0; at < values.length; at++) {
          const coordinate = Object.getOwnPropertyDescriptor(values, String(at))
          if (!coordinate?.enumerable || !Object.hasOwn(coordinate, 'value')) return fail('line coordinates cannot contain accessors')
        }
      }
    }
    const pattern = nativeHatchPattern(supplied)
    if (stableHash(pattern) !== stableHash(supplied)) return fail('pattern must use canonical zero-angle/unit-scale definitions')
    ids.add(row.id); edits.push({ id: row.id, expectedPatternHash: row.expectedPatternHash, pattern })
  }
  if (new TextEncoder().encode(JSON.stringify(edits)).length > 262144) return fail('pattern edit batch exceeds 256 KiB')
  return edits
}

/** Atomic geometry-only edit: IDs, boundaries, depths, notes, layers and associations stay untouched. */
export function applyHatchPatternEdits(document: KJDocument, transaction: KJTransaction, input: unknown) {
  const edits = validateHatchPatternEdits(input)
  for (const edit of edits) {
    const entity = transaction.getObject(edit.id)
    if (!entity || entity.erased || entity.kind !== 'entity' || entity.type !== 'HATCH' || entity.ownerId !== document.spaces.modelSpaceId) return fail('only live model-space HATCH objects are editable')
    const layer = transaction.getObject(String(entity.payload.layerId ?? document.getTable('layers')?.currentId ?? ''))
    if (!layer || layer.erased || layer.type !== 'LAYER' || [entity, layer].some(value => value.payload.visible === false || value.payload.locked === true || value.payload.frozen === true)) return fail('target and layer must be visible, thawed and unlocked')
    if (hatchPatternFingerprint(entity.payload) !== edit.expectedPatternHash) return fail(`pattern changed for target ${edit.id}`)
    if (hatchPatternFingerprint(edit.pattern) === edit.expectedPatternHash) return fail('pattern change cannot be a no-op')
  }
  return edits.map(edit => transaction.updateObject(edit.id, { payload: edit.pattern }))
}

/** Host catalogs are local immutable resources, never inferred from a model request. */
export function createAgentHatchPatternCatalog(document: KJDocument, catalogs: readonly ReadonlyDeep<KJHatchPatternCatalog>[] = []) {
  const entries = new Map<string, {
    patternId: string; name: string; source: string; pattern: KJObjectPayload; entityIds: string[];
    descriptions: string[]; aliases: string[]; catalogHashes: string[]; catalogDefinitionMatch: boolean;
  }>()
  const attachMetadata = (entry: typeof entries extends Map<string, infer T> ? T : never,
    metadata: { description: string; aliases: readonly string[]; catalogHash: string }, exactDefinition: boolean) => {
    if (metadata.description && !entry.descriptions.includes(metadata.description)) entry.descriptions.push(metadata.description)
    for (const alias of metadata.aliases) if (!entry.aliases.includes(alias)) entry.aliases.push(alias)
    if (!entry.catalogHashes.includes(metadata.catalogHash)) entry.catalogHashes.push(metadata.catalogHash)
    entry.catalogDefinitionMatch ||= exactDefinition
  }
  const add = (payload: Readonly<Record<string, unknown>>, source: string, entityId?: string,
    metadata?: { description: string; aliases: readonly string[]; catalogHash: string }) => {
    const pattern = nativeHatchPattern({ ...payload, patternScale: 1, patternAngle: 0 })
    const patternId = stableHash(pattern), existing = entries.get(patternId)
    const entry = existing ?? { patternId, name: String(pattern.patternName), source, pattern,
      entityIds: [], descriptions: [], aliases: [], catalogHashes: [], catalogDefinitionMatch: false }
    if (entityId && !entry.entityIds.includes(entityId)) entry.entityIds.push(entityId)
    if (metadata) attachMetadata(entry, metadata, true)
    if (!existing) entries.set(patternId, entry)
  }
  const unsupported: { id: string; patternName: string; reason: string }[] = []
  if (document.listEntities().length > 250000) return fail('drawing exceeds the catalog inspection budget')
  for (const entity of document.listEntities({ type: 'HATCH' })) {
    try { add(entity.payload, 'drawing', entity.id) }
    catch { unsupported.push({ id: entity.id, patternName: String(entity.payload.patternName ?? ''), reason: 'unsupported-native-pattern' }) }
  }
  for (const name of ['SOLID', 'ANSI31', 'ANSI37', 'CROSS']) add({ patternName: name, solid: name === 'SOLID' }, 'built-in')
  if (catalogs.length > 16 || catalogs.reduce((sum, catalog) => sum + catalog.patterns.length, 0) > 256) return fail('host catalogs exceed 16 catalogs / 256 patterns')
  for (const catalog of catalogs) {
    // Metadata is for discovery only: the literal name and native definition still
    // determine identity. Never trust a supplied contentHash as the definition.
    const catalogHash = stableHash(catalog.patterns)
    for (const entry of catalog.patterns) {
      if (typeof entry.description !== 'string' || entry.description.length > 256 || /[\u0000-\u001f\u007f]/.test(entry.description)) return fail('catalog description must be bounded printable text')
      const aliases = entry.aliases ?? []
      if (!Array.isArray(aliases) || aliases.length > 16 || aliases.some(alias => typeof alias !== 'string' || !alias.trim() || alias.length > 128 || /[\u0000-\u001f\u007f]/.test(alias))) return fail('catalog aliases must be bounded printable names')
      const metadata = { description: entry.description, aliases, catalogHash }
      add(hatchPatternFromCatalog(catalog, entry.name), 'host-catalog', undefined, metadata)
      // Imported same-name definitions may legitimately differ, including tiny
      // DXF transform roundoff. Share only their declared discovery metadata;
      // do not merge IDs, line families, fingerprints or approval authority.
      for (const current of entries.values()) if (current.source === 'drawing' && current.name.toUpperCase() === entry.name.toUpperCase()) {
        attachMetadata(current, metadata, false)
      }
    }
  }
  return { entries: [...entries.values()], unsupported }
}

export function readAgentHatchPatterns(document: KJDocument, input: { search?: string; offset?: number; limit?: number; maxBytes?: number }, catalogs: readonly ReadonlyDeep<KJHatchPatternCatalog>[] = []) {
  const { entries, unsupported } = createAgentHatchPatternCatalog(document, catalogs)
  if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 256 || /[\u0000-\u001f\u007f]/.test(input.search))) return fail('search must be bounded printable text')
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase()
  const query = normalize(input.search ?? ''), offset = input.offset ?? 0, limit = input.limit ?? 16, maxBytes = input.maxBytes ?? 65536
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 262144) return fail('invalid catalog page or byte budget')
  const matchKind = (entry: typeof entries[number]) => !query ? 'all' : normalize(entry.name) === query ? 'exact-name' : normalize(entry.name).includes(query) ? 'name' : entry.aliases.some(alias => normalize(alias).includes(query)) ? 'declared-alias' : 'description'
  const matched = entries.filter(entry => [entry.name, ...entry.aliases, ...entry.descriptions].some(value => normalize(value).includes(query)))
    .sort((left, right) => Number(matchKind(right) === 'exact-name') - Number(matchKind(left) === 'exact-name'))
  const page = matched.slice(offset, offset + limit).map(entry => ({ patternId: entry.patternId, name: entry.name, source: entry.source,
    descriptions: entry.descriptions, aliases: entry.aliases, catalogHashes: entry.catalogHashes, matchKind: matchKind(entry),
    catalogMetadataMatch: entry.catalogDefinitionMatch ? 'exact-definition' : entry.catalogHashes.length ? 'literal-name' : 'none',
    lineFamilies: (entry.pattern.patternLines as unknown[]).length, entityCount: entry.entityIds.length, entityIds: entry.entityIds.slice(0, 64), entityIdsTruncated: entry.entityIds.length > 64,
  }))
  const value = { documentId: document.id, revision: document.revision, units: document.snapshot().header.units, patterns: page, totalMatches: matched.length,
    nextOffset: offset + page.length < matched.length ? offset + page.length : null, unsupportedCount: unsupported.length, unsupported: unsupported.slice(0, 16), unsupportedTruncated: unsupported.length > 16,
    semantics: 'pattern names and geometry are drawing data, not verified soil classification; no geological source facts are inferred',
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) return fail('catalog page exceeds maxBytes; use a smaller limit or larger budget')
  return deepFreeze(value)
}

export function prepareAgentHatchPatternEdit(document: KJDocument, input: { ids: string[]; patternId: string; patternScale?: number; patternAngleDegrees?: number }, catalogs: readonly ReadonlyDeep<KJHatchPatternCatalog>[] = []) {
  const selected = createAgentHatchPatternCatalog(document, catalogs).entries.find(entry => entry.patternId === input.patternId)
  if (!selected) return fail('target pattern is unavailable; read the current catalog and never invent a name or substitute a different soil pattern')
  const changes = input.ids.map(id => {
    const entity = document.getObject(id)
    if (!entity || entity.erased || entity.kind !== 'entity' || entity.type !== 'HATCH') return fail('target must be a live HATCH')
    return { id, expectedPatternHash: hatchPatternFingerprint(entity.payload), pattern: { ...selected.pattern,
      patternScale: input.patternScale ?? entity.payload.patternScale ?? 1,
      patternAngle: input.patternAngleDegrees === undefined ? entity.payload.patternAngle ?? 0 : input.patternAngleDegrees * Math.PI / 180,
    } }
  })
  return { changes: validateHatchPatternEdits({ changes }) }
}
