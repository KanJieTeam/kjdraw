import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologyColumn, compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import {
  GEOLOGY_FAIL_CLOSED_CONTRACT_VERSION, geologyFailClosedAnswerFrame, geologyFailClosedResponseSchema,
  normalizeGeologyFailClosedAnswer, evaluateGeologyFailClosedAnswer,
} from '../scripts/testing/helpers/geology-fail-closed-contract.mjs'

const clone = value => structuredClone(value)
async function fixture(missing = false) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const input = { expectedRevision: 0, units: 'millimeter', locale: 'en', hole: {
    id: 'PUBLIC-A', collarElevation: 106.5, depth: 18,
    ...(missing ? {} : { initialWaterDepth: 2, stableWaterDepth: 4 }),
    strata: [
      { intervalId: 'I-FILL', code: '1', name: 'Fill', lithology: 'fill', top: 0, bottom: 3 },
      { intervalId: 'I-CLAY', code: '2', name: 'Clay', lithology: 'clay', top: 3, bottom: 10 },
      { intervalId: 'I-SAND', code: '3', name: 'Sand', lithology: 'sand', top: 10, bottom: 18 },
    ], observations: [{ kind: 'sample', id: 'S-A', depth: 5 }, { kind: 'spt', id: 'N-A', depth: 12, value: 15 }],
  } }
  const source = { kind: 'column', input }, compiled = compileGeologyColumn(input)
  await sdk.executeCommand('CREATEBATCH', { ...clone(compiled.commandArgs), geologySource: source }, { document })
  await document.transact('Retained manual geometry', tx => tx.createEntity('CIRCLE', { center: [200, 200, 0], radius: 3 }, { id: 'manual-native' }))
  const session = new KJAgentToolSession(sdk, document), args = { expectedRevision: document.revision, drawingId: compiled.evidence.rootObjectId, maxBytes: 262144 }
  const result = await session.call('cad_read_geology_source', args)
  assert.equal(result.ok, true)
  const snapshot = JSON.parse(document.serialize())
  return { sdk, document, session, drawingId: args.drawingId, context: { documentId: document.id, drawingId: args.drawingId, revision: document.revision,
    mode: 'invalid-request', retainedSource: { kind: result.value.kind, facts: result.value.facts }, requestedUpdates: [] },
    evidence: { origin: 'fixture-oracle-selftest', beforeDocument: snapshot, afterDocument: clone(snapshot), committed: false,
      approvalReceipts: [], pendingProposals: [], toolCalls: [{ name: 'cad_read_geology_source', args, result }] } }
}
const normal = await fixture(), absent = await fixture(true)
function ref(path, basis = 'requested', holeId = 'PUBLIC-A') { return { basis, holeId, path } }
function item(path, value) { return { ref: ref(path), value } }
const field = name => ref([name]), stratum = (id, name) => ref(['strata', { intervalId: id }, name])
const allIntervals = ref(['strata', '*', 'intervalId'])
function output(f, violation, refs = violation?.operands.map(value => value.ref) ?? []) {
  return { documentId: f.context.documentId, revision: f.context.revision, decision: 'blocked', violations: violation ? [violation] : [], missingFields: [],
    questions: refs.length ? [{ purpose: 'correct-invalid', refs, text: 'Please provide corrected source facts for these referenced fields.' }] : [] }
}
function verdict(answer, context = normal.context, evidence = normal.evidence) { return evaluateGeologyFailClosedAnswer({ answer, context, evidence }) }
function succeeds(answer, context = normal.context, evidence = normal.evidence) { const result = verdict(answer, context, evidence); assert.equal(result.satisfied, true, JSON.stringify(result)); assert.equal(result.liveModelPass, false); return result }
function fails(answer, context = normal.context, evidence = normal.evidence) { const result = verdict(answer, context, evidence); assert.equal(result.satisfied, false, JSON.stringify(result)); return result }
function strataUpdate(change) { const strata = clone(normal.context.retainedSource.facts.hole.strata); change(strata); return [{ holeId: 'PUBLIC-A', strata }] }
const cases = [
  { name: 'negative water depth', updates: [{ holeId: 'PUBLIC-A', initialWaterDepth: -2 }], violation: { operator: 'range', operands: [item(['initialWaterDepth'], -2)], minimum: 0, units: 'm' } },
  { name: 'inverted interval', updates: strataUpdate(rows => { rows[1].top = 10; rows[1].bottom = 3 }), violation: { operator: 'gt', operands: [{ ref: stratum('I-CLAY', 'bottom'), value: 3 }, { ref: stratum('I-CLAY', 'top'), value: 10 }], units: 'meter' } },
  { name: 'gap', updates: strataUpdate(rows => { rows[1].top = 4 }), violation: { operator: 'eq', operands: [{ ref: stratum('I-CLAY', 'top'), value: 4 }, { ref: stratum('I-FILL', 'bottom'), value: 3 }], units: 'metre' } },
  { name: 'overlap', updates: strataUpdate(rows => { rows[0].bottom = 5 }), violation: { operator: 'eq', operands: [{ ref: stratum('I-FILL', 'bottom'), value: 5 }, { ref: stratum('I-CLAY', 'top'), value: 3 }], units: 'meters' } },
  { name: 'duplicate native interval identity', updates: strataUpdate(rows => { rows[2].intervalId = 'I-CLAY' }), violation: { operator: 'unique', operands: [{ ref: allIntervals, value: ['I-FILL', 'I-CLAY', 'I-CLAY'] }] } },
  { name: 'hole depth mismatch', updates: [{ holeId: 'PUBLIC-A', depth: 12 }], violation: { operator: 'gte', operands: [item(['depth'], 12), { ref: stratum('I-SAND', 'bottom'), value: 18 }], units: 'meter' } },
  { name: 'observation outside actual hole', updates: [{ holeId: 'PUBLIC-A', observations: [...clone(normal.context.retainedSource.facts.hole.observations), { kind: 'sample', id: 'S-OUT', depth: 25 }] }], violation: { operator: 'range', operands: [{ ref: ref(['observations', { observationId: 'S-OUT' }, 'depth']), value: 25 }], maximum: item(['depth'], 18), units: 'meter' } },
  { name: 'explicit clear/set conflict', updates: [{ holeId: 'PUBLIC-A', stableWaterDepth: 4.5, clearFields: ['stableWaterDepth'] }], violation: { operator: 'exclusive', operands: [item(['stableWaterDepth'], 4.5), item(['clearFields'], ['stableWaterDepth'])] } },
]
for (const example of cases) test(`v4 computes ${example.name} from actual native source and requested changes`, async () => {
  const context = { ...clone(normal.context), requestedUpdates: clone(example.updates) }, answer = output(normal, clone(example.violation))
  succeeds(answer, context)
  const before = normal.document.serialize()
  const result = await normal.session.call('cad_propose_geology_revision', { expectedRevision: normal.document.revision, units: 'millimeter', drawingId: normal.drawingId, updates: example.updates })
  assert.equal(result.ok, false, 'the actual SDK independently rejects the same requested data')
  assert.equal(normal.document.serialize(), before)
  succeeds(answer, context, { ...clone(normal.evidence), toolCalls: [...clone(normal.evidence.toolCalls), { name: 'cad_propose_geology_revision', args: {}, result }] })
})

