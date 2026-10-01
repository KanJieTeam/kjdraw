import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { findDrawingText } from '../packages/kjdraw-sdk/src/drawing-text-search.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const directory = process.env.KJDRAW_GEOLOGY_DXF_DIR
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

class PrivateCorpusFailure extends Error {
  constructor(code) { super(code); this.code = code }
}
function check(condition, code) { if (!condition) throw new PrivateCorpusFailure(code) }
const same = (actual, expected, code) => check(canonicalStringify(actual) === canonicalStringify(expected), code)
function toolValue(result) {
  if (!result.ok) throw new PrivateCorpusFailure('SDK_' + (/^[A-Z0-9_]+$/.test(result.error?.code) ? result.error.code : 'TOOL_REJECTED'))
  return result.value
}
function safeCode(error) {
  if (error instanceof PrivateCorpusFailure) return error.code
  if (/snapshot exceeds the local archive byte limit/.test(String(error?.message))) return 'HISTORY_ARCHIVE_SINGLE_STEP_BUDGET'
  if (/^[A-Z0-9_]+$/.test(error?.code)) return 'SDK_' + error.code
  return 'UNCLASSIFIED_ENGINE_FAILURE'
}

async function drawings(root, depth = 0) {
  check(depth <= 64, 'PRIVATE_SCAN_DEPTH_LIMIT')
  const files = []
  // Scan only the explicitly selected root; never follow directory symlinks.
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await drawings(path, depth + 1))
    else if (entry.isFile() && /\.dxf$/i.test(entry.name)) files.push(path)
  }
  return files.sort()
}

function records(document) {
  return new Map(document.listObjects({ includeErased: true }).map(record => [record.id, structuredClone(record)]))
}
function unchanged(document, expected, allowedIds = new Set()) {
  check(document.listObjects({ includeErased: true }).length === expected.size, 'UNTARGETED_RECORD_COUNT_CHANGE')
  for (const [id, record] of expected) {
    if (!allowedIds.has(id)) same(document.getObject(id, { includeErased: true }), record, 'UNTARGETED_NATIVE_RECORD_CHANGE')
  }
}

function reference(document, id) {
  if (id == null) return id
  const record = document.getObject(String(id), { includeErased: true })
  check(record != null, 'DXF_RESOURCE_REFERENCE_MISSING')
  return record.kind === 'table-record' || record.kind === 'block-record'
    ? { kind: record.kind, type: record.type, name: record.name }
    : { kind: record.kind, type: record.type, handle: record.handle }
}
function nativeValue(value, document, key = '') {
  if (key === 'rawTags' || key === 'contractVersion') return undefined
  // Reimport may rebuild SDK IDs; keep their native target identity, including
  // HATCH boundary associations, instead of silently deleting every ID field.
  if (/Id$/.test(key) && value != null) return reference(document, value)
  if (/Ids$/.test(key) && Array.isArray(value)) return value.map(id => reference(document, id))
  if (typeof value === 'number') return Math.round(value * 1e8) / 1e8
  if (Array.isArray(value)) return value.map(item => nativeValue(item, document))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([name, item]) => {
    const converted = nativeValue(item, document, name)
    return converted === undefined ? [] : [[name, converted]]
  }))
  return value
}
function nativeEntity(document, entity) {
  return { handle: entity.handle, type: entity.type, owner: reference(document, entity.ownerId),
    payload: nativeValue({ normal: [0, 0, 1], ...entity.payload }, document),
    extension: nativeValue(entity.extension, document) }
}
function nativeTables(document) {
  const state = document.snapshot()
  return Object.fromEntries(Object.entries(state.tables).map(([name, table]) => [name,
    table.recordIds.map(id => {
      const record = document.getObject(id)
      return { kind: record.kind, type: record.type, name: record.name, payload: nativeValue(record.payload, document) }
    }).sort((left, right) => canonicalStringify([left.type, left.name]).localeCompare(canonicalStringify([right.type, right.name]))),
  ]))
}

