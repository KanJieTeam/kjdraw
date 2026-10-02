import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as agent from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn, compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { portableMcpInputSchema, assertPortableMcpInputSchema } from '../packages/kjdraw-sdk/src/mcp-schema-compat.js'
import { runKJAgentTask } from '../packages/kjdraw-sdk/src/agent-runner.js'
import { createKJModelAdapter } from '../packages/kjdraw-sdk/src/model-adapters.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { createKJDomesticModelAdapter } from '../packages/kjdraw-sdk/src/domestic-model-profiles.js'

const { KJAgentToolSession, KJDRAW_AGENT_TOOLS } = agent
const SCALAR = 'cad_propose_geology_scalar_revision', PROFILE = 'geology-scalars-v1'
const clone = structuredClone
const hash = value => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const content = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}
const close = sdk => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
const value = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value }
const scalarFields = ['collarElevation', 'depth', 'station', 'initialWaterDepth', 'stableWaterDepth']
const expectedProfile = ['cad_read_history', 'cad_propose_undo', 'cad_propose_redo', 'cad_read_geology_source',
  SCALAR, 'cad_propose_text_edit', 'cad_check_geometry', 'cad_read_drawing', 'cad_read_page',
  'cad_measure_distance', 'cad_propose_move', 'cad_find_text', 'cad_query_drawing', 'cad_query_topology',
  'cad_read_layouts', 'cad_read_selection_sets']

// Public native SDK/host selftests only: no paid caller, provider result or model-pass claim.
function makeHole(id, station) {
  return { id, station, collarElevation: 106 + station / 20, depth: 18, stableWaterDepth: 4,
    strata: [
      { intervalId: id + '-FILL', code: '1', name: 'Fill', top: 0, bottom: 3, lithology: 'fill' },
      { intervalId: id + '-CLAY', code: '2', name: 'Clay', top: 3, bottom: 10, lithology: 'clay', description: 'Retained caller fact' },
      { intervalId: id + '-SAND', code: '3', name: 'Sand', top: 10, bottom: 18, lithology: 'sand' },
    ], observations: [{ kind: 'sample', id: id + '-S', depth: 5, rangeTop: 4, rangeBottom: 6,
      measurements: { density: 1.84, waterContent: 22 } }, { kind: 'spt', id: id + '-N', depth: 12, value: 16 }] }
}
async function setup(t, { kind = 'section', locale = 'en', occurrenceState = 'absent', profile = PROFILE, sdkOptions = {} } = {}) {
  const sdk = createKJDrawSDK(sdkOptions), document = sdk.createDocument({ units: 'millimeter' })
  t.after(() => close(sdk))
  const holes = [makeHole('SCALAR-A', 0), makeHole('SCALAR-B', 20)]
  // The published default English column has one shared observation/description
  // column. Declare a compatible public fixture, not two conflicting columns.
  if (kind === 'column' && locale === 'en') delete holes[0].strata[1].description
  const input = kind === 'column' ? { expectedRevision: 0, locale, hole: holes[0], verticalScaleDenominator: 200 }
    : { expectedRevision: 0, locale, sourceFactMode: 'complete-occurrence-map', holes,
      correlations: ['SAND', 'FILL', 'CLAY'].map(suffix => ({
        fromHoleId: 'SCALAR-A', toHoleId: 'SCALAR-B',
        fromIntervalId: 'SCALAR-A-' + suffix, toIntervalId: 'SCALAR-B-' + suffix })),
      horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 85,
      surfaceRule: 'straight-between-supplied-collars' }
  if (kind === 'section' && occurrenceState === 'empty') input.uncorrelatedOccurrences = []
  await sdk.executeCommand('CREATEBATCH', clone((kind === 'column' ? compileGeologyColumn : compileGeologySection)(input).commandArgs), { document })
  await registerGeologyDrawingRecipe(document, { kind, input }, { expectedRevision: document.revision })
  await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'CIRCLE', options: { id: 'SCALAR-MANUAL' }, payload: { center: [460, 160, 0], radius: 3, layerId: document.getTable('layers').currentId } },
    { type: 'TEXT', options: { id: 'SCALAR-NOTE' }, payload: { position: [460, 175, 0], height: 2,
      text: 'Unrelated caller note', layerId: document.getTable('layers').currentId, styleId: document.getTable('textStyles').currentId } },
  ] }, { document })
  const session = new KJAgentToolSession(sdk, document, { toolProfile: profile })
  const listing = value(await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId: '', maxBytes: 8192 }))
  assert.equal(listing.drawingIds.length, 1)
  const drawingId = listing.drawingIds[0]
  const read = value(await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId, maxBytes: 262144 }))
  assert.equal(read.documentId, document.id); assert.equal(read.revision, document.revision)
  const source = clone(readGeologyDrawingRecipe(document, drawingId).source)
  return { sdk, document, session, drawingId, source, read, kind }
}
const request = f => ({ expectedRevision: f.document.revision, units: 'millimeter', drawingId: f.drawingId,
  updates: [{ holeId: 'SCALAR-A', stableWaterDepth: 4.5 }] })
