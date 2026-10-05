import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildNextScenarioFixture, evaluateNextScenarioOracle, expectedNextScenarioAnswer } from '../scripts/testing/helpers/geology-next-scenario-oracles.mjs'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const scenario = corpus.scenarios.find(item => item.id === 'GUS1-source-section.no-op-redraw-en-direct')
async function actualReadEvidence(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), toolCalls = []
  for (const [name, args] of [
    ['cad_read_drawing', {}],
    ['cad_read_geology_source', { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 }],
    ['cad_read_page', { expectedRevision: fixture.initialRevision, offset: 50, layerOffset: 0 }],
    ['cad_read_history', { expectedRevision: fixture.initialRevision }],
  ]) {
    const result = await session.call(name, args)
    assert.equal(result.ok, true, JSON.stringify(result)); toolCalls.push({ name, args, result })
  }
  const answer = expectedNextScenarioAnswer(scenario, fixture)
  return { origin: 'fixture-oracle-selftest', afterDocument: fixture.document, toolCalls,
    answer, rawFinalAnswer: JSON.stringify(answer), stage: 'completed-read' }
}
const failsAdmission = (fixture, evidence) => {
  const oracle = evaluateNextScenarioOracle(scenario, fixture, evidence)
  assert.equal(oracle.status, 'failed')
  assert.equal(oracle.assertions.find(item => item.id === 'only-successful-native-read-tools').satisfied, false)
  assert.equal(oracle.scenarioPassed, null)
}

test('no-op redraw admits actual read_history together with source and page receipts without mutating native state or claiming model execution', async () => {
  const fixture = await buildNextScenarioFixture(scenario)
  try {
    assert.equal(KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_read_history').effect, 'read')
    const before = fixture.document.serialize(), evidence = await actualReadEvidence(fixture)
    const oracle = evaluateNextScenarioOracle(scenario, fixture, evidence)
    assert.equal(oracle.status, 'satisfied', JSON.stringify(oracle)); assert.equal(oracle.scenarioPassed, null)
    assert.equal(oracle.scenarioExecuted, false)
    assert.equal(fixture.document.serialize(), before)
  } finally { fixture.dispose() }
})

test('invented names and real proposal tools are not read-only even with fabricated success-shaped receipt data', async () => {
  const fixture = await buildNextScenarioFixture(scenario)
  try {
    const evidence = await actualReadEvidence(fixture)
    for (const name of ['cad_read_imaginary_tool', 'cad_propose_undo', 'cad_propose_geology_revision']) {
      const calls = structuredClone(evidence.toolCalls); calls.at(-1).name = name
      failsAdmission(fixture, { ...evidence, toolCalls: calls })
    }
  } finally { fixture.dispose() }
})

test('history from a different actual document, stale native revision, omitted binding or failed real history read are all rejected', async () => {
  const fixture = await buildNextScenarioFixture(scenario)
  try {
    const evidence = await actualReadEvidence(fixture), other = fixture.sdk.createDocument({ units: 'millimeter' })
    const otherSession = new KJAgentToolSession(fixture.sdk, other)
    const foreignArgs = { expectedRevision: other.revision }, foreign = await otherSession.call('cad_read_history', foreignArgs)
    assert.equal(foreign.ok, true)
    failsAdmission(fixture, { ...evidence, toolCalls: [...evidence.toolCalls.slice(0, -1), { name: 'cad_read_history', args: foreignArgs, result: foreign }] })
    const stale = structuredClone(evidence.toolCalls); stale.at(-1).result.value.revision--
    failsAdmission(fixture, { ...evidence, toolCalls: stale })
    const missingBinding = structuredClone(evidence.toolCalls); missingBinding.at(-1).args = {}
    failsAdmission(fixture, { ...evidence, toolCalls: missingBinding })
    const session = new KJAgentToolSession(fixture.sdk, fixture.document), args = { expectedRevision: fixture.initialRevision - 1 }
    const failed = await session.call('cad_read_history', args)
    assert.equal(failed.ok, false)
    failsAdmission(fixture, { ...evidence, toolCalls: [...evidence.toolCalls.slice(0, -1), { name: 'cad_read_history', args, result: failed }] })
  } finally { fixture.dispose() }
})

test('a legitimate actual history read never weakens full-state preservation for an unrelated unapproved edit', async () => {
  const fixture = await buildNextScenarioFixture(scenario)
  try {
    const evidence = await actualReadEvidence(fixture)
    await fixture.document.transact('Unapproved unrelated fixture edit', tx => tx.createEntity('CIRCLE', { center: [950, 950, 0], radius: 3 }, { id: 'read-only-violation' }))
    const oracle = evaluateNextScenarioOracle(scenario, fixture, evidence)
    assert.equal(oracle.status, 'failed')
    assert.equal(oracle.assertions.find(item => item.id === 'read-only-state-unchanged').satisfied, false)
    assert.equal(oracle.scenarioPassed, null)
  } finally { fixture.dispose() }
})
