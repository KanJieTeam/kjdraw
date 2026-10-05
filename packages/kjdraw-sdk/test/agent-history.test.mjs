import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJDocument } from '../src/document.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { runKJAgentTask } from '../src/agent-runner.js'

function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
async function fixture(options = {}) {
  const original = KJDocument.create({ documentId: 'history-drawing', units: 'millimeter' })
  await original.transact('Existing source drawing', tx => {
    tx.createEntity('TEXT', { position: [10, 20, 0], height: 3, text: 'REV A' }, { id: 'note' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [100, 0, 0] }, { id: 'edge' })
    tx.putOpaquePayload('source-recipe', { revision: 'A', nested: { preserve: true } })
  })
  const sdk = createKJDrawSDK(options), document = sdk.attachDocument(KJDocument.open(original.serialize()))
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
async function edit({ document, session }, text = 'REV B') {
  const proposal = value(await session.call('cad_propose_text_edit', { expectedRevision: document.revision, units: 'millimeter', changes: [{ id: 'note', expectedText: document.getObject('note').payload.text, text }] }))
  value(await session.approve(proposal.planId, 'host-reviewer'))
}
async function propose({ document, session }, kind) {
  const read = value(await session.call('cad_read_history', { expectedRevision: document.revision }))
  return value(await session.call(`cad_propose_${kind}`, { expectedRevision: read.revision, units: read.units, targetHistoryId: read.history[`${kind}Target`].id }))
}

test('empty/opened baseline has no history and never registers an invented inverse proposal', async () => {
  const target = await fixture(), { document, session, sdk } = target, before = document.serialize()
  const history = value(await session.call('cad_read_history', { expectedRevision: document.revision }))
  assert.equal(history.history.canUndo, false)
  assert.equal(history.history.undoTarget, null)
  assert.equal((await session.call('cad_propose_undo', { expectedRevision: document.revision, units: 'millimeter', targetHistoryId: 'invented' })).ok, false)
  assert.equal(sdk.agentPlans.list().length, 0)
  assert.equal(document.serialize(), before)
  assert.equal(await document.undo(), false)
})

test('history read and proposal are immutable and approval performs real undo/redo once', async () => {
  const target = await fixture(), { document, session, sdk } = target
  const baselineFingerprint = document.fingerprint(), edge = document.getObject('edge')
  await edit(target)
  const editedFingerprint = document.fingerprint(), before = document.serialize(), historyBefore = document.history
  const undo = await propose(target, 'undo')
  assert.equal(undo.command, 'UNDO')
  assert.equal(undo.status, 'awaiting-host-approval')
  assert.equal(undo.preview.before[0].payload.text, 'REV B')
  assert.equal(undo.preview.after[0].payload.text, 'REV A')
  assert.equal(undo.preview.historyChange.afterFingerprint, baselineFingerprint)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, historyBefore)
  assert.throws(() => { undo.arguments.targetHistoryId = 'different' }, TypeError)
  assert.equal((await session.call('approve', { planId: undo.planId, reviewerId: 'model' })).ok, false)
  assert.equal((await session.call('cad_propose_undo', { ...undo.arguments, expectedRevision: document.revision, units: 'millimeter', confirmation: true })).ok, false)
  assert.equal((await session.approve(undo.planId, '')).ok, false)
  value(await session.approve(undo.planId, 'host-reviewer'))
  assert.equal(document.fingerprint(), baselineFingerprint)
  assert.equal(document.history.undoCount, 0)
  assert.equal(document.history.redoCount, 1)
  assert.deepEqual(document.getObject('edge'), edge)
  assert.equal(sdk.agentPlans.get(undo.planId).status, 'consumed')
  assert.equal((await session.approve(undo.planId, 'host-reviewer')).ok, false)
  const redo = await propose(target, 'redo')
  value(await session.approve(redo.planId, 'host-reviewer'))
  assert.equal(document.fingerprint(), editedFingerprint)
  assert.equal(document.history.undoCount, 1)
  assert.equal(document.snapshot().revisions.at(-1).kind, 'redo')
})

