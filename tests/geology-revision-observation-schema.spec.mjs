import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologyColumn } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'

const clone = value => structuredClone(value)
const revisionTool = () => KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_geology_revision')
const stateContent = document => {
  const snapshot = document.snapshot()
  return { objects: snapshot.objects, tables: snapshot.tables, spaces: snapshot.spaces, opaquePayloads: snapshot.opaquePayloads }
}

// Entirely public, caller-declared numerical facts and a synthetic field grid
// derived from the bundled Apache-2.0 pack. No private drawing or model calls.
function declaredSource(locale = 'zh-CN') {
  const columnStylePack = clone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
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
    id: 'PUBLIC-OBS-A', collarElevation: 106.5, depth: 18,
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

async function setup(locale) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const source = declaredSource(locale), compilation = compileGeologyColumn(source.input)
  await sdk.executeCommand('CREATEBATCH', clone(compilation.commandArgs), { document })
  const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [240, 160, 0], radius: 3 }, options: { id: 'PUBLIC-MANUAL-CIRCLE' } }, { document })
  await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [220, 175, 0], text: 'Independent review note', height: 2 }, options: { id: 'PUBLIC-MANUAL-NOTE' } }, { document })
  const manual = document.listEntities().filter(entity => !recipe.entityIds.includes(entity.id)).map(clone)
  const session = new KJAgentToolSession(sdk, document)
  return { sdk, document, source, recipe, manual, session,
    dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}

function request(fixture, observations = clone(fixture.source.input.hole.observations)) {
  return { expectedRevision: fixture.document.revision, units: 'millimeter', drawingId: fixture.recipe.drawingId,
    updates: [{ holeId: fixture.source.input.hole.id, observations }] }
}

function changedObservation(fixture) {
  const observations = clone(fixture.source.input.hole.observations)
  Object.assign(observations[0], { depth: 5.25, rangeTop: 5, rangeBottom: 5.5,
    measurements: { density: 1.92, waterContent: 23.6 } })
  return observations
}

test('revision exposes the existing core observation range and bounded numerical dictionary without changing creation schemas', () => {
  const observation = revisionTool().inputSchema.properties.updates.items.properties.observations.items
  for (const name of ['rangeTop', 'rangeBottom', 'measurements']) {
    assert.ok(Object.hasOwn(observation.properties, name), name)
    assert.ok(!observation.required.includes(name), `${name} must remain optional for existing callers`)
  }
  assert.equal(observation.properties.rangeTop.minimum, 0)
  assert.equal(observation.properties.rangeBottom.minimum, 0)
  assert.equal(observation.properties.measurements.type, 'object')
  assert.equal(observation.properties.measurements.maxProperties, 16)
  assert.equal(observation.properties.measurements.additionalProperties.type, 'number')
  assert.equal(observation.properties.measurements.additionalProperties.minimum, -1e6)
  assert.equal(observation.properties.measurements.additionalProperties.maximum, 1e6)
  for (const name of ['cad_propose_geology_column', 'cad_propose_geology_section']) {
    const properties = KJDRAW_AGENT_TOOLS.find(tool => tool.name === name).inputSchema.properties
    const hole = name.endsWith('column') ? properties.hole : properties.holes.items
    for (const field of ['rangeTop', 'rangeBottom', 'measurements']) assert.equal(Object.hasOwn(hole.properties.observations.items.properties, field), false)
  }
})

