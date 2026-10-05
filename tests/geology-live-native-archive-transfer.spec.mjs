import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runGeologyUserScenarios } from '../scripts/testing/run-geology-user-scenarios.mjs'
import { buildScenarioFixture } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createGeologyScenarioRuntimeState, reopenGeologyScenarioRuntimeState, geologyHistoryMetadata } from '../scripts/testing/helpers/geology-runner-history-transfer.mjs'
import { evaluateRound4NativeOracle } from '../scripts/testing/helpers/geology-round4-native-oracles.mjs'
import { evaluateRound5InventoryOracle } from '../scripts/testing/helpers/geology-round5-inventory-oracles.mjs'

const corpus = JSON.parse(await readFile(new URL('./fixtures/geology-user-scenarios-v1.json', import.meta.url), 'utf8'))
const mutationIntents = ['cad-annotation.preserve-mtext-format', 'cad-annotation.append-review-note', 'batch-historical-workflow.historical-dxf-note-revision']
const scenarios = corpus.scenarios.filter(scenario => !scenario.sequence && mutationIntents.includes(scenario.expected.intent))
const identityMarker = 'Public synthetic task input: complete alias-to-native-identity inventory, not expected outcomes. Read native data at the current revision before acting. '
const bindings = input => JSON.parse(input.messages.find(message => message.role === 'user').content.split(identityMarker).at(-1).split('\n\nFor automated review,')[0])
const response = calls => ({ model: 'fixture-not-real-provider', content: '', toolCalls: calls, finishReason: 'tool_calls',
  usage: { inputTokens: 19, outputTokens: 7, totalTokens: 26 }, elapsedMs: 1 })
const call = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const native = value => JSON.parse(JSON.stringify(value))

function mutationDeclaration(scenario) {
  const english = scenario.language === 'en'
  if (scenario.expected.intent === 'cad-annotation.preserve-mtext-format') return {
    alias: 'MTEXT-A', edit: text => text.replace(english ? 'Pending review' : '待核对', english ? 'Reviewed' : '已核对'),
  }
  if (scenario.expected.intent === 'cad-annotation.append-review-note') return {
    alias: 'NOTE-A', edit: text => text + (english ? '; for review only' : '；仅供复核'),
  }
  return { alias: 'NOTE-HISTORY', edit: text => text + (english ? ' Review edition' : '复核版') }
}

for (const scenario of scenarios) test(`actual runtime approved edit retains post-commit archive: ${scenario.id}`, async () => {
  const declaration = mutationDeclaration(scenario), events = []
  let requests = 0
  const report = await runGeologyUserScenarios({ answerContractVersion: 'v5', answerEncoding: 'json-object',
    scenarioIds: [scenario.id], maxScenarios: 1, maxRequests: 5,
    modelCall: async input => {
      requests++
      assert.equal(Object.hasOwn(input.settings, 'response_format'), false, 'Mutation tools do not receive final-answer JSON mode')
      const bound = bindings(input)
      if (requests === 1) return response([call('cad_query_drawing', { expectedRevision: bound.revision,
        filters: { ids: [bound.aliases[declaration.alias].nativeId] }, offset: 0, layerOffset: 0, limit: 20, maxLayers: 100, maxBytes: 65536 }, 'actual-native-read')])
      assert.equal(requests, 2)
      const actual = JSON.parse(input.messages.at(-1).content)
      assert.equal(actual.ok, true)
      const entity = actual.value.entities.find(item => item.id === bound.aliases[declaration.alias].nativeId)
      assert.ok(entity)
      return response([call('cad_propose_text_edit', { expectedRevision: actual.value.revision, units: actual.value.units,
        changes: [{ id: entity.id, expectedText: entity.geometry.text, text: declaration.edit(entity.geometry.text) }] }, 'actual-native-proposal')])
    }, onScenarioResult: event => {
      assert.equal(event.oracle.status, 'satisfied', JSON.stringify(event.oracle))
      assert.equal(event.evidence.hostApprovalApplied, false)
      assert.equal(event.evidence.afterDocument.history.undoCount, 0, 'An ordinary imported baseline has no seed edit history')
      events.push(event)
    } })
  assert.equal(requests, 2)
  assert.equal(report.requests, 2)
  assert.equal(report.totalTokens, 52)
  assert.equal(report.realProviderRequests, 0)
  assert.equal(report.passed, 0)
  assert.equal(report.scenarios[0].passed, null)
  const { fixture, evidence } = events[0]
  assert.equal(evidence.hostApprovalApplied, true)
  assert.equal(evidence.approvalReceipt.status, 'committed')
  assert.equal(evidence.approvalReceipt.command, 'TEXTEDIT')
  assert.equal(evidence.approvalReceipt.beforeRevision, fixture.initialRevision)
  assert.equal(evidence.approvalReceipt.afterRevision, fixture.initialRevision + 1)
  assert.equal(evidence.afterDocument.fingerprint(), fixture.oracleExpectedFingerprint)
  assert.equal(evidence.afterDocument.revision, fixture.initialRevision + 1)
  assert.equal(evidence.afterDocument.history.undoCount, 1, 'The actual host archive must survive the independent KJD reopening; no fabricated or lost history')
  assert.equal(report.scenarios[0].status, 'satisfied', JSON.stringify(report.scenarios[0]))
  const evaluate = fixture.round4NativeOracleId ? evaluateRound4NativeOracle : evaluateRound5InventoryOracle
  for (const tamper of [
    { hostApprovalApplied: false }, { approvedPlanId: 'not-the-real-approved-plan' },
    { approvalReceipt: { ...evidence.approvalReceipt, command: 'MOVE' } },
    { approvalReceipt: { ...evidence.approvalReceipt, beforeRevision: fixture.initialRevision - 1 } },
    { approvalReceipt: { ...evidence.approvalReceipt, afterRevision: fixture.initialRevision + 2 } },
  ]) assert.equal(evaluate(scenario, fixture, { ...evidence, ...tamper }).status, 'failed', 'Receipt and host approval evidence cannot be inferred from a correct final drawing')
  const target = evidence.proposal.preview.before[0].id
  for (const entity of fixture.initialEntities) if (entity.id !== target) {
    assert.deepEqual(native(evidence.afterDocument.getObject(entity.id)), native(entity), 'Every untouched full native payload, ID and handle remains exact')
  }
  const editedFingerprint = evidence.afterDocument.fingerprint(), archive = evidence.afterDocument.exportHistory()
  assert.equal(archive.undo.length, 1)
  assert.equal(archive.documentRevision, evidence.afterDocument.revision)
  assert.equal(archive.documentFingerprint, editedFingerprint)
  const undoTarget = evidence.afterDocument.history.undoTarget
  await fixture.sdk.executeCommand('UNDO', { targetHistoryId: undoTarget.id }, { document: evidence.afterDocument, expectedRevision: evidence.afterDocument.revision })
  assert.equal(evidence.afterDocument.fingerprint(), fixture.oracleBaselineDocument.fingerprint())
  assert.equal(evidence.afterDocument.history.redoTarget.id, undoTarget.id)
  await fixture.sdk.executeCommand('REDO', { targetHistoryId: evidence.afterDocument.history.redoTarget.id }, { document: evidence.afterDocument, expectedRevision: evidence.afterDocument.revision })
  assert.equal(evidence.afterDocument.fingerprint(), editedFingerprint)
})

