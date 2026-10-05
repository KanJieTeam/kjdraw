import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJDocument } from '../src/document.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { compileGeologyColumn } from '../src/geology-engineering.js'
import { registerGeologyDrawingRecipe, readGeologyDrawingRecipe, inspectGeologyDrawingRecipe,
  prepareGeologyDrawingRevision } from '../src/geology-drawing-update.js'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const source = { kind: 'column', input: { expectedRevision: 0, units: 'millimeter',
    hole: { id: 'PUBLIC-TEST', collarElevation: 106.5, depth: 18,
      strata: [{ intervalId: 'A', code: '1', name: 'Fill', lithology: 'fill', top: 0, bottom: 3 },
        { intervalId: 'B', code: '2', name: 'Clay', lithology: 'clay', top: 3, bottom: 18 }] } } }
  const compiled = compileGeologyColumn(source.input)
  await sdk.executeCommand('CREATEBATCH', structuredClone(compiled.commandArgs), { document })
  const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
  await document.transact('Unrelated manual object', tx => tx.createEntity('CIRCLE', { center: [90, 90, 0], radius: 3 }, { id: 'PUBLIC-MANUAL' }))
  return { sdk, document, source, recipe, session: new KJAgentToolSession(sdk, document) }
}

test('read-only inspection validates every generated record but never calls unrelated manual CAD a conflict', async () => {
  const { document, recipe } = await fixture(), before = document.serialize(), history = structuredClone(document.history)
  const result = inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision })
  assert.equal(result.sourceGeometryConsistent, true)
  assert.deepEqual(result.conflicts, [])
  assert.deepEqual(result.conflictTypes, [])
  assert.deepEqual(result.recipe, recipe)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.conflicts), true)
  assert.equal(Object.isFrozen(result.conflictTypes), true)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
  assert.equal(Object.hasOwn(result.recipe.source.input.hole, 'stableWaterDepth'), false)
})

test('all generated drift is identified without overwriting source, while ordinary reads and rebuilds still reject', async () => {
  const { document, recipe, source, sdk, session } = await fixture()
  const target = recipe.entityIds.filter(id => document.getObject(id).type === 'LINE').slice(0, 2)
  assert.equal(target.length, 2)
  await sdk.executeCommand('MOVE', { ids: target, dx: 2, dy: 0 }, { document })
  const before = document.serialize(), history = structuredClone(document.history)
  const inspected = inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision })
  assert.equal(inspected.sourceGeometryConsistent, false)
  assert.deepEqual(inspected.conflicts, target.map(id => ({ kind: 'entity', id, reason: 'record-changed' })))
  assert.deepEqual(inspected.conflictTypes, target.map(id => ({ id, generatedType: 'LINE', actualType: 'LINE' })))
  assert.equal(Object.isFrozen(inspected.conflictTypes[0]), true)
  assert.deepEqual(inspected.recipe.source, source)
  assert.throws(() => readGeologyDrawingRecipe(document, recipe.drawingId), /generated object changed/)
  const next = structuredClone(source); next.input.hole.collarElevation += 1
  assert.throws(() => prepareGeologyDrawingRevision(document, recipe, next, { expectedRevision: document.revision }), /generated object changed/)
  const plain = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId: recipe.drawingId, maxBytes: 262144 })
  assert.equal(plain.ok, false)
  const diagnostic = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId: recipe.drawingId, maxBytes: 262144, includeInspection: true })
  assert.equal(diagnostic.ok, true, JSON.stringify(diagnostic))
  assert.equal(diagnostic.value.inspectionOnly, true)
  assert.equal(diagnostic.value.sourceGeometryConsistent, false)
  assert.deepEqual(diagnostic.value.conflicts, inspected.conflicts)
  assert.deepEqual(diagnostic.value.conflictTypes, inspected.conflictTypes)
  assert.equal(diagnostic.value.measurementsVerified, false)
  assert.equal(Object.hasOwn(diagnostic.value.facts.hole, 'stableWaterDepth'), false)
  assert.equal(diagnostic.value.conflicts.some(item => item.id === 'PUBLIC-MANUAL'), false)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
})

test('generated resource edits are distinguished from entity conflicts', async () => {
  const { document, recipe } = await fixture()
  const layer = document.getObject(recipe.entityIds[0]).payload.layerId
  await document.transact('Explicit layer change', tx => tx.updateObject(layer, { payload: { color: 1 } }))
  const before = document.serialize()
  const result = inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision })
  assert.deepEqual(result.conflicts, [{ kind: 'resource', id: layer, reason: 'record-changed' }])
  assert.deepEqual(result.conflictTypes, [{ id: layer, generatedType: 'LAYER', actualType: 'LAYER' }])
  assert.equal(document.serialize(), before)
})

