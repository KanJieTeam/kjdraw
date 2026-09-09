import test from 'node:test'
import assert from 'node:assert/strict'
import { createDXFFileAdapter } from '../src/dxf-adapter.js'
import { KJDocument } from '../src/document.js'

function source(handles) {
  return ['0','SECTION','2','HEADER','9','$ACADVER','1','AC1032','0','ENDSEC',
    '0','SECTION','2','ENTITIES',
    ...handles.flatMap((handle, i) => ['0','LINE', ...(handle ? ['5', handle] : []),
      '8','0','10',String(i),'20','0','11',String(i + 1),'21','1']),
    '0','ENDSEC','0','EOF',''].join('\n')
}

test('DXF handle indexing tracks generated handles and repeated source handles', async () => {
  const adapter = createDXFFileAdapter()
  const doc = await adapter.read(source(['100', '100', '', '101', '100', '103', '1']))
  const entities = doc.listEntities()
  assert.equal(entities.length, 7)
  assert.ok(entities.every(e => e.type === 'LINE'))
  assert.equal(entities[0].handle, '100')
  assert.equal(new Set(entities.map(e => e.handle)).size, 7)
  assert.deepEqual(entities.map(e => e.payload.start), Array.from({ length: 7 }, (_, i) => [i, 0, 0]))
  const reopened = await adapter.read(adapter.write(doc, { version: '2018' }))
  assert.deepEqual(reopened.listEntities().map(e => e.handle), entities.map(e => e.handle))
})

test('bulk import preserves mixed explicit, missing and duplicate handles', async () => {
  const handles = Array.from({ length: 2048 }, (_, i) => i % 3 === 0 ? '' : (0x1000 + Math.floor(i / 2)).toString(16))
  const doc = await createDXFFileAdapter().read(source(handles))
  const entities = doc.listEntities()
  assert.equal(entities.length, handles.length)
  assert.ok(entities.every(e => e.type === 'LINE'))
  assert.equal(new Set(entities.map(e => e.handle)).size, handles.length)
  assert.deepEqual(entities.at(-1).payload.end, [2048, 1, 0])
})

test('transaction handle index preserves duplicate, purge and rollback semantics', async () => {
  const doc = KJDocument.create()
  let retained
  await doc.transact('indexed handles', tx => {
    const first = tx.createEntity('LINE', { start: [0, 0], end: [1, 1] }, { handle: '100' })
    assert.throws(() => tx.createEntity('POINT', { position: [0, 0] }, { handle: '100' }), /Duplicate handle/)
    const generated = tx.createEntity('POINT', { position: [0, 0] })
    assert.throws(() => tx.createEntity('POINT', { position: [0, 0] }, { handle: generated.handle }), /Duplicate handle/)
    tx.eraseObject(first.id, { hard: true })
    retained = tx.createEntity('POINT', { position: [2, 3] }, { handle: '100' })
    tx.eraseObject(retained.id)
    assert.throws(() => tx.createEntity('POINT', { position: [0, 0] }, { handle: '100' }), /Duplicate handle/)
    tx.restoreObject(retained.id)
  })
  const before = doc.serialize()
  await assert.rejects(doc.transact('rollback index', tx => {
    tx.eraseObject(retained.id, { hard: true })
    tx.createEntity('POINT', { position: [4, 5] }, { handle: '100' })
    throw new Error('abort')
  }), error => error.cause?.message === 'abort')
  assert.equal(doc.serialize(), before)
  await assert.rejects(doc.transact('fresh index', tx => tx.createEntity('POINT', { position: [0, 0] }, { handle: '100' })), error => /Duplicate handle/.test(error.message) || /Duplicate handle/.test(error.cause?.message ?? ''))
})
