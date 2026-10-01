import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { frameScenarioPrompt, geologyLiveProtocol, runGeologyUserScenarios } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { assessScenarioReadiness, buildScenarioFixture, expectedScenarioAnswer, scenarioFixtureInputBindings } from '../scripts/testing/preflight-geology-user-scenarios.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const runnable = corpus.scenarios.filter(scenario => assessScenarioReadiness(scenario).status === 'runnable')
const scenarioFor = intent => {
  const scenario = runnable.find(item => item.expected.intent === intent)
  assert.ok(scenario, `Runnable public fixture required: ${intent}`)
  return scenario
}
const inventory = scenarioFor('cad-query.inventory')
const textEdit = scenarioFor('cad-annotation.replace-native-text')
const exactLabel = scenarioFor('cad-query.exact-hole-label')
const usage = Object.freeze({ inputTokens: 19, outputTokens: 7, totalTokens: 26 })
const hash = value => createHash('sha256').update(value).digest('hex')
const identityMarker = 'Public synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. '

function readInputBindings(input) {
  const context = input.messages.find(message => message.role === 'user').content
  const framed = context.slice(context.lastIndexOf(identityMarker) + identityMarker.length)
  return JSON.parse(framed.split('\n\nFor automated review,')[0])
}
function response({ name, args, id = 'fixture-call', content = '' } = {}) {
  return { model: 'deepseek-flash', content, finishReason: name ? 'tool_calls' : 'stop', usage, elapsedMs: 1,
    toolCalls: name ? [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] : [] }
}
function repeatingReadCaller() {
  const requests = []
  return { requests, async call(input) {
    requests.push(structuredClone(input))
    const bindings = readInputBindings(input)
    return response({ name: 'cad_query_drawing', id: 'fixture-read-' + requests.length,
      args: { expectedRevision: bindings.revision, filters: {}, offset: 0, layerOffset: 0, limit: 64, maxLayers: 100, maxBytes: 262144 } })
  } }
}

