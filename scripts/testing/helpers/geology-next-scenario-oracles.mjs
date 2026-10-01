import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture, fixtureStateSignature, scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn, compileGeologySection } from '../../../packages/kjdraw-sdk/src/geology-engineering.js'
import { applyGeologyDrawingRevision, prepareGeologyDrawingRevision, readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../../../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'

// This additive module deliberately does not alter the active preflight, fixtures,
// frozen questions, runtime tools, or model-runner snapshot. Integrate explicitly
// into a NEW execution-surface version after its native self-tests pass.
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone
const same = (left, right) => canonicalStringify(left) === canonicalStringify(right)
const project = record => ({ id: record.id, type: record.type, payload: clone(record.payload) })
const sorted = records => records.map(project).sort((a, b) => a.id.localeCompare(b.id))

export const NEXT_SCENARIO_DESCRIPTORS = Object.freeze([
  { intent: 'source-water-depth.dated-groundwater-observation', kind: 'source', fixtureId: 'synthetic-source-column-v1', fixtureBranch: 'declared-groundwater-series-style' },
  { intent: 'source-strata.split-column-interval', kind: 'source', fixtureId: 'synthetic-source-column-v1', fixtureBranch: 'complete-caller-declared-column-split' },
  { intent: 'source-strata.append-bottom-stratum', kind: 'source', fixtureId: 'synthetic-source-column-v1', fixtureBranch: 'complete-caller-declared-bottom-interval' },
  { intent: 'source-section.add-identity-correlation', kind: 'source', fixtureId: 'synthetic-source-section-v1', fixtureBranch: 'complete-map-with-clay-explicitly-unlinked' },
  { intent: 'source-section.no-op-redraw', kind: 'read-only', fixtureId: 'synthetic-source-section-v1' },
  { intent: 'invalid-source.duplicate-stations', kind: 'fail-closed', fixtureId: 'synthetic-source-section-v1' },
  { intent: 'geological-presentation.manual-title-layout-change', kind: 'cad', fixtureId: 'synthetic-source-column-v1', fixtureBranch: 'unowned-manual-review-text' },
  { intent: 'geological-presentation.regeneration-preserves-manual-review', kind: 'source', fixtureId: 'synthetic-source-column-v1', fixtureBranch: 'unowned-manual-review-text' },
].map(descriptor => Object.freeze({ ...descriptor, id: `${descriptor.intent}-exact-next-oracle-v1`,
  supportedPrerequisites: Object.freeze([
    `fixture:${descriptor.fixtureId}`, 'document:current-revision-known', 'fixture:synthetic-public-data-only',
    'conversation:existing-same-document-context', 'conversation:prior-request-not-approved',
    ...(descriptor.intent === 'source-section.add-identity-correlation' ? ['source:clay-occurrences-explicitly-uncorrelated'] : []),
  ]),
  checks: Object.freeze(corpus.scenarios.find(item => item.expected.intent === descriptor.intent).expected.checks),
})))
const descriptors = new Map(NEXT_SCENARIO_DESCRIPTORS.map(descriptor => [descriptor.intent, descriptor]))
export const NEXT_ORACLE_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(scenario =>
  !scenario.sequence && descriptors.has(scenario.expected.intent)).map(scenario => scenario.id))

export const NEXT_REMAINING_BOUNDARIES = Object.freeze([
  { field: 'startDate/endDate', status: 'unsupported-revision-field', reason: 'Creation accepts dates, but cad_propose_geology_revision does not expose date fields. Do not change graphical date text and claim a source revision.' },
  { field: 'observations.rangeTop/rangeBottom/measurements', status: 'unsupported-agent-schema', reason: 'Native source types include these facts, but the current agent observation schema excludes them. A private compile route is not an agent pass.' },
  { field: 'groundwaterObservations on a section', status: 'unsupported-compiler-route', reason: 'Section compilation rejects dated groundwater observations. Stable summary water depths are a different field.' },
  { field: 'horizontalScaleDenominator/verticalScaleDenominator/datumElevation', status: 'unsupported-existing-layout-revision', reason: 'The current revision schema only revises hole facts and explicit correlation maps.' },
  { field: 'mixed source/manual approval', status: 'multi-proposal-driver-not-implemented-here', reason: 'Two independently reviewable native proposals need a bounded host ordering/approval driver; do not count one partial proposal as whole-task success.' },
  { field: 'creation, browser refresh, file export, multi-turn sequences', status: 'adapter-not-implemented-here', reason: 'These require their own blank-input, host session, artifact, and sequence adapters, not an ordinary source-revision oracle.' },
])

