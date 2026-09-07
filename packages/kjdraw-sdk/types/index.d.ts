export type Point2 = readonly [number, number]
export type Point3 = readonly [number, number, number]
export type KJCommandOrigin = 'ui' | 'script' | 'plugin' | 'ai' | { kind: string; owner?: string }
export type KJCommandMode = 'execute' | 'plan'
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

export class KJDeploymentRegistry {
  register(type: KJProviderType, provider: KJDeploymentProvider, options?: { replace?: boolean }): () => boolean
  get(type: KJProviderType, id: string): Readonly<KJDeploymentProvider> | null
  list(type?: KJProviderType): ReadonlyArray<Readonly<KJDeploymentProvider>>
}

export function createDeploymentProfile(options?: { mode?: KJDeploymentMode; projectAuthority?: string; providers?: Partial<Record<KJProviderType, string>> }): KJDeploymentProfile
export function validateDeploymentProfile(profile: KJDeploymentProfile, registry: KJDeploymentRegistry): KJDeploymentProfile
export const KJ_DEPLOYMENT_MODES: readonly KJDeploymentMode[]
export const KJ_PROVIDER_TYPES: Readonly<{ PROJECT_STORE: 'project-store'; COMPUTE: 'compute'; SCENE: 'scene' }>

export interface KJEntity<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  handle: string
  type: string
  kind: 'ENTITY'
  name?: string
  payload: TPayload
}

export interface KJCommandEnvelope<TArgs = Record<string, unknown>> {
  schema: string
  id: string
  command: string
  arguments: TArgs
  documentId: string
  expectedRevision: number
  origin: KJCommandOrigin
  mode: KJCommandMode
  confirmation?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface KJCommandReceipt<TResult = unknown> {
  commandEnvelopeId: string
  command: string
  beforeRevision: number
  afterRevision: number
  result: TResult
}

export interface KJDocumentSnapshot {
  id: string
  title?: string
  revision: number
  header: Record<string, unknown>
  objects: Record<string, KJEntity>
  tables: Record<string, unknown>
  spaces: Record<string, unknown>
}

export class KJDocument {
  readonly id: string
  readonly revision: number
  readonly history: { readonly canUndo: boolean; readonly canRedo: boolean }
  static open(input: KJDocumentSnapshot | Record<string, unknown>, options?: { historyLimit?: number }): KJDocument
  snapshot(): KJDocumentSnapshot
  fingerprint(): string
  serialize(options?: { pretty?: boolean }): string
  listEntities(options?: Record<string, unknown>): KJEntity[]
  listObjects(options?: Record<string, unknown>): KJEntity[]
  getObject(id: string): KJEntity | null
  getTable(name: string): { currentId?: string; records: KJEntity[] }
  undo(options?: Record<string, unknown>): unknown
  redo(options?: Record<string, unknown>): unknown
}

export class KJDrawSDK {
  readonly version: string
  readonly activeDocument: KJDocument
  readonly documents: Map<string, KJDocument>
  createDocument(options?: { documentId?: string; title?: string; units?: string; historyLimit?: number }): KJDocument
  attachDocument(document: KJDocument): KJDocument
  closeDocument(id: string): boolean
  setActiveDocument(id: string): KJDocument
  createCommandEnvelope<TArgs = Record<string, unknown>>(command: string, args?: TArgs, options?: Record<string, unknown>): KJCommandEnvelope<TArgs>
  executeCommand<TResult = unknown>(command: string, args?: Record<string, unknown>, options?: Record<string, unknown>): Promise<TResult>
  executeCommandEnvelope<TResult = unknown>(envelope: KJCommandEnvelope, options?: Record<string, unknown>): Promise<KJCommandReceipt<TResult> | TResult>
  readDocument(input: string | Uint8Array | ArrayBuffer, options?: { format?: string; version?: string }): Promise<KJDocument>
  writeDocument(document: KJDocument, options: { format: string; version?: string }): Promise<string | Uint8Array>
  snap(point: Point2, options?: { radius?: number; modes?: string[] }): Array<{ point: Point2; entityIds: string[]; mode: string }>
  getSelectionManager(documentId?: string): KJSelectionManager | null
}

export class KJProjectSession {
  readonly id: string
  readonly activeDocument: KJDocument
  static create(options: { sdk: KJDrawSDK; id?: string; title?: string; documents?: KJDocument[]; metadata?: Record<string, unknown> }): KJProjectSession
  static open(input: Uint8Array | ArrayBuffer, options: { sdk: KJDrawSDK }): Promise<KJProjectSession>
  package(): Promise<Uint8Array>
  destroy(): void
}

export class KJSelectionManager {
  readonly active: { readonly ids: string[]; replace(ids: string[]): void; add(ids: string[]): void; remove(ids: string[]): void; clear(): void }
}

export function createKJDrawSDK(options?: Record<string, unknown>): KJDrawSDK
export function instantiateKJCoreWasm(source: URL | string | ArrayBuffer | Uint8Array): Promise<WebAssembly.WebAssemblyInstantiatedSource>
export function createWasmGeometryBackend(instance: WebAssembly.Instance): unknown
export function registerGeometryBackend(backend: unknown): void
export function createKJCoreDocumentAuthority(instance: WebAssembly.Instance): unknown
export function createKJCoreSolidBackend(instance: WebAssembly.Instance): unknown
export function listStandardEntityTypes(): readonly string[]
export function entityLength2(entity: KJEntity): { length: number; approximate?: boolean }
export function entityArea2(entity: KJEntity): { area: number }

export const KJDRAW_1_0_PRODUCT_CONTRACT: Readonly<Record<string, unknown>>
export const KJDRAW_1_0_READINESS_PROFILE: Readonly<Record<string, unknown>>
export const KJDRAW_CAD_VERSION_MATRIX: readonly Readonly<Record<string, unknown>>[]
export const KJ_STANDARD_TYPES: Readonly<Record<string, string>>
export class KJDrawError extends Error { code: string; details: unknown }
export class KJValidationError extends KJDrawError {}
export class KJTransactionError extends KJDrawError {}
export class KJRevisionConflictError extends KJDrawError {}
export class KJRegistrationError extends KJDrawError {}
export class KJAdapterError extends KJDrawError {}
