import { KJ_TABLE_NAMES } from './constants.js'
import { KJTransactionError, KJValidationError } from './errors.js'
import { createId } from './ids.js'
import { allocateHandle, createObjectRecord } from './schema.js'
import { isStandardEntityType, normalizeStandardEntityPayload } from './standard-entities.js'
import { clone, fromHexHandle, normalizeName, toHexHandle } from './utils.js'

const TABLE_TYPE = Object.freeze({
  layers: 'LAYER',
  linetypes: 'LINETYPE',
  textStyles: 'TEXT_STYLE',
  dimensionStyles: 'DIM_STYLE',
  ucs: 'UCS',
  views: 'VIEW',
  blockRecords: 'BLOCK_RECORD',
})

export class KJTransaction {
  #state
  #closed = false
  #operations = []

  constructor(state, { label = 'Transaction', metadata = {} } = {}) {
    this.#state = state
    this.label = String(label)
    this.metadata = clone(metadata)
  }

  get operations() { return clone(this.#operations) }
  get closed() { return this.#closed }

  _draft() { return this.#state }
  _close() { this.#closed = true }

  #assertOpen() {
    if (this.#closed) throw new KJTransactionError('Transaction is already closed')
  }

  #record(type, data) {
    this.#operations.push({ type, ...clone(data) })
  }

  #claimHandle(handle) {
    const normalized = String(handle ?? '').trim().toUpperCase()
    if (!normalized) return allocateHandle(this.#state)
    const numeric = fromHexHandle(normalized)
    if (Object.values(this.#state.objects).some(object => object.handle === normalized)) throw new KJValidationError(`Duplicate handle: ${normalized}`)
    const handseed = fromHexHandle(this.#state.header.handseed)
    if (numeric >= handseed) this.#state.header.handseed = toHexHandle(numeric + 1n)
    return normalized
  }

  getObject(id) {
    this.#assertOpen()
    const object = this.#state.objects[String(id)]
    return object ? clone(object) : null
  }

  createObject(spec = {}) {
    this.#assertOpen()
    const id = String(spec.id ?? createId(spec.kind === 'entity' ? 'entity' : 'obj'))
    if (this.#state.objects[id]) throw new KJValidationError(`Duplicate object id: ${id}`)
    const normalizedSpec = spec.kind === 'entity' && isStandardEntityType(spec.type)
      ? { ...spec, payload: normalizeStandardEntityPayload(spec.type, { ...spec.payload, layerId: spec.payload?.layerId ?? this.#state.tables.layers.currentId }) }
      : spec
    const object = createObjectRecord({ ...normalizedSpec, id, handle: this.#claimHandle(spec.handle) })
    if (object.ownerId && !this.#state.objects[object.ownerId]) throw new KJValidationError(`Object owner does not exist: ${object.ownerId}`)
    this.#state.objects[id] = object
    if (object.kind === 'entity') {
      const owner = this.#state.objects[object.ownerId]
      if (owner?.kind !== 'block-record') throw new KJValidationError('Entity owner must be a block record')
      owner.payload.entityIds ??= []
      if (!owner.payload.entityIds.includes(id)) owner.payload.entityIds.push(id)
    }
    this.#record('object.create', { object })
    return clone(object)
  }

  createEntity(type, payload = {}, options = {}) {
    const ownerId = options.ownerId ?? this.#state.spaces.modelSpaceId
    const layerId = payload.layerId ?? this.#state.tables.layers.currentId
    return this.createObject({ ...options, kind: 'entity', type, ownerId, payload: normalizeStandardEntityPayload(type, { ...payload, layerId }) })
  }

  updateObject(id, patch = {}) {
    this.#assertOpen()
    id = String(id)
    const current = this.#state.objects[id]
    if (!current) throw new KJValidationError(`Object does not exist: ${id}`)
    if ('id' in patch && String(patch.id) !== id) throw new KJValidationError('Object id is immutable')
    if ('handle' in patch && String(patch.handle).toUpperCase() !== current.handle) throw new KJValidationError('Object handle is immutable')
    if ('kind' in patch && String(patch.kind) !== current.kind) throw new KJValidationError('Object kind is immutable')
    if ('type' in patch && normalizeName(patch.type) !== current.type) throw new KJValidationError('Object type is immutable')
    if ('ownerId' in patch && patch.ownerId !== current.ownerId) throw new KJValidationError('Use reparentObject to change ownership')
    const before = clone(current)
    const mergedPayload = patch.payload ? { ...current.payload, ...clone(patch.payload) } : current.payload
    const next = {
      ...current,
      ...clone(patch),
      id,
      handle: current.handle,
      payload: current.kind === 'entity' && isStandardEntityType(current.type) ? normalizeStandardEntityPayload(current.type, mergedPayload) : mergedPayload,
      extension: patch.extension ? { ...current.extension, ...clone(patch.extension) } : current.extension,
    }
    this.#state.objects[id] = next
    this.#record('object.update', { id, before, after: next })
    return clone(next)
  }

  reparentObject(id, ownerId) {
    this.#assertOpen()
    id = String(id); ownerId = ownerId == null ? null : String(ownerId)
    const object = this.#state.objects[id]
    if (!object) throw new KJValidationError(`Object does not exist: ${id}`)
    if (ownerId && !this.#state.objects[ownerId]) throw new KJValidationError(`Owner does not exist: ${ownerId}`)
    const previousOwnerId = object.ownerId
    if (object.kind === 'entity') {
      if (this.#state.objects[ownerId]?.kind !== 'block-record') throw new KJValidationError('Entity owner must be a block record')
      const previous = this.#state.objects[previousOwnerId]
      if (previous?.payload?.entityIds) previous.payload.entityIds = previous.payload.entityIds.filter(value => value !== id)
      const next = this.#state.objects[ownerId]
      next.payload.entityIds ??= []
      if (!next.payload.entityIds.includes(id)) next.payload.entityIds.push(id)
    }
    object.ownerId = ownerId
    this.#record('object.reparent', { id, previousOwnerId, ownerId })
    return clone(object)
  }

  eraseObject(id, { hard = false } = {}) {
    this.#assertOpen()
    id = String(id)
    const object = this.#state.objects[id]
    if (!object) return null
    if (!hard) return this.updateObject(id, { erased: true })
    const owned = Object.values(this.#state.objects).filter(value => value.ownerId === id)
    if (owned.length) throw new KJValidationError(`Cannot purge object with owned children: ${id}`)
    for (const table of Object.values(this.#state.tables)) {
      if (table.recordIds.includes(id) || table.currentId === id) throw new KJValidationError(`Cannot purge registered table record: ${id}`)
    }
    if (object.kind === 'entity') {
      const owner = this.#state.objects[object.ownerId]
      if (owner?.payload?.entityIds) owner.payload.entityIds = owner.payload.entityIds.filter(value => value !== id)
    }
    delete this.#state.objects[id]
    this.#record('object.purge', { object })
    return clone(object)
  }

  restoreObject(id) { return this.updateObject(id, { erased: false }) }

  setHeader(name, value) {
    this.#assertOpen()
    const key = String(name)
    if (key === 'handseed') throw new KJValidationError('HANDSEED is managed by the document')
    const previous = clone(this.#state.header[key])
    this.#state.header[key] = clone(value)
    this.#record('header.set', { name: key, previous, value })
    return clone(value)
  }

  setSystemVariable(name, value) {
    this.#assertOpen()
    const key = normalizeName(name)
    if (!key) throw new KJValidationError('System variable name is required')
    const previous = clone(this.#state.header.systemVariables[key])
    this.#state.header.systemVariables[key] = clone(value)
    this.#record('system-variable.set', { name: key, previous, value })
    return clone(value)
  }

  upsertTableRecord(tableName, record = {}) {
    this.#assertOpen()
    if (!KJ_TABLE_NAMES.includes(tableName)) throw new KJValidationError(`Unknown table: ${tableName}`)
    const table = this.#state.tables[tableName]
    const name = String(record.name ?? '').trim()
    if (!name) throw new KJValidationError('Table record name is required')
    const existingId = table.recordIds.find(id => normalizeName(this.#state.objects[id]?.name) === normalizeName(name))
    if (existingId) return this.updateObject(existingId, { name, payload: record.payload ?? record })
    const kind = tableName === 'blockRecords' ? 'block-record' : 'table-record'
    const created = this.createObject({ ...record, kind, type: record.type ?? TABLE_TYPE[tableName], name, payload: record.payload ?? record })
    table.recordIds.push(created.id)
    if (!table.currentId) table.currentId = created.id
    this.#record('table.record.add', { tableName, id: created.id })
    return created
  }

  setCurrentTableRecord(tableName, id) {
    this.#assertOpen()
    if (!KJ_TABLE_NAMES.includes(tableName)) throw new KJValidationError(`Unknown table: ${tableName}`)
    id = String(id)
    const table = this.#state.tables[tableName]
    if (!table.recordIds.includes(id)) throw new KJValidationError(`Object is not registered in ${tableName}: ${id}`)
    const previous = table.currentId
    table.currentId = id
    this.#record('table.current.set', { tableName, previous, id })
    return clone(this.#state.objects[id])
  }

  removeTableRecord(tableName, id) {
    this.#assertOpen()
    if (!KJ_TABLE_NAMES.includes(tableName)) throw new KJValidationError(`Unknown table: ${tableName}`)
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

  setActiveLayout(id) {
    this.#assertOpen()
    id = String(id)
    if (!this.#state.spaces.layoutIds.includes(id)) throw new KJValidationError(`Layout is not registered: ${id}`)
    const previous = this.#state.spaces.activeLayoutId
    this.#state.spaces.activeLayoutId = id
    this.#record('layout.active.set', { previous, id })
    return clone(this.#state.objects[id])
  }

  createLayout(options = {}) {
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
        viewportIds: [],
      },
    })
    this.#state.spaces.paperSpaceIds.push(block.id)
    this.#state.spaces.layoutIds.push(layout.id)
    const dictionary = this.#state.objects[this.#state.namedObjectsDictionaryId]
    dictionary.payload.entries.ACAD_LAYOUT ??= []
    if (!Array.isArray(dictionary.payload.entries.ACAD_LAYOUT)) dictionary.payload.entries.ACAD_LAYOUT = [dictionary.payload.entries.ACAD_LAYOUT]
    dictionary.payload.entries.ACAD_LAYOUT.push(layout.id)
    this.#record('layout.create', { layoutId: layout.id, blockRecordId: block.id })
    return clone(layout)
  }

  putResource(collection, id, descriptor) {
    this.#assertOpen()
    if (!Object.hasOwn(this.#state.resources, collection)) throw new KJValidationError(`Unknown resource collection: ${collection}`)
    id = String(id)
    const previous = clone(this.#state.resources[collection][id])
    this.#state.resources[collection][id] = clone(descriptor)
    this.#record('resource.put', { collection, id, previous, descriptor })
    return clone(descriptor)
  }

  removeResource(collection, id) {
    this.#assertOpen()
    if (!Object.hasOwn(this.#state.resources, collection)) throw new KJValidationError(`Unknown resource collection: ${collection}`)
    id = String(id)
    const previous = clone(this.#state.resources[collection][id])
    if (previous === undefined) return null
    delete this.#state.resources[collection][id]
    this.#record('resource.remove', { collection, id, previous })
    return previous
  }

  addDictionaryEntry(dictionaryId, key, targetId) {
    this.#assertOpen()
    const dictionary = this.#state.objects[String(dictionaryId)]
    if (dictionary?.kind !== 'dictionary') throw new KJValidationError(`Not a dictionary: ${dictionaryId}`)
    if (!this.#state.objects[String(targetId)]) throw new KJValidationError(`Dictionary target does not exist: ${targetId}`)
    dictionary.payload.entries ??= {}
    const normalizedKey = normalizeName(key)
    const previous = clone(dictionary.payload.entries[normalizedKey])
    dictionary.payload.entries[normalizedKey] = String(targetId)
    this.#record('dictionary.entry.set', { dictionaryId, key: normalizedKey, previous, targetId })
    return clone(dictionary)
  }

  removeDictionaryEntry(dictionaryId, key) {
    this.#assertOpen()
    const dictionary = this.#state.objects[String(dictionaryId)]
    if (dictionary?.kind !== 'dictionary') throw new KJValidationError(`Not a dictionary: ${dictionaryId}`)
    const normalizedKey = normalizeName(key)
    const previous = clone(dictionary.payload.entries?.[normalizedKey])
    if (dictionary.payload.entries) delete dictionary.payload.entries[normalizedKey]
    this.#record('dictionary.entry.remove', { dictionaryId, key: normalizedKey, previous })
    return previous
  }

  setXData(id, applicationName, values) {
    this.#assertOpen()
    const object = this.#state.objects[String(id)]
    if (!object) throw new KJValidationError(`Object does not exist: ${id}`)
    const application = normalizeName(applicationName)
    const previous = clone(object.extension.xdata[application])
    object.extension.xdata[application] = clone(values)
    this.#record('xdata.set', { id, application, previous, values })
    return clone(object)
  }

  putOpaquePayload(id, payload) {
    this.#assertOpen()
    id = String(id)
    const previous = clone(this.#state.opaquePayloads[id])
    this.#state.opaquePayloads[id] = clone(payload)
    this.#record('opaque.put', { id, previous, payload })
    return clone(payload)
  }
}
