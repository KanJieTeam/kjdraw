import { isDeepStrictEqual } from 'node:util'

// Benchmark scoring primitive, not a public SDK diff API. KJD IDs are authoritative
// within one document; a DXF reopen may assign new IDs even when handles survive.
const sorted = values => [...values].sort((a, b) => a.localeCompare(b))
const pointer = (base, key) => `${base}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`
function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function changedPaths(before, after, path = '') {
  if (isDeepStrictEqual(before, after)) return []
  const beforeArray = Array.isArray(before), afterArray = Array.isArray(after)
  if (beforeArray && afterArray) {
    if (before.length !== after.length) return [path || '/']
    return Array.from({ length: Math.max(before.length, after.length) }, (_, index) =>
      changedPaths(before[index], after[index], pointer(path, index))).flat()
  }
  const beforeObject = before !== null && typeof before === 'object' && !beforeArray
  const afterObject = after !== null && typeof after === 'object' && !afterArray
  if (beforeObject && afterObject) {
    return sorted(new Set([...Object.keys(before), ...Object.keys(after)]))
      .flatMap(key => changedPaths(before[key], after[key], pointer(path, key)))
  }
  return [path || '/']
}

export function captureSemanticEntityState(document) {
  if (!document || typeof document.listEntities !== 'function') throw new TypeError('A KJDraw document is required')
  const entities = document.listEntities().map(entity => ({
    id: entity.id,
    handle: entity.handle,
    kind: entity.kind,
    type: entity.type,
    ownerId: entity.ownerId,
    name: entity.name,
    payload: structuredClone(entity.payload),
    extension: structuredClone(entity.extension),
    source: structuredClone(entity.source),
  }))
  if (entities.some(entity => typeof entity.id !== 'string' || !entity.id) ||
      new Set(entities.map(entity => entity.id)).size !== entities.length) {
    throw new Error('Entity IDs must be unique and nonempty')
  }
  return deepFreeze({ documentId: document.id, revision: document.revision,
    entities: entities.sort((a, b) => a.id.localeCompare(b.id)) })
}

export function diffSemanticEntityStates(before, after, { allowedChangedIds = [] } = {}) {
  if (!Array.isArray(before?.entities) || !Array.isArray(after?.entities)) throw new TypeError('Captured entity states are required')
  const prior = new Map(before.entities.map(entity => [entity.id, entity]))
  const next = new Map(after.entities.map(entity => [entity.id, entity]))
  if (prior.size !== before.entities.length || next.size !== after.entities.length) throw new Error('Duplicate entity ID in captured state')
  const allowed = new Set(allowedChangedIds)
  const added = [], removed = [], modified = [], unchanged = []
  for (const id of sorted(prior.keys())) {
    const left = prior.get(id), right = next.get(id)
    if (!right) { removed.push(id); continue }
    const fields = changedPaths(left, right)
    if (fields.length) modified.push({ id, fields })
    else unchanged.push(id)
  }
  for (const id of sorted(next.keys())) if (!prior.has(id)) added.push(id)

  const removedHandles = new Map()
  const addedHandleCounts = new Map()
  for (const id of added) {
    const handle = next.get(id).handle
    if (typeof handle === 'string' && handle) addedHandleCounts.set(handle, (addedHandleCounts.get(handle) ?? 0) + 1)
  }
  for (const id of removed) {
    const handle = prior.get(id).handle
    if (typeof handle === 'string' && handle) {
      const matches = removedHandles.get(handle) ?? []
      matches.push(id)
      removedHandles.set(handle, matches)
    }
  }
  const idChurnByHandle = []
  for (const id of added) {
    const handle = next.get(id).handle, matches = removedHandles.get(handle)
    if (typeof handle === 'string' && handle && matches?.length === 1 && addedHandleCounts.get(handle) === 1) {
      idChurnByHandle.push({ handle, beforeId: matches[0], afterId: id,
        fieldsWithoutId: changedPaths({ ...prior.get(matches[0]), id: null }, { ...next.get(id), id: null }) })
    }
  }
  return Object.freeze({
    schema: 'kjdraw-semantic-entity-diff@1',
    beforeRevision: before.revision, afterRevision: after.revision,
    added, removed, modified, unchanged, idChurnByHandle,
    unexpectedExistingChanges: sorted([...removed, ...modified.map(change => change.id)].filter(id => !allowed.has(id))),
  })
}
