import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { FIXTURE_URL, serializeGeologyUserScenarios } from '../scripts/testing/generate-geology-user-scenarios.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { fixtureStateSignature } from '../scripts/testing/helpers/geology-scenario-fixtures.mjs'
import { assessScenarioReadiness } from '../scripts/testing/preflight-geology-user-scenarios.mjs'
import { NATIVE_HATCH_ISLAND_DESCRIPTOR, NATIVE_HATCH_ISLAND_SCENARIO_IDS, nativeHatchIslandDescriptor,
  assessNativeHatchIslandReadiness, buildNativeHatchIslandFixture, nativeHatchIslandInputBindings,
  nativeHatchIslandGeometry, evaluateNativeHatchIslandOracle, verifyNativeHatchIslandDxf,
} from '../scripts/testing/helpers/geology-native-hatch-island-oracle.mjs'

const frozenBytes = await readFile(FIXTURE_URL), corpus = JSON.parse(frozenBytes)
const byId = new Map(corpus.scenarios.map(scenario => [scenario.id, scenario]))
const first = 'GUS1-cad-structure.hatch-with-island-zh-direct', clone = structuredClone
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const emptyAnnotated = { arrays: [], styles: [], texts: [], alignedDimensions: [], rotatedDimensions: [], radiusDimensions: [], diameterDimensions: [] }
const hatchInput = (fixture, patch = {}) => ({ expectedRevision: fixture.initialRevision, units: 'millimeter',
  lines: [], circles: [], arcs: [], polylines: [], hatches: [{ loops: [
    { vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] },
    { vertices: [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 5, y: 10 }] },
  ], patternName: 'ANSI31', patternScale: 1, patternAngleDegrees: 0, ...patch }] })
function traceFor(fixture) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = []
  return { session, calls, async call(name, args) {
    const result = await session.call(name, args)
    calls.push({ name, args: clone(args), result })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return result.value
  } }
}
async function proposalFor(fixture, { tool = 'cad_propose_drawing', patch = {}, alter = () => {} } = {}) {
  const trace = traceFor(fixture)
  await trace.call('cad_read_drawing', {})
  const input = hatchInput(fixture, patch)
  if (tool === 'cad_propose_drawing_annotated') Object.assign(input, clone(emptyAnnotated))
  if (tool === 'cad_propose_drawing_pattern') input.arrays = []
  alter(input)
  const proposal = await trace.call(tool, input)
  return { trace, proposal }
}
const evidenceFor = (fixture, trace, proposal, patch = {}) => ({ origin: 'fixture-oracle-selftest',
  afterDocument: fixture.document, toolCalls: trace.calls, proposal, stage: 'pending-preview', ...patch })
function satisfied(verdict) {
  assert.equal(verdict.status, 'satisfied', JSON.stringify(verdict.assertions.filter(row => !row.satisfied)))
  assert.equal(verdict.scenarioPassed, null)
  assert.equal(verdict.scenarioExecuted, false)
  assert.equal(verdict.modelCalls, 0)
  assert.equal(verdict.admissionScope, 'independent-family-only-not-unified-preflight')
}

test('only the six original frozen island requests are independently covered; unified readiness stays honest', async () => {
  assert.equal(NATIVE_HATCH_ISLAND_SCENARIO_IDS.length, 6)
  assert.equal(new Set(NATIVE_HATCH_ISLAND_SCENARIO_IDS).size, 6)
  for (const id of NATIVE_HATCH_ISLAND_SCENARIO_IDS) {
    const scenario = byId.get(id)
    assert.deepEqual(nativeHatchIslandDescriptor(id).checks, scenario.expected.checks)
    assert.equal(assessNativeHatchIslandReadiness(id).status, 'runnable')
    assert.equal(assessNativeHatchIslandReadiness(id).scenarioPassed, null)
    assert.equal(assessScenarioReadiness(scenario).status, 'not-ready')
  }
  const invented = clone(byId.get(first)); invented.prerequisites.push('source:unsupported-current-project-facts')
  assert.equal(assessNativeHatchIslandReadiness(invented).status, 'not-ready')
  assert.equal(assessNativeHatchIslandReadiness({ ...byId.get(first), sequence: { id: 'unbuilt' } }).status, 'not-ready')
  assert.equal(assessNativeHatchIslandReadiness(byId.get('GUS1-cad-annotation.add-measured-dimension-zh-direct')).status, 'not-ready')
  assert.equal(Buffer.from(serializeGeologyUserScenarios()).equals(frozenBytes), true)
  assert.equal(hash(await readFile(FIXTURE_URL)), hash(frozenBytes))
})

