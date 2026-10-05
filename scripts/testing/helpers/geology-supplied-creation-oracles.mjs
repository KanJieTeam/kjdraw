import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn, compileGeologySection } from '../../../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../../../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { canonicalStringify, deepFreeze } from '../../../packages/kjdraw-sdk/src/utils.js'

// New adapter only: no frozen question, runtime, runner or existing scorer edits.
// Facts below are complete PUBLIC caller inputs, not project measurements or
// entity gold. Reference geometry is detached and never returned by bindings.
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const references = new WeakMap()
const definitionRows = [
  ['source-section.create-supplied-section', 'section', 'synthetic-source-section-v1', 'source:complete-section-input'],
  ['source-section.create-supplied-column', 'column', 'synthetic-source-section-v1', 'source:complete-column-input'],
  ['geological-presentation.supplied-section-datum', 'section', 'synthetic-source-section-v1', 'source:complete-section-input'],
  ['geological-presentation.chinese-column-headings', 'column', 'synthetic-source-column-v1', 'source:complete-column-input'],
]
export const SUPPLIED_CREATION_DESCRIPTORS = deepFreeze(definitionRows.map(([intent, sourceKind, fixtureId, inputPrerequisite]) => ({
  id: `${intent}-supplied-creation-native-v1`, intent, kind: 'creation', sourceKind, fixtureId,
  fixtureBranch: `supplied-creation-${intent}`,
  proposalTool: sourceKind === 'column' ? 'cad_propose_geology_column' : 'cad_propose_geology_section', command: 'CREATEBATCH',
  requiresBlankDocument: true, sourceBeforePolicy: 'actual-empty-native-source-list-not-a-fabricated-recipe',
  supportedPrerequisites: [`fixture:${fixtureId}`, 'document:current-revision-known', 'fixture:synthetic-public-data-only',
    'document:blank-millimetre', inputPrerequisite, 'conversation:existing-same-document-context', 'conversation:prior-request-not-approved'],
  checks: corpus.scenarios.find(scenario => scenario.expected.intent === intent).expected.checks,
})))
const descriptors = new Map(SUPPLIED_CREATION_DESCRIPTORS.map(item => [item.intent, item]))
export const SUPPLIED_CREATION_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(scenario => !scenario.sequence &&
  descriptors.has(scenario.expected.intent)).map(scenario => scenario.id))

function resolve(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(item => item.id === value)
  if (!scenario) throw new Error(`Unknown frozen supplied-creation scenario: ${value}`)
  return scenario
}
export function suppliedCreationDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  const scenario = typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value
  return descriptors.get(scenario?.expected?.intent) ?? null
}
export function assessSuppliedCreationReadiness(value) {
  const scenario = resolve(value), descriptor = suppliedCreationDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', reason: 'no-supplied-creation-oracle', scenarioPassed: null }
  const unsupportedPrerequisites = scenario.prerequisites.filter(item => !descriptor.supportedPrerequisites.includes(item))
  return { status: unsupportedPrerequisites.length ? 'not-ready' : 'runnable', oracleId: descriptor.id,
    unsupportedPrerequisites, modelCalls: 0, executionStatus: 'not-run', scenarioPassed: null }
}

function publicHole(id, prefix) {
  return { id, collarElevation: 106.5, depth: 18, initialWaterDepth: 2, stableWaterDepth: 4,
    strata: [
      { intervalId: `${prefix}-FILL`, code: '1', name: '填土', lithology: 'fill', top: 0, bottom: 3 },
      { intervalId: `${prefix}-CLAY`, code: '2', name: '黏土', lithology: 'clay', top: 3, bottom: 10 },
      { intervalId: `${prefix}-SAND`, code: '3', name: '砂土', lithology: 'sand', top: 10, bottom: 18 },
    ], observations: [{ kind: 'sample', id: id === 'TEST-A' ? 'S-A' : 'S-B', depth: 5 },
      { kind: 'spt', id: id === 'TEST-A' ? 'N-A' : 'N-B', depth: 12, value: 15 }] }
}

