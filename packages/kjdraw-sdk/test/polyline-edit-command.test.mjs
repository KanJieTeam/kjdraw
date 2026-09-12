import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJValidationError, createKJDrawSDK, entityLength2 } from '../src/index.js'

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
const points = entity => entity.payload.vertices.map(vertex => vertex.point)

test('PEDIT inserts an exact straight-segment vertex and preserves identity, widths, elevation and memberships', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'pedit-insert-line' })
  const polyline = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: {
    vertices: [
      { point: [0, 0], startWidth: 2, endWidth: 7, metadata: 'source' },
      { point: [10, 0], startWidth: 7, endWidth: 3 },
      { point: [10, 5], startWidth: 3, endWidth: 3 },
    ], elevation: 9, color: 4, closed: false,
  } })
  const group = await sdk.executeCommand('GROUP', { name: 'Editable path', ids: [polyline.id] })
  const originalRecord = drawing.getObject(polyline.id), revision = drawing.revision

  const result = await sdk.executeCommand('PEDIT', { id: polyline.id, operation: 'INSERT', segmentIndex: 0, point: [4, 0.05], tolerance: 0.1 })
  assert.equal(result.id, polyline.id); assert.equal(result.handle, polyline.handle)
  assert.deepEqual(points(result), [[0, 0, 0], [4, 0, 0], [10, 0, 0], [10, 5, 0]])
  assert.equal(result.payload.vertices[0].metadata, 'source')
  assert.deepEqual(result.payload.vertices.slice(0, 2).map(vertex => [vertex.startWidth, vertex.endWidth]), [[2, 4], [4, 7]])
  assert.equal(result.payload.elevation, 9); assert.equal(result.payload.color, 4)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [polyline.id])
  assert.equal(drawing.revision, revision + 1); assert.equal(drawing.validate().valid, true)

  const after = drawing.serialize(), editedRecord = drawing.getObject(polyline.id)
  assert.equal(KJDocument.open(after).serialize(), after)
  await sdk.executeCommand('UNDO'); assert.deepEqual(drawing.getObject(polyline.id), originalRecord)
  await sdk.executeCommand('REDO'); assert.deepEqual(drawing.getObject(polyline.id), editedRecord)
})

test('PEDIT splits a bulge arc by directed angle without changing the curve length and round-trips DXF', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'pedit-insert-arc' })
  const polyline = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: {
    vertices: [{ point: [0, 0], bulge: 1, startWidth: 2, endWidth: 6 }, { point: [10, 0] }], closed: false,
  } })
  const originalLength = entityLength2(polyline).value
  const result = await sdk.executeCommand('POLYLINEEDIT', { id: polyline.id, operation: 'INSERT', segmentIndex: 0, point: [5, -5], tolerance: 1e-8 })
  const quarterBulge = Math.tan(Math.PI / 8)
  for (const [actual, expected] of points(result).flatMap((point, index) => point.map((value, axis) => [value, [[0, 0, 0], [5, -5, 0], [10, 0, 0]][index][axis]]))) close(actual, expected)
  close(result.payload.vertices[0].bulge, quarterBulge)
  close(result.payload.vertices[1].bulge, quarterBulge)
  assert.deepEqual(result.payload.vertices.slice(0, 2).map(vertex => [vertex.startWidth, vertex.endWidth]), [[2, 4], [4, 6]])
  close(entityLength2(result).value, originalLength)

  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const reopened = await sdk.fileAdapters.read(dxf, { format: 'DXF' })
  const restored = reopened.listEntities({ type: 'LWPOLYLINE' })[0]
  close(entityLength2(restored).value, originalLength, 1e-7)
  close(restored.payload.vertices[0].bulge, quarterBulge, 1e-8)
  close(restored.payload.vertices[1].bulge, quarterBulge, 1e-8)
})

