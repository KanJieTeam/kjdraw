import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runGeologyUserScenarios } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { HISTORY_ORACLE_SCENARIO_IDS, historyScenarioDescriptor, evaluateHistoryScenarioOracle } from '../scripts/testing/helpers/geology-history-scenario-oracles.mjs'
import { buildScenarioFixture } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { createGeologyScenarioRuntimeState, bindGeologyScenarioRuntimeHistory, reopenGeologyScenarioRuntimeState,
  geologyHistoryApprovalReceipt, geologyHistoryMetadata } from '../scripts/testing/helpers/geology-runner-history-transfer.mjs'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const scenarios = corpus.scenarios.filter(scenario => HISTORY_ORACLE_SCENARIO_IDS.includes(scenario.id))
const marker = 'Public synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. '
const bindings = input => JSON.parse(input.messages.find(message => message.role === 'user').content.split(marker).at(-1).split('\n\nFor automated review,')[0])
const usage = { inputTokens: 17, outputTokens: 9, totalTokens: 26 }
const response = (calls = [], content = '') => ({ model: 'fixture-not-real-provider', toolCalls: calls, content, finishReason: calls.length ? 'tool_calls' : 'stop', usage, elapsedMs: 1 })
const call = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
// Compare the complete JSON-native payload actually persisted in KJD: an own
// property whose value is undefined is not part of the serialization format.
const nativePayload = value => JSON.parse(JSON.stringify(value))

for (const scenario of scenarios) test(`actual runner history survives archive transfer, fixture-only: ${scenario.id}`, async () => {
  const descriptor = historyScenarioDescriptor(scenario), events = []
  let requests = 0, actualHistory
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', scenarioIds: [scenario.id], maxScenarios: 1, maxRequests: 5,
    modelCall: async input => {
      requests++
      if (requests === 1) return response([call('cad_read_history', { expectedRevision: bindings(input).revision }, 'read-real-history')])
      assert.equal(requests, 2)
      const read = JSON.parse(input.messages.at(-1).content)
      assert.equal(read.ok, true)
      actualHistory = read.value.history
      if (descriptor.kind === 'read-only') {
        assert.equal(actualHistory.undoCount, 0)
        assert.equal(actualHistory.redoCount, 0)
        return response([], JSON.stringify({ documentId: read.value.documentId, revision: read.value.revision, history: actualHistory }))
      }
      assert.equal(actualHistory[`${descriptor.operation}Count`], 1, 'Real reviewed seed stack must not vanish at KJD reopening')
      return response([call(`cad_propose_${descriptor.operation}`, { expectedRevision: read.value.revision, units: read.value.units,
        targetHistoryId: actualHistory[`${descriptor.operation}Target`].id }, 'propose-real-history')])
    }, onScenarioResult: event => { events.push(event) },
  })
  assert.equal(report.requests, 2)
  assert.equal(report.totalTokens, 52)
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.passed, 0)
  assert.equal(report.scenarios[0].passed, null)
  assert.equal(report.evidenceOrigin, 'fixture-oracle-selftest')
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify(report.scenarios[0]))
  assert.equal(report.allSelectedPassed, false)
  const { fixture, evidence } = events[0]
  assert.deepEqual(fixture.initialHistory, actualHistory)
  assert.deepEqual(evidence.historyArchive, evidence.afterDocument.exportHistory({ limit: 50, maxBytes: 16 * 1024 * 1024 }))
  assert.deepEqual(geologyHistoryMetadata(evidence.liveHistory), geologyHistoryMetadata(evidence.afterDocument.history))
  if (descriptor.kind === 'history') {
    assert.equal(evidence.stage, 'committed')
    assert.equal(evidence.hostApprovalApplied, true)
    assert.equal(evidence.approvalReceipt.ok, true)
    assert.equal(evidence.approvalReceipt.value.status, 'committed')
    assert.equal(evidence.approvalReceipt.value.command, descriptor.operation.toUpperCase())
    assert.equal(evidence.approvalReceipt.value.afterRevision, fixture.initialRevision + 1)
    assert.equal(evidence.afterDocument.fingerprint(), fixture.oracleExpectedFingerprint)
    const moved = descriptor.operation === 'undo' ? 'redoTarget' : 'undoTarget'
    assert.equal(evidence.liveHistory[moved].id, actualHistory[`${descriptor.operation}Target`].id)
    assert.notEqual(evidence.afterDocument.history[moved].id, evidence.liveHistory[moved].id, 'Independent archive restoration intentionally renews target IDs')
    for (const entity of fixture.initialEntities) if (!fixture.oracleHistoryBefore.some(changed => changed.id === entity.id)) {
      assert.deepEqual(nativePayload(evidence.afterDocument.getObject(entity.id)), nativePayload(entity), 'Untouched full JSON-native object payload, ID and handle stay exact')
    }
  }
  const badArchive = { ...evidence, historyArchive: { ...evidence.historyArchive, documentFingerprint: 'not-the-real-fingerprint' } }
  assert.equal(evaluateHistoryScenarioOracle(scenario, fixture, badArchive).status, 'failed')
  if (descriptor.kind === 'history') {
    const wrongTarget = structuredClone(evidence.liveHistory), moved = descriptor.operation === 'undo' ? 'redoTarget' : 'undoTarget'
    wrongTarget[moved].id += '-not-the-read-target'
    assert.equal(evaluateHistoryScenarioOracle(scenario, fixture, { ...evidence, liveHistory: wrongTarget }).status, 'failed')
    const wrongTrace = evidence.toolCalls.map(item => ({ ...item, args: item.name === `cad_propose_${descriptor.operation}` ? { ...item.args, targetHistoryId: 'foreign-target' } : item.args }))
    assert.equal(evaluateHistoryScenarioOracle(scenario, fixture, { ...evidence, toolCalls: wrongTrace }).status, 'failed')
  }
})

