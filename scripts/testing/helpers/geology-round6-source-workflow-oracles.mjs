import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture, scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { suppliedCreationDocumentSemantics, suppliedCreationPhysicalGeometryMatches } from './geology-supplied-creation-oracles.mjs'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn } from '../../../packages/kjdraw-sdk/src/geology-engineering.js'
import { applyGeologyDrawingRevision, prepareGeologyDrawingRevision, readGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../../../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { canonicalStringify, deepFreeze } from '../../../packages/kjdraw-sdk/src/utils.js'

// NEW adapters only. No frozen question, installed SDK, prior oracle, prompt or
// model-runner surface is rewritten. Caller data is public synthetic input;
// detached gold never enters the bindings returned to a model.
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const references = new WeakMap()
const provenance = 'caller-declared-public-synthetic-not-measurement-certified'
const rows = [
  ['geological-presentation.declared-long-column-sheet', 'creation', 'source:complete-deep-column-input', 'template:declared-500mm-sheet'],
  ['geological-presentation.many-lithology-classes', 'creation', 'source:complete-eight-class-column-input', 'template:declared-fitting-sheet'],
  ['batch-historical-workflow.batch-multi-hole-update', 'source', 'source:complete-confirmed-multi-hole-water-table'],
  ['batch-historical-workflow.historical-kjd-source-recovery', 'source', 'source:complete-confirmed-boundary-table', 'artifact:synthetic-source-backed-kjd'],
]
export const ROUND6_SOURCE_WORKFLOW_DESCRIPTORS = deepFreeze(rows.map(([intent, kind, ...prerequisites]) => {
  const fixtureId = kind === 'creation' ? 'synthetic-source-column-v1' : 'synthetic-source-section-v1'
  return { id: `${intent}-exact-round6-source-workflow-v1`, intent, kind, sourceKind: kind === 'creation' ? 'column' : 'section',
    fixtureId, fixtureBranch: `round6-source-workflow-${intent}`,
    proposalTool: kind === 'creation' ? 'cad_propose_geology_column' : 'cad_propose_geology_revision',
    command: kind === 'creation' ? 'CREATEBATCH' : 'GEOLOGY_DRAWING_UPDATE', requiresBlankDocument: kind === 'creation',
    sourceBeforePolicy: kind === 'creation' ? 'actual-empty-native-source-list' : 'actual-reopened-native-source',
    supportedPrerequisites: [`fixture:${fixtureId}`, 'document:current-revision-known', 'fixture:synthetic-public-data-only',
      'conversation:existing-same-document-context', 'conversation:prior-request-not-approved',
      ...(kind === 'creation' ? ['document:blank-millimetre'] : []), ...prerequisites],
    checks: corpus.scenarios.find(scenario => scenario.expected.intent === intent).expected.checks }
}))
const descriptors = new Map(ROUND6_SOURCE_WORKFLOW_DESCRIPTORS.map(item => [item.intent, item]))
export const ROUND6_SOURCE_WORKFLOW_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(scenario => !scenario.sequence &&
  descriptors.has(scenario.expected.intent)).map(scenario => scenario.id))

function resolve(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(item => item.id === value)
  if (!scenario) throw new Error(`Unknown frozen round6 source workflow scenario: ${value}`)
  return scenario
}
export function round6SourceWorkflowDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  const scenario = typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value
  return descriptors.get(scenario?.expected?.intent) ?? null
}
export function assessRound6SourceWorkflowReadiness(value) {
  const scenario = resolve(value), descriptor = round6SourceWorkflowDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', reason: 'no-round6-source-workflow-oracle', scenarioPassed: null }
  const unsupportedPrerequisites = scenario.prerequisites.filter(item => !descriptor.supportedPrerequisites.includes(item))
  return { status: unsupportedPrerequisites.length ? 'not-ready' : 'runnable', oracleId: descriptor.id,
    unsupportedPrerequisites, modelCalls: 0, executionStatus: 'not-run', scenarioPassed: null }
}