test('geology live CLI defaults to an explicit zero-request dry run', () => {
  const result = spawnSync(process.execPath, ['scripts/testing/run-geology-user-scenarios.mjs'], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.equal(report.mode, 'dry-run')
  assert.equal(report.modelCalls, 0)
  assert.equal(report.readyScenarios, runnable.length)
  assert.equal(Object.isFrozen(geologyLiveProtocol), true)
  assert.ok(geologyLiveProtocol.maxRequestsPerScenario <= 12)
  assert.ok(geologyLiveProtocol.timeoutMs <= 60000)
})

test('a blocking provider billing or authentication failure halts the batch without hiding failed or unexecuted cases', async () => {
  for (const code of ['PROVIDER_PAYMENT_REQUIRED', 'PROVIDER_AUTH_FAILURE', 'MISSING_API_KEY']) {
    let calls = 0
    const report = await runGeologyUserScenarios({ scenarioIds: [inventory.id, exactLabel.id], maxScenarios: 2, maxRequests: 6,
      modelCall: async () => { calls++; const error = new Error(code); error.code = code; throw error } })
    assert.equal(calls, 1)
    assert.equal(report.selected, 2)
    assert.equal(report.executed, 1)
    assert.equal(report.unexecuted, 1)
    assert.equal(report.haltReason, code)
    assert.equal(report.transportFailures.length, 1)
    assert.equal(report.transportFailures[0].code, code)
    assert.equal(report.allSelectedPassed, false)
    assert.equal(report.evidenceOrigin, 'fixture-oracle-selftest')
    assert.equal(report.passed, 0)
  }
})

test('read answer framing includes only schema placeholders, never independent oracle values', async () => {
  for (const intent of ['cad-query.inventory', 'cad-query.exact-hole-label', 'cad-query.partial-label', 'cad-query.raw-mtext']) {
    const scenario = scenarioFor(intent), fixture = await buildScenarioFixture(scenario)
    try {
      const sentinel = 'UNTRUSTED_EXPECTED_OUTCOME_MUST_NOT_REACH_MODEL'
      const contaminated = { ...scenario, expected: { ...scenario.expected, oracleResult: { secret: sentinel } } }
      const framed = frameScenarioPrompt(contaminated, scenarioFixtureInputBindings(fixture))
      assert.ok(framed.startsWith(scenario.prompt))
      assert.ok(framed.includes('placeholder values are not answers'))
      assert.equal(framed.includes(sentinel), false)
      assert.equal(framed.includes(JSON.stringify(expectedScenarioAnswer(scenario, fixture))), false)
      assert.equal(framed.includes(fixture.manifest.completeMtext), false)
      assert.equal(framed.includes('"geometry"'), false)
      assert.equal(framed.includes('"layerName"'), intent !== 'cad-query.inventory' && intent !== 'cad-query.raw-mtext')
    } finally { fixture.dispose() }
  }
})

test('complete fixture identity inventory is shared across intents and is not a target-only or outcome frame', async () => {
  const fixture = await buildScenarioFixture(textEdit)
  try {
    const bindings = scenarioFixtureInputBindings(fixture)
    assert.deepEqual(Object.keys(bindings.aliases).sort(), Object.keys(fixture.identityAliases).sort())
    assert.ok(Object.keys(bindings.aliases).length > 10)
    for (const [alias, identity] of Object.entries(bindings.aliases)) {
      assert.deepEqual(Object.keys(identity).sort(), ['handle', 'nativeId'])
      assert.equal(identity.nativeId, fixture.identityAliases[alias].nativeId)
      assert.equal(fixture.document.getObject(identity.nativeId).handle, identity.handle)
    }
    for (const scenario of [textEdit, inventory, exactLabel]) {
      const framed = frameScenarioPrompt(scenario, bindings)
      assert.ok(framed.includes(JSON.stringify(bindings)))
      assert.ok(framed.includes('CIRCLE-MANUAL') && framed.includes('MTEXT-B') && framed.includes('LINE-B'))
      assert.equal(framed.includes('"position"'), scenario === exactLabel)
      assert.equal(framed.includes('"payload"'), false)
      if (scenario === textEdit) assert.equal(framed.includes('For automated review,'), false)
    }
  } finally { fixture.dispose() }
})

test('a caller that imitates real provider metadata is still fixture evidence and never a live-model pass', async () => {
  const requests = [], observed = []
  let answer
  const report = await runGeologyUserScenarios({ scenarioIds: [inventory.id], maxScenarios: 1, maxRequests: 5,
    modelCall: async input => {
      requests.push(structuredClone(input))
      const bindings = readInputBindings(input), last = input.messages.at(-1)
      if (last.role === 'user' && requests.length === 1) return response({ name: 'cad_query_drawing', id: 'fixture-inventory',
        args: { expectedRevision: bindings.revision, filters: {}, offset: 0, layerOffset: 0, limit: 64, maxLayers: 100, maxBytes: 262144 } })
      if (last.role === 'tool') {
        const actual = JSON.parse(last.content)
        assert.equal(actual.ok, true)
        const entityCounts = {}
        for (const entity of actual.value.entities) entityCounts[entity.type] = (entityCounts[entity.type] ?? 0) + 1
        answer = { entityCounts }
      }
      return response({ content: JSON.stringify(answer) })
    },
    onScenarioResult: event => {
      observed.push(event)
      assert.equal(event.evidence.origin, 'fixture-oracle-selftest')
      assert.equal(event.result.status, 'message')
      assert.equal(event.evidence.toolCalls.length, 1)
      assert.equal(event.evidence.toolCalls[0].result.ok, true)
      assert.equal(event.evidence.toolCalls[0].result.value.documentId, event.fixture.document.id)
      assert.equal(event.evidence.afterDocument.revision, event.fixture.initialRevision)
    },
  })
  assert.equal(report.evidenceOrigin, 'fixture-oracle-selftest')
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.passed, 0)
  assert.equal(report.failed, 0)
  assert.equal(report.notEvaluated, 1)
  assert.equal(report.executed, 1)
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify(report.scenarios[0]))
  assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.allSelectedPassed, false)
  assert.deepEqual(report.returnedModels, ['deepseek-flash'])
  assert.equal(report.requests, requests.length)
  assert.equal(report.totalTokens, report.requests * usage.totalTokens)
  assert.equal(observed.length, 1)
  assert.equal(report.scenarios[0].originalPromptSha256, hash(inventory.prompt))
  assert.ok(report.trace.every(item => item.usage.totalTokens === 26 && item.returnedModel === 'deepseek-flash'))
  assert.ok(requests.every(item => item.timeoutMs === geologyLiveProtocol.timeoutMs && item.settings.thinking.type === 'disabled'))
  const bindings = readInputBindings(requests[0])
  assert.deepEqual(Object.keys(bindings.aliases).sort(), Object.keys(observed[0].fixture.identityAliases).sort())
})