function semanticReference(input, document) {
  if (Array.isArray(input)) return input.map(item => semanticReference(item, document))
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, semanticReference(item, document)]))
  const record = typeof input === 'string' ? document.getObject(input) : null
  return !record ? input : record.kind === 'entity' ? { handle: record.handle } : { type: record.type, name: record.name }
}
const hatchTransportCodes = new Set([5, 330, 100, 8, 10, 20, 30, 2, 70, 71, 91, 92, 72, 73, 93, 97, 75, 76, 52, 41, 77, 78, 53, 43, 44, 45, 46, 79, 49])
function dxfRecords(document) {
  return document.listEntities().map(entity => {
    const payload = clone(entity.payload)
    if (entity.type === 'HATCH') {
      if (payload.rawTags) assert.ok(payload.rawTags.every(tag => hatchTransportCodes.has(tag.code)))
      delete payload.rawTags
      payload.associative ??= false
      payload.boundaryLoops = payload.boundaryLoops.map(loop => ({ ...loop, flags: loop.flags ?? (2 | (loop.external ? 1 : 0)) }))
      payload.patternLines = payload.patternLines?.map(line => ({ ...line, angle: Number((((line.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toFixed(12)) }))
    }
    return { handle: entity.handle, type: entity.type, payload: semanticReference(payload, document) }
  }).sort((a, b) => a.handle.localeCompare(b.handle))
}
const resources = document => ['layers', 'textStyles', 'linetypes'].map(table => ({ table,
  records: document.getTable(table).records.map(record => ({ type: record.type, name: record.name,
    payload: semanticReference(record.payload, document) })).sort((a, b) => a.name.localeCompare(b.name)) }))

test('scalar tool is additive: every old full definition remains byte-exact and general [] API unchanged', () => {
  assert.equal(KJDRAW_AGENT_TOOLS.length, 53)
  assert.equal(hash(KJDRAW_AGENT_TOOLS.filter(tool => tool.name !== SCALAR)), 'e5e20a67c532037a9fe84248f7a534c8abc0ec7f2a599a506eb38add63dd353b')
  assert.equal(hash(KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_geology_revision')), '4700cdcb5d293caa0d3e767b8077562f210f6b34840419f037f66fed6ebb6ffc')
  const tool = KJDRAW_AGENT_TOOLS.find(tool => tool.name === SCALAR)
  assert.equal(tool.effect, 'propose'); assert.ok(Object.isFrozen(tool))
  const schema = tool.inputSchema
  assert.deepEqual(schema.required, ['expectedRevision', 'units', 'drawingId', 'updates'])
  assert.deepEqual(Object.keys(schema.properties), schema.required)
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.updates.minItems, 1); assert.equal(schema.properties.updates.maxItems, 24)
  const row = schema.properties.updates.items
  assert.deepEqual(row.required, ['holeId']); assert.equal(row.additionalProperties, false)
  assert.deepEqual(Object.keys(row.properties), ['holeId', ...scalarFields, 'clearFields'])
  assert.deepEqual(row.properties.clearFields.items.enum, ['initialWaterDepth', 'stableWaterDepth'])
  assert.doesNotMatch(JSON.stringify(schema), /anyOf|oneOf|if"|then"|correlations|uncorrelatedOccurrences|observationChanges/)
  assertPortableMcpInputSchema(portableMcpInputSchema(schema))
})

test('constructor caller profile is explicit, immutable and every exposed name is an actual registered tool', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  t.after(() => close(sdk))
  const options = { toolProfile: PROFILE }, session = new KJAgentToolSession(sdk, document, options)
  options.toolProfile = 'full'
  assert.equal(session.toolProfile, PROFILE)
  assert.deepEqual(agent.KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES, expectedProfile)
  assert.ok(Object.isFrozen(agent.KJDRAW_GEOLOGY_SCALAR_TOOL_NAMES))
  assert.deepEqual(session.definitions.map(tool => tool.name), expectedProfile)
  assert.ok(session.definitions.every(tool => KJDRAW_AGENT_TOOLS.some(registered => registered.name === tool.name)))
  assert.throws(() => { session.toolProfile = 'full' }, TypeError)
  assert.throws(() => { session.definitions.push(KJDRAW_AGENT_TOOLS[0]) }, TypeError)
  assert.throws(() => { session.definitions.find(tool => tool.name === SCALAR).inputSchema.properties.strata = {} }, TypeError)
  assert.equal(new KJAgentToolSession(sdk, document).toolProfile, 'full')
  assert.deepEqual(new KJAgentToolSession(sdk, document).definitions, new KJAgentToolSession(sdk, document, { toolProfile: 'full' }).definitions)
  for (const name of ['cad_propose_geology_revision', 'cad_propose_geology_section', 'cad_propose_lines', 'cad_propose_structural_edit']) {
    const before = document.snapshot()
    assert.equal((await session.call(name, {})).ok, false)
    assert.equal(document.snapshot(), before)
  }
})

for (const profile of [null, '', 'geology-scalars-v2', 'FULL', 1, {}])
  test('unknown profile fails closed: ' + JSON.stringify(profile), t => {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    t.after(() => close(sdk))
    assert.throws(() => new KJAgentToolSession(sdk, document, { toolProfile: profile }), /profile/i)
  })

test('profile accessor cannot select/widen authority or run getter code', t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  t.after(() => close(sdk)); let getters = 0
  const options = Object.defineProperty({}, 'toolProfile', { enumerable: true, get() { getters++; return 'full' } })
  assert.throws(() => new KJAgentToolSession(sdk, document, options), /plain|data|accessor|profile/i)
  assert.equal(getters, 0)
})
test('millimetre native scalar tool remains unavailable in metre sessions, including explicit profile', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' })
  t.after(() => close(sdk))
  for (const toolProfile of ['full', PROFILE]) {
    const session = new KJAgentToolSession(sdk, document, { toolProfile })
    assert.equal(session.definitions.some(tool => tool.name === SCALAR), false)
    const before = document.snapshot()
    assert.equal((await session.call(SCALAR, { expectedRevision: 0, units: 'meter', drawingId: 'invented', updates: [] })).ok, false)
    assert.equal(document.snapshot(), before)
  }
})

for (const kind of ['column', 'section']) for (const locale of ['en', 'zh-CN'])
  for (const occurrenceState of ['absent', 'empty'])
    test(kind + ' ' + locale + ' ' + occurrenceState + ': actual scalar read/proposal/host approval/HATCH/undo/redo/KJD archive/DXF', async t => {
      const f = await setup(t, { kind, locale, occurrenceState })
      const before = f.document.snapshot(), beforeContent = content(f.document), beforeHistory = clone(f.document.history)
      const expected = clone(f.source)
      const hole = kind === 'column' ? expected.input.hole : expected.input.holes[0]
      hole.stableWaterDepth = 4.5
      const args = request(f), original = clone(args)
      const pending = value(await f.session.call(SCALAR, args))
      assert.deepEqual(args, original)
      assert.equal(pending.command, 'GEOLOGY_DRAWING_UPDATE'); assert.equal(pending.status, 'awaiting-host-approval')
      assert.equal(f.document.snapshot(), before); assert.deepEqual(f.document.history, beforeHistory)
      assert.deepEqual(pending.engineeringEvidence.beforeSource.facts, f.source.input)
      assert.deepEqual(pending.engineeringEvidence.afterSource.facts, expected.input)
      const untouched = Object.values(before.objects).filter(record => record.kind === 'entity' && !pending.preview.before.some(entity => entity.id === record.id))
      assert.ok(untouched.some(record => record.id === 'SCALAR-MANUAL'))
      assert.ok(untouched.some(record => record.type === 'HATCH'))
      const result = value(await f.session.approve(pending.planId, 'scalar-explicit-host'))
      assert.equal(result.status, 'committed'); assert.equal(result.afterRevision, before.revision + 1)
      assert.deepEqual(readGeologyDrawingRecipe(f.document, f.drawingId).source, expected)
      assert.equal(f.document.history.undoCount, beforeHistory.undoCount + 1)
      for (const record of untouched) assert.deepEqual(f.document.getObject(record.id), record)
      assert.deepEqual(f.document.snapshot().tables, before.tables); assert.deepEqual(f.document.snapshot().spaces, before.spaces)
      const afterContent = content(f.document), afterResources = resources(f.document)
      const undoRead = value(await f.session.call('cad_read_history', { expectedRevision: f.document.revision }))
      const undo = value(await f.session.call('cad_propose_undo', { expectedRevision: f.document.revision, units: 'millimeter', targetHistoryId: undoRead.history.undoTarget.id }))
      value(await f.session.approve(undo.planId, 'scalar-explicit-host'))
      assert.deepEqual(content(f.document), beforeContent)
      const redoRead = value(await f.session.call('cad_read_history', { expectedRevision: f.document.revision }))
      const redo = value(await f.session.call('cad_propose_redo', { expectedRevision: f.document.revision, units: 'millimeter', targetHistoryId: redoRead.history.redoTarget.id }))
      value(await f.session.approve(redo.planId, 'scalar-explicit-host'))
      assert.deepEqual(content(f.document), afterContent)
      const reopenedSdk = createKJDrawSDK(); t.after(() => close(reopenedSdk))
      const reopened = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'KJD' }), { format: 'KJD' })
      assert.equal(canonicalStringify(reopened.snapshot()), canonicalStringify(f.document.snapshot()))
      assert.equal(reopened.history.undoCount, 0)
      const archive = f.document.exportHistory(), corrupt = clone(archive); corrupt.documentFingerprint = 'wrong-drawing'
      const reopenedBeforeRestore = reopened.snapshot()
      await assert.rejects(reopened.restoreHistory(corrupt), /does not match/)
      assert.equal(reopened.history.undoCount, 0)
      assert.equal(reopened.snapshot(), reopenedBeforeRestore)
      await reopened.restoreHistory(archive)
      assert.equal(reopened.history.undoCount, f.document.history.undoCount)
      assert.notEqual(reopened.history.undoTarget.id, f.document.history.undoTarget.id)
      await reopened.undo(); assert.equal(canonicalStringify(content(reopened)), canonicalStringify(beforeContent))
      await reopened.redo(); assert.equal(canonicalStringify(content(reopened)), canonicalStringify(afterContent))
      const dxf = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'DXF' }), { format: 'DXF' })
      assert.equal(dxf.validate().valid, true)
      assert.equal(canonicalStringify(dxfRecords(dxf)), canonicalStringify(dxfRecords(f.document)))
      assert.equal(canonicalStringify(resources(dxf)), canonicalStringify(afterResources))
      assert.equal(dxf.history.undoCount, 0)
      assert.throws(() => readGeologyDrawingRecipe(dxf, f.drawingId), /source|recipe/i)
    })

