import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK, applyGeologySectionLinkChanges } from '../packages/kjdraw-sdk/src/index.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { createKJDomesticModelAdapter } from '../packages/kjdraw-sdk/src/domestic-model-profiles.js'
import { runKJAgentTask } from '../packages/kjdraw-sdk/src/agent-runner.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

// Public native engine/host selftests only: no provider calls or model passes.
const clone = value => structuredClone(value)
const content = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}
const link = (left = 'A', right = 'B', interval = 'UPPER') => ({ fromHoleId: left, toHoleId: right,
  fromIntervalId: `${left}-${interval}`, toIntervalId: `${right}-${interval}` })
const endpoints = item => [
  { holeId: item.fromHoleId, adjacentHoleId: item.toHoleId, intervalId: item.fromIntervalId },
  { holeId: item.toHoleId, adjacentHoleId: item.fromHoleId, intervalId: item.toIntervalId },
]
const unlink = (item = link()) => ({ correlations: { remove: [clone(item)] }, uncorrelatedOccurrences: { add: endpoints(item) } })
const connect = (item = link()) => ({ correlations: { add: [clone(item)] }, uncorrelatedOccurrences: { remove: endpoints(item) } })
function sourceInput(locale = 'zh-CN') {
  const holes = ['A', 'B', 'C'].map((id, index) => ({ id, station: index * 16, collarElevation: 106, depth: 18,
    initialWaterDepth: 2, stableWaterDepth: 4,
    strata: [
      { intervalId: `${id}-FILL`, code: '1', name: 'Fill', top: 0, bottom: 3, lithology: 'fill' },
      { intervalId: `${id}-UPPER`, code: '2-1', name: 'Clay', top: 3, bottom: 8, lithology: 'clay', description: 'Retained measured description' },
      { intervalId: `${id}-LOWER`, code: '2-2', name: 'Clay', top: 8, bottom: 10, lithology: 'clay' },
      { intervalId: `${id}-SAND`, code: '3', name: 'Sand', top: 10, bottom: 18, lithology: 'sand' },
    ], observations: [{ kind: 'sample', id: `${id}-S1`, depth: 5, displayLabel: 'S1', rangeTop: 4, rangeBottom: 6,
      measurements: { density: 1.84, waterContent: 22 } },
      { kind: 'spt', id: `${id}-N1`, depth: 12, value: 16 }],
  }))
  return { expectedRevision: 0, locale, holes,
    // Deliberately non-sorted native declaration order: a delta must retain it.
    correlations: ['LOWER', 'FILL', 'SAND', 'UPPER'].flatMap(interval => [link('B', 'C', interval), link('A', 'B', interval)]),
    horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 84,
    surfaceRule: 'straight-between-supplied-collars', sourceFactMode: 'complete-occurrence-map',
  }
}
async function setup(locale = 'zh-CN', { disconnected = false, illustrative = false } = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const input = sourceInput(locale)
  if (disconnected) Object.assign(input, applyGeologySectionLinkChanges(input, unlink()))
  if (illustrative) input.sourceFactMode = 'illustrative'
  await sdk.executeCommand('CREATEBATCH', clone(compileGeologySection(input).commandArgs), { document })
  await registerGeologyDrawingRecipe(document, { kind: 'section', input }, { expectedRevision: document.revision })
  const layerId = document.getTable('layers').currentId, styleId = document.getTable('textStyles').currentId
  await sdk.executeCommand('CREATEBATCH', { entities: [
    { id: 'PUBLIC-DELTA-MANUAL-CIRCLE', type: 'CIRCLE', payload: { center: [460, 160, 0], radius: 3, layerId } },
    { id: 'PUBLIC-DELTA-MANUAL-NOTE', type: 'TEXT', payload: { position: [460, 175, 0], height: 2, text: 'Untouched note', layerId, styleId } },
  ] }, { document })
  const session = new KJAgentToolSession(sdk, document)
  const listing = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId: '', maxBytes: 8192 })
  assert.equal(listing.ok, true, JSON.stringify(listing.error))
  assert.equal(listing.value.drawingIds.length, 1)
  const drawingId = listing.value.drawingIds[0], source = readGeologyDrawingRecipe(document, drawingId).source
  return { sdk, document, session, drawingId, source, dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}
const request = (fixture, changes = unlink()) => ({ expectedRevision: fixture.document.revision, units: 'millimeter',
  drawingId: fixture.drawingId, updates: [], linkChanges: clone(changes) })
