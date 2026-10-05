import { KJAgentPlanRegistry } from './agent-plans.js'
import type { KJAgentPlanRecord, KJAgentPlanRegistryOptions } from './agent-plans.js'
import { buildSDKCapabilityManifest } from './capabilities.js'
import { KJCommandRegistry, registerCoreCommands } from './commands.js'
import type { KJCommandArguments, KJCommandDefinition, KJCommandInputContext, KJRegisteredCommand } from './commands.js'
import { KJDocument } from './document.js'
import type { KJDocumentAuthority, KJDocumentConstructorOptions } from './document.js'
import { createDXFFileAdapter } from './dxf-adapter.js'
import { createDwgConversionFileAdapter } from './dwg-conversion.js'
import type { KJDwgConversionProvider } from './dwg-conversion.js'
import { createSVGFileAdapter } from './svg-adapter.js'
import { KJValidationError } from './errors.js'
import { KJEventBus } from './events.js'
import { KJExtensionRegistry } from './extensions.js'
import type { KJExtensionDefinition, KJExtensionPoint } from './extensions.js'
import { KJFileAdapterRegistry } from './file-adapters.js'
import type { KJFileAdapterDefinition, KJFileAdapterOptions } from './file-adapters.js'
import { createKJDFileAdapter } from './kjd-adapter.js'
import { hatchPatternFromCatalog, type KJHatchPatternCatalog } from './hatch-pattern-catalog.js'
import { KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG } from './knowledge-packs/geology-patterns.js'
import type { KJCoreSolidBackend } from './kernel/wasm-solid.js'
import type { KJContourBackendOptions } from './geometry/contour-wasm.js'
import {
  assertPluginCompatibility,
  assertPluginContribution,
  assertPluginPermission,
  createPluginGrant,
} from './plugin-contract.js'
import type {
  KJPluginContributionKind,
  KJPluginManifest,
  KJPluginPermission,
} from './plugin-contract.js'
import {
  createCommandEnvelope as createProtocolCommandEnvelope,
  createCommandReceipt,
  validateCommandEnvelope,
} from './product-contract.js'
import type {
  KJCommandEnvelope,
  KJCommandReceipt,
  KJCreateCommandOptions,
} from './product-contract.js'
import type { KJDocumentOptions, KJDocumentState, KJLegacyScene } from './schema.js'
import { KJSelectionManager } from './selection.js'
import type { KJSelectionSet } from './selection.js'
import { findSnapCandidates } from './snapping.js'
import type { KJSnapCandidate, KJSnapOptions, KJSnapPointInput } from './snapping.js'
import { canonicalStringify, deepFreeze, stableHash, type ReadonlyDeep } from './utils.js'
import { KJDRAW_VERSION } from './version.js'

export interface KJDocumentAuthorityProvider {
  readonly authoritative: true
  open(source: string): KJDocumentAuthority
}

export interface KJDrawSDKOptions {
  version?: string
  documentAuthority?: KJDocumentAuthorityProvider | null
  solidAuthority?: Readonly<KJCoreSolidBackend> | null
  /** Constructor-only host WASM asset for contour commands. Never serialized into drawings or command arguments. */
  contourBackend?: KJContourBackendOptions
  agentPlans?: KJAgentPlanRegistry
  agentPlanOptions?: KJAgentPlanRegistryOptions
  registerDefaultAdapters?: boolean
  /** Optional host-owned DWG converter. KJDraw stores neither endpoints nor credentials. */
  dwgConversionProvider?: KJDwgConversionProvider | null
  /** Constructor-only host pattern resources, added to the bundled catalog. */
  hatchPatternCatalogs?: readonly ReadonlyDeep<KJHatchPatternCatalog>[]
  /** Defaults true. A trusted host may opt out to use its own full bounded catalog. */
  includeBundledHatchPatterns?: boolean
}

export interface KJExecuteCommandOptions {
  document?: KJDocument | null
  author?: unknown
  expectedRevision?: number
  commandEnvelope?: Readonly<KJCommandEnvelope> | null
  /** Pin execution to a previously reviewed registry definition across asynchronous approval checks. */
  expectedCommandDefinition?: KJRegisteredCommand
}

