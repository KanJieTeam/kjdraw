import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologyColumn, compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { registerGeologyDrawingRecipe, readGeologyDrawingRecipe, prepareGeologyDrawingRevision, applyGeologyDrawingRevision } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'

const borehole = (id, station = 0) => ({ id, station, collarElevation: 105.25, depth: 16,
  strata: [
    { intervalId: `${id}-a`, code: '1', name: '填土', top: 0, bottom: 3, lithology: 'fill' },
    { intervalId: `${id}-b`, code: '2', name: '黏土', top: 3, bottom: 9, lithology: 'clay' },
    { intervalId: `${id}-c`, code: '3', name: '砂土', top: 9, bottom: 16, lithology: 'sand' },
  ] })
const compile = source => source.kind === 'column' ? compileGeologyColumn(source.input) : compileGeologySection(source.input)
const content = document => ({ objects: document.snapshot().objects, tables: document.snapshot().tables,
  opaquePayloads: document.snapshot().opaquePayloads, spaces: document.snapshot().spaces })
async function setup(source) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', structuredClone(compile(source).commandArgs), { document })
  const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [600, 600, 0], radius: 4 }, options: { id: 'manual-circle' } }, { document })
  const manual = document.listEntities({ type: 'CIRCLE' }).find(item => item.payload.radius === 4)
  assert.ok(manual)
  return { sdk, document, recipe, manual }
}
function revise(source, round) {
  const holes = source.kind === 'column' ? [source.input.hole] : source.input.holes
  for (const hole of holes) {
    if (round === 0) { hole.depth = 18; hole.strata[2].bottom = 18 }
    if (round === 1) hole.collarElevation += 0.5
    if (round === 2) hole.stableWaterDepth = 4.4
    if (round === 3) { hole.strata[0].bottom = 2.5; hole.strata[1].top = 2.5 }
    if (round === 4) { hole.strata[1].bottom = 10; hole.strata[2].top = 10 }
    if (round === 5) hole.observations = [{ kind: 'sample', id: 'S1', depth: 5 }]
    if (round === 6) hole.observations.push({ kind: 'spt', id: 'N1', depth: 12, value: 18 })
    if (round === 7) { hole.strata[1].name = '黄土'; hole.strata[1].lithology = 'loess' }
    if (round === 8) { hole.strata[2].bottom = 14; hole.strata.push({ intervalId: `${hole.id}-d`, code: '4', name: '砾砂', top: 14, bottom: 18, lithology: 'gravel' }) }
    if (round === 9) { hole.strata.pop(); hole.strata[2].bottom = 18 }
  }
  if (source.kind === 'section') source.input.correlations = holes[0].strata.map((layer, index) => ({
    fromHoleId: holes[0].id, toHoleId: holes[1].id,
    fromIntervalId: layer.intervalId, toIntervalId: holes[1].strata[index].intervalId,
  }))
}

