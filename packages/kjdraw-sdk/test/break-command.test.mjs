import assert from 'node:assert/strict'
import test from 'node:test'
import { createDraftingSession, createKJDrawSDK, KJValidationError } from '../src/index.js'
import { breakEntityPayloads } from '../src/editing.js'
import { projectDimension } from '../src/geometry/annotation.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const records = drawing => Object.fromEntries(drawing.listObjects({ includeErased: true }).map(value => [value.id, value]))
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)

async function vertexDimension(sdk, source) {
  const draft = createDraftingSession('dimension', { dimensionType: 'ALIGNED', textHeight: 2 })
  draft.addPoint(source.payload.vertices[0].point, { entityId: source.id, feature: 'vertex', vertexIndex: 0 })
  draft.addPoint(source.payload.vertices.at(-1).point, { entityId: source.id, feature: 'vertex', vertexIndex: source.payload.vertices.length - 1 })
  return sdk.executeCommand('CREATE', draft.addPoint([15, 8]))
}

test('BREAK splits an open bulge polyline exactly and migrates identity, widths, vertex references and memberships', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'break-open-polyline', units: 'millimeter' })
  const target = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [
    { point: [0, 0, 0], bulge: 0, startWidth: 1, endWidth: 3, station: 'A' },
    { point: [10, 0, 0], bulge: 1, startWidth: 3, endWidth: 7, station: 'B' },
    { point: [20, 0, 0], bulge: 0, startWidth: 7, endWidth: 9, station: 'C' },
    { point: [30, 0, 0], bulge: 0, startWidth: 9, endWidth: 9, station: 'D' },
  ], closed: false, elevation: 6, color: 2, lineweight: 35 } })
  const dimension = await vertexDimension(sdk, target)
  const group = await sdk.executeCommand('GROUP', { name: 'Break assembly', ids: [target.id] })
  sdk.activeSelection.replace([target.id]); const saved = await sdk.getSelectionManager().saveNamed('Break selection')
  const before = records(drawing), revision = drawing.revision
  const preview = breakEntityPayloads(target, { point: [15, -5], tolerance: 0.1 })
  assert.equal(drawing.revision, revision); assert.deepEqual(records(drawing), before)
  close(preview[0].payload.vertices[1].bulge, Math.tan(Math.PI / 8)); close(preview[1].payload.vertices[0].bulge, Math.tan(Math.PI / 8))
  close(preview[0].payload.vertices.at(-1).endWidth, 5); close(preview[1].payload.vertices[0].startWidth, 5)
  const pieces = await sdk.executeCommand('BREAK', { id: target.id, point: [15, -5], tolerance: 0.1 })
  assert.equal(pieces[0].id, target.id); assert.equal(pieces[1].source.derivedFromId, target.id)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, pieces.map(piece => piece.id))
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, pieces.map(piece => piece.id))
  const associations = drawing.getObject(dimension.id).payload.dimensionAssociations
  assert.deepEqual(associations.map(value => [value.entityId, value.vertexIndex]), [[pieces[0].id, 0], [pieces[1].id, 2]])
  assert.equal(projectDimension(drawing.getObject(dimension.id).payload).measurement, 30)
  const after = records(drawing)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    assert.equal(reopened.listEntities({ type: 'LWPOLYLINE' }).length, 2)
    assert.equal(reopened.listEntities({ type: 'DIMENSION' }).length, 1)
  }
  await sdk.executeCommand('UNDO'); assert.deepEqual(records(drawing), before)
  await sdk.executeCommand('REDO'); assert.deepEqual(records(drawing), after)
})