test('undo restores exact resources, source payloads and metadata instead of just entity geometry', async () => {
  const target = await fixture(), { document, session } = target, before = document.fingerprint()
  await document.transact('Combined source and geometry update', tx => {
    tx.updateObject('note', { payload: { text: 'REV C' } })
    tx.upsertTableRecord('layers', { name: 'ADDED', type: 'LAYER' })
    tx.putOpaquePayload('source-recipe', { revision: 'C' })
    tx.putResource('fonts', 'revision-font', { family: 'Revision C' })
  })
  const updated = document.fingerprint(), undo = await propose(target, 'undo')
  assert.ok(undo.preview.historyChange.changedSections.includes('opaquePayloads'))
  assert.ok(undo.preview.historyChange.changedSections.includes('tables'))
  value(await session.approve(undo.planId, 'host-reviewer'))
  assert.equal(document.fingerprint(), before)
  assert.equal(document.getTable('layers').records.some(layer => layer.name === 'ADDED'), false)
  assert.deepEqual(document.snapshot().opaquePayloads['source-recipe'], { revision: 'A', nested: { preserve: true } })
  value(await session.approve((await propose(target, 'redo')).planId, 'host-reviewer'))
  assert.equal(document.fingerprint(), updated)
})

test('stale history IDs, stale revisions, replaced commands and rejected plans never mutate content', async () => {
  for (const mode of ['revision', 'identity', 'command', 'reject']) {
    const target = await fixture(), { document, session, sdk } = target
    await edit(target)
    const undo = await propose(target, 'undo')
    if (mode === 'revision') await document.transact('Intervening edit', tx => tx.updateObject('edge', { payload: { end: [101, 0, 0] } }))
    if (mode === 'identity') await document.restoreHistory(document.exportHistory(), { expectedRevision: document.revision })
    if (mode === 'command') sdk.commands.register({ id: 'UNDO', transactional: false, execute: () => assert.fail('replacement command ran') }, { replace: true })
    if (mode === 'reject') value(session.reject(undo.planId, 'host-reviewer'))
    const before = document.serialize(), history = document.history
    assert.equal((await session.approve(undo.planId, 'host-reviewer')).ok, false, mode)
    assert.equal(document.serialize(), before, mode)
    assert.deepEqual(document.history, history, mode)
    assert.equal((await session.approve(undo.planId, 'host-reviewer')).ok, false, mode)
  }
})

test('history target is checked inside the document queue after asynchronous plan approval', async () => {
  const target = await fixture(), { sdk, document, session } = target
  await edit(target)
  const undo = await propose(target, 'undo'), revision = document.revision
  sdk.events.on('command:before-execute', ({ envelope }) => {
    if (envelope.command === 'UNDO') document.restoreHistory(document.exportHistory(), { expectedRevision: revision })
  })
  assert.equal((await session.approve(undo.planId, 'host-reviewer')).ok, false)
  assert.equal(document.revision, revision)
  assert.equal(document.getObject('note').payload.text, 'REV B')
})

test('redo is discarded by a new committed edit and a stale redo proposal is rejected', async () => {
  const target = await fixture(), { document, session } = target
  await edit(target)
  value(await session.approve((await propose(target, 'undo')).planId, 'host-reviewer'))
  const redo = await propose(target, 'redo')
  await edit(target, 'REV C')
  assert.equal(document.history.canRedo, false)
  const before = document.serialize()
  assert.equal((await session.approve(redo.planId, 'host-reviewer')).ok, false)
  assert.equal(document.serialize(), before)
})

