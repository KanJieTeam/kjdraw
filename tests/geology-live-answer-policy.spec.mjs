import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { frameScenarioPrompt, geologyScenarioAnswerFrame, runGeologyUserScenarios,
  geologyLiveProtocol, geologyLiveProtocolV4, geologyLiveProtocolV5, geologyLiveProtocolV5JsonObject,
  geologyLiveProtocolV5NativePolicy, geologyLiveProtocolV5JsonObjectNativePolicy,
} from '../scripts/testing/run-geology-user-scenarios.mjs'
import { scenarioAnswerFrame, scenarioFixtureInputBindings } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { ROUND4_READ_ANSWER_POLICY_INTENTS, round4ReadAnswerFrameWithPolicy } from '../scripts/testing/helpers/geology-read-answer-policy.mjs'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const policy = 'native-policy-codes-v1'
const optIn = { answerContractVersion: 'v5', answerPolicyVersion: policy }
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const identityMarker = 'Public synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. '
const bindings = input => JSON.parse(input.messages.find(message => message.role === 'user').content.split(identityMarker).at(-1).split('\n\nFor automated review,')[0])
const call = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const response = (content, toolCalls = []) => ({ model: 'fixture-not-real-provider', content, toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 19, outputTokens: 7, totalTokens: 26 }, elapsedMs: 1 })

function archivedPrompt(scenario, bound, answerContractVersion) {
  let prompt = scenario.prompt
  if (bound) prompt += `\n\n${identityMarker}${JSON.stringify(bound)}`
  const frame = scenarioAnswerFrame(scenario, { answerContractVersion })
  if (frame) {
    const instruction = answerContractVersion === 'v5'
      ? 'For automated review, return only one strict JSON answer instance. If the frame contains responseSchema, validate the answer against responseSchema. The outer version, responseSchema, nativePaths and rules are protocol documentation, NOT answer properties: do not copy them into your answer. Otherwise use only the declared answer fields. Placeholder values are not answers. Public answer frame: '
      : 'For automated review, return your final answer as strict JSON only, with this field structure (placeholder values are not answers): '
    prompt += `\n\n${instruction}${frame}. Read the actual native CAD data first. Do not change the drawing. Do not invent values or omit matching records. Do not use Markdown fences or add explanatory prose.`
  }
  return prompt
}

test('all four legacy protocol objects preserve their exact archived hashes', () => {
  for (const [protocol, hash] of [
    [geologyLiveProtocol, 'd920bcd844b88a7bdedb38d51283c96f3d39b97da4eaef795c91f12fcf73a069'],
    [geologyLiveProtocolV4, 'ef8864b22c671e59e9e9198e59c094f816034b4011842f116d21b1ffef45f0a2'],
    [geologyLiveProtocolV5, '2f9b6b87e850c744acc35741d822d1ecd371258e06ae255125c3a2242fb6cecb'],
    [geologyLiveProtocolV5JsonObject, 'd820c721a520251c74c4628e84d0a3b4c9802e3edcbe33265bc4f96bec4613e3'],
  ]) assert.equal(digest(protocol), hash)
})

test('native-policy text and JSON modes have distinct fixed explicit protocols and the same existing request budget', () => {
  assert.equal(digest(geologyLiveProtocolV5NativePolicy), 'a1658c6c886333a894e1d30f7a69d14ab6fccceb33847c87ca5bbeec7c0340de')
  assert.equal(digest(geologyLiveProtocolV5JsonObjectNativePolicy), 'ce6edca935366d18002827248e8d9c5d1912669eae34cc3e708016d34ae44082')
  for (const protocol of [geologyLiveProtocolV5NativePolicy, geologyLiveProtocolV5JsonObjectNativePolicy]) {
    assert.equal(protocol.answerContractVersion, 'v5')
    assert.equal(protocol.answerPolicyVersion, policy)
    assert.equal(protocol.maxRequestsPerScenario, 12)
    assert.equal(protocol.timeoutMs, 60000)
    assert.match(protocol.publicAnswerPolicyFrame, /archived legacy evidence is never rescored/)
  }
})

