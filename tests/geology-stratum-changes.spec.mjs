import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { applyGeologyStratumChanges } from '../packages/kjdraw-sdk/src/geology-stratum-changes.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { createSyntheticGeologyDemo } from '../examples/synthetic-geology-demo.mjs'

// Public source/native SDK fixtures only: not live provider acceptance.
const clone = structuredClone
const target = layer => ({ intervalId: layer.intervalId, expectedTop: layer.top, expectedBottom: layer.bottom })
const layers = () => [
  { intervalId: 'PUBLIC-L1', code: '1', name: 'Public fill', lithology: 'fill', top: 0, bottom: 3,
    description: 'Public retained source fact', descriptionSource: 'interval', patternVisibility: 'filled',
    patternLabel: 'P1', stratigraphicNotation: { symbol: 'Q', subscript: '4' } },
  { intervalId: 'PUBLIC-L2', code: '2', name: 'Public clay', lithology: 'clay', top: 3, bottom: 10 },
]
const changes = before => ({ update: [{ target: target(before[0]), set: { name: 'Public topsoil', lithology: 'cultivated-soil' } }] })
const content = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}
const hash = value => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const value = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value }

async function columnFixture(patternVisibility = 'filled') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const source = { kind: 'column', input: { expectedRevision: 0, locale: 'zh-CN', verticalScaleDenominator: 200,
    hole: { id: 'PUBLIC-STRATUM-HOLE', collarElevation: 106, depth: 10,
      strata: layers().map(({ stratigraphicNotation, patternLabel, ...layer }) => layer) } } }
  source.input.hole.strata[0].patternVisibility = patternVisibility
  await sdk.executeCommand('CREATEBATCH', clone(compileGeologyColumn(source.input).commandArgs), { document })
  const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
  return { sdk, document, source, recipe, session: new KJAgentToolSession(sdk, document),
    dispose() { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}
const request = f => ({ expectedRevision: f.document.revision, units: 'millimeter', drawingId: f.recipe.drawingId,
  updates: [{ holeId: f.source.input.hole.id, stratumChanges: changes(f.source.input.hole.strata) }] })

test('stratum delta is additive, closed, frozen and only exposes exact BEFORE identities and seven set fields', () => {
  const tool = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_geology_revision')
  const update = tool.inputSchema.properties.updates.items
  assert.equal(update.required.includes('stratumChanges'), false)
  const schema = update.properties.stratumChanges
  assert.equal(schema.additionalProperties, false); assert.ok(Object.isFrozen(schema))
  assert.deepEqual(Object.keys(schema.properties), ['update']); assert.deepEqual(schema.required, ['update'])
  assert.equal(schema.properties.update.minItems, 1); assert.equal(schema.properties.update.maxItems, 80)
  const operation = schema.properties.update.items
  assert.equal(operation.additionalProperties, false); assert.deepEqual(operation.required, ['target', 'set'])
  assert.deepEqual(operation.properties.target.required, ['intervalId', 'expectedTop', 'expectedBottom'])
  assert.deepEqual(Object.keys(operation.properties.set.properties), ['name', 'lithology', 'description', 'descriptionSource', 'code', 'patternVisibility', 'patternLabel'])
  assert.deepEqual(operation.properties.set.properties.patternLabel, { type: 'string', minLength: 1, maxLength: 24 })
  assert.deepEqual(operation.properties.set.properties.descriptionSource.enum, ['interval', 'layer-definition'])
  assert.deepEqual(operation.properties.set.properties.patternVisibility.enum, ['filled', 'boundary-only'])
  assert.equal(operation.properties.set.additionalProperties, false)
  assert.doesNotMatch(JSON.stringify(schema), /"anyOf"|"oneOf"|"default"/)
  assert.match(tool.description, /stratumChanges\.update.*BEFORE/)
  assert.match(update.properties.strata.description, /Complete-array replacement, NOT a patch/)
})

test('pure helper preserves every unrequested field, order, boundary and optional presence without mutating inputs', () => {
  const before = layers(), operations = changes(before), expected = clone(before)
  expected[0] = { ...expected[0], ...operations.update[0].set }
  const oldBefore = clone(before), oldOperations = clone(operations)
  const after = applyGeologyStratumChanges(before, operations)
  assert.deepEqual(after, expected); assert.deepEqual(before, oldBefore); assert.deepEqual(operations, oldOperations)
  assert.notEqual(after[0], before[0]); assert.notEqual(after[1], before[1])
  assert.equal(Object.hasOwn(after[1], 'description'), false)
  assert.deepEqual(after[0].stratigraphicNotation, before[0].stratigraphicNotation)
  after[0].stratigraphicNotation.symbol = 'Changed output only'
  assert.equal(before[0].stratigraphicNotation.symbol, 'Q')
})

test('all four explicit fields resolve from the same BEFORE source in caller-independent operation order', () => {
  const before = layers(), operations = { update: [
    { target: target(before[1]), set: { code: '2a', description: 'Public second interval description' } },
    { target: target(before[0]), set: { name: 'Public topsoil', lithology: 'cultivated-soil', code: '1a', description: 'Public amended description' } },
  ] }
  const expected = clone(before)
  Object.assign(expected[1], operations.update[0].set); Object.assign(expected[0], operations.update[1].set)
  assert.deepEqual(applyGeologyStratumChanges(before, operations), expected)
  assert.deepEqual(applyGeologyStratumChanges(before, { update: [...operations.update].reverse() }), expected)
  assert.equal(Object.hasOwn(before[1], 'description'), false)
})

test('visibility changes are literal display choices and preserve measured and classification facts', () => {
  const before = layers()
  const delta = { update: [{ target: target(before[0]), set: { patternVisibility: 'boundary-only' } }] }
  const expected = clone(before); expected[0].patternVisibility = 'boundary-only'
  assert.deepEqual(applyGeologyStratumChanges(before, delta), expected)
  const unrecorded = clone(before); delete unrecorded[0].patternVisibility
  const explicit = { update: [{ target: target(unrecorded[0]), set: { patternVisibility: 'filled' } }] }
  assert.deepEqual(applyGeologyStratumChanges(unrecorded, explicit), before)
  assert.equal(Object.hasOwn(unrecorded[0], 'patternVisibility'), false)
  assert.throws(() => applyGeologyStratumChanges(before, explicit), /must change/)
})

for (const [from, to] of [['filled', 'boundary-only'], ['boundary-only', 'filled']])
test(`exact display delta ${from} -> ${to} matches full replacement and closes native approval/history/DXF`, async () => {
  const f = await columnFixture(from), reopenedSdk = createKJDrawSDK()
  try {
    await f.document.transact('Unrelated manual note', tx => tx.createEntity('TEXT', {
      position: [500, 500, 0], height: 2, text: 'Keep this unrelated note',
    }, { id: 'unrelated-note' }))
    const manual = clone(f.document.getObject('unrelated-note'))
    const before = content(f.document), beforeHatches = f.document.listEntities({ type: 'HATCH' }).length
    const args = { expectedRevision: f.document.revision, units: 'millimeter', drawingId: f.recipe.drawingId,
      updates: [{ holeId: f.source.input.hole.id, stratumChanges: {
        update: [{ target: target(f.source.input.hole.strata[0]), set: { patternVisibility: to } }],
      } }] }
    const expectedSource = clone(f.source); expectedSource.input.hole.strata[0].patternVisibility = to
    const pending = value(await f.session.call('cad_propose_geology_revision', args))
    const full = clone(args); delete full.updates[0].stratumChanges
    full.updates[0].strata = clone(expectedSource.input.hole.strata)
    const equivalent = value(await f.session.call('cad_propose_geology_revision', full))
    assert.deepEqual(pending.preview, equivalent.preview)
    assert.deepEqual(pending.engineeringEvidence, equivalent.engineeringEvidence)
    assert.deepEqual(content(f.document), before)
    assert.deepEqual(pending.engineeringEvidence.afterSource.facts.hole, expectedSource.input.hole)
    const retained = pending.unchangedIds.map(id => clone(f.document.getObject(id)))
    args.updates[0].stratumChanges.update[0].set.patternVisibility = from
    assert.equal(value(await f.session.approve(pending.planId, 'public-display-reviewer')).status, 'committed')
    assert.deepEqual(readGeologyDrawingRecipe(f.document, f.recipe.drawingId).source, expectedSource)
    assert.deepEqual(f.document.getObject(manual.id), manual)
    for (const record of retained) assert.deepEqual(f.document.getObject(record.id), record)
    const afterHatches = f.document.listEntities({ type: 'HATCH' }).length
    assert.ok(to === 'filled' ? afterHatches > beforeHatches : afterHatches < beforeHatches)
    const after = content(f.document)
    await f.document.undo(); assert.deepEqual(content(f.document), before)
    await f.document.redo(); assert.deepEqual(content(f.document), after)
    const kjd = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'KJD' }), { format: 'KJD' })
    assert.deepEqual(readGeologyDrawingRecipe(kjd, f.recipe.drawingId).source, expectedSource)
    const dxf = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(dxf.validate().valid, true)
    assert.equal(dxf.listEntities({ type: 'HATCH' }).length, afterHatches)
    assert.equal(dxf.listEntities().length, f.document.listEntities().length)
    assert.ok(dxf.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === manual.payload.text))
    // DXF is graphics only; do not claim this source recipe survived exchange.
    assert.equal(Object.keys(dxf.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false)
  } finally { f.dispose(); for (const id of [...reopenedSdk.documents.keys()]) reopenedSdk.closeDocument(id) }
})

