import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJValidationError, createKJDrawSDK, entityLength2 } from '../src/index.js'
import { joinEntityPayloads } from '../src/editing.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
const activeRecords = drawing => Object.fromEntries(drawing.listObjects().map(record => [record.id, record]))

test('JOIN orders reversed line, polyline and arc paths while retaining the primary polyline identity and memberships', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'join-mixed' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Joined profile' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [10, 0, 7], end: [0, 0, 7], color: 1 } })
  const primary = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: {
    vertices: [{ point: [10, 0] }, { point: [15, 0] }], elevation: 7, layerId: layer.id, color: 4, lineweight: 35,
  } })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: {
    center: [15, 5, 7], radius: 5, startAngle: -Math.PI / 2, endAngle: 0, clockwise: false,
  } })
  const marker = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [30, 30, 7] } })
  const group = await sdk.executeCommand('GROUP', { name: 'Profile assembly', ids: [marker.id, arc.id, line.id, primary.id] })
  sdk.activeSelection.replace([arc.id, marker.id, primary.id, line.id])
  const saved = await sdk.getSelectionManager().saveNamed('Profile selection')
  const beforeLength = [line, primary, arc].reduce((sum, entity) => sum + entityLength2(entity).value, 0)
  const before = activeRecords(drawing), revision = drawing.revision

  const joined = await sdk.executeCommand('JOIN', { id: primary.id, ids: [arc.id, line.id, primary.id] })
  assert.equal(joined.id, primary.id)
  assert.equal(joined.handle, primary.handle)
  assert.equal(joined.type, 'LWPOLYLINE')
  assert.equal(joined.payload.closed, false)
  assert.equal(joined.payload.elevation, 7)
  assert.equal(joined.payload.layerId, layer.id)
  assert.equal(joined.payload.color, 4)
  assert.equal(joined.payload.lineweight, 35)
  assert.deepEqual(joined.payload.vertices.map(vertex => vertex.point), [[0, 0, 0], [10, 0, 0], [15, 0, 0], [20, 5, 0]])
  close(joined.payload.vertices[2].bulge, Math.tan(Math.PI / 8))
  close(entityLength2(joined).value, beforeLength)
  assert.equal(drawing.getObject(line.id), null)
  assert.equal(drawing.getObject(arc.id), null)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [marker.id, joined.id])
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, [joined.id, marker.id])
  assert.equal(drawing.revision, revision + 1)
  assert.equal(drawing.validate().valid, true)

  const current = drawing.serialize(), currentRecords = activeRecords(drawing)
  assert.equal(KJDocument.open(current).serialize(), current)
  const fromDxf = await sdk.fileAdapters.read(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  const dxfJoined = fromDxf.listEntities({ type: 'LWPOLYLINE' })[0]
  assert.ok(dxfJoined)
  assert.equal(dxfJoined.payload.closed, false)
  assert.equal(dxfJoined.payload.elevation, 7)
  close(entityLength2(dxfJoined).value, beforeLength)

  await sdk.executeCommand('UNDO')
  assert.deepEqual(activeRecords(drawing), before)
  await sdk.executeCommand('REDO')
  assert.deepEqual(activeRecords(drawing), currentRecords)
})

test('JOIN creates one closed editable polyline from an unordered loop and transfers every source reference once', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'join-loop' })
  const createLine = (start, end) => sdk.executeCommand('CREATE', { type: 'LINE', payload: { start, end, color: 2 } })
  const bottom = await createLine([0, 0], [10, 0])
  const right = await createLine([10, 10], [10, 0])
  const top = await createLine([0, 10], [10, 10])
  const left = await createLine([0, 0], [0, 10])
  const group = await sdk.executeCommand('GROUP', { name: 'Loop', ids: [right.id, top.id, left.id, bottom.id, right.id] })
  const before = activeRecords(drawing)
  const joined = await sdk.executeCommand('J', { ids: [right.id, bottom.id, left.id, top.id] })
  assert.equal(joined.type, 'LWPOLYLINE')
  assert.equal(joined.payload.closed, true)
  assert.equal(joined.payload.vertices.length, 4)
  assert.equal(entityLength2(joined).value, 40)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [joined.id])
  assert.equal(drawing.listEntities().length, 1)
  await sdk.executeCommand('UNDO')
  assert.deepEqual(activeRecords(drawing), before)
  await sdk.executeCommand('REDO')
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [joined.id])
})

