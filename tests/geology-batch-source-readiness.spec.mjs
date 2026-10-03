import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { BATCH_SOURCE_READINESS_SCENARIO_IDS, BATCH_SOURCE_READINESS_RESPONSE_CONTRACT, buildBatchSourceReadinessFixture, batchSourceReadinessWorkspaceInventory,
  expectedBatchSourceReadinessAnswer, evaluateBatchSourceReadinessOracle } from '../scripts/testing/helpers/geology-batch-source-readiness-oracles.mjs'
import { BATCH_SOURCE_READINESS_CHAT_PROTOCOL, BATCH_SOURCE_READINESS_CHAT_PROTOCOL_SHA256, batchSourceReadinessChatInputs,
  frameBatchSourceReadinessChatInputs,
  runBatchSourceReadinessChatWorkflow } from '../scripts/testing/helpers/geology-batch-source-readiness-chat-driver.mjs'

const clone = structuredClone
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = BATCH_SOURCE_READINESS_SCENARIO_IDS.map(id => corpus.scenarios.find(s => s.id === id))
const scenario = scenarios[0]
function inputFrom(messages) {
  const text = messages.findLast(message => message.role === 'user' && typeof message.content === 'string' &&
    message.content.includes(BATCH_SOURCE_READINESS_CHAT_PROTOCOL.inputStart)).content
  const start = text.lastIndexOf(BATCH_SOURCE_READINESS_CHAT_PROTOCOL.inputStart) + BATCH_SOURCE_READINESS_CHAT_PROTOCOL.inputStart.length
  return JSON.parse(text.slice(start, text.indexOf(BATCH_SOURCE_READINESS_CHAT_PROTOCOL.inputEnd, start)))
}
function scriptedAdapter({ fault, otherDrawingId, extraDrawingRead = false } = {}) {
  const turns = new Map()
  return { origin: 'fixture-oracle-selftest', model: 'public-native-batch-source-selftest', async call({ messages, settings, phase, documentIndex }) {
    const input = inputFrom(messages)
    assert.equal(Object.hasOwn(settings, 'stream'), false)
    assert.equal(Object.hasOwn(input, 'responseContract'), false)
    assert.equal(Object.hasOwn(input, 'absenceAudit'), false)
    assert.equal(Object.hasOwn(input, 'scope'), false)
    assert.equal(settings.tool_choice === undefined || settings.tool_choice === 'auto', true)
    assert.equal(input.workspaceInventory.documents.length, 4)
    for (const document of input.workspaceInventory.documents) {
      assert.equal(Object.hasOwn(document, 'sourceAvailable'), false)
      assert.equal(Object.hasOwn(document, 'sourceBacked'), false)
      assert.equal(Object.hasOwn(document, 'missingFields'), false)
      assert.equal(Object.hasOwn(document, 'drawingIds'), false)
    }
    const respond = (calls = [], content = '') => ({ model: this.model, content, toolCalls: calls,
      finishReason: calls.length ? 'tool_calls' : 'stop' })
    if (phase === 'final-read-only-answer') {
      assert.equal(settings.tools.length, 0)
      const receipts = input.actualNativeReadReceipts.filter(call => call.result.ok && call.name === 'cad_read_geology_source')
      const listings = receipts.filter(call => call.args.drawingId === '')
      const documents = listings.map(list => {
        const value = list.result.value
        return { documentId: value.documentId, revision: value.revision, sourceAvailable: value.sourceBacked,
          drawings: value.drawingIds.map(drawingId => {
            const source = receipts.find(call => call.result.value.documentId === value.documentId && call.args.drawingId === drawingId).result.value
            const holes = source.kind === 'column' ? [source.facts.hole] : source.facts.holes
            return { drawingId, kind: source.kind, holes: holes.map(hole => ({ holeId: hole.id, missingFields: [
              ...['initialWaterDepth', 'stableWaterDepth', 'observations'].filter(field => !Object.hasOwn(hole, field)),
              ...hole.strata.filter(interval => !Object.hasOwn(interval, 'description')).map(interval => `strata.${interval.intervalId}.description`),
            ] })) }
          }) }
      })
      if (fault === 'final-omit-document') documents.pop()
      if (fault === 'final-duplicate-document') documents[3] = clone(documents[0])
      if (fault === 'final-infer-source-from-dxf-label') documents[3].sourceAvailable = true
      if (fault === 'final-hide-missing-water') documents[1].drawings[0].holes[0].missingFields = documents[1].drawings[0].holes[0].missingFields.filter(field => !field.endsWith('WaterDepth'))
      if (fault === 'final-default-water-to-zero') documents[1].drawings[0].holes[0].stableWaterDepth = 0
      if (fault === 'final-cross-document-identity') documents[1].documentId = documents[0].documentId
      if (fault === 'final-hide-missing-description') for (const document of documents)
        for (const drawing of document.drawings) for (const hole of drawing.holes)
          hole.missingFields = hole.missingFields.filter(field => !field.endsWith('.description'))
      if (fault === 'final-duplicate-missing-field') documents[1].drawings[0].holes[0].missingFields.push(documents[1].drawings[0].holes[0].missingFields[0])
      if (fault === 'final-contract-copy') return respond([], JSON.stringify({ documents,
        absenceAudit: clone(BATCH_SOURCE_READINESS_RESPONSE_CONTRACT.absenceAudit),
        scope: BATCH_SOURCE_READINESS_RESPONSE_CONTRACT.scope }))
      if (fault === 'final-prefixed-json') return respond([], 'Answer: ' + JSON.stringify({ documents }))
      if (fault === 'final-tools') return respond([{ id: 'forbidden-final', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' } }])
      return respond([], fault === 'final-non-json' ? 'All ready.' : JSON.stringify({ documents }))
    }
    assert.equal(settings.tools.every(tool => !tool.function.name.startsWith('cad_propose_')), true)
    const turn = turns.get(documentIndex) ?? 0; turns.set(documentIndex, turn + 1)
    const tool = args => ({ id: `batch-source-${documentIndex}-${turn}`, type: 'function',
      function: { name: 'cad_read_geology_source', arguments: JSON.stringify(args) } })
    if (fault === 'skip-all-native-reads' && documentIndex === 0) return respond([], 'The file extension says enough.')
    if (turn === 0) {
      const args = { drawingId: '', expectedRevision: input.currentDocument.revision, maxBytes: 262144 }
      if (fault === 'stale-revision' && documentIndex === 0) args.expectedRevision--
      if (fault === 'wrong-document-source' && documentIndex === 0) args.drawingId = otherDrawingId
      if (fault === 'forbidden-proposal' && documentIndex === 0) return respond([{ id: 'forbidden', type: 'function',
        function: { name: 'cad_propose_move', arguments: JSON.stringify({ units: 'millimeter', expectedRevision: input.currentDocument.revision,
          ids: ['CIRCLE-MANUAL'], dx: 1, dy: 0 }) } }])
      return respond([tool(args), ...(extraDrawingRead && documentIndex === 3 ? [{ id: 'legal-extra-drawing-read',
        type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' } }] : [])])
    }
    const actual = messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))
    const list = actual.find(result => result.ok && Array.isArray(result.value?.drawingIds))
    if (!list) return respond([tool({ drawingId: '', expectedRevision: input.currentDocument.revision, maxBytes: 262144 })])
    if (turn === 1 && list.value.drawingIds.length && !(fault === 'skip-listed-source-facts' && documentIndex === 0))
      return respond(list.value.drawingIds.map((drawingId, index) => ({ ...tool({ drawingId, expectedRevision: input.currentDocument.revision, maxBytes: 262144 }), id: `batch-source-${documentIndex}-${turn}-${index}` })))
    return respond([], 'Actual native reads completed; drawing unchanged.')
  } }
}

test('six original frozen read-only batch questions; independent fixture has source, absence and actual reopened DXF block/manual branches', async () => {
  assert.equal(scenarios.length, 6)
  const fixture = await buildBatchSourceReadinessFixture(scenario)
  try {
    assert.equal(fixture.workspaceMembers.length, 4)
    const inventory = batchSourceReadinessWorkspaceInventory(fixture)
    assert.equal(new Set(inventory.documents.map(row => row.documentId)).size, 4)
    const graphics = fixture.workspaceMembers[3].document
    assert.ok(graphics.listEntities().some(entity => entity.type === 'INSERT'))
    assert.ok(graphics.listEntities().some(entity => entity.payload.text === 'TEST-A block text is not source'))
    assert.ok(graphics.listEntities().some(entity => entity.payload.text === '历史 DXF 人工备注'))
    assert.ok(graphics.listEntities().some(entity => entity.payload.text === '稳定地下水 groundwater 4.00'))
    assert.equal(fixture.workspaceMembers[3].artifact.format, 'DXF')
    const answer = expectedBatchSourceReadinessAnswer(scenario, fixture)
    assert.equal(answer.documents.filter(row => row.sourceAvailable).length, 3)
    assert.equal(answer.documents.flatMap(row => row.drawings).flatMap(row => row.holes).length, 4)
    assert.ok(answer.documents.flatMap(row => row.drawings).flatMap(row => row.holes).some(row => row.missingFields.length === 0))
    assert.ok(answer.documents.flatMap(row => row.drawings).flatMap(row => row.holes).some(row => row.missingFields.includes('stableWaterDepth')))
    assert.equal(JSON.stringify(batchSourceReadinessChatInputs(scenario, fixture, 0)).includes('"sourceBacked"'), false)
  } finally { fixture.dispose() }
})

for (const item of scenarios) test(`actual document-bound reads and model-produced answer remain fixture-only: ${item.id}`, async () => {
  const fixture = await buildBatchSourceReadinessFixture(item)
  try {
    const before = fixture.workspaceMembers.map(member => canonicalStringify(member.document.snapshot()))
    const report = await runBatchSourceReadinessChatWorkflow(item, { fixture, modelAdapter: scriptedAdapter() })
    assert.equal(report.status, 'completed', JSON.stringify(report.verdict.assertions.filter(row => !row.satisfied)))
    assert.equal(report.verdict.status, 'satisfied')
    assert.equal(report.requests, 12)
    assert.equal(report.toolCalls, 7)
    assert.equal(report.documentRuns.length, 4)
    assert.equal(report.documentRuns.every(row => row.readsComplete), true)
    assert.equal(report.scenarioPassed, null)
    assert.equal(report.scenarioExecuted, false)
    assert.equal(report.verifiedWorkflowExecutions, 0)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.scriptedResponseRequests, 12)
    assert.equal(report.approvals, 0)
    assert.equal(report.proposals, 0)
    assert.equal(report.workspaceUnchanged, true)
    assert.deepEqual(report.workspaceInitialStates, report.workspaceFinalStates)
    assert.deepEqual(fixture.workspaceMembers.map(member => canonicalStringify(member.document.snapshot())), before)
    assert.equal(report.prompts.every(prompt => prompt.includes(item.prompt)), true)
    assert.equal(report.responses.every(response => response.usage === null), true)
  } finally { fixture.dispose() }
})

for (const fault of ['skip-all-native-reads', 'skip-listed-source-facts', 'stale-revision', 'wrong-document-source', 'forbidden-proposal',
  'final-omit-document', 'final-duplicate-document', 'final-infer-source-from-dxf-label', 'final-hide-missing-water',
  'final-default-water-to-zero', 'final-cross-document-identity', 'final-tools', 'final-non-json',
  'final-contract-copy', 'final-hide-missing-description', 'final-duplicate-missing-field', 'final-prefixed-json'])
  test(`${fault}: no host read/answer repair, no partial model success or native mutation`, async () => {
    const fixture = await buildBatchSourceReadinessFixture(scenario)
    try {
      const report = await runBatchSourceReadinessChatWorkflow(scenario, { fixture,
        modelAdapter: scriptedAdapter({ fault, otherDrawingId: fixture.workspaceMembers[1].drawingIds[0] }) })
      assert.notEqual(report.status, 'completed')
      assert.equal(report.scenarioPassed, null)
      assert.equal(report.verifiedWorkflowExecutions, 0)
      assert.equal(report.workspaceUnchanged, true)
      assert.deepEqual(report.workspaceInitialStates, report.workspaceFinalStates)
      assert.equal(report.approvals, 0)
      assert.equal(report.proposals, 0)
    } finally { fixture.dispose() }
  })

test('oracle rejects missing/wrong/replayed document receipts and malformed answers, independently of exact answer text', async () => {
  const fixture = await buildBatchSourceReadinessFixture(scenario)
  try {
    const toolCalls = []
    for (const member of fixture.workspaceMembers) {
      const session = new KJAgentToolSession(member.sdk, member.document)
      for (const drawingId of ['', ...member.drawingIds]) {
        const args = { drawingId, expectedRevision: member.initialRevision, maxBytes: 262144 }
        const result = await session.call('cad_read_geology_source', args)
        assert.equal(result.ok, true)
        toolCalls.push({ boundDocumentId: member.document.id, name: 'cad_read_geology_source', args, result })
      }
    }
    const evidence = { origin: 'fixture-oracle-selftest', toolCalls, answer: expectedBatchSourceReadinessAnswer(scenario, fixture) }
    assert.equal(evaluateBatchSourceReadinessOracle(scenario, fixture, evidence).status, 'satisfied')
    for (const altered of [[], toolCalls.slice(1), toolCalls.map(call => ({ ...call, boundDocumentId: fixture.workspaceMembers[0].document.id })),
      toolCalls.map(call => ({ ...call, args: { ...call.args, expectedRevision: call.args.expectedRevision - 1 } }))])
      assert.equal(evaluateBatchSourceReadinessOracle(scenario, fixture, { ...evidence, toolCalls: altered }).status, 'failed')
    for (const answer of [null, {}, { documents: [null] }, { documents: [{ drawings: [{ holes: [null] }] }] }])
      assert.equal(evaluateBatchSourceReadinessOracle(scenario, fixture, { ...evidence, answer }).status, 'failed')
    await fixture.workspaceMembers[3].document.transact('Mutate actual historical block', tx => {
      const label = fixture.workspaceMembers[3].document.listEntities().find(entity => entity.payload.text === 'TEST-A block text is not source')
      tx.updateObject(label.id, { payload: { ...clone(label.payload), text: 'changed block text' } })
    })
    assert.equal(evaluateBatchSourceReadinessOracle(scenario, fixture, evidence).status, 'failed')
  } finally { fixture.dispose() }
})

test('v2 answer-only input carries no schema metadata or detached source/missing-field answers', async () => {
  assert.equal(BATCH_SOURCE_READINESS_CHAT_PROTOCOL.version, 'batch-source-readiness-native-read-only-v2-answer-only')
  assert.match(BATCH_SOURCE_READINESS_CHAT_PROTOCOL_SHA256, /^[a-f0-9]{64}$/)
  const fixture = await buildBatchSourceReadinessFixture(scenario)
  try {
    for (const index of [0, 1, 2, 3, null]) {
      const input = batchSourceReadinessChatInputs(scenario, fixture, index)
      for (const key of ['responseContract', 'absenceAudit', 'scope', 'expectedAnswer', 'scenarioId'])
        assert.equal(Object.hasOwn(input, key), false)
      assert.equal(Object.hasOwn(input, 'actualNativeReadReceipts'), false)
      const wire = JSON.stringify(input)
      assert.equal(wire.includes('"sourceBacked"'), false)
      assert.equal(wire.includes('"missingFields"'), false)
      const text = frameBatchSourceReadinessChatInputs(input)
      assert.ok(text.includes(scenario.prompt))
      assert.equal(text.includes('"responseContract"'), false)
      assert.equal(text.includes('"absenceAudit"'), false)
      assert.equal(text.includes('"scope"'), false)
      if (index === null) {
        assert.ok(text.includes('exactly one top-level key: documents'))
        assert.ok(text.includes('AND test description on EVERY stratum interval'))
        assert.ok(text.includes('strata. + its exact native intervalId + .description'))
        assert.ok(text.includes('zero, an empty array and a supplied empty string are present values'))
      }
    }
  } finally { fixture.dispose() }
})

test('v2 accepts a model-selected extra native cad_read_drawing({}) without inventing schema arguments', async () => {
  const fixture = await buildBatchSourceReadinessFixture(scenario)
  try {
    const report = await runBatchSourceReadinessChatWorkflow(scenario, { fixture, modelAdapter: scriptedAdapter({ extraDrawingRead: true }) })
    assert.equal(report.status, 'completed', JSON.stringify(report.verdict.assertions))
    assert.equal(report.verdict.oracleId, 'batch-historical-workflow.batch-source-readiness:native-v2')
    assert.equal(report.protocolSha256, BATCH_SOURCE_READINESS_CHAT_PROTOCOL_SHA256)
    assert.equal(report.toolCalls, 8)
    const read = report.evidence.toolCalls.find(call => call.name === 'cad_read_drawing')
    assert.deepEqual(read.args, {})
    assert.equal(read.result.ok, true)
    assert.equal(read.result.value.documentId, fixture.workspaceMembers[3].document.id)
    assert.equal(read.result.value.revision, fixture.workspaceMembers[3].initialRevision)
    assert.equal(report.workspaceUnchanged, true)
    assert.equal(report.scenarioPassed, null)
    assert.equal(report.modelCalls, 0)
  } finally { fixture.dispose() }
})

test('v2 extra native-read receipts still reject wrong document/revision/failure and source revision omissions', async () => {
  const fixture = await buildBatchSourceReadinessFixture(scenario)
  try {
    const toolCalls = []
    for (const member of fixture.workspaceMembers) {
      const session = new KJAgentToolSession(member.sdk, member.document)
      for (const drawingId of ['', ...member.drawingIds]) {
        const args = { drawingId, expectedRevision: member.initialRevision, maxBytes: 262144 }
        const result = await session.call('cad_read_geology_source', args)
        assert.equal(result.ok, true)
        toolCalls.push({ boundDocumentId: member.document.id, name: 'cad_read_geology_source', args, result })
      }
    }
    const member = fixture.workspaceMembers[3], session = new KJAgentToolSession(member.sdk, member.document)
    const read = { boundDocumentId: member.document.id, name: 'cad_read_drawing', args: {}, result: await session.call('cad_read_drawing', {}) }
    const evidence = { origin: 'fixture-oracle-selftest', toolCalls: [...toolCalls, read], answer: expectedBatchSourceReadinessAnswer(scenario, fixture) }
    assert.equal(evaluateBatchSourceReadinessOracle(scenario, fixture, evidence).status, 'satisfied')
    for (const fault of ['wrong-bound-document', 'wrong-receipt-document', 'stale-receipt-revision', 'failed-extra-read', 'missing-source-revision']) {
      const altered = clone(evidence), extra = altered.toolCalls.at(-1)
      if (fault === 'wrong-bound-document') extra.boundDocumentId = fixture.workspaceMembers[0].document.id
      if (fault === 'wrong-receipt-document') extra.result.value.documentId = fixture.workspaceMembers[0].document.id
      if (fault === 'stale-receipt-revision') extra.result.value.revision--
      if (fault === 'failed-extra-read') extra.result = { ok: false, error: { code: 'TEST_READ_FAILED', message: 'Public offline control' } }
      if (fault === 'missing-source-revision') delete altered.toolCalls[0].args.expectedRevision
      assert.equal(evaluateBatchSourceReadinessOracle(scenario, fixture, altered).status, 'failed', fault)
    }
  } finally { fixture.dispose() }
})

test('request budget ends without fabricated provider calls or completion', async () => {
  const report = await runBatchSourceReadinessChatWorkflow(scenario, { modelAdapter: scriptedAdapter(), maxRequests: 1 })
  assert.equal(report.status, 'failed')
  assert.equal(report.requests, 1)
  assert.equal(report.errorCode, 'BATCH_REQUEST_BUDGET_EXHAUSTED')
  assert.equal(report.modelCalls, 0)
  assert.equal(report.scenarioPassed, null)
  assert.equal(report.workspaceUnchanged, true)
})