test('explicit description provenance can be added or changed, but is never inferred', () => {
  const before = layers(), targetLayer = target(before[1])
  const delta = { update: [{ target: targetLayer, set: { description: 'Caller-supplied description', descriptionSource: 'interval' } }] }
  const after = applyGeologyStratumChanges(before, delta)
  assert.deepEqual(after[1], { ...before[1], description: 'Caller-supplied description', descriptionSource: 'interval' })
  assert.deepEqual(after[0], before[0]); assert.equal(Object.hasOwn(before[1], 'description'), false)
  const changed = applyGeologyStratumChanges(after, { update: [{ target: target(after[1]), set: { descriptionSource: 'layer-definition' } }] })
  assert.equal(changed[1].descriptionSource, 'layer-definition'); assert.equal(changed[1].description, after[1].description)
  const unspecified = applyGeologyStratumChanges(before, { update: [{ target: targetLayer, set: { description: 'Description with no declared source' } }] })
  assert.equal(Object.hasOwn(unspecified[1], 'descriptionSource'), false)
  assert.throws(() => applyGeologyStratumChanges(before, { update: [{ target: targetLayer, set: { descriptionSource: 'interval' } }] }), /requires a nonempty final description/)
})

for (const provenance of ['interval', 'layer-definition'])
test(`native description and ${provenance} provenance survive approval/history/native reopen and DXF text`, async () => {
  const f = await columnFixture(), reopenedSdk = createKJDrawSDK()
  try {
    const before = content(f.document), expectedSource = clone(f.source)
    const set = { description: 'Caller-supplied public description', descriptionSource: provenance }
    Object.assign(expectedSource.input.hole.strata[1], set)
    const args = { expectedRevision: f.document.revision, units: 'millimeter', drawingId: f.recipe.drawingId,
      updates: [{ holeId: f.source.input.hole.id, stratumChanges: { update: [{ target: target(f.source.input.hole.strata[1]), set }] } }] }
    const pending = value(await f.session.call('cad_propose_geology_revision', args))
    const full = clone(args); delete full.updates[0].stratumChanges; full.updates[0].strata = clone(expectedSource.input.hole.strata)
    const equivalent = value(await f.session.call('cad_propose_geology_revision', full))
    assert.deepEqual(pending.preview, equivalent.preview); assert.deepEqual(pending.engineeringEvidence, equivalent.engineeringEvidence)
    assert.deepEqual(content(f.document), before); assert.deepEqual(pending.engineeringEvidence.afterSource.facts.hole, expectedSource.input.hole)
    assert.equal(value(await f.session.approve(pending.planId, 'public-provenance-reviewer')).status, 'committed')
    assert.deepEqual(readGeologyDrawingRecipe(f.document, f.recipe.drawingId).source, expectedSource)
    const after = content(f.document)
    await f.document.undo(); assert.deepEqual(content(f.document), before)
    await f.document.redo(); assert.deepEqual(content(f.document), after)
    const native = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'KJD' }), { format: 'KJD' })
    assert.deepEqual(readGeologyDrawingRecipe(native, f.recipe.drawingId).source, expectedSource)
    const dxf = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(dxf.validate().valid, true)
    assert.ok(dxf.listEntities().some(entity => ['TEXT', 'MTEXT'].includes(entity.type) && entity.payload.text.includes(set.description)))
    assert.equal(Object.keys(dxf.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false)
  } finally { f.dispose(); for (const id of [...reopenedSdk.documents.keys()]) reopenedSdk.closeDocument(id) }
})

