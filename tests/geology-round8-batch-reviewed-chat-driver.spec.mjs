import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL, round8BatchReviewedChatInputs,
  frameRound8BatchReviewedChatInputs, round8BatchPhysicalValidationSource,
  runRound8BatchReviewedChatWorkflow } from '../scripts/testing/helpers/geology-round8-batch-reviewed-chat-driver.mjs'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { buildRound8ReviewedWorkflowFixture } from '../scripts/testing/helpers/geology-round8-reviewed-workflow-oracles.mjs'

const clone = structuredClone
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const scenarios = corpus.scenarios.filter(s => !s.sequence && s.expected.intent === ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.supportedIntent)
const scenario = scenarios.find(s => s.id.endsWith('-zh-direct'))
function callerInput(messages) {
  const text = messages.findLast(message => message.role === 'user' && typeof message.content === 'string' &&
    message.content.includes(ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.inputStart)).content
  const begin = text.lastIndexOf(ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.inputStart)
  const end = text.indexOf(ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.inputEnd, begin)
  return JSON.parse(text.slice(begin + ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.inputStart.length, end))
}
function scriptedAdapter({ fault, otherDrawingId, origin = 'fixture-oracle-selftest' } = {}) {
  const turns = new Map()
  return { origin, model: 'public-batch-read-only-scripted-selftest', async call({ messages, settings, phase, documentIndex }) {
    assert.equal(Object.hasOwn(settings, 'stream'), false, 'benchmark-owned stream is not forwarded')
    const input = callerInput(messages)
    for (const gold of ['stagingRows', 'afterContent', 'expectedEntity', 'afterSource', 'expectedVerdict'])
      assert.equal(JSON.stringify(input).includes(`"${gold}"`), false)
    if (phase === 'final-read-only-plan') {
      assert.equal(settings.tools.length, 0)
      const sourceReads = input.actualNativeReadReceipts.filter(call => call.name === 'cad_read_geology_source' && call.result.ok)
      const rows = sourceReads.map(call => ({ documentId: call.result.value.documentId, drawingId: call.args.drawingId,
        holeId: call.result.value.facts.hole.id, sourceKind: call.result.value.kind }))
      assert.equal(new Set(rows.map(row => row.documentId)).size, 30, 'scripted plan is built from thirty actual read receipts, never gold')
      if (fault === 'final-omit-document') rows.pop()
      if (fault === 'final-duplicate-document') rows[29] = clone(rows[0])
      if (fault === 'final-crossdoc-identity') rows[1].drawingId = rows[0].drawingId
      const batchPlan = { drawings: rows, batches: [0, 10, 20].map(offset => ({ documentIds: rows.slice(offset, offset + 10).map(row => row.documentId) })),
        requiresSeparateHostApproval: fault !== 'final-implicit-approval' }
      return { model: this.model, content: fault === 'final-non-json' ? 'Looks complete.' : JSON.stringify({ batchPlan }),
        toolCalls: fault === 'final-tool-call' ? [{ id: 'forbidden-final-read', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' } }] : [],
        finishReason: fault === 'final-tool-call' ? 'tool_calls' : 'stop' }
    }
    const turn = turns.get(documentIndex) ?? 0
    turns.set(documentIndex, turn + 1)
    const response = (calls = [], content = '') => ({ model: this.model, content, toolCalls: calls,
      finishReason: calls.length ? 'tool_calls' : 'stop' })
    const call = (name, args) => ({ id: `batch-native-${documentIndex}-${turn}`, type: 'function',
      function: { name, arguments: JSON.stringify(args) } })
    assert.equal(input.currentDocument.completeDeclaredSource.source.input.hole.id, `TEST-${String(documentIndex + 1).padStart(2, '0')}`)
    assert.equal(settings.tools.every(tool => !tool.function.name.startsWith('cad_propose_')), true)
    if (fault === 'skip-document-read' && documentIndex === 7) return response([], 'The supplied table is sufficient; I skipped reading.')
    if (turn === 0) {
      const args = clone(input.requiredNativeRead.arguments)
      if (documentIndex === 7 && fault === 'wrong-document') args.drawingId = otherDrawingId
      if (documentIndex === 7 && fault === 'one-failed-read') args.expectedRevision--
      if (documentIndex === 7 && fault === 'forbidden-proposal') return response([call('cad_propose_geology_revision', {
        expectedRevision: input.currentDocument.revision, drawingId: input.currentDocument.drawingId,
        units: 'millimeter', updates: [{ holeId: 'TEST-08', stableWaterDepth: 5 }] })])
      return response([call('cad_read_geology_source', args)])
    }
    const receipts = messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))
    if (receipts.at(-1)?.ok !== true) return response([call('cad_read_geology_source', clone(input.requiredNativeRead.arguments))])
    return response([], 'The actual native source for this current document was read. No drawing was changed.')
  } }
}

