import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture, fixtureStateSignature, scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologyColumn, compileGeologySection } from '../../../packages/kjdraw-sdk/src/geology-engineering.js'
import { applyGeologyDrawingRevision, prepareGeologyDrawingRevision, readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../../../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'

// Additive, detached from the active preflight and model snapshot. This file
// implements native fixture/oracle machinery, not a natural-language executor.
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const project = record => ({ id: record.id, type: record.type, payload: clone(record.payload) })
const sorted = records => records.map(project).sort((a, b) => a.id.localeCompare(b.id))
const revisionSchema = KJDRAW_AGENT_TOOLS.find(tool => tool.name === 'cad_propose_geology_revision').inputSchema
const publicReadTools = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))
const layoutFields = ['horizontalScaleDenominator', 'verticalScaleDenominator']
const provenance = 'caller-declared-public-synthetic-not-measurement-certified'

export const ROUND3_SCENARIO_DESCRIPTORS = Object.freeze([
  { intent: 'geological-presentation.declared-hatch-visibility', kind: 'source', fixtureId: 'synthetic-source-column-v1', fixtureBranch: 'sand-boundary-only-with-manual-note' },
  { intent: 'geological-presentation.source-pattern-label', kind: 'source', fixtureId: 'synthetic-source-column-v1', fixtureBranch: 'declared-pattern-label-style-with-manual-note' },
  { intent: 'investigation-preparation.coordinate-reference-check', kind: 'read-only', fixtureId: 'synthetic-source-section-v1', fixtureBranch: 'declared-local-location-table' },
  { intent: 'investigation-preparation.source-unit-audit', kind: 'read-only', fixtureId: 'synthetic-source-section-v1', fixtureBranch: 'mixed-unit-raw-sample-table' },
  { intent: 'investigation-preparation.layer-thickness-audit', kind: 'read-only', fixtureId: 'synthetic-source-section-v1', fixtureBranch: 'manual-review-note' },
  { intent: 'investigation-preparation.spt-record-completeness', kind: 'read-only', fixtureId: 'synthetic-source-section-v1', fixtureBranch: 'incomplete-raw-spt-table' },
  { intent: 'source-query.detect-source-graphic-drift', kind: 'read-only', fixtureId: 'synthetic-source-column-v1', fixtureBranch: 'actual-generated-line-manual-drift' },
  { intent: 'geological-presentation.unsupported-existing-scale-edit', kind: 'read-only', fixtureId: 'synthetic-source-section-v1', fixtureBranch: 'manual-review-note' },
].map(descriptor => Object.freeze({ ...descriptor, id: `${descriptor.intent}-exact-round3-oracle-v1`,
  supportedPrerequisites: Object.freeze([
    `fixture:${descriptor.fixtureId}`, 'fixture:synthetic-public-data-only', 'document:current-revision-known',
    'conversation:existing-same-document-context', 'conversation:prior-request-not-approved',
    ...(descriptor.intent === 'geological-presentation.declared-hatch-visibility' ? ['source:I-SAND-boundary-only-branch'] : []),
    ...(descriptor.intent === 'source-query.detect-source-graphic-drift' ? ['generated-object:manually-drifted'] : []),
    ...(descriptor.intent === 'geological-presentation.unsupported-existing-scale-edit' ? ['capability:hole-field-revision-only'] : []),
  ]), checks: Object.freeze(corpus.scenarios.find(scenario => scenario.expected.intent === descriptor.intent).expected.checks),
})))
const descriptors = new Map(ROUND3_SCENARIO_DESCRIPTORS.map(descriptor => [descriptor.intent, descriptor]))
export const ROUND3_ORACLE_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(scenario => !scenario.sequence &&
  descriptors.has(scenario.expected.intent)).map(scenario => scenario.id))