for (const locale of ['zh-CN', 'en']) test(`${locale}: reviewed range/laboratory update regenerates exact text, preserves source identity and can undo, redo and reopen`, async () => {
  const fixture = await setup(locale)
  try {
    const { sdk, document, source, recipe, manual, session } = fixture
    const original = document.snapshot(), beforeContent = stateContent(document)
    const hatchBefore = document.listEntities({ type: 'HATCH' }).map(clone)
    const observations = changedObservation(fixture), args = request(fixture, observations)
    const response = await session.call('cad_propose_geology_revision', args)
    assert.equal(response.ok, true, JSON.stringify(response.error))
    assert.equal(response.value.status, 'awaiting-host-approval')
    assert.deepEqual(document.snapshot(), original, 'native preview cannot modify source, CAD content or revision')
    assert.deepEqual(response.value.engineeringEvidence.afterSource.facts.hole.observations, observations)
    assert.deepEqual(response.value.engineeringEvidence.beforeSource.facts.hole.observations, source.input.hole.observations)
    assert.deepEqual(response.value.engineeringEvidence.afterSource.facts.hole.strata, source.input.hole.strata)
    const retained = response.value.unchangedIds.map(id => clone(document.getObject(id)))
    // Input mutation after proposal cannot change what a human approved.
    args.updates[0].observations[0].measurements.density = 99
    const approved = await session.approve(response.value.planId, 'public-test-reviewer')
    assert.equal(approved.ok, true, JSON.stringify(approved.error))
    assert.equal(document.revision, original.revision + 1, 'source and generated geometry commit in one transaction')
    const actualSource = readGeologyDrawingRecipe(document, recipe.drawingId).source
    const expectedSource = clone(source)
    expectedSource.input.hole.observations = changedObservation(fixture)
    assert.deepEqual(actualSource, expectedSource, 'no measurements, IDs, strata or units may be guessed')
    for (const entity of [...manual, ...retained]) assert.deepEqual(document.getObject(entity.id), entity)
    assert.deepEqual(document.listEntities({ type: 'HATCH' }), hatchBefore, 'laboratory edits must not change lithology fill')
    const texts = document.listEntities({ type: 'TEXT' })
    for (const text of ['1.92', '23.6', '1.86', '21.4', 'S-A', 'S-B', 'N=15', '5.00–5.50']) assert.ok(texts.some(entity => entity.payload.text === text), text)
    for (const [text, x] of [['1.92', 174], ['23.6', 188]]) {
      const entity = texts.find(entity => entity.payload.text === text)
      assert.equal(entity.payload.position[0], x, 'measurement stays in the caller-declared field lane')
    }
    const afterContent = stateContent(document)
    assert.equal((await session.approve(response.value.planId, 'public-test-reviewer')).ok, false, 'a consumed approval cannot replay')
    assert.deepEqual(stateContent(document), afterContent)
    await document.undo()
    assert.deepEqual(stateContent(document), beforeContent, 'undo restores complete source and CAD together')
    await document.redo()
    assert.deepEqual(stateContent(document), afterContent, 'redo restores the approved facts and exact object identities')
    const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
    assert.deepEqual(JSON.parse(JSON.stringify(stateContent(reopened))), JSON.parse(JSON.stringify(afterContent)),
      'all serializable content is exact; JSON has no representation for undefined optional properties')
    assert.deepEqual(readGeologyDrawingRecipe(reopened, recipe.drawingId).source, expectedSource)
    const dxf = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
    assert.equal(dxf.validate().valid, true)
    assert.equal(dxf.listEntities().length, document.listEntities().length)
    assert.deepEqual(dxf.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text).sort(), texts.map(entity => entity.payload.text).sort())
    assert.equal(dxf.listEntities({ type: 'HATCH' }).length, hatchBefore.length)
    assert.throws(() => readGeologyDrawingRecipe(dxf, recipe.drawingId), /recipe|source|drawing/i,
      'DXF is geometry exchange, not a promise to preserve source observations or UUIDs')
  } finally { fixture.dispose() }
})

