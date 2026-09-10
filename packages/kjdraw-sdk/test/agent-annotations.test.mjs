import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../src/sdk.js'
import { buildAgentAnnotationEntities as compile } from '../src/agent-annotations.js'
import { projectDimension } from '../src/geometry/annotation.js'

const ref = (id, feature, source = 'document') => ({ source, id, ...(feature ? { feature } : {}) })
const linear = (type = 'ALIGNED') => ({ type, from: ref('line', 'start'), to: ref('line', 'end'), position: { x: 5, y: 10 }, height: 2.5, ...(type === 'ROTATED' ? { rotationDegrees: 0 } : {}) })
const radial = (type = 'RADIUS', source = ref('circle')) => ({ type, source, directionDegrees: 0, position: { x: 15, y: 15 }, height: 2.5 })
const text = () => ({ text: 'Machine all edges', position: { x: 0, y: 20 }, height: 2.5, rotationDegrees: 0 })
async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Base geometry', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [3, 4, 0] }, { id: 'line' })
    tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5 }, { id: 'circle' })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [12, 0], [12, 8]], closed: true }, { id: 'poly' })
    tx.createEntity('CIRCLE', { center: [0, 0, 1], radius: 5 }, { id: 'raised' })
    tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5, normal: [0, 1, 0] }, { id: 'tilted' })
    const paper = tx.createLayout({ name: 'Paper' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [3, 4, 0] }, { id: 'paper-line', ownerId: paper.payload.blockRecordId })
  })
  return { sdk, document }
}
const input = (document, dimensions = [linear()], texts = []) => ({ expectedRevision: document.revision, units: 'millimeter', texts, dimensions })

test('native annotations derive measurements from actual references and compilation is deeply frozen and read-only', async () => {
  const { document } = await fixture(), before = document.serialize(), state = document.snapshot()
  const result = compile(document, input(document, [linear(), linear('ROTATED'), radial(), radial('DIAMETER')], [text()]))
  assert.deepEqual(result.map(x => x.type), ['TEXT', 'DIMENSION', 'DIMENSION', 'DIMENSION', 'DIMENSION'])
  assert.deepEqual(result.slice(1).map(x => projectDimension(x.payload).measurement), [5, 3, 5, 10])
  assert.deepEqual(result.slice(1).map(x => projectDimension(x.payload).label.text), ['5', '3', 'R5', '⌀10'])
  assert.equal(result[1].payload.textOverride, null)
  assert.equal(result[1].payload.measurement, null)
  assert.equal(result[1].payload.textPosition, undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result, 'envelope payloads must not retain undefined optional normalization fields')
  assert.ok(result.every(x => x.options.ownerId === state.spaces.modelSpaceId))
  assert.equal(new Set(result.map(x => x.options.id)).size, result.length)
  assert.ok(Object.isFrozen(result[1].payload.definitionPoints[0])); assert.throws(() => { result[0].payload.text = 'changed' }, TypeError)
  assert.equal(document.snapshot(), state); assert.equal(document.serialize(), before)
})

test('proposal references resolve semantic keys to real staged entities and polyline vertices use exact indexed geometry', async () => {
  const { document } = await fixture(), ownerId = document.snapshot().spaces.modelSpaceId
  const base = { type: 'CIRCLE', payload: { center: [30, 40, 0], radius: 2.5 }, options: { id: 'staged-circle', ownerId } }
  const between = { ...linear(), from: { ...ref('poly', 'vertex'), vertexIndex: 0 }, to: { ...ref('poly', 'vertex'), vertexIndex: 1 } }
  const result = compile(document, input(document, [radial('RADIUS', ref('circles:0', undefined, 'proposal')), between]), { baseEntities: { 'circles:0': base } })
  assert.deepEqual(result.map(x => projectDimension(x.payload).measurement), [2.5, 12])
  assert.deepEqual(result[0].payload.definitionPoints, [[30, 40, 0], [32.5, 40, 0]])
  base.payload.radius = 999; assert.equal(projectDimension(result[0].payload).measurement, 2.5)
  assert.equal(document.getObject('staged-circle'), null)
  assert.throws(() => compile(document, input(document, [radial('RADIUS', ref('unknown', undefined, 'proposal'))])), /resolve/)
})