export const ROUND3_PRODUCT_GAPS = Object.freeze([
  { fields: ['observations.measurements not rendered by the declared field grid'], status: 'compiler-rejects-source-only-updates',
    reason: 'Revision exposes bounded sample ranges and numerical measurement maps. A source-only change with no supported drawing difference is still rejected; no source-only editing acceptance is claimed.' },
  { fields: ['section.holes[].groundwaterObservations'], status: 'compiler-rejects',
    reason: 'The section compiler explicitly rejects dated down-hole groundwater observations. Summary stableWaterDepth is not a series substitute.' },
  { fields: ['startDate', 'endDate'], status: 'revision-schema-missing',
    reason: 'Initial creation accepts dates, but the source revision tool exposes neither date field.' },
  { fields: ['horizontalScaleDenominator', 'verticalScaleDenominator', 'datumElevation'], status: 'revision-schema-missing',
    reason: 'Initial section creation supports these facts; existing source revisions currently only expose hole updates and explicit links.' },
  { fields: ['incomplete SPT source.value'], status: 'compiler-rejects-incomplete-source',
    reason: 'Incomplete caller input is audited as a raw supplied table, never registered as valid compiled source, rendered as zero, or certified.' },
])

function resolveScenario(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(item => item.id === value)
  if (!scenario) throw new Error(`Unknown frozen scenario ID: ${value}`)
  return scenario
}

export function round3ScenarioDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  const scenario = typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value
  return descriptors.get(scenario?.expected?.intent) ?? null
}

export function assessRound3ScenarioReadiness(value) {
  const scenario = resolveScenario(value), descriptor = round3ScenarioDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', reason: 'no-round3-oracle-descriptor', scenarioPassed: null }
  const unsupportedPrerequisites = scenario.prerequisites.filter(item => !descriptor.supportedPrerequisites.includes(item))
  const schemaChanged = descriptor.intent === 'geological-presentation.unsupported-existing-scale-edit' &&
    layoutFields.some(field => Object.hasOwn(revisionSchema.properties, field))
  return { status: unsupportedPrerequisites.length || schemaChanged ? 'not-ready' : 'runnable',
    oracleId: descriptor.id, unsupportedPrerequisites, ...(schemaChanged ? { reason: 'revision-capability-changed-reassess-boundary' } : {}),
    executionStatus: 'not-run', modelCalls: 0, scenarioPassed: null }
}

/** Response grammar only. Boolean and numeric literals are placeholders. */
export function round3ScenarioAnswerFrame(value) {
  const descriptor = round3ScenarioDescriptor(value)
  if (descriptor?.kind !== 'read-only') return null
  const header = '"documentId":"current native document ID","revision":0'
  const body = {
    'investigation-preparation.coordinate-reference-check': '"coordinateReference":{"id":"caller reference ID","scope":"caller declared reference scope"},"engineeringAxes":{"X":"declared axis role","Y":"declared axis role"},"units":"source units","points":[{"holeId":"source hole ID","X":0,"Y":0}],"axesSwapped":false,"conflicts":[]',
    'investigation-preparation.source-unit-audit': '"sourceUnits":"borehole source units","cadUnits":"CAD units","conflicts":[{"table":"raw supplied table name","holeId":"source hole ID","recordId":"source record ID","field":"raw field name","value":0,"actualUnits":"raw declared units","expectedUnits":"native source-field units"}]',
    'investigation-preparation.layer-thickness-audit': '"units":"borehole source units","holes":[{"holeId":"source hole ID","depth":0,"strata":[{"intervalId":"source interval ID","top":0,"bottom":0,"thickness":0}],"totalThickness":0,"matchesDepth":false,"gaps":[],"overlaps":[]}]',
    'investigation-preparation.spt-record-completeness': '"units":"borehole source units","records":[{"holeId":"source hole ID","id":"source observation ID","depth":0,"value":null,"missingFields":["actual missing raw field name"]}]',
    'source-query.detect-source-graphic-drift': '"drawingId":"retained drawing ID","sourceBacked":false,"sourceGeometryConsistent":false,"conflicts":[{"id":"native object ID from source validator","type":"native object type"}],"mutationAllowed":false',
    'geological-presentation.unsupported-existing-scale-edit': '"drawingId":"retained drawing ID","decision":"blocked or clarification-required","unsupportedFields":["requested native field name"],"currentLayout":{"horizontalScaleDenominator":0,"verticalScaleDenominator":0,"datumElevation":0},"sourceFactsChanged":false',
  }[descriptor.intent]
  return `{${header},${body}} (return all source/table records and actual findings; null marks an absent measured value, never zero. Array row order is not scored. Field names and placeholders do not supply answer values.)`
}

