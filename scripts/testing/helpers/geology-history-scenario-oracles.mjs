import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { buildPublicScenarioFixture, fixtureStateSignature, scenarioFixtureInputBindings } from './geology-scenario-fixtures.mjs'
import { KJAgentToolSession, KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'
import { geologyHistoryMetadata } from './geology-runner-history-transfer.mjs'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const sorted = records => records.map(({ id, type, payload }) => ({ id, type, payload: clone(payload) })).sort((a, b) => a.id.localeCompare(b.id))
const readTools = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))

export const HISTORY_SCENARIO_DESCRIPTORS = Object.freeze([
  { intent: 'cad-persistence.read-undo-redo-history', kind: 'read-only', historyBranch: 'opened-baseline' },
  { intent: 'cad-persistence.undo-latest-commit', kind: 'history', historyBranch: 'one-reviewed-native-text-edit', operation: 'undo' },
  { intent: 'cad-persistence.redo-latest-undo', kind: 'history', historyBranch: 'one-reviewed-native-text-edit-then-undo', operation: 'redo' },
].map(item => Object.freeze({ ...item, id: `${item.intent}-real-history-oracle-v1`, fixtureId: 'synthetic-dxf-model-v1', fixtureBranch: item.historyBranch,
  supportedPrerequisites: Object.freeze(['fixture:synthetic-dxf-model-v1', 'document:current-revision-known', 'fixture:synthetic-public-data-only',
    'conversation:existing-same-document-context', 'conversation:prior-request-not-approved',
    ...(item.operation === 'undo' ? ['history:one-approved-edit'] : item.operation === 'redo' ? ['history:one-undone-edit'] : [])]),
  checks: Object.freeze(corpus.scenarios.find(scenario => scenario.expected.intent === item.intent).expected.checks),
})))
const descriptors = new Map(HISTORY_SCENARIO_DESCRIPTORS.map(item => [item.intent, item]))
export const HISTORY_ORACLE_SCENARIO_IDS = Object.freeze(corpus.scenarios.filter(scenario => !scenario.sequence && descriptors.has(scenario.expected.intent)).map(scenario => scenario.id))

function resolveScenario(value) {
  if (typeof value !== 'string') return value
  const found = corpus.scenarios.find(scenario => scenario.id === value)
  if (!found) throw new Error(`Unknown frozen history scenario: ${value}`)
  return found
}
export function historyScenarioDescriptor(value) {
  if (typeof value === 'string' && descriptors.has(value)) return descriptors.get(value)
  const scenario = typeof value === 'string' ? corpus.scenarios.find(item => item.id === value) : value
  return descriptors.get(scenario?.expected?.intent) ?? null
}
export function assessHistoryScenarioReadiness(value) {
  const scenario = resolveScenario(value), descriptor = historyScenarioDescriptor(scenario)
  if (!descriptor || scenario.sequence) return { status: 'not-ready', scenarioPassed: null, reason: 'no-independent-history-scenario-driver' }
  const unsupportedPrerequisites = scenario.prerequisites.filter(item => !descriptor.supportedPrerequisites.includes(item))
  return { status: unsupportedPrerequisites.length ? 'not-ready' : 'runnable', unsupportedPrerequisites,
    oracleId: descriptor.id, executionStatus: 'not-run', scenarioPassed: null, modelCalls: 0 }
}
export function historyScenarioAnswerFrame(value) {
  if (historyScenarioDescriptor(value)?.kind !== 'read-only') return null
  return '{"documentId":"current native document ID","revision":0,"history":{"canUndo":false,"canRedo":false,"undoLabel":null,"redoLabel":null,"undoCount":0,"redoCount":0,"undoTarget":null,"redoTarget":null}} (null is only the placeholder for an absent target. Actual non-null targets must contain the complete native id,label,revision,source fields from cad_read_history. All counts and booleans must be read, never inferred from chat.)'
}
export function historyScenarioInputBindings(fixture) { return scenarioFixtureInputBindings(fixture) }