const invalidDeltas = [
  ['missing update', delta => { delete delta.update }],
  ['empty update', delta => { delta.update = [] }],
  ['too many operations', delta => { delta.update = Array.from({ length: 81 }, () => clone(delta.update[0])) }],
  ['addition is forbidden', delta => { delta.add = [] }],
  ['removal is forbidden', delta => { delta.remove = [] }],
  ['missing target', delta => { delete delta.update[0].target }],
  ['missing intervalId', delta => { delete delta.update[0].target.intervalId }],
  ['missing expectedTop', delta => { delete delta.update[0].target.expectedTop }],
  ['missing expectedBottom', delta => { delete delta.update[0].target.expectedBottom }],
  ['unknown intervalId', delta => { delta.update[0].target.intervalId = 'UNKNOWN' }],
  ['fuzzy intervalId', delta => { delta.update[0].target.intervalId = 'PUBLIC-*' }],
  ['wrong expectedTop', delta => { delta.update[0].target.expectedTop = 0.01 }],
  ['wrong expectedBottom', delta => { delta.update[0].target.expectedBottom = 3.01 }],
  ['future renamed interval cannot become a target', delta => { delta.update.push({ target: { intervalId: 'Public topsoil', expectedTop: 0, expectedBottom: 3 }, set: { name: 'Second inferred edit' } }) }],
  ['nonfinite boundary', delta => { delta.update[0].target.expectedBottom = Infinity }],
  ['negative boundary', delta => { delta.update[0].target.expectedTop = -1 }],
  ['duplicate original interval', delta => { delta.update.push(clone(delta.update[0])) }],
  ['missing set', delta => { delete delta.update[0].set }],
  ['empty set', delta => { delta.update[0].set = {} }],
  ['null set', delta => { delta.update[0].set = null }],
  ['no-op set', delta => { delta.update[0].set = { name: 'Public fill' } }],
  ['identity cannot change', delta => { delta.update[0].set.intervalId = 'REPLACEMENT' }],
  ['top cannot change', delta => { delta.update[0].set.top = 1 }],
  ['bottom cannot change', delta => { delta.update[0].set.bottom = 4 }],
  ['pattern definition cannot change', delta => { delta.update[0].set.patternLines = [] }],
  ['unsupported visibility', delta => { delta.update[0].set.patternVisibility = 'hidden' }],
  ['null does not clear visibility', delta => { delta.update[0].set.patternVisibility = null }],
  ['group identity cannot change', delta => { delta.update[0].set.groupId = 'NEW-GROUP' }],
  ['unsupported lithology', delta => { delta.update[0].set.lithology = 'guessed-soil' }],
  ['null does not clear description', delta => { delta.update[0].set.description = null }],
  ['unsupported description provenance', delta => { delta.update[0].set.descriptionSource = 'inferred' }],
  ['null does not clear provenance', delta => { delta.update[0].set.descriptionSource = null }],
  ['empty name', delta => { delta.update[0].set.name = '' }],
  ['oversized code', delta => { delta.update[0].set.code = 'x'.repeat(25) }],
  ['oversized pattern label', delta => { delta.update[0].set.patternLabel = 'x'.repeat(25) }],
  ['null does not clear pattern label', delta => { delta.update[0].set.patternLabel = null }],
  ['oversized description', delta => { delta.update[0].set.description = 'x'.repeat(513) }],
  ['hidden delta field', delta => { Object.defineProperty(delta.update[0].set, 'name', { value: 'Hidden name', enumerable: false }) }],
  ['symbol delta field', delta => { delta.update[0].set[Symbol('hidden')] = 'Hidden' }],
]
for (const [label, mutate] of invalidDeltas) test(`pure helper fails closed: ${label}`, () => {
  const before = layers(), original = clone(before), delta = changes(before)
  mutate(delta)
  assert.throws(() => applyGeologyStratumChanges(before, delta), /Geology stratum changes/)
  assert.deepEqual(before, original)
})

