import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture, fixtureStateSignature, scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'

// Additive fixture/oracle work only. Nothing here interprets or executes user
// prose. Integration into a subsequent frozen model run must be explicit.
const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const readTools = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))
const project = record => ({ id: record.id, type: record.type, payload: clone(record.payload) })
const sortRecords = records => records.map(project).sort((a, b) => a.id.localeCompare(b.id))

export const ROUND4_NATIVE_DESCRIPTORS = Object.freeze([
  { intent: 'cad-query.native-object', kind: 'read-only' },
  { intent: 'cad-query.endpoint-topology', kind: 'read-only' },
  { intent: 'cad-annotation.preserve-mtext-format', kind: 'cad' },
  { intent: 'cad-annotation.append-review-note', kind: 'cad' },
].map(item => Object.freeze({ ...item, id: `${item.intent}-native-round4-v1`,
  fixtureId: 'synthetic-dxf-model-v1', fixtureBranch: 'round4-bilingual-review-native-dxf',
  supportedPrerequisites: Object.freeze(['fixture:synthetic-dxf-model-v1', 'document:current-revision-known',
    'fixture:synthetic-public-data-only', 'conversation:existing-same-document-context', 'conversation:prior-request-not-approved']),
  checks: Object.freeze(corpus.scenarios.find(scenario => scenario.expected.intent === item.intent).expected.checks),
})))
const descriptors = new Map(ROUND4_NATIVE_DESCRIPTORS.map(item => [item.intent, item]))
export const ROUND4_NATIVE_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(scenario => !scenario.sequence &&
  descriptors.has(scenario.expected.intent)).map(scenario => scenario.id))

function resolveScenario(value) {
  if (typeof value !== 'string') return value
  const scenario = corpus.scenarios.find(item => item.id === value)
  if (!scenario) throw new Error(`Unknown frozen scenario: ${value}`)
  return scenario
}

export function round4NativeDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  const scenario = typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value
  return descriptors.get(scenario?.expected?.intent) ?? null
}

export function assessRound4NativeReadiness(value) {
  const scenario = resolveScenario(value), descriptor = round4NativeDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', scenarioPassed: null, reason: 'no-round4-native-oracle' }
  const missing = scenario.prerequisites.filter(item => !descriptor.supportedPrerequisites.includes(item))
  return { status: missing.length ? 'not-ready' : 'runnable', unsupportedPrerequisites: missing,
    oracleId: descriptor.id, scenarioPassed: null, executionStatus: 'not-run', modelCalls: 0 }
}

export function round4NativeAnswerFrame(value) {
  const descriptor = round4NativeDescriptor(value)
  if (descriptor?.kind !== 'read-only') return null
  const header = '"documentId":"current native document ID","revision":0,"units":"actual drawing units"'
  const body = descriptor.intent === 'cad-query.native-object'
    ? '"entity":{"id":"actual ID","handle":"actual DXF handle","type":"native type","ownerId":"actual owner ID","coordinateSpace":"actual coordinate-space policy","start":[0,0,0],"end":[0,0,0],"layer":{"id":"actual layer ID","name":"actual name","visible":false,"frozen":false,"locked":false,"editable":false}}'
    : '"tolerance":0,"coordinateSpace":"actual coordinate-space policy","semanticInference":"actual inference policy","connections":[{"fromId":"native ID","fromFeature":"native endpoint name","toId":"native ID","toFeature":"native endpoint name","distance":0}],"connected":false'
  return `{${header},${body}} (field grammar only; all literal quantities and booleans are placeholders. Read actual native identities, geometry and layer data. Do not infer geological meaning from connectivity.)`
}

export function round4NativeInputBindings(fixture) { return scenarioFixtureInputBindings(fixture) }

