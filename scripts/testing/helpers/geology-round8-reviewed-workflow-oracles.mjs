import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture, scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { suppliedCreationDocumentSemantics } from './geology-supplied-creation-oracles.mjs'
import { round6SourceWorkflowPhysicalGeometryMatches } from './geology-round6-source-workflow-oracles.mjs'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologyColumn } from '../../../packages/kjdraw-sdk/src/geology-engineering.js'
import { applyGeologyDrawingRevision, prepareGeologyDrawingRevision, readGeologyDrawingRecipe,
  registerGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify, deepFreeze } from '../../../packages/kjdraw-sdk/src/utils.js'

// Standalone preparation, not a change to frozen questions or installed tools.
// Multiple host approvals, cross-document reads and a real browser refresh need
// their own runner adapters. Native selftests do not certify those host actions.
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const state = document => canonicalStringify(document.snapshot())
const references = new WeakMap()
const archiveProofs = new WeakMap()
const publicReadTools = new Map(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => [tool.name, tool]))
const provenance = 'caller-declared-public-synthetic-not-measurement-certified'
const MIXED = 'source-section.mixed-source-and-manual-edit'
const SELECTED = 'batch-historical-workflow.selected-historical-source-revision'
const STAGING = 'batch-historical-workflow.batch-distinct-drawings-staging'
const ARCHIVE = 'batch-historical-workflow.repeated-edit-archive-reopen'
const rows = [
  [MIXED, 'mixed', 'sequential-preview-and-explicit-host-approval-driver'],
  [SELECTED, 'source', 'selected-document-and-unselected-workspace-preservation'],
  [STAGING, 'read', 'multi-document-native-source-read-driver'],
  [ARCHIVE, 'local-session', 'browser-session-save-refresh-reopen'],
]
export const ROUND8_REVIEWED_WORKFLOW_DESCRIPTORS = deepFreeze(rows.map(([intent, kind, hostAction]) => ({
  id: `${intent}-exact-round8-reviewed-workflow-v1`, intent, kind,
  fixtureId: 'synthetic-source-section-v1', fixtureBranch: `round8-reviewed-workflow-${intent}`,
  proposalTool: kind === 'source' || kind === 'mixed' ? 'cad_propose_geology_revision' : null,
  command: kind === 'source' ? 'GEOLOGY_DRAWING_UPDATE' : null,
  ...(kind === 'mixed' ? { proposalTools: ['cad_propose_geology_revision', 'cad_propose_move'],
    commands: ['GEOLOGY_DRAWING_UPDATE', 'MOVE'], transactionPolicy: 'two-explicitly-ordered-separately-reviewed-commits' } : {}),
  requiredHostActions: [hostAction], sourceBeforePolicy: 'actual-current-native-source',
  supportedPrerequisites: corpus.scenarios.find(s => s.expected.intent === intent).prerequisites.concat([
    'conversation:existing-same-document-context', 'conversation:prior-request-not-approved']),
  checks: corpus.scenarios.find(s => s.expected.intent === intent).expected.checks,
})))
const descriptors = new Map(ROUND8_REVIEWED_WORKFLOW_DESCRIPTORS.map(item => [item.intent, item]))
export const ROUND8_REVIEWED_WORKFLOW_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(s => !s.sequence &&
  descriptors.has(s.expected.intent)).map(s => s.id))
function resolve(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(item => item.id === value)
  if (!scenario) throw new Error(`Unknown frozen round8 scenario: ${value}`)
  return scenario
}
export function round8ReviewedWorkflowDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  const scenario = typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value
  return descriptors.get(scenario?.expected?.intent) ?? null
}
export function assessRound8ReviewedWorkflowReadiness(value, { availableActions = [] } = {}) {
  const scenario = resolve(value), descriptor = round8ReviewedWorkflowDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', reason: 'no-round8-oracle', scenarioPassed: null }
  const unsupportedPrerequisites = scenario.prerequisites.filter(item => !descriptor.supportedPrerequisites.includes(item))
  const missingHostActions = descriptor.requiredHostActions.filter(item => !availableActions.includes(item))
  return { status: unsupportedPrerequisites.length || missingHostActions.length ? 'not-ready' : 'runnable',
    nativeFixtureAndOracleReady: true, oracleId: descriptor.id, unsupportedPrerequisites, missingHostActions,
    modelCalls: 0, scenarioPassed: null, executionStatus: 'not-run' }
}