test('getter targets and ambiguous or missing source identities never execute or infer a match', () => {
  let getters = 0
  const before = layers(), delta = changes(before)
  Object.defineProperty(delta.update[0].target, 'intervalId', { get() { getters++; return 'PUBLIC-L1' }, enumerable: true })
  assert.throws(() => applyGeologyStratumChanges(before, delta), /accessors/); assert.equal(getters, 0)
  const ambiguous = [...before, { ...before[0], top: 10, bottom: 11 }]
  assert.throws(() => applyGeologyStratumChanges(ambiguous, changes(before)), /exactly one existing stratum/)
  const unidentified = layers(); delete unidentified[0].intervalId
  assert.throws(() => applyGeologyStratumChanges(unidentified, changes(before)), /exactly one existing stratum/)
})

test('native schema/semantic failures do not modify source, geometry, history or plans, including hidden operations', async () => {
  const f = await columnFixture()
  try {
    const before = f.document.snapshot(), history = clone(f.document.history), plans = clone(f.sdk.agentPlans.list())
    for (const [, mutate] of invalidDeltas) {
      const args = request(f); mutate(args.updates[0].stratumChanges)
      const result = await f.session.call('cad_propose_geology_revision', args)
      assert.equal(result.ok, false, JSON.stringify(result))
      assert.equal(f.document.snapshot(), before); assert.deepEqual(f.document.history, history); assert.deepEqual(f.sdk.agentPlans.list(), plans)
    }
    for (const mutation of [
      args => { args.updates[0].strata = clone(f.source.input.hole.strata) },
      args => { Object.defineProperty(args.updates[0], 'strata', { value: clone(f.source.input.hole.strata), enumerable: false }) },
      args => { Object.defineProperty(args.updates[0], 'stratumChanges', { value: args.updates[0].stratumChanges, enumerable: false }); args.updates[0].collarElevation = 107 },
      args => { args.updates.push(clone(args.updates[0])) },
      args => { args.expectedRevision-- },
      args => { args.units = 'meter' },
    ]) {
      const args = request(f); mutation(args)
      assert.equal((await f.session.call('cad_propose_geology_revision', args)).ok, false)
      assert.equal(f.document.snapshot(), before); assert.deepEqual(f.document.history, history); assert.deepEqual(f.sdk.agentPlans.list(), plans)
    }
    let getters = 0
    const accessor = request(f)
    Object.defineProperty(accessor.updates[0].stratumChanges.update[0].target, 'intervalId', {
      get() { getters++; return 'PUBLIC-L1' }, enumerable: true,
    })
    assert.equal((await f.session.call('cad_propose_geology_revision', accessor)).ok, false)
    assert.equal(getters, 0); assert.equal(f.document.snapshot(), before)
    assert.deepEqual(f.document.history, history); assert.deepEqual(f.sdk.agentPlans.list(), plans)
  } finally { f.dispose() }
})