/** Returns caller facts only; optional absent descriptions stay absent. */
export function suppliedCreationCallerFacts(value) {
  const scenario = resolve(value), descriptor = suppliedCreationDescriptor(scenario)
  if (!descriptor) throw new Error('No supplied creation descriptor')
  const locale = descriptor.intent === 'geological-presentation.chinese-column-headings' ? 'zh-CN'
    : scenario.language === 'en' ? 'en' : 'zh-CN'
  const a = publicHole('TEST-A', 'I')
  if (descriptor.sourceKind === 'column') return { provenance: 'caller-declared-public-synthetic-not-measurement-certified',
    kind: 'column', sourceUnits: 'meter', drawingUnits: 'millimeter', depthConvention: 'depth-below-collar',
    input: { locale, hole: a, verticalScaleDenominator: 200 } }
  const b = publicHole('TEST-B', 'B')
  delete a.initialWaterDepth; delete b.initialWaterDepth
  a.station = 0; b.station = 20; b.collarElevation = 107.5
  return { provenance: 'caller-declared-public-synthetic-not-measurement-certified', kind: 'section',
    sourceUnits: 'meter', drawingUnits: 'millimeter', depthConvention: 'depth-below-collar', input: {
      locale, holes: [a, b], horizontalScaleDenominator: 200, verticalScaleDenominator: 200, datumElevation: 85,
      surfaceRule: 'straight-between-supplied-collars',
      correlations: a.strata.map((layer, index) => ({ fromHoleId: a.id, toHoleId: b.id,
        fromIntervalId: layer.intervalId, toIntervalId: b.strata[index].intervalId })), uncorrelatedOccurrences: [],
    } }
}

export async function buildSuppliedCreationFixture(value) {
  const scenario = resolve(value), descriptor = suppliedCreationDescriptor(scenario)
  assert.equal(assessSuppliedCreationReadiness(scenario).status, 'runnable')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  try {
    const facts = deepFreeze(suppliedCreationCallerFacts(scenario))
    const input = { expectedRevision: document.revision, ...clone(facts.input) }
    const source = { kind: descriptor.sourceKind, input: { ...input,
      ...(descriptor.sourceKind === 'section' ? { sourceFactMode: 'complete-occurrence-map' } : {}) } }
    const compiled = source.kind === 'column' ? compileGeologyColumn(source.input) : compileGeologySection(source.input)
    const commandArgs = { ...clone(compiled.commandArgs), geologySource: clone(source) }
    const reference = document.fork()
    await sdk.executeCommand('CREATEBATCH', clone(commandArgs), { document: reference })
    const drawingId = compiled.evidence.rootObjectId
    assert.deepEqual(readGeologyDrawingRecipe(reference, drawingId).source, source)
    assert.equal(reference.validate().valid, true)
    const current = `Current public synthetic blank millimetre drawing ${document.id}, revision ${document.revision}; no entities or retained geology recipes exist.`
    const conversationSeed = scenario.prerequisites.includes('conversation:prior-request-not-approved')
      ? [{ role: 'user', content: `${current} The previous exploratory request was not approved or executed. Wait for my corrected complete request and supplied source table.` }]
      : scenario.prerequisites.includes('conversation:existing-same-document-context')
        ? [{ role: 'user', content: `${current} Continue in this same document for my next complete creation request; do not act until then.` }] : []
    const fixture = { sdk, document, fixtureId: descriptor.fixtureId, fixtureBranch: descriptor.fixtureBranch, provenance: 'public-synthetic-only',
      suppliedCreationOracleId: descriptor.id, suppliedInputs: { completeGeologyCreation: facts },
      identityAliases: {}, identityStrategy: 'blank-native-document-no-existing-entity-targets',
      initialState: canonicalStringify(document.snapshot()), initialRevision: document.revision, initialEntities: [],
      oracleBaselineDocument: document.fork(), conversationSeed, sourceRecipePresent: false,
      builtFeatures: ['actual-blank-millimetre-document', 'complete-caller-declared-source-table', 'independent-native-creation-reference'],
      artifact: { format: 'KJD', bytes: await sdk.writeDocument(document, { format: 'KJD' }) },
      scenarioExecuted: false, modelCalls: 0,
      dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) },
    }
    references.set(fixture, { source: deepFreeze(clone(source)), drawingId, document: reference,
      commandArgs: deepFreeze(clone(commandArgs)), engineeringEvidence: deepFreeze(clone(compiled.evidence)) })
    assert.equal(canonicalStringify(document.snapshot()), fixture.initialState)
    return fixture
  } catch (error) { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id); throw error }
}

