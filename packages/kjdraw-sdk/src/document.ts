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
import { createId } from './ids.js'
import { canonicalStringify, clone, deepFreeze, nowIso, stableHash } from './utils.js'
import type {
  KJDocumentOptions,
  KJDocumentMetadata,
  KJDocumentSpaces,
  KJDocumentState,
  KJLegacyScene,
  KJObjectRecord,
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
  undoCount: number
  redoCount: number
  undoTarget: Readonly<KJDocumentHistoryTarget> | null
  redoTarget: Readonly<KJDocumentHistoryTarget> | null
}

export interface KJDocumentHistoryTarget {
  id: string
  label: string
  revision: number
  source: string
}

export interface KJDocumentHistoryPreview {
  target: Readonly<KJDocumentHistoryTarget>
  /** Detached content branch with no history or authority. */
  document: KJDocument
}

export const KJ_DOCUMENT_HISTORY_ARCHIVE_SCHEMA = 'com.kanjie.kjdraw.document-history@1' as const
export const KJ_DOCUMENT_HISTORY_ARCHIVE_LIMIT = 50
export const KJ_DOCUMENT_HISTORY_ARCHIVE_MAX_BYTES = 16777216

export interface KJDocumentHistoryArchiveEntry {
  label: string
  source: string
  revision: number
  before: KJDocumentState
  after: KJDocumentState
}

/** Optional local recovery data, separate from portable KJD/DXF content and approval plans. */
export interface KJDocumentHistoryArchive {
  schema: typeof KJ_DOCUMENT_HISTORY_ARCHIVE_SCHEMA
  documentId: string
  documentRevision: number
  documentFingerprint: string
  baselineRevision: number
  undo: KJDocumentHistoryArchiveEntry[]
  redo: KJDocumentHistoryArchiveEntry[]
}

export interface KJDocumentHistoryArchiveOptions {
  /** Nearest undo/redo entries combined, at most 50. */
  limit?: number
  maxBytes?: number
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
  /** Exact next entry captured during review; checked inside the document queue. */
  targetHistoryId?: string
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
  id: string
  label: string
  source: string
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

/** Undo/redo restore geometry from this snapshot but always take the revision
 * trail from the current document. Keeping that trail in every history entry
 * retains hundreds of growing copies during long editing sessions. */
function historyState(state: KJDocumentState): KJDocumentState {
  return { ...state, revisions: [] }
}

export class KJDocument {
  #state: KJDocumentState
  #events = new KJEventBus<KJDocumentEvents>()
  #undo: KJHistoryEntry[] = []
  #redo: KJHistoryEntry[] = []
  #historyLimit: number
  #historyBaselineRevision: number
  #queue: Promise<unknown> = Promise.resolve()
  #authority: KJDocumentAuthority | null = null
  #snapshotCache: ReadonlyDeep<KJDocumentState> | null = null
  #fingerprintCache: string | null = null
  #objectCache = new Map<string, KJReadonlyObjectRecord | null>()
  #queryCache = new Map<string, ReadonlyArray<KJReadonlyObjectRecord>>()
  #tableCache = new Map<string, Readonly<KJDocumentTableView> | null>()
  #ownerEntityIndex: Map<string, readonly KJObjectRecord[]> | null = null

  constructor(input: KJDocumentInput = {}, options: KJDocumentConstructorOptions = {}) {
    const candidate = input as Record<string, unknown>
    const state = candidate?.schema || Array.isArray(candidate?.entities) || Array.isArray(candidate?.layers)
      ? migrateDocumentState(input)
      : createEmptyDocumentState(input as KJDocumentOptions)
    validateDocumentState(state)
    this.#state = clone(state)
    this.#historyLimit = Math.max(1, Number(options.historyLimit ?? 500))
    this.#historyBaselineRevision = state.revision
  }

  static create(options: KJDocumentOptions & KJDocumentConstructorOptions = {}): KJDocument { return new KJDocument(options, options) }
  static open(input: string | KJDocumentState | KJLegacyScene | Record<string, unknown>, options: KJDocumentConstructorOptions = {}): KJDocument { return new KJDocument(typeof input === 'string' ? JSON.parse(input) as KJDocumentState : input, options) }

  /** Detached copy-on-write branch at the current revision. Shares unchanged
   * internal records, never authority, listeners, queued work or undo history.
   * Edits on either branch still undergo normal document validation. */
  fork(): KJDocument {
    const branch = KJDocument.create({ historyLimit: this.#historyLimit })
    branch.#state = this.#state
    branch.#historyBaselineRevision = this.#state.revision
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
      undoCount: this.#undo.length,
      redoCount: this.#redo.length,
      undoTarget: this.#historyTarget(this.#undo.at(-1)),
      redoTarget: this.#historyTarget(this.#redo.at(-1)),
    })
  }