export function round6SourceWorkflowCallerInputs(value) {
  const scenario = resolve(value), descriptor = round6SourceWorkflowDescriptor(scenario)
  if (!descriptor) throw new Error('No round6 caller input descriptor')
  if (descriptor.kind === 'creation') {
    const many = descriptor.intent.endsWith('many-lithology-classes')
    const classes = many
      ? [['fill', '填土'], ['cultivated-soil', '耕土'], ['clay', '黏土'], ['silty-clay', '粉质黏土'],
        ['silt', '粉土'], ['sand', '砂土'], ['gravel', '砾石'], ['rock', '岩石']]
      : [['fill', '填土'], ['clay', '黏土'], ['sand', '砂土']]
    const step = many ? 6 : 20
    return { completeColumnCreation: { provenance, sourceUnits: 'meter', drawingUnits: 'millimeter', depthConvention: 'depth-below-collar',
      input: { locale: scenario.language === 'en' ? 'en' : 'zh-CN', pageHeightMillimeters: 500, verticalScaleDenominator: 200,
        hole: { id: 'TEST-A', collarElevation: 106.5, depth: classes.length * step, initialWaterDepth: 2, stableWaterDepth: 4,
          strata: classes.map(([lithology, name], index) => ({ intervalId: `I-${index + 1}`, code: String(index + 1),
            name, lithology, top: index * step, bottom: (index + 1) * step })),
          observations: [{ kind: 'sample', id: 'S-A', depth: 5 }, { kind: 'spt', id: 'N-A', depth: 12, value: 15 }] } },
      templateDeclaration: { provenance: 'bundled-native-host-style-declaration', selectedPageHeightMillimeters: 500,
        declaredPageHeightsMillimeters: [297, 500, 841], modelMayReplaceStyle: false } } }
  }
  if (descriptor.intent.endsWith('batch-multi-hole-update')) return {
    confirmedMultiHoleWaterTable: { provenance, sourceUnits: 'meter', depthConvention: 'depth-below-collar',
      rows: [{ holeId: 'TEST-A', stableWaterDepth: 4.5 }, { holeId: 'TEST-B', stableWaterDepth: 5.25 }] },
  }
  return { confirmedBoundaryTable: { provenance, sourceUnits: 'meter', depthConvention: 'depth-below-collar',
    rows: [{ holeId: 'TEST-A', intervalId: 'I-CLAY', top: 3, bottom: 9.5 },
      { holeId: 'TEST-A', intervalId: 'I-SAND', top: 9.5, bottom: 18 }] } }
}

function conversationSeed(scenario, fixture) {
  const current = `Current public synthetic millimetre document ${fixture.document.id}, revision ${fixture.document.revision}.`
  if (scenario.prerequisites.includes('conversation:prior-request-not-approved')) return [{ role: 'user',
    content: `${current} The previous conversational request was not approved or executed. Wait for my corrected complete request and caller source table.` }]
  return scenario.prerequisites.includes('conversation:existing-same-document-context') ? [{ role: 'user',
    content: `${current} Continue in this same document for the next request. No conversational edit is pending or approved.` }] : []
}
const project = entity => ({ id: entity.id, type: entity.type, payload: clone(entity.payload) })
const sorted = entities => entities.map(project).sort((a, b) => a.id.localeCompare(b.id))
function sourceFacts(source) {
  const { columnStylePack, sectionStylePack, hatchPack, ...facts } = source.input
  return { kind: source.kind, facts }
}

/** Gold applies ONLY the complete public caller table to a detached baseline. */
function revisedSource(source, suppliedInputs) {
  const next = clone(source)
  if (suppliedInputs.confirmedMultiHoleWaterTable) {
    for (const row of suppliedInputs.confirmedMultiHoleWaterTable.rows)
      next.input.holes.find(hole => hole.id === row.holeId).stableWaterDepth = row.stableWaterDepth
  } else for (const row of suppliedInputs.confirmedBoundaryTable.rows) {
    const interval = next.input.holes.find(hole => hole.id === row.holeId).strata.find(interval => interval.intervalId === row.intervalId)
    interval.top = row.top; interval.bottom = row.bottom
  }
  return next
}