function resolveScenario(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(item => item.id === value)
  if (!scenario) throw new Error(`Unknown frozen scenario ID: ${value}`)
  return scenario
}

export function nextScenarioDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  const scenario = typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value
  const intent = scenario?.expected?.intent
  return descriptors.get(intent) ?? null
}

export function assessNextScenarioReadiness(value) {
  const scenario = resolveScenario(value), descriptor = descriptors.get(scenario.expected.intent)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', reason: 'no-next-oracle-descriptor', scenarioPassed: null }
  const unsupportedPrerequisites = scenario.prerequisites.filter(item => !descriptor.supportedPrerequisites.includes(item))
  return { status: unsupportedPrerequisites.length ? 'not-ready' : 'runnable', oracleId: descriptor.id,
    unsupportedPrerequisites, executionStatus: 'not-run', modelCalls: 0, scenarioPassed: null }
}

/** Only placeholders/output fields are public protocol; no answer values or selected edit targets. */
export function nextScenarioAnswerFrame(value) {
  const descriptor = nextScenarioDescriptor(value)
  if (descriptor?.kind === 'read-only') return '{"documentId":"current native document ID","revision":0,"drawingId":"retained drawing ID","sourceBacked":false,"sourceGeometryConsistent":false,"sourceFactsChanged":false,"revisionRequired":false}'
  if (descriptor?.kind === 'fail-closed') return '{"documentId":"current native document ID","revision":0,"decision":"blocked or clarification-required","issue":{"field":"native update field path","suppliedValue":"actual supplied invalid value or structured values","constraint":{"relation":"actual symbolic relation","units":"source units"}},"missingFields":["native schema field path"],"questions":[{"field":"native schema field path","question":"question"}]} (choose the actual decision after reading; issue may be null if no invalid value was supplied. Preserve actual JSON value types.)'
  return null
}

/** Complete caller facts, not independent-oracle conclusions. */
export function nextScenarioFixtureInputBindings(fixture) {
  return scenarioFixtureInputBindings(fixture)
}

function groundwaterPack() {
  const pack = clone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  pack.id = 'public-synthetic-groundwater-annotation-v1'
  pack.title = 'Caller-declared groundwater lane using bundled redistributable layout'
  pack.rules['geology-column-layout'].groundwaterAnnotationStyle = {
    fieldRole: 'pattern', textHeight: 1.5, markerHeight: 1.5, textWidthFactor: 0.7,
    gap: 0.5, valueOffset: 3, markerOffset: 0, dateOffset: -3,
  }
  return pack
}

