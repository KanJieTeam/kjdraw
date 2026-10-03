import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture } from './geology-scenario-fixtures.mjs'
import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologyColumn } from '../../../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe, registerGeologyDrawingRecipe } from '../../../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { canonicalStringify, deepFreeze } from '../../../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone, same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const state = document => canonicalStringify(document.snapshot())
const references = new WeakMap()
const readToolNames = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))
// Native cad_read_drawing has schema {}: bind its actual receipt, not an
// invented request argument. Every read schema that requires revision retains
// that requirement, including every source listing and full source read.
const revisionRequiredToolNames = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read' &&
  tool.inputSchema.required?.includes('expectedRevision')).map(tool => tool.name))
export const BATCH_SOURCE_READINESS_INTENT = 'batch-historical-workflow.batch-source-readiness'
export const BATCH_SOURCE_READINESS_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(s => !s.sequence &&
  s.expected.intent === BATCH_SOURCE_READINESS_INTENT).map(s => s.id))
export const BATCH_SOURCE_READINESS_RESPONSE_CONTRACT = deepFreeze({
  documents: [{ documentId: 'native document ID', revision: 'native revision integer', sourceAvailable: 'boolean',
    drawings: [{ drawingId: 'retained native drawing ID', kind: 'column or section',
      holes: [{ holeId: 'retained source hole ID', missingFields: ['absent optional field path'] }] }] }],
  absenceAudit: { holeFields: ['initialWaterDepth', 'stableWaterDepth', 'observations'],
    intervalFields: ['description'], intervalPathGrammar: 'strata.<exact intervalId>.description',
    absent: 'field not present in the actual source', zero: 'present known value', emptyArray: 'present confirmed empty list' },
  scope: 'Native source availability and this declared optional-field audit; no measurement certification or geological inference.',
})

export function batchSourceReadinessScenario(value) {
  const scenario = typeof value === 'string' ? corpus.scenarios.find(s => s.id === value) : value
  if (!scenario || scenario.sequence || scenario.expected.intent !== BATCH_SOURCE_READINESS_INTENT ||
    !BATCH_SOURCE_READINESS_SCENARIO_IDS.includes(scenario.id)) throw new Error('No frozen batch source-readiness scenario')
  return scenario
}
const facts = source => {
  const { columnStylePack, sectionStylePack, hatchPack, ...input } = source.input
  return { kind: source.kind, facts: input }
}
function holeRow(hole) {
  return { holeId: hole.id, missingFields: [
    ...BATCH_SOURCE_READINESS_RESPONSE_CONTRACT.absenceAudit.holeFields.filter(field => !Object.hasOwn(hole, field)),
    ...hole.strata.filter(interval => !Object.hasOwn(interval, 'description')).map(interval => `strata.${interval.intervalId}.description`),
  ] }
}
function canonicalAnswer(answer) {
  if (!answer || !Array.isArray(answer.documents) || answer.documents.some(row => !row || !Array.isArray(row.drawings) ||
    row.drawings.some(drawing => !drawing || !Array.isArray(drawing.holes) || drawing.holes.some(hole =>
      !hole || !Array.isArray(hole.missingFields))))) return answer
  const result = clone(answer)
  result.documents.sort((a, b) => String(a.documentId).localeCompare(String(b.documentId)))
  for (const row of result.documents) {
    if (!Array.isArray(row.drawings)) continue
    row.drawings.sort((a, b) => String(a.drawingId).localeCompare(String(b.drawingId)))
    for (const drawing of row.drawings) {
      if (!Array.isArray(drawing.holes)) continue
      drawing.holes.sort((a, b) => String(a.holeId).localeCompare(String(b.holeId)))
      for (const hole of drawing.holes) if (Array.isArray(hole.missingFields)) hole.missingFields.sort()
    }
  }
  return result
}
function captureMember(member, name) {
  const document = member.document
  const drawingIds = Object.keys(document.snapshot().opaquePayloads).filter(key => key.startsWith('geology-drawing-recipe:'))
    .map(key => key.slice('geology-drawing-recipe:'.length)).sort()
  const sources = drawingIds.map(drawingId => ({ drawingId, source: clone(readGeologyDrawingRecipe(document, drawingId).source) }))
  return { ...member, name, initialState: state(document), initialRevision: document.revision, drawingIds, sources }
}