test('inspection rejects stale revisions, absent recipes, extra options and foreign recipe identities', async () => {
  const { document, recipe, session } = await fixture(), before = document.serialize()
  assert.throws(() => inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision - 1 }), /stale/)
  assert.throws(() => inspectGeologyDrawingRecipe(document, 'geo-missing', { expectedRevision: document.revision }), /no source-backed/)
  assert.throws(() => inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision, approve: true }), /stale or invalid/)
  for (const args of [{ expectedRevision: document.revision, drawingId: '', maxBytes: 262144, includeInspection: true },
    { expectedRevision: document.revision - 1, drawingId: recipe.drawingId, maxBytes: 262144, includeInspection: true },
    { expectedRevision: document.revision, drawingId: recipe.drawingId, maxBytes: 262144, includeInspection: 'true' }])
    assert.equal((await session.call('cad_read_geology_source', args)).ok, false)
  assert.equal(document.serialize(), before)
  const forged = structuredClone(recipe); forged.documentId = 'foreign-document'
  await document.transact('Test untrusted retained identity', tx => tx.putOpaquePayload('geology-drawing-recipe:' + recipe.drawingId, forged))
  assert.throws(() => inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision }), /recipe document/)
})

test('the inspection option is optional and cannot become execution or certification authority', async () => {
  const { document, recipe, session } = await fixture()
  const definition = session.definitions.find(item => item.name === 'cad_read_geology_source')
  assert.equal(definition.effect, 'read')
  assert.equal(definition.inputSchema.required.includes('includeInspection'), false)
  const ordinary = await session.call(definition.name, { expectedRevision: document.revision, drawingId: recipe.drawingId, maxBytes: 262144 })
  assert.equal(ordinary.ok, true)
  assert.equal(Object.hasOwn(ordinary.value, 'inspectionOnly'), false)
  assert.equal(Object.hasOwn(ordinary.value, 'conflicts'), false)
  assert.equal(Object.hasOwn(ordinary.value, 'conflictTypes'), false)
  const listing = await session.call(definition.name, { expectedRevision: document.revision, drawingId: '', maxBytes: 262144 })
  assert.equal(listing.ok, true)
  assert.deepEqual(listing.value.drawingIds, [recipe.drawingId])
})

test('inspection reports every missing, reparented and changed generated entity while excluding edited manual CAD', async () => {
  const { document, recipe, session, sdk } = await fixture()
  const targets = recipe.entityIds.filter(id => document.getObject(id).type === 'LINE').slice(0, 4)
  assert.equal(targets.length, 4)
  await document.transact('Public synthetic mixed generated conflicts', tx => {
    tx.eraseObject(targets[0], { hard: true })
    tx.eraseObject(targets[1])
    tx.reparentObject(targets[2], document.spaces.paperSpaceIds[0])
    const line = document.getObject(targets[3])
    tx.updateObject(targets[3], { payload: { start: [line.payload.start[0] + 1, ...line.payload.start.slice(1)] } })
    tx.updateObject('PUBLIC-MANUAL', { payload: { radius: 5 } })
  })
  const before = document.serialize(), history = structuredClone(document.history), plans = structuredClone(sdk.agentPlans.list())
  const result = inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision })
  assert.equal(result.sourceGeometryConsistent, false)
  assert.deepEqual(result.conflicts, targets.map((id, index) => ({ kind: 'entity', id,
    reason: index < 2 ? 'missing' : index === 2 ? 'owner-membership' : 'record-changed' })))
  assert.deepEqual(result.conflictTypes, targets.map((id, index) => ({ id, generatedType: 'LINE', actualType: index < 2 ? null : 'LINE' })))
  assert.equal(result.conflicts.some(conflict => conflict.id === 'PUBLIC-MANUAL'), false)
  const diagnostic = await session.call('cad_read_geology_source', { expectedRevision: document.revision,
    drawingId: recipe.drawingId, maxBytes: 262144, includeInspection: true })
  assert.equal(diagnostic.ok, true, JSON.stringify(diagnostic))
  assert.deepEqual(diagnostic.value.conflicts, result.conflicts)
  assert.deepEqual(diagnostic.value.conflictTypes, result.conflictTypes)
  assert.throws(() => readGeologyDrawingRecipe(document, recipe.drawingId), /generated object changed/)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
  assert.deepEqual(sdk.agentPlans.list(), plans)
})

