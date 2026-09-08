import { KJDocument } from './document.js'
import { KJEventBus } from './events.js'
import type { KJEventSubscriptionOptions } from './events.js'
import { KJValidationError } from './errors.js'
import { createId } from './ids.js'
import { createKjpPackage, openKjpPackage } from './project-package.js'
import type { KjpCreateOptions, KjpEntryValue, KjpOpenOptions, KjpSource } from './project-package.js'
import { clone, deepFreeze, nowIso } from './utils.js'
import type { ReadonlyDeep } from './utils.js'

const SNAPSHOT_SCHEMA = 'com.kanjie.kjdraw.snapshot@1'

type KJOpenInput = Parameters<typeof KJDocument.open>[0]
type KJProjectState = 'unbound' | 'dirty' | 'saving' | 'saved' | 'error'
type KJDisposer = () => unknown

export interface KJProjectCommandRecord {
  envelope: unknown
  receipt: unknown
}

export interface KJProjectSnapshotDocument {
  id: string
  path: string
  revision: number
  fingerprint: string
}

export interface KJProjectSnapshotRecord {
  schema: typeof SNAPSHOT_SCHEMA
  id: string
  label: string
  at: string
  activeDocumentId: string | null
  documents: KJProjectSnapshotDocument[]
}

export interface KJProjectStateSnapshot {
  id: string
  title: string
  state: KJProjectState
  dirty: boolean
  activeDocumentId: string | null
  modifiedAt: string
  reason: string
  error: string | null
}

interface KJProjectEvents {
  'active-document': { documentId: string }
  command: { envelope: unknown; receipt: unknown; documentId: string }
  state: ReadonlyDeep<KJProjectStateSnapshot>
}

interface KJCommandCommittedEvent {
  envelope: unknown
  receipt: unknown
  document?: KJDocument | null
}

export interface KJProjectSDK {
  readonly documents: Map<string, KJDocument>
  readonly events: {
    on(name: 'command:committed', listener: (value: KJCommandCommittedEvent) => void, options?: KJEventSubscriptionOptions): KJDisposer
  }
  attachDocument(document: KJDocument): KJDocument
  closeDocument(id: string): boolean
  setActiveDocument(id: string): KJDocument | null
}

export interface KJProjectSessionOptions {
  sdk?: KJProjectSDK
  id?: string
  title?: string
  createdAt?: string
  metadata?: Record<string, unknown>
  migrations?: readonly unknown[]
}

export interface KJProjectCreateOptions extends KJProjectSessionOptions {
  documents?: ReadonlyMap<string, KJOpenInput | KJDocument> | readonly (KJOpenInput | KJDocument)[] | Readonly<Record<string, KJOpenInput | KJDocument>>
  documentId?: string
  activeDocumentId?: string
}

export interface KJProjectOpenOptions extends KjpOpenOptions {
  sdk?: KJProjectSDK
}

export interface KJProjectSnapshotOptions {
  id?: string
  at?: string
  limit?: number
}

export interface KJProjectPackageOptions {
  modifiedAt?: string
  writerVersion?: string
  recovery?: KjpCreateOptions['recovery']
  diagnostics?: KjpCreateOptions['diagnostics']
}

function projectId(value: unknown): string {
  const id = String(value ?? '').trim()
  if (!id) throw new KJValidationError('KJDraw 工程 id 不能为空')
  return id
}

function entryMap(entries: ReadonlyMap<string, Uint8Array> | undefined, prefix: string): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>()
  for (const [path, value] of entries ?? []) if (path.startsWith(prefix)) result.set(path.slice(prefix.length), value)
  return result
}

function documentRows(input: KJProjectCreateOptions['documents']): [string | undefined, KJOpenInput | KJDocument][] {
  if (input instanceof Map) return [...input]
  if (Array.isArray(input)) return input.map(document => [document instanceof KJDocument ? document.id : undefined, document])
  return Object.entries(input ?? {})
}

function normalizeDocument(input: KJOpenInput | KJDocument): KJDocument {
  return input instanceof KJDocument ? input : KJDocument.open(input)
}

/**
 * An in-memory project session. It owns KJD document membership, the command
 * journal and package metadata, while a platform file binding owns I/O.
 * Renderers and Vue stores are projections only and are deliberately absent.
 */
export class KJProjectSession {
  #events = new KJEventBus<KJProjectEvents>()
  #documentOff = new Map<string, KJDisposer>()
  #sdkOff: KJDisposer[] = []
  #savedFingerprint = ''

