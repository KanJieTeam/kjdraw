import { KJD_SCHEMA, KJD_SCHEMA_VERSION } from './constants.js'
import { KJDocument } from './document.js'
import { KJValidationError } from './errors.js'
import { defineFileAdapter } from './file-adapters.js'

async function sourceText(source) {
  if (typeof source === 'string') return source
  if (source instanceof Uint8Array) return new TextDecoder().decode(source)
  if (source instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(source))
  if (typeof source?.text === 'function') return source.text()
  if (source && typeof source === 'object') return JSON.stringify(source)
  throw new KJValidationError('KJD source must be text, bytes, Blob/File, or an object')
}

async function parseSource(source) {
  if (source instanceof KJDocument) return source.toJSON()
  if (source && typeof source === 'object' && !(source instanceof Uint8Array) && !(source instanceof ArrayBuffer) && typeof source.text !== 'function') return source
  const text = await sourceText(source)
  try { return JSON.parse(text) }
  catch (error) { throw new KJValidationError('KJD source is not valid JSON', { cause: error.message }) }
}

export function createKJDFileAdapter(options = {}) {
  return defineFileAdapter({
    id: options.id ?? 'kanjie.kjd.v1',
    vendor: 'Kanjie',
    priority: Number(options.priority ?? 1000),
    formats: { KJD: { read: [String(KJD_SCHEMA_VERSION)], write: [String(KJD_SCHEMA_VERSION)], notes: ['Canonical KJDraw document'] } },
    capabilities: {
      certification: 'schema-roundtrip',
      container: 'canonical-json',
      modelSpace: true,
      paperSpace: true,
      layouts: true,
      tables: true,
      resources: true,
      opaquePayloads: true,
      revisions: true,
    },
    preservation: { handles: 'exact', ownership: 'exact', objectIds: 'exact', opaqueObjects: 'exact', resources: 'exact' },
    sniff: async source => {
      try {
        const state = await parseSource(source)
        return state?.schema === KJD_SCHEMA && Number(state?.schemaVersion) === KJD_SCHEMA_VERSION
      } catch { return false }
    },
    read: async source => KJDocument.open(await parseSource(source)),
    write: async (document, writeOptions = {}) => {
      if (!(document instanceof KJDocument)) throw new KJValidationError('KJD writer requires a KJDocument')
      return document.serialize({ pretty: Boolean(writeOptions.pretty), includeRevisions: writeOptions.includeRevisions !== false })
    },
  })
}