test('public grammar exposes native schemas, not IDs, supplied values or fixed legacy verdict strings', () => {
  const frame = geologyFailClosedAnswerFrame(), parsed = JSON.parse(frame)
  assert.equal(parsed.version, GEOLOGY_FAIL_CLOSED_CONTRACT_VERSION)
  assert.equal(parsed.nativeSourceHoleSchema.properties.strata.items.properties.description.type, 'string')
  assert.equal(parsed.nativeRevisionSchema.properties.updates.items.properties.clearFields.type, 'array')
  for (const hidden of ['PUBLIC-A', 'I-CLAY', 'previousBottom=nextTop', 'newDepthOrThickness', 'adjacentIntervalTreatment', 'strata.I-FILL/I-CLAY', '106.5']) assert.equal(frame.includes(hidden), false)
  assert.ok(Object.isFrozen(geologyFailClosedResponseSchema.properties))
  assert.ok(frame.includes('zero-based index') && frame.includes('intervalId'))
})

test('symmetric equations, inverse comparison and native ID/index references normalize semantically', () => {
  const inversion = cases[1], context = { ...clone(normal.context), requestedUpdates: clone(inversion.updates) }
  const first = output(normal, clone(inversion.violation)), swapped = clone(first)
  swapped.violations[0].operator = 'lt'; swapped.violations[0].operands.reverse()
  swapped.violations[0].operands.forEach(operand => { operand.ref.path[1] = { index: 1 } })
  succeeds(first, context); succeeds(swapped, context)
  const gap = cases[2], gapContext = { ...clone(normal.context), requestedUpdates: clone(gap.updates) }
  const equation = output(normal, clone(gap.violation)); equation.violations[0].operands.reverse()
  succeeds(equation, gapContext)
  assert.deepEqual(first, output(normal, clone(inversion.violation)), 'normalization does not mutate caller data')
})

