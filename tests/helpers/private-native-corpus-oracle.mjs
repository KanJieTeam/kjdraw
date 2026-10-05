import { canonicalStringify, normalizeName } from '../../packages/kjdraw-sdk/src/utils.js'

export class CorpusFailure extends Error {
  constructor(code) { super(code); this.code = code }
}

const check = (condition, code) => { if (!condition) throw new CorpusFailure(code) }

export function nativeReference(document, id) {
  if (id == null) return id
  const record = document.getObject(String(id), { includeErased: true })
  check(record != null, 'DXF_NATIVE_REFERENCE_MISSING')
  return record.kind === 'table-record' || record.kind === 'block-record'
    ? { kind: record.kind, type: record.type, name: record.name }
    : { kind: record.kind, type: record.type, handle: record.handle }
}

export function nativeValue(item, document, key = '') {
  if (key === 'rawTags' || key === 'contractVersion') return undefined
  // VIEWPORT group 69 is a numeric viewport index, not a graph identity.
  // Preserve its exact value rather than treating the suffix as a UUID.
  if (key === 'viewportId' && typeof item === 'number') return item
  // DXF resource lookup uses normalizeName too: case is not a distinct
  // linetype, while a changed resolved resource still fails comparison.
  if (key === 'linetypeName' && typeof item === 'string') return normalizeName(item)
  if (/Id$/.test(key) && item != null) return nativeReference(document, item)
  if (/Ids$/.test(key) && Array.isArray(item)) return item.map(id => nativeReference(document, id))
  if (typeof item === 'number') return Math.round(item * 1e8) / 1e8
  if (Array.isArray(item)) return item.map(value => nativeValue(value, document))
  if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).flatMap(([name, value]) => {
    const converted = nativeValue(value, document, name)
    return converted === undefined ? [] : [[name, converted]]
  }))
  return item
}

export function nativeEntity(document, entity) {
  // Native TEXT group 51 defaults to zero when omitted by a DXF writer.
  // Do not normalize nonzero oblique angles or arbitrary metadata fields.
  const textDefaults = entity.type === 'TEXT' ? { obliqueAngle: 0 } : {}
  return { handle: entity.handle, type: entity.type, owner: nativeReference(document, entity.ownerId),
    payload: nativeValue({ normal: [0, 0, 1], ...textDefaults, ...entity.payload }, document),
    extension: nativeValue(entity.extension, document) }
}

export function nativeTables(document) {
  return Object.fromEntries(Object.entries(document.snapshot().tables).map(([name, table]) => [name,
    table.recordIds.map(id => {
      const record = document.getObject(id)
      return { kind: record.kind, type: record.type, name: record.name, payload: nativeValue(record.payload, document) }
    }).sort((a, b) => canonicalStringify([a.type, a.name]).localeCompare(canonicalStringify([b.type, b.name]))),
  ]))
}
