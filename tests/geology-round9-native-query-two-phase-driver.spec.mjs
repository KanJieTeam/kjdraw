import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { ROUND9_NATIVE_QUERY_CHAT_PROTOCOL } from '../scripts/testing/helpers/geology-round9-native-query-chat-driver.mjs'
import { ROUND9_NATIVE_QUERY_SCENARIO_IDS, ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT, buildRound9NativeQueryFixture,
  round9NativeQueryDescriptor } from '../scripts/testing/helpers/geology-round9-native-query-oracles.mjs'
import { ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL, round9TwoPhaseFinalOutputContract,
  runRound9NativeQueryTwoPhaseWorkflow } from '../scripts/testing/helpers/geology-round9-native-query-two-phase-driver.mjs'

const initialCorpus = await readFile(FIXTURE_URL), corpus = JSON.parse(initialCorpus), clone = structuredClone
const scenarios = new Map(corpus.scenarios.map(row => [row.id, row])), policy = ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT
const scenario = (kind = 'model-extents', language = 'zh') => scenarios.get(`GUS1-cad-query.${kind}-${language}-direct`)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const frozenPaths = ['../scripts/testing/helpers/geology-round9-native-query-chat-driver.mjs',
  '../scripts/testing/helpers/geology-round9-native-query-oracles.mjs']
const frozenHashes = await Promise.all(frozenPaths.map(async path => hash(await readFile(new URL(path, import.meta.url)))))
const union = rows => ({ min: [0, 1, 2].map(axis => Math.min(...rows.map(row => row.min[axis]))),
  max: [0, 1, 2].map(axis => Math.max(...rows.map(row => row.max[axis]))) })
function box(entity) {
  const g = entity.geometry, point = p => ({ min: [p[0], p[1], p[2] ?? 0], max: [p[0], p[1], p[2] ?? 0] })
  if (entity.type === 'LINE') return union([point(g.start), point(g.end)])
  if (entity.type === 'CIRCLE') return { min: [g.center[0] - g.radius, g.center[1] - g.radius, g.center[2] ?? 0],
    max: [g.center[0] + g.radius, g.center[1] + g.radius, g.center[2] ?? 0] }
  if (entity.type === 'LWPOLYLINE') return union(g.vertices.map(vertex => point(Array.isArray(vertex) ? vertex : vertex.point)))
  assert.ok(['TEXT', 'MTEXT'].includes(entity.type))
  // Scripted response computation only. The explicit read fixture rectangle
  // encloses this conservative text reserve; this is not a glyph-bounds API.
  const reserve = Math.max([...g.text].length * g.height * 4, g.width ?? 0, g.height * 4)
  return { min: [g.position[0] - reserve, g.position[1] - reserve, g.position[2] ?? 0],
    max: [g.position[0] + reserve, g.position[1] + reserve, g.position[2] ?? 0] }
}
function distance(p, entity) {
  const g = entity.geometry
  if (entity.type === 'CIRCLE') return Math.abs(Math.hypot(p[0] - g.center[0], p[1] - g.center[1]) - g.radius)
  const dx = g.end[0] - g.start[0], dy = g.end[1] - g.start[1], squared = dx * dx + dy * dy
  const t = squared ? Math.max(0, Math.min(1, ((p[0] - g.start[0]) * dx + (p[1] - g.start[1]) * dy) / squared)) : 0
  return Math.hypot(p[0] - g.start[0] - t * dx, p[1] - g.start[1] - t * dy)
}

/** This fixture adapter is not a real model. It has no SDK, native fixture or
 * gold imports. It emits actual tool calls and computes final bytes solely
 * from actual runner-returned tool results. Every report remains null-pass. */