export async function buildRound4NativeFixture(value) {
  const scenario = resolveScenario(value), readiness = assessRound4NativeReadiness(scenario)
  assert.equal(readiness.status, 'runnable', 'Only explicitly built branches can execute')
  const base = await buildPublicScenarioFixture('synthetic-dxf-model-v1')
  try {
    const original = base.document, mtext = original.getObject(base.identityAliases['MTEXT-A'].nativeId)
    await original.transact('Declare public bilingual review fixture', tx => {
      tx.updateObject(mtext.id, { payload: { ...clone(mtext.payload), text: '{\\fArial;待核对 Pending review}\\P第二段：合成资料 Synthetic input' } })
      tx.createEntity('TEXT', { position: [12, -14, 0], height: 2,
        layerId: mtext.payload.layerId, text: '备注：原标点；Original note, unchanged.' }, { id: 'public-fixture-NOTE-A' })
    })
    const handles = { ...Object.fromEntries(Object.entries(base.identityAliases).map(([alias, identity]) => [alias, identity.handle])),
      'NOTE-A': original.getObject('public-fixture-NOTE-A').handle }
    const bytes = await base.sdk.writeDocument(original, { format: 'DXF' })
    const document = await base.sdk.readDocument(bytes, { format: 'DXF' })
    assert.equal(document.validate().valid, true)
    const byHandle = new Map(document.listEntities().map(entity => [entity.handle, entity]))
    const identityAliases = Object.fromEntries(Object.entries(handles).map(([alias, handle]) => {
      const entity = byHandle.get(handle)
      assert.ok(entity, `Actual DXF reopen lost ${alias}`)
      return [alias, { nativeId: entity.id, handle, type: entity.type, layerId: entity.payload.layerId,
        layerName: document.getObject(entity.payload.layerId)?.name }]
    }))
    assert.equal(document.listEntities().length, 14)
    base.sdk.closeDocument(original.id)
    const conversationSeed = scenario.prerequisites.some(item => item.startsWith('conversation:'))
      ? [{ role: 'user', content: `Same public synthetic drawing ${document.id}, revision ${document.revision}. Earlier discussion did not execute, propose or approve an edit. Wait for my next complete instruction.` }] : []
    const fixture = { ...base, document, identityAliases, artifact: { format: 'DXF', bytes },
      fixtureBranch: 'round4-bilingual-review-native-dxf', round4NativeOracleId: readiness.oracleId,
      initialRevision: document.revision, initialState: fixtureStateSignature(document), initialEntities: clone(document.listEntities()),
      oracleBaselineDocument: document.fork(), conversationSeed, scenarioExecuted: false, modelCalls: 0 }
    if (round4NativeDescriptor(scenario).kind === 'cad') {
      const gold = expectedRound4NativeOutcome(scenario, fixture)
      const reference = document.fork()
      await base.sdk.executeCommand('TEXTEDIT', { changes: [{ id: gold.before[0].id,
        expectedText: gold.before[0].payload.text, text: gold.after[0].payload.text }] }, { document: reference })
      fixture.oracleExpectedFingerprint = reference.fingerprint()
    }
    return fixture
  } catch (error) { base.dispose(); throw error }
}

export function expectedRound4NativeAnswer(value, fixture) {
  const descriptor = round4NativeDescriptor(value), header = { documentId: fixture.document.id,
    revision: fixture.initialRevision, units: fixture.document.snapshot().header.units }
  if (descriptor?.kind !== 'read-only') return null
  const object = alias => fixture.oracleBaselineDocument.getObject(fixture.identityAliases[alias].nativeId)
  if (descriptor.intent === 'cad-query.native-object') {
    const entity = object('LINE-A'), layer = fixture.oracleBaselineDocument.getObject(entity.payload.layerId)
    const visible = layer.payload.visible !== false, frozen = layer.payload.frozen === true, locked = layer.payload.locked === true
    return { ...header, entity: { id: entity.id, handle: entity.handle, type: entity.type, ownerId: entity.ownerId,
      coordinateSpace: 'owner-local', start: clone(entity.payload.start), end: clone(entity.payload.end),
      layer: { id: layer.id, name: layer.name, visible, frozen, locked, editable: visible && !frozen && !locked } } }
  }
  const a = object('LINE-A'), b = object('LINE-B'), tolerance = 0.01, connections = []
  for (const fromFeature of ['start', 'end']) for (const toFeature of ['start', 'end']) {
    const from = a.payload[fromFeature], to = b.payload[toFeature]
    const distance = Math.hypot(...from.map((number, index) => number - to[index]))
    if (distance <= tolerance && a.ownerId === b.ownerId) connections.push({ fromId: a.id, fromFeature, toId: b.id, toFeature, distance })
  }
  return { ...header, tolerance, coordinateSpace: 'owner-local', semanticInference: 'none', connections, connected: connections.length > 0 }
}

export function expectedRound4NativeOutcome(value, fixture) {
  const scenario = resolveScenario(value), descriptor = round4NativeDescriptor(scenario)
  if (descriptor?.kind !== 'cad') return { kind: descriptor?.kind }
  const alias = descriptor.intent === 'cad-annotation.preserve-mtext-format' ? 'MTEXT-A' : 'NOTE-A'
  const before = clone(fixture.oracleBaselineDocument.getObject(fixture.identityAliases[alias].nativeId)), after = clone(before)
  if (alias === 'MTEXT-A') after.payload.text = scenario.language === 'en'
    ? before.payload.text.replace('Pending review', 'Reviewed') : before.payload.text.replace('待核对', '已核对')
  else after.payload.text += scenario.language === 'en' ? '; for review only' : '；仅供复核'
  return { kind: 'cad', targetId: before.id, before: sortRecords([before]), after: sortRecords([after]) }
}

function normalizedAnswer(value) {
  if (Array.isArray(value)) return value.map(normalizedAnswer)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'units' && ['mm', 'millimetre', 'millimeter'].includes(item)
    ? 'millimeter' : normalizedAnswer(item)]))
}