async function dxfReopen(sdk, document) {
  const output = await sdk.writeDocument(document, { format: 'DXF' })
  const reopened = await createKJDrawSDK().readDocument(output, { format: 'DXF' })
  check(reopened.validate().valid, 'DXF_REIMPORT_INVALID')
  check(!reopened.history.canUndo, 'DXF_REIMPORT_BASELINE_UNDOABLE')
  check(reopened.snapshot().header.units === document.snapshot().header.units, 'DXF_DRAWING_UNITS_CHANGED')
  const expected = document.listEntities(), actual = new Map(reopened.listEntities().map(entity => [entity.handle, entity]))
  check(expected.length === actual.size, 'DXF_ENTITY_COUNT_CHANGED')
  for (const entity of expected) {
    const restored = actual.get(entity.handle)
    check(restored != null, 'DXF_ENTITY_HANDLE_LOST')
    check(restored.type === entity.type, 'DXF_NATIVE_ENTITY_TYPE_CHANGED')
    same(nativeEntity(reopened, restored), nativeEntity(document, entity), entity.type === 'HATCH' ? 'DXF_HATCH_BOUNDARY_OR_PATTERN_CHANGED' : 'DXF_NATIVE_ENTITY_SEMANTICS_CHANGED')
  }
  same(nativeTables(reopened), nativeTables(document), 'DXF_LAYER_OR_RESOURCE_SEMANTICS_CHANGED')
}

async function reviewedHistory(context, kind, expectedFingerprint) {
  context.stage = kind.toUpperCase() + '_READ'
  const { document, session } = context
  const read = toolValue(await session.call('cad_read_history', { expectedRevision: document.revision }))
  const target = read.history[kind + 'Target']
  check(target != null, 'HISTORY_NEXT_TARGET_MISSING')
  const serialized = document.serialize(), currentHistory = document.history
  context.stage = kind.toUpperCase() + '_PROPOSE'
  const proposal = toolValue(await session.call('cad_propose_' + kind, { expectedRevision: document.revision, units: read.units, targetHistoryId: target.id }))
  check(document.serialize() === serialized, 'HISTORY_PROPOSAL_MUTATED_CONTENT')
  same(document.history, currentHistory, 'HISTORY_PROPOSAL_MUTATED_STACK')
  context.stage = kind.toUpperCase() + '_APPROVE'
  const receipt = toolValue(await session.approve(proposal.planId, 'private-local-regression'))
  check(receipt.status === 'committed', 'HISTORY_COMMIT_RECEIPT_MISSING')
  check(document.fingerprint() === expectedFingerprint, 'HISTORY_RESTORED_WRONG_CONTENT')
  check(!(await session.approve(proposal.planId, 'private-local-regression')).ok, 'HISTORY_APPROVAL_REPLAYED')
  context.engineSteps++
}

async function refreshHistory(context, expectedBefore, expectedAfter) {
  context.stage = 'HISTORY_ARCHIVE_EXPORT'
  const archive = context.document.exportHistory({ limit: 50 })
  check(archive.undo.length > 0, 'HISTORY_ARCHIVE_RETAINED_NO_UNDO')
  check(archive.undo.length + archive.redo.length <= 50, 'HISTORY_ARCHIVE_STEP_BOUND_EXCEEDED')
  const oldTarget = context.document.history.undoTarget.id, source = context.document.serialize()
  const originalRecords = records(context.document)
  // Save and reopen portable drawing content separately from the local history.
  const portable = await context.sdk.writeDocument(context.document, { format: 'KJD' })
  context.stage = 'HISTORY_ARCHIVE_REOPEN'
  context.sdk = createKJDrawSDK()
  context.document = await context.sdk.readDocument(portable, { format: 'KJD' })
  check(!context.document.history.canUndo && !context.document.history.canRedo, 'KJD_REOPEN_INVENTED_HISTORY')
  context.session = new KJAgentToolSession(context.sdk, context.document)
  context.stage = 'HISTORY_ARCHIVE_RESTORE'
  await context.document.restoreHistory(JSON.parse(JSON.stringify(archive)), { expectedRevision: context.document.revision })
  check(context.document.serialize() === source, 'HISTORY_ARCHIVE_MUTATED_PORTABLE_CONTENT')
  unchanged(context.document, originalRecords)
  check(context.document.history.undoTarget.id !== oldTarget, 'HISTORY_ARCHIVE_REUSED_OLD_TARGET_ID')
  check(context.document.history.undoCount === archive.undo.length, 'HISTORY_ARCHIVE_RESTORED_COUNT_MISMATCH')
  check(context.sdk.agentPlans.list().length === 0, 'HISTORY_ARCHIVE_RESTORED_APPROVAL_PLAN')
  context.retainedCounts.push(archive.undo.length)
  await reviewedHistory(context, 'undo', expectedBefore)
  await reviewedHistory(context, 'redo', expectedAfter)
  context.refreshes++
}

