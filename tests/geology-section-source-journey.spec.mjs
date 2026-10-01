import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { readGeologyDrawingRecipe } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'

// Synthetic facts, not a private project or a real-language-model benchmark.
const makeHole = (id, station) => ({
  id, station, collarElevation: 103.5, depth: 16, stableWaterDepth: 4.75,
  strata: [
    { intervalId: `${id}-a`, code: '1', name: '填土', top: 0, bottom: 3, lithology: 'fill' },
    { intervalId: `${id}-b`, code: '2', name: '黏土', top: 3, bottom: 9, lithology: 'clay' },
    { intervalId: `${id}-c`, code: '3', name: '砂土', top: 9, bottom: 16, lithology: 'sand' },
  ],
  observations: [{ kind: 'sample', id: `${id}-S1`, depth: 5.25 }],
})
const adjacentLinks = holes => holes.slice(1).flatMap((right, index) =>
  holes[index].strata.map((leftLayer, layerIndex) => ({
    fromHoleId: holes[index].id, toHoleId: right.id,
    fromIntervalId: leftLayer.intervalId, toIntervalId: right.strata[layerIndex].intervalId,
  })))
const content = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}
const nearly = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-7,
  `${label}: actual=${actual}; expected=${expected}`)
const dxfPayload = payload => {
  const value = structuredClone({ normal: [0, 0, 1], ...payload })
  if (value.boundaryLoops) {
    value.associative ??= false
    for (const loop of value.boundaryLoops) if (loop.vertices) loop.flags ??= 2 | (loop.external ? 1 : 0)
  }
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key === 'rawTags' || key === 'contractVersion' || /Ids?$/.test(key)) return undefined
    // DXF writes degrees in [0,360); a -45 degree pattern and 315 degrees
    // have identical lines. Defaults above are explicit in DXF, implicit in CAD.
    if (typeof item === 'number' && /angle$/i.test(key)) item = ((item % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    return typeof item === 'number' ? Math.round(item * 1e8) / 1e8 : item
  }))
}

async function assertDxfFidelity(sdk, document) {
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  assert.equal(reopened.validate().valid, true)
  assert.equal(reopened.listEntities().length, document.listEntities().length)
  const byHandle = new Map(reopened.listEntities().map(entity => [entity.handle, entity]))
  for (const expected of document.listEntities()) {
    const actual = byHandle.get(expected.handle)
    assert.ok(actual, 'DXF retains every object handle')
    assert.equal(actual.type, expected.type)
    assert.deepEqual(dxfPayload(actual.payload), dxfPayload(expected.payload), 'DXF retains native geometry, hatch pattern and text')
    for (const key of ['layerId', 'linetypeId', 'styleId', 'blockRecordId']) {
      const expectedName = document.getObject(expected.payload[key])?.name
      const actualName = reopened.getObject(actual.payload[key])?.name
      assert.equal(actualName, expectedName, `DXF retains named resource: ${key}`)
    }
  }
  return reopened
}

async function createSection(locale, holes = [makeHole('ZK-A', 0), makeHole('ZK-B', 12), makeHole('ZK-C', 24)]) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const original = document.snapshot()
  const pending = await session.call('cad_propose_geology_section', {
    version: '1.0.0', units: 'millimeter', expectedRevision: 0, locale,
    holes, correlations: adjacentLinks(holes), uncorrelatedOccurrences: [],
    horizontalScaleDenominator: 200, verticalScaleDenominator: 200,
    datumElevation: 84, surfaceRule: 'straight-between-supplied-collars',
  })
  assert.equal(pending.ok, true, JSON.stringify(pending.error))
  assert.deepEqual(document.snapshot(), original, 'creation proposal does not persist source facts')
  assert.equal((await session.approve(pending.value.planId, 'human-reviewer')).ok, true)
  const listing = await session.call('cad_read_geology_source', {
    expectedRevision: document.revision, drawingId: '', maxBytes: 8192,
  })
  assert.equal(listing.ok, true, JSON.stringify(listing.error))
  assert.equal(listing.value.drawingIds.length, 1)
  const [drawingId] = listing.value.drawingIds
  await sdk.executeCommand('CREATE', {
    type: 'CIRCLE', payload: { center: [620, 640, 0], radius: 3.5 }, options: { id: 'manual-section-review' },
  }, { document })
  const manual = document.getObject('manual-section-review')
  assert.ok(manual)
  return { sdk, document, session, drawingId, manual }
}