test('a legitimately removed generated layer is reported missing together with every relayered generated entity', async () => {
  const { document, recipe } = await fixture()
  const layer = document.getObject(recipe.entityIds[0]).payload.layerId
  const defaultLayer = document.getTable('layers').records.find(record => record.name === '0').id
  const affected = recipe.entityIds.filter(id => document.getObject(id).payload.layerId === layer)
  await document.transact('Public synthetic removed generated resource', tx => {
    for (const id of affected) tx.updateObject(id, { payload: { layerId: defaultLayer } })
    tx.removeTableRecord('layers', layer)
  })
  assert.equal(document.validate().valid, true)
  const before = document.serialize()
  const result = inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision })
  assert.equal(result.sourceGeometryConsistent, false)
  assert.deepEqual(result.conflicts, [{ kind: 'resource', id: layer, reason: 'missing' },
    ...affected.map(id => ({ kind: 'entity', id, reason: 'record-changed' }))])
  assert.deepEqual(result.conflictTypes, [{ id: layer, generatedType: 'LAYER', actualType: null },
    ...affected.map(id => ({ id, generatedType: document.getObject(id).type, actualType: document.getObject(id).type }))])
  assert.throws(() => readGeologyDrawingRecipe(document, recipe.drawingId), /generated resource changed/)
  assert.equal(document.serialize(), before)
})

test('inspection exposes different actual native types from a validated public snapshot, not guessed generated types', async () => {
  const { document, recipe } = await fixture()
  const target = recipe.entityIds.find(id => document.getObject(id).type === 'LINE')
  const state = structuredClone(document.snapshot())
  state.objects[target].type = 'CIRCLE'
  state.objects[target].payload = { ...structuredClone(document.getObject('PUBLIC-MANUAL').payload), layerId: document.getObject(target).payload.layerId }
  const altered = KJDocument.open(state)
  assert.equal(altered.validate().valid, true)
  const before = altered.serialize()
  const result = inspectGeologyDrawingRecipe(altered, recipe.drawingId, { expectedRevision: altered.revision })
  assert.deepEqual(result.conflicts, [{ kind: 'entity', id: target, reason: 'record-changed' }])
  assert.deepEqual(result.conflictTypes, [{ id: target, generatedType: 'LINE', actualType: 'CIRCLE' }])
  assert.equal(altered.serialize(), before)
  assert.throws(() => readGeologyDrawingRecipe(altered, recipe.drawingId), /generated object changed/)
})

test('inspection success cannot authorize scalar or general source revision over generated drift', async () => {
  const { sdk, document, recipe, session } = await fixture()
  const target = recipe.entityIds.find(id => document.getObject(id).type === 'LINE')
  await sdk.executeCommand('MOVE', { ids: [target], dx: 1, dy: 0 }, { document })
  const before = document.serialize(), history = structuredClone(document.history)
  assert.equal((await session.call('cad_read_geology_source', { expectedRevision: document.revision,
    drawingId: recipe.drawingId, maxBytes: 262144, includeInspection: true })).ok, true)
  for (const name of ['cad_propose_geology_scalar_revision', 'cad_propose_geology_revision']) {
    const result = await session.call(name, { expectedRevision: document.revision, units: 'millimeter',
      drawingId: recipe.drawingId, updates: [{ holeId: 'PUBLIC-TEST', collarElevation: 107.5 }] })
    assert.equal(result.ok, false)
    assert.match(result.error.message, /generated object changed/)
  }
  assert.equal(sdk.agentPlans.list().length, 0)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
})

test('inspection rejects a source recipe whose retained key names a different drawing', async () => {
  const { document, recipe, session } = await fixture()
  await document.transact('Public synthetic mismatched retained key', tx =>
    tx.putOpaquePayload('geology-drawing-recipe:geo-ALIAS', structuredClone(recipe)))
  const before = document.serialize()
  assert.throws(() => inspectGeologyDrawingRecipe(document, 'geo-ALIAS', { expectedRevision: document.revision }), /identity|drawingId|drawing ID|recipe key/i)
  assert.throws(() => readGeologyDrawingRecipe(document, 'geo-ALIAS'), /identity|drawingId|drawing ID|recipe key/i)
  for (const includeInspection of [false, true]) {
    const result = await session.call('cad_read_geology_source', { expectedRevision: document.revision,
      drawingId: 'geo-ALIAS', maxBytes: 262144, includeInspection })
    assert.equal(result.ok, false)
  }
  assert.equal(document.serialize(), before)
})