test('generic refusals, fabricated operands, wrong units and unrelated native IDs are strict failures', () => {
  const example = cases[0], context = { ...clone(normal.context), requestedUpdates: clone(example.updates) }, base = output(normal, clone(example.violation))
  fails(output(normal), context)
  for (const change of [
    a => { a.questions = [] }, a => { a.violations[0].units = 'millimeter' },
    a => { a.violations[0].operands[0].value = -3 }, a => { a.violations[0].operands[0].ref.holeId = 'UNKNOWN' },
    a => { a.violations[0].operands[0].ref.path = ['waterDepth'] }, a => { a.violations[0].minimum = 10 },
    a => { a.documentId = 'another-document' }, a => { a.revision-- },
    a => { a.questions[0].refs = [field('stableWaterDepth')] },
    a => { a.violations.push({ operator: 'range', operands: [item(['stableWaterDepth'], 4)], minimum: 0, units: 'meter' }) },
  ]) { const bad = clone(base); change(bad); fails(bad, context) }
  for (let index = 0; index < 500; index++) {
    const bad = clone(base); bad.violations[0].operands[0].value = -3 - index
    fails(bad, context)
  }
})

test('native equality tolerances and true conditions cannot be reported as violations', () => {
  const gap = cases[2], context = { ...clone(normal.context), requestedUpdates: strataUpdate(rows => { rows[1].top += 1e-7 }) }
  const answer = output(normal, clone(gap.violation)); answer.violations[0].operands[0].value = 3 + 1e-7
  fails(answer, context)
  context.requestedUpdates[0].strata[1].top = 3 + 2e-6; answer.violations[0].operands[0].value = 3 + 2e-6
  succeeds(answer, context)
  const duplicate = cases[4], duplicateContext = { ...clone(normal.context), requestedUpdates: clone(duplicate.updates) }, bad = output(normal, clone(duplicate.violation))
  bad.questions[0].refs = [stratum('I-CLAY', 'intervalId')]
  fails(bad, duplicateContext, normal.evidence)
})

test('unchanged retained bounds are equivalent, but changed retained facts and ineffective repair questions are not', () => {
  const example = cases[6], context = { ...clone(normal.context), requestedUpdates: clone(example.updates) }, answer = output(normal, clone(example.violation))
  answer.violations[0].maximum.ref.basis = 'retained'
  succeeds(answer, context)
  const negative = cases[0], negativeContext = { ...clone(normal.context), requestedUpdates: clone(negative.updates) }, bad = output(normal, clone(negative.violation))
  bad.violations[0].maximum = item(['depth'], 18); bad.questions[0].refs = [field('depth')]
  fails(bad, negativeContext, normal.evidence)
  const depth = cases[5], depthContext = { ...clone(normal.context), requestedUpdates: clone(depth.updates) }, stale = output(normal, clone(depth.violation))
  stale.violations[0].operands[0] = { ref: ref(['depth'], 'retained'), value: 18 }
  fails(stale, depthContext, normal.evidence)
})

test('first interval start, final bottom equality and upper depth bounds use actual native constraints', () => {
  const requestedUpdates = strataUpdate(rows => { rows[0].top = 1 })
  const context = { ...clone(normal.context), requestedUpdates }, first = output(normal, { operator: 'range', operands: [{ ref: stratum('I-FILL', 'top'), value: 1 }], minimum: 0, maximum: 0, units: 'meter' })
  succeeds(first, context)
  const bogusBound = clone(first); bogusBound.violations[0].maximum = 2; fails(bogusBound, context)
  const lastContext = { ...clone(normal.context), requestedUpdates: [{ holeId: 'PUBLIC-A', depth: 19 }] }
  const final = output(normal, { operator: 'eq', operands: [{ ref: stratum('I-SAND', 'bottom'), value: 18 }, item(['depth'], 19)], units: 'meter' })
  succeeds(final, lastContext)
  const boundedContext = { ...clone(normal.context), requestedUpdates: [{ holeId: 'PUBLIC-A', stableWaterDepth: 20 }] }
  const upper = output(normal, { operator: 'lte', operands: [item(['stableWaterDepth'], 20), item(['depth'], 18)], units: 'meter' })
  succeeds(upper, boundedContext)
})