function checkHoleHatches(document, recipe) {
  // Each column HATCH is a rectangle. Check its thickness against the source
  // directly, without using a second compiler invocation as an oracle.
  const scale = 1000 / recipe.source.input.verticalScaleDenominator
  const rectangularHatches = recipe.entityIds.map(id => document.getObject(id)).filter(entity => {
    if (entity.type !== 'HATCH' || entity.payload.solid) return false
    const points = entity.payload.boundaryLoops?.[0]?.vertices?.map(vertex => vertex.point)
    if (!points || points.length !== 4) return false
    const width = Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]))
    return width < 20 && new Set(points.map(point => point[0])).size === 2
      && new Set(points.map(point => point[1])).size === 2
  })
  const columns = [...new Set(rectangularHatches.map(entity => {
    const xs = entity.payload.boundaryLoops[0].vertices.map(vertex => vertex.point[0])
    return (Math.min(...xs) + Math.max(...xs)) / 2
  }))].sort((a, b) => a - b)
  assert.equal(columns.length, recipe.source.input.holes.length)
  const collars = new Map()
  for (const [index, hole] of recipe.source.input.holes.entries()) {
    const fills = rectangularHatches.filter(entity => {
      const xs = entity.payload.boundaryLoops[0].vertices.map(vertex => vertex.point[0])
      return Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - columns[index]) < 1e-8
    }).sort((a, b) => Math.max(...b.payload.boundaryLoops[0].vertices.map(v => v.point[1]))
      - Math.max(...a.payload.boundaryLoops[0].vertices.map(v => v.point[1])))
    assert.equal(fills.length, hole.strata.length, `${hole.id}: one native hatch per supplied interval`)
    collars.set(hole.id, { x: columns[index], y: Math.max(...fills[0].payload.boundaryLoops[0].vertices.map(vertex => vertex.point[1])) })
    for (const [layerIndex, fill] of fills.entries()) {
      const ys = fill.payload.boundaryLoops[0].vertices.map(vertex => vertex.point[1])
      const stratum = hole.strata[layerIndex]
      nearly(Math.max(...ys) - Math.min(...ys), (stratum.bottom - stratum.top) * scale,
        `${hole.id}/${stratum.intervalId} thickness`)
    }
  }
  const { holes, correlations, horizontalScaleDenominator } = recipe.source.input
  const anchor = collars.get(holes[0].id)
  for (const hole of holes) {
    const collar = collars.get(hole.id)
    nearly(collar.x - anchor.x, (hole.station - holes[0].station) * 1000 / horizontalScaleDenominator, 'supplied station to hole center')
    nearly(collar.y - anchor.y, (hole.collarElevation - holes[0].collarElevation) * scale, 'supplied collar elevation to section height')
  }
  const entities = recipe.entityIds.map(id => document.getObject(id))
  const bands = entities.filter(entity => entity.type === 'HATCH' && !entity.payload.solid
    && entity.payload.boundaryLoops?.[0]?.vertices && (() => {
      const xs = entity.payload.boundaryLoops[0].vertices.map(vertex => vertex.point[0])
      return Math.max(...xs) - Math.min(...xs) > 20
    })())
  assert.equal(bands.length, correlations.length, 'no invented filled band for explicitly unlinked intervals')
  const pointEqual = (left, right) => Math.abs(left[0] - right[0]) < 1e-7 && Math.abs(left[1] - right[1]) < 1e-7
  for (const link of correlations) {
    const left = holes.find(hole => hole.id === link.fromHoleId), right = holes.find(hole => hole.id === link.toHoleId)
    const from = left.strata.find(layer => layer.intervalId === link.fromIntervalId)
    const to = right.strata.find(layer => layer.intervalId === link.toIntervalId)
    const leftCollar = collars.get(left.id), rightCollar = collars.get(right.id)
    const topLeft = [leftCollar.x, leftCollar.y - from.top * scale]
    const topRight = [rightCollar.x, rightCollar.y - to.top * scale]
    const bottomLeft = [leftCollar.x, leftCollar.y - from.bottom * scale]
    const bottomRight = [rightCollar.x, rightCollar.y - to.bottom * scale]
    for (const [start, end] of [[topLeft, topRight], [bottomLeft, bottomRight]])
      assert.ok(entities.some(entity => entity.type === 'LINE' && pointEqual(entity.payload.start, start)
        && pointEqual(entity.payload.end, end)), 'explicit interval boundary terminates at the actual two hole centers')
    const expected = [bottomLeft, bottomRight, topRight, topLeft]
    assert.ok(bands.some(entity => {
      const actual = entity.payload.boundaryLoops[0].vertices.map(vertex => vertex.point)
      return actual.length === expected.length && actual.every((point, index) => pointEqual(point, expected[index]))
    }), 'native band outline follows the two explicit source interval depths')
  }
}

