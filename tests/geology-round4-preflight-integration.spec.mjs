import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, expectedScenarioAnswer, expectedScenarioOutcome,
  scenarioAnswerFrame, scenarioFixtureInputBindings, runGeologyScenarioPreflight, evaluateScenarioOracle,
} from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { ROUND4_NATIVE_SCENARIO_IDS, round4NativeDescriptor, expectedRound4NativeAnswer,
  expectedRound4NativeOutcome, round4NativeAnswerFrame,
} from '../scripts/testing/helpers/geology-round4-native-oracles.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = corpus.scenarios.filter(item => ROUND4_NATIVE_SCENARIO_IDS.includes(item.id))

test('round4 readiness includes real raw MTEXT DXF inputs, without treating preparation as model success', async () => {
  const report = await runGeologyScenarioPreflight()
  assert.equal(report.total, 1080)
  assert.equal(report.runnable, 624)
  assert.equal(report.notReady, 456)
  assert.equal(report.fixtureProbes.filter(item => item.branch).length, 40)
  assert.ok(report.fixtureProbes.every(item => item.status === 'built-and-validated'))
  assert.equal(report.modelCalls, 0)
  assert.equal(report.userScenarioPasses, null)
})

for (const scenario of scenarios) test(`round4 actual DXF fixture/router integration, not a model pass: ${scenario.id}`, async () => {
  assert.equal(assessScenarioReadiness(scenario).status, 'runnable')
  const fixture = await buildScenarioFixture(scenario)
  try {
    const descriptor = round4NativeDescriptor(scenario)
    assert.equal(fixture.round4NativeOracleId, descriptor.id)
    assert.equal(fixture.fixtureBranch, descriptor.fixtureBranch)
    assert.equal(fixture.artifact.format, 'DXF')
    assert.equal(fixture.document.validate().valid, true)
    assert.equal(fixture.document.revision, fixture.initialRevision)
    assert.deepEqual(expectedScenarioOutcome(scenario, fixture), expectedRound4NativeOutcome(scenario, fixture))
    assert.equal(scenarioAnswerFrame(scenario), round4NativeAnswerFrame(scenario))
    if (descriptor.kind === 'read-only') assert.deepEqual(expectedScenarioAnswer(scenario, fixture), expectedRound4NativeAnswer(scenario, fixture))
    const mtext = fixture.document.getObject(fixture.identityAliases['MTEXT-A'].nativeId)
    assert.equal(mtext.payload.text, '{\\fArial;待核对 Pending review}\\P第二段：合成资料 Synthetic input')
    const bindings = JSON.stringify(scenarioFixtureInputBindings(fixture))
    assert.ok(!bindings.includes('oracleExpectedFingerprint'))
    assert.ok(!bindings.includes('oracleBaselineDocument'))
    assert.equal(fixture.scenarioExecuted, false)
    assert.equal(fixture.modelCalls, 0)
    const result = evaluateScenarioOracle(scenario, fixture, undefined)
    assert.equal(result.status, 'not-evaluated')
    assert.equal(result.scenarioPassed, null)
  } finally { fixture.dispose() }
})
