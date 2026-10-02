import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FIXTURE_URL } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { ROUND9_NATIVE_QUERY_SCENARIO_IDS, ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT,
  buildRound9NativeQueryFixture } from '../scripts/testing/helpers/geology-round9-native-query-oracles.mjs'
import { ROUND9_NATIVE_QUERY_CHAT_PROTOCOL, round9NativeQueryChatInputs, frameRound9NativeQueryChatInputs,
  runRound9NativeQueryChatWorkflow } from '../scripts/testing/helpers/geology-round9-native-query-chat-driver.mjs'

const bytes = await readFile(FIXTURE_URL), corpus = JSON.parse(bytes), byId = new Map(corpus.scenarios.map(row => [row.id, row]))
const clone = structuredClone, policy = ROUND9_PUBLIC_NEIGHBORHOOD_CONTRACT
const scenario = (kind = 'model-extents', language = 'zh') => byId.get(`GUS1-cad-query.${kind}-${language}-direct`)
const hash = value => createHash('sha256').update(value).digest('hex')
const union = boxes => ({ min: [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]))),
  max: [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]))) })
function primitiveBox(entity) {
  const g = entity.geometry, point = p => ({ min: [p[0], p[1], p[2] ?? 0], max: [p[0], p[1], p[2] ?? 0] })
  if (entity.type === 'LINE') return union([point(g.start), point(g.end)])
  if (entity.type === 'CIRCLE') return { min: [g.center[0] - g.radius, g.center[1] - g.radius, g.center[2] ?? 0],
    max: [g.center[0] + g.radius, g.center[1] + g.radius, g.center[2] ?? 0] }
  if (entity.type === 'LWPOLYLINE') return union(g.vertices.map(vertex => point(Array.isArray(vertex) ? vertex : vertex.point)))
  // Fixture response model, not a product glyph-extents implementation. This
  // conservative response-derived enclosure sits inside the read outer frame.
  assert.ok(['TEXT', 'MTEXT'].includes(entity.type))
  const reserve = Math.max([...g.text].length * g.height * 4, g.width ?? 0, g.height * 4)
  return { min: [g.position[0] - reserve, g.position[1] - reserve, g.position[2] ?? 0],
    max: [g.position[0] + reserve, g.position[1] + reserve, g.position[2] ?? 0] }
}
function curveDistance(point, entity) {
  const g = entity.geometry
  if (entity.type === 'CIRCLE') return Math.abs(Math.hypot(point[0] - g.center[0], point[1] - g.center[1]) - g.radius)
  const dx = g.end[0] - g.start[0], dy = g.end[1] - g.start[1], squared = dx * dx + dy * dy
  const t = squared ? Math.max(0, Math.min(1, ((point[0] - g.start[0]) * dx + (point[1] - g.start[1]) * dy) / squared)) : 0
  return Math.hypot(point[0] - g.start[0] - t * dx, point[1] - g.start[1] - t * dy)
}

/** Explicitly scripted fixture response adapter. It has no SDK/document,
 * fixture objects or expected-answer imports: all geometry comes from actual
 * runner-returned tool messages, and all answer bytes come from this adapter. */