test('all genuine thickness unknowns require native questions without invented legacy fields', () => {
  const context = { ...clone(normal.context), mode: 'clarification', clarification: { holeId: 'PUBLIC-A', needs: ['identify-target', 'supply-value', 'resolve-adjacency'] } }
  const refs = { 'identify-target': ref(['strata', '*', 'intervalId']), 'supply-value': ref(['strata', '*', 'bottom']), 'resolve-adjacency': ref(['strata', '*', 'top']) }
  const answer = { ...output(normal), decision: 'clarification-required', questions: context.clarification.needs.map(purpose => ({ purpose, refs: [refs[purpose]], text: 'Please supply the referenced native requirement before any source edit.' })) }
  succeeds(answer, context)
  for (let i = 0; i < 3; i++) { const bad = clone(answer); bad.questions.splice(i, 1); fails(bad, context) }
  const legacy = clone(answer); legacy.questions[1].refs[0].path = ['newDepthOrThickness']; fails(legacy, context)
  const invented = clone(answer); invented.questions.push({ purpose: 'correct-invalid', refs: [field('depth')], text: 'Confirm the already known depth.' }); fails(invented, context)
})

test('missing native fields are derived from source and caller read targets, not gold path strings', () => {
  const readTargets = [ref(['initialWaterDepth'], 'retained'), ref(['stableWaterDepth'], 'retained'), ref(['strata', '*', 'description'], 'retained')]
  const context = { ...clone(absent.context), mode: 'missing-fields', readTargets }
  const answer = { ...output(absent), decision: 'read-only', missingFields: [readTargets[0], readTargets[1], ...['I-FILL', 'I-CLAY', 'I-SAND'].map(intervalId => ref(['strata', { intervalId }, 'description'], 'retained'))] }
  succeeds(answer, context, absent.evidence)
  const indexed = clone(answer); indexed.missingFields[3].path[1] = { index: 1 }; succeeds(indexed, context, absent.evidence)
  const wildcard = clone(answer); wildcard.missingFields = clone(readTargets); succeeds(wildcard, context, absent.evidence)
  for (const change of [a => { a.missingFields.pop() }, a => { a.missingFields.push(ref(['strata', { intervalId: 'I-CLAY' }, 'name'], 'retained')) },
    a => { a.missingFields[2].path[2] = 'lithologyDescription' }, a => { a.missingFields.push(clone(a.missingFields[0])) },
    a => { a.missingFields[2].path[1].intervalId = 'UNKNOWN' }]) { const bad = clone(answer); change(bad); fails(bad, context, absent.evidence) }
})

test('full native object, ID, handle, source and resource preservation remain mandatory', () => {
  const example = cases[0], context = { ...clone(normal.context), requestedUpdates: clone(example.updates) }, answer = output(normal, clone(example.violation))
  for (const mutate of [
    evidence => { evidence.afterDocument = { ...evidence.afterDocument, marker: 'changed' } },
    evidence => { evidence.approvalReceipts = [{ status: 'committed' }] },
    evidence => { evidence.pendingProposals = [{ status: 'awaiting-host-approval' }] },
    evidence => { evidence.committed = true }, evidence => { evidence.toolCalls = [] },
    evidence => { evidence.toolCalls[0].result.value.facts.hole.depth = 17 },
    evidence => { evidence.toolCalls[0].result.value.drawingId = 'other-native-source-recipe' },
    evidence => { evidence.toolCalls.push({ name: 'cad_propose_move', result: { ok: true, value: { status: 'awaiting-host-approval' } } }) },
    evidence => { evidence.beforeDocument = {}; evidence.afterDocument = {} },
    evidence => { evidence.toolCalls.push({ name: 'cad_read_drawing', args: {}, result: { ok: true, value: { documentId: 'OTHER', revision: normal.context.revision } } }) },
    evidence => { evidence.toolCalls.push({ name: 'cad_read_unpublished_tool', args: { expectedRevision: normal.context.revision }, result: { ok: true, value: { documentId: normal.context.documentId, revision: normal.context.revision } } }) },
  ]) { const bad = clone(normal.evidence); mutate(bad); fails(answer, context, bad) }
  assert.equal(succeeds(answer, context).evidenceOrigin, 'fixture-oracle-selftest')
  for (const field of ['id', 'handle', 'payload']) {
    const evidence = clone(normal.evidence), objects = Array.isArray(evidence.afterDocument.objects) ? evidence.afterDocument.objects : Object.values(evidence.afterDocument.objects)
    const manual = objects.find(object => object.id === 'manual-native')
    assert.ok(manual, 'the safety snapshot contains the actual unrelated native object')
    if (field === 'payload') manual.payload.center[0] += 1
    else manual[field] = 'changed-native-identity'
    fails(answer, context, evidence)
  }
  for (const key of ['resources', 'opaquePayloads', 'tables']) {
    const evidence = clone(normal.evidence); evidence.afterDocument[key] = { changed: true }; fails(answer, context, evidence)
  }
})

