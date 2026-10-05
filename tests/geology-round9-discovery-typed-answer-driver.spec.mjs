import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL as PROTOCOL, ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL_SHA256,
  runRound9DiscoveryTypedAnswerWorkflow, round9DiscoveryTypedAnswerInputs, round9DiscoveryTypedAnswerFunction,
} from '../scripts/testing/helpers/geology-round9-discovery-typed-answer-driver.mjs'
import { round9TwoPhaseFinalOutputContract } from '../scripts/testing/helpers/geology-round9-native-query-two-phase-driver.mjs'
import { ROUND9_NATIVE_QUERY_SCENARIO_IDS, ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT as policy,
  round9NativeQueryDescriptor, buildRound9NativeQueryFixture } from '../scripts/testing/helpers/geology-round9-native-query-oracles.mjs'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const clone = structuredClone, hash = value => createHash('sha256').update(value).digest('hex')
const corpusBytes = await readFile(FIXTURE_URL), corpus = JSON.parse(corpusBytes)
const scenarios = new Map(corpus.scenarios.map(row => [row.id, row]))
const scenario = (kind = 'model-extents', language = 'zh') => scenarios.get(`GUS1-cad-query.${kind}-${language}-direct`)
const frozenPaths = ['../scripts/testing/helpers/geology-round9-native-geometry-tools-driver.mjs',
  '../scripts/testing/helpers/geology-round9-native-query-two-phase-driver.mjs',
  '../scripts/testing/helpers/geology-round9-native-query-chat-driver.mjs',
  '../scripts/testing/helpers/geology-round9-native-query-oracles.mjs', '../packages/kjdraw-sdk/src/agent-tools.ts',
  '../packages/kjdraw-sdk/src/agent-tools.js', '../packages/kjdraw-sdk/types/agent-tools.d.ts']
const frozenHashes = await Promise.all(frozenPaths.map(async path => hash(await readFile(new URL(path, import.meta.url)))))
function frame(messages, start, end) {
  const text = messages.find(message => typeof message.content === 'string' && message.content.includes(start)).content
  return JSON.parse(text.split(start)[1].split(end)[0])
}
const union = boxes => ({ min: [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]))),
  max: [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]))) })
function nativeBox(entity, curves) {
  const geometry = entity.geometry, measured = curves.find(row => row.id === entity.id)
  const point = tuple => ({ min: [tuple[0], tuple[1], tuple[2] ?? 0], max: [tuple[0], tuple[1], tuple[2] ?? 0] })
  if (measured) {
    const z = entity.type === 'LINE' ? [Math.min(geometry.start[2], geometry.end[2]), Math.max(geometry.start[2], geometry.end[2])] : [geometry.center[2], geometry.center[2]]
    return { min: [...measured.bounds.min, z[0]], max: [...measured.bounds.max, z[1]] }
  }
  if (entity.type === 'LINE') return union([point(geometry.start), point(geometry.end)])
  if (entity.type === 'CIRCLE') return { min: [geometry.center[0] - geometry.radius, geometry.center[1] - geometry.radius, geometry.center[2]],
    max: [geometry.center[0] + geometry.radius, geometry.center[1] + geometry.radius, geometry.center[2]] }
  if (entity.type === 'LWPOLYLINE') return union(geometry.vertices.map(vertex => point(Array.isArray(vertex) ? vertex : vertex.point)))
  assert.ok(['TEXT', 'MTEXT'].includes(entity.type))
  // Scripted adapter-only arithmetic, no document, expected answer or geometry
  // oracle access. Actual enclosing native polyline covers this text reserve.
  const reserve = Math.max([...geometry.text].length * geometry.height * 4, geometry.width ?? 0, geometry.height * 4)
  return { min: [geometry.position[0] - reserve, geometry.position[1] - reserve, geometry.position[2]],
    max: [geometry.position[0] + reserve, geometry.position[1] + reserve, geometry.position[2]] }
}

