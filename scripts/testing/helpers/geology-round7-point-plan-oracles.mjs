import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { buildAgentGeologyPlan } from '../../../packages/kjdraw-sdk/src/agent-geology-plan.js'
import { canonicalStringify, deepFreeze } from '../../../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone, same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const references = new WeakMap()
const intents = ['investigation-point-layout.supplied-point-plan', 'investigation-point-layout.chinese-point-plan',
  'investigation-point-layout.explicit-section-route']
export const ROUND7_POINT_PLAN_DESCRIPTORS = deepFreeze(intents.map(intent => ({
  id: `${intent}-exact-round7-point-plan-v1`, intent, fixtureId: 'synthetic-source-section-v1',
  fixtureBranch: `round7-point-plan-${intent}`, kind: 'creation', proposalTool: 'cad_propose_geology_plan',
  command: 'CREATEBATCH', sourceKind: 'supplied-point-location', requiresBlankDocument: true,
  sourceBeforePolicy: 'actual-empty-native-source-list', retainedGeologyRecipe: false,
  requiresHostProposalTool: 'cad_propose_geology_plan',
  supportedPrerequisites: ['fixture:synthetic-source-section-v1', 'document:current-revision-known',
    'fixture:synthetic-public-data-only', 'document:blank-millimetre', 'source:complete-point-location-input',
    'source:complete-three-point-route-input', 'conversation:existing-same-document-context', 'conversation:prior-request-not-approved'],
  checks: corpus.scenarios.find(scenario => scenario.expected.intent === intent).expected.checks,
})))
const descriptors = new Map(ROUND7_POINT_PLAN_DESCRIPTORS.map(descriptor => [descriptor.intent, descriptor]))
export const ROUND7_POINT_PLAN_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(scenario => !scenario.sequence &&
  descriptors.has(scenario.expected.intent)).map(scenario => scenario.id))
function resolve(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(scenario => scenario.id === value)
  if (!scenario) throw new Error(`Unknown frozen round7 point-plan scenario: ${value}`)
  return scenario
}
export function round7PointPlanDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  const scenario = typeof value === 'string' ? corpus.scenarios.find(scenario => scenario.id === value) : value
  return descriptors.get(scenario?.expected?.intent) ?? null
}
export function assessRound7PointPlanReadiness(value) {
  const scenario = resolve(value), descriptor = round7PointPlanDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', reason: 'no-round7-point-plan-oracle', scenarioPassed: null }
  const unsupportedPrerequisites = scenario.prerequisites.filter(prerequisite => !descriptor.supportedPrerequisites.includes(prerequisite))
  return { status: unsupportedPrerequisites.length ? 'not-ready' : 'runnable', unsupportedPrerequisites,
    oracleId: descriptor.id, modelCalls: 0, executionStatus: 'not-run', scenarioPassed: null,
    hostToolExposureVerified: false, requiredHostProposalTool: descriptor.requiresHostProposalTool }
}

/** Every point, elevation, depth, route, scale and annotation is DECLARED public
 * synthetic caller input. No EPSG, measured provenance or actual site is guessed.
 * Engineering X labels are northing; model position is [easting,northing]. */