const invalidCases = [
  ['negative point depth', (_args, observations) => { observations[0].depth = -0.1 }],
  ['point below hole bottom', (_args, observations) => { observations[0].depth = 18.1 }],
  ['negative range top', (_args, observations) => { observations[0].rangeTop = -0.1 }],
  ['negative range bottom', (_args, observations) => { observations[0].rangeBottom = -0.1 }],
  ['range below hole bottom', (_args, observations) => { observations[0].rangeBottom = 18.1 }],
  ['reversed range', (_args, observations) => { observations[0].rangeTop = 5.5; observations[0].rangeBottom = 5 }],
  ['zero range thickness', (_args, observations) => { observations[0].rangeBottom = observations[0].rangeTop }],
  ['overlong sample range', (_args, observations) => { observations[0].rangeTop = 0; observations[0].rangeBottom = 6 }],
  ['point outside supplied range', (_args, observations) => { observations[0].rangeTop = 5.5; observations[0].rangeBottom = 5.7 }],
  ['missing range top', (_args, observations) => { delete observations[0].rangeTop }],
  ['missing range bottom', (_args, observations) => { delete observations[0].rangeBottom }],
  ['overlapping sampled ranges', (_args, observations) => { observations[1].rangeTop = 5.1; observations[1].rangeBottom = 7.2 }],
  ['sample-only range on SPT', (_args, observations) => { observations[2].rangeTop = 11.8; observations[2].rangeBottom = 12.2 }],
  ['sample-only laboratory map on SPT', (_args, observations) => { observations[2].measurements = { density: 1.9 } }],
  ['SPT missing measured value', (_args, observations) => { delete observations[2].value }],
  ['SPT null measured value', (_args, observations) => { observations[2].value = null }],
  ['laboratory value missing', (_args, observations) => { observations[0].measurements.density = undefined }],
  ['laboratory value null', (_args, observations) => { observations[0].measurements.density = null }],
  ['laboratory value NaN', (_args, observations) => { observations[0].measurements.density = NaN }],
  ['laboratory value Infinity', (_args, observations) => { observations[0].measurements.density = Infinity }],
  ['laboratory value out of core bound', (_args, observations) => { observations[0].measurements.density = 1000001 }],
  ['laboratory string not a number', (_args, observations) => { observations[0].measurements.density = '1.92' }],
  ['undeclared nested laboratory unit object', (_args, observations) => { observations[0].measurements.density = { value: 1.92, unit: 'g/cm3' } }],
  ['too many laboratory fields', (_args, observations) => { observations[0].measurements = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`v${index}`, index])) }],
  ['unsafe laboratory field name', (_args, observations) => { observations[0].measurements['density-raw'] = 1.9 }],
  ['overlong laboratory field name', (_args, observations) => { observations[0].measurements['x'.repeat(25)] = 1.9 }],
  ['polluting laboratory field name', (_args, observations) => { observations[0].measurements.constructor = 1.9 }],
  ['symbol laboratory property', (_args, observations) => { observations[0].measurements[Symbol('hidden')] = 1.9 }],
  ['hidden laboratory property', (_args, observations) => { Object.defineProperty(observations[0].measurements, 'secret', { value: 1.9 }) }],
  ['laboratory array', (_args, observations) => { observations[0].measurements = [1.9] }],
  ['non-plain laboratory map', (_args, observations) => { observations[0].measurements = Object.assign(Object.create({ inherited: 1.9 }), { density: 1.9 }) }],
  ['null range top cannot clear', (_args, observations) => { observations[0].rangeTop = null }],
  ['null range bottom cannot clear', (_args, observations) => { observations[0].rangeBottom = null }],
  ['null laboratory map cannot clear', (_args, observations) => { observations[0].measurements = null }],
  ['null observations cannot clear', args => { args.updates[0].observations = null }],
  ['per-record clearFields is not an invented API', (_args, observations) => { observations[0].clearFields = ['rangeTop', 'rangeBottom'] }],
  ['range clearFields is not a hole-level field', args => { args.updates[0].clearFields = ['rangeTop'] }],
  ['set and clear observations conflicts', args => { args.updates[0].clearFields = ['observations'] }],
  ['missing CAD units', args => { delete args.units }],
  ['source units are not plotted units', args => { args.units = 'meter' }],
  ['made-up sourceUnits input is refused', args => { args.sourceUnits = 'millimeter' }],
  ['unexpected observation field', (_args, observations) => { observations[0].laboratoryUnit = 'g/cm3' }],
]

for (const [label, mutate] of invalidCases) test(`${label}: invalid observation update has no partial source, geometry, revision or history change`, async () => {
  const fixture = await setup()
  try {
    const args = request(fixture)
    // A valid scalar in the same patch must also remain uncommitted on failure.
    args.updates[0].collarElevation = 107.25
    mutate(args, args.updates[0].observations)
    const before = fixture.document.snapshot(), history = clone(fixture.document.history)
    const result = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(result.ok, false, label)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.document.history, history)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source, fixture.source)
  } finally { fixture.dispose() }
})

test('laboratory accessor is rejected without executing it', async () => {
  const fixture = await setup()
  try {
    const args = request(fixture), before = fixture.document.snapshot()
    let reads = 0
    Object.defineProperty(args.updates[0].observations[0].measurements, 'density', {
      enumerable: true, get() { reads++; return 1.92 },
    })
    const result = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(result.ok, false)
    assert.equal(reads, 0)
    assert.deepEqual(fixture.document.snapshot(), before)
  } finally { fixture.dispose() }
})

