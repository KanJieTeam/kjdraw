import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { buildScenarioFixture, evaluateScenarioOracle, expectedScenarioAnswer, normalizeScenarioAnswerUnits,
  scenarioAnswerFrame } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))

test('unit spelling normalization never changes measurements, labels or non-unit metadata', () => {
  const value = { units: 'm', sourceUnits: 'metre', cadUnits: 'mm', depth: 18, text: 'metre', sourceConvention: 'meter',
    measurements: [{ units: 'millimetre', value: 1000 }], unknown: { units: 'foot' } }
  const original = structuredClone(value), normalized = normalizeScenarioAnswerUnits(value)
  assert.deepEqual(normalized, { ...value, units: 'meter', sourceUnits: 'meter', cadUnits: 'millimeter',
    measurements: [{ units: 'millimeter', value: 1000 }] })
  assert.deepEqual(value, original)
})

test('retained source unit answers accept native spelling but reject 1000 wrong-unit or wrong-arithmetic variants', async () => {
  const scenario = corpus.scenarios.find(item => item.expected.intent === 'source-query.water-depth-to-elevation' && item.language === 'en')
  const fixture = await buildScenarioFixture(scenario)
  try {
    const session = new KJAgentToolSession(fixture.sdk, fixture.document)
    const args = { expectedRevision: fixture.initialRevision, drawingId: fixture.drawingId, maxBytes: 262144 }
    const result = await session.call('cad_read_geology_source', args)
    assert.equal(result.ok, true)
    assert.equal(result.value.units, 'millimeter')
    assert.equal(result.value.sourceUnits, 'meter')
    const answer = expectedScenarioAnswer(scenario, fixture)
    answer.units = result.value.sourceUnits
    answer.sourceConvention = result.value.depthConvention
    const evaluate = answer => evaluateScenarioOracle(scenario, fixture, { origin: 'fixture-oracle-selftest',
      afterDocument: fixture.document, toolCalls: [{ name: 'cad_read_geology_source', args, result }], answer })
    assert.equal(evaluate(answer).status, 'satisfied')
    for (let index = 1; index <= 500; index++) {
      assert.equal(evaluate({ ...answer, units: 'millimeter', stableWaterElevation: answer.stableWaterElevation + index }).status, 'failed')
      assert.equal(evaluate({ ...answer, stableWaterElevation: answer.stableWaterElevation + index }).status, 'failed')
    }
    assert.equal(evaluate({ ...answer, units: 'millimeter' }).status, 'failed', 'correct number in wrong physical units still fails')
    assert.equal(evaluate({ ...answer, sourceConvention: 'millimeter' }).status, 'failed')
    const frame = scenarioAnswerFrame(scenario)
    assert.ok(frame.includes('exact depthConvention code returned by cad_read_geology_source'))
    assert.equal(frame.includes(answer.sourceConvention), false, 'the output frame does not contain the expected code')
  } finally { fixture.dispose() }
})

test('negative answer grammar declares alternatives and native fields without secret verdict tokens', () => {
  const scenario = corpus.scenarios.find(item => item.expected.intent === 'invalid-source.negative-water-depth')
  const frame = scenarioAnswerFrame(scenario)
  assert.ok(frame.includes('blocked or clarification-required'))
  assert.ok(frame.includes('minimum'))
  assert.ok(frame.includes('relation'))
  assert.ok(frame.includes('native field paths'))
  for (const token of ['validDepthOrMissing', 'validIntervalBounds', 'unambiguousFieldUpdate', '106.5', '102.5']) {
    assert.equal(frame.includes(token), false)
  }
})