async function journey(bytes, context) {
  context.stage = 'IMPORT'
  context.sdk = createKJDrawSDK()
  context.document = await context.sdk.readDocument(bytes, { format: 'DXF' })
  context.session = new KJAgentToolSession(context.sdk, context.document)
  let document = context.document
  check(document.validate().valid, 'SOURCE_DXF_IMPORT_INVALID')
  check(document.history.undoCount === 0 && document.history.redoCount === 0, 'SOURCE_IMPORT_NOT_INITIAL_BASELINE')
  check(!await document.undo(), 'SOURCE_IMPORT_WAS_UNDONE')
  const sourceFingerprint = document.fingerprint()
  check(document.listEntities({ type: 'HATCH' }).length > 0, 'SOURCE_SECTION_HAS_NO_NATIVE_HATCH')
  context.stage = 'SELECT_EXACT_TEXT'
  const target = document.listEntities({ type: 'TEXT', ownerId: document.spaces.modelSpaceId }).find(entity => {
    if (!entity.payload.text?.trim() || entity.payload.text.length > 250) return false
    return findDrawingText(document, { expectedRevision: document.revision, search: entity.payload.text, match: 'exact', limit: 100 })
      .matches.some(match => match.id === entity.id && match.textEditCandidate)
  })
  check(target != null, 'SOURCE_HAS_NO_EXPLICIT_EDITABLE_TEXT')
  const targetId = target.id, originalText = target.payload.text, originalLayerId = target.payload.layerId
  context.stage = 'PREPARE_REVIEW_LAYER'
  let reviewLayerId
  const reviewLayerPayload = structuredClone(document.getObject(document.getTable('layers').currentId).payload)
  await document.transact('Private local regression review layer', tx => {
    reviewLayerId = tx.upsertTableRecord('layers', { name: 'KJDRAW_LOCAL_HISTORY_REVIEW', type: 'LAYER', payload: { ...reviewLayerPayload, visible: true, frozen: false, locked: false } }).id
  })
  context.engineSteps++
  const baselineRecords = records(document), edited = new Set([targetId])
  const operations = [
    ['text', originalText + ' [校核 1]'], ['move', 1, 0], ['layer', reviewLayerId],
    ['text', originalText + ' [校核 2]'], ['move', 0, 1], ['layer', originalLayerId],
    ['text', originalText + ' [校核 3]'], ['move', -1, -1], ['text', originalText],
    ['text', originalText + ' [校核完成]'],
  ]
  for (const [index, [kind, requested, dy]] of operations.entries()) {
    context.round = index + 1
    document = context.document
    const session = context.session, current = structuredClone(document.getObject(targetId))
    const beforeFingerprint = document.fingerprint(), beforeRecords = records(document), serialized = document.serialize(), history = document.history
    context.stage = 'EXACT_TEXT_REDISCOVERY'
    const found = toolValue(await session.call('cad_find_text', { expectedRevision: document.revision, search: current.payload.text, match: 'exact', limit: 100 }))
    check(found.matches.some(match => match.id === targetId && match.textEditCandidate), 'EDIT_TARGET_NOT_REDISCOVERED')
    let name, arguments_
    if (kind === 'text') { name = 'cad_propose_text_edit'; arguments_ = { changes: [{ id: targetId, expectedText: current.payload.text, text: requested }] } }
    else if (kind === 'move') { name = 'cad_propose_move'; arguments_ = { ids: [targetId], dx: requested, dy } }
    else { name = 'cad_propose_relayer'; arguments_ = { ids: [targetId], layerId: requested, maxBytes: 262144 } }
    context.stage = 'EDIT_PROPOSE_' + kind.toUpperCase()
    const proposal = toolValue(await session.call(name, { expectedRevision: document.revision, units: document.snapshot().header.units, ...arguments_ }))
    check(document.serialize() === serialized, 'EDIT_PROPOSAL_MUTATED_CONTENT')
    same(document.history, history, 'EDIT_PROPOSAL_MUTATED_HISTORY')
    same(proposal.preview.before.map(entity => entity.id), [targetId], 'EDIT_PREVIEW_EXPANDED_UNRELATED_TARGETS')
    same(proposal.preview.after.map(entity => entity.id), [targetId], 'EDIT_PREVIEW_REPLACED_TARGET_IDENTITY')
    context.stage = 'EDIT_APPROVE_' + kind.toUpperCase()
    toolValue(await session.approve(proposal.planId, 'private-local-regression'))
    const actual = document.getObject(targetId)
    check(actual.id === current.id && actual.handle === current.handle && actual.type === current.type && actual.ownerId === current.ownerId, 'EDIT_NATIVE_IDENTITY_CHANGED')
    same(actual.source, current.source, 'EDIT_NATIVE_SOURCE_CHANGED')
    same(actual.extension, current.extension, 'EDIT_NATIVE_EXTENSION_CHANGED')
    same(actual.payload, proposal.preview.after[0].payload, 'EDIT_DIFFERS_FROM_REVIEWED_PAYLOAD')
    if (kind === 'text') check(actual.payload.text === requested, 'EXACT_TEXT_REPLACEMENT_MISMATCH')
    if (kind === 'layer') check(actual.payload.layerId === requested, 'EXACT_LAYER_ASSIGNMENT_MISMATCH')
    if (kind === 'move') for (const key of ['position', 'alignmentPoint']) {
      if (current.payload[key]) {
        const expected = [...current.payload[key]]; expected[0] += requested; expected[1] += dy
        same(actual.payload[key], expected, 'EXACT_ANNOTATION_TRANSLATION_MISMATCH')
      }
    }
    unchanged(document, beforeRecords, edited)
    unchanged(document, baselineRecords, edited)
    context.editRounds++; context.engineSteps++
    const afterFingerprint = document.fingerprint(), afterRecords = records(document)
    await reviewedHistory(context, 'undo', beforeFingerprint)
    unchanged(context.document, beforeRecords)
    await reviewedHistory(context, 'redo', afterFingerprint)
    unchanged(context.document, afterRecords)
    if (index === 4 || index === 9) await refreshHistory(context, beforeFingerprint, afterFingerprint)
    context.stage = 'DXF_EXPORT_REIMPORT'
    await dxfReopen(context.sdk, context.document)
    context.dxfReopens++
  }
  check(context.editRounds === 10 && context.engineSteps >= 35 && context.refreshes === 2 && context.dxfReopens === 10, 'CUMULATIVE_JOURNEY_INCOMPLETE')
  check(context.document.fingerprint() !== sourceFingerprint, 'CUMULATIVE_EDITS_NOT_COMMITTED')
  return context
}

