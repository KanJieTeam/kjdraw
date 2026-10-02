import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, expectedScenarioAnswer, expectedScenarioOutcome,
  scenarioAnswerFrame, scenarioFixtureInputBindings, runGeologyScenarioPreflight, evaluateScenarioOracle,
} from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { ROUND3_ORACLE_SCENARIO_IDS, round3ScenarioDescriptor, expectedRound3ScenarioAnswer,
  expectedRound3ScenarioOutcome, round3ScenarioAnswerFrame,
} from '../scripts/testing/helpers/geology-round3-scenario-oracles.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = corpus.scenarios.filter(item => ROUND3_ORACLE_SCENARIO_IDS.includes(item.id))

test('round3 readiness constructs its real branches, without claiming a model execution', async () => {
  const report = await runGeologyScenarioPreflight()
  assert.equal(report.total, 1080)
  assert.equal(report.runnable, 624)
  assert.equal(report.notReady, 456)
  assert.equal(report.fixtureProbes.filter(item => item.branch).length, 40)
  assert.ok(report.fixtureProbes.every(item => item.status === 'built-and-validated'))
  assert.equal(report.modelCalls, 0)
  assert.equal(report.userScenarioPasses, null)
})

for (const scenario of scenarios) test(`round3 real fixture/router integration, not a model pass: ${scenario.id}`, async () => {
  assert.equal(assessScenarioReadiness(scenario).status, 'runnable')
  const fixture = await buildScenarioFixture(scenario)
  try {
    const descriptor = round3ScenarioDescriptor(scenario)
    assert.equal(fixture.round3OracleDescriptorId, descriptor.id)
    assert.equal(fixture.artifact.format, 'KJD')
    assert.equal(fixture.document.validate().valid, true)
    assert.equal(fixture.document.revision, fixture.initialRevision)
    assert.deepEqual(expectedScenarioOutcome(scenario, fixture), expectedRound3ScenarioOutcome(scenario, fixture))
    assert.equal(scenarioAnswerFrame(scenario), round3ScenarioAnswerFrame(scenario))
    if (descriptor.kind === 'read-only')
      assert.deepEqual(expectedScenarioAnswer(scenario, fixture), expectedRound3ScenarioAnswer(scenario, fixture))
    const bindings = JSON.stringify(scenarioFixtureInputBindings(fixture))
    assert.ok(!bindings.includes('oracleExpectedCommittedState'))
    assert.ok(!bindings.includes('oracleDriftedEntityIds'))
    const result = evaluateScenarioOracle(scenario, fixture, undefined)
    assert.equal(result.status, 'not-evaluated')
    assert.equal(result.scenarioPassed, null)
  } finally { fixture.dispose() }
})
