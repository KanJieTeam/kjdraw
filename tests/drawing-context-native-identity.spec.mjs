import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { createDrawingContext } from '../packages/kjdraw-sdk/src/drawing-context.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'

test('native drawing query exposes the actual handle and owner-local coordinates without aliases or mutation', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  try {
    await document.transact('Synthetic native identity', tx => {
      tx.createEntity('LINE', { start: [12, 34, 0], end: [56, 78, 0] }, { id: 'identity-line' })
      tx.createEntity('LINE', { start: [1, 2, 0], end: [3, 4, 0] }, { id: 'paper-line', ownerId: document.spaces.paperSpaceIds[0] })
    })
    const fingerprint = document.fingerprint(), revision = document.revision
    for (const id of ['identity-line', 'paper-line']) {
      const entity = document.getObject(id)
      const page = createDrawingContext(document, { ids: [id], spaceId: entity.ownerId, expectedRevision: revision })
      assert.equal(page.entities.length, 1)
      const row = page.entities[0]
      assert.equal(row.id, entity.id)
      assert.equal(row.handle, entity.handle)
      assert.notEqual(row.handle, row.id)
      assert.equal(row.ownerId, entity.ownerId)
      assert.equal(row.coordinateSpace, 'owner-local')
      assert.deepEqual(row.geometry.start, entity.payload.start)
      assert.deepEqual(row.geometry.end, entity.payload.end)
      assert.ok(Object.isFrozen(row))
    }
    const session = new KJAgentToolSession(sdk, document)
    const result = await session.call('cad_query_drawing', { expectedRevision: revision, filters: { ids: ['identity-line'] },
      offset: 0, layerOffset: 0, limit: 200, maxLayers: 100, maxBytes: 262144 })
    assert.equal(result.ok, true)
    assert.equal(result.value.entities[0].handle, document.getObject('identity-line').handle)
    assert.equal(result.value.entities[0].coordinateSpace, 'owner-local')
    assert.equal(document.fingerprint(), fingerprint)
    assert.equal(document.revision, revision)
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})

test('DXF reopen retains handles in bounded query receipts without claiming UUID stability', async () => {
  const sdk = createKJDrawSDK(), original = sdk.createDocument({ units: 'millimeter' })
  try {
    await original.transact('Synthetic line', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [20, 0, 0] }, { id: 'before-dxf' }))
    const before = original.getObject('before-dxf')
    const reopened = await sdk.readDocument(await sdk.writeDocument(original, { format: 'DXF' }), { format: 'DXF' })
    const page = createDrawingContext(reopened, { expectedRevision: reopened.revision, maxBytes: 1024, maxLayers: 0 })
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024)
    assert.equal(page.entities.length, 1)
    assert.equal(page.entities[0].handle, before.handle)
    assert.equal(page.entities[0].coordinateSpace, 'owner-local')
    assert.equal(page.entities[0].id, reopened.listEntities()[0].id)
    assert.notEqual(page.entities[0].id, before.id)
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})
