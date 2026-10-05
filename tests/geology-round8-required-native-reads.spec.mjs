import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { ROUND8_REVIEWED_CHAT_PROTOCOL, ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL,
  round8ReviewedChatStageInputs, frameRound8ReviewedChatStage, runRound8ReviewedChatWorkflow } from '../scripts/testing/helpers/geology-round8-reviewed-chat-driver.mjs'
import { buildRound8ReviewedWorkflowFixture, round8ReviewedWorkflowInputBindings,
  evaluateRound8ReviewedStepOracle } from '../scripts/testing/helpers/geology-round8-reviewed-workflow-oracles.mjs'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = corpus.scenarios.filter(item => ROUND8_REVIEWED_CHAT_PROTOCOL.supportedIntents.includes(item.expected.intent) && !item.sequence)
const mixed = scenarios.find(item => item.id === 'GUS1-source-section.mixed-source-and-manual-edit-zh-direct')
const clone = structuredClone
const readOption = ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL.option
const legacyPrefix = 'This is a caller-declared, separately reviewed workflow. Read the current native recipe and drawing as needed. '
  + 'Prepare exactly one pending proposal for this stage; the host reviews it separately. '
  + 'Do not execute edits, approve proposals, guess absent facts, or redo a completed stage. '
  + 'For the first stage use the caller\'s declared first step only. For the remaining manual stage move the declared IDs by the declared vector. '
  + 'Caller data and identity inventory are inputs, not expected entity output.\n'
function inputOf(messages) {
  const message = messages.filter(item => item.role === 'user' && typeof item.content === 'string' &&
    item.content.includes(ROUND8_REVIEWED_CHAT_PROTOCOL.inputStart)).at(-1)
  const begin = message.content.lastIndexOf(ROUND8_REVIEWED_CHAT_PROTOCOL.inputStart)
  const end = message.content.indexOf(ROUND8_REVIEWED_CHAT_PROTOCOL.inputEnd, begin)
  return JSON.parse(message.content.slice(begin + ROUND8_REVIEWED_CHAT_PROTOCOL.inputStart.length, end))
}
function fixtureAdapter(fault = null) {
  const turns = new Map()
  return { origin: 'fixture-oracle-selftest', model: 'public-scripted-required-native-read-fixture', async call({ messages, settings, stageIndex }) {
    const input = inputOf(messages), data = input.callerInputs
    assert.deepEqual(input.stagePolicy.requiredReadToolNames, ['cad_read_geology_source'])
    assert.deepEqual(input.requiredNativeReadContract.requiredToolCalls[0].arguments,
      { expectedRevision: data.revision, drawingId: data.drawingId })
    assert.equal(input.requiredNativeReadContract.hostWillNotExecuteRequiredReadOnModelsBehalf, true)
    assert.ok(settings.tools.some(tool => tool.function.name === 'cad_read_geology_source'))
    const turn = turns.get(stageIndex) ?? 0
    turns.set(stageIndex, turn + 1)
    const call = (name, args, suffix = '') => ({ id: `required-native-stage-${stageIndex}-${turn}${suffix}`,
      type: 'function', function: { name, arguments: JSON.stringify(args) } })
    const respond = calls => ({ content: fault === 'prior-stage-read' && stageIndex === 1
      ? 'The earlier stage had a source read.' : '', toolCalls: calls, finishReason: 'tool_calls',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, model: this.model })
    if (turn === 0) {
      if (stageIndex === 1 && ['missing-source-read', 'prior-stage-read', 'read-after-proposal'].includes(fault))
        return respond([call('cad_read_drawing', {})])
      const args = { expectedRevision: data.revision, drawingId: data.drawingId, maxBytes: 262144 }
      if (stageIndex === 1 && fault === 'stale-source-read') args.expectedRevision--
      if (stageIndex === 1 && fault === 'failed-source-read') args.drawingId = 'public-missing-native-root'
      return respond([call('cad_read_geology_source', args)])
    }
    if (stageIndex === 1 && turn === 1 && ['stale-source-read', 'failed-source-read'].includes(fault))
      return respond([call('cad_read_drawing', {})])
    if (stageIndex === 0) {
      const declaration = data.suppliedInputs.confirmedMixedChanges ?? data.suppliedInputs.confirmedSelectedWaterTable
      return respond([call('cad_propose_geology_revision', { expectedRevision: data.revision, drawingId: data.drawingId,
        units: declaration.drawingUnits, updates: clone(declaration.waterTable ?? declaration.rows) })])
    }
    const declaration = data.remainingManualDisplacement
    const move = call('cad_propose_move', { expectedRevision: data.revision, units: declaration.units,
      ids: clone(declaration.ids), dx: declaration.dx, dy: declaration.dy })
    if (fault === 'read-after-proposal') return respond([move, call('cad_read_geology_source',
      { expectedRevision: data.revision, drawingId: data.drawingId, maxBytes: 262144 }, '-late')])
    return respond([move])
  } }
}