test('the final proposal tool output comes from actual SDK execution without another provider turn or fabricated result', async () => {
  const requests = []
  let diagnostics
  const report = await runGeologyUserScenarios({ scenarioIds: [textEdit.id], maxScenarios: 1, maxRequests: 5,
    modelCall: async input => {
      requests.push(structuredClone(input))
      const bindings = readInputBindings(input), last = input.messages.at(-1)
      if (last.role === 'user') return response({ name: 'cad_find_text', id: 'fixture-find-target',
        args: { expectedRevision: bindings.revision, search: 'TEST-A', match: 'exact' } })
      assert.equal(last.role, 'tool')
      const read = JSON.parse(last.content)
      assert.equal(read.ok, true)
      assert.equal(read.value.matches.length, 1)
      const match = read.value.matches[0]
      assert.equal(match.id, bindings.aliases['TEXT-A'].nativeId)
      return { ...response({ name: 'cad_propose_text_edit', id: 'fixture-last-proposal',
        args: { expectedRevision: bindings.revision, units: 'millimeter',
          changes: [{ id: match.id, expectedText: match.text, text: match.text + '复核' }] } }),
        toolOutputs: [{ id: 'invented-provider-output', result: { ok: true, value: { status: 'committed' } } }],
      }
    },
    onScenarioResult: event => {
      const output = event.result.toolOutputs.at(-1), actual = event.evidence.toolCalls.at(-1)
      assert.equal(event.result.status, 'proposal')
      assert.equal(event.oracle.status, 'satisfied')
      assert.equal(output.id, 'fixture-last-proposal')
      assert.equal(output.name, 'cad_propose_text_edit')
      assert.equal(output.result.ok, true)
      assert.equal(output.result.value, event.result.proposal)
      assert.equal(actual.result, output.result)
      assert.equal(actual.result.value.status, 'awaiting-host-approval')
      assert.equal(event.evidence.afterDocument.revision, event.fixture.initialRevision)
      assert.equal(event.evidence.toolCalls.some(item => item.id === 'invented-provider-output'), false)
      assert.equal(requests.some(input => input.messages.some(message => message.tool_call_id === 'fixture-last-proposal')), false)
      diagnostics = { beforeRevision: event.fixture.initialRevision, finalToolId: output.id }
    },
  })
  assert.equal(requests.length, 2)
  assert.equal(report.requests, 2)
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify(report.scenarios[0]))
  assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.passed, 0)
  assert.equal(report.allSelectedPassed, false)
  assert.ok(diagnostics)
  assert.equal(JSON.stringify(report).includes('fixture-last-proposal'), false)
  assert.equal(JSON.stringify(report).includes('toolOutputs'), false)
})

test('global budget stops extra execution and selected-but-unexecuted questions remain explicit', async () => {
  const caller = repeatingReadCaller()
  const report = await runGeologyUserScenarios({ scenarioIds: [inventory.id, exactLabel.id], maxScenarios: 2, maxRequests: 3, modelCall: caller.call })
  assert.equal(report.selected, 2)
  assert.equal(report.requests, 3)
  assert.equal(caller.requests.length, 3)
  assert.equal(report.executed, 1)
  assert.equal(report.unexecuted, 1)
  assert.equal(report.scenarios.length, 1)
  assert.equal(report.scenarios[0].requests, 3)
  assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.allSelectedPassed, false)
})

test('per-case limits remain bounded and maxScenarios selects unique known runnable IDs only', async () => {
  const caller = repeatingReadCaller()
  const report = await runGeologyUserScenarios({ scenarioIds: [inventory.id, exactLabel.id], maxScenarios: 2, maxRequests: 100, modelCall: caller.call })
  assert.equal(report.selected, 2)
  assert.equal(report.executed, 2)
  assert.ok(report.requests <= 2 * geologyLiveProtocol.maxRequestsPerScenario)
  assert.ok(report.scenarios.every(row => row.requests > 0 && row.requests <= geologyLiveProtocol.maxRequestsPerScenario))
  const duplicate = await runGeologyUserScenarios({ scenarioIds: [inventory.id, inventory.id, exactLabel.id], maxScenarios: 1, maxRequests: 1,
    modelCall: async () => response({ content: 'No native read was made.' }) })
  assert.equal(duplicate.selected, 1)
  assert.equal(duplicate.requests, 1)
  assert.equal(duplicate.scenarios[0].id, inventory.id)
})