/** Host prerequisites are seeded by real reviewed commands, never fabricated history. */
export async function buildHistoryScenarioFixture(value) {
  const scenario = resolveScenario(value), descriptor = historyScenarioDescriptor(scenario)
  assert.equal(assessHistoryScenarioReadiness(scenario).status, 'runnable')
  const fixture = await buildPublicScenarioFixture('synthetic-dxf-model-v1')
  try {
    if (descriptor.kind === 'history') {
      const seed = new KJAgentToolSession(fixture.sdk, fixture.document), id = fixture.identityAliases['TEXT-A'].nativeId
      const original = fixture.document.getObject(id)
      const proposal = await seed.call('cad_propose_text_edit', { expectedRevision: fixture.document.revision, units: 'millimeter',
        changes: [{ id, expectedText: original.payload.text, text: original.payload.text + ' · 已复核 / Reviewed' }] })
      assert.equal(proposal.ok, true)
      assert.equal(fixtureStateSignature(fixture.document), fixture.initialState, 'Seed preview is genuinely unapproved')
      const approval = await seed.approve(proposal.value.planId, 'explicit-public-fixture-host')
      assert.equal(approval.ok, true)
      assert.equal(fixture.document.history.undoCount, 1)
      fixture.seedEvidence = { proposal, approval }
      if (descriptor.operation === 'redo') {
        const history = await seed.call('cad_read_history', { expectedRevision: fixture.document.revision })
        const undo = await seed.call('cad_propose_undo', { expectedRevision: fixture.document.revision, units: 'millimeter',
          targetHistoryId: history.value.history.undoTarget.id })
        assert.equal(undo.ok, true)
        const undone = await seed.approve(undo.value.planId, 'explicit-public-fixture-host')
        assert.equal(undone.ok, true)
        assert.equal(fixture.document.history.redoCount, 1)
        fixture.seedEvidence.undo = { proposal: undo, approval: undone }
      }
    }
    const document = fixture.document
    fixture.historyOracleId = descriptor.id
    fixture.fixtureBranch = descriptor.historyBranch
    fixture.initialRevision = document.revision
    fixture.initialState = fixtureStateSignature(document)
    fixture.initialEntities = clone(document.listEntities())
    fixture.initialHistory = clone(document.history)
    fixture.oracleBaselineDocument = document.fork()
    fixture.conversationSeed = scenario.prerequisites.some(item => item.startsWith('conversation:')) ? [{ role: 'user',
      content: `Same public drawing ${document.id}, revision ${document.revision}. This conversation is not an execution receipt. Read current native engine history; no edit in this conversation has been proposed or approved.` }] : []
    if (descriptor.kind === 'history') {
      const target = document.history[descriptor.operation === 'undo' ? 'undoTarget' : 'redoTarget']
      fixture.oracleHistoryTarget = clone(target)
      const restored = document.previewHistory(descriptor.operation, { expectedRevision: document.revision, targetHistoryId: target.id }).document
      const beforeById = new Map(document.listEntities().map(entity => [entity.id, entity])), afterById = new Map(restored.listEntities().map(entity => [entity.id, entity]))
      const changed = [...new Set([...beforeById.keys(), ...afterById.keys()])].filter(id => !same(beforeById.get(id), afterById.get(id)))
      fixture.oracleHistoryBefore = sorted(changed.flatMap(id => beforeById.has(id) ? [beforeById.get(id)] : []))
      fixture.oracleHistoryAfter = sorted(changed.flatMap(id => afterById.has(id) ? [afterById.get(id)] : []))
      fixture.oracleExpectedFingerprint = restored.fingerprint()
    }
    return fixture
  } catch (error) { fixture.dispose(); throw error }
}

export function expectedHistoryScenarioAnswer(value, fixture) {
  return historyScenarioDescriptor(value)?.kind === 'read-only' ? { documentId: fixture.document.id,
    revision: fixture.initialRevision, history: clone(fixture.initialHistory) } : null
}
export function expectedHistoryScenarioOutcome(value, fixture) {
  const descriptor = historyScenarioDescriptor(value)
  return descriptor?.kind === 'history' ? { kind: 'history', command: descriptor.operation.toUpperCase(), target: clone(fixture.oracleHistoryTarget),
    before: clone(fixture.oracleHistoryBefore), after: clone(fixture.oracleHistoryAfter) } : { kind: descriptor?.kind }
}

