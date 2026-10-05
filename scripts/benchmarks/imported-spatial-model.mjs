import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAiChatRuntime } from '../../apps/playground/ai/runtime.js'
import { inspectBuildingCandidates, queryBuildingCandidates } from '../../apps/playground/ai/scene-context.js'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { createEraseImpact } from '../../packages/kjdraw-sdk/src/erase-impact.js'
import { extractKJModelUsage } from '../../packages/kjdraw-sdk/src/model-usage.js'
import { canonicalStringify } from '../../packages/kjdraw-sdk/src/utils.js'
import { checkDrawingReopen } from '../../tests/helpers/imported-drawing-edit-journey.mjs'

// This is one fixed, opt-in source-specific protocol, not a general benchmark.
// The host oracle is NEVER included in a model prompt or fabricated response.
const rounds = Object.freeze([
  Object.freeze({ operation: 'ambiguity', prompt: '删除顶部三个楼' }),
  Object.freeze({ operation: 'erase', prompt: '删除底部两个楼' }),
  Object.freeze({ operation: 'undo', prompt: '撤销' }),
  Object.freeze({ operation: 'redo', prompt: '重做' }),
])
export const importedSpatialModelProtocol = Object.freeze({
  version: 'imported-spatial-original-plan-v1', maxRequests: 80, rounds,
  oracle: Object.freeze({ initialEntities: 836, spatialCandidates: 20, topRowCandidates: 5, topRowTolerance: 3,
    bottomIndices: Object.freeze([18, 19]), erasedEntities: 23, remainingEntities: 813 }),
  scope: 'Source-specific spatial intent and reviewed engine history; not geological interpretation, independent CAD certification or model-comparison evidence.',
  approval: 'Harness approval only after an independent exact native-object oracle; not human acceptance.',
})

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
class ProtocolFailure extends Error { constructor(code) { super(code); this.code = code } }
function check(condition, code) { if (!condition) throw new ProtocolFailure(code) }
const same = (actual, expected, code) => check(canonicalStringify(actual) === canonicalStringify(expected), code)
const sorted = values => [...values].sort()
const records = document => document.snapshot().objects
function safeFailure(error) { return error instanceof ProtocolFailure ? error.code : 'ENGINE_OR_TRANSPORT_CHECK_FAILED' }

