import { KJRegistrationError, KJValidationError } from './errors.js'
import { deepFreeze } from './utils.js'

export const KJ_DEPLOYMENT_MODES = Object.freeze([
  'browser-local',
  'desktop-local',
  'self-hosted',
  'cloud-assisted',
  'hybrid',
])

export const KJ_PROVIDER_TYPES = deepFreeze({
  PROJECT_STORE: 'project-store',
  COMPUTE: 'compute',
  SCENE: 'scene',
})

const REQUIRED_METHODS = deepFreeze({
  [KJ_PROVIDER_TYPES.PROJECT_STORE]: ['loadProject', 'saveProject'],
  [KJ_PROVIDER_TYPES.COMPUTE]: ['execute'],
  [KJ_PROVIDER_TYPES.SCENE]: ['openScene', 'queryViewport'],
})

function normalizeProvider(type, provider) {
  if (!Object.values(KJ_PROVIDER_TYPES).includes(type)) throw new KJRegistrationError(`Unknown deployment provider type: ${type}`)
  if (!provider || typeof provider !== 'object') throw new KJRegistrationError(`${type} provider must be an object`)
  const id = String(provider.id ?? '').trim()
  if (!id) throw new KJRegistrationError(`${type} provider requires an id`)
  for (const method of REQUIRED_METHODS[type]) {
    if (typeof provider[method] !== 'function') throw new KJRegistrationError(`${type} provider ${id} requires ${method}()`)
  }
  return Object.freeze({ ...provider, id, type, locality: String(provider.locality ?? 'host-defined') })
}

/** Host-owned registry for optional local or remote deployment services.
 * KJDraw never performs network access merely because a provider is registered. */
export class KJDeploymentRegistry {
  #providers = new Map(Object.values(KJ_PROVIDER_TYPES).map(type => [type, new Map()]))

  register(type, provider, { replace = false } = {}) {
    const entry = normalizeProvider(type, provider)
    const providers = this.#providers.get(type)
    if (providers.has(entry.id) && !replace) throw new KJRegistrationError(`Deployment provider already registered: ${type}/${entry.id}`)
    providers.set(entry.id, entry)
    return () => providers.get(entry.id) === entry && providers.delete(entry.id)
  }

  get(type, id) { return this.#providers.get(type)?.get(String(id)) ?? null }
  list(type) {
    if (type == null) return [...this.#providers.values()].flatMap(providers => [...providers.values()])
    if (!this.#providers.has(type)) throw new KJRegistrationError(`Unknown deployment provider type: ${type}`)
    return [...this.#providers.get(type).values()]
  }
}

export function createDeploymentProfile(options = {}) {
  const mode = String(options.mode ?? 'browser-local')
  if (!KJ_DEPLOYMENT_MODES.includes(mode)) throw new KJValidationError(`Unsupported deployment mode: ${mode}`)
  const providerIds = {}
  for (const type of Object.values(KJ_PROVIDER_TYPES)) {
    const value = options.providers?.[type]
    if (value != null && !String(value).trim()) throw new KJValidationError(`Provider id for ${type} cannot be empty`)
    if (value != null) providerIds[type] = String(value)
  }
  return deepFreeze({
    schema: 'com.kanjie.kjdraw.deployment-profile@1',
    mode,
    projectAuthority: String(options.projectAuthority ?? (mode.includes('local') ? 'local-project-file' : 'host-selected-provider')),
    providers: providerIds,
  })
}

export function validateDeploymentProfile(profile, registry) {
  const normalized = createDeploymentProfile(profile)
  if (!(registry instanceof KJDeploymentRegistry)) throw new KJValidationError('A KJDeploymentRegistry is required')
  for (const [type, id] of Object.entries(normalized.providers)) {
    if (!registry.get(type, id)) throw new KJValidationError(`Deployment profile references an unavailable provider: ${type}/${id}`)
  }
  return normalized
}