for (const kind of ['column', 'section']) test(`${kind}: ten same-document source revisions preserve manual objects, undo/redo and reopen`, async () => {
  const source = kind === 'column'
    ? { kind, input: { hole: borehole('ZK01'), locale: 'zh-CN', expectedRevision: 0 } }
    : { kind, input: { holes: [borehole('ZK01'), borehole('ZK02', 12)], correlations: [],
      horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 85,
      surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 } }
  if (kind === 'section') source.input.correlations = source.input.holes[0].strata.map((layer, index) => ({
    fromHoleId: 'ZK01', toHoleId: 'ZK02', fromIntervalId: layer.intervalId, toIntervalId: source.input.holes[1].strata[index].intervalId,
  }))
  const { sdk, document, manual } = await setup(source)
  let recipe = readGeologyDrawingRecipe(document, compile(source).evidence.rootObjectId)
  for (let round = 0; round < 10; round++) {
    revise(source, round)
    const before = content(document), revision = document.revision
    const preview = prepareGeologyDrawingRevision(document, recipe, source, { expectedRevision: revision })
    assert.deepEqual(content(document), before, 'preview cannot edit or save source facts')
    assert.ok(preview.createdIds.length + preview.removedIds.length > 0)
    assert.ok(preview.unchangedIds.length > 0, 'unchanged exact geometry retains IDs')
    const retained = preview.unchangedIds.map(id => document.getObject(id))
    const result = await applyGeologyDrawingRevision(document, recipe, source, { expectedRevision: revision })
    assert.equal(document.revision, revision + 1)
    assert.deepEqual(document.getObject(manual.id), manual)
    for (const entity of retained) assert.deepEqual(document.getObject(entity.id), entity)
    const after = content(document)
    await document.undo(); assert.deepEqual(content(document), before, 'undo restores geometry and source facts together')
    await document.redo(); assert.deepEqual(content(document), after)
    recipe = readGeologyDrawingRecipe(document, result.recipe.drawingId)
    assert.deepEqual(recipe.source, source)
    assert.ok(document.listEntities({ type: 'HATCH' }).length > 0)
    if (kind === 'column') {
      // Independent source-to-geometry check, not a self-comparison of compiler outputs.
      const scale = result.evidence.parameters.verticalScaleDenominator
      const fills = recipe.entityIds.map(id => document.getObject(id)).filter(item => item.type === 'HATCH' && !item.payload.solid).slice(0, source.input.hole.strata.length)
      assert.equal(fills.length, source.input.hole.strata.length)
      for (const [index, fill] of fills.entries()) {
        const y = fill.payload.boundaryLoops[0].vertices.map(vertex => vertex.point[1])
        const stratum = source.input.hole.strata[index]
        const expectedThickness = (stratum.bottom - stratum.top) * 1000 / scale
        assert.ok(Math.abs(Math.max(...y) - Math.min(...y) - expectedThickness) < 1e-8, `native hatch thickness follows source data in round ${round + 1}: actual=${Math.max(...y) - Math.min(...y)}, expected=${expectedThickness}, scale=${scale}`)
      }
    }
    for (const format of ['KJD', 'DXF']) {
      const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
      assert.equal(reopened.validate().valid, true)
      assert.equal(reopened.listEntities().length, document.listEntities().length)
      assert.equal(reopened.listEntities({ type: 'HATCH' }).length, document.listEntities({ type: 'HATCH' }).length)
      if (format === 'KJD') assert.deepEqual(readGeologyDrawingRecipe(reopened, recipe.drawingId), recipe)
      else assert.ok(reopened.listEntities().some(item => item.handle === manual.handle), 'manual DXF handle remains stable')
    }
  }
})

test('source revision rejects stale input, invalid strata, changed geometry and protected resources atomically', async () => {
  const original = { kind: 'column', input: { hole: borehole('ZK01'), expectedRevision: 0 } }
  for (const mode of ['stale', 'invalid', 'manual-edit', 'locked', 'external-reference', 'accessor', 'cycle']) {
    const { sdk, document, recipe } = await setup(original), next = structuredClone(original)
    revise(next, 3)
    if (mode === 'invalid') next.input.hole.strata[1].top = 2
    if (mode === 'manual-edit') await sdk.executeCommand('MOVE', { ids: [recipe.entityIds[0]], dx: 1, dy: 0 }, { document })
    if (mode === 'locked') await document.transact('Lock generated layer', tx => tx.updateObject(`${recipe.resourceRoot}-layer-0`, { payload: { locked: true } }))
    if (mode === 'external-reference') {
      const preview = prepareGeologyDrawingRevision(document, recipe, next, { expectedRevision: document.revision })
      await document.transact('External reference', tx => tx.putOpaquePayload('external-link', { id: preview.removedIds[0] }))
    }
    if (mode === 'accessor') Object.defineProperty(next.input.hole, 'depth', { enumerable: true, get() { throw new Error('must not run getter') } })
    if (mode === 'cycle') next.input.extra = next
    const before = document.snapshot(), revision = document.revision
    await assert.rejects(applyGeologyDrawingRevision(document, recipe, next, { expectedRevision: mode === 'stale' ? revision - 1 : revision }), undefined, mode)
    assert.deepEqual(document.snapshot(), before, mode)
  }
})