for (const locale of ['zh-CN', 'en']) test(`${locale}: section source journey covers reviewed edits, explicit links and exact reopen`, async t => {
  const { sdk, document, session, drawingId, manual } = await createSection(locale)
  const initial = readGeologyDrawingRecipe(document, drawingId).source.input
  const middleId = 'ZK-B'
  const steps = [
    { name: 'correct collar elevation', update: hole => ({ holeId: hole.id, collarElevation: 104.2 }) },
    { name: 'deepen borehole with explicit final interval', update: hole => ({ holeId: hole.id, depth: 18,
      strata: hole.strata.map((layer, index) => index === hole.strata.length - 1 ? { ...layer, bottom: 18 } : layer) }) },
    { name: 'correct one boundary and preserve continuity', update: hole => ({ holeId: hole.id,
      strata: hole.strata.map((layer, index) => index === 0 ? { ...layer, bottom: 2.6 } : index === 1 ? { ...layer, top: 2.6 } : layer) }) },
    { name: 'correct measured stable water depth', update: hole => ({ holeId: hole.id, stableWaterDepth: 6.25 }) },
    { name: 'replace sample list with retained sample and supplied SPT', update: hole => ({ holeId: hole.id,
      observations: [...hole.observations, { kind: 'spt', id: `${hole.id}-N1`, depth: 11.5, value: 21 }] }) },
    { name: 'correct SPT measured blow count', update: hole => ({ holeId: hole.id,
      observations: hole.observations.map(item => item.kind === 'spt' ? { ...item, value: 27 } : item) }) },
    { name: 'correct sample depth', update: hole => ({ holeId: hole.id,
      observations: hole.observations.map(item => item.kind === 'sample' ? { ...item, depth: 5.85 } : item) }) },
    { name: 'split one interval with caller-declared unlinked occurrences', update: hole => ({ holeId: hole.id,
      strata: hole.strata.flatMap(layer => layer.intervalId !== `${hole.id}-b` ? [layer] : [
        { ...layer, bottom: 6 }, { ...layer, intervalId: `${hole.id}-b-extra`, top: 6 },
      ]) }), uncorrelated: [
      { holeId: middleId, adjacentHoleId: 'ZK-A', intervalId: `${middleId}-b-extra` },
      { holeId: middleId, adjacentHoleId: 'ZK-C', intervalId: `${middleId}-b-extra` },
    ] },
    { name: 'merge only the previously split interval', update: hole => ({ holeId: hole.id,
      strata: hole.strata.filter(layer => layer.intervalId !== `${hole.id}-b-extra`)
        .map(layer => layer.intervalId === `${hole.id}-b` ? { ...layer, bottom: 9 } : layer) }), uncorrelated: [] },
    { name: 'correct lithology and explicitly withdraw incompatible correlations', update: hole => ({ holeId: hole.id,
      strata: hole.strata.map(layer => layer.intervalId === `${hole.id}-b` ? { ...layer, name: '粉质黏土', lithology: 'silty-clay' } : layer) }),
      correlations: current => current.filter(link => !link.fromIntervalId.endsWith('-b') && !link.toIntervalId.endsWith('-b')),
      uncorrelated: [
        { holeId: middleId, adjacentHoleId: 'ZK-A', intervalId: `${middleId}-b` },
        { holeId: middleId, adjacentHoleId: 'ZK-C', intervalId: `${middleId}-b` },
        { holeId: 'ZK-A', adjacentHoleId: middleId, intervalId: 'ZK-A-b' },
        { holeId: 'ZK-C', adjacentHoleId: middleId, intervalId: 'ZK-C-b' },
      ] },
    { name: 'correct measured station', update: hole => ({ holeId: hole.id, station: 13.5 }) },
    { name: 'remove unsupported reading explicitly', update: hole => ({ holeId: hole.id, clearFields: ['stableWaterDepth'] }) },
    { name: 'remove sample and SPT annotations explicitly', update: hole => ({ holeId: hole.id, clearFields: ['observations'] }) },
    { name: 'restore compatible stratum and caller-confirmed links', update: hole => ({ holeId: hole.id,
      strata: hole.strata.map(layer => layer.intervalId === `${hole.id}-b` ? { ...layer, name: '黏土', lithology: 'clay' } : layer) }),
      correlations: () => initial.correlations, uncorrelated: [] },
    { name: 'add a new stable water measurement', update: hole => ({ holeId: hole.id, stableWaterDepth: 7.25 }) },
    { name: 'add newly supplied sample and SPT measurements', update: hole => ({ holeId: hole.id, observations: [
      { kind: 'sample', id: `${hole.id}-S2`, depth: 8.25 }, { kind: 'spt', id: `${hole.id}-N2`, depth: 12.5, value: 30 },
    ] }) },
    { name: 'correct SPT depth without losing the sample', update: hole => ({ holeId: hole.id,
      observations: hole.observations.map(item => item.kind === 'spt' ? { ...item, depth: 13.5 } : item) }) },
    { name: 'shorten hole and final interval consistently', update: hole => ({ holeId: hole.id, depth: 17.5,
      strata: hole.strata.map((layer, index) => index === hole.strata.length - 1 ? { ...layer, bottom: 17.5 } : layer) }) },
    { name: 'correct lower boundary on both adjoining intervals', update: hole => ({ holeId: hole.id,
      strata: hole.strata.map(layer => layer.intervalId.endsWith('-b') ? { ...layer, bottom: 9.2 }
        : layer.intervalId.endsWith('-c') ? { ...layer, top: 9.2 } : layer) }) },
    { name: 'refine station without changing neighboring hole facts', update: hole => ({ holeId: hole.id, station: 13.75 }) },
  ]
  for (const step of steps) {
    const sourceRead = await session.call('cad_read_geology_source', {
      expectedRevision: document.revision, drawingId, maxBytes: 262144,
    })
    assert.equal(sourceRead.ok, true, JSON.stringify(sourceRead.error))
    assert.equal(sourceRead.value.measurementsVerified, false)
    const beforeRecipe = readGeologyDrawingRecipe(document, drawingId)
    const currentHole = beforeRecipe.source.input.holes.find(hole => hole.id === middleId)
    const before = content(document), revision = document.revision
    const proposal = await session.call('cad_propose_geology_revision', {
      units: 'millimeter', expectedRevision: revision, drawingId,
      updates: [step.update(structuredClone(currentHole))],
      ...(step.uncorrelated ? { uncorrelatedOccurrences: step.uncorrelated } : {}),
      ...(step.correlations ? { correlations: step.correlations(beforeRecipe.source.input.correlations) } : {}),
    })
    assert.equal(proposal.ok, true, `${step.name}: ${JSON.stringify(proposal.error)}`)
    assert.deepEqual(content(document), before, `${step.name}: review precedes mutation`)
    const oldObjects = new Map(document.listEntities().map(entity => [entity.id, entity]))
    assert.equal((await session.approve(proposal.value.planId, 'human-reviewer')).ok, true, step.name)
    assert.equal(document.revision, revision + 1, `${step.name}: one transaction`)
    assert.equal((await session.approve(proposal.value.planId, 'human-reviewer')).ok, false, 'no approval replay')
    const recipe = readGeologyDrawingRecipe(document, drawingId)
    for (const hole of recipe.source.input.holes.filter(hole => hole.id !== middleId))
      assert.deepEqual(hole, initial.holes.find(originalHole => originalHole.id === hole.id), 'other borehole facts stay exact')
    assert.deepEqual(document.getObject(manual.id), manual, 'manual content stays exact')
    const retained = recipe.entityIds.filter(id => oldObjects.has(id))
    assert.ok(retained.length > 0)
    for (const id of retained) assert.deepEqual(document.getObject(id), oldObjects.get(id), 'retained object is byte-for-byte unchanged')
    assert.equal(document.listEntities().length, recipe.entityIds.length + 1, 'no accumulation of abandoned geometry')
    checkHoleHatches(document, recipe)
    const after = content(document)
    await document.undo(); assert.deepEqual(content(document), before, `${step.name}: undo restores source and geometry`)
    await document.redo(); assert.deepEqual(content(document), after, `${step.name}: redo restores source and geometry`)
    const reopened = await assertDxfFidelity(sdk, document)
    assert.throws(() => readGeologyDrawingRecipe(reopened, drawingId), 'DXF is geometry-only, not certified source recovery')
  }
  t.diagnostic('20 consecutive reviewed section revisions; 20 full-entity DXF fidelity checks; 0 language-model calls')
})