export function round3ScenarioFixtureInputBindings(fixture) { return scenarioFixtureInputBindings(fixture) }

function sourceFacts(source) {
  const { columnStylePack, sectionStylePack, hatchPack, ...facts } = source.input
  return { kind: source.kind, facts }
}

function sourceHoles(source) { return source.kind === 'column' ? [source.input.hole] : source.input.holes }

function locationTable(source) {
  return { provenance, coordinateReference: { id: 'PUBLIC-LOCAL-GRID', scope: 'caller-declared-local-no-global-datum' },
    engineeringAxes: { X: 'northing', Y: 'easting' }, units: 'metre',
    rows: sourceHoles(source).map(hole => ({ holeId: hole.id, X: hole.x, Y: hole.y })) }
}

function branchInputs(source, descriptor) {
  const holes = sourceHoles(source)
  if (descriptor.fixtureBranch === 'sand-boundary-only-with-manual-note') holes[0].strata[2].patternVisibility = 'boundary-only'
  if (descriptor.fixtureBranch === 'declared-pattern-label-style-with-manual-note') {
    const pack = clone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
    pack.id = 'public-synthetic-pattern-label-style-v1'
    pack.title = 'Caller-declared pattern label lane using bundled redistributable layout'
    pack.rules['geology-column-layout'].patternLabelStyle = { height: 1.5, textWidthFactor: 0.7, minimumBandHeight: 8 }
    source.input.columnStylePack = pack
    return { patternLabelConvention: { provenance, fieldRole: 'pattern', stylePackId: pack.id } }
  }
  if (['declared-local-location-table', 'mixed-unit-raw-sample-table'].includes(descriptor.fixtureBranch)) {
    holes.forEach((hole, index) => { hole.x = 4200 + index * 18; hole.y = 3200 + index * 9 })
    const inputs = { locationTable: locationTable(source) }
    if (descriptor.fixtureBranch === 'mixed-unit-raw-sample-table') inputs.sampleTable = { provenance, tableId: 'samples',
      rows: holes.flatMap((hole, holeIndex) => hole.observations.filter(item => item.kind === 'sample').map(item => ({
        holeId: hole.id, id: item.id, depth: holeIndex === 0 ? item.depth * 1000 : item.depth,
        units: holeIndex === 0 ? 'millimeter' : 'metre',
      }))) }
    return inputs
  }
  if (descriptor.fixtureBranch === 'incomplete-raw-spt-table') {
    const rows = holes.flatMap((hole, holeIndex) => hole.observations.filter(item => item.kind === 'spt').map(item => ({
      holeId: hole.id, id: item.id, depth: item.depth, ...(holeIndex === 0 ? { value: item.value } : {}),
    })))
    // A missing measured value cannot be a valid rendered native SPT. Keep the
    // incomplete caller row separate, omit that observation from compiled source,
    // and require an audit instead of inventing zero or changing source records.
    holes[1].observations = holes[1].observations.filter(item => item.kind !== 'spt')
    return { sptRecordTable: { provenance, units: 'metre', rows } }
  }
  return undefined
}

