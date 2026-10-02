import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { ROUND9_NATIVE_GEOMETRY_TOOLS_PROTOCOL as PROTOCOL, runRound9NativeGeometryToolsWorkflow,
  round9NativeGeometryToolInputs, evaluateRound9NativeGeometryToolCoverage } from '../scripts/testing/helpers/geology-round9-native-geometry-tools-driver.mjs'
import { ROUND9_NATIVE_QUERY_SCENARIO_IDS, ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT as policy,
  round9NativeQueryDescriptor, buildRound9NativeQueryFixture } from '../scripts/testing/helpers/geology-round9-native-query-oracles.mjs'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'

const clone = structuredClone, hash = value => createHash('sha256').update(value).digest('hex')
const corpusBytes = await readFile(FIXTURE_URL), corpus = JSON.parse(corpusBytes), scenarios = new Map(corpus.scenarios.map(row => [row.id, row]))
const frozenPaths = ['../scripts/testing/helpers/geology-round9-native-query-chat-driver.mjs',
  '../scripts/testing/helpers/geology-round9-native-query-oracles.mjs', '../scripts/testing/helpers/geology-round9-native-query-two-phase-driver.mjs']
const frozenHashes = await Promise.all(frozenPaths.map(async path => hash(await readFile(new URL(path, import.meta.url)))))
const scenario = (kind = 'model-extents', language = 'zh') => scenarios.get(`GUS1-cad-query.${kind}-${language}-direct`)
const union = boxes => ({ min: [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]))),
  max: [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]))) })
function nativeBox(entity, curveRows) {
  const g = entity.geometry, measured = curveRows.find(row => row.id === entity.id)
  const point = p => ({ min: [p[0], p[1], p[2] ?? 0], max: [p[0], p[1], p[2] ?? 0] })
  if (measured) {
    const z = entity.type === 'LINE' ? [Math.min(g.start[2], g.end[2]), Math.max(g.start[2], g.end[2])] : [g.center[2], g.center[2]]
    return { min: [...measured.bounds.min, z[0]], max: [...measured.bounds.max, z[1]] }
  }
  if (entity.type === 'LWPOLYLINE') return union(g.vertices.map(vertex => point(Array.isArray(vertex) ? vertex : vertex.point)))
  if (entity.type === 'LINE') return union([point(g.start), point(g.end)])
  if (entity.type === 'CIRCLE') return { min: [g.center[0] - g.radius, g.center[1] - g.radius, g.center[2]], max: [g.center[0] + g.radius, g.center[1] + g.radius, g.center[2]] }
  assert.ok(['TEXT', 'MTEXT'].includes(entity.type))
  // Fixture-adapter computation, not host computation or an engine glyph API.
  // The actual large read polyline encloses this conservative text reserve.
  const reserve = Math.max([...g.text].length * g.height * 4, g.width ?? 0, g.height * 4)
  return { min: [g.position[0] - reserve, g.position[1] - reserve, g.position[2]], max: [g.position[0] + reserve, g.position[1] + reserve, g.position[2]] }
}
function frame(messages, start, end) {
  const text = messages.find(message => typeof message.content === 'string' && message.content.includes(start)).content
  return JSON.parse(text.split(start)[1].split(end)[0])
}

/** Public scripted adapter selftest, never real model execution. It has no
 * document, SDK, baseline/gold import or output oracle. All final data come
 * only from the caller's public declarations and real returned receipts. */