test('history envelopes bind reviewed arguments and require an authenticated one-shot plan', async () => {
  const target = await fixture(), { sdk, document, session } = target
  await edit(target)
  const undo = await propose(target, 'undo'), before = document.serialize()
  const forged = sdk.createCommandEnvelope('UNDO', { targetHistoryId: 'unreviewed' }, { document, expectedRevision: document.revision, origin: 'ai', confirmation: { status: 'confirmed', planId: undo.planId, confirmedBy: 'host-reviewer' } })
  await assert.rejects(sdk.executeCommandEnvelope(forged), /arguments.*match/)
  assert.equal(document.serialize(), before)
  assert.throws(() => sdk.createCommandEnvelope('UNDO', undo.arguments, { document, expectedRevision: document.revision, origin: 'ai' }), /explicit user confirmation/)
  value(await session.approve(undo.planId, 'host-reviewer'))
  const redo = await propose(target, 'redo'), execution = sdk.createCommandEnvelope('REDO', redo.arguments, { document, expectedRevision: document.revision, origin: 'ai', confirmation: { status: 'confirmed', planId: redo.planId, confirmedBy: 'host-reviewer' } })
  const results = await Promise.allSettled([sdk.executeCommandEnvelope(execution), sdk.executeCommandEnvelope(execution)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(document.getObject('note').payload.text, 'REV B')
})

test('expired history proposals cannot commit and old sessions cannot access a replaced document', async () => {
  let now = 1000
  const target = await fixture({ agentPlanOptions: { clock: () => now, defaultTtlMs: 10 } }), { sdk, document, session } = target
  await edit(target)
  const undo = await propose(target, 'undo'), before = document.serialize()
  now += 11
  const expired = await session.approve(undo.planId, 'host-reviewer')
  assert.equal(expired.ok, false)
  assert.match(expired.error.message, /expired/)
  assert.equal(document.serialize(), before)
  sdk.documents.set(document.id, KJDocument.open(before))
  assert.equal((await session.call('cad_read_history', { expectedRevision: document.revision })).ok, false)
})

test('failed authoritative history commits retain geometry/history and cannot be retried automatically', async () => {
  const target = await fixture(), { document, session } = target
  await edit(target)
  const undo = await propose(target, 'undo'), before = document.serialize(), history = document.history
  document.bindAuthority({ serialize: () => document.serialize(), close: () => {}, commit: () => { throw new Error('uncertain history commit') } })
  assert.equal((await session.approve(undo.planId, 'host-reviewer')).ok, false)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
  assert.equal((await session.approve(undo.planId, 'host-reviewer')).ok, false)
})

test('natural model tool calls reach real engine history with no prompt interception', async () => {
  const target = await fixture(), { document, session } = target
  await edit(target)
  let turn = 0
  const model = { createConversation: ({ tools }) => {
    assert.ok(tools.some(tool => tool.name === 'cad_read_history'))
    assert.ok(tools.some(tool => tool.name === 'cad_propose_undo'))
    return { next: async input => {
      if (++turn === 1) return { text: '', calls: [{ id: 'read', name: 'cad_read_history', arguments: { expectedRevision: document.revision } }] }
      const history = input.results[0].result.value
      return { text: '', calls: [{ id: 'undo', name: 'cad_propose_undo', arguments: { expectedRevision: history.revision, units: history.units, targetHistoryId: history.history.undoTarget.id } }] }
    } }
  } }
  const before = document.serialize(), result = await runKJAgentTask({ session, model, prompt: '撤销刚才的修改', toolNames: ['cad_read_history', 'cad_propose_undo'] })
  assert.equal(result.status, 'awaiting-approval', JSON.stringify(result))
  assert.equal(result.outputs[1].name, 'cad_propose_undo')
  assert.equal(document.serialize(), before)
  value(await session.approve(result.proposalIds[0], 'host-reviewer'))
  assert.equal(document.getObject('note').payload.text, 'REV A')
})

test('real DXF import is a baseline; only later edits are undoable and survive validated local refresh', async () => {
  const seed = await fixture(), dxf = await seed.sdk.writeDocument(seed.document, { format: 'DXF' })
  const sdk = createKJDrawSDK(), document = await sdk.readDocument(dxf, { format: 'DXF' }), session = new KJAgentToolSession(sdk, document)
  assert.equal(document.history.undoCount, 0)
  assert.equal(await document.undo(), false)
  const note = document.listEntities({ type: 'TEXT' })[0], baseline = document.fingerprint(), importRevision = document.revision
  const modification = value(await session.call('cad_propose_text_edit', { expectedRevision: document.revision, units: 'millimeter', changes: [{ id: note.id, expectedText: 'REV A', text: 'REV B' }] }))
  value(await session.approve(modification.planId, 'host-reviewer'))
  const archive = document.exportHistory(), refreshedSDK = createKJDrawSDK(), refreshed = refreshedSDK.attachDocument(KJDocument.open(document.serialize())), refreshedSession = new KJAgentToolSession(refreshedSDK, refreshed)
  assert.equal(archive.baselineRevision, importRevision)
  assert.equal(refreshed.history.canUndo, false)
  await refreshed.restoreHistory(JSON.parse(JSON.stringify(archive)), { expectedRevision: refreshed.revision })
  assert.notEqual(refreshed.history.undoTarget.id, document.history.undoTarget.id)
  assert.equal(refreshedSDK.agentPlans.list().length, 0)
  const undo = value(await refreshedSession.call('cad_propose_undo', { expectedRevision: refreshed.revision, units: 'millimeter', targetHistoryId: refreshed.history.undoTarget.id }))
  value(await refreshedSession.approve(undo.planId, 'host-reviewer'))
  assert.equal(refreshed.fingerprint(), baseline)
  assert.equal(refreshed.history.canUndo, false)
  assert.equal(refreshed.listEntities().length, document.listEntities().length)
})

test('archive restores undo and redo chains with fresh IDs and never restores pending approval', async () => {
  const target = await fixture(), { document, session } = target
  await edit(target, 'REV B')
  await edit(target, 'REV C')
  value(await session.approve((await propose(target, 'undo')).planId, 'host-reviewer'))
  const pending = await propose(target, 'redo'), archive = document.exportHistory(), json = document.serialize()
  assert.equal(archive.undo.length, 1)
  assert.equal(archive.redo.length, 1)
  assert.equal(JSON.stringify(archive).includes(pending.planId), false)
  assert.ok(archive.undo.every(entry => !Object.hasOwn(entry, 'id') && entry.before.revisions.length === 0 && entry.after.revisions.length === 0))
  const sdk = createKJDrawSDK(), reopened = sdk.attachDocument(KJDocument.open(json)), newSession = new KJAgentToolSession(sdk, reopened)
  await reopened.restoreHistory(archive, { expectedRevision: reopened.revision })
  assert.equal(reopened.serialize(), json)
  assert.notEqual(reopened.history.redoTarget.id, document.history.redoTarget.id)
  assert.equal((await newSession.approve(pending.planId, 'host-reviewer')).ok, false)
  await reopened.redo({ expectedRevision: reopened.revision, targetHistoryId: reopened.history.redoTarget.id })
  assert.equal(reopened.getObject('note').payload.text, 'REV C')
  await reopened.undo()
  await reopened.undo()
  assert.equal(reopened.getObject('note').payload.text, 'REV A')
  assert.equal(reopened.history.canUndo, false)
})

test('archive rejects stale identity/content, invalid snapshots, disconnected chains and oversize data atomically', async () => {
  const target = await fixture(), { document } = target
  await edit(target, 'REV B')
  await edit(target, 'REV C')
  const valid = document.exportHistory(), before = document.serialize(), history = document.history
  const attacks = [
    archive => { archive.documentId = 'other' },
    archive => { archive.documentRevision-- },
    archive => { archive.documentFingerprint = 'different' },
    archive => { archive.baselineRevision = -1 },
    archive => { archive.undo[0].before.objects.note.id = 'invalid' },
    archive => { archive.undo.at(-1).after.objects.note.payload.text = 'broken current boundary' },
    archive => { archive.undo[0].after.objects.note.payload.text = 'broken adjacent chain' },
    archive => { archive.undo[0].before.revisions.push({}) },
    archive => { archive.undo[0].revision = archive.baselineRevision },
    archive => { archive.undo[0].source = 'adapter:dxf-ascii' },
    archive => { archive.undo.push(...Array(50).fill(archive.undo[0])) },
    archive => { archive.extra = 'not allowed' },
    archive => { archive.undo[0].after.opaquePayloads.tooLarge = 'x'.repeat(16777216) },
  ]
  for (const [index, attack] of attacks.entries()) {
    const corrupted = JSON.parse(JSON.stringify(valid)); attack(corrupted)
    await assert.rejects(document.restoreHistory(corrupted, { expectedRevision: document.revision }), `attack ${index}`)
    assert.equal(document.serialize(), before)
    assert.deepEqual(document.history, history)
  }
  await assert.rejects(document.restoreHistory(valid, { expectedRevision: document.revision - 1 }))
})

test('archive retains nearest bounded history and portable document serialization still opens without it', async () => {
  const target = await fixture(), { document } = target
  for (let index = 0; index < 52; index++) await document.transact(`Edit ${index}`, tx => tx.updateObject('note', { payload: { text: `Step ${index}` } }))
  const archive = document.exportHistory()
  assert.equal(archive.undo.length, 50)
  assert.equal(archive.undo[0].label, 'Edit 2')
  assert.ok(Object.isFrozen(archive.undo[0].before.objects.note))
  const reopened = KJDocument.open(document.serialize())
  assert.equal(reopened.history.canUndo, false)
  await reopened.restoreHistory(archive)
  for (let index = 0; index < 50; index++) assert.equal(await reopened.undo(), true)
  assert.equal(reopened.getObject('note').payload.text, 'Step 1')
  assert.equal(await reopened.undo(), false)
  assert.throws(() => document.exportHistory({ limit: 51 }))
  assert.throws(() => document.exportHistory({ maxBytes: 1024 }), /snapshot.*byte limit/)
})

test('clearing the baseline invalidates old history plans without changing the document', async () => {
  const target = await fixture(), { document, session } = target
  await edit(target)
  const undo = await propose(target, 'undo'), before = document.serialize()
  await document.clearHistory({ expectedRevision: document.revision })
  assert.equal(document.serialize(), before)
  assert.equal((await session.approve(undo.planId, 'host-reviewer')).ok, false)
  assert.equal(await document.undo(), false)
  assert.equal(document.exportHistory().undo.length, 0)
})
