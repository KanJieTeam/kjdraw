import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJValidationError, createKJDrawSDK } from '../src/index.js'

test('standard entity contracts normalize coordinates, preserve degenerate DXF lines and reject invalid geometry atomically', async () => {
  const document = KJDocument.create({ documentId: 'contracts' })
  const line = await document.transact('Canonical line', transaction => transaction.createEntity('line', { start: [0, 0], end: [4, 3] }))
  assert.deepEqual(line.payload.start, [0, 0, 0])
  assert.deepEqual(line.payload.end, [4, 3, 0])
  assert.equal(line.payload.contractVersion, 1)
  const before = document.serialize()
  await assert.rejects(document.transact('Invalid circle', transaction => {
    transaction.createEntity('POINT', { position: [5, 5] })
    transaction.createEntity('CIRCLE', { center: [0, 0], radius: -1 })
  }), KJValidationError)
  assert.equal(document.serialize(), before)
  await document.transact('Collapse imported line', transaction => transaction.updateObject(line.id, { payload: { end: [0, 0, 0] } }))
  assert.deepEqual(document.getObject(line.id).payload.end, [0, 0, 0])
  assert.equal(document.getObject(line.id).payload.degenerate, true)
  const generic = await document.transact('Generic plugin create', transaction => transaction.createObject({ kind: 'entity', type: 'POINT', ownerId: document.snapshot().spaces.modelSpaceId, payload: { position: [8, 9] } }))
  assert.equal(generic.payload.contractVersion, 1)
  assert.deepEqual(generic.payload.position, [8, 9, 0])
  assert.equal(generic.payload.layerId, document.snapshot().tables.layers.currentId)
})

test('solid, trace, table and proxy contracts remain canonical and editable', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'extended-contracts' })
  const solid = await sdk.executeCommand('CREATE', { type: 'SOLID', payload: { vertices: [[0, 0], [4, 0], [0, 3]] } })
  const table = await sdk.executeCommand('CREATE', { type: 'TABLE', payload: { position: [10, 20], rows: 2, columns: 2, cells: [[{ text: '孔号' }, { text: '标高' }], [{ text: 'ZK1' }, { text: '12.3' }]] } })
  const proxy = await sdk.executeCommand('CREATE', { type: 'PROXY_ENTITY', payload: { originalType: 'ACME_FUTURE', rawTags: [{ code: 1, value: 'opaque' }] } })
  assert.equal(solid.payload.contractVersion, 1)
  assert.equal((await sdk.executeCommand('AREA', { id: solid.id }))[0].value, 6)
  assert.equal(table.payload.cells[1][0].text, 'ZK1')
  await sdk.executeCommand('GRIPEDIT', { id: table.id, gripId: 'position', point: [30, 40] })
  assert.deepEqual(document.getObject(table.id).payload.position, [30, 40, 0])
  assert.equal(proxy.payload.originalType, 'ACME_FUTURE')
  assert.equal(document.validate().valid, true)
})

test('opening an early v1 document upgrades unversioned standard payloads before validation', () => {
  const original = KJDocument.create({ documentId: 'early-v1' }).toJSON()
  const id = 'legacy-point', handle = original.header.handseed
  original.header.handseed = (BigInt(`0x${handle}`) + 1n).toString(16).toUpperCase()
  original.objects[id] = { id, handle, kind: 'entity', type: 'POINT', ownerId: original.spaces.modelSpaceId, name: null, payload: { position: [1, 2] }, extension: { xdata: {}, xrecordIds: [], reactorIds: [], hyperlinks: [] }, erased: false, source: null }
  original.objects[original.spaces.modelSpaceId].payload.entityIds.push(id)
  const opened = KJDocument.open(original)
  assert.equal(opened.getObject(id).payload.contractVersion, 1)
  assert.deepEqual(opened.getObject(id).payload.position, [1, 2, 0])
})

test('unsafe legacy standard entities survive as proxy entities instead of guessed geometry', () => {
  const document = KJDocument.open({ id: 'legacy-proxy', entities: [{ id: 'bad-circle', type: 'circle', radius: 'unknown' }] })
  const proxy = document.getObject('bad-circle')
  assert.equal(proxy.type, 'PROXY_ENTITY')
  assert.equal(proxy.payload.originalType, 'CIRCLE')
  assert.match(proxy.payload.importError, /center|finite/i)
})

test('session selections are ordered, unique and automatically prune erased entities', async () => {
  const sdk = createKJDrawSDK()
  sdk.createDocument({ documentId: 'selection-session' })
  const first = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [1, 0] } })
  const second = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [2, 0], radius: 1 } })
  const selection = sdk.activeSelection
  selection.add([first.id, second.id, first.id])
  assert.deepEqual(selection.ids, [first.id, second.id])
  selection.toggle(first.id)
  assert.deepEqual(selection.ids, [second.id])
  await sdk.executeCommand('ERASE', { id: second.id })
  assert.equal(selection.size, 0)
})

test('named selection sets persist in the document dictionary and round-trip through KJD', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'selection-named' })
  const first = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [1, 2] } })
  const second = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [3, 4] } })
  sdk.activeSelection.replace([second.id, first.id])
  const saved = await sdk.getSelectionManager().saveNamed('Control points', { description: 'Survey control' })
  assert.equal(saved.kind, 'group')
  assert.deepEqual(saved.payload.memberIds, [second.id, first.id])
  const reopened = KJDocument.open(document.serialize())
  const reopenedSdk = createKJDrawSDK()
  reopenedSdk.attachDocument(reopened)
  reopenedSdk.getSelectionManager().loadNamed('control points')
  assert.deepEqual(reopenedSdk.activeSelection.ids, [second.id, first.id])
  assert.equal(await reopenedSdk.getSelectionManager().deleteNamed('Control points'), true)
  assert.equal(reopenedSdk.getSelectionManager().listNamed().length, 0)
  assert.equal(reopened.validate().valid, true)
})