test('JOIN tolerance closes only explicit small endpoint gaps', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'join-tolerance' })
  const first = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [5, 0] } })
  const second = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [5.001, 0], end: [10, 0] } })
  const before = drawing.serialize(), history = drawing.history
  await assert.rejects(sdk.executeCommand('JOIN', { ids: [first.id, second.id] }), KJValidationError)
  assert.equal(drawing.serialize(), before)
  assert.deepEqual(drawing.history, history)
  const joined = await sdk.executeCommand('JOIN', { ids: [first.id, second.id], tolerance: 0.002 })
  assert.deepEqual(joined.payload.vertices.map(vertex => vertex.point), [[0, 0, 0], [5, 0, 0], [10, 0, 0]])
})

test('JOIN combines unordered co-elliptical arcs as one native editable ellipse and preserves primary identity', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'join-ellipse', units: 'millimeter' })
  const make = (startParameter, endParameter, properties = {}) => sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [10, 20, 0], majorAxis: [12, 0, 0], ratio: .5, startParameter, endParameter, ...properties,
  } })
  const first = await make(0, Math.PI / 2)
  const primary = await make(Math.PI / 2, Math.PI, { color: 4, lineweight: 35 })
  const last = await make(Math.PI, Math.PI * 3 / 2)
  const marker = await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [50, 50, 0] } })
  const group = await sdk.executeCommand('GROUP', { name: 'Elliptical assembly', ids: [last.id, marker.id, first.id, primary.id] })
  sdk.activeSelection.replace([last.id, marker.id, primary.id, first.id])
  const saved = await sdk.getSelectionManager().saveNamed('Elliptical selection')
  const before = activeRecords(drawing), revision = drawing.revision

  const preview = joinEntityPayloads([last, primary, first], { primaryId: primary.id })
  assert.equal(preview.type, 'ELLIPSE'); assert.equal(preview.closed, false)
  assert.deepEqual(preview.sourceIds, [first.id, primary.id, last.id])
  close(preview.payload.startParameter, 0); close(preview.payload.endParameter, Math.PI * 3 / 2)
  assert.equal(drawing.revision, revision); assert.deepEqual(activeRecords(drawing), before)

  const joined = await sdk.executeCommand('JOIN', { id: primary.id, ids: [last.id, primary.id, first.id] })
  assert.equal(joined.id, primary.id); assert.equal(joined.handle, primary.handle); assert.equal(joined.type, 'ELLIPSE')
  assert.deepEqual(joined.payload.center, [10, 20, 0]); assert.deepEqual(joined.payload.majorAxis, [12, 0, 0])
  close(joined.payload.ratio, .5); close(joined.payload.startParameter, 0); close(joined.payload.endParameter, Math.PI * 3 / 2)
  assert.equal(joined.payload.color, 4); assert.equal(joined.payload.lineweight, 35)
  assert.equal(drawing.getObject(first.id), null); assert.equal(drawing.getObject(last.id), null)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, [joined.id, marker.id])
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, [joined.id, marker.id])
  assert.equal(drawing.validate().valid, true)

  const committed = activeRecords(drawing)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) }), { format })
    const ellipse = reopened.listEntities({ type: 'ELLIPSE' })[0]
    assert.ok(ellipse); close(ellipse.payload.startParameter, 0); close(ellipse.payload.endParameter, Math.PI * 3 / 2)
  }
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }), python = process.env.KJDRAW_PYTHON || 'python'
  const result = spawnSyncWithFileStdin(python, ['-c', 'import io,json,ezdxf,sys,os; p=os.environ.get("KJDRAW_FILE_STDIN_PATH"); s=open(p,encoding="utf-8").read() if p else sys.stdin.read(); d=ezdxf.read(io.StringIO(s)); a=d.audit(); es=list(d.modelspace().query("ELLIPSE")); print(json.dumps({"ellipses":len(es),"start":es[0].dxf.start_param,"end":es[0].dxf.end_param,"errors":len(a.errors),"fixes":len(a.fixes)}))'], dxf, { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  const audited = JSON.parse(result.stdout.trim()); assert.equal(audited.ellipses, 1); close(audited.start, 0); close(audited.end, Math.PI * 3 / 2); assert.equal(audited.errors + audited.fixes, 0)
  await sdk.executeCommand('UNDO'); assert.deepEqual(activeRecords(drawing), before)
  await sdk.executeCommand('REDO'); assert.deepEqual(activeRecords(drawing), committed)
})