function scriptedAdapter(options = {}) {
  let input, serial = 0, injected = false
  const issued = new Map(), observations = []
  const adapter = { origin: 'fixture-oracle-selftest', model: 'two-phase-scripted-fixture-not-provider', observations,
    async call({ messages, settings, phase, signal, requestIndex }) {
      observations.push({ phase, requestIndex, messages: clone(messages), settings: clone(settings) })
      assert.equal(Object.hasOwn(settings, 'stream'), false)
      if (options.onCall) await options.onCall({ phase, signal, requestIndex })
      if (options.providerFailure) { const error = new Error('fixture transport failure'); error.code = 'FIXTURE_TRANSPORT_FAILED'; throw error }
      const response = (content, toolCalls = []) => ({ content, toolCalls,
        ...(options.usage ? { usage: clone(options.usage) } : {}) })
      if (phase === 'final-only-json') {
        assert.deepEqual(settings.response_format, { type: 'json_object' })
        assert.deepEqual(settings.tools, [])
        assert.ok(messages[0].content.includes('without prose'))
        const frame = messages.find(message => message.content?.includes(ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.finalInputStart)).content
        const final = JSON.parse(frame.split(ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.finalInputStart)[1].split(ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.finalInputEnd)[0])
        const receipts = final.actualSuccessfulNativeReadReceipts
        assert.ok(receipts.length && receipts.every(row => row.result.ok === true))
        const geometry = receipts.filter(row => row.name === 'cad_query_drawing')
        const modelId = geometry.find(row => !Object.hasOwn(row.args.filters, 'spaceId')).result.value.spaceId
        const rows = geometry.filter(row => (row.args.filters.spaceId ?? modelId) === modelId).flatMap(row => row.result.value.entities)
        const layoutIds = receipts.filter(row => row.name === 'cad_read_layouts').flatMap(row => row.result.value.layouts)
          .filter(row => !row.model).map(row => row.spaceId)
        const header = { documentId: final.currentDocument.documentId, revision: final.currentDocument.revision, units: final.currentDocument.units }
        let answer
        if (Object.hasOwn(final.responseSchema.properties, 'model')) {
          answer = { ...header, model: { spaceId: modelId, ...union(rows.map(box)) }, excludedPaperSpaceIds: layoutIds }
          if (Object.hasOwn(final.responseSchema.properties, 'paperSpaces')) answer.paperSpaces = layoutIds.flatMap(spaceId => {
            const paperRows = geometry.filter(row => row.args.filters.spaceId === spaceId).flatMap(row => row.result.value.entities)
            return paperRows.length ? [{ spaceId, ...union(paperRows.map(box)) }] : []
          })
        } else {
          const referenceId = final.bindings.aliases['TEXT-A'].nativeId, anchor = rows.find(row => row.id === referenceId)
          assert.ok(anchor?.geometry)
          answer = { ...header, referenceId, candidates: rows.filter(row => row.ownerId === modelId && ['LINE', 'CIRCLE'].includes(row.type)
            && distance(anchor.geometry.position, row) <= final.bindings.suppliedInputs.neighborhoodQueryContract.radius)
            .map(row => ({ id: row.id, type: row.type })), geologicalMeaningAssigned: false }
        }
        if (options.alterAnswer) options.alterAnswer(answer, { final, rows, geometry, layoutIds })
        if (options.finalTool) return response('', [{ id: 'forbidden-final-call', type: 'function', function: {
          name: 'cad_propose_move', arguments: JSON.stringify({ expectedRevision: header.revision, units: header.units, ids: [rows[0].id], dx: 1, dy: 0 }) } }])
        if (options.finalOversize) return response('x'.repeat(1048577))
        return response(options.finalText ? options.finalText(answer) : JSON.stringify(answer))
      }
      assert.equal(phase, 'native-reads')
      assert.equal(Object.hasOwn(settings, 'response_format'), false)
      assert.ok(settings.tools.length > 0)
      if (!input) {
        const frame = messages.find(message => message.content?.includes(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.inputStart)).content
        input = JSON.parse(frame.split(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.inputStart)[1].split(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.inputEnd)[0])
      }
      const tool = (name, args) => {
        const id = `new-two-phase-fixture-${++serial}`; issued.set(id, { name, args: clone(args) })
        return response('', [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }])
      }
      if (options.fakeRead) return response(JSON.stringify({ tool_calls: [{ function: { name: 'cad_query_drawing', arguments: {} } }] }))
      if (options.propose) return tool('cad_propose_move', { expectedRevision: input.currentDocument.revision, units: input.currentDocument.units,
        ids: [input.bindings.aliases['CIRCLE-A'].nativeId], dx: 1, dy: 0 })
      if (options.staleFirst && !injected) { injected = true; return tool('cad_query_drawing', {
        expectedRevision: input.currentDocument.revision + 1, filters: {}, offset: 0, layerOffset: 0, limit: 200, maxLayers: 100, maxBytes: 262144 }) }
      const receipts = messages.filter(message => message.role === 'tool').map(message => {
        assert.ok(issued.has(message.tool_call_id), 'All evidence must correspond to an actual model-issued call')
        return { ...issued.get(message.tool_call_id), result: JSON.parse(message.content) }
      }).filter(row => row.result.ok === true)
      const extents = input.responseGrammar.includes('excludedPaperSpaceIds'), layouts = receipts.filter(row => row.name === 'cad_read_layouts')
      if (extents && !layouts.some(row => row.result.value.nextOffset === null)) return tool('cad_read_layouts', {
        expectedRevision: input.currentDocument.revision, offset: layouts.at(-1)?.result.value.nextOffset ?? 0, limit: 100, maxBytes: 262144 })
      const pages = receipts.filter(row => row.name === 'cad_query_drawing'), modelPages = pages.filter(row => !Object.hasOwn(row.args.filters, 'spaceId'))
      if (options.wrongOwner) {
        if (pages.length) return response('The paper owner read is complete; no model owner was inspected.')
        const actualPaperId = layouts.flatMap(row => row.result.value.layouts).find(row => !row.model).spaceId
        return tool('cad_query_drawing', { expectedRevision: input.currentDocument.revision, filters: { spaceId: actualPaperId },
          offset: 0, layerOffset: 0, limit: 200, maxLayers: 100, maxBytes: 262144 })
      }
      if (!modelPages.length || !options.partialPagination && !modelPages.some(row => row.result.value.nextOffset === null)) return tool('cad_query_drawing', {
        expectedRevision: input.currentDocument.revision, filters: options.skipAnchor ? { types: ['LINE', 'CIRCLE'] } : {},
        offset: modelPages.at(-1)?.result.value.nextOffset ?? 0, layerOffset: 0, limit: options.partialPagination ? 3 : options.pageLimit ?? 200,
        maxLayers: 100, maxBytes: 262144 })
      if (extents && input.responseGrammar.includes(',"paperSpaces":')) for (const spaceId of layouts.flatMap(row => row.result.value.layouts).filter(row => !row.model).map(row => row.spaceId)) {
        if (options.skipPaperRead) break
        const paperPages = pages.filter(row => row.args.filters.spaceId === spaceId)
        if (!paperPages.some(row => row.result.value.nextOffset === null)) return tool('cad_query_drawing', {
          expectedRevision: input.currentDocument.revision, filters: { spaceId }, offset: paperPages.at(-1)?.result.value.nextOffset ?? 0,
          layerOffset: 0, limit: options.pageLimit ?? 200, maxLayers: 100, maxBytes: 262144 })
      }
      return response(options.readText ?? 'The requested native reads are complete.')
    } }
  return adapter
}
function satisfied(report) {
  assert.equal(report.status, 'completed', JSON.stringify({ error: report.errorCode, gate: report.readGateAssertions?.filter(row => !row.satisfied),
    assertions: report.verdict?.assertions?.filter(row => !row.satisfied) }))
  assert.equal(report.verdict.status, 'satisfied'); assert.equal(report.scenarioPassed, null)
  assert.equal(report.modelCalls, 0); assert.equal(report.fixtureOnly, true); assert.equal(report.scenarioExecuted, false)
  assert.equal(report.verifiedWorkflowExecutions, 0); assert.equal(report.networkRequestsVerified, null)
  assert.equal(report.finalRequests, 1); assert.ok(report.requests <= 16 && report.toolCalls <= 32)
  assert.equal(report.requests, report.requestRecords.length); assert.equal(report.requests, report.responseUsage.length)
  assert.equal(report.stateUnchanged, true); assert.equal(report.proposals, 0); assert.equal(report.approvals, 0)
  assert.deepEqual(report.answer, JSON.parse(report.rawFinalAnswer))
  assert.ok(report.calls.length && report.calls.every(call => call.result.ok === true))
}