export interface KJCreateSDKCommandEnvelopeOptions extends KJCreateCommandOptions {
  document?: KJDocument | null
}

export interface KJExecuteCommandEnvelopeOptions extends KJExecuteCommandOptions {
  agentPlanOptions?: { ttlMs?: number }
}

export interface KJSnapSDKOptions extends KJSnapOptions {
  document?: KJDocument | null
}

export interface KJPluginScopeOptions {
  grantedPermissions?: readonly string[]
}

export type KJSDKCommandEnvelopeReceipt<TResult = unknown> = Readonly<
  KJCommandReceipt<TResult | Readonly<KJAgentPlanRecord> | null>
>

export interface KJDocumentAttachedEvent {
  document: KJDocument
}

export interface KJDocumentClosedEvent {
  documentId: string
}

export interface KJDocumentAuthorityReadyEvent {
  authority: KJDocumentAuthorityProvider
  documentIds: readonly string[]
}

export interface KJSolidAuthorityReadyEvent {
  authority: Readonly<KJCoreSolidBackend>
}

export interface KJActiveDocumentChangedEvent {
  documentId: string
}

export interface KJCommandPlannedEvent {
  envelope: Readonly<KJCommandEnvelope>
  receipt: Readonly<KJCommandReceipt<Readonly<KJAgentPlanRecord> | null>>
  document: KJDocument
  plan: Readonly<KJAgentPlanRecord> | null
}

export interface KJCommandBeforeExecuteEvent {
  envelope: Readonly<KJCommandEnvelope>
  document: KJDocument
  beforeRevision: number
  agentPlan: Readonly<KJAgentPlanRecord> | null
}

export interface KJCommandCommittedEvent {
  envelope: Readonly<KJCommandEnvelope>
  receipt: Readonly<KJCommandReceipt<unknown>>
  document: KJDocument
}

export interface KJCommandFailedEvent {
  envelope: Readonly<KJCommandEnvelope>
  document: KJDocument
  beforeRevision: number
  afterRevision: number
  error: unknown
}

export interface KJDrawSDKEvents {
  'document:attached': KJDocumentAttachedEvent
  'document:closed': KJDocumentClosedEvent
  'document:authority-ready': KJDocumentAuthorityReadyEvent
  'solid:authority-ready': KJSolidAuthorityReadyEvent
  'document:active-changed': KJActiveDocumentChangedEvent
  'command:planned': KJCommandPlannedEvent
  'command:before-execute': KJCommandBeforeExecuteEvent
  'command:committed': KJCommandCommittedEvent
  'command:failed': KJCommandFailedEvent
}

export type KJRegistrationDisposer = () => boolean

export interface KJPluginScope {
  readonly owner: string
  readonly manifest: ReadonlyDeep<KJPluginManifest>
  registerCommand(definition: KJCommandDefinition): KJRegistrationDisposer
  registerExtension(point: KJExtensionPoint, definition: KJExtensionDefinition): KJRegistrationDisposer
  registerFileAdapter(definition: KJFileAdapterDefinition): KJRegistrationDisposer
  executeCommand<TResult = unknown>(
    id: string,
    args?: KJCommandArguments,
    options?: KJExecuteCommandOptions,
  ): Promise<TResult>
  dispose(): void
}

type KJOpenDocumentInput = string | KJDocumentState | KJLegacyScene | Record<string, unknown>

function isOpenDocumentInput(value: unknown): value is KJOpenDocumentInput {
  return typeof value === 'string' || (value !== null && typeof value === 'object')
}

function optionalProperty<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): {} | { [Property in Key]: Value } {
  return value === undefined ? {} : { [key]: value } as { [Property in Key]: Value }
}

const validatedHatchCatalogs = new WeakSet<object>([KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG])

/** Detached immutable host resources. Exact duplicate catalogs do not consume
 * the effective 16-catalog / 256-pattern budget; a declared hash is not identity.
 * No model, document or restored chat field can register patterns through this API.
 */
