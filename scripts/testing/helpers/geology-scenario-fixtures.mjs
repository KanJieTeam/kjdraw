import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn, compileGeologySection } from '../../../packages/kjdraw-sdk/src/geology-engineering.js'
import { registerGeologyDrawingRecipe, readGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../../../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'

export const PUBLIC_FIXTURE_IDS = Object.freeze([
  'synthetic-dxf-model-v1', 'synthetic-source-column-v1', 'synthetic-source-section-v1',
])

const GRAPHICS = [
  ['LINE-A', 'LINE', { start: [0, 0, 0], end: [20, 0, 0] }],
  ['LINE-B', 'LINE', { start: [20, 0, 0], end: [20, 10, 0] }],
  ['CIRCLE-A', 'CIRCLE', { center: [0, 0, 0], radius: 4 }],
  ['CIRCLE-MANUAL', 'CIRCLE', { center: [90, 90, 0], radius: 3 }],
  ['POLY-A', 'LWPOLYLINE', { vertices: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }],
  ['TEXT-A', 'TEXT', { position: [2, 2, 0], text: 'TEST-A', height: 2 }],
  ['TEXT-B', 'TEXT', { position: [22, 2, 0], text: 'TEST-B', height: 2 }],
  ['DEPTH-A', 'TEXT', { position: [2, -2, 0], text: '18.00', height: 2 }],
  ['WATER-INITIAL-A', 'TEXT', { position: [2, -5, 0], text: '初见地下水 groundwater 2.00', height: 2 }],
  ['WATER-STABLE-A', 'TEXT', { position: [2, -8, 0], text: '稳定地下水 groundwater 4.00', height: 2 }],
  ['TITLE-A', 'TEXT', { position: [0, 25, 0], text: '合成地质图 Synthetic geology', height: 2 }],
  ['MTEXT-A', 'MTEXT', { position: [30, 10, 0], text: '{\\fArial;待核对}\\P第二段：合成资料', height: 2, width: 30 }],
  ['MTEXT-B', 'MTEXT', { position: [30, 0, 0], text: '合成测试图\\P非实测资料', height: 2, width: 30 }],
]

export function fixtureStateSignature(document) {
  return canonicalStringify(document.snapshot())
}

/** Complete input identity inventory, never intent-selected targets or gold answers. */
export function scenarioFixtureInputBindings(fixture) {
  return { provenance: 'public-synthetic-input-identities', documentId: fixture.document.id, revision: fixture.initialRevision,
    identityStrategy: fixture.identityStrategy ?? 'actual-retained-kjd-native-identities',
    aliases: Object.fromEntries(Object.entries(fixture.identityAliases).map(([alias, identity]) =>
      [alias, { nativeId: identity.nativeId, handle: identity.handle }])),
    ...(fixture.suppliedInputs ? { suppliedInputs: structuredClone(fixture.suppliedInputs) } : {}) }
}

function conversationFor(prerequisites, document, fixtureId) {
  const current = `The current public synthetic fixture is ${fixtureId}, document ${document.id}, revision ${document.revision}, units ${document.snapshot().header.units}.`
  if (prerequisites.includes('conversation:prior-request-not-approved')) {
    return [{ role: 'user', content: `${current} For the earlier request, merely note a possible +1 mm X move of CIRCLE-MANUAL. Do NOT execute it, propose it, or approve it. Wait for my next complete instruction, which supersedes this deferred request.` }]
  }
  if (prerequisites.includes('conversation:existing-same-document-context')) {
    return [{ role: 'user', content: `${current} Continue using this same drawing for my next complete request. No action has been executed, proposed or approved in this conversation.` }]
  }
  return []
}

function fixtureResult(sdk, document, fixtureId, values, prerequisites) {
  return {
    sdk, document, fixtureId, provenance: 'public-synthetic-only', ...values,
    initialState: fixtureStateSignature(document), initialRevision: document.revision,
    initialEntities: structuredClone(document.listEntities()), oracleBaselineDocument: document.fork(),
    conversationSeed: conversationFor(prerequisites, document, fixtureId),
    // Only the assigned model runner can execute the actual user request.
    scenarioExecuted: false, modelCalls: 0,
    dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) },
  }
}

