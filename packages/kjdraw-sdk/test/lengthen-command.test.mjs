import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJValidationError, createKJDrawSDK, entityLength2 } from '../src/index.js'

const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)

test('LENGTHEN keeps LINE identity, direction, style and XYZ slope across total, delta, percent and dynamic modes', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'lengthen-line' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 2], end: [10, 0, 4], color: 3, lineweight: 25 } })
  const original = drawing.getObject(line.id), revision = drawing.revision

  let result = await sdk.executeCommand('LENGTHEN', { id: line.id, mode: 'TOTAL', value: 15, pickPoint: [9, 0] })
  assert.equal(result.id, line.id); assert.equal(result.handle, line.handle)
  assert.deepEqual(result.payload.start, [0, 0, 2]); assert.deepEqual(result.payload.end, [15, 0, 5])
  assert.equal(result.payload.color, 3); assert.equal(result.payload.lineweight, 25); close(entityLength2(result).value, 15)
  result = await sdk.executeCommand('LENGTHEN', { id: line.id, delta: -5, endpoint: 'start' })
  assert.deepEqual(result.payload.start, [5, 0, 3]); close(entityLength2(result).value, 10)
  result = await sdk.executeCommand('LENGTHEN', { id: line.id, percent: 50, endpoint: 'end' })
  close(entityLength2(result).value, 5); close(result.payload.end[2], 4)
  result = await sdk.executeCommand('LENGTHEN', { id: line.id, mode: 'DYNAMIC', targetPoint: [13, 7], endpoint: 'end' })
  close(entityLength2(result).value, 8); close(result.payload.end[0], 13); close(result.payload.end[1], 0)
  assert.equal(drawing.revision, revision + 4)

  await sdk.executeCommand('UNDO'); close(entityLength2(drawing.getObject(line.id)).value, 5)
  await sdk.executeCommand('UNDO'); close(entityLength2(drawing.getObject(line.id)).value, 10)
  await sdk.executeCommand('UNDO'); close(entityLength2(drawing.getObject(line.id)).value, 15)
  await sdk.executeCommand('UNDO'); assert.deepEqual(drawing.getObject(line.id), original)
  for (let index = 0; index < 4; index += 1) await sdk.executeCommand('REDO')
  close(entityLength2(drawing.getObject(line.id)).value, 8)
})

test('LENGTHEN changes either ARC endpoint with exact directed length and round-trips through KJD and DXF', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'lengthen-arc' })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: {
    center: [5, 5, 6], radius: 10, startAngle: 0, endAngle: Math.PI / 2, clockwise: false, color: 5,
  } })
  let result = await sdk.executeCommand('LENGTHEN', { id: arc.id, totalLength: 10 * Math.PI, endpoint: 'end' })
  assert.equal(result.id, arc.id); assert.equal(result.handle, arc.handle); assert.equal(result.payload.color, 5)
  close(result.payload.startAngle, 0); close(result.payload.endAngle, Math.PI); close(entityLength2(result).value, 10 * Math.PI)
  result = await sdk.executeCommand('LENGTHEN', { id: arc.id, mode: 'DELTA', value: -5 * Math.PI, endpoint: 'start' })
  close(result.payload.startAngle, Math.PI / 2); close(result.payload.endAngle, Math.PI); close(entityLength2(result).value, 5 * Math.PI)
  result = await sdk.executeCommand('LENGTHEN', { id: arc.id, percent: 200, pickPoint: [5, -5] })
  close(result.payload.startAngle, Math.PI / 2); close(result.payload.endAngle, 3 * Math.PI / 2); close(entityLength2(result).value, 10 * Math.PI)
  result = await sdk.executeCommand('LENGTHEN', { id: arc.id, mode: 'DYNAMIC', point: [15, 5], endpoint: 'start' })
  close(result.payload.startAngle, 0); close(result.payload.endAngle, 3 * Math.PI / 2); close(entityLength2(result).value, 15 * Math.PI)
  assert.equal(result.payload.center[2], 6)

  const serialized = drawing.serialize()
  assert.equal(KJDocument.open(serialized).serialize(), serialized)
  const reopened = await sdk.fileAdapters.read(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  const reopenedArc = reopened.listEntities({ type: 'ARC' })[0]
  assert.ok(reopenedArc); close(entityLength2(reopenedArc).value, 15 * Math.PI); assert.equal(reopenedArc.payload.center[2], 6)
})

test('LENGTHEN rejects ambiguous, collapsed, full-circle and protected edits without mutation', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'lengthen-reject' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Lengthen target' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0], layerId: layer.id } })
  const arc = await sdk.executeCommand('CREATE', { type: 'ARC', payload: { center: [20, 0], radius: 5, startAngle: 0, endAngle: Math.PI } })
  const rejectUnchanged = async (work, predicate = error => error instanceof KJValidationError) => {
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(work(), predicate)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  }
  await rejectUnchanged(() => sdk.executeCommand('LENGTHEN', { id: line.id, value: 5, pickPoint: [5, 0] }), error => /closer/.test(error.message))
  await rejectUnchanged(() => sdk.executeCommand('LENGTHEN', { id: line.id, delta: -10, endpoint: 'end' }))
  await rejectUnchanged(() => sdk.executeCommand('LENGTHEN', { id: arc.id, totalLength: 10 * Math.PI, endpoint: 'end' }), error => /less than a full circle/.test(error.message))
  await rejectUnchanged(() => sdk.executeCommand('LENGTHEN', { id: arc.id, mode: 'DYNAMIC', point: [20, 0], endpoint: 'end' }), error => /center/.test(error.message))
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  await rejectUnchanged(() => sdk.executeCommand('LENGTHEN', { id: line.id, value: 20, endpoint: 'end' }), error => error.details?.policy === 'layer-editability')
})

test('LENGTHEN advertises its exact modes and stable identity', () => {
  const capability = createKJDrawSDK().capabilities().commands.find(command => command.id === 'LENGTHEN')
  assert.deepEqual(capability.capabilities, {
    domain: 'topology', precision: 'exact', supportedEntityTypes: ['LINE', 'ARC'], modes: ['TOTAL', 'DELTA', 'PERCENT', 'DYNAMIC'], stableIdentity: true,
  })
})
