import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const clone = value => structuredClone(value)
const content = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}
const makeHole = (id, station) => ({ id, station, collarElevation: 106, depth: 18,
  strata: [
    { intervalId: `${id}-FILL`, code: '1', name: 'Fill', top: 0, bottom: 3, lithology: 'fill' },
    { intervalId: `${id}-CLAY`, code: '2', name: 'Clay', top: 3, bottom: 10, lithology: 'clay' },
    { intervalId: `${id}-SAND`, code: '3', name: 'Sand', top: 10, bottom: 18, lithology: 'sand' },
  ], observations: [{ kind: 'sample', id: `${id}-S1`, depth: 5 }] })
const adjacentLinks = holes => holes.slice(1).flatMap((right, index) => holes[index].strata.map((layer, layerIndex) => ({
  fromHoleId: holes[index].id, toHoleId: right.id, fromIntervalId: layer.intervalId, toIntervalId: right.strata[layerIndex].intervalId,
})))

async function setup(locale = 'zh-CN', illustrative = false) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  let session = new KJAgentToolSession(sdk, document)
  const holes = [makeHole('PUBLIC-A', 0), makeHole('PUBLIC-B', 16), makeHole('PUBLIC-C', 32)]
  if (illustrative) {
    const source = { kind: 'section', input: { holes, correlations: adjacentLinks(holes), locale,
      horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 84,
      surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0, sourceFactMode: 'illustrative' } }
    await sdk.executeCommand('CREATEBATCH', clone(compileGeologySection(source.input).commandArgs), { document })
    await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
  } else {
    const pending = await session.call('cad_propose_geology_section', { version: '1.0.0', units: 'millimeter',
      expectedRevision: document.revision, holes, correlations: adjacentLinks(holes), uncorrelatedOccurrences: [], locale,
      horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 84,
      surfaceRule: 'straight-between-supplied-collars' })
    assert.equal(pending.ok, true, JSON.stringify(pending.error))
    assert.equal((await session.approve(pending.value.planId, 'public-section-reviewer')).ok, true)
  }
  const layerId = document.getTable('layers').currentId, styleId = document.getTable('textStyles').currentId
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [460, 160, 0], radius: 3, layerId },
    options: { id: 'PUBLIC-LINKS-MANUAL-CIRCLE' } }, { document })
  await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [460, 175, 0], height: 2, text: 'Unrelated review note', layerId, styleId },
    options: { id: 'PUBLIC-LINKS-MANUAL-NOTE' } }, { document })
  session = new KJAgentToolSession(sdk, document)
  const listing = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId: '', maxBytes: 8192 })
  assert.equal(listing.ok, true, JSON.stringify(listing.error))
  assert.equal(listing.value.drawingIds.length, 1)
  const drawingId = listing.value.drawingIds[0], source = readGeologyDrawingRecipe(document, drawingId).source
  return { sdk, document, session, drawingId, source,
    manual: ['PUBLIC-LINKS-MANUAL-CIRCLE', 'PUBLIC-LINKS-MANUAL-NOTE'].map(id => clone(document.getObject(id))),
    dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}

function unlinkOneAdjacentClayPair(fixture) {
  return { expectedRevision: fixture.document.revision, units: 'millimeter', drawingId: fixture.drawingId, updates: [],
    correlations: fixture.source.input.correlations.filter(link => !(link.fromHoleId === 'PUBLIC-A' && link.toHoleId === 'PUBLIC-B' && link.fromIntervalId === 'PUBLIC-A-CLAY')).map(clone),
    uncorrelatedOccurrences: [
      { holeId: 'PUBLIC-A', adjacentHoleId: 'PUBLIC-B', intervalId: 'PUBLIC-A-CLAY' },
      { holeId: 'PUBLIC-B', adjacentHoleId: 'PUBLIC-A', intervalId: 'PUBLIC-B-CLAY' },
    ],
  }
}