test('ordinary unseeded fixtures retain the original import baseline, without fabricated undo prerequisites', async () => {
  const scenario = corpus.scenarios.find(item => item.expected.intent === 'cad-query.inventory')
  const fixture = await buildScenarioFixture(scenario)
  const chat = createAiChatRuntime()
  try {
    const initial = await createGeologyScenarioRuntimeState(fixture)
    assert.equal(Object.hasOwn(initial, 'drawingHistory'), false)
    await chat.restoreLocalState(initial)
    await bindGeologyScenarioRuntimeHistory(fixture, chat, initial)
    assert.equal(chat.drawingHistory.undoCount, 0)
    assert.equal(chat.drawingHistory.redoCount, 0)
    const after = await reopenGeologyScenarioRuntimeState(fixture, await chat.exportLocalState(), chat.drawingHistory)
    assert.equal(after.document.history.undoCount, 0)
    assert.equal(after.document.history.redoCount, 0)
    assert.equal(Object.hasOwn(after, 'liveHistory'), false)
  } finally { chat.destroy(); fixture.dispose() }
})

const undo = scenarios.find(scenario => historyScenarioDescriptor(scenario).operation === 'undo')
for (const [label, corrupt] of [
  ['foreign document ID', state => { state.drawingHistory.documentId = 'foreign-document' }],
  ['stale revision', state => { state.drawingHistory.documentRevision-- }],
  ['wrong fingerprint', state => { state.drawingHistory.documentFingerprint = 'wrong' }],
  ['tampered after snapshot', state => { state.drawingHistory.undo[0].after.header.title += 'tampered' }],
  ['missing real seed stack', state => { state.drawingHistory.undo = [] }],
]) test(`runner cannot bind corrupted history prerequisites: ${label}`, async () => {
  const fixture = await buildScenarioFixture(undo), chat = createAiChatRuntime()
  try {
    const initial = structuredClone(await createGeologyScenarioRuntimeState(fixture))
    corrupt(initial)
    await chat.restoreLocalState(initial)
    await assert.rejects(bindGeologyScenarioRuntimeHistory(fixture, chat, initial))
    assert.equal(chat.revision, fixture.initialRevision)
    assert.deepEqual(JSON.parse((await chat.exportLocalState()).drawing), nativePayload(fixture.document.snapshot()))
  } finally { chat.destroy(); fixture.dispose() }
})

test('history approval normalization refuses provider prose, a non-applied result and foreign native receipt', () => {
  const fixture = { document: { id: 'actual-document' }, initialRevision: 3 }, proposal = { command: 'UNDO', documentId: 'actual-document', expectedRevision: 3 }
  for (const approval of [{ status: 'message', text: 'Approved' }, { status: 'error' }, { status: 'applied', receipt: { status: 'committed', command: 'UNDO', documentId: 'foreign', beforeRevision: 3, afterRevision: 4 } }]) {
    assert.throws(() => geologyHistoryApprovalReceipt(approval, fixture, proposal))
  }
  const realShape = { status: 'applied', receipt: { status: 'committed', command: 'UNDO', beforeRevision: 3, afterRevision: 4 } }
  assert.deepEqual(geologyHistoryApprovalReceipt(realShape, fixture, proposal), { ok: true, value: realShape.receipt })
  assert.throws(() => geologyHistoryApprovalReceipt(realShape, fixture, { ...proposal, documentId: 'foreign-document' }))
  assert.throws(() => geologyHistoryApprovalReceipt(realShape, fixture, { ...proposal, expectedRevision: 2 }))
})