test('PEDIT deletes only topologically safe vertices and keeps a two-vertex closed polyline valid', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'pedit-delete' })
  const open = await sdk.executeCommand('CREATE', { type: 'POLYLINE', payload: {
    vertices: [
      { point: [0, 0, 3], startWidth: 1, endWidth: 2 },
      { point: [4, 0, 3], startWidth: 2, endWidth: 5 },
      { point: [8, 0, 3], startWidth: 5, endWidth: 6 },
      { point: [12, 0, 3] },
    ], closed: false,
  } })
  let result = await sdk.executeCommand('PEDIT', { id: open.id, operation: 'DELETE', vertexIndex: 1 })
  assert.deepEqual(points(result), [[0, 0, 3], [8, 0, 3], [12, 0, 3]])
  assert.equal(result.payload.vertices[0].endWidth, 5)
  result = await sdk.executeCommand('PEDIT', { id: open.id, operation: 'DELETE', vertexIndex: 2 })
  assert.deepEqual(points(result), [[0, 0, 3], [8, 0, 3]])
  assert.equal(result.payload.vertices[1].bulge, 0)

  const closed = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [[0, 0], [5, 0], [2, 4]], closed: true } })
  const reduced = await sdk.executeCommand('PEDIT', { id: closed.id, operation: 'DELETE', vertexIndex: 1 })
  assert.equal(reduced.payload.vertices.length, 2); assert.equal(reduced.payload.closed, true)
  assert.equal(drawing.validate().valid, true)

  const legacyDxf = await sdk.writeDocument(drawing, { format: 'DXF', version: 'R14' })
  const legacy = await sdk.fileAdapters.read(legacyDxf, { format: 'DXF' })
  assert.deepEqual(points(legacy.listEntities({ type: 'POLYLINE' })[0]), [[0, 0, 3], [8, 0, 3]])
})

test('PEDIT sets signed sweep or bulge on valid outgoing segments', async () => {
  const sdk = createKJDrawSDK(); sdk.createDocument({ documentId: 'pedit-bulge' })
  const polyline = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [[0, 0], [10, 0], [20, 0]], closed: false } })
  let result = await sdk.executeCommand('PEDIT', { id: polyline.id, operation: 'SET_BULGE', segmentIndex: 0, sweepDegrees: 180 })
  close(result.payload.vertices[0].bulge, 1)
  result = await sdk.executeCommand('PE', { id: polyline.id, operation: 'ARC', segmentIndex: 1, sweepDegrees: -90 })
  close(result.payload.vertices[1].bulge, -Math.tan(Math.PI / 8))
  result = await sdk.executeCommand('PEDIT', { id: polyline.id, operation: 'SET_BULGE', segmentIndex: 1, bulge: 0 })
  assert.equal(result.payload.vertices[1].bulge, 0)
})

test('PEDIT rejects unsafe curve deletion, invalid geometry, special legacy topology and protected edits atomically', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'pedit-reject' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'PEDIT locked' })
  const curved = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [{ point: [0, 0], bulge: 0.5 }, [5, 0], [10, 0]], closed: false } })
  const special = await sdk.executeCommand('CREATE', { type: 'POLYLINE', payload: { vertices: [[0, 5], [5, 5], [10, 5]], dxfFlags: 8 } })
  const locked = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [[0, 10], [5, 10], [10, 10]], layerId: layer.id } })
  const rejectUnchanged = async (work, predicate = error => error instanceof KJValidationError) => {
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(work(), predicate)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  }
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: curved.id, operation: 'DELETE', vertexIndex: 1 }), error => /adjacent to an arc/.test(error.message))
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: curved.id, operation: 'INSERT', segmentIndex: 0, point: [5, 5], tolerance: 0.01 }), error => /outside/.test(error.message))
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: curved.id, operation: 'SET_BULGE', segmentIndex: 2, bulge: 1 }), error => /segmentIndex/.test(error.message))
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: curved.id, operation: 'SET_BULGE', segmentIndex: 0, bulge: 1, sweepDegrees: 90 }), error => /not both/.test(error.message))
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: curved.id, operation: 'SET_BULGE', segmentIndex: 0, bulge: 1e308 }), error => /unbounded/.test(error.message))
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: special.id, operation: 'DELETE', vertexIndex: 1 }), error => /ordinary 2D/.test(error.message))
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: locked.id, operation: 'DELETE', vertexIndex: 1 }), error => error.details?.policy === 'layer-editability')
})

test('PEDIT advertises exact stable topology operations', () => {
  const capability = createKJDrawSDK().capabilities().commands.find(command => command.id === 'PEDIT')
  assert.deepEqual(capability.aliases, ['PE', 'POLYLINEEDIT'])
  assert.deepEqual(capability.capabilities, {
    domain: 'topology', precision: 'exact', supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE'], operations: ['INSERT', 'DELETE', 'SET_BULGE'], stableIdentity: true,
  })
})
