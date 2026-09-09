import test from 'node:test'
import assert from 'node:assert/strict'
import { hatchPatternLines, hatchStrokes } from '../src/geometry/hatch.js'
import { transformEntityPayload } from '../src/geometry/transform.js'
import { rotation3, scale3, translation3 } from '../src/geometry/matrix3.js'
import { createKJDrawSDK } from '../src/sdk.js'

const family = { angle: 0, base: [1, 0], offset: [2, 4], dashes: [2, -2, 0, -2] }
const payload = () => ({ patternName: 'ORIGINAL_TEST', solid: false, patternAngle: 0, patternScale: 1, patternLines: [family], boundaryLoops: [{ vertices: [[0, 0], [20, 0], [20, 20], [0, 20]] }, { external: false, vertices: [[5, 5], [15, 5], [15, 15], [5, 15]] }] })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)

test('custom dash rows preserve signed offsets, gaps, dots and viewport phase', () => {
  const result = hatchStrokes([family], [0, 0, 12, 4])
  assert.deepEqual(result.segments, [[[1, 0], [3, 0]], [[7, 0], [9, 0]], [[3, 4], [5, 4]], [[9, 4], [11, 4]]])
  assert.deepEqual(result.dots, [[5, 0], [11, 0], [1, 4], [7, 4]])
  const crop = hatchStrokes([family], [2, 0, 10, 0])
  assert.deepEqual(crop.segments, [[[2, 0], [3, 0]], [[7, 0], [9, 0]]])
  assert.deepEqual(crop.dots, [[5, 0]])
  const negative = hatchStrokes([{ ...family, offset: [-2, -4] }], [0, 0, 12, 4])
  assert.deepEqual(negative.segments.slice().sort(), result.segments.slice().sort())
})

test('pattern work is bounded without replacing spacing or changing negative-coordinate phase', () => {
  const result = hatchStrokes([{ ...family, offset: [0, .0001] }], [-1e6, -1e6, 1e6, 1e6], 37)
  assert.equal(result.limited, true); assert.equal(result.work, 37)
  assert.ok(result.segments.length + result.dots.length <= 37)
  assert.throws(() => hatchPatternLines({ patternLines: [{ ...family, dashes: [Infinity] }] }), /Invalid/)
  assert.throws(() => hatchStrokes([{ ...family, dashes: [0] }], [0, 0, 10, 10]), /Invalid/)
  assert.throws(() => hatchPatternLines({ rawTags: [{ code: 78, value: 1000000000 }] }), /Invalid/)
})

test('collinear continuous rows and whole-cycle translations paint one exact locus', () => {
  const continuous = hatchStrokes([{ angle: 0, base: [2, 3], offset: [7, 0], dashes: [] }], [0, 0, 20, 20])
  assert.deepEqual(continuous.segments, [[[0, 3], [20, 3]]]); assert.equal(continuous.work, 1)
  const dashed = hatchStrokes([{ ...family, offset: [6, 0] }], [0, 0, 12, 4])
  assert.deepEqual(dashed.segments, [[[1, 0], [3, 0]], [[7, 0], [9, 0]]])
  assert.throws(() => hatchStrokes([{ ...family, offset: [1, 0] }], [0, 0, 12, 4]), /Invalid/)
})

test('custom pattern transforms retain actual bases, directions, dash lengths and offset vectors', () => {
  const moved = transformEntityPayload('HATCH', payload(), translation3(8, -3))
  assert.deepEqual(hatchPatternLines(moved)[0], { ...family, base: [9, -3] })
  const rotated = hatchPatternLines(transformEntityPayload('HATCH', moved, rotation3(Math.PI / 2)))[0]
  near(rotated.base[0], 3); near(rotated.base[1], 9); near(rotated.offset[0], -4); near(rotated.offset[1], 2); near(rotated.angle, Math.PI / 2)
  const scaled = hatchPatternLines(transformEntityPayload('HATCH', moved, scale3(2, 2)))[0]
  assert.deepEqual(scaled.base, [18, -6]); assert.deepEqual(scaled.dashes, [4, -4, 0, -4])
  const mirror = hatchPatternLines(transformEntityPayload('HATCH', payload(), scale3(-1, 1)))[0]
  near(Math.cos(mirror.angle), -1); assert.deepEqual(mirror.base, [-1, 0]); assert.deepEqual(mirror.offset, [-2, 4])
})

test('rotated and scaled imported line definitions are applied once, including later property edits', () => {
  const rawTags = [[52, 30], [41, 2], [78, 1], [53, 75], [43, 3], [44, 4], [45, -2], [46, 6], [79, 2], [49, 4], [49, -2]].map(([code, value]) => ({ code, value: String(value) }))
  const imported = { patternAngle: Math.PI / 6, patternScale: 2, rawTags }
  const first = hatchPatternLines(imported)[0]
  near(first.angle, 75 * Math.PI / 180); assert.deepEqual(first.base, [3, 4]); assert.deepEqual(first.offset, [-2, 6]); assert.deepEqual(first.dashes, [4, -2])
  const edited = hatchPatternLines({ ...imported, patternAngle: Math.PI / 6 + Math.PI / 2, patternScale: 4 })[0]
  near(edited.angle, 165 * Math.PI / 180); near(edited.base[0], -8); near(edited.base[1], 6); near(edited.offset[0], -12); near(edited.offset[1], -4)
  assert.deepEqual(edited.dashes, [8, -4])
})

test('custom pattern DXF import, move, rotate, scale, undo and reopen preserve pattern geometry', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument()
  await doc.transact('custom hatch', tx => tx.createEntity('HATCH', payload()))
  const dxf = await sdk.writeDocument(doc, { format: 'DXF', version: '2018' })
  const importedSDK = createKJDrawSDK(), imported = await importedSDK.readDocument(dxf, { format: 'DXF' })
  const hatch = imported.listEntities({ type: 'HATCH' })[0]
  assert.deepEqual(hatchPatternLines(hatch.payload), [family])
  await importedSDK.executeCommand('MOVE', { id: hatch.id, dx: 8, dy: -3 })
  assert.deepEqual(hatchPatternLines(imported.getObject(hatch.id).payload)[0].base, [9, -3])
  const output = await importedSDK.writeDocument(imported, { format: 'DXF', version: '2018' })
  const reopened = await createKJDrawSDK().readDocument(output, { format: 'DXF' })
  assert.deepEqual(hatchPatternLines(reopened.listEntities()[0].payload)[0].base, [9, -3])
  assert.deepEqual(reopened.listEntities()[0].payload.boundaryLoops[1].vertices[0].point, [13, 2, 0])
  await importedSDK.executeCommand('UNDO'); assert.deepEqual(hatchPatternLines(imported.getObject(hatch.id).payload), [family])
  await importedSDK.executeCommand('REDO'); assert.deepEqual(hatchPatternLines(imported.getObject(hatch.id).payload)[0].base, [9, -3])
})
