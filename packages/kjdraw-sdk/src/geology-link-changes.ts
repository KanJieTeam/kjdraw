import { KJValidationError } from './errors.js'
import type { KJGeologySectionInput } from './geology-engineering.js'
import type { ReadonlyDeep } from './utils.js'

/** Exact source interval identities, never legacy codes, indices or labels. */
export interface KJGeologyIntervalLink {
  fromHoleId: string
  toHoleId: string
  fromIntervalId: string
  toIntervalId: string
}
export interface KJGeologyUncorrelatedOccurrence {
  holeId: string
  adjacentHoleId: string
  intervalId: string
}
export interface KJGeologySectionLinkChanges {
  correlations?: { add?: readonly KJGeologyIntervalLink[]; remove?: readonly KJGeologyIntervalLink[] }
  uncorrelatedOccurrences?: { add?: readonly KJGeologyUncorrelatedOccurrence[]; remove?: readonly KJGeologyUncorrelatedOccurrence[] }
}

function fail(message: string): never { throw new KJValidationError(`Geology link changes: ${message}`) }
const linkFields = ['fromHoleId', 'toHoleId', 'fromIntervalId', 'toIntervalId'] as const
const occurrenceFields = ['holeId', 'adjacentHoleId', 'intervalId'] as const
const linkKey = (link: KJGeologyIntervalLink): string => JSON.stringify(linkFields.map(field => link[field]))
const occurrenceKey = (item: KJGeologyUncorrelatedOccurrence): string => JSON.stringify(occurrenceFields.map(field => item[field]))

// Public helper inputs are data, including when not reached through agent-tools.
// Inspect descriptors before cloning so getters and hidden/symbol properties
// cannot run or disappear during validation. Budgets match source snapshots.
function dataCopy<T>(input: T): T {
  let nodes = 0, characters = 0
  const ancestors = new Set<object>()
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 150000 || depth > 32) fail('data budget exceeded')
    if (value === null || typeof value === 'boolean') return
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('nonfinite data'); return }
    if (typeof value === 'string') { if ((characters += value.length) > 2000000) fail('text budget exceeded'); return }
    if (!value || typeof value !== 'object' || ancestors.has(value)) fail('require finite acyclic plain data')
    const array = Array.isArray(value)
    if (array ? Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1
      : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('require plain objects and dense arrays')
    ancestors.add(value)
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor.enumerable || !('value' in descriptor))
        fail('accessors, hidden, symbol and unsafe properties are forbidden')
      if (array && (String(Number(key)) !== key || !Number.isSafeInteger(Number(key)) || Number(key) < 0 || Number(key) >= value.length))
        fail('require indexed array data only')
      visit(descriptor.value, depth + 1)
    }
    ancestors.delete(value)
  }
  visit(input, 0)
  return structuredClone(input)
}
function closed(value: unknown, fields: readonly string[], path: string, required: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(record, key)))
    fail(`${path} requires only its published exact identity fields`)
  return record
}
function exactIdentity(value: unknown, fields: readonly string[], path: string): void {
  const record = closed(value, fields, path, fields)
  if (fields.some(field => typeof record[field] !== 'string' || !(record[field] as string).trim() || (record[field] as string).length > 64))
    fail(`${path} requires nonempty source IDs of at most 64 characters`)
}

/** Add/remove resolves against ONE immutable BEFORE source. Surviving native
 * declarations retain order and every unrequested field; additions append in
 * caller order. Both endpoints must have explicitly complete final coverage.
 * The existing drawing compiler remains authoritative for strata compatibility,
 * branching/crossing, layout, HATCH, resource and geometry validation.
 */