test('new prospective two-phase protocol leaves old protocols untouched and reserves final request within total budget', () => {
  assert.deepEqual(ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.defaultBudgets, { maxRequests: 16, maxToolCalls: 32, maxBytes: 1048576, timeoutMs: 120000 })
  assert.equal(ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.readPhaseMaximumRequests, 15)
  assert.equal(ROUND9_NATIVE_QUERY_TWO_PHASE_PROTOCOL.reservedFinalRequests, 1)
  assert.equal(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.version, 'round9-single-native-document-read-only-chat-v1')
})
for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS) test(`actual native reads then separate raw final JSON; fixture only ${id}`, async () => {
  const current = scenarios.get(id), options = round9NativeQueryDescriptor(current).intent.endsWith('label-neighborhood') ? { neighborhoodPolicy: policy } : {}
  const adapter = scriptedAdapter(), report = await runRound9NativeQueryTwoPhaseWorkflow(current, { ...options, modelAdapter: adapter })
  satisfied(report)
  assert.equal(report.originalQuestionHash, hash(current.prompt))
  assert.equal(report.readPhaseRawText, 'The requested native reads are complete.')
  assert.equal(report.firstPhase.errorCode, 'ROUND9_FINAL_ANSWER_NOT_JSON')
  assert.equal(report.firstPhase.verdict.status, 'failed', 'First-stage original verdict is retained, not repaired')
  assert.deepEqual(report.readPhaseOriginalVerdict, report.firstPhase.verdict)
  assert.ok(report.readGateAssertions.every(row => row.satisfied))
  assert.ok(report.requestRecords.filter(row => row.phase === 'native-reads').every(row => !Object.hasOwn(row.settings, 'response_format')))
  const final = report.requestRecords.at(-1)
  assert.equal(final.phase, 'final-only-json'); assert.deepEqual(final.settings.tools, []); assert.deepEqual(final.settings.response_format, { type: 'json_object' })
  assert.equal(report.requestBytesTotal, report.requestRecords.reduce((sum, row) => sum + row.requestBytes, 0))
  assert.equal(report.responseBytesTotal, report.requestRecords.reduce((sum, row) => sum + row.responseBytes, 0))
  assert.ok(report.requestRecords.every(row => row.requestBytes <= 1048576 && row.responseBytes <= 1048576))
})
for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS.filter(id => id.includes('label-neighborhood'))) test(`no implicit caller neighborhood policy: ${id}`, async () => {
  let calls = 0
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenarios.get(id), { modelAdapter: {
    origin: 'fixture-oracle-selftest', call() { calls++; throw Error('must not run') } } })
  assert.equal(report.status, 'not-ready'); assert.equal(report.requests, 0); assert.equal(report.finalRequests, 0); assert.equal(calls, 0)
})
test('closed final grammar supplies shape only, Chinese has no paperSpaces; English lists it without expected values', () => {
  const zh = round9TwoPhaseFinalOutputContract(scenario()), en = round9TwoPhaseFinalOutputContract(scenario('model-extents', 'en'))
  assert.equal(zh.additionalProperties, false); assert.equal(Object.hasOwn(zh.properties, 'paperSpaces'), false)
  assert.equal(Object.hasOwn(en.properties, 'paperSpaces'), true)
  assert.equal(JSON.stringify(zh).includes('-1000'), false); assert.equal(JSON.stringify(en).includes('1400'), false)
  const neighborhood = round9TwoPhaseFinalOutputContract(scenario('label-neighborhood'))
  assert.deepEqual(neighborhood.properties.candidates.items.properties.type.enum, ['LINE', 'CIRCLE'])
})
test('returned grammar objects cannot mutate subsequent caller contracts or host final schemas', () => {
  const exported = round9TwoPhaseFinalOutputContract(scenario())
  exported.properties.documentId.type = 'forged'; exported.additionalProperties = true
  const later = round9TwoPhaseFinalOutputContract(scenario())
  assert.equal(later.properties.documentId.type, 'string'); assert.equal(later.additionalProperties, false)
})
for (const options of [{ fakeRead: true }, { staleFirst: true }, { partialPagination: true }, { wrongOwner: true }, { propose: true }, { providerFailure: true }])
  test(`first-stage actual failure prevents final, preserved actual receipts: ${JSON.stringify(options)}`, async () => {
    const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { modelAdapter: scriptedAdapter(options) })
    assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0); assert.equal(report.stateUnchanged, true)
    assert.equal(report.proposals, 0); assert.equal(report.approvals, 0)
    assert.equal(report.requestRecords.some(row => row.phase === 'final-only-json'), false)
    if (options.fakeRead) { assert.equal(report.errorCode, 'KJAGENT_READ_REQUIRED'); assert.equal(report.toolCalls, 0) }
    if (options.staleFirst) { assert.ok(report.calls.some(row => row.result.ok === false)); assert.ok(report.calls.some(row => row.result.ok === true)) }
    if (options.wrongOwner) assert.equal(report.readGateAssertions.find(row => row.id === 'all-model-native-geometries-read').satisfied, false)
  })