test('annotation output commits as one batch and saves native dimension picture blocks to DXF without losing measurements', async () => {
  const { sdk, document } = await fixture(), revision = document.revision
  const result = compile(document, input(document, [linear(), linear('ROTATED'), radial(), radial('DIAMETER')], [text()]))
  await sdk.executeCommand('CREATEBATCH', { entities: result })
  assert.equal(document.revision, revision + 1)
  const dxf = String(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }))
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const dimensions = reopened.listEntities({ type: 'DIMENSION' })
  assert.deepEqual(dimensions.map(x => projectDimension(x.payload).measurement), [5, 3, 5, 10])
  for (const dim of dimensions) {
    const block = reopened.getTable('blockRecords').records.find(x => x.name === dim.payload.blockName)
    assert.ok(block); assert.ok(reopened.listEntities({ ownerId: block.id }).length >= 3)
  }
  await sdk.executeCommand('UNDO'); assert.equal(document.listEntities({ type: 'DIMENSION' }).length, 0)
  await sdk.executeCommand('REDO'); assert.equal(document.listEntities({ type: 'DIMENSION' }).length, 4)
  if (process.env.KJDRAW_PYTHON) {
    const python = spawnSync(process.env.KJDRAW_PYTHON, ['-c', 'import sys,io,json,ezdxf; d=ezdxf.read(io.StringIO(sys.stdin.read())); a=d.audit(); print(json.dumps({"values":[e.get_measurement() for e in d.modelspace().query("DIMENSION")],"errors":len(a.errors),"fixes":len(a.fixes)}))'], { input: dxf, encoding: 'utf8', timeout: 30000 })
    assert.equal(python.status, 0, python.stderr)
    assert.deepEqual(JSON.parse(python.stdout), { values: [5, 3, 5, 10], errors: 0, fixes: 0 })
  }
})

test('stale, unknown, unsupported, cross-owner, non-XY and forged dimension values are rejected', async () => {
  const { document } = await fixture()
  const cases = [
    { ...input(document), expectedRevision: document.revision - 1 }, { ...input(document), units: 'meter' },
    input(document, [{ ...linear(), measurement: 999 }]), input(document, [{ ...linear(), textOverride: '999' }]),
    input(document, [{ ...linear(), type: 'ANGULAR' }]), input(document, [{ ...linear(), to: ref('absent', 'end') }]),
    input(document, [{ ...linear(), to: ref('paper-line', 'end') }]), input(document, [radial('RADIUS', ref('raised'))]),
    input(document, [radial('RADIUS', ref('tilted'))]), input(document, [radial('DIAMETER', ref('line'))]),
    input(document, [{ ...linear(), from: { ...ref('line', 'start'), vertexIndex: 0 } }]),
    input(document, [{ ...linear(), from: { ...ref('poly', 'vertex'), vertexIndex: 30 } }]),
    input(document, [{ ...linear(), from: ref('line', 'start'), to: ref('line', 'start') }]),
    input(document, [], [{ ...text(), text: 'first\nsecond' }]), input(document, [], [{ ...text(), height: 0 }]),
  ]
  for (const bad of cases) assert.throws(() => compile(document, bad))
  for (const badOptions of [{ baseEntities: null }, { baseEntities: [] }, { unknown: {} }]) assert.throws(() => compile(document, input(document), badOptions))
  const ownerId = document.snapshot().spaces.modelSpaceId
  assert.throws(() => compile(document, input(document), { baseEntities: { x: { type: 'CIRCLE', payload: { center: [0, 0], radius: 5 }, options: { id: 'circle', ownerId } } } }), /new and unique/)
})