function fixtureAdapter(options = {}) {
  const issued = new Map(), observations = []; let input, serial = 0, injected = false
  const response = (content, toolCalls = []) => ({ content, toolCalls, ...(options.usage ? { usage: clone(options.usage) } : {}) })
  return { origin: 'fixture-oracle-selftest', model: 'native-geometry-tools-fixture-not-provider', observations,
    async call({ messages, settings, phase, signal, requestIndex }) {
      observations.push({ messages: clone(messages), settings: clone(settings), phase, requestIndex })
      assert.equal(Object.hasOwn(settings, 'stream'), false)
      if (options.onCall) await options.onCall({ phase, signal, requestIndex })
      if (options.transportFail) { const error = new Error('private transport detail must not be copied'); error.code = 'PUBLIC_FIXTURE_TRANSPORT_ERROR'; throw error }
      if (phase === 'final-only-json') {
        assert.deepEqual(settings.response_format, { type: 'json_object' }); assert.deepEqual(settings.tools, [])
        const final = frame(messages, PROTOCOL.finalInputStart, PROTOCOL.finalInputEnd)
        const receipts = final.actualSuccessfulNativeReadReceipts, geometry = receipts.filter(row => row.name === 'cad_query_drawing')
        const modelId = geometry.find(row => !Object.hasOwn(row.args.filters, 'spaceId')).result.value.spaceId
        const rows = geometry.filter(row => (row.args.filters.spaceId ?? modelId) === modelId).flatMap(row => row.result.value.entities)
        const layoutIds = receipts.filter(row => row.name === 'cad_read_layouts').flatMap(row => row.result.value.layouts)
          .filter(row => !row.model).map(row => row.spaceId)
        const helperPages = receipts.filter(row => row.name === final.geometryReadContract.requiredToolName)
        const helperRows = helperPages.flatMap(row => row.result.value.rows)
        const header = { documentId: final.currentDocument.documentId, revision: final.currentDocument.revision, units: final.currentDocument.units }
        let answer
        if (Object.hasOwn(final.responseSchema.properties, 'model')) {
          assert.ok(helperRows.length)
          answer = { ...header, model: { spaceId: modelId, ...union(rows.map(row => nativeBox(row, helperRows))) }, excludedPaperSpaceIds: layoutIds }
          if (Object.hasOwn(final.responseSchema.properties, 'paperSpaces')) answer.paperSpaces = layoutIds.flatMap(spaceId => {
            const paperRows = geometry.filter(row => row.args.filters.spaceId === spaceId).flatMap(row => row.result.value.entities)
            return paperRows.length ? [{ spaceId, ...union(paperRows.map(row => nativeBox(row, []))) }] : []
          })
        } else {
          answer = { ...header, referenceId: helperPages[0].result.value.anchor.id,
            candidates: helperRows.map(row => ({ id: row.id, type: row.type })), geologicalMeaningAssigned: false }
        }
        if (options.alterAnswer) options.alterAnswer(answer, { final, rows, helperPages, layoutIds })
        if (options.finalTool) return response('', [{ id: 'forbidden-final-tool', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' } }])
        if (options.finalOversize) return response('x'.repeat(1048577))
        return response(options.finalText ? options.finalText(answer) : JSON.stringify(answer))
      }
      assert.equal(phase, 'native-reads'); assert.equal(Object.hasOwn(settings, 'response_format'), false)
      assert.deepEqual(settings.tools.map(row => row.function.name).sort(), [...PROTOCOL.toolNames].sort())
      input ??= frame(messages, PROTOCOL.inputStart, PROTOCOL.inputEnd)
      const tool = (name, args) => {
        const id = options.duplicateIds ? 'duplicate-model-call' : `native-geometry-fixture-${++serial}`
        issued.set(id, { name, args: clone(args) })
        return response('', [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }])
      }
      if (options.fakeAllReads) return response(JSON.stringify({ tool_calls: [{ function: { name: 'cad_query_curve_bounds', arguments: {} } }] }))
      if (options.propose) return tool('cad_propose_move', { expectedRevision: input.currentDocument.revision, units: input.currentDocument.units,
        ids: [input.bindings.aliases['CIRCLE-A'].nativeId], dx: 1, dy: 0 })
      const receipts = messages.filter(message => message.role === 'tool').map(message => {
        assert.ok(issued.has(message.tool_call_id)); return { ...issued.get(message.tool_call_id), result: JSON.parse(message.content) }
      }).filter(row => row.result.ok === true)
      const extents = input.geometryReadContract.requiredToolName === 'cad_query_curve_bounds'
      const layouts = receipts.filter(row => row.name === 'cad_read_layouts')
      if (extents && !layouts.some(row => row.result.value.nextOffset === null)) return tool('cad_read_layouts', {
        expectedRevision: input.currentDocument.revision, offset: layouts.at(-1)?.result.value.nextOffset ?? 0, limit: options.layoutLimit ?? 100, maxBytes: 262144 })
      const pages = receipts.filter(row => row.name === 'cad_query_drawing'), modelPages = pages.filter(row => !Object.hasOwn(row.args.filters, 'spaceId'))
      if (!modelPages.some(row => row.result.value.nextOffset === null)) return tool('cad_query_drawing', {
        expectedRevision: input.currentDocument.revision, filters: options.skipAnchor ? { types: ['LINE', 'CIRCLE'] } : {},
        offset: modelPages.at(-1)?.result.value.nextOffset ?? 0, layerOffset: 0, limit: options.queryLimit ?? 200, maxLayers: 100, maxBytes: 262144 })
      if (extents && input.responseGrammar.includes(',"paperSpaces":')) for (const spaceId of layouts.flatMap(row => row.result.value.layouts).filter(row => !row.model).map(row => row.spaceId)) {
        if (options.skipPaper) break
        const paperPages = pages.filter(row => row.args.filters.spaceId === spaceId)
        if (!paperPages.some(row => row.result.value.nextOffset === null)) return tool('cad_query_drawing', {
          expectedRevision: input.currentDocument.revision, filters: { spaceId }, offset: paperPages.at(-1)?.result.value.nextOffset ?? 0,
          layerOffset: 0, limit: 200, maxLayers: 100, maxBytes: 262144 })
      }
      const modelId = modelPages[0].result.value.spaceId, required = input.geometryReadContract.requiredToolName
      const helperPages = receipts.filter(row => row.name === required)
      if (options.skipGeometry) return response('Native drawing was read, but no geometry tool was called.')
      if (options.fakeGeometry) return response(JSON.stringify({ tool_calls: [{ function: { name: required, arguments: {} } }] }))
      if (!helperPages.some(row => row.result.value.nextOffset === null)) {
        if (options.partialGeometry && helperPages.length) return response('Only the first helper page was read.')
        const common = { documentId: input.currentDocument.documentId, expectedRevision: input.currentDocument.revision, ownerId: modelId,
          units: input.currentDocument.units, ownerPolicy: 'model-space-only', visibility: 'include-hidden', typeScope: 'finite-line-circle-only',
          unsupportedPolicy: 'reject', offset: helperPages.at(-1)?.result.value.nextOffset ?? 0, limit: options.geometryLimit ?? 200, maxEntities: 4096, maxBytes: 262144 }
        if (!extents) Object.assign(common, { anchorId: input.bindings.aliases['TEXT-A'].nativeId,
          radius: input.bindings.suppliedInputs.neighborhoodQueryContract.radius,
          metric: 'text-insertion-to-finite-native-xy-curve', boundary: 'inclusive' })
        if (options.staleGeometry && !injected) { injected = true; common.expectedRevision++ }
        if (options.wrongDocument) common.documentId = 'foreign-document'
        if (options.wrongUnits) common.units = 'meter'
        if (options.wrongOwner) common.ownerId = layouts.flatMap(row => row.result.value.layouts).find(row => !row.model).spaceId
        if (options.allOwnerUnsupported) common.typeScope = 'all-owner-entities'
        if (options.entityBudget) common.maxEntities = 1
        if (options.wrongRadius && !extents) common.radius++
        if (options.wrongAnchor && !extents) common.anchorId = input.bindings.aliases['TEXT-B'].nativeId
        if (options.visibleOnly) common.visibility = 'visible-only'
        if (options.skipGeometryFirstPage) common.offset = 1
        return tool(required, common)
      }
      return response('Actual native drawing and geometry-tool reads completed.')
    } }
}
function satisfied(report) {
  assert.equal(report.status, 'completed', JSON.stringify({ error: report.errorCode, gate: report.readGateAssertions?.filter(row => !row.satisfied), coverage: report.geometryCoverage }))
  assert.equal(report.verdict.status, 'satisfied'); assert.equal(report.geometryCoverage.status, 'satisfied')
  assert.equal(report.scenarioPassed, null); assert.equal(report.modelCalls, 0); assert.equal(report.fixtureOnly, true)
  assert.equal(report.scenarioExecuted, false); assert.equal(report.verifiedWorkflowExecutions, 0); assert.equal(report.networkRequestsVerified, null)
  assert.equal(report.finalRequests, 1); assert.ok(report.requests <= 16 && report.toolCalls <= 32)
  assert.equal(report.requests, report.requestRecords.length); assert.equal(report.requests, report.responseUsage.length)
  assert.equal(report.stateUnchanged, true); assert.equal(report.proposals, 0); assert.equal(report.approvals, 0)
  assert.deepEqual(report.answer, JSON.parse(report.rawFinalAnswer)); assert.ok(report.calls.every(call => call.result.ok === true))
}

test('new forward-only actual geometry protocol reserves final JSON without increasing original budgets', () => {
  assert.deepEqual(PROTOCOL.defaultBudgets, { maxRequests: 16, maxToolCalls: 32, maxBytes: 1048576, timeoutMs: 120000 })
  assert.equal(PROTOCOL.readPhaseMaximumRequests, 15); assert.equal(PROTOCOL.reservedFinalRequests, 1)
  assert.equal(PROTOCOL.toolNames.filter(name => name.startsWith('cad_query_curve_')).length, 2)
  assert.match(PROTOCOL.geometryScope, /not-all-drawing-xyz/); assert.match(PROTOCOL.oldEvidencePolicy, /no-old-report-rescoring/)
})
for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS) test('actual SDK geometry tool plus native query then model-only final; fixture not model pass: ' + id, async () => {
  const current = scenarios.get(id), neighborhood = round9NativeQueryDescriptor(current).intent.endsWith('label-neighborhood')
  const report = await runRound9NativeGeometryToolsWorkflow(current, { ...(neighborhood ? { neighborhoodPolicy: policy } : {}), modelAdapter: fixtureAdapter() })
  satisfied(report); assert.equal(report.originalQuestionHash, hash(current.prompt))
  assert.equal(report.readPhaseOriginalVerdict.status, 'failed'); assert.equal(report.firstPhaseEvidence.error.code, 'ROUND9_GEOMETRY_READ_ACK_NOT_FINAL_JSON')
  assert.equal(report.readPhaseRawText, 'Actual native drawing and geometry-tool reads completed.')
  assert.ok(report.requestRecords.filter(row => row.phase === 'native-reads').every(row => !Object.hasOwn(row.settings, 'response_format')))
  assert.deepEqual(report.requestRecords.at(-1).settings.response_format, { type: 'json_object' }); assert.deepEqual(report.requestRecords.at(-1).settings.tools, [])
  const helper = report.calls.find(row => row.name === (neighborhood ? 'cad_query_curve_neighborhood' : 'cad_query_curve_bounds'))
  assert.ok(helper); assert.equal(helper.result.value.scopeComplete, true); assert.equal(helper.args.typeScope, 'finite-line-circle-only')
  assert.ok(helper.result.value.excludedCounts.otherTypes > 0, 'Other types remain real native query work, not silently covered by curves')
  assert.equal(report.requestBytesTotal, report.requestRecords.reduce((sum, row) => sum + row.requestBytes, 0))
  assert.equal(report.responseBytesTotal, report.requestRecords.reduce((sum, row) => sum + row.responseBytes, 0))
})
for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS.filter(id => id.includes('label-neighborhood'))) test('original ambiguous neighborhood remains not ready without explicit caller radius: ' + id, async () => {
  let calls = 0
  const report = await runRound9NativeGeometryToolsWorkflow(scenarios.get(id), { modelAdapter: { origin: 'fixture-oracle-selftest', call() { calls++ } } })
  assert.equal(report.status, 'not-ready'); assert.equal(report.requests, 0); assert.equal(calls, 0)
})
for (const options of [{ skipGeometry: true }, { fakeGeometry: true }, { fakeAllReads: true }, { propose: true },
  { wrongDocument: true }, { wrongUnits: true }, { allOwnerUnsupported: true }, { entityBudget: true }, { duplicateIds: true },
  { visibleOnly: true }, { skipGeometryFirstPage: true }, { partialGeometry: true, geometryLimit: 1 }])
  test('missing/failed/unsupported/mis-scoped geometry evidence never enters final: ' + JSON.stringify(options), async () => {
    const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { modelAdapter: fixtureAdapter(options) })
    assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0); assert.equal(report.stateUnchanged, true)
    assert.equal(report.proposals, 0); assert.equal(report.approvals, 0)
    assert.equal(report.requestRecords.some(row => row.phase === 'final-only-json'), false)
  })
