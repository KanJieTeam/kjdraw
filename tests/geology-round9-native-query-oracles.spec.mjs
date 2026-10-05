import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { ROUND9_NATIVE_QUERY_DESCRIPTORS, ROUND9_NATIVE_QUERY_SCENARIO_IDS, ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT,
  round9NativeQueryDescriptor, assessRound9NativeQueryReadiness, round9NativeQueryAnswerFrame, round9NativeQueryInputBindings,
  buildRound9NativeQueryFixture, expectedRound9NativeQueryAnswer, evaluateRound9NativeQueryOracle,
} from '../scripts/testing/helpers/geology-round9-native-query-oracles.mjs'

const originalBytes = await readFile(FIXTURE_URL)
const corpus = JSON.parse(originalBytes), byId = new Map(corpus.scenarios.map(item => [item.id, item]))
const clone = structuredClone, policy = ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT
const query = 'GUS1-cad-query.model-extents-zh-direct', nearby = 'GUS1-cad-query.label-neighborhood-zh-direct'
const hash = value => createHash('sha256').update(value).digest('hex')
const traces = fixture => {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}
async function geometryPages(trace, fixture, filters = {}, limit = 3) {
  let offset = 0
  do {
    const page = await trace.call('cad_query_drawing', { expectedRevision: fixture.initialRevision, filters,
      offset, layerOffset: 0, limit, maxLayers: 0, maxBytes: 65536 })
    offset = page.nextOffset
  } while (offset !== null)
}
async function evidenceFor(scenario, fixture) {
  const trace = traces(fixture)
  if (round9NativeQueryDescriptor(scenario).intent === 'cad-query.model-extents') {
    let offset = 0
    do { const page = await trace.call('cad_read_layouts', { expectedRevision: fixture.initialRevision, offset, limit: 1, maxBytes: 65536 }); offset = page.nextOffset } while (offset !== null)
  }
  await geometryPages(trace, fixture)
  if (scenario.language === 'en' && round9NativeQueryDescriptor(scenario).intent === 'cad-query.model-extents') {
    for (const spaceId of fixture.document.spaces.paperSpaceIds) if (fixture.document.listEntities().some(item => item.ownerId === spaceId)) await geometryPages(trace, fixture, { spaceId })
  }
  return { trace, evidence: { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls,
    answer: expectedRound9NativeQueryAnswer(scenario, fixture) } }
}
const passed = (scenario, fixture, evidence) => {
  const result = evaluateRound9NativeQueryOracle(scenario, fixture, evidence)
  assert.equal(result.status, 'satisfied', JSON.stringify(result.assertions?.filter(item => !item.satisfied)))
  assert.equal(result.scenarioExecuted, false)
  assert.equal(result.scenarioPassed, null)
  return result
}
const failed = (scenario, fixture, evidence, assertionId) => {
  const result = evaluateRound9NativeQueryOracle(scenario, fixture, evidence)
  assert.equal(result.status, 'failed', JSON.stringify(result))
  assert.equal(result.scenarioPassed, null)
  if (assertionId) assert.equal(result.assertions.find(item => item.id === assertionId)?.satisfied, false)
}

test('round9 declares twelve original questions; only six have complete original facts, never a default neighborhood radius', () => {
  assert.equal(ROUND9_NATIVE_QUERY_DESCRIPTORS.length, 2)
  assert.equal(ROUND9_NATIVE_QUERY_SCENARIO_IDS.length, 12)
  assert.equal(ROUND9_NATIVE_QUERY_SCENARIO_IDS.filter(id => assessRound9NativeQueryReadiness(id).status === 'runnable').length, 6)
  assert.equal(ROUND9_NATIVE_QUERY_SCENARIO_IDS.filter(id => assessRound9NativeQueryReadiness(id, { neighborhoodPolicy: policy }).status === 'runnable').length, 12)
  assert.equal(assessRound9NativeQueryReadiness(corpus.scenarios.find(item => item.expected.intent === 'cad-query.native-object')).status, 'not-ready')
})
for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS.filter(id => id.includes('label-neighborhood'))) test(`original neighborhood remains not ready without newly supplied policy: ${id}`, async () => {
  const readiness = assessRound9NativeQueryReadiness(id)
  assert.equal(readiness.reason, 'missing-public-neighborhood-policy')
  assert.deepEqual(readiness.missingFacts, ['radius', 'distance-metric', 'boundary-inclusion', 'owner-scope'])
  assert.equal(readiness.scenarioPassed, null)
  assert.equal(round9NativeQueryAnswerFrame(id), null)
  await assert.rejects(buildRound9NativeQueryFixture(id), /cannot be invented/)
})