/** Public scripted adapter only: reads its wire and actual returned receipts,
 * never the fixture document, SDK or detached expected answer. */
function fixtureAdapter(options = {}) {
  const issued = new Map(), observations = []; let input, serial = 0, injected = false
  const response = (content, toolCalls = []) => ({ content, toolCalls, model: 'public-scripted-returned-model-not-provider',
    ...(options.usage ? { usage: clone(options.usage) } : {}) })
  const adapter = { origin: 'fixture-oracle-selftest', model: 'public-scripted-requested-model-not-provider', observations,
    async call({ messages, settings, phase, signal, requestIndex }) {
      observations.push({ messages: clone(messages), settings: clone(settings), phase, requestIndex })
      assert.equal(Object.hasOwn(settings, 'stream'), false)
      assert.equal(Object.hasOwn(settings, 'response_format'), false)
      if (options.onCall) await options.onCall({ phase, signal, requestIndex, adapter })
      if (options.transportFail) { const error = new Error('secret-looking transport message must not enter diagnostics'); error.code = 'PUBLIC_FIXTURE_TRANSPORT_FAILED'; throw error }
      if (phase === 'final-only-typed-answer') {
        assert.deepEqual(settings.tool_choice, PROTOCOL.finalRequestToolChoice)
        assert.equal(settings.tools.length, 1); assert.equal(settings.tools[0].function.name, PROTOCOL.answerFunction)
        assert.equal(Object.hasOwn(settings.tools[0].function, 'strict'), false)
        const final = frame(messages, PROTOCOL.finalInputStart, PROTOCOL.finalInputEnd)
        assert.deepEqual(settings.tools[0].function.parameters, final.responseSchema)
        const receipts = final.actualSuccessfulNativeReadReceipts, geometry = receipts.filter(row => row.name === 'cad_query_drawing')
        const modelId = receipts.filter(row => row.name === 'cad_read_layouts').flatMap(row => row.result.value.layouts).find(row => row.model).spaceId
        const rows = geometry.filter(row => (row.args.filters.spaceId ?? modelId) === modelId).flatMap(row => row.result.value.entities)
        const paperIds = receipts.filter(row => row.name === 'cad_read_layouts').flatMap(row => row.result.value.layouts).filter(row => !row.model).map(row => row.spaceId)
        const helperPages = receipts.filter(row => row.name === final.geometryReadContract.requiredToolName)
        const helperRows = helperPages.flatMap(row => row.result.value.rows)
        const identity = { documentId: final.currentDocument.documentId, revision: final.currentDocument.revision, units: final.currentDocument.units }
        let answer
        if (Object.hasOwn(final.responseSchema.properties, 'model')) {
          answer = { ...identity, model: { spaceId: modelId, ...union(rows.map(row => nativeBox(row, helperRows))) }, excludedPaperSpaceIds: paperIds }
          if (Object.hasOwn(final.responseSchema.properties, 'paperSpaces')) answer.paperSpaces = paperIds.flatMap(spaceId => {
            const paperRows = geometry.filter(row => row.args.filters.spaceId === spaceId).flatMap(row => row.result.value.entities)
            return paperRows.length ? [{ spaceId, ...union(paperRows.map(row => nativeBox(row, []))) }] : []
          })
        } else answer = { ...identity, referenceId: helperPages[0].result.value.anchor.id,
          candidates: helperRows.map(row => ({ id: row.id, type: row.type })), geologicalMeaningAssigned: false }
        if (options.alterAnswer) options.alterAnswer(answer)
        const args = options.finalArguments ? options.finalArguments(answer) : JSON.stringify(answer)
        const call = { id: options.finalId ?? 'final-data-answer', type: 'function', function: { name: options.wrongFinalName ?? PROTOCOL.answerFunction, arguments: args } }
        const result = response(Object.hasOwn(options, 'finalContent') ? options.finalContent : null,
          options.noFinalCall ? [] : options.extraFinalCall ? [call, clone({ ...call, id: 'second-answer' })] : [call])
        if (options.missingFinalContent) delete result.content
        if (options.finishReason) result.finishReason = options.finishReason
        if (options.finalOversize) result.toolCalls[0].function.arguments = 'x'.repeat(1048577)
        return result
      }
      assert.equal(phase, 'native-reads')
      assert.deepEqual(settings.tools.map(row => row.function.name).sort(), [...PROTOCOL.toolNames].sort())
      input ??= frame(messages, PROTOCOL.inputStart, PROTOCOL.inputEnd)
      const tool = (name, args) => {
        const id = options.duplicateIds ? 'same-call-id' : `typed-fixture-call-${++serial}`
        issued.set(id, { name, args: clone(args) })
        return response('', [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }])
      }
      if (requestIndex === 1) {
        assert.deepEqual(settings.tool_choice, PROTOCOL.firstRequestToolChoice)
        if (options.noFirstCall) return response('Layouts are known without reading.')
        if (options.wrongFirstName) return tool('cad_read_drawing', {})
        return tool('cad_read_layouts', { expectedRevision: input.currentDocument.revision + (options.staleFirstLayout ? 1 : 0),
          offset: options.skipFirstLayoutPage ? 1 : 0, limit: options.layoutLimit ?? 100, maxBytes: 262144 })
      }
      assert.notDeepEqual(settings.tool_choice, PROTOCOL.firstRequestToolChoice, 'Named discovery is not imposed on later native turns')
      const receipts = messages.filter(message => message.role === 'tool').map(message => {
        assert.ok(issued.has(message.tool_call_id)); return { ...issued.get(message.tool_call_id), result: JSON.parse(message.content) }
      }).filter(row => row.result.ok === true)
      const layouts = receipts.filter(row => row.name === 'cad_read_layouts')
      if (!layouts.some(row => row.result.value.nextOffset === null) && !(options.partialLayouts && layouts.length))
        return tool('cad_read_layouts', { expectedRevision: input.currentDocument.revision, offset: layouts.at(-1)?.result.value.nextOffset ?? 0,
          limit: options.layoutLimit ?? 100, maxBytes: 262144 })
      const modelId = layouts.flatMap(row => row.result.value.layouts).find(row => row.model).spaceId
      const pages = receipts.filter(row => row.name === 'cad_query_drawing'), modelPages = pages.filter(row => !Object.hasOwn(row.args.filters, 'spaceId'))
      if (!modelPages.some(row => row.result.value.nextOffset === null)) return tool('cad_query_drawing', { expectedRevision: input.currentDocument.revision,
        filters: options.skipAnchor ? { types: ['LINE', 'CIRCLE'] } : {}, offset: modelPages.at(-1)?.result.value.nextOffset ?? 0,
        layerOffset: 0, limit: options.queryLimit ?? 200, maxLayers: 100, maxBytes: 262144 })
      const extents = input.geometryReadContract.requiredToolName === 'cad_query_curve_bounds'
      if (extents && input.responseGrammar.includes(',"paperSpaces":')) for (const spaceId of layouts.flatMap(row => row.result.value.layouts).filter(row => !row.model).map(row => row.spaceId)) {
        if (options.skipPaper) break
        const paperPages = pages.filter(row => row.args.filters.spaceId === spaceId)
        if (!paperPages.some(row => row.result.value.nextOffset === null)) return tool('cad_query_drawing', { expectedRevision: input.currentDocument.revision,
          filters: { spaceId }, offset: paperPages.at(-1)?.result.value.nextOffset ?? 0, layerOffset: 0, limit: 200, maxLayers: 100, maxBytes: 262144 })
      }
      const required = input.geometryReadContract.requiredToolName, helperPages = receipts.filter(row => row.name === required)
      if (options.skipGeometry) return response('Only original drawing reads completed, not geometry.')
      if (!helperPages.some(row => row.result.value.nextOffset === null)) {
        if (options.partialGeometry && helperPages.length) return response('Only a partial geometry page was read.')
        const args = { documentId: input.currentDocument.documentId, expectedRevision: input.currentDocument.revision,
          ownerId: options.wrongOwner ? 'space-000-invented' : modelId, units: input.currentDocument.units, ownerPolicy: 'model-space-only',
          visibility: options.visibleOnly ? 'visible-only' : 'include-hidden', typeScope: 'finite-line-circle-only', unsupportedPolicy: 'reject',
          offset: options.skipGeometryFirstPage ? 1 : helperPages.at(-1)?.result.value.nextOffset ?? 0,
          limit: options.geometryLimit ?? 200, maxEntities: 4096, maxBytes: 262144 }
        if (!extents) Object.assign(args, { anchorId: input.bindings.aliases['TEXT-A'].nativeId,
          radius: input.bindings.suppliedInputs.neighborhoodQueryContract.radius + (options.wrongRadius ? 1 : 0),
          metric: 'text-insertion-to-finite-native-xy-curve', boundary: 'inclusive' })
        if (options.staleGeometry && !injected) { injected = true; args.expectedRevision++ }
        return tool(required, args)
      }
      if (options.neverAcknowledge) return tool('cad_read_layouts', { expectedRevision: input.currentDocument.revision, offset: 0, limit: 100, maxBytes: 262144 })
      return response('Actual native reads completed; final data submission follows.')
    } }
  return adapter
}
function satisfied(report) {
  assert.equal(report.status, 'completed', JSON.stringify({ error: report.errorCode, gates: report.readGateAssertions?.filter(row => !row.satisfied), geometry: report.geometryCoverage }))
  assert.equal(report.verdict.status, 'satisfied'); assert.equal(report.geometryCoverage.status, 'satisfied')
  assert.equal(report.discoverySucceeded, true); assert.equal(report.completeLayoutDiscovery, true)
  assert.equal(report.origin, 'fixture-oracle-selftest'); assert.equal(report.scenarioPassed, null); assert.equal(report.scenarioExecuted, false)
  assert.equal(report.modelCalls, 0); assert.equal(report.realProviderAdapterInvocations, 0); assert.equal(report.networkRequestsVerified, null)
  assert.equal(report.finalRequests, 1); assert.equal(report.finalAnswerCalls, 1); assert.equal(report.answerFunctionExecuted, false)
  assert.equal(report.toolCalls, report.nativeToolCalls + 1); assert.ok(report.requests <= 16 && report.toolCalls <= 32)
  assert.equal(report.proposals, 0); assert.equal(report.approvals, 0); assert.equal(report.stateUnchanged, true)
  assert.deepEqual(JSON.parse(report.rawFinalAnswer), report.answer)
  assert.ok(report.evidence.toolCalls.every(call => PROTOCOL.toolNames.includes(call.name) && call.result.ok === true))
  assert.equal(report.evidence.toolCalls.some(call => call.name === PROTOCOL.answerFunction), false)
}