const invalid = [
  ['extra correlations []', args => { args.correlations = [] }, /unknown property/],
  ['extra uncorrelatedOccurrences []', args => { args.uncorrelatedOccurrences = [] }, /unknown property/],
  ['extra linkChanges', args => { args.linkChanges = { correlations: { add: [] } } }, /unknown property/],
  ...['strata', 'observations', 'groundwaterObservations', 'observationChanges', 'x', 'y', 'id', 'startDate', 'endDate'].map(field =>
    ['unsupported update ' + field, args => { args.updates[0][field] = [] }, /unknown property/]),
  ['clear observations', args => { args.updates[0].clearFields = ['observations'] }, /expected one of/],
  ['clear groundwater records', args => { args.updates[0].clearFields = ['groundwaterObservations'] }, /expected one of/],
  ['null scalar', args => { args.updates[0].stableWaterDepth = null }, /finite number/],
  ['NaN scalar', args => { args.updates[0].stableWaterDepth = NaN }, /finite number/],
  ['negative water depth', args => { args.updates[0].stableWaterDepth = -1 }, /bounds/],
  ['strata beyond reduced depth', args => { args.updates[0] = { holeId: 'SCALAR-A', depth: 8 } }, /depth|interval|strat/i],
  ['unknown hole', args => { args.updates[0].holeId = 'DOES-NOT-EXIST' }, /existing hole/],
  ['duplicate hole', args => { args.updates.push(clone(args.updates[0])) }, /unique existing/],
  ['no changed field', args => { args.updates[0] = { holeId: 'SCALAR-A' } }, /changed fields/],
  ['no-op unchanged scalar', args => { args.updates[0].stableWaterDepth = 4 }, /not changed|does not alter/],
  ['empty updates', args => { args.updates = [] }, /array length/],
  ['25 updates', args => { args.updates = Array.from({ length: 25 }, () => clone(args.updates[0])) }, /array length/],
  ['set and clear same field', args => { args.updates[0].clearFields = ['stableWaterDepth'] }, /both clear and set/],
  ['duplicate clear', args => { args.updates[0] = { holeId: 'SCALAR-A', clearFields: ['stableWaterDepth', 'stableWaterDepth'] } }, /same field twice/],
  ['wrong units', args => { args.units = 'meter' }, /expected one of/],
  ['stale revision', args => { args.expectedRevision-- }, /revision/i],
  ['wrong recipe', args => { args.drawingId = 'FOREIGN' }, /source|recipe/i],
  ['hidden unsupported list', args => { Object.defineProperty(args, 'uncorrelatedOccurrences', { value: [], enumerable: false }) }, /unknown property/],
  ['hidden declared initial water alongside stable change', args => { Object.defineProperty(args.updates[0], 'initialWaterDepth', { value: 2, enumerable: false }) }, /enumerable plain data/],
  ['hidden required units', args => { Object.defineProperty(args, 'units', { value: 'millimeter', enumerable: false }) }, /enumerable plain data/],
  ['accessor unsupported list', args => { Object.defineProperty(args, 'uncorrelatedOccurrences', { enumerable: true, get() { throw new Error('must not invoke getter') } }) }, /unknown property/],
  ['accessor scalar', args => { Object.defineProperty(args.updates[0], 'stableWaterDepth', { enumerable: true, get() { throw new Error('must not invoke getter') } }) }, /accessor/],
  ['inherited list', args => { Object.setPrototypeOf(args, { uncorrelatedOccurrences: [] }) }, /plain object/],
]
for (const [label, mutate, error] of invalid) test(label + ': rejected without plan, mutation, sanitization or new history', async t => {
  const f = await setup(t), args = request(f), before = f.document.snapshot(), history = clone(f.document.history)
  mutate(args)
  const result = await f.session.call(SCALAR, args)
  assert.equal(result.ok, false); assert.match(result.error.message, error)
  assert.equal(f.document.snapshot(), before); assert.deepEqual(f.document.history, history)
  assert.deepEqual(readGeologyDrawingRecipe(f.document, f.drawingId).source, f.source)
  assert.equal(f.sdk.agentPlans.list().length, 0)
})

