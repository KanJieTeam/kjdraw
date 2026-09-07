import { KJ_EVENT_NAMES } from './constants.js'
import { KJEventBus } from './events.js'
import { KJRevisionConflictError, KJTransactionError, KJValidationError } from './errors.js'
import {
  createEmptyDocumentState,
  migrateDocumentState,
  validateDocumentState,
} from './schema.js'
import { KJTransaction } from './transaction.js'
import { canonicalStringify, clone, deepFreeze, nowIso, stableHash } from './utils.js'

function contentForFingerprint(state) {
  const value = clone(state)
  value.revision = 0
  value.revisions = []
  if (value.metadata) value.metadata.modifiedAt = null
  return value
}

export class KJDocument {
  #state
  #events = new KJEventBus()
  #undo = []
  #redo = []
  #historyLimit
  #queue = Promise.resolve()
  #authority = null

  constructor(input = {}, options = {}) {
    const state = input?.schema || Array.isArray(input?.entities) || Array.isArray(input?.layers)
      ? migrateDocumentState(input)
      : createEmptyDocumentState(input)
    validateDocumentState(state)
    this.#state = clone(state)
    this.#historyLimit = Math.max(1, Number(options.historyLimit ?? 500))
  }

  static create(options = {}) { return new KJDocument(options) }
  static open(input, options = {}) { return new KJDocument(typeof input === 'string' ? JSON.parse(input) : input, options) }

