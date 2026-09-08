import { KJRegistrationError } from './errors.js'
import { deepFreeze, type ReadonlyDeep } from './utils.js'

export const KJ_EXTENSION_POINTS = Object.freeze([
  'entity-type',
  'object-type',
  'geometry-kernel',
  'renderer',
  'file-adapter',
  'command',
  'tool',
  'snap-provider',
  'property-provider',
  'workspace',
  'survey-package',
] as const)

export type KJExtensionPoint = typeof KJ_EXTENSION_POINTS[number]

export interface KJExtensionDefinition extends Record<string, unknown> {
  id?: unknown
}

export type KJRegisteredExtension = ReadonlyDeep<Record<string, unknown> & {
  id: string
  owner: string
}>

export interface KJExtensionRegistrationOptions {
  owner?: string
  replace?: boolean
}

export class KJExtensionRegistry {
  #points = new Map<string, Map<string, KJRegisteredExtension>>()

  constructor(points: readonly string[] = KJ_EXTENSION_POINTS) {
    for (const point of points) this.#points.set(point, new Map<string, KJRegisteredExtension>())
  }

  register(
    point: string,
    definition: KJExtensionDefinition,
    { owner = 'application', replace = false }: KJExtensionRegistrationOptions = {},
  ): () => boolean {
    const registry = this.#points.get(point)
    if (!registry) throw new KJRegistrationError(`Unknown extension point: ${point}`)
    const id = String(definition?.id ?? '').trim()
    if (!id) throw new KJRegistrationError(`Extension registered at ${point} requires an id`)
    if (registry.has(id) && !replace) throw new KJRegistrationError(`Extension already registered: ${point}/${id}`)
    // Extension definitions may intentionally contain executable functions.
    // Keep function identity while freezing the public registration record.
    const entry = deepFreeze({ ...definition, id, owner: String(owner) })
    registry.set(id, entry)
    return (): boolean => registry.get(id) === entry && registry.delete(id)
  }

  get(point: string, id: unknown): KJRegisteredExtension | null {
    return this.#points.get(point)?.get(String(id)) ?? null
  }

  has(point: string, id: unknown): boolean {
    return this.#points.get(point)?.has(String(id)) ?? false
  }

  list(point: string): KJRegisteredExtension[] {
    return [...(this.#points.get(point)?.values() ?? [])]
  }

  removeOwner(owner: unknown): number {
    let count = 0
    for (const registry of this.#points.values()) {
      for (const [id, entry] of registry) {
        if (entry.owner === owner) {
          registry.delete(id)
          count += 1
        }
      }
    }
    return count
  }
}