export function mergeHatchPatternCatalogs(
  ...sources: readonly (readonly ReadonlyDeep<KJHatchPatternCatalog>[])[]
): ReadonlyDeep<KJHatchPatternCatalog[]> {
  const fail = (message: string): never => { throw new KJValidationError(`HATCH catalog registry: ${message}`) }
  const catalogs: ReadonlyDeep<KJHatchPatternCatalog>[] = [], identities = new Set<string>()
  let count = 0, nodes = 0
  const data = (value: unknown, depth = 0): void => {
    if (++nodes > 100000 || depth > 12) fail('catalog exceeds the plain-data budget')
    if (value === null || ['string', 'boolean', 'undefined'].includes(typeof value)) return
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('catalog numbers must be finite'); return }
    if (!value || typeof value !== 'object') fail('catalog requires plain data')
    const object = value as object
    if (![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(object))) fail('catalog requires plain objects and arrays')
    const descriptors = Object.getOwnPropertyDescriptors(object)
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) fail('catalog arrays must be dense')
      for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, String(index))) fail('catalog arrays must be dense')
    }
    for (const key of Reflect.ownKeys(object)) {
      if (Array.isArray(value) && key === 'length') continue
      if (typeof key !== 'string') fail('catalog cannot contain symbol fields')
      const descriptor = descriptors[key as string]
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('catalog cannot contain accessors or hidden data')
      data(descriptor!.value, depth + 1)
    }
  }
  for (const source of sources) {
    if (!Array.isArray(source) || Object.getPrototypeOf(source) !== Array.prototype || source.length > 16 || Reflect.ownKeys(source).length !== source.length + 1) fail('host catalogs require at most 16 dense entries')
    for (let index = 0; index < source.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(source, String(index))
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('host catalogs cannot contain accessors')
      const supplied = descriptor!.value as ReadonlyDeep<KJHatchPatternCatalog>
      let catalog: ReadonlyDeep<KJHatchPatternCatalog>
      if (supplied && validatedHatchCatalogs.has(supplied)) catalog = supplied
      else {
        data(supplied)
        const copy = structuredClone(supplied) as KJHatchPatternCatalog
        if (!copy || copy.version !== '1.0.0' || !Array.isArray(copy.patterns) || copy.patterns.length < 1 || copy.patterns.length > 256) fail('catalog requires version 1.0.0 and 1–256 patterns')
        const names = new Set<string>()
        for (const pattern of copy.patterns) {
          if (typeof pattern.name !== 'string' || !pattern.name.trim() || pattern.name.length > 128 || /[\u0000-\u001f\u007f]/.test(pattern.name) || names.has(pattern.name.toUpperCase())) fail('pattern names must be bounded and unique')
          if (typeof pattern.description !== 'string' || pattern.description.length > 256 || /[\u0000-\u001f\u007f]/.test(pattern.description)) fail('pattern descriptions must be bounded printable text')
          const aliases = (pattern as typeof pattern & { aliases?: unknown }).aliases
          if (aliases !== undefined && (!Array.isArray(aliases) || aliases.length > 16 || aliases.some(alias =>
            typeof alias !== 'string' || !alias.trim() || alias.length > 128 || /[\u0000-\u001f\u007f]/.test(alias)))) fail('pattern aliases require at most 16 bounded printable names')
          if (!Array.isArray(pattern.lines) || pattern.lines.length < 1 || pattern.lines.length > 128) fail('patterns require 1–128 complete native line families')
          names.add(pattern.name.toUpperCase())
          hatchPatternFromCatalog(copy, pattern.name)
        }
        if (copy.contentHash !== stableHash(copy.patterns)) fail('catalog content hash does not match its complete definitions')
        if (new TextEncoder().encode(JSON.stringify(copy)).length > 4194304) fail('catalog exceeds 4 MiB')
        catalog = deepFreeze(copy)
        validatedHatchCatalogs.add(catalog)
      }
      const identity = canonicalStringify(catalog)!
      if (identities.has(identity)) continue
      if (catalogs.length >= 16 || count + catalog.patterns.length > 256) fail('host catalogs exceed 16 catalogs / 256 patterns')
      identities.add(identity); count += catalog.patterns.length; catalogs.push(catalog)
    }
  }
  return deepFreeze(catalogs) as ReadonlyDeep<KJHatchPatternCatalog[]>
}