  get id() { return this.#state.documentId }
  get revision() { return this.#state.revision }
  get schemaVersion() { return this.#state.schemaVersion }
  get hasAuthoritativeBackend() { return this.#authority != null }
  get history() {
    return Object.freeze({
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      undoLabel: this.#undo.at(-1)?.label ?? null,
      redoLabel: this.#redo.at(-1)?.label ?? null,
    })
  }

  on(name, listener, options) { return this.#events.on(name, listener, options) }
  once(name, listener, options) { return this.#events.once(name, listener, options) }

  snapshot() { return deepFreeze(clone(this.#state)) }
  toJSON({ includeRevisions = true } = {}) {
    const state = clone(this.#state)
    if (!includeRevisions) state.revisions = []
    return state
  }
  serialize({ pretty = false, includeRevisions = true } = {}) { return canonicalStringify(this.toJSON({ includeRevisions }), pretty ? 2 : 0) }
  fingerprint() { return stableHash(contentForFingerprint(this.#state)) }
  validate() { return validateDocumentState(this.#state, { throwOnError: false }) }

  bindAuthority(session) {
    if (!session || typeof session.commit !== 'function' || typeof session.serialize !== 'function' || typeof session.close !== 'function') {
      throw new KJValidationError('Document authority must expose commit, serialize and close')
    }
    try {
      const source = session.serialize()
      const accepted = typeof source === 'string' ? JSON.parse(source) : source
      validateDocumentState(accepted)
      if (accepted.documentId !== this.id || Number(accepted.revision) !== this.revision) {
        throw new KJValidationError('Document authority does not match the current document identity and revision')
      }
      this.unbindAuthority()
      this.#state = clone(accepted)
      this.#authority = session
      return this
    } catch (error) {
      session.close()
      throw error
    }
  }

  unbindAuthority() {
    if (!this.#authority) return false
    const authority = this.#authority
    this.#authority = null
    authority.close()
    return true
  }

  getObject(id, { includeErased = false } = {}) {
    const object = this.#state.objects[String(id)]
    if (!object || (object.erased && !includeErased)) return null
    return deepFreeze(clone(object))
  }

  listObjects({ kind, type, ownerId, includeErased = false } = {}) {
    const normalizedType = type == null ? null : String(type).toUpperCase()
    return Object.values(this.#state.objects)
      .filter(object => includeErased || !object.erased)
      .filter(object => kind == null || object.kind === kind)
      .filter(object => normalizedType == null || object.type === normalizedType)
      .filter(object => ownerId == null || object.ownerId === ownerId)
      .map(object => deepFreeze(clone(object)))
  }

  listEntities(options = {}) { return this.listObjects({ ...options, kind: 'entity' }) }
  getTable(name) {
    const table = this.#state.tables[String(name)]
    if (!table) return null
    return deepFreeze({ currentId: table.currentId, records: table.recordIds.map(id => clone(this.#state.objects[id])).filter(Boolean) })
  }
  getActiveLayout() { return this.getObject(this.#state.spaces.activeLayoutId) }

  #enqueue(work) {
    const result = this.#queue.then(work, work)
    this.#queue = result.catch(() => {})
    return result
  }

  transact(label, work, options = {}) {
    if (typeof work !== 'function') return Promise.reject(new KJTransactionError('Transaction callback must be a function'))
    return this.#enqueue(() => this.#performTransaction(label, work, options))
  }

  async #performTransaction(label, work, options) {
    if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
      throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, { documentId: this.id })
    }
    const before = clone(this.#state)
    const draft = clone(this.#state)
    const transaction = new KJTransaction(draft, { label, metadata: options.metadata })
    let result
    try {
      result = await work(transaction)
      validateDocumentState(draft)
      const revision = this.#state.revision + 1
      draft.revision = revision
      draft.metadata.modifiedAt = options.at ?? nowIso()
      const record = {
        revision,
        kind: 'commit',
        label: String(label),
        at: draft.metadata.modifiedAt,
        author: options.author ?? null,
        source: options.source ?? 'sdk',
        metadata: clone(options.metadata ?? {}),
        operationCount: transaction.operations.length,
        operations: transaction.operations,
      }
      record.fingerprint = stableHash(contentForFingerprint(draft))
      draft.revisions.push(record)
      const accepted = await this.#acceptAuthoritativeCommit(draft, before.revision)
      transaction._close()
      this.#events.emit(KJ_EVENT_NAMES.BEFORE_COMMIT, deepFreeze({ before: clone(before), after: clone(accepted), revision: clone(record) }))
      this.#state = accepted
      this.#undo.push({ label: String(label), before, after: clone(accepted), revision })
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

  undo(options = {}) {
    return this.#enqueue(async () => {
      if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
        throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, { documentId: this.id })
      }
      const entry = this.#undo.at(-1)
      if (!entry) return false
      const current = clone(this.#state)
      const restored = this.#restoreHistoricalState(entry.before, {
        kind: 'undo', label: `Undo ${entry.label}`, targetRevision: entry.revision, ...options,
      })
      const accepted = await this.#acceptAuthoritativeCommit(restored, current.revision)
      this.#undo.pop()
      this.#state = accepted
      this.#redo.push({ ...entry, after: current })
      this.#emitChange(KJ_EVENT_NAMES.UNDO, this.#state.revisions.at(-1))
      return true
    })
  }

  redo(options = {}) {
    return this.#enqueue(async () => {
      if (options.expectedRevision != null && Number(options.expectedRevision) !== this.#state.revision) {
        throw new KJRevisionConflictError(Number(options.expectedRevision), this.#state.revision, { documentId: this.id })
      }
      const entry = this.#redo.at(-1)
      if (!entry) return false
      const before = clone(this.#state)
      const restored = this.#restoreHistoricalState(entry.after, {
        kind: 'redo', label: `Redo ${entry.label}`, targetRevision: entry.revision, ...options,
      })
      const accepted = await this.#acceptAuthoritativeCommit(restored, before.revision)
      this.#redo.pop()
      this.#state = accepted
      this.#undo.push({ ...entry, before, after: clone(this.#state) })
      this.#emitChange(KJ_EVENT_NAMES.REDO, this.#state.revisions.at(-1))
      return true
    })
  }

  #restoreHistoricalState(source, options) {
    const restored = clone(source)
    const revision = this.#state.revision + 1
    restored.revision = revision
    restored.revisions = clone(this.#state.revisions)
    restored.metadata.modifiedAt = options.at ?? nowIso()
    const record = {
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

  async #acceptAuthoritativeCommit(candidate, expectedRevision) {
    if (!this.#authority) return candidate
    const serialized = canonicalStringify(candidate)
    const acceptedSource = await this.#authority.commit(serialized, expectedRevision)
    const accepted = typeof acceptedSource === 'string' ? JSON.parse(acceptedSource) : clone(acceptedSource)
    validateDocumentState(accepted)
    if (accepted.documentId !== this.id || Number(accepted.revision) !== Number(expectedRevision) + 1) {
      throw new KJValidationError('Authoritative backend returned a mismatched document commit')
    }
    return accepted
  }

  #emitChange(eventName, revision) {
    const payload = deepFreeze({ document: this.snapshot(), revision: clone(revision), history: this.history })
    this.#events.emit(eventName, payload)
    this.#events.emit(KJ_EVENT_NAMES.CHANGE, payload)
    this.#events.emit(KJ_EVENT_NAMES.HISTORY, this.history)
  }
}
