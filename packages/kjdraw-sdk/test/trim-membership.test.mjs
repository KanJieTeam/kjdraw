import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, KJDocument } from '../src/index.js'

const allRecords = drawing => Object.fromEntries(drawing.listObjects({ includeErased: true }).map(record => [record.id, record]))

async function fixture(type = 'CIRCLE') {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument()
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Members' })
  const create = (type, payload) => sdk.executeCommand('CREATE', { type, payload })
  const payload = type === 'LINE' ? { start: [0, 0, 6], end: [100, 0, 6] }
    : { center: [0, 0, 6], radius: 10, ...(type === 'ARC' ? { startAngle: 0, endAngle: Math.PI } : {}) }
  const target = await create(type, { ...payload, layerId: layer.id, color: 2 })
  const before = await create('POINT', { position: [-25, -25, 6] })
  const after = await create('POINT', { position: [125, 25, 6] })
  const cutters = []
  if (type === 'CIRCLE') cutters.push(await create('LINE', { start: [-15, 0, 6], end: [15, 0, 6] }))
  else for (const x of type === 'LINE' ? [30, 70] : [-5, 5]) cutters.push(await create('LINE', { start: [x, -15, 6], end: [x, 15, 6] }))
  const group = await sdk.executeCommand('GROUP', { name: 'Assembly', ids: [before.id, target.id, after.id] })
  const secondGroup = await sdk.executeCommand('GROUP', { name: 'Only profile', ids: [target.id] })
  sdk.activeSelection.replace([after.id, target.id, before.id])
  const saved = await sdk.getSelectionManager().saveNamed('Saved profile', { description: 'keep description' })
  const unrelated = await sdk.executeCommand('GROUP', { name: 'Other objects', ids: [after.id, before.id] })
  const ignored = await drawing.transact('Ignored records', transaction => {
    const erased = transaction.createObject({ kind: 'group', type: 'GROUP', name: 'Erased group', payload: { memberIds: [target.id] } })
    transaction.eraseObject(erased.id)
    const custom = transaction.createObject({ kind: 'group', type: 'CUSTOM_GROUP', name: 'Custom references', payload: { memberIds: [target.id] } })
    transaction.updateObject(before.id, { payload: { linkedId: target.id } })
    return [erased.id, custom.id]
  })
  return { sdk, drawing, target, before, after, layer, cutters, group, secondGroup, saved, unrelated, ignored,
    trim: { id: target.id, boundaryIds: cutters.map(cutter => cutter.id), pickPoint: type === 'LINE' ? [50, 0] : [0, 10] } }
}

test('TRIM CIRCLE transfers GROUP and saved-selection memberships to the derived ARC in the same revision', async () => {
  const { sdk, drawing, target, before, after, group, secondGroup, saved, unrelated, ignored, trim } = await fixture()
  const previous = allRecords(drawing), revision = drawing.revision
  const result = await sdk.executeCommand('TRIM', trim)
  assert.notEqual(result.id, target.id)
  assert.equal(result.type, 'ARC')
  assert.equal(drawing.revision, revision + 1)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [before.id, result.id, after.id])
  assert.deepEqual(drawing.getObject(secondGroup.id).payload.memberIds, [result.id])
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, [after.id, result.id, before.id])
  assert.equal(drawing.getObject(saved.id).payload.description, 'keep description')
  assert.deepEqual(drawing.getObject(unrelated.id), unrelated)
  for (const id of ignored) assert.deepEqual(drawing.getObject(id, { includeErased: true }), previous[id])
  assert.equal(drawing.getObject(before.id).payload.linkedId, target.id, 'unrelated references are not rewritten')
  const current = allRecords(drawing)
  sdk.getSelectionManager().loadNamed('Saved profile')
  assert.deepEqual(sdk.activeSelection.ids, [after.id, result.id, before.id])
  const reopened = KJDocument.open(drawing.serialize())
  assert.deepEqual(allRecords(reopened), current)
  const reopenedSdk = createKJDrawSDK()
  reopenedSdk.attachDocument(reopened)
  reopenedSdk.getSelectionManager().loadNamed('Saved profile')
  assert.deepEqual(reopenedSdk.activeSelection.ids, [after.id, result.id, before.id])
  await sdk.executeCommand('UNDO')
  assert.deepEqual(allRecords(drawing), previous)
  sdk.getSelectionManager().loadNamed('Saved profile')
  assert.deepEqual(sdk.activeSelection.ids, [after.id, target.id, before.id])
  await sdk.executeCommand('REDO')
  assert.deepEqual(allRecords(drawing), current)
})