test('exact six original tasks are read-only staging; there is no invented thirty-independent-columns family', () => {
  assert.equal(scenarios.length, 6)
  assert.equal(corpus.scenarios.some(s => s.expected.intent === 'batch-historical-workflow.thirty-independent-columns'), false)
  for (const item of scenarios) assert.equal(item.expected.mutation, 'none')
  assert.deepEqual(ROUND8_BATCH_REVIEWED_CHAT_PROTOCOL.defaultBudgets,
    { maxRequests: 64, maxToolCalls: 96, maxTurnsPerDocument: 3, maxBytes: 1048576 })
})

test('physical validation resolves SDK default paper layout without inventing or rewriting source facts', async () => {
  const fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    for (const member of fixture.workspaceMembers) {
      const before = clone(member.source)
      assert.equal(Object.hasOwn(member.source.input, 'pageHeightMillimeters'), false)
      const projection = round8BatchPhysicalValidationSource(member.source)
      assert.equal(projection.input.pageHeightMillimeters, KJDRAW_GEOLOGY_KNOWLEDGE_PACK.rules['geology-column-layout'].paperHeight)
      delete projection.input.pageHeightMillimeters
      assert.deepEqual(projection, before)
      assert.deepEqual(member.source, before)
      assert.equal(Object.hasOwn(member.completeDeclaredSource.source.input, 'pageHeightMillimeters'), false)
      const explicit = { ...clone(member.source), input: { ...clone(member.source.input), pageHeightMillimeters: 500 } }
      assert.equal(round8BatchPhysicalValidationSource(explicit).input.pageHeightMillimeters, 500)
    }
    assert.throws(() => round8BatchPhysicalValidationSource({ kind: 'column', input: { columnStylePack: {} } }), /DEFAULT_COLUMN_STYLE/)
  } finally { fixture.dispose() }
})

for (const item of scenarios) test(`thirty real independently bound SDK reads and model-produced plan, not a model pass: ${item.id}`, async () => {
  const fixture = await buildRound8ReviewedWorkflowFixture(item)
  try {
    const before = fixture.workspaceMembers.map(member => canonicalStringify(member.document.snapshot()))
    const input = round8BatchReviewedChatInputs(item, fixture, 0)
    assert.equal(input.callerBatchPolicy.approvalGranted, false)
    assert.equal(input.callerBatchPolicy.compileNewDrawing, false)
    assert.equal(frameRound8BatchReviewedChatInputs(input).includes('crossDocumentCallsDoNotSwitchTheBoundSession'), true)
    const report = await runRound8BatchReviewedChatWorkflow(item, { fixture, modelAdapter: scriptedAdapter() })
    assert.equal(report.status, 'completed', JSON.stringify({ errorCode: report.errorCode, failed: report.verdict?.assertions.filter(row => !row.satisfied) }))
    assert.equal(report.verdict.status, 'satisfied')
    assert.equal(report.verdict.hostActionsVerified, true)
    assert.equal(report.documentRuns.length, 30)
    assert.equal(report.documentRuns.every(row => row.currentRead && row.workspaceUnchanged), true)
    assert.equal(report.requests, 61)
    assert.equal(report.adapterInvocations, 61)
    assert.equal(report.scriptedResponseRequests, 61)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.realProviderAdapterInvocations, 0)
    assert.equal(report.networkRequestsVerified, null)
    assert.equal(report.scenarioPassed, null)
    assert.equal(report.scenarioExecuted, false)
    assert.equal(report.verifiedWorkflowExecutions, 0)
    assert.equal(report.toolCalls, 30)
    assert.equal(report.approvals, 0)
    assert.equal(report.proposals, 0)
    assert.equal(report.archives.length, 30)
    assert.equal(new Set(report.archives.map(row => row.documentId)).size, 30)
    assert.equal(new Set(report.archives.map(row => row.drawingId)).size, 30)
    assert.equal(new Set(report.archives.map(row => row.dxfSha256)).size, 30, 'different source facts produce thirty distinct physically verified DXFs')
    assert.equal(report.archives.every(row => row.hostValidationOnly && row.fullPhysicalGeometryHatchesResourcesVerified && row.nativeSourceRetained), true)
    assert.equal(report.archives.every(row => row.physicalValidationPaperHeightMillimeters === 297 &&
      row.physicalValidationPaperHeightOrigin === 'published-sdk-default-layout-policy'), true)
    assert.deepEqual(fixture.workspaceMembers.map(member => canonicalStringify(member.document.snapshot())), before)
    assert.equal(report.responseUsage.every(row => row.usage === null), true, 'fixture with no usage does not fabricate token counts')
  } finally { fixture.dispose() }
})

