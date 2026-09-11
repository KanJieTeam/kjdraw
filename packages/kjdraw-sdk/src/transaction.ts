import { KJ_TABLE_NAMES } from './constants.js'
import type { KJTableName } from './constants.js'
import { KJTransactionError, KJValidationError } from './errors.js'
import { createId } from './ids.js'
import { allocateHandle, createObjectRecord } from './schema.js'
import { isStandardEntityType, normalizeStandardEntityPayload } from './standard-entities.js'
import { transformEntityPayload } from './geometry/transform.js'
import type { AffineMatrix3Input } from './geometry/matrix3.js'
import { clone, fromHexHandle, normalizeName, stableHash, toHexHandle } from './utils.js'
import type {
  KJDocumentState,
  KJObjectExtension,
  KJObjectPayload,
  KJObjectRecord,
  KJObjectSpec,
  KJResourceCollectionName,
} from './schema.js'
import type { ReadonlyDeep } from './utils.js'

function readonlyDraftView<T>(value: T, cache: WeakMap<object, object>): ReadonlyDeep<T> {
  if (!value || typeof value !== 'object') return value as ReadonlyDeep<T>
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return clone(value) as ReadonlyDeep<T>
  const object = value as object
  const cached = cache.get(object)
  if (cached) return cached as ReadonlyDeep<T>
  const rejectMutation = (): never => { throw new KJTransactionError('Transaction draft views are read-only; use transaction methods to mutate state') }
  const proxy = new Proxy(object, {
    get(target, property, receiver) {
      return readonlyDraftView(Reflect.get(target, property, receiver), cache)
    },
    set: rejectMutation,
    deleteProperty: rejectMutation,
    defineProperty: rejectMutation,
    setPrototypeOf: rejectMutation,
  })
  cache.set(object, proxy)
  return proxy as ReadonlyDeep<T>
}

const TABLE_TYPE: Readonly<Record<KJTableName, string>> = Object.freeze({
  layers: 'LAYER',
  linetypes: 'LINETYPE',
  textStyles: 'TEXT_STYLE',
  dimensionStyles: 'DIM_STYLE',
  ucs: 'UCS',
  views: 'VIEW',
  blockRecords: 'BLOCK_RECORD',
})

export interface KJTransactionOperation extends Record<string, unknown> {
  type: string
}

export interface KJTransactionOptions {
  label?: string
  metadata?: Record<string, unknown>
}

export interface KJObjectPatch extends Record<string, unknown> {
  id?: string
  handle?: string
  kind?: string
  type?: string
  ownerId?: string | null
  name?: string | null
  payload?: KJObjectPayload
  extension?: Partial<KJObjectExtension>
  erased?: boolean
  source?: unknown
}

export interface KJTableRecordInput extends KJObjectSpec {
  name?: string
}

export interface KJLayoutOptions {
  name?: string
  paper?: unknown
  dxfPlotSettings?: import('./plot-settings.js').KJDxfPlotSettings
}

export class KJTransaction {
  #state: KJDocumentState
  #closed = false
  #operations: KJTransactionOperation[] = []
  #ownedObjects = new Set<string>()
  #handles: Set<string> | null = null
  #entityMembership = new WeakMap<string[], Set<string>>()
  #readonlyDraftCache = new WeakMap<object, object>()
  #compoundMutation = false
  readonly label: string
  readonly metadata: Record<string, unknown>

  constructor(state: KJDocumentState, { label = 'Transaction', metadata = {} }: KJTransactionOptions = {}) {
    this.#state = state
    this.label = String(label)
    this.metadata = clone(metadata)
  }

