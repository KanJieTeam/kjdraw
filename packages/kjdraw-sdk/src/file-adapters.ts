import { KJAdapterError, KJRegistrationError, KJValidationError } from './errors.js'
import { clone, deepFreeze, normalizeName } from './utils.js'

export type KJFileOperation = 'read' | 'write'

export interface KJFileFormatDescriptor {
  read: string[]
  write: string[]
  notes: string[]
}

export interface KJFileFormatDescriptorInput {
  read?: readonly (string | number)[]
  write?: readonly (string | number)[]
  notes?: readonly unknown[]
}

export type KJFileFormatMap = Record<string, KJFileFormatDescriptor>
export type KJFileFormatMapInput = Record<string, KJFileFormatDescriptorInput>

export interface KJFileAdapterContext extends Record<string, unknown> {
  format?: string
  version?: string | number | null
  adapter?: Readonly<KJFileAdapter>
  adapterId?: string | null
}

export interface KJFileAdapterOptions extends Record<string, unknown> {
  format?: string
  version?: string | number | null
  adapterId?: string | null
  /** Cancels cooperative file readers before they commit a document. */
  signal?: AbortSignal
  /** Bounded host progress without exposing file contents. */
  onProgress?: (progress: Readonly<KJFileReadProgress>) => void
}

export interface KJFileReadProgress {
  phase: 'source' | 'parse' | 'import'
  completed: number
  total?: number
  unit: 'bytes' | 'tags' | 'entities'
}

export interface KJFileAdapter<TRead = unknown, TWrite = unknown> {
  id: string
  priority: number
  vendor: string | null
  formats: KJFileFormatMap
  capabilities: Record<string, unknown>
  preservation: Record<string, unknown>
  sniff?: (source: unknown, options: KJFileAdapterOptions) => boolean | Promise<boolean>
  read?: (source: unknown, options: KJFileAdapterContext) => TRead | Promise<TRead>
  write?: (document: unknown, options: KJFileAdapterContext) => TWrite | Promise<TWrite>
}

export interface KJFileAdapterDefinition<TRead = unknown, TWrite = unknown> extends Record<string, unknown> {
  id?: string
  priority?: number
  vendor?: string | null
  formats?: KJFileFormatMapInput
  capabilities?: Record<string, unknown>
  preservation?: Record<string, unknown>
  sniff?: (source: unknown, options: KJFileAdapterOptions) => boolean | Promise<boolean>
  read?: (source: unknown, options: KJFileAdapterContext) => TRead | Promise<TRead>
  write?: (document: unknown, options: KJFileAdapterContext) => TWrite | Promise<TWrite>
}

export interface KJFileAdapterCapability {
  id: string
  vendor: string | null
  formats: KJFileFormatMap
  capabilities: Record<string, unknown>
  preservation: Record<string, unknown>
}

function normalizeFormatMap(formats: KJFileFormatMapInput = {}): KJFileFormatMap {
  const output: KJFileFormatMap = {}
  for (const [name, descriptor] of Object.entries(formats)) {
    output[normalizeName(name)] = {
      read: [...(descriptor.read ?? [])].map(String),
      write: [...(descriptor.write ?? [])].map(String),
      notes: [...(descriptor.notes ?? [])].map(String),
    }
  }
  return output
}

export function defineFileAdapter<TRead = unknown, TWrite = unknown>(definition: KJFileAdapterDefinition<TRead, TWrite> = {}): Readonly<KJFileAdapter<TRead, TWrite>> {
  const id = String(definition.id ?? '').trim()
  if (!id) throw new KJRegistrationError('File adapter requires an id')
  if (!definition.formats || typeof definition.formats !== 'object') throw new KJRegistrationError(`File adapter ${id} requires a formats map`)
  if (typeof definition.read !== 'function' && typeof definition.write !== 'function') throw new KJRegistrationError(`File adapter ${id} must implement read or write`)
  return deepFreeze({
    ...definition,
    id,
    priority: definition.priority ?? 0,
    vendor: definition.vendor ?? null,
    formats: normalizeFormatMap(definition.formats),
    capabilities: clone(definition.capabilities ?? {}),
    preservation: clone(definition.preservation ?? {}),
  }) as Readonly<KJFileAdapter<TRead, TWrite>>
}

function supportsVersion(values: readonly string[], version: string | number | null | undefined): boolean {
  if (!values.length) return false
  return version == null || values.includes('*') || values.includes(String(version))
}

export class KJFileAdapterRegistry {
  #adapters = new Map<string, Readonly<KJFileAdapter>>()

  register(definition: KJFileAdapterDefinition, { replace = false }: { replace?: boolean } = {}): () => boolean {
    const adapter = defineFileAdapter(definition)
    if (this.#adapters.has(adapter.id) && !replace) throw new KJRegistrationError(`File adapter already registered: ${adapter.id}`)
    this.#adapters.set(adapter.id, adapter)
    return () => this.#adapters.get(adapter.id) === adapter && this.#adapters.delete(adapter.id)
  }

  get(id: string): Readonly<KJFileAdapter> | null { return this.#adapters.get(String(id)) ?? null }
  list(): ReadonlyArray<Readonly<KJFileAdapter>> { return [...this.#adapters.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)) }

  find({ format, version = null, operation = 'read', adapterId = null }: KJFileAdapterOptions & { operation?: KJFileOperation } = {}): Readonly<KJFileAdapter> | null {
    const normalizedFormat = normalizeName(format)
    const candidates = adapterId ? [this.get(adapterId)].filter((adapter): adapter is Readonly<KJFileAdapter> => Boolean(adapter)) : this.list()
    return candidates.find(adapter => {
      const descriptor = adapter.formats[normalizedFormat]
      return descriptor && typeof adapter[operation] === 'function' && supportsVersion(descriptor[operation], version)
    }) ?? null
  }

  async read(source: unknown, inputOptions: KJFileAdapterOptions = {}): Promise<unknown> {
    let options = inputOptions
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
    const adapter = this.find({ ...options, ...(format === undefined ? {} : { format }), operation: 'read' })
    if (!adapter?.read) throw new KJAdapterError(`No reader for ${format ?? 'unknown format'} ${options.version ?? ''}`.trim(), { format, version: options.version })
    try { return await adapter.read(source, { ...options, format: normalizeName(format), adapter }) }
    catch (error) { throw new KJAdapterError(`Adapter ${adapter.id} failed to read ${format}`, { adapterId: adapter.id, format }, error) }
  }

  async write(document: unknown, options: KJFileAdapterOptions = {}): Promise<unknown> {
    if (!options.format) throw new KJValidationError('Output format is required')
    const adapter = this.find({ ...options, operation: 'write' })
    if (!adapter?.write) throw new KJAdapterError(`No writer for ${options.format} ${options.version ?? ''}`.trim(), { format: options.format, version: options.version })
    try { return await adapter.write(document, { ...options, format: normalizeName(options.format), adapter }) }
    catch (error) { throw new KJAdapterError(`Adapter ${adapter.id} failed to write ${options.format}`, { adapterId: adapter.id, format: options.format }, error) }
  }

  capabilityMatrix(): KJFileAdapterCapability[] {
    return this.list().map(adapter => ({
      id: adapter.id,
      vendor: adapter.vendor,
      formats: clone(adapter.formats),
      capabilities: clone(adapter.capabilities),
      preservation: clone(adapter.preservation),
    }))
  }
}
