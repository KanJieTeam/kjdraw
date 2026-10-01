import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologyColumn, compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { applyGeologyObservationChanges } from '../packages/kjdraw-sdk/src/geology-observation-changes.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const clone = value => structuredClone(value)
const content = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}
const target = record => ({ kind: record.kind, id: record.id, expectedDepth: record.depth })

// Public synthetic source facts, never a private drawing or model response.
function declaredSource(locale = 'zh-CN') {
  const columnStylePack = clone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  columnStylePack.rules['geology-column-layout'].sampleMarkerStyle = { height: 1.2, gap: 0.5, baselineOffset: 0 }
  columnStylePack.rules['geology-column-layout'].fieldGrid = [
    { start: 15, role: 'layerNumber', label: 'Layer', subLabel: 'ID' },
    { start: 25, role: 'layerName', label: 'Layer', subLabel: 'Name' },
    { start: 43, role: 'baseElevation', label: 'Elev.', subLabel: '(m)' },
    { start: 55, role: 'thickness', label: 'Thick.', subLabel: '(m)' },
    { start: 65, role: 'depth', label: 'Depth', subLabel: '(m)' },
    { start: 75, role: 'pattern', label: 'Pattern', subLabel: '1:{verticalScale}' },
    { start: 95, role: 'description', label: 'Description' },
    { start: 130, role: 'sample', label: 'Sample', subLabel: 'ID' },
    { start: 150, role: 'spt', label: 'SPT', subLabel: 'N' },
    { start: 167, role: 'measurement', key: 'density', label: 'Density', subLabel: 'g/cm3', decimals: 2 },
    { start: 181, role: 'measurement', key: 'waterContent', label: 'Water', subLabel: '%', decimals: 1 },
  ]
  return { kind: 'column', input: { expectedRevision: 0, locale, columnStylePack, hole: {
    id: 'PUBLIC-DELTA-A', collarElevation: 106.5, depth: 18,
    strata: [
      { intervalId: 'I-FILL', code: '1', name: 'Fill', top: 0, bottom: 3, lithology: 'fill' },
      { intervalId: 'I-CLAY', code: '2', name: 'Clay', top: 3, bottom: 10, lithology: 'clay' },
      { intervalId: 'I-SAND', code: '3', name: 'Sand', top: 10, bottom: 18, lithology: 'sand' },
    ],
    observations: [
      { kind: 'sample', id: 'S-A', depth: 5, rangeTop: 4.75, rangeBottom: 5.25,
        measurements: { density: 1.81, waterContent: 19.2 } },
      { kind: 'sample', id: 'S-B', depth: 7, rangeTop: 6.8, rangeBottom: 7.2,
        measurements: { density: 1.86, waterContent: 21.4 } },
      { kind: 'spt', id: 'N-A', depth: 12, value: 15 },
    ],
  } } }
}

async function setup(locale = 'zh-CN', mutateSource = () => {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const source = declaredSource(locale)
  mutateSource(source)
  await sdk.executeCommand('CREATEBATCH', clone(compileGeologyColumn(source.input).commandArgs), { document })
  const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
  const layerId = document.getTable('layers').currentId, styleId = document.getTable('textStyles').currentId
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [240, 160, 0], radius: 3, layerId },
    options: { id: 'PUBLIC-DELTA-MANUAL-CIRCLE' } }, { document })
  await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [220, 175, 0], text: 'Independent review note', height: 2, layerId, styleId },
    options: { id: 'PUBLIC-DELTA-MANUAL-NOTE' } }, { document })
  return { sdk, document, source, recipe, session: new KJAgentToolSession(sdk, document),
    manual: ['PUBLIC-DELTA-MANUAL-CIRCLE', 'PUBLIC-DELTA-MANUAL-NOTE'].map(id => clone(document.getObject(id))),
    dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}
function request(fixture, changes = { update: [{ target: target(fixture.source.input.hole.observations[2]), set: { value: 18 } }] }) {
  return { expectedRevision: fixture.document.revision, units: 'millimeter', drawingId: fixture.recipe.drawingId,
    updates: [{ holeId: fixture.source.input.hole.id, observationChanges: changes }] }
}
const observations = fixture => readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source.input.hole.observations
async function approve(fixture, args) {
  const proposal = await fixture.session.call('cad_propose_geology_revision', args)
  assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
  assert.equal((await fixture.session.approve(proposal.value.planId, 'public-delta-reviewer')).ok, true)
  return proposal.value
}

