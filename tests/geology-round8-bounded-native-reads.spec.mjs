import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { ROUND8_REVIEWED_CHAT_PROTOCOL, ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL,
  ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL, round8ReviewedChatStageInputs,
  frameRound8ReviewedChatStage, runRound8ReviewedChatWorkflow } from '../scripts/testing/helpers/geology-round8-reviewed-chat-driver.mjs'
import { buildRound8ReviewedWorkflowFixture, evaluateRound8ReviewedStepOracle } from '../scripts/testing/helpers/geology-round8-reviewed-workflow-oracles.mjs'

const clone = structuredClone
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = corpus.scenarios.filter(item => ROUND8_REVIEWED_CHAT_PROTOCOL.supportedIntents.includes(item.expected.intent) && !item.sequence)
const mixed = scenarios.find(item => item.id === 'GUS1-source-section.mixed-source-and-manual-edit-zh-direct')
const option = ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.option
const v3Prefix = 'This is a caller-declared, separately reviewed workflow with a mandatory native-read contract. '
  + 'During THIS stage, before proposing ANY change (including a manual geometry change), '
  + 'call every stagePolicy.requiredReadToolNames tool using the current callerInputs drawingId and revision. '
  + 'Inspect its successful actual receipt for this document and revision. '
  + 'cad_read_drawing, cad_query_drawing, previous-stage reads and conversational claims do not replace cad_read_geology_source. '
  + 'The host will not execute a missing read for you. Additional geometry reads remain available as needed. '
const sharedPrefix = 'Prepare exactly one pending proposal for this stage; the host reviews it separately. '
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
  return { origin: 'fixture-oracle-selftest', model: 'public-scripted-bounded-source-read-fixture', async call({ messages, stageIndex }) {
    const input = inputOf(messages), data = input.callerInputs
    assert.equal(input.protocol, ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.version)
    assert.deepEqual(input.requiredNativeReadContract.requiredToolCalls[0].arguments,
      { expectedRevision: data.revision, drawingId: data.drawingId, maxBytes: 262144 })
    assert.equal(input.requiredNativeReadContract.sourceReadBudget.noHostArgumentRewriteOrAutomaticRetry, true)
    const turn = turns.get(stageIndex) ?? 0
    turns.set(stageIndex, turn + 1)
    const call = (name, args, suffix = '') => ({ id: `bounded-native-stage-${stageIndex}-${turn}${suffix}`,
      type: 'function', function: { name, arguments: JSON.stringify(args) } })
    const respond = calls => ({ content: '', toolCalls: calls, finishReason: 'tool_calls', model: this.model,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })
    if (stageIndex === 1 && fault === 'small-budget-then-success' && turn < 3)
      return respond([call('cad_read_geology_source', { ...clone(input.requiredNativeReadContract.requiredToolCalls[0].arguments),
        maxBytes: [1024, 2048, 262144][turn] })])
    if (turn === 0) {
      if (stageIndex === 1 && fault === 'missing-source-read') return respond([call('cad_read_drawing', {})])
      const args = clone(input.requiredNativeReadContract.requiredToolCalls[0].arguments)
      if (stageIndex === 1 && fault === 'stale-source-read') args.expectedRevision--
      if (stageIndex === 1 && fault === 'failed-source-read') args.drawingId = 'public-missing-native-root'
      if (stageIndex === 1 && fault === 'over-schema-byte-budget') args.maxBytes++
      return respond([call('cad_read_geology_source', args)])
    }
    if (stageIndex === 1 && turn === 1 && ['stale-source-read', 'failed-source-read', 'over-schema-byte-budget'].includes(fault))
      return respond([call('cad_read_drawing', {})])
    if (stageIndex === 0) {
      const declaration = data.suppliedInputs.confirmedMixedChanges ?? data.suppliedInputs.confirmedSelectedWaterTable
      return respond([call('cad_propose_geology_revision', { expectedRevision: data.revision, drawingId: data.drawingId,
        units: declaration.drawingUnits, updates: clone(declaration.waterTable ?? declaration.rows) })])
    }
    const declaration = data.remainingManualDisplacement
    return respond([call('cad_propose_move', { expectedRevision: data.revision, units: declaration.units,
      ids: clone(declaration.ids), dx: declaration.dx, dy: declaration.dy })])
  } }
}