  readonly sdk: KJProjectSDK
  readonly id: string
  title: string
  readonly createdAt: string
  modifiedAt: string
  metadata: Record<string, unknown>
  migrations: unknown[]
  readonly documents = new Map<string, KJDocument>()
  activeDocumentId: string | null = null
  commands: ReadonlyDeep<KJProjectCommandRecord>[] = []
  assets = new Map<string, KjpEntryValue>()
  snapshots = new Map<string, KjpEntryValue>()
  snapshotLedger: ReadonlyDeep<KJProjectSnapshotRecord>[] = []
  dirty = false
  state: KJProjectState = 'unbound'
  lastError: Error | null = null

  constructor({ sdk, id, title = '未命名工程', createdAt, metadata = {}, migrations = [] }: KJProjectSessionOptions = {}) {
    if (!sdk?.attachDocument || !sdk?.events) throw new KJValidationError('KJProjectSession 需要 KJDrawSDK')
    this.sdk = sdk
    this.id = projectId(id ?? createId('project'))
    this.title = String(title || '未命名工程')
    this.createdAt = String(createdAt ?? nowIso())
    this.modifiedAt = this.createdAt
    this.metadata = clone(metadata)
    this.migrations = clone([...migrations])
    this.#sdkOff.push(sdk.events.on('command:committed', value => this.#recordCommand(value)))
  }

  static create(options: KJProjectCreateOptions & { sdk: KJProjectSDK }): KJProjectSession {
    const session = new KJProjectSession(options)
    for (const [, input] of documentRows(options.documents)) session.attachDocument(normalizeDocument(input))
    if (!session.documents.size) session.attachDocument(KJDocument.create({ documentId: options.documentId ?? 'model', title: session.title }))
    const firstDocumentId = session.documents.keys().next().value
    if (!firstDocumentId) throw new KJValidationError('KJDraw 工程无法创建默认图纸')
    session.setActiveDocument(options.activeDocumentId ?? firstDocumentId)
    session.dirty = true
    session.state = 'unbound'
    return session
  }

  static async open(source: KjpSource, options: KJProjectOpenOptions & { sdk: KJProjectSDK }): Promise<KJProjectSession> {
    const opened = await openKjpPackage(source, options)
    const session = new KJProjectSession({
      sdk: options.sdk,
      id: opened.manifest.projectId,
      title: opened.manifest.title,
      createdAt: opened.manifest.createdAt,
      metadata: opened.manifest.metadata,
      migrations: opened.manifest.migrations,
    })
    session.modifiedAt = opened.manifest.modifiedAt
    session.commands = clone(opened.commands) as ReadonlyDeep<KJProjectCommandRecord>[]
    session.assets = entryMap(opened.entries, 'assets/')
    session.snapshots = entryMap(opened.entries, 'snapshots/')
    const snapshots = opened.manifest.metadata.snapshots
    session.snapshotLedger = Array.isArray(snapshots) ? clone(snapshots) as ReadonlyDeep<KJProjectSnapshotRecord>[] : []
    for (const document of opened.drawings.values()) session.attachDocument(document)
    session.setActiveDocument(opened.manifest.activeDrawing)
    session.dirty = false
    session.state = 'saved'
    session.#savedFingerprint = session.fingerprint()
    return session
  }

  on<Name extends keyof KJProjectEvents>(
    name: Name,
    listener: (payload: KJProjectEvents[Name]) => void,
    options?: KJEventSubscriptionOptions,
  ): () => boolean {
    return this.#events.on(name, listener, options)
  }

  attachDocument(input: KJOpenInput | KJDocument): KJDocument {
    const document = normalizeDocument(input)
    const existing = this.documents.get(document.id)
    if (existing && existing !== document) this.detachDocument(document.id)
    if (!this.sdk.documents.has(document.id)) this.sdk.attachDocument(document)
    else if (this.sdk.documents.get(document.id) !== document) throw new KJValidationError(`SDK 已存在不同的同名图纸：${document.id}`)
    this.documents.set(document.id, document)
    this.#documentOff.set(document.id, document.on('document:change', () => this.markDirty('document-change')))
    this.activeDocumentId ??= document.id
    return document
  }

  detachDocument(id: unknown): boolean {
    const documentId = String(id)
    if (!this.documents.has(documentId)) return false
    this.#documentOff.get(documentId)?.()
    this.#documentOff.delete(documentId)
    this.documents.delete(documentId)
    this.sdk.closeDocument(documentId)
    if (this.activeDocumentId === documentId) this.activeDocumentId = this.documents.keys().next().value ?? null
    this.markDirty('document-detached')
    return true
  }

