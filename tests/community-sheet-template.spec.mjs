import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, KJAgentToolSession } from '../packages/kjdraw-sdk/src/index.js'
import { loadSheetResources, planSheetTemplate, proposeSheetTemplate } from '../skills/kjdraw-sheet-template/scripts/sheet-template.mjs'

// Public synthetic SDK evidence. Approval is a deterministic test host, not a human/model pass.
const facts = () => ({ version: '1.0.0', templateId: 'community-a4-landscape-v1', sheetId: 'public-a4',
  expectedRevision: 0, units: 'millimeter', origin: [0, 0],
  fields: { title: 'PUBLIC A4 FRAME', drawingNumber: 'EXAMPLE-001', revision: 'A', scaleLabel: '1:1' },
  symbols: [{ name: 'revision-triangle', position: [35, 60] }] })
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const vertices = entity => entity.payload.vertices.map(vertex => Array.isArray(vertex) ? vertex.slice(0, 2) : vertex.point.slice(0, 2))
function fixture(units = 'millimeter') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-sheet-template', units })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
const state = f => ({ drawing: f.document.serialize(), history: f.document.exportHistory(), plans: f.sdk.agentPlans.list() })
const layerOf = (document, entity) => document.getObject(entity.payload.layerId).name
function geometry(document) {
  return document.listEntities().map(entity => ({ type: entity.type, layer: layerOf(document, entity),
    ...(entity.type === 'LINE' ? { start: entity.payload.start, end: entity.payload.end } :
      entity.type === 'TEXT' ? { text: entity.payload.text, position: entity.payload.position, height: entity.payload.height } :
        { vertices: vertices(entity), closed: entity.payload.closed }) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}
function assertSheet(document, { frame = [10, 10, 287, 200], names = ['SHEET-FRAME', 'SHEET-TITLE', 'SHEET-TEXT', 'SHEET-REVISION'], color = 7 } = {}) {
  assert.equal(document.validate().valid, true)
  assert.equal(document.snapshot().header.units, 'millimeter')
  assert.equal(document.listEntities().length, 15)
  assert.equal(document.listEntities({ type: 'LINE' }).length, 5)
  assert.equal(document.listEntities({ type: 'TEXT' }).length, 8)
  assert.equal(document.listEntities({ type: 'LWPOLYLINE' }).length, 2)
  const outline = document.listEntities().find(entity => layerOf(document, entity) === names[0])
  assert.deepEqual(vertices(outline), [[frame[0], frame[1]], [frame[2], frame[1]], [frame[2], frame[3]], [frame[0], frame[3]]])
  assert.equal(outline.payload.closed, true)
  const texts = document.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
  assert.deepEqual(new Set(texts), new Set(['TITLE', 'DRAWING', 'REV.', 'SCALE', ...Object.values(facts().fields)]))
  for (const name of names) assert.ok(document.getTable('layers').records.some(layer => layer.name === name))
  const layer = document.getTable('layers').records.find(item => item.name === names[0])
  assert.equal(layer.payload.color, color)
  for (const entity of document.listEntities()) assert.equal(entity.ownerId, document.spaces.modelSpaceId)
}

test('resource loader and deterministic planner consume the original frame, title fields, layer rules and symbol', async () => {
  const f = fixture(), resources = await loadSheetResources(), before = state(f)
  const plan = planSheetTemplate(f.document, facts(), resources)
  assert.deepEqual(state(f), before)
  assert.equal(plan.toolName, 'cad_propose_drawing_annotated')
  assert.equal(plan.arguments.polylines.length, 2)
  assert.deepEqual(plan.arguments.polylines[1].points, [[35, 60], [39, 60], [37, 63.5]])
  assert.deepEqual(plan.arguments.styles.map(style => style.name), resources.rules.layers.map(layer => layer.name))
  assert.deepEqual(plan.arguments.styles.map(style => style.sources.length), [1, 5, 8, 1])
  assert.equal(plan.evidence.entityCount, 15)
  assert.equal(plan.evidence.sheetId, 'public-a4')
  assert.match(plan.evidence.resourceDigests.template, /^[0-9a-f]{64}$/)
})

test('native proposal changes no drawing, source DXF bytes or history and cannot be executed as pending', async () => {
  const f = fixture(), before = state(f), source = await f.sdk.writeDocument(f.document, { format: 'DXF' })
  const result = await proposeSheetTemplate(f.session, f.document, facts())
  assert.equal(result.status, 'awaiting-host-approval')
  assert.equal(result.proposal.command, 'CREATEBATCH')
  assert.equal(result.proposal.preview.after.length, 15)
  assert.equal(f.document.serialize(), before.drawing)
  assert.deepEqual(f.document.exportHistory(), before.history)
  assert.equal(await f.sdk.writeDocument(f.document, { format: 'DXF' }), source)
  await assert.rejects(async () => {
    const pending = f.sdk.createCommandEnvelope('CREATEBATCH', result.proposal.arguments, {
      document: f.document, origin: 'ai', expectedRevision: 0,
      confirmation: { status: 'pending', planId: result.proposal.planId },
    })
    await f.sdk.executeCommandEnvelope(pending, { document: f.document })
  }, /explicit user confirmation/)
  assert.equal(f.document.serialize(), before.drawing)
  assert.equal(f.sdk.agentPlans.get(result.proposal.planId).status, 'active')
})

test('test host applies one native batch; exact frame/layers survive undo, redo and independent DXF reopening', async () => {
  const f = fixture(), before = f.document.snapshot()
  const result = await proposeSheetTemplate(f.session, f.document, facts())
  value(await f.session.approve(result.proposal.planId, 'community-sheet-template-test-host'))
  assert.equal(f.document.revision, 1)
  assert.equal(f.document.history.undoCount, 1)
  assertSheet(f.document)
  const committed = geometry(f.document), createdIds = f.document.listEntities().map(entity => entity.id)
  const dxf = await f.sdk.writeDocument(f.document, { format: 'DXF', version: '2018' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  assertSheet(reopened)
  assert.deepEqual(geometry(reopened), committed)
  await f.document.undo()
  assert.deepEqual(f.document.snapshot().objects, before.objects)
  assert.deepEqual(f.document.snapshot().tables, before.tables)
  assert.equal(f.document.listEntities().length, 0)
  await f.document.redo()
  assert.deepEqual(geometry(f.document), committed)
  assert.deepEqual(f.document.listEntities().map(entity => entity.id), createdIds)
})

test('changing actual resource margin, layer/color and symbol vertices changes approved native output', async () => {
  const f = fixture(), original = await loadSheetResources(), resources = structuredClone(original)
  resources.template.frameMargin = 15
  resources.rules.layers[0].name = 'CUSTOM-FRAME'
  resources.rules.layers[0].color = 2
  resources.template.symbols['revision-triangle'].vertices = [[0, 0], [6, 0], [3, 5]]
  const initial = planSheetTemplate(f.document, facts(), original)
  const result = await proposeSheetTemplate(f.session, f.document, facts(), resources)
  assert.notEqual(result.evidence.resourceDigests.template, initial.evidence.resourceDigests.template)
  assert.notEqual(result.evidence.resourceDigests.rules, initial.evidence.resourceDigests.rules)
  value(await f.session.approve(result.proposal.planId, 'community-sheet-resource-test-host'))
  assertSheet(f.document, { frame: [15, 15, 282, 195], names: ['CUSTOM-FRAME', 'SHEET-TITLE', 'SHEET-TEXT', 'SHEET-REVISION'], color: 2 })
  const marker = f.document.listEntities().find(entity => layerOf(f.document, entity) === 'SHEET-REVISION')
  assert.deepEqual(vertices(marker), [[35, 60], [41, 60], [38, 65]])
})

test('explicit larger dimensions and nonzero origin move the model frame without guessing or rescaling', async () => {
  const f = fixture(), input = { ...facts(), origin: [100, -50], size: [400, 300], symbols: [] }
  const result = await proposeSheetTemplate(f.session, f.document, input)
  assert.deepEqual(result.evidence.frame, [110, -40, 490, 240])
  assert.deepEqual(result.evidence.titleBox, [310, -40, 490, -8])
  assert.equal(result.evidence.entityCount, 14)
  assert.deepEqual(result.proposal.preview.after.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.height), Array(8).fill(null).map((_, index) => index % 2 ? 3 : 1.8))
  assert.equal(f.document.listEntities().length, 0)
})

test('a tool session bound to another document cannot register a template proposal', async () => {
  const f = fixture(), other = f.sdk.createDocument({ documentId: 'other-public-sheet', units: 'millimeter' })
  const before = state(f), otherBefore = other.serialize()
  await assert.rejects(proposeSheetTemplate(f.session, other, facts()), /bound to the selected document/)
  assert.deepEqual(state(f), before)
  assert.equal(other.serialize(), otherBefore)
})

test('a stale host approval preserves later native geometry and history without inserting a frame', async () => {
  const f = fixture(), result = await proposeSheetTemplate(f.session, f.document, facts())
  await f.document.transact('Later public host edit', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [20, 0, 0] }))
  const before = f.document.serialize(), history = f.document.exportHistory()
  assert.equal((await f.session.approve(result.proposal.planId, 'community-sheet-stale-test-host')).ok, false)
  assert.equal(f.document.serialize(), before)
  assert.deepEqual(f.document.exportHistory(), history)
  assert.equal(f.document.listEntities().length, 1)
  assert.equal(f.document.listEntities({ type: 'LWPOLYLINE' }).length, 0)
})

test('missing host identity and explicit host rejection cannot commit a pending sheet', async () => {
  const f = fixture(), before = f.document.serialize(), history = f.document.exportHistory()
  const result = await proposeSheetTemplate(f.session, f.document, facts())
  assert.equal((await f.session.approve(result.proposal.planId, '')).ok, false)
  assert.equal(f.document.serialize(), before)
  assert.deepEqual(f.document.exportHistory(), history)
  assert.equal(value(f.session.reject(result.proposal.planId, 'community-sheet-rejection-test-host')).status, 'rejected')
  assert.equal((await f.session.approve(result.proposal.planId, 'community-sheet-rejection-test-host')).ok, false)
  assert.equal(f.document.serialize(), before)
  assert.deepEqual(f.document.exportHistory(), history)
})

for (const [name, change] of [
  ['missing units', input => { delete input.units }],
  ['unsupported units', input => { input.units = 'meter' }],
  ['stale revision', input => { input.expectedRevision = 1 }],
  ['nonfinite origin', input => { input.origin = [NaN, 0] }],
  ['coordinate overflow', input => { input.origin = [1e9, 1e9] }],
  ['undersized frame', input => { input.size = [200, 120] }],
  ['missing title fact', input => { delete input.fields.title }],
  ['unknown field', input => { input.fields.material = 'invented' }],
  ['multiline text', input => { input.fields.title = 'PUBLIC\nSECOND LINE' }],
  ['text cell overflow', input => { input.fields.revision = 'REVISION-TOO-LONG' }],
  ['unsupported symbol', input => { input.symbols[0].name = 'north-arrow' }],
  ['symbol outside frame', input => { input.symbols[0].position = [-20, 20] }],
  ['symbol overlaps title', input => { input.symbols[0].position = [150, 20] }],
  ['unknown input', input => { input.overwrite = true }],
]) test('invalid declaration produces no proposal or mutation: ' + name, async () => {
  const f = fixture(), input = facts(), before = state(f)
  change(input)
  await assert.rejects(proposeSheetTemplate(f.session, f.document, input))
  assert.deepEqual(state(f), before)
})

test('document unit mismatch and existing geometry remain unchanged instead of being converted/replaced', async () => {
  for (const units of ['meter', 'millimeter']) {
    const f = fixture(units)
    if (units === 'millimeter') await f.document.transact('Public existing source', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] }))
    const before = state(f)
    await assert.rejects(proposeSheetTemplate(f.session, f.document, { ...facts(), expectedRevision: f.document.revision }))
    assert.deepEqual(state(f), before)
  }
})

test('resource layer collision and native invalid resource values fail before any registered plan', async () => {
  for (const change of [resources => { resources.rules.layers[0].name = '0' },
    resources => { resources.rules.layers[0].color = 999 },
    resources => { resources.template.titleBlock.size = [280, 32] }]) {
    const f = fixture(), resources = await loadSheetResources(), before = state(f)
    change(resources)
    await assert.rejects(proposeSheetTemplate(f.session, f.document, facts(), resources))
    assert.deepEqual(state(f), before)
  }
})
