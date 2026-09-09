import { KJ_EVENT_NAMES } from './constants.js'
import type { KJObjectKind, KJTableName } from './constants.js'
import { KJEventBus } from './events.js'
import { KJRevisionConflictError, KJTransactionError, KJValidationError } from './errors.js'
import {
  createEmptyDocumentState,
  migrateDocumentState,
  validateDocumentState,
} from './schema.js'
import { KJTransaction } from './transaction.js'
import { canonicalStringify, clone, deepFreeze, nowIso, stableHash } from './utils.js'
import type {
  KJDocumentOptions,
  KJDocumentState,
  KJLegacyScene,
  KJReadonlyObjectRecord,
  KJRevisionRecord,
  KJValidationResult,
} from './schema.js'
import type { ReadonlyDeep } from './utils.js'

export interface KJDocumentHistory {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

export interface KJDocumentAuthority {
  commit(serialized: string, expectedRevision: number): Promise<string | KJDocumentState> | string | KJDocumentState
  serialize(): string | KJDocumentState
  close(): void
}

export interface KJDocumentConstructorOptions {
  historyLimit?: number
}

export interface KJDocumentQuery {
  kind?: KJObjectKind
  type?: string
  ownerId?: string
  includeErased?: boolean
}

export interface KJDocumentTransactionOptions {
  expectedRevision?: number
  metadata?: Record<string, unknown>
  at?: string
  author?: unknown
  source?: string
}

export interface KJDocumentHistoryOptions {
  expectedRevision?: number
  at?: string
  author?: unknown
  source?: string
}

export interface KJDocumentTableView {
  currentId: string | null
  records: ReadonlyArray<KJReadonlyObjectRecord>
}

export type KJDocumentInput = KJDocumentOptions | KJDocumentState | KJLegacyScene | Record<string, unknown>

export interface KJDocumentChangePayload {
  document: ReadonlyDeep<KJDocumentState>
  revision: ReadonlyDeep<KJRevisionRecord> | undefined
  history: Readonly<KJDocumentHistory>
}

export interface KJDocumentBeforeCommitPayload {
  before: ReadonlyDeep<KJDocumentState>
  after: ReadonlyDeep<KJDocumentState>
  revision: ReadonlyDeep<KJRevisionRecord>
}

interface KJDocumentEvents {
  'document:before-commit': KJDocumentBeforeCommitPayload
  'document:after-commit': KJDocumentChangePayload
  'document:change': KJDocumentChangePayload
  'document:undo': KJDocumentChangePayload
  'document:redo': KJDocumentChangePayload
  'document:history': Readonly<KJDocumentHistory>
}

interface KJHistoryEntry {
  label: string
  before: KJDocumentState
  after: KJDocumentState
  revision: number
}

interface KJRestoreOptions extends KJDocumentHistoryOptions {
  kind: 'undo' | 'redo'
  label: string
  targetRevision: number
}

function contentForFingerprint(state: KJDocumentState): KJDocumentState {
  return {
    ...state,
    revision: 0,
    revisions: [],
    metadata: { ...state.metadata, modifiedAt: null },
  }
}

/**
 * Fork the mutable transaction shell while sharing immutable object records.
 * KJTransaction owns copy-on-write for every object it mutates. This keeps a
 * one-object edit O(document metadata + touched objects) instead of cloning
 * every entity before work even begins.
 */
function createTransactionState(state: KJDocumentState): KJDocumentState {
  return {
    ...state,
    header: { ...state.header, systemVariables: { ...state.header.systemVariables } },
    tables: Object.fromEntries(Object.entries(state.tables).map(([name, table]) => [name, {
      currentId: table.currentId,
      recordIds: [...table.recordIds],
    }])) as KJDocumentState['tables'],
    spaces: {
      ...state.spaces,
      paperSpaceIds: [...state.spaces.paperSpaceIds],
      layoutIds: [...state.spaces.layoutIds],
    },
    objects: { ...state.objects },
    resources: Object.fromEntries(Object.entries(state.resources).map(([name, collection]) => [name, {
      ...collection,
    }])) as KJDocumentState['resources'],
    opaquePayloads: { ...state.opaquePayloads },
    revisions: [...state.revisions],
    metadata: {
      ...state.metadata,
      tags: [...state.metadata.tags],
      custom: { ...state.metadata.custom },
    },
  }
}

export class KJDocument {
  #state: KJDocumentState
  #events = new KJEventBus<KJDocumentEvents>()
  #undo: KJHistoryEntry[] = []
  #redo: KJHistoryEntry[] = []
  #historyLimit: number
  #queue: Promise<unknown> = Promise.resolve()
  #authority: KJDocumentAuthority | null = null
  #snapshotCache: ReadonlyDeep<KJDocumentState> | null = null
  #fingerprintCache: string | null = null
  #objectCache = new Map<string, KJReadonlyObjectRecord | null>()
  #queryCache = new Map<string, ReadonlyArray<KJReadonlyObjectRecord>>()
  #tableCache = new Map<string, Readonly<KJDocumentTableView> | null>()

