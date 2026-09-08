import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJValidationError, createKJDrawSDK, explodeEntity } from '../src/index.js'

test('EXPLODE preserves drawing properties, paper-space ownership and elevation without copying topology or identity', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'PROFILE', color: 3 })
  const linetype = await sdk.executeCommand('LINETYPE', { name: 'PROFILE-DASH', pattern: [2, -1] })
  const ownerId = document.snapshot().spaces.paperSpaceIds[0]
  const drawingProperties = {
    layerId: layer.id, color: 2, trueColor: 0x123456, linetypeId: linetype.id,
    linetypeName: 'PROFILE-DASH', linetypeScale: 1.5, lineweight: 35,
    transparency: 0.25, visible: true, thickness: 0.5, normal: [0, 0, 1], elevation: 6,
  }
  const source = await sdk.executeCommand('CREATE', {
    type: 'LWPOLYLINE', options: { ownerId, name: 'Original profile' },
    payload: { ...drawingProperties, id: 'not-an-entity-id', handle: 'not-a-handle', ownerId: 'not-an-owner', closed: false,
      vertices: [{ point: [-1, 0], bulge: 1 }, { point: [1, 0] }, { point: [3, 0] }] },
  })
  const snapshot = document.serialize(), revision = document.revision
  const preview = explodeEntity(source)
  assert.equal(document.serialize(), snapshot)
  const pieces = await sdk.executeCommand('EXPLODE', { id: source.id })
  assert.equal(document.revision, revision + 1)
  assert.deepEqual(pieces.map(piece => piece.type), ['ARC', 'LINE'])
  const reopened = KJDocument.open(document.serialize())
  for (const [index, piece] of pieces.entries()) {
    for (const [key, value] of Object.entries(drawingProperties)) {
      assert.deepEqual(piece.payload[key], value, `${piece.type}.${key}`)
      assert.deepEqual(preview[index].payload[key], value, `preview ${piece.type}.${key}`)
    }
    assert.equal(piece.ownerId, ownerId)
    assert.equal(piece.name, source.name)
    assert.notEqual(piece.id, source.id)
    assert.notEqual(piece.handle, source.handle)
    assert.deepEqual(reopened.getObject(piece.id).payload, piece.payload)
    assert.equal(reopened.getObject(piece.id).ownerId, ownerId)
    for (const key of ['id', 'handle', 'ownerId', 'vertices', 'closed']) assert.equal(Object.hasOwn(piece.payload, key), false, key)
  }
  assert.deepEqual(pieces[0].payload.center, [0, 0, 6])
  assert.deepEqual(pieces[1].payload.start, [1, 0, 6])
  assert.deepEqual(pieces[1].payload.end, [3, 0, 6])
  await sdk.executeCommand('UNDO')
  assert.deepEqual(document.getObject(source.id), source)
  assert.ok(pieces.every(piece => document.getObject(piece.id) === null))
  await sdk.executeCommand('REDO')
  assert.ok(pieces.every(piece => document.getObject(piece.id)?.handle === piece.handle))
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const fromDxf = await sdk.fileAdapters.read(dxf, { format: 'DXF', version: '2018' })
  const reopenedLayer = fromDxf.getTable('layers').records.find(item => item.name === 'PROFILE')
  const reopenedPieces = fromDxf.listEntities()
  assert.equal(reopenedPieces.length, 2)
  assert.ok(reopenedPieces.every(piece => piece.payload.layerId === reopenedLayer.id))
  assert.ok(reopenedPieces.every(piece => fromDxf.snapshot().spaces.paperSpaceIds.includes(piece.ownerId)))
  for (const piece of reopenedPieces) {
    for (const key of ['color', 'trueColor', 'linetypeName', 'linetypeScale', 'lineweight', 'visible', 'thickness', 'normal']) assert.deepEqual(piece.payload[key], drawingProperties[key], `DXF ${piece.type}.${key}`)
    assert.equal(fromDxf.getObject(piece.payload.linetypeId).name, 'PROFILE-DASH')
  }
  assert.deepEqual(reopenedPieces.find(piece => piece.type === 'ARC').payload.center, [0, 0, 6])
  assert.deepEqual(reopenedPieces.find(piece => piece.type === 'LINE').payload.start, [1, 0, 6])
})

