import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { KJDRAW_ROAD_INPUT_ASSET_SCHEMA as schema } from '../src/input-assets.js'
import { buildAgentRoadDrawing } from '../src/agent-road-drawing.js'
import { agentPreviewMatchesDocument } from '../src/agent-preview.js'
import { createKJModelAdapter } from '../src/model-adapters.js'
import { runKJAgentTask } from '../src/agent-runner.js'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../examples/fixtures/road-design.mjs'

const tool = 'cad_propose_road_drawing_from_asset'
const source = (assetId = 'survey-c2') => ({ assetId, schema, data: createRoadDesignFixture() })
function fixture(options = {}, units = 'meter') {
  const sdk = createKJDrawSDK(options), document = sdk.createDocument({ units })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
const argumentsFor = (ref, expectedRevision = 0) => ({ expectedRevision, units: 'meter', assetId: ref.assetId, sha256: ref.sha256, ...structuredClone(roadDrawingFixtureOptions) })
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }

test('registered source produces the same complete 488-entity road without model arrays, then one approved undoable edit', async () => {
  const { sdk, document, session } = fixture(), original = source(), data = structuredClone(original.data), before = document.serialize()
  const ref = await session.registerInputAsset(original)
  assert.equal(document.serialize(), before); assert.equal(document.history.canUndo, false)
  assert.equal('data' in ref, false); assert.ok(Object.isFrozen(ref.counts))
  original.data.profile[0].elevation += 99
  const args = argumentsFor(ref), input = { expectedRevision: 0, ...data, ...structuredClone(roadDrawingFixtureOptions) }
  assert.ok(Buffer.byteLength(JSON.stringify(args)) < Buffer.byteLength(JSON.stringify(input)) / 3)
  const expected = buildAgentRoadDrawing(document, input)
  const proposal = value(await session.call(tool, args))
  assert.equal(proposal.sourceAsset, ref)
  assert.deepEqual(proposal.arguments, expected.commandArgs)
  assert.deepEqual(proposal.engineeringEvidence, expected.evidence)
  assert.equal(proposal.preview.after.length, 488); assert.equal(proposal.preview.resources.length, 8)
  assert.equal(document.serialize(), before)
  assert.throws(() => { proposal.sourceAsset.sha256 = '0'.repeat(64) }, TypeError)
  assert.throws(() => { proposal.engineeringEvidence.designParameters.input.sections[0].ground[0][1] = 1 }, TypeError)
  const other = sdk.createDocument({ units: 'meter' })
  const receipt = value(await session.approve(proposal.planId, 'asset-reviewer'))
  assert.equal(receipt.sourceAsset, ref); assert.equal(receipt.afterRevision - receipt.beforeRevision, 1)
  assert.equal(other.listEntities().length, 0); assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  const ids = document.listEntities({ ownerId: document.snapshot().spaces.modelSpaceId }).map(entity => entity.id)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    assert.equal(reopened.listEntities({ ownerId: reopened.snapshot().spaces.modelSpaceId }).length, 488)
    const originalTypes = document.listEntities({ ownerId: document.snapshot().spaces.modelSpaceId }).map(entity => entity.type).sort()
    assert.deepEqual(reopened.listEntities({ ownerId: reopened.snapshot().spaces.modelSpaceId }).map(entity => entity.type).sort(), originalTypes)
  }
  assert.equal((await session.approve(proposal.planId, 'asset-reviewer')).ok, false)
  await document.undo(); assert.equal(document.listEntities().length, 0)
  for (const item of proposal.preview.resources) assert.equal(document.getObject(item.id), null)
  await document.redo(); assert.deepEqual(document.listEntities({ ownerId: document.snapshot().spaces.modelSpaceId }).map(entity => entity.id), ids)
  assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
})