test('backward-compatible point observations and explicit complete-list replacement remove only caller-omitted optional facts', async () => {
  const fixture = await setup()
  try {
    const observations = clone(fixture.source.input.hole.observations)
    delete observations[0].rangeTop
    delete observations[0].rangeBottom
    delete observations[0].measurements
    const response = await fixture.session.call('cad_propose_geology_revision', request(fixture, observations))
    assert.equal(response.ok, true, JSON.stringify(response.error))
    assert.equal((await fixture.session.approve(response.value.planId, 'public-test-reviewer')).ok, true)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source.input.hole.observations, observations)
    for (const entity of fixture.manual) assert.deepEqual(fixture.document.getObject(entity.id), entity)
  } finally { fixture.dispose() }
})

test('the existing explicit observations clear is approved atomically; null is never a synonym for clear', async () => {
  const fixture = await setup()
  try {
    const before = stateContent(fixture.document)
    const args = request(fixture)
    delete args.updates[0].observations
    args.updates[0].clearFields = ['observations']
    const response = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(response.ok, true, JSON.stringify(response.error))
    assert.deepEqual(stateContent(fixture.document), before)
    assert.equal((await fixture.session.approve(response.value.planId, 'public-test-reviewer')).ok, true)
    assert.equal(Object.hasOwn(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source.input.hole, 'observations'), false)
    await fixture.document.undo()
    assert.deepEqual(stateContent(fixture.document), before)
  } finally { fixture.dispose() }
})

test('confirmed empty observation list and unknown removed field have distinct approved source semantics', async () => {
  const fixture = await setup()
  try {
    const sourceBefore = readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source
    const empty = await fixture.session.call('cad_propose_geology_revision', request(fixture, []))
    assert.equal(empty.ok, true, JSON.stringify(empty.error))
    assert.equal((await fixture.session.approve(empty.value.planId, 'public-test-reviewer')).ok, true)
    const emptyHole = readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source.input.hole
    assert.equal(Object.hasOwn(emptyHole, 'observations'), true)
    assert.deepEqual(emptyHole.observations, [], 'confirmed no records is a present empty list')
    const emptyContent = stateContent(fixture.document)
    const args = request(fixture)
    delete args.updates[0].observations
    args.updates[0].clearFields = ['observations']
    const unknown = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(unknown.ok, false, 'the current compiler refuses source-only changes with identical supported geometry')
    assert.match(unknown.error.message, /source change does not alter supported drawing output/)
    assert.deepEqual(stateContent(fixture.document), emptyContent)
    await fixture.document.undo()
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source, sourceBefore)
    const beforeUnknown = stateContent(fixture.document)
    args.expectedRevision = fixture.document.revision
    const separateUnknown = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(separateUnknown.ok, true, JSON.stringify(separateUnknown.error))
    assert.deepEqual(stateContent(fixture.document), beforeUnknown)
    assert.equal((await fixture.session.approve(separateUnknown.value.planId, 'public-test-reviewer')).ok, true)
    assert.equal(Object.hasOwn(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source.input.hole, 'observations'), false,
      'unknown is the absence of the optional field, not an empty list')
    await fixture.document.undo()
    assert.deepEqual(stateContent(fixture.document), beforeUnknown)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source, sourceBefore)
    const guidance = revisionTool().inputSchema.properties.updates.items.properties.observations.description
    assert.match(guidance, /Complete replacement list/)
    assert.match(guidance, /confirmed.*no observations/)
    assert.match(guidance, /unknown/)
  } finally { fixture.dispose() }
})