test('EXPLODE preserves vertex Z and clockwise bulges without adding legacy elevation twice', async () => {
  for (const type of ['LWPOLYLINE', 'POLYLINE']) {
    for (const elevation of [0, 6]) {
      const sdk = createKJDrawSDK(), document = sdk.createDocument()
      const source = await sdk.executeCommand('CREATE', { type, payload: { elevation, closed: true,
        vertices: [{ point: [-1, 0, 6], bulge: -1 }, { point: [1, 0, 6] }, { point: [3, 0, 6] }] } })
      const pieces = await sdk.executeCommand('EXPLODE', { id: source.id })
      assert.deepEqual(pieces.map(piece => piece.type), ['ARC', 'LINE', 'LINE'])
      assert.equal(pieces[0].payload.clockwise, true)
      assert.equal(pieces[0].payload.center[2], 6)
      assert.ok(pieces.slice(1).every(piece => piece.payload.start[2] === 6 && piece.payload.end[2] === 6))
      assert.equal(document.validate().valid, true)
    }
  }
  const sdk = createKJDrawSDK(); sdk.createDocument()
  const source = await sdk.executeCommand('CREATE', { type: 'POLYLINE', payload: { dxfFlags: 8, elevation: 12,
    vertices: [[0, 0, 0], [2, 0, 3], [4, 0, 7]] } })
  const pieces = await sdk.executeCommand('EXPLODE', { id: source.id })
  assert.deepEqual(pieces.map(piece => [piece.payload.start[2], piece.payload.end[2]]), [[0, 3], [3, 7]])
})

test('EXPLODE cannot silently flatten tilted extrusion or non-planar bulge arcs', async () => {
  for (const payload of [
    { normal: [1, 0, 1], vertices: [[0, 0], [2, 0], [2, 2]] },
    { vertices: [{ point: [0, 0, 1], bulge: 1 }, { point: [2, 0, 4] }] },
  ]) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument()
    const source = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload })
    const before = document.serialize(), history = document.history
    await assert.rejects(sdk.executeCommand('EXPLODE', { id: source.id }), KJValidationError)
    assert.equal(document.serialize(), before)
    assert.deepEqual(document.history, history)
  }
})

test('EXPLODE writes only the source layer and remains atomic when it is protected', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const currentId = document.getTable('layers').currentId
  const sourceLayer = await sdk.executeCommand('LAYERNEW', { name: 'Writable source' })
  const source = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { layerId: sourceLayer.id, color: 0, vertices: [[0, 0], [2, 0], [2, 2]] } })
  await sdk.executeCommand('LAYERUPDATE', { id: currentId, patch: { locked: true } })
  const pieces = await sdk.executeCommand('EXPLODE', { id: source.id })
  assert.ok(pieces.every(piece => piece.payload.layerId === sourceLayer.id && piece.payload.color === 0))
  await sdk.executeCommand('UNDO')
  for (const protection of [{ locked: true }, { frozen: true }, { visible: false }]) {
    await sdk.executeCommand('LAYERUPDATE', { id: sourceLayer.id, patch: { locked: false, frozen: false, visible: true, ...protection } })
    const before = document.serialize(), history = document.history
    await assert.rejects(sdk.executeCommand('EXPLODE', { id: source.id }), error => error instanceof KJValidationError && error.details?.policy === 'layer-editability')
    assert.equal(document.serialize(), before)
    assert.deepEqual(document.history, history)
  }
  await sdk.executeCommand('LAYERUPDATE', { id: sourceLayer.id, patch: { visible: true } })
  assert.equal((await sdk.executeCommand('EXPLODE', { id: source.id })).length, 2)
})
