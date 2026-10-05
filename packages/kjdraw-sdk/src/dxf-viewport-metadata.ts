import { KJValidationError } from './errors.js'
import type { KJDocumentState } from './schema.js'
import { clone, stableHash } from './utils.js'
import type { ReadonlyDeep } from './utils.js'

export const DXF_VIEWPORT_METADATA_KEY = 'dxf:viewport-metadata:v1'
export const DXF_VIEWPORT_METADATA_UNSUPPORTED_KEY = 'dxf:viewport-metadata-unsupported:v1'
interface Tag { code: number; value: string }
interface RecordData { type: string; tags: readonly Tag[] }
interface Metadata {
  schema: 'kjdraw.dxf.viewport-metadata.v1'
  sourceVersion: string
  rootHandle: string | null
  rootEntries: { name: string; code: number; handle: string }[]
  records: RecordData[]
  entityReferences: { handle: string; id: string }[]
  viewports: { id: string; fingerprint: string }[]
}
const handle = (record: RecordData): string => record.tags.find(tag => tag.code === 5)?.value.toUpperCase() ?? ''
const referenceCode = (code: number): boolean => code >= 320 && code <= 369 || code >= 390 && code <= 399 || code === 480 || code === 481
const references = (record: RecordData): string[] => record.tags.filter(tag => referenceCode(tag.code) && tag.value !== '0').map(tag => tag.value.toUpperCase())
const fail = (message: string): never => { throw new KJValidationError('DXF viewport metadata: ' + message) }

function viewportReferences(tags: readonly Tag[]): { handle: string; type: 'DICTIONARY' | 'VISUALSTYLE' | null }[] {
  const result: { handle: string; type: 'DICTIONARY' | 'VISUALSTYLE' | null }[] = []
  let group: string | null = null
  for (const tag of tags) {
    if (tag.code === 102) {
      if (tag.value === '}') { if (!group) return fail('unbalanced reference group'); group = null }
      else {
        if (group || !['{ACAD_XDICTIONARY', '{ACAD_REACTORS'].includes(tag.value)) return fail('unsupported reference group')
        group = tag.value
      }
    } else if ((group && referenceCode(tag.code) || !group && tag.code === 348) && tag.value !== '0') {
      const key = tag.value.toUpperCase()
      if (!/^[0-9A-F]{1,32}$/.test(key)) return fail('invalid viewport reference handle')
      if (group === '{ACAD_XDICTIONARY' && tag.code !== 360 || group === '{ACAD_REACTORS' && tag.code !== 330) return fail('unsupported viewport reference code')
      result.push({ handle: key, type: group === '{ACAD_XDICTIONARY' ? 'DICTIONARY' : !group ? 'VISUALSTYLE' : null })
    }
  }
  if (group) return fail('unterminated reference group')
  return result
}

/** Capture only the complete metadata graph reached by a viewport extension
 * dictionary/reactor. Values are opaque data, never executable or geological facts. */
