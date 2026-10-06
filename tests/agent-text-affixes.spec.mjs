import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { expandAgentTextAffixes } from '../packages/kjdraw-sdk/src/text-edit.js'
import { canonicalStringify } from '../packages/kjdraw-sdk/src/utils.js'

const value = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value }
const content = document => {
  const { objects, tables, spaces, opaquePayloads } = document.snapshot()
  return { objects, tables, spaces, opaquePayloads }
}
async function fixture(t) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  t.after(() => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) })
  await document.transact('Public literal annotations', tx => {
    tx.createEntity('TEXT', { text: '原标点。 Original; punctuation.', position: [0, 0, 0], height: 2 }, { id: 'note' })
    tx.createEntity('MTEXT', { text: '{\\fArial;甲\\P乙}', position: [0, 10, 0], height: 2, width: 40, attachmentPoint: 1 }, { id: 'mtext' })
    tx.createEntity('CIRCLE', { center: [50, 0, 0], radius: 3 }, { id: 'untouched' })
  })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
const args = (document, changes) => ({ expectedRevision: document.revision, units: 'millimeter', changes })

test('literal affixes preserve bytes, Unicode, explicit spaces and raw MTEXT without inferred separators', () => {
  assert.deepEqual(expandAgentTextAffixes({ changes: [
    { id: 'a', expectedText: '原标点。 English.', append: '复核版' },
    { id: 'b', expectedText: '{\\fArial;甲\\P乙}', prepend: '草稿：', append: ' 已核' },
    { id: 'c', expectedText: 'old', text: 'replacement' },
  ] }), [
    { id: 'a', expectedText: '原标点。 English.', text: '原标点。 English.复核版' },
    { id: 'b', expectedText: '{\\fArial;甲\\P乙}', text: '草稿：{\\fArial;甲\\P乙} 已核' },
    { id: 'c', expectedText: 'old', text: 'replacement' },
  ])
})

test('affixes reject ambiguous, unsafe, hidden and accessor data without reading getters', () => {
  const base = { id: 'a', expectedText: 'original' }
  for (const row of [
    base, { ...base, text: 'new', append: 'extra' }, { ...base, append: '' },
    { ...base, append: null }, { ...base, prepend: 1 }, { ...base, append: 'x'.repeat(16385) },
    { ...base, append: '\0' }, { ...base, append: '%<field>%' },
    { ...base, append: 'x', unknown: true },
    Object.defineProperty({ ...base }, 'append', { value: 'hidden', enumerable: false }),
  ]) assert.throws(() => expandAgentTextAffixes({ changes: [row] }))
  let reads = 0
  const accessor = Object.defineProperty({ ...base }, 'append', { enumerable: true, get() { reads++; return 'x' } })
  assert.throws(() => expandAgentTextAffixes({ changes: [accessor] }))
  assert.equal(reads, 0)
  assert.throws(() => expandAgentTextAffixes({ changes: [
    { id: 'a', expectedText: 'x'.repeat(16384), append: 'x' },
  ] }))
})

test('FULL affixes seal native TEXTEDIT preview, approval, unchanged objects, DXF reopen and exact undo/redo', async t => {
  const f = await fixture(t), before = content(f.document)
  const note = structuredClone(f.document.getObject('note')), mtext = structuredClone(f.document.getObject('mtext'))
  const untouched = structuredClone(f.document.getObject('untouched'))
  const input = args(f.document, [
    { id: 'note', expectedText: note.payload.text, append: '复核版' },
    { id: 'mtext', expectedText: mtext.payload.text, prepend: 'DRAFT: ', append: ' 已核' },
  ])
  const proposal = value(await f.session.call('cad_propose_text_edit', input))
  assert.equal(proposal.command, 'TEXTEDIT'); assert.equal(proposal.status, 'awaiting-host-approval')
  assert.deepEqual(content(f.document), before)
  assert.deepEqual(proposal.arguments.changes, [
    { id: 'note', expectedText: note.payload.text, text: note.payload.text + '复核版' },
    { id: 'mtext', expectedText: mtext.payload.text, text: 'DRAFT: ' + mtext.payload.text + ' 已核' },
  ])
  input.changes[0].append = 'caller mutation must not commit'
  assert.equal(value(await f.session.approve(proposal.planId, 'public-literal-reviewer')).status, 'committed')
  assert.deepEqual(f.document.getObject('note'), { ...note, payload: { ...note.payload, text: note.payload.text + '复核版' } })
  assert.deepEqual(f.document.getObject('mtext'), { ...mtext, payload: { ...mtext.payload, text: 'DRAFT: ' + mtext.payload.text + ' 已核' } })
  assert.deepEqual(f.document.getObject('untouched'), untouched)
  const after = content(f.document)
  await f.document.undo(); assert.deepEqual(content(f.document), before)
  await f.document.redo(); assert.deepEqual(content(f.document), after)
  const reopened = await f.sdk.readDocument(await f.sdk.writeDocument(f.document, { format: 'DXF' }), { format: 'DXF' })
  assert.equal(reopened.validate().valid, true)
  for (const expected of [f.document.getObject('note'), f.document.getObject('mtext')])
    assert.equal(reopened.listEntities().find(entity => entity.handle === expected.handle).payload.text, expected.payload.text)
})

test('stale text, locked targets and a late invalid row reject the entire native batch', async t => {
  const f = await fixture(t)
  for (const changes of [
    [{ id: 'note', expectedText: 'wrong original', append: 'x' }],
    [{ id: 'note', expectedText: f.document.getObject('note').payload.text, append: 'x' },
      { id: 'mtext', expectedText: 'wrong', prepend: 'y' }],
    [{ id: 'untouched', expectedText: '', append: 'x' }],
  ]) {
    const before = content(f.document), history = structuredClone(f.document.history)
    assert.equal((await f.session.call('cad_propose_text_edit', args(f.document, changes))).ok, false)
    assert.deepEqual(content(f.document), before); assert.deepEqual(f.document.history, history)
    assert.equal(f.sdk.agentPlans.list().length, 0)
  }
  await f.document.transact('Protect annotation', tx => tx.updateObject('note', { payload: { locked: true } }))
  assert.equal((await f.session.call('cad_propose_text_edit', args(f.document, [
    { id: 'note', expectedText: f.document.getObject('note').payload.text, append: 'x' },
  ]))).ok, false)
})

test('scalar-v1 remains byte-for-byte frozen and rejects FULL-only affixes', async t => {
  const f = await fixture(t), scalar = new KJAgentToolSession(f.sdk, f.document, { toolProfile: 'geology-scalars-v1' })
  assert.equal(createHash('sha256').update(canonicalStringify(scalar.definitions)).digest('hex'),
    '30326cf01cd7e970ca6073ddbe0cd7a665262adb1f8f39e51bb7af68883ffd2f')
  const before = content(f.document)
  assert.equal((await scalar.call('cad_propose_text_edit', args(f.document, [
    { id: 'note', expectedText: f.document.getObject('note').payload.text, append: 'x' },
  ]))).ok, false)
  assert.deepEqual(content(f.document), before)
})

test('unsupported rich MTEXT controls reject without stripping or rewriting the original format', async t => {
  const f = await fixture(t)
  await f.document.transact('Explicit unsupported color control', tx =>
    tx.updateObject('mtext', { payload: { text: '{\\C1;原文}' } }))
  const before = content(f.document)
  assert.equal((await f.session.call('cad_propose_text_edit', args(f.document, [
    { id: 'mtext', expectedText: '{\\C1;原文}', append: '补充' },
  ]))).ok, false)
  assert.deepEqual(content(f.document), before)
})