export const ROUND8_TEN_REVIEWED_CHANGES = deepFreeze([
  { index: 1, kind: 'source', units: 'meter', updates: [{ holeId: 'TEST-A', stableWaterDepth: 4.25 }] },
  { index: 2, kind: 'manual', units: 'millimeter', ids: ['CIRCLE-MANUAL'], dx: 1, dy: 0 },
  { index: 3, kind: 'source', units: 'meter', updates: [{ holeId: 'TEST-B', stableWaterDepth: 4.5 }] },
  { index: 4, kind: 'manual', units: 'millimeter', ids: ['CIRCLE-MANUAL'], dx: 2, dy: 0 },
  { index: 5, kind: 'boundary', units: 'meter', holeId: 'TEST-A', rows: [
    { intervalId: 'I-CLAY', top: 3, bottom: 9.5 }, { intervalId: 'I-SAND', top: 9.5, bottom: 18 }] },
  { index: 6, kind: 'source', units: 'meter', updates: [{ holeId: 'TEST-A', observationChanges: {
    update: [{ target: { kind: 'sample', id: 'S-A', expectedDepth: 5 }, set: { depth: 5.5 } }] } }] },
  { index: 7, kind: 'source', units: 'meter', updates: [{ holeId: 'TEST-B', observationChanges: {
    update: [{ target: { kind: 'spt', id: 'N-B', expectedDepth: 12 }, set: { value: 18 } }] } }] },
  { index: 8, kind: 'manual', units: 'millimeter', ids: ['CIRCLE-MANUAL'], dx: -1, dy: 0 },
  { index: 9, kind: 'source', units: 'meter', updates: [{ holeId: 'TEST-A', stableWaterDepth: 5 }] },
  { index: 10, kind: 'source', units: 'meter', updates: [{ holeId: 'TEST-B', stableWaterDepth: 5.25 }] },
])

export function round8ReviewedWorkflowCallerInputs(value) {
  const descriptor = round8ReviewedWorkflowDescriptor(value)
  if (!descriptor) throw new Error('No round8 caller input descriptor')
  if (descriptor.kind === 'mixed') return {
    confirmedMixedChanges: { provenance, sourceUnits: 'meter', drawingUnits: 'millimeter',
      waterTable: [{ holeId: 'TEST-A', stableWaterDepth: 4.5 }],
      manualDisplacement: { ids: ['CIRCLE-MANUAL'], dx: 10, dy: 0 },
      reviewPolicy: { order: ['source-water-update', 'manual-circle-move'],
        oneApprovalPerProposal: true, rereadRevisionAfterEachApproval: true,
        wholeRequestIsNotOneAtomicTransaction: true } },
  }
  if (descriptor.kind === 'source') return { confirmedSelectedWaterTable: { provenance,
    sourceUnits: 'meter', drawingUnits: 'millimeter', rows: [{ holeId: 'TEST-A', stableWaterDepth: 4.5 }] } }
  if (descriptor.kind === 'read') return { callerBatchPolicy: { provenance, maxDrawingsPerBatch: 10,
    declaredDrawingCount: 30, approvalGranted: false, compileNewDrawing: false,
    organizationPolicy: 'each-native-source-root-stays-in-its-own-document' },
    responseContract: { field: 'batchPlan', fields: ['drawings', 'batches', 'requiresSeparateHostApproval'],
      drawingFields: ['documentId', 'drawingId', 'holeId', 'sourceKind'],
      batchFields: ['documentIds'], sourceKindVocabulary: ['column', 'section'] } }
  return { confirmedHistoricalChangeLedger: { provenance, sourceUnits: 'meter', drawingUnits: 'millimeter',
    changes: clone(ROUND8_TEN_REVIEWED_CHANGES),
    status: 'already-individually-approved-and-applied-native-setup-not-model-run' },
    callerArchivePolicy: { portableSourceBackup: 'KJD', graphicsExchange: 'DXF',
      historyRecovery: 'separate-validated-local-history-archive',
      refreshRequired: true, cadLabelsAreNotMeasuredFacts: true },
    responseContract: { field: 'archiveFormats', fields: ['KJD', 'DXF', 'history'],
      roleCodeVocabulary: {
        'native-source-backup': 'Portable native drawing content that retains registered source recipes and native identities; this does not itself restore session undo history.',
        'graphics-exchange-no-native-source': 'Standard CAD geometry and resource exchange without a native source recipe or a recovered undo stack.',
        'separate-local-history-archive': 'Host-local bounded engine history snapshots requiring identity/revision/fingerprint validation; not a CAD interchange format.',
      },
      eachFieldUsesOneRoleCodeFromVocabulary: true } }
}

