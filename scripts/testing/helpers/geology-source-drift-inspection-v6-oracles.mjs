import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { FIXTURE_URL } from '../generate-geology-user-scenarios.mjs'
import { evaluateRound3ScenarioOracle } from './geology-round3-scenario-oracles.mjs'
import { fixtureStateSignature } from './geology-scenario-fixtures.mjs'
import { KJDRAW_AGENT_TOOLS } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologyColumn } from '../../../packages/kjdraw-sdk/src/geology-engineering.js'
import { canonicalStringify } from '../../../packages/kjdraw-sdk/src/utils.js'

const corpus = JSON.parse(await readFile(FIXTURE_URL, 'utf8'))
const intent = 'source-query.detect-source-graphic-drift'
const scenarios = new Map(corpus.scenarios.filter(row => !row.sequence && row.expected.intent === intent).map(row => [row.id, row]))
const readTools = new Set(KJDRAW_AGENT_TOOLS.filter(tool => tool.effect === 'read').map(tool => tool.name))
const contexts = new WeakMap()
const clone = structuredClone
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b)
const ordered = rows => [...rows].sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)))
const sha = value => createHash('sha256').update(value).digest('hex')
const ownExecutionPaths = ['scripts/testing/helpers/geology-source-drift-inspection-v6-oracles.mjs',
  'tests/geology-source-drift-inspection-v6.spec.mjs']
const ownExecutionSurface = Object.freeze(Object.fromEntries(await Promise.all(ownExecutionPaths.map(async path =>
  [path, sha(await readFile(new URL('../../../' + path, import.meta.url)))]))))

export const SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS = Object.freeze([...scenarios.keys()])
export const SOURCE_DRIFT_INSPECTION_V6_PROTOCOL = Object.freeze({
  version: 'geology-source-drift-inspection-v6',
  scope: 'Only six original public synthetic source-query.detect-source-graphic-drift questions; not global 1080 acceptance.',
  transportAnswerContractVersion: 'v5',
  transportAnswerEncoding: 'json-object',
  prompt: 'Unchanged frozen human question, existing complete public identity bindings and existing response-shape frame. No expected source verdict, forced call or output repair.',
  inspectionEvidence: 'Actual successful includeInspection:true source read at the exact native document/revision/drawing; every retained fact and complete conflict kind/id/reason plus conflictTypes generatedType/actualType must match independently compiled source records and actual native records. Complete unchanged snapshot and exact final answer remain mandatory.',
  compatibility: 'The old v5 validator-rejection path remains evaluated by its unchanged original oracle. Old archives are never rescored; inspection results are a separately versioned verdict.',
  approval: 'Read-only. No proposal, approval, mutation or inferred measurement is accepted.',
})

function resolveScenario(value) {
  const id = typeof value === 'string' ? value : value?.id
  const scenario = scenarios.get(id)
  if (!scenario || typeof value === 'object' && !same(value, scenario)) throw new Error('UNKNOWN_OR_CHANGED_FROZEN_DRIFT_SCENARIO')
  return scenario
}

/** Host-only immutable baseline. This object and its private facts are never a model input. */
export function createSourceDriftInspectionV6Context(value, fixture) {
  const scenario = resolveScenario(value)
  assert.equal(fixture.fixtureBranch, 'actual-generated-line-manual-drift')
  assert.equal(fixture.initialRevision, fixture.document.revision)
  assert.equal(fixtureStateSignature(fixture.document), fixture.initialState)
  const recipe = clone(fixture.document.snapshot().opaquePayloads['geology-drawing-recipe:' + fixture.drawingId])
  assert.equal(recipe.documentId, fixture.document.id)
  assert.equal(recipe.drawingId, fixture.drawingId)
  assert.equal(recipe.source.kind, 'column')
  assert.ok(same(recipe.source, fixture.source))
  const compiled = compileGeologyColumn(recipe.source.input)
  assert.equal(recipe.entityIds.length, compiled.commandArgs.entities.length)
  const ids = [...fixture.oracleDriftedEntityIds]
  assert.ok(ids.length && new Set(ids).size === ids.length)
  const nativeRecords = ids.map(id => {
    const index = recipe.entityIds.indexOf(id), actual = fixture.document.getObject(id)
    assert.ok(index >= 0 && actual?.kind === 'entity' && !actual.erased)
    const generated = compiled.commandArgs.entities[index]
    assert.equal(generated.options.id, id)
    assert.equal(actual.type, generated.type)
    // This finite fixture declares an actual translated generated LINE, not a
    // guessed conflict or a manual annotation classified by proximity/name.
    assert.equal(generated.type, 'LINE')
    assert.ok(!same(actual.payload.start, generated.payload.start) || !same(actual.payload.end, generated.payload.end))
    return clone(actual)
  })
  const { columnStylePack, sectionStylePack, hatchPack, ...facts } = recipe.source.input
  const context = Object.freeze({ version: SOURCE_DRIFT_INSPECTION_V6_PROTOCOL.version, scenarioId: scenario.id })
  contexts.set(context, {
    documentId: fixture.document.id, revision: fixture.initialRevision, drawingId: fixture.drawingId,
    units: fixture.document.snapshot().header.units, initialState: fixture.initialState,
    retained: { kind: recipe.source.kind, facts: clone(facts) }, nativeRecords,
    conflicts: ids.map(id => ({ kind: 'entity', id, reason: 'record-changed' })),
    conflictTypes: ids.map(id => ({ id, generatedType: compiled.commandArgs.entities[recipe.entityIds.indexOf(id)].type,
      actualType: nativeRecords.find(record => record.id === id).type })),
    answer: { documentId: fixture.document.id, revision: fixture.initialRevision, drawingId: fixture.drawingId,
      sourceBacked: true, sourceGeometryConsistent: false,
      conflicts: nativeRecords.map(record => ({ id: record.id, type: record.type })), mutationAllowed: false },
  })
  return context
}

