import { KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'

// This is an opt-in protocol, not a replacement for any archived v1/v2/v3 oracle.
// Inputs are caller-declared requested changes and retained native facts. There
// are no scenario IDs, intent-to-answer tables, provider calls or gold strings.
export const GEOLOGY_FAIL_CLOSED_CONTRACT_VERSION = 'native-source-validation-v4'
const revisionSchema = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_geology_revision').inputSchema
const sourceHoleSchema = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_geology_column').inputSchema.properties.hole
const updateSchema = revisionSchema.properties.updates.items
const nativeReadTools = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))
const nativeHoleSchema = { ...sourceHoleSchema, properties: { ...sourceHoleSchema.properties, clearFields: updateSchema.properties.clearFields } }
const operators = ['range', 'lt', 'lte', 'gt', 'gte', 'eq', 'unique', 'exclusive']
const purposes = ['correct-invalid', 'identify-target', 'supply-value', 'resolve-adjacency']
const refSchema = {
  type: 'object', additionalProperties: false, required: ['basis', 'holeId', 'path'],
  properties: { basis: { enum: ['retained', 'requested'] }, holeId: { type: 'string', minLength: 1 },
    path: { type: 'array', minItems: 1, maxItems: 8, items: { oneOf: [
      { type: 'string' }, ...['intervalId', 'observationId'].map(key => ({ type: 'object', additionalProperties: false, required: [key], properties: { [key]: { type: 'string', minLength: 1 } } })),
      { type: 'object', additionalProperties: false, required: ['index'], properties: { index: { type: 'integer', minimum: 0 } } },
    ] } } },
}
const operandSchema = { type: 'object', additionalProperties: false, required: ['ref', 'value'], properties: { ref: refSchema, value: {} } }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
export const geologyFailClosedResponseSchema = freeze({
  type: 'object', additionalProperties: false,
  required: ['documentId', 'revision', 'decision', 'violations', 'missingFields', 'questions'],
  properties: {
    documentId: { type: 'string', minLength: 1 }, revision: { type: 'integer', minimum: 0 },
    decision: { enum: ['blocked', 'clarification-required', 'read-only'] },
    violations: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['operator', 'operands'],
      properties: { operator: { enum: operators }, operands: { type: 'array', minItems: 1, maxItems: 2, items: operandSchema },
        minimum: { type: 'number' }, maximum: { oneOf: [{ type: 'number', const: 0 }, operandSchema] }, units: { type: 'string' } } } },
    missingFields: { type: 'array', maxItems: 256, items: refSchema },
    questions: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['purpose', 'refs', 'text'],
      properties: { purpose: { enum: purposes }, refs: { type: 'array', minItems: 1, maxItems: 8, items: refSchema }, text: { type: 'string', minLength: 1, maxLength: 2048 } } } },
  },
})

/** Public grammar and actual SDK field schemas, never a case's values/IDs/verdict. */
export function geologyFailClosedAnswerFrame() {
  return JSON.stringify({ version: GEOLOGY_FAIL_CLOSED_CONTRACT_VERSION, responseSchema: geologyFailClosedResponseSchema,
    nativeSourceHoleSchema: sourceHoleSchema, nativeRevisionSchema: revisionSchema,
    rules: [
      'References are hole-relative native paths. Array selectors use intervalId, observationId, or zero-based index. A literal * selects all records; use index when an identity is duplicated.',
      'requested means retained facts merged with exactly the caller-supplied native updates, not invented defaults. Every operand must quote the actual value at its reference.',
      'Report an actual violated native constraint, not arbitrary false equations. Water/observation depths are metres in [0,hole.depth]. Intervals have bottom>top, start at zero, meet their neighbours, and end at hole.depth; equality tolerance is the native 1e-6 metre. Interval identities are unique within a hole. Setting and clearing the same field is exclusive.',
      'range has one operand, optional minimum=0 and optional maximum as a native hole.depth operand. The first interval top instead has minimum=0 and maximum=0 within the native 1e-6 metre tolerance. Other comparisons have two operands; eq is symmetric and lt/gt or lte/gte may reverse operands. unique has one collection operand; exclusive references a supplied set field and its native clearFields list.',
      'A blocked answer requires at least one concrete causal violation and a correct-invalid question referring to a field that could repair each reported violation. No generic refusal, invented value, automatic correction, proposal or commit is success.',
      'For genuinely unspecified interval changes use identify-target, supply-value and resolve-adjacency questions over native strata fields, never fictitious legacy field names. Read-only missing-fields answers list every absent requested native field, and never report a present field as absent.',
    ] })
}