test('host registration is idempotent for equal content, rejects replacement and bounds session assets', async () => {
  const { sdk, document, session } = fixture(), ref = await session.registerInputAsset(source()), before = document.serialize()
  assert.equal(await session.registerInputAsset(source()), ref)
  const changed = source(); changed.data.pavement.leftWidth += .1
  await assert.rejects(session.registerInputAsset(changed), /cannot be replaced/)
  for (let i = 1; i < 16; i++) await session.registerInputAsset(source('survey-' + i))
  await assert.rejects(session.registerInputAsset(source('overflow')), /16 assets|4 MiB/)
  assert.equal(await session.registerInputAsset(source()), ref)
  assert.equal(document.serialize(), before)
  assert.equal((await session.call('registerInputAsset', source())).ok, false)
  assert.ok(!session.definitions.some(def => /register|approve|load|fetch/i.test(def.name)))
})

test('hashes and exact session registration are required; raw arrays or unknown schema fields cannot override source', async () => {
  const { sdk, document, session } = fixture(), ref = await session.registerInputAsset(source()), before = document.serialize()
  const cases = [
    { ...argumentsFor(ref), assetId: 'unknown' }, { ...argumentsFor(ref), sha256: '0'.repeat(64) },
    { ...argumentsFor(ref), sha256: ref.sha256.toUpperCase() }, { ...argumentsFor(ref), sha256: 'a'.repeat(63) },
    { ...argumentsFor(ref), units: 'millimeter' }, { ...argumentsFor(ref), expectedRevision: 1 },
  ]
  for (const key of ['alignment', 'profile', 'sections', 'pavement', 'slopes', 'data', 'schema', 'url', 'path']) cases.push({ ...argumentsFor(ref), [key]: [] })
  for (const key of Object.keys(argumentsFor(ref))) { const args = argumentsFor(ref); delete args[key]; cases.push(args) }
  for (const args of cases) { assert.equal((await session.call(tool, args)).ok, false, JSON.stringify(args)); assert.equal(document.serialize(), before) }
  const another = fixture()
  assert.equal((await new KJAgentToolSession(sdk, document).call(tool, argumentsFor(ref))).ok, false)
  assert.equal((await another.session.call(tool, argumentsFor(ref))).ok, false)
  assert.equal(document.serialize(), before)
})


test('registration rejects detached/replaced or wrong-unit documents, including detach while SHA-256 is pending', async () => {
  const wrong = fixture({}, 'millimeter')
  await assert.rejects(wrong.session.registerInputAsset(source()), /meter/)
  const detached = fixture(), first = detached.session.registerInputAsset(source())
  detached.sdk.documents.delete(detached.document.id)
  await assert.rejects(first, /detached|replaced/)
  const replaced = fixture(), pending = replaced.session.registerInputAsset(source())
  replaced.sdk.documents.set(replaced.document.id, replaced.document.fork())
  await assert.rejects(pending, /detached|replaced/)
  const completed = fixture(), ref = await completed.session.registerInputAsset(source())
  completed.sdk.documents.delete(completed.document.id)
  assert.equal((await completed.session.call(tool, argumentsFor(ref))).ok, false)
})

test('concurrent registration or tools are rejected and changed revisions during hashing cannot register stale context', async () => {
  const { document, session } = fixture(), first = session.registerInputAsset(source())
  await assert.rejects(session.registerInputAsset(source('parallel')), /busy/)
  assert.equal((await session.call('cad_read_drawing', {})).ok, false)
  await first
  const race = fixture()
  const failure = assert.rejects(race.session.registerInputAsset(source()), /revision/i)
  await race.document.transact('Concurrent host edit', tx => tx.createEntity('LINE', { start: [0, 0], end: [1, 0] }))
  await failure
  const recovered = await race.session.registerInputAsset(source())
  assert.equal(value(await race.session.call(tool, argumentsFor(recovered, race.document.revision))).expectedRevision, race.document.revision)
  assert.equal(document.revision, 0)
})