test('explicit [] retains its native complete replacement semantics in default general API, while scalar rejects it', async t => {
  const f = await setup(t, { profile: 'full' }), args = request(f)
  args.correlations = clone(f.source.input.correlations); args.uncorrelatedOccurrences = []
  const before = f.document.snapshot()
  const rejected = await f.session.call(SCALAR, args)
  assert.equal(rejected.ok, false); assert.match(rejected.error.message, /unknown property/)
  assert.equal(f.document.snapshot(), before); assert.equal(Object.hasOwn(args, 'uncorrelatedOccurrences'), true)
  const general = value(await f.session.call('cad_propose_geology_revision', args))
  assert.deepEqual(general.engineeringEvidence.afterSource.facts.uncorrelatedOccurrences, [])
  value(await f.session.approve(general.planId, 'explicit-general-host'))
  const actual = readGeologyDrawingRecipe(f.document, f.drawingId).source.input
  assert.equal(Object.hasOwn(actual, 'uncorrelatedOccurrences'), true); assert.deepEqual(actual.uncorrelatedOccurrences, [])
})

test('extra unrequested but valid scalar remains visible: schema is not a user-intent oracle or hidden stripping repair', async t => {
  const f = await setup(t), args = request(f), before = f.document.snapshot()
  args.updates[0].initialWaterDepth = 2
  const pending = value(await f.session.call(SCALAR, args))
  assert.equal(pending.engineeringEvidence.afterSource.facts.holes[0].stableWaterDepth, 4.5)
  assert.equal(pending.engineeringEvidence.afterSource.facts.holes[0].initialWaterDepth, 2)
  assert.equal(args.updates[0].initialWaterDepth, 2)
  assert.equal(f.document.snapshot(), before)
  value(f.session.reject(pending.planId, 'caller-rejects-extra-measurement'))
  assert.equal(f.document.snapshot(), before)
  assert.equal((await f.session.approve(pending.planId, 'host')).ok, false)
})

