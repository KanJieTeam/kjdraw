import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Compound attributes', tx => {
    const block = tx.upsertTableRecord('blockRecords', { id: 'definition', name: 'ATTRIBUTED', type: 'BLOCK_RECORD', payload: { entityIds: [], isSpace: false, basePoint: [0, 0, 0] } })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [5, 0, 0] }, { ownerId: block.id, id: 'definition-line' })
    tx.createEntity('INSERT', { blockRecordId: block.id, position: [100, 200, 0], scale: [2, 2, 2], rotation: 0.2 }, { id: 'insert' })
    for (const [index, id] of ['attr-a', 'attr-b'].entries()) tx.createEntity('ATTRIB', {
      parentInsertId: 'insert', position: [105 + index, 206 + index, 0], alignmentPoint: [110 + index, 210 + index, 0], text: `Value ${index}`, tag: `TAG${index}`, height: 1.5,
      widthFactor: 0.8, generationFlags: index ? 2 : 1, horizontalAlignment: 1, verticalAlignment: 0, flags: index ? 9 : 0,
    }, { id })
    tx.createObject({ id: 'sequence', kind: 'custom', type: 'SEQEND', ownerId: 'insert', payload: { dxfOwnerMode: 'insert', layerId: tx._draft().tables.layers.currentId } })
    tx.updateObject('insert', { payload: { attributeIds: ['attr-a', 'attr-b'], sequenceEndId: 'sequence' } })
    tx.createEntity('TEXT', { position: [0, 0, 0], text: 'Outside', widthFactor: 0.7, generationFlags: 4, horizontalAlignment: 2, verticalAlignment: 3 }, { id: 'outside' })
  })
  return { sdk, document }
}
const persisted = value => JSON.parse(JSON.stringify(value))
const records = document => persisted(Object.fromEntries(document.listObjects({ includeErased: true }).map(object => [object.id, object])))
const near = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9, `${actual} != ${expected}`))

test('native ATTRIB links and single-line text parameters are first-class, stable through KJD', async () => {
  const { sdk, document } = await fixture()
  assert.equal(document.validate().valid, true)
  assert.equal(document.getObject('attr-a').payload.widthFactor, 0.8)
  assert.equal(document.getObject('attr-a').payload.generationFlags, 1)
  assert.equal(document.getObject('attr-b').payload.flags, 9)
  assert.equal(document.getObject('outside').payload.widthFactor, 0.7)
  assert.equal(document.getObject('outside').payload.verticalAlignment, 3)
  assert.equal(document.listEntities().some(entity => entity.type === 'SEQEND'), false)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(records(reopened), records(document))
})

test('MOVE duplicate parent/child selection transforms each once; rotate and scale preserve identities and undo', async () => {
  const { sdk, document } = await fixture(), original = records(document)
  await sdk.executeCommand('MOVE', { ids: ['insert', 'attr-a'], dx: 10, dy: -5 })
  near(document.getObject('attr-a').payload.position, [115, 201, 0])
  near(document.getObject('attr-a').payload.alignmentPoint, [120, 205, 0])
  near(document.getObject('insert').payload.position, [110, 195, 0])
  await sdk.executeCommand('ROTATE', { ids: ['insert'], angleDegrees: 90, center: [0, 0] })
  near(document.getObject('attr-a').payload.position, [-201, 115, 0])
  await sdk.executeCommand('SCALE', { ids: ['insert'], factor: 2, center: [0, 0] })
  near(document.getObject('attr-a').payload.position, [-402, 230, 0])
  assert.equal(document.getObject('attr-a').payload.height, 3)
  for (const id of ['insert', 'attr-a', 'attr-b', 'sequence']) assert.equal(document.getObject(id).handle, original[id].handle)
  assert.deepEqual(persisted(document.getObject('outside')), original.outside)
  const transformed = records(document)
  for (let i = 0; i < 3; i++) await sdk.executeCommand('UNDO')
  assert.deepEqual(records(document), original)
  for (let i = 0; i < 3; i++) await sdk.executeCommand('REDO')
  assert.deepEqual(records(document), transformed)
})

test('COPY duplicates the complete ordered sequence with new ids and handles and one undo', async () => {
  const { sdk, document } = await fixture(), original = records(document)
  const copied = await sdk.executeCommand('COPY', { ids: ['insert', 'attr-b'], dx: 25, dy: -10 })
  assert.equal(copied.length, 1)
  const insert = copied[0], children = insert.payload.attributeIds.map(id => document.getObject(id)), end = document.getObject(insert.payload.sequenceEndId)
  assert.equal(children.length, 2)
  for (const [i, attr] of children.entries()) {
    assert.equal(attr.payload.parentInsertId, insert.id)
    assert.equal(attr.payload.tag, `TAG${i}`)
    near(attr.payload.position, [130 + i, 196 + i, 0])
    assert.equal(attr.payload.widthFactor, 0.8)
  }
  assert.equal(end.ownerId, insert.id)
  assert.deepEqual(end.payload, document.getObject('sequence').payload)
  for (const item of [insert, ...children, end]) {
    assert.equal(Object.hasOwn(original, item.id), false)
    assert.equal(Object.values(original).some(old => old.handle === item.handle), false)
  }
  assert.equal(document.validate().valid, true)
  for (const [id, value] of Object.entries(original)) {
    if (value.kind !== 'block-record') assert.deepEqual(persisted(document.getObject(id)), value)
  }
  await sdk.executeCommand('UNDO')
  assert.deepEqual(records(document), original)
  await sdk.executeCommand('REDO')
  assert.equal(document.getObject(insert.id).payload.sequenceEndId, end.id)
})