test('new named discovery/typed-answer protocol explicitly preserves original resource bounds and separate phases', () => {
  assert.deepEqual(PROTOCOL.defaultBudgets, { maxRequests: 16, maxToolCalls: 32, maxBytes: 1048576, timeoutMs: 120000 })
  assert.equal(PROTOCOL.readPhaseMaximumRequests, 15); assert.equal(PROTOCOL.reservedFinalRequests, 1)
  assert.equal(PROTOCOL.reservedFinalAnswerCalls, 1); assert.equal(PROTOCOL.providerRequestTimeoutMs, 60000)
  assert.equal(ROUND9_DISCOVERY_TYPED_ANSWER_PROTOCOL_SHA256, hash(canonicalStringify(PROTOCOL)))
  assert.ok(Object.isFrozen(PROTOCOL.firstRequestToolChoice.function))
  assert.match(PROTOCOL.oldEvidencePolicy, /no-old-report-rescoring/)
})
for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS) test('original frozen native scenario with real SDK reads and typed data; no fixture model-pass: ' + id, async () => {
  const current = scenarios.get(id), near = round9NativeQueryDescriptor(current).intent.endsWith('label-neighborhood')
  const report = await runRound9DiscoveryTypedAnswerWorkflow(current, { ...(near ? { neighborhoodPolicy: policy } : {}), modelAdapter: fixtureAdapter() })
  satisfied(report); assert.equal(report.originalQuestionHash, hash(current.prompt))
  assert.equal(report.calls[0].name, 'cad_read_layouts'); assert.equal(report.calls[0].result.ok, true)
  assert.equal(report.readPhaseOriginalVerdict.status, 'failed', 'Read acknowledgement is not retroactively an old final answer')
  assert.deepEqual(report.requestRecords[0].settings.tool_choice, PROTOCOL.firstRequestToolChoice)
  assert.ok(report.requestRecords.slice(1, -1).every(row => !Object.hasOwn(row.settings, 'tool_choice')))
  assert.deepEqual(report.requestRecords.at(-1).settings.tool_choice, PROTOCOL.finalRequestToolChoice)
  assert.equal(report.requestRecords.at(-1).settings.tools.length, 1)
  assert.equal(report.rawFinalAnswer, report.requestRecords.at(-1).response.toolCalls[0].function.arguments)
  assert.equal(report.rawFinalContent, null)
  assert.deepEqual(round9DiscoveryTypedAnswerFunction(current).inputSchema, round9TwoPhaseFinalOutputContract(current))
  assert.equal(report.requestBytesTotal, report.requestRecords.reduce((sum, row) => sum + row.requestBytes, 0))
  assert.equal(report.responseBytesTotal, report.requestRecords.reduce((sum, row) => sum + row.responseBytes, 0))
})
for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS.filter(id => id.includes('label-neighborhood'))) test('unchanged original ambiguous radius remains not-ready: ' + id, async () => {
  let calls = 0
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenarios.get(id), { modelAdapter: { origin: 'fixture-oracle-selftest', call() { calls++ } } })
  assert.equal(report.status, 'not-ready'); assert.equal(report.requests, 0); assert.equal(calls, 0); assert.equal(report.scenarioPassed, null)
})
for (const options of [{ noFirstCall: true }, { wrongFirstName: true }, { staleFirstLayout: true }, { skipFirstLayoutPage: true },
  { partialLayouts: true, layoutLimit: 1 }, { skipGeometry: true }, { wrongOwner: true }, { visibleOnly: true },
  { skipGeometryFirstPage: true }, { partialGeometry: true, geometryLimit: 1 }, { duplicateIds: true }])
  test('real missing/stale/wrong discovery or geometry cannot enter final: ' + JSON.stringify(options), async () => {
    const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter(options) })
    assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0); assert.equal(report.stateUnchanged, true)
  })