for (const field of scalarFields) test('existing native scalar field ' + field + ' uses unchanged compiler validation', async t => {
  const f = await setup(t, { kind: field === 'initialWaterDepth' ? 'column' : 'section' }), args = request(f)
  const candidate = { collarElevation: 107, depth: 19, station: 1, initialWaterDepth: 2, stableWaterDepth: 4.5 }[field]
  args.updates = [{ holeId: 'SCALAR-A', [field]: candidate }]
  if (field === 'depth') {
    const before = f.document.snapshot(), result = await f.session.call(SCALAR, args)
    assert.equal(result.ok, false); assert.match(result.error.message, /final layer bottom must equal hole depth/)
    assert.equal(f.document.snapshot(), before); assert.equal(f.sdk.agentPlans.list().length, 0)
    return // A scalar API cannot fabricate the matching strata replacement.
  }
  const result = value(await f.session.call(SCALAR, args))
  const afterHole = f.kind === 'column' ? result.engineeringEvidence.afterSource.facts.hole : result.engineeringEvidence.afterSource.facts.holes[0]
  assert.equal(afterHole[field], candidate)
  value(await f.session.approve(result.planId, 'host'))
  const actual = readGeologyDrawingRecipe(f.document, f.drawingId).source.input
  assert.equal((f.kind === 'column' ? actual.hole : actual.holes[0])[field], candidate)
})
for (const field of ['initialWaterDepth', 'stableWaterDepth']) test('explicit clear removes only optional ' + field + ', not known zero or unrelated records', async t => {
  const f = await setup(t, { kind: 'column' }), args = request(f)
  args.updates = [{ holeId: 'SCALAR-A', [field]: 0 }]
  value(await f.session.approve(value(await f.session.call(SCALAR, args)).planId, 'host'))
  assert.equal(readGeologyDrawingRecipe(f.document, f.drawingId).source.input.hole[field], 0)
  args.expectedRevision = f.document.revision; args.updates = [{ holeId: 'SCALAR-A', clearFields: [field] }]
  const pending = value(await f.session.call(SCALAR, args))
  assert.equal(Object.hasOwn(pending.engineeringEvidence.afterSource.facts.hole, field), false)
  value(await f.session.approve(pending.planId, 'host'))
  const actual = readGeologyDrawingRecipe(f.document, f.drawingId).source.input.hole
  assert.equal(Object.hasOwn(actual, field), false); assert.deepEqual(actual.observations, f.source.input.hole.observations)
})

test('caller argument mutation after preview cannot alter native approval binding; replay and foreign session fail', async t => {
  const f = await setup(t), args = request(f), pending = value(await f.session.call(SCALAR, args))
  args.updates[0].stableWaterDepth = 9
  const fresh = new KJAgentToolSession(f.sdk, f.document, { toolProfile: 'full' })
  assert.equal((await fresh.approve(pending.planId, 'foreign-session')).ok, false)
  assert.equal((await f.session.approve('foreign-plan', 'host')).ok, false)
  value(await f.session.approve(pending.planId, 'host'))
  assert.equal(readGeologyDrawingRecipe(f.document, f.drawingId).source.input.holes[0].stableWaterDepth, 4.5)
  const after = f.document.snapshot()
  assert.equal((await f.session.approve(pending.planId, 'host')).ok, false)
  assert.equal(f.document.snapshot(), after)
  assert.throws(() => f.session.bindTaskProposal(pending.planId, {}), /available|supports/)
})

test('real external edit invalidates pending scalar approval, with no automatic retry or source update', async t => {
  const f = await setup(t), pending = value(await f.session.call(SCALAR, request(f)))
  await f.sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [600, 200, 0], radius: 2,
    layerId: f.document.getTable('layers').currentId } }, { document: f.document })
  const afterExternal = f.document.snapshot(), history = clone(f.document.history)
  assert.equal((await f.session.approve(pending.planId, 'host')).ok, false)
  assert.equal(f.document.snapshot(), afterExternal); assert.deepEqual(f.document.history, history)
  assert.deepEqual(readGeologyDrawingRecipe(f.document, f.drawingId).source, f.source)
})