async function rebuiltSourceFixture(base, source, descriptor, suppliedInputs) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  try {
    const compiled = source.kind === 'column' ? compileGeologyColumn(source.input) : compileGeologySection(source.input)
    await sdk.executeCommand('CREATEBATCH', clone(compiled.commandArgs), { document })
    const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
    await document.transact('Add unowned public review objects', transaction => {
      transaction.createEntity('CIRCLE', { center: [90, 90, 0], radius: 3 }, { id: 'CIRCLE-MANUAL' })
      if (descriptor.fixtureBranch === 'unowned-manual-review-text') {
        transaction.createEntity('TEXT', { position: [15, 310, 0], text: '手工复核标题 Manual review title', height: 2 }, { id: 'TEXT-TITLE' })
        transaction.createEntity('TEXT', { position: [15, -8, 0], text: '人工校核备注 Manual review note', height: 2 }, { id: 'NOTE-MANUAL' })
      }
    })
    const bytes = await sdk.writeDocument(document, { format: 'KJD' })
    const reopened = await sdk.readDocument(bytes, { format: 'KJD' })
    assert.deepEqual(readGeologyDrawingRecipe(reopened, recipe.drawingId).source, source)
    assert.equal(reopened.validate().valid, true)
    const aliases = ['CIRCLE-MANUAL', 'TEXT-TITLE', 'NOTE-MANUAL'].filter(id => reopened.getObject(id))
    return { ...base, sdk, document: reopened, source, drawingId: recipe.drawingId,
      fixtureBranch: descriptor.fixtureBranch, ...(suppliedInputs ? { suppliedInputs } : {}),
      initialRevision: reopened.revision, initialState: fixtureStateSignature(reopened),
      initialEntities: clone(reopened.listEntities()), oracleBaselineDocument: reopened.fork(),
      identityAliases: Object.fromEntries(aliases.map(id => {
        const entity = reopened.getObject(id)
        return [id, { nativeId: id, handle: entity.handle, type: entity.type }]
      })), artifact: { format: 'KJD', bytes },
      builtFeatures: [...base.builtFeatures, descriptor.fixtureBranch].filter(Boolean),
      conversationSeed: base.conversationSeed.map(message => ({ ...message, content: message.content
        .replaceAll(base.document.id, reopened.id).replace(`revision ${base.initialRevision}`, `revision ${reopened.revision}`) })),
      dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) },
    }
  } catch (error) {
    for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id)
    throw error
  }
}

export async function buildNextScenarioFixture(value) {
  const scenario = resolveScenario(value), descriptor = descriptors.get(scenario.expected.intent)
  const readiness = assessNextScenarioReadiness(scenario)
  if (readiness.status !== 'runnable') throw new Error('Next scenario has unsupported prerequisites or no executable descriptor')
  const base = await buildPublicScenarioFixture(descriptor.fixtureId, { prerequisites: scenario.prerequisites })
  if (!descriptor.fixtureBranch) return prepareDetachedOracleState(scenario, base)
  const source = clone(base.source)
  let suppliedInputs
  if (descriptor.fixtureBranch === 'declared-groundwater-series-style') {
    source.input.columnStylePack = groundwaterPack()
    source.input.hole.groundwaterObservations = [{ depth: 5.5, elevation: 101, observedOn: '2026-09-01', marker: 'filled-down-triangle' }]
    suppliedInputs = { groundwaterMarkerConvention: { provenance: 'caller-declared-public-synthetic-not-measurement-certified',
      marker: 'filled-down-triangle', units: 'metre', observationDateFormat: 'YYYY-MM-DD' } }
  } else if (descriptor.fixtureBranch === 'complete-caller-declared-column-split') {
    suppliedInputs = { confirmedColumnSplitIntervals: { provenance: 'caller-declared-public-synthetic-not-measurement-certified', holeId: 'TEST-A', units: 'metre',
      intervals: [
        { intervalId: 'I-SAND-1', code: '3-1', name: scenario.language === 'en' ? 'Sand' : '砂土', lithology: 'sand', top: 10, bottom: 14 },
        { intervalId: 'I-GRAVEL', code: '3-2', name: scenario.language === 'en' ? 'Gravel' : '砾砂', lithology: 'gravel', top: 14, bottom: 18 },
      ] } }
  } else if (descriptor.fixtureBranch === 'complete-caller-declared-bottom-interval') {
    suppliedInputs = { confirmedBottomInterval: { provenance: 'caller-declared-public-synthetic-not-measurement-certified', holeId: 'TEST-A', units: 'metre',
      interval: { intervalId: 'I-ROCK', code: '4', name: scenario.language === 'en' ? 'Rock' : '岩层', lithology: 'rock', top: 18, bottom: 20 } } }
  } else if (descriptor.fixtureBranch === 'complete-map-with-clay-explicitly-unlinked') {
    source.input.sourceFactMode = 'complete-occurrence-map'
    source.input.correlations = source.input.correlations.filter(link => link.fromIntervalId !== 'I-CLAY')
    source.input.uncorrelatedOccurrences = [
      { holeId: 'TEST-A', adjacentHoleId: 'TEST-B', intervalId: 'I-CLAY' },
      { holeId: 'TEST-B', adjacentHoleId: 'TEST-A', intervalId: 'B-CLAY' },
    ]
  }
  try { return await prepareDetachedOracleState(scenario, await rebuiltSourceFixture(base, source, descriptor, suppliedInputs)) }
  finally { base.dispose() }
}