function constructorHatchPatternCatalogs(options: KJDrawSDKOptions): ReadonlyDeep<KJHatchPatternCatalog[]> {
  for (const key of ['hatchPatternCatalogs', 'includeBundledHatchPatterns']) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)
    if ((!descriptor && key in options) || descriptor && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) {
      throw new KJValidationError(`SDK ${key} must be an own enumerable data property`)
    }
  }
  const selected = Object.getOwnPropertyDescriptor(options, 'includeBundledHatchPatterns')?.value
  if (selected !== undefined && typeof selected !== 'boolean') throw new KJValidationError('SDK includeBundledHatchPatterns must be boolean')
  const supplied = Object.getOwnPropertyDescriptor(options, 'hatchPatternCatalogs')?.value
  return mergeHatchPatternCatalogs(selected === false ? [] : [KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG], supplied === undefined ? [] : supplied)
}

function copyContourBackend(options: KJContourBackendOptions): KJContourBackendOptions {
  if (options.wasmBytes !== undefined) {
    return Object.freeze({ wasmBytes: options.wasmBytes instanceof Uint8Array ? new Uint8Array(options.wasmBytes) : new Uint8Array(options.wasmBytes.slice(0)) })
  }
  if (options.wasmUrl !== undefined) return Object.freeze({ wasmUrl: typeof options.wasmUrl === 'string' ? options.wasmUrl : new URL(options.wasmUrl) })
  return Object.freeze({})
}

function constructorContourBackend(options: KJDrawSDKOptions): KJContourBackendOptions {
  const descriptor = Object.getOwnPropertyDescriptor(options, 'contourBackend')
  if ((!descriptor && 'contourBackend' in options) || descriptor && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) {
    throw new KJValidationError('SDK contourBackend must be an own enumerable data property')
  }
  const supplied = descriptor?.value as KJContourBackendOptions | undefined
  if (supplied === undefined) return Object.freeze({})
  if (!supplied || typeof supplied !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(supplied))) throw new KJValidationError('SDK contourBackend must be a plain data object')
  for (const key of Reflect.ownKeys(supplied)) {
    const field = Object.getOwnPropertyDescriptor(supplied, key)!
    if (typeof key !== 'string' || !['wasmBytes', 'wasmUrl'].includes(key) || !field.enumerable || !Object.hasOwn(field, 'value')) throw new KJValidationError('SDK contourBackend supports only wasmBytes or wasmUrl data properties')
  }
  if (supplied.wasmBytes !== undefined && supplied.wasmUrl !== undefined) throw new KJValidationError('SDK contourBackend accepts either wasmBytes or wasmUrl, not both')
  if (supplied.wasmBytes !== undefined) {
    if (!(supplied.wasmBytes instanceof Uint8Array) && !(supplied.wasmBytes instanceof ArrayBuffer)) throw new KJValidationError('SDK contourBackend wasmBytes must be a Uint8Array or ArrayBuffer')
    if (supplied.wasmBytes.byteLength === 0 || supplied.wasmBytes.byteLength > 4 * 1024 * 1024) throw new KJValidationError('SDK contour WASM asset exceeds the 4 MiB budget or is empty')
  }
  if (supplied.wasmUrl !== undefined && typeof supplied.wasmUrl !== 'string' && !(supplied.wasmUrl instanceof URL)) throw new KJValidationError('SDK contourBackend wasmUrl must be a string or URL')
  return copyContourBackend(supplied)
}

export class KJDrawSDK {
  readonly version: string
  readonly events: KJEventBus<KJDrawSDKEvents>
  readonly extensions: KJExtensionRegistry
  readonly commands: KJCommandRegistry
  readonly fileAdapters: KJFileAdapterRegistry
  readonly documents: Map<string, KJDocument>
  readonly selections: Map<string, KJSelectionManager>
  readonly agentPlans: KJAgentPlanRegistry
  readonly #hatchPatternCatalogs: ReadonlyDeep<KJHatchPatternCatalog[]>
  readonly #contourBackend: KJContourBackendOptions
  activeDocumentId: string | null
  documentAuthority: KJDocumentAuthorityProvider | null
  solidAuthority: Readonly<KJCoreSolidBackend> | null

