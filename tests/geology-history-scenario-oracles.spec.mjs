import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { HISTORY_ORACLE_SCENARIO_IDS, HISTORY_SCENARIO_DESCRIPTORS, assessHistoryScenarioReadiness,
  buildHistoryScenarioFixture, evaluateHistoryScenarioOracle, expectedHistoryScenarioAnswer, expectedHistoryScenarioOutcome,
  historyScenarioAnswerFrame, historyScenarioDescriptor, historyScenarioInputBindings } from '../scripts/testing/helpers/geology-history-scenario-oracles.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const byId = new Map(corpus.scenarios.map(scenario => [scenario.id, scenario]))
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

test('real history oracle adds exactly 18 original variants and no browser/sequence shortcuts', () => {
  assert.equal(HISTORY_SCENARIO_DESCRIPTORS.length, 3)
  assert.equal(HISTORY_ORACLE_SCENARIO_IDS.length, 18)
  const unknown = corpus.scenarios.find(scenario => scenario.expected.intent === 'cad-persistence.refresh-pending-proposal')
  assert.equal(assessHistoryScenarioReadiness(unknown).status, 'not-ready')
  const sequence = corpus.scenarios.find(scenario => scenario.sequence && scenario.expected.intent === 'cad-persistence.undo-latest-commit')
  if (sequence) assert.equal(assessHistoryScenarioReadiness(sequence).status, 'not-ready')
})

for (const id of HISTORY_ORACLE_SCENARIO_IDS) test(`real history SDK selftest, zero model calls: ${id}`, async () => {
  const scenario = byId.get(id), fixture = await buildHistoryScenarioFixture(scenario)
  try {
    assert.equal(fixture.scenarioExecuted, false)
    assert.equal(fixture.modelCalls, 0)
    assert.equal(fixture.document.validate().valid, true)
    const trace = traceFor(fixture), descriptor = historyScenarioDescriptor(scenario)
    const history = await trace.call('cad_read_history', { expectedRevision: fixture.initialRevision })
    assert.deepEqual(history.history, fixture.initialHistory)
    let proposal
    if (descriptor.kind === 'history') {
      assert.equal(fixture.seedEvidence.approval.ok, true)
      const gold = expectedHistoryScenarioOutcome(scenario, fixture)
      proposal = await trace.call(`cad_propose_${descriptor.operation}`, { expectedRevision: fixture.initialRevision,
        units: 'millimeter', targetHistoryId: gold.target.id })
    } else {
      assert.equal(fixture.initialHistory.undoCount, 0)
      assert.equal(fixture.initialHistory.redoCount, 0)
    }
    const evidence = { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls: trace.calls,
      answer: expectedHistoryScenarioAnswer(scenario, fixture), proposal, stage: 'pending-preview' }
    const pending = evaluateHistoryScenarioOracle(scenario, fixture, evidence)
    assert.equal(pending.status, 'satisfied', JSON.stringify(pending.assertions?.filter(item => !item.satisfied)))
    assert.equal(pending.scenarioPassed, null)
    assert.equal(pending.scenarioExecuted, false)
    if (proposal) {
      const tampered = clone(proposal)
      tampered.arguments.targetHistoryId += '-wrong'
      assert.equal(evaluateHistoryScenarioOracle(scenario, fixture, { ...evidence, proposal: tampered }).status, 'failed')
      const receipt = await trace.session.approve(proposal.planId, 'public-history-oracle-selftest')
      assert.equal(receipt.ok, true, JSON.stringify(receipt.error))
      const committed = evaluateHistoryScenarioOracle(scenario, fixture, { ...evidence, stage: 'committed', approvalReceipt: receipt,
        approvedPlanId: proposal.planId })
      assert.equal(committed.status, 'satisfied', JSON.stringify(committed.assertions?.filter(item => !item.satisfied)))
      assert.equal(committed.scenarioPassed, null)
      const state = fixtureStateSignature(fixture.document)
      assert.equal((await trace.session.approve(proposal.planId, 'public-history-oracle-selftest')).ok, false)
      assert.equal(fixtureStateSignature(fixture.document), state)
      if (scenario.id.endsWith('-zh-direct')) {
        const bytes = await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' })
        const recovered = await fixture.sdk.readDocument(bytes, { format: 'DXF' })
        const native = document => document.listEntities().map(entity => ({ handle: entity.handle, type: entity.type,
          payload: { ...entity.payload, layerId: document.getObject(entity.payload.layerId)?.name,
            ...(entity.payload.styleId ? { styleId: document.getObject(entity.payload.styleId)?.name } : {}) } })).sort((a, b) => a.handle.localeCompare(b.handle))
        assert.deepEqual(native(recovered), native(fixture.document), 'Every restored native geometry/text/handle/property survives actual DXF export and reopen')
      }
    } else {
      assert.equal(evaluateHistoryScenarioOracle(scenario, fixture, { ...evidence, answer: {} }).status, 'failed')
      assert.equal(evaluateHistoryScenarioOracle(scenario, fixture, { ...evidence, toolCalls: [] }).status, 'failed')
    }
  } finally { fixture.dispose() }
})

test('history oracle requires current native receipt, not a chat claim or alternate guessed inverse edit', async () => {
  const scenario = corpus.scenarios.find(item => item.id === 'GUS1-cad-persistence.undo-latest-commit-zh-direct')
  const fixture = await buildHistoryScenarioFixture(scenario)
  try {
    const trace = traceFor(fixture), id = fixture.identityAliases['TEXT-A'].nativeId
    const before = fixture.document.getObject(id)
    const inverse = await trace.call('cad_propose_text_edit', { expectedRevision: fixture.initialRevision, units: 'millimeter',
      changes: [{ id, expectedText: before.payload.text, text: 'TEST-A' }] })
    const verdict = evaluateHistoryScenarioOracle(scenario, fixture, { origin: 'fixture-oracle-selftest', afterDocument: fixture.document,
      toolCalls: trace.calls, proposal: inverse, stage: 'pending-preview' })
    assert.equal(verdict.status, 'failed')
    assert.ok(verdict.assertions.some(item => item.id === 'real-engine-history-targets' && !item.satisfied))
    assert.ok(verdict.assertions.some(item => item.id === 'exact-undo-target-identity' && !item.satisfied))
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
  } finally { fixture.dispose() }
})

test('history fixture publishes aliases but does not supply future undo/redo targets as model answers', async () => {
  const fixture = await buildHistoryScenarioFixture('GUS1-cad-persistence.undo-latest-commit-zh-direct')
  try {
    const bindings = historyScenarioInputBindings(fixture)
    assert.ok(!JSON.stringify(bindings).includes(fixture.oracleHistoryTarget.id))
    assert.ok(!JSON.stringify(bindings).includes('oracleHistory'))
    assert.ok(!historyScenarioAnswerFrame('cad-persistence.read-undo-redo-history').includes(fixture.document.id))
  } finally { fixture.dispose() }
})