async function runtimeDocument(chat, sdk) {
  return sdk.readDocument((await chat.exportLocalState()).drawing, { format: 'KJD' })
}
function unchanged(before, after, allowed = new Set()) {
  same(Object.keys(records(after)), Object.keys(records(before)), 'OBJECT_ID_SET_CHANGED')
  for (const [id, record] of Object.entries(records(before))) {
    if (!allowed.has(id)) same(records(after)[id], record, 'UNTOUCHED_NATIVE_RECORD_CHANGED')
  }
  check(after.snapshot().header.units === before.snapshot().header.units, 'DRAWING_UNITS_CHANGED')
}
function noMutation(before, after) {
  check(after.revision === before.revision && after.fingerprint() === before.fingerprint(), 'UNAPPROVED_MUTATION')
  same(records(after), records(before), 'UNAPPROVED_RECORD_CHANGE')
}
async function reopen(sdk, document) {
  await checkDrawingReopen(sdk, document)
  const dxf = await sdk.writeDocument(document, { format: 'DXF' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  check(reopened.snapshot().header.units === document.snapshot().header.units, 'DXF_UNITS_CHANGED')
  check(!reopened.history.canUndo && !reopened.history.canRedo, 'DXF_REOPEN_IMPORT_UNDOABLE')
}

/** Only normal runtime model calls drive proposals. Reports omit source paths,
 * labels, IDs, arguments, provider text/bodies and credentials. No file writes. */
export async function runImportedSpatialModel({ bytes, connection, fetchImpl = fetch, maxRequests = 80,
  executionOrigin = 'real-model', onProgress = () => {}, reviewClarification, onModelResult } = {}) {
  check(Number.isSafeInteger(maxRequests) && maxRequests >= 1 && maxRequests <= 80, 'INVALID_REQUEST_BUDGET')
  check(['real-model', 'deterministic-protocol-fixture'].includes(executionOrigin), 'INVALID_EXECUTION_ORIGIN')
  check(reviewClarification === undefined || typeof reviewClarification === 'function', 'INVALID_CLARIFICATION_REVIEW')
  check(onModelResult === undefined || typeof onModelResult === 'function', 'INVALID_MODEL_RESULT_OBSERVER')
  const sourceHash = hash(bytes)
  const report = {
    protocol: importedSpatialModelProtocol.version, protocolHash: hash(JSON.stringify(importedSpatialModelProtocol)),
    sourceId: sourceHash.slice(0, 12), executionOrigin, scope: importedSpatialModelProtocol.scope,
    requests: 0, naturalLanguageModelCalls: 0, rounds: [], trace: [], usage: [], passed: false,
    nativeProtocolPassed: false, semanticClarificationConfirmed: null,
    originalBytesUnchanged: false,
  }
  let chat, stage = 'SOURCE_IDENTITY'
  const sdk = createKJDrawSDK()
  try {
    const source = await sdk.readDocument(bytes, { format: 'DXF' })
    check(source.validate().valid && !source.history.canUndo && !source.history.canRedo, 'INVALID_OR_UNDOABLE_IMPORT_BASELINE')
    check(source.listEntities().length === importedSpatialModelProtocol.oracle.initialEntities, 'SOURCE_PROTOCOL_IDENTITY_MISMATCH')
    chat = createAiChatRuntime({ ...connection, captureToolOutputs: true, fetchImpl: async (url, request) => {
      if (report.requests >= maxRequests) throw new ProtocolFailure('MODEL_REQUEST_BUDGET')
      const requestIndex = ++report.requests
      if (executionOrigin === 'real-model') report.naturalLanguageModelCalls++
      const started = performance.now()
      const body = JSON.parse(request.body)
      const item = { request: requestIndex, round: report.rounds.length,
        toolsOffered: body.tools?.map(tool => tool.function?.name ?? tool.name).filter(Boolean) ?? [], toolCalls: [] }
      report.trace.push(item)
      onProgress({ phase: 'request', request: requestIndex, round: item.round })
      const response = await fetchImpl(url, request)
      if (response.ok && /json/.test(response.headers.get('content-type') ?? '')) {
        try {
          const payload = await response.clone().json()
          item.toolCalls = (payload.choices?.[0]?.message?.tool_calls ?? [])
            .map(call => call.function?.name).filter(name => typeof name === 'string' && /^cad_[a-z_]+$/.test(name))
          report.usage.push(extractKJModelUsage(connection.protocol ?? 'chat-completions', payload,
            { latencyMs: performance.now() - started }))
        } catch { /* Runtime performs authoritative bounded response validation. */ }
      }
      onProgress({ phase: 'response', request: requestIndex, round: item.round, tools: item.toolCalls })
      return response
    } })
    await chat.importDocument(new File([bytes], 'input.dxf'))
    const baseline = await runtimeDocument(chat, sdk)
    const candidates = inspectBuildingCandidates(baseline)
    const oracle = importedSpatialModelProtocol.oracle
    check(candidates.length === oracle.spatialCandidates, 'SOURCE_SPATIAL_INDEX_MISMATCH')
    check(candidates.filter(candidate => Math.abs(candidate.bounds[3] - candidates[0].bounds[3]) < oracle.topRowTolerance).length === oracle.topRowCandidates,
      'SOURCE_TOP_ROW_MISMATCH')
    const query = queryBuildingCandidates(baseline, { expectedRevision: baseline.revision, indices: oracle.bottomIndices })
    check(query.ok, 'HOST_ORACLE_QUERY_FAILED')
    const requestedIds = [...new Set(query.value.candidates.flatMap(candidate => candidate.memberIds))]
    const impact = createEraseImpact(baseline, { expectedRevision: baseline.revision, units: baseline.snapshot().header.units,
      operation: 'erase', ids: requestedIds, tolerance: 0.01, maxBytes: 262144 })
    check(impact.canErase && impact.effectiveEraseIds.length === oracle.erasedEntities, 'SOURCE_ERASE_IMPACT_MISMATCH')
    const erasedIds = new Set(impact.effectiveEraseIds)
    let deleted, lastPlanId
    for (const [index, round] of rounds.entries()) {
      const entry = { round: index + 1, operation: round.operation, requests: 0, passed: false }
      report.rounds.push(entry)
      const before = await runtimeDocument(chat, sdk), beforeRequests = report.requests
      stage = round.operation.toUpperCase() + '_MODEL'
      const result = await chat.send(round.prompt)
      // Opt-in private diagnostics only. A detached copy prevents observers from
      // changing the authoritative result or supplying an answer to the model.
      if (onModelResult) await onModelResult({ operation: round.operation, result: structuredClone(result) })
      entry.requests = report.requests - beforeRequests
      entry.status = result.status
      stage = round.operation.toUpperCase() + '_APPROVAL_ISOLATION'
      noMutation(before, await runtimeDocument(chat, sdk))
      if (round.operation === 'ambiguity') {
        // No text-keyword classifier or canned answer establishes a pass: this
        // verifies an actual nonempty model answer and no proposed mutation.
        check(result.status === 'message' && result.text.trim().length > 0 && !result.proposal, 'AMBIGUOUS_TARGET_NOT_CLARIFIED')
        check(!chat.drawingHistory.canUndo && !chat.drawingHistory.canRedo, 'AMBIGUITY_CREATED_HISTORY')
        if (reviewClarification) {
          const reviewed = await reviewClarification({ text: result.text, topCandidateCount: oracle.topRowCandidates })
          check(reviewed === true || reviewed === false || reviewed === undefined, 'INVALID_CLARIFICATION_REVIEW_RESULT')
          report.semanticClarificationConfirmed = reviewed ?? null
        }
        entry.answerRequiresHumanClarificationReview = report.semanticClarificationConfirmed === null
        entry.passed = true
        continue
      }
      check(result.status === 'proposal' && result.proposals?.length === 1, 'MODEL_DID_NOT_PROPOSE_ONE_REVIEWABLE_CHANGE')
      const proposal = result.proposal
      lastPlanId = proposal.planId
      // Portable drawing/history state must not transfer an outstanding plan
      // into a new runtime's host approval registry.
      const isolated = createAiChatRuntime(connection)
      try {
        await isolated.restoreLocalState(await chat.exportLocalState())
        check((await isolated.approve(proposal.planId)).status === 'error', 'PENDING_APPROVAL_TRANSFERRED_TO_NEW_SESSION')
        noMutation(before, await runtimeDocument(isolated, sdk))
      } finally { isolated.destroy() }
      stage = round.operation.toUpperCase() + '_EXACT_PROPOSAL'
      if (round.operation === 'erase') {
        check(proposal.preview.command === 'STRUCTURALEDIT', 'WRONG_ERASE_COMMAND')
        same(sorted(proposal.preview.before.map(entity => entity.id)), sorted(erasedIds), 'WRONG_SPATIAL_ERASE_TARGETS')
        check(proposal.preview.after.length === 0, 'UNREQUESTED_RECONNECTION_OR_RELAYER')
        same(sorted(proposal.structuralEdit?.requestedEraseIds ?? []), sorted(requestedIds), 'WRONG_REQUESTED_ERASE_TARGETS')
        same(sorted(proposal.structuralEdit?.effectiveEraseIds ?? []), sorted(erasedIds), 'WRONG_ASSOCIATED_ERASE_TARGETS')
        const names = report.trace.slice(beforeRequests).flatMap(item => item.toolCalls)
        check(names.includes('cad_query_spatial_candidates') && names.includes('cad_query_impact') && names.includes('cad_propose_structural_edit'),
          'MODEL_DID_NOT_QUERY_SPATIAL_AND_IMPACT')
      } else {
        check(proposal.preview.command === round.operation.toUpperCase(), 'MODEL_GUESSED_INVERSE_EDIT')
        const target = chat.drawingHistory[round.operation + 'Target']
        check(target && proposal.preview.historyChange?.targetHistoryId === target.id, 'WRONG_LIVE_HISTORY_ID')
        check(proposal.preview.historyChange.afterFingerprint === (round.operation === 'undo' ? baseline : deleted).fingerprint(),
          'WRONG_RETAINED_HISTORY_SNAPSHOT')
        const names = report.trace.slice(beforeRequests).flatMap(item => item.toolCalls)
        check(names.includes('cad_read_history') && names.includes('cad_propose_' + round.operation), 'MODEL_DID_NOT_USE_HISTORY_TOOLS')
      }
      stage = round.operation.toUpperCase() + '_APPROVAL'
      check((await chat.approve(proposal.planId)).status === 'applied', 'REVIEWED_APPROVAL_FAILED')
      check((await chat.approve(proposal.planId)).status === 'error', 'APPROVAL_REPLAY_NOT_REJECTED')
      const after = await runtimeDocument(chat, sdk)
      check(after.revision === before.revision + 1, 'APPROVAL_REVISION_NOT_INCREMENTED_ONCE')
      stage = round.operation.toUpperCase() + '_NATIVE_RECORDS'
      if (round.operation === 'erase') {
        check(after.listEntities().length === oracle.remainingEntities, 'WRONG_REMAINING_ENTITY_COUNT')
        unchanged(baseline, after, erasedIds)
        for (const id of erasedIds) same(records(after)[id], { ...records(baseline)[id], erased: true }, 'ERASED_NATIVE_RECORD_CHANGED')
        deleted = after
      } else {
        const expected = round.operation === 'undo' ? baseline : deleted
        check(after.fingerprint() === expected.fingerprint(), 'HISTORY_DID_NOT_RESTORE_EXACT_CONTENT')
        same(records(after), records(expected), 'HISTORY_DID_NOT_RESTORE_ALL_RECORDS')
        check(round.operation !== 'undo' || !chat.drawingHistory.canUndo, 'IMPORT_BASELINE_BECAME_UNDOABLE')
      }
      stage = round.operation.toUpperCase() + '_EXPORT_REOPEN'
      await reopen(sdk, after)
      entry.untouchedNativeRecords = Object.keys(records(baseline)).length - erasedIds.size
      entry.dxfAndKjdReopen = true
      entry.passed = true
    }
    stage = 'LOCAL_REOPEN_APPROVAL_ISOLATION'
    const state = await chat.exportLocalState()
    const restored = createAiChatRuntime(connection)
    try {
      await restored.restoreLocalState(state)
      const restoredDocument = await runtimeDocument(restored, sdk)
      check(restoredDocument.fingerprint() === deleted.fingerprint(), 'LOCAL_REOPEN_CONTENT_CHANGED')
      check((await restored.approve(lastPlanId)).status === 'error', 'LOCAL_REOPEN_RESTORED_APPROVAL')
      report.localHistory = { archived: Boolean(state.drawingHistory),
        retainedUndoSteps: state.drawingHistory?.undo.length ?? 0,
        warning: restored.historyRestoreWarning || chat.historyRestoreWarning }
      if (state.drawingHistory) check(restored.drawingHistory.canUndo, 'VALID_ARCHIVE_HISTORY_NOT_RESTORED')
      else check(!restored.drawingHistory.canUndo && !restored.drawingHistory.canRedo, 'ABSENT_ARCHIVE_INVENTED_HISTORY')
    } finally { restored.destroy() }
    report.nativeProtocolPassed = report.rounds.length === rounds.length && report.rounds.every(round => round.passed)
    report.passed = report.nativeProtocolPassed && report.semanticClarificationConfirmed === true
    if (report.nativeProtocolPassed && !report.passed) {
      report.failureStage = 'CLARIFICATION_SEMANTIC_REVIEW'
      report.failure = report.semanticClarificationConfirmed === false ? 'CLARIFICATION_NOT_CONFIRMED' : 'CLARIFICATION_REVIEW_REQUIRED'
    }
  } catch (error) {
    report.failureStage = stage
    report.failure = safeFailure(error)
  } finally {
    report.originalBytesUnchanged = hash(bytes) === sourceHash
    chat?.destroy()
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv.includes('--run')) console.log(JSON.stringify({ mode: 'dry-run', requests: 0, ...importedSpatialModelProtocol }, null, 2))
  else {
    const option = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
    let report
    try {
      const drawing = option('--drawing'), endpoint = process.env.KJDRAW_BENCH_ENDPOINT,
        model = process.env.KJDRAW_BENCH_MODEL, apiKey = process.env.KJDRAW_BENCH_API_KEY
      check(drawing && endpoint && model && apiKey, 'EXPLICIT_PRIVATE_DRAWING_AND_PROCESS_CONNECTION_REQUIRED')
      const bytes = new Uint8Array(await readFile(drawing)), sourceHash = hash(bytes)
      report = await runImportedSpatialModel({ bytes,
        connection: { endpoint, model, apiKey, provider: process.env.KJDRAW_BENCH_PROVIDER ?? 'custom',
          protocol: process.env.KJDRAW_BENCH_PROTOCOL ?? 'chat-completions' },
        onProgress: progress => console.log(JSON.stringify(progress)) })
      report.originalFileHashUnchanged = hash(await readFile(drawing)) === sourceHash
      if (!report.originalFileHashUnchanged) report.passed = false
    } catch (error) { report = { passed: false, failure: safeFailure(error), requests: 0 } }
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.passed ? 0 : 1
  }
}
