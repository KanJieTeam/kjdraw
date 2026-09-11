import test from 'node:test'
import assert from 'node:assert/strict'
import { KJDocument } from '../src/document.js'
import { canonicalStringify } from '../src/utils.js'
import { createKJDrawSDK } from '../src/sdk.js'

async function fixture() {
  const document = KJDocument.create({ units: 'millimeter' })
  let block, paper
  await document.transact('Overlap and owner order', tx => {
    block = tx.upsertTableRecord('blockRecords', { name: 'Nested detail', payload: { basePoint: [0, 0, 0], entityIds: [] } }).id
    paper = tx.createLayout({ name: 'Sheet' }).payload.blockRecordId
    for (const [owner, prefix] of [[document.snapshot().spaces.modelSpaceId, 'model'], [block, 'block'], [paper, 'paper']]) {
      tx.createEntity('LINE', { start: [0, 0], end: [10, 0], color: 1 }, { id: prefix + '-z-first', ownerId: owner })
      tx.createEntity('CIRCLE', { center: [0, 0], radius: 10, color: 2 }, { id: prefix + '-a-second', ownerId: owner })
      tx.createEntity('LINE', { start: [0, 0], end: [10, 0], color: 3 }, { id: prefix + '-m-third', ownerId: owner })
    }
  })
  return { document, block, paper, model: document.snapshot().spaces.modelSpaceId }
}
const ids = (document, ownerId, options = {}) => document.listEntities({ ownerId, ...options }).map(entity => entity.id)

test('model, paper and nested block enumeration honors persisted order across canonical KJD without changing hashes', async () => {
  const { document, model, block, paper } = await fixture(), serialized = document.serialize(), fingerprint = document.fingerprint()
  for (const reopened of [KJDocument.open(serialized), KJDocument.open(JSON.parse(canonicalStringify(document.toJSON())))]) {
    for (const [owner, prefix] of [[model, 'model'], [block, 'block'], [paper, 'paper']]) {
      assert.deepEqual(ids(reopened, owner), [prefix + '-z-first', prefix + '-a-second', prefix + '-m-third'])
      assert.deepEqual(ids(reopened, owner, { type: 'LINE' }), [prefix + '-z-first', prefix + '-m-third'])
      assert.equal(reopened.listEntities({ ownerId: owner }), reopened.listEntities({ ownerId: owner }))
    }
    assert.equal(reopened.serialize(), serialized); assert.equal(reopened.fingerprint(), fingerprint)
  }
  const sdk = createKJDrawSDK()
  const reopened = await sdk.readDocument(serialized, { format: 'KJD' })
  assert.deepEqual(ids(reopened, model), ids(document, model))
})

test('explicit owner drawing order invalidates query caches and survives undo, redo, forks and authoritative canonicalization', async () => {
  const { document, model } = await fixture(), original = ids(document, model)
  const cached = document.listEntities({ ownerId: model }), originalFingerprint = document.fingerprint()
  await document.transact('Bring first to front', tx => tx.updateObject(model, { payload: { entityIds: ['model-a-second', 'model-m-third', 'model-z-first'] } }))
  const reordered = ['model-a-second', 'model-m-third', 'model-z-first']
  assert.deepEqual(ids(document, model), reordered); assert.notEqual(document.listEntities({ ownerId: model }), cached)
  assert.notEqual(document.fingerprint(), originalFingerprint, 'drawing order is fingerprinted as existing owner content')
  assert.deepEqual(ids(document.fork(), model), reordered)
  await document.undo(); assert.deepEqual(ids(document, model), original)
  await document.redo(); assert.deepEqual(ids(document, model), reordered)
  const source = document.serialize()
  document.bindAuthority({ serialize: () => source, commit: serialized => serialized, close() {} })
  assert.deepEqual(ids(document, model), reordered)
  await document.transact('Canonical authority round trip', tx => tx.updateObject('model-z-first', { payload: { color: 4 } }))
  assert.deepEqual(ids(document, model), reordered)
  document.unbindAuthority()
})

test('erase, restore and reparent preserve owner drawing order with filters and erased queries', async () => {
  const { document, model, block } = await fixture()
  await document.transact('Erase middle', tx => tx.eraseObject('model-a-second'))
  assert.deepEqual(ids(document, model), ['model-z-first', 'model-m-third'])
  assert.deepEqual(ids(document, model, { includeErased: true }), ['model-z-first', 'model-a-second', 'model-m-third'])
  await document.transact('Restore middle', tx => tx.restoreObject('model-a-second'))
  assert.deepEqual(ids(document, model), ['model-z-first', 'model-a-second', 'model-m-third'])
  await document.transact('Move owner', tx => tx.reparentObject('model-z-first', block))
  assert.deepEqual(ids(document, model), ['model-a-second', 'model-m-third'])
  assert.deepEqual(ids(document, block), ['block-z-first', 'block-a-second', 'block-m-third', 'model-z-first'])
  const reopened = KJDocument.open(document.serialize())
  assert.deepEqual(ids(reopened, model), ids(document, model)); assert.deepEqual(ids(reopened, block), ids(document, block))
  await document.undo(); assert.deepEqual(ids(document, model), ['model-z-first', 'model-a-second', 'model-m-third'])
})

test('legacy missing and duplicate membership entries neither drop entities nor duplicate them and remain read-only', async () => {
  const { document, model, block } = await fixture()
  for (const membership of [undefined, [], ['model-m-third'], ['model-m-third', 'model-m-third']]) {
    const state = document.toJSON()
    if (membership === undefined) delete state.objects[model].payload.entityIds
    else state.objects[model].payload.entityIds = membership
    const legacy = KJDocument.open(state), before = legacy.serialize(), hash = legacy.fingerprint()
    const expected = membership?.length ? ['model-m-third', 'model-z-first', 'model-a-second'] : ['model-z-first', 'model-a-second', 'model-m-third']
    assert.deepEqual(ids(legacy, model), expected)
    assert.deepEqual(ids(KJDocument.open(before), model), expected)
    assert.deepEqual(ids(legacy, block), ['block-z-first', 'block-a-second', 'block-m-third'])
    assert.equal(legacy.serialize(), before); assert.equal(legacy.fingerprint(), hash)
    assert.equal(legacy.validate().valid, true)
  }
})