test('v4 only declares published bounded maxBytes; legacy and v3 framing and source facts stay unchanged', async () => {
  assert.equal(KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_read_geology_source').inputSchema.properties.maxBytes.maximum,
    ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.maxBytes)
  for (const scenario of scenarios) {
    const fixture = await buildRound8ReviewedWorkflowFixture(scenario)
    try {
      const count = scenario.expected.intent === mixed.expected.intent ? 2 : 1
      for (let index = 0; index < count; index++) {
        const context = { revision: fixture.initialRevision + index,
          ...(index ? { previousApproval: { status: 'committed', afterRevision: fixture.initialRevision + 1 } } : {}) }
        const legacy = round8ReviewedChatStageInputs(scenario, fixture, index, context)
        assert.equal(Object.hasOwn(legacy, 'requiredNativeReadContract'), false)
        const old = round8ReviewedChatStageInputs(scenario, fixture, index,
          { ...context, readProtocolVersion: ROUND8_REVIEWED_CHAT_NATIVE_READ_PROTOCOL.option })
        assert.equal(Object.hasOwn(old.requiredNativeReadContract, 'sourceReadBudget'), false)
        assert.equal(Object.hasOwn(old.requiredNativeReadContract.requiredToolCalls[0].arguments, 'maxBytes'), false)
        assert.equal(frameRound8ReviewedChatStage(old), v3Prefix + sharedPrefix + ROUND8_REVIEWED_CHAT_PROTOCOL.inputStart + JSON.stringify(old) + ROUND8_REVIEWED_CHAT_PROTOCOL.inputEnd)
        const next = round8ReviewedChatStageInputs(scenario, fixture, index, { ...context, readProtocolVersion: option })
        assert.deepEqual(next.callerInputs, old.callerInputs)
        assert.deepEqual(next.stagePolicy, old.stagePolicy)
        const budget = next.requiredNativeReadContract.sourceReadBudget
        assert.equal(budget.maxBytes, 262144)
        assert.equal(budget.everyActualNativeReadMustSucceed, true)
        assert.equal(budget.oversizeSourceRejectedWithoutTruncation, true)
        const stripped = clone(next); stripped.protocol = old.protocol
        delete stripped.requiredNativeReadContract.sourceReadBudget
        delete stripped.requiredNativeReadContract.requiredToolCalls[0].arguments.maxBytes
        assert.deepEqual(stripped, old)
        const frame = frameRound8ReviewedChatStage(next)
        assert.match(frame, /maxBytes:262144/)
        assert.match(frame, /not a source measurement or expected content/)
        assert.match(frame, /discard failed-read evidence/)
        for (const gold of ['expectedEntity', 'afterContent', 'beforeContent', 'afterSource', 'unchangedIds'])
          assert.equal(frame.includes(`"${gold}"`), false)
      }
    } finally { fixture.dispose() }
  }
})