export function captureViewportMetadata(state: ReadonlyDeep<KJDocumentState>, objects: readonly RecordData[], viewports: readonly { id: string; record: RecordData }[]): Metadata | null {
  const roots: string[] = [], owners: Metadata['viewports'] = []
  for (const item of viewports) {
    const linked = viewportReferences(item.record.tags)
    roots.push(...linked.map(reference => reference.handle))
    if (linked.length) owners.push({ id: item.id, fingerprint: stableHash(state.objects[item.id]!.payload) })
  }
  if (!roots.length) return null
  const byHandle = new Map<string, RecordData>()
  for (const record of objects) {
    const key = handle(record)
    if (!key) continue
    if (byHandle.has(key)) return fail('duplicate source object handle')
    byHandle.set(key, record)
  }
  const entityHandles = new Map<string, string>()
  for (const object of Object.values(state.objects)) {
    const source = object.source && typeof object.source === 'object' ? (object.source as Readonly<Record<string, unknown>>).originalHandle : undefined
    if (object.kind !== 'entity' || typeof source !== 'string' || !source) continue
    const key = source.toUpperCase()
    entityHandles.set(key, entityHandles.has(key) ? '' : object.id)
  }
  const selected = new Map<string, RecordData>(), entityReferences = new Map<string, string>()
  let rootHandle: string | null = null
  const visit = (key: string, depth = 0): void => {
    if (depth > 64) return fail('reference graph nesting exceeds 64')
    if (key === '0' || selected.has(key) || entityReferences.has(key) || key === rootHandle) return
    if (!/^[0-9A-F]{1,32}$/.test(key)) return fail('invalid reference handle')
    const entityId = entityHandles.get(key)
    if (entityId) { entityReferences.set(key, entityId); return }
    const record = byHandle.get(key)
    if (!record) return fail('referenced object is unavailable')
    if (!['DICTIONARY', 'XRECORD', 'SCALE', 'VISUALSTYLE'].includes(record.type)) return fail('referenced object type is unsupported: ' + record.type)
    if (record.type === 'DICTIONARY' && record.tags.some(tag => tag.code === 330 && tag.value === '0')) {
      if (rootHandle && rootHandle !== key) return fail('multiple source root dictionaries')
      rootHandle = key; return
    }
    if (selected.size >= 4096 || record.tags.length > 8192) return fail('reference graph exceeds its bounded budget')
    // XDATA handle references have a separate meaning and are not guessed.
    if (record.tags.some(tag => tag.code >= 1000)) return fail('referenced object contains unsupported XDATA')
    selected.set(key, record)
    for (const reference of references(record)) visit(reference, depth + 1)
  }
  roots.forEach(root => visit(root))
  for (const item of viewports) for (const reference of viewportReferences(item.record.tags)) {
    if (reference.type && selected.get(reference.handle)?.type !== reference.type) return fail('viewport reference needs ' + reference.type)
  }
  const rootEntries: Metadata['rootEntries'] = []
  if (rootHandle) {
    const tags = byHandle.get(rootHandle)!.tags
    for (let i = 0; i < tags.length - 1; i++) {
      const tag = tags[i]!, next = tags[i + 1]!
      if (tag.code === 3 && [350, 360].includes(next.code) && selected.has(next.value.toUpperCase())) {
        if (!tag.value || tag.value.length > 255 || tag.value.toUpperCase() === 'ACAD_LAYOUT') return fail('unsupported source root entry')
        rootEntries.push({ name: tag.value, code: next.code, handle: next.value.toUpperCase() })
      }
    }
  }
  const result: Metadata = { schema: 'kjdraw.dxf.viewport-metadata.v1', sourceVersion: state.header.sourceVersion,
    rootHandle, rootEntries, records: [...selected.values()].map(record => clone(record)),
    entityReferences: [...entityReferences].map(([handle, id]) => ({ handle, id })), viewports: owners }
  if (JSON.stringify(result).length > 2 * 1024 * 1024) return fail('reference graph exceeds 2 MiB')
  return result
}

/** Validate stored metadata again after KJD reopen or caller edits. Refuse a
 * stale/erased target rather than writing dangling handles or stripping data. */