async function prepareDetachedOracleState(scenario, fixture) {
  try {
    Object.defineProperty(fixture, 'nextOracleDescriptorId', { value: nextScenarioDescriptor(scenario).id, enumerable: false })
    const gold = expectedNextScenarioOutcome(scenario, fixture)
    if (gold.kind === 'read-only') return fixture
    const reference = fixture.oracleBaselineDocument.fork()
    if (gold.kind === 'source') {
      await applyGeologyDrawingRevision(reference, readGeologyDrawingRecipe(reference, fixture.drawingId), gold.afterSource, { expectedRevision: fixture.initialRevision })
    } else await fixture.sdk.executeCommand('MOVE', { ids: gold.targetIds, dx: 0, dy: 5 }, { document: reference })
    assert.equal(fixtureStateSignature(fixture.document), fixture.initialState, 'oracle compilation must not mutate the assigned input document')
    // Non-enumerable and never returned by input bindings: gold and reference
    // geometry must remain outside every model prompt. This is only a detached
    // oracle branch, not a user execution, approval, or model pass.
    Object.defineProperty(fixture, 'oracleExpectedCommittedState', { value: clone(reference.snapshot()), enumerable: false })
    return fixture
  } catch (error) { fixture.dispose(); throw error }
}

/** Gold computation is never called by the model prompt builder. */
export function expectedNextScenarioOutcome(value, fixture) {
  const scenario = resolveScenario(value), descriptor = descriptors.get(scenario.expected.intent)
  if (!descriptor) throw new Error('No next outcome descriptor')
  if (descriptor.kind === 'read-only' || descriptor.kind === 'fail-closed') return { kind: 'read-only', answer: expectedNextScenarioAnswer(scenario, fixture) }
  if (descriptor.kind === 'cad') {
    const id = fixture.identityAliases['TEXT-TITLE'].nativeId
    const before = [project(fixture.oracleBaselineDocument.getObject(id))], after = clone(before)
    for (const field of ['position', 'alignmentPoint']) if (after[0].payload[field]) after[0].payload[field][1] += 5
    return { kind: 'cad', before, after, targetIds: [id] }
  }
  const afterSource = clone(fixture.source), hole = afterSource.kind === 'column' ? afterSource.input.hole : afterSource.input.holes[0]
  switch (descriptor.intent) {
    case 'source-water-depth.dated-groundwater-observation':
      hole.groundwaterObservations.push({ depth: 4.5, elevation: 102, observedOn: '2026-09-02', marker: 'filled-down-triangle' })
      break
    case 'source-strata.split-column-interval':
      hole.strata.splice(2, 1, ...clone(fixture.suppliedInputs.confirmedColumnSplitIntervals.intervals))
      break
    case 'source-strata.append-bottom-stratum':
      hole.depth = 20
      hole.strata.push(clone(fixture.suppliedInputs.confirmedBottomInterval.interval))
      break
    case 'source-section.add-identity-correlation':
      afterSource.input.correlations.push({ fromHoleId: 'TEST-A', toHoleId: 'TEST-B', fromIntervalId: 'I-CLAY', toIntervalId: 'B-CLAY' })
      afterSource.input.uncorrelatedOccurrences = []
      break
    case 'geological-presentation.regeneration-preserves-manual-review':
      hole.stableWaterDepth = 4.5
      break
    default: throw new Error('Next source oracle lacks an explicit requested update')
  }
  const reference = prepareGeologyDrawingRevision(fixture.oracleBaselineDocument,
    readGeologyDrawingRecipe(fixture.oracleBaselineDocument, fixture.drawingId), afterSource, { expectedRevision: fixture.initialRevision })
  return { kind: 'source', beforeSource: clone(fixture.source), afterSource,
    before: sorted(reference.before), after: sorted(reference.after), unchangedIds: reference.unchangedIds,
    removedIds: reference.removedIds, createdIds: reference.createdIds, nextRecipe: reference.recipe, drawingId: fixture.drawingId }
}