export async function buildRound3ScenarioFixture(value) {
  const scenario = resolveScenario(value), descriptor = round3ScenarioDescriptor(scenario)
  if (assessRound3ScenarioReadiness(scenario).status !== 'runnable') throw new Error('Round3 scenario has unsupported prerequisites or no executable descriptor')
  const base = await buildPublicScenarioFixture(descriptor.fixtureId, { prerequisites: scenario.prerequisites })
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  try {
    const source = clone(base.source), suppliedInputs = branchInputs(source, descriptor)
    const compiled = source.kind === 'column' ? compileGeologyColumn(source.input) : compileGeologySection(source.input)
    await sdk.executeCommand('CREATEBATCH', clone(compiled.commandArgs), { document })
    const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision: document.revision })
    await document.transact('Add unowned public manual review content', transaction => {
      const layerId = document.getTable('layers').currentId, styleId = document.getTable('textStyles').currentId
      transaction.createEntity('CIRCLE', { center: [90, 90, 0], radius: 3, layerId }, { id: 'CIRCLE-MANUAL' })
      transaction.createEntity('TEXT', { position: [12, -8, 0], text: '人工校核备注 Manual review note', height: 2, layerId, styleId }, { id: 'NOTE-MANUAL' })
    })
    let driftedId
    if (descriptor.fixtureBranch === 'actual-generated-line-manual-drift') {
      driftedId = recipe.entityIds.find(id => document.getObject(id).type === 'LINE')
      assert.ok(driftedId)
      await sdk.executeCommand('MOVE', { ids: [driftedId], dx: 1, dy: 0 }, { document })
      assert.throws(() => readGeologyDrawingRecipe(document, recipe.drawingId), /generated object changed/)
    }
    const bytes = await sdk.writeDocument(document, { format: 'KJD' })
    const reopened = await sdk.readDocument(bytes, { format: 'KJD' })
    assert.equal(reopened.validate().valid, true)
    if (!driftedId) assert.deepEqual(readGeologyDrawingRecipe(reopened, recipe.drawingId).source, source)
    const aliases = ['CIRCLE-MANUAL', 'NOTE-MANUAL']
    const fixture = { ...base, sdk, document: reopened, source, drawingId: recipe.drawingId, fixtureBranch: descriptor.fixtureBranch,
      ...(suppliedInputs ? { suppliedInputs } : {}), initialRevision: reopened.revision, initialState: fixtureStateSignature(reopened),
      initialEntities: clone(reopened.listEntities()), oracleBaselineDocument: reopened.fork(),
      identityAliases: Object.fromEntries(aliases.map(id => [id, { nativeId: id, handle: reopened.getObject(id).handle, type: reopened.getObject(id).type }])),
      artifact: { format: 'KJD', bytes }, builtFeatures: [...base.builtFeatures, descriptor.fixtureBranch, 'manual-review-note'],
      conversationSeed: base.conversationSeed.map(message => ({ ...message, content: message.content
        .replaceAll(base.document.id, reopened.id).replace(`revision ${base.initialRevision}`, `revision ${reopened.revision}`) })),
      dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) },
    }
    Object.defineProperty(fixture, 'round3OracleDescriptorId', { value: descriptor.id, enumerable: false })
    Object.defineProperty(fixture, 'oracleDriftedEntityIds', { value: driftedId ? [driftedId] : [], enumerable: false })
    const gold = expectedRound3ScenarioOutcome(scenario, fixture)
    if (gold.kind === 'source') {
      const reference = fixture.oracleBaselineDocument.fork()
      await applyGeologyDrawingRevision(reference, readGeologyDrawingRecipe(reference, fixture.drawingId), gold.afterSource,
        { expectedRevision: fixture.initialRevision })
      Object.defineProperty(fixture, 'oracleExpectedCommittedState', { value: clone(reference.snapshot()), enumerable: false })
      assert.equal(fixtureStateSignature(fixture.document), fixture.initialState, 'Detached gold compilation never modifies assigned input')
    }
    return fixture
  } catch (error) {
    for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id)
    throw error
  } finally { base.dispose() }
}

/** Independent requested facts, never a prompt/bindings builder. */
export function expectedRound3ScenarioOutcome(value, fixture) {
  const scenario = resolveScenario(value), descriptor = round3ScenarioDescriptor(scenario)
  if (!descriptor) throw new Error('No round3 outcome descriptor')
  if (descriptor.kind === 'read-only') return { kind: 'read-only', answer: expectedRound3ScenarioAnswer(scenario, fixture) }
  const afterSource = clone(fixture.source)
  if (descriptor.intent === 'geological-presentation.declared-hatch-visibility') afterSource.input.hole.strata[2].patternVisibility = 'filled'
  else if (descriptor.intent === 'geological-presentation.source-pattern-label') {
    afterSource.input.hole.strata[1].patternLabel = scenario.language === 'en' ? 'Silty clay' : '粉质黏土'
  } else throw new Error('Round3 source oracle lacks an explicit requested update')
  const revision = prepareGeologyDrawingRevision(fixture.oracleBaselineDocument,
    readGeologyDrawingRecipe(fixture.oracleBaselineDocument, fixture.drawingId), afterSource, { expectedRevision: fixture.initialRevision })
  return { kind: 'source', beforeSource: clone(fixture.source), afterSource, before: sorted(revision.before), after: sorted(revision.after),
    unchangedIds: revision.unchangedIds, createdIds: revision.createdIds, removedIds: revision.removedIds, nextRecipe: revision.recipe }
}

