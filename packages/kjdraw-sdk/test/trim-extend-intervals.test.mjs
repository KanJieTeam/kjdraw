import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument, KJValidationError, createKJDrawSDK, extendLinePayload, trimLinePayload, trimLinePayloads } from '../src/index.js'

const line = (start, end) => ({ type: 'LINE', payload: { start, end } })
const boundary = x => line([x, -10, 0], [x, 10, 0])
const endpoints = pieces => pieces.map(piece => [piece.start, piece.end])
const recordsById = records => Object.fromEntries(records.map(record => [record.id, record]))

test('TRIM removes only the picked interior interval, retaining identity, properties, XYZ and one history step', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'PROFILE' })
  const linetype = await sdk.executeCommand('LINETYPE', { name: 'PROFILE-DASH', pattern: [3, -1] })
  const ownerId = document.snapshot().spaces.paperSpaceIds[0]
  const properties = { layerId: layer.id, color: 2, trueColor: 0x234567, lineweight: 35, linetypeId: linetype.id, linetypeScale: 1.5 }
  const target = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { ...properties, start: [0, 0, 6], end: [100, 0, 16] },
    options: { ownerId, name: 'Profile', extension: { xdata: { KJ_TEST: { profile: 'A' } } } } })
  const boundaries = []
  for (const x of [70, 30]) boundaries.push(await sdk.executeCommand('CREATE', boundary(x)))
  const before = document.serialize(), revision = document.revision
  const preview = trimLinePayloads(target, boundaries, [50, 0])
  assert.deepEqual(endpoints(preview), [[[0, 0, 6], [30, 0, 9]], [[70, 0, 13], [100, 0, 16]]])
  assert.equal(document.serialize(), before)
  const primary = await sdk.executeCommand('TRIM', { id: target.id, boundaryIds: boundaries.map(item => item.id), pickPoint: [50, 0] })
  assert.equal(primary.id, target.id)
  assert.equal(primary.handle, target.handle)
  assert.equal(document.revision, revision + 1)
  const pieces = document.listEntities({ ownerId, type: 'LINE' })
  assert.equal(pieces.length, 2)
  const retained = pieces.find(piece => piece.id === target.id)
  const derived = pieces.filter(piece => piece.id !== target.id)
  assert.ok(retained)
  assert.equal(derived.length, 1)
  const extra = derived[0]
  assert.deepEqual(retained, primary)
  assert.deepEqual(endpoints([retained.payload, extra.payload]), endpoints(preview))
  for (const piece of pieces) {
    for (const [key, value] of Object.entries(properties)) assert.deepEqual(piece.payload[key], value)
    assert.equal(piece.ownerId, ownerId)
    assert.equal(piece.name, target.name)
    assert.deepEqual(piece.extension.xdata, target.extension.xdata)
  }
  assert.notEqual(extra.id, target.id)
  assert.notEqual(extra.handle, target.handle)
  assert.equal(extra.source.derivedFromId, target.id)
  for (const item of boundaries) assert.deepEqual(document.getObject(item.id), item)
  const reopened = KJDocument.open(document.serialize())
  // KJD canonicalizes object keys; entity enumeration is not drawing order.
  assert.deepEqual(recordsById(reopened.listEntities()), recordsById(document.listEntities()))
  await sdk.executeCommand('UNDO')
  assert.deepEqual(document.getObject(target.id), target)
  assert.equal(document.getObject(extra.id), null)
  assert.deepEqual(recordsById(document.listEntities()), recordsById([target, ...boundaries]))
  await sdk.executeCommand('REDO')
  assert.deepEqual(recordsById(document.listEntities()), recordsById([...pieces, ...boundaries]))
  assert.equal(document.getObject(extra.id).handle, extra.handle)
})

test('trimLinePayload remains safe for one-piece trims and rejects multiple results without dropping a side', () => {
  const target = line([0, 0, 6], [100, 0, 6]), cuts = [boundary(30), boundary(70)]
  assert.deepEqual(endpoints(trimLinePayloads(target, cuts, [50, 0])), [[[0, 0, 6], [30, 0, 6]], [[70, 0, 6], [100, 0, 6]]])
  assert.throws(() => trimLinePayload(target, cuts, [50, 0]), /use trimLinePayloads/)
  assert.deepEqual(trimLinePayload(target, cuts, [10, 0]).start, [30, 0, 6])
  assert.deepEqual(trimLinePayload(target, cuts, [90, 0]).end, [70, 0, 6])
  assert.deepEqual(trimLinePayload(target, cuts, [10, 0]).end, [100, 0, 6])
  assert.deepEqual(trimLinePayload(target, cuts, [90, 0]).start, [0, 0, 6])
  assert.deepEqual(target.payload, { start: [0, 0, 6], end: [100, 0, 6] })
})

test('TRIM orders and deduplicates cuts, preserving reversed line direction and the other intervals', () => {
  const cuts = [boundary(80), boundary(40), boundary(20), boundary(60), boundary(40)]
  assert.deepEqual(endpoints(trimLinePayloads(line([0, 0, 6], [100, 0, 16]), cuts, [50, 0])),
    [[[0, 0, 6], [40, 0, 10]], [[60, 0, 12], [100, 0, 16]]])
  assert.deepEqual(endpoints(trimLinePayloads(line([100, 0, 16], [0, 0, 6]), [boundary(30), boundary(70)], [50, 0])),
    [[[100, 0, 16], [70, 0, 13]], [[30, 0, 9], [0, 0, 6]]])
})

