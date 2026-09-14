import type {
  KJAgentCapabilityCandidatePredicate,
  KJAgentCapabilityCandidateRule,
  KJAgentCapabilityEvidenceSource,
} from './agent-capabilities.js'
import { KJValidationError } from './errors.js'
import { deepFreeze, type ReadonlyDeep } from './utils.js'

type JsonScalar = string | number | boolean | null
type Bounds = readonly [number, number, number, number]
type ResolvedRule = ReadonlyDeep<KJAgentCapabilityCandidateRule> & { readonly capabilityId: string; readonly capabilityVersion: string }

export interface KJAgentCapabilityCandidateEvaluationInput {
  candidateRules: readonly ResolvedRule[]
  topology: unknown
  expectedRevision: number
  expectedTolerance: number
  units: string
  seedIds: readonly string[]
  relatedIds: readonly string[]
  maxBytes: number
}

export interface KJAgentCapabilityPredicateEvidence {
  predicateIndex: number
  fact: KJAgentCapabilityCandidatePredicate['fact']
  operator: KJAgentCapabilityCandidatePredicate['operator']
  source: ReadonlyDeep<KJAgentCapabilityEvidenceSource>
  compareTo?: ReadonlyDeep<KJAgentCapabilityEvidenceSource>
  relation?: string
  passed: boolean
  observed?: Readonly<Record<string, unknown>>
  matchingRelatedIds?: readonly string[]
  nonMatchingIds?: readonly string[]
}

export interface KJAgentCapabilityCandidateEvidence {
  capabilityId: string
  capabilityVersion: string
  ruleId: string
  seedId: string
  passed: boolean
  predicates: readonly ReadonlyDeep<KJAgentCapabilityPredicateEvidence>[]
}

export interface KJAgentCapabilityCandidate {
  capabilityId: string
  capabilityVersion: string
  ruleId: string
  candidateKind: string
  seedIds: readonly [string]
  relatedIds: readonly string[]
  evidenceCodes: readonly string[]
  nonMatchingIds: readonly string[]
  confirmationRequired: boolean
}

export interface KJAgentCapabilityCandidateEvaluation {
  documentId: string
  revision: number
  units: string
  candidates: readonly ReadonlyDeep<KJAgentCapabilityCandidate>[]
  evidence: readonly ReadonlyDeep<KJAgentCapabilityCandidateEvidence>[]
  nonMatchingIds: readonly string[]
  confirmationRequired: boolean
  limits: Readonly<{ maxRules: number; maxIds: number; maxEvaluations: number; evaluations: number; maxBytes: number }>
}