export function round7PointPlanCallerInputs(value) {
  const scenario = resolve(value), descriptor = round7PointPlanDescriptor(scenario)
  if (!descriptor) throw new Error('No round7 complete point-source descriptor')
  const chinese = descriptor.intent.endsWith('chinese-point-plan') || scenario.language !== 'en'
  const boreholes = [{ id: 'TEST-A', position: [1015, 2020], collarElevation: 106.5, depth: 18 },
    { id: 'TEST-B', position: [1095, 2060], collarElevation: 107.5, depth: 21 },
    { id: 'TEST-C', position: [1055, 2025], collarElevation: 108.25, depth: 24 }]
  const offsets = [[5, 12], [5, 12], [5, 16]]
  return { completePointLocationInput: {
    provenance: 'caller-declared-public-synthetic-not-measurement-certified', sourceUnits: 'meter', drawingUnits: 'millimeter',
    coordinateReference: { status: 'declared-local-synthetic-frame-not-a-survey-crs', modelPositionOrder: ['easting', 'northing'],
      engineeringCoordinateLabels: { X: 'northing', Y: 'easting' }, northDirection: 'model-positive-Y' },
    input: { version: '1.0.0', units: 'meter', locale: chinese ? 'zh-CN' : 'en', drawingId: 'PUBLIC-POINT-PLAN-01',
      title: chinese ? '勘探点平面位置图（公开合成资料）' : 'Investigation point location plan (public synthetic)', scale: 1000,
      boundary: [[1000, 2000], [1120, 2000], [1120, 2080], [1000, 2080]], boreholes,
      sectionLines: [{ id: 'SECTION-A', holeIds: ['TEST-A', 'TEST-B', 'TEST-C'], label: 'A—A', endpointLabels: ['A', 'A'] }],
      coordinateCallouts: boreholes.map((hole, index) => {
        const [x, y] = hole.position, [dx, dy] = offsets[index]
        return { id: `COORD-${hole.id}`, point: [...hole.position], elbow: [x + dx, y + dy], landingEnd: [x + dx + 17, y + dy],
          xLabelPosition: [x + dx + 1, y + dy + 3], yLabelPosition: [x + dx + 1, y + dy - 3], precision: 3, textHeight: 1.25 }
      }), northAngleDegrees: 0 },
    templateDeclaration: { provenance: 'bundled-native-ISO-A3-plan-layout', paperUnits: 'millimeter', paperWidth: 420,
      paperHeight: 297, orientation: 'landscape', modelMayReplaceStyle: false },
  } }
}
const sorted = entities => entities.map(entity => ({ id: entity.id, type: entity.type, payload: clone(entity.payload) }))
  .sort((a, b) => a.id.localeCompare(b.id))