test('TRIM keeps no-intersection, endpoint-only and exact-cut picks atomic, while circle tangency is one boundary', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const target = await sdk.executeCommand('CREATE', line([0, 0, 6], [100, 0, 6]))
  for (const [spec, pick] of [[boundary(0), [50, 0]], [boundary(130), [50, 0]], [line([30, 2], [30, 5]), [50, 0]], [boundary(30), [30, 0]]]) {
    const cutter = await sdk.executeCommand('CREATE', spec)
    const before = document.serialize(), history = document.history
    await assert.rejects(sdk.executeCommand('TRIM', { id: target.id, boundaryIds: [cutter.id], pickPoint: pick }), KJValidationError)
    assert.equal(document.serialize(), before)
    assert.deepEqual(document.history, history)
  }
  const tangent = { type: 'CIRCLE', payload: { center: [50, 1], radius: 1 } }
  assert.deepEqual(endpoints(trimLinePayloads(target, [tangent, tangent], [20, 0])), [[[50, 0, 6], [100, 0, 6]]])
  assert.throws(() => trimLinePayloads(target, [tangent], [50, 0]), /cutting boundary/)
  const circle = { type: 'CIRCLE', payload: { center: [50, 0], radius: 20 } }
  assert.deepEqual(endpoints(trimLinePayloads(target, [circle], [50, 0])), [[[0, 0, 6], [30, 0, 6]], [[70, 0, 6], [100, 0, 6]]])
})

test('TRIM and EXTEND honor finite LINE, forward RAY and infinite XLINE boundary domains', () => {
  const target = line([0, 0, 6], [100, 0, 16])
  const ray = { type: 'RAY', payload: { origin: [30, 5], direction: [0, -1] } }
  const reverseRay = { type: 'RAY', payload: { origin: [30, 5], direction: [0, 1] } }
  const xline = { type: 'XLINE', payload: { origin: [70, 5], direction: [0, 1] } }
  assert.deepEqual(endpoints(trimLinePayloads(target, [ray, xline], [50, 0])), [[[0, 0, 6], [30, 0, 9]], [[70, 0, 13], [100, 0, 16]]])
  assert.throws(() => trimLinePayloads(target, [reverseRay], [50, 0]), /No trim intersection/)
  const short = line([0, 0, 6], [10, 0, 16])
  assert.deepEqual(extendLinePayload(short, [ray], [10, 0]).end, [30, 0, 36])
  assert.deepEqual(extendLinePayload(short, [xline], [10, 0]).end, [70, 0, 76])
  assert.throws(() => extendLinePayload(short, [reverseRay], [10, 0]), /No boundary/)
})

test('EXTEND interpolates or extrapolates XYZ from the original line, with one undo and stable identity', async () => {
  for (const [x, pick, key, expected] of [[20, [10, 0], 'end', [20, 0, 26]], [-10, [0, 0], 'start', [-10, 0, -4]]]) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument()
    const target = await sdk.executeCommand('CREATE', line([0, 0, 6], [10, 0, 16]))
    const cutter = await sdk.executeCommand('CREATE', boundary(x))
    const revision = document.revision
    const result = await sdk.executeCommand('EXTEND', { id: target.id, boundaryIds: [cutter.id], pickPoint: pick })
    assert.equal(result.id, target.id)
    assert.equal(result.handle, target.handle)
    assert.deepEqual(result.payload[key], expected)
    assert.equal(document.revision, revision + 1)
    await sdk.executeCommand('UNDO')
    assert.deepEqual(document.getObject(target.id), target)
    await sdk.executeCommand('REDO')
    assert.deepEqual(document.getObject(target.id).payload[key], expected)
  }
})

test('TRIM and EXTEND reject protected targets atomically, and locked boundaries remain usable', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Target layer' })
  const target = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { layerId: layer.id, start: [0, 0, 6], end: [100, 0, 6] } })
  const cuts = []
  for (const x of [30, 70, 120]) cuts.push(await sdk.executeCommand('CREATE', boundary(x)))
  await sdk.executeCommand('LAYERUPDATE', { id: document.getTable('layers').currentId, patch: { locked: true } })
  for (const protection of [{ locked: true }, { frozen: true }, { visible: false }]) {
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false, frozen: false, visible: true, ...protection } })
    for (const [command, boundaryIds, pickPoint] of [['TRIM', cuts.slice(0, 2).map(item => item.id), [50, 0]], ['EXTEND', [cuts[2].id], [100, 0]]]) {
      const before = document.serialize(), history = document.history
      await assert.rejects(sdk.executeCommand(command, { id: target.id, boundaryIds, pickPoint }), error => error.details?.policy === 'layer-editability')
      assert.equal(document.serialize(), before)
      assert.deepEqual(document.history, history)
    }
  }
  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { visible: true } })
  await sdk.executeCommand('TRIM', { id: target.id, boundaryIds: cuts.slice(0, 2).map(item => item.id), pickPoint: [50, 0] })
  const results = document.listEntities({ type: 'LINE' }).filter(item => item.payload.layerId === layer.id)
  assert.equal(results.length, 2)
  assert.ok(results.every(item => item.payload.start[2] === 6 && item.payload.end[2] === 6))
})