export function expectedNextScenarioAnswer(value, fixture) {
  const descriptor = nextScenarioDescriptor(value)
  if (descriptor?.kind === 'read-only') return { documentId: fixture.document.id, revision: fixture.initialRevision,
    drawingId: fixture.drawingId, sourceBacked: true, sourceGeometryConsistent: true, sourceFactsChanged: false, revisionRequired: false }
  if (descriptor?.kind === 'fail-closed') return { documentId: fixture.document.id, revision: fixture.initialRevision, decision: 'blocked',
    issue: { field: 'updates[].station', suppliedValue: [0, 0], constraint: { relation: 'pairwise-distinct', units: 'metre' } }, missingFields: [], questions: [] }
  return null
}

function normalizeUnits(value) {
  if (Array.isArray(value)) return value.map(normalizeUnits)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'units' && ['meter', 'metre', 'm'].includes(item) ? 'meter' : normalizeUnits(item)]))
}

function sourceFacts(source) {
  const { columnStylePack, sectionStylePack, hatchPack, ...facts } = source.input
  return { kind: source.kind, facts }
}

function exactCommittedState(actualDocument, referenceState, command) {
  const actual = clone(actualDocument.snapshot()), reference = clone(referenceState)
  if (!reference) return false
  const actualEntry = actual.revisions.at(-1), referenceEntry = reference.revisions.at(-1)
  // The oracle branch executes later and has a separate clock/envelope. Validate
  // those exact generated metadata fields, then bind the reference to them;
  // all prior journals, operations, object metadata, units and resources remain
  // in the full-state comparison. No geometric/source field is normalized.
  if (!actualEntry || !referenceEntry || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(actualEntry.at) ||
    !Number.isFinite(Date.parse(actualEntry.at)) || actual.metadata.modifiedAt !== actualEntry.at) return false
  reference.metadata.modifiedAt = actual.metadata.modifiedAt
  referenceEntry.at = actualEntry.at
  if (command === 'MOVE') {
    const metadata = actualEntry.metadata
    if (metadata?.commandProtocol !== 'com.kanjie.kjdraw.command@1' ||
      !/^command-[a-f0-9-]{36}$/.test(metadata.commandEnvelopeId ?? '') || !same(metadata.commandOrigin, { kind: 'ai' })) return false
    referenceEntry.metadata.commandEnvelopeId = metadata.commandEnvelopeId
    referenceEntry.metadata.commandProtocol = metadata.commandProtocol
    referenceEntry.metadata.commandOrigin = clone(metadata.commandOrigin)
  }
  return same(actual, reference)
}