function semanticReferences(value, document) {
  if (Array.isArray(value)) return value.map(item => semanticReferences(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, semanticReferences(item, document)]))
  const referenced = typeof value === 'string' ? document.getObject(value) : null
  if (!referenced) return value
  return referenced.kind === 'entity' ? { entityHandle: referenced.handle } : { resourceType: referenced.type, resourceName: referenced.name }
}
// DXF writer bookkeeping is whitelisted, never blanket geometry normalization.
const hatchTransportCodes = new Set([5, 330, 100, 8, 10, 20, 30, 2, 70, 71, 91, 92, 72, 73, 93, 97, 75, 76, 52, 41, 77, 78, 53, 43, 44, 45, 46, 79, 49])
function geometryByHandle(document) {
  return document.listEntities().map(entity => {
    const payload = clone(entity.payload)
    if (entity.type === 'HATCH') {
      if (payload.rawTags) assert.ok(payload.rawTags.every(tag => hatchTransportCodes.has(tag.code)), 'unexpected transport tag cannot be dropped')
      delete payload.rawTags
      payload.associative ??= false
      payload.boundaryLoops = payload.boundaryLoops.map(loop => ({ ...loop, flags: loop.flags ?? (2 | (loop.external ? 1 : 0)) }))
      payload.patternLines = payload.patternLines?.map(line => ({ ...line,
        angle: Number((((line.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toFixed(12)) }))
    }
    return { handle: entity.handle, type: entity.type, payload: semanticReferences(payload, document) }
  }).sort((a, b) => a.handle.localeCompare(b.handle))
}
const resourcesByName = document => ['layers', 'textStyles', 'linetypes'].map(table => ({ table,
  records: document.getTable(table).records.map(record => ({ type: record.type, name: record.name,
    payload: semanticReferences(record.payload, document) })).sort((a, b) => a.name.localeCompare(b.name)),
}))

test('delta is additive, bounded, closed, frozen and has no model-dependent schema unions', () => {
  const tool = KJDRAW_AGENT_TOOLS.find(item => item.name === 'cad_propose_geology_revision')
  const hole = tool.inputSchema.properties.updates.items
  assert.ok(!hole.required.includes('observationChanges'))
  const changes = hole.properties.observationChanges
  assert.ok(Object.isFrozen(changes))
  assert.deepEqual(changes.required, [])
  assert.equal(changes.additionalProperties, false)
  for (const name of ['add', 'update', 'remove']) {
    assert.equal(changes.properties[name].minItems, 1)
    assert.equal(changes.properties[name].maxItems, 256)
  }
  assert.deepEqual(changes.properties.update.items.properties.target.required, ['kind', 'id', 'expectedDepth'])
  assert.deepEqual(Object.keys(changes.properties.update.items.properties.set.properties), ['depth', 'value', 'displayLabel', 'sampleMarker', 'rangeTop', 'rangeBottom'])
  assert.deepEqual(changes.properties.update.items.properties.clearFields.items.enum, ['displayLabel', 'sampleMarker', 'rangeTop', 'rangeBottom'])
  assert.ok(changes.properties.add.items.properties.measurements)
  assert.doesNotMatch(JSON.stringify(changes), /"anyOf"|"oneOf"/)
  assert.match(hole.properties.observations.description, /complete-array replacement.*not a patch/i)
  assert.match(hole.properties.strata.description, /complete-array replacement.*not a patch/i)
})

for (const locale of ['zh-CN', 'en']) test(`${locale}: exact delta → native approval → replay rejection → reviewed undo/redo → full KJD/DXF closure`, async () => {
  const fixture = await setup(locale)
  try {
    const { sdk, document, recipe, source, session, manual } = fixture
    const read = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId: recipe.drawingId, maxBytes: 262144 })
    assert.equal(read.ok, true, JSON.stringify(read.error))
    assert.equal(read.value.sourceUnits, 'meter')
    assert.deepEqual(read.value.facts.hole.observations, source.input.hole.observations)
    const original = document.snapshot(), before = content(document), hatches = clone(document.listEntities({ type: 'HATCH' }))
    const changes = { update: [
      { target: target(source.input.hole.observations[0]), set: { depth: 5.25, rangeTop: 5, rangeBottom: 5.5, displayLabel: 'S-REV', sampleMarker: 'open-circle' } },
      { target: target(source.input.hole.observations[2]), set: { value: 18 } },
    ], remove: [target(source.input.hole.observations[1])], add: [
      { kind: 'sample', id: 'S-C', depth: 9.5, rangeTop: 9.4, rangeBottom: 9.6, measurements: { density: 1.95, waterContent: 24.1 } },
    ] }
    const expectedSource = clone(source)
    expectedSource.input.hole.observations = [
      { ...clone(source.input.hole.observations[0]), ...changes.update[0].set },
      { ...clone(source.input.hole.observations[2]), value: 18 }, clone(changes.add[0]),
    ]
    const args = request(fixture, changes)
    const pending = await session.call('cad_propose_geology_revision', args)
    assert.equal(pending.ok, true, JSON.stringify(pending.error))
    assert.equal(pending.value.status, 'awaiting-host-approval')
    assert.deepEqual(document.snapshot(), original, 'preview cannot change source/CAD/revision/history')
    assert.deepEqual(pending.value.engineeringEvidence.afterSource.facts.hole.observations, expectedSource.input.hole.observations)
    const retained = pending.value.unchangedIds.map(id => clone(document.getObject(id)))
    // Caller mutation after proposing is isolated from the approved snapshot.
    changes.update[0].set.depth = 100
    changes.add[0].measurements.density = 99
    changes.remove.length = 0
    assert.equal((await session.approve(pending.value.planId, 'public-delta-reviewer')).ok, true)
    assert.equal(document.revision, original.revision + 1)
    assert.deepEqual(readGeologyDrawingRecipe(document, recipe.drawingId).source, expectedSource)
    assert.deepEqual(document.listEntities({ type: 'HATCH' }), hatches)
    for (const entity of [...manual, ...retained]) assert.deepEqual(document.getObject(entity.id), entity)
    const texts = document.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
    for (const text of ['S-REV', 'S-C', 'N=18', '1.81', '19.2', '1.95', '24.1', '5.00–5.50', '9.40–9.60']) assert.ok(texts.includes(text), text)
    assert.ok(!texts.includes('S-B'))
    const after = content(document)
    assert.equal((await session.approve(pending.value.planId, 'public-delta-reviewer')).ok, false)
    assert.deepEqual(content(document), after)
    for (const [action, expected] of [['undo', before], ['redo', after]]) {
      const history = await session.call('cad_read_history', { expectedRevision: document.revision })
      assert.equal(history.ok, true, JSON.stringify(history.error))
      const proposal = await session.call(`cad_propose_${action}`, { expectedRevision: document.revision, units: 'millimeter', targetHistoryId: history.value.history[`${action}Target`].id })
      assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
      assert.equal((await session.approve(proposal.value.planId, 'public-delta-reviewer')).ok, true)
      assert.deepEqual(content(document), expected)
    }
    const recovered = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
    assert.equal(canonicalStringify(recovered.snapshot()), canonicalStringify(document.snapshot()))
    assert.deepEqual(readGeologyDrawingRecipe(recovered, recipe.drawingId).source, expectedSource)
    const exchangeSDK = createKJDrawSDK()
    try {
      const dxf = await exchangeSDK.readDocument(await sdk.writeDocument(recovered, { format: 'DXF' }), { format: 'DXF' })
      assert.equal(dxf.validate().valid, true)
      assert.equal(canonicalStringify(geometryByHandle(dxf)), canonicalStringify(geometryByHandle(recovered)), 'every entity payload/handle/coordinate/HATCH survives DXF')
      assert.equal(canonicalStringify(resourcesByName(dxf)), canonicalStringify(resourcesByName(recovered)), 'all named resources survive DXF')
      assert.throws(() => readGeologyDrawingRecipe(dxf, recipe.drawingId), /recipe|source|drawing/i, 'DXF is geometry, not a retained source-recipe promise')
    } finally { for (const id of [...exchangeSDK.documents.keys()]) exchangeSDK.closeDocument(id) }
  } finally { fixture.dispose() }
})

test('single SPT patch preserves all untouched samples, range endpoints and laboratory fields exactly', async () => {
  const fixture = await setup()
  try {
    await approve(fixture, request(fixture))
    const expected = clone(fixture.source.input.hole.observations)
    expected[2].value = 18
    assert.deepEqual(observations(fixture), expected)
  } finally { fixture.dispose() }
})

test('same IDs at different depths and kinds are selected by the exact triple, not collapsed or guessed', async () => {
  const fixture = await setup('en', source => { for (const record of source.input.hole.observations) record.id = 'SHARED' })
  try {
    const before = clone(fixture.source.input.hole.observations)
    await approve(fixture, request(fixture, { update: [
      { target: target(before[1]), set: { sampleMarker: 'open-circle' } },
      { target: target(before[2]), set: { value: 22 } },
    ] }))
    assert.deepEqual(observations(fixture), [before[0], { ...before[1], sampleMarker: 'open-circle' }, { ...before[2], value: 22 }])
  } finally { fixture.dispose() }
})

test('record clearFields withdraws only requested optional facts and preserves laboratory measurements', async () => {
  const fixture = await setup('en', source => { Object.assign(source.input.hole.observations[0], { displayLabel: 'S-CUSTOM', sampleMarker: 'open-circle' }) })
  try {
    await approve(fixture, request(fixture, { update: [{ target: target(fixture.source.input.hole.observations[0]), clearFields: ['displayLabel', 'sampleMarker', 'rangeTop', 'rangeBottom'] }] }))
    const expected = clone(fixture.source.input.hole.observations)
    for (const key of ['displayLabel', 'sampleMarker', 'rangeTop', 'rangeBottom']) delete expected[0][key]
    assert.deepEqual(observations(fixture), expected)
  } finally { fixture.dispose() }
})

test('removing the last known observation keeps confirmed empty [], while old replacement/unknown semantics remain unchanged', async () => {
  const fixture = await setup('en', source => { source.input.hole.observations = [source.input.hole.observations[2]] })
  try {
    await approve(fixture, request(fixture, { remove: [target(fixture.source.input.hole.observations[0])] }))
    assert.deepEqual(observations(fixture), [])
    assert.ok(Object.hasOwn(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source.input.hole, 'observations'))
    await fixture.document.undo()
    const oldArrayRequest = request(fixture, {})
    delete oldArrayRequest.updates[0].observationChanges
    oldArrayRequest.updates[0].clearFields = ['observations']
    await approve(fixture, oldArrayRequest)
    assert.equal(Object.hasOwn(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source.input.hole, 'observations'), false)
  } finally { fixture.dispose() }
})

test('legacy observations array still replaces in full; it is never silently merged as a patch', async () => {
  const fixture = await setup()
  try {
    const args = request(fixture), kept = { ...clone(fixture.source.input.hole.observations[2]), value: 18 }
    delete args.updates[0].observationChanges
    args.updates[0].observations = [kept]
    await approve(fixture, args)
    assert.deepEqual(observations(fixture), [kept])
  } finally { fixture.dispose() }
})

test('explicit addition can establish a previously unknown list without inventing other observations', async () => {
  const fixture = await setup('en', source => { delete source.input.hole.observations })
  try {
    const added = { kind: 'spt', id: 'NEW-N', depth: 12, value: 17 }
    await approve(fixture, request(fixture, { add: [added] }))
    assert.deepEqual(observations(fixture), [added])
  } finally { fixture.dispose() }
})

test('same-before target resolution refuses future-depth lookup and an ambiguous original triple', () => {
  const before = [{ kind: 'sample', id: 'A', depth: 5, measurements: { density: 1.8 } }]
  const original = clone(before)
  assert.throws(() => applyGeologyObservationChanges(before, { update: [
    { target: target(before[0]), set: { depth: 6 } },
    { target: { kind: 'sample', id: 'A', expectedDepth: 6 }, set: { displayLabel: 'B' } },
  ] }), /exactly one existing/)
  assert.throws(() => applyGeologyObservationChanges([...before, clone(before[0])], { remove: [target(before[0])] }), /exactly one existing/)
  assert.deepEqual(before, original)
})

test('a new record may share an ID at a different depth; removing it leaves the original and its laboratory map exact', async () => {
  const fixture = await setup('en')
  try {
    const before = clone(fixture.source.input.hole.observations)
    const added = { kind: 'sample', id: 'S-A', depth: 9.5, rangeTop: 9.4, rangeBottom: 9.6, measurements: { density: 1.95 } }
    await approve(fixture, request(fixture, { add: [added] }))
    assert.deepEqual(observations(fixture), [...before, added])
    await approve(fixture, request(fixture, { remove: [target(added)] }))
    assert.deepEqual(observations(fixture), before)
  } finally { fixture.dispose() }
})

for (const operation of ['update', 'remove']) test(`${operation} cannot fabricate a record in an unknown observations list`, async () => {
  const fixture = await setup('en', source => { delete source.input.hole.observations })
  try {
    const identity = { kind: 'spt', id: 'UNKNOWN', expectedDepth: 12 }
    const changes = operation === 'update' ? { update: [{ target: identity, set: { value: 18 } }] } : { remove: [identity] }
    const before = fixture.document.snapshot()
    assert.equal((await fixture.session.call('cad_propose_geology_revision', request(fixture, changes))).ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.equal(Object.hasOwn(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source.input.hole, 'observations'), false)
  } finally { fixture.dispose() }
})

test('source-only optional withdrawal that does not change visible output still rejects, rather than claiming a drawing revision', async () => {
  const fixture = await setup('en', source => { source.input.hole.observations[0].displayLabel = 'S-A' })
  try {
    const before = fixture.document.snapshot()
    const response = await fixture.session.call('cad_propose_geology_revision', request(fixture, {
      update: [{ target: target(fixture.source.input.hole.observations[0]), clearFields: ['displayLabel'] }],
    }))
    assert.equal(response.ok, false)
    assert.match(response.error.message, /source change does not alter supported drawing output/)
    assert.deepEqual(fixture.document.snapshot(), before)
  } finally { fixture.dispose() }
})

test('all delta identities are read before the edit; an earlier depth update never makes a later future target valid', async () => {
  const fixture = await setup('en')
  try {
    const before = fixture.document.snapshot()
    const changes = { update: [
      { target: target(fixture.source.input.hole.observations[0]), set: { depth: 5.1 } },
      { target: { kind: 'sample', id: 'S-A', expectedDepth: 5.1 }, set: { displayLabel: 'REVISED' } },
    ] }
    const response = await fixture.session.call('cad_propose_geology_revision', request(fixture, changes))
    assert.equal(response.ok, false)
    assert.match(response.error.message, /exactly one existing record/)
    assert.deepEqual(fixture.document.snapshot(), before)
  } finally { fixture.dispose() }
})

const invalidCases = [
  ['empty operation object', (_args, changes) => { delete changes.update }],
  ['empty update array', (_args, changes) => { changes.update = [] }],
  ['empty add array', (_args, changes) => { changes.add = [] }],
  ['empty remove array', (_args, changes) => { changes.remove = [] }],
  ['null changes', args => { args.updates[0].observationChanges = null }],
  ['unknown changes key', (_args, changes) => { changes.upsert = [] }],
  ['null set', (_args, changes) => { changes.update[0].set = null }],
  ['empty update set', (_args, changes) => { changes.update[0].set = {} }],
  ['missing update set/clear', (_args, changes) => { delete changes.update[0].set }],
  ['unchanged explicit value', (_args, changes) => { changes.update[0].set.value = 15 }],
  ['clearing an absent optional fact is no-op', (_args, changes) => { delete changes.update[0].set; changes.update[0].clearFields = ['displayLabel'] }],
  ['missing target', (_args, changes) => { delete changes.update[0].target }],
  ['missing target depth', (_args, changes) => { delete changes.update[0].target.expectedDepth }],
  ['missing target kind', (_args, changes) => { delete changes.update[0].target.kind }],
  ['missing target id', (_args, changes) => { delete changes.update[0].target.id }],
  ['wrong target depth', (_args, changes) => { changes.update[0].target.expectedDepth = 12.01 }],
  ['negative expected depth', (_args, changes) => { changes.update[0].target.expectedDepth = -1 }],
  ['unknown observation id', (_args, changes) => { changes.update[0].target.id = 'UNKNOWN' }],
  ['null target cannot mean auto-select', (_args, changes) => { changes.update[0].target = null }],
  ['negative-depth addition', (_args, changes) => { changes.add = [{ kind: 'spt', id: 'NEW', depth: -1, value: 20 }] }],
  ['below-bottom addition', (_args, changes) => { changes.add = [{ kind: 'spt', id: 'NEW', depth: 19, value: 20 }] }],
  ['removal missing depth identity', (_args, changes) => { changes.remove = [{ kind: 'sample', id: 'S-A' }] }],
  ['empty clear array', (_args, changes) => { changes.update[0].clearFields = [] }],
  ['null clear array', (_args, changes) => { changes.update[0].clearFields = null }],
  ['wrong observation kind', (_args, changes) => { changes.update[0].target.kind = 'sample' }],
  ['fuzzy identity is forbidden', (_args, changes) => { changes.update[0].target.id = 'N-*' }],
  ['unexpected target field', (_args, changes) => { changes.update[0].target.depth = 12 }],
  ['identity cannot be set', (_args, changes) => { changes.update[0].set.id = 'B' }],
  ['kind cannot be set', (_args, changes) => { changes.update[0].set.kind = 'sample' }],
  ['laboratory-map patch not invented', (_args, changes) => { changes.update[0].set.measurements = { density: 1.9 } }],
  ['required value cannot be cleared', (_args, changes) => { changes.update[0].clearFields = ['value'] }],
  ['depth cannot be cleared', (_args, changes) => { changes.update[0].clearFields = ['depth'] }],
  ['laboratory facts cannot be cleared', (_args, changes) => { changes.update[0].clearFields = ['measurements'] }],
  ['set and clear same field', (_args, changes) => { changes.update[0].set.displayLabel = 'NEW'; changes.update[0].clearFields = ['displayLabel'] }],
  ['duplicate clear field', (_args, changes) => { changes.update[0].clearFields = ['displayLabel', 'displayLabel'] }],
  ['duplicate original target', (_args, changes) => { changes.update.push(clone(changes.update[0])) }],
  ['remove and re-add same original identity is not an implicit replacement', (_args, changes, fixture) => {
    changes.remove = [target(fixture.source.input.hole.observations[0])]
    changes.add = [{ ...clone(fixture.source.input.hole.observations[0]), displayLabel: 'REPLACEMENT' }]
  }],
  ['update/remove same original target', (_args, changes) => { changes.remove = [clone(changes.update[0].target)] }],
  ['duplicate removals', (_args, changes, fixture) => { changes.remove = [target(fixture.source.input.hole.observations[0]), target(fixture.source.input.hole.observations[0])] }],
  ['full replacement mixed with delta', (args, _changes, fixture) => { args.updates[0].observations = clone(fixture.source.input.hole.observations) }],
  ['unknown clearing mixed with delta', args => { args.updates[0].clearFields = ['observations'] }],
  ['duplicate existing addition', (_args, changes, fixture) => { changes.add = [clone(fixture.source.input.hole.observations[0])] }],
  ['addition reuses touched identity', (_args, changes, fixture) => { changes.add = [clone(fixture.source.input.hole.observations[2])] }],
  ['duplicate new additions', (_args, changes) => { const record = { kind: 'spt', id: 'NEW', depth: 15, value: 20 }; changes.add = [record, clone(record)] }],
  ['add SPT without required measured value', (_args, changes) => { changes.add = [{ kind: 'spt', id: 'NEW', depth: 15 }] }],
  ['add laboratory units object is not a number', (_args, changes) => { changes.add = [{ kind: 'sample', id: 'NEW', depth: 15, measurements: { density: { value: 1.9, unit: 'g/cm3' } } }] }],
  ['sample laboratory data on SPT', (_args, changes) => { changes.add = [{ kind: 'spt', id: 'NEW', depth: 15, value: 20, measurements: { density: 1.9 } }] }],
  ['unknown CAD units', args => { args.units = 'meter' }],
  ['missing CAD units', args => { delete args.units }],
  ['stale revision', args => { args.expectedRevision-- }],
  ['unknown hole', args => { args.updates[0].holeId = 'UNKNOWN' }],
  ['duplicate hole update', args => { args.updates.push(clone(args.updates[0])) }],
  ['negative SPT value', (_args, changes) => { changes.update[0].set.value = -1 }],
  ['NaN SPT value', (_args, changes) => { changes.update[0].set.value = NaN }],
  ['Infinity SPT value', (_args, changes) => { changes.update[0].set.value = Infinity }],
  ['null SPT value cannot clear', (_args, changes) => { changes.update[0].set.value = null }],
  ['negative depth', (_args, changes) => { changes.update[0].set.depth = -1 }],
  ['depth beyond hole bottom', (_args, changes) => { changes.update[0].set.depth = 18.1 }],
  ['sample-only marker on SPT', (_args, changes) => { changes.update[0].set.sampleMarker = 'open-circle' }],
  ['sample-only range on SPT', (_args, changes) => { Object.assign(changes.update[0].set, { rangeTop: 11.5, rangeBottom: 12.5 }) }],
  ['sparse update array', (_args, changes) => { delete changes.update[0] }],
  ['extra update array property', (_args, changes) => { changes.update.extra = true }],
  ['symbol update property', (_args, changes) => { changes.update[0][Symbol('secret')] = true }],
  ['hidden update property', (_args, changes) => { Object.defineProperty(changes.update[0], 'secret', { value: true }) }],
  ['non-plain target prototype', (_args, changes) => { changes.update[0].target = Object.assign(Object.create({ inherited: true }), changes.update[0].target) }],
  ['more than 256 combined operations', (_args, changes) => { changes.add = Array.from({ length: 256 }, (_, i) => ({ kind: 'spt', id: `N${i}`, depth: 15, value: 20 })) }],
]
for (const [label, mutate] of invalidCases) test(`${label}: fail closed without changing source, CAD or history`, async () => {
  const fixture = await setup()
  try {
    const args = request(fixture), changes = args.updates[0].observationChanges
    mutate(args, changes, fixture)
    const before = fixture.document.snapshot(), history = clone(fixture.document.history)
    const response = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(response.ok, false, label)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.document.history, history)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source, fixture.source)
  } finally { fixture.dispose() }
})

