import assert from 'node:assert/strict'
import test from 'node:test'
import { arcSweep, createKJDrawSDK, KJDocument, KJValidationError } from '../src/index.js'
import { buildKJModificationCommand, getKJModificationDefinition, validateKJModificationSelection } from '../src/modification-controls.js'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
const records = drawing => Object.fromEntries(drawing.listEntities().map(entity => [entity.id, entity]))

async function fixture(type, payload) {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Curve parts', color: 4 })
  const target = await drawing.transact('Part', tx => tx.createEntity(type, {
    center: [0, 0, 6], radius: 10, color: 2, lineweight: 35, linetypeScale: 1.5, layerId: layer.id, ...payload,
  }, { name: 'mounting-profile', extension: { xdata: { KJ_PART: { material: 'steel' } } } }))
  const create = (type, payload) => sdk.executeCommand('CREATE', { type, payload })
  return { sdk, drawing, target, layer, create }
}

async function assertHistoryAndFiles(sdk, drawing, before, after) {
  await sdk.executeCommand('UNDO')
  assert.deepEqual(records(drawing), before)
  await sdk.executeCommand('REDO')
  assert.deepEqual(records(drawing), after)
  assert.deepEqual(records(KJDocument.open(drawing.serialize())), after)
  const reopened = await sdk.fileAdapters.read(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  const expected = [...drawing.listEntities({ type: 'ARC' })].sort((a, b) => a.payload.startAngle - b.payload.startAngle)
  const actual = reopened.listEntities({ type: 'ARC' })
  assert.equal(actual.length, expected.length)
  const remaining = [...actual]
  for (const original of expected) {
    const middle = original.payload.startAngle + arcSweep(original.payload) / 2
    const index = remaining.findIndex(arc => {
      const candidate = arc.payload.startAngle + arcSweep(arc.payload) / 2
      return Math.abs(Math.cos(candidate) - Math.cos(middle)) < 1e-9 && Math.abs(Math.sin(candidate) - Math.sin(middle)) < 1e-9
    })
    assert.notEqual(index, -1, 'DXF preserves the actual arc, including its middle')
    const arc = remaining.splice(index, 1)[0]
    near(Math.abs(arcSweep(arc.payload)), Math.abs(arcSweep(original.payload)))
    assert.deepEqual(arc.payload.center, [0, 0, 6])
    for (const key of ['radius', 'color', 'lineweight', 'linetypeScale']) assert.equal(arc.payload[key], original.payload[key])
    assert.equal(reopened.getObject(arc.payload.layerId).name, 'Curve parts')
  }
}

test('TRIM CIRCLE produces one derived ARC without changing immutable type identity, in one undoable transaction', async () => {
  const { sdk, drawing, target, create } = await fixture('CIRCLE', {})
  const cutter = await create('LINE', { start: [-15, 0, 6], end: [15, 0, 6] })
  const before = records(drawing), revision = drawing.revision
  const built = buildKJModificationCommand('trim', { ids: [target.id, cutter.id], points: [[0, 10]] })
  const arc = await sdk.executeCommand(built.command, built.arguments)
  assert.equal(drawing.revision, revision + 1)
  assert.equal(drawing.getObject(target.id), null)
  assert.equal(arc.type, 'ARC')
  assert.notEqual(arc.id, target.id)
  assert.notEqual(arc.handle, target.handle)
  assert.deepEqual(arc.source, { derivedFromId: target.id, derivedFromHandle: target.handle })
  assert.equal(arc.ownerId, target.ownerId)
  assert.equal(arc.name, target.name)
  assert.deepEqual(arc.extension.xdata, target.extension.xdata)
  near(arcSweep(arc.payload), Math.PI)
  near(Math.sin(arc.payload.startAngle + arcSweep(arc.payload) / 2), -1)
  assert.deepEqual(drawing.getObject(cutter.id), cutter)
  await assertHistoryAndFiles(sdk, drawing, before, records(drawing))
})

test('TRIM clockwise ARC keeps both directed sides, original primary identity, styles and elevation', async () => {
  const { sdk, drawing, target, create } = await fixture('ARC', { startAngle: Math.PI, endAngle: 0, clockwise: true })
  const cutters = await Promise.all([-5, 5].map(x => create('LINE', { start: [x, 0, 6], end: [x, 15, 6] })))
  const before = records(drawing), revision = drawing.revision
  const primary = await sdk.executeCommand('TRIM', { id: target.id, boundaryIds: cutters.map(entity => entity.id), pickPoint: [0, 10] })
  assert.equal(primary.id, target.id)
  assert.equal(primary.handle, target.handle)
  assert.equal(drawing.revision, revision + 1)
  const arcs = drawing.listEntities({ type: 'ARC' })
  assert.equal(arcs.length, 2)
  near(primary.payload.startAngle, Math.PI)
  near(primary.payload.endAngle, 2 * Math.PI / 3)
  const derived = arcs.find(arc => arc.id !== target.id)
  near(derived.payload.startAngle, Math.PI / 3)
  near(derived.payload.endAngle, 0)
  for (const arc of arcs) {
    assert.equal(arc.payload.clockwise, true)
    near(arcSweep(arc.payload), -Math.PI / 3)
    assert.deepEqual(arc.extension.xdata, target.extension.xdata)
  }
  await assertHistoryAndFiles(sdk, drawing, before, records(drawing))
})

test('EXTEND ARC grows only the picked endpoint to the nearest boundary and reopens correctly', async () => {
  const { sdk, drawing, target, create } = await fixture('ARC', { startAngle: 0, endAngle: Math.PI / 2, clockwise: false })
  const cutter = await create('LINE', { start: [-5, 0, 6], end: [-5, 15, 6] })
  const before = records(drawing), revision = drawing.revision
  const arc = await sdk.executeCommand('EXTEND', { id: target.id, boundaryIds: [cutter.id], pickPoint: [0, 10] })
  assert.equal(arc.id, target.id)
  assert.equal(arc.handle, target.handle)
  assert.equal(drawing.revision, revision + 1)
  near(arc.payload.startAngle, 0)
  near(arc.payload.endAngle, 2 * Math.PI / 3)
  await assertHistoryAndFiles(sdk, drawing, before, records(drawing))
})

test('curve edits reject protected layers, self-boundaries, coincident circles and invalid picks atomically', async () => {
  const { sdk, drawing, target, layer, create } = await fixture('CIRCLE', {})
  const cutter = await create('LINE', { start: [-15, 0, 6], end: [15, 0, 6] })
  const coincident = await create('CIRCLE', { center: [0, 0, 6], radius: 10 })
  for (const [boundaryIds, pickPoint] of [[[target.id], [0, 10]], [[coincident.id], [0, 10]], [[cutter.id], [0, 0]], [[cutter.id], [10, 0]]]) {
    const before = drawing.serialize(), revision = drawing.revision
    await assert.rejects(sdk.executeCommand('TRIM', { id: target.id, boundaryIds, pickPoint }), KJValidationError)
    assert.equal(drawing.serialize(), before)
    assert.equal(drawing.revision, revision)
  }
  for (const protection of [{ locked: true }, { frozen: true }, { visible: false }]) {
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false, frozen: false, visible: true, ...protection } })
    const before = drawing.serialize(), revision = drawing.revision
    await assert.rejects(sdk.executeCommand('TRIM', { id: target.id, boundaryIds: [cutter.id], pickPoint: [0, 10] }))
    assert.equal(drawing.serialize(), before)
    assert.equal(drawing.revision, revision)
  }
})

test('shared modification preflight exposes the same curve targets and boundary restrictions in both languages', () => {
  const entity = (type, id = type) => ({ id, kind: 'entity', type })
  for (const locale of ['en', 'zh']) {
    for (const type of ['LINE', 'ARC', 'CIRCLE', 'ELLIPSE']) assert.doesNotThrow(() => validateKJModificationSelection(getKJModificationDefinition('trim'), [entity(type, 'target'), entity('LINE', 'boundary')], locale))
    for (const type of ['LINE', 'ARC']) assert.doesNotThrow(() => validateKJModificationSelection(getKJModificationDefinition('extend'), [entity(type, 'target'), entity('RAY', 'boundary')], locale))
    assert.throws(() => validateKJModificationSelection(getKJModificationDefinition('extend'), [entity('CIRCLE'), entity('LINE')], locale), locale === 'zh' ? /请先选择目标/ : /target first/)
    assert.throws(() => validateKJModificationSelection(getKJModificationDefinition('trim'), [entity('ARC'), entity('SPLINE')], locale), locale === 'zh' ? /边界必须/ : /Boundaries must/)
    assert.throws(() => validateKJModificationSelection(getKJModificationDefinition('trim'), [null, entity('LINE')], locale))
  }
})