test('an imported geometry-only drawing cannot manufacture a geology source recipe', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [100, 0, 0] } }, { document })
  await assert.rejects(registerGeologyDrawingRecipe(document, { kind: 'column', input: { hole: borehole('ZK01'), expectedRevision: 0 } }, { expectedRevision: document.revision }))
  assert.equal(Object.keys(document.snapshot().opaquePayloads).length, 0)
})

test('AI tools create source-backed geometry atomically and revise data with human approval', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  let session = new KJAgentToolSession(sdk, document)
  const proposal = await session.call('cad_propose_geology_column', { version: '1.0.0', units: 'millimeter', expectedRevision: 0, hole: borehole('ZK01') })
  assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
  assert.equal(document.revision, 0)
  assert.equal(Object.keys(document.snapshot().opaquePayloads).length, 0, 'unapproved source facts cannot persist')
  assert.equal((await session.approve(proposal.value.planId, 'human')).ok, true)
  assert.equal(document.revision, 1, 'initial source and drawing are one transaction')
  session = new KJAgentToolSession(sdk, document)
  const listing = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId: '', maxBytes: 8192 })
  assert.equal(listing.ok, true)
  assert.equal(listing.value.drawingIds.length, 1)
  const drawingId = listing.value.drawingIds[0]
  for (let round = 0; round < 10; round++) {
    const read = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId, maxBytes: 262144 })
    assert.equal(read.ok, true, JSON.stringify(read.error))
    assert.equal(read.value.measurementsVerified, false)
    assert.equal(read.value.units, 'millimeter', 'existing CAD units remain API-compatible')
    assert.equal(read.value.drawingUnits, 'millimeter')
    assert.equal(read.value.sourceUnits, 'meter', 'measured source depths are not CAD coordinates')
    assert.equal(read.value.depthConvention, 'depth-below-collar')
    assert.equal(read.value.sourceFieldUnits.collarElevation, 'meter')
    assert.equal(read.value.sourceFieldUnits['strata.bottom'], 'meter')
    assert.equal(read.value.sourceFieldUnits['observations.value'], 'observation-specific', 'blow counts are not lengths')
    const original = document.snapshot()
    const update = await session.call('cad_propose_geology_revision', { units: 'millimeter', expectedRevision: document.revision,
      drawingId, updates: [{ holeId: 'ZK01', collarElevation: 105.25 + (round + 1) * 0.1 }] })
    assert.equal(update.ok, true, JSON.stringify(update.error))
    assert.equal(update.value.status, 'awaiting-host-approval')
    assert.deepEqual(document.snapshot(), original)
    assert.equal(update.value.engineeringEvidence.afterSource.facts.hole.collarElevation, 105.25 + (round + 1) * 0.1)
    assert.equal((await session.approve(update.value.planId, 'human')).ok, true)
    assert.equal(document.revision, original.revision + 1)
    assert.equal((await session.approve(update.value.planId, 'human')).ok, false, 'approval must not replay')
    assert.equal(readGeologyDrawingRecipe(document, drawingId).source.input.hole.collarElevation, 105.25 + (round + 1) * 0.1)
  }
  const stale = await session.call('cad_propose_geology_revision', { units: 'millimeter', expectedRevision: document.revision - 1, drawingId,
    updates: [{ holeId: 'ZK01', collarElevation: 110 }] })
  assert.equal(stale.ok, false)
  const next = await session.call('cad_propose_geology_revision', { units: 'millimeter', expectedRevision: document.revision, drawingId,
    updates: [{ holeId: 'ZK01', collarElevation: 110 }] })
  assert.equal(next.ok, true)
  const unchanged = document.snapshot()
  assert.equal(session.reject(next.value.planId, 'human').ok, true)
  assert.equal((await session.approve(next.value.planId, 'human')).ok, false)
  assert.deepEqual(document.snapshot(), unchanged)
})