async function graphicsFixture(prerequisites, branch) {
  const graphics = structuredClone(GRAPHICS)
  if (branch === 'mtext-awaiting-explicit-replacement') graphics.find(([alias]) => alias === 'MTEXT-B')[2].text = '旧版图名\\P待重新核对'
  const writer = createKJDrawSDK(), original = writer.createDocument({ units: 'millimeter' })
  let layerId
  await original.transact('Construct public synthetic DXF baseline', tx => {
    layerId = tx.upsertTableRecord('layers', { name: 'PUBLIC-CAD', type: 'LAYER', payload: { visible: true, locked: false } }).id
    if (branch === 'existing-review-layer') tx.upsertTableRecord('layers', { name: 'REVIEW', type: 'LAYER', payload: { visible: true, locked: false } })
    for (const [alias, type, payload] of graphics) tx.createEntity(type, { ...structuredClone(payload), layerId }, { id: `public-fixture-${alias}` })
  })
  const originalAliases = Object.fromEntries(graphics.map(([alias]) => {
    const entity = original.getObject(`public-fixture-${alias}`)
    return [alias, { originalId: entity.id, handle: entity.handle }]
  }))
  const bytes = await writer.writeDocument(original, { format: 'DXF' })
  const sdk = createKJDrawSDK(), document = await sdk.readDocument(bytes, { format: 'DXF' })
  assert.equal(document.validate().valid, true, 'Generated DXF must actually reopen and validate')
  const byHandle = new Map(document.listEntities().map(entity => [entity.handle, entity]))
  const identityAliases = Object.fromEntries(graphics.map(([alias, type, payload]) => {
    const entity = byHandle.get(originalAliases[alias].handle)
    assert.ok(entity, `DXF handle missing: ${alias}`)
    assert.equal(entity.type, type)
    if (payload.text !== undefined) assert.equal(entity.payload.text, payload.text, `DXF raw text changed: ${alias}`)
    return [alias, { nativeId: entity.id, handle: entity.handle, type: entity.type, layerId: entity.payload.layerId,
      layerName: document.getObject(entity.payload.layerId)?.name, originalId: originalAliases[alias].originalId }]
  }))
  assert.equal(document.listEntities().length, graphics.length)
  const entityCounts = {}
  for (const [, type] of graphics) entityCounts[type] = (entityCounts[type] ?? 0) + 1
  const manifest = {
    entityCounts, entities: graphics.map(([alias, type, payload]) => ({ alias, type, payload: structuredClone(payload) })),
    exactHoleAliases: ['TEXT-A'], groundwaterAliases: ['WATER-INITIAL-A', 'WATER-STABLE-A'],
    completeMtext: GRAPHICS.find(([alias]) => alias === 'MTEXT-A')[2].text,
  }
  writer.closeDocument(original.id)
  return fixtureResult(sdk, document, PUBLIC_FIXTURE_IDS[0], { identityAliases, manifest, artifact: { format: 'DXF', bytes },
    identityStrategy: 'rebind-original-handle-to-actually-imported-native-id', sourceRecipePresent: false,
    builtFeatures: ['model-space-lines-circles-polyline', 'native-chinese-english-text', 'raw-native-mtext', 'exact-handles-and-layers'],
    unbuiltContractFeatures: ['paper-space', 'protected-layer-branches', 'persistent-selection-sets', 'owned-leader-pairs', 'native-dimensions', 'hatch-islands', 'block-graphs'] }, prerequisites)
}

