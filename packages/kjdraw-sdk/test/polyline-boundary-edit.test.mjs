import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { createBoundaryEditSession, createDraftingSession, createKJDrawSDK } from '../src/index.js'
import { projectDimension } from '../src/geometry/annotation.js'

const records = drawing => Object.fromEntries(drawing.listObjects({ includeErased: true }).map(value => [value.id, value]))
const vertices = entity => entity.payload.vertices.map(vertex => ({ point: vertex.point, bulge: vertex.bulge, startWidth: vertex.startWidth, endWidth: vertex.endWidth }))
const executePreview = (sdk, drawing) => request => sdk.executeCommandEnvelope(sdk.createCommandEnvelope(request.command, request.arguments, {
  document: drawing, expectedRevision: request.expectedRevision, origin: 'ui',
}), { document: drawing })

async function fixture(type = 'LWPOLYLINE') {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: `polyline-${type.toLowerCase()}`, units: 'millimeter' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Profiles', color: 2 }, { document: drawing })
  const boundaryLayer = await sdk.executeCommand('LAYERNEW', { name: 'Cutters', color: 4 }, { document: drawing })
  const target = await sdk.executeCommand('CREATE', { type, payload: {
    vertices: [
      { point: [0, 0, 0], bulge: 0, startWidth: 1, endWidth: 2, station: 'A' },
      { point: [10, 0, 0], bulge: 0, startWidth: 2, endWidth: 6, station: 'B' },
      { point: [100, 0, 0], bulge: Math.tan(Math.PI / 8), startWidth: 6, endWidth: 8, station: 'C' },
      { point: [110, 10, 0], bulge: 0, startWidth: 8, endWidth: 8, station: 'D' },
    ], closed: false, elevation: 6, dxfFlags: 0, layerId: layer.id, color: 2, lineweight: 35, linetypeScale: 1.5,
  }, options: { name: 'Bent profile', extension: { xdata: { TEST: { role: 'profile' } } } } }, { document: drawing })
  const cutters = []
  for (const x of [30, 70, 130, -20]) cutters.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
    start: [x, -20, 6], end: [x, 30, 6], layerId: boundaryLayer.id,
  } }, { document: drawing }))
  const group = await sdk.executeCommand('GROUP', { name: 'Profile group', ids: [target.id] }, { document: drawing })
  sdk.activeSelection.replace([target.id])
  const saved = await sdk.getSelectionManager(drawing.id).saveNamed('Profile selection')
  return { sdk, drawing, target, layer, cutters, group, saved }
}

test('TRIM previews and splits the picked straight LWPOLYLINE segment with exact properties and memberships', async () => {
  const value = await fixture(), { sdk, drawing, target, cutters, group, saved } = value
  const before = records(drawing), history = drawing.history, revision = drawing.revision
  const session = createBoundaryEditSession('trim', { document: drawing, boundaryIds: cutters.slice(0, 2).map(value => value.id) })
  session.confirmBoundaries()
  const preview = session.preview(target.id, [50, 1])
  assert.equal(drawing.revision, revision); assert.deepEqual(drawing.history, history); assert.deepEqual(records(drawing), before)
  assert.deepEqual(preview.pieces.map(piece => piece.payload.vertices.map(vertex => vertex.point)), [
    [[0, 0, 0], [10, 0, 0], [30, 0, 0]], [[70, 0, 0], [100, 0, 0], [110, 10, 0]],
  ])
  assert.equal(preview.pieces[1].payload.vertices[1].bulge, target.payload.vertices[2].bulge)
  assert.equal(preview.pieces[0].payload.vertices[1].endWidth, 2 + (6 - 2) * 20 / 90)
  assert.equal(preview.pieces[1].payload.vertices[0].startWidth, 2 + (6 - 2) * 60 / 90)
  const receipt = await session.apply(preview, executePreview(sdk, drawing))
  assert.equal(receipt.status, 'committed'); assert.equal(drawing.revision, revision + 1)
  const derived = drawing.listEntities({ type: 'LWPOLYLINE' }).find(entity => entity.id !== target.id)
  assert.ok(derived); assert.equal(derived.source.derivedFromId, target.id)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [target.id, derived.id])
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, [target.id, derived.id])
  for (const entity of [drawing.getObject(target.id), derived]) {
    assert.equal(entity.payload.elevation, 6); assert.equal(entity.payload.color, 2); assert.equal(entity.payload.lineweight, 35)
    assert.deepEqual(entity.extension, target.extension); assert.equal(entity.name, target.name)
  }
  const after = records(drawing)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    const paths = reopened.listEntities({ type: 'LWPOLYLINE' }).map(vertices).sort((left, right) => left[0].point[0] - right[0].point[0])
    assert.equal(paths.length, 2); assert.deepEqual(paths.map(path => path.map(vertex => vertex.point)), preview.pieces.map(piece => piece.payload.vertices.map(vertex => vertex.point)))
  }
  await sdk.executeCommand('UNDO', {}, { document: drawing }); assert.deepEqual(records(drawing), before)
  await sdk.executeCommand('REDO', {}, { document: drawing }); assert.deepEqual(records(drawing), after)
})

