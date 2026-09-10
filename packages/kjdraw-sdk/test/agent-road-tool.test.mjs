import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../src/agent-tools.js'
import { agentPreviewMatchesDocument } from '../src/agent-preview.js'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../examples/fixtures/road-design.mjs'

const tool = 'cad_propose_road_drawing'
function fixture(units = 'meter') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units })
  return { sdk, document, session: new KJAgentToolSession(sdk, document), input: { expectedRevision: 0, ...createRoadDesignFixture(), ...structuredClone(roadDrawingFixtureOptions) } }
}
function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }

test('road tool schema requires every supplied design and display field including nested objects', async () => {
  const definition = KJDRAW_AGENT_TOOLS.find(item => item.name === tool)
  assert.equal(definition.effect, 'propose')
  const visit = schema => {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual(schema.required, Object.keys(schema.properties))
      Object.values(schema.properties).forEach(visit)
    }
    if (schema.items) visit(schema.items)
  }
  visit(definition.inputSchema)
  const { document, session, input } = fixture(), before = document.serialize()
  for (const key of Object.keys(input)) {
    const incomplete = structuredClone(input); delete incomplete[key]
    assert.equal((await session.call(tool, incomplete)).ok, false, key)
    assert.equal(document.serialize(), before)
  }
})

test('road session returns frozen calculation evidence and exact 488-entity preview before one atomic approval and undo/redo', async () => {
  const { sdk, document, session, input } = fixture(), before = document.serialize(), originalInput = JSON.stringify(input)
  const proposal = value(await session.call(tool, input))
  assert.equal(proposal.command, 'CREATEBATCH'); assert.equal(proposal.status, 'awaiting-host-approval')
  assert.equal(proposal.documentId, document.id); assert.equal(proposal.expectedRevision, 0)
  assert.equal(proposal.preview.after.length, 488); assert.equal(proposal.preview.resources.length, 8)
  assert.deepEqual(proposal.preview.before, [])
  assert.equal(proposal.engineeringEvidence.calculation.sections.length, 13)
  assert.equal(proposal.engineeringEvidence.calculation.length, 600)
  assert.equal(proposal.engineeringEvidence.entityCount, 488)
  assert.equal(proposal.engineeringEvidence.units, 'meter')
  assert.ok(proposal.engineeringEvidence.limitations.length > 0)
  assert.equal(Buffer.byteLength(JSON.stringify({ ok: true, value: proposal })) <= 1048576, true)
  assert.equal(Buffer.byteLength(JSON.stringify(proposal.preview)) <= 262144, true)
  assert.equal(Buffer.byteLength(JSON.stringify(proposal.engineeringEvidence)) <= 262144, true)
  assert.throws(() => { proposal.engineeringEvidence.calculation.length = 1 }, TypeError)
  assert.throws(() => { proposal.arguments.entities[0].payload.layerId = 'forged-layer' }, TypeError)
  assert.equal(document.serialize(), before); assert.equal(JSON.stringify(input), originalInput)
  // Mutating the caller's input after review cannot alter the stored approved batch.
  input.title = 'changed after proposal'; input.pavement.leftWidth = 99
  const receipt = value(await session.approve(proposal.planId, 'road-reviewer'))
  assert.equal(receipt.beforeRevision, 0); assert.equal(receipt.afterRevision, 1)
  assert.equal(document.listEntities().length, 488)
  assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  for (const entity of proposal.arguments.entities) assert.equal(document.getObject(entity.options.id).ownerId, document.snapshot().spaces.modelSpaceId)
  assert.equal((await session.approve(proposal.planId, 'road-reviewer')).ok, false)
  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length, 0)
  for (const resource of proposal.preview.resources) assert.equal(document.getObject(resource.id), null)
  await sdk.executeCommand('REDO')
  assert.equal(document.listEntities().length, 488)
  assert.equal(agentPreviewMatchesDocument(document, proposal.preview), true)
  const applied = document.serialize()
  assert.equal((await session.call(tool, { ...JSON.parse(originalInput), expectedRevision: document.revision })).ok, false)
  assert.equal(document.serialize(), applied)
})

test('road session rejects stale, unsupported, unsafe and over-budget inputs without partial resources or geometry', async () => {
  const changes = [
    input => { input.expectedRevision = 1 }, input => { input.units = 'millimeter' },
    input => { input.origin = [0, 0] }, input => { input.pavement.leftCrossfall = 'automatic' },
    input => { input.sections = Array.from({ length: 32 }, (_, i) => ({ station: i * 600 / 31, ground: [[-25, 99], [25, 99]] })) },
    input => { input.sections[0].ground = Array.from({ length: 257 }, (_, i) => [i, 99]) },
  ]
  for (const change of changes) {
    const { document, session, input } = fixture(), before = document.serialize(); change(input)
    assert.equal((await session.call(tool, input)).ok, false)
    assert.equal(document.serialize(), before)
  }
  const { document, session, input } = fixture('millimeter'), before = document.serialize()
  input.units = 'millimeter'
  assert.equal((await session.call(tool, input)).ok, false)
  assert.equal(document.serialize(), before)
  const fresh = fixture(); let invoked = 0
  Object.defineProperty(fresh.input.sections[0].ground[0], '1', { enumerable: true, get() { invoked++; return 99 } })
  assert.equal((await fresh.session.call(tool, fresh.input)).ok, false)
  assert.equal(invoked, 0); assert.equal(fresh.document.revision, 0)
})

test('competing road approvals retain only the first atomic batch and refuse changed revision', async () => {
  const { document, session, input } = fixture()
  const first = value(await session.call(tool, input)), second = value(await session.call(tool, input))
  assert.equal(document.revision, 0)
  value(await session.approve(first.planId, 'reviewer'))
  const applied = document.serialize()
  const conflict = await session.approve(second.planId, 'reviewer')
  assert.equal(conflict.ok, false)
  // Core preflight detects the now-occupied deterministic resource IDs before execution.
  assert.equal(conflict.error.code, 'KJDOCUMENT_INVALID')
  assert.equal(document.serialize(), applied)
  assert.equal(document.listEntities().length, 488)
})

test('road resource-name collisions reject before proposal and host changes invalidate a reviewed road', async () => {
  const { document, session, input } = fixture()
  const plan = value(await session.call(tool, input))
  const layer = plan.preview.resources.find(resource => resource.type === 'LAYER')
  await document.transact('host layer', tx => tx.upsertTableRecord('layers', { name: layer.name, type: 'LAYER', payload: { color: 7 } }))
  const changed = document.serialize()
  assert.equal((await session.approve(plan.planId, 'reviewer')).ok, false)
  assert.equal((await session.call(tool, { ...input, expectedRevision: document.revision })).ok, false)
  assert.equal(document.serialize(), changed)
  assert.equal(document.listEntities().length, 0)
})