for (const scenario of scenarios) test(`v4 actual native reads and host review selftest, not a model pass: ${scenario.id}`, async () => {
  const fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report = await runRound8ReviewedChatWorkflow(scenario, { fixture, readProtocolVersion: option,
      modelAdapter: fixtureAdapter(), reviewProposal: ({ pendingVerdict }) => pendingVerdict.status === 'satisfied' })
    assert.equal(report.status, 'completed', JSON.stringify({ errorCode: report.errorCode, verdict: report.verdict }))
    assert.equal(report.verdict.status, 'satisfied')
    assert.equal(report.protocol, ROUND8_REVIEWED_CHAT_BOUNDED_READ_PROTOCOL.version)
    assert.equal(report.readProtocolVersion, option)
    for (const [index, step] of report.steps.entries()) {
      assert.equal(step.toolCalls[0].name, 'cad_read_geology_source')
      assert.equal(step.toolCalls[0].args.maxBytes, 262144)
      assert.equal(step.toolCalls[0].args.expectedRevision, fixture.initialRevision + index)
      assert.equal(step.toolCalls[0].result.ok, true)
      assert.equal(step.toolCalls[0].result.value.revision, fixture.initialRevision + index)
      assert.equal(step.pendingVerdict.status, 'satisfied')
      assert.equal(step.committedVerdict.status, 'satisfied')
    }
    assert.equal(report.approvals, scenario.expected.intent === mixed.expected.intent ? 2 : 1)
    assert.equal(report.toolCalls, report.approvals * 3, 'one actual source read + actual proposal + counted host history read per approval')
    assert.equal(report.modelCalls, 0)
    assert.equal(report.realProviderRequests, 0)
    assert.equal(report.scenarioPassed, null)
    assert.equal(report.scenarioExecuted, false)
  } finally { fixture.dispose() }
})

for (const fault of ['small-budget-then-success', 'missing-source-read', 'stale-source-read', 'failed-source-read', 'over-schema-byte-budget'])
  test(`v4 keeps the frozen rejection criterion: ${fault}`, async () => {
    const fixture = await buildRound8ReviewedWorkflowFixture(mixed)
    try {
      const report = await runRound8ReviewedChatWorkflow(mixed, { fixture, readProtocolVersion: option,
        modelAdapter: fixtureAdapter(fault), reviewProposal: () => true })
      assert.notEqual(report.status, 'completed')
      assert.equal(report.approvals, 1)
      assert.equal(report.evidence.afterDocument.revision, fixture.initialRevision + 1)
      assert.deepEqual(report.evidence.afterDocument.getObject('CIRCLE-MANUAL').payload, fixture.document.getObject('CIRCLE-MANUAL').payload)
      assert.equal(report.verdict.status, 'failed')
      assert.equal(report.scenarioPassed, null)
      const last = report.steps.at(-1), verdict = evaluateRound8ReviewedStepOracle(mixed, fixture, 1, last)
      assert.equal(verdict.status, 'failed')
      if (fault === 'small-budget-then-success') {
        const reads = last.toolCalls.filter(call => call.name === 'cad_read_geology_source')
        assert.deepEqual(reads.map(call => call.args.maxBytes), [1024, 2048, 262144])
        assert.deepEqual(reads.map(call => call.result.ok), [false, false, true])
        assert.equal(last.toolCalls.some(call => call.name === 'cad_propose_move' && call.result.ok), true)
        assert.equal(verdict.assertions.find(row => row.id === 'all-native-reads-succeeded').satisfied, false,
          'a correct MOVE after successful source read cannot erase two actual failed reads')
      }
    } finally { fixture.dispose() }
  })

for (const budget of [{ maxToolCalls: 3 }, { maxRequests: 2 }, { maxApprovals: 0 }])
  test(`v4 does not expand existing host budgets: ${JSON.stringify(budget)}`, async () => {
    const fixture = await buildRound8ReviewedWorkflowFixture(mixed)
    try {
      const report = await runRound8ReviewedChatWorkflow(mixed, { fixture, readProtocolVersion: option,
        modelAdapter: fixtureAdapter(), reviewProposal: () => true, ...budget })
      assert.notEqual(report.status, 'completed')
      assert.equal(report.scenarioPassed, null)
      assert.ok(report.requests <= (budget.maxRequests ?? 16))
      assert.ok(report.toolCalls <= (budget.maxToolCalls ?? 32))
      assert.ok(report.approvals <= (budget.maxApprovals ?? 2))
      assert.deepEqual(report.evidence.afterDocument.getObject('CIRCLE-MANUAL').payload, fixture.document.getObject('CIRCLE-MANUAL').payload)
    } finally { fixture.dispose() }
  })