for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS) test(`round9 independent native DXF selftest, zero model calls: ${id}`, async () => {
  const scenario = byId.get(id), options = scenario.expected.intent === 'cad-query.label-neighborhood' ? { neighborhoodPolicy: policy } : {}
  const fixture = await buildRound9NativeQueryFixture(scenario, options)
  try {
    const { evidence } = await evidenceFor(scenario, fixture)
    passed(scenario, fixture, evidence)
    assert.equal(fixture.modelCalls, 0)
    assert.equal(fixture.scenarioExecuted, false)
    assert.equal(fixture.document.validate().valid, true)
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
    assert.deepEqual(Buffer.from(fixture.artifact.bytes), fixture.initialArtifactBytes)
    assert.equal(fixture.document.history.undoCount, 0, 'Actually imported DXF has a baseline, not invented history')
    assert.equal(fixture.sdk.agentPlans.list().length, 0)
    const bindings = round9NativeQueryInputBindings(fixture), serialized = JSON.stringify(bindings)
    for (const forbidden of ['oracleExpected', 'oracleBaseline', 'initialEntities', '"min"', '"max"', '"candidates"']) assert.ok(!serialized.includes(forbidden), forbidden)
    assert.equal(Object.keys(bindings.aliases).length, fixture.document.listEntities().length, 'Complete identity inventory, not a target-only list')
    const frame = round9NativeQueryAnswerFrame(scenario, options)
    assert.ok(frame.includes('response grammar only'))
    if (options.neighborhoodPolicy) {
      assert.deepEqual(bindings.suppliedInputs.neighborhoodQueryContract, policy)
      assert.ok(frame.includes(JSON.stringify(policy)), 'The model must actually receive the newly declared public radius/metric/boundary/owner contract')
      const aliases = Object.entries(fixture.identityAliases).filter(([, item]) => evidence.answer.candidates.some(candidate => candidate.id === item.nativeId)).map(([alias]) => alias).sort()
      assert.deepEqual(aliases, ['CIRCLE-A', 'CIRCLE-B', 'LINE-A', 'LINE-C'])
      assert.equal(evidence.answer.geologicalMeaningAssigned, false)
    } else {
      assert.deepEqual(evidence.answer.model.min, [-1000, -800, 0])
      assert.deepEqual(evidence.answer.model.max, [1400, 1200, 0])
      const paper = fixture.document.getObject(fixture.identityAliases['PAPER-FRAME'].nativeId)
      assert.notEqual(paper.ownerId, evidence.answer.model.spaceId)
      assert.ok(evidence.answer.excludedPaperSpaceIds.includes(paper.ownerId))
      if (scenario.language === 'en') assert.deepEqual(evidence.answer.paperSpaces.find(item => item.spaceId === paper.ownerId),
        { spaceId: paper.ownerId, min: [5000, 5000, 0], max: [7000, 6000, 0] })
      else assert.equal(Object.hasOwn(evidence.answer, 'paperSpaces'), false, 'Chinese request only asks model extents with paper excluded')
    }
  } finally { fixture.dispose() }
})

test('literal originals and generated frozen corpus bytes are unchanged; no inferred radius is present in any of the six requests', async () => {
  assert.equal(hash(await readFile(FIXTURE_URL)), hash(originalBytes))
  for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS.filter(id => id.includes('label-neighborhood'))) {
    assert.equal(byId.get(id).prompt.includes('10 mm'), false)
    assert.equal(byId.get(id).prompt.includes(policy.metric), false)
  }
})