const invalidSampleCases = [
  ['depth outside unchanged range', operation => { operation.set = { depth: 6 } }],
  ['clearing only rangeTop', operation => { delete operation.set; operation.clearFields = ['rangeTop'] }],
  ['clearing only rangeBottom', operation => { delete operation.set; operation.clearFields = ['rangeBottom'] }],
  ['reversed range', operation => { operation.set = { rangeTop: 5.5, rangeBottom: 5 } }],
  ['negative range endpoint', operation => { operation.set = { rangeTop: -1 } }],
  ['overlong range', operation => { operation.set = { rangeTop: 0, rangeBottom: 6 } }],
  ['overlap with untouched sample', operation => { operation.set = { rangeTop: 4.75, rangeBottom: 7.1 } }],
  ['range beyond hole bottom', operation => { operation.set = { rangeBottom: 19 } }],
  ['range not containing point', operation => { operation.set = { rangeTop: 5.5, rangeBottom: 5.75 } }],
  ['null sample range cannot clear', operation => { operation.set = { rangeTop: null } }],
  ['final same-kind/id/depth collision', operation => {
    operation.set = { depth: 7, rangeTop: 6.8, rangeBottom: 7.2 }
  }],
]
for (const [label, mutate] of invalidSampleCases) test(`${label}: compiler still enforces final sample invariants`, async () => {
  // The collision fixture is created with the duplicate ID at a DIFFERENT
  // depth, legal in the existing native identity contract.
  const fixture = await setup('en', source => { if (label.startsWith('final ')) source.input.hole.observations[1].id = 'S-A' })
  try {
    const operation = { target: target(fixture.source.input.hole.observations[0]), set: { displayLabel: 'CHANGED' } }
    mutate(operation, fixture)
    const before = fixture.document.snapshot()
    assert.equal((await fixture.session.call('cad_propose_geology_revision', request(fixture, { update: [operation] }))).ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source, fixture.source)
  } finally { fixture.dispose() }
})