function assertBands(document, source) {
  const holes = source.input.holes, bands = document.listEntities({ type: 'HATCH' }).filter(entity => {
    const vertices = entity.payload.boundaryLoops?.[0]?.vertices
    return vertices && Math.max(...vertices.map(vertex => vertex.point[0])) - Math.min(...vertices.map(vertex => vertex.point[0])) > 20
  })
  assert.equal(bands.length, source.input.correlations.length)
  const x = hole => 52 + hole.station * 1000 / source.input.horizontalScaleDenominator
  const y = (hole, depth) => 43 + (hole.collarElevation - depth - source.input.datumElevation) * 1000 / source.input.verticalScaleDenominator
  for (const item of source.input.correlations) {
    const left = holes.find(hole => hole.id === item.fromHoleId), right = holes.find(hole => hole.id === item.toHoleId)
    const a = left.strata.find(layer => layer.intervalId === item.fromIntervalId), b = right.strata.find(layer => layer.intervalId === item.toIntervalId)
    const points = [[x(left), y(left, a.bottom), 0], [x(right), y(right, b.bottom), 0], [x(right), y(right, b.top), 0], [x(left), y(left, a.top), 0]]
    assert.ok(bands.some(band => canonicalStringify(band.payload.boundaryLoops[0].vertices.map(vertex => vertex.point)) === canonicalStringify(points)))
  }
}
function semanticReference(value, document) {
  if (Array.isArray(value)) return value.map(item => semanticReference(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, semanticReference(item, document)]))
  const record = typeof value === 'string' ? document.getObject(value) : null
  return !record ? value : record.kind === 'entity' ? { handle: record.handle } : { type: record.type, name: record.name }
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
const resourceRecords = document => ['layers', 'textStyles', 'linetypes'].map(table => ({ table,
  records: document.getTable(table).records.map(record => ({ type: record.type, name: record.name,
    payload: semanticReference(record.payload, document) })).sort((a, b) => a.name.localeCompare(b.name)),
}))

test('link delta is additive, closed, bounded, frozen, exact interval-ID-only and free of provider-specific schema unions', () => {
  const tool = KJDRAW_AGENT_TOOLS.find(item => item.name === 'cad_propose_geology_revision'), schema = tool.inputSchema
  assert.equal(KJDRAW_AGENT_TOOLS.filter(item => item.name === tool.name).length, 1)
  assert.ok(schema.required.includes('updates'))
  assert.ok(!schema.required.includes('linkChanges'))
  assert.equal(schema.properties.updates.minItems, 0)
  assert.ok(schema.properties.correlations && schema.properties.uncorrelatedOccurrences)
  const delta = schema.properties.linkChanges
  assert.equal(Object.isFrozen(delta), true)
  assert.equal(delta.additionalProperties, false)
  for (const [name, fields] of [['correlations', ['fromHoleId', 'toHoleId', 'fromIntervalId', 'toIntervalId']],
    ['uncorrelatedOccurrences', ['holeId', 'adjacentHoleId', 'intervalId']]]) {
    assert.equal(delta.properties[name].additionalProperties, false)
    for (const operation of ['add', 'remove']) {
      const items = delta.properties[name].properties[operation]
      assert.equal(items.minItems, 1); assert.equal(items.maxItems, 256)
      assert.deepEqual(items.items.required, fields)
      assert.equal(items.items.additionalProperties, false)
    }
  }
  assert.doesNotMatch(JSON.stringify(delta), /"(?:anyOf|oneOf|allOf)"|StratumCode|"index"/)
})