test('explicit profile supports actual native manual MOVE and TEXTEDIT after the source commit', async t => {
  const f = await setup(t)
  value(await f.session.approve(value(await f.session.call(SCALAR, request(f))).planId, 'source-host'))
  const sourceBeforeManual = clone(readGeologyDrawingRecipe(f.document, f.drawingId).source)
  const before = clone(f.document.getObject('SCALAR-MANUAL'))
  const move = value(await f.session.call('cad_propose_move', { expectedRevision: f.document.revision, units: 'millimeter',
    ids: ['SCALAR-MANUAL'], dx: 6, dy: 0 }))
  value(await f.session.approve(move.planId, 'manual-host'))
  assert.deepEqual(f.document.getObject('SCALAR-MANUAL').payload.center, [before.payload.center[0] + 6, before.payload.center[1], 0])
  const note = f.document.getObject('SCALAR-NOTE')
  const edit = value(await f.session.call('cad_propose_text_edit', { expectedRevision: f.document.revision, units: 'millimeter',
    changes: [{ id: note.id, expectedText: note.payload.text, text: 'Explicitly edited manual note' }] }))
  value(await f.session.approve(edit.planId, 'manual-host'))
  assert.equal(f.document.getObject(note.id).payload.text, 'Explicitly edited manual note')
  assert.deepEqual(readGeologyDrawingRecipe(f.document, f.drawingId).source, sourceBeforeManual)
})

test('bounded scripted bridge genuinely reads source then invokes the registered scalar API, never claiming provider execution', async t => {
  const f = await setup(t)
  let requests = 0
  const run = await runKJAgentTask({ session: f.session, prompt: 'Caller requests SCALAR-A stableWaterDepth 4.5 only.',
    toolNames: ['cad_read_geology_source', SCALAR], expectProposal: true, expectReadEvidence: true, maxTurns: 3, maxToolCalls: 3,
    model: { createConversation({ tools }) {
      assert.deepEqual(tools.map(tool => tool.name), ['cad_read_geology_source', SCALAR])
      return { async next(input) {
        requests++
        if (requests === 1) return { text: '', calls: [{ id: 'actual-source-read', name: 'cad_read_geology_source',
          arguments: { expectedRevision: f.document.revision, drawingId: f.drawingId, maxBytes: 262144 } }] }
        const read = value(input.results[0].result)
        assert.equal(read.documentId, f.document.id)
        return { text: 'Awaiting host review, not committed.', calls: [{ id: 'actual-scalar-plan', name: SCALAR,
          arguments: { expectedRevision: read.revision, units: read.units, drawingId: f.drawingId,
            updates: [{ holeId: read.facts.holes[0].id, stableWaterDepth: 4.5 }] } }] }
      } }
    } } })
  assert.equal(run.status, 'awaiting-approval'); assert.equal(requests, 2)
  assert.equal(run.outputs.length, 2); assert.equal(run.outputs[0].result.ok, true)
  assert.equal(run.proposalIds.length, 1)
  assert.equal(readGeologyDrawingRecipe(f.document, f.drawingId).source.input.holes[0].stableWaterDepth, 4)
  value(f.session.reject(run.proposalIds[0], 'scripted-host-only'))
})

test('constructor copies and freezes supported knowledge options without retaining or freezing caller data', t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  t.after(() => close(sdk))
  const pack = clone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  const sha256 = hash(pack), options = { toolProfile: 'full', geologySectionKnowledge: { pack, sha256 } }
  const session = new KJAgentToolSession(sdk, document, options), originalDefinitions = clone(session.definitions)
  options.toolProfile = PROFILE; options.geologySectionKnowledge.sha256 = 'b'.repeat(64)
  pack.id = 'caller-changed-pack'; pack.rules['geology-section-layout'].footerGrid = [{ key: 'unexpected-caller-field' }]
  assert.equal(session.toolProfile, 'full')
  assert.equal(session.geologySectionKnowledge.id, KJDRAW_GEOLOGY_KNOWLEDGE_PACK.id)
  assert.equal(session.geologySectionKnowledge.sha256, sha256)
  assert.deepEqual(session.definitions, originalDefinitions)
  assert.equal(Object.isFrozen(options), false); assert.equal(Object.isFrozen(pack), false)
})

test('hidden constructor profile is rejected rather than silently disappearing during a clone', t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  t.after(() => close(sdk))
  const options = Object.defineProperty({}, 'toolProfile', { value: PROFILE, enumerable: false })
  assert.throws(() => new KJAgentToolSession(sdk, document, options), /enumerable data/)
})

test('general revision cannot be selected through a run or forged wrapper while native profile is narrow', async t => {
  const f = await setup(t), before = f.document.snapshot(); let modelCalls = 0
  await assert.rejects(runKJAgentTask({ session: f.session, prompt: 'Caller-supplied general request.',
    toolNames: ['cad_propose_geology_revision'], model: { createConversation() { modelCalls++; throw new Error('must not invoke model') } } }), /session.definitions|exact names/)
  assert.equal(modelCalls, 0)
  assert.equal((await f.session.call('cad_propose_geology_revision', request(f))).ok, false)
  assert.equal(f.document.snapshot(), before)
})

test('native scalar plan binds complete arguments; valid but altered scalar content cannot execute', async t => {
  const captured = []
  const bindingProvider = { algorithm: 'PUBLIC-SELFTEST-SHA256',
    async create(text) { captured.push(JSON.parse(text)); return createHash('sha256').update(text).digest('hex') },
    async verify(text, binding) { return createHash('sha256').update(text).digest('hex') === binding } }
  const f = await setup(t, { sdkOptions: { agentPlanOptions: { bindingProvider } } })
  const pending = value(await f.session.call(SCALAR, request(f))), actual = captured.at(-1)
  assert.equal(actual.command, 'GEOLOGY_DRAWING_UPDATE')
  const altered = clone(actual.arguments); altered.next.input.holes[0].stableWaterDepth = 8
  const execution = f.sdk.createCommandEnvelope(actual.command, altered, { document: f.document,
    expectedRevision: f.document.revision, origin: 'ai', confirmation: { status: 'confirmed', planId: pending.planId, confirmedBy: 'host' } })
  const before = f.document.snapshot()
  await assert.rejects(f.sdk.executeCommandEnvelope(execution, { document: f.document }), /do not match|binding/)
  assert.equal(f.document.snapshot(), before)
  assert.equal(f.sdk.agentPlans.get(pending.planId).status, 'active')
  value(await f.session.approve(pending.planId, 'host'))
  assert.equal(readGeologyDrawingRecipe(f.document, f.drawingId).source.input.holes[0].stableWaterDepth, 4.5)
})

