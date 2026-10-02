import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture, fixtureStateSignature, scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'

// Native data only. No phrase interpreter or model answer is stored in a fixture.
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const reads = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))
const native = records => records.map(({ id, type, payload }) => ({ id, type, payload: clone(payload) })).sort((a, b) => a.id.localeCompare(b.id))

export const ROUND5_INVENTORY_DESCRIPTORS = Object.freeze([
  { intent: 'cad-query.protected-layer-inventory', kind: 'read-only', fixtureBranch: 'round5-protected-layers-native-dxf' },
  { intent: 'cad-query.named-selection', kind: 'read-only', fixtureBranch: 'round5-persistent-selection-native-kjd' },
  { intent: 'batch-historical-workflow.historical-dxf-note-revision', kind: 'cad', fixtureBranch: 'round5-historical-note-native-dxf' },
].map(item => Object.freeze({ ...item, id: `${item.intent}-native-round5-v1`, fixtureId: 'synthetic-dxf-model-v1',
  supportedPrerequisites: Object.freeze(['fixture:synthetic-dxf-model-v1', 'document:current-revision-known',
    'fixture:synthetic-public-data-only', 'conversation:existing-same-document-context', 'conversation:prior-request-not-approved']),
  checks: Object.freeze(corpus.scenarios.find(scenario => scenario.expected.intent === item.intent).expected.checks),
})))
const descriptors = new Map(ROUND5_INVENTORY_DESCRIPTORS.map(item => [item.intent, item]))
export const ROUND5_INVENTORY_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(item => !item.sequence && descriptors.has(item.expected.intent)).map(item => item.id))

function resolve(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(item => item.id === value)
  assert.ok(scenario, 'Unknown frozen round5 scenario')
  return scenario
}
export function round5InventoryDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  const scenario = typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value
  return descriptors.get(scenario?.expected?.intent) ?? null
}
export function assessRound5InventoryReadiness(value) {
  const scenario = resolve(value), descriptor = round5InventoryDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', scenarioPassed: null, reason: 'no-round5-inventory-driver' }
  const missing = scenario.prerequisites.filter(item => !descriptor.supportedPrerequisites.includes(item))
  return { status: missing.length ? 'not-ready' : 'runnable', unsupportedPrerequisites: missing, oracleId: descriptor.id,
    scenarioPassed: null, modelCalls: 0, executionStatus: 'not-run' }
}
export function round5InventoryAnswerFrame(value) {
  const descriptor = round5InventoryDescriptor(value)
  if (descriptor?.kind !== 'read-only') return null
  const body = descriptor.intent === 'cad-query.named-selection'
    ? '"selectionSets":[{"id":"actual native set ID","name":"actual name","memberIds":["actual exact member ID"],"memberCount":0}]'
    : '"layers":[{"id":"actual layer ID","name":"actual name","visible":false,"frozen":false,"locked":false,"editable":false}]'
  return `{"documentId":"actual document ID","revision":0,${body}} (grammar only. For layers include every layer with visible=false OR frozen=true OR locked=true. For selection sets include only the exact named set requested, preserving all exact native members. Read the complete registered catalog with pagination; do not infer membership from nearby geometry. Array row order is not scored.)`
}
export function round5InventoryInputBindings(fixture) { return scenarioFixtureInputBindings(fixture) }

