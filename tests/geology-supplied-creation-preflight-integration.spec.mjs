import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, expectedScenarioOutcome, scenarioAnswerFrame,
  scenarioFixtureInputBindings, runGeologyScenarioPreflight, evaluateScenarioOracle,
} from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { SUPPLIED_CREATION_SCENARIO_IDS, suppliedCreationDescriptor, expectedSuppliedCreationOutcome,
} from '../scripts/testing/helpers/geology-supplied-creation-oracles.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = corpus.scenarios.filter(item => SUPPLIED_CREATION_SCENARIO_IDS.includes(item.id))

test('supplied creation input preparation never counts as a real-model pass', async () => {
  const report = await runGeologyScenarioPreflight()
  assert.equal(report.total, 1080)
  assert.equal(report.runnable, 624)
  assert.equal(report.notReady, 456)
  assert.equal(report.fixtureProbes.filter(item => item.branch).length, 40)
  assert.ok(report.fixtureProbes.every(item => item.status === 'built-and-validated'))
  assert.equal(report.modelCalls, 0)
  assert.equal(report.userScenarioPasses, null)
})

for (const scenario of scenarios) test(`actual blank document and supplied creation router: ${scenario.id}`, async () => {
  assert.equal(assessScenarioReadiness(scenario).status, 'runnable')
  const fixture = await buildScenarioFixture(scenario)
  try {
    const descriptor = suppliedCreationDescriptor(scenario)
    assert.equal(fixture.suppliedCreationOracleId, descriptor.id)
    assert.equal(fixture.fixtureBranch, descriptor.fixtureBranch)
    assert.equal(fixture.artifact.format, 'KJD')
    assert.equal(fixture.document.validate().valid, true)
    assert.equal(fixture.document.listEntities().length, 0)
    assert.equal(fixture.document.revision, 0)
    assert.equal(fixture.sourceRecipePresent, false)
    assert.deepEqual(expectedScenarioOutcome(scenario, fixture), expectedSuppliedCreationOutcome(scenario, fixture))
    assert.equal(scenarioAnswerFrame(scenario), null)
    const input = scenarioFixtureInputBindings(fixture)
    assert.equal(input.suppliedInputs.completeGeologyCreation.kind, descriptor.sourceKind)
    assert.equal(input.suppliedInputs.completeGeologyCreation.input.locale,
      descriptor.intent === 'geological-presentation.chinese-column-headings' ? 'zh-CN' : scenario.language === 'en' ? 'en' : 'zh-CN')
    const bindings = JSON.stringify(input)
    for (const forbidden of ['commandArgs', 'engineeringEvidence', 'oracleBaselineDocument', 'preview', 'rootObjectId']) assert.equal(bindings.includes(forbidden), false)
    assert.equal(fixture.scenarioExecuted, false)
    assert.equal(fixture.modelCalls, 0)
    const result = evaluateScenarioOracle(scenario, fixture, undefined)
    assert.equal(result.status, 'not-evaluated')
    assert.equal(result.scenarioPassed, null)
  } finally { fixture.dispose() }
})