test('descriptor validation never invokes getters and rejects cycles, prototypes, sparse arrays and input/output budgets', async () => {
  const { document } = await fixture(); let reads = 0
  const getter = input(document); Object.defineProperty(getter, 'units', { enumerable: true, get() { reads++; return 'millimeter' } })
  assert.throws(() => compile(document, getter), /accessors/)
  const array = []; Object.defineProperty(array, '0', { enumerable: true, get() { reads++; return text() } })
  assert.throws(() => compile(document, input(document, [], array)), /accessors/); assert.equal(reads, 0)
  const circular = input(document); circular.loop = circular
  for (const bad of [circular, Object.assign(Object.create({}), input(document)), input(document, [], Array(2)), { ...input(document), [Symbol('hidden')]: 1 }]) assert.throws(() => compile(document, bad))
  assert.equal(compile(document, input(document, [], Array.from({ length: 64 }, text))).length, 64)
  assert.throws(() => compile(document, input(document, [], Array.from({ length: 65 }, text))), /1–64/)
  assert.throws(() => compile(document, input(document, [], Array.from({ length: 64 }, () => ({ ...text(), text: '汉'.repeat(1000) })))), /byte budget/)
})

test('recompilation reads geometry after MOVE, undo and redo instead of cached dimensions', async () => {
  const { sdk, document } = await fixture()
  const dimension = { ...linear(), from: ref('circle', 'center'), to: ref('line', 'end') }
  const measure = () => projectDimension(compile(document, input(document, [dimension]))[0].payload).measurement
  assert.equal(measure(), 5)
  const old = input(document, [dimension]); await sdk.executeCommand('MOVE', { ids: ['line'], dx: 3, dy: 4 })
  assert.throws(() => compile(document, old), /revision/i); assert.equal(measure(), 10)
  await sdk.executeCommand('UNDO'); assert.equal(measure(), 5)
  await sdk.executeCommand('REDO'); assert.equal(measure(), 10)
})


test('circle quadrants and actual arc endpoints/sweeps provide geometry-derived annotation anchors', async () => {
  const { document } = await fixture()
  await document.transact('Arcs', tx => {
    tx.createEntity('ARC', { center: [90, 50, 0], radius: 14.5, startAngle: Math.PI / 2, endAngle: 3 * Math.PI / 2 }, { id: 'left-arc' })
    tx.createEntity('ARC', { center: [90, 50, 0], radius: 14.5, startAngle: Math.PI / 2, endAngle: 3 * Math.PI / 2, clockwise: true }, { id: 'right-arc' })
  })
  const dimension = { ...linear('ROTATED'), from: ref('left-arc', 'left'), to: ref('right-arc', 'right'), rotationDegrees: 0 }
  assert.ok(Math.abs(projectDimension(compile(document, input(document, [dimension]))[0].payload).measurement - 29) < 1e-9)
  const ends = { ...linear(), from: ref('left-arc', 'start'), to: ref('left-arc', 'end') }
  assert.ok(Math.abs(projectDimension(compile(document, input(document, [ends]))[0].payload).measurement - 29) < 1e-9)
  for (const [from, to] of [['left', 'right'], ['bottom', 'top']]) {
    const diameter = { ...linear(), from: ref('circle', from), to: ref('circle', to) }
    assert.equal(projectDimension(compile(document, input(document, [diameter]))[0].payload).measurement, 10)
  }
  assert.throws(() => compile(document, input(document, [{ ...dimension, from: ref('left-arc', 'right') }])), /actual ARC sweep/)
  assert.throws(() => compile(document, input(document, [{ ...dimension, to: ref('right-arc', 'left') }])), /actual ARC sweep/)
  assert.throws(() => compile(document, input(document, [radial('RADIUS', ref('left-arc'))])), /actual ARC sweep/)
  assert.equal(projectDimension(compile(document, input(document, [{ ...radial('RADIUS', ref('left-arc')), directionDegrees: 180 }]))[0].payload).measurement, 14.5)
})