export async function buildRound5InventoryFixture(value) {
  const scenario = resolve(value), descriptor = round5InventoryDescriptor(scenario)
  assert.equal(assessRound5InventoryReadiness(scenario).status, 'runnable')
  // This is the literal caller-requested native name, not a translated alias.
  // The mixed-language frozen question still names the Chinese selection set.
  const requestedSelectionSetName = descriptor.intent === 'cad-query.named-selection'
    ? scenario.language === 'en' ? 'Hole labels' : '孔位标注组' : null
  const base = await buildPublicScenarioFixture('synthetic-dxf-model-v1')
  try {
    const original = base.document
    if (descriptor.intent === 'cad-query.protected-layer-inventory') await original.transact('Declare public layer protection states', tx => {
      for (const [name, payload] of [
        ['PUBLIC-HIDDEN', { visible: false, frozen: false, locked: false }],
        ['PUBLIC-FROZEN', { visible: true, frozen: true, locked: false }],
        ['PUBLIC-LOCKED', { visible: true, frozen: false, locked: true }],
        ['PUBLIC-MULTI-PROTECTED', { visible: false, frozen: true, locked: true }],
        ['PUBLIC-EDITABLE', { visible: true, frozen: false, locked: false }],
      ]) tx.upsertTableRecord('layers', { name, type: 'LAYER', payload })
    })
    if (descriptor.intent === 'batch-historical-workflow.historical-dxf-note-revision') await original.transact('Declare synthetic historical graphic note', tx => {
      tx.createEntity('TEXT', { position: [10, -15, 0], height: 2, text: '历史备注；原标点。 Historical note; keep punctuation.',
        layerId: original.getObject(base.identityAliases['TEXT-A'].nativeId).payload.layerId }, { id: 'public-NOTE-HISTORY' })
    })
    if (descriptor.intent === 'cad-query.named-selection') {
      await base.sdk.getSelectionManager(original.id).saveNamed(requestedSelectionSetName, {
        ids: [base.identityAliases['TEXT-A'].nativeId, base.identityAliases['LINE-A'].nativeId], description: 'Public exact stored members, not a neighbourhood inference' })
      await base.sdk.getSelectionManager(original.id).saveNamed('局部详图', { ids: [base.identityAliases['LINE-B'].nativeId, base.identityAliases['CIRCLE-A'].nativeId] })
    }
    const handles = Object.fromEntries(Object.entries(base.identityAliases).map(([alias, identity]) => [alias, identity.handle]))
    if (descriptor.kind === 'cad') handles['NOTE-HISTORY'] = original.getObject('public-NOTE-HISTORY').handle
    const format = descriptor.intent === 'cad-query.named-selection' ? 'KJD' : 'DXF'
    const bytes = await base.sdk.writeDocument(original, { format })
    const document = await base.sdk.readDocument(bytes, { format })
    assert.equal(document.validate().valid, true)
    const byHandle = new Map(document.listEntities().map(entity => [entity.handle, entity]))
    const identityAliases = Object.fromEntries(Object.entries(handles).map(([alias, handle]) => {
      const entity = byHandle.get(handle)
      assert.ok(entity, 'An actual export/reopen must retain each native graphic handle')
      return [alias, { nativeId: entity.id, handle, type: entity.type, layerId: entity.payload.layerId,
        layerName: document.getObject(entity.payload.layerId)?.name }]
    }))
    // KJD preserves document identity; reading it already replaces the SDK
    // registry entry. Closing that ID would detach the recovered document.
    if (original.id !== document.id) base.sdk.closeDocument(original.id)
    const fixture = { ...base, document, identityAliases, artifact: { format, bytes }, fixtureBranch: descriptor.fixtureBranch,
      requestedSelectionSetName,
      round5InventoryOracleId: descriptor.id, initialRevision: document.revision, initialState: fixtureStateSignature(document),
      initialEntities: clone(document.listEntities()), oracleBaselineDocument: document.fork(),
      conversationSeed: scenario.prerequisites.some(item => item.startsWith('conversation:')) ? [{ role: 'user',
        content: `Same public drawing ${document.id}, revision ${document.revision}. No previous discussion is an approval or an execution receipt. Wait for the next complete request.` }] : [],
      scenarioExecuted: false, modelCalls: 0 }
    if (descriptor.kind === 'cad') {
      const gold = expectedRound5InventoryOutcome(scenario, fixture), reference = document.fork()
      await base.sdk.executeCommand('TEXTEDIT', { changes: [{ id: gold.targetId, expectedText: gold.before[0].payload.text,
        text: gold.after[0].payload.text }] }, { document: reference })
      fixture.oracleExpectedFingerprint = reference.fingerprint()
    }
    return fixture
  } catch (error) { base.dispose(); throw error }
}