test('invalid budgets, providers and unknown IDs fail before invoking an injected caller', async () => {
  let invoked = 0
  const modelCall = async () => { invoked++; return response({ content: 'Never invoke.' }) }
  for (const options of [{ maxScenarios: 0 }, { maxScenarios: 1081 }, { maxScenarios: 1.5 },
    { maxRequests: 0 }, { maxRequests: 2001 }, { maxRequests: Infinity }, { provider: 'unknown' },
    { scenarioIds: ['UNKNOWN_FROZEN_ID'] }, { scenarioIds: [null] }, { scenarioIds: 'not-an-array' }, { onCheckpoint: true }]) {
    await assert.rejects(runGeologyUserScenarios({ ...options, modelCall }))
  }
  assert.equal(invoked, 0)
})

test('completed-case checkpoints preserve partial failures and cannot mutate the authoritative result', async () => {
  const checkpoints = []
  const report = await runGeologyUserScenarios({ scenarioIds: [inventory.id, exactLabel.id], maxScenarios: 2, maxRequests: 2,
    modelCall: async () => response({ content: 'No native data was read.' }),
    onCheckpoint: checkpoint => {
      checkpoints.push(structuredClone(checkpoint))
      checkpoint.scenarios[0].status = 'INVENTED_PASS'
      checkpoint.passed = 1080
    },
  })
  assert.equal(checkpoints.length, 2)
  assert.equal(checkpoints[0].executed, 1)
  assert.equal(checkpoints[0].unexecuted, 1)
  assert.equal(checkpoints[1].executed, 2)
  assert.equal(checkpoints[1].unexecuted, 0)
  assert.deepEqual(checkpoints.map(item => item.completedScenariosCount), [1, 2])
  assert.ok(checkpoints.every(item => item.scenarios.length === 1 && item.checkpointScope === 'one-completed-case-and-cumulative-totals'))
  assert.ok(checkpoints.every(item => item.trace.every(trace => trace.scenarioId === item.scenarios[0].id)))
  assert.ok(checkpoints.every(item => item.complete === false && item.allSelectedPassed === false && item.passed === 0))
  assert.equal(report.passed, 0)
  assert.equal(report.allSelectedPassed, false)
  assert.equal(report.scenarios.some(item => item.status === 'INVENTED_PASS'), false)
  assert.match(report.executionSurfaceSha256, /^[a-f0-9]{64}$/)
  assert.ok(Object.keys(report.executionSurface).length > 127)
  assert.ok(Object.values(report.executionSurface).every(value => /^[a-f0-9]{64}$/.test(value)))
})

test('secret-shaped provider exceptions never leak raw messages or arbitrary error codes', async () => {
  for (const secret of ['sk-fixture-private-token-never-publish', 'SYNTHETIC_UPPERCASE_PRIVATE_ERROR_SENTINEL']) {
    const progress = []
    const report = await runGeologyUserScenarios({ scenarioIds: [inventory.id], maxScenarios: 1, maxRequests: 1,
      modelCall: async () => { throw Object.assign(new Error('private provider body ' + secret), { code: secret }) },
      onProgress: event => progress.push(event),
    })
    assert.equal(report.requests, 1)
    assert.equal(report.trace.length, 0)
    assert.equal(report.transportFailures[0].code, 'SCENARIO_EXECUTION_FAILURE')
    assert.equal(JSON.stringify({ report, progress }).includes(secret), false)
    assert.equal(JSON.stringify({ report, progress }).includes('private provider body'), false)
    assert.equal(report.realProviderRequests, 0)
  }
  const known = await runGeologyUserScenarios({ scenarioIds: [inventory.id], maxScenarios: 1, maxRequests: 1,
    modelCall: async () => { throw Object.assign(new Error('untrusted private diagnostic body'), { code: 'PROVIDER_HTTP_FAILURE' }) },
  })
  assert.equal(known.transportFailures[0].code, 'PROVIDER_HTTP_FAILURE')
  assert.equal(JSON.stringify(known).includes('untrusted private diagnostic body'), false)
})
