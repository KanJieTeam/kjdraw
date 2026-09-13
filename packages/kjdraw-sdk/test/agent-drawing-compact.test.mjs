import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createKjpPackage, openKjpPackage } from '../src/project-package.js'

const tool = 'cad_propose_drawing_compact'
const empty = () => ({ expectedRevision: 0, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [] })
const drawing = () => ({
  ...empty(), lines: [[-12.5, 7, 43.75, -8]], circles: [[5.5, -9, 2.25]],
  arcs: [[14, 19, 6, 270, 90]],
  ellipses: [[20, 15, 8, 6, .4, 15, 300]],
  polylines: [{ points: [[-20, -10], [30, -10], [25, 40], [-20, 35]], closed: true }],
})
function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
function geometry(entities) { return entities.map(({ type, payload }) => ({ type, payload })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }

test('compact native drawing matches the original tool, previews without mutation and saves as one undoable edit', async () => {
  const { sdk, document, session } = fixture(), reference = fixture()
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [777, 888, 0] } })
  const retained = geometry(document.listEntities()), before = document.serialize()
  const proposed = value(await session.call(tool, { ...drawing(), expectedRevision: 1 }))
  const original = value(await reference.session.call('cad_propose_drawing', {
    ...empty(),
    lines: [{ start: { x: -12.5, y: 7 }, end: { x: 43.75, y: -8 } }],
    circles: [{ center: { x: 5.5, y: -9 }, radius: 2.25 }],
    arcs: [{ center: { x: 14, y: 19 }, radius: 6, startDegrees: 270, endDegrees: 90 }],
    ellipses: [{ center: { x: 20, y: 15 }, majorAxis: { x: 8, y: 6 }, ratio: .4, startDegrees: 15, endDegrees: 300 }],
    polylines: [{ vertices: [{ x: -20, y: -10 }, { x: 30, y: -10 }, { x: 25, y: 40 }, { x: -20, y: 35 }], closed: true }],
  }))
  assert.equal(document.serialize(), before)
  assert.equal(proposed.status, 'awaiting-host-approval')
  assert.equal(proposed.command, 'CREATEBATCH')
  assert.equal(proposed.preview.before.length, 0)
  const withoutLayer = entities => entities.map(({ type, payload: { layerId, ...payload } }) => ({ type, payload }))
  assert.deepEqual(geometry(withoutLayer(proposed.preview.after)), geometry(withoutLayer(original.preview.after)))
  value(await session.approve(proposed.planId, 'reviewer'))
  assert.equal(document.revision, 2)
  for (const expected of proposed.preview.after) assert.deepEqual(document.getObject(expected.id).payload, expected.payload)
  for (const format of ['KJD', 'DXF']) {
    const artifact = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopenedDocument = await createKJDrawSDK().readDocument(artifact, { format })
    const ellipse = reopenedDocument.listEntities({ type: 'ELLIPSE' })[0]
    assert.deepEqual(ellipse.payload.center, [20, 15, 0])
    assert.deepEqual(ellipse.payload.majorAxis, [8, 6, 0])
    assert.equal(ellipse.payload.ratio, .4)
    assert.ok(Math.abs(ellipse.payload.startParameter - 15 * Math.PI / 180) < 1e-12)
    assert.ok(Math.abs(ellipse.payload.endParameter - 300 * Math.PI / 180) < 1e-12)
  }
  const saved = await createKjpPackage({ projectId: 'compact-edit', title: 'Compact geometry', drawings: { [document.id]: document }, activeDrawing: document.id })
  const reopened = await openKjpPackage(saved)
  assert.deepEqual(geometry(reopened.activeDocument.listEntities()), geometry(document.listEntities()))
  await sdk.executeCommand('UNDO')
  assert.deepEqual(geometry(document.listEntities()), retained)
  await sdk.executeCommand('REDO')
  assert.deepEqual(geometry(document.listEntities()), geometry(reopened.activeDocument.listEntities()))
})

test('compact total-entity boundary is shared across groups and accepts exactly 64', async () => {
  const { document, session } = fixture(), source = document.serialize()
  const circles = Array.from({ length: 63 }, (_, i) => [i * 3, 0, 1])
  const good = { ...empty(), circles, lines: [[0, 4, 10, 4]] }
  const tooMany = { ...good, arcs: [[0, 0, 1, 0, 90]] }
  assert.equal((await session.call(tool, tooMany)).ok, false)
  assert.equal(document.serialize(), source)
  const proposed = value(await session.call(tool, good))
  assert.equal(proposed.preview.after.length, 64)
  assert.equal(document.serialize(), source)
  value(await session.approve(proposed.planId, 'reviewer'))
  assert.equal(document.listEntities().length, 64)
})