test('registered sources cannot bypass drawable entity budgets, layer protections or conflicting drawing identity', async () => {
  const huge = fixture(), registration = source()
  registration.data.sections = Array.from({ length: 32 }, (_, i) => ({ station: 600 * i / 31, ground: [[-25, 99], [25, 99]] }))
  const hugeRef = await huge.session.registerInputAsset(registration), untouched = huge.document.serialize()
  const over = await huge.session.call(tool, argumentsFor(hugeRef))
  assert.equal(over.ok, false); assert.match(over.error.message, /budget|limit|maxEntities/)
  assert.equal(huge.document.serialize(), untouched)
  const locked = fixture(), ref = await locked.session.registerInputAsset(source())
  await locked.document.transact('Protected target layer', tx => tx.upsertTableRecord('layers', { name: 'ACCESS-ROAD-STUDY_ROAD_DESIGN', payload: { locked: true } }))
  const before = locked.document.serialize()
  assert.equal((await locked.session.call(tool, argumentsFor(ref, locked.document.revision))).ok, false)
  assert.equal(locked.document.serialize(), before)
  const normal = fixture(), normalRef = await normal.session.registerInputAsset(source())
  const proposal = value(await normal.session.call(tool, argumentsFor(normalRef)))
  value(await normal.session.approve(proposal.planId, 'reviewer'))
  const approved = normal.document.serialize()
  assert.equal((await normal.session.call(tool, argumentsFor(normalRef, normal.document.revision))).ok, false)
  assert.equal(normal.document.serialize(), approved)
})

test('duplicate proposals, approvals and later retries never apply the source twice', async () => {
  const { document, session } = fixture(), ref = await session.registerInputAsset(source())
  const first = value(await session.call(tool, argumentsFor(ref))), second = value(await session.call(tool, argumentsFor(ref)))
  const approvals = await Promise.all([session.approve(first.planId, 'reviewer'), session.approve(first.planId, 'reviewer')])
  assert.equal(approvals.filter(result => result.ok).length, 1)
  assert.equal(document.revision, 1); assert.equal(document.listEntities().length, 488)
  const approved = document.serialize()
  assert.equal((await session.approve(second.planId, 'reviewer')).ok, false)
  assert.equal((await session.approve(first.planId, 'reviewer')).ok, false)
  assert.equal((await session.call(tool, argumentsFor(ref))).ok, false)
  assert.equal(document.serialize(), approved)
})

test('asset proposals retain host rejection, expiry, source revision and exact core command identity checks', async () => {
  let now = 100
  const expired = fixture({ agentPlanOptions: { clock: () => now, defaultTtlMs: 10 } }), ref = await expired.session.registerInputAsset(source())
  const plan = value(await expired.session.call(tool, argumentsFor(ref)))
  now += 11
  assert.equal((await expired.session.approve(plan.planId, 'reviewer')).ok, false); assert.equal(expired.document.revision, 0)
  const normal = fixture(), normalRef = await normal.session.registerInputAsset(source())
  const rejected = value(await normal.session.call(tool, argumentsFor(normalRef)))
  value(normal.session.reject(rejected.planId, 'reviewer'))
  assert.equal((await normal.session.approve(rejected.planId, 'reviewer')).ok, false)
  const revised = value(await normal.session.call(tool, argumentsFor(normalRef)))
  await normal.document.transact('Other edit', tx => tx.createEntity('CIRCLE', { center: [0, 0], radius: 1 }))
  assert.equal((await normal.session.approve(revised.planId, 'reviewer')).ok, false)
  const next = value(await normal.session.call(tool, argumentsFor(normalRef, normal.document.revision)))
  let called = 0
  normal.sdk.commands.register({ id: 'CREATEBATCH', execute() { called++ } }, { replace: true })
  assert.equal((await normal.session.approve(next.planId, 'reviewer')).ok, false); assert.equal(called, 0)
  assert.equal(normal.document.listEntities().length, 1)
})

test('the existing road tool retains its full-array schema and asset descriptors do not replace old arguments', async () => {
  const old = KJDRAW_AGENT_TOOLS.find(def => def.name === 'cad_propose_road_drawing').inputSchema
  for (const key of ['alignment', 'profile', 'sections', 'pavement', 'slopes']) assert.ok(old.required.includes(key))
  assert.equal('assetId' in old.properties, false)
  const definition = KJDRAW_AGENT_TOOLS.find(def => def.name === tool), { document, session } = fixture()
  assert.equal(definition.effect, 'propose')
  assert.deepEqual(definition.inputSchema.required, Object.keys(definition.inputSchema.properties))
  const ref = await session.registerInputAsset(source())
  assert.equal((await session.call('cad_propose_road_drawing', argumentsFor(ref))).ok, false)
  const plan = value(await session.call('cad_propose_road_drawing', { expectedRevision: 0, ...createRoadDesignFixture(), ...structuredClone(roadDrawingFixtureOptions) }))
  assert.equal(plan.preview.after.length, 488); assert.equal('sourceAsset' in plan, false); assert.equal(document.revision, 0)
})