function semanticReferences(value, document) {
  if (Array.isArray(value)) return value.map(item => semanticReferences(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, semanticReferences(item, document)]))
  const referenced = typeof value === 'string' ? document.getObject(value) : null
  if (!referenced) return value
  return referenced.kind === 'entity' ? { entityHandle: referenced.handle } : { resourceType: referenced.type, resourceName: referenced.name }
}
const hatchTransportCodes = new Set([5, 330, 100, 8, 10, 20, 30, 2, 70, 71, 91, 92, 72, 73, 93, 97, 75, 76, 52, 41, 77, 78, 53, 43, 44, 45, 46, 79, 49])
function geometryByHandle(document) {
  return document.listEntities().map(entity => {
    const payload = clone(entity.payload)
    if (entity.type === 'HATCH') {
      if (payload.rawTags) assert.ok(payload.rawTags.every(tag => hatchTransportCodes.has(tag.code)), 'unexpected transport tag cannot be dropped from evidence')
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

function verifyNativeBands(document, source) {
  const { holes, correlations, horizontalScaleDenominator, verticalScaleDenominator, datumElevation } = source.input
  const bands = document.listEntities({ type: 'HATCH' }).filter(entity => {
    const vertices = entity.payload.boundaryLoops?.[0]?.vertices
    return vertices && Math.max(...vertices.map(vertex => vertex.point[0])) - Math.min(...vertices.map(vertex => vertex.point[0])) > 20
  })
  assert.equal(bands.length, correlations.length, 'only caller-declared links produce filled interval bands')
  const x = hole => 52 + (hole.station - holes[0].station) * 1000 / horizontalScaleDenominator
  const y = (hole, depth) => 43 + (hole.collarElevation - depth - datumElevation) * 1000 / verticalScaleDenominator
  for (const link of correlations) {
    const left = holes.find(hole => hole.id === link.fromHoleId), right = holes.find(hole => hole.id === link.toHoleId)
    const from = left.strata.find(layer => layer.intervalId === link.fromIntervalId), to = right.strata.find(layer => layer.intervalId === link.toIntervalId)
    const expected = [[x(left), y(left, from.bottom), 0], [x(right), y(right, to.bottom), 0], [x(right), y(right, to.top), 0], [x(left), y(left, from.top), 0]]
    assert.ok(bands.some(band => canonicalStringify(band.payload.boundaryLoops[0].vertices.map(vertex => vertex.point)) === canonicalStringify(expected)),
      'each band follows exact supplied interval depths and terminates at both native hole centres')
  }
}

test('links-only section revision keeps updates required but permits an explicit empty array', () => {
  const tool = KJDRAW_AGENT_TOOLS.find(item => item.name === 'cad_propose_geology_revision')
  assert.ok(tool.inputSchema.required.includes('updates'), 'existing API still requires its updates field')
  assert.equal(tool.inputSchema.properties.updates.minItems, 0)
  assert.equal(tool.inputSchema.properties.updates.maxItems, 24)
  assert.match(tool.description, /adjacent.*pair.*both|both.*adjacent.*pair/i)
  assert.match(tool.inputSchema.properties.updates.description, /links-only|correlations|uncorrelatedOccurrences/)
})

for (const locale of ['zh-CN', 'en']) test(`${locale}: source read → links-only native proposal → approval → history → KJD/DXF complete closure`, async () => {
  const fixture = await setup(locale)
  try {
    const { sdk, document, session, drawingId, manual } = fixture
    const read = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId, maxBytes: 262144 })
    assert.equal(read.ok, true, JSON.stringify(read.error))
    assert.equal(read.value.facts.sourceFactMode, 'complete-occurrence-map')
    assert.equal(read.value.sourceUnits, 'meter')
    assert.deepEqual(read.value.facts.holes, fixture.source.input.holes)
    const args = unlinkOneAdjacentClayPair(fixture), requestedCorrelations = clone(args.correlations), requestedUnlinked = clone(args.uncorrelatedOccurrences)
    const before = document.snapshot(), beforeContent = content(document), originalRecipe = readGeologyDrawingRecipe(document, drawingId)
    const initialFingerprint = document.fingerprint()
    const proposal = await session.call('cad_propose_geology_revision', args)
    assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
    assert.equal(proposal.value.status, 'awaiting-host-approval')
    assert.deepEqual(document.snapshot(), before, 'preview cannot change holes, links, CAD or history')
    assert.deepEqual(proposal.value.engineeringEvidence.beforeSource.facts, read.value.facts)
    assert.deepEqual(proposal.value.engineeringEvidence.afterSource.facts.holes, read.value.facts.holes)
    assert.deepEqual(proposal.value.engineeringEvidence.afterSource.facts.correlations, requestedCorrelations)
    assert.deepEqual(proposal.value.engineeringEvidence.afterSource.facts.uncorrelatedOccurrences, requestedUnlinked)
    assert.equal(proposal.value.engineeringEvidence.parameters.occurrenceCount, 12)
    assert.equal(proposal.value.engineeringEvidence.parameters.linkedOccurrenceCount, 10)
    assert.equal(proposal.value.engineeringEvidence.parameters.unlinkedOccurrenceCount, 2)
    assert.ok(proposal.value.preview.before.some(entity => entity.type === 'HATCH'))
    const retained = proposal.value.unchangedIds.map(id => clone(document.getObject(id)))
    args.correlations.splice(0, args.correlations.length)
    args.uncorrelatedOccurrences[0].intervalId = 'POST-PROPOSAL-TAMPER'
    assert.equal((await session.approve(proposal.value.planId, 'public-section-reviewer')).ok, true)
    assert.equal(document.revision, before.revision + 1)
    const expectedSource = clone(fixture.source)
    expectedSource.input.correlations = requestedCorrelations
    expectedSource.input.uncorrelatedOccurrences = requestedUnlinked
    assert.deepEqual(readGeologyDrawingRecipe(document, drawingId).source, expectedSource)
    for (const entity of [...manual, ...retained]) assert.deepEqual(document.getObject(entity.id), entity)
    for (const id of originalRecipe.entityIds.filter(id => proposal.value.preview.before.some(entity => entity.id === id))) assert.equal(document.getObject(id), null)
    verifyNativeBands(document, expectedSource)
    const afterContent = content(document), editedFingerprint = document.fingerprint()
    assert.equal((await session.approve(proposal.value.planId, 'public-section-reviewer')).ok, false)
    assert.deepEqual(content(document), afterContent)
    const undoRead = await session.call('cad_read_history', { expectedRevision: document.revision })
    const undo = await session.call('cad_propose_undo', { expectedRevision: document.revision, units: 'millimeter', targetHistoryId: undoRead.value.history.undoTarget.id })
    assert.equal(undo.ok, true, JSON.stringify(undo.error))
    assert.deepEqual(content(document), afterContent)
    assert.equal((await session.approve(undo.value.planId, 'public-section-reviewer')).ok, true)
    assert.deepEqual(content(document), beforeContent)
    assert.equal(document.fingerprint(), initialFingerprint)
    const redoRead = await session.call('cad_read_history', { expectedRevision: document.revision })
    const redo = await session.call('cad_propose_redo', { expectedRevision: document.revision, units: 'millimeter', targetHistoryId: redoRead.value.history.redoTarget.id })
    assert.equal(redo.ok, true, JSON.stringify(redo.error))
    assert.equal((await session.approve(redo.value.planId, 'public-section-reviewer')).ok, true)
    assert.deepEqual(content(document), afterContent)
    assert.equal(document.fingerprint(), editedFingerprint)
    const recovered = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
    assert.equal(canonicalStringify(recovered.snapshot()), canonicalStringify(document.snapshot()))
    assert.deepEqual(readGeologyDrawingRecipe(recovered, drawingId).source, expectedSource)
    const dxfSDK = createKJDrawSDK()
    try {
      const dxf = await dxfSDK.readDocument(await sdk.writeDocument(recovered, { format: 'DXF' }), { format: 'DXF' })
      assert.equal(dxf.validate().valid, true)
      assert.equal(canonicalStringify(geometryByHandle(dxf)), canonicalStringify(geometryByHandle(recovered)),
        'every native entity handle, coordinate, full payload and HATCH pattern survives DXF')
      assert.equal(canonicalStringify(resourcesByName(dxf)), canonicalStringify(resourcesByName(recovered)),
        'every named resource field, layer protection and text style survives DXF')
    } finally { for (const id of [...dxfSDK.documents.keys()]) dxfSDK.closeDocument(id) }
    // Reopened source can restore the exact original explicit links without
    // resending any unchanged hole array, then undo that revision as one edit.
    const recoveredSession = new KJAgentToolSession(sdk, recovered)
    const restore = await recoveredSession.call('cad_propose_geology_revision', { expectedRevision: recovered.revision, units: 'millimeter', drawingId, updates: [],
      correlations: clone(fixture.source.input.correlations), uncorrelatedOccurrences: [] })
    assert.equal(restore.ok, true, JSON.stringify(restore.error))
    assert.equal((await recoveredSession.approve(restore.value.planId, 'public-section-reviewer')).ok, true)
    assert.deepEqual(readGeologyDrawingRecipe(recovered, drawingId).source, fixture.source)
    await recovered.undo()
    assert.deepEqual(readGeologyDrawingRecipe(recovered, drawingId).source, expectedSource)
  } finally { fixture.dispose() }
})

test('an explicitly complete all-unlinked occurrence map removes every section band without resending holes', async () => {
  const fixture = await setup()
  try {
    const before = fixture.document.snapshot(), beforeContent = content(fixture.document)
    const uncorrelatedOccurrences = fixture.source.input.holes.slice(1).flatMap((right, index) => {
      const left = fixture.source.input.holes[index]
      return [...left.strata.map(layer => ({ holeId: left.id, adjacentHoleId: right.id, intervalId: layer.intervalId })),
        ...right.strata.map(layer => ({ holeId: right.id, adjacentHoleId: left.id, intervalId: layer.intervalId }))]
    })
    const pending = await fixture.session.call('cad_propose_geology_revision', {
      expectedRevision: fixture.document.revision, units: 'millimeter', drawingId: fixture.drawingId,
      updates: [], correlations: [], uncorrelatedOccurrences,
    })
    assert.equal(pending.ok, true, JSON.stringify(pending.error))
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.equal(pending.value.engineeringEvidence.parameters.occurrenceCount, 12)
    assert.equal(pending.value.engineeringEvidence.parameters.linkedOccurrenceCount, 0)
    assert.equal(pending.value.engineeringEvidence.parameters.unlinkedOccurrenceCount, 12)
    assert.equal((await fixture.session.approve(pending.value.planId, 'public-section-reviewer')).ok, true)
    const expectedSource = clone(fixture.source)
    expectedSource.input.correlations = []
    expectedSource.input.uncorrelatedOccurrences = uncorrelatedOccurrences
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, expectedSource)
    verifyNativeBands(fixture.document, expectedSource)
    for (const entity of fixture.manual) assert.deepEqual(fixture.document.getObject(entity.id), entity)
    await fixture.document.undo()
    assert.deepEqual(content(fixture.document), beforeContent)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
  } finally { fixture.dispose() }
})

const invalidCases = [
  ['no explicit link fields', (args) => { delete args.correlations; delete args.uncorrelatedOccurrences }],
  ['all empty arrays without occurrence coverage', args => { args.correlations = []; args.uncorrelatedOccurrences = [] }],
  ['unchanged full source no-op', (args, fixture) => { args.correlations = clone(fixture.source.input.correlations); args.uncorrelatedOccurrences = [] }],
  ['unknown source drawing', args => { args.drawingId = 'geo-PUBLIC-UNKNOWN' }],
  ['unknown hole in correlation', args => { args.correlations[0].fromHoleId = 'PUBLIC-MISSING' }],
  ['unknown interval in correlation', args => { args.correlations[0].fromIntervalId = 'PUBLIC-MISSING' }],
  ['unknown uncorrelated interval', args => { args.uncorrelatedOccurrences[0].intervalId = 'PUBLIC-MISSING' }],
  ['nonadjacent hole pair', args => { args.correlations[0].toHoleId = 'PUBLIC-C'; args.correlations[0].toIntervalId = 'PUBLIC-C-FILL' }],
  ['omitted one adjacent endpoint', args => { args.uncorrelatedOccurrences.pop() }],
  ['omitted both adjacent endpoints', args => { args.uncorrelatedOccurrences = [] }],
  ['omitted occurrence on a different pair', args => { args.correlations.pop() }],
  ['duplicate correlation', args => { args.correlations.push(clone(args.correlations[0])) }],
  ['duplicate uncorrelated occurrence', args => { args.uncorrelatedOccurrences.push(clone(args.uncorrelatedOccurrences[0])) }],
  ['linked/unlinked conflict', args => { args.uncorrelatedOccurrences.push({ holeId: 'PUBLIC-A', adjacentHoleId: 'PUBLIC-B', intervalId: 'PUBLIC-A-FILL' }) }],
  ['guessed layer-code identity instead of source interval ID', args => { delete args.correlations[0].fromIntervalId; args.correlations[0].fromStratumCode = '1' }],
  ['reverse station direction', args => { const link = args.correlations[0]; [link.fromHoleId, link.toHoleId] = [link.toHoleId, link.fromHoleId]; [link.fromIntervalId, link.toIntervalId] = [link.toIntervalId, link.fromIntervalId] }],
  ['stale revision', args => { args.expectedRevision-- }],
  ['missing required updates array', args => { delete args.updates }],
  ['null updates array', args => { args.updates = null }],
  ['null correlations cannot clear', args => { args.correlations = null }],
  ['null uncorrelated occurrences cannot clear', args => { args.uncorrelatedOccurrences = null }],
  ['sparse correlation array', args => { delete args.correlations[0] }],
  ['extra array property', args => { args.correlations.extra = true }],
  ['symbol array property', args => { args.uncorrelatedOccurrences[Symbol('extra')] = true }],
  ['hidden array property', args => { Object.defineProperty(args.correlations, '0', { value: args.correlations[0], enumerable: false }) }],
  ['unrelated hole update is not a substitute for coverage', args => { args.updates = [{ holeId: 'PUBLIC-MISSING', collarElevation: 107 }] }],
]

for (const [label, mutate] of invalidCases) test(`${label}: rejected links-only input leaves source, geometry, revision and history untouched`, async () => {
  const fixture = await setup()
  try {
    const args = unlinkOneAdjacentClayPair(fixture)
    mutate(args, fixture)
    const before = fixture.document.snapshot(), history = clone(fixture.document.history)
    const response = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(response.ok, false, label)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.document.history, history)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
  } finally { fixture.dispose() }
})