test('nested accessors reject before invocation and before any native edits', async () => {
  const fixture = await setup()
  try {
    const args = request(fixture), set = args.updates[0].observationChanges.update[0].set
    let reads = 0
    Object.defineProperty(set, 'value', { enumerable: true, get() { reads++; return 18 } })
    const before = fixture.document.snapshot()
    assert.equal((await fixture.session.call('cad_propose_geology_revision', args)).ok, false)
    assert.equal(reads, 0)
    assert.deepEqual(fixture.document.snapshot(), before)
  } finally { fixture.dispose() }
})

test('pending delta binds original revision; later unrelated edit blocks approval without partial source changes', async () => {
  const fixture = await setup()
  try {
    const pending = await fixture.session.call('cad_propose_geology_revision', request(fixture))
    assert.equal(pending.ok, true, JSON.stringify(pending.error))
    await fixture.sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [260, 160, 0], radius: 2 } }, { document: fixture.document })
    const before = fixture.document.snapshot()
    assert.equal((await fixture.session.approve(pending.value.planId, 'public-delta-reviewer')).ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source, fixture.source)
  } finally { fixture.dispose() }
})

for (const layerPatch of [{ locked: true }, { frozen: true }, { visible: false }]) test(`protected generated layer ${JSON.stringify(layerPatch)} rejects delta before proposal`, async () => {
  const fixture = await setup()
  try {
    const generatedText = fixture.document.listEntities({ type: 'TEXT' }).find(entity => entity.payload.text === 'N=15')
    await fixture.sdk.executeCommand('LAYERUPDATE', { id: generatedText.payload.layerId, patch: layerPatch }, { document: fixture.document })
    const before = fixture.document.snapshot()
    const result = await fixture.session.call('cad_propose_geology_revision', request(fixture))
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'KJDOCUMENT_INVALID')
    assert.match(result.error.message, /generated resource changed:/i, 'recipe validation rejects the changed protective layer before preparing any edit')
    for (const [key, value] of Object.entries(layerPatch)) assert.equal(fixture.document.getObject(generatedText.payload.layerId).payload[key], value)
    assert.deepEqual(fixture.document.snapshot(), before)
  } finally { fixture.dispose() }
})

