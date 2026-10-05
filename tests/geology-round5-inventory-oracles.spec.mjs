import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { ROUND5_INVENTORY_SCENARIO_IDS, ROUND5_INVENTORY_DESCRIPTORS, assessRound5InventoryReadiness,
  buildRound5InventoryFixture, expectedRound5InventoryAnswer, expectedRound5InventoryOutcome,
  evaluateRound5InventoryOracle, round5InventoryDescriptor, round5InventoryInputBindings,
} from '../scripts/testing/helpers/geology-round5-inventory-oracles.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const byId = new Map(corpus.scenarios.map(item => [item.id, item]))
const clone = structuredClone
function traceFor(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}

test('round5 declares exactly 18 original public scenarios, never exports a prose command interpreter', () => {
  assert.equal(ROUND5_INVENTORY_DESCRIPTORS.length, 3)
  assert.equal(ROUND5_INVENTORY_SCENARIO_IDS.length, 18)
  const unknown = corpus.scenarios.find(item => item.expected.intent === 'cad-query.model-extents')
  assert.equal(assessRound5InventoryReadiness(unknown).status, 'not-ready')
})

for (const id of ROUND5_INVENTORY_SCENARIO_IDS) test(`round5 actual engine selftest, zero model calls: ${id}`, async () => {
  const scenario = byId.get(id), fixture = await buildRound5InventoryFixture(scenario)
  try {
    const descriptor = round5InventoryDescriptor(scenario), trace = traceFor(fixture), revision = fixture.initialRevision
    assert.equal(fixture.document.validate().valid, true)
    assert.equal(fixture.modelCalls, 0)
    let proposal
    if (descriptor.intent === 'cad-query.named-selection') {
      let offset = 0
      do { const page = await trace.call('cad_read_selection_sets', { expectedRevision: revision, offset, limit: 1, maxBytes: 65536 }); offset = page.nextOffset }
      while (offset !== null)
      assert.equal(fixture.artifact.format, 'KJD', 'DXF itself does not promise native persistent selection metadata')
      assert.equal(fixture.document.listObjects({ kind: 'group', type: 'SELECTION_SET' }).length, 2)
    } else if (descriptor.kind === 'read-only') {
      let layerOffset = 0
      do { const page = await trace.call('cad_query_drawing', { expectedRevision: revision, filters: {}, offset: 0,
        layerOffset, limit: 0, maxLayers: 2, maxBytes: 65536 }); layerOffset = page.nextLayerOffset }
      while (layerOffset !== null)
      assert.equal(fixture.artifact.format, 'DXF')
      assert.equal(expectedRound5InventoryAnswer(scenario, fixture).layers.length, 4)
    } else {
      const gold = expectedRound5InventoryOutcome(scenario, fixture)
      await trace.call('cad_query_drawing', { expectedRevision: revision, filters: { ids: [gold.targetId] }, offset: 0,
        layerOffset: 0, limit: 20, maxLayers: 100, maxBytes: 65536 })
      proposal = await trace.call('cad_propose_text_edit', { expectedRevision: revision, units: 'millimeter', changes: [{ id: gold.targetId,
        expectedText: gold.before[0].payload.text, text: gold.after[0].payload.text }] })
    }
    const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls,
      answer: expectedRound5InventoryAnswer(scenario, fixture), proposal, stage: 'pending-preview' }
    const pending = evaluateRound5InventoryOracle(scenario, fixture, evidence)
    assert.equal(pending.status, 'satisfied', JSON.stringify(pending.assertions?.filter(item => !item.satisfied)))
    assert.equal(pending.scenarioPassed, null)
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
    if (proposal) {
      const wrong = clone(proposal); wrong.preview.after[0].payload.text = 'Changed all historical contents'
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, proposal: wrong }).status, 'failed')
      const approval = await trace.session.approve(proposal.planId, 'public-round5-oracle-host')
      assert.equal(approval.ok, true)
      const committed = evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, stage: 'committed', approval, approvedPlanId: proposal.planId })
      assert.equal(committed.status, 'satisfied', JSON.stringify(committed.assertions?.filter(item => !item.satisfied)))
      assert.equal(committed.scenarioPassed, null)
      const actualHostEvidence = { ...evidence, stage: 'committed', approvalReceipt: approval.value,
        approvedPlanId: proposal.planId, hostApprovalApplied: true }
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, actualHostEvidence).status, 'satisfied')
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...actualHostEvidence, hostApprovalApplied: false }).status, 'failed')
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...actualHostEvidence, approvedPlanId: 'not-approved' }).status, 'failed')
      for (const receipt of [{ ...approval.value, status: 'rejected' },
        { ...approval.value, status: undefined }, { ...approval.value, planId: 'foreign-plan' }]) {
        assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...actualHostEvidence, approvalReceipt: receipt }).status, 'failed')
      }
      const finalFingerprint = fixture.document.fingerprint()
      assert.equal((await trace.session.approve(proposal.planId, 'public-round5-oracle-host')).ok, false)
      assert.equal(fixture.document.fingerprint(), finalFingerprint)
      await fixture.document.undo()
      assert.equal(fixture.document.fingerprint(), fixture.oracleBaselineDocument.fingerprint())
      await fixture.document.redo()
      assert.equal(fixture.document.fingerprint(), finalFingerprint)
      const recovered = await fixture.sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' }), { format: 'DXF' })
      const semantic = document => document.listEntities().map(item => ({ handle: item.handle, type: item.type,
        payload: { ...item.payload, layerId: document.getObject(item.payload.layerId)?.name,
          ...(item.payload.styleId ? { styleId: document.getObject(item.payload.styleId)?.name } : {}) } })).sort((a, b) => a.handle.localeCompare(b.handle))
      assert.deepEqual(semantic(recovered), semantic(fixture.document), 'Every native entity and handle survives actual DXF export/reopen')
    } else {
      const altered = clone(evidence.answer)
      if (altered.layers) altered.layers[0].locked = !altered.layers[0].locked
      else altered.selectionSets[0].memberIds.push(fixture.identityAliases['CIRCLE-A'].nativeId)
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, answer: altered }).status, 'failed')
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, toolCalls: [] }).status, 'failed')
      const reordered = clone(evidence.answer)
      if (reordered.layers) reordered.layers.reverse()
      else reordered.selectionSets[0].memberIds.reverse()
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, answer: reordered }).status, 'satisfied')
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, origin: 'real-model',
        rawFinalAnswer: JSON.stringify(evidence.answer) + ' explanation' }).status, 'not-evaluated')
    }
    const input = JSON.stringify(round5InventoryInputBindings(fixture))
    assert.equal(input.includes('oracleExpectedFingerprint'), false)
    assert.equal(input.includes('oracleBaselineDocument'), false)
    assert.equal(input.includes('PUBLIC-HIDDEN'), false, 'Layer flags/names must be read, not provided as expected answers')
  } finally { fixture.dispose() }
})