function scriptedAdapter(settings = {}) {
  let input, serial = 0, injected = false
  const issued = new Map()
  return { origin: 'fixture-oracle-selftest', model: 'scripted-native-query-fixture-not-a-provider',
    async call({ messages, settings: transportSettings }) {
      assert.equal(Object.hasOwn(transportSettings, 'stream'), false, 'Transport owns stream:false; no CAD arguments are rewritten')
      if (!input) {
        const frame = messages.find(message => typeof message.content === 'string' && message.content.includes(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.inputStart)).content
        input = JSON.parse(frame.split(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.inputStart)[1].split(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.inputEnd)[0])
      }
      const tool = (name, args) => {
        const id = `fixture-read-${++serial}`; issued.set(id, { name, args: clone(args) })
        return { content: '', toolCalls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
          ...(settings.usage ? { usage: clone(settings.usage) } : {}) }
      }
      if (settings.missingReads) return { content: 'I did not read the native drawing.', toolCalls: [] }
      if (settings.propose) return tool('cad_propose_move', { expectedRevision: input.currentDocument.revision,
        units: input.currentDocument.units, ids: [input.bindings.aliases['CIRCLE-A'].nativeId], dx: 1, dy: 0 })
      if (settings.staleFirst && !injected) {
        injected = true
        return tool('cad_query_drawing', { expectedRevision: input.currentDocument.revision + 1, filters: {},
          offset: 0, layerOffset: 0, limit: 3, maxLayers: 0, maxBytes: 65536 })
      }
      const successful = messages.filter(message => message.role === 'tool').map(message => {
        const call = issued.get(message.tool_call_id), result = JSON.parse(message.content)
        assert.ok(call, 'Only this model adapter\'s actual issued calls can be read as receipts')
        return { ...call, result }
      }).filter(call => call.result.ok === true)
      const extents = input.responseGrammar.includes('excludedPaperSpaceIds')
      const layouts = successful.filter(call => call.name === 'cad_read_layouts')
      if (extents && !layouts.some(call => call.result.value.nextOffset === null)) {
        const offset = layouts.at(-1)?.result.value.nextOffset ?? 0
        return tool('cad_read_layouts', { expectedRevision: input.currentDocument.revision, offset, limit: 1, maxBytes: 65536 })
      }
      const geometryCalls = successful.filter(call => call.name === 'cad_query_drawing')
      const modelCalls = geometryCalls.filter(call => !Object.hasOwn(call.args.filters, 'spaceId'))
      if (!modelCalls.length || !settings.partialPagination && !modelCalls.some(call => call.result.value.nextOffset === null)) {
        return tool('cad_query_drawing', { expectedRevision: input.currentDocument.revision, filters: {},
          offset: modelCalls.at(-1)?.result.value.nextOffset ?? 0, layerOffset: 0, limit: 3, maxLayers: 0, maxBytes: 65536 })
      }
      const modelId = modelCalls[0].result.value.spaceId
      const modelRows = modelCalls.flatMap(call => call.result.value.entities)
      const paperIds = layouts.flatMap(call => call.result.value.layouts).filter(row => !row.model).map(row => row.spaceId)
      const needsPaper = extents && input.responseGrammar.includes(',"paperSpaces":')
      if (needsPaper && !settings.skipPaperRead) for (const spaceId of paperIds) {
        const pages = geometryCalls.filter(call => call.args.filters.spaceId === spaceId)
        if (!pages.some(call => call.result.value.nextOffset === null)) return tool('cad_query_drawing', {
          expectedRevision: input.currentDocument.revision, filters: { spaceId },
          offset: pages.at(-1)?.result.value.nextOffset ?? 0, layerOffset: 0, limit: 3, maxLayers: 0, maxBytes: 65536 })
      }
      const header = { documentId: input.currentDocument.documentId, revision: input.currentDocument.revision,
        units: input.currentDocument.units }
      let answer
      if (extents) {
        answer = { ...header, model: { spaceId: modelId, ...union(modelRows.map(primitiveBox)) }, excludedPaperSpaceIds: paperIds }
        if (needsPaper) answer.paperSpaces = paperIds.flatMap(spaceId => {
          const rows = geometryCalls.filter(call => call.args.filters.spaceId === spaceId).flatMap(call => call.result.value.entities)
          return rows.length ? [{ spaceId, ...union(rows.map(primitiveBox)) }] : []
        })
      } else {
        const referenceId = input.bindings.aliases['TEXT-A'].nativeId
        const reference = modelRows.find(row => row.id === referenceId)
        assert.ok(reference?.geometry, 'No fixture response computes an answer from unread anchor geometry')
        const declared = input.bindings.suppliedInputs.neighborhoodQueryContract
        answer = { ...header, referenceId, candidates: modelRows.filter(row => row.ownerId === modelId
          && ['LINE', 'CIRCLE'].includes(row.type) && curveDistance(reference.geometry.position, row) <= declared.radius)
          .map(row => ({ id: row.id, type: row.type })), geologicalMeaningAssigned: false }
      }
      if (settings.alterAnswer) settings.alterAnswer(answer, { input, modelRows, paperIds, geometryCalls })
      const raw = settings.rawFinal ? settings.rawFinal(answer) : JSON.stringify(answer)
      return { content: raw, toolCalls: [], ...(settings.usage ? { usage: clone(settings.usage) } : {}) }
    } }
}
const satisfied = report => {
  assert.equal(report.status, 'completed', JSON.stringify({ error: report.errorCode, assertions: report.verdict?.assertions?.filter(row => !row.satisfied) }))
  assert.equal(report.verdict.status, 'satisfied')
  assert.equal(report.scenarioPassed, null)
  assert.equal(report.scenarioExecuted, false)
  assert.equal(report.fixtureOnly, true)
  assert.equal(report.modelCalls, 0)
  assert.equal(report.networkRequestsVerified, null)
  assert.equal(report.verifiedWorkflowExecutions, 0)
  assert.equal(report.proposals, 0); assert.equal(report.approvals, 0)
  assert.deepEqual(JSON.parse(report.rawFinalAnswer), report.answer)
  assert.ok(report.calls.length > 1 && report.calls.every(call => call.result?.ok === true))
  assert.equal(report.stateUnchanged, true)
}