test('erase, restore, purge and reparent operate on the entire sequence and preserve unrelated objects', async () => {
  const { sdk, document } = await fixture(), original = records(document)
  await sdk.executeCommand('ERASE', { ids: ['attr-a', 'insert', 'sequence'] })
  for (const id of ['insert', 'attr-a', 'attr-b', 'sequence']) assert.equal(document.snapshot().objects[id].erased, true)
  assert.equal(document.getObject('outside').erased, false)
  await sdk.executeCommand('RESTORE', { ids: ['sequence', 'attr-b', 'insert'] })
  assert.deepEqual(records(document), original)
  const destination = document.snapshot().spaces.paperSpaceIds[0]
  await document.transact('Compound attributes', tx => tx.reparentObject('insert', destination))
  for (const id of ['insert', 'attr-a', 'attr-b']) assert.equal(document.getObject(id).ownerId, destination)
  assert.equal(document.getObject('sequence').ownerId, 'insert')
  assert.equal(document.validate().valid, true)
  await sdk.executeCommand('UNDO')
  assert.deepEqual(records(document), original)
  await document.transact('Compound attributes', tx => tx.eraseObject('insert', { hard: true }))
  for (const id of ['insert', 'attr-a', 'attr-b', 'sequence']) assert.equal(document.getObject(id), null)
  assert.equal(document.getObject('outside').erased, false)
  await sdk.executeCommand('UNDO')
  assert.deepEqual(records(document), original)
})

test('one-sided, shared, cross-space, invalid SEQEND and dangling compound links reject atomically', async () => {
  for (const mutate of [
    tx => tx.updateObject('insert', { payload: { attributeIds: ['attr-a', 'attr-a'] } }),
    tx => tx.updateObject('insert', { payload: { attributeIds: ['attr-a'] } }),
    tx => tx.updateObject('insert', { payload: { attributeIds: ['outside', 'attr-b'] } }),
    tx => tx.updateObject('attr-a', { payload: { parentInsertId: null } }),
    tx => tx.updateObject('attr-a', { payload: { parentInsertId: 'outside' } }),
    tx => tx.updateObject('insert', { payload: { sequenceEndId: null } }),
    tx => tx.updateObject('sequence', { payload: { dxfOwnerMode: 'guess' } }),
    tx => tx.createEntity('INSERT', { blockRecordId: 'definition', attributeIds: ['attr-a'], sequenceEndId: 'sequence' }),
    tx => tx.reparentObject('attr-a', tx._draft().spaces.paperSpaceIds[0]),
    tx => tx.reparentObject('sequence', 'outside'),
    tx => tx.eraseObject('attr-a'),
    tx => tx.eraseObject('sequence', { hard: true }),
    tx => tx.updateObject('insert', { payload: { position: [0, 0, 0] } }),
  ]) {
    const { document } = await fixture(), before = document.serialize()
    await assert.rejects(document.transact('Compound attributes', tx => { tx.updateObject('outside', { payload: { text: 'must roll back' } }); mutate(tx) }))
    assert.equal(document.serialize(), before)
  }
})

test('protected attribute layers prevent parent edits and copies before partial changes commit', async () => {
  for (const [command, args] of [
    ['MOVE', { ids: ['outside', 'insert'], dx: 20 }], ['ERASE', { ids: ['outside', 'insert'] }],
    ['COPY', { ids: ['insert'], dx: 20 }], ['SCALE', { ids: ['insert'], factor: 2 }],
  ]) {
    const { sdk, document } = await fixture()
    await document.transact('Compound attributes', tx => {
      const layer = tx.upsertTableRecord('layers', { name: 'LOCKED-ATTRIBUTE', payload: { locked: true, visible: true } })
      tx.updateObject('attr-b', { payload: { layerId: layer.id } })
    })
    const before = document.serialize()
    await assert.rejects(sdk.executeCommand(command, args), /writable|locked/)
    assert.equal(document.serialize(), before)
  }
})

test('unsupported compound duplication explicitly rejects while standalone ATTRIB remains editable', async () => {
  const { sdk, document } = await fixture()
  for (const [command, args] of [
    ['ARRAYRECT', { ids: ['insert'], rows: 2, columns: 2, rowSpacing: 10, columnSpacing: 10 }],
    ['ARRAYPOLAR', { ids: ['insert'], count: 3, center: [0, 0] }],
    ['MIRROR', { ids: ['insert'], lineStart: [0, 0], lineEnd: [1, 0] }],
    ['COPY', { ids: ['attr-a'], dx: 1 }],
    ['COPY', { ids: ['insert'], dx: 1, payloadPatch: { position: [0, 0, 0] } }],
  ]) {
    const before = document.serialize()
    await assert.rejects(sdk.executeCommand(command, args), /attribute|Attributed/)
    assert.equal(document.serialize(), before)
  }
  const standalone = await sdk.executeCommand('CREATE', { type: 'ATTRIB', payload: { position: [1, 2, 0], text: 'Independent', tag: 'S' } })
  await sdk.executeCommand('MOVE', { ids: [standalone.id], dx: 3, dy: 4 })
  near(document.getObject(standalone.id).payload.position, [4, 6, 0])
  await sdk.executeCommand('ERASE', { ids: [standalone.id] })
  assert.equal(document.snapshot().objects[standalone.id].erased, true)
})