for (const locale of ['zh-CN', 'en']) for (const kind of ['column', 'section'])
  test(`${locale}/${kind}: shortening never silently clips water, sample, SPT or strata facts`, async () => {
    const originalHole = { ...makeHole('ZK-B', 12), stableWaterDepth: 14.25, observations: [
      { kind: 'sample', id: 'ZK-B-S1', depth: 15 }, { kind: 'spt', id: 'ZK-B-N1', depth: 15.5, value: 20 },
    ] }
    let fixture
    if (kind === 'section') fixture = await createSection(locale, [makeHole('ZK-A', 0), originalHole, makeHole('ZK-C', 24)])
    else {
      const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
      const session = new KJAgentToolSession(sdk, document)
      const initial = await session.call('cad_propose_geology_column', {
        version: '1.0.0', units: 'millimeter', expectedRevision: 0, locale, hole: originalHole,
      })
      assert.equal(initial.ok, true, JSON.stringify(initial.error))
      assert.equal((await session.approve(initial.value.planId, 'human-reviewer')).ok, true)
      const listing = await session.call('cad_read_geology_source', {
        expectedRevision: document.revision, drawingId: '', maxBytes: 8192,
      })
      assert.equal(listing.ok, true)
      fixture = { sdk, document, session, drawingId: listing.value.drawingIds[0] }
    }
    const { sdk, document, session, drawingId } = fixture
    const shortened = {
      holeId: originalHole.id, depth: 12, stableWaterDepth: 7.25,
      strata: originalHole.strata.map((layer, index) => index === 2 ? { ...layer, bottom: 12 } : layer),
      observations: [
        { kind: 'sample', id: 'ZK-B-S1', depth: 10 }, { kind: 'spt', id: 'ZK-B-N1', depth: 11, value: 20 },
      ],
    }
    const invalid = [
      { name: 'stable water below new hole bottom', changes: { stableWaterDepth: 14.25 } },
      { name: 'sample below new hole bottom', changes: { observations: [
        { ...shortened.observations[0], depth: 15 }, shortened.observations[1],
      ] } },
      { name: 'SPT below new hole bottom', changes: { observations: [
        shortened.observations[0], { ...shortened.observations[1], depth: 15.5 },
      ] } },
      { name: 'final stratum below new hole bottom', changes: { strata: originalHole.strata } },
    ]
    for (const { name, changes } of invalid) {
      const before = document.snapshot()
      const rejected = await session.call('cad_propose_geology_revision', {
        units: 'millimeter', expectedRevision: document.revision, drawingId,
        updates: [{ ...shortened, ...changes }],
      })
      assert.equal(rejected.ok, false, name)
      assert.deepEqual(document.snapshot(), before, `${name}: reject the entire request instead of clipping source facts`)
    }
    const before = content(document), revision = document.revision
    const pending = await session.call('cad_propose_geology_revision', {
      units: 'millimeter', expectedRevision: revision, drawingId, updates: [shortened],
    })
    assert.equal(pending.ok, true, JSON.stringify(pending.error))
    assert.deepEqual(content(document), before)
    assert.equal((await session.approve(pending.value.planId, 'human-reviewer')).ok, true)
    assert.equal(document.revision, revision + 1)
    const recipe = readGeologyDrawingRecipe(document, drawingId)
    const revisedHole = kind === 'column' ? recipe.source.input.hole : recipe.source.input.holes[1]
    for (const key of ['depth', 'stableWaterDepth', 'strata', 'observations']) assert.deepEqual(revisedHole[key], shortened[key])
    if (kind === 'section') {
      checkHoleHatches(document, recipe)
      for (const hole of recipe.source.input.holes.filter(item => item.id !== originalHole.id))
        assert.deepEqual(hole, makeHole(hole.id, hole.station), 'unlisted hole facts are untouched')
      assert.deepEqual(document.getObject(fixture.manual.id), fixture.manual)
    }
    const after = content(document)
    await document.undo(); assert.deepEqual(content(document), before)
    await document.redo(); assert.deepEqual(content(document), after)
    await assertDxfFidelity(sdk, document)
  })