export function expectedRound3ScenarioAnswer(value, fixture) {
  const descriptor = round3ScenarioDescriptor(value), header = { documentId: fixture.document.id, revision: fixture.initialRevision }
  if (descriptor?.kind !== 'read-only') return null
  const holes = sourceHoles(fixture.source)
  switch (descriptor.intent) {
    case 'investigation-preparation.coordinate-reference-check': {
      const table = fixture.suppliedInputs.locationTable
      return { ...header, coordinateReference: clone(table.coordinateReference), engineeringAxes: clone(table.engineeringAxes), units: 'meter',
        points: table.rows.map(row => ({ holeId: row.holeId, X: row.X, Y: row.Y })), axesSwapped: false, conflicts: [] }
    }
    case 'investigation-preparation.source-unit-audit':
      return { ...header, sourceUnits: 'meter', cadUnits: fixture.document.snapshot().header.units,
        conflicts: fixture.suppliedInputs.sampleTable.rows.filter(row => !['m', 'meter', 'metre'].includes(row.units)).map(row => ({
          table: fixture.suppliedInputs.sampleTable.tableId, holeId: row.holeId, recordId: row.id, field: 'depth', value: row.depth, actualUnits: row.units, expectedUnits: 'meter',
        })) }
    case 'investigation-preparation.layer-thickness-audit':
      return { ...header, units: 'meter', holes: holes.map(hole => {
        const strata = hole.strata.map(layer => ({ intervalId: layer.intervalId, top: layer.top, bottom: layer.bottom, thickness: layer.bottom - layer.top }))
        const totalThickness = strata.reduce((sum, layer) => sum + layer.thickness, 0)
        return { holeId: hole.id, depth: hole.depth, strata, totalThickness, matchesDepth: Math.abs(totalThickness - hole.depth) <= 1e-6, gaps: [], overlaps: [] }
      }) }
    case 'investigation-preparation.spt-record-completeness':
      return { ...header, units: 'meter', records: fixture.suppliedInputs.sptRecordTable.rows.map(row => ({ holeId: row.holeId,
        id: row.id, depth: row.depth, value: Object.hasOwn(row, 'value') ? row.value : null, missingFields: Object.hasOwn(row, 'value') ? [] : ['value'] })) }
    case 'source-query.detect-source-graphic-drift':
      return { ...header, drawingId: fixture.drawingId, sourceBacked: true, sourceGeometryConsistent: false,
        conflicts: fixture.oracleDriftedEntityIds.map(id => ({ id, type: fixture.document.getObject(id).type })), mutationAllowed: false }
    case 'geological-presentation.unsupported-existing-scale-edit':
      return { ...header, drawingId: fixture.drawingId, decision: 'blocked', unsupportedFields: layoutFields.filter(field => !Object.hasOwn(revisionSchema.properties, field)),
        currentLayout: Object.fromEntries([...layoutFields, 'datumElevation'].map(field => [field, fixture.source.input[field]])), sourceFactsChanged: false }
    default: throw new Error('Round3 read oracle lacks an explicit fact computation')
  }
}

const unitKeys = new Set(['units', 'sourceUnits', 'cadUnits', 'actualUnits', 'expectedUnits'])
const unorderedRowKeys = new Set(['points', 'holes', 'strata', 'records', 'conflicts', 'unsupportedFields', 'missingFields'])
function normalizeAnswer(value, key = '') {
  if (Array.isArray(value)) {
    const items = value.map(item => normalizeAnswer(item))
    return unorderedRowKeys.has(key) ? items.sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b))) : items
  }
  if (!value || typeof value !== 'object') {
    if (unitKeys.has(key) && ['meter', 'metre', 'm'].includes(value)) return 'meter'
    if (unitKeys.has(key) && ['millimeter', 'millimetre', 'mm'].includes(value)) return 'millimeter'
    return value
  }
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, normalizeAnswer(item, name)]))
}

