import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runGeologyUserScenarios, frameScenarioPrompt } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { buildScenarioFixture, scenarioFixtureInputBindings } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createGeologyScenarioRuntimeState } from '../scripts/testing/helpers/geology-runner-history-transfer.mjs'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const scenario = corpus.scenarios.find(item => item.expected.intent === 'cad-annotation.replace-native-text')
const marker = 'Public synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. '
const bindings = input => JSON.parse(input.messages.find(message => message.role === 'user').content.split(marker).at(-1).split('\n\nFor automated review,')[0])
const call = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const usage = { inputTokens: 19, outputTokens: 7, totalTokens: 26 }

function caller({ duplicate = true, unrequestedSecond = false, alias = 'TEXT-A', edit = text => text + '复核' } = {}) {
  const requests = []
  return { requests, async modelCall(input) {
    requests.push(input)
    const bound = bindings(input)
    let tools
    if (requests.length === 1) tools = [call('cad_query_drawing', { expectedRevision: bound.revision,
      filters: { ids: [bound.aliases[alias].nativeId] }, offset: 0, layerOffset: 0, limit: 20, maxLayers: 100, maxBytes: 65536 }, 'actual-target-read')]
    else {
      assert.equal(requests.length, 2)
      const read = JSON.parse(input.messages.at(-1).content)
      assert.equal(read.ok, true)
      const entity = read.value.entities.find(item => item.id === bound.aliases[alias].nativeId)
      const args = { expectedRevision: read.value.revision, units: read.value.units,
        changes: [{ id: entity.id, expectedText: entity.geometry.text, text: edit(entity.geometry.text) }] }
      tools = [call('cad_propose_text_edit', args, 'actual-plan-one')]
      if (duplicate) tools.push(call('cad_propose_text_edit', unrequestedSecond
        ? { ...args, changes: [{ ...args.changes[0], text: 'Unrequested replacement' }] } : args, 'actual-plan-two'))
    }
    return { model: 'fixture-not-real-provider', content: 'No drawing has been changed.', toolCalls: tools,
      finishReason: 'tool_calls', usage, elapsedMs: 1 }
  } }
}

for (const unrequestedSecond of [false, true]) test(`multiple actual native proposals never reuse the satisfied preview after all are rejected (${unrequestedSecond ? 'unrequested second edit' : 'two correct edits'})`, async () => {
  const provider = caller({ unrequestedSecond }), events = []
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', scenarioIds: [scenario.id], maxScenarios: 1, maxRequests: 5,
    modelCall: provider.modelCall, onScenarioResult: event => {
      assert.equal(event.oracle.status, 'satisfied', 'The original pending preview really passed before the host rejected the multi-plan batch')
      assert.equal(event.result.proposals.length, 2)
      events.push(event)
    } })
  assert.equal(report.requests, 2)
  assert.equal(report.totalTokens, 52)
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.passed, 0)
  assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.scenarios[0].status, 'failed')
  assert.equal(report.scenarios[0].reason, 'host-approval-not-completed')
  assert.ok(report.scenarios[0].assertions.some(check => check.id === 'host-approval-not-completed' && check.satisfied === false))
  const { fixture, evidence, result } = events[0]
  assert.equal(evidence.hostApprovalApplied, false)
  assert.equal(evidence.approvalReceipt, null)
  assert.equal(Object.hasOwn(evidence, 'approvedPlanId'), false)
  assert.equal(evidence.stage, 'host-approval-not-completed')
  assert.deepEqual(evidence.rejectedPlans.map(receipt => receipt.planId), result.proposals.map(proposal => proposal.planId))
  assert.ok(evidence.rejectedPlans.every(receipt => receipt.status === 'rejected'))
  assert.equal(evidence.afterDocument.revision, fixture.initialRevision)
  assert.equal(evidence.afterDocument.history.undoCount, 0)
  assert.equal(evidence.afterDocument.history.redoCount, 0)
  assert.equal(fixtureStateSignature(evidence.afterDocument), fixture.initialState)
})

