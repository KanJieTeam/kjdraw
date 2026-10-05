import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK, findDrawingText, KJAgentToolSession } from '../src/index.js'

async function drawing() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Imported-style annotations', tx => {
    for (let i = 0; i < 75; i++) tx.createEntity('TEXT', {
      text: 'Depth ' + i, position: [i * 3, 0, 0], height: 2,
    }, { id: 'distractor-' + i })
    tx.createEntity('TEXT', { text: 'ZK03', position: [0, 50, 0], height: 2 }, { id: 'hole-a' })
    tx.createEntity('TEXT', { text: 'ZK03', position: [100, 50, 0], height: 2 }, { id: 'hole-b' })
    tx.createEntity('MTEXT', { text: '{\\H1.2x;粉质黏土}\\P层底 5.20', position: [10, 40, 0], height: 2, width: 25 }, { id: 'stratum' })
    tx.createEntity('MTEXT', { text: '粉质黏土\\P层底 5.20', position: [10, 20, 0], height: 2, width: 25 }, { id: 'plain-stratum' })
    tx.createEntity('LINE', { start: [0, 30], end: [100, 30] }, { id: 'boundary' })
  })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}

test('literal text search finds late objects, retains duplicate targets and complete native formatting', async () => {
  const { document, session } = await drawing()
  const revision = document.revision
  const first = await session.call('cad_find_text', { expectedRevision: revision, search: 'zk03', match: 'exact', limit: 1 })
  assert.equal(first.ok, true)
  assert.equal(first.value.totalMatches, 2)
  assert.equal(first.value.nextOffset, 1)
  assert.equal(first.value.matches[0].id, 'hole-a')
  assert.ok(first.value.matches[0].bounds)
  const second = findDrawingText(document, { expectedRevision: revision, search: 'zk03', match: 'exact', offset: 1, limit: 1 })
  assert.equal(second.matches[0].id, 'hole-b')
  assert.equal(second.nextOffset, null)
  assert.equal(findDrawingText(document, { expectedRevision: revision, search: 'zk03', caseSensitive: true }).totalMatches, 0)
  const layer = findDrawingText(document, { expectedRevision: revision, search: '粉质黏土' })
  assert.equal(layer.matches.find(match => match.id === 'stratum').text, '{\\H1.2x;粉质黏土}\\P层底 5.20')
  assert.equal(layer.matches.find(match => match.id === 'stratum').textEditCandidate, false)
  assert.match(layer.note, /untrusted/)
  assert.equal(document.revision, revision)
  assert.equal(findDrawingText(document, { expectedRevision: revision, search: 'ZK.*' }).totalMatches, 0)
})

test('search plus exact text proposal changes only the reviewed label and preserves geometry', async () => {
  const { document, session } = await drawing()
  const revision = document.revision
  const before = document.listEntities()
  const match = findDrawingText(document, { expectedRevision: revision, search: '粉质黏土' }).matches[0]
  const proposal = await session.call('cad_propose_text_edit', {
    expectedRevision: revision, units: 'millimeter',
    changes: [{ id: match.id, expectedText: match.text, text: match.text.replace('粉质黏土', '黏土') }],
  })
  assert.equal(proposal.ok, true, JSON.stringify(proposal.error))
  assert.equal(document.getObject(match.id).payload.text, match.text)
  assert.equal((await session.approve(proposal.value.planId, 'fixture-reviewer')).ok, true)
  assert.equal(document.getObject(match.id).payload.text, '黏土\\P层底 5.20')
  for (const entity of before.filter(entity => entity.id !== match.id)) assert.deepEqual(document.getObject(entity.id), entity)
  const stale = await session.call('cad_find_text', { expectedRevision: revision, search: '黏土' })
  assert.equal(stale.ok, false)
  assert.equal(await document.undo(), true)
  assert.equal(document.getObject(match.id).payload.text, match.text)
  assert.equal(await document.redo(), true)
  assert.equal(document.getObject(match.id).payload.text, '黏土\\P层底 5.20')
})