export function prepareViewportMetadata(state: KJDocumentState): Metadata | null {
  if (state.opaquePayloads[DXF_VIEWPORT_METADATA_UNSUPPORTED_KEY] != null) return fail('unsupported source metadata is preserved for viewing but cannot be safely exported')
  const input = state.opaquePayloads[DXF_VIEWPORT_METADATA_KEY]
  if (input == null) return null
  if (JSON.stringify(input).length > 2 * 1024 * 1024) return fail('stored graph exceeds 2 MiB')
  const metadata = input as Metadata
  if (metadata.schema !== 'kjdraw.dxf.viewport-metadata.v1' || !Array.isArray(metadata.records) || metadata.records.length > 4096 ||
      !Array.isArray(metadata.viewports) || !Array.isArray(metadata.entityReferences) || !Array.isArray(metadata.rootEntries)) return fail('invalid stored graph')
  if (typeof metadata.sourceVersion !== 'string' || metadata.sourceVersion !== state.header.sourceVersion) return fail('stored source version is inconsistent')
  if (metadata.rootHandle !== null && (typeof metadata.rootHandle !== 'string' || !/^[0-9A-F]{1,32}$/.test(metadata.rootHandle))) return fail('invalid root handle')
  const handles = new Set<string>()
  const types = new Map<string, string>()
  const occupied = new Set(Object.values(state.objects).map(object => object.handle))
  for (const record of metadata.records) {
    if (!['DICTIONARY', 'XRECORD', 'SCALE', 'VISUALSTYLE'].includes(record.type) || !Array.isArray(record.tags) || record.tags.length > 8192 ||
        record.tags.some(tag => !tag || !Number.isInteger(tag.code) || tag.code <= 0 || tag.code >= 1000 || typeof tag.value !== 'string' || /[\r\n\0]/.test(tag.value))) return fail('invalid stored object record')
    const key = handle(record)
    if (record.tags.filter(tag => tag.code === 5).length !== 1 || !/^[0-9A-F]{1,32}$/.test(key) || handles.has(key) || occupied.has(key) || key === metadata.rootHandle) return fail('stored object handle collision')
    handles.add(key)
    types.set(key, record.type)
  }
  const refs = new Set<string>()
  for (const reference of metadata.entityReferences) {
    const object = state.objects[reference.id]
    if (!object || object.erased || object.kind !== 'entity' || typeof reference.handle !== 'string' || !/^[0-9A-F]{1,32}$/.test(reference.handle) || refs.has(reference.handle)) return fail('reference target is erased or unavailable')
    if (handles.has(reference.handle) || reference.handle === metadata.rootHandle) return fail('stored reference handle collision')
    const originalHandle = object.source && typeof object.source === 'object' ? (object.source as Record<string, unknown>).originalHandle : undefined
    if (typeof originalHandle !== 'string' || originalHandle.toUpperCase() !== reference.handle) return fail('stored reference alias does not match its source entity')
    refs.add(reference.handle)
  }
  const viewportIds = new Set<string>()
  for (const viewport of metadata.viewports) {
    const object = state.objects[viewport.id]
    if (!object || object.erased || object.type !== 'VIEWPORT' || stableHash(object.payload) !== viewport.fingerprint) return fail('viewport changed; opaque metadata needs a graph-aware editor')
    if (viewportIds.has(viewport.id)) return fail('duplicate viewport metadata owner')
    viewportIds.add(viewport.id)
    if (!Array.isArray(object.payload.rawTags)) return fail('viewport source tags are unavailable')
    for (const reference of viewportReferences(object.payload.rawTags as Tag[])) {
      if (!handles.has(reference.handle) && !refs.has(reference.handle)) return fail('viewport reference is unresolved')
      if (reference.type && types.get(reference.handle) !== reference.type) return fail('viewport reference needs ' + reference.type)
    }
  }
  for (const object of Object.values(state.objects)) {
    if (!object.erased && object.type === 'VIEWPORT' && Array.isArray(object.payload.rawTags) &&
        viewportReferences(object.payload.rawTags as Tag[]).length && !viewportIds.has(object.id)) return fail('viewport metadata owner is missing')
  }
  for (const record of metadata.records) for (const reference of references(record)) {
    if (reference !== metadata.rootHandle && !handles.has(reference) && !refs.has(reference)) return fail('stored reference is unresolved')
  }
  const names = new Set<string>()
  for (const entry of metadata.rootEntries) {
    if (typeof entry.name !== 'string' || !entry.name || entry.name.length > 255 || /[\r\n\0]/.test(entry.name) || entry.name.toUpperCase() === 'ACAD_LAYOUT' || names.has(entry.name.toUpperCase()) || ![350,360].includes(entry.code) || !handles.has(entry.handle)) return fail('invalid root registration')
    names.add(entry.name.toUpperCase())
  }
  for (const record of metadata.records) {
    if (metadata.rootHandle && record.tags.some(tag => tag.code === 330 && tag.value.toUpperCase() === metadata.rootHandle) &&
        !metadata.rootEntries.some(entry => entry.handle === handle(record))) return fail('source root registration is missing')
  }
  return metadata
}

export function viewportMetadataReferenceMap(state: KJDocumentState, metadata: Metadata, rootHandle: string): ReadonlyMap<string, string> {
  return new Map([...(metadata.rootHandle ? [[metadata.rootHandle, rootHandle] as const] : []),
    ...metadata.entityReferences.map(reference => [reference.handle, state.objects[reference.id]!.handle] as const)])
}

export function isViewportMetadataReference(code: number): boolean { return referenceCode(code) }
