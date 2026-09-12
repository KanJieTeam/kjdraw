import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJValidationError, createKJDrawSDK, entityLength2 } from '../src/index.js'

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
    const protectedLayer = await sdk.executeCommand('LAYERNEW', { name: `Protected ${JSON.stringify(protection)}` })
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
    domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE', 'ARC', 'LWPOLYLINE', 'POLYLINE'], maximumEntities: 4096,
  })
})
