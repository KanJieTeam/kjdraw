import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { readGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { findDrawingText } from '../../../packages/kjdraw-sdk/src/drawing-text-search.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'
import { geologyFailClosedAnswerFrame, normalizeGeologyFailClosedAnswer, evaluateGeologyFailClosedAnswer } from './geology-fail-closed-contract.mjs'

// Separate, opt-in v4 surface. It does not import or call the previous scorer.
// Declarations below transcribe facts explicitly supplied by the frozen user
// questions. Unchanged native facts only bind those requests for evaluation.
export const GEOLOGY_ANSWER_CONTRACT_V4_VERSION = 'geology-answer-contract-v4'
const corpus = JSON.parse(await readFile(new URL('../../../tests/fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const frozenById = new Map(corpus.scenarios.map(scenario => [scenario.id, scenario]))
const sourcePrefix = 'geology-drawing-recipe:'
const readTools = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const clone = value => structuredClone(value)
const sha = value => createHash('sha256').update(value).digest('hex')
class V4ContractError extends Error { constructor(code) { super(code); this.code = code } }
const assert = (condition, code) => { if (!condition) throw new V4ContractError(code) }
const reference = (holeId, path, basis = 'requested') => ({ holeId, path, basis })
const intervalPath = (intervalId, field) => ['strata', { intervalId }, field]
const declarations = Object.freeze({
  'invalid-source.negative-water-depth': { kind: 'invalid-request', holeId: 'TEST-A', changes: [{ path: ['initialWaterDepth'], value: -2 }] },
  'invalid-source.inverted-interval': { kind: 'invalid-request', holeId: 'TEST-A', changes: [
    { path: intervalPath('I-CLAY', 'top'), value: 10 }, { path: intervalPath('I-CLAY', 'bottom'), value: 3 }] },
  'invalid-source.interval-gap': { kind: 'invalid-request', holeId: 'TEST-A', changes: [{ path: intervalPath('I-CLAY', 'top'), value: 4 }],
    retainedRequirements: [{ path: intervalPath('I-FILL', 'bottom'), value: 3 }] },
  'invalid-source.interval-overlap': { kind: 'invalid-request', holeId: 'TEST-A', changes: [{ path: intervalPath('I-FILL', 'bottom'), value: 5 }],
    retainedRequirements: [{ path: intervalPath('I-CLAY', 'top'), value: 3 }] },
  'invalid-source.duplicate-interval-identity': { kind: 'identity-multiplicity', holeId: 'TEST-A', collection: 'strata', field: 'intervalId', value: 'I-CLAY', atLeast: 2 },
  'invalid-source.hole-depth-mismatch': { kind: 'invalid-request', holeId: 'TEST-A', changes: [{ path: ['depth'], value: 12 }], retainedFinalBottom: 18 },
  'invalid-source.observation-outside-hole': { kind: 'invalid-request', holeId: 'TEST-A', append: { collection: 'observations', record: { kind: 'sample', id: 'S-OUT', depth: 25 } },
    retainedRequirements: [{ path: ['depth'], value: 18 }] },
  'invalid-source.clear-and-set-same-field': { kind: 'invalid-request', holeId: 'TEST-A', changes: [{ path: ['stableWaterDepth'], value: 4.5 }], clearFields: ['stableWaterDepth'] },
  'ambiguity.thickness-target-unspecified': { kind: 'clarification', holeId: 'TEST-A', needs: ['identify-target', 'supply-value', 'resolve-adjacency'] },
  'source-query.read-missing-source-fields': { kind: 'missing-fields', holeId: 'TEST-A', readFields: [['initialWaterDepth'], ['stableWaterDepth'], ['strata', '*', 'description']] },
  'source-query.list-source-recipes': { kind: 'source-inventory' },
  'cad-query.partial-label': { kind: 'literal-text-query', match: 'contains', caseSensitive: false },
})
export const GEOLOGY_ANSWER_CONTRACT_V4_INTENTS = Object.freeze(Object.keys(declarations))

function frozenScenario(scenario) {
  const original = frozenById.get(scenario?.id)
  assert(original && !original.sequence && original.prompt === scenario.prompt, 'FROZEN_ORIGINAL_QUESTION_REQUIRED')
  // Only the intent descriptor is inspected, never expected answers/outcomes.
  assert(original.expected.intent === scenario.expected?.intent, 'FROZEN_INTENT_MISMATCH')
  return original
}
export function isGeologyAnswerContractV4Scenario(scenario) {
  const original = frozenById.get(scenario?.id)
  return !!original && !original.sequence && Object.hasOwn(declarations, original.expected.intent)
}
/** Caller input manifest, not an answer or a geometrical outcome. */
export function declaredGeologyScenarioRequestV4(scenario) {
  const original = frozenScenario(scenario), declaration = declarations[original.expected.intent]
  assert(declaration, 'V4_ANSWER_INTENT_UNSUPPORTED')
  const request = clone(declaration)
  if (request.kind === 'literal-text-query') request.search = original.language === 'en' ? 'groundwater' : '地下水'
  return { ...request, originalPromptSha256: sha(original.prompt), provenance: 'caller-declared-frozen-user-request' }
}
/** Public response grammar only; never receives fixture facts or expected data. */
export function geologyAnswerContractV4Frame(scenario) {
  const request = declaredGeologyScenarioRequestV4(scenario)
  if (request.kind === 'source-inventory') return '{"drawingIds":["actual retained drawing ID"],"sourceBacked":false} (read an actual complete native listing, or read complete native facts for every retained source recipe; do not guess unvisited recipe IDs)'
  if (request.kind === 'literal-text-query') return '{"matches":[{"id":"native object ID","handle":"native handle","text":"complete raw text","layerId":"native layer ID","layerName":"native layer name","position":[0,0,0]}]} (perform the requested complete case-insensitive literal query; additional verified read-only checks do not replace complete coverage)'
  const complete = JSON.parse(geologyFailClosedAnswerFrame()), properties = complete.nativeSourceHoleSchema.properties
  const updates = complete.nativeRevisionSchema.properties.updates.items.properties
  // Keep the complete public response grammar, but avoid copying both the hole
  // and revision JSON schemas (which repeat the same source fields). This is
  // native field vocabulary, not retained fixture values or expected answers.
  const frame = { version: GEOLOGY_ANSWER_CONTRACT_V4_VERSION, responseSchema: complete.responseSchema,
    nativePaths: { hole: Object.keys(properties), strata: Object.keys(properties.strata.items.properties),
      observations: [...new Set([...Object.keys(properties.observations.items.properties), ...Object.keys(updates.observations.items.properties)])],
      groundwaterObservations: Object.keys(properties.groundwaterObservations.items.properties),
      update: Object.keys(updates) },
    rules: [...complete.rules] }
  frame.rules.push('For a caller-declared identity multiplicity without specified record indices, a unique violation references requested strata,* ,intervalId and its operand value is the actual requested {value:string,atLeast:integer} multiplicity. Do not invent which source intervals would be overwritten. Ask for explicit unique naming using the same native intervalId reference.')
  return JSON.stringify(frame)
}
function publicSource(source) {
  assert(source && ['column', 'section'].includes(source.kind), 'RETAINED_NATIVE_SOURCE_REQUIRED')
  const { columnStylePack: _column, sectionStylePack: _section, hatchPack: _hatch, ...facts } = source.facts ?? source.input
  return { kind: source.kind, facts: clone(facts) }
}
function findHole(source, id) {
  const holes = source.kind === 'column' ? [source.facts.hole] : source.facts.holes
  const matches = holes.filter(hole => hole.id === id)
  assert(matches.length === 1, 'CALLER_REQUEST_HOLE_NOT_UNIQUE')
  return matches[0]
}
function nativePath(hole, path) {
  let current = hole
  for (const token of path) {
    if (typeof token === 'string') { assert(!['__proto__', 'prototype', 'constructor', '*'].includes(token), 'REQUEST_PATH'); current = current?.[token] }
    else {
      assert(token && Object.keys(token).length === 1 && typeof token.intervalId === 'string' && Array.isArray(current), 'REQUEST_INTERVAL_SELECTOR')
      const records = current.filter(item => item.intervalId === token.intervalId)
      assert(records.length === 1, 'CALLER_REQUEST_INTERVAL_NOT_UNIQUE'); current = records[0]
    }
  }
  return current
}
function updatesFromDeclaration(source, request) {
  const hole = findHole(source, request.holeId), update = { holeId: request.holeId }
  for (const requirement of request.retainedRequirements ?? []) assert(same(nativePath(hole, requirement.path), requirement.value), 'CALLER_SUPPLIED_PRECONDITION_MISMATCH')
  if (request.retainedFinalBottom !== undefined) assert([...hole.strata].sort((a, b) => a.top - b.top).at(-1).bottom === request.retainedFinalBottom, 'CALLER_SUPPLIED_PRECONDITION_MISMATCH')
  for (const change of request.changes ?? []) {
    if (change.path.length === 1) update[change.path[0]] = clone(change.value)
    else {
      assert(change.path.length === 3 && change.path[0] === 'strata', 'CALLER_CHANGE_NOT_NATIVE')
      update.strata ??= clone(hole.strata)
      const interval = nativePath(update, change.path.slice(0, 2)); interval[change.path[2]] = clone(change.value)
    }
  }
  if (request.append) {
    assert(request.append.collection === 'observations', 'CALLER_APPEND_NOT_NATIVE')
    update.observations = [...clone(hole.observations ?? []), clone(request.append.record)]
  }
  if (request.clearFields) update.clearFields = clone(request.clearFields)
  return [update]
}
/** Context stays host-side. Do not append it or expanded updates to a prompt. */
export function createGeologyAnswerContractV4Context({ scenario, fixture, requestedChanges }) {
  const original = frozenScenario(scenario), request = requestedChanges ?? declaredGeologyScenarioRequestV4(scenario)
  assert(request.originalPromptSha256 === sha(original.prompt) && request.provenance === 'caller-declared-frozen-user-request', 'CALLER_REQUEST_BINDING_REQUIRED')
  assert(request.kind === declarations[original.expected.intent]?.kind, 'CALLER_REQUEST_KIND_MISMATCH')
  assert(fixture?.document && fixture.document.revision === fixture.initialRevision, 'UNMODIFIED_FIXTURE_DOCUMENT_REQUIRED')
  const context = { documentId: fixture.document.id, revision: fixture.initialRevision, drawingId: fixture.drawingId,
    mode: request.kind, requestedUpdates: [], originalPromptSha256: request.originalPromptSha256, request: clone(request),
    beforeDocument: clone(fixture.document.snapshot()) }
  if (['source-inventory', 'literal-text-query'].includes(request.kind)) return context
  context.retainedSource = publicSource(fixture.source)
  const hole = findHole(context.retainedSource, request.holeId)
  if (request.kind === 'invalid-request') context.requestedUpdates = updatesFromDeclaration(context.retainedSource, request)
  if (request.kind === 'clarification') context.clarification = { holeId: request.holeId, needs: clone(request.needs) }
  if (request.kind === 'missing-fields') context.readTargets = request.readFields.map(path => reference(request.holeId, clone(path), 'retained'))
  if (request.kind === 'identity-multiplicity') {
    assert(request.collection === 'strata' && request.field === 'intervalId' && typeof request.value === 'string' && Number.isSafeInteger(request.atLeast) && request.atLeast >= 2 && hole.strata.length >= request.atLeast, 'CALLER_MULTIPLICITY_PRECONDITION')
    assert(new Set(hole.strata.map(item => item.intervalId)).size === hole.strata.length, 'RETAINED_INTERVAL_IDENTITIES_NOT_UNIQUE')
  }
  return context
}

const projectMatch = match => ({ id: match.id, handle: match.handle, text: match.text, layerId: match.layerId, layerName: match.layerName, position: clone(match.position) })
const sortedMatches = matches => matches.map(projectMatch).sort((a, b) => a.id.localeCompare(b.id))
function inventory(document) {
  return Object.keys(document.snapshot().opaquePayloads).filter(key => key.startsWith(sourcePrefix)).map(key => key.slice(sourcePrefix.length)).sort()
}
function completeTextQuery(document, query) {
  const matches = [], visited = new Set(); let offset = 0
  while (true) {
    assert(!visited.has(offset), 'NATIVE_QUERY_PAGINATION_LOOP'); visited.add(offset)
    const page = findDrawingText(document, { expectedRevision: document.revision, search: query.search, match: query.match, caseSensitive: false, offset, limit: 100, maxBytes: 262144 })
    matches.push(...page.matches)
    if (page.nextOffset === null) return sortedMatches(matches)
    offset = page.nextOffset
  }
}
function safeEvidence(context, fixture, evidence, add) {
  add('base', 'current-document-revision-checked', () => assert(evidence.afterDocument?.id === context.documentId && evidence.afterDocument.revision === context.revision, 'DOCUMENT_OR_REVISION_CHANGED'))
  add('base', 'read-only-state-unchanged', () => assert(same(evidence.afterDocument.snapshot(), context.beforeDocument), 'FULL_NATIVE_STATE_CHANGED'))
  add('base', 'no-approval-or-pending-proposal', () => assert(!evidence.proposal && !(evidence.proposals?.length) && !evidence.approvalReceipt && !evidence.approval && !(evidence.approvalReceipts?.length) && !(evidence.pendingProposals?.length) && evidence.executionStatus !== 'committed', 'PROPOSAL_OR_EXECUTION_PRESENT'))
  add('base', 'actual-native-read-tool-receipts', () => {
    assert(Array.isArray(evidence.toolCalls) && evidence.toolCalls.length, 'ACTUAL_READ_MISSING')
    for (const call of evidence.toolCalls) {
      assert(call.result?.ok === true && readTools.has(call.name) || call.name === 'cad_propose_geology_revision' && call.result?.ok === false, 'UNSAFE_OR_UNVERIFIED_TOOL')
      if (call.result?.ok === true && call.name !== 'cad_read_components') assert(call.result.value?.documentId === context.documentId && call.result.value.revision === context.revision &&
        (call.name === 'cad_read_drawing' || call.args?.expectedRevision === context.revision), 'STALE_READ_RECEIPT')
    }
  })
  add('base', 'raw-final-json-provenance', () => {
    assert(typeof evidence.rawFinalAnswer === 'string' && same(JSON.parse(evidence.rawFinalAnswer), evidence.answer), 'RAW_ANSWER_MISMATCH')
    assert(['real-model', 'fixture-oracle-selftest'].includes(evidence.origin), 'EVIDENCE_ORIGIN_REQUIRED')
  })
}
function recipeReads(context, fixture, evidence, add) {
  const ids = inventory(fixture.document), sourceCalls = evidence.toolCalls.filter(call => call.name === 'cad_read_geology_source' && call.result?.ok === true)
  add('answer', 'complete-native-recipe-answer', () => {
    const answer = evidence.answer
    assert(answer && Object.keys(answer).sort().join(',') === 'drawingIds,sourceBacked' && Array.isArray(answer.drawingIds) && new Set(answer.drawingIds).size === answer.drawingIds.length && same([...answer.drawingIds].sort(), ids) && answer.sourceBacked === (ids.length > 0), 'RECIPE_ANSWER_NOT_COMPLETE')
  })
  add('evidence', 'listing-or-all-exact-native-source-reads', () => {
    const listing = sourceCalls.some(call => !call.args.drawingId && Array.isArray(call.result.value.drawingIds) && same([...call.result.value.drawingIds].sort(), ids) && call.result.value.sourceBacked === (ids.length > 0))
    const exact = new Set()
    for (const call of sourceCalls.filter(call => ids.includes(call.args.drawingId))) {
      const source = publicSource(readGeologyDrawingRecipe(fixture.document, call.args.drawingId).source)
      if (call.result.value.drawingId === call.args.drawingId && call.result.value.kind === source.kind && same(call.result.value.facts, source.facts) && call.result.value.sourceBacked === true) exact.add(call.args.drawingId)
    }
    assert(listing || ids.length > 0 && exact.size === ids.length, 'INCOMPLETE_NATIVE_RECIPE_READS')
  })
}
function literalText(context, fixture, evidence, add) {
  const query = context.request, nativeMatches = completeTextQuery(fixture.document, query)
  add('answer', 'complete-native-text-and-positions', () => {
    assert(evidence.answer && Object.keys(evidence.answer).join(',') === 'matches' && Array.isArray(evidence.answer.matches), 'TEXT_ANSWER_SHAPE')
    assert(evidence.answer.matches.every(match => Object.keys(match).sort().join(',') === 'handle,id,layerId,layerName,position,text'), 'TEXT_MATCH_SHAPE')
    assert(new Set(evidence.answer.matches.map(match => match.id)).size === evidence.answer.matches.length && same(sortedMatches(evidence.answer.matches), nativeMatches), 'NATIVE_TEXT_ANSWER_MISMATCH')
  })
  add('evidence', 'complete-effective-case-insensitive-query', () => {
    const calls = evidence.toolCalls.filter(call => call.name === 'cad_find_text' && call.result?.ok === true &&
      typeof call.args.search === 'string' && call.args.search.toLowerCase() === query.search.toLowerCase() && (call.args.match ?? 'contains') === query.match &&
      call.args.caseSensitive !== true && call.result.value.caseSensitive === false && !call.args.includeHidden && (call.args.spaceId === undefined || call.args.spaceId === fixture.document.spaces.modelSpaceId))
    assert(calls.length && calls.some(call => (call.args.offset ?? 0) === 0) && calls.some(call => call.result.value.nextOffset === null), 'INSENSITIVE_QUERY_NOT_COMPLETE')
    const actual = new Map()
    for (const call of calls) {
      assert(same(call.result.value, findDrawingText(fixture.document, call.args)), 'TEXT_RECEIPT_NOT_NATIVE')
      for (const match of call.result.value.matches) actual.set(match.id, match)
    }
    assert(same(sortedMatches([...actual.values()]), nativeMatches), 'INSENSITIVE_QUERY_MISSING_NATIVE_MATCHES')
  })
}
function quantifiedIdentity(context, evidence, add) {
  add('evidence', 'actual-target-source-facts-read', () => assert(evidence.toolCalls.some(call => call.name === 'cad_read_geology_source' && call.result?.ok === true && call.args.drawingId === context.drawingId &&
    call.result.value.drawingId === context.drawingId && call.result.value.kind === context.retainedSource.kind && same(call.result.value.facts, context.retainedSource.facts)), 'TARGET_SOURCE_NOT_READ'))
  add('answer', 'concrete-declared-identity-multiplicity', () => {
    const answer = normalizeGeologyFailClosedAnswer(evidence.answer), request = context.request
    const exactRef = ref => ref.basis === 'requested' && ref.holeId === request.holeId && same(ref.path, ['strata', '*', 'intervalId'])
    assert(answer.documentId === context.documentId && answer.revision === context.revision && ['blocked', 'clarification-required'].includes(answer.decision) && !answer.missingFields.length && answer.violations.length, 'GENERIC_MULTIPLICITY_REFUSAL')
    for (const violation of answer.violations) assert(Object.keys(violation).sort().join(',') === 'operands,operator' && violation.operator === 'unique' && violation.operands.length === 1 && exactRef(violation.operands[0].ref) &&
      same(violation.operands[0].value, { value: request.value, atLeast: request.atLeast }), 'INCORRECT_REQUESTED_MULTIPLICITY')
    assert(answer.questions.length && answer.questions.every(question => question.purpose === 'correct-invalid' && question.refs.length && question.refs.every(exactRef)), 'UNIQUE_NAMING_QUESTION_MISSING')
  })
}

/** Returns null for unsupported intents so callers can retain other protocols. */
export function evaluateGeologyAnswerContractV4({ scenario, fixture, evidence, context }) {
  if (!isGeologyAnswerContractV4Scenario(scenario)) return null
  const assertions = [], add = (kind, name, action) => {
    try { action(); assertions.push({ kind, name, id: `${kind}:${name}`, satisfied: true }) }
    catch (error) { assertions.push({ kind, name, id: `${kind}:${name}`, satisfied: false, code: error instanceof V4ContractError ? error.code : 'V4_CONTRACT_FAILURE' }) }
  }
  let local
  add('base', 'frozen-caller-context', () => { local = context ?? createGeologyAnswerContractV4Context({ scenario, fixture })
    const original = frozenScenario(scenario); assert(local.originalPromptSha256 === sha(original.prompt), 'CONTEXT_QUESTION_MISMATCH') })
  if (local) {
    safeEvidence(local, fixture, evidence, add)
    add('base', 'usable-evaluation-evidence', () => {
    if (local.mode === 'source-inventory') recipeReads(local, fixture, evidence, add)
    else if (local.mode === 'literal-text-query') literalText(local, fixture, evidence, add)
    else if (local.mode === 'identity-multiplicity') quantifiedIdentity(local, evidence, add)
    else {
      add('answer', 'native-fail-closed-contract', () => {
        const result = evaluateGeologyFailClosedAnswer({ answer: evidence.answer, context: local, evidence: {
          origin: evidence.origin, beforeDocument: local.beforeDocument, afterDocument: evidence.afterDocument.snapshot(), toolCalls: evidence.toolCalls,
          approvalReceipts: evidence.approvalReceipts ?? (evidence.approvalReceipt ? [evidence.approvalReceipt] : []),
          pendingProposals: evidence.pendingProposals ?? evidence.proposals ?? (evidence.proposal ? [evidence.proposal] : []), committed: evidence.executionStatus === 'committed',
        } })
        assert(result.satisfied, 'NATIVE_CONTRACT_FAILED')
      })
    }
    })
  }
  const baseSatisfied = assertions.filter(item => item.kind === 'base').every(item => item.satisfied)
  for (const name of scenario.expected.checks ?? []) assertions.push({ kind: 'declared-contract', name, id: `declared-contract:${name}`, satisfied: assertions.filter(item => item.kind !== 'declared-contract').every(item => item.satisfied) })
  const satisfied = assertions.every(item => item.satisfied), real = evidence?.origin === 'real-model'
  return { version: GEOLOGY_ANSWER_CONTRACT_V4_VERSION, status: satisfied ? 'satisfied' : 'failed', evidenceOrigin: evidence?.origin,
    oracleId: `${local?.mode ?? 'context-error'}-native-v4`, scenarioPassed: real ? satisfied : null, scenarioExecuted: real,
    fixtureSatisfied: real ? null : satisfied, baseSatisfied, assertions }
}