for (const locale of ['zh-CN', 'en']) for (const action of ['remove', 'add']) test(`${locale} ${action}: exact source → pending → approval → native HATCH/IDs/resources → undo/redo → archive/KJD/DXF`, async () => {
  const fixture = await setup(locale, { disconnected: action === 'add' })
  const { sdk, document, session, drawingId } = fixture
  try {
    const actualRead = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId, maxBytes: 262144 })
    assert.equal(actualRead.ok, true)
    const changes = action === 'add' ? connect() : unlink(), args = request(fixture, changes)
    const expectedSource = clone(fixture.source)
    expectedSource.input = applyGeologySectionLinkChanges(fixture.source.input, changes)
    const before = document.snapshot(), beforeContent = content(document), beforeFingerprint = document.fingerprint()
    const history = clone(document.history), resources = resourceRecords(document)
    const proposal = await session.call('cad_propose_geology_revision', args)
    assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
    assert.equal(proposal.value.status, 'awaiting-host-approval')
    assert.equal(proposal.value.command, 'GEOLOGY_DRAWING_UPDATE')
    assert.deepEqual(document.snapshot(), before)
    assert.deepEqual(document.history, history)
    assert.deepEqual(proposal.value.engineeringEvidence.beforeSource.facts, actualRead.value.facts)
    assert.deepEqual(proposal.value.engineeringEvidence.afterSource.facts.holes, actualRead.value.facts.holes)
    assert.deepEqual(proposal.value.engineeringEvidence.afterSource.facts.correlations, expectedSource.input.correlations)
    assert.equal(Object.hasOwn(expectedSource.input, 'uncorrelatedOccurrences'), true)
    assert.deepEqual(proposal.value.engineeringEvidence.afterSource.facts.uncorrelatedOccurrences, expectedSource.input.uncorrelatedOccurrences)
    const retained = proposal.value.unchangedIds.map(id => clone(document.getObject(id)))
    const unrelated = Object.values(before.objects).filter(record => !proposal.value.preview.before.some(entity => entity.id === record.id) && record.kind === 'entity')
    args.linkChanges.correlations[action][0].fromHoleId = 'POST-PREVIEW-TAMPER'
    const approval = await session.approve(proposal.value.planId, 'public-link-delta-reviewer')
    assert.equal(approval.ok, true, JSON.stringify(approval.error))
    assert.equal(approval.value.status, 'committed')
    assert.equal(document.revision, before.revision + 1)
    assert.equal(document.history.undoCount, history.undoCount + 1)
    assert.deepEqual(readGeologyDrawingRecipe(document, drawingId).source, expectedSource)
    for (const record of [...retained, ...unrelated]) assert.deepEqual(document.getObject(record.id), record)
    assert.deepEqual(resourceRecords(document), resources)
    assertBands(document, expectedSource)
    const afterContent = content(document), afterFingerprint = document.fingerprint()
    assert.equal((await session.approve(proposal.value.planId, 'public-link-delta-reviewer')).ok, false)
    const historyRead = await session.call('cad_read_history', { expectedRevision: document.revision })
    const undo = await session.call('cad_propose_undo', { expectedRevision: document.revision, units: 'millimeter', targetHistoryId: historyRead.value.history.undoTarget.id })
    assert.equal(undo.ok, true)
    assert.equal((await session.approve(undo.value.planId, 'public-link-delta-reviewer')).ok, true)
    assert.deepEqual(content(document), beforeContent)
    assert.equal(document.fingerprint(), beforeFingerprint)
    const redoRead = await session.call('cad_read_history', { expectedRevision: document.revision })
    const redo = await session.call('cad_propose_redo', { expectedRevision: document.revision, units: 'millimeter', targetHistoryId: redoRead.value.history.redoTarget.id })
    assert.equal(redo.ok, true)
    assert.equal((await session.approve(redo.value.planId, 'public-link-delta-reviewer')).ok, true)
    assert.deepEqual(content(document), afterContent)
    assert.equal(document.fingerprint(), afterFingerprint)
    const reopenedSdk = createKJDrawSDK()
    try {
      const reopened = await reopenedSdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
      assert.equal(canonicalStringify(reopened.snapshot()), canonicalStringify(document.snapshot()))
      assert.deepEqual(readGeologyDrawingRecipe(reopened, drawingId).source, expectedSource)
      assert.equal(reopened.history.undoCount, 0, 'Portable KJD alone must not invent history')
      const archive = document.exportHistory(), invalid = clone(archive)
      invalid.documentFingerprint = 'tampered-not-current-drawing'
      const portableBaseline = reopened.snapshot()
      await assert.rejects(reopened.restoreHistory(invalid), /does not match/)
      assert.deepEqual(reopened.snapshot(), portableBaseline)
      assert.equal(reopened.history.undoCount, 0)
      await reopened.restoreHistory(archive)
      assert.equal(reopened.history.undoCount, document.history.undoCount)
      assert.notEqual(reopened.history.undoTarget.id, document.history.undoTarget.id)
      // JSON archives preserve every defined native fact; optional undefined
      // properties serialize as absent. Compare full canonical content, without
      // dropping any identity, geometry, source or resource field.
      await reopened.undo(); assert.equal(canonicalStringify(content(reopened)), canonicalStringify(beforeContent))
      await reopened.redo(); assert.equal(canonicalStringify(content(reopened)), canonicalStringify(afterContent))
      const dxf = await reopenedSdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
      assert.equal(dxf.validate().valid, true)
      assert.equal(canonicalStringify(dxfRecords(dxf)), canonicalStringify(dxfRecords(document)))
      assert.equal(canonicalStringify(resourceRecords(dxf)), canonicalStringify(resources))
      assert.equal(dxf.history.undoCount, 0)
      assert.throws(() => readGeologyDrawingRecipe(dxf, drawingId), /source|recipe/i)
    } finally { for (const id of [...reopenedSdk.documents.keys()]) reopenedSdk.closeDocument(id) }
  } finally { fixture.dispose() }
})

test('same-BEFORE exact remap preserves other-neighbour occurrences and surviving order, appending only declared identities', async () => {
  const fixture = await setup()
  try {
    const old = link(), lower = link('A', 'B', 'LOWER')
    const remap = { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: old.fromIntervalId, toIntervalId: lower.toIntervalId }
    const changes = { correlations: { remove: [old, lower], add: [remap] }, uncorrelatedOccurrences: { add: [endpoints(lower)[0], endpoints(old)[1]] } }
    const proposal = await fixture.session.call('cad_propose_geology_revision', request(fixture, changes))
    assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
    const expectedLinks = fixture.source.input.correlations.filter(item => canonicalStringify(item) !== canonicalStringify(old) && canonicalStringify(item) !== canonicalStringify(lower))
    assert.deepEqual(proposal.value.engineeringEvidence.afterSource.facts.correlations, [...expectedLinks, remap])
    assert.deepEqual(proposal.value.engineeringEvidence.afterSource.facts.holes, fixture.source.input.holes)
    assert.ok(expectedLinks.some(item => item.fromHoleId === 'B' && item.fromIntervalId === 'B-UPPER' && item.toHoleId === 'C'))
    assert.equal((await fixture.session.approve(proposal.value.planId, 'public-link-delta-reviewer')).ok, true)
    assertBands(fixture.document, readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source)
  } finally { fixture.dispose() }
})