test('EXTEND keeps POLYLINE identity, elevation, untouched bulges and vertex metadata', async () => {
  const { sdk, drawing, target, cutters, group } = await fixture('POLYLINE')
  const before = records(drawing), revision = drawing.revision
  const session = createBoundaryEditSession('extend', { document: drawing, boundaryIds: [cutters[3].id] })
  session.confirmBoundaries(); const preview = session.preview(target.id, [0, 0])
  assert.deepEqual(preview.pieces[0].payload.vertices[0].point, [-20, 0, 0]); assert.deepEqual(records(drawing), before)
  await session.apply(preview, executePreview(sdk, drawing))
  const result = drawing.getObject(target.id)
  assert.equal(drawing.revision, revision + 1); assert.equal(result.handle, target.handle)
  assert.equal(result.payload.elevation, 6); assert.equal(result.payload.vertices[2].bulge, target.payload.vertices[2].bulge)
  assert.equal(result.payload.vertices[1].station, 'B'); assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [target.id])
  await sdk.executeCommand('UNDO', {}, { document: drawing }); assert.deepEqual(records(drawing), before)
})

async function bulgeFixture(direction = 1) {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'bulge-boundary-edit', units: 'millimeter' })
  const target = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [
    { point: [-20, 0, 0], bulge: 0, startWidth: 1, endWidth: 2, station: 'lead' },
    { point: [0, 0, 0], bulge: direction, startWidth: 2, endWidth: 6, station: 'arc' },
    { point: [100, 0, 0], bulge: 0, startWidth: 6, endWidth: 8, station: 'tail' },
    { point: [120, 0, 0], bulge: 0, startWidth: 8, endWidth: 8, station: 'end' },
  ], elevation: 6, closed: false, color: 2, lineweight: 35 } }, { document: drawing })
  const cutters = []
  for (const x of [25, 75]) cutters.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
    start: [x, direction > 0 ? -60 : 10, 6], end: [x, direction > 0 ? -10 : 60, 6],
  } }, { document: drawing }))
  const group = await sdk.executeCommand('GROUP', { name: 'Bulge profile group', ids: [target.id] }, { document: drawing })
  sdk.activeSelection.replace([target.id]); const saved = await sdk.getSelectionManager(drawing.id).saveNamed('Bulge profile selection')
  return { sdk, drawing, target, cutters, group, saved }
}