export async function buildRound7PointPlanFixture(value) {
  const scenario = resolve(value), descriptor = round7PointPlanDescriptor(scenario)
  assert.equal(assessRound7PointPlanReadiness(scenario).status, 'runnable')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const fixture = { sdk, document, fixtureId: descriptor.fixtureId, fixtureBranch: descriptor.fixtureBranch,
    identityAliases: {}, identityStrategy: 'actual-blank-native-millimetre-document', sourceRecipePresent: false,
    retainedGeologyRecipe: false, suppliedInputs: deepFreeze(round7PointPlanCallerInputs(scenario)),
    provenance: 'public-synthetic-only', round7PointPlanOracleId: descriptor.id,
    initialRevision: document.revision, initialState: canonicalStringify(document.snapshot()), initialEntities: [],
    oracleBaselineDocument: document.fork(), scenarioExecuted: false, modelCalls: 0,
    dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
  try {
    fixture.artifact = { format: 'KJD', bytes: await sdk.writeDocument(document, { format: 'KJD' }) }
    const context = `Current public synthetic blank millimetre document ${document.id}, revision ${document.revision}.`
    fixture.conversationSeed = scenario.prerequisites.includes('conversation:prior-request-not-approved')
      ? [{ role: 'user', content: `${context} The previous conversational request was not approved or executed. Wait for the corrected complete caller source input.` }]
      : scenario.prerequisites.includes('conversation:existing-same-document-context')
        ? [{ role: 'user', content: `${context} Continue using this same document. No conversational edit is pending or approved.` }] : []
    const input = { ...clone(fixture.suppliedInputs.completePointLocationInput.input), expectedRevision: fixture.initialRevision }
    const reference = document.fork(), compiled = buildAgentGeologyPlan(reference, input)
    await sdk.executeCommand('CREATEBATCH', clone(compiled.commandArgs), { document: reference })
    assert.equal(reference.validate().valid, true)
    assert.deepEqual(reference.snapshot().opaquePayloads, {}, 'point-plan graphics are NOT a column/section source recipe')
    references.set(fixture, { document: reference, commandArgs: clone(compiled.commandArgs), input,
      engineeringEvidence: clone(compiled.evidence), after: sorted(reference.listEntities()) })
    assert.equal(canonicalStringify(document.snapshot()), fixture.initialState)
    return fixture
  } catch (error) { fixture.dispose(); throw error }
}
export function round7PointPlanInputBindings(fixture) { return scenarioFixtureInputBindings(fixture) }
export function expectedRound7PointPlanOutcome(value, fixture) {
  const descriptor = round7PointPlanDescriptor(value), gold = references.get(fixture)
  if (!gold || fixture.round7PointPlanOracleId !== descriptor?.id) throw new Error('No detached point-plan reference')
  return { command: descriptor.command, proposalTool: descriptor.proposalTool, input: clone(gold.input),
    commandArgs: clone(gold.commandArgs), before: [], after: clone(gold.after), engineeringEvidence: clone(gold.engineeringEvidence) }
}

/** These application tags are not standardized DXF fields. Their loss is
 * explicitly tested, never presented as retained semantics. All geometric,
 * annotation, owner, style and plot fields remain in the exchanged projection. */
export const POINT_PLAN_NON_DXF_APPLICATION_FIELDS = Object.freeze(['semanticRole', 'sourceId', 'sourceBacked',
  'referencedHoleIds', 'pointKind', 'endpoint', 'segmentRole', 'coordinateAxis', 'coordinateValue', 'coordinateConvention'])
const viewportTransportCodes = new Set([5, 330, 100, 8, 67, 410, 10, 20, 30, 40, 41, 68, 69, 12, 22, 16, 26, 36,
  17, 27, 37, 42, 43, 44, 45, 51, 90])
function semanticReferences(value, document) {
  if (Array.isArray(value)) return value.map(item => semanticReferences(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, semanticReferences(item, document)]))
  const target = typeof value === 'string' ? document.getObject(value) : null
  return !target ? value : target.kind === 'entity' ? { entityHandle: target.handle, type: target.type }
    : { resourceType: target.type, resourceName: target.name }
}
export function round7PointPlanDxfPhysicalSemantics(document) {
  const allEntities = document.listEntities()
  const entities = allEntities.map(entity => {
    const payload = clone(entity.payload)
    for (const key of POINT_PLAN_NON_DXF_APPLICATION_FIELDS) delete payload[key]
    if (entity.type === 'VIEWPORT') {
      // DXF assigns an ordinal to the one floating viewport in each owner.
      const ownerViewports = allEntities.filter(item => item.type === 'VIEWPORT' && item.ownerId === entity.ownerId)
        .sort((a, b) => Number.parseInt(a.handle, 16) - Number.parseInt(b.handle, 16))
      payload.viewportId ??= ownerViewports.findIndex(item => item.id === entity.id) + 2
      if (payload.rawTags) {
        assert.ok(payload.rawTags.every(tag => viewportTransportCodes.has(tag.code)), 'unknown raw viewport fields cannot be silently erased')
        assert.equal(Number(payload.rawTags.find(tag => tag.code === 69)?.value), payload.viewportId)
        delete payload.rawTags
      }
    } else assert.equal(Object.hasOwn(payload, 'rawTags'), false, 'unexpected raw entity data requires a separate complete comparator')
    return { handle: entity.handle, type: entity.type, ownerName: document.getObject(entity.ownerId)?.name,
      payload: semanticReferences(payload, document) }
  }).sort((a, b) => a.handle.localeCompare(b.handle))
  const resources = ['layers', 'textStyles', 'linetypes', 'blockRecords'].map(table => ({ table,
    currentName: document.getObject(document.getTable(table).currentId)?.name,
    records: document.getTable(table).records.map(record => ({ type: record.type, name: record.name,
      payload: semanticReferences(record.payload, document) })).sort((a, b) => a.name.localeCompare(b.name)),
  }))
  const layouts = document.snapshot().spaces.layoutIds.map(id => {
    const layout = document.getObject(id), payload = clone(layout.payload)
    // The native viewportIds cache is not rebuilt by DXF import. Verify actual
    // physical owner membership instead; do NOT claim that this cache survived.
    payload.viewportIds = allEntities.filter(entity => entity.type === 'VIEWPORT' && entity.ownerId === payload.blockRecordId)
      .map(entity => entity.id).sort((a, b) => document.getObject(a).handle.localeCompare(document.getObject(b).handle))
    return { name: layout.name, payload: semanticReferences(payload, document) }
  }).sort((a, b) => a.name.localeCompare(b.name))
  return { units: document.snapshot().header.units, entities, resources, layouts }
}
const trimNumber = value => value.toFixed(2).replace(/\.0+$/u, '').replace(/(\.\d*?)0+$/u, '$1')
/** Independent complete caller-coordinate arithmetic, not compiler positions.
 * The original route deliberately is NOT shortest-neighbour order. */