test('1,000 deterministic same-document depth/boundary revisions preserve unrelated objects and bounded entity count', async () => {
  const source = { kind: 'column', input: { hole: borehole('ZK-SOAK'), expectedRevision: 0 } }
  const { sdk, document, manual } = await setup(source)
  let recipe = readGeologyDrawingRecipe(document, compile(source).evidence.rootObjectId)
  for (let round = 0; round < 1000; round++) {
    source.input.hole.depth = 16 + ((round + 1) % 20) * 0.1
    source.input.hole.strata[2].bottom = source.input.hole.depth
    const result = await applyGeologyDrawingRevision(document, recipe, source, { expectedRevision: document.revision })
    recipe = result.recipe
    assert.deepEqual(document.getObject(manual.id), manual)
    assert.equal(document.listEntities().length, recipe.entityIds.length + 1, 'rebuild must not accumulate old entities')
    if (round % 100 === 0) {
      const contentAfter = content(document)
      await document.undo(); await document.redo()
      assert.deepEqual(content(document), contentAfter)
      for (const format of ['KJD', 'DXF']) {
        const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
        assert.equal(reopened.validate().valid, true)
        assert.equal(reopened.listEntities().length, document.listEntities().length)
      }
    }
  }
})

for (const locale of ['zh-CN', 'en']) test(locale + ': default column displays both supplied water readings and reviewed clears remove only requested source facts', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const hole = { ...borehole('ZK-WATER'), initialWaterDepth: 4.25, stableWaterDepth: 5.75 }
  const initial = await session.call('cad_propose_geology_column', {
    version: '1.0.0', units: 'millimeter', expectedRevision: 0, locale, hole,
  })
  assert.equal(initial.ok, true, JSON.stringify(initial.error))
  assert.equal((await session.approve(initial.value.planId, 'human')).ok, true)
  const texts = () => document.listEntities({ type: 'TEXT' }).map(entity => entity.payload.text)
  const contains = value => texts().some(text => text.includes(value))
  for (const value of locale === 'zh-CN' ? ['初见水位(m)', '稳定水位(m)', '4.25', '5.75'] : ['INITIAL WATER', 'STABLE WATER', '4.25', '5.75']) assert.ok(contains(value), value)
  const listing = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId: '', maxBytes: 8192 })
  const [drawingId] = listing.value.drawingIds
  const before = document.snapshot()
  const conflict = await session.call('cad_propose_geology_revision', {
    units: 'millimeter', expectedRevision: document.revision, drawingId,
    updates: [{ holeId: hole.id, stableWaterDepth: 3, clearFields: ['stableWaterDepth'] }],
  })
  assert.equal(conflict.ok, false)
  assert.deepEqual(document.snapshot(), before)
  const pending = await session.call('cad_propose_geology_revision', {
    units: 'millimeter', expectedRevision: document.revision, drawingId,
    updates: [{ holeId: hole.id, clearFields: ['initialWaterDepth'] }],
  })
  assert.equal(pending.ok, true, JSON.stringify(pending.error))
  assert.deepEqual(document.snapshot(), before)
  assert.equal((await session.approve(pending.value.planId, 'human')).ok, true)
  assert.equal(readGeologyDrawingRecipe(document, drawingId).source.input.hole.initialWaterDepth, undefined)
  assert.equal(readGeologyDrawingRecipe(document, drawingId).source.input.hole.stableWaterDepth, 5.75)
  assert.ok(!contains('4.25'))
  assert.ok(contains('5.75'))
  await document.undo()
  assert.equal(readGeologyDrawingRecipe(document, drawingId).source.input.hole.initialWaterDepth, 4.25)
  assert.ok(contains('4.25'))
})