for (const tool of ['cad_propose_drawing', 'cad_propose_drawing_pattern'])
for (const id of NATIVE_HATCH_ISLAND_SCENARIO_IDS) test(`actual ${tool} imported public DXF island selftest; zero provider/model calls: ${id}`, async () => {
  const fixture = await buildNativeHatchIslandFixture(id)
  try {
    assert.equal(fixture.artifact.format, 'DXF')
    assert.equal(fixture.sourceRecipePresent, false)
    assert.equal(fixture.document.validate().valid, true)
    assert.equal(fixture.document.listEntities().length, 13)
    assert.equal(fixture.conversationSeed.length, ['followup', 'correction'].includes(byId.get(id).interaction) ? 1 : 0)
    const bindings = nativeHatchIslandInputBindings(fixture)
    assert.doesNotMatch(JSON.stringify(bindings), /"gold"|"preview"|"commandArgs"|"after"|"payload"|"drawingId"|"suppliedInputs"/)
    const { trace, proposal } = await proposalFor(fixture, { tool })
    assert.equal(trace.calls.at(-1).name, tool)
    assert.equal(trace.calls.at(-1).result.value, proposal)
    assert.equal(proposal.arguments.entities.length, 1)
    assert.equal(proposal.arguments.entities[0].type, 'HATCH')
    if (tool === 'cad_propose_drawing_pattern') assert.deepEqual(trace.calls.at(-1).args.arrays, [])
    const pending = evaluateNativeHatchIslandOracle(id, fixture, evidenceFor(fixture, trace, proposal))
    satisfied(pending)
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
    assert.deepEqual(nativeHatchIslandGeometry(proposal.preview.after[0].payload), { outerArea: 400, islandArea: 25, filledArea: 375, loopCount: 2 })
    for (const check of NATIVE_HATCH_ISLAND_DESCRIPTOR.checks) assert.equal(pending.assertions.find(row => row.id === check)?.satisfied, true)
    const approvalReceipt = await trace.session.approve(proposal.planId, 'public-island-fixture-reviewer')
    assert.equal(approvalReceipt.ok, true)
    satisfied(evaluateNativeHatchIslandOracle(id, fixture, evidenceFor(fixture, trace, proposal, {
      phase: 'committed', approvalReceipt, approvedPlanId: proposal.planId, pendingVerdict: pending,
    })))
    const roundtrip = await verifyNativeHatchIslandDxf(fixture)
    assert.equal(roundtrip.status, 'satisfied')
    assert.equal(roundtrip.filledArea, 375)
    assert.equal(roundtrip.entityCount, 14)
    const committed = fixture.document.fingerprint()
    await fixture.sdk.executeCommand('UNDO', {}, { document: fixture.document })
    assert.equal(fixture.document.listEntities().length, 13)
    assert.equal(fixture.document.fingerprint(), fixture.oracleBaselineDocument.fingerprint())
    await fixture.sdk.executeCommand('REDO', {}, { document: fixture.document })
    assert.equal(fixture.document.listEntities().length, 14)
    assert.equal(fixture.document.fingerprint(), committed)
  } finally { fixture.dispose() }
})