test('R9 driver declares a prospective bounded single-native-session read contract, no host answer or provider claim', () => {
  assert.deepEqual(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.defaultBudgets, { maxRequests: 16, maxToolCalls: 32, maxBytes: 1048576 })
  assert.equal(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.approvalPolicy, 'no-proposal-no-approval-no-commit')
  assert.ok(ROUND9_NATIVE_QUERY_CHAT_PROTOCOL.toolNames.every(name => !name.startsWith('cad_propose_')))
})
for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS) test(`actual read pagination and independent JSON scoring; scripted fixture only: ${id}`, async () => {
  const current = byId.get(id), opts = current.expected.intent.endsWith('label-neighborhood') ? { neighborhoodPolicy: policy } : {}
  const report = await runRound9NativeQueryChatWorkflow(current, { ...opts, modelAdapter: scriptedAdapter() })
  satisfied(report)
  assert.ok(report.requests <= 16 && report.toolCalls <= 32)
  assert.equal(report.requests, report.scriptedResponseRequests)
  assert.equal(report.requests, report.responseUsage.length)
  assert.ok(report.responseUsage.every(row => row.usage === null))
  assert.ok(report.calls.some(call => call.args?.offset > 0), 'Several actual geometry/layout pages were traversed')
  if (opts.neighborhoodPolicy) assert.equal(report.answer.candidates.length, 4)
  else assert.deepEqual(report.answer.model, { spaceId: report.answer.model.spaceId, min: [-1000, -800, 0], max: [1400, 1200, 0] })
})
for (const id of ROUND9_NATIVE_QUERY_SCENARIO_IDS.filter(id => id.includes('label-neighborhood'))) test(`no implicit radius, no native build or adapter invocation: ${id}`, async () => {
  let calls = 0
  const report = await runRound9NativeQueryChatWorkflow(byId.get(id), { modelAdapter: {
    origin: 'fixture-oracle-selftest', call() { calls++; throw Error('must not run') } } })
  assert.equal(report.status, 'not-ready'); assert.equal(calls, 0)
  assert.equal(report.requests, 0); assert.equal(report.toolCalls, 0); assert.equal(report.scenarioPassed, null)
  assert.equal(report.readiness.reason, 'missing-public-neighborhood-policy')
})
test('explicit alternate caller radius is used by actual response model; no illustrative 10 mm hardcode', async () => {
  const report = await runRound9NativeQueryChatWorkflow(scenario('label-neighborhood'), {
    neighborhoodPolicy: { ...policy, radius: 1 }, modelAdapter: scriptedAdapter() })
  satisfied(report); assert.deepEqual(report.answer.candidates, [])
})
test('public model frame supplies full identity inventory and caller policy, never entity geometry or oracle gold', async () => {
  const current = scenario('label-neighborhood'), fixture = await buildRound9NativeQueryFixture(current, { neighborhoodPolicy: policy })
  try {
    const input = round9NativeQueryChatInputs(current, fixture, { neighborhoodPolicy: policy })
    assert.equal(Object.keys(input.bindings.aliases).length, fixture.document.listEntities().length)
    assert.deepEqual(input.bindings.suppliedInputs.neighborhoodQueryContract, policy)
    assert.equal(input.readPolicy.noAutomaticHostReadOrAnswerCompletion, true)
    for (const field of ['oracleExpected', 'oracleBaseline', 'initialEntities', '"geometry":', '-1000', '1400'])
      assert.equal(frameRound9NativeQueryChatInputs(input).includes(field), false, field)
    assert.ok(input.responseGrammar.includes('response grammar only'))
  } finally { fixture.dispose() }
})
for (const kind of ['model-extents', 'label-neighborhood']) test(`${kind}: stale read later repaired still fails unchanged frozen every-read criterion`, async () => {
  const report = await runRound9NativeQueryChatWorkflow(scenario(kind), { neighborhoodPolicy: policy, modelAdapter: scriptedAdapter({ staleFirst: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.stateUnchanged, true)
  assert.ok(report.calls.some(call => call.result?.ok === false))
  assert.ok(report.calls.some(call => call.result?.ok === true))
  assert.equal(report.verdict.assertions.find(row => row.id === 'successful-current-native-read-tools-only').satisfied, false)
})
test('no actual read cannot be rescued by host-supplied input identities or final text; actual SDK read-required rejection', async () => {
  const report = await runRound9NativeQueryChatWorkflow(scenario(), { modelAdapter: scriptedAdapter({ missingReads: true }) })
  assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'KJAGENT_READ_REQUIRED')
  assert.equal(report.toolCalls, 0); assert.equal(report.calls.length, 0)
  assert.equal(report.verdict.assertions.find(row => row.id === 'successful-current-native-read-tools-only').satisfied, false)
})
test('read-only scope rejects actual model proposal with no pending plan, approval or modification', async () => {
  const current = scenario(), fixture = await buildRound9NativeQueryFixture(current)
  try {
    const report = await runRound9NativeQueryChatWorkflow(current, { fixture, modelAdapter: scriptedAdapter({ propose: true }) })
    assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'KJAGENT_TOOL_NOT_ALLOWED')
    assert.equal(fixture.sdk.agentPlans.list().length, 0)
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
  } finally { fixture.dispose() }
})
for (const kind of ['model-extents', 'label-neighborhood']) test(`${kind}: only first geometry page is not a completed native query`, async () => {
  const report = await runRound9NativeQueryChatWorkflow(scenario(kind), { neighborhoodPolicy: policy,
    modelAdapter: scriptedAdapter({ partialPagination: true }) })
  assert.equal(report.status, 'failed')
  assert.equal(report.verdict.assertions.find(row => row.id === (kind === 'model-extents' ? 'complete-model-pagination' : 'complete-neighborhood-query-pagination')).satisfied, false)
})
test('English nonempty paper extents must have real paper reads; unused paper owner cannot be reported as invented zero bounds', async () => {
  const current = scenario('model-extents', 'en')
  const noPaper = await runRound9NativeQueryChatWorkflow(current, { modelAdapter: scriptedAdapter({ skipPaperRead: true }) })
  assert.equal(noPaper.status, 'failed')
  assert.ok(noPaper.verdict.assertions.some(row => row.id.startsWith('complete-paper-pagination:') && !row.satisfied))
  const unused = await runRound9NativeQueryChatWorkflow(current, { modelAdapter: scriptedAdapter({
    alterAnswer(answer, { paperIds }) {
      const empty = paperIds.find(id => !answer.paperSpaces.some(row => row.spaceId === id))
      assert.ok(empty, 'Actual imported fixture has an unused native paper owner')
      answer.paperSpaces.push({ spaceId: empty, min: [0, 0, 0], max: [0, 0, 0] })
    } }) })
  assert.equal(unused.status, 'failed')
  assert.equal(unused.verdict.assertions.find(row => row.id === 'exact-independent-native-answer').satisfied, false)
})
for (const [name, alterAnswer] of [
  ['foreign document', answer => { answer.documentId = 'foreign-document' }],
  ['stale final revision', answer => { answer.revision++ }],
  ['paper bounds mixed into model', (answer, { geometryCalls }) => {
    const paperRows = geometryCalls.filter(call => call.args.filters.spaceId).flatMap(call => call.result.value.entities)
    answer.model.max = union(paperRows.map(primitiveBox)).max
  }],
  ['missing paper exclusions', answer => { answer.excludedPaperSpaceIds = [] }],
]) test(`correct native reads cannot rescue ${name} in raw final model JSON`, async () => {
  const report = await runRound9NativeQueryChatWorkflow(scenario('model-extents', 'en'), { modelAdapter: scriptedAdapter({ alterAnswer }) })
  assert.equal(report.status, 'failed')
  assert.equal(report.verdict.assertions.find(row => row.id === 'exact-independent-native-answer').satisfied, false)
})
for (const rawFinal of [answer => '```json\n' + JSON.stringify(answer) + '\n```', answer => JSON.stringify(answer) + '\nDone.', () => 'not JSON'])
  test('raw final answer is never stripped, completed or replaced with a host answer', async () => {
    const report = await runRound9NativeQueryChatWorkflow(scenario(), { modelAdapter: scriptedAdapter({ rawFinal }) })
    assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'ROUND9_FINAL_ANSWER_NOT_JSON')
    assert.equal(report.answer, undefined); assert.ok(report.rawFinalAnswer)
  })