function validInspection(call, gold) {
  const value = call.result?.value
  return call.name === 'cad_read_geology_source' && call.args?.includeInspection === true &&
    call.args.expectedRevision === gold.revision && call.args.drawingId === gold.drawingId && call.result?.ok === true &&
    value?.documentId === gold.documentId && value.revision === gold.revision && value.drawingId === gold.drawingId &&
    value.units === gold.units && value.drawingUnits === gold.units && value.sourceUnits === 'meter' &&
    value.depthConvention === 'depth-below-collar' && value.sourceBacked === true && value.measurementsVerified === false &&
    value.inspectionOnly === true && value.sourceGeometryConsistent === false && value.truncated !== true &&
    same({ kind: value.kind, facts: value.facts }, gold.retained) && Array.isArray(value.conflicts) &&
    same(ordered(value.conflicts), ordered(gold.conflicts)) && Array.isArray(value.conflictTypes) &&
    same(ordered(value.conflictTypes), ordered(gold.conflictTypes))
}

function actualValidatorRejection(call, gold) {
  return call.name === 'cad_read_geology_source' && call.args?.drawingId === gold.drawingId &&
    call.args.expectedRevision === gold.revision && call.args.includeInspection !== true &&
    call.result?.ok === false && call.result.error?.code === 'KJDOCUMENT_INVALID' &&
    gold.conflicts.some(conflict => call.result.error.message ===
      `Geology drawing update: generated object changed: ${conflict.id}; reconcile manual edits before rebuilding`)
}

/** Score collected native evidence only. Never call a model, read a tool or approve a plan here. */
export function evaluateSourceDriftInspectionV6Oracle(value, fixture, evidence, { context } = {}) {
  const scenario = resolveScenario(value)
  if (!evidence || !['real-model', 'fixture-oracle-selftest'].includes(evidence.origin))
    return { status: 'not-evaluated', scenarioPassed: null, scenarioExecuted: false, reason: 'actual-execution-evidence-missing' }
  const baseline = context ?? createSourceDriftInspectionV6Context(scenario, fixture)
  const gold = contexts.get(baseline)
  if (!gold || baseline.scenarioId !== scenario.id || gold.documentId !== fixture.document.id)
    throw new Error('SOURCE_DRIFT_CONTEXT_MISMATCH')
  const calls = Array.isArray(evidence.toolCalls) ? evidence.toolCalls : []
  const inspectionCalls = calls.filter(call => call.name === 'cad_read_geology_source' && call.args?.includeInspection === true)
  if (!inspectionCalls.length) {
    const legacy = evaluateRound3ScenarioOracle(scenario, fixture, evidence, { answerContractVersion: 'v5' })
    return { ...legacy, protocolVersion: SOURCE_DRIFT_INSPECTION_V6_PROTOCOL.version, acceptedEvidencePath: 'legacy-v5-validator-rejection' }
  }
  const assertions = [], check = (id, satisfied) => assertions.push({ id, satisfied: !!satisfied })
  check('current-document-revision-checked', evidence.afterDocument?.id === gold.documentId && evidence.afterDocument.revision === gold.revision)
  check('exact-full-retained-source-inspection', inspectionCalls.every(call => validInspection(call, gold)))
  check('native-read-evidence-only', calls.length > 0 && calls.every(call => readTools.has(call.name) &&
    (actualValidatorRejection(call, gold) || call.result?.ok === true &&
      call.result.value?.documentId === gold.documentId && call.result.value.revision === gold.revision &&
      (call.name === 'cad_read_drawing' || call.args?.expectedRevision === gold.revision))))
  check('actual-generated-record-identities-and-types', !!evidence.afterDocument && gold.nativeRecords.every(record =>
    same(evidence.afterDocument.getObject(record.id), record)))
  check('no-pending-plan-or-approval-in-read-only-task', !evidence.proposal && !evidence.proposals?.length &&
    !evidence.approval && !evidence.approvalReceipt && evidence.hostApprovalApplied !== true &&
    (evidence.executionStatus === undefined && evidence.origin === 'fixture-oracle-selftest' || evidence.executionStatus === 'message'))
  check('read-only-state-unchanged', !!evidence.afterDocument && fixtureStateSignature(evidence.afterDocument) === gold.initialState)
  let rawMatches = false
  try { rawMatches = typeof evidence.rawFinalAnswer === 'string' && same(JSON.parse(evidence.rawFinalAnswer), evidence.answer) } catch { /* failed provenance */ }
  check('raw-final-json-provenance', rawMatches)
  const answer = evidence.answer
  check('exact-complete-answer-and-native-conflict-types', !!answer && Array.isArray(answer.conflicts) &&
    same({ ...answer, conflicts: ordered(answer.conflicts) }, { ...gold.answer, conflicts: ordered(gold.answer.conflicts) }))
  const satisfied = assertions.every(item => item.satisfied)
  return { status: satisfied ? 'satisfied' : 'failed', protocolVersion: SOURCE_DRIFT_INSPECTION_V6_PROTOCOL.version,
    oracleId: intent + '-inspection-exact-v6', acceptedEvidencePath: 'full-inspection-receipt', evidenceOrigin: evidence.origin,
    scenarioPassed: evidence.origin === 'real-model' ? satisfied : null, scenarioExecuted: evidence.origin === 'real-model', assertions }
}