for (const sweepDegrees of [-135, -90, -45, 0, 45, 90, 180]) test(`native polyline angle ${sweepDegrees} degrees uses engine conversion, never an approximate model bulge`, async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  try {
    await document.transact('Public angle fixture', transaction => {
      transaction.createEntity('LWPOLYLINE', { vertices: [
        { point: [0, 0], bulge: 0.1, startWidth: 0.25, endWidth: 0.75 },
        { point: [12, 0] }, { point: [12, 9] },
      ], closed: false }, { id: 'PUBLIC-SWEEP-PATH' })
      transaction.createEntity('CIRCLE', { center: [30, 0], radius: 2 }, { id: 'PUBLIC-SWEEP-MANUAL' })
    })
    const session = new KJAgentToolSession(sdk, document), before = document.snapshot()
    const response = await session.call('cad_propose_polyline_edit', { expectedRevision: document.revision, units: 'millimeter',
      id: 'PUBLIC-SWEEP-PATH', operation: 'SET_BULGE', segmentIndex: 0, sweepDegrees })
    assert.equal(response.ok, true, JSON.stringify(response.error))
    assert.deepEqual(document.snapshot(), before)
    assert.equal(response.value.arguments.sweepDegrees, sweepDegrees)
    assert.equal(Object.hasOwn(response.value.arguments, 'bulge'), false, 'caller angle is passed to the engine, not recalculated by the model')
    const preview = response.value.preview.after[0], expectedBulge = Math.tan(sweepDegrees * Math.PI / 720)
    assert.ok(Math.abs(preview.payload.vertices[0].bulge - expectedBulge) < 1e-12)
    assert.ok(Math.abs(4 * Math.atan(preview.payload.vertices[0].bulge) * 180 / Math.PI - sweepDegrees) < 1e-10,
      'the native arc returns the requested angle, not twice that angle')
    assert.equal((await session.approve(response.value.planId, 'public-test-reviewer')).ok, true)
    const actual = document.getObject('PUBLIC-SWEEP-PATH')
    assert.equal(actual.id, preview.id)
    assert.equal(actual.handle, before.objects[actual.id].handle)
    assert.deepEqual(actual.payload, preview.payload)
    assert.equal(actual.payload.vertices[0].startWidth, 0.25)
    assert.equal(actual.payload.vertices[0].endWidth, 0.75)
    assert.deepEqual(document.getObject('PUBLIC-SWEEP-MANUAL'), before.objects['PUBLIC-SWEEP-MANUAL'])
    await document.undo()
    assert.deepEqual(document.getObject('PUBLIC-SWEEP-PATH'), before.objects['PUBLIC-SWEEP-PATH'])
    await document.redo()
    assert.deepEqual(document.getObject('PUBLIC-SWEEP-PATH'), actual)
    const tool = KJDRAW_AGENT_TOOLS.find(item => item.name === 'cad_propose_polyline_edit')
    assert.match(tool.description, /prefer sweepDegrees/)
    assert.match(tool.inputSchema.properties.sweepDegrees.description, /engine computes bulge=tan\(sweepRadians\/4\)/)
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})

test('source read reports fixed metre depth fields and does not invent units or certify laboratory values', async () => {
  const fixture = await setup()
  try {
    const response = await fixture.session.call('cad_read_geology_source', {
      expectedRevision: fixture.document.revision, drawingId: fixture.recipe.drawingId, maxBytes: 262144,
    })
    assert.equal(response.ok, true, JSON.stringify(response.error))
    assert.equal(response.value.units, 'millimeter')
    assert.equal(response.value.sourceUnits, 'meter')
    assert.equal(response.value.sourceFieldUnits['observations.rangeTop'], 'meter')
    assert.equal(response.value.sourceFieldUnits['observations.rangeBottom'], 'meter')
    assert.equal(response.value.sourceFieldUnits['observations.measurements'], 'declared-field-specific')
    assert.equal(response.value.measurementsVerified, false)
    assert.deepEqual(response.value.facts.hole.observations, fixture.source.input.hole.observations)
  } finally { fixture.dispose() }
})

test('stale observation proposal and stale approval reject without overwriting a later manual change', async () => {
  const fixture = await setup()
  try {
    const args = request(fixture, changedObservation(fixture)), before = fixture.document.snapshot()
    const stale = await fixture.session.call('cad_propose_geology_revision', { ...args, expectedRevision: args.expectedRevision - 1 })
    assert.equal(stale.ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    const proposal = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
    await fixture.sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [230, 180, 0], radius: 2 } }, { document: fixture.document })
    const later = fixture.document.snapshot()
    assert.equal((await fixture.session.approve(proposal.value.planId, 'public-test-reviewer')).ok, false)
    assert.deepEqual(fixture.document.snapshot(), later)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.recipe.drawingId).source, fixture.source)
  } finally { fixture.dispose() }
})