test('malformed tuples and invalid decoded geometry are rejected atomically', async () => {
  const { document, session } = fixture(), source = document.serialize()
  const cases = [
    empty(),
    { ...empty(), lines: [[0, 1, 2]] },
    { ...empty(), lines: [[0, 1, 2, 3, 4]] },
    { ...empty(), lines: [[0, 1, 0, 1]] },
    { ...empty(), lines: [[0, 1, '2', 3]] },
    { ...empty(), circles: [[0, 0, 0]] },
    { ...empty(), circles: [[0, 0, -1]] },
    { ...empty(), circles: [[0, 0, 1, 2]] },
    { ...empty(), arcs: [[0, 0, -1, 0, 90]] },
    { ...empty(), arcs: [[0, 0, 1, -1, 90]] },
    { ...empty(), arcs: [[0, 0, 1, 0, 361]] },
    { ...empty(), arcs: [[0, 0, 1, 0, 360]] },
    { ...empty(), arcs: [[0, 0, 1, 90, 90]] },
    { ...empty(), ellipses: [[0, 0, 0, 0, .5, 0, 360]] },
    { ...empty(), ellipses: [[0, 0, 5, 0, 0, 0, 360]] },
    { ...empty(), ellipses: [[0, 0, 5, 0, 1.1, 0, 360]] },
    { ...empty(), ellipses: [[0, 0, 5, 0, .5, 90, 90]] },
    { ...empty(), ellipses: [[0, 0, 5, 0, .5, 0]] },
    { ...empty(), polylines: [{ points: [[0, 0, 0], [1, 1]], closed: false }] },
    { ...empty(), polylines: [{ points: [[0, 0], [1, 1]], closed: true }] },
    { ...empty(), polylines: [{ points: [[0, 0], [0, 0]], closed: false }] },
    { ...empty(), polylines: [{ points: [[0, 0], [1, 1], [0, 0]], closed: true }] },
    { ...empty(), polylines: [{ points: [[0, 0], [1, 1]], closed: 'false' }] },
    { ...empty(), polylines: [{ points: Array.from({ length: 65 }, (_, i) => [i, 0]), closed: false }] },
    { ...drawing(), circles: Array.from({ length: 65 }, (_, i) => [i, 0, 1]) },
    { ...drawing(), expectedRevision: 99 },
    { ...drawing(), units: 'meter' },
    { ...drawing(), commands: ['DELETE'] },
    { ...drawing(), polylines: [{ points: [[0, 0], [1, 1]], closed: false, bulge: 1 }] },
    ...[NaN, Infinity, -Infinity, 1e13].map(x => ({ ...empty(), lines: [[x, 0, 1, 1]] })),
  ]
  const missing = drawing(); delete missing.arcs; cases.push(missing)
  for (const input of cases) {
    const result = await session.call(tool, input)
    assert.equal(result.ok, false, JSON.stringify(input))
    assert.equal(document.serialize(), source)
  }
  value(await session.call(tool, drawing()))
})

test('compact arrays reject getters, hidden fields, sparse entries and custom properties without invoking accessors', async () => {
  const { document, session } = fixture(), source = document.serialize()
  let getterCalls = 0
  const cases = []
  const outerGetter = drawing()
  Object.defineProperty(outerGetter, 'lines', { get() { getterCalls++; return [[0, 0, 1, 1]] }, enumerable: true })
  cases.push(outerGetter)
  const tupleGetter = [0, 0, 1, 1]
  Object.defineProperty(tupleGetter, '2', { get() { getterCalls++; return 1 }, enumerable: true })
  cases.push({ ...empty(), lines: [tupleGetter] })
  const hidden = [0, 0, 1, 1]; Object.defineProperty(hidden, '2', { value: 1, enumerable: false })
  cases.push({ ...empty(), lines: [hidden] })
  const sparse = [0, 0, 1, 1]; delete sparse[1]
  cases.push({ ...empty(), lines: [sparse] })
  const custom = [0, 0, 1, 1]; custom.code = 'DELETE'
  cases.push({ ...empty(), lines: [custom] })
  const symbol = [0, 0, 1, 1]; symbol[Symbol('unknown')] = 5
  cases.push({ ...empty(), lines: [symbol] })
  const pointGetter = [0, 0]
  Object.defineProperty(pointGetter, '0', { get() { getterCalls++; return 0 }, enumerable: true })
  cases.push({ ...empty(), polylines: [{ points: [pointGetter, [1, 1]], closed: false }] })
  for (const input of cases) {
    assert.equal((await session.call(tool, input)).ok, false)
    assert.equal(document.serialize(), source)
  }
  assert.equal(getterCalls, 0)
})

test('compact proposal still rejects stale approval and cannot approve a rejected plan', async () => {
  const { sdk, document, session } = fixture()
  const first = value(await session.call(tool, drawing()))
  value(session.reject(first.planId, 'reviewer'))
  assert.equal((await session.approve(first.planId, 'reviewer')).ok, false)
  const second = value(await session.call(tool, drawing()))
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [200, 300, 0], radius: 9 } })
  const changed = document.serialize()
  assert.equal((await session.approve(second.planId, 'reviewer')).ok, false)
  assert.equal(document.serialize(), changed)
})

test('compact input cannot bypass the decoded geometry preview byte budget', async () => {
  const { document, session } = fixture(), source = document.serialize()
  const polylines = Array.from({ length: 64 }, (_, row) => ({ closed: false, points: Array.from({ length: 64 }, (_, col) => [100000000000.12345 + col, -100000000000.12345 - row]) }))
  const result = await session.call(tool, { ...empty(), polylines })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /256 KiB/)
  assert.equal(document.serialize(), source)
})