test('catalog evidence cannot swap document/revision or skip protected layers', async () => {
  const scenario = byId.get('GUS1-cad-query.protected-layer-inventory-zh-direct'), fixture = await buildRound5InventoryFixture(scenario)
  try {
    const trace = traceFor(fixture)
    await trace.call('cad_query_drawing', { expectedRevision: fixture.initialRevision, filters: {}, offset: 0, layerOffset: 0,
      limit: 0, maxLayers: 100, maxBytes: 65536 })
    const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls,
      answer: expectedRound5InventoryAnswer(scenario, fixture) }
    assert.equal(evaluateRound5InventoryOracle(scenario, fixture, evidence).status, 'satisfied')
    for (const field of ['documentId', 'revision']) {
      const wrong = clone(trace.calls)
      wrong[0].result.value[field] = field === 'documentId' ? 'different-document' : fixture.initialRevision + 1
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, toolCalls: wrong }).status, 'failed')
    }
    const incomplete = clone(trace.calls)
    const protectedId = evidence.answer.layers[0].id
    incomplete[0].result.value.layers = incomplete[0].result.value.layers.filter(item => item.id !== protectedId)
    assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, toolCalls: incomplete }).status, 'failed')
  } finally { fixture.dispose() }
})

const literalNamedSelectionRequests = [
  ['zh-direct', '孔位标注组'],
  ['zh-casual', '孔位标注组'],
  ['en-direct', 'Hole labels'],
  ['zh-followup', '孔位标注组'],
  ['mixed', '孔位标注组'],
  ['zh-correction', '孔位标注组'],
]
for (const [variant, requestedName] of literalNamedSelectionRequests) test(`round5 exact original named-selection request reaches native catalog: ${variant}`, async () => {
  const scenario = byId.get(`GUS1-cad-query.named-selection-${variant}`)
  assert.ok(scenario.prompt.includes(requestedName), 'The native fixture name must be present literally in the original frozen question')
  const fixture = await buildRound5InventoryFixture(scenario)
  try {
    assert.equal(fixture.requestedSelectionSetName, requestedName)
    const translatedName = requestedName === 'Hole labels' ? '孔位标注组' : 'Hole labels'
    const sets = fixture.document.listObjects({ kind: 'group', type: 'SELECTION_SET' })
    assert.deepEqual(sets.map(item => item.name).sort(), [requestedName, '局部详图'].sort())
    assert.equal(sets.some(item => item.name === translatedName), false, 'No implicit translation alias is added to the native catalog')
    const trace = traceFor(fixture)
    const page = await trace.call('cad_read_selection_sets', { expectedRevision: fixture.initialRevision,
      offset: 0, limit: 20, maxBytes: 65536 })
    assert.equal(page.nextOffset, null)
    const actualTarget = page.selectionSets.find(item => item.name === requestedName)
    assert.ok(actualTarget)
    assert.equal(actualTarget.memberCount, 2)
    assert.deepEqual([...actualTarget.memberIds].sort(), [fixture.identityAliases['TEXT-A'].nativeId,
      fixture.identityAliases['LINE-A'].nativeId].sort())
    const answer = { documentId: page.documentId, revision: page.revision, selectionSets: [{
      id: actualTarget.id, name: actualTarget.name, memberIds: clone(actualTarget.memberIds), memberCount: actualTarget.memberCount }] }
    assert.deepEqual(expectedRound5InventoryAnswer(scenario, fixture), answer, 'The independent answer is taken from the actual requested native set')
    const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls, answer }
    const accepted = evaluateRound5InventoryOracle(scenario, fixture, evidence)
    assert.equal(accepted.status, 'satisfied')
    assert.equal(accepted.scenarioPassed, null, 'Native fixture tests must not claim a real-model pass')
    const wrongAnswers = []
    for (const name of [translatedName, `${requestedName} `, requestedName === 'Hole labels' ? 'hole labels' : '孔位标注']) {
      const wrong = clone(answer); wrong.selectionSets[0].name = name; wrongAnswers.push(wrong)
    }
    const missing = clone(answer); missing.selectionSets[0].memberIds.pop(); missing.selectionSets[0].memberCount--
    wrongAnswers.push(missing)
    const expanded = clone(answer); expanded.selectionSets[0].memberIds.push(fixture.identityAliases['CIRCLE-A'].nativeId); expanded.selectionSets[0].memberCount++
    wrongAnswers.push(expanded)
    const wrongCount = clone(answer); wrongCount.selectionSets[0].memberCount++
    wrongAnswers.push(wrongCount)
    const wrongId = clone(answer); wrongId.selectionSets[0].id = page.selectionSets.find(item => item.name !== requestedName).id
    wrongAnswers.push(wrongId)
    wrongAnswers.push({ ...clone(answer), selectionSets: [] })
    for (const wrong of wrongAnswers) {
      assert.equal(evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, answer: wrong }).status, 'failed')
    }
    const renamedReceipt = clone(trace.calls)
    renamedReceipt[0].result.value.selectionSets.find(item => item.id === actualTarget.id).name = translatedName
    const badReceipt = evaluateRound5InventoryOracle(scenario, fixture, { ...evidence, toolCalls: renamedReceipt })
    assert.equal(badReceipt.status, 'failed')
    assert.equal(badReceipt.assertions.find(item => item.id === 'all-required-native-catalog-records-read').satisfied, false)
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
    assert.equal(fixture.modelCalls, 0)
  } finally { fixture.dispose() }
})