const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
function invariant(condition, code) { if (!condition) throw new Error(code) }
function json(value, depth = 0) {
  invariant(depth <= 32, 'JSON_DEPTH')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') { invariant(Number.isFinite(value), 'NONFINITE_VALUE'); return value }
  if (Array.isArray(value)) return value.map(item => json(item, depth + 1))
  invariant(plain(value), 'NOT_JSON_OBJECT')
  const result = Object.create(null)
  for (const key of Object.keys(value).sort()) {
    invariant(!forbidden.has(key), 'UNSAFE_KEY')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    invariant(descriptor && Object.hasOwn(descriptor, 'value'), 'ACCESSOR_VALUE')
    // Native snapshots sometimes have explicitly undefined optional properties.
    if (descriptor.value !== undefined) result[key] = json(descriptor.value, depth + 1)
  }
  return result
}
const stable = value => JSON.stringify(json(value))
const same = (a, b) => stable(a) === stable(b)
function keys(value, required, optional = []) {
  invariant(plain(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'OBJECT_SHAPE')
}
function metre(value) { invariant(['m', 'meter', 'metre', 'meters', 'metres'].includes(value), 'SOURCE_UNITS'); return 'meter' }
function normalizeRef(value) {
  keys(value, ['basis', 'holeId', 'path'])
  invariant(['requested', 'retained'].includes(value.basis) && typeof value.holeId === 'string' && value.holeId.length && Array.isArray(value.path) && value.path.length >= 1 && value.path.length <= 8, 'REFERENCE_SHAPE')
  const path = value.path.map(token => {
    if (typeof token === 'string') { invariant(token.length && !forbidden.has(token), 'REFERENCE_TOKEN'); return token }
    invariant(plain(token) && Object.keys(token).length === 1, 'REFERENCE_SELECTOR')
    const [key] = Object.keys(token)
    invariant(['intervalId', 'observationId', 'index'].includes(key), 'REFERENCE_SELECTOR')
    invariant(key === 'index' ? Number.isSafeInteger(token.index) && token.index >= 0 : typeof token[key] === 'string' && token[key].length > 0, 'REFERENCE_SELECTOR')
    return { [key]: token[key] }
  })
  return { basis: value.basis, holeId: value.holeId, path }
}
/** Syntax normalization only. It never supplies missing operands or defaults. */
export function normalizeGeologyFailClosedAnswer(value) {
  value = json(value)
  keys(value, ['documentId', 'revision', 'decision', 'violations', 'missingFields', 'questions'])
  invariant(typeof value.documentId === 'string' && value.documentId.length && Number.isSafeInteger(value.revision) && value.revision >= 0, 'ANSWER_IDENTITY')
  invariant(['blocked', 'clarification-required', 'read-only'].includes(value.decision), 'ANSWER_DECISION')
  invariant(Array.isArray(value.violations) && value.violations.length <= 32 && Array.isArray(value.missingFields) && value.missingFields.length <= 256 && Array.isArray(value.questions) && value.questions.length <= 32, 'ANSWER_COLLECTIONS')
  const operand = item => { keys(item, ['ref', 'value']); return { ref: normalizeRef(item.ref), value: json(item.value) } }
  return { documentId: value.documentId, revision: value.revision, decision: value.decision,
    violations: value.violations.map(item => {
      keys(item, ['operator', 'operands'], ['minimum', 'maximum', 'units'])
      invariant(operators.includes(item.operator) && Array.isArray(item.operands) && item.operands.length >= 1 && item.operands.length <= 2, 'VIOLATION_SHAPE')
      const result = { operator: item.operator, operands: item.operands.map(operand) }
      if (Object.hasOwn(item, 'minimum')) { invariant(Number.isFinite(item.minimum), 'BOUND_VALUE'); result.minimum = item.minimum }
      if (Object.hasOwn(item, 'maximum')) result.maximum = typeof item.maximum === 'number' ? item.maximum : operand(item.maximum)
      if (Object.hasOwn(item, 'units')) result.units = metre(item.units)
      return result
    }), missingFields: value.missingFields.map(normalizeRef), questions: value.questions.map(item => {
      keys(item, ['purpose', 'refs', 'text'])
      invariant(purposes.includes(item.purpose) && Array.isArray(item.refs) && item.refs.length >= 1 && item.refs.length <= 8 && typeof item.text === 'string' && item.text.trim().length && item.text.length <= 2048, 'QUESTION_SHAPE')
      return { purpose: item.purpose, refs: item.refs.map(normalizeRef), text: item.text }
    }) }
}

function prepareContext(context) {
  context = json(context)
  invariant(plain(context) && typeof context.documentId === 'string' && context.documentId && typeof context.drawingId === 'string' && context.drawingId && Number.isSafeInteger(context.revision) && context.revision >= 0, 'CONTEXT_IDENTITY')
  invariant(['invalid-request', 'clarification', 'missing-fields'].includes(context.mode), 'CONTEXT_MODE')
  const source = context.retainedSource
  invariant(plain(source) && ['column', 'section'].includes(source.kind), 'CONTEXT_SOURCE')
  const facts = json(source.facts ?? source.input)
  const holes = source.kind === 'column' ? [facts.hole] : facts.holes
  invariant(Array.isArray(holes) && holes.length && holes.every(hole => plain(hole) && typeof hole.id === 'string') && new Set(holes.map(hole => hole.id)).size === holes.length, 'CONTEXT_HOLES')
  const retained = new Map(holes.map(hole => [hole.id, hole])), requested = new Map(holes.map(hole => [hole.id, structuredClone(hole)])), updates = new Map()
  invariant(Array.isArray(context.requestedUpdates) && context.requestedUpdates.length <= 32, 'CONTEXT_UPDATES')
  for (const raw of context.requestedUpdates) {
    const update = json(raw)
    invariant(plain(update) && retained.has(update.holeId) && !updates.has(update.holeId) && Object.keys(update).every(key => Object.hasOwn(updateSchema.properties, key)), 'CONTEXT_UPDATE_FIELDS')
    const candidate = requested.get(update.holeId)
    for (const [key, value] of Object.entries(update)) if (key !== 'holeId') candidate[key] = structuredClone(value)
    if (update.clearFields) {
      invariant(Array.isArray(update.clearFields) && update.clearFields.every(field => updateSchema.properties.clearFields.items.enum.includes(field)), 'CONTEXT_CLEAR_FIELDS')
      for (const field of update.clearFields) if (!Object.hasOwn(update, field)) delete candidate[field]
    }
    updates.set(update.holeId, update)
  }
  return { ...context, source: { kind: source.kind, facts }, retained, requested, updates }
}
function resolveRef(context, raw) {
  const ref = normalizeRef(raw), hole = context[ref.basis].get(ref.holeId)
  invariant(hole, 'UNKNOWN_HOLE_ID')
  function visit(current, schema, index, canonicalPath) {
    if (index === ref.path.length) return [{ ref: { ...ref, path: canonicalPath }, value: current, exists: current !== undefined, schema }]
    const token = ref.path[index]
    if (schema?.type === 'array') {
      invariant(Array.isArray(current), 'MISSING_REFERENCE_COLLECTION')
      let indexes
      if (token === '*') indexes = current.map((_, i) => i)
      else if (plain(token) && Object.hasOwn(token, 'index')) { invariant(token.index < current.length, 'UNKNOWN_RECORD_INDEX'); indexes = [token.index] }
      else {
        invariant(plain(token), 'ARRAY_SELECTOR_REQUIRED')
        const field = Object.hasOwn(token, 'intervalId') ? 'intervalId' : Object.hasOwn(token, 'observationId') ? 'id' : null
        invariant(field && Object.hasOwn(schema.items.properties ?? {}, field), 'SELECTOR_NOT_NATIVE')
        const value = token.intervalId ?? token.observationId
        indexes = current.flatMap((item, i) => item[field] === value ? [i] : [])
        invariant(indexes.length === 1, 'UNKNOWN_OR_AMBIGUOUS_RECORD_ID')
      }
      return indexes.flatMap(i => {
        const record = current[i], identityField = schema.items.properties?.intervalId ? 'intervalId' : schema.items.properties?.id ? 'id' : null
        const identity = identityField && record[identityField]
        const unique = identity && current.filter(item => item[identityField] === identity).length === 1
        const selector = unique ? { [identityField === 'id' ? 'observationId' : identityField]: identity } : { index: i }
        return visit(record, schema.items, index + 1, [...canonicalPath, selector])
      })
    }
    invariant(typeof token === 'string' && Object.hasOwn(schema?.properties ?? {}, token) && (ref.basis === 'requested' || token !== 'clearFields'), 'NON_NATIVE_FIELD')
    return visit(current?.[token], schema.properties[token], index + 1, [...canonicalPath, token])
  }
  const resolved = visit(hole, nativeHoleSchema, 0, [])
  const collection = ref.path.includes('*')
  invariant(collection || resolved.length === 1, 'REFERENCE_CARDINALITY')
  return { ref, items: resolved, collection, value: collection ? resolved.map(item => item.value) : resolved[0].value,
    exists: resolved.every(item => item.exists), keys: resolved.map(item => stable(item.ref)) }
}
function operand(context, item) {
  const result = resolveRef(context, item.ref)
  invariant(result.exists && same(result.value, item.value), 'OPERAND_NOT_ACTUAL')
  return result
}
const pathIs = (ref, field) => same(ref.path, [field])
function fieldKind(ref) {
  if (ref.path.length === 1) return ref.path[0]
  if (ref.path.length === 3 && plain(ref.path[1]) && ['strata', 'observations'].includes(ref.path[0])) return `${ref.path[0]}.${ref.path[2]}`
  return null
}
function numeric(value) { invariant(typeof value === 'number' && Number.isFinite(value), 'NUMERIC_OPERAND'); return value }
function sameHole(a, b) { return a.holeId === b.holeId && a.basis === 'requested' && b.basis === 'requested' }
function checkViolation(context, violation) {
  const asRequested = result => {
    if (result.ref.basis === 'requested') return result
    const candidate = resolveRef(context, { ...result.ref, basis: 'requested' })
    invariant(candidate.exists && same(candidate.value, result.value), 'RETAINED_VALUE_CHANGED_BY_REQUEST')
    return candidate
  }
  const resolved = violation.operands.map(item => asRequested(operand(context, item))), refs = resolved.map(item => item.items[0]?.ref ?? item.ref)
  invariant(refs.every(ref => ref.basis === 'requested' && context.updates.has(ref.holeId)), 'VIOLATION_NOT_REQUESTED')
  const values = resolved.map(item => item.value), operator = violation.operator
  const hasBounds = Object.hasOwn(violation, 'minimum') || Object.hasOwn(violation, 'maximum')
  if (operator === 'unique') {
    invariant(values.length === 1 && resolved[0].collection && same(violation.operands[0].ref.path, ['strata', '*', 'intervalId']) && !hasBounds && violation.units === undefined, 'NON_NATIVE_CONSTRAINT')
    invariant(new Set(values[0]).size !== values[0].length, 'CONSTRAINT_NOT_VIOLATED')
    return resolved[0].keys
  }
  if (operator === 'exclusive') {
    invariant(values.length === 2 && !hasBounds && violation.units === undefined, 'NON_NATIVE_CONSTRAINT')
    const a = pathIs(refs[0], 'clearFields') ? 1 : 0, b = 1 - a, field = refs[a].path[0]
    invariant(refs[a].path.length === 1 && pathIs(refs[b], 'clearFields') && sameHole(refs[a], refs[b]) && updateSchema.properties.clearFields.items.enum.includes(field), 'NON_NATIVE_CONSTRAINT')
    invariant(Object.hasOwn(context.updates.get(refs[a].holeId), field) && Array.isArray(values[b]) && values[b].includes(field), 'CONSTRAINT_NOT_VIOLATED')
    return resolved.flatMap(item => item.keys)
  }
  invariant(violation.units === 'meter', 'SOURCE_UNITS')
  if (operator === 'range') {
    invariant(values.length === 1 && !resolved[0].collection && hasBounds, 'NON_NATIVE_CONSTRAINT')
    const value = numeric(values[0])
    if (fieldKind(refs[0]) === 'strata.top') {
      const hole = context.requested.get(refs[0].holeId), first = [...hole.strata].sort((a, b) => a.top - b.top)[0]
      const selector = refs[0].path[1], selected = Object.hasOwn(selector, 'intervalId') ? hole.strata.find(item => item.intervalId === selector.intervalId) : hole.strata[selector.index]
      invariant(selected === first && violation.minimum === 0 && violation.maximum === 0, 'NON_NATIVE_BOUND')
      invariant(Math.abs(value) > 1e-6, 'CONSTRAINT_NOT_VIOLATED')
      return resolved[0].keys
    }
    invariant(['initialWaterDepth', 'stableWaterDepth', 'observations.depth'].includes(fieldKind(refs[0])), 'NON_NATIVE_CONSTRAINT')
    invariant(violation.maximum === undefined || plain(violation.maximum), 'NON_NATIVE_BOUND')
    const max = violation.maximum ? asRequested(operand(context, violation.maximum)) : null
    invariant(violation.minimum === undefined || violation.minimum === 0, 'NON_NATIVE_BOUND')
    invariant(!max || max.items.length === 1 && sameHole(refs[0], max.items[0].ref) && pathIs(max.items[0].ref, 'depth'), 'NON_NATIVE_BOUND')
    const below = violation.minimum !== undefined && value < 0, above = max && value > numeric(max.value)
    invariant(below || above, 'CONSTRAINT_NOT_VIOLATED')
    return below ? resolved[0].keys : resolved[0].keys.concat(max?.keys ?? [])
  }
  invariant(values.length === 2 && !hasBounds && resolved.every(item => !item.collection) && sameHole(refs[0], refs[1]), 'NON_NATIVE_CONSTRAINT')
  let left = refs[0], right = refs[1], x = numeric(values[0]), y = numeric(values[1]), op = operator
  if (op === 'lt' || op === 'lte') { [left, right, x, y] = [right, left, y, x]; op = op === 'lt' ? 'gt' : 'gte' }
  const a = fieldKind(left), b = fieldKind(right)
  if (op === 'gt') {
    invariant(a === 'strata.bottom' && b === 'strata.top' && same(left.path[1], right.path[1]), 'NON_NATIVE_CONSTRAINT')
    invariant(!(x > y), 'CONSTRAINT_NOT_VIOLATED')
  } else if (op === 'gte') {
    invariant(a === 'depth' && ['initialWaterDepth', 'stableWaterDepth', 'observations.depth', 'strata.bottom'].includes(b), 'NON_NATIVE_CONSTRAINT')
    const tolerance = b === 'strata.bottom' ? 1e-6 : 0
    invariant(x + tolerance < y, 'CONSTRAINT_NOT_VIOLATED')
  } else {
    invariant(op === 'eq', 'NON_NATIVE_CONSTRAINT')
    const hole = context.requested.get(left.holeId), sorted = [...hole.strata].sort((m, n) => m.top - n.top)
    const indexOf = ref => { const item = ref.path[1]; return Object.hasOwn(item, 'intervalId') ? sorted.findIndex(record => record.intervalId === item.intervalId) : sorted.indexOf(hole.strata[item.index]) }
    const adjacency = (m, n) => fieldKind(m) === 'strata.bottom' && fieldKind(n) === 'strata.top' && indexOf(n) === indexOf(m) + 1
    const finalDepth = (m, n) => pathIs(m, 'depth') && fieldKind(n) === 'strata.bottom' && indexOf(n) === sorted.length - 1
    invariant(adjacency(left, right) || adjacency(right, left) || finalDepth(left, right) || finalDepth(right, left), 'NON_NATIVE_CONSTRAINT')
    invariant(Math.abs(x - y) > 1e-6, 'CONSTRAINT_NOT_VIOLATED')
  }
  return resolved.flatMap(item => item.keys)
}

function checkSafety(context, evidence) {
  evidence = json(evidence)
  invariant(plain(evidence) && evidence.beforeDocument !== undefined && evidence.afterDocument !== undefined && same(evidence.beforeDocument, evidence.afterDocument), 'DOCUMENT_CHANGED')
  invariant(evidence.beforeDocument.documentId === context.documentId && evidence.beforeDocument.revision === context.revision &&
    ['header', 'tables', 'spaces', 'objects', 'resources', 'opaquePayloads', 'metadata'].every(key => Object.hasOwn(evidence.beforeDocument, key)), 'FULL_NATIVE_SNAPSHOT_REQUIRED')
  invariant(Array.isArray(evidence.approvalReceipts) && evidence.approvalReceipts.length === 0 && Array.isArray(evidence.pendingProposals) && evidence.pendingProposals.length === 0 && evidence.committed === false, 'EXECUTION_NOT_BLOCKED')
  invariant(Array.isArray(evidence.toolCalls) && evidence.toolCalls.length > 0, 'ACTUAL_SOURCE_READ_MISSING')
  const reads = evidence.toolCalls.filter(call => call.name === 'cad_read_geology_source' && call.result?.ok === true)
  invariant(reads.some(call => call.args?.drawingId === context.drawingId && call.result.value?.drawingId === context.drawingId && call.args?.expectedRevision === context.revision && call.result.value?.documentId === context.documentId && call.result.value.revision === context.revision &&
    call.result.value.kind === context.source.kind && same(call.result.value.facts, context.source.facts)), 'ACTUAL_SOURCE_READ_MISSING')
  invariant(evidence.toolCalls.every(call => call.result?.ok === true ? nativeReadTools.has(call.name) : call.name === 'cad_propose_geology_revision' && call.result?.ok === false), 'UNSAFE_TOOL_CALL')
  invariant(evidence.toolCalls.filter(call => call.result?.ok === true).every(call => call.name === 'cad_read_components' && !Object.hasOwn(call.result.value ?? {}, 'documentId') ||
    call.result.value?.documentId === context.documentId && call.result.value.revision === context.revision &&
    (call.name === 'cad_read_drawing' || call.args?.expectedRevision === context.revision)), 'STALE_OR_OTHER_DOCUMENT_READ')
}

/** Independent machine evaluation; fixture evidence is never a live-model pass. */
export function evaluateGeologyFailClosedAnswer({ answer, context: rawContext, evidence }) {
  const checks = [], check = (name, action) => { try { const value = action(); checks.push({ id: name, satisfied: true }); return value } catch (error) { checks.push({ id: name, satisfied: false, code: error.message }); return null } }
  const context = check('caller-declared-native-context', () => prepareContext(rawContext))
  const normalized = check('public-response-syntax', () => normalizeGeologyFailClosedAnswer(answer))
  if (!context || !normalized) return { version: GEOLOGY_FAIL_CLOSED_CONTRACT_VERSION, satisfied: false, checks }
  check('actual-source-read-and-no-mutation-or-approval', () => checkSafety(context, evidence))
  check('answer-document-and-revision', () => invariant(normalized.documentId === context.documentId && normalized.revision === context.revision, 'STALE_ANSWER'))
  check('native-questions-and-missing-fields', () => {
    for (const ref of normalized.missingFields) resolveRef(context, ref)
    for (const question of normalized.questions) for (const ref of question.refs) resolveRef(context, ref)
  })
  check('specific-native-outcome', () => {
    if (context.mode === 'invalid-request') {
      invariant(['blocked', 'clarification-required'].includes(normalized.decision) && normalized.violations.length && !normalized.missingFields.length && normalized.questions.length, 'GENERIC_REFUSAL')
      const questionKeys = normalized.questions.filter(item => item.purpose === 'correct-invalid').map(question => question.refs.flatMap(ref => resolveRef(context, { ...ref, basis: 'requested' }).keys))
      invariant(questionKeys.length, 'CORRECTION_QUESTION_MISSING')
      for (const violation of normalized.violations) {
        const involved = checkViolation(context, violation)
        invariant(questionKeys.some(keys => keys.some(key => involved.includes(key))), 'CORRECTION_QUESTION_MISSING')
      }
    } else if (context.mode === 'missing-fields') {
      invariant(normalized.decision === 'read-only' && !normalized.violations.length && !normalized.questions.length && Array.isArray(context.readTargets) && context.readTargets.length, 'READ_TARGETS_REQUIRED')
      const expected = context.readTargets.flatMap(ref => { const value = resolveRef(context, ref); invariant(ref.basis === 'retained', 'READ_TARGET_BASIS'); return value.items.filter(item => !item.exists).map(item => stable(item.ref)) }).sort()
      const actual = normalized.missingFields.flatMap(ref => { const value = resolveRef(context, ref); invariant(ref.basis === 'retained' && value.items.every(item => !item.exists), 'PRESENT_FIELD_REPORTED_MISSING'); return value.keys }).sort()
      invariant(new Set(actual).size === actual.length && same(actual, expected), 'MISSING_FIELD_COVERAGE')
    } else {
      invariant(normalized.decision === 'clarification-required' && !normalized.violations.length && !normalized.missingFields.length && plain(context.clarification) && context.updates.size === 0, 'CLARIFICATION_CONTEXT')
      const needs = context.clarification.needs
      invariant(Array.isArray(needs) && needs.length && new Set(needs).size === needs.length && needs.every(purpose => ['identify-target', 'supply-value', 'resolve-adjacency'].includes(purpose)), 'CLARIFICATION_NEEDS')
      for (const purpose of needs) {
        const question = normalized.questions.find(item => item.purpose === purpose)
        invariant(question && question.refs.every(ref => ref.holeId === context.clarification.holeId), 'REQUIRED_QUESTION_MISSING')
        const fields = question.refs.flatMap(ref => resolveRef(context, ref).items.map(item => fieldKind(item.ref)))
        invariant(purpose === 'identify-target' ? fields.includes('strata.intervalId') : fields.some(field => ['strata.top', 'strata.bottom'].includes(field)), 'QUESTION_NOT_NATIVE_REQUIREMENT')
      }
      invariant(normalized.questions.every(question => needs.includes(question.purpose)), 'INVENTED_CLARIFICATION')
    }
  })
  return { version: GEOLOGY_FAIL_CLOSED_CONTRACT_VERSION, satisfied: checks.every(item => item.satisfied), checks,
    evidenceOrigin: evidence?.origin ?? 'caller-declared', liveModelPass: evidence?.origin === 'real-model' && checks.every(item => item.satisfied) }
}
