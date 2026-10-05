import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, expectedScenarioOutcome, scenarioAnswerFrame,
  scenarioFixtureInputBindings, runGeologyScenarioPreflight, evaluateScenarioOracle,
} from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS, round6SourceWorkflowDescriptor,
  expectedRound6SourceWorkflowOutcome,
} from '../scripts/testing/helpers/geology-round6-source-workflow-oracles.mjs'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const cases = corpus.scenarios.filter(item => ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS.includes(item.id))

test('source workflow preparation expands only complete original questions, not real model passes', async () => {
  const report = await runGeologyScenarioPreflight()
  assert.equal(report.total, 1080)
  assert.equal(report.runnable, 624)
  assert.equal(report.notReady, 456)
  assert.equal(report.fixtureProbes.filter(item => item.branch).length, 40)
  assert.ok(report.fixtureProbes.every(item => item.status === 'built-and-validated'))
  assert.equal(report.modelCalls, 0)
  assert.equal(report.userScenarioPasses, null)
})

for (const scenario of cases) test(`actual native source workflow router: ${scenario.id}`, async () => {
  assert.equal(assessScenarioReadiness(scenario).status, 'runnable')
  const fixture = await buildScenarioFixture(scenario)
  try {
    const descriptor = round6SourceWorkflowDescriptor(scenario)
    assert.equal(fixture.round6SourceWorkflowOracleId, descriptor.id)
    assert.equal(fixture.fixtureBranch, descriptor.fixtureBranch)
    assert.equal(fixture.artifact.format, 'KJD')
    assert.equal(fixture.document.validate().valid, true)
    assert.deepEqual(expectedScenarioOutcome(scenario, fixture), expectedRound6SourceWorkflowOutcome(scenario, fixture))
    assert.equal(scenarioAnswerFrame(scenario), null)
    const input = scenarioFixtureInputBindings(fixture)
    if (descriptor.kind === 'creation') {
      assert.equal(fixture.document.listEntities().length, 0)
      assert.equal(fixture.document.revision, 0)
      assert.equal(fixture.sourceRecipePresent, false)
      assert.equal(input.suppliedInputs.completeColumnCreation.input.pageHeightMillimeters, 500)
      assert.equal(input.suppliedInputs.completeColumnCreation.input.verticalScaleDenominator, 200)
    } else {
      assert.equal(fixture.sourceRecipePresent, true)
      assert.deepEqual(readGeologyDrawingRecipe(fixture.document, input.drawingId).source, fixture.source)
      assert.ok(fixture.document.listEntities().some(item => item.type === 'HATCH'))
      assert.ok(input.suppliedInputs.confirmedMultiHoleWaterTable || input.suppliedInputs.confirmedBoundaryTable)
    }
    const bindings = JSON.stringify(input)
    for (const field of ['commandArgs', 'engineeringEvidence', 'oracleBaselineDocument', 'oracleExpectedFingerprint', 'preview'])
      assert.equal(bindings.includes(field), false, 'Only complete caller facts and native identities enter model input')
    const unevaluated = evaluateScenarioOracle(scenario, fixture, undefined)
    assert.equal(unevaluated.status, 'not-evaluated')
    assert.equal(unevaluated.scenarioPassed, null)
  } finally { fixture.dispose() }
})