test('actual paper helper owner fails, never silently projects into model', async () => {
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { modelAdapter: fixtureAdapter({ wrongOwner: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
  const call = report.calls.find(row => row.name === 'cad_query_curve_bounds')
  assert.equal(call.result.ok, false); assert.equal(call.result.error.code, 'KJNATIVE_GEOMETRY_OWNER_UNSUPPORTED')
})
test('a repaired earlier failed actual geometry read remains failed evidence', async () => {
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { modelAdapter: fixtureAdapter({ staleGeometry: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
  const calls = report.calls.filter(row => row.name === 'cad_query_curve_bounds')
  assert.ok(calls.some(row => row.result.ok === false)); assert.ok(calls.some(row => row.result.ok === true))
  assert.equal(report.readGateAssertions.find(row => row.id === 'successful-current-native-read-tools-only').satisfied, false)
})
for (const options of [{ wrongRadius: true }, { wrongAnchor: true }, { skipAnchor: true }]) test('original neighborhood contract is not rewritten or filled: ' + JSON.stringify(options), async () => {
  const report = await runRound9NativeGeometryToolsWorkflow(scenario('label-neighborhood'), { neighborhoodPolicy: policy, modelAdapter: fixtureAdapter(options) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0); assert.equal(report.stateUnchanged, true)
})
test('all real native drawing, layouts and geometry pages remain required under fixed total budgets', async () => {
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { modelAdapter: fixtureAdapter({ queryLimit: 3, geometryLimit: 1, layoutLimit: 1 }) })
  satisfied(report)
  assert.ok(report.calls.filter(row => row.name === 'cad_query_curve_bounds').length > 1)
  assert.ok(report.calls.filter(row => row.name === 'cad_query_drawing').some(row => row.args.offset > 0))
  assert.ok(report.calls.filter(row => row.name === 'cad_read_layouts').some(row => row.args.offset > 0))
})
test('partial and conflicting receipt chains cannot be advertised as complete', async () => {
  const current = scenario(), fixture = await buildRound9NativeQueryFixture(current)
  try {
    const report = await runRound9NativeGeometryToolsWorkflow(current, { fixture, modelAdapter: fixtureAdapter({ geometryLimit: 1 }) })
    satisfied(report)
    const input = round9NativeGeometryToolInputs(current, fixture), calls = report.evidence.toolCalls
    for (const altered of [calls.filter(row => row.name !== 'cad_query_curve_bounds' || row.args.offset !== 0),
      calls.filter(row => row.name !== 'cad_query_curve_bounds' || row.result.value.nextOffset !== null),
      calls.map(row => row.name === 'cad_query_curve_bounds' && row.args.offset > 0 ? { ...row, result: { ...row.result, value: { ...row.result.value, totalResultCount: row.result.value.totalResultCount + 1 } } } : row),
      calls.map(row => row.name === 'cad_query_curve_bounds' && row.args.offset > 0 ? { ...row, result: { ...row.result, value: { ...row.result.value, bounds: { min: [0, 0], max: [1, 1] } } } } : row),
      calls.map(row => row.name === 'cad_query_curve_bounds' && row.args.offset === 0 ? { ...row, result: { ...row.result, value: { ...row.result.value,
        rows: [{ ...row.result.value.rows[0], handle: 'FOREIGN' }] } } } : row)])
      assert.equal(evaluateRound9NativeGeometryToolCoverage(current, input, altered).status, 'failed')
  } finally { fixture.dispose() }
})
test('same-page duplicate native identities or nonfinite distance never certify complete helper evidence', async () => {
  const current = scenario('label-neighborhood'), fixture = await buildRound9NativeQueryFixture(current, { neighborhoodPolicy: policy })
  try {
    const report = await runRound9NativeGeometryToolsWorkflow(current, { fixture, neighborhoodPolicy: policy, modelAdapter: fixtureAdapter() })
    satisfied(report)
    const input = round9NativeGeometryToolInputs(current, fixture, { neighborhoodPolicy: policy }), calls = report.evidence.toolCalls
    const changed = replacement => calls.map(call => call.name === 'cad_query_curve_neighborhood'
      ? { ...call, result: { ...call.result, value: replacement(clone(call.result.value)) } } : call)
    for (const altered of [changed(value => { value.rows[1] = clone(value.rows[0]); return value }),
      changed(value => { value.rows[0].distance = Number.NaN; return value }),
      changed(value => { value.rows[0].distance = policy.radius + 1; return value })])
      assert.equal(evaluateRound9NativeGeometryToolCoverage(current, input, altered).status, 'failed')
  } finally { fixture.dispose() }
})
test('public geometry contract supplies no coordinates/answer and cannot substitute curve-only bounds for full XYZ', async () => {
  const current = scenario(), fixture = await buildRound9NativeQueryFixture(current)
  try {
    const input = round9NativeGeometryToolInputs(current, fixture)
    assert.equal(input.originalRequest, current.prompt)
    assert.equal(input.geometryReadContract.requiredToolName, 'cad_query_curve_bounds')
    assert.match(input.geometryReadContract.scopeBoundary, /never substitute/)
    for (const forbidden of ['expectedAnswer', 'oracleBaselineDocument', 'bounds', 'distance', 'candidates'])
      assert.equal(Object.hasOwn(input.geometryReadContract, forbidden), false)
  } finally { fixture.dispose() }
})
test('English nonempty paper bounds still require original real paper queries', async () => {
  const report = await runRound9NativeGeometryToolsWorkflow(scenario('model-extents', 'en'), { modelAdapter: fixtureAdapter({ skipPaper: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
  assert.ok(report.readGateAssertions.some(row => row.id.startsWith('complete-paper-pagination:') && !row.satisfied))
})
for (const kind of ['model-extents', 'label-neighborhood']) test('actual geometry receipt does not authorize wrong final mathematics: ' + kind, async () => {
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(kind), { ...(kind === 'label-neighborhood' ? { neighborhoodPolicy: policy } : {}),
    modelAdapter: fixtureAdapter({ alterAnswer: answer => { if (answer.model) answer.model.min[0] = 0; else answer.candidates = [] } }) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 1); assert.equal(report.geometryCoverage.status, 'satisfied')
  assert.equal(report.verdict.assertions.find(row => row.id === 'exact-independent-native-answer').satisfied, false)
  assert.deepEqual(report.answer, JSON.parse(report.rawFinalAnswer))
})
for (const options of [{ finalText: answer => '```json\n' + JSON.stringify(answer) + '\n```' },
  { finalText: answer => 'Result: ' + JSON.stringify(answer) }, { finalText: () => '[]' },
  { alterAnswer: answer => { answer.extra = true } }, { finalTool: true },
  { alterAnswer: answer => { answer.documentId = 'foreign'; answer.model.spaceId = 'foreign' } }])
  test('raw final JSON provenance and original closed answer contract remain strict: ' + Object.keys(options).join(','), async () => {
    const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { modelAdapter: fixtureAdapter(options) })
    assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 1); assert.equal(report.stateUnchanged, true)
  })
test('raw provider response/usage is preserved; fixture statistics never become real provider claims', async () => {
  const usage = { inputTokens: 90, outputTokens: 30, totalTokens: 120 }
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { modelAdapter: fixtureAdapter({ usage }) })
  satisfied(report); assert.ok(report.responseUsage.every(row => JSON.stringify(row.usage) === JSON.stringify(usage)))
  assert.ok(report.requestRecords.every(row => JSON.stringify(row.response.usage) === JSON.stringify(usage)))
  assert.equal(report.finalNormalizedUsage.totalTokens, 120)
  const malformed = await runRound9NativeGeometryToolsWorkflow(scenario(), { modelAdapter: fixtureAdapter({ usage: { totalTokens: 'unverified' } }) })
  satisfied(malformed); assert.equal(malformed.finalNormalizedUsage.totalTokens, null)
  assert.ok(malformed.responseUsage.every(row => row.usage.totalTokens === 'unverified'))
})
for (const budget of [{ maxRequests: 2 }, { maxToolCalls: 1 }, { maxBytes: 1024 }]) test('fixed shared budget rejects incomplete work: ' + JSON.stringify(budget), async () => {
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { ...budget, modelAdapter: fixtureAdapter() })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
  assert.ok(report.requests <= (budget.maxRequests ?? 16)); assert.ok(report.toolCalls <= (budget.maxToolCalls ?? 32))
})
test('oversized final response is retained unmodified but never accepted', async () => {
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { modelAdapter: fixtureAdapter({ finalOversize: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'ROUND9_GEOMETRY_RESPONSE_BYTES_EXHAUSTED')
  assert.equal(report.requestRecords.at(-1).response.content.length, 1048577)
})
test('pre-cancellation causes no adapter invocation, no native query and no final request', async () => {
  const controller = new AbortController(); controller.abort()
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { signal: controller.signal, modelAdapter: fixtureAdapter() })
  assert.equal(report.status, 'cancelled'); assert.equal(report.requests, 0); assert.equal(report.adapterInvocations, 0)
})
test('overall timeout interrupts a noncooperative adapter without dispatching final', async () => {
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { timeoutMs: 30,
    modelAdapter: { origin: 'fixture-oracle-selftest', call: () => new Promise(() => {}) } })
  assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'ROUND9_GEOMETRY_TIMEOUT'); assert.equal(report.finalRequests, 0)
})
test('cancellation while native tool phase is active never enters final', async () => {
  const controller = new AbortController()
  const report = await runRound9NativeGeometryToolsWorkflow(scenario(), { signal: controller.signal,
    modelAdapter: fixtureAdapter({ onCall: ({ requestIndex }) => { if (requestIndex === 3) controller.abort() } }) })
  assert.equal(report.status, 'cancelled'); assert.equal(report.finalRequests, 0)
})
test('question, source DXF bytes, native state/history and frozen older protocols remain unchanged', async () => {
  const current = scenario(), fixture = await buildRound9NativeQueryFixture(current)
  try {
    const before = fixtureStateSignature(fixture.document), history = clone(fixture.document.history), artifact = hash(fixture.artifact.bytes)
    const report = await runRound9NativeGeometryToolsWorkflow(current, { fixture, modelAdapter: fixtureAdapter() })
    satisfied(report); assert.equal(fixtureStateSignature(fixture.document), before); assert.deepEqual(fixture.document.history, history)
    assert.equal(hash(fixture.artifact.bytes), artifact); assert.equal(fixture.sdk.agentPlans.list().length, 0)
    assert.equal(report.originalQuestionHash, hash(current.prompt))
  } finally { fixture.dispose() }
  assert.equal(hash(await readFile(FIXTURE_URL)), hash(corpusBytes))
  assert.deepEqual(await Promise.all(frozenPaths.map(async path => hash(await readFile(new URL(path, import.meta.url))))), frozenHashes)
})
for (const options of [{ answer: {} }, { response_format: { type: 'json_object' } }, { maxRequests: 17 }, { maxRequests: 1 },
  { maxToolCalls: 33 }, { maxBytes: 1048577 }, { timeoutMs: 120001 }]) test('unknown answer injection/format or expanded resource option rejected: ' + Object.keys(options).join(','), async () => {
  let calls = 0
  await assert.rejects(runRound9NativeGeometryToolsWorkflow(scenario(), { ...options,
    modelAdapter: { origin: 'fixture-oracle-selftest', call() { calls++ } } }), /UNKNOWN_ROUND9_GEOMETRY_DRIVER_OPTION|INVALID_ROUND9_GEOMETRY_DRIVER_BUDGET/)
  assert.equal(calls, 0)
})
test('hidden/symbol/accessor options cannot inject a host answer or invoke a getter', async () => {
  let calls = 0; const adapter = { origin: 'fixture-oracle-selftest', call() { calls++ } }
  for (const options of [Object.defineProperty({ modelAdapter: adapter }, 'answer', { enumerable: false, value: {} }),
    { modelAdapter: adapter, [Symbol('answer')]: {} }, Object.defineProperty({}, 'modelAdapter', { enumerable: true, get() { calls++; return adapter } })])
    await assert.rejects(runRound9NativeGeometryToolsWorkflow(scenario(), options), /UNKNOWN_ROUND9_GEOMETRY_DRIVER_OPTION/)
  assert.equal(calls, 0)
})
test('new driver imports neither expected answer nor a substitute geometry implementation', async () => {
  const source = await readFile(new URL('../scripts/testing/helpers/geology-round9-native-geometry-tools-driver.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['expectedRound9NativeQueryAnswer', 'queryNativeCurveBounds', 'queryNativeCurveNeighborhood', 'oracleBaselineDocument', 'document.listEntities'])
    assert.equal(source.includes(forbidden), false)
})