/** Reuse the unchanged transport/prompt runner; adjudicate new executions under a separate protocol. */
export async function runSourceDriftInspectionV6Scenarios({ provider = 'deepseek', model = 'deepseek-chat', maxRequests = 120,
  modelCall, onModelResponse, onScenarioResult, onProgress = () => {}, onCheckpoint } = {}) {
  const { runGeologyUserScenarios } = await import('../run-geology-user-scenarios.mjs')
  const verdicts = new Map()
  const legacy = await runGeologyUserScenarios({ provider, model, maxRequests, maxScenarios: scenarios.size,
    scenarioIds: SOURCE_DRIFT_INSPECTION_V6_SCENARIO_IDS, answerContractVersion: 'v5', answerEncoding: 'json-object',
    ...(modelCall ? { modelCall } : {}), ...(onModelResponse ? { onModelResponse } : {}),
    async onScenarioResult(execution) {
      const context = createSourceDriftInspectionV6Context(execution.scenario, execution.fixture)
      const oracle = evaluateSourceDriftInspectionV6Oracle(execution.scenario, execution.fixture, execution.evidence, { context })
      verdicts.set(execution.scenario.id, oracle)
      if (onScenarioResult) await onScenarioResult({ ...execution, legacyOracle: execution.oracle, oracle })
    },
    onProgress(item) {
      const oracle = verdicts.get(item.id)
      onProgress({ ...item, protocolVersion: SOURCE_DRIFT_INSPECTION_V6_PROTOCOL.version,
        status: oracle?.status ?? item.status, passed: oracle?.scenarioPassed ?? item.passed,
        failedChecks: (oracle?.assertions ?? item.assertions ?? []).filter(row => !row.satisfied).map(row => row.id),
        legacyV5Passed: item.passed })
    }, ...(onCheckpoint ? { onCheckpoint: checkpoint => onCheckpoint({ ...checkpoint,
      checkpointOracleProtocol: 'unchanged-legacy-v5-transport-diagnostic', parentProtocol: SOURCE_DRIFT_INSPECTION_V6_PROTOCOL.version }) } : {}),
  })
  const rows = legacy.scenarios.map(row => {
    const oracle = verdicts.get(row.id)
    const verdict = oracle ? oracle.scenarioPassed : row.passed
    const passed = legacy.evidenceOrigin === 'real-model' && row.requests && verdict === null ? false : verdict
    return { ...row, legacyV5Status: row.status, legacyV5Passed: row.passed,
      status: passed === false ? 'failed' : oracle?.status ?? row.status, passed,
      assertions: oracle?.assertions ?? row.assertions, acceptedEvidencePath: oracle?.acceptedEvidencePath ?? null }
  })
  const passed = rows.filter(row => row.passed === true).length, failed = rows.filter(row => row.passed === false).length
  const executionSurface = Object.freeze({ ...legacy.executionSurface, ...ownExecutionSurface })
  return { ...legacy, protocol: SOURCE_DRIFT_INSPECTION_V6_PROTOCOL, protocolSha256: sha(JSON.stringify(SOURCE_DRIFT_INSPECTION_V6_PROTOCOL)),
    transportProtocol: legacy.protocol, transportProtocolSha256: legacy.protocolSha256,
    executionSurface, executionSurfaceSha256: sha(JSON.stringify(executionSurface)),
    scenarios: rows, passed, failed, notEvaluated: rows.filter(row => row.passed === null).length,
    legacyV5SameExecutionSummary: { passed: legacy.passed, failed: legacy.failed, allSelectedPassed: legacy.allSelectedPassed },
    allSelectedPassed: legacy.evidenceOrigin === 'real-model' && legacy.selected > 0 && passed === legacy.selected }
}