  #historyTarget(entry: KJHistoryEntry | undefined): Readonly<KJDocumentHistoryTarget> | null {
    return entry ? Object.freeze({ id: entry.id, label: entry.label, revision: entry.revision, source: entry.source }) : null
  }

  #requireHistoryTarget(kind: 'undo' | 'redo', options: KJDocumentHistoryOptions): KJHistoryEntry | undefined {
    if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
      throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, { documentId: this.id })
    }
    const entry = (kind === 'undo' ? this.#undo : this.#redo).at(-1)
    if (options.targetHistoryId !== undefined && (typeof options.targetHistoryId !== 'string' || !options.targetHistoryId || entry?.id !== options.targetHistoryId)) {
      throw new KJValidationError(`The reviewed ${kind} history target is unavailable or changed; read history and propose again`)
    }
    return entry
  }

  /** Preview the actual next history snapshot without invoking or altering history. */
  previewHistory(kind: 'undo' | 'redo', options: KJDocumentHistoryOptions = {}): KJDocumentHistoryPreview {
    if (kind !== 'undo' && kind !== 'redo') throw new KJValidationError('History preview requires undo or redo')
    const entry = this.#requireHistoryTarget(kind, options)
    if (!entry) throw new KJValidationError(`No ${kind} history is available in this document session`)
    const branch = this.fork(), source = kind === 'undo' ? entry.before : entry.after
    branch.#adoptState({ ...source, revision: this.#state.revision, revisions: this.#state.revisions }, null)
    return Object.freeze({ target: this.#historyTarget(entry)!, document: branch })
  }

  /** Establish an import/open baseline without changing content or audit records. Host-only. */
  clearHistory(options: Pick<KJDocumentHistoryOptions, 'expectedRevision'> = {}): Promise<Readonly<KJDocumentHistory>> {
    return this.#enqueue(() => {
      if (options.expectedRevision != null && options.expectedRevision !== this.revision) throw new KJRevisionConflictError(options.expectedRevision, this.revision)
      this.#undo = []
      this.#redo = []
      this.#historyBaselineRevision = this.revision
      this.#events.emit(KJ_EVENT_NAMES.HISTORY, this.history)
      return this.history
    })
  }

  /** Export bounded engine snapshots for a trusted host's local session store. */
  exportHistory(options: KJDocumentHistoryArchiveOptions = {}): ReadonlyDeep<KJDocumentHistoryArchive> {
    const limit = options.limit ?? KJ_DOCUMENT_HISTORY_ARCHIVE_LIMIT
    const maxBytes = options.maxBytes ?? KJ_DOCUMENT_HISTORY_ARCHIVE_MAX_BYTES
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > KJ_DOCUMENT_HISTORY_ARCHIVE_LIMIT || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > KJ_DOCUMENT_HISTORY_ARCHIVE_MAX_BYTES) throw new KJValidationError('History archive requires limit 1–50 and maxBytes 1024–16777216')
    const undoCount = Math.min(this.#undo.length, Math.ceil(limit / 2) + Math.max(0, Math.floor(limit / 2) - this.#redo.length))
    const redoCount = Math.min(this.#redo.length, limit - undoCount)
    const projectEntry = ({ label, source, revision, before, after }: KJHistoryEntry): KJDocumentHistoryArchiveEntry => ({ label, source, revision, before, after })
    const archive: KJDocumentHistoryArchive = { schema: KJ_DOCUMENT_HISTORY_ARCHIVE_SCHEMA, documentId: this.id, documentRevision: this.revision, documentFingerprint: this.fingerprint(), baselineRevision: this.#historyBaselineRevision, undo: [], redo: [] }
    const undo = undoCount ? this.#undo.slice(-undoCount).reverse() : [], redo = redoCount ? this.#redo.slice(-redoCount).reverse() : []
    let byteLength = new TextEncoder().encode(JSON.stringify(archive)).length
    // Measure one entry at a time; serializing 50 large DXF snapshots first can
    // exhaust memory before the byte limit gets a chance to reduce the archive.
    let undoFull = false, redoFull = false
    for (let index = 0; index < Math.max(undo.length, redo.length); index++) {
      for (const kind of ['undo', 'redo'] as const) {
        const entry = (kind === 'undo' ? undo : redo)[index]
        if (!entry || (kind === 'undo' ? undoFull : redoFull)) continue
        const projected = projectEntry(entry), addition = new TextEncoder().encode(JSON.stringify(projected)).length + (archive[kind].length ? 1 : 0)
        if (byteLength + addition > maxBytes) {
          if (kind === 'undo') undoFull = true
          else redoFull = true
          continue
        }
        archive[kind].unshift(projected)
        byteLength += addition
      }
      if (undoFull && redoFull) break
    }
    if (this.#undo.length + this.#redo.length > 0 && !archive.undo.length && !archive.redo.length) throw new KJValidationError('One history snapshot exceeds the local archive byte limit')
    return deepFreeze(clone(archive))
  }

  /** Validate a local archive against current content, then install fresh history identities.
   * No geometry, document revision or saved approval registry is restored here. */
  restoreHistory(input: unknown, options: Pick<KJDocumentHistoryOptions, 'expectedRevision'> = {}): Promise<Readonly<KJDocumentHistory>> {
    return this.#enqueue(() => {
      if (options.expectedRevision != null && options.expectedRevision !== this.revision) throw new KJRevisionConflictError(options.expectedRevision, this.revision)
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new KJValidationError('History archive must be an object')
      const serialized = canonicalStringify(input)
      if (!serialized || new TextEncoder().encode(serialized).length > KJ_DOCUMENT_HISTORY_ARCHIVE_MAX_BYTES) throw new KJValidationError('History archive exceeds the 16 MiB limit')
      const archive = clone(input) as KJDocumentHistoryArchive
      if (Object.keys(archive).sort().join(',') !== 'baselineRevision,documentFingerprint,documentId,documentRevision,redo,schema,undo' || archive.schema !== KJ_DOCUMENT_HISTORY_ARCHIVE_SCHEMA || archive.documentId !== this.id || archive.documentRevision !== this.revision || archive.documentFingerprint !== this.fingerprint()) throw new KJValidationError('History archive does not match the current document identity, revision or content fingerprint')
      if (!Number.isSafeInteger(archive.baselineRevision) || archive.baselineRevision < 0 || archive.baselineRevision > this.revision) throw new KJValidationError('History archive baseline revision is invalid')
      if (!Array.isArray(archive.undo) || !Array.isArray(archive.redo) || archive.undo.length + archive.redo.length > KJ_DOCUMENT_HISTORY_ARCHIVE_LIMIT) throw new KJValidationError('History archive exceeds the 50 step limit')
      const content = (state: KJDocumentState): string => canonicalStringify(contentForFingerprint(state))!
      for (const entry of [...archive.undo, ...archive.redo]) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'after,before,label,revision,source' || typeof entry.label !== 'string' || entry.label.length > 1024 || typeof entry.source !== 'string' || entry.source.length > 256 || entry.source === 'adapter:dxf-ascii' || !Number.isSafeInteger(entry.revision) || entry.revision <= archive.baselineRevision || entry.revision > this.revision) throw new KJValidationError('Invalid history archive entry or attempt to undo the import baseline')
        for (const state of [entry.before, entry.after]) {
          validateDocumentState(state)
          if (state.documentId !== this.id || !Number.isSafeInteger(state.revision) || state.revision < archive.baselineRevision || state.revision > this.revision || state.revisions.length !== 0) throw new KJValidationError('History snapshot identity, revision or audit trail is invalid')
          if (Object.entries(state.objects).some(([id, record]) => record.id !== id)) throw new KJValidationError('History snapshot object IDs do not match their registry keys')
        }
        if (entry.before.revision >= entry.after.revision) throw new KJValidationError('History snapshot revisions are not ordered')
        const recorded = this.#state.revisions.find(record => record.revision === entry.revision)
        if (!recorded || recorded.kind !== 'commit' || recorded.label !== entry.label || recorded.source !== entry.source) throw new KJValidationError('History entry is not bound to a recorded document commit')
      }
      let current = content(this.#state)
      for (const entry of [...archive.undo].reverse()) {
        if (content(entry.after) !== current) throw new KJValidationError('Undo history snapshot chain does not match current or adjacent content')
        current = content(entry.before)
      }
      current = content(this.#state)
      for (const entry of [...archive.redo].reverse()) {
        if (content(entry.before) !== current) throw new KJValidationError('Redo history snapshot chain does not match current or adjacent content')
        current = content(entry.after)
      }
      const renew = (entry: KJDocumentHistoryArchiveEntry): KJHistoryEntry => ({ ...entry, id: createId('history') })
      this.#undo = archive.undo.slice(-this.#historyLimit).map(renew)
      this.#redo = archive.redo.slice(-this.#historyLimit).map(renew)
      this.#historyBaselineRevision = archive.baselineRevision
      this.#events.emit(KJ_EVENT_NAMES.HISTORY, this.history)
      return this.history
    })
  }

  on<Name extends keyof KJDocumentEvents>(name: Name, listener: (payload: KJDocumentEvents[Name]) => void, options?: { signal?: AbortSignal }): () => boolean { return this.#events.on(name, listener, options) }
  once<Name extends keyof KJDocumentEvents>(name: Name, listener: (payload: KJDocumentEvents[Name]) => void, options?: { signal?: AbortSignal }): () => boolean { return this.#events.once(name, listener, options) }

  snapshot(): ReadonlyDeep<KJDocumentState> {
    this.#snapshotCache ??= deepFreeze(clone(this.#state))
    return this.#snapshotCache
  }
  /** Lightweight immutable document metadata without cloning the object graph. */
  get metadata(): ReadonlyDeep<KJDocumentMetadata> { return deepFreeze(clone(this.#state.metadata)) }
  /** Lightweight immutable layout/space registry without cloning the object graph. */
  get spaces(): ReadonlyDeep<KJDocumentSpaces> { return deepFreeze(clone(this.#state.spaces)) }
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
    // Object records are immutable between revisions. Transactions clone each
    // touched record before mutation, so freezing the shared record avoids an
    // O(entity count) clone when a renderer enumerates a large drawing.
    const result = !object || (object.erased && !includeErased) ? null : deepFreeze(object)
    this.#objectCache.set(key, result)
    return result
  }

  listObjects({ kind, type, ownerId, includeErased = false }: KJDocumentQuery = {}): ReadonlyArray<KJReadonlyObjectRecord> {
    const normalizedType = type == null ? null : String(type).toUpperCase()
    const key = `${kind ?? ''}|${normalizedType ?? ''}|${ownerId ?? ''}|${includeErased ? '1' : '0'}`
    const cached = this.#queryCache.get(key)
    if (cached) return cached
    let objects = kind === 'entity' && ownerId != null
      ? [...this.#entitiesByOwner(ownerId)]
      : Object.values(this.#state.objects).filter(object => kind == null || object.kind === kind).filter(object => ownerId == null || object.ownerId === ownerId)
    objects = objects.filter(object => includeErased || !object.erased).filter(object => normalizedType == null || object.type === normalizedType)
    const result = Object.freeze(objects.map(object => this.getObject(object.id, { includeErased })!)) as ReadonlyArray<KJReadonlyObjectRecord>
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
    this.#ownerEntityIndex = null
  }

  #entitiesByOwner(ownerId: string): readonly KJObjectRecord[] {
    if (!this.#ownerEntityIndex) {
      const grouped = new Map<string, KJObjectRecord[]>()
      for (const object of Object.values(this.#state.objects)) if (object.kind === 'entity' && object.ownerId != null) {
        const values = grouped.get(object.ownerId)
        if (values) values.push(object)
        else grouped.set(object.ownerId, [object])
      }
      this.#ownerEntityIndex = new Map()
      for (const [owner, values] of grouped) {
        // Persisted membership defines draw order. Old documents may omit
        // entries, so append only those missing records by native handle.
        const remaining = new Map(values.map(object => [object.id, object])), ordered: KJObjectRecord[] = []
        for (const id of this.#state.objects[owner]?.payload.entityIds ?? []) {
          const object = remaining.get(id)
          if (object) { ordered.push(object); remaining.delete(id) }
        }
        ordered.push(...[...remaining.values()].sort((a, b) => {
          const left = BigInt(`0x${a.handle}`), right = BigInt(`0x${b.handle}`)
          return left < right ? -1 : left > right ? 1 : 0
        }))
        this.#ownerEntityIndex.set(owner, ordered)
      }
    }
    return this.#ownerEntityIndex.get(String(ownerId)) ?? []
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
      const acceptedFingerprint = accepted.revisions.at(-1)?.fingerprint
      this.#adoptState(accepted, typeof acceptedFingerprint === 'string' ? acceptedFingerprint : null)
      this.#undo.push({ id: createId('history'), label: String(label), source: record.source, before: historyState(before), after: historyState(accepted), revision })
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
      const entry = this.#requireHistoryTarget('undo', options)
      if (!entry) return false
      const current = this.#state
      const restored = this.#restoreHistoricalState(entry.before, {
        kind: 'undo', label: `Undo ${entry.label}`, targetRevision: entry.revision, ...options,
      })
      const accepted = await this.#acceptAuthoritativeCommit(restored, current.revision)
      this.#undo.pop()
      this.#adoptState(accepted, restored.revisions.at(-1)?.fingerprint as string | undefined ?? null)
      this.#redo.push({ ...entry, after: historyState(current) })
      this.#emitChange(KJ_EVENT_NAMES.UNDO, this.#state.revisions.at(-1))
      return true
    })
  }

  redo(options: KJDocumentHistoryOptions = {}): Promise<boolean> {
    return this.#enqueue(async () => {
      const entry = this.#requireHistoryTarget('redo', options)
      if (!entry) return false
      const before = this.#state
      const restored = this.#restoreHistoricalState(entry.after, {
        kind: 'redo', label: `Redo ${entry.label}`, targetRevision: entry.revision, ...options,
      })
      const accepted = await this.#acceptAuthoritativeCommit(restored, before.revision)
      this.#redo.pop()
      this.#adoptState(accepted, restored.revisions.at(-1)?.fingerprint as string | undefined ?? null)
      this.#undo.push({ ...entry, before: historyState(before), after: historyState(accepted) })
      this.#emitChange(KJ_EVENT_NAMES.REDO, this.#state.revisions.at(-1))
      return true
    })
  }

  #restoreHistoricalState(source: KJDocumentState, options: KJRestoreOptions): KJDocumentState {
    const restored = createTransactionState(source)
    const revision = this.#state.revision + 1
    restored.revision = revision
    // Revision records are immutable between commits. The transaction shell
    // already uses a shallow copy; deep-cloning the entire audit trail on
    // every undo/redo made long sessions quadratic in allocations.
    restored.revisions = [...this.#state.revisions]
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
    restored.revisions.push(record)
    validateDocumentState(restored, { previousState: this.#state })
    return restored
  }

  async #acceptAuthoritativeCommit(candidate: KJDocumentState, expectedRevision: number): Promise<KJDocumentState> {
    if (!this.#authority) return candidate
    const authority = this.#authority
    const sourceState = this.#state
    const serialized = canonicalStringify(candidate) ?? ''
    try {
      const acceptedSource = await authority.commit(serialized, expectedRevision)
      if (this.#authority !== authority || this.#state !== sourceState) {
        throw new KJValidationError('Authoritative backend response belongs to an obsolete document session')
      }
      const accepted = typeof acceptedSource === 'string' ? JSON.parse(acceptedSource) as KJDocumentState : clone(acceptedSource)
      validateDocumentState(accepted)
      const acceptedJson = canonicalStringify(accepted)
      if (accepted.documentId !== this.id || Number(accepted.revision) !== Number(expectedRevision) + 1 ||
        (acceptedJson !== serialized && acceptedJson !== canonicalStringify(this.#canonicalAuthorityCandidate(serialized)))) {
        throw new KJValidationError('Authoritative backend returned a mismatched document commit')
      }
      return accepted
    } catch (error) {
      // The backend may already have advanced. Preserve the original error and
      // local state, but never reuse an uncertain or divergent session.
      if (this.#authority === authority) {
        this.#authority = null
        try { authority.close() } catch { /* Preserve the commit failure. */ }
      }
      throw error
    }
  }

  #canonicalAuthorityCandidate(serialized: string): KJDocumentState {
    // Only the documented Rust KJD parser defaults are equivalent to the
    // submitted candidate. Unknown fields, payloads and history stay exact.
    const normalized = JSON.parse(serialized) as KJDocumentState
    for (const object of Object.values(normalized.objects)) {
      object.handle = object.handle.replace(/[a-z]/g, value => value.toUpperCase())
      object.type = object.type.replace(/[a-z]/g, value => value.toUpperCase())
      for (const [key, value] of Object.entries({ ownerId: null, name: null, payload: {}, extension: {}, erased: false, source: null })) {
        if (!Object.hasOwn(object, key)) (object as unknown as Record<string, unknown>)[key] = value
      }
    }
    for (const table of Object.values(normalized.tables)) if (!Object.hasOwn(table, 'currentId')) table.currentId = null
    if (!Object.hasOwn(normalized, 'opaquePayloads')) normalized.opaquePayloads = {}
    if (!Object.hasOwn(normalized, 'revisions')) normalized.revisions = []
    return normalized
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