test('correlation array accessor is rejected without invoking it', async () => {
  const fixture = await setup()
  try {
    const args = unlinkOneAdjacentClayPair(fixture), before = fixture.document.snapshot()
    let reads = 0
    const first = args.correlations[0]
    Object.defineProperty(args.correlations, '0', { enumerable: true, get() { reads++; return first } })
    assert.equal((await fixture.session.call('cad_propose_geology_revision', args)).ok, false)
    assert.equal(reads, 0)
    assert.deepEqual(fixture.document.snapshot(), before)
  } finally { fixture.dispose() }
})

for (const patch of [{ locked: true }, { frozen: true }, { visible: false }]) test(`protected generated layer ${JSON.stringify(patch)} blocks links-only proposal and approval-time mutation`, async () => {
  const fixture = await setup()
  try {
    const args = unlinkOneAdjacentClayPair(fixture)
    const pending = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(pending.ok, true, JSON.stringify(pending.error))
    const changed = pending.value.preview.before.find(entity => entity.type === 'HATCH')
    const layerId = fixture.document.getObject(changed.id).payload.layerId
    await fixture.sdk.executeCommand('LAYERUPDATE', { id: layerId, patch }, { document: fixture.document })
    const protectedState = fixture.document.snapshot(), protectedHistory = clone(fixture.document.history)
    assert.equal((await fixture.session.approve(pending.value.planId, 'public-section-reviewer')).ok, false)
    assert.deepEqual(fixture.document.snapshot(), protectedState)
    const again = await fixture.session.call('cad_propose_geology_revision', { ...args, expectedRevision: fixture.document.revision })
    assert.equal(again.ok, false)
    assert.deepEqual(fixture.document.snapshot(), protectedState)
    assert.deepEqual(fixture.document.history, protectedHistory)
  } finally { fixture.dispose() }
})

