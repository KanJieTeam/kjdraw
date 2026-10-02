import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, expectedScenarioAnswer, expectedScenarioOutcome,
  scenarioAnswerFrame, scenarioFixtureInputBindings, runGeologyScenarioPreflight, evaluateScenarioOracle,
} from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { HISTORY_ORACLE_SCENARIO_IDS, historyScenarioDescriptor, expectedHistoryScenarioAnswer,
  expectedHistoryScenarioOutcome, historyScenarioAnswerFrame,
} from '../scripts/testing/helpers/geology-history-scenario-oracles.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = corpus.scenarios.filter(item => HISTORY_ORACLE_SCENARIO_IDS.includes(item.id))

test('history readiness adds actual reviewed history fixtures, never model passes', async () => {
  const report = await runGeologyScenarioPreflight()
  assert.equal(report.total, 1080)
  assert.equal(report.runnable, 624)
  assert.equal(report.notReady, 456)
  assert.equal(report.fixtureProbes.filter(item => item.branch).length, 40)
  assert.ok(report.fixtureProbes.every(item => item.status === 'built-and-validated'))
  assert.equal(report.modelCalls, 0)
  assert.equal(report.userScenarioPasses, null)
})

for (const scenario of scenarios) test(`history actual fixture/router integration, not a model pass: ${scenario.id}`, async () => {
  assert.equal(assessScenarioReadiness(scenario).status, 'runnable')
  const fixture = await buildScenarioFixture(scenario)
  try {
    const descriptor = historyScenarioDescriptor(scenario)
    assert.equal(fixture.historyOracleId, descriptor.id)
    assert.equal(fixture.fixtureBranch, descriptor.historyBranch)
    assert.equal(fixture.document.validate().valid, true)
    assert.equal(fixture.document.revision, fixture.initialRevision)
    assert.deepEqual(fixture.document.history, fixture.initialHistory)
    assert.deepEqual(expectedScenarioOutcome(scenario, fixture), expectedHistoryScenarioOutcome(scenario, fixture))
    assert.equal(scenarioAnswerFrame(scenario), historyScenarioAnswerFrame(scenario))
    if (descriptor.kind === 'read-only') {
      assert.deepEqual(expectedScenarioAnswer(scenario, fixture), expectedHistoryScenarioAnswer(scenario, fixture))
      assert.equal(fixture.initialHistory.undoCount, 0)
      assert.equal(fixture.initialHistory.redoCount, 0)
    } else {
      assert.equal(fixture.seedEvidence.approval.ok, true)
      assert.equal(fixture.initialHistory[descriptor.operation === 'undo' ? 'undoCount' : 'redoCount'], 1)
      const bindings = JSON.stringify(scenarioFixtureInputBindings(fixture))
      assert.ok(!bindings.includes(fixture.oracleHistoryTarget.id), 'Expected native history target is not supplied as an answer')
    }
    assert.equal(fixture.scenarioExecuted, false)
    assert.equal(fixture.modelCalls, 0)
    const result = evaluateScenarioOracle(scenario, fixture, undefined)
    assert.equal(result.status, 'not-evaluated')
    assert.equal(result.scenarioPassed, null)
  } finally { fixture.dispose() }
})