test('JOIN closes a complete ellipse and rejects incompatible, disconnected, overlapping and already closed inputs atomically', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'join-ellipse-validation' })
  const make = (startParameter, endParameter, patch = {}) => sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: {
    center: [0, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter, endParameter, ...patch,
  } })
  const top = await make(0, Math.PI), bottom = await make(Math.PI, Math.PI * 2)
  const full = await sdk.executeCommand('JOIN', { ids: [bottom.id, top.id] })
  assert.equal(full.type, 'ELLIPSE'); close(full.payload.startParameter, 0); close(full.payload.endParameter, Math.PI * 2)
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const native = reopened.listEntities({ type: 'ELLIPSE' })[0]; assert.ok(native); close(native.payload.endParameter - native.payload.startParameter, Math.PI * 2)

  const rejectUnchanged = async (ids, pattern) => {
    const before = drawing.serialize(), revision = drawing.revision, history = drawing.history
    await assert.rejects(sdk.executeCommand('JOIN', { ids }), pattern)
    assert.equal(drawing.serialize(), before); assert.equal(drawing.revision, revision); assert.deepEqual(drawing.history, history)
  }
  const closed = await make(0, Math.PI * 2, { center: [30, 0, 0] })
  const incompatible = await make(0, Math.PI / 2, { center: [40, 0, 0] })
  const gap = await make(Math.PI, Math.PI * 3 / 2, { center: [40, 0, 0] })
  await rejectUnchanged([closed.id, incompatible.id], /open elliptical arcs/)
  await rejectUnchanged([incompatible.id, gap.id], /disconnected/)
  const overlapA = await make(0, Math.PI, { center: [60, 0, 0] })
  const overlapB = await make(Math.PI / 2, Math.PI * 3 / 2, { center: [60, 0, 0] })
  await rejectUnchanged([overlapA.id, overlapB.id], /disconnected|overlap/)
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [40, 0], end: [45, 0] } })
  await rejectUnchanged([incompatible.id, line.id], /not implemented/)
})

test('JOIN rejects branches, duplicate ids, cross-space, non-coplanar and protected sources atomically', async () => {
  const rejectUnchanged = async (drawing, work, predicate = error => error instanceof KJValidationError) => {
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(work(), predicate)
    assert.equal(drawing.serialize(), before)
    assert.deepEqual(drawing.history, history)
    assert.equal(drawing.revision, revision)
  }

  {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    const lines = []
    for (const end of [[10, 0], [0, 10], [-10, 0]]) lines.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end } }))
    await rejectUnchanged(drawing, () => sdk.executeCommand('JOIN', { ids: lines.map(line => line.id) }), error => /branched/.test(error.message))
    await rejectUnchanged(drawing, () => sdk.executeCommand('JOIN', { ids: [lines[0].id, lines[0].id] }), error => /unique/.test(error.message))
  }

  {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    const model = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [5, 0] } })
    const paperOwner = drawing.getObject(drawing.snapshot().spaces.layoutIds[1]).payload.blockRecordId
    let paper
    await drawing.transact('paper source', transaction => { paper = transaction.createEntity('LINE', { start: [5, 0], end: [10, 0] }, { ownerId: paperOwner }) })
    await rejectUnchanged(drawing, () => sdk.executeCommand('JOIN', { ids: [model.id, paper.id] }), error => /drawing space/.test(error.message))
  }

  {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    const first = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [5, 0, 0] } })
    const second = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [5, 0, 0], end: [10, 0, 1] } })
    await rejectUnchanged(drawing, () => sdk.executeCommand('JOIN', { ids: [first.id, second.id] }), error => /coplanar/.test(error.message))
  }

  for (const protection of [{ locked: true }, { frozen: true }, { visible: false }]) {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    const protectedLayer = await sdk.executeCommand('LAYERNEW', { name: `Protected-${Object.keys(protection)[0]}` })
    const first = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [5, 0] } })
    const second = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [5, 0], end: [10, 0], layerId: protectedLayer.id } })
    await sdk.executeCommand('LAYERUPDATE', { id: protectedLayer.id, patch: protection })
    await rejectUnchanged(drawing, () => sdk.executeCommand('JOIN', { ids: [first.id, second.id] }), error => error.details?.policy === 'layer-editability')
  }
})

test('JOIN is declared as an exact bounded topology capability', () => {
  const sdk = createKJDrawSDK()
  const capability = sdk.capabilities().commands.find(command => command.id === 'JOIN')
  assert.deepEqual(capability.capabilities, {
    domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE', 'ARC', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE'], maximumEntities: 4096,
  })
})