test('one complete actual proposal is approved exactly once with a real receipt and preserved archive', async () => {
  const provider = caller({ duplicate: false }), events = []
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', scenarioIds: [scenario.id], maxScenarios: 1, maxRequests: 5,
    modelCall: provider.modelCall, onScenarioResult: event => events.push(event) })
  assert.equal(report.requests, 2)
  assert.equal(report.scenarios[0].status, 'satisfied')
  assert.equal(report.scenarios[0].passed, null)
  const { evidence, fixture, result } = events[0]
  assert.equal(evidence.hostApprovalApplied, true)
  assert.equal(evidence.approvedPlanId, result.proposal.planId)
  assert.equal(evidence.approvalReceipt.status, 'committed')
  assert.equal(evidence.approvalReceipt.command, 'TEXTEDIT')
  assert.equal(evidence.approvalReceipt.afterRevision, fixture.initialRevision + 1)
  assert.equal(evidence.afterDocument.revision, fixture.initialRevision + 1)
  assert.equal(evidence.afterDocument.history.undoCount, 1)
  assert.equal(Object.hasOwn(evidence, 'rejectedPlans'), false)
})

test('a real applied single proposal is still a failed journey when the independent committed oracle fails', async () => {
  const selected = corpus.scenarios.find(item => item.expected.intent === 'cad-annotation.append-review-note')
  const provider = caller({ duplicate: false, alias: 'NOTE-A', edit: text => text + '；仅供复核' }), events = []
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', scenarioIds: [selected.id], maxScenarios: 1, maxRequests: 5,
    modelCall: provider.modelCall, onScenarioResult: event => {
      assert.equal(event.oracle.status, 'satisfied')
      // A local fault injection of the independent postcondition, not a change
      // to any frozen corpus value, provider prompt or archived live report.
      event.fixture.oracleExpectedFingerprint = 'deliberately-corrupted-local-postcondition'
      events.push(event)
    } })
  assert.equal(report.requests, 2)
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.scenarios[0].status, 'failed')
  assert.equal(report.scenarios[0].passed, null)
  const { evidence, fixture } = events[0]
  assert.equal(evidence.hostApprovalApplied, true)
  assert.equal(evidence.approvalReceipt.status, 'committed')
  assert.equal(evidence.afterDocument.revision, fixture.initialRevision + 1)
  assert.equal(evidence.afterDocument.history.undoCount, 1)
  assert.ok(report.scenarios[0].assertions.some(check => check.id === 'exact-full-native-content-after-commit' && !check.satisfied))
})

test('actual runtime rejected native plans cannot later be approved, with no leaked pending permission', async () => {
  const fixture = await buildScenarioFixture(scenario), provider = caller()
  const chat = createAiChatRuntime({ provider: 'deepseek', model: 'fixture-not-real-provider',
    endpoint: 'https://public-fixture.invalid/chat/completions', protocol: 'chat-completions', apiKey: 'public-fixture-only',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body), { messages, ...settings } = body
      const returned = await provider.modelCall({ messages, settings })
      return Response.json({ model: returned.model, choices: [{ message: { role: 'assistant', content: returned.content,
        tool_calls: returned.toolCalls }, finish_reason: returned.finishReason }],
      usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens } })
    } })
  try {
    await chat.restoreLocalState(await createGeologyScenarioRuntimeState(fixture))
    const before = await chat.exportLocalState()
    const result = await chat.send(frameScenarioPrompt(scenario, scenarioFixtureInputBindings(fixture), { answerContractVersion: 'v5' }))
    assert.equal(result.status, 'proposal')
    assert.equal(result.proposals.length, 2)
    for (const proposal of result.proposals) assert.equal(chat.reject(proposal.planId).status, 'rejected')
    for (const proposal of result.proposals) {
      const rejected = await chat.approve(proposal.planId)
      assert.equal(rejected.status, 'error')
      assert.equal(rejected.error.code, 'AI_PROPOSAL_MISSING')
    }
    const after = await chat.exportLocalState()
    assert.deepEqual(JSON.parse(after.drawing), JSON.parse(before.drawing))
    assert.deepEqual(after.drawingHistory, before.drawingHistory)
    assert.equal(chat.drawingHistory.undoCount, 0)
    assert.equal(provider.requests.length, 2)
  } finally { chat.destroy(); fixture.dispose() }
})
