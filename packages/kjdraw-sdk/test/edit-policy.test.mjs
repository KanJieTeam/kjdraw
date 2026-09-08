import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createKJDrawSDK } from '../src/index.js'

async function fixture(protection = { locked: true }) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Reference geometry' })
  const editable = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } })
  const protectedEntity = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [5, -5], end: [5, 5], layerId: layer.id } })
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: protection })
  return { sdk, document, layer, editable, protectedEntity, layer0: document.getTable('layers').currentId }
}

async function unchangedOnReject(document, work, reason) {
  const before = document.serialize(), history = document.history
  await assert.rejects(work(), error => error instanceof KJValidationError && error.details?.policy === 'layer-editability' && (!reason || error.details.reason === reason))
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
}

for (const [reason, protection] of [['locked', { locked: true }], ['frozen', { frozen: true }], ['hidden', { visible: false }]]) {
  test(`commands protect ${reason} layer entities and reject mixed batches atomically`, async () => {
    const { sdk, document, layer, editable, protectedEntity, layer0 } = await fixture(protection)
    const ids = [editable.id, protectedEntity.id]
    for (const [command, args] of [
      ['M', { ids, dx: 7, dy: 2 }],
      ['ROTATE', { ids, angleDegrees: 30 }],
      ['SCALE', { ids, factor: 2 }],
      ['DELETE', { ids }],
      ['GRIPEDIT', { id: protectedEntity.id, gripId: 'end', point: [9, 9] }],
      ['PROPERTIES', { id: protectedEntity.id, patch: { payload: { layerId: layer0 } } }],
      ['BREAK', { id: protectedEntity.id, point: [5, 0] }],
      ['COPY', { ids, dx: 20, dy: 0 }],
      ['ARRAYRECT', { ids, rows: 2, columns: 2, rowSpacing: 10, columnSpacing: 10 }],
      ['BLOCKCREATE', { ids, name: 'Mixed selection' }],
    ]) await unchangedOnReject(document, () => sdk.executeCommand(command, args), reason)
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false, frozen: false, visible: true } })
    const beforeMove = document.getObject(protectedEntity.id).payload.start
    await sdk.executeCommand('MOVE', { ids, dx: 7, dy: 2 })
    assert.deepEqual(document.getObject(protectedEntity.id).payload.start, [beforeMove[0] + 7, beforeMove[1] + 2, beforeMove[2]])
    await sdk.executeCommand('UNDO')
    assert.deepEqual(document.getObject(protectedEntity.id).payload.start, beforeMove)
    await sdk.executeCommand('REDO')
    assert.deepEqual(document.getObject(protectedEntity.id).payload.start, [beforeMove[0] + 7, beforeMove[1] + 2, beforeMove[2]])
  })

  test(`creation and reassignment into a ${reason} layer are blocked, including current and newly created batch layers`, async () => {
    const { sdk, document, layer, editable } = await fixture(protection)
    await unchangedOnReject(document, () => sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [1, 1], layerId: layer.id } }), reason)
    await unchangedOnReject(document, () => sdk.executeCommand('PROPERTIES', { id: editable.id, patch: { payload: { layerId: layer.id } } }), reason)
    await unchangedOnReject(document, () => sdk.executeCommand('CREATEBATCH', { entities: [
      { type: 'POINT', payload: { position: [1, 1] } },
      { type: 'POINT', layerName: layer.name, payload: { position: [2, 2] } },
    ] }), reason)
    await unchangedOnReject(document, () => sdk.executeCommand('CREATEBATCH', { entities: [
      { type: 'POINT', layerName: 'Writable new layer', payload: { position: [1, 1] } },
      { type: 'POINT', layerName: 'Protected new layer', layer: protection, payload: { position: [2, 2] } },
    ] }), reason)
    assert.equal(document.getTable('layers').records.some(value => value.name === 'Writable new layer'), false)
    await sdk.executeCommand('LAYERCURRENT', { id: layer.id })
    await unchangedOnReject(document, () => sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [1, 1] } }), reason)
  })
}