const invalidCases = [
  ['empty delta', args => { args.linkChanges = {} }],
  ['empty group', args => { args.linkChanges.correlations = {} }],
  ['empty operation', args => { args.linkChanges.correlations.remove = [] }],
  ['null delta', args => { args.linkChanges = null }],
  ['primitive delta', args => { args.linkChanges = 'remove' }],
  ['null group', args => { args.linkChanges.correlations = null }],
  ['unknown group', args => { args.linkChanges.legacy = {} }],
  ['unknown operation', args => { args.linkChanges.correlations.update = [] }],
  ['legacy selector', args => { args.linkChanges.correlations.remove[0].fromStratumCode = '2-1' }],
  ['missing interval identity', args => { delete args.linkChanges.correlations.remove[0].fromIntervalId }],
  ['index selector', args => { args.linkChanges.correlations.remove[0].index = 1 }],
  ['guessed name selector', args => { args.linkChanges.correlations.remove[0].name = 'Clay' }],
  ['unknown occurrence property', args => { args.linkChanges.uncorrelatedOccurrences.add[0].depth = 3 }],
  ['null identity', args => { args.linkChanges.correlations.remove[0].fromIntervalId = null }],
  ['empty identity', args => { args.linkChanges.correlations.remove[0].fromIntervalId = '' }],
  ['unknown hole', args => { args.linkChanges.correlations.remove[0].fromHoleId = 'UNKNOWN' }],
  ['unknown interval', args => { args.linkChanges.correlations.remove[0].fromIntervalId = 'UNKNOWN' }],
  ['nonadjacent endpoints', args => { args.linkChanges.correlations.remove[0].toHoleId = 'C'; args.linkChanges.correlations.remove[0].toIntervalId = 'C-UPPER' }],
  ['reverse station direction', args => { args.linkChanges.correlations.remove[0] = { fromHoleId: 'B', toHoleId: 'A', fromIntervalId: 'B-UPPER', toIntervalId: 'A-UPPER' } }],
  ['duplicate remove', args => { args.linkChanges.correlations.remove.push(clone(args.linkChanges.correlations.remove[0])) }],
  ['duplicate add', args => { args.linkChanges.uncorrelatedOccurrences.add.push(clone(args.linkChanges.uncorrelatedOccurrences.add[0])) }],
  ['same identity add and remove', args => { args.linkChanges.correlations.add = clone(args.linkChanges.correlations.remove) }],
  ['already existing add', args => { args.linkChanges.correlations.add = [link('B', 'C')] }],
  ['absent remove', args => { args.linkChanges.uncorrelatedOccurrences.remove = endpoints(link('B', 'C')) }],
  ['one-sided occurrence coverage', args => { args.linkChanges.uncorrelatedOccurrences.add.pop() }],
  ['no occurrence coverage', args => { delete args.linkChanges.uncorrelatedOccurrences }],
  ['unlinked declaration without unlinking', args => { delete args.linkChanges.correlations }],
  ['wrong neighbour occurrence', args => { args.linkChanges.uncorrelatedOccurrences.add[1].adjacentHoleId = 'C' }],
  ['mixed full correlations even empty', args => { args.correlations = [] }],
  ['mixed full unlinked even empty', args => { args.uncorrelatedOccurrences = [] }],
  ['mixed nonempty updates', args => { args.updates = [{ holeId: 'A', collarElevation: 107 }] }],
  ['future interval update forbidden', args => { args.updates = [{ holeId: 'A', strata: [{ intervalId: 'FUTURE', code: '1', name: 'Clay', top: 0, bottom: 18, lithology: 'clay' }] }] }],
  ['missing required updates', args => { delete args.updates }],
  ['stale revision', args => { args.expectedRevision-- }],
  ['wrong units', args => { args.units = 'meter' }],
  ['unknown drawing', args => { args.drawingId = 'geo-UNKNOWN' }],
  ['257 total operations', args => { args.linkChanges.correlations.remove = Array.from({ length: 255 }, () => link()) }],
  ['257 single-list operations', args => { args.linkChanges.correlations.remove = Array.from({ length: 257 }, () => link()) }],
  ['sparse operation array', args => { delete args.linkChanges.correlations.remove[0] }],
  ['array extra property', args => { args.linkChanges.correlations.remove.extra = true }],
  ['array symbol property', args => { args.linkChanges.correlations.remove[Symbol('extra')] = true }],
  ['hidden array item', args => { Object.defineProperty(args.linkChanges.correlations.remove, '0', { enumerable: false }) }],
  ['hidden group', args => { Object.defineProperty(args.linkChanges, 'correlations', { enumerable: false }) }],
  ['hidden extra add cannot disappear into a partial valid proposal', args => {
    Object.defineProperty(args.linkChanges.correlations, 'add', { value: [link('B', 'C')], enumerable: false })
  }],
  ['hidden top-level delta mixed with full replacements', args => {
    Object.defineProperty(args, 'linkChanges', { enumerable: false })
    Object.assign(args, { correlations: sourceInput().correlations.filter(item => canonicalStringify(item) !== canonicalStringify(link())), uncorrelatedOccurrences: endpoints(link()) })
  }],
  ['hidden full replacement cannot disappear from mutual-exclusion checks', args => {
    Object.defineProperty(args, 'correlations', { value: [], enumerable: false })
  }],
  ['prototype identity', args => { Object.setPrototypeOf(args.linkChanges.correlations.remove[0], { injected: true }) }],
]
for (const [label, mutate] of invalidCases) test(`${label}: no proposal, no source/geometry/history mutation`, async () => {
  const fixture = await setup()
  try {
    const args = request(fixture); mutate(args)
    const before = fixture.document.snapshot(), history = clone(fixture.document.history), plans = fixture.sdk.agentPlans.list()
    const rejected = await fixture.session.call('cad_propose_geology_revision', args)
    assert.equal(rejected.ok, false, label)
    if (label === '257 total operations') assert.match(rejected.error.message, /256 total explicit operations/)
    assert.equal(rejected.value, undefined)
    assert.deepEqual(fixture.sdk.agentPlans.list(), plans)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.document.history, history)
    assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, fixture.source)
  } finally { fixture.dispose() }
})

