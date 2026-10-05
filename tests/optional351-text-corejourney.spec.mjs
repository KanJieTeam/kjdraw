import test from 'node:test'
import { createHash } from 'node:crypto'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { findDrawingText } from '../packages/kjdraw-sdk/src/drawing-text-search.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'
import { CorpusFailure, nativeEntity, nativeTables } from './helpers/private-native-corpus-oracle.mjs'

// Optional private corpus, never copied into fixtures or published reports.
// KJDRAW_TEXT_CORPUS_ROOTS: JSON array of 1–8 paths or {root,recursive:false}.
// KJDRAW_TEXT_CORPUS_PROFILE: core (TEXT/MOVE/RELAYER) or ten-round.
// All operations use exact real native identities, not language/model guesses.
const configuredRoots = process.env.KJDRAW_TEXT_CORPUS_ROOTS
const profile = process.env.KJDRAW_TEXT_CORPUS_PROFILE ?? 'core'
const liveProgress = process.env.KJDRAW_TEXT_CORPUS_PROGRESS === '1'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const check = (condition, code) => { if (!condition) throw new CorpusFailure(code) }
const same = (actual, expected, code) => check(canonicalStringify(actual) === canonicalStringify(expected), code)
const value = result => {
  if (!result.ok) {
    const failure = new CorpusFailure('SDK_' + (/^[A-Z0-9_]+$/.test(result.error?.code) ? result.error.code : 'TOOL_REJECTED'))
    // Trusted local reproductions may inspect the SDK diagnostic; aggregate
    // corpus output remains limited to the fixed stage and error code.
    failure.details = result.error
    throw failure
  }
  return result.value
}
const safeCode = error => error instanceof CorpusFailure ? error.code : 'ENGINE_OR_REOPEN_FAILURE'
const records = document => document.snapshot().objects
function untouched(document, before, allowed = new Set()) {
  same(Object.keys(records(document)).sort(), Object.keys(before).sort(), 'NATIVE_RECORD_ID_SET_CHANGED')
  for (const [id, record] of Object.entries(before)) if (!allowed.has(id)) {
    same(records(document)[id], record, 'UNTOUCHED_NATIVE_RECORD_CHANGED')
  }
}
async function scan(directory, recursive, boundary, depth = 0) {
  check(depth <= 64, 'CORPUS_DIRECTORY_DEPTH_LIMIT')
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory() && recursive) files.push(...await scan(path, true, boundary, depth + 1))
    else if (entry.isFile() && /\.dxf$/i.test(entry.name)) {
      const canonical = await realpath(path), within = relative(boundary, canonical)
      check(!isAbsolute(within) && within !== '..' && !within.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')), 'CORPUS_SOURCE_ESCAPED_ROOT')
      files.push(canonical)
    }
  }
  return files.sort()
}
async function reopen(context) {
  context.stage = 'KJD_EXPORT_REOPEN'
  const { sdk, document } = context
  const kjd = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  check(kjd.validate().valid, 'KJD_REOPEN_INVALID')
  same(records(kjd), records(document), 'KJD_NATIVE_RECORD_CHANGED')
  check(kjd.snapshot().header.units === document.snapshot().header.units, 'KJD_UNITS_CHANGED')
  check(!kjd.history.canUndo && !kjd.history.canRedo, 'KJD_REOPEN_INVENTED_HISTORY')
  context.kjdReopens++
  context.stage = 'DXF_EXPORT_REOPEN'
  const dxf = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  check(dxf.validate().valid, 'DXF_REOPEN_INVALID')
  check(dxf.snapshot().header.units === document.snapshot().header.units, 'DXF_UNITS_CHANGED')
  check(!dxf.history.canUndo && !dxf.history.canRedo, 'DXF_REOPEN_IMPORT_UNDOABLE')
  const actual = new Map(dxf.listEntities().map(entity => [entity.handle, entity]))
  check(actual.size === document.listEntities().length, 'DXF_NATIVE_ENTITY_COUNT_CHANGED')
  for (const entity of document.listEntities()) {
    const restored = actual.get(entity.handle)
    check(restored != null, 'DXF_NATIVE_HANDLE_MISSING')
    same(nativeEntity(dxf, restored), nativeEntity(document, entity), entity.type === 'HATCH' ? 'DXF_HATCH_GEOMETRY_OR_PATTERN_CHANGED' : 'DXF_NATIVE_ENTITY_SEMANTICS_CHANGED')
  }
  same(nativeTables(dxf), nativeTables(document), 'DXF_LAYER_OR_RESOURCE_SEMANTICS_CHANGED')
  context.dxfReopens++
}
async function history(context, kind, expectedFingerprint, expectedRecords) {
  const { document, session } = context
  context.stage = kind.toUpperCase() + '_READ_PROPOSE'
  const read = value(await session.call('cad_read_history', { expectedRevision: document.revision }))
  const target = read.history[kind + 'Target']
  check(target != null, 'REAL_HISTORY_TARGET_MISSING')
  const serialized = document.serialize(), beforeHistory = document.history
  const proposal = value(await session.call('cad_propose_' + kind, { expectedRevision: document.revision,
    units: read.units, targetHistoryId: target.id }))
  check(document.serialize() === serialized, 'HISTORY_PROPOSAL_MUTATED_DOCUMENT')
  same(document.history, beforeHistory, 'HISTORY_PROPOSAL_MUTATED_STACK')
  context.stage = kind.toUpperCase() + '_APPROVE'
  check(value(await session.approve(proposal.planId, 'private-native-core-regression')).status === 'committed', 'HISTORY_APPROVAL_NOT_COMMITTED')
  context.engineSteps++
  check(document.fingerprint() === expectedFingerprint, 'REAL_HISTORY_RESTORED_WRONG_FINGERPRINT')
  same(records(document), expectedRecords, 'REAL_HISTORY_DID_NOT_RESTORE_ALL_NATIVE_RECORDS')
  check(!(await session.approve(proposal.planId, 'private-native-core-regression')).ok, 'HISTORY_APPROVAL_REPLAYED')
}
async function journey(bytes, context) {
  context.sdk = createKJDrawSDK()
  context.stage = 'IMPORT'
  context.document = await context.sdk.readDocument(bytes, { format: 'DXF' })
  const document = context.document
  check(document.validate().valid, 'SOURCE_IMPORT_INVALID')
  check(!document.history.canUndo && !document.history.canRedo && !await document.undo(), 'SOURCE_IMPORT_NOT_INITIAL_BASELINE')
  context.imported = true
  const texts = document.listEntities({ ownerId: document.spaces.modelSpaceId, type: 'TEXT' })
  if (!texts.length) return 'NO_MODEL_NATIVE_TEXT'
  context.hasNativeText = true
  context.stage = 'SELECT_UNIQUE_REAL_TEXT'
  const allText = document.listEntities({ ownerId: document.spaces.modelSpaceId }).filter(entity =>
    ['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF'].includes(entity.type) && typeof entity.payload.text === 'string')
  const frequencies = new Map()
  for (const entity of allText) frequencies.set(entity.payload.text, (frequencies.get(entity.payload.text) ?? 0) + 1)
  const unique = texts.filter(entity => typeof entity.payload.text === 'string' && entity.payload.text.trim() &&
    entity.payload.text.length <= 240 && frequencies.get(entity.payload.text) === 1)
  if (!unique.length) return 'NO_UNIQUE_BOUNDED_TEXT_LABEL'
  const target = unique.find(entity => {
    const found = findDrawingText(document, { expectedRevision: document.revision, search: entity.payload.text,
      match: 'exact', caseSensitive: true, maxBytes: 262144, limit: 100 })
    return found.totalMatches === 1 && found.matches[0]?.id === entity.id && found.matches[0].textEditCandidate
  })
  if (!target) return 'UNIQUE_TEXT_PROTECTED_OR_NOT_DRAWABLE'
  context.selected = true
  context.session = new KJAgentToolSession(context.sdk, document)
  const sourceRecords = records(document), sourceUnits = document.snapshot().header.units
  const originalText = target.payload.text, originalLayer = target.payload.layerId
  context.stage = 'PREPARE_REVIEW_LAYER'
  const payload = structuredClone(document.getObject(originalLayer ?? document.getTable('layers').currentId).payload)
  let name = 'KJDRAW_PRIVATE_CORE_REVIEW', suffix = 0
  while (document.getTable('layers').records.some(record => record.name === name)) name = 'KJDRAW_PRIVATE_CORE_REVIEW_' + ++suffix
  let reviewLayer
  await document.transact('Private native core review layer', tx => {
    reviewLayer = tx.upsertTableRecord('layers', { name, type: 'LAYER', payload: { ...payload, visible: true, frozen: false, locked: false } }).id
  })
  context.engineSteps++
  for (const [id, record] of Object.entries(sourceRecords)) same(records(document)[id], record, 'REVIEW_LAYER_CHANGED_ORIGINAL_RECORD')
  const baseline = records(document), changed = new Set([target.id])
  const operations = profile === 'ten-round' ? [
    ['text', originalText + ' [CORE 1]'], ['move', 1, 0], ['layer', reviewLayer],
    ['text', originalText + ' [CORE 2]'], ['move', 0, 1], ['layer', originalLayer],
    ['text', originalText + ' [CORE 3]'], ['move', -1, -1], ['text', originalText], ['text', originalText + ' [CORE DONE]'],
  ] : [['text', originalText + ' [CORE]'], ['move', 1, 0], ['layer', reviewLayer]]
  for (const [index, [kind, requested, dy]] of operations.entries()) {
    context.round = index + 1
    const current = structuredClone(document.getObject(target.id)), expected = structuredClone(current)
    const beforeRecords = records(document), beforeFingerprint = document.fingerprint()
    const serialized = document.serialize(), beforeHistory = document.history
    context.stage = 'EXACT_TARGET_REDISCOVERY'
    const found = value(await context.session.call('cad_find_text', { expectedRevision: document.revision,
      search: current.payload.text, match: 'exact', caseSensitive: true, maxBytes: 262144, limit: 100 }))
    check(found.totalMatches === 1 && found.matches[0]?.id === target.id && found.matches[0].textEditCandidate, 'EXACT_UNIQUE_TARGET_CHANGED')
    let tool, args
    if (kind === 'text') { tool = 'cad_propose_text_edit'; args = { changes: [{ id: target.id, expectedText: current.payload.text, text: requested }] }; expected.payload.text = requested }
    else if (kind === 'move') {
      tool = 'cad_propose_move'; args = { ids: [target.id], dx: requested, dy }
      for (const key of ['position', 'alignmentPoint']) if (expected.payload[key]) { expected.payload[key][0] += requested; expected.payload[key][1] += dy }
    } else { tool = 'cad_propose_relayer'; args = { ids: [target.id], layerId: requested, maxBytes: 262144 }; expected.payload.layerId = requested }
    context.stage = kind.toUpperCase() + '_PROPOSE'
    const proposal = value(await context.session.call(tool, { expectedRevision: document.revision, units: sourceUnits, ...args }))
    check(document.serialize() === serialized, 'EDIT_PROPOSAL_MUTATED_DOCUMENT')
    same(document.history, beforeHistory, 'EDIT_PROPOSAL_MUTATED_HISTORY')
    same(proposal.preview.before.map(entity => entity.id), [target.id], 'EDIT_PROPOSAL_EXPANDED_TARGET')
    same(proposal.preview.after.map(entity => entity.id), [target.id], 'EDIT_PROPOSAL_REPLACED_TARGET')
    context.stage = kind.toUpperCase() + '_APPROVE'
    check(value(await context.session.approve(proposal.planId, 'private-native-core-regression')).status === 'committed', 'EDIT_NOT_COMMITTED')
    context.engineSteps++; context.editRounds++; context[kind + 'Edits']++
    same(document.getObject(target.id), expected, 'REVIEWED_EXACT_NATIVE_RECORD_MISMATCH')
    untouched(document, beforeRecords, changed)
    untouched(document, baseline, changed)
    check(document.snapshot().header.units === sourceUnits, 'EDIT_CHANGED_DRAWING_UNITS')
    const afterRecords = records(document), afterFingerprint = document.fingerprint()
    await history(context, 'undo', beforeFingerprint, beforeRecords)
    await history(context, 'redo', afterFingerprint, afterRecords)
  }
  await reopen(context)
  return null
}