  get operations(): KJTransactionOperation[] { return clone(this.#operations) }
  get operationCount(): number { return this.#operations.length }
  get closed(): boolean { return this.#closed }

  _draft(): ReadonlyDeep<KJDocumentState> { return readonlyDraftView(this.#state, this.#readonlyDraftCache) }
  _close(): void { this.#closed = true }

  _revisionOperations(maxEmbeddedOperations = 1_000): KJTransactionOperation[] {
    if (this.#operations.length <= maxEmbeddedOperations) return clone(this.#operations)
    const byType: Record<string, number> = {}
    for (const operation of this.#operations) byType[operation.type] = (byType[operation.type] ?? 0) + 1
    return [{
      type: 'operations.compacted',
      operationCount: this.#operations.length,
      byType,
      digest: stableHash(this.#operations),
    }]
  }

  #assertOpen(): void {
    if (this.#closed) throw new KJTransactionError('Transaction is already closed')
  }

  #record(type: string, data: Record<string, unknown>): void {
    this.#operations.push({ type, ...clone(data) })
  }

  #mutableObject(id: string): KJObjectRecord {
    const current = this.#state.objects[id]
    if (!current) throw new KJValidationError(`Object does not exist: ${id}`)
    if (this.#ownedObjects.has(id)) return current
    const owned = clone(current)
    this.#state.objects[id] = owned
    this.#ownedObjects.add(id)
    return owned
  }

  #claimHandle(handle?: string): string {
    const normalized = String(handle ?? '').trim().toUpperCase()
    if (!normalized) return allocateHandle(this.#state)
    const numeric = fromHexHandle(normalized)
    this.#handles ??= new Set(Object.values(this.#state.objects).map(object => object.handle))
    if (this.#handles.has(normalized)) throw new KJValidationError(`Duplicate handle: ${normalized}`)
    const handseed = fromHexHandle(this.#state.header.handseed)
    if (numeric >= handseed) this.#state.header.handseed = toHexHandle(numeric + 1n)
    return normalized
  }

  #appendEntity(owner: KJObjectRecord, id: string): void {
    const ids = owner.payload.entityIds ??= []
    let members = this.#entityMembership.get(ids)
    if (!members) { members = new Set(ids); this.#entityMembership.set(ids, members) }
    if (!members.has(id)) { ids.push(id); members.add(id) }
  }

  getObject(id: string): KJObjectRecord | null {
    this.#assertOpen()
    const object = this.#state.objects[String(id)]
    return object ? clone(object) : null
  }

  #compoundChildren(object: KJObjectRecord): string[] {
    if (object.kind !== 'entity' || object.type !== 'INSERT') return []
    return [...(object.payload.attributeIds ?? []), ...(object.payload.sequenceEndId ? [object.payload.sequenceEndId] : [])]
  }

  #withCompoundMutation<T>(operation: () => T): T {
    const previous = this.#compoundMutation
    this.#compoundMutation = true
    try { return operation() } finally { this.#compoundMutation = previous }
  }

  /** Apply one containing-space matrix to an INSERT and its attached attributes. */
  transformEntity(id: string, matrix: AffineMatrix3Input): KJObjectRecord[] {
    this.#assertOpen()
    const entity = this.getObject(id)
    if (!entity || entity.kind !== 'entity' || entity.erased) throw new KJValidationError(`Live entity does not exist: ${id}`)
    const ids = [entity.id, ...(entity.type === 'INSERT' ? entity.payload.attributeIds ?? [] : [])]
    const updates = ids.map(objectId => {
      const item = this.getObject(objectId)
      if (!item || item.kind !== 'entity' || item.erased) throw new KJValidationError(`Attached entity does not exist: ${objectId}`)
      return { id: objectId, payload: transformEntityPayload(item.type, item.payload, matrix) }
    })
    return this.#withCompoundMutation(() => updates.map(update => this.updateObject(update.id, { payload: update.payload })))
  }

  createObject(spec: KJObjectSpec = {}): KJObjectRecord {
    this.#assertOpen()
    const id = String(spec.id ?? createId(spec.kind === 'entity' ? 'entity' : 'obj'))
    if (this.#state.objects[id]) throw new KJValidationError(`Duplicate object id: ${id}`)
    const requestedOwnerId = spec.ownerId == null ? null : String(spec.ownerId)
    if (requestedOwnerId && !this.#state.objects[requestedOwnerId]) throw new KJValidationError(`Object owner does not exist: ${requestedOwnerId}`)
    const normalizedSpec: KJObjectSpec = spec.kind === 'entity' && isStandardEntityType(spec.type)
      ? { ...spec, payload: normalizeStandardEntityPayload(spec.type, { ...spec.payload, layerId: spec.payload?.layerId ?? this.#state.tables.layers.currentId }) }
      : spec
    const object = createObjectRecord({ ...normalizedSpec, id, handle: this.#claimHandle(spec.handle) })
    this.#state.objects[id] = object
    this.#handles?.add(object.handle)
    this.#ownedObjects.add(id)
    if (object.kind === 'entity') {
      const owner = this.#mutableObject(object.ownerId ?? '')
      if (owner?.kind !== 'block-record') throw new KJValidationError('Entity owner must be a block record')
      this.#appendEntity(owner, id)
    }
    this.#record('object.create', { id: object.id, handle: object.handle, kind: object.kind, objectType: object.type, ownerId: object.ownerId })
    return clone(object)
  }

  createEntity(type: string, payload: KJObjectPayload = {}, options: KJObjectSpec = {}): KJObjectRecord {
    const ownerId = options.ownerId ?? this.#state.spaces.modelSpaceId
    const layerId = payload.layerId ?? this.#state.tables.layers.currentId
    // createObject normalizes standard geometry and isolates its payload. Do not
    // repeat the same normalization here; commit still validates the full graph.
    return this.createObject({ ...options, kind: 'entity', type, ownerId, payload: { ...payload, ...(layerId == null ? {} : { layerId }) } })
  }

  updateObject(id: string, patch: KJObjectPatch = {}): KJObjectRecord {
    this.#assertOpen()
    id = String(id)
    const current = this.#state.objects[id]
    if (!current) throw new KJValidationError(`Object does not exist: ${id}`)
    if (!this.#compoundMutation) {
      if (patch.erased != null && patch.erased !== current.erased && (current.payload.parentInsertId != null || current.type === 'SEQEND')) throw new KJValidationError('Erase or restore attached records through their INSERT')
      if (current.type === 'INSERT' && this.#compoundChildren(current).length) {
        if (patch.payload && ['position', 'rotation', 'scale', 'mirrored', 'blockRecordId'].some(key => key in patch.payload! && stableHash([patch.payload![key]]) !== stableHash([current.payload[key]]))) throw new KJValidationError('Transform an attributed INSERT with transformEntity; direct geometry replacement is unsupported')
        if (patch.erased != null && patch.erased !== current.erased) return this.#withCompoundMutation(() => {
          for (const childId of this.#compoundChildren(current)) this.updateObject(childId, { erased: patch.erased! })
          return this.updateObject(id, patch)
        })
      }
    }
    if ('id' in patch && String(patch.id) !== id) throw new KJValidationError('Object id is immutable')
    if ('handle' in patch && String(patch.handle).toUpperCase() !== current.handle) throw new KJValidationError('Object handle is immutable')
    if ('kind' in patch && String(patch.kind) !== current.kind) throw new KJValidationError('Object kind is immutable')
    if ('type' in patch && normalizeName(patch.type) !== current.type) throw new KJValidationError('Object type is immutable')
    if ('ownerId' in patch && patch.ownerId !== current.ownerId) throw new KJValidationError('Use reparentObject to change ownership')
    const before = clone(current)
    const base = clone(current)
    const copiedPatch = clone(patch)
    const mergedPayload = copiedPatch.payload ? { ...base.payload, ...copiedPatch.payload } : base.payload
    const next: KJObjectRecord = {
      ...base,
      ...copiedPatch,
      id,
      handle: current.handle,
      kind: current.kind,
      type: current.type,
      ownerId: current.ownerId,
      payload: current.kind === 'entity' && isStandardEntityType(current.type) ? normalizeStandardEntityPayload(current.type, mergedPayload) : mergedPayload,
      extension: copiedPatch.extension ? { ...base.extension, ...copiedPatch.extension } as KJObjectExtension : base.extension,
    }
    this.#state.objects[id] = next
    this.#ownedObjects.add(id)
    this.#record('object.update', { id, before, after: next })
    return clone(next)
  }

  reparentObject(id: string, ownerId: string | null): KJObjectRecord {
    this.#assertOpen()
    id = String(id); ownerId = ownerId == null ? null : String(ownerId)
    const object = this.#mutableObject(id)
    if (ownerId && !this.#state.objects[ownerId]) throw new KJValidationError(`Owner does not exist: ${ownerId}`)
    if (!this.#compoundMutation && ownerId !== object.ownerId) {
      if (object.type === 'SEQEND' || object.payload.parentInsertId != null) throw new KJValidationError('Reparent attached records through their INSERT')
      if (object.type === 'INSERT' && this.#compoundChildren(object).length) return this.#withCompoundMutation(() => {
        for (const childId of object.payload.attributeIds ?? []) this.reparentObject(childId, ownerId)
        return this.reparentObject(id, ownerId)
      })
    }
    const previousOwnerId = object.ownerId
    if (object.kind === 'entity') {
      if (this.#state.objects[ownerId ?? '']?.kind !== 'block-record') throw new KJValidationError('Entity owner must be a block record')
      const previous = previousOwnerId ? this.#mutableObject(previousOwnerId) : null
      if (previous?.payload?.entityIds) previous.payload.entityIds = previous.payload.entityIds.filter(value => value !== id)
      const next = this.#mutableObject(ownerId ?? '')
      this.#appendEntity(next, id)
    }
    object.ownerId = ownerId
    this.#record('object.reparent', { id, previousOwnerId, ownerId })
    return clone(object)
  }

  eraseObject(id: string, { hard = false }: { hard?: boolean } = {}): KJObjectRecord | null {
    this.#assertOpen()
    id = String(id)
    const object = this.#state.objects[id]
    if (!object) return null
    if (!this.#compoundMutation && hard) {
      if (object.payload.parentInsertId != null || object.type === 'SEQEND') throw new KJValidationError('Purge attached records through their INSERT')
      if (object.type === 'INSERT' && this.#compoundChildren(object).length) return this.#withCompoundMutation(() => {
        for (const childId of this.#compoundChildren(object)) this.eraseObject(childId, { hard: true })
        return this.eraseObject(id, { hard: true })
      })
    }
    if (!hard) return this.updateObject(id, { erased: true })
    const owned = Object.values(this.#state.objects).filter(value => value.ownerId === id)
    if (owned.length) throw new KJValidationError(`Cannot purge object with owned children: ${id}`)
    for (const table of Object.values(this.#state.tables)) {
      if (table.recordIds.includes(id) || table.currentId === id) throw new KJValidationError(`Cannot purge registered table record: ${id}`)
    }
    if (object.kind === 'entity') {
      const owner = object.ownerId ? this.#mutableObject(object.ownerId) : null
      if (owner?.payload?.entityIds) owner.payload.entityIds = owner.payload.entityIds.filter(value => value !== id)
    }
    delete this.#state.objects[id]
    this.#handles?.delete(object.handle)
    this.#record('object.purge', { object })
    return clone(object)
  }

  restoreObject(id: string): KJObjectRecord { return this.updateObject(id, { erased: false }) }

  setHeader<T>(name: string, value: T): T {
    this.#assertOpen()
    const key = String(name)
    if (key === 'handseed') throw new KJValidationError('HANDSEED is managed by the document')
    const previous = clone(this.#state.header[key])
    this.#state.header[key] = clone(value)
    this.#record('header.set', { name: key, previous, value })
    return clone(value)
  }

  setSystemVariable<T>(name: string, value: T): T {
    this.#assertOpen()
    const key = normalizeName(name)
    if (!key) throw new KJValidationError('System variable name is required')
    const previous = clone(this.#state.header.systemVariables[key])
    this.#state.header.systemVariables[key] = clone(value)
    this.#record('system-variable.set', { name: key, previous, value })
    return clone(value)
  }

  upsertTableRecord(tableName: KJTableName, record: KJTableRecordInput = {}): KJObjectRecord {
    this.#assertOpen()
    if (!(KJ_TABLE_NAMES as readonly string[]).includes(tableName)) throw new KJValidationError(`Unknown table: ${tableName}`)
    const table = this.#state.tables[tableName]
    const name = String(record.name ?? '').trim()
    if (!name) throw new KJValidationError('Table record name is required')
    const existingId = table.recordIds.find(id => normalizeName(this.#state.objects[id]?.name) === normalizeName(name))
    if (existingId) return this.updateObject(existingId, { name, payload: record.payload ?? record as unknown as KJObjectPayload })
    const kind = tableName === 'blockRecords' ? 'block-record' : 'table-record'
    const created = this.createObject({ ...record, kind, type: record.type ?? TABLE_TYPE[tableName], name, payload: record.payload ?? record as unknown as KJObjectPayload })
    table.recordIds.push(created.id)
    if (!table.currentId) table.currentId = created.id
    this.#record('table.record.add', { tableName, id: created.id })
    return created
  }

  setCurrentTableRecord(tableName: KJTableName, id: string): KJObjectRecord {
    this.#assertOpen()
    if (!(KJ_TABLE_NAMES as readonly string[]).includes(tableName)) throw new KJValidationError(`Unknown table: ${tableName}`)
    id = String(id)
    const table = this.#state.tables[tableName]
    if (!table.recordIds.includes(id)) throw new KJValidationError(`Object is not registered in ${tableName}: ${id}`)
    const previous = table.currentId
    table.currentId = id
    this.#record('table.current.set', { tableName, previous, id })
    return clone(this.#state.objects[id]!)
  }

  removeTableRecord(tableName: KJTableName, id: string): KJObjectRecord | null {
    this.#assertOpen()
    if (!(KJ_TABLE_NAMES as readonly string[]).includes(tableName)) throw new KJValidationError(`Unknown table: ${tableName}`)
    id = String(id)
    const table = this.#state.tables[tableName]
    if (!table.recordIds.includes(id)) throw new KJValidationError(`Object is not registered in ${tableName}: ${id}`)
    if (table.currentId === id) throw new KJValidationError(`Cannot remove the current ${tableName} record`)
    if (tableName === 'layers') {
      const record = this.#state.objects[id]
      if (normalizeName(record?.name) === '0') throw new KJValidationError('Layer 0 cannot be removed')
      const usedBy = Object.values(this.#state.objects).find(object => object.kind === 'entity' && !object.erased && object.payload?.layerId === id)
      if (usedBy) throw new KJValidationError(`Layer is used by entity ${usedBy.id}`)
    }
    table.recordIds = table.recordIds.filter(value => value !== id)
    const removed = this.eraseObject(id, { hard: true })
    this.#record('table.record.remove', { tableName, id })
    return removed
  }

  setActiveLayout(id: string): KJObjectRecord {
    this.#assertOpen()
    id = String(id)
    if (!this.#state.spaces.layoutIds.includes(id)) throw new KJValidationError(`Layout is not registered: ${id}`)
    const previous = this.#state.spaces.activeLayoutId
    this.#state.spaces.activeLayoutId = id
    this.#record('layout.active.set', { previous, id })
    return clone(this.#state.objects[id]!)
  }

  createLayout(options: KJLayoutOptions = {}): KJObjectRecord {
    this.#assertOpen()
    const name = String(options.name ?? '').trim()
    if (!name) throw new KJValidationError('Layout name is required')
    if (this.#state.spaces.layoutIds.some(id => String(this.#state.objects[id]?.name).toUpperCase() === name.toUpperCase())) throw new KJValidationError(`Layout already exists: ${name}`)
    const blockName = `*PAPER_SPACE_${this.#state.spaces.paperSpaceIds.length + 1}`
    const block = this.upsertTableRecord('blockRecords', { name: blockName, type: 'BLOCK_RECORD', payload: { entityIds: [], isSpace: true } })
    const layout = this.createObject({
      kind: 'layout', type: 'LAYOUT', ownerId: this.#state.namedObjectsDictionaryId, name,
      payload: {
        blockRecordId: block.id,
        tabOrder: this.#state.spaces.layoutIds.length,
        paper: clone(options.paper ?? { width: 420, height: 297, unit: 'mm' }),
        ...(options.dxfPlotSettings === undefined ? {} : { dxfPlotSettings: clone(options.dxfPlotSettings) }),
        viewportIds: [],
      },
    })
    this.#state.spaces.paperSpaceIds.push(block.id)
    this.#state.spaces.layoutIds.push(layout.id)
    const dictionary = this.#mutableObject(this.#state.namedObjectsDictionaryId)
    dictionary.payload.entries ??= {}
    dictionary.payload.entries.ACAD_LAYOUT ??= []
    if (!Array.isArray(dictionary.payload.entries.ACAD_LAYOUT)) dictionary.payload.entries.ACAD_LAYOUT = [dictionary.payload.entries.ACAD_LAYOUT]
    dictionary.payload.entries.ACAD_LAYOUT.push(layout.id)
    this.#record('layout.create', { layoutId: layout.id, blockRecordId: block.id })
    return clone(layout)
  }

  putResource<T>(collection: KJResourceCollectionName, id: string, descriptor: T): T {
    this.#assertOpen()
    if (!Object.hasOwn(this.#state.resources, collection)) throw new KJValidationError(`Unknown resource collection: ${collection}`)
    id = String(id)
    const previous = clone(this.#state.resources[collection][id])
    this.#state.resources[collection][id] = clone(descriptor)
    this.#record('resource.put', { collection, id, previous, descriptor })
    return clone(descriptor)
  }

  removeResource(collection: KJResourceCollectionName, id: string): unknown {
    this.#assertOpen()
    if (!Object.hasOwn(this.#state.resources, collection)) throw new KJValidationError(`Unknown resource collection: ${collection}`)
    id = String(id)
    const previous = clone(this.#state.resources[collection][id])
    if (previous === undefined) return null
    delete this.#state.resources[collection][id]
    this.#record('resource.remove', { collection, id, previous })
    return previous
  }

  addDictionaryEntry(dictionaryId: string, key: string, targetId: string): KJObjectRecord {
    this.#assertOpen()
    const dictionary = this.#state.objects[String(dictionaryId)]
    if (dictionary?.kind !== 'dictionary') throw new KJValidationError(`Not a dictionary: ${dictionaryId}`)
    if (!this.#state.objects[String(targetId)]) throw new KJValidationError(`Dictionary target does not exist: ${targetId}`)
    const writableDictionary = this.#mutableObject(String(dictionaryId))
    writableDictionary.payload.entries ??= {}
    const normalizedKey = normalizeName(key)
    const previous = clone(writableDictionary.payload.entries[normalizedKey])
    writableDictionary.payload.entries[normalizedKey] = String(targetId)
    this.#record('dictionary.entry.set', { dictionaryId, key: normalizedKey, previous, targetId })
    return clone(writableDictionary)
  }

  removeDictionaryEntry(dictionaryId: string, key: string): string | string[] | undefined {
    this.#assertOpen()
    const dictionary = this.#state.objects[String(dictionaryId)]
    if (dictionary?.kind !== 'dictionary') throw new KJValidationError(`Not a dictionary: ${dictionaryId}`)
    const writableDictionary = this.#mutableObject(String(dictionaryId))
    const normalizedKey = normalizeName(key)
    const previous = clone(writableDictionary.payload.entries?.[normalizedKey])
    if (writableDictionary.payload.entries) delete writableDictionary.payload.entries[normalizedKey]
    this.#record('dictionary.entry.remove', { dictionaryId, key: normalizedKey, previous })
    return previous
  }

  setXData<T>(id: string, applicationName: string, values: T): KJObjectRecord {
    this.#assertOpen()
    const object = this.#state.objects[String(id)]
    if (!object) throw new KJValidationError(`Object does not exist: ${id}`)
    const writableObject = this.#mutableObject(String(id))
    const application = normalizeName(applicationName)
    const previous = clone(writableObject.extension.xdata[application])
    writableObject.extension.xdata[application] = clone(values)
    this.#record('xdata.set', { id, application, previous, values })
    return clone(writableObject)
  }

  putOpaquePayload<T>(id: string, payload: T): T {
    this.#assertOpen()
    id = String(id)
    const previous = clone(this.#state.opaquePayloads[id])
    this.#state.opaquePayloads[id] = clone(payload)
    this.#record('opaque.put', { id, previous, payload })
    return clone(payload)
  }
}