function conversationSeed(scenario, fixture) {
  const content = `Current public synthetic document ${fixture.document.id}, revision ${fixture.document.revision}; no conversational edit was approved.`
  return ['followup', 'correction'].includes(scenario.interaction) ? [{ role: 'user', content }] : []
}
function facts(source) {
  const { columnStylePack, sectionStylePack, hatchPack, ...input } = source.input
  return { kind: source.kind, facts: input }
}
const project = entity => ({ id: entity.id, type: entity.type, payload: clone(entity.payload) })
const sorted = entities => entities.map(project).sort((a, b) => a.id.localeCompare(b.id))
function contentOfSnapshot(snapshot) {
  // Detached replay has independent clock/audit records, not independent CAD
  // facts. All document content fields remain exact; only modification time
  // and the revision audit sequence are not part of the content projection.
  const { revision, revisions, metadata, ...content } = snapshot
  return { ...content, metadata: { ...metadata, modifiedAt: null } }
}
const completeContent = document => contentOfSnapshot(document.snapshot())
function sourceAfterChange(before, change) {
  const next = clone(before), holes = next.kind === 'column' ? [next.input.hole] : next.input.holes
  if (change.kind === 'boundary') {
    const hole = holes.find(item => item.id === change.holeId)
    for (const row of change.rows) Object.assign(hole.strata.find(item => item.intervalId === row.intervalId), { top: row.top, bottom: row.bottom })
  } else for (const update of change.updates ?? []) {
    const hole = holes.find(item => item.id === update.holeId)
    for (const [key, value] of Object.entries(update)) {
      if (key === 'holeId') continue
      if (key === 'observationChanges') {
        for (const operation of value.update) {
          const target = hole.observations.find(item => item.kind === operation.target.kind && item.id === operation.target.id &&
            item.depth === operation.target.expectedDepth)
          assert.ok(target, 'caller observation target must exist in declared BEFORE source')
          Object.assign(target, clone(operation.set))
        }
      } else hole[key] = clone(value)
    }
  }
  return next
}
async function addManualNote(fixture) {
  await fixture.document.transact('Add public unowned fixed review note', tx => tx.createEntity('TEXT', {
    position: [10, -12, 0], height: 2, text: '人工核对备注 Manual note: never move or rewrite.',
    styleId: fixture.document.getTable('textStyles').currentId }, { id: 'NOTE-MANUAL' }))
  fixture.identityAliases['NOTE-MANUAL'] = { nativeId: 'NOTE-MANUAL', handle: fixture.document.getObject('NOTE-MANUAL').handle }
}
async function reopenAssigned(fixture) {
  const bytes = await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' })
  const before = state(fixture.document), document = await fixture.sdk.readDocument(bytes, { format: 'KJD' })
  assert.equal(state(document), before, 'assigned KJD must actually reopen exactly')
  fixture.document = document; fixture.artifact = { format: 'KJD', bytes }
}
async function sourceGold(fixture, reference, change) {
  const previous = readGeologyDrawingRecipe(reference, fixture.drawingId), afterSource = sourceAfterChange(previous.source, change)
  const beforeUndoCount = reference.history.undoCount
  const before = reference.fork(), revision = prepareGeologyDrawingRevision(reference, previous, afterSource, { expectedRevision: reference.revision })
  await applyGeologyDrawingRevision(reference, previous, afterSource, { expectedRevision: reference.revision })
  return { kind: 'source', proposalTool: 'cad_propose_geology_revision', command: 'GEOLOGY_DRAWING_UPDATE',
    expectedRevision: before.revision, beforeSource: clone(previous.source), afterSource,
    before: sorted(revision.before), after: sorted(revision.after), unchangedIds: [...revision.unchangedIds],
    beforeDocument: before, afterDocument: reference.fork(), beforeUndoCount, afterUndoCount: beforeUndoCount + 1,
    declaredChange: clone(change) }
}
async function manualGold(fixture, reference, change) {
  const beforeUndoCount = reference.history.undoCount
  const before = reference.fork(), ids = change.ids, beforeEntities = ids.map(id => before.getObject(id))
  await fixture.sdk.executeCommand('MOVE', { ids, dx: change.dx, dy: change.dy, expectedRevision: reference.revision }, { document: reference })
  return { kind: 'manual', proposalTool: 'cad_propose_move', command: 'MOVE', expectedRevision: before.revision,
    beforeSource: clone(readGeologyDrawingRecipe(before, fixture.drawingId).source),
    afterSource: clone(readGeologyDrawingRecipe(reference, fixture.drawingId).source),
    before: sorted(beforeEntities), after: sorted(ids.map(id => reference.getObject(id))), unchangedIds: [],
    beforeDocument: before, afterDocument: reference.fork(), beforeUndoCount, afterUndoCount: beforeUndoCount + 1,
    declaredChange: clone(change) }
}
async function callNative(session, calls, name, args) {
  const result = await session.call(name, args)
  calls.push({ name, args: clone(args), result })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.value
}
async function actualChange(fixture, change, gold) {
  const session = new KJAgentToolSession(fixture.sdk, fixture.document), calls = [], expectedRevision = fixture.document.revision
  const current = await callNative(session, calls, 'cad_read_geology_source', { expectedRevision, drawingId: fixture.drawingId, maxBytes: 262144 })
  let args, name
  if (change.kind === 'manual') {
    await callNative(session, calls, 'cad_read_drawing', {})
    name = 'cad_propose_move'; args = { expectedRevision, units: 'millimeter', ids: change.ids, dx: change.dx, dy: change.dy }
  } else {
    let updates = clone(change.updates)
    if (change.kind === 'boundary') {
      const strata = clone(current.facts.holes.find(hole => hole.id === change.holeId).strata)
      for (const row of change.rows) Object.assign(strata.find(item => item.intervalId === row.intervalId), { top: row.top, bottom: row.bottom })
      updates = [{ holeId: change.holeId, strata }]
    }
    name = 'cad_propose_geology_revision'; args = { expectedRevision, units: 'millimeter', drawingId: fixture.drawingId, updates }
  }
  const beforeState = state(fixture.document), proposal = await callNative(session, calls, name, args)
  assert.equal(state(fixture.document), beforeState, 'history setup proposal itself must not edit')
  assert.equal(same(sorted(proposal.preview.before), gold.before), true)
  assert.equal(same(sorted(proposal.preview.after), gold.after), true)
  const approval = await session.approve(proposal.planId, 'round8-public-native-history-setup-reviewer')
  assert.equal(approval.ok, true, JSON.stringify(approval.error))
  assert.equal(same(completeContent(fixture.document), completeContent(gold.afterDocument)), true,
    'each actual reviewed setup turn must match the independently replayed complete source/geometry/resources')
  assert.deepEqual(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source, gold.afterSource)
  assert.equal(round6SourceWorkflowPhysicalGeometryMatches(fixture.document.listEntities(), gold.afterSource), true)
  await callNative(session, calls, 'cad_read_history', { expectedRevision: fixture.document.revision })
  const fingerprint = fixture.document.fingerprint()
  assert.equal((await session.approve(proposal.planId, 'round8-public-native-history-setup-reviewer')).ok, false)
  assert.equal(fixture.document.fingerprint(), fingerprint)
  return { index: change.index, toolCalls: calls, proposal, approval, approvedPlanId: proposal.planId,
    beforeState, afterDocument: fixture.document.fork(), phase: 'committed', modelCalls: 0 }
}