for (const label of ['incompatible lithology', 'crossing correlations']) test(`${label}: explicit coverage cannot bypass authoritative compiler rejection`, async () => {
  const fixture = await setup()
  try {
    const upper = link(), other = label === 'incompatible lithology' ? link('A', 'B', 'SAND') : link('A', 'B', 'LOWER')
    const first = { ...upper, toIntervalId: other.toIntervalId }
    const changes = label === 'incompatible lithology'
      ? { correlations: { remove: [upper, other], add: [first] }, uncorrelatedOccurrences: { add: [endpoints(other)[0], endpoints(upper)[1]] } }
      : { correlations: { remove: [upper, other], add: [first, { ...other, toIntervalId: upper.toIntervalId }] } }
    assert.doesNotThrow(() => applyGeologySectionLinkChanges(fixture.source.input, changes), 'identity/coverage alone is not geology compatibility')
    const before = fixture.document.snapshot(), plans = fixture.sdk.agentPlans.list()
    const rejected = await fixture.session.call('cad_propose_geology_revision', request(fixture, changes))
    assert.equal(rejected.ok, false)
    assert.match(rejected.error.message, /compatible|cross|reverse/i)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.sdk.agentPlans.list(), plans)
  } finally { fixture.dispose() }
})

test('a bare new link cannot automatically remove either retained uncorrelated occurrence', async () => {
  const fixture = await setup('en', { disconnected: true })
  try {
    const before = fixture.document.snapshot(), plans = fixture.sdk.agentPlans.list()
    assert.equal((await fixture.session.call('cad_propose_geology_revision', request(fixture, { correlations: { add: [link()] } }))).ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.sdk.agentPlans.list(), plans)
  } finally { fixture.dispose() }
})

test('direct helper retains absent optional lists, every untouched source fact, input order, and detached ownership', () => {
  const original = sourceInput(), before = clone(original), next = applyGeologySectionLinkChanges(original, unlink())
  assert.equal(Object.hasOwn(original, 'uncorrelatedOccurrences'), false)
  assert.deepEqual(original, before)
  assert.deepEqual(next.holes, before.holes)
  assert.deepEqual(next.correlations, before.correlations.filter(item => canonicalStringify(item) !== canonicalStringify(link())))
  assert.deepEqual(next.uncorrelatedOccurrences, endpoints(link()))
  const reconnected = applyGeologySectionLinkChanges(next, connect())
  assert.deepEqual(reconnected.uncorrelatedOccurrences, [], 'known empty does not become absent/unknown')
  assert.deepEqual(reconnected.correlations, [...next.correlations, link()])
  const retarget = { correlations: { remove: [link(), link('A', 'B', 'LOWER')], add: [
    { ...link(), toIntervalId: 'B-LOWER' }, { ...link('A', 'B', 'LOWER'), toIntervalId: 'B-UPPER' },
  ] } }
  const withoutOptional = applyGeologySectionLinkChanges(original, retarget)
  assert.equal(Object.hasOwn(withoutOptional, 'uncorrelatedOccurrences'), false)
  next.holes[0].strata[0].code = 'POST-RETURN'; assert.deepEqual(original, before)
})

for (const [label, mutate] of [
  ['missing required correlation list', source => { delete source.correlations }],
  ['null correlation list', source => { source.correlations = null }],
  ['duplicate source hole identity', source => { source.holes[1].id = source.holes[0].id }],
  ['duplicate interval in one source hole', source => { source.holes[0].strata[1].intervalId = source.holes[0].strata[0].intervalId }],
  ['invalid duplicate stations', source => { source.holes[1].station = source.holes[0].station }],
  ['an incomplete BEFORE map cannot be promoted by a repairing delta', source => { source.correlations.pop() }],
  ['inferred topology is not exact source coverage', source => { source.correlationMode = 'source-group-topology' }],
]) test(`public helper rejects ${label} with a typed validation error`, () => {
  const source = sourceInput(); mutate(source)
  assert.throws(() => applyGeologySectionLinkChanges(source, unlink()), error => error.code === 'KJDOCUMENT_INVALID')
})