for (const locale of ['zh-CN', 'en']) test(`${locale}: one reviewed batch revises exactly two named section boreholes`, async () => {
  const { sdk, document, session, drawingId, manual } = await createSection(locale)
  const originalRecipe = readGeologyDrawingRecipe(document, drawingId)
  const updates = originalRecipe.source.input.holes.slice(0, 2).map((hole, index) => ({
    holeId: hole.id, collarElevation: 103.7 + index * 0.4, depth: 17 + index,
    stableWaterDepth: 6.25 + index,
    strata: hole.strata.map((layer, layerIndex) => layerIndex === 2 ? { ...layer, bottom: 17 + index } : layer),
    observations: [...hole.observations, { kind: 'spt', id: `${hole.id}-N-BATCH`, depth: 12.5, value: 25 + index }],
  }))
  const before = content(document), revision = document.revision
  const pending = await session.call('cad_propose_geology_revision', {
    units: 'millimeter', expectedRevision: revision, drawingId, updates,
  })
  assert.equal(pending.ok, true, JSON.stringify(pending.error))
  assert.deepEqual(content(document), before, 'batch is only proposed until reviewed')
  assert.equal((await session.approve(pending.value.planId, 'human-reviewer')).ok, true)
  assert.equal(document.revision, revision + 1, 'two hole changes are one undoable transaction')
  const recipe = readGeologyDrawingRecipe(document, drawingId)
  for (const update of updates) {
    const hole = recipe.source.input.holes.find(item => item.id === update.holeId)
    for (const key of ['collarElevation', 'depth', 'stableWaterDepth', 'strata', 'observations']) assert.deepEqual(hole[key], update[key])
  }
  assert.deepEqual(recipe.source.input.holes[2], originalRecipe.source.input.holes[2], 'third hole is not modified')
  assert.deepEqual(recipe.source.input.correlations, originalRecipe.source.input.correlations, 'unchanged caller correlations are retained')
  assert.deepEqual(document.getObject(manual.id), manual)
  checkHoleHatches(document, recipe)
  const after = content(document)
  await document.undo(); assert.deepEqual(content(document), before)
  await document.redo(); assert.deepEqual(content(document), after)
  await assertDxfFidelity(sdk, document)
})