/** Four actual reopened native documents; the model receives their complete
 * identity inventory, never these detached source-presence/missing-field rows. */
export async function buildBatchSourceReadinessFixture(value) {
  const scenario = batchSourceReadinessScenario(value), members = []
  try {
    const completeBase = await buildPublicScenarioFixture('synthetic-source-column-v1')
    const source = clone(completeBase.source)
    source.input.hole.id = 'PUBLIC-COMPLETE'
    for (const interval of source.input.hole.strata) interval.description = '公开合成描述；非认证实测。'
    completeBase.dispose()
    const sdk = createKJDrawSDK(), original = sdk.createDocument({ units: 'millimeter' })
    try {
      const compiled = compileGeologyColumn(source.input)
      await sdk.executeCommand('CREATEBATCH', clone(compiled.commandArgs), { document: original })
      await registerGeologyDrawingRecipe(original, source, { expectedRevision: original.revision })
      await original.transact('Public manual content', tx => {
        tx.createEntity('CIRCLE', { center: [90, 90, 0], radius: 3 }, { id: 'CIRCLE-MANUAL' })
        tx.createEntity('TEXT', { position: [10, -10, 0], height: 2, text: '人工核对备注 Public manual note' }, { id: 'NOTE-MANUAL' })
      })
      const bytes = await sdk.writeDocument(original, { format: 'KJD' })
      const document = await sdk.readDocument(bytes, { format: 'KJD' })
      assert.equal(state(document), state(original))
      members.push(captureMember({ sdk, document, artifact: { format: 'KJD', bytes },
        dispose: () => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }, 'public-column-01.kjd'))
    } catch (error) { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id); throw error }
    members.push(captureMember(await buildPublicScenarioFixture('synthetic-source-column-v1',
      { branch: 'optional-water-and-description-absent' }), 'public-column-02.kjd'))
    members.push(captureMember(await buildPublicScenarioFixture('synthetic-source-section-v1',
      { branch: 'complete-occurrence-map' }), 'public-section-03.kjd'))
    const graphics = await buildPublicScenarioFixture('synthetic-dxf-model-v1')
    try {
      await graphics.document.transact('Public historical block and paper note', tx => {
        const block = tx.upsertTableRecord('blockRecords', { name: 'PUBLIC-REVIEW-BLOCK', payload: { basePoint: [0, 0, 0], entityIds: [] } })
        tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 5, 0] }, { id: 'BLOCK-LINE', ownerId: block.id })
        tx.createEntity('TEXT', { position: [0, 0, 0], height: 2, text: 'TEST-A block text is not source' }, { id: 'BLOCK-TEXT', ownerId: block.id })
        tx.createEntity('INSERT', { position: [50, 50, 0], blockRecordId: block.id }, { id: 'BLOCK-INSERT' })
        tx.createEntity('TEXT', { position: [5, 5, 0], height: 2, text: '历史 DXF 人工备注' },
          { id: 'PAPER-MANUAL', ownerId: graphics.document.snapshot().spaces.paperSpaceIds[0] })
      })
      const bytes = await graphics.sdk.writeDocument(graphics.document, { format: 'DXF' })
      const document = await graphics.sdk.readDocument(bytes, { format: 'DXF' })
      assert.ok(document.listEntities().some(entity => entity.type === 'INSERT'))
      members.push(captureMember({ ...graphics, document, artifact: { format: 'DXF', bytes } }, 'public-historical-04.dxf'))
    } catch (error) { graphics.dispose(); throw error }
    for (const member of members) assert.equal(member.document.validate().valid, true)
    assert.equal(new Set(members.map(member => member.document.id)).size, members.length)
    const fixture = { scenarioId: scenario.id, workspaceMembers: members, modelCalls: 0, scenarioExecuted: false,
      provenance: 'public-synthetic-only', dispose: () => { for (const member of members) member.dispose() } }
    const answer = { documents: members.map(member => ({ documentId: member.document.id, revision: member.initialRevision,
      sourceAvailable: member.sources.length > 0, drawings: member.sources.map(({ drawingId, source }) => ({ drawingId,
        kind: source.kind, holes: (source.kind === 'column' ? [source.input.hole] : source.input.holes).map(holeRow) })) })) }
    references.set(fixture, { answer: canonicalAnswer(answer), members: members.map(member => ({
      documentId: member.document.id, revision: member.initialRevision, state: member.initialState,
      drawingIds: clone(member.drawingIds), sources: clone(member.sources),
    })) })
    return fixture
  } catch (error) { for (const member of members) member.dispose(); throw error }
}