test('presentation parameters omitted by the user are not secretly fixed to the selftest defaults', async () => {
  for (const [tool, scale, angle] of [['cad_propose_drawing', 2.5, 30], ['cad_propose_drawing', 0.75, 120], ['cad_propose_drawing_pattern', 2.5, 30]]) {
    const fixture = await buildNativeHatchIslandFixture(first)
    try {
      const { trace, proposal } = await proposalFor(fixture, { tool, patch: { patternScale: scale, patternAngleDegrees: angle } })
      const pending = evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal))
      satisfied(pending)
      const approvalReceipt = await trace.session.approve(proposal.planId, 'public-island-reviewer')
      assert.equal(approvalReceipt.ok, true)
      satisfied(evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal, {
        phase: 'committed', approvalReceipt, approvedPlanId: proposal.planId, pendingVerdict: pending,
      })))
      assert.equal((await verifyNativeHatchIslandDxf(fixture)).status, 'satisfied')
    } finally { fixture.dispose() }
  }
})

test('boundary winding and starting vertex may differ without changing the exact specified native geometry', async () => {
  const fixture = await buildNativeHatchIslandFixture(first)
  try {
    const { trace, proposal } = await proposalFor(fixture, { alter: input => {
      for (const loop of input.hatches[0].loops) { loop.vertices.reverse(); loop.vertices.push(loop.vertices.shift()) }
    } })
    const pending = evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal))
    satisfied(pending)
    const receipt = await trace.session.approve(proposal.planId, 'public-island-reviewer')
    assert.equal(receipt.ok, true)
    assert.equal((await verifyNativeHatchIslandDxf(fixture)).status, 'satisfied')
  } finally { fixture.dispose() }
})

const geometryTampering = [
  ['solid hatch', p => { p.solid = true }],
  ['name-only different pattern', p => { p.patternName = 'ANSI37' }],
  ['absent island', p => { p.boundaryLoops.pop() }],
  ['outer and island swapped', p => { p.boundaryLoops.reverse() }],
  ['island marked external', p => { p.boundaryLoops[1].external = true }],
  ['open island', p => { p.boundaryLoops[1].closed = false }],
  ['wrong island coordinate', p => { p.boundaryLoops[1].vertices[0].point[0] += 0.5 }],
  ['bow-tie with same corner set', p => { [p.boundaryLoops[0].vertices[1], p.boundaryLoops[0].vertices[2]] = [p.boundaryLoops[0].vertices[2], p.boundaryLoops[0].vertices[1]] }],
  ['curved boundary', p => { p.boundaryLoops[0].vertices[0].bulge = 0.1 }],
  ['island ignored by hatch style', p => { p.hatchStyle = 2 }],
  ['infinite presentation scale', p => { p.patternScale = Infinity }],
  ['fabricated custom pattern under ANSI31 name', p => { p.patternLines = [{ angle: 0, base: [0, 0], offset: [0, 1], dashes: [] }] }],
]
for (const [name, alter] of geometryTampering) test(`independent oracle rejects ${name}`, async () => {
  const fixture = await buildNativeHatchIslandFixture(first)
  try {
    const { trace, proposal } = await proposalFor(fixture), forged = clone(proposal)
    alter(forged.preview.after[0].payload)
    const evidence = evidenceFor(fixture, trace, forged)
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, evidence).status, 'failed')
    // Even if an attacker edits its claimed receipt along with the preview,
    // independent geometry assertions cannot be replaced by those claims.
    evidence.toolCalls = clone(trace.calls)
    evidence.toolCalls.at(-1).result.value = forged
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, evidence).status, 'failed')
  } finally { fixture.dispose() }
})

test('a genuine successful proposal with an extra native entity cannot satisfy the one-hatch user scope', async () => {
  const fixture = await buildNativeHatchIslandFixture(first)
  try {
    const { trace, proposal } = await proposalFor(fixture, { alter: input => { input.lines = [{ start: { x: 100, y: 100 }, end: { x: 101, y: 100 } }] } })
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal)).status, 'failed')
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
  } finally { fixture.dispose() }
})