const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
function wire(protocol, args) {
  const id = 'asset-call'
  if (protocol === 'responses') return { status: 'completed', output: [{ type: 'function_call', id, call_id: id, name: tool, arguments: JSON.stringify(args) }] }
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', id, function: { name: tool, arguments: JSON.stringify(args) } }] } }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: tool, input: args }] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { id, name: tool, args } }] } }] }
}
for (const protocol of protocols) test(protocol + ': reference-only model arguments produce exact host-reviewed geometry and reject wrong hashes', async () => {
  for (const valid of [true, false]) {
    const { document, session } = fixture(), ref = await session.registerInputAsset(source()), args = argumentsFor(ref), before = document.serialize()
    if (!valid) args.sha256 = '0'.repeat(64)
    let calls = 0
    const model = createKJModelAdapter({ protocol, model: 'offline-input-asset-protocol-fixture', request: async ({ body }) => {
      calls++
      const defs = protocol === 'gemini-generate-content' ? body.tools[0].functionDeclarations : body.tools
      assert.equal(defs.length, 1)
      const def = defs[0], schema = def.function?.parameters ?? def.parameters ?? def.input_schema ?? def.parametersJsonSchema
      assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.sha256.minLength, 64)
      for (const key of ['alignment', 'profile', 'sections', 'data']) assert.equal(key in schema.properties, false)
      assert.equal(JSON.stringify(body).includes('3300240'), false, 'raw source coordinate arrays stay local')
      return wire(protocol, args)
    } })
    const run = await runKJAgentTask({ session, model, prompt: 'Draw the road using host source descriptor: ' + JSON.stringify(ref), toolNames: [tool], maxTurns: 1 })
    assert.equal(calls, 1); assert.equal(document.serialize(), before)
    assert.equal(run.status, valid ? 'awaiting-approval' : 'limit-reached')
    assert.equal(run.outputs[0].result.ok, valid)
    if (valid) {
      const proposal = run.outputs[0].result.value
      assert.equal(proposal.preview.after.length, 488); assert.deepEqual(proposal.sourceAsset, ref)
      assert.equal(value(await session.approve(proposal.planId, 'protocol-reviewer')).sourceAsset.sha256, ref.sha256)
      assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
    }
  }
})


test('an independently supplied route uses its own source geometry and engineering parameters through the same asset tool', async () => {
  const { document, session } = fixture()
  const data = {
    units: 'meter', startStation: 200, alignment: [[10, 20], [70, 100]],
    profile: [{ station: 200, elevation: 2 }, { station: 300, elevation: 3 }],
    sections: [200, 225, 300].map(station => ({ station, ground: [[-30, 0], [0, .5], [30, 1]] })),
    pavement: { leftWidth: 2, rightWidth: 3, leftCrossfall: -.02, rightCrossfall: -.03 },
    slopes: { cutHtoV: 1, fillHtoV: 1.5 },
  }
  const ref = await session.registerInputAsset({ assetId: 'local-access', schema, data })
  const args = { ...argumentsFor(ref), drawingId: 'short-route', title: 'Different local access route', profileScale: { horizontal: 1, vertical: 4 }, sectionScale: { horizontal: 1, vertical: 1 } }
  const { assetId, sha256, ...options } = args
  const proposal = value(await session.call(tool, args))
  assert.deepEqual(proposal.arguments, buildAgentRoadDrawing(document, { ...data, ...options }).commandArgs)
  assert.equal(proposal.engineeringEvidence.calculation.length, 100)
  assert.equal(proposal.engineeringEvidence.calculation.sections.length, 3)
  assert.equal(proposal.engineeringEvidence.calculation.startStation, 200)
  assert.deepEqual(proposal.engineeringEvidence.designParameters.input.pavement, data.pavement)
  value(await session.approve(proposal.planId, 'reviewer'))
  assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
})

