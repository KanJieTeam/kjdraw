import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS, KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { createKJModelAdapter } from '../packages/kjdraw-sdk/src/model-adapters.js'
import { createKJDomesticModelAdapter } from '../packages/kjdraw-sdk/src/domestic-model-profiles.js'
import { runKJAgentTask } from '../packages/kjdraw-sdk/src/agent-runner.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { compileGeologyColumn } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { portableMcpInputSchema, assertPortableMcpInputSchema } from '../packages/kjdraw-sdk/src/mcp-schema-compat.js'

// Native SDK/provider-wire fixtures, not live provider/model-pass evidence.
const BOUNDS = 'cad_query_curve_bounds', NEAR = 'cad_query_curve_neighborhood'
const nativeNames = [BOUNDS, NEAR], clone = structuredClone
const hash = value => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const commonKeys = ['documentId', 'expectedRevision', 'ownerId', 'units', 'ownerPolicy', 'visibility',
  'typeScope', 'unsupportedPolicy', 'offset', 'limit', 'maxEntities', 'maxBytes']
const nearKeys = [...commonKeys, 'anchorId', 'radius', 'metric', 'boundary']
const close = sdk => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const line = (id, start, end, extra = {}) => ({ id, type: 'LINE', payload: { start, end, ...extra } })
const circle = (id, center, radius, extra = {}) => ({ id, type: 'CIRCLE', payload: { center, radius, ...extra } })
const anchor = (position = [0, 0]) => ({ id: 'anchor', type: 'TEXT', payload: { position, text: 'Public synthetic label', height: 2 } })
async function setup(t, entities = [line('line-five', [3, 4], [6, 8]), circle('ring-ten', [14, 0], 4), anchor()], units = 'millimeter') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units })
  t.after(() => close(sdk))
  if (entities.length) await document.transact('Public native tool fixture', tx => {
    for (const entity of entities) tx.createEntity(entity.type, clone(entity.payload), { id: entity.id,
      ...(entity.ownerId ? { ownerId: entity.ownerId } : {}) })
  })
  const session = new KJAgentToolSession(sdk, document)
  return { sdk, document, session }
}
const options = (document, patch = {}) => ({ documentId: document.id, expectedRevision: document.revision,
  ownerId: document.spaces.modelSpaceId, units: document.snapshot().header.units,
  ownerPolicy: 'model-space-only', visibility: 'include-hidden', typeScope: 'finite-line-circle-only',
  unsupportedPolicy: 'reject', offset: 0, limit: 200, maxEntities: 4096, maxBytes: 262144, ...patch })
const nearby = (document, patch = {}) => ({ ...options(document), anchorId: 'anchor', radius: 10,
  metric: 'text-insertion-to-finite-native-xy-curve', boundary: 'inclusive', ...patch })
async function unchanged(f, operation) {
  const before = f.document.serialize(), snapshot = f.document.snapshot(), history = clone(f.document.history)
  const plans = clone(f.sdk.agentPlans.list())
  try { return await operation() } finally {
    assert.equal(f.document.serialize(), before)
    assert.equal(f.document.snapshot(), snapshot)
    assert.deepEqual(f.document.history, history)
    assert.deepEqual(f.sdk.agentPlans.list(), plans)
  }
}
async function rejected(f, name, input, code) {
  const result = await unchanged(f, () => f.session.call(name, input))
  assert.equal(result.ok, false, JSON.stringify(result))
  if (code) assert.equal(result.error.code, code)
  return result
}

