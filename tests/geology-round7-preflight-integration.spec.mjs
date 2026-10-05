import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, expectedScenarioOutcome, scenarioAnswerFrame,
  scenarioFixtureInputBindings, runGeologyScenarioPreflight, evaluateScenarioOracle,
} from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { ROUND7_POINT_PLAN_SCENARIO_IDS, round7PointPlanDescriptor, expectedRound7PointPlanOutcome,
} from '../scripts/testing/helpers/geology-round7-point-plan-oracles.mjs'
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const cases = corpus.scenarios.filter(item => ROUND7_POINT_PLAN_SCENARIO_IDS.includes(item.id))

test('point-plan preparation requires actual mapped physical predicates, not a model pass', async () => {
  const report = await runGeologyScenarioPreflight()
  assert.equal(report.total, 1080)
  assert.equal(report.runnable, 624)
  assert.equal(report.notReady, 456)
  assert.equal(report.fixtureProbes.filter(item => item.branch).length, 40)
  assert.ok(report.fixtureProbes.every(item => item.status === 'built-and-validated'))
  assert.equal(report.modelCalls, 0)
  assert.equal(report.userScenarioPasses, null)
})
for (const scenario of cases) test(`actual point-plan caller facts and empty native document: ${scenario.id}`, async () => {
  assert.equal(assessScenarioReadiness(scenario).status, 'runnable')
  const fixture = await buildScenarioFixture(scenario)
  try {
    const descriptor = round7PointPlanDescriptor(scenario)
    assert.equal(fixture.round7PointPlanOracleId, descriptor.id)
    assert.equal(fixture.fixtureBranch, descriptor.fixtureBranch)
    assert.equal(fixture.document.snapshot().header.units, 'millimeter')
    assert.equal(fixture.document.listEntities().length, 0)
    assert.equal(fixture.document.revision, 0)
    assert.deepEqual(fixture.document.snapshot().opaquePayloads, {})
    const input = scenarioFixtureInputBindings(fixture)
    assert.equal(input.suppliedInputs.completePointLocationInput.input.units, 'meter')
    assert.equal(input.suppliedInputs.completePointLocationInput.input.scale, 1000)
    assert.equal(input.suppliedInputs.completePointLocationInput.input.boreholes.length, 3)
    assert.deepEqual(input.suppliedInputs.completePointLocationInput.input.sectionLines[0].holeIds,
      ['TEST-A', 'TEST-B', 'TEST-C'])
    assert.deepEqual(expectedScenarioOutcome(scenario, fixture), expectedRound7PointPlanOutcome(scenario, fixture))
    assert.equal(scenarioAnswerFrame(scenario), null)
    for (const key of ['commandArgs', 'engineeringEvidence', 'oracleBaselineDocument', 'preview'])
      assert.equal(JSON.stringify(input).includes(key), false, 'No hidden drawing output or expected geometry enters model input')
    const unevaluated = evaluateScenarioOracle(scenario, fixture, undefined)
    assert.equal(unevaluated.status, 'not-evaluated')
    assert.equal(unevaluated.scenarioPassed, null)
  } finally { fixture.dispose() }
})