export function batchSourceReadinessWorkspaceInventory(fixture) {
  return { provenance: 'complete-public-synthetic-workspace-input-identities', documents: fixture.workspaceMembers.map(member => ({
    documentId: member.document.id, revision: member.initialRevision, name: member.name, artifactFormat: member.artifact.format,
  })) }
}
export function expectedBatchSourceReadinessAnswer(value, fixture) {
  batchSourceReadinessScenario(value)
  assert.ok(references.has(fixture), 'Actual fixture with private detached reference required')
  return clone(references.get(fixture).answer)
}
export function batchSourceReadinessReadsComplete(fixture, calls, documentId) {
  const member = references.get(fixture)?.members.find(member => member.documentId === documentId)
  if (!member) return false
  const actual = calls.filter(call => call.boundDocumentId === documentId)
  const matching = call => call.name === 'cad_read_geology_source' && call.result?.ok === true &&
    call.args?.expectedRevision === member.revision && call.result.value?.documentId === member.documentId && call.result.value.revision === member.revision
  return actual.some(call => matching(call) && call.args.drawingId === '' &&
    Array.isArray(call.result.value.drawingIds) && same([...call.result.value.drawingIds].sort(), member.drawingIds) &&
    call.result.value.sourceBacked === (member.sources.length > 0)) &&
    member.sources.every(({ drawingId, source }) => actual.some(call => matching(call) && call.args.drawingId === drawingId &&
      call.result.value.drawingId === drawingId && call.result.value.sourceUnits === 'meter' && same({ kind: call.result.value.kind,
        facts: call.result.value.facts }, facts(source))))
}
export function evaluateBatchSourceReadinessOracle(value, fixture, evidence) {
  const scenario = batchSourceReadinessScenario(value), reference = references.get(fixture)
  if (!reference || !evidence || !['fixture-oracle-selftest', 'real-model'].includes(evidence.origin))
    return { status: 'not-evaluated', scenarioPassed: null, scenarioExecuted: false }
  const calls = evidence.toolCalls ?? [], assertions = [], check = (id, condition) => assertions.push({ id, satisfied: !!condition })
  check('same-original-frozen-task', fixture.scenarioId === scenario.id)
  check('complete-current-document-bound-source-read-receipts', reference.members.every(member =>
    batchSourceReadinessReadsComplete(fixture, calls, member.documentId)))
  check('every-actual-read-successful-and-bound-to-its-own-current-document', calls.length > 0 && calls.every(call => {
    const member = reference.members.find(member => member.documentId === call.boundDocumentId)
    return member && readToolNames.has(call.name) && call.result?.ok === true && call.result.value?.documentId === member.documentId &&
      call.result.value.revision === member.revision &&
      (!revisionRequiredToolNames.has(call.name) || call.args?.expectedRevision === member.revision)
  }))
  check('no-proposal-approval-or-commit', !evidence.proposals && !evidence.approvals &&
    calls.every(call => !call.name.startsWith('cad_propose_')))
  check('exact-capability-and-optional-missing-fact-answer', same(canonicalAnswer(evidence.answer), reference.answer))
  check('complete-native-workspace-state-unchanged-including-graphics-blocks-paper-and-manual-content',
    reference.members.every(member => fixture.workspaceMembers.some(actual => actual.document.id === member.documentId &&
      state(actual.document) === member.state)))
  const satisfied = assertions.every(assertion => assertion.satisfied)
  return { status: satisfied ? 'satisfied' : 'failed', oracleId: BATCH_SOURCE_READINESS_INTENT + ':native-v2', assertions,
    evidenceOrigin: evidence.origin, nativeContractSatisfied: satisfied,
    scenarioPassed: evidence.origin === 'real-model' ? satisfied : null,
    scenarioExecuted: evidence.origin === 'real-model' && evidence.realProviderAdapterInvocations > 0 }
}