const baselineScenario = corpus.scenarios.find(scenario => scenario.expected.intent === 'cad-query.inventory')
for (const [label, corrupt] of [
  ['missing archive', state => { delete state.drawingHistory }],
  ['foreign document ID', state => { state.drawingHistory.documentId = 'foreign-document' }],
  ['stale revision', state => { state.drawingHistory.documentRevision-- }],
  ['wrong current fingerprint', state => { state.drawingHistory.documentFingerprint = 'not-the-actual-fingerprint' }],
  ['tampered real current after snapshot', state => { state.drawingHistory.undo.at(-1).after.header.title += 'unrequested' }],
  ['broken adjacent chain snapshot', state => {
    // Actual SDK snapshots can share immutable subtrees. Detach just one
    // endpoint so this tests a broken chain, not a consistent joint mutation.
    state.drawingHistory.undo[0].after = structuredClone(state.drawingHistory.undo[0].after)
    state.drawingHistory.undo[0].after.header.title += 'unrequested'
  }],
]) test(`every actual exported runtime archive is fail-closed on postcondition: ${label}`, async () => {
  const fixture = await buildScenarioFixture(baselineScenario), chat = createAiChatRuntime()
  try {
    await chat.restoreLocalState(await createGeologyScenarioRuntimeState(fixture))
    const absentUndo = await chat.applyHistory('undo')
    assert.equal(absentUndo.status, 'error') // No baseline history: must not create a seed.
    const target = fixture.document.getObject(fixture.identityAliases['TEXT-A'].nativeId)
    const current = await fixture.sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
    await fixture.sdk.executeCommand('TEXTEDIT', { changes: [{ id: target.id, expectedText: target.payload.text,
      text: target.payload.text + ' actual checked change' }] }, { document: current, expectedRevision: current.revision })
    await fixture.sdk.executeCommand('TEXTEDIT', { changes: [{ id: target.id, expectedText: target.payload.text + ' actual checked change',
      text: target.payload.text + ' second checked change' }] }, { document: current, expectedRevision: current.revision })
    const state = structuredClone({ drawing: await fixture.sdk.writeDocument(current, { format: 'KJD' }), drawingHistory: current.exportHistory() })
    const live = structuredClone(current.history), completeBefore = native(current.snapshot())
    corrupt(state)
    await assert.rejects(reopenGeologyScenarioRuntimeState(fixture, state, live), 'Missing or invalid actual history archive cannot silently fall back to an empty imported baseline')
    assert.deepEqual(native(current.snapshot()), completeBefore, 'Validation is independent and cannot repair or mutate the actual drawing')
  } finally { chat.destroy(); fixture.dispose() }
})

test('ordinary baseline actual empty archive is validated and retains zero history, never fabricated user edits', async () => {
  const fixture = await buildScenarioFixture(baselineScenario), chat = createAiChatRuntime()
  try {
    await chat.restoreLocalState(await createGeologyScenarioRuntimeState(fixture))
    const state = await chat.exportLocalState(), live = chat.drawingHistory
    assert.ok(state.drawingHistory)
    assert.equal(state.drawingHistory.undo.length, 0)
    const reopened = await reopenGeologyScenarioRuntimeState(fixture, state, live)
    assert.deepEqual(reopened.document.exportHistory(), state.drawingHistory)
    assert.deepEqual(geologyHistoryMetadata(reopened.document.history), geologyHistoryMetadata(live))
    assert.equal(reopened.document.history.undoCount, 0)
    assert.equal(reopened.document.history.redoCount, 0)
    assert.equal(Object.hasOwn(reopened, 'liveHistory'), false, 'Only explicitly declared history fixtures bind ephemeral model-target evidence')
  } finally { chat.destroy(); fixture.dispose() }
})