  setActiveDocument(id: unknown): KJDocument {
    const documentId = String(id)
    const document = this.documents.get(documentId)
    if (!document) throw new KJValidationError(`工程中不存在图纸：${documentId}`)
    this.activeDocumentId = documentId
    this.sdk.setActiveDocument(documentId)
    this.#events.emit('active-document', { documentId })
    return document
  }

  get activeDocument(): KJDocument | null {
    return this.activeDocumentId ? this.documents.get(this.activeDocumentId) ?? null : null
  }

  #recordCommand({ envelope, receipt, document }: KJCommandCommittedEvent): void {
    if (!document || !this.documents.has(document.id)) return
    this.commands.push(deepFreeze({ envelope: clone(envelope), receipt: clone(receipt) }))
    this.markDirty('command')
    this.#events.emit('command', { envelope, receipt, documentId: document.id })
  }

  markDirty(reason = 'change'): void {
    this.modifiedAt = nowIso()
    this.dirty = true
    if (this.state !== 'saving' && this.state !== 'error') this.state = 'dirty'
    this.#events.emit('state', this.snapshotState(reason))
  }

  snapshotState(reason = ''): ReadonlyDeep<KJProjectStateSnapshot> {
    return deepFreeze({
      id: this.id,
      title: this.title,
      state: this.state,
      dirty: this.dirty,
      activeDocumentId: this.activeDocumentId,
      modifiedAt: this.modifiedAt,
      reason,
      error: this.lastError?.message ?? null,
    })
  }

  fingerprint(): string {
    return [...this.documents.values()].map(document => `${document.id}:${document.fingerprint()}`).sort().join('|')
  }

  createSnapshot(label = '版本快照', options: KJProjectSnapshotOptions = {}): ReadonlyDeep<KJProjectSnapshotRecord> {
    const id = String(options.id ?? createId('snapshot'))
    const at = String(options.at ?? nowIso())
    const documents: KJProjectSnapshotDocument[] = []
    for (const document of this.documents.values()) {
      const path = `${id}/${document.id}.kjd`
      this.snapshots.set(path, document.serialize())
      documents.push({ id: document.id, path: `snapshots/${path}`, revision: document.revision, fingerprint: document.fingerprint() })
    }
    const record = deepFreeze<KJProjectSnapshotRecord>({ schema: SNAPSHOT_SCHEMA, id, label: String(label), at, activeDocumentId: this.activeDocumentId, documents })
    this.snapshotLedger.push(record)
    const limit = Math.max(1, Number(options.limit ?? 100))
    while (this.snapshotLedger.length > limit) {
      const removed = this.snapshotLedger.shift()
      if (!removed) break
      for (const row of removed.documents) this.snapshots.delete(row.path.replace(/^snapshots\//, ''))
    }
    this.markDirty('snapshot')
    return record
  }

  async package(options: KJProjectPackageOptions = {}): Promise<Uint8Array> {
    if (!this.documents.size || !this.activeDocumentId) throw new KJValidationError('空工程不能保存')
    const modifiedAt = String(options.modifiedAt ?? this.modifiedAt ?? nowIso())
    return createKjpPackage({
      projectId: this.id,
      title: this.title,
      drawings: this.documents,
      activeDrawing: this.activeDocumentId,
      commands: this.commands,
      assets: this.assets,
      snapshots: this.snapshots,
      createdAt: this.createdAt,
      modifiedAt,
      migrations: this.migrations,
      metadata: { ...clone(this.metadata), snapshots: clone(this.snapshotLedger) },
      ...(options.writerVersion === undefined ? {} : { writerVersion: options.writerVersion }),
      ...(options.recovery === undefined ? {} : { recovery: options.recovery }),
      ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    })
  }

  beginSave(): void {
    this.state = 'saving'
    this.lastError = null
    this.#events.emit('state', this.snapshotState('save-start'))
  }

  markSaved(): void {
    this.#savedFingerprint = this.fingerprint()
    this.dirty = false
    this.state = 'saved'
    this.lastError = null
    this.#events.emit('state', this.snapshotState('save-complete'))
  }

  markSaveError(error: unknown): void {
    this.dirty = true
    this.state = 'error'
    this.lastError = error instanceof Error ? error : new Error(String(error || '工程保存失败'))
    this.#events.emit('state', this.snapshotState('save-error'))
  }

  hasChangedSinceSave(): boolean { return this.dirty || this.fingerprint() !== this.#savedFingerprint }

  destroy(): void {
    for (const off of this.#sdkOff.splice(0)) off()
    for (const off of this.#documentOff.values()) off()
    this.#documentOff.clear()
    for (const id of this.documents.keys()) this.sdk.closeDocument(id)
    this.documents.clear()
    this.#events.clear()
  }
}

export { SNAPSHOT_SCHEMA }