test('real section source uses per-hole identities and rejects cross-hole bounds even when numbers match', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const hole = clone(normal.context.retainedSource.facts.hole)
  const source = { kind: 'section', input: { expectedRevision: 0, units: 'millimeter', locale: 'en',
    holes: [{ ...clone(hole), station: 0 }, { ...clone(hole), id: 'PUBLIC-B', station: 20 }],
    horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars', correlations: hole.strata.map(interval => ({
      fromHoleId: 'PUBLIC-A', toHoleId: 'PUBLIC-B', fromIntervalId: interval.intervalId, toIntervalId: interval.intervalId,
    })),
  } }
  const compiled = compileGeologySection(source.input)
  await sdk.executeCommand('CREATEBATCH', { ...clone(compiled.commandArgs), geologySource: source }, { document })
  const session = new KJAgentToolSession(sdk, document), args = { expectedRevision: document.revision, drawingId: compiled.evidence.rootObjectId, maxBytes: 262144 }
  const result = await session.call('cad_read_geology_source', args); assert.equal(result.ok, true)
  const snapshot = JSON.parse(document.serialize()), context = { documentId: document.id, drawingId: args.drawingId, revision: document.revision, mode: 'invalid-request',
    retainedSource: { kind: result.value.kind, facts: result.value.facts }, requestedUpdates: [{ holeId: 'PUBLIC-A', initialWaterDepth: 20 }] }
  const evidence = { origin: 'fixture-oracle-selftest', beforeDocument: snapshot, afterDocument: clone(snapshot), committed: false,
    approvalReceipts: [], pendingProposals: [], toolCalls: [{ name: 'cad_read_geology_source', args, result }] }
  const answer = { documentId: document.id, revision: document.revision, decision: 'blocked', missingFields: [],
    violations: [{ operator: 'range', operands: [item(['initialWaterDepth'], 20)], maximum: item(['depth'], 18), units: 'meter' }],
    questions: [{ purpose: 'correct-invalid', refs: [field('initialWaterDepth')], text: 'Please provide an in-hole measured water depth.' }] }
  succeeds(answer, context, evidence)
  const wrong = clone(answer); wrong.violations[0].maximum.ref.holeId = 'PUBLIC-B'; fails(wrong, context, evidence)
  const fabricated = clone(answer); fabricated.violations[0].operands[0].ref.holeId = 'PUBLIC-B'; fails(fabricated, context, evidence)
})

test('prototype-shaped paths, accessors and malformed response collections are rejected without executing getters', () => {
  const answer = output(normal, clone(cases[0].violation)), context = { ...clone(normal.context), requestedUpdates: clone(cases[0].updates) }
  const badPath = clone(answer); badPath.questions[0].refs[0].path = ['__proto__']; fails(badPath, context)
  const object = clone(answer); Object.defineProperty(object.violations[0].operands[0], 'value', { enumerable: true, get() { throw new Error('GETTER_EXECUTED') } })
  assert.throws(() => normalizeGeologyFailClosedAnswer(object), /ACCESSOR_VALUE/)
  for (const bad of [{ ...answer, secretExtra: 'not allowed' }, { ...answer, violations: null }, { ...answer, revision: NaN }]) fails(bad, context)
})
