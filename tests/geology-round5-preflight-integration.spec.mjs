import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, expectedScenarioAnswer, expectedScenarioOutcome,
  scenarioAnswerFrame, scenarioFixtureInputBindings, runGeologyScenarioPreflight, evaluateScenarioOracle,
} from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { ROUND5_INVENTORY_SCENARIO_IDS, round5InventoryDescriptor, expectedRound5InventoryAnswer,
  expectedRound5InventoryOutcome, round5InventoryAnswerFrame,
} from '../scripts/testing/helpers/geology-round5-inventory-oracles.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = corpus.scenarios.filter(item => ROUND5_INVENTORY_SCENARIO_IDS.includes(item.id))

test('round5 actual input preparation remains distinct from real-model execution', async () => {
  const report = await runGeologyScenarioPreflight()
  assert.equal(report.total, 1080)
  assert.equal(report.runnable, 624)
  assert.equal(report.notReady, 456)
  assert.equal(report.fixtureProbes.filter(item => item.branch).length, 40)
  assert.ok(report.fixtureProbes.every(item => item.status === 'built-and-validated'))
  assert.equal(report.modelCalls, 0)
  assert.equal(report.userScenarioPasses, null)
})

for (const scenario of scenarios) test(`round5 full router and native input integration: ${scenario.id}`, async () => {
  assert.equal(assessScenarioReadiness(scenario).status, 'runnable')
  const fixture = await buildScenarioFixture(scenario)
  try {
    const descriptor = round5InventoryDescriptor(scenario)
    assert.equal(fixture.round5InventoryOracleId, descriptor.id)
    assert.equal(fixture.fixtureBranch, descriptor.fixtureBranch)
    assert.equal(fixture.artifact.format, descriptor.intent === 'cad-query.named-selection' ? 'KJD' : 'DXF')
    assert.equal(fixture.document.validate().valid, true)
    assert.equal(fixture.document.revision, fixture.initialRevision)
    assert.deepEqual(expectedScenarioOutcome(scenario, fixture), expectedRound5InventoryOutcome(scenario, fixture))
    assert.equal(scenarioAnswerFrame(scenario), round5InventoryAnswerFrame(scenario))
    if (descriptor.kind === 'read-only') assert.deepEqual(expectedScenarioAnswer(scenario, fixture), expectedRound5InventoryAnswer(scenario, fixture))
    const bindings = JSON.stringify(scenarioFixtureInputBindings(fixture))
    for (const forbidden of ['oracleExpectedFingerprint', 'oracleBaselineDocument', 'PUBLIC-HIDDEN']) assert.equal(bindings.includes(forbidden), false)
    assert.equal(fixture.scenarioExecuted, false)
    assert.equal(fixture.modelCalls, 0)
    const result = evaluateScenarioOracle(scenario, fixture, undefined)
    assert.equal(result.status, 'not-evaluated')
    assert.equal(result.scenarioPassed, null)
  } finally { fixture.dispose() }
})