test('legacy default framing remains byte-identical and opt-in exposes only required native-read protocol, not gold', async () => {
  const fixture = await buildRound8ReviewedWorkflowFixture(mixed)
  try {
    for (const stageIndex of [0, 1]) {
      const context = { revision: fixture.initialRevision + stageIndex,
        ...(stageIndex ? { previousApproval: { status: 'committed', afterRevision: fixture.initialRevision + 1 } } : {}) }
      const legacy = round8ReviewedChatStageInputs(mixed, fixture, stageIndex, context)
      assert.equal(legacy.protocol, ROUND8_REVIEWED_CHAT_PROTOCOL.version)
      assert.equal(Object.hasOwn(legacy.stagePolicy, 'requiredReadToolNames'), false)
      assert.equal(Object.hasOwn(legacy, 'requiredNativeReadContract'), false)
      assert.equal(frameRound8ReviewedChatStage(legacy), legacyPrefix + ROUND8_REVIEWED_CHAT_PROTOCOL.inputStart + JSON.stringify(legacy) + ROUND8_REVIEWED_CHAT_PROTOCOL.inputEnd)
      assert.deepEqual(round8ReviewedChatStageInputs(mixed, fixture, stageIndex, { ...context, readProtocolVersion: 'legacy' }), legacy)
      const required = round8ReviewedChatStageInputs(mixed, fixture, stageIndex, { ...context, readProtocolVersion: readOption })
      assert.equal(required.protocol, ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL.version)
      assert.deepEqual(required.callerInputs, legacy.callerInputs)
      assert.deepEqual(required.stagePolicy.requiredReadToolNames, ['cad_read_geology_source'])
      assert.deepEqual(required.requiredNativeReadContract.requiredReceipt,
        { ok: true, documentId: fixture.document.id, revision: context.revision })
      const frame = frameRound8ReviewedChatStage(required)
      assert.match(frame, /During THIS stage, before proposing ANY change/)
      assert.match(frame, /previous-stage reads and conversational claims do not replace cad_read_geology_source/)
      assert.equal(frame.includes('native recipe and drawing as needed'), false)
      for (const gold of ['beforeContent', 'afterContent', 'unchangedIds', 'afterSource', 'afterUndoCount', 'expectedEntity'])
        assert.equal(frame.includes(`"${gold}"`), false)
      if (!stageIndex) assert.deepEqual(required.callerInputs.suppliedInputs, round8ReviewedWorkflowInputBindings(fixture).suppliedInputs)
    }
    assert.throws(() => round8ReviewedChatStageInputs(mixed, fixture, 0,
      { revision: fixture.initialRevision, readProtocolVersion: 'invented' }), /Unknown reviewed-chat read protocol/)
    await assert.rejects(runRound8ReviewedChatWorkflow(mixed,
      { fixture, modelAdapter: fixtureAdapter(), reviewProposal: () => true, readProtocolVersion: 'invented' }), /Unknown reviewed-chat read protocol/)
  } finally { fixture.dispose() }
})

for (const scenario of scenarios) test(`required-native-reads v3 actual runtime fixture, not a model pass: ${scenario.id}`, async () => {
  const fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, readProtocolVersion: readOption,
      modelAdapter: fixtureAdapter(), reviewProposal: ({ pendingVerdict }) => pendingVerdict.status === 'satisfied' })
    assert.equal(report.status, 'completed', JSON.stringify({ status: report.status, errorCode: report.errorCode }))
    assert.equal(report.verdict.status, 'satisfied')
    assert.equal(report.readProtocolVersion, readOption)
    assert.equal(report.protocol, ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL.version)
    assert.equal(report.approvals, scenario.expected.intent === mixed.expected.intent ? 2 : 1)
    for (const [index, step] of report.steps.entries()) {
      assert.equal(step.toolCalls[0].name, 'cad_read_geology_source')
      assert.equal(step.toolCalls[0].args.expectedRevision, fixture.initialRevision + index)
      assert.equal(step.toolCalls[0].result.value.revision, fixture.initialRevision + index)
      assert.equal(step.pendingVerdict.status, 'satisfied')
      assert.equal(step.committedVerdict.status, 'satisfied')
    }
    assert.equal(report.toolCalls, report.approvals === 2 ? 6 : 3, 'required reads are real model calls, not hidden host reads; postcommit history reads remain counted')
    assert.equal(report.hostVerificationReads, report.approvals)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.realProviderRequests, 0)
    assert.equal(report.scenarioPassed, null)
    assert.equal(report.scenarioExecuted, false)
  } finally { fixture.dispose() }
})

