import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJValidationError, createKJDrawSDK } from '../src/index.js'

const activeRecords = drawing => Object.fromEntries(drawing.listObjects().map(record => [record.id, record]))

test('STRETCH moves only crossing-window vertices and preserves identity, topology, styles, Z and memberships', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'stretch-mixed' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Stretch geometry' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-5, 0, 3], end: [5, 0, 4], layerId: layer.id, color: 2 } })
  const polyline = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: {
    vertices: [
      { point: [-5, 5], bulge: 0.5, startWidth: 1, endWidth: 2 },
      { point: [5, 5], bulge: -0.25, startWidth: 3, endWidth: 4 },
      { point: [15, 5], bulge: 0, startWidth: 0, endWidth: 0 },
    ], elevation: 9, closed: false, layerId: layer.id, lineweight: 30,
  } })
  const group = await sdk.executeCommand('GROUP', { name: 'Stretch assembly', ids: [line.id, polyline.id] })
  const before = activeRecords(drawing), revision = drawing.revision

  const result = await sdk.executeCommand('STRETCH', { ids: [line.id, polyline.id], crossingStart: [0, 10], crossingEnd: [10, -1], dx: 5, dy: 2 })
  assert.deepEqual(result.map(entity => entity.id), [line.id, polyline.id])
  assert.equal(result[0].handle, line.handle); assert.deepEqual(result[0].payload.start, [-5, 0, 3]); assert.deepEqual(result[0].payload.end, [10, 2, 4])
  assert.equal(result[0].payload.color, 2)
  assert.equal(result[1].handle, polyline.handle); assert.equal(result[1].payload.elevation, 9); assert.equal(result[1].payload.lineweight, 30)
  assert.deepEqual(result[1].payload.vertices.map(vertex => vertex.point), [[-5, 5, 0], [10, 7, 0], [15, 5, 0]])
  assert.deepEqual(result[1].payload.vertices.map(vertex => [vertex.bulge, vertex.startWidth, vertex.endWidth]), [[0.5, 1, 2], [-0.25, 3, 4], [0, 0, 0]])
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [line.id, polyline.id])
  assert.equal(drawing.revision, revision + 1); assert.equal(drawing.validate().valid, true)

  const current = drawing.serialize(), currentRecords = activeRecords(drawing)
  assert.equal(KJDocument.open(current).serialize(), current)
  const reopened = await sdk.fileAdapters.read(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.deepEqual(reopened.listEntities({ type: 'LINE' })[0].payload.end, [10, 2, 4])
  const reopenedPolyline = reopened.listEntities({ type: 'LWPOLYLINE' })[0]
  assert.deepEqual(reopenedPolyline.payload.vertices.map(vertex => vertex.point), [[-5, 5, 0], [10, 7, 0], [15, 5, 0]])
  assert.equal(reopenedPolyline.payload.elevation, 9)

  await sdk.executeCommand('UNDO'); assert.deepEqual(activeRecords(drawing), before)
  await sdk.executeCommand('REDO'); assert.deepEqual(activeRecords(drawing), currentRecords)
})

test('STRETCH moves a whole entity when all defining vertices are inside and accepts a from/to displacement', async () => {
  const sdk = createKJDrawSDK(); sdk.createDocument({ documentId: 'stretch-whole' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [1, 2, 7], end: [3, 4, 8] } })
  const [result] = await sdk.executeCommand('S', { id: line.id, firstPoint: [0, 0], secondPoint: [5, 5], from: [10, 10], to: [7, 7] })
  assert.deepEqual(result.payload.start, [-2, -1, 7])
  assert.deepEqual(result.payload.end, [0, 1, 8])
})

test('STRETCH rejects empty windows, no vertex hits, unsupported types and protected mixed edits atomically', async () => {
  const rejectUnchanged = async (drawing, work, predicate = error => error instanceof KJValidationError) => {
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(work(), predicate)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  }
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'stretch-reject' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Protected stretch' })
  const first = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [5, 0] } })
  const second = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [5, 0], end: [10, 0], layerId: layer.id } })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [5, 0], radius: 2 } })
  await rejectUnchanged(drawing, () => sdk.executeCommand('STRETCH', { id: first.id, crossingStart: [1, 1], crossingEnd: [1, 5], dx: 1 }))
  await rejectUnchanged(drawing, () => sdk.executeCommand('STRETCH', { id: first.id, crossingStart: [20, 20], crossingEnd: [30, 30], dx: 1 }), error => /no editable vertices/.test(error.message))
  await rejectUnchanged(drawing, () => sdk.executeCommand('STRETCH', { ids: [first.id, circle.id], crossingStart: [-1, -1], crossingEnd: [6, 1], dx: 1 }), error => /not implemented/.test(error.message))
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  await rejectUnchanged(drawing, () => sdk.executeCommand('STRETCH', { ids: [first.id, second.id], crossingStart: [-1, -1], crossingEnd: [11, 1], dx: 1 }), error => error.details?.policy === 'layer-editability')
})

test('STRETCH exposes a bounded exact crossing-window capability', () => {
  const capability = createKJDrawSDK().capabilities().commands.find(command => command.id === 'STRETCH')
  assert.deepEqual(capability.capabilities, {
    domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE', 'LWPOLYLINE', 'POLYLINE'], selection: 'crossing-window', maximumEntities: 4096, stableIdentity: true,
  })
})