test('existing full strata replacement remains compatible and produces the same exact reviewed result', async () => {
  const f = await columnFixture()
  try {
    const args = request(f), delta = value(await f.session.call('cad_propose_geology_revision', args))
    const full = request(f); delete full.updates[0].stratumChanges
    full.updates[0].strata = applyGeologyStratumChanges(f.source.input.hole.strata, args.updates[0].stratumChanges)
    const replacement = value(await f.session.call('cad_propose_geology_revision', full))
    assert.deepEqual(delta.engineeringEvidence, replacement.engineeringEvidence)
    assert.deepEqual(delta.preview, replacement.preview)
    assert.equal(f.document.revision, args.expectedRevision)
  } finally { f.dispose() }
})

test('scalar16 schemas and original wire hashes stay exact and reject the new delta field', async () => {
  const f = await columnFixture()
  try {
    const scalar = new KJAgentToolSession(f.sdk, f.document, { toolProfile: 'geology-scalars-v1' })
    assert.equal(scalar.definitions.length, 16)
    assert.equal(hash(scalar.definitions), '30326cf01cd7e970ca6073ddbe0cd7a665262adb1f8f39e51bb7af68883ffd2f')
    assert.equal(hash(scalar.definitions.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))),
      'db26706498552e8fc1f7417de5924ef64f0e286226b84beb8efa0134f3e34689')
    const before = f.document.snapshot(), args = request(f)
    const general = await scalar.call('cad_propose_geology_revision', args)
    assert.equal(general.ok, false); assert.match(general.error.message, /Unknown CAD tool/)
    const rejected = await scalar.call('cad_propose_geology_scalar_revision', args)
    assert.equal(rejected.ok, false); assert.match(rejected.error.message, /unknown property/)
    assert.equal(f.document.snapshot(), before); assert.equal(f.sdk.agentPlans.list().length, 0)
  } finally { f.dispose() }
})