const MAX_RULES = 32
const MAX_IDS = 64
const MAX_EVALUATIONS = 100_000
const MAX_INPUT_BYTES = 524_288
const MAX_INPUT_NODES = 65_536
const MAX_DEPTH = 16
const ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
const ENTITY_TYPE = /^[A-Z][A-Z0-9_]{0,63}$/
const encoder = new TextEncoder()
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor'])
const paths = new Set([
  'entities[].ownerId',
  'entities[].layer.id',
  'entities[].nativeReferences.hatch.loops[].boundarySources',
  'entities[].nativeReferences.insert.blockRecordId',
  'entities[].nativeReferences.insert.typeCountSignature',
  'entities[].nativeReferences.insert.repeat.sameDefinitionInstanceCount',
  'entities[].nativeReferences.displayExtent.bounds',
])
const operators = new Set(['exists', 'equals', 'at_least', 'at_most', 'all_resolved', 'same_as', 'within'])
const facts = new Set(['native-reference', 'geometry-relation', 'repeat-group', 'spatial-cluster', 'property'])
const pathFacts: Readonly<Record<KJAgentCapabilityEvidenceSource['path'], readonly KJAgentCapabilityCandidatePredicate['fact'][]>> = {
  'entities[].ownerId': ['property'],
  'entities[].layer.id': ['property'],
  'entities[].nativeReferences.hatch.loops[].boundarySources': ['native-reference'],
  'entities[].nativeReferences.insert.blockRecordId': ['property'],
  'entities[].nativeReferences.insert.typeCountSignature': ['property'],
  'entities[].nativeReferences.insert.repeat.sameDefinitionInstanceCount': ['repeat-group'],
  'entities[].nativeReferences.displayExtent.bounds': ['property', 'geometry-relation', 'spatial-cluster'],
}
const operatorsByFact: Readonly<Record<KJAgentCapabilityCandidatePredicate['fact'], readonly KJAgentCapabilityCandidatePredicate['operator'][]>> = {
  'native-reference': ['exists', 'all_resolved'],
  'geometry-relation': ['within'],
  'repeat-group': ['at_least', 'at_most'],
  'spatial-cluster': ['within'],
  property: ['exists', 'equals', 'same_as'],
}
const fail = (message: string): never => { throw new KJValidationError(message) }
const jsonBytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).length
const plainRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label} must be an object`)
  return value as Record<string, unknown>
}
const exactRecord = (value: unknown, allowed: readonly string[], label: string): Record<string, unknown> => {
  const result = plainRecord(value, label)
  if (Object.keys(result).some(key => !allowed.includes(key))) return fail(`${label} contains unsupported fields`)
  return result
}
const boundedText = (value: unknown, label: string, maximum = 256): string => {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0')) return fail(`${label} must be bounded nonempty text`)
  return value
}
const identifier = (value: unknown, label: string): string => {
  const result = boundedText(value, label, 128)
  if (!ID.test(result)) return fail(`${label} must be a stable lowercase identifier`)
  return result
}
const exactVersion = (value: unknown): string => {
  const result = boundedText(value, 'Resolved capability version', 128)
  if (!SEMVER.test(result)) return fail('Resolved capability version must be an exact semantic version')
  return result
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const classifiesPatternAsNoiseOrBoundary = (candidateKind: string): boolean => candidateKind.toLowerCase().split(/[._-]+/).some(token => token === 'noise' || token === 'boundary')
const stableCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

// Detach public inputs without invoking getters or toJSON hooks.
function safeJsonSnapshot(input: unknown): unknown {
  let nodes = 0
  const active = new Set<object>()
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > MAX_INPUT_NODES || depth > MAX_DEPTH) return fail('Candidate evaluation input exceeds the structural budget')
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return value
    if (!value || typeof value !== 'object') return fail('Candidate evaluation input must contain only finite JSON values')
    if (active.has(value)) return fail('Candidate evaluation input must not contain cycles')
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) return fail('Candidate evaluation input must use plain objects and arrays')
    const keys = Reflect.ownKeys(value)
    const result: unknown[] | Record<string, unknown> = array ? [] : Object.create(null)
    active.add(value)
    for (const key of keys) {
      if (array && key === 'length') continue
      if (typeof key !== 'string' || unsafeKeys.has(key)) return fail('Candidate evaluation input contains an unsafe property')
      if (array && !/^(0|[1-9]\d*)$/.test(key)) return fail('Candidate evaluation arrays must contain only indexed values')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!descriptor.enumerable || !('value' in descriptor)) return fail('Candidate evaluation input must not contain accessors or hidden properties')
      ;(result as Record<string, unknown>)[key] = visit(descriptor.value, depth + 1)
    }
    if (array && keys.length - 1 !== value.length) return fail('Candidate evaluation arrays must not contain holes')
    active.delete(value)
    return result
  }
  const result = visit(input, 0)
  if (jsonBytes(result) > MAX_INPUT_BYTES) fail('Candidate evaluation input exceeds the byte budget')
  return result
}

function ids(value: unknown, label: string, minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_IDS) return fail(`${label} must contain ${minimum} to ${MAX_IDS} IDs`)
  const result = value.map(item => boundedText(item, `${label} ID`))
  if (new Set(result).size !== result.length) return fail(`${label} IDs must be unique`)
  return result.sort()
}

function source(value: unknown, label: string): KJAgentCapabilityEvidenceSource {
  const item = exactRecord(value, ['toolName', 'scope', 'path'], label)
  if (item.toolName !== 'cad_query_topology' || !['seed', 'related'].includes(String(item.scope)) || !paths.has(String(item.path))) return fail(`${label} is unsupported`)
  return { toolName: 'cad_query_topology', scope: item.scope as 'seed' | 'related', path: item.path as KJAgentCapabilityEvidenceSource['path'] }
}

function validateRules(value: unknown): ResolvedRule[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RULES) return fail(`Candidate evaluation requires 1 to ${MAX_RULES} resolved rules`)
  const result = value.map(raw => {
    const item = exactRecord(raw, ['id', 'candidateKind', 'seed', 'predicates', 'evidenceCodes', 'nonMatchPolicy', 'confirmation', 'capabilityId', 'capabilityVersion'], 'Resolved candidate rule')
    const seed = exactRecord(item.seed, ['entityTypes'], 'Resolved candidate seed')
    if (!Array.isArray(seed.entityTypes) || seed.entityTypes.length < 1 || seed.entityTypes.length > 16) return fail('Resolved candidate entity types are invalid')
    const entityTypes = seed.entityTypes.map(value => boundedText(value, 'Resolved candidate entity type', 64))
    if (entityTypes.some(value => !ENTITY_TYPE.test(value)) || new Set(entityTypes).size !== entityTypes.length) return fail('Resolved candidate entity types must be unique canonical names')
    if (!Array.isArray(item.predicates) || item.predicates.length < 1 || item.predicates.length > 16) return fail('Resolved candidate predicates are invalid')
    const predicates = item.predicates.map(rawPredicate => {
      const predicate = exactRecord(rawPredicate, ['fact', 'source', 'operator', 'compareTo', 'relation', 'value'], 'Resolved candidate predicate')
      if (!facts.has(String(predicate.fact)) || !operators.has(String(predicate.operator))) return fail('Resolved candidate predicate vocabulary is unsupported')
      const fact = predicate.fact as KJAgentCapabilityCandidatePredicate['fact'], operator = predicate.operator as KJAgentCapabilityCandidatePredicate['operator']
      const resolvedSource = source(predicate.source, 'Resolved candidate predicate source')
      if (!pathFacts[resolvedSource.path].includes(fact) || !operatorsByFact[fact].includes(operator)) return fail('Resolved candidate predicate fact, path and operator are incompatible')
      const compareTo = predicate.compareTo === undefined ? undefined : source(predicate.compareTo, 'Resolved candidate predicate comparison')
      if (compareTo && compareTo.scope === resolvedSource.scope) return fail('Resolved candidate comparisons must bind seed and related scopes')
      if (compareTo && compareTo.path !== resolvedSource.path) return fail('Resolved candidate comparisons must use the same evidence path')
      const hasValue = Object.hasOwn(predicate, 'value')
      if (hasValue && !(predicate.value === null || typeof predicate.value === 'string' || typeof predicate.value === 'boolean' || finite(predicate.value))) return fail('Resolved candidate predicate value must be a finite scalar')
      if (['equals', 'at_least', 'at_most'].includes(operator) !== hasValue || ['same_as', 'within'].includes(operator) !== (compareTo !== undefined)) return fail('Resolved candidate predicate has invalid value or comparison fields')
      if (['at_least', 'at_most'].includes(operator) && typeof predicate.value !== 'number') return fail('Resolved candidate numeric predicate requires a number')
      return {
        fact,
        source: resolvedSource,
        operator,
        ...(compareTo ? { compareTo } : {}),
        ...(predicate.relation === undefined ? {} : { relation: identifier(predicate.relation, 'Resolved candidate relation') }),
        ...(hasValue ? { value: predicate.value as JsonScalar } : {}),
      }
    })
    if (!Array.isArray(item.evidenceCodes) || item.evidenceCodes.length < 1 || item.evidenceCodes.length > 16) return fail('Resolved candidate evidence codes are invalid')
    const evidenceCodes = item.evidenceCodes.map(value => identifier(value, 'Resolved candidate evidence code'))
    if (new Set(evidenceCodes).size !== evidenceCodes.length) return fail('Resolved candidate evidence codes must be unique')
    if (!['always', 'when-ambiguous'].includes(String(item.confirmation))) return fail('Resolved candidate confirmation is unsupported')
    if (item.nonMatchPolicy !== undefined && item.nonMatchPolicy !== 'preserve') return fail('Resolved candidate nonMatchPolicy is unsupported')
    const candidateKind = identifier(item.candidateKind, 'Resolved candidate kind')
    if (entityTypes.some(type => type === 'HATCH' || type === 'INSERT') && item.confirmation !== 'always') return fail('Resolved HATCH and INSERT candidates require explicit confirmation')
    if (entityTypes.some(type => type === 'HATCH' || type === 'INSERT') && classifiesPatternAsNoiseOrBoundary(candidateKind)) return fail('Capability rules cannot classify HATCH or INSERT candidates as noise or boundary')
    if (predicates.some(predicate => predicate.fact === 'repeat-group')) {
      const scopedBy = (path: KJAgentCapabilityEvidenceSource['path']) => predicates.some(predicate => predicate.operator === 'same_as' && predicate.source.path === path)
      const contained = predicates.some(predicate => predicate.operator === 'within' && predicate.source.path === 'entities[].nativeReferences.displayExtent.bounds')
      if (!scopedBy('entities[].ownerId') || !scopedBy('entities[].layer.id') || !scopedBy('entities[].nativeReferences.insert.blockRecordId') || !contained) return fail('Resolved repeated candidates must bind exact block record, owner, layer and spatial containment')
    }
    return {
      id: identifier(item.id, 'Resolved candidate rule id'),
      candidateKind,
      seed: { entityTypes }, predicates, evidenceCodes,
      ...(item.nonMatchPolicy === undefined ? {} : { nonMatchPolicy: item.nonMatchPolicy as 'preserve' }),
      confirmation: item.confirmation as 'always' | 'when-ambiguous',
      capabilityId: identifier(item.capabilityId, 'Resolved capability id'),
      capabilityVersion: exactVersion(item.capabilityVersion),
    } as ResolvedRule
  })
  const keys = result.map(rule => `${rule.capabilityId}\0${rule.capabilityVersion}\0${rule.id}`)
  if (new Set(keys).size !== keys.length) return fail('Resolved candidate rules must have unique provenance')
  return result.sort((a, b) => stableCompare(a.capabilityId, b.capabilityId) || stableCompare(a.capabilityVersion, b.capabilityVersion) || stableCompare(a.id, b.id))
}

interface TopologyEntity {
  id: string
  type: string
  ownerId: string
  layerId: string | null
  raw: Record<string, unknown>
}
interface TopologyView { documentId: string; revision: number; units: string; tolerance: number; entities: Map<string, TopologyEntity> }

function topologyView(value: unknown, expectedRevision: number, expectedTolerance: number, units: string, exactIds: readonly string[]): TopologyView {
  const item = plainRecord(value, 'Topology result')
  const documentId = boundedText(item.documentId, 'Topology documentId')
  if (item.revision !== expectedRevision) return fail('Topology revision does not match expectedRevision')
  if (item.units !== units) return fail('Topology units do not match requested units')
  if (item.coordinateSpace !== 'owner-local' || item.semanticInference !== 'none') return fail('Candidate evaluation requires exact owner-local topology without semantic inference')
  if (!finite(item.tolerance) || item.tolerance !== expectedTolerance) return fail('Topology tolerance does not match expectedTolerance')
  if (!Array.isArray(item.entities) || item.entities.length > MAX_IDS) return fail('Topology entities are invalid')
  const entities = new Map<string, TopologyEntity>()
  for (const raw of item.entities) {
    const entity = plainRecord(raw, 'Topology entity')
    const id = boundedText(entity.id, 'Topology entity id'), type = boundedText(entity.type, 'Topology entity type', 64), ownerId = boundedText(entity.ownerId, 'Topology entity ownerId')
    const layer = plainRecord(entity.layer, 'Topology entity layer')
    if (!(layer.id === null || typeof layer.id === 'string' && layer.id.length > 0 && layer.id.length <= 256)) return fail('Topology entity layer id is invalid')
    if (entities.has(id)) return fail('Topology entity IDs must be unique')
    entities.set(id, { id, type, ownerId, layerId: layer.id as string | null, raw: entity })
  }
  const actual = [...entities.keys()].sort()
  if (actual.length !== exactIds.length || actual.some((id, index) => id !== exactIds[index])) return fail('Topology entity IDs must exactly match seedIds and relatedIds')
  return { documentId, revision: expectedRevision, units, tolerance: item.tolerance, entities }
}

type EvidenceValue = { kind: 'scalar'; value: JsonScalar } | { kind: 'bounds'; value: Bounds } | { kind: 'references'; value: readonly Record<string, unknown>[] }

function recordAt(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function boundsAt(value: unknown): Bounds | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite)) return null
  const result = value as unknown as Bounds
  return result[0] <= result[2] && result[1] <= result[3] ? result : null
}
function nativeReferences(entity: TopologyEntity): Record<string, unknown> | null { return recordAt(entity.raw.nativeReferences) }

// This switch is the evaluator's complete evidence language. Never traverse a manifest-supplied path dynamically.
function resolveEvidence(entity: TopologyEntity, path: KJAgentCapabilityEvidenceSource['path']): EvidenceValue | null {
  if (path === 'entities[].ownerId') return { kind: 'scalar', value: entity.ownerId }
  if (path === 'entities[].layer.id') return { kind: 'scalar', value: entity.layerId }
  const native = nativeReferences(entity)
  if (path === 'entities[].nativeReferences.displayExtent.bounds') {
    const extent = recordAt(native?.displayExtent)
    if (!extent || extent.status !== 'complete') return null
    const bounds = boundsAt(extent.bounds)
    return bounds ? { kind: 'bounds', value: bounds } : fail('Topology contains malformed complete display bounds')
  }
  if (path === 'entities[].nativeReferences.hatch.loops[].boundarySources') {
    const hatch = recordAt(native?.hatch)
    if (!hatch || !Array.isArray(hatch.loops)) return null
    const references: Record<string, unknown>[] = []
    for (const rawLoop of hatch.loops) {
      const loop = recordAt(rawLoop)
      if (!loop || !Array.isArray(loop.boundarySources)) return fail('Topology contains malformed HATCH boundary sources')
      for (const rawReference of loop.boundarySources) {
        const reference = recordAt(rawReference)
        if (!reference) return fail('Topology contains malformed HATCH boundary source')
        references.push(reference)
      }
    }
    return { kind: 'references', value: references }
  }
  const insert = recordAt(native?.insert)
  if (!insert || insert.status !== 'matched') return null
  if (path === 'entities[].nativeReferences.insert.blockRecordId') return typeof insert.blockRecordId === 'string' && insert.blockRecordId ? { kind: 'scalar', value: insert.blockRecordId } : null
  if (path === 'entities[].nativeReferences.insert.typeCountSignature') return typeof insert.typeCountSignature === 'string' && insert.typeCountSignature ? { kind: 'scalar', value: insert.typeCountSignature } : null
  if (path === 'entities[].nativeReferences.insert.repeat.sameDefinitionInstanceCount') {
    const repeat = recordAt(insert.repeat), count = repeat?.sameDefinitionInstanceCount
    return Number.isSafeInteger(count) && (count as number) >= 0 ? { kind: 'scalar', value: count as number } : null
  }
  return null
}

function equalScalar(left: JsonScalar, right: JsonScalar): boolean {
  return typeof left === typeof right && (typeof left !== 'number' || typeof right !== 'number' ? left === right : left === right || Object.is(left, -0) && Object.is(right, 0) || Object.is(left, 0) && Object.is(right, -0))
}
function summary(value: EvidenceValue | null): Readonly<Record<string, unknown>> {
  if (!value) return { status: 'unavailable' }
  if (value.kind === 'scalar') return { status: 'available', value: value.value }
  if (value.kind === 'bounds') return { status: 'available', bounds: [...value.value] }
  const statuses: Record<string, number> = {}
  for (const reference of value.value) { const status = typeof reference.status === 'string' ? reference.status : 'invalid'; statuses[status] = (statuses[status] ?? 0) + 1 }
  return { status: 'available', count: value.value.length, statuses: Object.fromEntries(Object.entries(statuses).sort(([a], [b]) => stableCompare(a, b))) }
}

function evaluatePredicate(predicate: ReadonlyDeep<KJAgentCapabilityCandidatePredicate>, seed: TopologyEntity, related: TopologyEntity | undefined, tolerance: number): { passed: boolean; observed: Readonly<Record<string, unknown>> } {
  const entityFor = (scope: 'seed' | 'related'): TopologyEntity | undefined => scope === 'seed' ? seed : related
  const sourceEntity = entityFor(predicate.source.scope)
  if (!sourceEntity) return { passed: false, observed: { source: { status: 'unavailable' } } }
  const left = resolveEvidence(sourceEntity, predicate.source.path)
  const rightEntity = predicate.compareTo ? entityFor(predicate.compareTo.scope) : undefined
  const right = predicate.compareTo && rightEntity ? resolveEvidence(rightEntity, predicate.compareTo.path) : null
  let passed = false
  if (predicate.operator === 'exists') passed = !!left && (left.kind !== 'scalar' || left.value !== null) && (left.kind !== 'references' || left.value.length > 0)
  else if (predicate.operator === 'equals') passed = !!left && left.kind === 'scalar' && Object.hasOwn(predicate, 'value') && equalScalar(left.value, predicate.value as JsonScalar)
  else if (predicate.operator === 'at_least') passed = !!left && left.kind === 'scalar' && typeof left.value === 'number' && typeof predicate.value === 'number' && left.value >= predicate.value
  else if (predicate.operator === 'at_most') passed = !!left && left.kind === 'scalar' && typeof left.value === 'number' && typeof predicate.value === 'number' && left.value <= predicate.value
  else if (predicate.operator === 'all_resolved') passed = !!left && left.kind === 'references' && left.value.length > 0 && left.value.every(reference => reference.source === 'native' && reference.status === 'matched' && typeof reference.entityId === 'string' && !!reference.entityId && typeof reference.type === 'string' && !!reference.type)
  else if (predicate.operator === 'same_as') passed = !!left && !!right && left.kind === right.kind && (left.kind === 'scalar' && right.kind === 'scalar' ? equalScalar(left.value, right.value) : left.kind === 'bounds' && right.kind === 'bounds' && left.value.every((value, index) => value === right.value[index]))
  else if (predicate.operator === 'within') {
    // Owner-local bounds from different owners are not comparable even if their numbers overlap.
    if (left?.kind === 'bounds' && right?.kind === 'bounds' && rightEntity && sourceEntity.ownerId === rightEntity.ownerId) {
      passed = right.value[0] - tolerance <= left.value[0] && right.value[1] - tolerance <= left.value[1] && left.value[2] <= right.value[2] + tolerance && left.value[3] <= right.value[3] + tolerance
    }
  }
  return { passed, observed: { source: summary(left), ...(predicate.compareTo ? { compareTo: summary(right) } : {}) } }
}

/** Evaluate locked declarative candidate rules against one exact topology query. This function never edits a document. */
export function evaluateAgentCapabilityCandidates(input: KJAgentCapabilityCandidateEvaluationInput): ReadonlyDeep<KJAgentCapabilityCandidateEvaluation> {
  const detached = exactRecord(safeJsonSnapshot(input), ['candidateRules', 'topology', 'expectedRevision', 'expectedTolerance', 'units', 'seedIds', 'relatedIds', 'maxBytes'], 'Candidate evaluation')
  if (!Number.isSafeInteger(detached.expectedRevision) || (detached.expectedRevision as number) < 0) return fail('Candidate expectedRevision must be a nonnegative safe integer')
  if (!finite(detached.expectedTolerance) || (detached.expectedTolerance as number) <= 0 || (detached.expectedTolerance as number) > 1) return fail('Candidate expectedTolerance must be greater than zero and at most 1 drawing unit')
  const expectedRevision = detached.expectedRevision as number, expectedTolerance = detached.expectedTolerance as number, units = boundedText(detached.units, 'Candidate units', 64)
  if (!Number.isSafeInteger(detached.maxBytes) || (detached.maxBytes as number) < 1024 || (detached.maxBytes as number) > 262144) return fail('Candidate maxBytes must be an integer from 1024 through 262144')
  const maxBytes = detached.maxBytes as number, seedIds = ids(detached.seedIds, 'Candidate seedIds', 1), relatedIds = ids(detached.relatedIds, 'Candidate relatedIds', 0)
  if (seedIds.length + relatedIds.length > MAX_IDS || seedIds.some(id => relatedIds.includes(id))) return fail('Candidate seedIds and relatedIds must be disjoint and contain at most 64 total IDs')
  const rules = validateRules(detached.candidateRules), exactIds = [...seedIds, ...relatedIds].sort(), topology = topologyView(detached.topology, expectedRevision, expectedTolerance, units, exactIds)
  let evaluations = 0
  const bump = (): void => { if (++evaluations > MAX_EVALUATIONS) fail(`Candidate predicate evaluation budget exceeded (${MAX_EVALUATIONS})`) }
  const candidates: KJAgentCapabilityCandidate[] = [], evidence: KJAgentCapabilityCandidateEvidence[] = []
  for (const rule of rules) for (const seedId of seedIds) {
    const seed = topology.entities.get(seedId)!
    if (!rule.seed.entityTypes.includes(seed.type)) continue
    const unary = rule.predicates.map((predicate, predicateIndex) => ({ predicate, predicateIndex })).filter(({ predicate }) => predicate.source.scope === 'seed' && !predicate.compareTo)
    const paired = rule.predicates.map((predicate, predicateIndex) => ({ predicate, predicateIndex })).filter(({ predicate }) => !(predicate.source.scope === 'seed' && !predicate.compareTo))
    const predicateEvidence: KJAgentCapabilityPredicateEvidence[] = []
    let unaryPassed = true
    for (const { predicate, predicateIndex } of unary) {
      bump(); const result = evaluatePredicate(predicate, seed, undefined, topology.tolerance)
      unaryPassed = unaryPassed && result.passed
      predicateEvidence.push({ predicateIndex, fact: predicate.fact, operator: predicate.operator, source: predicate.source, ...(predicate.compareTo ? { compareTo: predicate.compareTo } : {}), ...(predicate.relation ? { relation: predicate.relation } : {}), passed: result.passed, observed: result.observed })
    }
    let matchingRelatedIds = [...relatedIds]
    for (const { predicate, predicateIndex } of paired) {
      const matching: string[] = [], nonMatching: string[] = []
      for (const relatedId of relatedIds) {
        bump(); const result = evaluatePredicate(predicate, seed, topology.entities.get(relatedId)!, topology.tolerance)
        ;(result.passed ? matching : nonMatching).push(relatedId)
      }
      matchingRelatedIds = matchingRelatedIds.filter(id => matching.includes(id))
      predicateEvidence.push({ predicateIndex, fact: predicate.fact, operator: predicate.operator, source: predicate.source, ...(predicate.compareTo ? { compareTo: predicate.compareTo } : {}), ...(predicate.relation ? { relation: predicate.relation } : {}), passed: matching.length > 0, matchingRelatedIds: matching, nonMatchingIds: nonMatching })
    }
    predicateEvidence.sort((a, b) => a.predicateIndex - b.predicateIndex)
    const passed = unaryPassed && (paired.length === 0 || matchingRelatedIds.length > 0)
    evidence.push({ capabilityId: rule.capabilityId, capabilityVersion: rule.capabilityVersion, ruleId: rule.id, seedId, passed, predicates: predicateEvidence })
    if (passed) {
      const matchedIds = [seedId, ...(paired.length ? matchingRelatedIds : [])]
      if (matchedIds.some(id => ['HATCH', 'INSERT'].includes(topology.entities.get(id)!.type)) && classifiesPatternAsNoiseOrBoundary(rule.candidateKind)) return fail('Capability rules cannot classify HATCH or INSERT candidates as noise or boundary')
      candidates.push({ capabilityId: rule.capabilityId, capabilityVersion: rule.capabilityVersion, ruleId: rule.id, candidateKind: rule.candidateKind, seedIds: [seedId], relatedIds: paired.length ? matchingRelatedIds : [], evidenceCodes: [...rule.evidenceCodes], nonMatchingIds: paired.length ? relatedIds.filter(id => !matchingRelatedIds.includes(id)) : [...relatedIds], confirmationRequired: false })
    }
  }
  const candidateCountByRule = new Map<string, number>()
  for (const candidate of candidates) { const key = `${candidate.capabilityId}\0${candidate.capabilityVersion}\0${candidate.ruleId}`; candidateCountByRule.set(key, (candidateCountByRule.get(key) ?? 0) + 1) }
  for (const candidate of candidates) {
    const rule = rules.find(item => item.capabilityId === candidate.capabilityId && item.capabilityVersion === candidate.capabilityVersion && item.id === candidate.ruleId)!
    const entityIds = [...candidate.seedIds, ...candidate.relatedIds]
    const containsSemanticPattern = entityIds.some(id => ['HATCH', 'INSERT'].includes(topology.entities.get(id)!.type))
    const key = `${candidate.capabilityId}\0${candidate.capabilityVersion}\0${candidate.ruleId}`
    candidate.confirmationRequired = rule.confirmation === 'always' || containsSemanticPattern || (candidateCountByRule.get(key) ?? 0) !== 1 || candidate.relatedIds.length > 1
  }
  candidates.sort((a, b) => stableCompare(a.capabilityId, b.capabilityId) || stableCompare(a.capabilityVersion, b.capabilityVersion) || stableCompare(a.ruleId, b.ruleId) || stableCompare(a.seedIds[0], b.seedIds[0]))
  evidence.sort((a, b) => stableCompare(a.capabilityId, b.capabilityId) || stableCompare(a.capabilityVersion, b.capabilityVersion) || stableCompare(a.ruleId, b.ruleId) || stableCompare(a.seedId, b.seedId))
  const included = new Set(candidates.flatMap(candidate => [...candidate.seedIds, ...candidate.relatedIds]))
  const result: KJAgentCapabilityCandidateEvaluation = {
    documentId: topology.documentId, revision: topology.revision, units: topology.units,
    candidates, evidence, nonMatchingIds: exactIds.filter(id => !included.has(id)), confirmationRequired: candidates.some(candidate => candidate.confirmationRequired),
    limits: { maxRules: MAX_RULES, maxIds: MAX_IDS, maxEvaluations: MAX_EVALUATIONS, evaluations, maxBytes },
  }
  if (jsonBytes(result) > maxBytes) fail('Candidate evaluation result exceeds maxBytes; evaluate fewer rules or IDs')
  return deepFreeze(result)
}