test('locked geometry remains available for inspection, measurement, boundaries and copies to writable layers', async () => {
  const { sdk, document, editable, protectedEntity, layer0 } = await fixture()
  await sdk.executeCommand('SELECT', { ids: [protectedEntity.id] })
  assert.deepEqual(sdk.activeSelection.ids, [protectedEntity.id])
  assert.equal((await sdk.executeCommand('LENGTH', { id: protectedEntity.id }))[0].value, 10)
  const source = document.getObject(protectedEntity.id)
  await sdk.executeCommand('TRIM', { id: editable.id, boundaryIds: [protectedEntity.id], pickPoint: [9, 0] })
  assert.deepEqual(document.getObject(editable.id).payload.end, [5, 0, 0])
  const copies = await sdk.executeCommand('COPY', { id: protectedEntity.id, dx: 20, dy: 0, payloadPatch: { layerId: layer0 } })
  assert.equal(copies[0].payload.layerId, layer0)
  assert.deepEqual(document.getObject(protectedEntity.id), source)
})

test('restore on a protected layer is blocked until layer management makes it writable', async () => {
  const { sdk, document, layer, protectedEntity } = await fixture({})
  await sdk.executeCommand('ERASE', { id: protectedEntity.id })
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  await unchangedOnReject(document, () => sdk.executeCommand('RESTORE', { id: protectedEntity.id }), 'locked')
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false } })
  await sdk.executeCommand('RESTORE', { id: protectedEntity.id })
  assert.ok(document.getObject(protectedEntity.id))
})

test('transactional extension commands share protection, including low-level entity mutators', async () => {
  const { sdk, document, protectedEntity } = await fixture()
  for (const [method, args] of [
    ['updateObject', [protectedEntity.id, { name: 'Edited' }]],
    ['eraseObject', [protectedEntity.id, { hard: true }]],
    ['restoreObject', [protectedEntity.id]],
    ['reparentObject', [protectedEntity.id, document.snapshot().spaces.paperSpaceId]],
    ['setXData', [protectedEntity.id, 'PLUGIN', [1, 2]]],
    ['putOpaquePayload', [protectedEntity.id, { extra: 1 }]],
  ]) {
    const dispose = sdk.commands.register({ id: 'EXTENSION_WRITE', execute: ({ transaction }) => transaction[method](...args) })
    await unchangedOnReject(document, () => sdk.executeCommand('EXTENSION_WRITE'), 'locked')
    dispose()
  }
  sdk.commands.register({ id: 'CATCH_WRITE', execute: ({ transaction }) => {
    transaction.createEntity('POINT', { position: [99, 99] })
    try { transaction.eraseObject(protectedEntity.id) } catch { /* The whole command must still fail. */ }
  } })
  await unchangedOnReject(document, () => sdk.executeCommand('CATCH_WRITE'), 'locked')
})

test('createObject and destination patch variants cannot bypass layer protection', async () => {
  const { sdk, document, layer, editable } = await fixture()
  sdk.commands.register({ id: 'PLUGIN_CREATE', execute: ({ transaction }) => transaction.createObject({
    kind: 'entity', type: 'POINT', ownerId: document.snapshot().spaces.modelSpaceId, payload: { position: [1, 2], layerId: layer.id },
  }) })
  await unchangedOnReject(document, () => sdk.executeCommand('PLUGIN_CREATE'), 'locked')
  await unchangedOnReject(document, () => sdk.executeCommand('OFFSET', { id: editable.id, distance: 2, payloadPatch: { layerId: layer.id } }), 'locked')
  await unchangedOnReject(document, () => sdk.executeCommand('COPY', { id: editable.id, dx: 1, dy: 0, payloadPatch: { layerId: layer.id } }), 'locked')
})

test('raw document transactions can reconstruct protected imported drawings without weakening command editing', async () => {
  const { sdk, document, layer } = await fixture()
  const imported = await document.transact('Import protected geometry', transaction => transaction.createEntity('POINT', { position: [1, 2], layerId: layer.id }))
  assert.equal(imported.payload.layerId, layer.id)
  await unchangedOnReject(document, () => sdk.executeCommand('MOVE', { id: imported.id, dx: 2, dy: 0 }), 'locked')
})