test('exact interval tuples do not collide when IDs contain separators, and middle-hole occurrences stay independent', () => {
  const source = sourceInput()
  const untouched = clone(source.holes[1].observations)
  const changed = applyGeologySectionLinkChanges(source, unlink())
  assert.deepEqual(changed.holes[1].observations, untouched)
  assert.ok(changed.correlations.some(item => canonicalStringify(item) === canonicalStringify(link('B', 'C'))))
  const odd = sourceInput()
  odd.holes[0].id = 'A|B'; odd.holes[0].strata.forEach(layer => { layer.intervalId = layer.intervalId.replace('A-', 'A|B-') })
  odd.correlations.forEach(item => { if (item.fromHoleId === 'A') { item.fromHoleId = 'A|B'; item.fromIntervalId = item.fromIntervalId.replace('A-', 'A|B-') } })
  const actual = { fromHoleId: 'A|B', toHoleId: 'B', fromIntervalId: 'A|B-UPPER', toIntervalId: 'B-UPPER' }
  assert.deepEqual(applyGeologySectionLinkChanges(odd, unlink(actual)).uncorrelatedOccurrences, endpoints(actual))
})

test('caller operation limit accepts exactly 256 explicit operations and refuses the 257th before identity dispatch', () => {
  const source = sourceInput()
  source.holes = source.holes.slice(0, 2).map(hole => ({ ...hole, strata: Array.from({ length: 128 }, (_, index) => ({
    intervalId: `${hole.id}-${index}`, code: String(index + 1), name: 'Clay', top: index, bottom: index + 1, lithology: 'clay',
  })) }))
  source.correlations = Array.from({ length: 128 }, (_, index) => ({ fromHoleId: 'A', toHoleId: 'B', fromIntervalId: `A-${index}`, toIntervalId: `B-${index}` }))
  const changes = { correlations: { remove: clone(source.correlations), add: source.correlations.map((item, index) => ({ ...item, toIntervalId: `B-${index ^ 1}` })) } }
  assert.equal(applyGeologySectionLinkChanges(source, changes).correlations.length, 128)
  changes.uncorrelatedOccurrences = { add: [{ holeId: 'A', adjacentHoleId: 'B', intervalId: 'A-0' }] }
  assert.throws(() => applyGeologySectionLinkChanges(source, changes), /256 total explicit operations/)
})

function sizedSource(holeCount, intervalCount) {
  const source = sourceInput()
  source.holes = Array.from({ length: holeCount }, (_, holeIndex) => ({ id: `H${holeIndex}`, station: holeIndex * 16,
    collarElevation: 500, depth: intervalCount, strata: Array.from({ length: intervalCount }, (_, index) => ({
      intervalId: `I${index}`, code: String(index + 1), name: 'Clay', top: index, bottom: index + 1, lithology: 'clay',
    })) }))
  const all = source.holes.slice(1).flatMap((right, index) => source.holes[index].strata.map(layer => ({
    fromHoleId: source.holes[index].id, toHoleId: right.id, fromIntervalId: layer.intervalId, toIntervalId: layer.intervalId,
  })))
  return { source, all }
}
test('final correlation limit remains 512 even when only three explicit delta operations were supplied', () => {
  const { source, all } = sizedSource(4, 200)
  source.correlations = all.slice(0, 512)
  source.uncorrelatedOccurrences = all.slice(512).flatMap(endpoints)
  assert.throws(() => applyGeologySectionLinkChanges(source, connect(all[512])), /512 correlations/)
})
test('final uncorrelated occurrence limit remains 2048; explicit unlinking cannot expand past it', () => {
  const { source, all } = sizedSource(24, 46)
  source.correlations = all.slice(0, 34)
  source.uncorrelatedOccurrences = all.slice(34).flatMap(endpoints)
  assert.equal(source.uncorrelatedOccurrences.length, 2048)
  assert.throws(() => applyGeologySectionLinkChanges(source, unlink(all[0])), /2048 uncorrelated/)
})

test('external actual references to changed generated geometry block the delta before any proposal exists', async () => {
  const fixture = await setup()
  try {
    const input = fixture.source.input, left = input.holes.find(hole => hole.id === 'A'), right = input.holes.find(hole => hole.id === 'B')
    const interval = left.strata.find(layer => layer.intervalId === 'A-UPPER')
    const xmin = 52 + left.station * 1000 / input.horizontalScaleDenominator, xmax = 52 + right.station * 1000 / input.horizontalScaleDenominator
    const ymin = 43 + (left.collarElevation - interval.bottom - input.datumElevation) * 1000 / input.verticalScaleDenominator
    const ymax = 43 + (left.collarElevation - interval.top - input.datumElevation) * 1000 / input.verticalScaleDenominator
    const target = fixture.document.listEntities({ type: 'HATCH' }).find(entity => {
      const vertices = entity.payload.boundaryLoops[0].vertices.map(vertex => vertex.point)
      return Math.min(...vertices.map(point => point[0])) === xmin && Math.max(...vertices.map(point => point[0])) === xmax &&
        Math.min(...vertices.map(point => point[1])) === ymin && Math.max(...vertices.map(point => point[1])) === ymax
    })
    assert.ok(target, 'Independent actual upper-clay band between A and B')
    await fixture.document.transact('Public explicit downstream reference', tx => tx.putOpaquePayload('public-link-dependent', { referencedEntityId: target.id }))
    const before = fixture.document.snapshot(), history = clone(fixture.document.history), plans = fixture.sdk.agentPlans.list()
    const rejection = await fixture.session.call('cad_propose_geology_revision', request(fixture))
    assert.equal(rejection.ok, false)
    assert.match(rejection.error.message, /external payload refers/)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.document.history, history)
    assert.deepEqual(fixture.sdk.agentPlans.list(), plans)
  } finally { fixture.dispose() }
})