test('eight current source-backed holes use compact exact deltas, real native approval, unchanged facts, undo/redo and KJD/DXF closure', async () => {
  const f = await createSyntheticGeologyDemo(), reopenedSdk = createKJDrawSDK()
  try {
    const read = value(await f.session.call('cad_read_geology_source', { expectedRevision: f.document.revision, drawingId: f.drawingId, maxBytes: 262144 }))
    const beforeRecipe = readGeologyDrawingRecipe(f.document, f.drawingId), expectedSource = clone(beforeRecipe.source)
    const args = { expectedRevision: read.revision, units: read.units, drawingId: read.drawingId,
      updates: read.facts.holes.map(hole => ({ holeId: hole.id,
        stratumChanges: { update: [{ target: target(hole.strata[0]), set: { name: '示例耕植土', lithology: 'cultivated-soil' } }] } })) }
    const fullArgs = { ...args, updates: read.facts.holes.map(hole => ({ holeId: hole.id,
      strata: hole.strata.map((layer, index) => index ? layer : { ...layer, name: '示例耕植土', lithology: 'cultivated-soil' }) })) }
    assert.ok(Buffer.byteLength(JSON.stringify(args)) < Buffer.byteLength(JSON.stringify(fullArgs)) / 2, 'compact deltas do not restate every unchanged interval')
    for (const hole of expectedSource.input.holes) Object.assign(hole.strata[0], { name: '示例耕植土', lithology: 'cultivated-soil' })
    const before = content(f.document), revision = f.document.revision
    const invalidLateTarget = clone(args), oldHistory = clone(f.document.history), oldPlans = clone(f.sdk.agentPlans.list())
    invalidLateTarget.updates.at(-1).stratumChanges.update[0].target.expectedBottom += 0.01
    assert.equal((await f.session.call('cad_propose_geology_revision', invalidLateTarget)).ok, false)
    assert.deepEqual(content(f.document), before); assert.equal(f.document.revision, revision)
    assert.deepEqual(f.document.history, oldHistory); assert.deepEqual(f.sdk.agentPlans.list(), oldPlans)
    const pending = value(await f.session.call('cad_propose_geology_revision', args))
    assert.equal(pending.command, 'GEOLOGY_DRAWING_UPDATE'); assert.equal(pending.status, 'awaiting-host-approval')
    assert.deepEqual(content(f.document), before); assert.equal(f.document.revision, revision)
    assert.deepEqual(pending.engineeringEvidence.afterSource.facts.holes, expectedSource.input.holes)
    const retained = pending.unchangedIds.map(id => clone(f.document.getObject(id)))
    args.updates[0].stratumChanges.update[0].set.name = 'Caller mutation after review must not commit'
    const receipt = value(await f.session.approve(pending.planId, 'public-stratum-reviewer'))
    assert.equal(receipt.status, 'committed'); assert.equal(f.document.revision, revision + 1)
    const afterRecipe = readGeologyDrawingRecipe(f.document, f.drawingId)
    assert.deepEqual(afterRecipe.source, expectedSource)
    for (const field of ['drawingId', 'documentId', 'resourceRoot', 'textStyleId']) assert.equal(afterRecipe[field], beforeRecipe[field])
    assert.deepEqual(f.document.getObject(f.manual.id), f.manual)
    for (const record of retained) assert.deepEqual(f.document.getObject(record.id), record)
    assert.ok(f.document.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName === 'GEO_TOPSOIL'))
    const after = content(f.document)
    await f.document.undo(); assert.deepEqual(content(f.document), before)
    await f.document.redo(); assert.deepEqual(content(f.document), after)
    const kjd = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'KJD' }), { format: 'KJD' })
    assert.deepEqual(readGeologyDrawingRecipe(kjd, f.drawingId).source, expectedSource)
    const dxf = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(dxf.validate().valid, true); assert.equal(dxf.listEntities().length, f.document.listEntities().length)
    assert.ok(dxf.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName === 'GEO_TOPSOIL' && entity.payload.patternLines.length > 0))
    assert.equal(Object.keys(dxf.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false)
  } finally { f.dispose(); for (const id of [...reopenedSdk.documents.keys()]) reopenedSdk.closeDocument(id) }
})