export async function buildRound6SourceWorkflowFixture(value) {
  const scenario = resolve(value), descriptor = round6SourceWorkflowDescriptor(scenario)
  assert.equal(assessRound6SourceWorkflowReadiness(scenario).status, 'runnable')
  const suppliedInputs = deepFreeze(round6SourceWorkflowCallerInputs(scenario))
  let fixture
  if (descriptor.kind === 'creation') {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    fixture = { sdk, document, identityAliases: {}, identityStrategy: 'actual-blank-native-document', sourceRecipePresent: false,
      artifact: { format: 'KJD', bytes: await sdk.writeDocument(document, { format: 'KJD' }) },
      dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
  } else {
    fixture = await buildPublicScenarioFixture(descriptor.fixtureId, { branch: 'complete-occurrence-map' })
    await fixture.document.transact('Declare unowned public manual review note', transaction => transaction.createEntity('TEXT', {
      position: [10, -12, 0], height: 2, styleId: fixture.document.getTable('textStyles').currentId,
      text: '人工核对备注 Manual review note: preserve exactly.' }, { id: 'NOTE-MANUAL' }))
    const bytes = await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })
    const beforeReopen = fixture.document.snapshot(), document = await fixture.sdk.readDocument(bytes, { format: 'KJD' })
    assert.equal(canonicalStringify(document.snapshot()), canonicalStringify(beforeReopen), 'actual historical source artifact must reopen exactly')
    fixture = { ...fixture, document, artifact: { format: 'KJD', bytes },
      identityAliases: { ...fixture.identityAliases, 'NOTE-MANUAL': { nativeId: 'NOTE-MANUAL', handle: document.getObject('NOTE-MANUAL').handle } },
      source: clone(readGeologyDrawingRecipe(document, fixture.drawingId).source) }
  }
  try {
    Object.assign(fixture, { fixtureId: descriptor.fixtureId, fixtureBranch: descriptor.fixtureBranch,
      round6SourceWorkflowOracleId: descriptor.id, provenance: 'public-synthetic-only', suppliedInputs,
      initialRevision: fixture.document.revision, initialState: canonicalStringify(fixture.document.snapshot()),
      initialEntities: clone(fixture.document.listEntities()), oracleBaselineDocument: fixture.document.fork(),
      scenarioExecuted: false, modelCalls: 0 })
    fixture.conversationSeed = conversationSeed(scenario, fixture)
    const reference = fixture.document.fork()
    let gold
    if (descriptor.kind === 'creation') {
      const source = { kind: 'column', input: { expectedRevision: fixture.initialRevision, ...clone(suppliedInputs.completeColumnCreation.input) } }
      const compiled = compileGeologyColumn(source.input), commandArgs = { ...clone(compiled.commandArgs), geologySource: clone(source) }
      await fixture.sdk.executeCommand(descriptor.command, clone(commandArgs), { document: reference })
      gold = { beforeSource: null, afterSource: source, drawingId: compiled.evidence.rootObjectId,
        before: [], after: sorted(reference.listEntities()), unchangedIds: [], commandArgs, engineeringEvidence: compiled.evidence }
    } else {
      const beforeSource = clone(fixture.source), afterSource = revisedSource(beforeSource, suppliedInputs)
      const previous = readGeologyDrawingRecipe(reference, fixture.drawingId)
      const revision = prepareGeologyDrawingRevision(reference, previous, afterSource, { expectedRevision: fixture.initialRevision })
      await applyGeologyDrawingRevision(reference, previous, afterSource, { expectedRevision: fixture.initialRevision })
      gold = { beforeSource, afterSource, drawingId: fixture.drawingId, before: sorted(revision.before), after: sorted(revision.after),
        unchangedIds: [...revision.unchangedIds], engineeringEvidence: revision.evidence }
    }
    assert.deepEqual(readGeologyDrawingRecipe(reference, gold.drawingId).source, gold.afterSource)
    assert.equal(reference.validate().valid, true)
    references.set(fixture, { ...gold, document: reference })
    assert.equal(canonicalStringify(fixture.document.snapshot()), fixture.initialState, 'detached oracle cannot change the assigned drawing')
    return fixture
  } catch (error) { fixture.dispose(); throw error }
}

export function round6SourceWorkflowInputBindings(fixture) {
  return { ...scenarioFixtureInputBindings(fixture),
    ...(fixture.sourceRecipePresent ? { drawingId: fixture.drawingId, sourceKind: fixture.source.kind } : {}) }
}
export function expectedRound6SourceWorkflowOutcome(value, fixture) {
  const descriptor = round6SourceWorkflowDescriptor(value), gold = references.get(fixture)
  if (!gold || fixture.round6SourceWorkflowOracleId !== descriptor?.id) throw new Error('No detached round6 workflow reference')
  return { kind: descriptor.kind, command: descriptor.command, proposalTool: descriptor.proposalTool,
    drawingId: gold.drawingId, beforeSource: clone(gold.beforeSource), afterSource: clone(gold.afterSource),
    before: clone(gold.before), after: clone(gold.after), unchangedIds: [...gold.unchangedIds],
    ...(gold.commandArgs ? { commandArgs: clone(gold.commandArgs) } : {}), engineeringEvidence: clone(gold.engineeringEvidence) }
}