export function round7PointPlanPhysicalGeometryMatches(value, input) {
  const document = Array.isArray(value) ? null : value, entities = document ? document.listEntities() : value
  if (!Array.isArray(entities)) return false
  const factor = 1000, p3 = point => [point[0] * factor, point[1] * factor, 0]
  const vertices = entity => (entity.payload.vertices ?? []).map(vertex => vertex.point ?? vertex)
  const layer = entity => document?.getObject(entity.payload.layerId)?.name
  const circles = entities.filter(entity => entity.type === 'CIRCLE')
  // Marker offsets are source metres before the local host conversion. Keep
  // that dimensional operation order rather than subtracting rounded CAD mm.
  const sourceRadius = 2.2 * input.scale / 1000, sourceHeight = 2.5 * input.scale / 1000
  const radius = sourceRadius * factor
  if (circles.length !== input.boreholes.length || !input.boreholes.every(hole => {
    const center = p3(hole.position)
    return circles.some(entity => same(entity.payload.center, center) && entity.payload.radius === radius) &&
      entities.some(entity => entity.type === 'LINE' && same(entity.payload.start, p3([hole.position[0] - sourceRadius, hole.position[1]])) && same(entity.payload.end, p3([hole.position[0] + sourceRadius, hole.position[1]]))) &&
      entities.some(entity => entity.type === 'LINE' && same(entity.payload.start, p3([hole.position[0], hole.position[1] - sourceRadius])) && same(entity.payload.end, p3([hole.position[0], hole.position[1] + sourceRadius]))) &&
      entities.some(entity => entity.type === 'TEXT' && entity.payload.text === hole.id &&
        same(entity.payload.position, p3([hole.position[0] + sourceRadius * 1.25, hole.position[1] + sourceHeight * 0.25]))) &&
      entities.some(entity => entity.type === 'TEXT' && entity.payload.text === `H=${trimNumber(hole.collarElevation)}  D=${trimNumber(hole.depth)}`)
  })) return false
  const boundary = entities.filter(entity => entity.type === 'LWPOLYLINE' &&
    (entity.payload.semanticRole === 'survey-boundary' || layer(entity) === 'BOUNDARY'))
  if (boundary.length !== 1 || !boundary[0].payload.closed || !same(vertices(boundary[0]), input.boundary.map(p3))) return false
  const routes = entities.filter(entity => entity.type === 'LWPOLYLINE' &&
    (entity.payload.semanticRole === 'section-line' || layer(entity) === 'SECTIONS'))
  if (routes.length !== input.sectionLines.length || !input.sectionLines.every(route => routes.some(entity => !entity.payload.closed &&
    same(vertices(entity), route.holeIds.map(id => p3(input.boreholes.find(hole => hole.id === id).position)))))) return false
  for (const callout of input.coordinateCallouts) {
    if (!entities.some(entity => entity.type === 'TEXT' && entity.payload.text === `X=${callout.point[1].toFixed(callout.precision)}` &&
      same(entity.payload.position, p3(callout.xLabelPosition)) && entity.payload.height === callout.textHeight * factor) ||
      !entities.some(entity => entity.type === 'TEXT' && entity.payload.text === `Y=${callout.point[0].toFixed(callout.precision)}` &&
      same(entity.payload.position, p3(callout.yLabelPosition)) && entity.payload.height === callout.textHeight * factor)) return false
  }
  if (!entities.some(entity => entity.type === 'TEXT' && entity.payload.text === input.title) ||
    !entities.some(entity => entity.type === 'TEXT' && entity.payload.text === (input.locale === 'zh-CN' ? '北' : 'N'))) return false
  const viewport = entities.filter(entity => entity.type === 'VIEWPORT')
  const min = [0, 1].map(axis => Math.min(...input.boundary.map(point => point[axis])))
  const max = [0, 1].map(axis => Math.max(...input.boundary.map(point => point[axis])))
  const margin = 4 * input.scale / 1000, arrowLength = 12 * input.scale / 1000
  const angle = (90 + input.northAngleDegrees) * Math.PI / 180
  const arrowBase = [max[0] - margin * 1.4, max[1] - margin * 1.4]
  const arrowTip = [arrowBase[0] + Math.cos(angle) * arrowLength, arrowBase[1] + Math.sin(angle) * arrowLength]
  if (!entities.some(entity => entity.type === 'LINE' && same(entity.payload.start, p3(arrowBase)) && same(entity.payload.end, p3(arrowTip)))) return false
  if (viewport.length !== 1 || !same(viewport[0].payload.center, [210, 155, 0]) || viewport[0].payload.width !== 390 ||
    viewport[0].payload.height !== 250 || viewport[0].payload.viewHeight !== 250 * input.scale ||
    !same(viewport[0].payload.viewCenter, [(min[0] + max[0]) * factor / 2, (min[1] + max[1]) * factor / 2, 0]) ||
    viewport[0].payload.twistAngle !== 0) return false
  if (document) {
    const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id))
      .find(layout => layout.payload.blockRecordId === viewport[0].ownerId)
    if (!layout || !same(layout.payload.paper, { width: 420, height: 297, unit: 'mm' }) ||
      layout.payload.dxfPlotSettings?.paperWidth !== 420 || layout.payload.dxfPlotSettings?.paperHeight !== 297 ||
      layout.payload.dxfPlotSettings?.scaleNumerator !== 1 || layout.payload.dxfPlotSettings?.scaleDenominator !== 1) return false
  }
  return entities.every(entity => entity.type !== 'HATCH') // no geology/fill facts were supplied
}