test('every frozen legacy frame and complete prompt remains byte-identical for every old contract', () => {
  for (const answerContractVersion of ['v3', 'v4', 'v5']) for (const scenario of corpus.scenarios) {
    assert.equal(geologyScenarioAnswerFrame(scenario, { answerContractVersion }), scenarioAnswerFrame(scenario, { answerContractVersion }))
    assert.equal(geologyScenarioAnswerFrame(scenario, { answerContractVersion, answerPolicyVersion: 'legacy' }), scenarioAnswerFrame(scenario, { answerContractVersion }))
    const bound = { documentId: 'public-test-document', revision: 0, aliases: {} }
    assert.equal(frameScenarioPrompt(scenario, bound, { answerContractVersion }), archivedPrompt(scenario, bound, answerContractVersion))
    assert.equal(frameScenarioPrompt(scenario, bound, { answerContractVersion, answerPolicyVersion: 'legacy' }), archivedPrompt(scenario, bound, answerContractVersion))
    assert.ok(frameScenarioPrompt(scenario, bound, { answerContractVersion }).startsWith(scenario.prompt))
  }
})

test('only the twelve intended read frames change, with no substituted questions, identities or values', () => {
  let changed = 0
  for (const scenario of corpus.scenarios) {
    const legacy = geologyScenarioAnswerFrame(scenario, { answerContractVersion: 'v5' }), actual = geologyScenarioAnswerFrame(scenario, optIn)
    if (ROUND4_READ_ANSWER_POLICY_INTENTS.includes(scenario.expected.intent)) {
      changed++
      assert.equal(actual, round4ReadAnswerFrameWithPolicy(scenario, { answerPolicyVersion: policy }))
      assert.ok(actual.startsWith(`${legacy}\n`))
      const addition = actual.slice(legacy.length)
      assert.match(addition, /"owner-local" means native definition coordinates/)
      assert.doesNotMatch(addition, /TEST-|LINE-|entity-|block-|drawing-|\[\s*\d|connected\s*[:=]/)
    } else {
      assert.equal(actual, legacy)
      assert.equal(frameScenarioPrompt(scenario, null, optIn), archivedPrompt(scenario, null, 'v5'))
    }
    const prompt = frameScenarioPrompt(scenario, null, optIn)
    assert.ok(prompt.startsWith(scenario.prompt), 'The original literal request is not rewritten')
  }
  assert.equal(changed, 12)
})

test('invalid policies and non-v5 opt-in requests fail before any model caller', async () => {
  let invoked = 0
  for (const options of [
    { answerContractVersion: 'v3', answerPolicyVersion: policy },
    { answerContractVersion: 'v4', answerPolicyVersion: policy },
    { answerContractVersion: 'v5', answerPolicyVersion: 'invented' },
  ]) {
    await assert.rejects(runGeologyUserScenarios({ ...options, modelCall: async () => { invoked++; return response('{}') } }))
    assert.throws(() => frameScenarioPrompt(corpus.scenarios[0], null, options))
  }
  assert.equal(invoked, 0)
})

for (const answerEncoding of ['text', 'json-object']) test(`native-policy ${answerEncoding} CLI dry-run performs zero requests and declares its new protocol`, () => {
  const run = spawnSync(process.execPath, ['scripts/testing/run-geology-user-scenarios.mjs', '--answer-contract-version', 'v5',
    '--answer-encoding', answerEncoding, '--answer-policy-version', policy], { encoding: 'utf8', windowsHide: true })
  assert.equal(run.status, 0, run.stderr)
  const report = JSON.parse(run.stdout)
  assert.equal(report.modelCalls, 0)
  assert.equal(report.mode, 'dry-run')
  assert.equal(report.answerPolicyVersion, policy)
  assert.equal(report.version, answerEncoding === 'text' ? geologyLiveProtocolV5NativePolicy.version : geologyLiveProtocolV5JsonObjectNativePolicy.version)
})

function nativeCaller(scenario, { wrongValue = false, omitRead = false } = {}) {
  const requests = []
  return { requests, async modelCall(input) {
    requests.push(structuredClone(input))
    const bound = bindings(input), topology = scenario.expected.intent === 'cad-query.endpoint-topology'
    if (omitRead) return response('{}')
    if (requests.length === 1) return response('Read actual native data first.', [
      ...(topology ? [call('cad_query_topology', { expectedRevision: bound.revision, units: 'millimeter',
        ids: ['LINE-A', 'LINE-B'].map(alias => bound.aliases[alias].nativeId), tolerance: 0.01, maxBytes: 262144 }, 'actual-topology')] : []),
      call('cad_query_drawing', { expectedRevision: bound.revision, filters: { ids: (topology ? ['LINE-A', 'LINE-B'] : ['LINE-A']).map(alias => bound.aliases[alias].nativeId) },
        offset: 0, layerOffset: 0, limit: 64, maxLayers: 100, maxBytes: 262144 }, 'actual-native-object')])
    assert.equal(requests.length, 2, 'No hidden retries or new policy-only calls')
    const receipt = JSON.parse(input.messages.at(-1).content)
    assert.equal(receipt.ok, true)
    const current = receipt.value
    const header = { documentId: current.documentId, revision: current.revision, units: current.units }
    let answer
    if (topology) {
      const topologyReceipt = input.messages.find(message => message.role === 'tool' && message.tool_call_id === 'actual-topology')
      const topologyResult = JSON.parse(topologyReceipt.content)
      assert.equal(topologyResult.ok, true)
      const nativeTopology = topologyResult.value
      const a = current.entities.find(entity => entity.id === bound.aliases['LINE-A'].nativeId)
      const b = current.entities.find(entity => entity.id === bound.aliases['LINE-B'].nativeId)
      const connections = []
      for (const fromFeature of ['start', 'end']) for (const toFeature of ['start', 'end']) {
        const distance = Math.hypot(...a.geometry[fromFeature].map((value, index) => value - b.geometry[toFeature][index]))
        if (a.ownerId === b.ownerId && distance <= nativeTopology.tolerance)
          connections.push({ fromId: a.id, fromFeature, toId: b.id, toFeature, distance })
      }
      answer = { ...header, tolerance: nativeTopology.tolerance, coordinateSpace: nativeTopology.coordinateSpace,
        semanticInference: nativeTopology.semanticInference, connections, connected: connections.length > 0 }
    }
    else {
      const entity = current.entities.find(entity => entity.id === bound.aliases['LINE-A'].nativeId)
      const layer = current.layers.find(layer => layer.id === entity.layerId)
      assert.ok(layer)
      answer = { ...header, entity: { id: entity.id, handle: bound.aliases['LINE-A'].handle, type: entity.type, ownerId: entity.ownerId,
        coordinateSpace: 'owner-local', start: entity.geometry.start, end: entity.geometry.end, layer } }
    }
    if (wrongValue) topology ? answer.tolerance += 0.01 : answer.entity.end[0] += 0.01
    return response(JSON.stringify(answer))
  } }
}

for (const [provider, answerEncoding] of [['qwen', 'text'], ['deepseek', 'json-object']])
  for (const intent of ROUND4_READ_ANSWER_POLICY_INTENTS) test(`actual read and strict scoring with ${provider}/${answerEncoding}/${intent}`, async () => {
    const scenario = corpus.scenarios.find(scenario => scenario.expected.intent === intent && scenario.id.endsWith('-zh-direct'))
    const caller = nativeCaller(scenario), events = []
    const report = await runGeologyUserScenarios({ ...optIn, provider, answerEncoding, scenarioIds: [scenario.id],
      maxScenarios: 1, maxRequests: 3, modelCall: caller.modelCall, onScenarioResult: event => events.push(event) })
    assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify(report.scenarios[0]))
    assert.equal(report.protocol, answerEncoding === 'text' ? geologyLiveProtocolV5NativePolicy : geologyLiveProtocolV5JsonObjectNativePolicy)
    assert.equal(report.requests, 2)
    assert.equal(report.totalTokens, 52)
    assert.equal(report.realProviderRequests, 0)
    assert.equal(report.evidenceOrigin, 'fixture-oracle-selftest')
    assert.equal(report.passed, 0)
    assert.equal(report.scenarios[0].passed, null)
    assert.equal(report.allSelectedPassed, false)
    const { fixture, evidence } = events[0]
    const shape = geologyScenarioAnswerFrame(scenario, optIn)
    assert.equal(report.scenarios[0].answerFrameSha256, digest(shape))
    assert.equal(report.scenarios[0].originalPromptSha256, digest(scenario.prompt))
    assert.equal(report.scenarios[0].promptSha256, digest(frameScenarioPrompt(scenario, scenarioFixtureInputBindings(fixture), optIn)))
    assert.ok(caller.requests.every(request => answerEncoding === 'text'
      ? !Object.hasOwn(request.settings, 'response_format') : request.settings.response_format.type === 'json_object'))
    assert.ok(report.trace.every(trace => answerEncoding === 'text' ? !Object.hasOwn(trace, 'responseFormat') : trace.responseFormat.type === 'json_object'))
    assert.equal(evidence.hostApprovalApplied, false)
    assert.equal(evidence.approvalReceipt, null)
    assert.equal(evidence.afterDocument.history.undoCount, 0)
    assert.equal(evidence.afterDocument.fingerprint(), fixture.oracleBaselineDocument.fingerprint())
    assert.equal(report.executionSurface['scripts/testing/helpers/geology-read-answer-policy.mjs'], '67c656207962c100b68b7dda301c1e03e6ce8d9cc242d89a592c572aea884028')
    assert.ok(report.executionSurface['scripts/testing/helpers/geology-supplied-creation-oracles.mjs'])
    assert.ok(report.executionSurface['scripts/testing/helpers/geology-answer-encoding.mjs'], 'Text mode also executes encoding validation/format selection; hash this real dependency in both modes')
    assert.ok(report.executionSurface['tests/geology-supplied-creation-preflight-integration.spec.mjs'])
  })