/** Never exposes expected CAD entities, resources, output IDs or oracle verdicts. */
export function suppliedCreationInputBindings(fixture) {
  return { provenance: 'public-synthetic-caller-supplied-geology-input', documentId: fixture.document.id,
    revision: fixture.initialRevision, identityStrategy: fixture.identityStrategy, aliases: {},
    suppliedInputs: clone(fixture.suppliedInputs) }
}
export function expectedSuppliedCreationOutcome(value, fixture) {
  const descriptor = suppliedCreationDescriptor(value), gold = references.get(fixture)
  if (!descriptor || !gold || fixture.suppliedCreationOracleId !== descriptor.id) throw new Error('Detached supplied-creation reference is unavailable')
  return { kind: 'creation', proposalTool: descriptor.proposalTool, command: descriptor.command,
    source: clone(gold.source), drawingId: gold.drawingId, commandArgs: clone(gold.commandArgs),
    before: [], after: gold.document.listEntities().map(entity => ({ id: entity.id, type: entity.type, payload: clone(entity.payload) })),
    engineeringEvidence: clone(gold.engineeringEvidence) }
}

function semanticReferences(value, document) {
  if (Array.isArray(value)) return value.map(item => semanticReferences(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, semanticReferences(item, document)]))
  const referenced = typeof value === 'string' ? document.getObject(value) : null
  if (!referenced) return value
  return referenced.kind === 'entity' ? { entityHandle: referenced.handle } : { resourceType: referenced.type, resourceName: referenced.name }
}
const hatchTransportCodes = new Set([5, 330, 100, 8, 10, 20, 30, 2, 70, 71, 91, 92, 72, 73, 93, 97, 75, 76, 52, 41, 77, 78, 53, 43, 44, 45, 46, 79, 49])
/** Complete native geometry and resource semantics, also used after real DXF
 * import where resource UUIDs change. No coordinate, source or pattern is dropped.
 */
