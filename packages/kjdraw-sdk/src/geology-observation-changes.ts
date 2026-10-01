import { KJValidationError } from './errors.js'
import type { KJGeologyObservation } from './geology-engineering.js'
import { canonicalStringify, type ReadonlyDeep } from './utils.js'

/** Exact identity in the source snapshot, not a fuzzy label or future depth. */
export interface KJGeologyObservationTarget {
  kind: KJGeologyObservation['kind']
  id: string
  expectedDepth: number
}

export type KJGeologyObservationClearField = 'displayLabel' | 'sampleMarker' | 'rangeTop' | 'rangeBottom'
export interface KJGeologyObservationChange {
  target: KJGeologyObservationTarget
  set?: Partial<Pick<KJGeologyObservation, 'depth' | 'value' | 'displayLabel' | 'sampleMarker' | 'rangeTop' | 'rangeBottom'>>
  clearFields?: readonly KJGeologyObservationClearField[]
}

/** Additive tool input. Existing observations arrays remain full replacements. */
export interface KJGeologyObservationChanges {
  add?: readonly KJGeologyObservation[]
  update?: readonly KJGeologyObservationChange[]
  remove?: readonly KJGeologyObservationTarget[]
}

const identity = (record: Pick<KJGeologyObservation, 'kind' | 'id' | 'depth'>): string =>
  JSON.stringify([record.kind, record.id, record.depth])
const fail = (message: string): never => { throw new KJValidationError(`Geology observation changes: ${message}`) }

/** Called only after the closed agent schema validates every field. Resolves
 * all targets against one immutable source snapshot, then lets the existing
 * source compiler enforce depth, range, layout and measurement invariants.
 * Nothing here infers missing records, moves range endpoints or converts units.
 */
export function applyGeologyObservationChanges(
  before: ReadonlyDeep<readonly KJGeologyObservation[]> | undefined,
  changes: KJGeologyObservationChanges,
): KJGeologyObservation[] {
  const additions = changes.add ?? [], updates = changes.update ?? [], removals = changes.remove ?? []
  const count = additions.length + updates.length + removals.length
  if (!count || count > 256) fail('require between 1 and 256 explicit operations')
  const original = before ?? []
  const changed = new Map<number, KJGeologyObservation>()
  const removed = new Set<number>(), touched = new Set<string>()
  const resolve = (target: KJGeologyObservationTarget): number => {
    const key = identity({ kind: target.kind, id: target.id, depth: target.expectedDepth })
    const matches = original.flatMap((record, index) => identity(record) === key ? [index] : [])
    if (matches.length !== 1) fail('target kind, id and expectedDepth must match exactly one existing record in this hole')
    if (touched.has(key)) fail('an original record cannot be updated or removed more than once')
    touched.add(key)
    return matches[0]!
  }
  for (const operation of updates) {
    const index = resolve(operation.target), record = original[index]!
    const set = operation.set ?? {}, clear = operation.clearFields ?? []
    if (!Object.keys(set).length && !clear.length) fail('an update requires explicit changed fields')
    if (new Set(clear).size !== clear.length) fail('an update cannot clear a field twice')
    if (clear.some(field => Object.hasOwn(set, field))) fail('an update cannot both set and clear a field')
    const next: KJGeologyObservation = structuredClone(record)
    Object.assign(next, structuredClone(set))
    for (const field of clear) delete next[field]
    if (canonicalStringify(next) === canonicalStringify(record)) fail('an update must change stored facts')
    changed.set(index, next)
  }
  for (const target of removals) removed.add(resolve(target))
  const additionIdentities = new Set<string>()
  for (const record of additions) {
    const key = identity(record)
    if (additionIdentities.has(key) || touched.has(key) || original.some(item => identity(item) === key))
      fail('an addition cannot duplicate an existing, touched or newly added identity')
    additionIdentities.add(key)
  }
  // Existing record order is retained; explicit new records append in caller
  // order. Removing the last record leaves [], never unknown/absent facts.
  return [
    ...original.flatMap((record, index) => removed.has(index) ? [] : [changed.get(index) ?? structuredClone(record)]),
    ...additions.map(record => structuredClone(record)),
  ]
}