  constructor(options: KJDrawSDKOptions = {}) {
    this.#contourBackend = constructorContourBackend(options)
    Object.defineProperty(this, 'contourBackend', { enumerable: true, configurable: false,
      get: () => copyContourBackend(this.#contourBackend) })
    this.#hatchPatternCatalogs = constructorHatchPatternCatalogs(options)
    Object.defineProperty(this, 'hatchPatternCatalogs', { enumerable: true, configurable: false,
      get: () => this.#hatchPatternCatalogs })
    this.version = options.version ?? KJDRAW_VERSION
    this.events = new KJEventBus<KJDrawSDKEvents>()
    this.extensions = new KJExtensionRegistry()
    this.commands = new KJCommandRegistry()
    this.fileAdapters = new KJFileAdapterRegistry()
    this.documents = new Map<string, KJDocument>()
    this.selections = new Map<string, KJSelectionManager>()
    this.activeDocumentId = null
    this.documentAuthority = options.documentAuthority ?? null
    this.solidAuthority = options.solidAuthority ?? null
    this.agentPlans = options.agentPlans ?? new KJAgentPlanRegistry(options.agentPlanOptions)
    registerCoreCommands(this.commands)
    if (options.registerDefaultAdapters !== false) {
      this.fileAdapters.register(createKJDFileAdapter())
      this.fileAdapters.register(createDXFFileAdapter())
      this.fileAdapters.register(createSVGFileAdapter())
    }
    if (options.dwgConversionProvider) this.fileAdapters.register(createDwgConversionFileAdapter({ provider: options.dwgConversionProvider }))
  }

  /** Host-selected immutable catalog snapshot. There is intentionally no setter. */
  get hatchPatternCatalogs(): ReadonlyDeep<KJHatchPatternCatalog[]> { return this.#hatchPatternCatalogs }

  /** Detached host asset options for read-only previews. Commands use the same constructor snapshot. */
  get contourBackend(): KJContourBackendOptions { return copyContourBackend(this.#contourBackend) }

  createDocument(options: KJDocumentOptions & KJDocumentConstructorOptions = {}): KJDocument {
    return this.attachDocument(KJDocument.create(options))
  }

  openDocument(input: KJOpenDocumentInput, options: KJDocumentConstructorOptions = {}): KJDocument {
    return this.attachDocument(KJDocument.open(input, options))
  }

  attachDocument(document: KJDocument): KJDocument {
    if (!(document instanceof KJDocument)) throw new KJValidationError('Expected a KJDocument')
    if (this.documentAuthority && !document.hasAuthoritativeBackend) {
      document.bindAuthority(this.documentAuthority.open(document.serialize()))
    }
    this.documents.set(document.id, document)
    if (!this.selections.has(document.id)) this.selections.set(document.id, new KJSelectionManager(document))
    this.activeDocumentId ??= document.id
    this.events.emit('document:attached', { document })
    return document
  }

  closeDocument(inputId: string): boolean {
    const id = String(inputId)
    const document = this.documents.get(id)
    if (!document) return false
    this.documents.delete(id)
    document.unbindAuthority()
    this.selections.get(id)?.dispose()
    this.selections.delete(id)
    if (this.activeDocumentId === id) this.activeDocumentId = this.documents.keys().next().value ?? null
    this.events.emit('document:closed', { documentId: id })
    return true
  }

  get activeDocument(): KJDocument | null {
    return this.activeDocumentId === null ? null : this.documents.get(this.activeDocumentId) ?? null
  }

  get activeSelection(): KJSelectionSet | null {
    return this.activeDocumentId === null ? null : this.selections.get(this.activeDocumentId)?.active ?? null
  }

  getSelectionManager(documentId: string | null = this.activeDocumentId): KJSelectionManager | null {
    return documentId === null ? null : this.selections.get(String(documentId)) ?? null
  }

  setDocumentAuthority(authority: KJDocumentAuthorityProvider): KJDocumentAuthorityProvider {
    if (!authority || authority.authoritative !== true || typeof authority.open !== 'function') {
      throw new KJValidationError('An authoritative document provider is required')
    }
    const newlyBound: KJDocument[] = []
    try {
      for (const document of this.documents.values()) {
        if (document.hasAuthoritativeBackend) continue
        document.bindAuthority(authority.open(document.serialize()))
        newlyBound.push(document)
      }
      this.documentAuthority = authority
      this.events.emit('document:authority-ready', { authority, documentIds: [...this.documents.keys()] })
      return authority
    } catch (error) {
      for (const document of newlyBound.reverse()) document.unbindAuthority()
      throw error
    }
  }

  setSolidAuthority(authority: Readonly<KJCoreSolidBackend>): Readonly<KJCoreSolidBackend> {
    if (!authority || authority.authoritative !== true || typeof authority.openMesh !== 'function' || typeof authority.box !== 'function') {
      throw new KJValidationError('An authoritative KJCore solid provider is required')
    }
    this.solidAuthority = authority
    this.events.emit('solid:authority-ready', { authority })
    return authority
  }

  setActiveDocument(inputId: string): KJDocument {
    const id = String(inputId)
    const document = this.documents.get(id)
    if (!document) throw new KJValidationError(`Document is not attached: ${id}`)
    this.activeDocumentId = id
    this.events.emit('document:active-changed', { documentId: id })
    return document
  }

  executeCommand<TResult = unknown>(
    id: string,
    args?: KJCommandArguments,
    options?: KJExecuteCommandOptions,
  ): Promise<TResult>
  executeCommand<TResult = unknown>(
    envelope: Readonly<KJCommandEnvelope>,
    options?: KJExecuteCommandEnvelopeOptions,
  ): Promise<KJSDKCommandEnvelopeReceipt<TResult>>
  executeCommand<TResult = unknown>(
    idOrEnvelope: string | Readonly<KJCommandEnvelope>,
    argsOrOptions: KJCommandArguments | KJExecuteCommandEnvelopeOptions = {},
    options: KJExecuteCommandOptions = {},
  ): Promise<TResult> | Promise<KJSDKCommandEnvelopeReceipt<TResult>> {
    if (typeof idOrEnvelope !== 'string') {
      return this.executeCommandEnvelope<TResult>(idOrEnvelope, argsOrOptions as KJExecuteCommandEnvelopeOptions)
    }
    const args = argsOrOptions as KJCommandArguments
    const document = options.document ?? this.activeDocument
    const context: KJCommandInputContext = {
      sdk: this,
      events: this.events,
      extensions: this.extensions,
      ...optionalProperty('document', document ?? undefined),
      ...optionalProperty('author', options.author),
      ...optionalProperty('expectedRevision', options.expectedRevision),
      ...optionalProperty('commandEnvelope', options.commandEnvelope),
      ...optionalProperty('expectedDefinition', options.expectedCommandDefinition),
    }
    return this.commands.execute(idOrEnvelope, context, args) as Promise<TResult>
  }

  createCommandEnvelope<TArguments extends Record<string, unknown> = KJCommandArguments>(
    command: string,
    args: TArguments = {} as TArguments,
    options: KJCreateSDKCommandEnvelopeOptions = {},
  ): Readonly<KJCommandEnvelope<TArguments>> {
    const { document: optionDocument, ...envelopeOptions } = options
    const document = optionDocument ?? this.activeDocument
    const documentId = options.documentId ?? document?.id
    return createProtocolCommandEnvelope(command, args, {
      ...envelopeOptions,
      ...optionalProperty('documentId', documentId),
    })
  }

  async executeCommandEnvelope<TResult = unknown>(
    input: unknown,
    options: KJExecuteCommandEnvelopeOptions = {},
  ): Promise<KJSDKCommandEnvelopeReceipt<TResult>> {
    const envelope = validateCommandEnvelope(input)
    const document = options.document ?? this.documents.get(envelope.documentId)
    if (!document) throw new KJValidationError(`Command document is not attached: ${envelope.documentId}`)
    if (document.id !== envelope.documentId) throw new KJValidationError(`Command document mismatch: ${envelope.documentId}`)
    const beforeRevision = document.revision
    if (envelope.mode === 'plan') {
      const plan = envelope.origin.kind === 'ai'
        ? await this.agentPlans.register(envelope, document, options.agentPlanOptions)
        : null
      const receipt = createCommandReceipt(envelope, {
        status: 'planned',
        beforeRevision,
        afterRevision: beforeRevision,
        result: plan,
      })
      this.events.emit('command:planned', { envelope, receipt, document, plan })
      return receipt
    }
    const agentPlan = envelope.origin.kind === 'ai' ? await this.agentPlans.consume(envelope, document) : null
    this.events.emit('command:before-execute', { envelope, document, beforeRevision, agentPlan })
    try {
      const result = await this.executeCommand<TResult>(envelope.command, envelope.arguments as KJCommandArguments, {
        ...options,
        document,
        ...optionalProperty('expectedRevision', envelope.expectedRevision ?? undefined),
        commandEnvelope: envelope,
        ...optionalProperty('expectedCommandDefinition', options.expectedCommandDefinition),
      })
      const receipt = createCommandReceipt(envelope, {
        status: 'committed',
        beforeRevision,
        afterRevision: document.revision,
        result,
      })
      this.events.emit('command:committed', { envelope, receipt, document })
      return receipt
    } catch (error) {
      this.events.emit('command:failed', {
        envelope,
        document,
        beforeRevision,
        afterRevision: document.revision,
        error,
      })
      throw error
    }
  }

  snap(cursor: KJSnapPointInput, options: KJSnapSDKOptions = {}): readonly Readonly<KJSnapCandidate>[] {
    const document = options.document ?? this.activeDocument
    if (!document) throw new KJValidationError('Snap requires an active KJDocument')
    const { document: _document, ...snapOptions } = options
    return findSnapCandidates(document, cursor, snapOptions)
  }

  async readDocument(source: unknown, options: KJFileAdapterOptions = {}): Promise<KJDocument> {
    const result = await this.fileAdapters.read(source, options)
    if (result instanceof KJDocument) return this.attachDocument(result)
    if (!isOpenDocumentInput(result)) throw new KJValidationError('File adapter did not return a KJDocument-compatible value')
    return this.attachDocument(KJDocument.open(result, options as KJDocumentConstructorOptions))
  }

  writeDocument<TResult = unknown>(
    document: KJDocument | null = this.activeDocument,
    options: KJFileAdapterOptions = {},
  ): Promise<TResult> {
    if (!(document instanceof KJDocument)) throw new KJValidationError('Expected a KJDocument')
    return this.fileAdapters.write(document, options) as Promise<TResult>
  }

  capabilities(): ReturnType<typeof buildSDKCapabilityManifest> {
    return buildSDKCapabilityManifest(this)
  }

  createPluginScope(manifestInput: unknown, { grantedPermissions = [] }: KJPluginScopeOptions = {}): Readonly<KJPluginScope> {
    const manifest = assertPluginCompatibility(manifestInput, { sdkVersion: this.version })
    const grant = createPluginGrant(manifest, grantedPermissions)
    const owner = manifest.id
    const disposers: KJRegistrationDisposer[] = []
    const track = (dispose: KJRegistrationDisposer): KJRegistrationDisposer => {
      disposers.push(dispose)
      return dispose
    }
    const authorize = (
      permission: KJPluginPermission,
      kind: KJPluginContributionKind,
      id: unknown,
    ): void => {
      assertPluginPermission(grant, permission)
      assertPluginContribution(manifest, kind, id)
    }
    const scope: KJPluginScope = {
      owner,
      manifest,
      registerCommand: definition => {
        authorize('commands.register', 'commands', definition.id)
        return track(this.commands.register(definition, { owner }))
      },
      registerExtension: (point, definition) => {
        authorize('extensions.register', 'extensions', `${point}/${String(definition.id ?? '')}`)
        return track(this.extensions.register(point, definition, { owner }))
      },
      registerFileAdapter: definition => {
        authorize('file-adapters.register', 'fileAdapters', definition.id)
        return track(this.fileAdapters.register(definition))
      },
      executeCommand: <TResult = unknown>(
        id: string,
        args: KJCommandArguments = {},
        commandOptions: KJExecuteCommandOptions = {},
      ): Promise<TResult> => {
        assertPluginPermission(grant, 'commands.execute')
        return this.executeCommand<TResult>(id, args, commandOptions)
      },
      dispose: (): void => {
        for (const dispose of disposers.splice(0).reverse()) dispose()
        this.commands.removeOwner(owner)
        this.extensions.removeOwner(owner)
      },
    }
    return Object.freeze(scope)
  }
}

export function createKJDrawSDK(options: KJDrawSDKOptions = {}): KJDrawSDK {
  return new KJDrawSDK(options)
}