function canonicalAnswer(answer) {
  const value = clone(answer)
  if (Array.isArray(value.layers)) value.layers.sort((a, b) => a.id.localeCompare(b.id))
  if (Array.isArray(value.selectionSets)) {
    value.selectionSets.sort((a, b) => a.id.localeCompare(b.id))
    for (const item of value.selectionSets) if (Array.isArray(item.memberIds)) item.memberIds.sort()
  }
  return value
}
export function expectedRound5InventoryAnswer(value, fixture) {
  const descriptor = round5InventoryDescriptor(value)
  if (descriptor?.kind !== 'read-only') return null
  const header = { documentId: fixture.document.id, revision: fixture.initialRevision }, baseline = fixture.oracleBaselineDocument
  if (descriptor.intent === 'cad-query.named-selection') return { ...header, selectionSets: baseline.listObjects({ kind: 'group', type: 'SELECTION_SET' })
    .filter(item => item.name === fixture.requestedSelectionSetName).map(item => ({ id: item.id, name: item.name, memberIds: clone(item.payload.memberIds), memberCount: item.payload.memberIds.length })) }
  return { ...header, layers: baseline.getTable('layers').records
    .map(item => { const frozen = item.payload.frozen === true, visible = item.payload.visible !== false && !frozen, locked = item.payload.locked === true
      return { id: item.id, name: item.name, visible, frozen, locked, editable: visible && !frozen && !locked } })
    .filter(item => !item.visible || item.frozen || item.locked) }
}
export function expectedRound5InventoryOutcome(value, fixture) {
  const scenario = resolve(value), descriptor = round5InventoryDescriptor(scenario)
  if (descriptor?.kind !== 'cad') return { kind: descriptor?.kind }
  const before = clone(fixture.oracleBaselineDocument.getObject(fixture.identityAliases['NOTE-HISTORY'].nativeId)), after = clone(before)
  after.payload.text += scenario.language === 'en' ? ' Review edition' : '复核版'
  return { kind: 'cad', targetId: before.id, before: native([before]), after: native([after]) }
}
export function evaluateRound5InventoryOracle(value, fixture, evidence) {
  const scenario = resolve(value), descriptor = round5InventoryDescriptor(scenario)
  if (!descriptor || !evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) ||
    !evidence.afterDocument || !Array.isArray(evidence.toolCalls)) return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-round5-evidence-missing' }
  const calls = evidence.toolCalls, assertions = [], check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  const bound = call => call.result?.ok === true && call.result.value?.documentId === fixture.document.id &&
    call.result.value?.revision === fixture.initialRevision && (call.name === 'cad_read_drawing' || call.args?.expectedRevision === fixture.initialRevision)
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id)
  if (descriptor.kind === 'read-only') {
    if (evidence.origin === 'real-model') {
      try { if (!same(JSON.parse(evidence.rawFinalAnswer), evidence.answer)) return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-final-answer-provenance-mismatch' } }
      catch { return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-final-answer-not-json' } }
    }
    const expected = expectedRound5InventoryAnswer(scenario, fixture)
    const observed = calls.filter(bound).flatMap(call => descriptor.intent === 'cad-query.named-selection'
      ? call.name === 'cad_read_selection_sets' ? call.result.value.selectionSets : [] : call.result.value.layers ?? [])
    const expectedRecords = expected.layers ?? expected.selectionSets
    check('all-required-native-catalog-records-read', expectedRecords.length > 0 && expectedRecords.every(item => observed.some(record => record.id === item.id &&
      (descriptor.intent === 'cad-query.named-selection' ? record.name === item.name && record.membershipValid === true && same([...record.memberIds].sort(), [...item.memberIds].sort())
        : ['name', 'visible', 'frozen', 'locked', 'editable'].every(key => record[key] === item[key])))))
    // A complete traversal must reach a final page in every relevant catalog.
    check('catalog-traversal-finished', calls.some(call => bound(call) && (descriptor.intent === 'cad-query.named-selection'
      ? call.name === 'cad_read_selection_sets' && call.result.value.nextOffset === null && call.result.value.truncatedByBytes === false
      : ['cad_query_drawing', 'cad_read_drawing', 'cad_read_page'].includes(call.name) && call.result.value.nextLayerOffset === null)))
    check('successful-native-read-tools-only', calls.length > 0 && calls.every(call => reads.has(call.name) && bound(call)))
    check('exact-independent-catalog-answer', evidence.answer && same(canonicalAnswer(evidence.answer), canonicalAnswer(expected)))
    check('full-native-state-unchanged', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
  } else {
    const gold = expectedRound5InventoryOutcome(scenario, fixture), proposal = evidence.proposal
    if (!proposal) return { status: 'not-evaluated', scenarioPassed: null, reason: 'native-text-proposal-missing' }
    const index = calls.findIndex(call => call.name === 'cad_propose_text_edit' && call.result?.ok === true &&
      call.args?.expectedRevision === fixture.initialRevision && same(call.result.value, proposal))
    check('full-old-native-text-read', calls.slice(0, index).some(call => bound(call) && reads.has(call.name) &&
      [...(call.result.value.entities ?? []), ...(call.result.value.matches ?? [])].some(item => item.id === gold.targetId &&
        (item.text ?? item.geometry?.text) === gold.before[0].payload.text)))
    check('actual-native-proposal-receipt', index >= 0)
    check('full-before-after-preview', proposal.documentId === fixture.document.id && proposal.expectedRevision === fixture.initialRevision &&
      proposal.command === 'TEXTEDIT' && same(native(proposal.preview?.before ?? []), gold.before) && same(native(proposal.preview?.after ?? []), gold.after))
    const phase = evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage)
    if (phase === 'pending') {
      check('no-mutation-during-preview', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
      check('explicit-host-approval-before-commit', proposal.status === 'awaiting-host-approval' && !evidence.approval && !evidence.approvalReceipt)
    } else if (phase === 'committed') {
      const approval = evidence.approval ?? evidence.approvalReceipt, receipt = approval?.value ?? approval
      check('explicit-host-approval-before-commit', (approval?.ok === true || evidence.hostApprovalApplied === true) && evidence.approvedPlanId === proposal.planId &&
        receipt?.status === 'committed' && (!Object.hasOwn(receipt, 'planId') || receipt.planId === proposal.planId) &&
        receipt.command === 'TEXTEDIT' && receipt.beforeRevision === fixture.initialRevision && receipt.afterRevision === fixture.initialRevision + 1)
      check('exact-full-native-result', evidence.afterDocument.fingerprint() === fixture.oracleExpectedFingerprint &&
        evidence.afterDocument.revision === fixture.initialRevision + 1)
    } else check('supported-evidence-phase', false)
  }
  const satisfied = assertions.every(item => item.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(item => item.id === id)) check(id, satisfied)
  return { status: assertions.every(item => item.satisfied) ? 'satisfied' : 'failed', oracleId: descriptor.id,
    evidenceOrigin: evidence.origin, scenarioExecuted: evidence.origin === 'real-model',
    scenarioPassed: evidence.origin === 'real-model' ? assertions.every(item => item.satisfied) : null, assertions }
}