/** Separate metre-to-paper arithmetic; never copies compiler result coordinates. */
export function round6SourceWorkflowPhysicalGeometryMatches(entities, source) {
  if (source.kind === 'section') {
    if (!suppliedCreationPhysicalGeometryMatches(entities, source)) return false
    const layout = KJDRAW_GEOLOGY_KNOWLEDGE_PACK.rules['geology-section-layout'], input = source.input
    const points = entity => (entity.payload.vertices ?? []).map(vertex => Array.isArray(vertex) ? vertex : vertex.point)
    return input.holes.every(hole => {
      if (hole.stableWaterDepth == null) return true
      const x = layout.plotLeft + 18 + (hole.station - input.holes[0].station) * 1000 / input.horizontalScaleDenominator
      const y = layout.plotBottom + (hole.collarElevation - hole.stableWaterDepth - input.datumElevation) * 1000 / input.verticalScaleDenominator
      return entities.some(entity => entity.type === 'LINE' && same(entity.payload.start, [x - 5, y, 0]) && same(entity.payload.end, [x + 5, y, 0])) &&
        entities.some(entity => entity.type === 'LWPOLYLINE' && same(points(entity), [[x - 2, y + 1.2, 0], [x, y - 1, 0], [x + 2, y + 1.2, 0]]))
    })
  }
  const input = source.input, english = input.locale === 'en'
  const layout = KJDRAW_GEOLOGY_KNOWLEDGE_PACK.rules['geology-column-layout']
  const index = layout.fieldGrid.findIndex(field => field.role === 'pattern')
  const left = english ? 67 : layout.fieldGrid[index].start, right = english ? 92 : layout.fieldGrid[index + 1].start
  const header = english ? (input.hole.initialWaterDepth != null || input.hole.stableWaterDepth != null ? 64 : 56) : layout.headerDepth
  const top = input.pageHeightMillimeters - header - (english ? 10 : layout.fieldHeaderHeight)
  const y = depth => top - depth * 1000 / input.verticalScaleDenominator
  const expected = input.hole.strata.map(layer => [[left, y(layer.bottom), 0], [right, y(layer.bottom), 0], [right, y(layer.top), 0], [left, y(layer.top), 0]])
  if (english) {
    const classes = [...new Set(input.hole.strata.map(layer => layer.patternKey ?? layer.lithology))]
    const columns = Math.min(4, classes.length), width = (195 - 15) / columns, legendTop = Math.min(y(input.hole.depth) - 3, 57 - 3)
    for (let i = 0; i < classes.length; i++) {
      const x = 15 + (i % columns) * width, y = legendTop - 5 - Math.floor(i / columns) * 10
      expected.push([[x, y - 7, 0], [x + 8, y - 7, 0], [x + 8, y - 1, 0], [x, y - 1, 0]])
    }
  }
  const polygons = entities.filter(entity => entity.type === 'HATCH').map(entity => entity.payload.boundaryLoops[0].vertices.map(vertex => vertex.point))
  return polygons.length === expected.length && expected.every(points => polygons.some(polygon => same(points, polygon)))
}