export function evaluateRound7PointPlanOracle(value, fixture, evidence) {
  const scenario = resolve(value), descriptor = round7PointPlanDescriptor(scenario), gold = references.get(fixture)
  if (!gold || assessRound7PointPlanReadiness(scenario).status !== 'runnable') return { status: 'not-evaluated', scenarioPassed: null }
  if (!evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) || !evidence.proposal ||
    !evidence.afterDocument || !Array.isArray(evidence.toolCalls)) return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-point-plan-evidence-missing' }
  const calls = evidence.toolCalls, proposal = evidence.proposal, assertions = []
  const check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  const proposalIndex = calls.findIndex(call => call.name === descriptor.proposalTool && call.result?.ok === true &&
    call.args?.expectedRevision === fixture.initialRevision && same(call.result.value, proposal))
  const blankRead = calls.findIndex(call => call.name === 'cad_read_drawing' && call.result?.ok === true &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
    call.result.value?.units === 'millimeter' && call.result.value?.truncated === false && same(call.result.value?.entities, []))
  const sourceRead = calls.findIndex(call => call.name === 'cad_read_geology_source' && call.result?.ok === true &&
    call.args?.expectedRevision === fixture.initialRevision && call.args?.drawingId === '' &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
    call.result.value?.sourceBacked === false && same(call.result.value?.drawingIds, []))
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id &&
    blankRead >= 0 && sourceRead >= 0 && blankRead < proposalIndex && sourceRead < proposalIndex)
  check('actual-meter-source-millimetre-host-plan-tool', proposalIndex >= 0 && proposal.units === 'meter' &&
    proposal.engineeringEvidence?.sourceUnits === 'meter' && proposal.engineeringEvidence?.units === 'millimeter')
  check('complete-caller-input-and-resources-preserved', same(proposal.arguments, gold.commandArgs))
  check('full-before-after-preview', proposal.command === 'CREATEBATCH' && proposal.documentId === fixture.document.id &&
    proposal.expectedRevision === fixture.initialRevision && proposal.preview?.documentId === fixture.document.id &&
    proposal.preview?.revision === fixture.initialRevision && same(sorted(proposal.preview?.before ?? []), []) &&
    same(sorted(proposal.preview?.after ?? []), gold.after))
  check('all-supplied-points-and-routes-preserved', round7PointPlanPhysicalGeometryMatches(proposal.preview?.after ?? [], gold.input))
  check('explicit-section-route-order', same(proposal.engineeringEvidence?.sectionReferences, gold.engineeringEvidence.sectionReferences))
  check('source-label-convention-not-inferred', proposal.engineeringEvidence?.coordinateConvention === 'engineering X=northing, Y=easting')
  const phase = evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage)
  if (phase === 'pending') {
    check('no-mutation-during-preview', canonicalStringify(evidence.afterDocument.snapshot()) === fixture.initialState)
    check('explicit-host-approval-before-commit', proposal.status === 'awaiting-host-approval' && !evidence.approval && !evidence.approvalReceipt)
  } else if (phase === 'committed') {
    const approval = evidence.approval ?? evidence.approvalReceipt, receipt = approval?.value ?? approval
    check('explicit-host-approval-before-commit', (approval?.ok === true || evidence.hostApprovalApplied === true) &&
      receipt?.status === 'committed' && receipt?.command === 'CREATEBATCH' && receipt?.beforeRevision === fixture.initialRevision &&
      receipt?.afterRevision === fixture.initialRevision + 1 && (evidence.approvedPlanId ?? receipt?.planId) === proposal.planId &&
      (receipt?.planId == null || receipt.planId === proposal.planId))
    check('whole-point-plan-atomic', evidence.afterDocument.revision === fixture.initialRevision + 1 &&
      evidence.afterDocument.history.undoCount === fixture.oracleBaselineDocument.history.undoCount + 1)
    check('complete-native-objects-resources-and-layout', same(evidence.afterDocument.snapshot().objects, gold.document.snapshot().objects) &&
      same(evidence.afterDocument.snapshot().tables, gold.document.snapshot().tables) && same(evidence.afterDocument.snapshot().spaces, gold.document.snapshot().spaces))
    check('complete-physical-point-route-coordinate-layout', round7PointPlanPhysicalGeometryMatches(evidence.afterDocument, gold.input))
    check('no-retained-column-section-recipe-claim', same(evidence.afterDocument.snapshot().opaquePayloads, {}))
  } else check('supported-point-plan-phase', false)
  const complete = assertions.every(assertion => assertion.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(assertion => assertion.id === id)) check(id, complete)
  const satisfied = assertions.every(assertion => assertion.satisfied)
  return { status: satisfied ? 'satisfied' : 'failed', oracleId: descriptor.id, phase, assertions,
    evidenceOrigin: evidence.origin, scenarioPassed: evidence.origin === 'real-model' ? satisfied : null,
    scenarioExecuted: evidence.origin === 'real-model' }
}