test('real all-unlinked source can add one explicitly declared link without changing the other pair declarations', async () => {
  const fixture = await setup()
  try {
    const input = clone(fixture.source.input), allUnlinked = input.correlations.flatMap(endpoints)
    const pending = await fixture.session.call('cad_propose_geology_revision', { expectedRevision: fixture.document.revision, units: 'millimeter',
      drawingId: fixture.drawingId, updates: [], correlations: [], uncorrelatedOccurrences: allUnlinked })
    assert.equal(pending.ok, true)
    assert.equal((await fixture.session.approve(pending.value.planId, 'public-link-delta-reviewer')).ok, true)
    const previous = readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source
    assert.deepEqual(previous.input.correlations, [])
    const added = await fixture.session.call('cad_propose_geology_revision', request(fixture, connect()))
    assert.equal(added.ok, true, JSON.stringify(added.error))
    assert.deepEqual(added.value.engineeringEvidence.afterSource.facts.correlations, [link()])
    const expected = allUnlinked.filter(item => !endpoints(link()).some(target => canonicalStringify(item) === canonicalStringify(target)))
    assert.deepEqual(added.value.engineeringEvidence.afterSource.facts.uncorrelatedOccurrences, expected)
    assert.equal((await fixture.session.approve(added.value.planId, 'public-link-delta-reviewer')).ok, true)
    assertBands(fixture.document, readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source)
  } finally { fixture.dispose() }
})