test('bad, incomplete, unit-mismatched or hidden caller neighborhood declarations are never made ready', () => {
  for (const bad of [{ ...policy, radius: 0 }, { ...policy, radius: NaN }, { ...policy, radius: 10001 },
    { ...policy, units: 'meter' }, { ...policy, metric: 'distance-to-circle-center' }, { ...policy, boundary: 'exclusive' },
    { ...policy, ownerScope: 'all-spaces' }, { ...policy, guessedCandidates: ['CIRCLE-A'] }, { radius: 10 }]) {
    assert.throws(() => assessRound9NativeQueryReadiness(nearby, { neighborhoodPolicy: bad }))
  }
  const accessor = { ...policy }; Object.defineProperty(accessor, 'radius', { enumerable: true, get() { throw Error('must not execute') } })
  assert.throws(() => assessRound9NativeQueryReadiness(nearby, { neighborhoodPolicy: accessor }), /accessors/)
  const hidden = { ...policy }; Object.defineProperty(hidden, 'radius', { enumerable: false, value: 10 })
  assert.throws(() => assessRound9NativeQueryReadiness(nearby, { neighborhoodPolicy: hidden }), /hidden/)
})

test('model extents reject paper inclusion, wrong dimensions/units/owner, missing exclusions and extra fabricated objects', async () => {
  const scenario = byId.get(query), fixture = await buildRound9NativeQueryFixture(scenario)
  try {
    const { evidence } = await evidenceFor(scenario, fixture)
    for (const alter of [answer => { answer.model.max[0] = 7000 }, answer => { answer.model.min[1] += 1 },
      answer => { answer.model.min.pop() }, answer => { answer.units = 'meter' }, answer => { answer.model.spaceId = fixture.document.spaces.paperSpaceIds[0] },
      answer => { answer.excludedPaperSpaceIds = [] }, answer => { answer.model.entityIds = ['fabricated'] }]) {
      const answer = clone(evidence.answer); alter(answer)
      failed(scenario, fixture, { ...evidence, answer }, 'exact-independent-native-answer')
    }
    passed(scenario, fixture, { ...evidence, answer: { ...clone(evidence.answer), units: 'mm' } })
  } finally { fixture.dispose() }
})

test('English separately reported paper frame values cannot be omitted or mixed with model space', async () => {
  const scenario = byId.get('GUS1-cad-query.model-extents-en-direct'), fixture = await buildRound9NativeQueryFixture(scenario)
  try {
    const { evidence } = await evidenceFor(scenario, fixture)
    const missing = clone(evidence.answer); delete missing.paperSpaces
    failed(scenario, fixture, { ...evidence, answer: missing })
    const wrong = clone(evidence.answer); wrong.paperSpaces[0].min = clone(wrong.model.min)
    failed(scenario, fixture, { ...evidence, answer: wrong })
    failed(scenario, fixture, { ...evidence, toolCalls: evidence.toolCalls.filter(call => call.result.value.spaceId !== evidence.answer.paperSpaces[0].spaceId) })
  } finally { fixture.dispose() }
})

for (const intent of ['model-extents', 'label-neighborhood']) test(`${intent}: partial pagination, omitted native geometry and stale/foreign/failed/unknown read receipts fail`, async () => {
  const scenario = byId.get(`GUS1-cad-query.${intent}-zh-direct`), fixture = await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: policy })
  try {
    const { evidence } = await evidenceFor(scenario, fixture)
    const completeQueries = evidence.toolCalls.filter(call => call.name === 'cad_query_drawing')
    assert.ok(completeQueries.length > 1)
    failed(scenario, fixture, { ...evidence, toolCalls: evidence.toolCalls.filter(call => call.name !== 'cad_query_drawing' || call === completeQueries[0]) },
      intent === 'model-extents' ? 'complete-model-pagination' : 'complete-neighborhood-query-pagination')
    const missingEntity = clone(evidence.toolCalls)
    const omittedId = intent === 'model-extents' ? fixture.identityAliases['MODEL-GUIDE'].nativeId : fixture.identityAliases['CIRCLE-A'].nativeId
    for (const call of missingEntity) if (call.result.value.entities) call.result.value.entities = call.result.value.entities.filter(item => item.id !== omittedId)
    failed(scenario, fixture, { ...evidence, toolCalls: missingEntity })
    for (const change of [call => { call.result.value.documentId = 'foreign-document' }, call => { call.result.value.revision++ },
      call => { call.args.expectedRevision = fixture.initialRevision + 1 }, call => { call.result.value.units = 'meter' },
      call => { call.result = { ok: false, error: { code: 'READ_FAILED', message: 'failed' } } }, call => { call.name = 'cad_read_made_up' }]) {
      const calls = clone(evidence.toolCalls), call = calls.find(item => item.name === 'cad_query_drawing'); change(call)
      failed(scenario, fixture, { ...evidence, toolCalls: calls }, 'successful-current-native-read-tools-only')
    }
    failed(scenario, fixture, { ...evidence, toolCalls: [] })
  } finally { fixture.dispose() }
})

