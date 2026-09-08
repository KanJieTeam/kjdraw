import { KJEventBus } from './events.js'
import { KJValidationError } from './errors.js'
import { normalizeName } from './utils.js'
import type { KJDocument } from './document.js'
import type { KJObjectRecord, KJReadonlyObjectRecord } from './schema.js'

const NAMED_PREFIX = 'KJ_SELECTION_SET:'

export type KJEntityReference = string | { id: string }
export type KJSelectionReason = 'add' | 'remove' | 'clear' | 'replace'

export interface KJSelectionChange {
  reason: KJSelectionReason
  changedIds: readonly string[]
  ids: readonly string[]
  size: number
}

export interface KJSelectionMutationOptions {
  silent?: boolean
}

export interface KJNamedSelectionSet {
  id: string
  name: string | null
  description: unknown
  memberIds: readonly string[]
}

export interface KJSaveSelectionOptions {
  ids?: readonly KJEntityReference[]
  description?: unknown
}

interface KJSelectionEvents {
  change: KJSelectionChange
}

function referenceId(value: KJEntityReference): string {
  return String(typeof value === 'object' ? value.id : value)
}

function entityId(document: KJDocument, value: KJEntityReference): string {
  const id = referenceId(value)
  const object = document.getObject(id)
  if (!object || object.kind !== 'entity') throw new KJValidationError(`Selectable entity does not exist: ${id}`)
  return id
}

export class KJSelectionSet {
  #document: KJDocument
  #ids: string[] = []
  #events = new KJEventBus<KJSelectionEvents>()

  constructor(document: KJDocument, ids: readonly KJEntityReference[] = []) {
    if (!document?.getObject) throw new KJValidationError('Selection set requires a KJDocument')
    this.#document = document
    this.replace(ids, { silent: true })
  }

  get size(): number { return this.#ids.length }
  get ids(): readonly string[] { return Object.freeze([...this.#ids]) }
  get objects(): ReadonlyArray<KJReadonlyObjectRecord> { return Object.freeze(this.#ids.map(id => this.#document.getObject(id)).filter((object): object is KJReadonlyObjectRecord => Boolean(object))) }
  has(value: KJEntityReference): boolean { return this.#ids.includes(referenceId(value)) }
  onChange(listener: (change: KJSelectionChange) => void, options?: { signal?: AbortSignal }): () => void { return this.#events.on('change', listener, options) }

  #emit(reason: KJSelectionReason, changedIds: readonly string[]): void {
    this.#events.emit('change', Object.freeze({ reason, changedIds: Object.freeze([...changedIds]), ids: this.ids, size: this.size }))
  }

  add(values: KJEntityReference | readonly KJEntityReference[], { silent = false }: KJSelectionMutationOptions = {}): this {
    const incoming = Array.isArray(values) ? values : [values]
    const changed: string[] = []
    for (const value of incoming) {
      const id = entityId(this.#document, value)
      if (!this.#ids.includes(id)) { this.#ids.push(id); changed.push(id) }
    }
    if (changed.length && !silent) this.#emit('add', changed)
    return this
  }

  remove(values: KJEntityReference | readonly KJEntityReference[], { silent = false }: KJSelectionMutationOptions = {}): this {
    const targets = new Set((Array.isArray(values) ? values : [values]).map(referenceId))
    const changed = this.#ids.filter(id => targets.has(id))
    if (changed.length) this.#ids = this.#ids.filter(id => !targets.has(id))
    if (changed.length && !silent) this.#emit('remove', changed)
    return this
  }

  toggle(value: KJEntityReference): this { return this.has(value) ? this.remove(value) : this.add(value) }

  clear({ silent = false }: KJSelectionMutationOptions = {}): this {
    const changed = [...this.#ids]
    this.#ids = []
    if (changed.length && !silent) this.#emit('clear', changed)
    return this
  }

  replace(values: readonly KJEntityReference[] = [], { silent = false }: KJSelectionMutationOptions = {}): this {
    const next: string[] = []
    for (const value of values) {
      const id = entityId(this.#document, value)
      if (!next.includes(id)) next.push(id)
    }
    const changed = [...new Set([...this.#ids, ...next])]
    this.#ids = next
    if (changed.length && !silent) this.#emit('replace', changed)
    return this
  }

  selectWhere(predicate: (entity: KJReadonlyObjectRecord, index: number) => boolean, { append = false }: { append?: boolean } = {}): this {
    if (typeof predicate !== 'function') throw new KJValidationError('Selection predicate must be a function')
    const matches = this.#document.listEntities().filter(predicate).map(object => object.id)
    return append ? this.add(matches) : this.replace(matches)
  }

  prune(): string[] {
    const removed = this.#ids.filter(id => !this.#document.getObject(id))
    if (removed.length) this.remove(removed)
    return removed
  }
}

export class KJSelectionManager {
  #document: KJDocument
  #disposeDocumentChange: (() => void) | null
  readonly active: KJSelectionSet

  constructor(document: KJDocument) {
    this.#document = document
    this.active = new KJSelectionSet(document)
    this.#disposeDocumentChange = document.on('document:change', () => this.active.prune())
  }

  dispose(): void { this.#disposeDocumentChange?.(); this.#disposeDocumentChange = null }

  listNamed(): KJNamedSelectionSet[] {
    return this.#document.listObjects({ kind: 'group', type: 'SELECTION_SET' })
      .map(group => ({ id: group.id, name: group.name, description: group.payload.description ?? null, memberIds: Object.freeze([...(group.payload.memberIds ?? [])]) }))
  }

  getNamed(name: string): KJReadonlyObjectRecord | null {
    const key = normalizeName(name)
    return this.#document.listObjects({ kind: 'group', type: 'SELECTION_SET' }).find(group => normalizeName(group.name) === key) ?? null
  }

  loadNamed(name: string, { append = false }: { append?: boolean } = {}): KJSelectionSet {
    const group = this.getNamed(name)
    if (!group) throw new KJValidationError(`Named selection set does not exist: ${name}`)
    const ids = (group.payload.memberIds ?? []).filter(id => this.#document.getObject(id))
    if (append) this.active.add(ids)
    else this.active.replace(ids)
    return this.active
  }

  async saveNamed(name: string, options: KJSaveSelectionOptions = {}): Promise<KJObjectRecord> {
    name = String(name ?? '').trim()
    if (!name) throw new KJValidationError('Named selection set requires a name')
    const memberIds = [...(options.ids ?? this.active.ids)].map(id => entityId(this.#document, id))
    const existing = this.getNamed(name)
    return this.#document.transact(`Save selection set ${name}`, transaction => {
      const group = existing
        ? transaction.updateObject(existing.id, { name, payload: { memberIds, description: options.description ?? existing.payload.description ?? null } })
        : transaction.createObject({ kind: 'group', type: 'SELECTION_SET', ownerId: this.#document.snapshot().namedObjectsDictionaryId, name, payload: { memberIds, description: options.description ?? null } })
      transaction.addDictionaryEntry(this.#document.snapshot().namedObjectsDictionaryId, `${NAMED_PREFIX}${name}`, group.id)
      return group
    }, { source: 'selection-manager' })
  }

  async deleteNamed(name: string): Promise<boolean> {
    const group = this.getNamed(name)
    if (!group) return false
    await this.#document.transact(`Delete selection set ${group.name}`, transaction => {
      transaction.removeDictionaryEntry(this.#document.snapshot().namedObjectsDictionaryId, `${NAMED_PREFIX}${group.name}`)
      transaction.eraseObject(group.id, { hard: true })
    }, { source: 'selection-manager' })
    return true
  }
}