test('manual drift of generated source content is not hidden by a small observation patch', async () => {
  const fixture = await setup()
  try {
    const generatedText = fixture.document.listEntities({ type: 'TEXT' }).find(entity => entity.payload.text === 'N=15')
    await fixture.sdk.executeCommand('TEXTEDIT', { changes: [{ id: generatedText.id, expectedText: 'N=15', text: 'Manual drift' }] }, { document: fixture.document })
    const before = fixture.document.snapshot()
    const result = await fixture.session.call('cad_propose_geology_revision', request(fixture))
    assert.equal(result.ok, false)
    assert.match(result.error.message, /generated object changed:.*reconcile manual edits/i)
    assert.deepEqual(fixture.document.snapshot(), before)
  } finally { fixture.dispose() }
})

test('same observation identity in multiple section holes remains scoped to the exact holeId', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  try {
    const template = declaredSource('en').input.hole
    const holes = ['PUBLIC-A', 'PUBLIC-B'].map((id, i) => ({ ...clone(template), id, station: i * 16,
      strata: template.strata.map(layer => ({ ...clone(layer), intervalId: `${id}-${layer.intervalId}` })) }))
    const correlations = holes[0].strata.map((layer, i) => ({ fromHoleId: holes[0].id, toHoleId: holes[1].id,
      fromIntervalId: layer.intervalId, toIntervalId: holes[1].strata[i].intervalId }))
    const source = { kind: 'section', input: { expectedRevision: 0, locale: 'en', holes, correlations, uncorrelatedOccurrences: [], sourceFactMode: 'complete-occurrence-map',
      horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 84, surfaceRule: 'straight-between-supplied-collars' } }
    await sdk.executeCommand('CREATEBATCH', clone(compileGeologySection(source.input).commandArgs), { document })
    const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
    const session = new KJAgentToolSession(sdk, document), beforeHatches = clone(document.listEntities({ type: 'HATCH' }))
    const result = await session.call('cad_propose_geology_revision', { expectedRevision: document.revision, units: 'millimeter', drawingId: recipe.drawingId,
      updates: [{ holeId: 'PUBLIC-B', observationChanges: { update: [{ target: target(holes[1].observations[2]), set: { value: 22 } }] } }] })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    assert.equal((await session.approve(result.value.planId, 'public-delta-reviewer')).ok, true)
    const expected = clone(source)
    expected.input.holes[1].observations[2].value = 22
    assert.deepEqual(readGeologyDrawingRecipe(document, recipe.drawingId).source, expected)
    assert.deepEqual(document.listEntities({ type: 'HATCH' }), beforeHatches)
    const beforeInvalid = document.snapshot(), currentRevision = document.revision
    const rejected = await session.call('cad_propose_geology_revision', { expectedRevision: currentRevision, units: 'millimeter', drawingId: recipe.drawingId,
      updates: [
        { holeId: 'PUBLIC-A', observationChanges: { update: [{ target: target(holes[0].observations[2]), set: { value: 19 } }] } },
        { holeId: 'PUBLIC-B', observationChanges: { remove: [{ kind: 'sample', id: 'UNKNOWN', expectedDepth: 5 }] } },
      ] })
    assert.equal(rejected.ok, false, 'valid first hole plus invalid second hole must not produce partial changes')
    assert.deepEqual(document.snapshot(), beforeInvalid)
    assert.deepEqual(readGeologyDrawingRecipe(document, recipe.drawingId).source, expected)
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})