test('column and graphics-only DXF cannot use a source-section link delta', async () => {
  const fixture = await setup()
  const sdk = createKJDrawSDK()
  try {
    const column = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, column)
    const supplied = sourceInput().holes[0]
    const columnHole = { id: 'PUBLIC-COLUMN', collarElevation: supplied.collarElevation, depth: supplied.depth,
      strata: supplied.strata.map(({ description, ...facts }) => facts) }
    const creation = await session.call('cad_propose_geology_column', { version: '1.0.0', expectedRevision: 0, units: 'millimeter', hole: columnHole })
    assert.equal(creation.ok, true, JSON.stringify(creation.error))
    assert.equal((await session.approve(creation.value.planId, 'public-link-delta-reviewer')).ok, true)
    const listing = await session.call('cad_read_geology_source', { expectedRevision: column.revision, drawingId: '', maxBytes: 8192 })
    const before = column.snapshot(), plans = sdk.agentPlans.list()
    assert.equal((await session.call('cad_propose_geology_revision', { expectedRevision: column.revision, units: 'millimeter', drawingId: listing.value.drawingIds[0], updates: [], linkChanges: unlink() })).ok, false)
    assert.deepEqual(column.snapshot(), before)
    assert.deepEqual(sdk.agentPlans.list(), plans)
    const dxf = await sdk.readDocument(await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' }), { format: 'DXF' })
    const baseline = dxf.snapshot(), dxfSession = new KJAgentToolSession(sdk, dxf)
    assert.equal((await dxfSession.call('cad_propose_geology_revision', { ...request(fixture), expectedRevision: dxf.revision })).ok, false)
    assert.deepEqual(dxf.snapshot(), baseline)
    assert.deepEqual(sdk.agentPlans.list(), plans)
  } finally { fixture.dispose(); for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})

for (const provider of ['deepseek', 'qwen']) test(`${provider}: model fixture must regenerate valid exact arguments after actual SDK legacy-field refusal`, async () => {
  const fixture = await setup('en')
  try {
    const before = fixture.document.snapshot(), good = request(fixture), bad = clone(good)
    bad.linkChanges.correlations.remove[0].fromStratumCode = '2-1'
    let requests = 0
    const model = createKJDomesticModelAdapter({ provider, model: `${provider}-fixture`, request: async ({ body }) => {
      requests++
      let name, args
      if (requests === 1) { name = 'cad_read_geology_source'; args = { expectedRevision: fixture.document.revision, drawingId: fixture.drawingId, maxBytes: 262144 } }
      else if (requests === 2) {
        assert.equal(JSON.parse(body.messages.at(-1).content).ok, true)
        name = 'cad_propose_geology_revision'; args = bad
      } else {
        assert.equal(JSON.parse(body.messages.at(-1).content).ok, false)
        assert.match(JSON.parse(body.messages.at(-1).content).error.message, /unknown property/)
        name = 'cad_propose_geology_revision'; args = good
      }
      return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '',
        tool_calls: [{ id: `public-repair-${requests}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }
    } })
    const result = await runKJAgentTask({ session: fixture.session, model, prompt: 'Public exact source-link review selftest.',
      toolNames: ['cad_read_geology_source', 'cad_propose_geology_revision'], expectReadEvidence: true })
    assert.equal(result.status, 'awaiting-approval', JSON.stringify(result.error))
    assert.equal(requests, 3)
    assert.deepEqual(result.outputs.map(output => output.result.ok), [true, false, true])
    assert.equal(result.failedToolCalls, 1)
    assert.equal(result.proposalIds.length, 1)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.equal((await fixture.session.approve(result.proposalIds[0], 'public-link-delta-reviewer')).ok, true)
    assertBands(fixture.document, readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source)
  } finally { fixture.dispose() }
})

test('getters are rejected before invocation by both public helper and native tool schema', async () => {
  let reads = 0
  const changes = unlink()
  Object.defineProperty(changes.correlations.remove[0], 'fromHoleId', { enumerable: true, get() { reads++; return 'A' } })
  assert.throws(() => applyGeologySectionLinkChanges(sourceInput(), changes), /accessors/)
  const fixture = await setup()
  try {
    const before = fixture.document.snapshot(), plans = fixture.sdk.agentPlans.list()
    const args = request(fixture); args.linkChanges = changes
    assert.equal((await fixture.session.call('cad_propose_geology_revision', args)).ok, false)
    assert.equal(reads, 0)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.sdk.agentPlans.list(), plans)
  } finally { fixture.dispose() }
})

test('illustrative source is not silently promoted to a complete occurrence map', async () => {
  const fixture = await setup('en', { illustrative: true })
  try {
    const before = fixture.document.snapshot(), plans = fixture.sdk.agentPlans.list()
    assert.equal((await fixture.session.call('cad_propose_geology_revision', request(fixture))).ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.sdk.agentPlans.list(), plans)
  } finally { fixture.dispose() }
})

for (const change of ['unrelated edit', 'generated drift', 'locked', 'frozen', 'hidden']) test(`${change}: stale approval and subsequent protected/drifted source fail atomically`, async () => {
  const fixture = await setup()
  try {
    const pending = await fixture.session.call('cad_propose_geology_revision', request(fixture))
    assert.equal(pending.ok, true)
    if (change === 'unrelated edit') await fixture.sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [450, 0], end: [451, 0] } }, { document: fixture.document })
    else if (change === 'generated drift') {
      const entity = pending.value.preview.before.find(item => item.type === 'HATCH')
      await fixture.document.transact('Explicit public drift', tx => tx.updateObject(entity.id, { payload: { patternScale: fixture.document.getObject(entity.id).payload.patternScale + 1 } }))
    } else {
      const entity = pending.value.preview.before.find(item => item.type === 'HATCH'), layerId = fixture.document.getObject(entity.id).payload.layerId
      await fixture.sdk.executeCommand('LAYERUPDATE', { id: layerId, patch: change === 'hidden' ? { visible: false } : { [change]: true } }, { document: fixture.document })
    }
    const before = fixture.document.snapshot(), history = clone(fixture.document.history)
    assert.equal((await fixture.session.approve(pending.value.planId, 'public-link-delta-reviewer')).ok, false)
    assert.deepEqual(fixture.document.snapshot(), before)
    assert.deepEqual(fixture.document.history, history)
    if (change !== 'unrelated edit') {
      const plans = fixture.sdk.agentPlans.list()
      assert.equal((await fixture.session.call('cad_propose_geology_revision', request(fixture))).ok, false)
      assert.deepEqual(fixture.document.snapshot(), before)
      assert.deepEqual(fixture.sdk.agentPlans.list(), plans)
    }
  } finally { fixture.dispose() }
})

for (const provider of ['deepseek', 'qwen', 'kimi', 'doubao']) test(`${provider}: exact additive schema/arguments round-trip through actual adapter, no unions or automatic CAD dispatch`, async () => {
  const definition = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_geology_revision'), changes = unlink()
  const args = { expectedRevision: 7, units: 'millimeter', drawingId: 'geo-PUBLIC', updates: [], linkChanges: changes }
  let requests = 0
  const adapter = createKJDomesticModelAdapter({ provider, model: `${provider}-fixture`, request: async ({ body }) => {
    requests++
    assert.deepEqual(body.tools[0].function.parameters, definition.inputSchema)
    return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'public-delta-1', type: 'function', function: { name: definition.name, arguments: JSON.stringify(args) } }] } }] }
  } })
  const turn = await adapter.createConversation({ instructions: 'Use published exact IDs.', tools: [definition] })
    .next({ kind: 'prompt', text: 'Public schema selftest.' }, new AbortController().signal)
  assert.equal(requests, 1)
  assert.equal(turn.calls.length, 1)
  assert.deepEqual(turn.calls[0].arguments, args)
})