test('BREAK maps every closed polyline vertex to one deterministic open fragment', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'break-closed-polyline' })
  const target = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [
    { point: [0, 0, 0], station: 'A' }, { point: [10, 0, 0], station: 'B' },
    { point: [10, 10, 0], station: 'C' }, { point: [0, 10, 0], station: 'D' },
  ], closed: true, color: 3 } })
  const dimension = await vertexDimension(sdk, target)
  const pieces = await sdk.executeCommand('BREAK', { id: target.id, firstPoint: [5, 0], secondPoint: [5, 10], tolerance: 0.1 })
  assert.deepEqual(pieces.map(piece => piece.payload.vertices.map(vertex => vertex.point)), [
    [[5, 0, 0], [10, 0, 0], [10, 10, 0], [5, 10, 0]],
    [[5, 10, 0], [0, 10, 0], [0, 0, 0], [5, 0, 0]],
  ])
  assert.ok(pieces.every(piece => piece.payload.closed === false))
  assert.deepEqual(drawing.getObject(dimension.id).payload.dimensionAssociations.map(value => [value.entityId, value.vertexIndex]), [
    [pieces[1].id, 2], [pieces[1].id, 1],
  ])
})

test('BREAK preserves ordinary 2D POLYLINE identity, plane and DXF native topology', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'break-polyline' })
  const target = await sdk.executeCommand('CREATE', { type: 'POLYLINE', payload: { vertices: [
    { point: [0, 0, 3], bulge: 0, startWidth: 1, endWidth: 2, dxfFlags: 0 },
    { point: [10, 0, 3], bulge: 0, startWidth: 2, endWidth: 4, dxfFlags: 0 },
    { point: [20, 5, 3], bulge: 0, startWidth: 4, endWidth: 4, dxfFlags: 0 },
  ], elevation: 3, dxfFlags: 0, closed: false, color: 5 } })
  const pieces = await sdk.executeCommand('BREAK', { id: target.id, point: [5, 0], tolerance: 0.1 })
  assert.equal(pieces[0].id, target.id); assert.ok(pieces.every(piece => piece.type === 'POLYLINE' && piece.payload.elevation === 3 && piece.payload.color === 5))
  assert.ok(pieces.flatMap(piece => piece.payload.vertices).every(vertex => vertex.point[2] === 3))
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    assert.equal(reopened.listEntities({ type: 'POLYLINE' }).length, 2)
  }
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }), python = process.env.KJDRAW_PYTHON || 'python'
  const result = spawnSyncWithFileStdin(python, ['-c', 'import io,json,ezdxf,sys,os; p=os.environ.get("KJDRAW_FILE_STDIN_PATH"); s=open(p,encoding="utf-8").read() if p else sys.stdin.read(); d=ezdxf.read(io.StringIO(s)); a=d.audit(); print(json.dumps({"polylines":len(d.modelspace().query("POLYLINE")),"errors":len(a.errors),"fixes":len(a.fixes)}))'], dxf, { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout.trim()), { polylines: 2, errors: 0, fixes: 0 })
})

test('BREAK CIRCLE creates two ordered native arcs and migrates only uniquely owned curve references', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'break-circle', units: 'millimeter' })
  const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 10, color: 4, lineweight: 25 } })
  const draft = createDraftingSession('dimension', { dimensionType: 'ALIGNED', textHeight: 2 })
  draft.addPoint([10, 0], { entityId: circle.id, feature: 'curve', angle: 0 })
  draft.addPoint([0, 10], { entityId: circle.id, feature: 'curve', angle: Math.PI / 2 })
  const dimension = await sdk.executeCommand('CREATE', draft.addPoint([12, 12]))
  const group = await sdk.executeCommand('GROUP', { name: 'Split circle', ids: [circle.id] })
  const before = records(drawing), revision = drawing.revision
  const preview = breakEntityPayloads(circle, { firstPoint: [Math.SQRT1_2 * 10, -Math.SQRT1_2 * 10], secondPoint: [-Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], tolerance: 1e-8 })
  assert.equal(drawing.revision, revision); assert.deepEqual(records(drawing), before); assert.deepEqual(preview.map(piece => piece.type), ['ARC', 'ARC'])
  const pieces = await sdk.executeCommand('BREAK', { id: circle.id, firstPoint: [Math.SQRT1_2 * 10, -Math.SQRT1_2 * 10], secondPoint: [-Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], tolerance: 1e-8 })
  assert.equal(drawing.getObject(circle.id), null); assert.deepEqual(drawing.getObject(group.id).payload.memberIds, pieces.map(piece => piece.id))
  assert.ok(pieces.every(piece => piece.type === 'ARC' && piece.source.derivedFromId === circle.id && piece.payload.color === 4))
  assert.deepEqual(drawing.getObject(dimension.id).payload.dimensionAssociations.map(value => value.entityId), [pieces[0].id, pieces[0].id])
  close(projectDimension(drawing.getObject(dimension.id).payload).measurement, Math.sqrt(200))
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'ARC' }).length, 2); assert.equal(reopened.listEntities({ type: 'CIRCLE' }).length, 0)
  const python = process.env.KJDRAW_PYTHON || 'python'
  const result = spawnSyncWithFileStdin(python, ['-c', 'import io,json,ezdxf,sys,os; p=os.environ.get("KJDRAW_FILE_STDIN_PATH"); s=open(p,encoding="utf-8").read() if p else sys.stdin.read(); d=ezdxf.read(io.StringIO(s)); a=d.audit(); print(json.dumps({"arcs":len(d.modelspace().query("ARC")),"circles":len(d.modelspace().query("CIRCLE")),"errors":len(a.errors),"fixes":len(a.fixes)}))'], dxf, { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout.trim()), { arcs: 2, circles: 0, errors: 0, fixes: 0 })
})