// This is a private, optional real-engine regression, not an LLM benchmark.
// Project paths, names, labels, coordinates and error payloads never enter TAP.
test('private original section DXF: ten exact edits, reviewed history, refreshed archives and native DXF preservation', { skip: !directory }, async t => {
  let files
  try { files = await drawings(directory) } catch { throw new PrivateCorpusFailure('PRIVATE_ROOT_SCAN_FAILED') }
  check(files.length > 0, 'PRIVATE_CORPUS_HAS_NO_DXF')
  let completed = 0, editRounds = 0, engineSteps = 0, refreshes = 0, dxfReopens = 0
  const failures = new Map(), retainedCounts = []
  for (const path of files) {
    let bytes
    try { bytes = new Uint8Array(await readFile(path)) } catch { throw new PrivateCorpusFailure('PRIVATE_SOURCE_READ_FAILED') }
    const originalHash = hash(bytes), id = originalHash.slice(0, 12)
    await t.test('private-section-' + id, async () => {
      const context = { stage: 'IMPORT', round: 0, editRounds: 0, engineSteps: 0, refreshes: 0, dxfReopens: 0, retainedCounts: [] }
      let failure
      try { await journey(bytes, context) } catch (error) { failure = { code: safeCode(error), stage: context.stage, round: context.round } }
      try { check(hash(await readFile(path)) === originalHash, 'PRIVATE_ORIGINAL_FILE_CHANGED') }
      catch { failure = { code: 'PRIVATE_ORIGINAL_FILE_CHANGED_OR_UNREADABLE', stage: 'SOURCE_HASH_RECHECK', round: context.round } }
      editRounds += context.editRounds; engineSteps += context.engineSteps; refreshes += context.refreshes; dxfReopens += context.dxfReopens
      retainedCounts.push(...context.retainedCounts)
      if (failure) {
        const key = failure.stage + ':' + failure.code
        failures.set(key, (failures.get(key) ?? 0) + 1)
        // Wrap without cause: SDK assertion dumps can contain private text.
        throw new PrivateCorpusFailure(id + '; round=' + failure.round + '; class=' + key)
      }
      completed++
    })
  }
  t.diagnostic('private DXF attempted=' + files.length + '; completed=' + completed + '; exact edit rounds=' + editRounds + '; committed engine steps=' + engineSteps + '; validated history refreshes=' + refreshes + '; DXF reimports=' + dxfReopens + '; natural-language model calls=0')
  if (retainedCounts.length) t.diagnostic('archive retained undo steps: min=' + Math.min(...retainedCounts) + '; max=' + Math.max(...retainedCounts) + '; archive limit=50 steps/16MiB')
  for (const [code, count] of failures) t.diagnostic('failure class=' + code + '; drawings=' + count)
  check(completed === files.length, 'PRIVATE_CORPUS_JOURNEYS_FAILED')
})
