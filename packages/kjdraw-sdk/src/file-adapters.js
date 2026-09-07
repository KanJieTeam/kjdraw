import { KJAdapterError, KJRegistrationError, KJValidationError } from './errors.js'
import { clone, deepFreeze, normalizeName } from './utils.js'

function normalizeFormatMap(formats = {}) {
  const output = {}
  for (const [name, descriptor] of Object.entries(formats)) {
    output[normalizeName(name)] = {
      read: [...(descriptor.read ?? [])].map(String),
      write: [...(descriptor.write ?? [])].map(String),
      notes: [...(descriptor.notes ?? [])].map(String),
    }
  }
  return output
}

export function defineFileAdapter(definition = {}) {
  const id = String(definition.id ?? '').trim()
  if (!id) throw new KJRegistrationError('File adapter requires an id')
  if (!definition.formats || typeof definition.formats !== 'object') throw new KJRegistrationError(`File adapter ${id} requires a formats map`)
  if (typeof definition.read !== 'function' && typeof definition.write !== 'function') throw new KJRegistrationError(`File adapter ${id} must implement read or write`)
  return deepFreeze({
    priority: 0,
    vendor: null,
    capabilities: {},
    preservation: {},
    ...definition,
    id,
    formats: normalizeFormatMap(definition.formats),
    capabilities: clone(definition.capabilities ?? {}),
    preservation: clone(definition.preservation ?? {}),
  })
}

function supportsVersion(values, version) {
  if (!values.length) return false
  return version == null || values.includes('*') || values.includes(String(version))
}

export class KJFileAdapterRegistry {
  #adapters = new Map()

  register(definition, { replace = false } = {}) {
    const adapter = defineFileAdapter(definition)
    if (this.#adapters.has(adapter.id) && !replace) throw new KJRegistrationError(`File adapter already registered: ${adapter.id}`)
    this.#adapters.set(adapter.id, adapter)
    return () => this.#adapters.get(adapter.id) === adapter && this.#adapters.delete(adapter.id)
  }

  get(id) { return this.#adapters.get(String(id)) ?? null }
  list() { return [...this.#adapters.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)) }

  find({ format, version = null, operation = 'read', adapterId = null } = {}) {
    const normalizedFormat = normalizeName(format)
    const candidates = adapterId ? [this.get(adapterId)].filter(Boolean) : this.list()
    return candidates.find(adapter => {
      const descriptor = adapter.formats[normalizedFormat]
      return descriptor && typeof adapter[operation] === 'function' && supportsVersion(descriptor[operation], version)
    }) ?? null
  }

  async read(source, options = {}) {
    let format = options.format
    if (!format && options.adapterId) format = Object.keys(this.get(options.adapterId)?.formats ?? {})[0]
    if (!format) {
      for (const adapter of this.list()) {
        if (typeof adapter.sniff === 'function' && await adapter.sniff(source, options)) {
          format = Object.keys(adapter.formats)[0]
          options = { ...options, adapterId: adapter.id }
          break
        }
      }
    }
    const adapter = this.find({ ...options, format, operation: 'read' })
    if (!adapter) throw new KJAdapterError(`No reader for ${format ?? 'unknown format'} ${options.version ?? ''}`.trim(), { format, version: options.version })
    try { return await adapter.read(source, { ...options, format: normalizeName(format), adapter }) }
    catch (error) { throw new KJAdapterError(`Adapter ${adapter.id} failed to read ${format}`, { adapterId: adapter.id, format }, error) }
  }

  async write(document, options = {}) {
    if (!options.format) throw new KJValidationError('Output format is required')
    const adapter = this.find({ ...options, operation: 'write' })
    if (!adapter) throw new KJAdapterError(`No writer for ${options.format} ${options.version ?? ''}`.trim(), { format: options.format, version: options.version })
    try { return await adapter.write(document, { ...options, format: normalizeName(options.format), adapter }) }
    catch (error) { throw new KJAdapterError(`Adapter ${adapter.id} failed to write ${options.format}`, { adapterId: adapter.id, format: options.format }, error) }
  }

  capabilityMatrix() {
    return this.list().map(adapter => ({
      id: adapter.id,
      vendor: adapter.vendor,
      formats: clone(adapter.formats),
      capabilities: clone(adapter.capabilities),
      preservation: clone(adapter.preservation),
    }))
  }
}