export function evaluateRound6SourceWorkflowOracle(value, fixture, evidence) {
  const scenario = resolve(value), descriptor = round6SourceWorkflowDescriptor(scenario), gold = references.get(fixture)
  if (!gold || assessRound6SourceWorkflowReadiness(scenario).status !== 'runnable')
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'round6-workflow-not-ready' }
  if (!evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) ||
    !evidence.afterDocument || !evidence.proposal || !Array.isArray(evidence.toolCalls))
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-round6-workflow-evidence-missing' }
  const calls = evidence.toolCalls, proposal = evidence.proposal, assertions = []
  const check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  const phase = evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage)
  const proposalIndex = calls.findIndex(call => call.name === descriptor.proposalTool && call.result?.ok === true &&
    call.args?.expectedRevision === fixture.initialRevision && same(call.result.value, proposal))
  const sourceRead = calls.findIndex(call => call.name === 'cad_read_geology_source' && call.result?.ok === true &&
    call.args?.expectedRevision === fixture.initialRevision && call.args?.drawingId === (gold.beforeSource ? gold.drawingId : '') &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
    (gold.beforeSource ? same({ kind: call.result.value.kind, facts: call.result.value.facts }, sourceFacts(gold.beforeSource))
      : call.result.value.sourceBacked === false && same(call.result.value.drawingIds, [])))
  const blankRead = calls.findIndex(call => call.name === 'cad_read_drawing' && call.result?.ok === true &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
    call.result.value?.units === 'millimeter' && call.result.value?.truncated === false && same(call.result.value?.entities, []))
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id &&
    sourceRead >= 0 && sourceRead < proposalIndex && (descriptor.kind !== 'creation' || blankRead >= 0 && blankRead < proposalIndex))
  check('read-retained-source-before-revision', sourceRead >= 0 && sourceRead < proposalIndex)
  check('actual-native-proposal-tool-evidence', proposalIndex >= 0)
  check('full-before-after-preview', proposal.documentId === fixture.document.id && proposal.expectedRevision === fixture.initialRevision &&
    proposal.command === descriptor.command && proposal.preview?.documentId === fixture.document.id && proposal.preview?.revision === fixture.initialRevision &&
    same(sorted(proposal.preview?.before ?? []), gold.before) && same(sorted(proposal.preview?.after ?? []), gold.after))
  if (descriptor.kind === 'creation') {
    check('complete-caller-source-and-resource-match', same(proposal.arguments, gold.commandArgs))
    check('source-before-after-diff-visible', sourceRead >= 0 && same(proposal.arguments?.geologySource, gold.afterSource))
    const params = proposal.engineeringEvidence?.parameters
    check('declared-sheet-only', params?.pageHeightMillimeters === 500 && params?.verticalScaleDenominator === 200 && params?.verticalScaleSource === 'explicit')
    check('every-interval-and-lithology-kept', params?.stratumCount === gold.afterSource.input.hole.strata.length &&
      params?.lithologyCount === new Set(gold.afterSource.input.hole.strata.map(layer => layer.lithology)).size)
    check('independent-physical-depth-and-hatch-arithmetic', round6SourceWorkflowPhysicalGeometryMatches(proposal.preview?.after ?? [], gold.afterSource))
  } else {
    check('source-before-after-diff-visible', same(proposal.engineeringEvidence?.beforeSource, sourceFacts(gold.beforeSource)) &&
      same(proposal.engineeringEvidence?.afterSource, sourceFacts(gold.afterSource)))
    check('unchanged-native-identity-map-exact', same([...(proposal.unchangedIds ?? [])].sort(), [...gold.unchangedIds].sort()))
    check('reopened-source-used-not-old-chat', fixture.artifact?.format === 'KJD' && fixture.sourceRecipePresent === true && sourceRead >= 0)
  }
  if (phase === 'pending') {
    check('no-mutation-during-preview', canonicalStringify(evidence.afterDocument.snapshot()) === fixture.initialState)
    check('explicit-host-approval-before-commit', proposal.status === 'awaiting-host-approval' && !evidence.approval && !evidence.approvalReceipt)
  } else if (phase === 'committed') {
    const approval = evidence.approval ?? evidence.approvalReceipt, receipt = approval?.value ?? approval
    check('explicit-host-approval-before-commit', (approval?.ok === true || evidence.hostApprovalApplied === true) &&
      receipt?.status === 'committed' && receipt?.command === descriptor.command && receipt?.beforeRevision === fixture.initialRevision &&
      receipt?.afterRevision === fixture.initialRevision + 1 && (evidence.approvedPlanId ?? receipt?.planId) === proposal.planId &&
      (receipt?.planId == null || receipt.planId === proposal.planId))
    check('whole-batch-atomic', evidence.afterDocument.revision === fixture.initialRevision + 1 &&
      evidence.afterDocument.history.undoCount === fixture.oracleBaselineDocument.history.undoCount + 1)
    let source
    try { source = readGeologyDrawingRecipe(evidence.afterDocument, gold.drawingId).source } catch { /* geometry/source conflict is failed evidence */ }
    check('exact-complete-source-after-commit', same(source, gold.afterSource))
    check('generated-native-geometry-matches-source', same(suppliedCreationDocumentSemantics(evidence.afterDocument), suppliedCreationDocumentSemantics(gold.document)))
    check('complete-native-object-and-resource-preservation', same(evidence.afterDocument.snapshot().objects, gold.document.snapshot().objects) &&
      same(evidence.afterDocument.snapshot().tables, gold.document.snapshot().tables))
    check('independent-physical-depth-and-hatch-arithmetic', round6SourceWorkflowPhysicalGeometryMatches(evidence.afterDocument.listEntities(), gold.afterSource))
    check('one-exact-retained-source-root', same(Object.keys(evidence.afterDocument.snapshot().opaquePayloads), [`geology-drawing-recipe:${gold.drawingId}`]))
    check('all-unrequested-records-and-manual-objects-unchanged', [...gold.unchangedIds,
      ...Object.values(fixture.identityAliases).map(identity => identity.nativeId)].every(id =>
      same(evidence.afterDocument.getObject(id), fixture.oracleBaselineDocument.getObject(id))))
  } else check('supported-workflow-phase', false)
  const complete = assertions.every(item => item.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(item => item.id === id)) check(id, complete)
  const satisfied = assertions.every(item => item.satisfied)
  return { status: satisfied ? 'satisfied' : 'failed', oracleId: descriptor.id, phase, assertions,
    evidenceOrigin: evidence.origin, scenarioPassed: evidence.origin === 'real-model' ? satisfied : null,
    scenarioExecuted: evidence.origin === 'real-model' }
}