test('a genuine public pattern-tool array proposal cannot bypass the one-HATCH scope or mutate before approval', async () => {
  const fixture = await buildNativeHatchIslandFixture(first)
  try {
    const { trace, proposal } = await proposalFor(fixture, { tool: 'cad_propose_drawing_pattern', alter: input => {
      input.lines = [[100, 100, 101, 100]]
      input.arrays = [{ sources: ['lines:0'], rows: 1, columns: 2, dx: 10, dy: 0 }]
    } })
    assert.equal(trace.calls.at(-1).name, 'cad_propose_drawing_pattern')
    assert.equal(proposal.arguments.entities.length, 3)
    assert.deepEqual(proposal.preview.after.map(entity => entity.type).sort(), ['HATCH', 'LINE', 'LINE'])
    const verdict = evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal))
    assert.equal(verdict.assertions.find(row => row.id === 'actual-native-proposal-tool-evidence').satisfied, true)
    assert.equal(verdict.assertions.find(row => row.id === 'native-hatch-island-topology').satisfied, false)
    assert.equal(verdict.status, 'failed')
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
    assert.equal(fixture.document.history.undoCount, 0)
  } finally { fixture.dispose() }
})

test('otherwise valid forged command and preview cannot replace the arguments sealed by the actual SDK plan', async () => {
  const fixture = await buildNativeHatchIslandFixture(first)
  try {
    const { trace, proposal } = await proposalFor(fixture), forged = clone(proposal)
    forged.arguments.entities[0].payload.patternScale = 2
    forged.preview.after[0].payload.patternScale = 2
    const calls = clone(trace.calls); calls.at(-1).result.value = forged
    const verdict = evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, forged, { toolCalls: calls }))
    assert.equal(verdict.assertions.find(row => row.id === 'native-hatch-island-topology').satisfied, true)
    assert.equal(verdict.assertions.find(row => row.id === 'full-before-after-preview').satisfied, true)
    assert.equal(verdict.assertions.find(row => row.id === 'actual-native-proposal-tool-evidence').satisfied, false)
    assert.equal(verdict.status, 'failed')
  } finally { fixture.dispose() }
})

test('missing/foreign/stale/failed reads, wrong receipt, malformed evidence and runtime failure cannot become a pass', async () => {
  const fixture = await buildNativeHatchIslandFixture(first)
  try {
    const { trace, proposal } = await proposalFor(fixture)
    for (const patch of [
      { toolCalls: trace.calls.slice(1) }, { toolCalls: [] }, { toolCalls: [{ ...trace.calls[0], result: { ok: false } }, trace.calls[1]] },
      { proposal: { ...proposal, documentId: 'foreign' } }, { proposal: { ...proposal, expectedRevision: fixture.initialRevision + 1 } },
      { proposal: { ...proposal, planId: 'invented' } }, { proposal: null }, { proposal: { preview: null } },
      { executionStatus: 'failed' }, { executionStatus: 'limit-reached' }, { error: { code: 'FAILED' } },
    ]) assert.equal(evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal, patch)).status, 'failed')
    for (const [field, value] of [['documentId', 'foreign'], ['revision', fixture.initialRevision + 1], ['units', 'meter']]) {
      const calls = clone(trace.calls); calls[0].result.value[field] = value
      assert.equal(evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal, { toolCalls: calls })).status, 'failed')
    }
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, { origin: 'invented' }).status, 'not-evaluated')
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, null).scenarioPassed, null)
  } finally { fixture.dispose() }
})

test('pending artifact/state/history mutation and fabricated approval cannot satisfy the oracle', async () => {
  const fixture = await buildNativeHatchIslandFixture(first)
  try {
    const { trace, proposal } = await proposalFor(fixture)
    for (const patch of [{ approval: { ok: true } }, { hostApprovalApplied: true },
      { phase: 'committed', approvalReceipt: { ok: true, value: { status: 'committed', command: 'CREATEBATCH', beforeRevision: fixture.initialRevision, afterRevision: fixture.initialRevision + 1 } }, approvedPlanId: proposal.planId }])
      assert.equal(evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal, patch)).status, 'failed')
    const bytes = fixture.artifact.bytes
    fixture.artifact.bytes = Buffer.from('not the original public DXF')
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal)).status, 'failed')
    fixture.artifact.bytes = bytes
    await fixture.document.transact('Unrequested public-note change', tx => {
      const id = fixture.identityAliases['TEXT-A'].nativeId, entity = fixture.document.getObject(id)
      tx.updateObject(id, { payload: { ...entity.payload, text: 'unrequested' } })
    })
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal)).status, 'failed')
  } finally { fixture.dispose() }
})