async function stagingWorkspace() {
  const sdk = createKJDrawSDK(), members = []
  for (let index = 1; index <= 30; index++) {
    const document = sdk.createDocument({ units: 'millimeter' }), suffix = String(index).padStart(2, '0')
    const source = { kind: 'column', input: { expectedRevision: 0, units: 'millimeter', locale: 'zh-CN', verticalScaleDenominator: 200,
      hole: { id: `TEST-${suffix}`, collarElevation: 100 + index / 10, depth: 18, initialWaterDepth: 2, stableWaterDepth: 4,
        strata: [{ intervalId: `${suffix}-FILL`, code: '1', name: '填土', lithology: 'fill', top: 0, bottom: 3 },
          { intervalId: `${suffix}-CLAY`, code: '2', name: '黏土', lithology: 'clay', top: 3, bottom: 10 },
          { intervalId: `${suffix}-SAND`, code: '3', name: '砂土', lithology: 'sand', top: 10, bottom: 18 }],
        observations: [{ kind: 'sample', id: `S-${suffix}`, depth: 5 }, { kind: 'spt', id: `N-${suffix}`, depth: 12, value: 15 }] } } }
    const compiled = compileGeologyColumn(source.input)
    await sdk.executeCommand('CREATEBATCH', clone(compiled.commandArgs), { document })
    const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
    const bytes = await sdk.writeDocument(document, { format: 'KJD' }), reopened = await sdk.readDocument(bytes, { format: 'KJD' })
    assert.equal(state(reopened), state(document))
    assert.deepEqual(readGeologyDrawingRecipe(reopened, recipe.drawingId).source, source)
    members.push({ document: reopened, drawingId: recipe.drawingId, source, artifact: { format: 'KJD', bytes },
      initialState: state(reopened), completeDeclaredSource: { provenance, sourceUnits: 'meter', drawingUnits: 'millimeter', source: clone(source) } })
    // KJD preserves document ID. readDocument replaces the attached SDK entry;
    // closing the original ID here would detach the reopened document as well.
  }
  return { sdk, document: members[0].document, drawingId: members[0].drawingId, source: members[0].source,
    artifact: members[0].artifact, workspaceMembers: members, identityAliases: {}, sourceRecipePresent: true,
    dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}

export async function buildRound8ReviewedWorkflowFixture(value) {
  const scenario = resolve(value), descriptor = round8ReviewedWorkflowDescriptor(scenario)
  assert.ok(descriptor && !scenario.sequence)
  let fixture = descriptor.kind === 'read' ? await stagingWorkspace()
    : await buildPublicScenarioFixture('synthetic-source-section-v1', { branch: 'complete-occurrence-map' })
  try {
    fixture.fixtureId = descriptor.fixtureId; fixture.fixtureBranch = descriptor.fixtureBranch
    fixture.round8ReviewedWorkflowOracleId = descriptor.id
    fixture.suppliedInputs = round8ReviewedWorkflowCallerInputs(scenario)
    if (descriptor.kind !== 'read') {
      await addManualNote(fixture)
      await reopenAssigned(fixture)
      fixture.source = clone(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source)
    }
    if (descriptor.kind === 'source') {
      const other = await buildPublicScenarioFixture('synthetic-source-section-v1', { branch: 'complete-occurrence-map' })
      // A genuinely different document has the same TEST-A and TEST-B names.
      // Native context, not the spelling of the hole ID, determines the target.
      const previous = readGeologyDrawingRecipe(other.document, other.drawingId), changed = clone(previous.source)
      changed.input.holes[0].stableWaterDepth = 6
      await applyGeologyDrawingRevision(other.document, previous, changed, { expectedRevision: other.document.revision })
      const bytes = await other.sdk.writeDocument(other.document, { format: 'KJD' })
      const otherDocument = await other.sdk.readDocument(bytes, { format: 'KJD' })
      fixture.unselectedWorkspaceMembers = [{ sdk: other.sdk, document: otherDocument, drawingId: other.drawingId,
        source: clone(changed), artifact: { format: 'KJD', bytes }, initialState: state(otherDocument) }]
      const dispose = fixture.dispose
      fixture.dispose = () => { dispose(); other.dispose() }
      fixture.suppliedInputs.selectedHistoricalContext = { provenance: 'actual-public-synthetic-kjd-native-context',
        selectedDocumentId: fixture.document.id, selectedDrawingId: fixture.drawingId,
        selectedArtifactFormat: 'KJD', unselectedDocuments: [{ documentId: otherDocument.id, drawingId: other.drawingId,
          declaredHoleIds: changed.input.holes.map(hole => hole.id), approvalGranted: false }] }
    }
    if (descriptor.kind === 'read') fixture.suppliedInputs.declaredWorkspace = {
      provenance: 'actual-public-synthetic-kjd-artifacts-and-caller-source-tables',
      documents: fixture.workspaceMembers.map(member => ({ documentId: member.document.id, drawingId: member.drawingId,
        artifactFormat: 'KJD', completeDeclaredSource: clone(member.completeDeclaredSource) })),
    }
    const reference = fixture.document.fork(), goldSteps = []
    if (descriptor.kind === 'mixed') {
      goldSteps.push(await sourceGold(fixture, reference, { kind: 'source', updates: fixture.suppliedInputs.confirmedMixedChanges.waterTable }))
      goldSteps.push(await manualGold(fixture, reference, { kind: 'manual', ...fixture.suppliedInputs.confirmedMixedChanges.manualDisplacement }))
    } else if (descriptor.kind === 'source') {
      goldSteps.push(await sourceGold(fixture, reference, { kind: 'source', updates: fixture.suppliedInputs.confirmedSelectedWaterTable.rows }))
    } else if (descriptor.kind === 'local-session') {
      const historyBaseline = fixture.document.fork(), actualHistory = []
      for (const change of ROUND8_TEN_REVIEWED_CHANGES) {
        const gold = change.kind === 'manual' ? await manualGold(fixture, reference, change) : await sourceGold(fixture, reference, change)
        goldSteps.push(gold); actualHistory.push(await actualChange(fixture, change, gold))
      }
      assert.equal(fixture.document.history.undoCount, 10, 'the actual reopened baseline has ten, not fictional conversational edits')
      fixture.actualHistoricalSetup = { modelCalls: 0, baselineDocument: historyBaseline, steps: actualHistory,
        historyArchive: clone(fixture.document.exportHistory({ limit: 20, maxBytes: 16777216 })) }
      assert.equal(fixture.actualHistoricalSetup.historyArchive.undo.length, 10, 'complete ten-step history must fit, never silently truncate')
      fixture.source = clone(readGeologyDrawingRecipe(fixture.document, fixture.drawingId).source)
    }
    Object.assign(fixture, { provenance: 'public-synthetic-only', initialRevision: fixture.document.revision,
      initialState: state(fixture.document), initialEntities: clone(fixture.document.listEntities()),
      oracleBaselineDocument: fixture.document.fork(), sourceRecipePresent: true,
      identityStrategy: 'actual-retained-kjd-native-identities', scenarioExecuted: false, modelCalls: 0 })
    fixture.conversationSeed = conversationSeed(scenario, fixture)
    references.set(fixture, { document: reference, steps: goldSteps,
      afterSource: clone(readGeologyDrawingRecipe(reference, fixture.drawingId).source),
      stagingRows: (fixture.workspaceMembers ?? []).map(member => ({ documentId: member.document.id,
        drawingId: member.drawingId, holeId: member.source.input.hole.id, sourceKind: 'column' })) })
    fixture.suppliedInputs = deepFreeze(fixture.suppliedInputs)
    return fixture
  } catch (error) { fixture.dispose(); throw error }
}

export function round8ReviewedWorkflowInputBindings(fixture) {
  return { ...scenarioFixtureInputBindings(fixture), drawingId: fixture.drawingId,
    sourceKind: fixture.source.kind, workflowContract: {
      independentHostActionsRequired: round8ReviewedWorkflowDescriptor(fixture.round8ReviewedWorkflowOracleId?.replace(/-exact-round8-reviewed-workflow-v1$/, ''))?.requiredHostActions ?? [],
      nativeFixtureValidationIsNotAModelOrBrowserPass: true } }
}
export function expectedRound8ReviewedWorkflowOutcome(value, fixture) {
  const descriptor = round8ReviewedWorkflowDescriptor(value), gold = references.get(fixture)
  if (!gold || fixture.round8ReviewedWorkflowOracleId !== descriptor?.id) throw new Error('No round8 detached reference')
  return { kind: descriptor.kind, drawingId: fixture.drawingId, afterSource: clone(gold.afterSource),
    steps: gold.steps.map(step => ({ kind: step.kind, proposalTool: step.proposalTool, command: step.command,
      expectedRevision: step.expectedRevision, beforeSource: clone(step.beforeSource), afterSource: clone(step.afterSource),
      beforeUndoCount: step.beforeUndoCount, afterUndoCount: step.afterUndoCount,
      before: clone(step.before), after: clone(step.after), unchangedIds: clone(step.unchangedIds),
      beforeContent: clone(completeContent(step.beforeDocument)), afterContent: clone(completeContent(step.afterDocument)) })),
    stagingRows: clone(gold.stagingRows) }
}

function checkedSourceRead(calls, fixture, step) {
  return calls.findIndex(call => call.name === 'cad_read_geology_source' && call.result?.ok === true &&
    call.args?.expectedRevision === step.expectedRevision && call.args?.drawingId === fixture.drawingId &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === step.expectedRevision &&
    call.result.value?.sourceUnits === 'meter' && same({ kind: call.result.value.kind, facts: call.result.value.facts }, facts(step.beforeSource)))
}
function stepAssertions(fixture, step, actual, { allowPending = false } = {}) {
  const checks = [], check = (id, satisfied) => checks.push({ id, satisfied: !!satisfied })
  const proposal = actual?.proposal, calls = actual?.toolCalls ?? [], phase = actual?.phase ?? actual?.stage
  const proposedIndex = calls.findIndex(call => call.name === step.proposalTool && call.result?.ok === true &&
    call.args?.expectedRevision === step.expectedRevision && same(call.result.value, proposal))
  const sourceRead = checkedSourceRead(calls, fixture, step)
  check('current-document-revision-checked', sourceRead >= 0 && sourceRead < proposedIndex)
  check('read-retained-source-before-revision', sourceRead >= 0 && sourceRead < proposedIndex)
  check('all-native-reads-succeeded', calls.filter(call => call.name.startsWith('cad_read_')).every(call => call.result?.ok === true))
  check('actual-native-proposal-tool-evidence', proposedIndex >= 0 && proposal?.documentId === fixture.document.id &&
    proposal?.expectedRevision === step.expectedRevision && proposal?.command === step.command)
  check('full-before-after-preview', proposal?.preview?.documentId === fixture.document.id &&
    proposal?.preview?.revision === step.expectedRevision && same(sorted(proposal?.preview?.before ?? []), step.before) &&
    same(sorted(proposal?.preview?.after ?? []), step.after))
  if (step.kind === 'source') {
    check('source-before-after-diff-visible', same(proposal?.engineeringEvidence?.beforeSource, facts(step.beforeSource)) &&
      same(proposal?.engineeringEvidence?.afterSource, facts(step.afterSource)))
    check('unchanged-identity-map-complete', same([...(proposal?.unchangedIds ?? [])].sort(), [...step.unchangedIds].sort()))
  } else check('manual-move-exact-and-not-a-source-rewrite', same(proposal?.arguments?.ids, step.declaredChange.ids) &&
    proposal?.arguments?.dx === step.declaredChange.dx && proposal?.arguments?.dy === step.declaredChange.dy && same(step.beforeSource, step.afterSource))
  if (phase === 'pending' && allowPending) {
    check('no-mutation-during-preview', actual?.afterDocument && same(completeContent(actual.afterDocument), completeContent(step.beforeDocument)) &&
      actual.afterDocument.revision === step.expectedRevision)
    check('explicit-host-approval-before-commit', proposal?.status === 'awaiting-host-approval' && !actual?.approval && !actual?.approvalReceipt)
  } else {
    let beforeSnapshot
    try { beforeSnapshot = JSON.parse(actual?.beforeState) } catch { /* absent/non-native state is failed evidence */ }
    check('no-mutation-during-preview', beforeSnapshot?.documentId === fixture.document.id &&
      beforeSnapshot?.revision === step.expectedRevision && same(contentOfSnapshot(beforeSnapshot ?? {}), completeContent(step.beforeDocument)))
    const approval = actual?.approval ?? actual?.approvalReceipt, receipt = approval?.value ?? approval
    check('explicit-host-approval-before-commit', phase === 'committed' && (approval?.ok === true || actual?.hostApprovalApplied === true) &&
      receipt?.status === 'committed' && receipt.command === step.command && receipt.beforeRevision === step.expectedRevision &&
      receipt.afterRevision === step.expectedRevision + 1 && (actual?.approvedPlanId ?? receipt?.planId) === proposal?.planId &&
      (!Object.hasOwn(receipt ?? {}, 'planId') || receipt.planId === proposal?.planId))
    check('exact-complete-content-after-commit', actual?.afterDocument &&
      same(completeContent(actual.afterDocument), completeContent(step.afterDocument)) && actual.afterDocument.revision === step.expectedRevision + 1)
    let source
    try { source = readGeologyDrawingRecipe(actual.afterDocument, fixture.drawingId).source } catch { /* failed native source evidence */ }
    check('complete-source-after-commit', same(source, step.afterSource))
    check('native-hatch-depth-and-water-geometry', actual?.afterDocument &&
      round6SourceWorkflowPhysicalGeometryMatches(actual.afterDocument.listEntities(), step.afterSource))
    check('one-native-history-operation', calls.some(call => call.name === 'cad_read_history' && call.result?.ok === true &&
      call.args?.expectedRevision === step.expectedRevision + 1 && call.result.value?.documentId === fixture.document.id &&
      call.result.value?.revision === step.expectedRevision + 1 && call.result.value?.history?.undoCount === step.afterUndoCount &&
      call.result.value?.history?.redoCount === 0))
  }
  return checks
}

/** A checked partial preview is not completion of the whole mixed request. */
export function evaluateRound8ReviewedStepOracle(value, fixture, index, evidence) {
  const descriptor = round8ReviewedWorkflowDescriptor(value), gold = references.get(fixture), step = gold?.steps[index]
  if (!descriptor || !step || !evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin))
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-round8-step-evidence-missing' }
  const assertions = stepAssertions(fixture, step, evidence, { allowPending: true })
  return { status: assertions.every(item => item.satisfied) ? 'satisfied' : 'failed', assertions,
    oracleId: descriptor.id, scenarioPassed: null, scenarioExecuted: false, completeWorkflow: false }
}