test('full inventory adds exactly two read tools; the previous 53 definitions remain byte-exact', () => {
  assert.equal(KJDRAW_AGENT_TOOLS.length, 55)
  assert.equal(hash(KJDRAW_AGENT_TOOLS.filter(tool => !nativeNames.includes(tool.name))),
    'a60751347e747475e5499146e379bf7f4b92649490f46fe3bf248e2e3cfb3d20')
  assert.deepEqual(KJDRAW_AGENT_TOOLS.slice(-2).map(tool => tool.name), nativeNames)
  for (const name of nativeNames) {
    const tool = KJDRAW_AGENT_TOOLS.find(tool => tool.name === name)
    assert.equal(tool.effect, 'read'); assert.ok(Object.isFrozen(tool))
    assert.match(tool.description, /model/i); assert.match(tool.description, /LINE.*CIRCLE/)
    assert.match(tool.description, /binary64/); assert.match(tool.description, /nextOffset/)
    assert.match(tool.description, /paper|block/)
  }
})
test('new closed schemas require every native identity, scope, policy, pagination and resource limit', () => {
  for (const name of nativeNames) {
    const schema = KJDRAW_AGENT_TOOLS.find(tool => tool.name === name)?.inputSchema
    assert.ok(schema, name); assert.equal(schema.type, 'object'); assert.equal(schema.additionalProperties, false)
    assert.deepEqual(schema.required, name === BOUNDS ? commonKeys : nearKeys)
    assert.deepEqual(Object.keys(schema.properties), schema.required)
    assert.deepEqual(schema.properties.ownerPolicy.enum, ['model-space-only'])
    assert.deepEqual(schema.properties.visibility.enum, ['include-hidden', 'visible-only'])
    assert.deepEqual(schema.properties.typeScope.enum, ['all-owner-entities', 'finite-line-circle-only'])
    assert.deepEqual(schema.properties.unsupportedPolicy.enum, ['reject', 'diagnostics'])
    assert.equal(schema.properties.offset.maximum, 4096); assert.equal(schema.properties.limit.maximum, 200)
    assert.equal(schema.properties.maxEntities.maximum, 4096); assert.equal(schema.properties.maxBytes.maximum, 262144)
    assert.doesNotMatch(JSON.stringify(schema), /"default"|anyOf|oneOf|allOf/)
    assertPortableMcpInputSchema(portableMcpInputSchema(schema))
  }
  const near = KJDRAW_AGENT_TOOLS.find(tool => tool.name === NEAR).inputSchema
  assert.equal(near.properties.radius.exclusiveMinimum, 0); assert.equal(near.properties.radius.maximum, 1e12)
  assert.deepEqual(near.properties.metric.enum, ['text-insertion-to-finite-native-xy-curve'])
  assert.deepEqual(near.properties.boundary.enum, ['inclusive'])
})
test('scalar profile exact 16 definitions and original effective wire SHA cannot be widened by new native tools', async t => {
  const f = await setup(t), caller = { toolProfile: 'geology-scalars-v1' }
  const session = new KJAgentToolSession(f.sdk, f.document, caller)
  caller.toolProfile = 'full'
  assert.equal(session.toolProfile, 'geology-scalars-v1')
  assert.equal(session.definitions.length, 16)
  assert.deepEqual(session.definitions.map(tool => tool.name), KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES)
  assert.equal(hash(session.definitions), '30326cf01cd7e970ca6073ddbe0cd7a665262adb1f8f39e51bb7af68883ffd2f')
  const wire = session.definitions.map(tool => ({ type: 'function', function: {
    name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
  assert.equal(hash(wire), 'db26706498552e8fc1f7417de5924ef64f0e286226b84beb8efa0134f3e34689')
  assert.throws(() => { session.toolProfile = 'full' }, TypeError)
  for (const name of nativeNames) {
    assert.equal(session.definitions.some(tool => tool.name === name), false)
    const result = await unchanged(f, () => session.call(name, name === BOUNDS ? options(f.document) : nearby(f.document)))
    assert.equal(result.ok, false); assert.match(result.error.message, /Unknown CAD tool/)
  }
})
for (const [name, keys] of [[BOUNDS, commonKeys], [NEAR, nearKeys]]) for (const key of keys)
  test(`${name} missing explicit ${key} is rejected without a guessed default`, async t => {
    const f = await setup(t), input = name === BOUNDS ? options(f.document) : nearby(f.document)
    delete input[key]
    const result = await rejected(f, name, input, 'KJDOCUMENT_INVALID')
    assert.match(result.error.message, new RegExp(`missing ${key}`))
  })

test('actual bound SDK document returns independent analytic curve bounds and native exact handles', async t => {
  const f = await setup(t)
  const result = value(await unchanged(f, () => f.session.call(BOUNDS, options(f.document))))
  assert.deepEqual(result.bounds, { min: [3, -4], max: [18, 8] })
  assert.equal(result.documentId, f.document.id); assert.equal(result.revision, f.document.revision)
  assert.equal(result.ownerId, f.document.spaces.modelSpaceId); assert.equal(result.units, 'millimeter')
  assert.equal(result.complete, true); assert.equal(result.scopeComplete, true)
  assert.equal(result.method, 'native-analytic-owner-xy-centerline-curves-v1')
  assert.equal(result.numericalPolicy, 'binary64-no-selection-tolerance')
  assert.equal(result.excludedCounts.otherTypes, 1)
  for (const row of result.rows) {
    const object = f.document.getObject(row.id)
    assert.equal(row.handle, object.handle); assert.equal(row.ownerId, object.ownerId)
    assert.equal(row.layerId, object.payload.layerId)
  }
  assert.ok(Object.isFrozen(result.rows)); assert.equal(Object.hasOwn(result, 'planId'), false)
  assert.equal((await f.session.approve('not-a-query-plan')).ok, false)
})
test('actual neighborhood is finite XY centerline distance with inclusive boundary, not infinite line or circle center', async t => {
  const f = await setup(t, [anchor(), line('five', [3, 4], [6, 8]), line('boundary', [0, 10], [1, 10]),
    line('outside', [0, 10.00000001], [1, 10.00000001]), line('finite-outside', [11, 0], [20, 0]),
    circle('circumference', [14, 0], 4), circle('center-nonunique', [0, 0], 10)])
  const result = value(await unchanged(f, () => f.session.call(NEAR, nearby(f.document))))
  assert.deepEqual(result.rows.map(row => row.id), ['five', 'boundary', 'circumference', 'center-nonunique'])
  assert.equal(result.rows[0].distance, 5); assert.deepEqual(result.rows[0].closestPoint, [3, 4])
  assert.equal(result.rows[1].distance, 10); assert.equal(result.rows[2].distance, 10)
  assert.equal(result.rows[3].closestPoint, null); assert.equal(result.rows[3].closestPointUnique, false)
  assert.deepEqual(result.anchor.position, [0, 0]); assert.equal(result.excludedCounts.anchor, 1)
})
test('pagination preserves exact native scope bounds, IDs and explicit completeness across all pages', async t => {
  const f = await setup(t, Array.from({ length: 7 }, (_, i) => line(`native-${i}`, [i, -i], [i + 1, 2])))
  const ids = []; let offset = 0
  do {
    const page = value(await unchanged(f, () => f.session.call(BOUNDS, options(f.document, { offset, limit: 2 }))))
    assert.equal(page.complete, false); assert.equal(page.scopeComplete, true); assert.equal(page.totalResultCount, 7)
    assert.deepEqual(page.bounds, { min: [0, -6], max: [7, 2] })
    ids.push(...page.rows.map(row => row.id)); offset = page.nextOffset
  } while (offset !== null)
  assert.deepEqual(ids, Array.from({ length: 7 }, (_, i) => `native-${i}`)); assert.equal(new Set(ids).size, 7)
  await rejected(f, BOUNDS, options(f.document, { offset: 8 }), 'KJDOCUMENT_INVALID')
})
test('candidate pagination does not mark a last page as a complete whole-neighborhood answer', async t => {
  const f = await setup(t, [anchor(), ...Array.from({ length: 5 }, (_, i) => line(`within-${i}`, [i, 1], [i, 2]))])
  const first = value(await f.session.call(NEAR, nearby(f.document, { limit: 2 })))
  const last = value(await f.session.call(NEAR, nearby(f.document, { limit: 2, offset: 4 })))
  assert.equal(first.totalResultCount, 5); assert.equal(first.nextOffset, 2); assert.equal(first.complete, false)
  assert.equal(last.nextOffset, null); assert.equal(last.complete, false); assert.equal(last.rows.length, 1)
})
for (const [patch, code] of [[{ documentId: 'foreign-document' }, 'KJNATIVE_GEOMETRY_DOCUMENT_MISMATCH'],
  [{ expectedRevision: 99 }, 'KJDOCUMENT_REVISION_CONFLICT'], [{ units: 'mm' }, 'KJDOCUMENT_INVALID'],
  [{ ownerId: 'nonexistent-owner' }, 'KJNATIVE_GEOMETRY_OWNER_UNSUPPORTED']])
  test(`forged identity/policy rejected by the actual session: ${JSON.stringify(patch)}`, async t => {
    const f = await setup(t)
    await rejected(f, BOUNDS, options(f.document, patch), code)
    await rejected(f, NEAR, nearby(f.document, patch), code)
  })
test('paper and block owners fail closed; native meter document distances are not silently converted', async t => {
  const f = await setup(t, [anchor(), line('native-meter-five', [3, 4], [6, 8])], 'meter')
  const result = value(await f.session.call(NEAR, nearby(f.document, { radius: 5 })))
  assert.equal(result.units, 'meter'); assert.equal(result.rows[0].distance, 5)
  await f.document.transact('Declare public block owner', tx => tx.upsertTableRecord('blockRecords', {
    id: 'public-block', name: 'Public block', payload: { entityIds: [] } }))
  for (const ownerId of [f.document.spaces.paperSpaceIds[0], 'public-block'])
    await rejected(f, BOUNDS, options(f.document, { ownerId }), 'KJNATIVE_GEOMETRY_OWNER_UNSUPPORTED')
})
test('explicit visibility excludes hidden geometry but never substitutes a hidden native anchor', async t => {
  const f = await setup(t, [anchor(), line('shown', [0, 3], [2, 3]), circle('hidden', [0, 0], 2, { visible: false })])
  const shown = value(await unchanged(f, () => f.session.call(NEAR, nearby(f.document, { visibility: 'visible-only' }))))
  assert.deepEqual(shown.rows.map(row => row.id), ['shown']); assert.equal(shown.excludedCounts.hidden, 1)
  await f.document.transact('Hide actual anchor', tx => tx.updateObject('anchor', { payload: { visible: false } }))
  await rejected(f, NEAR, nearby(f.document, { visibility: 'visible-only' }), 'KJNATIVE_GEOMETRY_ANCHOR_HIDDEN')
  assert.equal(value(await f.session.call(NEAR, nearby(f.document))).anchor.visible, false)
})
test('unsupported all-owner geometry outside the first page is rejected or explicitly incomplete, never guessed', async t => {
  const f = await setup(t, [line('first', [0, 0], [1, 1]), circle('second', [2, 2], 1), anchor([100, 200])])
  await rejected(f, BOUNDS, options(f.document, { typeScope: 'all-owner-entities', limit: 1 }), 'KJNATIVE_GEOMETRY_SCOPE_UNSUPPORTED')
  const page = value(await unchanged(f, () => f.session.call(BOUNDS, options(f.document, {
    typeScope: 'all-owner-entities', limit: 1, unsupportedPolicy: 'diagnostics' }))))
  assert.equal(page.complete, false); assert.equal(page.scopeComplete, false); assert.equal(page.totalResultCount, null)
  assert.equal(page.bounds, null); assert.deepEqual(page.rows, []); assert.equal(page.diagnostics[0].id, 'anchor')
  await rejected(f, BOUNDS, options(f.document, { typeScope: 'all-owner-entities', unsupportedPolicy: 'diagnostics', offset: 1 }), 'KJDOCUMENT_INVALID')
})
test('unsupported curve orientation, anchor type and missing anchor reject with original native codes', async t => {
  const f = await setup(t, [anchor(), circle('tilted', [0, 0], 2, { normal: [0, 1, 0] })])
  await rejected(f, NEAR, nearby(f.document), 'KJNATIVE_GEOMETRY_SCOPE_UNSUPPORTED')
  for (const anchorId of ['tilted', 'absent'])
    await rejected(f, NEAR, nearby(f.document, { anchorId }), 'KJNATIVE_GEOMETRY_ANCHOR_UNSUPPORTED')
})
test('work and response budgets reject whole native results without partial pages or state/history changes', async t => {
  const f = await setup(t, [anchor(), ...Array.from({ length: 12 }, (_, i) => line(`public-curve-${i}`, [0, 0], [1, 1]))])
  await rejected(f, BOUNDS, options(f.document, { maxEntities: 12 }), 'KJNATIVE_GEOMETRY_ENTITY_LIMIT')
  await rejected(f, BOUNDS, options(f.document, { maxBytes: 1024 }), 'KJNATIVE_GEOMETRY_BYTE_LIMIT')
  const page = value(await f.session.call(BOUNDS, options(f.document, { maxBytes: 1024, limit: 1 })))
  assert.equal(page.rows.length, 1); assert.equal(page.nextOffset, 1); assert.equal(page.totalResultCount, 12)
})
for (const patch of [{ radius: 0 }, { radius: -1 }, { radius: Infinity }, { radius: '10' },
  { metric: 'distance-to-center' }, { boundary: 'exclusive' }, { limit: 201 }, { maxEntities: 4097 },
  { maxBytes: 262145 }, { offset: -1 }, { ownerPolicy: 'paper-projection' }, { geometry: [] }])
  test(`closed schema refuses expanded/invalid neighborhood arguments: ${JSON.stringify(patch)}`, async t => {
    const f = await setup(t)
    await rejected(f, NEAR, nearby(f.document, patch), 'KJDOCUMENT_INVALID')
  })
test('own enumerable data fields only: inherited/accessor/hidden/symbol arguments cannot be cloned into a valid query', async t => {
  const f = await setup(t), valid = options(f.document); let getters = 0
  const inherited = Object.assign(Object.create({ ownerId: valid.ownerId }), valid); delete inherited.ownerId
  for (const input of [inherited,
    Object.defineProperty({ ...valid }, 'ownerId', { enumerable: true, get() { getters++; return valid.ownerId } }),
    Object.defineProperty({ ...valid }, 'offset', { enumerable: false, value: 0 }),
    { ...valid, [Symbol('extra')]: 1 }]) await rejected(f, BOUNDS, input)
  assert.equal(getters, 0)
  assert.equal(value(await f.session.call(BOUNDS, Object.assign(Object.create(null), valid))).documentId, f.document.id)
})
test('session rejects detached/replaced document even if caller supplies the former exact identity', async t => {
  const f = await setup(t), input = options(f.document)
  f.sdk.closeDocument(f.document.id)
  const result = await f.session.call(BOUNDS, input)
  assert.equal(result.ok, false); assert.match(result.error.message, /detached|replaced/)
})
test('strict exact identifiers reject whitespace, control bytes and substituted policy strings without coercion', async t => {
  const f = await setup(t)
  for (const patch of [{ documentId: ' ' + f.document.id }, { ownerId: f.document.spaces.modelSpaceId + '\n' },
    { units: 'Millimeter' }, { ownerPolicy: 'MODEL-SPACE-ONLY' }, { visibility: true },
    { typeScope: 'line-and-circle' }, { unsupportedPolicy: 'skip' }, { expectedRevision: '1' },
    { offset: 0.5 }, { limit: 0 }, { maxEntities: 0 }, { maxBytes: 1023 }])
    await rejected(f, BOUNDS, options(f.document, patch), 'KJDOCUMENT_INVALID')
})
test('genuine SDK DXF exchange/reimport yields bound native query results and exact imported handle identities', async t => {
  const f = await setup(t), bytes = await f.sdk.writeDocument(f.document, { format: 'DXF' })
  const imported = await f.sdk.readDocument(bytes, { format: 'DXF' })
  const importedSession = new KJAgentToolSession(f.sdk, imported)
  const originalAnchor = f.document.getObject('anchor')
  const importedAnchor = imported.listEntities().find(entity => entity.handle === originalAnchor.handle)
  assert.ok(importedAnchor); assert.notEqual(importedAnchor.id, originalAnchor.id)
  assert.equal(imported.history.undoCount, 0, 'A fresh DXF is an opened baseline, not a query-created edit')
  const g = { sdk: f.sdk, document: imported, session: importedSession }
  const bounds = value(await unchanged(g, () => importedSession.call(BOUNDS, options(imported))))
  const candidates = value(await unchanged(g, () => importedSession.call(NEAR, nearby(imported, { anchorId: importedAnchor.id }))))
  assert.deepEqual(bounds.bounds, { min: [3, -4], max: [18, 8] })
  assert.deepEqual(candidates.rows.map(row => row.distance), [5, 10])
  assert.deepEqual(bounds.rows.map(row => row.handle), ['line-five', 'ring-ten'].map(id => f.document.getObject(id).handle))
  assert.deepEqual(imported.snapshot().opaquePayloads, {})
  assert.equal(imported.history.undoCount, 0)
})
test('empty native model has certified null bounds; no empty-result origin or edit is fabricated', async t => {
  const f = await setup(t, [])
  const result = value(await unchanged(f, () => f.session.call(BOUNDS, options(f.document, { typeScope: 'all-owner-entities' }))))
  assert.equal(result.bounds, null); assert.equal(result.complete, true); assert.equal(result.scopeComplete, true)
  assert.equal(result.totalResultCount, 0); assert.deepEqual(result.rows, [])
  assert.equal(f.document.history.undoCount, 0)
})
test('tiny native segments retain binary64 distance policy through agent dispatch, without selection tolerance', async t => {
  const f = await setup(t, [anchor([5e-201, 0]), line('tiny', [0, 0], [1e-200, 0])])
  const result = value(await unchanged(f, () => f.session.call(NEAR, nearby(f.document, { radius: 1e-210 }))))
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].distance, 0)
  assert.deepEqual(result.rows[0].closestPoint, [5e-201, 0])
})
test('native source-backed column read does not change recipes, HATCH, resources, snapshots, plans or real history', async t => {
  const f = await setup(t, [])
  const input = { expectedRevision: 0, locale: 'en', hole: { id: 'NATIVE-SOURCE', collarElevation: 100,
    depth: 12, stableWaterDepth: 4, strata: [{ intervalId: 'FILL', code: '1', name: 'Fill', top: 0, bottom: 3, lithology: 'fill' },
      { intervalId: 'CLAY', code: '2', name: 'Clay', top: 3, bottom: 12, lithology: 'clay' }] }, verticalScaleDenominator: 200 }
  await f.sdk.executeCommand('CREATEBATCH', clone(compileGeologyColumn(input).commandArgs), { document: f.document })
  await registerGeologyDrawingRecipe(f.document, { kind: 'column', input }, { expectedRevision: f.document.revision })
  const listing = value(await f.session.call('cad_read_geology_source', { expectedRevision: f.document.revision, drawingId: '', maxBytes: 8192 }))
  const source = clone(readGeologyDrawingRecipe(f.document, listing.drawingIds[0]))
  const bounds = value(await unchanged(f, () => f.session.call(BOUNDS, options(f.document))))
  assert.equal(bounds.scopeComplete, true); assert.ok(bounds.excludedCounts.otherTypes > 0)
  assert.ok(f.document.listEntities().some(entity => entity.type === 'HATCH'))
  assert.deepEqual(readGeologyDrawingRecipe(f.document, listing.drawingIds[0]), source)
  await rejected(f, BOUNDS, options(f.document, { typeScope: 'all-owner-entities' }), 'KJNATIVE_GEOMETRY_SCOPE_UNSUPPORTED')
})
test('real undo/redo and validated KJD/history recovery retain exact native read behavior without query history entries', async t => {
  const f = await setup(t, [line('keep', [0, 0], [1, 1])])
  await f.document.transact('Caller second real edit', tx => tx.createEntity('CIRCLE', { center: [10, 0], radius: 2 }, { id: 'last' }))
  const committed = f.document.serialize(), historyCount = f.document.history.undoCount
  assert.equal(value(await unchanged(f, () => f.session.call(BOUNDS, options(f.document)))).rows.length, 2)
  await f.sdk.executeCommand('UNDO', {}, { document: f.document })
  assert.equal(value(await f.session.call(BOUNDS, options(f.document))).rows.length, 1)
  await f.sdk.executeCommand('REDO', {}, { document: f.document })
  assert.equal(value(await f.session.call(BOUNDS, options(f.document))).rows.length, 2)
  assert.equal(f.document.history.undoCount, historyCount)
  const archive = f.document.exportHistory(), reopened = await f.sdk.readDocument(f.document.serialize(), { format: 'KJD' })
  await reopened.restoreHistory(archive, { expectedRevision: reopened.revision })
  const reopenedSession = new KJAgentToolSession(f.sdk, reopened)
  assert.deepEqual(value(await reopenedSession.call(BOUNDS, options(reopened))).bounds, { min: [0, -2], max: [12, 2] })
  assert.equal(reopened.history.undoCount, historyCount)
  assert.ok(committed.includes('keep'))
})

function wireDefinitions(protocol, body) {
  if (protocol === 'chat-completions') return body.tools.map(tool => ({ name: tool.function.name, schema: tool.function.parameters }))
  if (protocol === 'responses') return body.tools.map(tool => ({ name: tool.name, schema: tool.parameters }))
  if (protocol === 'anthropic-messages') return body.tools.map(tool => ({ name: tool.name, schema: tool.input_schema }))
  return body.tools[0].functionDeclarations.map(tool => ({ name: tool.name, schema: tool.parametersJsonSchema }))
}
function reply(protocol, call, index) {
  const id = `native-tool-selftest-${index}`, text = 'Native public fixture read completed; no change applied.'
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: call ? 'tool_calls' : 'stop', message: {
    role: 'assistant', content: call ? null : text, ...(call ? { tool_calls: [{ id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : {}) } }] }
  if (protocol === 'responses') return { status: 'completed', output: call ? [{ type: 'function_call', call_id: id,
    name: call.name, arguments: JSON.stringify(call.arguments) }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: call ? 'tool_use' : 'end_turn',
    content: call ? [{ type: 'tool_use', id, name: call.name, input: call.arguments }] : [{ type: 'text', text }] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: call
    ? [{ functionCall: { id, name: call.name, args: call.arguments } }] : [{ text }] } }] }
}
async function wireTest(t, protocol, provider) {
  const f = await setup(t), requests = [], calls = [
    { name: BOUNDS, arguments: options(f.document) }, { name: NEAR, arguments: nearby(f.document) } ]
  const config = { model: 'public-scripted-native-fixture-not-live', request: async request => {
    requests.push(clone(request.body))
    assert.ok(requests.length <= 3, 'No hidden request/budget expansion')
    return reply(protocol, calls[requests.length - 1], requests.length)
  } }
  const model = provider ? createKJDomesticModelAdapter({ ...config, provider }) : createKJModelAdapter({ ...config, protocol })
  const result = await unchanged(f, () => runKJAgentTask({ session: f.session, model,
    prompt: 'Read the explicitly supplied native scope without changing it.', toolNames: nativeNames,
    expectReadEvidence: true, maxTurns: 3, maxToolCalls: 2, maxRepairAttempts: 0 }))
  assert.equal(result.status, 'responded'); assert.equal(result.turns, 3); assert.equal(result.toolCalls, 2)
  assert.deepEqual(result.proposalIds, []); assert.equal(result.failedToolCalls, 0)
  assert.deepEqual(result.outputs.map(output => output.name), nativeNames)
  assert.deepEqual(value(result.outputs[0].result).bounds, { min: [3, -4], max: [18, 8] })
  assert.deepEqual(value(result.outputs[1].result).rows.map(row => row.distance), [5, 10])
  const expected = f.session.definitions.filter(tool => nativeNames.includes(tool.name)).map(tool => ({ name: tool.name, schema: tool.inputSchema }))
  for (const body of requests) assert.deepEqual(wireDefinitions(protocol, body), expected)
  assert.deepEqual(expected.map(tool => tool.schema.properties.units.enum), [['millimeter'], ['millimeter']])
  assert.equal(result.measurements.complete, false, 'No provider usage is fabricated by fixtures')
}
for (const protocol of ['chat-completions', 'responses', 'anthropic-messages', 'gemini-generate-content'])
  test(`${protocol} actual adapter wire preserves required closed native schemas and real SDK results`, t => wireTest(t, protocol))
for (const provider of ['deepseek', 'qwen', 'kimi', 'doubao'])
  test(`${provider} domestic wire fixture preserves native schema without invented provider/model success`, t => wireTest(t, 'chat-completions', provider))