for (const fault of ['wrong-document', 'one-failed-read', 'skip-document-read', 'forbidden-proposal',
  'final-omit-document', 'final-duplicate-document', 'final-crossdoc-identity', 'final-implicit-approval', 'final-non-json', 'final-tool-call'])
  test(`read-only original fails closed for ${fault}; no hidden reads or partial-document pass`, async () => {
    const fixture = await buildRound8ReviewedWorkflowFixture(scenario)
    try {
      const report = await runRound8BatchReviewedChatWorkflow(scenario, { fixture,
        modelAdapter: scriptedAdapter({ fault, otherDrawingId: fixture.workspaceMembers[0].drawingId }) })
      assert.notEqual(report.status, 'completed')
      assert.equal(report.scenarioPassed, null)
      assert.equal(report.verifiedWorkflowExecutions, 0)
      assert.equal(report.approvals, 0)
      assert.equal(report.proposals, 0)
      assert.equal(report.archives.length, 0, 'failed model workflow is not relabeled through a successful archive selftest')
      assert.equal(fixture.workspaceMembers.every(member => canonicalStringify(member.document.snapshot()) === member.initialState), true)
      if (!fault.startsWith('final-')) assert.equal(report.documentRuns.length, 8)
      else assert.equal(report.documentRuns.length, 30)
      if (fault === 'one-failed-read' || fault === 'wrong-document') {
        assert.equal(report.documentRuns.at(-1).toolCalls.some(call => call.result.ok === false), true)
        assert.equal(report.documentRuns.at(-1).currentRead, true, 'a later successful repair cannot hide an earlier failed read under the frozen oracle')
      }
      if (fault === 'skip-document-read') {
        assert.equal(report.toolCalls, 7)
        assert.equal(report.errorCode, 'KJAGENT_READ_REQUIRED', 'actual SDK read guard rejects the persistent missing read after its bounded correction')
      }
      if (fault === 'forbidden-proposal') assert.equal(report.errorCode, 'KJAGENT_TOOL_NOT_ALLOWED')
    } finally { fixture.dispose() }
  })

for (const fault of ['duplicate-native-ownership', 'cross-document-source', 'missing-source-table'])
  test(`incomplete ownership/source preparation remains not-ready: ${fault}`, async () => {
    const fixture = await buildRound8ReviewedWorkflowFixture(scenario)
    try {
      if (fault === 'duplicate-native-ownership') fixture.workspaceMembers[1] = fixture.workspaceMembers[0]
      else if (fault === 'cross-document-source') fixture.workspaceMembers[1].source = clone(fixture.workspaceMembers[0].source)
      else fixture.workspaceMembers[1].completeDeclaredSource = undefined
      const report = await runRound8BatchReviewedChatWorkflow(scenario, { fixture, modelAdapter: scriptedAdapter() })
      assert.equal(report.status, 'not-ready')
      assert.equal(report.requests, 0)
      assert.equal(report.scenarioPassed, null)
      assert.equal(report.scenarioExecuted, false)
    } finally { fixture.dispose() }
  })

for (const budget of [{ maxRequests: 60 }, { maxToolCalls: 29 }, { maxBytes: 1024 }])
  test(`bounded host resources cannot silently expand: ${JSON.stringify(budget)}`, async () => {
    const fixture = await buildRound8ReviewedWorkflowFixture(scenario)
    try {
      const report = await runRound8BatchReviewedChatWorkflow(scenario, { fixture, modelAdapter: scriptedAdapter(), ...budget })
      assert.notEqual(report.status, 'completed')
      assert.ok(report.requests <= (budget.maxRequests ?? 64))
      assert.ok(report.toolCalls <= (budget.maxToolCalls ?? 96))
      assert.equal(report.errorCode, Object.hasOwn(budget, 'maxRequests') ? 'BATCH_REQUEST_BUDGET_EXHAUSTED'
        : Object.hasOwn(budget, 'maxToolCalls') ? 'BATCH_TOOL_BUDGET_EXHAUSTED' : 'KJMODEL_SIZE_LIMIT')
      if (Object.hasOwn(budget, 'maxBytes')) assert.equal(report.requests, 0,
        'the native adapter schema/history byte guard fails before transport when even selected tool schemas exceed 1024 bytes')
      assert.equal(report.scenarioPassed, null)
      assert.equal(fixture.workspaceMembers.every(member => canonicalStringify(member.document.snapshot()) === member.initialState), true)
    } finally { fixture.dispose() }
  })

test('no external provider is called by a cancelled task and wrong original intent is refused', async () => {
  const controller = new AbortController(); controller.abort()
  const fixture = await buildRound8ReviewedWorkflowFixture(scenario)
  try {
    const report = await runRound8BatchReviewedChatWorkflow(scenario,
      { fixture, signal: controller.signal, modelAdapter: scriptedAdapter() })
    assert.equal(report.status, 'cancelled')
    assert.equal(report.requests, 0)
    assert.equal(report.scenarioPassed, null)
    await assert.rejects(runRound8BatchReviewedChatWorkflow(corpus.scenarios.find(s => s.expected.intent === 'source-section.mixed-source-and-manual-edit'),
      { fixture, modelAdapter: scriptedAdapter() }), /NO_ORIGINAL_BATCH_STAGING_SCENARIO/)
    await assert.rejects(runRound8BatchReviewedChatWorkflow(scenario, { fixture, modelAdapter: scriptedAdapter(), maxRequests: 10000 }), /INVALID_BATCH_DRIVER_BUDGET/)
  } finally { fixture.dispose() }
})