function publicHole(id, prefix) {
  return { id, collarElevation: 106.5, depth: 18, initialWaterDepth: 2, stableWaterDepth: 4,
    strata: [
      { intervalId: `${prefix}-FILL`, code: '1', name: '填土', lithology: 'fill', top: 0, bottom: 3 },
      { intervalId: `${prefix}-CLAY`, code: '2', name: '黏土', lithology: 'clay', top: 3, bottom: 10 },
      { intervalId: `${prefix}-SAND`, code: '3', name: '砂土', lithology: 'sand', top: 10, bottom: 18 },
    ], observations: [{ kind: 'sample', id: id === 'TEST-A' ? 'S-A' : 'S-B', depth: 5 }, { kind: 'spt', id: id === 'TEST-A' ? 'N-A' : 'N-B', depth: 12, value: 15 }] }
}

async function sourceFixture(kind, prerequisites, branch) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const a = publicHole('TEST-A', 'I'), b = publicHole('TEST-B', 'B')
  if (prerequisites.includes('source:two-contiguous-sand-intervals')) {
    a.strata.splice(2, 1, { ...a.strata[2], intervalId: 'I-SAND-1', bottom: 14 }, { ...a.strata[2], intervalId: 'I-SAND-2', top: 14 })
  }
  let source
  if (kind === 'column') source = { kind, input: { expectedRevision: 0, units: 'millimeter', locale: 'zh-CN', hole: a } }
  else {
    delete a.initialWaterDepth; delete b.initialWaterDepth
    a.station = 0; b.station = 20; b.collarElevation = 107.5
    source = { kind, input: { expectedRevision: 0, units: 'millimeter', locale: 'zh-CN', holes: [a, b],
      horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 85,
      surfaceRule: 'straight-between-supplied-collars',
      ...(branch === 'complete-occurrence-map' ? { sourceFactMode: 'complete-occurrence-map' } : {}),
      correlations: a.strata.map((layer, index) => ({ fromHoleId: a.id, toHoleId: b.id, fromIntervalId: layer.intervalId, toIntervalId: b.strata[index].intervalId })),
    } }
  }
  if (branch === 'declared-sample-marker-style') {
    assert.equal(kind, 'column')
    const pack = structuredClone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
    pack.id = 'public-synthetic-sample-marker-style-v1'
    pack.title = 'Caller-declared synthetic marker layout derived from bundled redistributable styles'
    pack.rules['geology-column-layout'].sampleMarkerStyle = { height: 2, gap: 1, baselineOffset: 0 }
    source.input.columnStylePack = pack
  }
  if (branch === 'optional-water-and-description-absent') {
    delete a.initialWaterDepth; delete a.stableWaterDepth
    for (const interval of a.strata) delete interval.description
  }
  if (branch === 'explicit-source-page-scale') source.input.verticalScaleDenominator = 200
  let suppliedInputs
  if (prerequisites.includes('source:complete-split-and-correlation-table')) {
    assert.equal(kind, 'section')
    const updates = [a, b].map(hole => ({ holeId: hole.id, strata: [
      ...structuredClone(hole.strata.slice(0, 2)),
      { intervalId: hole.id === 'TEST-A' ? 'I-SAND-1' : 'B-SAND-1', code: '3-1', name: '砂土', lithology: 'sand', top: 10, bottom: 14 },
      { intervalId: hole.id === 'TEST-A' ? 'I-GRAVEL' : 'B-GRAVEL', code: '3-2', name: '砾砂', lithology: 'gravel', top: 14, bottom: 18 },
    ] }))
    const correlations = updates[0].strata.map((layer, index) => ({ fromHoleId: 'TEST-A', toHoleId: 'TEST-B',
      fromIntervalId: layer.intervalId, toIntervalId: updates[1].strata[index].intervalId }))
    suppliedInputs = { confirmedSectionSplit: { provenance: 'caller-declared-public-synthetic-not-measurement-certified',
      units: 'metre', updates, correlations } }
  }
  if (prerequisites.includes('source:complete-confirmed-replacement-table')) {
    assert.equal(kind, 'column')
    const strata = structuredClone(a.strata)
    strata[2].name = '砾质砂'; strata[2].lithology = 'gravel'
    suppliedInputs = { ...(suppliedInputs ?? {}), confirmedStrataReplacement: {
      provenance: 'caller-declared-public-synthetic-not-measurement-certified', holeId: a.id, units: 'metre', strata,
    } }
  }
  if (prerequisites.includes('source:complete-confirmed-observation-list')) {
    assert.equal(kind, 'column')
    const observations = structuredClone(a.observations)
    observations[0].depth = 5.5; observations[1].value = 18
    suppliedInputs = { ...(suppliedInputs ?? {}), confirmedObservationReplacement: {
      provenance: 'caller-declared-public-synthetic-not-measurement-certified', holeId: a.id, units: 'metre', observations,
    } }
  }
  const compiled = kind === 'column' ? compileGeologyColumn(source.input) : compileGeologySection(source.input)
  await sdk.executeCommand('CREATEBATCH', structuredClone(compiled.commandArgs), { document })
  const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
  await document.transact('Add unrelated public review circle', tx => tx.createEntity('CIRCLE', { center: [90, 90, 0], radius: 3 }, { id: 'CIRCLE-MANUAL' }))
  const retained = readGeologyDrawingRecipe(document, recipe.drawingId)
  assert.deepEqual(retained.source, source)
  assert.ok(document.listEntities({ type: 'HATCH' }).length > 0, 'Source compile must create real native hatches')
  const bytes = await sdk.writeDocument(document, { format: 'KJD' })
  const reopened = await sdk.readDocument(bytes, { format: 'KJD' })
  const recovered = readGeologyDrawingRecipe(reopened, recipe.drawingId)
  assert.deepEqual(recovered.source, source, 'Real KJD reopen must retain source facts')
  assert.equal(reopened.validate().valid, true)
  const fixtureId = kind === 'column' ? PUBLIC_FIXTURE_IDS[1] : PUBLIC_FIXTURE_IDS[2]
  return fixtureResult(sdk, reopened, fixtureId, { source, drawingId: recipe.drawingId, ...(suppliedInputs ? { suppliedInputs } : {}),
    identityAliases: { 'CIRCLE-MANUAL': { nativeId: 'CIRCLE-MANUAL', handle: reopened.getObject('CIRCLE-MANUAL').handle, type: 'CIRCLE' } },
    artifact: { format: 'KJD', bytes }, sourceRecipePresent: true,
    builtFeatures: ['actual-geology-compile', 'native-hatches', 'registered-source-recipe', 'manual-circle', 'actual-kjd-source-recovery',
      ...(prerequisites.includes('source:two-contiguous-sand-intervals') ? ['two-contiguous-same-code-sand-intervals'] : []),
      ...(suppliedInputs ? ['complete-caller-supplied-split-and-correlation-table'] : []),
      ...(branch === 'declared-sample-marker-style' ? ['caller-declared-field-grid-sample-marker-style'] : []),
      ...(branch === 'complete-occurrence-map' ? ['complete-adjacent-occurrence-map'] : [])],
    unbuiltContractFeatures: ['missing-data-branches', 'manual-drift-branches', 'protected-layers', 'split-merge-replacement-tables', 'multi-document-inventory'] }, prerequisites)
}

export async function buildPublicScenarioFixture(fixtureId, { prerequisites = [], branch } = {}) {
  if (fixtureId === PUBLIC_FIXTURE_IDS[0]) return graphicsFixture(prerequisites, branch)
  if (fixtureId === PUBLIC_FIXTURE_IDS[1]) return sourceFixture('column', prerequisites, branch)
  if (fixtureId === PUBLIC_FIXTURE_IDS[2]) return sourceFixture('section', prerequisites, branch)
  throw new Error(`No implemented public synthetic fixture builder for ${fixtureId}`)
}

export const BUILDABLE_PREREQUISITES = Object.freeze([
  ...PUBLIC_FIXTURE_IDS.map(id => `fixture:${id}`), 'fixture:synthetic-public-data-only', 'document:current-revision-known',
  'conversation:existing-same-document-context', 'conversation:prior-request-not-approved',
  'source:two-contiguous-sand-intervals', 'source:complete-split-and-correlation-table',
  'source:complete-confirmed-replacement-table', 'source:complete-confirmed-observation-list',
  'source:optional-water-and-description-absent',
])