test('unread actual text anchor cannot be supplied by aliases or host into final evidence', async () => {
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario('label-neighborhood'), {
    neighborhoodPolicy: policy, modelAdapter: scriptedAdapter({ skipAnchor: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
  assert.equal(report.readGateAssertions.find(row => row.id === 'actual-native-text-anchor-read').satisfied, false)
})
test('English paper pagination must be real before final; unused paper space never becomes zero bounds', async () => {
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario('model-extents', 'en'), { modelAdapter: scriptedAdapter({ skipPaperRead: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
  assert.ok(report.readGateAssertions.some(row => row.id.startsWith('complete-paper-pagination:') && !row.satisfied))
})
test('multiple actual geometry pages still must be traversed under shared budgets', async () => {
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { modelAdapter: scriptedAdapter({ pageLimit: 3 }) })
  satisfied(report); assert.ok(report.calls.some(row => row.args.offset > 0))
})
for (const kind of ['model-extents', 'label-neighborhood']) test(`${kind} final wrong math is not corrected by host`, async () => {
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(kind), { ...(kind === 'label-neighborhood' ? { neighborhoodPolicy: policy } : {}),
    modelAdapter: scriptedAdapter({ alterAnswer: answer => { if (answer.model) answer.model.min[0] = 0; else answer.candidates = [] } }) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 1)
  assert.equal(report.verdict.assertions.find(row => row.id === 'exact-independent-native-answer').satisfied, false)
  assert.deepEqual(JSON.parse(report.rawFinalAnswer), report.answer)
})
test('final foreign owner and document identity remain exact oracle failures', async () => {
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { modelAdapter: scriptedAdapter({ alterAnswer: answer => {
    answer.documentId = 'foreign-document'; answer.model.spaceId = 'foreign-owner'
  } }) })
  assert.equal(report.status, 'failed'); assert.equal(report.stateUnchanged, true)
  assert.equal(report.verdict.assertions.find(row => row.id === 'model-paper-space-separated').satisfied, false)
})
for (const options of [{ finalText: answer => '```json\n' + JSON.stringify(answer) + '\n```' },
  { finalText: answer => 'Result: ' + JSON.stringify(answer) }, { finalText: () => '[]' },
  { alterAnswer: answer => { answer.extra = 'not requested' } }, { finalTool: true }])
  test(`no final format repair, extra-field stripping or CAD execution: ${Object.keys(options).join(',')}`, async () => {
    const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { modelAdapter: scriptedAdapter(options) })
    assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 1); assert.equal(report.stateUnchanged, true)
    assert.equal(report.proposals, 0); assert.equal(report.approvals, 0); assert.ok(report.rawFinalAnswer !== undefined)
    if (options.finalTool) assert.equal(report.errorCode, 'ROUND9_TWO_PHASE_FINAL_TOOL_CALL_NOT_ALLOWED')
  })
test('raw requests/responses and supplied usage preserved; missing counters do not become fake totals or network verification', async () => {
  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 3 }
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { modelAdapter: scriptedAdapter({ usage }) })
  satisfied(report)
  assert.ok(report.responseUsage.every(row => JSON.stringify(row.usage) === JSON.stringify(usage)))
  assert.ok(report.requestRecords.every(row => JSON.stringify(row.response.usage) === JSON.stringify(usage)))
  assert.equal(report.finalNormalizedUsage.totalTokens, 120)
  const invalid = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { modelAdapter: scriptedAdapter({ usage: { totalTokens: 'fake' } }) })
  satisfied(invalid); assert.equal(invalid.finalNormalizedUsage.totalTokens, null)
  assert.ok(invalid.responseUsage.every(row => row.usage.totalTokens === 'fake'))
})
for (const budget of [{ maxRequests: 2 }, { maxToolCalls: 1 }, { maxBytes: 1024 }]) test(`shared budget never expanded or unread work filled: ${JSON.stringify(budget)}`, async () => {
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { ...budget, modelAdapter: scriptedAdapter() })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
  assert.ok(report.requests <= (budget.maxRequests ?? 16)); assert.ok(report.toolCalls <= (budget.maxToolCalls ?? 32))
})
test('final-only oversized response is preserved as raw evidence but rejected by the same byte budget', async () => {
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { modelAdapter: scriptedAdapter({ finalOversize: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'ROUND9_TWO_PHASE_RESPONSE_BYTES_EXHAUSTED')
  assert.equal(report.requestRecords.at(-1).response.content.length, 1048577)
})
test('pre-cancelled external signal invokes no provider or native reads', async () => {
  const controller = new AbortController(); controller.abort()
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { signal: controller.signal, modelAdapter: scriptedAdapter() })
  assert.equal(report.status, 'cancelled'); assert.equal(report.requests, 0); assert.equal(report.finalRequests, 0)
})
test('overall timeout also interrupts an adapter ignoring its signal; no final and no second source execution', async () => {
  const fixture = await buildRound9NativeQueryFixture(scenario())
  try {
    const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { fixture, timeoutMs: 30,
      modelAdapter: { origin: 'fixture-oracle-selftest', call: () => new Promise(() => {}) } })
    assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'ROUND9_TWO_PHASE_TIMEOUT')
    assert.equal(report.finalRequests, 0); assert.equal(report.requests, 1)
  } finally { fixture.dispose() }
})
test('cancellation after actual read completion prevents final adapter dispatch', async () => {
  const controller = new AbortController()
  const report = await runRound9NativeQueryTwoPhaseWorkflow(scenario(), { signal: controller.signal,
    modelAdapter: scriptedAdapter({ onCall: ({ requestIndex }) => { if (requestIndex === 3) controller.abort() } }) })
  assert.equal(report.status, 'cancelled'); assert.equal(report.finalRequests, 0)
})
test('native document, history, source artifact, question and old driver/oracle are preserved exactly', async () => {
  const current = scenario(), fixture = await buildRound9NativeQueryFixture(current)
  try {
    const initial = fixtureStateSignature(fixture.document), history = clone(fixture.document.history), source = hash(fixture.artifact.bytes)
    const report = await runRound9NativeQueryTwoPhaseWorkflow(current, { fixture, modelAdapter: scriptedAdapter() })
    satisfied(report); assert.equal(fixtureStateSignature(fixture.document), initial)
    assert.deepEqual(fixture.document.history, history); assert.equal(hash(fixture.artifact.bytes), source)
    assert.equal(report.originalQuestionHash, hash(current.prompt)); assert.equal(fixture.sdk.agentPlans.list().length, 0)
  } finally { fixture.dispose() }
  assert.equal(hash(await readFile(FIXTURE_URL)), hash(initialCorpus))
  assert.deepEqual(await Promise.all(frozenPaths.map(async path => hash(await readFile(new URL(path, import.meta.url))))), frozenHashes)
})
for (const options of [{ answer: {} }, { response_format: { type: 'json_object' } }, { maxRequests: 17 },
  { maxToolCalls: 33 }, { maxBytes: 1048577 }, { timeoutMs: 120001 }, { maxRequests: 1 }])
  test(`unknown caller answer/format or expanded budget rejected before any adapter call: ${Object.keys(options).join(',')}`, async () => {
    let calls = 0
    await assert.rejects(runRound9NativeQueryTwoPhaseWorkflow(scenario(), { ...options,
      modelAdapter: { origin: 'fixture-oracle-selftest', call() { calls++ } } }), /UNKNOWN_ROUND9_TWO_PHASE_OPTION|INVALID_ROUND9_TWO_PHASE_BUDGET/)
    assert.equal(calls, 0)
  })
test('hidden, symbolic or accessor options fail closed without invoking getters or adapter', async () => {
  let invoked = 0
  const adapter = { origin: 'fixture-oracle-selftest', call() { invoked++ } }
  for (const malicious of [Object.defineProperty({ modelAdapter: adapter }, 'answer', { enumerable: false, value: {} }),
    { modelAdapter: adapter, [Symbol('answer')]: {} },
    Object.defineProperty({}, 'modelAdapter', { enumerable: true, get() { invoked++; return adapter } })])
    await assert.rejects(runRound9NativeQueryTwoPhaseWorkflow(scenario(), malicious), /UNKNOWN_ROUND9_TWO_PHASE_OPTION/)
  assert.equal(invoked, 0)
})