test('TRIM splits a picked bulge interval exactly and interpolates signed bulges and widths', async () => {
  const { sdk, drawing, target, cutters, group, saved } = await bulgeFixture(), before = records(drawing), revision = drawing.revision
  const session = createBoundaryEditSession('trim', { document: drawing, boundaryIds: cutters.map(value => value.id) }); session.confirmBoundaries()
  const preview = session.preview(target.id, [50, -50]), expectedBulge = Math.tan(Math.PI / 12), y = -25 * Math.sqrt(3)
  assert.equal(drawing.revision, revision); assert.deepEqual(records(drawing), before); assert.equal(preview.pieces.length, 2)
  const first = preview.pieces[0].payload.vertices, second = preview.pieces[1].payload.vertices
  assert.ok(Math.abs(first.at(-1).point[0] - 25) < 1e-9 && Math.abs(first.at(-1).point[1] - y) < 1e-9)
  assert.ok(Math.abs(second[0].point[0] - 75) < 1e-9 && Math.abs(second[0].point[1] - y) < 1e-9)
  assert.ok(Math.abs(first[1].bulge - expectedBulge) < 1e-12); assert.ok(Math.abs(second[0].bulge - expectedBulge) < 1e-12)
  assert.ok(Math.abs(first[1].endWidth - 10 / 3) < 1e-12); assert.ok(Math.abs(second[0].startWidth - 14 / 3) < 1e-12)
  await session.apply(preview, executePreview(sdk, drawing))
  const after = records(drawing); assert.equal(drawing.revision, revision + 1)
  const derived = drawing.listEntities({ type: 'LWPOLYLINE' }).find(entity => entity.id !== target.id)
  assert.ok(derived); assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [target.id, derived.id])
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, [target.id, derived.id])
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    const values = [...reopened.listEntities({ type: 'LWPOLYLINE' })].sort((a, b) => a.payload.vertices[0].point[0] - b.payload.vertices[0].point[0])
    assert.equal(values.length, 2); assert.ok(values.every(value => value.payload.elevation === 6))
    assert.ok(Math.abs(values[0].payload.vertices[1].bulge - expectedBulge) < 1e-9)
    assert.ok(Math.abs(values[1].payload.vertices[0].bulge - expectedBulge) < 1e-9)
  }
  await sdk.executeCommand('UNDO', {}, { document: drawing }); assert.deepEqual(records(drawing), before)
  await sdk.executeCommand('REDO', {}, { document: drawing }); assert.deepEqual(records(drawing), after)
  const clockwise = await bulgeFixture(-1), clockwiseSession = createBoundaryEditSession('trim', {
    document: clockwise.drawing, boundaryIds: clockwise.cutters.map(value => value.id),
  })
  clockwiseSession.confirmBoundaries(); const clockwisePreview = clockwiseSession.preview(clockwise.target.id, [50, 50])
  assert.ok(clockwisePreview.pieces[0].payload.vertices[1].bulge < 0 && clockwisePreview.pieces[1].payload.vertices[0].bulge < 0)
  assert.ok(Math.abs(clockwisePreview.pieces[0].payload.vertices.at(-1).point[1] - 25 * Math.sqrt(3)) < 1e-9)
  clockwiseSession.cancel()
})

test('EXTEND grows an open terminal bulge along its signed continuation to one finite boundary', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'bulge-extend' })
  const target = await sdk.executeCommand('CREATE', { type: 'POLYLINE', payload: { vertices: [
    { point: [-20, 0, 0], bulge: 0, startWidth: 1, endWidth: 2 },
    { point: [0, 0, 0], bulge: 1, startWidth: 2, endWidth: 6 },
    { point: [100, 0, 0], bulge: 0, startWidth: 6, endWidth: 6 },
  ], elevation: 6, dxfFlags: 0 } }, { document: drawing })
  const boundary = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [75, 10, 6], end: [75, 60, 6] } }, { document: drawing })
  const session = createBoundaryEditSession('extend', { document: drawing, boundaryIds: [boundary.id] }); session.confirmBoundaries()
  const preview = session.preview(target.id, [100, 0]), result = preview.pieces[0].payload, expectedY = 25 * Math.sqrt(3)
  assert.ok(Math.abs(result.vertices.at(-1).point[0] - 75) < 1e-9 && Math.abs(result.vertices.at(-1).point[1] - expectedY) < 1e-9)
  assert.ok(Math.abs(result.vertices[1].bulge - Math.sqrt(3)) < 1e-9)
  assert.deepEqual(result.vertices[1].startWidth, 2); assert.deepEqual(result.vertices[1].endWidth, 6)
  await session.apply(preview, executePreview(sdk, drawing))
  assert.equal(drawing.getObject(target.id).handle, target.handle)
  assert.ok(Math.abs(drawing.getObject(target.id).payload.vertices[1].bulge - Math.sqrt(3)) < 1e-9)
})