test('section revisions reject missing, duplicate and invented correlations atomically', async () => {
  const { document, session, drawingId } = await createSection('zh-CN')
  const recipe = readGeologyDrawingRecipe(document, drawingId)
  const middle = recipe.source.input.holes[1]
  const base = { units: 'millimeter', expectedRevision: document.revision, drawingId,
    updates: [{ holeId: middle.id, collarElevation: 104 }] }
  const split = middle.strata.flatMap(layer => layer.intervalId !== 'ZK-B-b' ? [layer] : [
    { ...layer, bottom: 6 }, { ...layer, intervalId: 'ZK-B-new', top: 6 },
  ])
  const cases = [
    { ...base, updates: [{ holeId: middle.id, strata: split }] },
    { ...base, correlations: [...recipe.source.input.correlations, recipe.source.input.correlations[0]] },
    { ...base, correlations: recipe.source.input.correlations.map((link, index) => index === 0
      ? { ...link, fromIntervalId: 'invented-interval' } : link) },
    { ...base, updates: [{ holeId: middle.id, depth: 8 }] },
    { ...base, updates: [{ holeId: 'invented-hole', collarElevation: 104 }] },
    { ...base, updates: [{ holeId: middle.id, strata: middle.strata.map(layer => layer.intervalId === 'ZK-B-b'
      ? { ...layer, lithology: 'rock', name: '岩石' } : layer) }] },
    { ...base, updates: [{ holeId: middle.id, groundwaterObservations: [
      { depth: 4, elevation: 99.5, observedOn: '2026-10-01', marker: 'filled-down-triangle' },
    ] }] },
  ]
  for (const args of cases) {
    const before = document.snapshot()
    const proposal = await session.call('cad_propose_geology_revision', args)
    assert.equal(proposal.ok, false)
    assert.deepEqual(document.snapshot(), before, 'rejected facts cannot partially change the drawing')
  }
})