function exactCommittedState(actualDocument, referenceState) {
  const actual = clone(actualDocument.snapshot()), reference = clone(referenceState)
  if (!reference) return false
  const actualEntry = actual.revisions.at(-1), referenceEntry = reference.revisions.at(-1)
  if (!actualEntry || !referenceEntry || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(actualEntry.at) ||
    !Number.isFinite(Date.parse(actualEntry.at)) || actual.metadata.modifiedAt !== actualEntry.at) return false
  // Detached compiler clocks differ. These are the only reference fields bound
  // to the verified actual clock; every geometry/reference/journal field stays exact.
  reference.metadata.modifiedAt = actual.metadata.modifiedAt
  referenceEntry.at = actualEntry.at
  return same(actual, reference)
}

/** Score collected native evidence, never execute user prose or approve a plan. */
export function evaluateRound3ScenarioOracle(value, fixture, evidence, { answerContractVersion = 'v3' } = {}) {
  const scenario = resolveScenario(value), descriptor = round3ScenarioDescriptor(scenario)
  if (assessRound3ScenarioReadiness(scenario).status !== 'runnable') return { status: 'not-evaluated', scenarioPassed: null, reason: 'scenario-not-ready' }
  if (!evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) || !evidence.afterDocument ||
    !Array.isArray(evidence.toolCalls) || !evidence.toolCalls.length) return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-execution-evidence-missing' }
  const calls = evidence.toolCalls, assertions = [], check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  const sourceRead = calls.find(call => call.name === 'cad_read_geology_source' && call.args?.drawingId === fixture.drawingId &&
    call.args?.expectedRevision === fixture.initialRevision && call.result?.ok === true &&
    call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
    call.result.value?.sourceUnits === 'meter' && call.result.value?.drawingUnits === fixture.document.snapshot().header.units &&
    same({ kind: call.result.value.kind, facts: call.result.value.facts }, sourceFacts(fixture.source)))
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id)
  if (descriptor.kind === 'read-only') {
    if (evidence.origin === 'real-model') {
      try { if (!same(JSON.parse(evidence.rawFinalAnswer), evidence.answer)) return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-structured-model-answer-missing-or-mismatched' } }
      catch { return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-model-answer-is-not-valid-structured-json' } }
    }
    const drift = descriptor.fixtureBranch === 'actual-generated-line-manual-drift'
    const driftRead = drift && calls.find(call => call.name === 'cad_read_geology_source' && call.args?.drawingId === fixture.drawingId &&
      call.args?.expectedRevision === fixture.initialRevision && call.result?.ok === false &&
      fixture.oracleDriftedEntityIds.every(id => call.result.error?.message?.includes(`generated object changed: ${id};`)))
    const listed = drift && calls.find(call => call.name === 'cad_read_geology_source' && call.args?.drawingId === '' &&
      call.args?.expectedRevision === fixture.initialRevision && call.result?.ok === true &&
      call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
      same(call.result.value.drawingIds, [fixture.drawingId]) && call.result.value.sourceBacked === true)
    if (answerContractVersion === 'v5') {
      // The public validator rejects a drifted recipe before returning facts.
      // Bind EACH such rejection to the actual retained recipe, revision and
      // generated conflict identity. Do not require an unrelated listing call,
      // or excuse any other failed read merely because the task is read-only.
      const actualDriftRead = call => drift && call.name === 'cad_read_geology_source' &&
        call.args?.drawingId === fixture.drawingId && call.args?.expectedRevision === fixture.initialRevision &&
        call.result?.ok === false && call.result.error?.code === 'KJDOCUMENT_INVALID' &&
        fixture.oracleDriftedEntityIds.some(id => call.result.error.message ===
          `Geology drawing update: generated object changed: ${id}; reconcile manual edits before rebuilding`)
      check('exact-retained-source-actually-read', drift ? calls.some(actualDriftRead) : !!sourceRead)
      check('native-read-evidence-only', calls.every(call => publicReadTools.has(call.name) &&
        (actualDriftRead(call) || call.result?.ok === true &&
          call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision &&
          (call.name === 'cad_read_drawing' || call.args?.expectedRevision === fixture.initialRevision))))
      check('no-pending-plan-or-approval-in-read-only-task', !evidence.proposal && !evidence.approval && !evidence.approvalReceipt)
    } else {
      check('exact-retained-source-actually-read', drift ? !!listed && !!driftRead : !!sourceRead)
      check('native-read-evidence-only', calls.every(call => ['cad_read_drawing', 'cad_read_page', 'cad_query_drawing', 'cad_find_text', 'cad_read_geology_source'].includes(call.name) &&
        (call === driftRead || call.result?.ok === true && call.result.value?.documentId === fixture.document.id && call.result.value?.revision === fixture.initialRevision)))
    }
    check('read-only-state-unchanged', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
    check('exact-complete-answer-from-source-and-caller-tables', same(normalizeAnswer(evidence.answer), normalizeAnswer(expectedRound3ScenarioAnswer(scenario, fixture))))
    if (descriptor.intent === 'geological-presentation.unsupported-existing-scale-edit') check('actual-schema-has-no-requested-layout-fields',
      layoutFields.every(field => !Object.hasOwn(revisionSchema.properties, field)))
  } else {
    const gold = expectedRound3ScenarioOutcome(scenario, fixture), proposal = evidence.proposal
    if (!proposal) return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-native-proposal-missing' }
    const proposalIndex = calls.findIndex(call => call.name === 'cad_propose_geology_revision' && call.args?.expectedRevision === fixture.initialRevision &&
      call.result?.ok === true && same(call.result.value, proposal))
    check('actual-native-proposal-tool-evidence', proposalIndex >= 0)
    check('read-retained-source-before-revision', !!sourceRead && calls.indexOf(sourceRead) < proposalIndex)
    check('full-before-after-preview', proposal.documentId === fixture.document.id && proposal.expectedRevision === fixture.initialRevision &&
      proposal.preview?.documentId === fixture.document.id && proposal.preview?.revision === fixture.initialRevision &&
      same(sorted(proposal.preview.before ?? []), gold.before) && same(sorted(proposal.preview.after ?? []), gold.after))
    check('source-before-after-diff-visible', same(proposal.engineeringEvidence?.beforeSource, sourceFacts(gold.beforeSource)) &&
      same(proposal.engineeringEvidence?.afterSource, sourceFacts(gold.afterSource)))
    const phase = evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage)
    if (phase === 'pending') {
      check('no-mutation-during-preview', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
      check('explicit-host-approval-before-commit', proposal.status === 'awaiting-host-approval' && !evidence.approval && !evidence.approvalReceipt)
    } else if (phase === 'committed') {
      const approval = evidence.approval ?? evidence.approvalReceipt, receipt = approval?.value ?? approval
      check('explicit-host-approval-before-commit', (approval?.ok === true || receipt?.status === 'committed') && receipt?.command === proposal.command &&
        receipt?.beforeRevision === fixture.initialRevision && receipt?.afterRevision === fixture.initialRevision + 1 &&
        (evidence.approvedPlanId ?? receipt?.planId) === proposal.planId)
      check('exact-full-native-state-after-commit', exactCommittedState(evidence.afterDocument, fixture.oracleExpectedCommittedState))
      let retainedSource
      try { retainedSource = readGeologyDrawingRecipe(evidence.afterDocument, fixture.drawingId).source } catch { /* A failed exact oracle, not a fatal batch stop. */ }
      check('generated-native-geometry-matches-source', same(retainedSource, gold.afterSource))
    } else check('supported-collected-evidence-phase', false)
  }
  const satisfied = assertions.every(item => item.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(item => item.id === id)) check(id, satisfied)
  return { status: assertions.every(item => item.satisfied) ? 'satisfied' : 'failed', oracleId: descriptor.id, evidenceOrigin: evidence.origin,
    scenarioPassed: evidence.origin === 'real-model' ? assertions.every(item => item.satisfied) : null,
    scenarioExecuted: evidence.origin === 'real-model', assertions }
}