test('an existing unrelated object cannot masquerade as the required native text-style recipe reference', async () => {
  const { document, recipe, session } = await fixture()
  const malformed = structuredClone(recipe); malformed.textStyleId = 'PUBLIC-MANUAL'
  await document.transact('Public synthetic malformed style identity', tx =>
    tx.putOpaquePayload('geology-drawing-recipe:' + recipe.drawingId, malformed))
  const before = document.serialize()
  assert.throws(() => inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision }), /text style|text-style/i)
  for (const includeInspection of [false, true]) assert.equal((await session.call('cad_read_geology_source', {
    expectedRevision: document.revision, drawingId: recipe.drawingId, maxBytes: 262144, includeInspection })).ok, false)
  assert.equal(document.serialize(), before)
})

test('unsupported or malformed retained recipes fail closed rather than becoming conflict diagnostics', async () => {
  for (const change of [recipe => { recipe.version = 99 }, recipe => { recipe.extraAuthority = true },
    recipe => { recipe.source.kind = 'unsupported' }, recipe => { recipe.source.input.hole.strata[0].bottom = 19 },
    recipe => { recipe.entityIds[1] = recipe.entityIds[0] }, recipe => { recipe.entityIds.pop() },
    recipe => { recipe.entityIds[0] = 'PUBLIC-MANUAL' }]) {
    const { document, recipe, session } = await fixture(), malformed = structuredClone(recipe)
    change(malformed)
    await document.transact('Public synthetic malformed retained recipe', tx =>
      tx.putOpaquePayload('geology-drawing-recipe:' + recipe.drawingId, malformed))
    const before = document.serialize(), history = structuredClone(document.history)
    assert.throws(() => inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision }))
    for (const includeInspection of [false, true]) assert.equal((await session.call('cad_read_geology_source', {
      expectedRevision: document.revision, drawingId: recipe.drawingId, maxBytes: 262144, includeInspection })).ok, false)
    assert.equal(document.serialize(), before)
    assert.deepEqual(document.history, history)
  }
})

test('native unit changes and stale source metadata cannot bypass source revision protections', async () => {
  const { document, recipe, source, session } = await fixture()
  const staleStored = structuredClone(recipe); staleStored.source.input.hole.collarElevation += 0.25
  await document.transact('Public source metadata changed independently', tx =>
    tx.putOpaquePayload('geology-drawing-recipe:' + recipe.drawingId, staleStored))
  const next = structuredClone(source); next.input.hole.collarElevation += 1
  assert.throws(() => prepareGeologyDrawingRevision(document, recipe, next, { expectedRevision: document.revision }), /registered source facts have changed/)
  const diagnostic = inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision })
  assert.equal(diagnostic.sourceGeometryConsistent, false)
  assert.deepEqual(diagnostic.recipe.source, staleStored.source)
  await document.transact('Public native units changed', tx => tx.setHeader('units', 'meter'))
  const before = document.serialize()
  assert.throws(() => inspectGeologyDrawingRecipe(document, recipe.drawingId, { expectedRevision: document.revision }), /units do not match/)
  assert.throws(() => readGeologyDrawingRecipe(document, recipe.drawingId), /units do not match/)
  for (const includeInspection of [false, true]) assert.equal((await session.call('cad_read_geology_source', {
    expectedRevision: document.revision, drawingId: recipe.drawingId, maxBytes: 262144, includeInspection })).ok, false)
  assert.equal(document.serialize(), before)
})

test('includeInspection false preserves the ordinary result and over-budget diagnostics reject without truncation or plans', async () => {
  const { document, recipe, session, sdk } = await fixture()
  const args = { expectedRevision: document.revision, drawingId: recipe.drawingId, maxBytes: 262144 }
  const ordinary = await session.call('cad_read_geology_source', args)
  assert.equal(ordinary.ok, true)
  assert.deepEqual(await session.call('cad_read_geology_source', { ...args, includeInspection: false }), ordinary)
  await document.transact('Public many generated drift records', tx => {
    for (const id of recipe.entityIds.filter(id => document.getObject(id).type === 'LINE')) {
      const entity = document.getObject(id)
      tx.updateObject(id, { payload: { start: [entity.payload.start[0] + 1, ...entity.payload.start.slice(1)] } })
    }
  })
  const before = document.serialize(), history = structuredClone(document.history)
  const result = await session.call('cad_read_geology_source', { ...args, expectedRevision: document.revision, maxBytes: 1024, includeInspection: true })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /maxBytes/)
  assert.equal(Object.hasOwn(result, 'value'), false)
  assert.equal(sdk.agentPlans.list().length, 0)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
})