test('changed native command definition blocks approval even at the exact unchanged document revision', async t => {
  const f = await setup(t), pending = value(await f.session.call(SCALAR, request(f))), before = f.document.snapshot()
  const original = f.sdk.commands.resolve('GEOLOGY_DRAWING_UPDATE')
  let executions = 0
  f.sdk.commands.register({ ...original, execute() { executions++; throw new Error('must not execute altered command') } }, { replace: true })
  const result = await f.session.approve(pending.planId, 'host')
  assert.equal(result.ok, false); assert.match(result.error.message, /Command changed since preview/)
  assert.equal(executions, 0); assert.equal(f.document.snapshot(), before)
})

const wireProtocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
function wireAnswer(protocol, args) {
  const id = 'public-scalar-wire'
  if (protocol === 'responses') return { status: 'completed', output: [{ type: 'function_call', call_id: id,
    name: SCALAR, arguments: JSON.stringify(args) }] }
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant',
    content: null, tool_calls: [{ id, type: 'function', function: { name: SCALAR, arguments: JSON.stringify(args) } }] } }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name: SCALAR, input: args }] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { id, name: SCALAR, args } }] } }] }
}
for (const protocol of wireProtocols) test(protocol + ': real adapter preserves closed scalar schema and rejects no fields implicitly', async t => {
  const f = await setup(t), definition = f.session.definitions.find(tool => tool.name === SCALAR), args = request(f)
  args.uncorrelatedOccurrences = []
  let requests = 0
  const adapter = createKJModelAdapter({ protocol, model: 'public-selftest-no-provider', request: async ({ body }) => {
    requests++
    const schema = protocol === 'responses' ? body.tools[0].parameters
      : protocol === 'chat-completions' ? body.tools[0].function.parameters
      : protocol === 'anthropic-messages' ? body.tools[0].input_schema : body.tools[0].functionDeclarations[0].parametersJsonSchema
    assert.deepEqual(schema, definition.inputSchema)
    return wireAnswer(protocol, args)
  } })
  const before = f.document.snapshot()
  const turn = await adapter.createConversation({ instructions: 'Public native schema selftest.', tools: [definition] })
    .next({ kind: 'prompt', text: 'Schema roundtrip only, not a real provider.' }, new AbortController().signal)
  assert.equal(requests, 1); assert.deepEqual(turn.calls[0].arguments, args)
  assert.equal(Object.hasOwn(turn.calls[0].arguments, 'uncorrelatedOccurrences'), true)
  const rejection = await f.session.call(turn.calls[0].name, turn.calls[0].arguments)
  assert.equal(rejection.ok, false); assert.match(rejection.error.message, /unknown property/)
  assert.equal(f.document.snapshot(), before); assert.equal(f.sdk.agentPlans.list().length, 0)
})

test('one genuine invalid-array result followed by model-owned correction obeys existing shared repair budget', async t => {
  const f = await setup(t), before = f.document.snapshot(); let requests = 0
  const invalidArgs = request(f); invalidArgs.uncorrelatedOccurrences = []
  const run = await runKJAgentTask({ session: f.session, prompt: 'Public caller scalar request.',
    toolNames: ['cad_read_geology_source', SCALAR], maxTurns: 3, maxToolCalls: 3, maxRepairAttempts: 1,
    model: { createConversation() { return { async next(input) {
      requests++
      if (requests === 1) return { text: '', calls: [{ id: 'repair-read', name: 'cad_read_geology_source',
        arguments: { expectedRevision: f.document.revision, drawingId: f.drawingId, maxBytes: 262144 } }] }
      if (requests === 2) return { text: '', calls: [{ id: 'repair-invalid', name: SCALAR, arguments: clone(invalidArgs) }] }
      assert.equal(input.results[0].result.ok, false)
      assert.match(input.results[0].result.error.message, /unknown property/)
      return { text: 'Awaiting review.', calls: [{ id: 'repair-new-args', name: SCALAR, arguments: request(f) }] }
    } } } } })
  assert.equal(run.status, 'awaiting-approval'); assert.equal(run.turns, 3); assert.equal(run.toolCalls, 3)
  assert.equal(run.repairAttempts, 1); assert.equal(run.failedToolCalls, 1)
  assert.equal(run.outputs[1].result.ok, false); assert.equal(run.outputs[2].result.ok, true)
  assert.equal(Object.hasOwn(invalidArgs, 'uncorrelatedOccurrences'), true)
  assert.equal(f.document.snapshot(), before)
  value(f.session.reject(run.proposalIds[0], 'scripted-no-provider-host'))
})