/** Exact collected-evidence oracle; never interpret user prose or approve a plan. */
export function evaluateNextScenarioOracle(value, fixture, evidence) {
  const scenario = resolveScenario(value), descriptor = descriptors.get(scenario.expected.intent)
  if (assessNextScenarioReadiness(scenario).status !== 'runnable') return { status: 'not-evaluated', scenarioPassed: null, reason: 'scenario-not-ready' }
  if (!evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) ||
    !evidence.afterDocument || !Array.isArray(evidence.toolCalls) ||
    (!evidence.toolCalls.length && ['read-only', 'fail-closed'].includes(descriptor.kind))) {
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-execution-evidence-missing' }
  }
  const assertions = [], check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  const calls = evidence.toolCalls, phase = evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage)
  const sourceRead = calls.find(call => call.name === 'cad_read_geology_source' && call.result?.ok === true &&
    call.args?.drawingId === fixture.drawingId && call.args?.expectedRevision === fixture.initialRevision &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
    same({ kind: call.result.value.kind, facts: call.result.value.facts }, sourceFacts(fixture.source)))
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id)
  if (descriptor.kind === 'read-only' || descriptor.kind === 'fail-closed') {
    if (evidence.origin === 'real-model') {
      try {
        if (!same(JSON.parse(evidence.rawFinalAnswer), evidence.answer)) return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-structured-model-answer-missing-or-mismatched' }
      } catch { return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-model-answer-is-not-valid-structured-json' } }
    }
    check('exact-retained-source-actually-read', !!sourceRead)
    check('only-successful-native-read-tools', calls.every(call => ['cad_read_drawing', 'cad_query_drawing', 'cad_read_page', 'cad_find_text', 'cad_read_geology_source'].includes(call.name) &&
      call.result?.ok === true && call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision))
    check('read-only-state-unchanged', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
    check('exact-answer-equals-independent-fixture-facts', same(normalizeUnits(evidence.answer), normalizeUnits(expectedNextScenarioAnswer(scenario, fixture))))
  } else {
    const gold = expectedNextScenarioOutcome(scenario, fixture), proposal = evidence.proposal
    if (!proposal) return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-native-proposal-missing' }
    const toolName = descriptor.kind === 'cad' ? 'cad_propose_move' : 'cad_propose_geology_revision'
    const proposalIndex = calls.findIndex(call => call.name === toolName && call.result?.ok === true &&
      call.args?.expectedRevision === fixture.initialRevision && same(call.result.value, proposal))
    check('actual-native-proposal-tool-evidence', proposalIndex >= 0)
    check('full-before-after-preview', proposal.documentId === fixture.document.id && proposal.expectedRevision === fixture.initialRevision &&
      proposal.preview?.documentId === fixture.document.id && proposal.preview?.revision === fixture.initialRevision &&
      same(sorted(proposal.preview.before ?? []), gold.before) && same(sorted(proposal.preview.after ?? []), gold.after))
    if (descriptor.kind === 'source') {
      check('read-retained-source-before-revision', !!sourceRead && calls.indexOf(sourceRead) < proposalIndex)
      check('source-before-after-diff-visible', same(proposal.engineeringEvidence?.beforeSource, sourceFacts(gold.beforeSource)) &&
        same(proposal.engineeringEvidence?.afterSource, sourceFacts(gold.afterSource)))
    }
    if (phase === 'pending') {
      check('no-mutation-during-preview', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
      check('explicit-host-approval-before-commit', proposal.status === 'awaiting-host-approval' && !evidence.approval && !evidence.approvalReceipt)
    } else if (phase === 'committed') {
      const approval = evidence.approval ?? evidence.approvalReceipt, receipt = approval?.value ?? approval
      check('explicit-host-approval-before-commit', (approval?.ok === true || receipt?.status === 'committed') && receipt?.command === proposal.command &&
        receipt?.beforeRevision === fixture.initialRevision && receipt?.afterRevision === fixture.initialRevision + 1 &&
        (evidence.approvedPlanId ?? receipt?.planId) === proposal.planId)
      check('exact-full-native-state-after-commit', exactCommittedState(evidence.afterDocument, fixture.oracleExpectedCommittedState, proposal.command))
      if (gold.kind === 'source') {
        let retainedSource
        try { retainedSource = readGeologyDrawingRecipe(evidence.afterDocument, fixture.drawingId).source } catch { /* A generated geometry/source conflict is a failed oracle, never a fatal batch stop. */ }
        check('exact-source-facts-and-generated-native-geometry', same(retainedSource, gold.afterSource))
      }
    } else check('supported-collected-evidence-phase', false)
  }
  const exactSatisfied = assertions.every(assertion => assertion.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(assertion => assertion.id === id)) check(id, exactSatisfied)
  return { status: assertions.every(assertion => assertion.satisfied) ? 'satisfied' : 'failed', oracleId: descriptor.id,
    evidenceOrigin: evidence.origin, phase, scenarioPassed: evidence.origin === 'real-model' ? assertions.every(assertion => assertion.satisfied) : null,
    scenarioExecuted: evidence.origin === 'real-model', assertions }
}