test('near requires complete observed layout pagination too, even when first page already exposes model owner', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario('label-neighborhood'), { neighborhoodPolicy: policy,
    modelAdapter: fixtureAdapter({ partialLayouts: true, layoutLimit: 1 }) })
  assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'ROUND9_TYPED_ANSWER_LAYOUT_PAGINATION_INCOMPLETE')
  assert.equal(report.finalRequests, 0)
})
test('successful repaired geometry read does not erase an actual prior rejected read', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ staleGeometry: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
  const calls = report.calls.filter(call => call.name === 'cad_query_curve_bounds')
  assert.ok(calls.some(call => call.result.ok === false)); assert.ok(calls.some(call => call.result.ok === true))
  assert.equal(report.readGateAssertions.find(row => row.id === 'successful-current-native-read-tools-only').satisfied, false)
})
test('actual drawing and geometry and layout pages all remain complete under original total request/tool bounds', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ queryLimit: 3, geometryLimit: 1, layoutLimit: 1 }) })
  satisfied(report)
  for (const name of ['cad_query_drawing', 'cad_query_curve_bounds', 'cad_read_layouts'])
    assert.ok(report.calls.some(call => call.name === name && call.args.offset > 0))
})
test('English paper reads are required, not supplied by the final function schema', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario('model-extents', 'en'), { modelAdapter: fixtureAdapter({ skipPaper: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
})
for (const kind of ['model-extents', 'label-neighborhood']) test('typed function cannot make wrong native mathematics a pass: ' + kind, async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(kind), { ...(kind === 'label-neighborhood' ? { neighborhoodPolicy: policy } : {}),
    modelAdapter: fixtureAdapter({ alterAnswer: answer => { if (answer.model) answer.model.min[0] = 0; else answer.candidates = [] } }) })
  assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'ROUND9_FROZEN_NATIVE_ORACLE_FAILED')
  assert.equal(report.finalRequests, 1); assert.equal(report.verdict.assertions.find(row => row.id === 'exact-independent-native-answer').satisfied, false)
})
for (const options of [{ wrongFinalName: 'cad_propose_move' }, { noFinalCall: true }, { extraFinalCall: true },
  { finalContent: 'Result: answer' }, { finalContent: ' ' }, { missingFinalContent: true },
  { finalArguments: () => '{' }, { finalArguments: answer => '```json\n' + JSON.stringify(answer) + '\n```' },
  { finalArguments: () => 'null' }, { finalArguments: () => '[]' }, { finalArguments: () => '"text"' },
  { alterAnswer: answer => { answer.extra = [] } }, { alterAnswer: answer => { delete answer.units } },
  { alterAnswer: answer => { answer.model.spaceId = 'foreign-owner' } }, { alterAnswer: answer => { answer.paperSpaces = [] } }])
  test('sole raw final function must be exact, closed, complete and prose-free: ' + Object.keys(options).join(','), async () => {
    const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter(options) })
    assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 1)
    assert.equal(report.stateUnchanged, true); assert.equal(report.answerFunctionExecuted, false)
  })