for (const provider of ['deepseek', 'qwen', 'kimi', 'doubao'])
  test(provider + ': domestic adapter preserves exact closed scalar schema and raw extra[] rejection, no real provider call', async t => {
    const f = await setup(t), definition = f.session.definitions.find(tool => tool.name === SCALAR), args = request(f)
    args.correlations = []
    let requests = 0
    const adapter = createKJDomesticModelAdapter({ provider, model: provider + '-public-selftest',
      request: async ({ body }) => {
        requests++; assert.deepEqual(body.tools[0].function.parameters, definition.inputSchema)
        return wireAnswer('chat-completions', args)
      } })
    const before = f.document.snapshot()
    const turn = await adapter.createConversation({ instructions: 'Use published native schemas.', tools: [definition] })
      .next({ kind: 'prompt', text: 'Public synthetic wire fixture, not a real provider.' }, new AbortController().signal)
    assert.equal(requests, 1); assert.deepEqual(turn.calls[0].arguments, args)
    const rejected = await f.session.call(turn.calls[0].name, turn.calls[0].arguments)
    assert.equal(rejected.ok, false); assert.match(rejected.error.message, /unknown property/)
    assert.equal(f.document.snapshot(), before); assert.equal(f.sdk.agentPlans.list().length, 0)
  })

test('multiple scalar hole updates are atomic: later invalid depth never changes the first valid water edit', async t => {
  const f = await setup(t), before = f.document.snapshot(), args = request(f)
  args.updates.push({ holeId: 'SCALAR-B', depth: 8 })
  const result = await f.session.call(SCALAR, args)
  assert.equal(result.ok, false); assert.match(result.error.message, /depth|interval|strat/i)
  assert.equal(f.document.snapshot(), before)
  assert.deepEqual(readGeologyDrawingRecipe(f.document, f.drawingId).source, f.source)
  assert.equal(f.sdk.agentPlans.list().length, 0)
})

test('graphics-only DXF cannot supply guessed source facts to the scalar tool', async t => {
  const f = await setup(t), reopenedSdk = createKJDrawSDK(); t.after(() => close(reopenedSdk))
  const imported = await reopenedSdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'DXF' }), { format: 'DXF' })
  const session = new KJAgentToolSession(reopenedSdk, imported, { toolProfile: PROFILE }), before = imported.snapshot()
  assert.equal(Object.hasOwn(before.opaquePayloads, 'geology-drawing-recipe:' + f.drawingId), false)
  const args = request(f); args.expectedRevision = imported.revision
  const result = await session.call(SCALAR, args)
  assert.equal(result.ok, false); assert.equal(result.error.code, 'KJDOCUMENT_INVALID'); assert.match(result.error.message, /source/i)
  assert.equal(imported.snapshot(), before); assert.equal(reopenedSdk.agentPlans.list().length, 0)
})

test('an active scalar proposal cannot be bound or approved as a persisted task', async t => {
  const f = await setup(t), before = f.document.snapshot(), pending = value(await f.session.call(SCALAR, request(f)))
  assert.equal(f.sdk.agentPlans.get(pending.planId).status, 'active')
  assert.throws(() => f.session.bindTaskProposal(pending.planId, {}), /Persistent task approval supports/)
  assert.equal((await f.session.approveTask(pending.planId, 'host', new Date().toISOString())).ok, false)
  assert.equal(f.document.snapshot(), before)
  value(f.session.reject(pending.planId, 'unsupported-task-route'))
})

test('mixed valid/invalid scalar batch preserves actual errors and existing fail-closed rejection of every plan', async t => {
  const f = await setup(t), before = f.document.snapshot(), invalidArgs = request(f)
  invalidArgs.uncorrelatedOccurrences = []
  let requests = 0
  const run = await runKJAgentTask({ session: f.session, prompt: 'Public synthetic scalar caller.',
    toolNames: ['cad_read_geology_source', SCALAR], maxTurns: 3, maxToolCalls: 3, maxRepairAttempts: 1,
    model: { createConversation() { return { async next() {
      requests++
      if (requests === 1) return { text: '', calls: [{ id: 'mixed-source', name: 'cad_read_geology_source',
        arguments: { expectedRevision: f.document.revision, drawingId: f.drawingId, maxBytes: 262144 } }] }
      return { text: 'Host must review the pending valid plan.', calls: [
        { id: 'mixed-invalid', name: SCALAR, arguments: clone(invalidArgs) },
        { id: 'mixed-valid', name: SCALAR, arguments: request(f) },
      ] }
    } } } } })
  assert.equal(requests, 2); assert.equal(run.status, 'failed')
  assert.equal(run.error.code, 'KJAGENT_INCOMPLETE_BATCH')
  assert.equal(run.outputs[1].result.ok, false); assert.equal(run.outputs[2].result.ok, true)
  assert.equal(run.failedToolCalls, 1); assert.equal(run.repairAttempts, 0); assert.equal(run.proposalIds.length, 0)
  assert.equal(f.document.snapshot(), before); assert.deepEqual(invalidArgs.uncorrelatedOccurrences, [])
  const rejectedId = run.outputs[2].result.value.planId
  assert.equal(f.sdk.agentPlans.get(rejectedId).status, 'rejected')
  assert.equal((await f.session.approve(rejectedId, 'must-not-approve-incomplete-batch')).ok, false)
  assert.equal(f.document.snapshot(), before)
})
