import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

test('PEDIT sets exact tapered segment widths with stable identity and DXF persistence', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'pedit-width', units: 'millimeter' })
  const polyline = await sdk.executeCommand('CREATE', { type: 'POLYLINE', payload: { vertices: [[0, 0], [10, 0], [20, 0]], closed: false } })
  const identity = { id: polyline.id, handle: polyline.handle }, revision = drawing.revision
  const result = await sdk.executeCommand('PEDIT', { id: polyline.id, operation: 'SET_WIDTH', segmentIndex: 1, startWidth: 2.5, endWidth: 7.5 })
  assert.deepEqual({ id: result.id, handle: result.handle }, identity)
  assert.deepEqual(result.payload.vertices.map(vertex => [vertex.startWidth, vertex.endWidth]), [[0, 0], [2.5, 7.5], [0, 0]])
  assert.equal(drawing.revision, revision + 1)
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const reopened = await sdk.fileAdapters.read(dxf, { format: 'DXF' }), restored = reopened.listEntities({ type: 'POLYLINE' })[0]
  assert.deepEqual(restored.payload.vertices.map(vertex => [vertex.startWidth, vertex.endWidth]), [[0, 0], [2.5, 7.5], [0, 0]])
  await sdk.executeCommand('UNDO'); assert.deepEqual(drawing.getObject(polyline.id), polyline)
  await sdk.executeCommand('REDO'); assert.equal(drawing.getObject(polyline.id).payload.vertices[1].endWidth, 7.5)
})

test('pointer PEDIT resolves unique straight, arc and closed-seam topology without numeric indices', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'pedit-pointer', units: 'millimeter' })
  const path = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: {
    vertices: [{ point: [0, 0], startWidth: 2, endWidth: 4 }, { point: [10, 0], startWidth: 4, endWidth: 6 }, { point: [10, 10], startWidth: 6, endWidth: 8 }, { point: [0, 10], startWidth: 8, endWidth: 10 }],
    closed: true, elevation: 7, color: 3,
  } })
  const identity = { id: path.id, handle: path.handle }
  let edited = await sdk.executeCommand('PEDIT', { id: path.id, operation: 'INSERT', point: [0.04, 5], tolerance: 0.1 })
  assert.deepEqual({ id: edited.id, handle: edited.handle }, identity)
  assert.deepEqual(edited.payload.vertices[4].point, [0, 5, 0]); assert.equal(edited.payload.vertices[3].endWidth, 9); assert.equal(edited.payload.vertices[4].startWidth, 9)
  edited = await sdk.executeCommand('PEDIT', { id: path.id, operation: 'DELETE', point: [0.03, 5.02], tolerance: 0.1 })
  assert.equal(edited.payload.vertices.length, 4)
  edited = await sdk.executeCommand('PEDIT', { id: path.id, operation: 'SET_BULGE', point: [5, 0.04], tolerance: 0.1, sweepDegrees: -90 })
  close(edited.payload.vertices[0].bulge, -Math.tan(Math.PI / 8))
  edited = await sdk.executeCommand('PEDIT', { id: path.id, operation: 'SET_BULGE', point: [5, 2.0710678118654755], tolerance: 1e-8, sweepDegrees: 0 })
  assert.equal(edited.payload.vertices[0].bulge, 0)
  assert.deepEqual({ id: edited.id, handle: edited.handle }, identity)
  const kjd = await sdk.writeDocument(drawing, { format: 'KJD' }), dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  assert.equal(KJDocument.open(kjd).getObject(path.id).payload.vertices.length, 4)
  const reopened = await sdk.fileAdapters.read(dxf, { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'LWPOLYLINE' })[0].payload.vertices.length, 4)
  await sdk.executeCommand('UNDO'); close(drawing.getObject(path.id).payload.vertices[0].bulge, -Math.tan(Math.PI / 8))
  await sdk.executeCommand('REDO'); assert.equal(drawing.getObject(path.id).payload.vertices[0].bulge, 0)
})

test('independent ezdxf validates pointer-edited native polyline output without repair', async t => {
  if (!process.env.KJDRAW_PYTHON) return t.skip('KJDRAW_PYTHON is not configured')
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'pedit-pointer-ezdxf' })
  const path = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [[0, 0], [10, 0], [10, 10]], closed: false } })
  await sdk.executeCommand('PEDIT', { id: path.id, operation: 'INSERT', point: [5, 0], tolerance: 1e-8 })
  await sdk.executeCommand('PEDIT', { id: path.id, operation: 'SET_BULGE', point: [7.5, 0], tolerance: 1e-8, sweepDegrees: 90 })
  await sdk.executeCommand('PEDIT', { id: path.id, operation: 'SET_WIDTH', segmentIndex: 2, startWidth: 3, endWidth: 5 })
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const code = 'import sys,io,json,ezdxf;d=ezdxf.read(io.StringIO(sys.stdin.read()));a=d.audit();p=list(d.modelspace().query("LWPOLYLINE"));print(json.dumps({"version":ezdxf.__version__,"count":len(p),"points":[list(v) for v in p[0].get_points("xyseb")],"errors":len(a.errors),"fixes":len(a.fixes)}))'
  const run = spawnSync(process.env.KJDRAW_PYTHON, ['-c', code], { input: dxf, encoding: 'utf8', timeout: 30000 })
  assert.equal(run.status, 0, run.stderr); const result = JSON.parse(run.stdout)
  assert.equal(result.version, '1.4.4'); assert.equal(result.count, 1); assert.equal(result.points.length, 4)
  close(result.points[1][4], Math.tan(Math.PI / 8), 1e-8); assert.deepEqual(result.points[2].slice(2, 4), [3, 5]); assert.equal(result.errors, 0); assert.equal(result.fixes, 0)
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
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: curved.id, operation: 'SET_WIDTH', segmentIndex: 0, startWidth: -1, endWidth: 2 }), error => /widths/.test(error.message))
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: curved.id, operation: 'SET_WIDTH', point: [99, 99], tolerance: .01, startWidth: 1, endWidth: 2 }), error => /outside/.test(error.message))
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: special.id, operation: 'DELETE', vertexIndex: 1 }), error => /ordinary 2D/.test(error.message))
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  await rejectUnchanged(() => sdk.executeCommand('PEDIT', { id: locked.id, operation: 'DELETE', vertexIndex: 1 }), error => error.details?.policy === 'layer-editability')
})

test('PEDIT advertises exact stable topology operations', () => {
  const capability = createKJDrawSDK().capabilities().commands.find(command => command.id === 'PEDIT')
  assert.deepEqual(capability.aliases, ['PE', 'POLYLINEEDIT'])
  assert.deepEqual(capability.capabilities, {
    domain: 'topology', precision: 'exact', supportedEntityTypes: ['LWPOLYLINE', 'POLYLINE'], operations: ['INSERT', 'DELETE', 'SET_BULGE', 'SET_WIDTH'], stableIdentity: true,
  })
})