test('search distinguishes protected layers and fails without truncating oversized matches', async () => {
  const { document } = await drawing()
  await document.transact('Layer visibility', tx => {
    const hidden = tx.upsertTableRecord('layers', { name: 'HIDDEN', payload: { visible: false } })
    const locked = tx.upsertTableRecord('layers', { name: 'LOCKED', payload: { locked: true } })
    tx.createEntity('TEXT', { text: 'Hidden ZK', position: [0, 0], height: 2, layerId: hidden.id }, { id: 'hidden-text' })
    tx.createEntity('TEXT', { text: 'Locked ZK', position: [0, 0], height: 2, layerId: locked.id }, { id: 'locked-text' })
    tx.createEntity('TEXT', { text: 'Long ' + 'x'.repeat(3000), position: [0, 0], height: 2 }, { id: 'long-text' })
  })
  const expectedRevision = document.revision
  assert.equal(findDrawingText(document, { expectedRevision, search: 'Hidden' }).totalMatches, 0)
  assert.equal(findDrawingText(document, { expectedRevision, search: 'Hidden', includeHidden: true }).matches[0].textEditCandidate, false)
  assert.equal(findDrawingText(document, { expectedRevision, search: 'Locked' }).matches[0].textEditCandidate, false)
  assert.throws(() => findDrawingText(document, { expectedRevision, search: 'Long', maxBytes: 1024 }), /Complete text/)
  assert.equal(findDrawingText(document, { expectedRevision, search: 'Long', maxBytes: 8192 }).matches[0].text.length, 3005)
  assert.throws(() => findDrawingText(document, { expectedRevision, search: ' ' }), /literal/)
})

test('search isolates model, paper and block coordinates and excludes invisible or erased text', async () => {
  const { document } = await drawing()
  let blockId
  await document.transact('Owner-space fixture', tx => {
    blockId = tx.upsertTableRecord('blockRecords', { name: 'NATIVE_LABELS', payload: { entityIds: [] } }).id
    tx.createEntity('TEXT', { text: 'ZK03', position: [1, 2], height: 2 }, { id: 'block-label', ownerId: blockId })
    tx.createEntity('TEXT', { text: 'ZK03', position: [5, 6], height: 2 }, {
      id: 'paper-label', ownerId: document.spaces.paperSpaceIds[0],
    })
    tx.createEntity('ATTDEF', { text: 'PRIVATE LABEL', tag: 'PRIVATE', flags: 1, position: [7, 8], height: 2 }, {
      id: 'invisible-definition', ownerId: blockId,
    })
    const erased = tx.createEntity('TEXT', { text: 'ZK03', position: [9, 10], height: 2 }, { id: 'erased-label' })
    tx.eraseObject(erased.id)
  })
  const expectedRevision = document.revision
  const query = { expectedRevision, search: 'ZK03', match: 'exact' }
  assert.equal(findDrawingText(document, query).totalMatches, 2)
  const block = findDrawingText(document, { ...query, spaceId: blockId })
  assert.deepEqual(block.matches.map(match => match.id), ['block-label'])
  assert.deepEqual(block.matches[0].position, [1, 2, 0])
  assert.equal(block.matches[0].textEditCandidate, false)
  const paper = findDrawingText(document, { ...query, spaceId: document.spaces.paperSpaceIds[0] })
  assert.deepEqual(paper.matches.map(match => match.id), ['paper-label'])
  assert.equal(paper.matches[0].textEditCandidate, false)
  assert.equal(findDrawingText(document, { expectedRevision, search: 'PRIVATE', spaceId: blockId }).totalMatches, 0)
  const hidden = findDrawingText(document, { expectedRevision, search: 'PRIVATE', spaceId: blockId, includeHidden: true })
  assert.equal(hidden.matches[0].visible, false)
  assert.equal(hidden.matches[0].textEditCandidate, false)
  assert.throws(() => findDrawingText(document, { ...query, spaceId: 'not-a-space' }))
  assert.throws(() => { block.matches[0].position.push(3) }, TypeError)
})