/** Actually reopen both byte streams and validate local history; receipt is unforgeable within this process. */
export async function verifyRound8ArchiveArtifacts(fixture, { kjdBytes, dxfBytes, historyArchive }) {
  const gold = references.get(fixture)
  if (!gold || !kjdBytes || !dxfBytes || !historyArchive) throw new Error('Complete real archive bytes and separate local history are required')
  const sdk = createKJDrawSDK(), kjd = await sdk.readDocument(kjdBytes, { format: 'KJD' })
  try {
    assert.equal(state(kjd), state(fixture.document), 'actual KJD bytes must contain current full state, not a different drawing or stale snapshot')
    assert.equal(same(completeContent(kjd), completeContent(gold.document)), true, 'actual bytes must match detached final geometry/source/resources')
    assert.deepEqual(readGeologyDrawingRecipe(kjd, fixture.drawingId).source, gold.afterSource)
    assert.equal(round6SourceWorkflowPhysicalGeometryMatches(kjd.listEntities(), gold.afterSource), true)
    const dxf = await sdk.readDocument(dxfBytes, { format: 'DXF' })
    assert.equal(dxf.validate().valid, true)
    assert.equal(same(suppliedCreationDocumentSemantics(dxf), suppliedCreationDocumentSemantics(kjd)), true,
      'actual DXF must preserve full physical geometry, handles, HATCH loops/patterns and resource semantics')
    assert.throws(() => readGeologyDrawingRecipe(dxf, fixture.drawingId), /source|recipe|drawing/i)
    assert.equal(kjd.history.undoCount, 0, 'KJD source backup alone does not silently recover edit history')
    await kjd.restoreHistory(clone(historyArchive), { expectedRevision: kjd.revision })
    assert.equal(kjd.history.undoCount, historyArchive.undo.length)
    assert.equal(same(completeContent(kjd), completeContent(gold.document)), true, 'validated history restore must not modify current content')
    const token = Object.freeze({ schema: 'round8-actual-archive-byte-verification-v1' })
    archiveProofs.set(token, { fixture, documentId: fixture.document.id, revision: fixture.document.revision,
      state: fixture.initialState, fingerprint: fixture.document.fingerprint(), historyCount: kjd.history.undoCount,
      kjdBytes: clone(kjdBytes), dxfBytes: clone(dxfBytes), historyArchive: clone(historyArchive) })
    return token
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
}

export function evaluateRound8ReviewedWorkflowOracle(value, fixture, evidence) {
  const descriptor = round8ReviewedWorkflowDescriptor(value), gold = references.get(fixture)
  if (!gold || !descriptor || fixture.round8ReviewedWorkflowOracleId !== descriptor.id)
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'round8-oracle-not-prepared' }
  if (!evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) || !evidence.afterDocument)
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-round8-evidence-missing' }
  const assertions = [], check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  if (descriptor.kind === 'source' || descriptor.kind === 'mixed') {
    const steps = evidence.steps ?? (descriptor.kind === 'source' ? [evidence] : [])
    check('entire-reviewed-workflow-step-count', steps.length === gold.steps.length)
    gold.steps.forEach((step, index) => assertions.push(...stepAssertions(fixture, step, steps[index]).map(item => ({
      id: `step-${index + 1}:${item.id}`, satisfied: item.satisfied }))))
    check('source-and-cad-diffs-visible', gold.steps.every((step, index) => steps[index]?.proposal?.command === step.command))
    check('mixed-atomicity-or-ordering-explicit', descriptor.kind !== 'mixed' ||
      evidence.reviewPolicy?.wholeRequestIsNotOneAtomicTransaction === true &&
      same(evidence.reviewPolicy?.order, fixture.suppliedInputs.confirmedMixedChanges.reviewPolicy.order))
    check('all-unrequested-native-content-unchanged', same(completeContent(evidence.afterDocument), completeContent(gold.document)))
    check('selected-historical-recipe-identity', descriptor.kind !== 'source' ||
      evidence.afterDocument.id === fixture.suppliedInputs.selectedHistoricalContext.selectedDocumentId &&
      (fixture.unselectedWorkspaceMembers ?? []).every(member => state(member.document) === member.initialState))
    check('exact-final-revision', evidence.afterDocument.revision === fixture.initialRevision + gold.steps.length)
  } else if (descriptor.kind === 'read') {
    const calls = evidence.toolCalls ?? [], plan = evidence.answer?.batchPlan
    check('assigned-current-document-identity-unchanged', evidence.afterDocument.id === fixture.document.id &&
      state(evidence.afterDocument) === fixture.initialState)
    check('every-read-is-public-successful-and-current-workspace-bound', calls.length > 0 && calls.every(call => {
      const tool = publicReadTools.get(call.name), result = call.result?.value
      const member = fixture.workspaceMembers.find(member => member.document.id === result?.documentId)
      if (!tool || call.result?.ok !== true || !member || result?.revision !== member.document.revision) return false
      if ((tool.inputSchema.required ?? []).includes('expectedRevision') && call.args?.expectedRevision !== result.revision) return false
      if (Object.hasOwn(call.args ?? {}, 'expectedRevision') && call.args.expectedRevision !== result.revision) return false
      if (call.name === 'cad_read_geology_source' && !['', member.drawingId].includes(call.args?.drawingId)) return false
      return true
    }))
    check('current-document-revision-checked', fixture.workspaceMembers.every(member => calls.some(call =>
      call.name === 'cad_read_geology_source' && call.result?.ok === true && call.args?.expectedRevision === member.document.revision &&
      call.args?.drawingId === member.drawingId && call.result.value?.documentId === member.document.id &&
      call.result.value?.revision === member.document.revision && call.result.value?.sourceUnits === 'meter' &&
      same({ kind: call.result.value.kind, facts: call.result.value.facts }, facts(member.source)))))
    check('batch-distinct-root-identities', Array.isArray(plan?.drawings) && plan.drawings.length === gold.stagingRows.length &&
      new Set(plan.drawings.map(row => row.documentId)).size === gold.stagingRows.length &&
      same([...plan.drawings].sort((a, b) => a.documentId.localeCompare(b.documentId)),
        [...gold.stagingRows].sort((a, b) => a.documentId.localeCompare(b.documentId))))
    const batches = plan?.batches
    const members = Array.isArray(batches) ? batches.flatMap(batch => batch.documentIds ?? []) : []
    check('batch-partition-complete-no-duplicates', Array.isArray(batches) && batches.length > 0 && batches.length <= 30 &&
      batches.every(batch => same(Object.keys(batch), ['documentIds']) && Array.isArray(batch.documentIds) &&
        batch.documentIds.length > 0 && batch.documentIds.length <= fixture.suppliedInputs.callerBatchPolicy.maxDrawingsPerBatch) &&
      members.length === 30 && new Set(members).size === 30 && same([...members].sort(), gold.stagingRows.map(row => row.documentId).sort()))
    check('staging-no-implicit-approval', plan?.requiresSeparateHostApproval === true && !evidence.proposal &&
      !evidence.approval && !evidence.approvalReceipt && calls.every(call => publicReadTools.has(call.name)))
    check('read-only-state-unchanged', fixture.workspaceMembers.every(member => state(member.document) === member.initialState))
  } else {
    const proof = archiveProofs.get(evidence.archiveVerification), history = fixture.actualHistoricalSetup
    const calls = evidence.toolCalls ?? []
    check('current-document-revision-checked', calls.some(call => call.name === 'cad_read_geology_source' &&
      call.result?.ok === true && call.args?.drawingId === fixture.drawingId && call.args?.expectedRevision === fixture.initialRevision &&
      call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
      same({ kind: call.result.value.kind, facts: call.result.value.facts }, facts(gold.afterSource))))
    check('actual-final-history-inventory-read', calls.some(call => call.name === 'cad_read_history' && call.result?.ok === true &&
      call.args?.expectedRevision === fixture.initialRevision && call.result.value?.documentId === fixture.document.id &&
      call.result.value?.history?.undoCount === 10 && call.result.value?.history?.redoCount === 0))
    check('actual-ten-reviewed-native-setup-not-chat', history?.steps.length === 10 && gold.steps.length === 10 &&
      history.steps.every((actual, index) => stepAssertions(fixture, gold.steps[index], actual).every(item => item.satisfied)))
    check('actual-archive-bytes-and-local-history-reopened', proof?.fixture === fixture && proof.documentId === fixture.document.id &&
      proof.revision === fixture.initialRevision && proof.state === fixture.initialState && proof.fingerprint === fixture.document.fingerprint() &&
      proof.historyCount === 10 && same(proof.historyArchive, history?.historyArchive))
    check('long-history-final-state-reopen-comparison', same(completeContent(evidence.afterDocument), completeContent(gold.document)) &&
      state(evidence.afterDocument) === fixture.initialState)
    check('source-archive-distinguished-from-dxf', evidence.answer?.archiveFormats?.KJD === 'native-source-backup' &&
      evidence.answer?.archiveFormats?.DXF === 'graphics-exchange-no-native-source' &&
      evidence.answer?.archiveFormats?.history === 'separate-local-history-archive')
    // Native selftests can verify serialization, but cannot fake a browser action.
    const refresh = evidence.browserRefreshEvidence
    check('actual-browser-refresh-action-required-for-real-model-pass', evidence.origin === 'fixture-oracle-selftest' ||
      refresh?.action === 'browser-session-save-refresh-reopen' && refresh?.performed === true &&
      refresh?.beforeDocumentId === fixture.document.id && refresh?.afterDocumentId === fixture.document.id &&
      refresh?.beforeRevision === fixture.initialRevision && refresh?.afterRevision === fixture.initialRevision &&
      refresh?.beforeState === fixture.initialState && refresh?.afterState === fixture.initialState)
  }
  const exact = assertions.every(item => item.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(item => item.id === id)) check(id, exact)
  const satisfied = assertions.every(item => item.satisfied)
  const actionsVerified = descriptor.requiredHostActions.every(action => evidence.actualHostActions?.includes(action))
  return { status: satisfied ? 'satisfied' : 'failed', oracleId: descriptor.id, assertions,
    evidenceOrigin: evidence.origin, nativeContractSatisfied: satisfied, hostActionsVerified: actionsVerified,
    scenarioPassed: evidence.origin === 'real-model' && actionsVerified ? satisfied : null,
    scenarioExecuted: evidence.origin === 'real-model' && actionsVerified }
}
