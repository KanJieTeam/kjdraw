import { KJRegistrationError, KJValidationError } from './errors.js'
import { deepFreeze } from './utils.js'

export type KJDeploymentMode = 'browser-local' | 'desktop-local' | 'self-hosted' | 'cloud-assisted' | 'hybrid'
export type KJProviderType = 'project-store' | 'compute' | 'scene'

export interface KJDeploymentProvider {
  id: string
  locality?: string
  [key: string]: unknown
}

export interface KJProjectStoreProvider extends KJDeploymentProvider {
  loadProject(projectId: string, options?: Record<string, unknown>): Promise<unknown>
  saveProject(projectId: string, project: unknown, options?: Record<string, unknown>): Promise<unknown>
}

export interface KJComputeProvider extends KJDeploymentProvider {
  execute(operation: string, input: unknown, options?: Record<string, unknown>): Promise<unknown>
}

export interface KJSceneProvider extends KJDeploymentProvider {
  openScene(sceneId: string, options?: Record<string, unknown>): Promise<unknown>
  queryViewport(viewport: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
}

export interface KJDeploymentProfile {
  schema: 'com.kanjie.kjdraw.deployment-profile@1'
  mode: KJDeploymentMode
  projectAuthority: string
  providers: Partial<Record<KJProviderType, string>>
}

export interface KJDeploymentProfileOptions {
  mode?: KJDeploymentMode
  projectAuthority?: string
  providers?: Partial<Record<KJProviderType, string>>
}

export const KJ_DEPLOYMENT_MODES: readonly KJDeploymentMode[] = Object.freeze([
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
} as const)

const REQUIRED_METHODS: Readonly<Record<KJProviderType, readonly string[]>> = deepFreeze({
  [KJ_PROVIDER_TYPES.PROJECT_STORE]: ['loadProject', 'saveProject'],
  [KJ_PROVIDER_TYPES.COMPUTE]: ['execute'],
  [KJ_PROVIDER_TYPES.SCENE]: ['openScene', 'queryViewport'],
})

function normalizeProvider(type: KJProviderType, provider: KJDeploymentProvider): Readonly<KJDeploymentProvider> {
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
  #providers: Map<KJProviderType, Map<string, Readonly<KJDeploymentProvider>>> = new Map(
    Object.values(KJ_PROVIDER_TYPES).map(type => [type, new Map()]),
  )

  register(type: KJProviderType, provider: KJDeploymentProvider, { replace = false }: { replace?: boolean } = {}): () => boolean {
    const entry = normalizeProvider(type, provider)
    const providers = this.#providers.get(type)!
    if (providers.has(entry.id) && !replace) throw new KJRegistrationError(`Deployment provider already registered: ${type}/${entry.id}`)
    providers.set(entry.id, entry)
    return () => providers.get(entry.id) === entry && providers.delete(entry.id)
  }

  get(type: KJProviderType, id: string): Readonly<KJDeploymentProvider> | null {
    return this.#providers.get(type)?.get(String(id)) ?? null
  }

  list(type?: KJProviderType): ReadonlyArray<Readonly<KJDeploymentProvider>> {
    if (type == null) return [...this.#providers.values()].flatMap(providers => [...providers.values()])
    if (!this.#providers.has(type)) throw new KJRegistrationError(`Unknown deployment provider type: ${type}`)
    return [...this.#providers.get(type)!.values()]
  }
}

export function createDeploymentProfile(options: KJDeploymentProfileOptions = {}): Readonly<KJDeploymentProfile> {
  const mode = String(options.mode ?? 'browser-local') as KJDeploymentMode
  if (!KJ_DEPLOYMENT_MODES.includes(mode)) throw new KJValidationError(`Unsupported deployment mode: ${mode}`)
  const providerIds: Partial<Record<KJProviderType, string>> = {}
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

export function validateDeploymentProfile(profile: KJDeploymentProfileOptions, registry: KJDeploymentRegistry): Readonly<KJDeploymentProfile> {
  const normalized = createDeploymentProfile(profile)
  if (!(registry instanceof KJDeploymentRegistry)) throw new KJValidationError('A KJDeploymentRegistry is required')
  for (const [type, id] of Object.entries(normalized.providers) as [KJProviderType, string][]) {
    if (!registry.get(type, id)) throw new KJValidationError(`Deployment profile references an unavailable provider: ${type}/${id}`)
  }
  return normalized
}