export function applyGeologySectionLinkChanges(
  before: ReadonlyDeep<KJGeologySectionInput>, changes: KJGeologySectionLinkChanges,
): KJGeologySectionInput {
  const original = dataCopy(before), operations = dataCopy(changes)
  if (!original || typeof original !== 'object' || Array.isArray(original)) fail('require an actual section source object')
  if (original.sourceFactMode !== 'complete-occurrence-map' ||
    (original.correlationMode ?? 'explicit-correlations') !== 'explicit-correlations' || original.manualConnections?.length)
    fail('require a complete source-backed exact adjacent-hole occurrence map')
  closed(operations, ['correlations', 'uncorrelatedOccurrences'], 'linkChanges')
  let count = 0
  for (const [name, fields] of [['correlations', linkFields], ['uncorrelatedOccurrences', occurrenceFields]] as const) {
    const group = operations[name]
    if (group === undefined) continue
    closed(group, ['add', 'remove'], `linkChanges.${name}`)
    if (!Object.keys(group).length) fail(`linkChanges.${name} requires explicit operations`)
    for (const action of ['add', 'remove'] as const) {
      const items = group[action]
      if (items === undefined) continue
      if (!Array.isArray(items) || !items.length || items.length > 256) fail(`linkChanges.${name}.${action} requires 1–256 entries`)
      count += items.length
      items.forEach((item, index) => exactIdentity(item, fields, `linkChanges.${name}.${action}[${index}]`))
    }
  }
  if (!count || count > 256) fail('require between 1 and 256 total explicit operations')
  if (!Array.isArray(original.holes) || original.holes.length < 2 || original.holes.length > 24) fail('require 2–24 actual source holes')
  if (original.holes.some(hole => !hole || typeof hole !== 'object' || Array.isArray(hole))) fail('require actual source hole objects')
  const ordered = [...original.holes].sort((a, b) => (a.station ?? NaN) - (b.station ?? NaN))
  const byId = new Map<string, number>(), intervals = new Map<string, Set<string>>()
  ordered.forEach((hole, index) => {
    if (typeof hole.id !== 'string' || byId.has(hole.id) || !Number.isFinite(hole.station) ||
      index > 0 && hole.station! <= ordered[index - 1]!.station!) fail('require unique source hole IDs and increasing stations')
    const ids = new Set<string>()
    if (!Array.isArray(hole.strata) || !hole.strata.length) fail('require actual source intervals')
    for (const layer of hole.strata) {
      if (!layer || typeof layer !== 'object' || typeof layer.intervalId !== 'string' || !layer.intervalId || ids.has(layer.intervalId)) fail('require unique source interval IDs in each hole')
      ids.add(layer.intervalId)
    }
    byId.set(hole.id, index); intervals.set(hole.id, ids)
  })
  const occurrence = (holeId: string, adjacentHoleId: string, intervalId: string): string => {
    const first = byId.get(holeId), second = byId.get(adjacentHoleId)
    if (first === undefined || second === undefined || Math.abs(first - second) !== 1 || !intervals.get(holeId)!.has(intervalId))
      fail('reference must identify an actual BEFORE interval toward an adjacent source hole')
    return occurrenceKey({ holeId, adjacentHoleId, intervalId })
  }
  const checkLink = (link: KJGeologyIntervalLink): void => {
    occurrence(link.fromHoleId, link.toHoleId, link.fromIntervalId)
    occurrence(link.toHoleId, link.fromHoleId, link.toIntervalId)
    if (byId.get(link.toHoleId)! !== byId.get(link.fromHoleId)! + 1) fail('correlations must follow actual increasing station order; never reverse endpoints')
  }
  const checkCoverage = (input: ReadonlyDeep<KJGeologySectionInput>): void => {
    if (!Array.isArray(input.correlations) || input.correlations.length > 512 ||
      Object.hasOwn(input, 'uncorrelatedOccurrences') && !Array.isArray(input.uncorrelatedOccurrences) || (input.uncorrelatedOccurrences?.length ?? 0) > 2048)
      fail('require actual lists with at most 512 correlations and 2048 uncorrelated occurrences')
    const coverage = new Map<string, boolean>()
    ordered.forEach((hole, index) => {
      for (const neighbour of [ordered[index - 1], ordered[index + 1]]) if (neighbour)
        for (const id of intervals.get(hole.id)!) coverage.set(occurrenceKey({ holeId: hole.id, adjacentHoleId: neighbour.id, intervalId: id }), false)
    })
    const mark = (id: string): void => { if (coverage.get(id) !== false) fail('duplicate or conflicting linked/unlinked occurrence'); coverage.set(id, true) }
    for (const link of input.correlations) {
      if (!link || !link.fromIntervalId || !link.toIntervalId || link.fromStratumCode || link.toStratumCode) fail('complete source requires interval-ID links, never legacy code selectors')
      checkLink(link as KJGeologyIntervalLink)
      mark(occurrence(link.fromHoleId, link.toHoleId, link.fromIntervalId))
      mark(occurrence(link.toHoleId, link.fromHoleId, link.toIntervalId))
    }
    for (const item of input.uncorrelatedOccurrences ?? []) {
      exactIdentity(item, occurrenceFields, 'source uncorrelated occurrence')
      mark(occurrence(item.holeId, item.adjacentHoleId, item.intervalId))
    }
    if ([...coverage.values()].some(value => !value)) fail('incomplete occurrence map: explicitly cover both endpoints of every adjacent-hole interval; coverage is never inferred')
  }
  checkCoverage(original)
  const patch = <T>(items: readonly T[], group: { add?: readonly T[]; remove?: readonly T[] },
    key: (item: T) => string, check: (item: T) => void): T[] => {
    const prior = new Map<string, T>()
    for (const item of items) { const id = key(item); if (prior.has(id)) fail('duplicate BEFORE identity'); prior.set(id, item) }
    const removed = new Set<string>(), added = new Set<string>()
    for (const item of group.remove ?? []) {
      check(item)
      const id = key(item)
      if (!prior.has(id) || removed.has(id)) fail('remove must match exactly one untouched BEFORE declaration')
      removed.add(id)
    }
    for (const item of group.add ?? []) {
      check(item)
      const id = key(item)
      if (prior.has(id) || added.has(id) || removed.has(id)) fail('add cannot duplicate an existing, touched or newly added identity')
      added.add(id)
    }
    return [...items.filter(item => !removed.has(key(item))).map(item => structuredClone(item)),
      ...(group.add ?? []).map(item => structuredClone(item))]
  }
  const next = structuredClone(original) as KJGeologySectionInput
  if (operations.correlations !== undefined) next.correlations = patch(original.correlations as readonly KJGeologyIntervalLink[], operations.correlations, linkKey, checkLink)
  if (operations.uncorrelatedOccurrences !== undefined) next.uncorrelatedOccurrences = patch(original.uncorrelatedOccurrences ?? [], operations.uncorrelatedOccurrences,
    occurrenceKey, item => { occurrence(item.holeId, item.adjacentHoleId, item.intervalId) })
  checkCoverage(next)
  return next
}