test('declared neighborhood rejects missed boundary, outside/far/paper/wrong-type neighbors and inferred borehole meaning', async () => {
  const scenario = byId.get(nearby), fixture = await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: policy })
  try {
    const { evidence } = await evidenceFor(scenario, fixture)
    for (const alias of ['LINE-C', 'CIRCLE-B']) {
      const answer = clone(evidence.answer); answer.candidates = answer.candidates.filter(item => item.id !== fixture.identityAliases[alias].nativeId)
      failed(scenario, fixture, { ...evidence, answer })
    }
    for (const alias of ['LINE-D', 'LINE-B', 'LINE-E', 'CIRCLE-C', 'CIRCLE-MANUAL', 'PAPER-CIRCLE-A', 'PAPER-LINE-A', 'POLY-A']) {
      const answer = clone(evidence.answer), record = fixture.document.getObject(fixture.identityAliases[alias].nativeId)
      answer.candidates.push({ id: record.id, type: record.type })
      failed(scenario, fixture, { ...evidence, answer })
    }
    const wrong = clone(evidence.answer); wrong.geologicalMeaningAssigned = true
    failed(scenario, fixture, { ...evidence, answer: wrong }, 'spatial-candidates-not-geological-facts')
    const reference = clone(evidence.answer); reference.referenceId = fixture.identityAliases['TEXT-B'].nativeId
    failed(scenario, fixture, { ...evidence, answer: reference })
    const duplicate = clone(evidence.answer); duplicate.candidates.push(clone(duplicate.candidates[0]))
    failed(scenario, fixture, { ...evidence, answer: duplicate })
    const reversed = clone(evidence.answer); reversed.candidates.reverse()
    passed(scenario, fixture, { ...evidence, answer: reversed })
  } finally { fixture.dispose() }
})

test('actual bounded neighborhood query plus separately read anchor is sufficient; default entire-model reading is not a hidden requirement', async () => {
  const scenario = byId.get(nearby), fixture = await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: policy })
  try {
    const trace = traces(fixture), reference = fixture.identityAliases['TEXT-A'].nativeId
    await geometryPages(trace, fixture, { ids: [reference] })
    await geometryPages(trace, fixture, { types: ['LINE', 'CIRCLE'], bounds: [-8, -8, 12, 12] }, 1)
    const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls,
      answer: expectedRound9NativeQueryAnswer(scenario, fixture) }
    passed(scenario, fixture, evidence)
    const missingAnchor = trace.calls.filter(call => !call.args.filters.ids)
    failed(scenario, fixture, { ...evidence, toolCalls: missingAnchor }, 'actual-native-text-anchor-read')
    const wrongOwner = clone(trace.calls)
    for (const call of wrongOwner.filter(call => call.args.filters.types)) call.args.filters.spaceId = fixture.document.spaces.paperSpaceIds[0]
    failed(scenario, fixture, { ...evidence, toolCalls: wrongOwner }, 'complete-neighborhood-query-pagination')
  } finally { fixture.dispose() }
})

test('caller-declared alternative radius is genuinely used, not secretly fixed at the illustrative 10 mm declaration', async () => {
  const scenario = byId.get(nearby), alternative = { ...policy, radius: 1 }, fixture = await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: alternative })
  try {
    const { evidence } = await evidenceFor(scenario, fixture)
    assert.deepEqual(evidence.answer.candidates, [])
    passed(scenario, fixture, evidence)
    assert.equal(round9NativeQueryInputBindings(fixture).suppliedInputs.neighborhoodQueryContract.radius, 1)
  } finally { fixture.dispose() }
})