export function evaluateHistoryScenarioOracle(value, fixture, evidence) {
  const scenario = resolveScenario(value), descriptor = historyScenarioDescriptor(scenario)
  if (!descriptor || !evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin) ||
    !evidence.afterDocument || !Array.isArray(evidence.toolCalls)) return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-history-evidence-missing' }
  const calls = evidence.toolCalls, assertions = [], check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  // Runtime refresh uses a validated archive and deliberately renews ephemeral
  // IDs. The exact live IDs remain bound to the pre-model fixture target and
  // real tool/approval receipts; never replace them with reimport-generated IDs.
  const history = evidence.liveHistory ?? evidence.afterDocument.history
  if (evidence.liveHistory) {
    check('actual-restored-history-archive-and-live-metadata', !!evidence.historyArchive &&
      same(evidence.historyArchive, evidence.afterDocument.exportHistory({ limit: 50, maxBytes: 16 * 1024 * 1024 })) &&
      same(geologyHistoryMetadata(evidence.liveHistory), geologyHistoryMetadata(evidence.afterDocument.history)))
  }
  const bound = call => call.result?.ok === true && call.result.value?.documentId === fixture.document.id &&
    call.result.value?.revision === fixture.initialRevision && (call.name === 'cad_read_drawing' || call.args?.expectedRevision === fixture.initialRevision)
  const historyRead = calls.find(call => call.name === 'cad_read_history' && bound(call) && same(call.result.value.history, fixture.initialHistory))
  check('current-document-revision-checked', evidence.afterDocument.id === fixture.document.id)
  check('real-engine-history-targets', !!historyRead)
  if (descriptor.kind === 'read-only') {
    if (evidence.origin === 'real-model') {
      try { if (!same(JSON.parse(evidence.rawFinalAnswer), evidence.answer)) return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-model-answer-missing-or-mismatched' } }
      catch { return { status: 'not-evaluated', scenarioPassed: null, reason: 'raw-model-answer-not-json' } }
    }
    check('successful-bound-native-reads-only', calls.every(call => readTools.has(call.name) && bound(call)))
    check('exact-native-history-answer', same(evidence.answer, expectedHistoryScenarioAnswer(scenario, fixture)))
    check('read-only-state-unchanged', fixtureStateSignature(evidence.afterDocument) === fixture.initialState && same(history, fixture.initialHistory))
  } else {
    const gold = expectedHistoryScenarioOutcome(scenario, fixture), proposal = evidence.proposal
    if (!proposal) return { status: 'not-evaluated', scenarioPassed: null, reason: 'actual-history-proposal-missing' }
    const index = calls.findIndex(call => call.name === `cad_propose_${descriptor.operation}` && call.result?.ok === true &&
      call.args?.expectedRevision === fixture.initialRevision && call.args?.targetHistoryId === gold.target.id && same(call.result.value, proposal))
    check(`exact-${descriptor.operation}-target-identity`, index >= 0 && calls.indexOf(historyRead) < index && proposal.arguments?.targetHistoryId === gold.target.id)
    check('full-before-after-preview', proposal.documentId === fixture.document.id && proposal.expectedRevision === fixture.initialRevision &&
      proposal.command === gold.command && proposal.preview?.documentId === fixture.document.id && proposal.preview?.revision === fixture.initialRevision &&
      same(sorted(proposal.preview.before ?? []), gold.before) && same(sorted(proposal.preview.after ?? []), gold.after))
    const phase = evidence.phase ?? (evidence.stage === 'pending-preview' ? 'pending' : evidence.stage)
    if (phase === 'pending') {
      check('no-mutation-during-preview', fixtureStateSignature(evidence.afterDocument) === fixture.initialState && same(history, fixture.initialHistory))
      check('explicit-host-approval-before-commit', proposal.status === 'awaiting-host-approval' && !evidence.approvalReceipt)
    } else if (phase === 'committed') {
      const receipt = evidence.approvalReceipt?.value
      check('explicit-host-approval-before-commit', evidence.approvalReceipt?.ok === true && receipt?.command === gold.command &&
        receipt.beforeRevision === fixture.initialRevision && receipt.afterRevision === fixture.initialRevision + 1 && evidence.approvedPlanId === proposal.planId)
      check('exact-native-content-restored', evidence.afterDocument.fingerprint() === fixture.oracleExpectedFingerprint && evidence.afterDocument.revision === fixture.initialRevision + 1)
      check('history-target-moved-not-new-guessed-edit', descriptor.operation === 'undo'
        ? history.redoTarget?.id === gold.target.id && history.undoCount === 0
        : history.undoTarget?.id === gold.target.id && history.redoCount === 0)
    } else check('supported-evidence-phase', false)
  }
  const satisfied = assertions.every(item => item.satisfied)
  for (const id of descriptor.checks) if (!assertions.some(item => item.id === id)) check(id, satisfied)
  return { status: assertions.every(item => item.satisfied) ? 'satisfied' : 'failed', oracleId: descriptor.id,
    scenarioPassed: evidence.origin === 'real-model' ? assertions.every(item => item.satisfied) : null,
    scenarioExecuted: evidence.origin === 'real-model', evidenceOrigin: evidence.origin, assertions }
}