export function suppliedCreationDocumentSemantics(document) {
  const entities = document.listEntities().map(entity => {
    const payload = clone(entity.payload)
    if (entity.type === 'HATCH') {
      if (payload.rawTags) assert.ok(payload.rawTags.every(tag => hatchTransportCodes.has(tag.code)))
      delete payload.rawTags
      payload.associative ??= false
      payload.boundaryLoops = payload.boundaryLoops.map(loop => ({ ...loop, flags: loop.flags ?? (2 | (loop.external ? 1 : 0)) }))
      payload.patternLines = payload.patternLines?.map(line => ({ ...line,
        angle: Number((((line.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toFixed(12)) }))
    }
    return { handle: entity.handle, type: entity.type,
      coordinateSpace: entity.ownerId === document.spaces.modelSpaceId ? 'model' : document.getObject(entity.ownerId)?.name,
      payload: semanticReferences(payload, document) }
  }).sort((a, b) => a.handle.localeCompare(b.handle))
  const resources = ['layers', 'textStyles', 'linetypes'].map(table => ({ table,
    currentName: document.getObject(document.getTable(table).currentId)?.name,
    records: document.getTable(table).records.map(record => ({ type: record.type, name: record.name,
      payload: semanticReferences(record.payload, document) })).sort((a, b) => a.name.localeCompare(b.name)),
  }))
  return { units: document.snapshot().header.units, entities, resources }
}
const sortEntities = entities => entities.map(entity => ({ id: entity.id, type: entity.type, payload: entity.payload })).sort((a, b) => a.id.localeCompare(b.id))

/** Independent arithmetic from caller metre facts and bundled declared page
 * layout, not coordinates copied from compiler output. Every layer polygon and
 * every exact section link must be present at its full physical depth/extent.
 */
export function suppliedCreationPhysicalGeometryMatches(entities, source) {
  if (!Array.isArray(entities)) return false
  const polygons = entities.filter(entity => entity.type === 'HATCH').map(entity => entity.payload?.boundaryLoops?.[0]?.vertices?.map(vertex => vertex.point))
  const expected = [], input = source.input
  if (source.kind === 'column') {
    // The native English default is the compact A4 frame, whereas Chinese
    // defaults use the bundled physical field grid. Neither origin is taken
    // from the generated result being scored.
    const layout = input.locale === 'en' ? {
      paperHeight: 297, headerDepth: input.hole.initialWaterDepth != null || input.hole.stableWaterDepth != null ? 64 : 56,
      fieldHeaderHeight: 10, fieldGrid: [{ role: 'pattern', start: 67 }, { role: 'stratum', start: 92 }],
    } : KJDRAW_GEOLOGY_KNOWLEDGE_PACK.rules['geology-column-layout']
    const patternIndex = layout.fieldGrid.findIndex(cell => cell.role === 'pattern')
    const left = layout.fieldGrid[patternIndex].start, right = layout.fieldGrid[patternIndex + 1].start
    const top = layout.paperHeight - layout.headerDepth - layout.fieldHeaderHeight
    const y = depth => top - depth * 1000 / input.verticalScaleDenominator
    for (const layer of input.hole.strata) expected.push([[left, y(layer.bottom), 0], [right, y(layer.bottom), 0], [right, y(layer.top), 0], [left, y(layer.top), 0]])
    if (input.locale === 'en') {
      // Compact English sheets also carry one 8 x 6 mm footer legend swatch
      // per caller-supplied distinct lithology, separate from depth-scale bands.
      const distinct = [...new Set(input.hole.strata.map(layer => layer.patternKey ?? layer.lithology))]
      const columns = Math.min(4, distinct.length), width = (195 - 15) / columns
      const legendTop = Math.min(y(input.hole.depth) - 3, 57 - 3)
      for (let i = 0; i < distinct.length; i++) {
        const x = 15 + (i % columns) * width, y = legendTop - 5 - Math.floor(i / columns) * 10
        expected.push([[x, y - 7, 0], [x + 8, y - 7, 0], [x + 8, y - 1, 0], [x, y - 1, 0]])
      }
    }
  } else {
    const layout = KJDRAW_GEOLOGY_KNOWLEDGE_PACK.rules['geology-section-layout']
    // Native section frames reserve an 18 mm elevation-axis label lane before
    // the first supplied hole centre. Station spacing remains exact metres.
    const x = hole => layout.plotLeft + 18 + (hole.station - input.holes[0].station) * 1000 / input.horizontalScaleDenominator
    const y = (hole, depth) => layout.plotBottom + (hole.collarElevation - depth - input.datumElevation) * 1000 / input.verticalScaleDenominator
    const half = layout.boreholeWidth / 2
    for (const hole of input.holes) for (const layer of hole.strata) expected.push([
      [x(hole) - half, y(hole, layer.bottom), 0], [x(hole) + half, y(hole, layer.bottom), 0],
      [x(hole) + half, y(hole, layer.top), 0], [x(hole) - half, y(hole, layer.top), 0],
    ])
    for (const link of input.correlations) {
      const left = input.holes.find(hole => hole.id === link.fromHoleId), right = input.holes.find(hole => hole.id === link.toHoleId)
      const from = left.strata.find(layer => layer.intervalId === link.fromIntervalId), to = right.strata.find(layer => layer.intervalId === link.toIntervalId)
      expected.push([[x(left), y(left, from.bottom), 0], [x(right), y(right, to.bottom), 0],
        [x(right), y(right, to.top), 0], [x(left), y(left, from.top), 0]])
    }
  }
  return polygons.length === expected.length && expected.every(points => polygons.some(actual => same(points, actual)))
}

/** Actual collected native tool evidence only; self-tests never become live
 * model passes. Empty source listing is a real read, not a fictional source.
 */
export function evaluateSuppliedCreationOracle(value, fixture, evidence) {
  const scenario = resolve(value), descriptor = suppliedCreationDescriptor(scenario), gold = references.get(fixture)
  if (assessSuppliedCreationReadiness(scenario).status !== 'runnable' || !gold)
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'creation-scenario-not-ready' }
  if (!evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) ||
    !evidence.afterDocument || !Array.isArray(evidence.toolCalls) || !evidence.proposal)
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-creation-evidence-missing' }
  const calls = evidence.toolCalls, proposal = evidence.proposal, assertions = []
  const check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  const phase = evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage)
  const proposalIndex = calls.findIndex(call => call.name === descriptor.proposalTool && call.result?.ok === true &&
    call.args?.expectedRevision === fixture.initialRevision && same(call.result.value, proposal))
  const drawingRead = calls.findIndex(call => call.name === 'cad_read_drawing' && call.result?.ok === true &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
    call.result.value?.units === 'millimeter' && call.result.value?.truncated === false &&
    Array.isArray(call.result.value?.entities) && call.result.value.entities.length === 0)
  const sourceRead = calls.findIndex(call => call.name === 'cad_read_geology_source' && call.result?.ok === true &&
    call.args?.drawingId === '' && call.args?.expectedRevision === fixture.initialRevision &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
    call.result.value?.sourceBacked === false && same(call.result.value?.drawingIds, []))
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id && drawingRead >= 0 && drawingRead < proposalIndex)
  check('read-retained-source-before-revision', sourceRead >= 0 && sourceRead < proposalIndex)
  check('actual-native-proposal-tool-evidence', proposalIndex >= 0)
  check('complete-caller-facts-not-inferred', same(proposal.arguments?.geologySource, gold.source))
  check('independent-complete-command-and-resource-match', same(proposal.arguments, gold.commandArgs))
  check('independent-metre-to-page-hatch-and-hole-centre-arithmetic', suppliedCreationPhysicalGeometryMatches(proposal.preview?.after, gold.source))
  check('full-before-after-preview', proposal.command === descriptor.command && proposal.documentId === fixture.document.id &&
    proposal.expectedRevision === fixture.initialRevision && proposal.preview?.documentId === fixture.document.id &&
    proposal.preview?.revision === fixture.initialRevision && same(proposal.preview?.before, []) &&
    same(sortEntities(proposal.preview?.after ?? []), sortEntities(gold.document.listEntities())))
  check('source-before-after-diff-visible', sourceRead >= 0 && same(proposal.arguments?.geologySource, gold.source))
  if (phase === 'pending') {
    check('no-mutation-during-preview', canonicalStringify(evidence.afterDocument.snapshot()) === fixture.initialState)
    check('explicit-host-approval-before-commit', proposal.status === 'awaiting-host-approval' && !evidence.approval && !evidence.approvalReceipt)
  } else if (phase === 'committed') {
    const approval = evidence.approval ?? evidence.approvalReceipt, receipt = approval?.value ?? approval
    check('explicit-host-approval-before-commit', (approval?.ok === true || evidence.hostApprovalApplied === true) &&
      receipt?.status === 'committed' && receipt?.command === descriptor.command &&
      receipt?.beforeRevision === fixture.initialRevision && receipt?.afterRevision === fixture.initialRevision + 1 &&
      (evidence.approvedPlanId ?? receipt?.planId) === proposal.planId &&
      (receipt?.planId == null || receipt.planId === proposal.planId))
    check('one-atomic-creation-revision', evidence.afterDocument.revision === fixture.initialRevision + 1)
    let actualSource
    try { actualSource = readGeologyDrawingRecipe(evidence.afterDocument, gold.drawingId).source } catch { /* failed native state, not an exception-shaped pass */ }
    check('exact-complete-source-recovered', same(actualSource, gold.source))
    check('generated-native-geometry-matches-source', same(suppliedCreationDocumentSemantics(evidence.afterDocument), suppliedCreationDocumentSemantics(gold.document)))
    check('committed-source-depths-and-links-at-exact-native-physical-coordinates', suppliedCreationPhysicalGeometryMatches(evidence.afterDocument.listEntities(), gold.source))
    check('one-exact-native-source-root', same(Object.keys(evidence.afterDocument.snapshot().opaquePayloads), [`geology-drawing-recipe:${gold.drawingId}`]))
  } else check('supported-creation-evidence-phase', false)
  const complete = assertions.every(item => item.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(item => item.id === id)) check(id, complete)
  const satisfied = assertions.every(item => item.satisfied)
  return { status: satisfied ? 'satisfied' : 'failed', oracleId: descriptor.id, phase, assertions,
    evidenceOrigin: evidence.origin, scenarioPassed: evidence.origin === 'real-model' ? satisfied : null,
    scenarioExecuted: evidence.origin === 'real-model' }
}