test('BREAK rejects ambiguous seams, invalid topology and protected entities without revision or history changes', async t => {
  await t.test('circle seam association', async () => {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    const circle = await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0], radius: 10 } })
    const draft = createDraftingSession('dimension', { dimensionType: 'ALIGNED' })
    draft.addPoint([10, 0], { entityId: circle.id, feature: 'curve', angle: 0 }); draft.addPoint([0, 10]); await sdk.executeCommand('CREATE', draft.addPoint([12, 12]))
    const before = drawing.serialize(), revision = drawing.revision, history = drawing.history
    await assert.rejects(sdk.executeCommand('BREAK', { id: circle.id, firstPoint: [10, 0], secondPoint: [-10, 0], tolerance: 0.1 }), /seam cannot be uniquely migrated/)
    assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision); assert.deepEqual(drawing.history, history)
  })
  for (const [name, patch] of [['locked', { locked: true }], ['hidden', { visible: false }], ['frozen', { frozen: true }]]) await t.test(name, async () => {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument(), layer = await sdk.executeCommand('LAYERNEW', { name })
    const target = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [{ point: [0, 0] }, { point: [10, 0] }, { point: [20, 0] }], layerId: layer.id } })
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch })
    const before = drawing.serialize(), revision = drawing.revision
    await assert.rejects(sdk.executeCommand('BREAK', { id: target.id, point: [5, 0], tolerance: 0.1 }), KJValidationError)
    assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
  })
  await t.test('same closed segment and special POLYLINE', async () => {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    const closed = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [{ point: [0, 0] }, { point: [10, 0] }, { point: [10, 10] }], closed: true } })
    const special = await sdk.executeCommand('CREATE', { type: 'POLYLINE', payload: { vertices: [{ point: [20, 0] }, { point: [30, 0] }, { point: [40, 0] }], dxfFlags: 8 } })
    for (const [id, args] of [[closed.id, { firstPoint: [2, 0], secondPoint: [8, 0] }], [special.id, { point: [25, 0] }]]) {
      const before = drawing.serialize(), revision = drawing.revision
      await assert.rejects(sdk.executeCommand('BREAK', { id, ...args, tolerance: 0.1 }), KJValidationError)
      assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
    }
  })
  await t.test('non-XY and degenerate polylines', async () => {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    for (const vertices of [
      [{ point: [0, 0, 0] }, { point: [10, 0, 1] }, { point: [20, 0, 0] }],
      [{ point: [0, 0, 0] }, { point: [0, 0, 0] }, { point: [20, 0, 0] }],
    ]) {
      const target = await sdk.executeCommand('CREATE', { type: 'POLYLINE', payload: { vertices, dxfFlags: 0 } })
      const before = drawing.serialize(), revision = drawing.revision
      await assert.rejects(sdk.executeCommand('BREAK', { id: target.id, point: [5, 0], tolerance: 0.1 }), KJValidationError)
      assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision)
    }
  })
})