export function evaluateRound4NativeOracle(value, fixture, evidence) {
  const scenario = resolveScenario(value), descriptor = round4NativeDescriptor(scenario)
  if (assessRound4NativeReadiness(scenario).status !== 'runnable' || !evidence ||
    !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) || !evidence.afterDocument || !Array.isArray(evidence.toolCalls))
    return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-native-evidence-missing' }
  const calls = evidence.toolCalls, assertions = [], check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  const bound = call => call.result?.ok === true && call.result.value?.documentId === fixture.document.id &&
    call.result.value?.revision === fixture.initialRevision && (call.name === 'cad_read_drawing' || call.args?.expectedRevision === fixture.initialRevision)
  const queried = alias => calls.some(call => bound(call) && readTools.has(call.name) &&
    (call.result.value?.entities ?? []).some(entity => entity.id === fixture.identityAliases[alias].nativeId && entity.geometryOmittedReason === null))
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id)
  if (descriptor.kind === 'read-only') {
    if (evidence.origin === 'real-model') {
      try { if (!same(JSON.parse(evidence.rawFinalAnswer), evidence.answer)) return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-model-answer-missing-or-mismatched' } }
      catch { return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-model-answer-not-json' } }
    }
    check('successful-bound-native-read-evidence', calls.length > 0 && calls.every(call => readTools.has(call.name) && bound(call)))
    const topology = descriptor.intent === 'cad-query.endpoint-topology' && calls.some(call => bound(call) && call.name === 'cad_query_topology' &&
      call.args?.tolerance === 0.01 && same([...call.args.ids].sort(), ['LINE-A', 'LINE-B'].map(alias => fixture.identityAliases[alias].nativeId).sort()))
    check('actual-requested-geometry-read', descriptor.intent === 'cad-query.native-object' ? queried('LINE-A') : topology || queried('LINE-A') && queried('LINE-B'))
    check('read-only-state-unchanged', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
    check('exact-answer-from-independent-native-facts', same(normalizedAnswer(evidence.answer), normalizedAnswer(expectedRound4NativeAnswer(scenario, fixture))))
  } else {
    const gold = expectedRound4NativeOutcome(scenario, fixture), proposal = evidence.proposal
    if (!proposal) return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-native-proposal-missing' }
    const proposalIndex = calls.findIndex(call => call.name === 'cad_propose_text_edit' && call.result?.ok === true &&
      call.args?.expectedRevision === fixture.initialRevision && same(call.result.value, proposal))
    const oldTextRead = calls.slice(0, proposalIndex).some(call => bound(call) && readTools.has(call.name) &&
      [...(call.result.value?.entities ?? []), ...(call.result.value?.matches ?? [])].some(entity => entity.id === gold.targetId &&
        (entity.text ?? entity.geometry?.text) === gold.before[0].payload.text))
    check('full-old-text-read-before-edit', oldTextRead)
    check('actual-native-proposal-tool-evidence', proposalIndex >= 0)
    check('full-before-after-preview', proposal.documentId === fixture.document.id && proposal.expectedRevision === fixture.initialRevision &&
      proposal.command === 'TEXTEDIT' && proposal.preview?.documentId === fixture.document.id && proposal.preview?.revision === fixture.initialRevision &&
      same(sortRecords(proposal.preview.before ?? []), gold.before) && same(sortRecords(proposal.preview.after ?? []), gold.after))
    const phase = evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage)
    if (phase === 'pending') {
      check('no-mutation-during-preview', fixtureStateSignature(evidence.afterDocument) === fixture.initialState)
      check('explicit-host-approval-before-commit', proposal.status === 'awaiting-host-approval' && !evidence.approval && !evidence.approvalReceipt)
    } else if (phase === 'committed') {
      const approval = evidence.approval ?? evidence.approvalReceipt, receipt = approval?.value ?? approval
      check('explicit-host-approval-before-commit', (approval?.ok === true || evidence.hostApprovalApplied === true) && receipt?.status === 'committed' &&
        (!Object.hasOwn(receipt, 'planId') || receipt.planId === proposal.planId) && receipt.command === 'TEXTEDIT' &&
        receipt.beforeRevision === fixture.initialRevision && receipt.afterRevision === fixture.initialRevision + 1 && evidence.approvedPlanId === proposal.planId)
      check('exact-full-native-content-after-commit', evidence.afterDocument.fingerprint() === fixture.oracleExpectedFingerprint &&
        evidence.afterDocument.revision === fixture.initialRevision + 1 && evidence.afterDocument.history.undoCount === 1)
    } else check('supported-evidence-phase', false)
  }
  const passed = assertions.every(item => item.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(item => item.id === id)) check(id, passed)
  return { status: assertions.every(item => item.satisfied) ? 'satisfied' : 'failed', oracleId: descriptor.id,
    evidenceOrigin: evidence.origin, scenarioPassed: evidence.origin === 'real-model' ? assertions.every(item => item.satisfied) : null,
    scenarioExecuted: evidence.origin === 'real-model', assertions }
}