for (const [name, options] of [['wrong actual value', { wrongValue: true }], ['no actual native read', { omitRead: true }]])
  test(`new public policy does not rescue ${name}`, async () => {
    const scenario = corpus.scenarios.find(scenario => scenario.expected.intent === 'cad-query.native-object' && scenario.id.endsWith('-zh-direct'))
    const caller = nativeCaller(scenario, options)
    const report = await runGeologyUserScenarios({ ...optIn, answerEncoding: 'json-object', scenarioIds: [scenario.id],
      maxScenarios: 1, maxRequests: 3, modelCall: caller.modelCall })
    assert.equal(report.scenarios[0].status, 'failed')
    assert.equal(report.realProviderRequests, 0)
    assert.equal(report.passed, 0)
    assert.equal(report.scenarios[0].passed, null)
  })

test('native-policy mode retains the existing global request budget without a hidden final-answer call', async () => {
  const scenario = corpus.scenarios.find(scenario => scenario.expected.intent === 'cad-query.native-object' && scenario.id.endsWith('-zh-direct'))
  const caller = nativeCaller(scenario)
  const report = await runGeologyUserScenarios({ ...optIn, answerEncoding: 'json-object', scenarioIds: [scenario.id],
    maxScenarios: 1, maxRequests: 1, modelCall: caller.modelCall })
  assert.equal(caller.requests.length, 1)
  assert.equal(report.requests, 1)
  assert.equal(report.totalTokens, 26)
  assert.notEqual(report.scenarios[0].status, 'satisfied')
})