test('committed unrelated entities/layers/source metadata and unreviewed content changes cannot satisfy preservation', async () => {
  const fixture = await buildNativeHatchIslandFixture(first)
  try {
    const { trace, proposal } = await proposalFor(fixture)
    const pendingVerdict = evaluateNativeHatchIslandOracle(first, fixture, evidenceFor(fixture, trace, proposal))
    const approvalReceipt = await trace.session.approve(proposal.planId, 'public-island-reviewer')
    assert.equal(approvalReceipt.ok, true)
    const evidence = evidenceFor(fixture, trace, proposal, { phase: 'committed', approvalReceipt, approvedPlanId: proposal.planId, pendingVerdict })
    satisfied(evaluateNativeHatchIslandOracle(first, fixture, evidence))
    const before = fixture.document.fork()
    const target = fixture.document.getObject(fixture.identityAliases['TEXT-A'].nativeId)
    await fixture.document.transact('Unauthorized edit after approved hatch', tx => tx.updateObject(target.id, { payload: { ...target.payload, text: 'changed' } }))
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, evidence).status, 'failed')
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, { ...evidence, afterDocument: before, approvedPlanId: 'foreign' }).status, 'failed')
    assert.equal(evaluateNativeHatchIslandOracle(first, fixture, { ...evidence, afterDocument: before, pendingVerdict: null }).status, 'failed')
  } finally { fixture.dispose() }
})

test('independent DXF verification rejects lost island closure, ignored island, wrong pattern spacing and altered untouched fields', async () => {
  const fixture = await buildNativeHatchIslandFixture(first)
  try {
    const { trace, proposal } = await proposalFor(fixture)
    assert.equal((await trace.session.approve(proposal.planId, 'public-island-reviewer')).ok, true)
    const bytes = await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' }), text = Buffer.from(bytes).toString('utf8').replace(/\r/g, '')
    const hatchStart = text.indexOf('\nHATCH\n'), start = text.slice(0, hatchStart), body = text.slice(hatchStart)
    assert.ok(hatchStart >= 0)
    for (const altered of [body.replace('\n73\n1\n', '\n73\n0\n'), body.replace('\n75\n0\n', '\n75\n2\n'),
      body.replace('\n45\n-2.245064030267288\n', '\n45\n0\n')]) {
      assert.notEqual(altered, body)
      await assert.rejects(verifyNativeHatchIslandDxf(fixture, { bytes: Buffer.from(start + altered) }))
    }
    const alteredNote = text.replace('\nTEST-A\n', '\nUNREQUESTED\n')
    assert.notEqual(alteredNote, text)
    await assert.rejects(verifyNativeHatchIslandDxf(fixture, { bytes: Buffer.from(alteredNote) }))
    const entitiesStart = start.indexOf('\nENTITIES\n')
    assert.ok(entitiesStart >= 0)
    const wrongOwner = start.slice(0, entitiesStart) + start.slice(entitiesStart).replace(/\n330\n[^\n]+\n/, '\n330\nFFFF\n') + body
    assert.notEqual(wrongOwner, text)
    await assert.rejects(verifyNativeHatchIslandDxf(fixture, { bytes: Buffer.from(wrongOwner) }))
    const wrongStyle = text.replace('\nTEST-A\n7\nSTANDARD\n', '\nTEST-A\n7\nWRONG\n')
    assert.notEqual(wrongStyle, text)
    await assert.rejects(verifyNativeHatchIslandDxf(fixture, { bytes: Buffer.from(wrongStyle) }))
  } finally { fixture.dispose() }
})

test('no frozen question bytes change and additive verification modules contain no model interception or provider call', async () => {
  assert.equal(hash(await readFile(FIXTURE_URL)), hash(frozenBytes))
  const helper = await readFile(new URL('../scripts/testing/helpers/geology-native-hatch-island-oracle.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(helper, /tool_choice|fetch\(|deepseek|api[_-]?key|prompt\.includes|prompt\.match|model\.call/i)
})