test('polyline boundary editing rejects closed/special/degenerate topology and protected targets without history', async () => {
  const { sdk, drawing, target, layer, cutters } = await fixture()
  for (const protection of [{ locked: true }, { frozen: true }, { visible: false }]) {
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false, frozen: false, visible: true, ...protection } }, { document: drawing })
    const session = createBoundaryEditSession('trim', { document: drawing, boundaryIds: cutters.slice(0, 2).map(value => value.id) }); session.confirmBoundaries()
    const before = drawing.serialize(), history = drawing.history
    assert.throws(() => session.preview(target.id, [50, 0]), error => error.details?.code === 'boundary-edit.protected-target')
    await assert.rejects(sdk.executeCommand('TRIM', { id: target.id, boundaryIds: cutters.slice(0, 2).map(value => value.id), pickPoint: [50, 0] }, { document: drawing }), error => error.details?.policy === 'layer-editability')
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history)
  }
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false, frozen: false, visible: true } }, { document: drawing })
  for (const [patch, pattern] of [[{ closed: true }, /open polylines/], [{ normal: [1, 0, 0] }, /positive XY/],
    [{ vertices: [{ point: [0, 0, 0] }, { point: [0, 0, 0] }] }, /zero-length/]]) {
    await drawing.transact('Unsupported topology', tx => tx.updateObject(target.id, { payload: patch }))
    const session = createBoundaryEditSession('trim', { document: drawing, boundaryIds: cutters.slice(0, 2).map(value => value.id) }); session.confirmBoundaries()
    assert.throws(() => session.preview(target.id, [50, 0]), error => pattern.test(String(error.details?.reason ?? error.message)))
    await sdk.executeCommand('UNDO', {}, { document: drawing })
  }
  const ambiguous = await bulgeFixture()
  const coincident = await ambiguous.sdk.executeCommand('CREATE', { type: 'ARC', payload: {
    center: [50, 0, 6], radius: 50, startAngle: Math.PI, endAngle: Math.PI * 2,
  } }, { document: ambiguous.drawing })
  const ambiguousSession = createBoundaryEditSession('trim', { document: ambiguous.drawing, boundaryIds: [coincident.id] })
  ambiguousSession.confirmBoundaries(); const unchanged = records(ambiguous.drawing)
  assert.throws(() => ambiguousSession.preview(ambiguous.target.id, [50, -50]), error => /Coincident/.test(String(error.details?.reason ?? error.message)))
  assert.deepEqual(records(ambiguous.drawing), unchanged)
})

test('TRIM refuses associative polyline topology replacement while EXTEND refreshes stable endpoint associations', async () => {
  const { sdk, drawing, target, cutters } = await fixture()
  await sdk.executeCommand('PEDIT', { id: target.id, operation: 'SET_BULGE', segmentIndex: 2, bulge: 0 }, { document: drawing })
  const draft = createDraftingSession('dimension', { dimensionType: 'ALIGNED' })
  draft.addPoint([0, 0], { entityId: target.id, feature: 'vertex', vertexIndex: 0 })
  draft.addPoint([10, 0], { entityId: target.id, feature: 'vertex', vertexIndex: 1 })
  const dimension = await sdk.executeCommand('CREATE', draft.addPoint([5, 15]), { document: drawing })
  const before = drawing.serialize(), revision = drawing.revision
  await assert.rejects(sdk.executeCommand('TRIM', { id: target.id, boundaryIds: cutters.slice(0, 2).map(value => value.id), pickPoint: [50, 0] }, { document: drawing }), /cannot split or replace/)
  assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
  await sdk.executeCommand('EXTEND', { id: target.id, boundaryIds: [cutters[3].id], pickPoint: [0, 0] }, { document: drawing })
  assert.equal(projectDimension(drawing.getObject(dimension.id).payload).measurement, 30)
})

test('independent ezdxf reads the trimmed native LWPOLYLINE geometry without audit repair', async t => {
  if (!process.env.KJDRAW_PYTHON) return t.skip('KJDRAW_PYTHON is not configured')
  const { sdk, drawing, target, cutters } = await bulgeFixture()
  await sdk.executeCommand('TRIM', { id: target.id, boundaryIds: cutters.map(value => value.id), pickPoint: [50, -50] }, { document: drawing })
  const dxf = String(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }))
  const script = 'import sys,io,json,ezdxf; d=ezdxf.read(io.StringIO(sys.stdin.read())); a=d.audit(); p=list(d.modelspace().query("LWPOLYLINE")); print(json.dumps({"version":ezdxf.__version__,"count":len(p),"points":[[(x,y,b) for x,y,sw,ew,b in e.get_points("xyseb")] for e in p],"errors":len(a.errors),"fixes":len(a.fixes)}))'
  const run = spawnSync(process.env.KJDRAW_PYTHON, ['-c', script], { input: dxf, encoding: 'utf8', timeout: 30000 })
  assert.equal(run.status, 0, run.stderr)
  const result = JSON.parse(run.stdout)
  assert.equal(result.version, '1.4.4'); assert.equal(result.count, 2); assert.equal(result.errors, 0); assert.equal(result.fixes, 0)
  const paths = result.points.sort((a, b) => a[0][0] - b[0][0])
  assert.deepEqual(paths.map(path => path.map(point => point.slice(0, 2)).map(point => point.map(value => Math.round(value * 1e9) / 1e9))),
    [[[-20, 0], [0, 0], [25, -43.301270189]], [[75, -43.301270189], [100, 0], [120, 0]]])
  assert.ok(Math.abs(paths[0][1][2] - Math.tan(Math.PI / 12)) < 1e-9); assert.ok(Math.abs(paths[1][0][2] - Math.tan(Math.PI / 12)) < 1e-9)
})