test('foreign fixture / mismatched explicit radius and host-provided answer options are rejected before any model call', async () => {
  const current = scenario('label-neighborhood'), fixture = await buildRound9NativeQueryFixture(current, { neighborhoodPolicy: policy })
  try {
    const report = await runRound9NativeQueryChatWorkflow(current, { fixture, neighborhoodPolicy: { ...policy, radius: 1 }, modelAdapter: scriptedAdapter() })
    assert.equal(report.status, 'failed'); assert.equal(report.errorCode, 'ROUND9_FIXTURE_IDENTITY_OR_CALLER_POLICY_MISMATCH')
    assert.equal(report.requests, 0)
    await assert.rejects(runRound9NativeQueryChatWorkflow(current, { fixture, neighborhoodPolicy: policy, answer: {}, modelAdapter: scriptedAdapter() }), /UNKNOWN_ROUND9_DRIVER_OPTION/)
  } finally { fixture.dispose() }
})
test('native read-only state and original DXF bytes remain exact, not merely same entity count', async () => {
  const current = scenario(), fixture = await buildRound9NativeQueryFixture(current)
  try {
    const history = clone(fixture.document.history), source = hash(fixture.artifact.bytes)
    const report = await runRound9NativeQueryChatWorkflow(current, { fixture, modelAdapter: scriptedAdapter() })
    satisfied(report)
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
    assert.deepEqual(fixture.document.history, history); assert.equal(hash(fixture.artifact.bytes), source)
  } finally { fixture.dispose() }
})
test('raw usage is preserved only as supplied; absent or invalid usage never fabricates token or network proof', async () => {
  const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 7, reasoningOutputTokens: 3 }
  const valid = await runRound9NativeQueryChatWorkflow(scenario(), { modelAdapter: scriptedAdapter({ usage }) })
  satisfied(valid); assert.ok(valid.responseUsage.every(row => JSON.stringify(row.usage) === JSON.stringify(usage)))
  assert.equal(valid.measurements.totals.totalTokens, valid.requests * usage.totalTokens)
  assert.equal(valid.measurements.complete, true)
  const invalid = await runRound9NativeQueryChatWorkflow(scenario(), { modelAdapter: scriptedAdapter({ usage: { inputTokens: -1, totalTokens: 'fake' } }) })
  satisfied(invalid)
  assert.ok(invalid.responseUsage.every(row => row.usage.inputTokens === -1))
  assert.equal(invalid.measurements.totals.totalTokens, null)
  assert.equal(invalid.measurements.complete, false)
  assert.equal(invalid.networkRequestsVerified, null)
})
for (const options of [{ maxRequests: 1 }, { maxToolCalls: 1 }, { maxBytes: 1024 }])
  test(`prospective resource budget is enforced without completing unread work: ${JSON.stringify(options)}`, async () => {
    const report = await runRound9NativeQueryChatWorkflow(scenario(), { ...options, modelAdapter: scriptedAdapter() })
    assert.equal(report.status, 'failed')
    assert.ok(report.requests <= (options.maxRequests ?? 16))
    assert.ok(report.toolCalls <= (options.maxToolCalls ?? 32))
    assert.equal(report.verifiedWorkflowExecutions, 0)
    if (options.maxBytes) { assert.equal(report.requests, 0); assert.equal(report.errorCode, 'KJMODEL_SIZE_LIMIT') }
  })
test('pre-cancelled signal causes no adapter call and no read', async () => {
  const controller = new AbortController(); controller.abort()
  const report = await runRound9NativeQueryChatWorkflow(scenario(), { signal: controller.signal, modelAdapter: scriptedAdapter() })
  assert.equal(report.status, 'cancelled'); assert.equal(report.requests, 0); assert.equal(report.toolCalls, 0)
})
test('original corpus and frozen oracle remain byte-stable', async () => {
  assert.equal(hash(await readFile(FIXTURE_URL)), hash(bytes))
  assert.equal(hash(await readFile(new URL('../scripts/testing/helpers/geology-round9-native-query-oracles.mjs', import.meta.url))),
    '426f730d1075ed96c27673bae6550fc3b59fc087580110d66ea7ba013480bc1a')
})