for (const type of ['LINE', 'ARC']) test(`TRIM ${type} replaces the original member in place with both retained pieces in source order`, async () => {
  const { sdk, drawing, target, before, after, group, secondGroup, saved, trim } = await fixture(type)
  const previous = allRecords(drawing), revision = drawing.revision
  const primary = await sdk.executeCommand('TRIM', trim)
  const extra = drawing.listEntities({ type }).find(entity => entity.id !== target.id && entity.source?.derivedFromId === target.id)
  assert.ok(extra)
  assert.equal(primary.id, target.id)
  assert.equal(drawing.revision, revision + 1)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [before.id, primary.id, extra.id, after.id])
  assert.deepEqual(drawing.getObject(secondGroup.id).payload.memberIds, [primary.id, extra.id])
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, [after.id, primary.id, extra.id, before.id])
  const current = allRecords(drawing)
  assert.deepEqual(allRecords(KJDocument.open(drawing.serialize())), current)
  await sdk.executeCommand('UNDO'); assert.deepEqual(allRecords(drawing), previous)
  await sdk.executeCommand('REDO'); assert.deepEqual(allRecords(drawing), current)
})

test('TRIM membership replacement is stably deduplicated at the first old member position', async () => {
  const { sdk, drawing, target, before, after, group, saved, trim } = await fixture('LINE')
  await drawing.transact('Legacy duplicate group members', transaction => {
    transaction.updateObject(group.id, { payload: { memberIds: [before.id, target.id, after.id, target.id, before.id] } })
    transaction.updateObject(saved.id, { payload: { memberIds: [target.id, before.id, target.id, after.id] } })
  })
  const previous = allRecords(drawing)
  const primary = await sdk.executeCommand('TRIM', trim)
  const extra = drawing.listEntities({ type: 'LINE' }).find(entity => entity.source?.derivedFromId === target.id)
  assert.ok(extra)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [before.id, primary.id, extra.id, after.id])
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, [primary.id, extra.id, before.id, after.id])
  await sdk.executeCommand('UNDO')
  assert.deepEqual(allRecords(drawing), previous, 'Undo restores the exact original membership, including duplicates')
})

test('protected target layers reject TRIM before any persistent group or saved-selection change', async () => {
  const { sdk, drawing, layer, trim } = await fixture()
  for (const protection of [{ locked: true }, { frozen: true }, { visible: false }]) {
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false, frozen: false, visible: true, ...protection } })
    const previous = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(sdk.executeCommand('TRIM', trim), error => error.details?.policy === 'layer-editability')
    assert.equal(drawing.serialize(), previous)
    assert.deepEqual(drawing.history, history)
    assert.equal(drawing.revision, revision)
  }
})

test('single-piece LINE end trimming keeps persistent memberships unchanged', async () => {
  const { sdk, drawing, group, saved, target, trim } = await fixture('LINE')
  const previousGroup = drawing.getObject(group.id), previousSaved = drawing.getObject(saved.id)
  const primary = await sdk.executeCommand('TRIM', { ...trim, pickPoint: [10, 0] })
  assert.equal(primary.id, target.id)
  assert.deepEqual(drawing.getObject(group.id), previousGroup)
  assert.deepEqual(drawing.getObject(saved.id), previousSaved)
})