// Export the exact oracle for isolated reproductions; no private fixtures are bundled.
export { journey as runPrivateNativeCoreJourney, nativeEntity, nativeTables }

test('optional private native TEXT corpus: exact edits, reviewed history and complete native reopen preservation; zero model calls', {
  skip: !configuredRoots,
}, async t => {
  let files
  try {
    check(['core', 'ten-round'].includes(profile), 'INVALID_CORPUS_PROFILE')
    const roots = JSON.parse(configuredRoots)
    check(Array.isArray(roots) && roots.length >= 1 && roots.length <= 8, 'INVALID_EXPLICIT_CORPUS_ROOTS')
    files = []
    for (const entry of roots) {
      const path = typeof entry === 'string' ? entry : entry?.root
      check(typeof path === 'string' && path.length > 0 && (typeof entry === 'string' || entry.recursive === undefined || typeof entry.recursive === 'boolean'), 'INVALID_EXPLICIT_CORPUS_ROOT')
      const boundary = await realpath(resolve(path))
      files.push(...await scan(boundary, typeof entry === 'string' || entry.recursive !== false, boundary))
    }
  } catch { throw new CorpusFailure('EXPLICIT_PRIVATE_CORPUS_SCAN_FAILED') }
  check(files.length > 0, 'EXPLICIT_PRIVATE_CORPUS_HAS_NO_DXF')
  const report = { profile, filesDiscovered: files.length, distinctDxf: 0, duplicateFiles: 0, importedValid: 0,
    nativeTextFiles: 0, selectedUniqueEditableText: 0, completedJourneys: 0, skippedNoText: 0,
    skippedNoUniqueBoundedText: 0, skippedProtectedText: 0, failedJourneys: 0, editRounds: 0,
    engineSteps: 0, textEdits: 0, moveEdits: 0, layerEdits: 0, kjdReopens: 0, dxfReopens: 0,
    originalHashesUnchanged: 0, naturalLanguageModelCalls: 0, failures: {} }
  const hashes = new Set()
  for (const path of files) {
    let bytes
    try { bytes = new Uint8Array(await readFile(path)) } catch { throw new CorpusFailure('PRIVATE_DXF_SOURCE_READ_FAILED') }
    const beforeHash = hash(bytes)
    if (hashes.has(beforeHash)) { report.duplicateFiles++; continue }
    hashes.add(beforeHash); report.distinctDxf++
    const context = { stage: 'IMPORT', round: 0, imported: false, hasNativeText: false, selected: false,
      editRounds: 0, engineSteps: 0, textEdits: 0, moveEdits: 0, layerEdits: 0, kjdReopens: 0, dxfReopens: 0 }
    let skip, failure
    try { skip = await journey(bytes, context) }
    catch (error) { failure = context.stage + ':' + safeCode(error) }
    try { check(hash(await readFile(path)) === beforeHash, 'ORIGINAL_SOURCE_HASH_CHANGED'); report.originalHashesUnchanged++ }
    catch { failure = 'SOURCE_HASH_RECHECK:ORIGINAL_SOURCE_CHANGED_OR_UNREADABLE' }
    report.importedValid += Number(context.imported); report.nativeTextFiles += Number(context.hasNativeText)
    report.selectedUniqueEditableText += Number(context.selected)
    for (const key of ['editRounds', 'engineSteps', 'textEdits', 'moveEdits', 'layerEdits', 'kjdReopens', 'dxfReopens']) report[key] += context[key]
    if (failure) { report.failedJourneys++; report.failures[failure] = (report.failures[failure] ?? 0) + 1 }
    else if (skip === 'NO_MODEL_NATIVE_TEXT') report.skippedNoText++
    else if (skip === 'NO_UNIQUE_BOUNDED_TEXT_LABEL') report.skippedNoUniqueBoundedText++
    else if (skip === 'UNIQUE_TEXT_PROTECTED_OR_NOT_DRAWABLE') report.skippedProtectedText++
    else report.completedJourneys++
    if (report.distinctDxf % 100 === 0) {
      const progress = JSON.stringify({ phase: 'private-corpus-progress', processed: report.distinctDxf,
        nativeTextFiles: report.nativeTextFiles, completedJourneys: report.completedJourneys,
        failedJourneys: report.failedJourneys, naturalLanguageModelCalls: 0 })
      // Opt-in private runs can expose real aggregate progress immediately;
      // node:test otherwise buffers diagnostics until this parent test ends.
      // No path, project label, geometry or original source hash is emitted.
      if (liveProgress) process.stdout.write(progress + '\n')
      else t.diagnostic(progress)
    }
  }
  t.diagnostic(JSON.stringify(report))
  check(report.originalHashesUnchanged === report.distinctDxf, 'PRIVATE_SOURCE_HASH_RECHECK_INCOMPLETE')
  check(report.failedJourneys === 0, 'PRIVATE_NATIVE_TEXT_CORPUS_HAS_JOURNEY_FAILURES')
})