test('an illustrative source is not silently promoted to a complete occurrence-map source by empty updates', async () => {
  const fixture = await setup('en', true)
  try {
    const args = unlinkOneAdjacentClayPair(fixture), before = fixture.document.snapshot()
    assert.equal((await fixture.session.call('cad_propose_geology_revision', args)).ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.equal(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source.input.sourceFactMode, 'illustrative')
  } finally { fixture.dispose() }
})

test('column revisions still require at least one explicit changed hole field, even if empty link arrays are supplied', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  try {
    const hole = makeHole('PUBLIC-COLUMN', 0)
    hole.observations[0].displayLabel = 'S1'
    const create = await session.call('cad_propose_geology_column', { version: '1.0.0', units: 'millimeter', expectedRevision: 0, hole })
    assert.equal(create.ok, true, JSON.stringify(create.error))
    assert.equal((await session.approve(create.value.planId, 'public-section-reviewer')).ok, true)
    const listing = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId: '', maxBytes: 8192 })
    for (const extra of [{}, { correlations: [] }, { uncorrelatedOccurrences: [] }, { correlations: [], uncorrelatedOccurrences: [] }]) {
      const before = document.snapshot()
      const result = await session.call('cad_propose_geology_revision', { expectedRevision: document.revision, units: 'millimeter',
        drawingId: listing.value.drawingIds[0], updates: [], ...extra })
      assert.equal(result.ok, false)
      assert.deepEqual(document.snapshot(), before)
    }
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})