for (const fault of ['missing-source-read', 'prior-stage-read', 'stale-source-read', 'failed-source-read', 'read-after-proposal'])
  test(`required read protocol still refuses ${fault}; no host substitution or retroactive score relaxation`, async () => {
    const fixture = await buildRound8ReviewedWorkflowFixture(mixed)
    try {
      const report = await runRound8ReviewedChatWorkflow(mixed, { fixture, readProtocolVersion: readOption,
        modelAdapter: fixtureAdapter(fault), reviewProposal: () => true })
      assert.notEqual(report.status, 'completed')
      assert.equal(report.approvals, 1)
      assert.equal(report.steps[0].committedVerdict.status, 'satisfied')
      assert.equal(report.verdict.status, 'failed')
      assert.equal(report.evidence.afterDocument.revision, fixture.initialRevision + 1)
      assert.deepEqual(report.evidence.afterDocument.getObject('CIRCLE-MANUAL').payload, fixture.document.getObject('CIRCLE-MANUAL').payload)
      const second = report.steps[1]
      assert.equal(second.toolCalls.some(call => call.name === 'cad_read_drawing' && call.result.ok), true,
        'actual current general drawing read is not scored as an actual native source read')
      assert.equal(report.hostVerificationReads, 1, 'only first committed history is read by verification host; it never supplies a missing model source read')
      const bad = evaluateRound8ReviewedStepOracle(mixed, fixture, 1, second)
      assert.equal(bad.status, 'failed')
      assert.ok(bad.assertions.some(item => !item.satisfied &&
        ['current-document-revision-checked', 'read-retained-source-before-revision', 'all-native-reads-succeeded'].includes(item.id)))
      assert.equal(report.scenarioPassed, null)
    } finally { fixture.dispose() }
  })

test('general non-geology CAD workflow is unchanged and does not gain a required native source read', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Public general geometry setup', tx => tx.createEntity('CIRCLE',
    { center: [10, 20, 0], radius: 3 }, { id: 'GENERAL-MANUAL' }))
  const revision = document.revision, calls = []
  const response = toolCalls => Response.json({ model: 'public-general-cad-fixture', choices: [{
    message: { role: 'assistant', content: '', tool_calls: toolCalls }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })
  const chat = createAiChatRuntime({ endpoint: 'https://public-fixture.invalid/chat/completions',
    model: 'public-general-cad-fixture', captureToolOutputs: true, fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.equal(JSON.stringify(body.messages).includes('requiredNativeReadContract'), false)
      if (!calls.length) {
        calls.push('cad_read_drawing')
        return response([{ id: 'general-read', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' } }])
      }
      const read = JSON.parse(body.messages.find(item => item.role === 'tool' && item.tool_call_id === 'general-read').content)
      assert.equal(read.ok, true)
      assert.equal(read.value.revision, revision)
      calls.push('cad_propose_move')
      return response([{ id: 'general-move', type: 'function', function: { name: 'cad_propose_move',
        arguments: JSON.stringify({ expectedRevision: revision, units: 'millimeter', ids: ['GENERAL-MANUAL'], dx: 10, dy: 0 }) } }])
    } })
  try {
    await chat.restoreLocalState({ drawing: await sdk.writeDocument(document, { format: 'KJD' }),
      history: [], sourceFormat: 'KJD', committed: false })
    const result = await chat.send('Move the manually created circle GENERAL-MANUAL right by 10 millimeters.')
    assert.equal(result.status, 'proposal', JSON.stringify(result.error))
    assert.deepEqual(calls, ['cad_read_drawing', 'cad_propose_move'])
    assert.deepEqual(result.toolOutputs.map(item => item.name), calls)
    assert.equal(chat.revision, revision)
    assert.equal((await chat.approve(result.proposal.planId)).status, 'applied')
    const state = JSON.parse((await chat.exportLocalState()).drawing)
    assert.equal(state.revision, revision + 1)
    assert.deepEqual(state.objects['GENERAL-MANUAL'].payload.center, [20, 20, 0])
    assert.deepEqual(Object.keys(state.opaquePayloads), [])
    assert.equal(canonicalStringify(document.snapshot()).includes('geology-drawing-recipe'), false)
  } finally { chat.destroy(); sdk.closeDocument(document.id) }
})