test('English missing real paper and Chinese extra paper fields are not silently dropped or completed', async () => {
  const english = await runRound9DiscoveryTypedAnswerWorkflow(scenario('model-extents', 'en'), { modelAdapter: fixtureAdapter({ alterAnswer: answer => { answer.paperSpaces = [] } }) })
  assert.equal(english.errorCode, 'ROUND9_FROZEN_NATIVE_ORACLE_FAILED')
  const chinese = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ alterAnswer: answer => { answer.paperSpaces = [] } }) })
  assert.equal(chinese.errorCode, 'ROUND9_TYPED_ANSWER_FINAL_SCHEMA_INVALID')
})
test('raw final whitespace inside function JSON is retained byte-exact, not stripped or prettified', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ finalContent: '',
    finalArguments: answer => '\n  ' + JSON.stringify(answer, null, 2) + '\n' }) })
  satisfied(report); assert.ok(report.rawFinalAnswer.startsWith('\n  ')); assert.ok(report.rawFinalAnswer.endsWith('\n'))
})
test('origin/model/call snapshot cannot be widened or relabelled by external caller mutation', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ onCall: ({ requestIndex, adapter }) => {
    if (requestIndex === 1) { adapter.origin = 'real-model'; adapter.model = 'invented-model'; adapter.call = () => { throw Error('mutated callback must not run') } }
  } }) })
  satisfied(report)
  assert.equal(report.declaredModel, 'public-scripted-requested-model-not-provider')
  assert.ok(report.requestRecords.every(row => row.response.model === 'public-scripted-returned-model-not-provider'))
})
test('final raw call identity cannot reuse a native SDK call ID or omit its own identity', async () => {
  for (const [finalId, code] of [['typed-fixture-call-1', 'ROUND9_TYPED_ANSWER_FINAL_CALL_ID_REUSED'],
    ['', 'ROUND9_TYPED_ANSWER_FINAL_CALL_ID_INVALID']]) {
    const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ finalId }) })
    assert.equal(report.status, 'failed'); assert.equal(report.errorCode, code); assert.equal(report.finalAnswerCallId, finalId)
    assert.equal(report.rawFinalAnswer, report.requestRecords.at(-1).response.toolCalls[0].function.arguments)
    assert.equal(report.stateUnchanged, true); assert.equal(report.answerFunctionExecuted, false)
  }
})
test('a truncated final provider finish reason cannot be rescued by apparently complete typed arguments', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ finishReason: 'length' }) })
  assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'KJMODEL_INCOMPLETE')
  assert.equal(report.requestRecords.at(-1).response.finishReason, 'length')
  assert.equal(report.finalRequests, 1); assert.equal(report.answerFunctionExecuted, false)
})
test('actual raw model usage remains separate from unverifiable fixture/network counts', async () => {
  const usage = { inputTokens: 90, outputTokens: 30, totalTokens: 120 }
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ usage }) })
  satisfied(report); assert.equal(report.finalNormalizedUsage.totalTokens, 120)
  assert.ok(report.responseUsage.every(row => JSON.stringify(row.usage) === JSON.stringify(usage)))
  assert.equal(report.adapterInvocations, report.requests); assert.equal(report.scriptedResponseRequests, report.requests)
  const malformed = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ usage: { totalTokens: 'not-verified' } }) })
  satisfied(malformed); assert.equal(malformed.finalNormalizedUsage.totalTokens, null)
  assert.ok(malformed.responseUsage.every(row => row.usage.totalTokens === 'not-verified'))
})
for (const budget of [{ maxRequests: 2 }, { maxToolCalls: 2 }, { maxBytes: 1024 }]) test('shared fixed resource limits do not hide requests or dispatch final: ' + JSON.stringify(budget), async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { ...budget, modelAdapter: fixtureAdapter() })
  assert.equal(report.status, 'failed'); assert.equal(report.finalRequests, 0)
  assert.ok(report.requests <= (budget.maxRequests ?? 16)); assert.ok(report.toolCalls <= (budget.maxToolCalls ?? 32))
})
test('readphase cannot consume the reserved final request by never acknowledging', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ neverAcknowledge: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.requests, 15); assert.equal(report.finalRequests, 0)
})
test('oversized original final argument string is recorded but not accepted or truncated', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ finalOversize: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'ROUND9_TYPED_ANSWER_RESPONSE_BYTES_EXHAUSTED')
  assert.equal(report.requestRecords.at(-1).response.toolCalls[0].function.arguments.length, 1048577)
})
test('pre-cancel and noncooperative timeout do not create reads, final calls or success', async () => {
  const controller = new AbortController(); controller.abort()
  const cancelled = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { signal: controller.signal, modelAdapter: fixtureAdapter() })
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.requests, 0); assert.equal(cancelled.adapterInvocations, 0)
  const timedOut = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { timeoutMs: 20,
    modelAdapter: { origin: 'fixture-oracle-selftest', call: () => new Promise(() => {}) } })
  assert.equal(timedOut.status, 'failed'); assert.equal(timedOut.errorCode, 'ROUND9_TYPED_ANSWER_TIMEOUT'); assert.equal(timedOut.finalRequests, 0)
})
test('each adapter invocation receives a documented 60-second local deadline, with no provider-specific defaults', async t => {
  const durations = []
  t.mock.method(AbortSignal, 'timeout', duration => { durations.push(duration); return new AbortController().signal })
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter() })
  satisfied(report); assert.equal(durations.length, report.requests); assert.ok(durations.every(duration => duration === 60000))
  assert.ok(report.requestRecords.every(row => !Object.hasOwn(row.settings, 'thinking') && !Object.hasOwn(row.settings, 'enable_thinking')))
})
test('transport error diagnostics preserve public code only, not private messages or phantom completed reads', async () => {
  const report = await runRound9DiscoveryTypedAnswerWorkflow(scenario(), { modelAdapter: fixtureAdapter({ transportFail: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'PUBLIC_FIXTURE_TRANSPORT_FAILED')
  assert.equal(report.finalRequests, 0); assert.equal(report.calls.length, 0)
  assert.equal(JSON.stringify(report).includes('secret-looking'), false)
})
test('question, DXF bytes, complete state/history, plans and every frozen existing module remain unchanged', async () => {
  const current = scenario(), fixture = await buildRound9NativeQueryFixture(current)
  try {
    const before = fixtureStateSignature(fixture.document), history = clone(fixture.document.history), artifact = hash(fixture.artifact.bytes)
    const report = await runRound9DiscoveryTypedAnswerWorkflow(current, { fixture, modelAdapter: fixtureAdapter() })
    satisfied(report); assert.equal(fixtureStateSignature(fixture.document), before); assert.deepEqual(fixture.document.history, history)
    assert.equal(hash(fixture.artifact.bytes), artifact); assert.equal(fixture.sdk.agentPlans.list().length, 0)
    const input = round9DiscoveryTypedAnswerInputs(current, fixture)
    assert.equal(input.originalRequest, current.prompt); assert.equal(Object.hasOwn(input, 'answer'), false)
    assert.equal(Object.hasOwn(input, 'expectedAnswer'), false)
  } finally { fixture.dispose() }
  assert.equal(hash(await readFile(FIXTURE_URL)), hash(corpusBytes))
  assert.deepEqual(await Promise.all(frozenPaths.map(async path => hash(await readFile(new URL(path, import.meta.url))))), frozenHashes)
})
for (const options of [{ answer: {} }, { tool_choice: {} }, { response_format: { type: 'json_object' } }, { maxRequests: 17 },
  { maxRequests: 1 }, { maxToolCalls: 33 }, { maxToolCalls: 1 }, { maxBytes: 1048577 }, { timeoutMs: 120001 }])
  test('unknown answer injection or expanded budget cannot grant hidden authority: ' + Object.keys(options).join(','), async () => {
    let calls = 0
    await assert.rejects(runRound9DiscoveryTypedAnswerWorkflow(scenario(), { ...options,
      modelAdapter: { origin: 'fixture-oracle-selftest', call() { calls++ } } }), /UNKNOWN_ROUND9_TYPED_ANSWER_OPTION|INVALID_ROUND9_TYPED_ANSWER_BUDGET/)
    assert.equal(calls, 0)
  })
test('own-field options and immutable provenance refuse accessors/inherited fields without evaluating getters', async () => {
  let getters = 0
  for (const options of [Object.defineProperty({}, 'modelAdapter', { enumerable: true, get() { getters++; return {} } }),
    { modelAdapter: Object.defineProperty({ call() {} }, 'origin', { enumerable: true, get() { getters++; return 'real-model' } }) },
    { modelAdapter: Object.assign(Object.create({ origin: 'real-model' }), { call() {} }) },
    { modelAdapter: fixtureAdapter(), [Symbol('answer')]: {} }])
    await assert.rejects(runRound9DiscoveryTypedAnswerWorkflow(scenario(), options), /UNKNOWN_ROUND9_TYPED_ANSWER_OPTION|EXPLICIT_ROUND9_TYPED_ANSWER_ADAPTER_REQUIRED/)
  assert.equal(getters, 0)
})
test('production driver has no expected-answer read, substitute geometry or synthetic fixture-model promotion', async () => {
  const source = await readFile(new URL('../scripts/testing/helpers/geology-round9-discovery-typed-answer-driver.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['expectedRound9NativeQueryAnswer', 'oracleBaselineDocument', 'document.listEntities',
    'queryNativeCurveBounds', 'queryNativeCurveNeighborhood', 'fixtureAdapter']) assert.equal(source.includes(forbidden), false)
})