for (const intent of ['model-extents', 'label-neighborhood']) test(`${intent}: malformed answer containers, altered native geometry and missing earlier pages are rejected without evaluator crashes`, async () => {
  const scenario = byId.get(`GUS1-cad-query.${intent}-zh-direct`), fixture = await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: policy })
  try {
    const { evidence } = await evidenceFor(scenario, fixture)
    for (const answer of [null, [], 'prose', {},
      { ...clone(evidence.answer), candidates: [null, 7, {}] },
      { ...clone(evidence.answer), excludedPaperSpaceIds: {} }]) failed(scenario, fixture, { ...evidence, answer })
    const wrongGeometry = clone(evidence.toolCalls)
    const targetId = fixture.identityAliases['CIRCLE-A'].nativeId
    const entity = wrongGeometry.flatMap(call => call.result.value.entities ?? []).find(item => item.id === targetId)
    entity.geometry.radius += 1
    failed(scenario, fixture, { ...evidence, toolCalls: wrongGeometry })
    const omittedGeometry = clone(evidence.toolCalls)
    const omitted = omittedGeometry.flatMap(call => call.result.value.entities ?? []).find(item => item.id === targetId)
    omitted.geometry = null; omitted.geometryOmittedReason = 'response-budget'
    failed(scenario, fixture, { ...evidence, toolCalls: omittedGeometry })
    const lastPageOnly = evidence.toolCalls.filter(call => call.name !== 'cad_query_drawing' || call.result.value.nextOffset === null)
    failed(scenario, fixture, { ...evidence, toolCalls: lastPageOnly })
  } finally { fixture.dispose() }
})

for (const intent of ['model-extents', 'label-neighborhood']) test(`${intent}: byte/state/history mutation, pending proposal, approval marker and runtime failure cannot pass`, async () => {
  const scenario = byId.get(`GUS1-cad-query.${intent}-zh-direct`), fixture = await buildRound9NativeQueryFixture(scenario, { neighborhoodPolicy: policy })
  try {
    const { evidence, trace } = await evidenceFor(scenario, fixture)
    for (const extra of [{ approvalReceipt: { status: 'committed' } }, { hostApprovalApplied: true }, { proposal: {} },
      { executionStatus: 'error' }, { executionStatus: 'cancelled' }, { error: { code: 'KJAGENT_READ_REQUIRED' } }]) failed(scenario, fixture, { ...evidence, ...extra })
    const bytes = fixture.artifact.bytes
    fixture.artifact.bytes = Buffer.from(bytes); fixture.artifact.bytes[0] ^= 1
    failed(scenario, fixture, evidence, 'original-dxf-bytes-unchanged'); fixture.artifact.bytes = bytes
    const changed = fixture.document.fork()
    await changed.transact('Actual unauthorized native edit', tx => {
      const object = changed.getObject(fixture.identityAliases['CIRCLE-A'].nativeId)
      tx.updateObject(object.id, { payload: { ...object.payload, radius: 7 } })
    })
    failed(scenario, fixture, { ...evidence, afterDocument: changed }, 'read-only-state-unchanged')
    const result = await trace.session.call('cad_propose_move', { expectedRevision: fixture.initialRevision, units: 'millimeter',
      ids: [fixture.identityAliases['CIRCLE-A'].nativeId], dx: 1, dy: 0 })
    assert.equal(result.ok, true)
    failed(scenario, fixture, evidence, 'no-proposal-or-host-approval')
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState, 'A real pending plan is still not a commit')
  } finally { fixture.dispose() }
})

test('raw final assistant bytes must be exact JSON, never early fixture answers, stripped prose or errored text rescued as live success', async () => {
  const scenario = byId.get(query), fixture = await buildRound9NativeQueryFixture(scenario)
  try {
    const { evidence } = await evidenceFor(scenario, fixture)
    // No real-model positive assertion: these are explicitly adversarial provenance rejections.
    for (const rawFinalAnswer of ['', 'earlier schema ' + JSON.stringify(evidence.answer), JSON.stringify(evidence.answer) + '\nDone.', '```json\n' + JSON.stringify(evidence.answer) + '\n```', '{"model":null}']) {
      const result = evaluateRound9NativeQueryOracle(scenario, fixture, { ...evidence, origin: 'real-model', rawFinalAnswer })
      assert.equal(result.status, 'failed')
      assert.equal(result.scenarioPassed, false)
      assert.equal(result.assertions.find(item => item.id === 'actual-final-model-answer-provenance').satisfied, false)
    }
    const result = evaluateRound9NativeQueryOracle(scenario, fixture, { ...evidence, origin: 'fixture', rawFinalAnswer: JSON.stringify(evidence.answer) })
    assert.equal(result.status, 'not-evaluated'); assert.equal(result.scenarioPassed, null)
  } finally { fixture.dispose() }
})