  constructor(input: KJDocumentInput = {}, options: KJDocumentConstructorOptions = {}) {
    const candidate = input as Record<string, unknown>
    const state = candidate?.schema || Array.isArray(candidate?.entities) || Array.isArray(candidate?.layers)
      ? migrateDocumentState(input)
      : createEmptyDocumentState(input as KJDocumentOptions)
    validateDocumentState(state)
    this.#state = clone(state)
    this.#historyLimit = Math.max(1, Number(options.historyLimit ?? 500))
  }

  static create(options: KJDocumentOptions & KJDocumentConstructorOptions = {}): KJDocument { return new KJDocument(options, options) }
  static open(input: string | KJDocumentState | KJLegacyScene | Record<string, unknown>, options: KJDocumentConstructorOptions = {}): KJDocument { return new KJDocument(typeof input === 'string' ? JSON.parse(input) as KJDocumentState : input, options) }

  /** Detached copy-on-write branch at the current revision. Shares unchanged
   * internal records, never authority, listeners, queued work or undo history.
   * Edits on either branch still undergo normal document validation. */
  fork(): KJDocument {
    const branch = KJDocument.create({ historyLimit: this.#historyLimit })
    branch.#state = this.#state
    branch.#snapshotCache = this.#snapshotCache
    branch.#fingerprintCache = this.#fingerprintCache
    return branch
  }

  get id(): string { return this.#state.documentId }
  get revision(): number { return this.#state.revision }
  get schemaVersion(): number { return this.#state.schemaVersion }
  get hasAuthoritativeBackend(): boolean { return this.#authority != null }
  get history(): Readonly<KJDocumentHistory> {
    return Object.freeze({
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      undoLabel: this.#undo.at(-1)?.label ?? null,
      redoLabel: this.#redo.at(-1)?.label ?? null,
    })
  }

  on<Name extends keyof KJDocumentEvents>(name: Name, listener: (payload: KJDocumentEvents[Name]) => void, options?: { signal?: AbortSignal }): () => boolean { return this.#events.on(name, listener, options) }
  once<Name extends keyof KJDocumentEvents>(name: Name, listener: (payload: KJDocumentEvents[Name]) => void, options?: { signal?: AbortSignal }): () => boolean { return this.#events.once(name, listener, options) }

  snapshot(): ReadonlyDeep<KJDocumentState> {
    this.#snapshotCache ??= deepFreeze(clone(this.#state))
    return this.#snapshotCache
  }
  toJSON({ includeRevisions = true }: { includeRevisions?: boolean } = {}): KJDocumentState {
    const state = clone(this.#state)
    if (!includeRevisions) state.revisions = []
    return state
  }
  serialize({ pretty = false, includeRevisions = true }: { pretty?: boolean; includeRevisions?: boolean } = {}): string { return canonicalStringify(this.toJSON({ includeRevisions }), pretty ? 2 : 0) ?? '' }
  fingerprint(): string {
    this.#fingerprintCache ??= stableHash(contentForFingerprint(this.#state))
    return this.#fingerprintCache
  }
  validate(): KJValidationResult { return validateDocumentState(this.#state, { throwOnError: false }) }

  bindAuthority(session: KJDocumentAuthority): this {
    if (!session || typeof session.commit !== 'function' || typeof session.serialize !== 'function' || typeof session.close !== 'function') {
      throw new KJValidationError('Document authority must expose commit, serialize and close')
    }
    try {
      const source = session.serialize()
      const accepted = typeof source === 'string' ? JSON.parse(source) as KJDocumentState : source
      validateDocumentState(accepted)
      if (accepted.documentId !== this.id || Number(accepted.revision) !== this.revision) {
        throw new KJValidationError('Document authority does not match the current document identity and revision')
      }
      this.unbindAuthority()
      this.#adoptState(clone(accepted))
      this.#authority = session
      return this
    } catch (error) {
      session.close()
      throw error
    }
  }

  unbindAuthority(): boolean {
    if (!this.#authority) return false
    const authority = this.#authority
    this.#authority = null
    authority.close()
    return true
  }

  getObject(id: string, { includeErased = false }: { includeErased?: boolean } = {}): KJReadonlyObjectRecord | null {
    const key = `${includeErased ? '1' : '0'}:${String(id)}`
    if (this.#objectCache.has(key)) return this.#objectCache.get(key) ?? null
    const object = this.#state.objects[String(id)]
    const result = !object || (object.erased && !includeErased) ? null : deepFreeze(clone(object))
    this.#objectCache.set(key, result)
    return result
  }

  listObjects({ kind, type, ownerId, includeErased = false }: KJDocumentQuery = {}): ReadonlyArray<KJReadonlyObjectRecord> {
    const normalizedType = type == null ? null : String(type).toUpperCase()
    const key = `${kind ?? ''}|${normalizedType ?? ''}|${ownerId ?? ''}|${includeErased ? '1' : '0'}`
    const cached = this.#queryCache.get(key)
    if (cached) return cached
    const result = Object.freeze(Object.values(this.#state.objects)
      .filter(object => includeErased || !object.erased)
      .filter(object => kind == null || object.kind === kind)
      .filter(object => normalizedType == null || object.type === normalizedType)
      .filter(object => ownerId == null || object.ownerId === ownerId)
      .map(object => this.getObject(object.id, { includeErased })!)) as ReadonlyArray<KJReadonlyObjectRecord>
    this.#queryCache.set(key, result)
    return result
  }

  listEntities(options: Omit<KJDocumentQuery, 'kind'> = {}): ReadonlyArray<KJReadonlyObjectRecord> { return this.listObjects({ ...options, kind: 'entity' }) }
  getTable(name: KJTableName | string): Readonly<KJDocumentTableView> | null {
    const key = String(name)
    if (this.#tableCache.has(key)) return this.#tableCache.get(key) ?? null
    const table = this.#state.tables[key as KJTableName]
    const result = table
      ? Object.freeze({ currentId: table.currentId, records: Object.freeze(table.recordIds.map(id => this.getObject(id, { includeErased: true })).filter((record): record is NonNullable<typeof record> => Boolean(record))) })
      : null
    this.#tableCache.set(key, result)
    return result
  }
  getActiveLayout(): KJReadonlyObjectRecord | null { return this.getObject(this.#state.spaces.activeLayoutId) }

  #adoptState(state: KJDocumentState, fingerprint: string | null = null): void {
    this.#state = state
    this.#snapshotCache = null
    this.#fingerprintCache = fingerprint
    this.#objectCache.clear()
    this.#queryCache.clear()
    this.#tableCache.clear()
  }

  #enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.#queue.then(work, work)
    this.#queue = result.catch(() => undefined)
    return result
  }

  transact<TResult>(label: string, work: (transaction: KJTransaction) => TResult | Promise<TResult>, options: KJDocumentTransactionOptions = {}): Promise<TResult> {
    if (typeof work !== 'function') return Promise.reject(new KJTransactionError('Transaction callback must be a function'))
    return this.#enqueue(() => this.#performTransaction(label, work, options))
  }

  async #performTransaction<TResult>(label: string, work: (transaction: KJTransaction) => TResult | Promise<TResult>, options: KJDocumentTransactionOptions): Promise<TResult> {
    if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
      throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, { documentId: this.id })
    }
    const before = this.#state
    const draft = createTransactionState(this.#state)
    const transaction = new KJTransaction(draft, { label, metadata: options.metadata ?? {} })
    try {
      const result = await work(transaction)
      validateDocumentState(draft, { previousState: before })
      const revision = this.#state.revision + 1
      draft.revision = revision
      draft.metadata.modifiedAt = options.at ?? nowIso()
      const record: KJRevisionRecord = {
        revision,
        kind: 'commit',
        label: String(label),
        at: draft.metadata.modifiedAt,
        author: options.author ?? null,
        source: options.source ?? 'sdk',
        metadata: clone(options.metadata ?? {}),
        operationCount: transaction.operationCount,
        operations: transaction._revisionOperations(),
      }
      record.fingerprint = stableHash(contentForFingerprint(draft))
      draft.revisions.push(record)
      const accepted = await this.#acceptAuthoritativeCommit(draft, before.revision)
      transaction._close()
      let beforeSnapshot: ReadonlyDeep<KJDocumentState> | null = null
      let afterSnapshot: ReadonlyDeep<KJDocumentState> | null = null
      const beforeCommit = Object.freeze({
        get before(): ReadonlyDeep<KJDocumentState> { return beforeSnapshot ??= deepFreeze(clone(before)) },
        get after(): ReadonlyDeep<KJDocumentState> { return afterSnapshot ??= deepFreeze(clone(accepted)) },
        revision: deepFreeze(clone(record)),
      })
      this.#events.emit(KJ_EVENT_NAMES.BEFORE_COMMIT, beforeCommit)
      this.#adoptState(accepted, record.fingerprint ?? null)
      this.#undo.push({ label: String(label), before, after: accepted, revision })
      if (this.#undo.length > this.#historyLimit) this.#undo.shift()
      this.#redo = []
      this.#emitChange(KJ_EVENT_NAMES.AFTER_COMMIT, record)
      return result
    } catch (error) {
      transaction._close()
      if (error instanceof KJValidationError || error instanceof KJTransactionError) throw error
      throw new KJTransactionError(`Transaction failed: ${label}`, { label }, error)
    }
  }

  undo(options: KJDocumentHistoryOptions = {}): Promise<boolean> {
    return this.#enqueue(async () => {
      if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
        throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, { documentId: this.id })
      }
      const entry = this.#undo.at(-1)
      if (!entry) return false
      const current = this.#state
      const restored = this.#restoreHistoricalState(entry.before, {
        kind: 'undo', label: `Undo ${entry.label}`, targetRevision: entry.revision, ...options,
      })
      const accepted = await this.#acceptAuthoritativeCommit(restored, current.revision)
      this.#undo.pop()
      this.#adoptState(accepted, restored.revisions.at(-1)?.fingerprint as string | undefined ?? null)
      this.#redo.push({ ...entry, after: current })
      this.#emitChange(KJ_EVENT_NAMES.UNDO, this.#state.revisions.at(-1))
      return true
    })
  }

  redo(options: KJDocumentHistoryOptions = {}): Promise<boolean> {
    return this.#enqueue(async () => {
      if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
        throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, { documentId: this.id })
      }
      const entry = this.#redo.at(-1)
      if (!entry) return false
      const before = this.#state
      const restored = this.#restoreHistoricalState(entry.after, {
        kind: 'redo', label: `Redo ${entry.label}`, targetRevision: entry.revision, ...options,
      })
      const accepted = await this.#acceptAuthoritativeCommit(restored, before.revision)
      this.#redo.pop()
      this.#adoptState(accepted, restored.revisions.at(-1)?.fingerprint as string | undefined ?? null)
      this.#undo.push({ ...entry, before, after: accepted })
      this.#emitChange(KJ_EVENT_NAMES.REDO, this.#state.revisions.at(-1))
      return true
    })
  }

  #restoreHistoricalState(source: KJDocumentState, options: KJRestoreOptions): KJDocumentState {
    const restored = createTransactionState(source)
    const revision = this.#state.revision + 1
    restored.revision = revision
    restored.revisions = clone(this.#state.revisions)
    restored.metadata.modifiedAt = options.at ?? nowIso()
    const record: KJRevisionRecord = {
      revision,
      kind: options.kind,
      label: options.label,
      targetRevision: options.targetRevision,
      at: restored.metadata.modifiedAt,
      author: options.author ?? null,
      source: options.source ?? 'sdk',
      operationCount: 0,
      operations: [],
    }
    record.fingerprint = stableHash(contentForFingerprint(restored))
    restored.revisions.push(record)
    validateDocumentState(restored)
    return restored
  }

  async #acceptAuthoritativeCommit(candidate: KJDocumentState, expectedRevision: number): Promise<KJDocumentState> {
    if (!this.#authority) return candidate
    const serialized = canonicalStringify(candidate) ?? ''
    const acceptedSource = await this.#authority.commit(serialized, expectedRevision)
    const accepted = typeof acceptedSource === 'string' ? JSON.parse(acceptedSource) as KJDocumentState : clone(acceptedSource)
    validateDocumentState(accepted)
    if (accepted.documentId !== this.id || Number(accepted.revision) !== Number(expectedRevision) + 1) {
      throw new KJValidationError('Authoritative backend returned a mismatched document commit')
    }
    return accepted
  }

  #emitChange(eventName: 'document:after-commit' | 'document:undo' | 'document:redo', revision: KJRevisionRecord | undefined): void {
    const owner = this
    let documentSnapshot: ReadonlyDeep<KJDocumentState> | null = null
    const payload = Object.freeze({
      get document(): ReadonlyDeep<KJDocumentState> { return documentSnapshot ??= owner.snapshot() },
      documentId: this.id,
      documentRevision: this.revision,
      revision: deepFreeze(clone(revision)),
      history: this.history,
    })
    this.#events.emit(eventName, payload)
    this.#events.emit(KJ_EVENT_NAMES.CHANGE, payload)
    this.#events.emit(KJ_EVENT_NAMES.HISTORY, this.history)
  }
}
