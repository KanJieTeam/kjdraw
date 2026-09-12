import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { validateDrawingGeometry } from '../src/drawing-validation.js'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Original geometry', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [3, 4, 12] }, { id: 'line' })
    tx.createEntity('CIRCLE', { center: [3, 4, 0], radius: 2 }, { id: 'circle' })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[0, 2, 0], [0, 0, 0], [3, 4, 0]] }, { id: 'aligned-dimension' })
    tx.createEntity('DIMENSION', { dimensionType: 'ANGULAR_3_POINT', definitionPoints: [[4, 4, 0], [10, 0, 0], [0, 10, 0], [0, 0, 0]] }, { id: 'angular-dimension' })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [10, 0], [10, 10]], closed: true }, { id: 'closed' })
    tx.createEntity('POLYLINE', { vertices: [[0, 0, 2], [10, 0, 3]], closed: false }, { id: 'open' })
    tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 2, normal: [0, 1, 0] }, { id: 'tilted' })
    tx.createEntity('XLINE', { origin: [0, 0, 0], direction: [1, 0, 0] }, { id: 'guide' })
    const sheet = tx.createLayout({ name: 'Paper' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [3, 4, 12] }, { id: 'paper', ownerId: sheet.payload.blockRecordId })
  })
  return { sdk, document }
}
const numeric = (objectId, kind, expected, tolerance = 0) => ({ id: `${kind}-${objectId}`, kind, objectId, expected, tolerance })
const gap = (from = 'line', to = 'circle', expected = 5) => ({ id: 'gap', kind: 'point-distance', from: { objectId: from, feature: 'start' }, to: { objectId: to, feature: 'center' }, expected, tolerance: 0 })
const check = (document, checks, extra = {}) => validateDrawingGeometry(document, { expectedRevision: document.revision, units: 'millimeter', checks, ...extra })

test('native 3D length, radius, object feature distance and canonical closure produce frozen explicit evidence', async () => {
  const { document } = await fixture(), before = document.serialize()
  const result = check(document, [numeric('line', 'line-length', 13), numeric('circle', 'circle-radius', 2), gap(), numeric('closed', 'polyline-closed', true), numeric('open', 'polyline-closed', false)])
  assert.equal(result.passed, true)
  assert.deepEqual(result.checks.map(item => item.actual), [13, 2, 5, true, false])
  assert.equal(result.documentId, document.id)
  assert.equal(result.revision, document.revision)
  assert.equal(result.units, 'millimeter')
  assert.equal(result.checks[2].references[0].objectId, 'line')
  assert.equal(result.checks[2].references[0].ownerId, document.getObject('line').ownerId)
  assert.equal(result.checks[2].references[0].feature, 'start')
  assert.ok(Object.isFrozen(result.checks[2].references[0]))
  assert.throws(() => { result.checks[0].passed = false }, TypeError)
  assert.equal(document.serialize(), before)
})

test('failed requirements stay false, tolerance boundary is inclusive, and closure never accepts numeric tolerance', async () => {
  const { document } = await fixture()
  const result = check(document, [numeric('line', 'line-length', 12, 1), numeric('circle', 'circle-radius', 4, 1), numeric('open', 'polyline-closed', true)])
  assert.equal(result.passed, false)
  assert.deepEqual(result.checks.map(item => item.error), [1, 2, 1])
  assert.deepEqual(result.checks.map(item => item.passed), [true, false, false])
  assert.throws(() => check(document, [numeric('open', 'polyline-closed', true, 1)]), /tolerance 0/)
})

test('native linear and angular dimensions return kernel measurements rather than displayed text', async () => {
  const { document } = await fixture(), before = document.serialize()
  const result = check(document, [
    numeric('aligned-dimension', 'dimension-measurement', 5, 1e-12),
    numeric('angular-dimension', 'dimension-measurement', 90),
  ])
  assert.equal(result.passed, true)
  assert.ok(Math.abs(result.checks[0].actual - 5) < 1e-12)
  assert.equal(result.checks[1].actual, 90)
  assert.deepEqual(result.checks.map(item => item.references[0].objectId), ['aligned-dimension', 'angular-dimension'])
  assert.throws(() => check(document, [numeric('line', 'dimension-measurement', 13)]), /native DIMENSION/)
  assert.equal(document.serialize(), before)
})

test('MOVE, undo and redo remeasure the actual objects and reject stale evidence revisions', async () => {
  const { sdk, document } = await fixture()
  const initial = check(document, [gap()])
  await sdk.executeCommand('MOVE', { ids: ['circle'], dx: 3, dy: 4 })
  assert.equal(check(document, [gap()]).checks[0].actual, 10)
  assert.equal(check(document, [gap()]).passed, false)
  assert.throws(() => check(document, [gap()], { expectedRevision: initial.revision }), /revision conflict/)
  await sdk.executeCommand('UNDO')
  assert.equal(check(document, [gap()]).passed, true)
  await sdk.executeCommand('REDO')
  assert.equal(check(document, [gap()]).checks[0].actual, 10)
})

test('point references respect native owner and OCS boundaries while invariant 3D lengths and radii remain usable', async () => {
  const { document } = await fixture()
  const crossOwner = { ...gap(), to: { objectId: 'paper', feature: 'end' } }
  assert.throws(() => check(document, [crossOwner]), /same native owner/)
  assert.throws(() => check(document, [gap('line', 'tilted')]), /default \+Z plane/)
  assert.equal(check(document, [numeric('tilted', 'circle-radius', 2), numeric('paper', 'line-length', 13)]).passed, true)
  const spatial = { ...gap(), from: { objectId: 'line', feature: 'end' }, expected: 12 }
  assert.equal(check(document, [spatial]).checks[0].actual, 12)
  const origin = { ...gap(), from: { objectId: 'guide', feature: 'origin' } }
  assert.equal(check(document, [origin]).passed, true)
})

test('unsupported checks, missing entities, wrong fields, wrong units and invalid budgets reject without changing history', async () => {
  const { document } = await fixture(), before = document.serialize()
  for (const checks of [[], Array.from({ length: 65 }, (_, index) => ({ ...numeric('line', 'line-length', 13), id: String(index) })),
    [numeric('missing', 'line-length', 1)], [numeric('circle', 'line-length', 2)], [numeric('line', 'area', 13)],
    [numeric('line', 'line-length', -1)], [numeric('line', 'line-length', NaN)], [numeric('line', 'line-length', 13, -1)],
    [{ id: 'missing-tolerance', kind: 'line-length', objectId: 'line', expected: 13 }],
    [numeric('line', 'line-length', 13), numeric('line', 'line-length', 13)],
    [{ ...gap(), to: { objectId: 'circle', feature: 'end' } }],
    [{ ...numeric('line', 'line-length', 13), execute: 'anything' }],
  ]) assert.throws(() => check(document, checks))
  assert.throws(() => check(document, [gap()], { units: 'mm' }), /exactly match/)
  assert.throws(() => check(document, [gap()], { expectedRevision: null }), /nonnegative safe integer/)
  let invoked = 0
  const bad = numeric('line', 'line-length', 13)
  Object.defineProperty(bad, 'expected', { enumerable: true, get() { invoked++; return 13 } })
  assert.throws(() => check(document, [bad]), /accessors/)
  assert.equal(invoked, 0)
  assert.equal(document.serialize(), before)
})

test('DXF save and SDK reopen preserve measured 3D geometry and canonical closure', async () => {
  const { sdk, document } = await fixture(), before = document.serialize()
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'DXF', targetVersion: '2018' }), { format: 'DXF' })
  const line = reopened.listEntities({ type: 'LINE' }).find(item => item.ownerId === reopened.snapshot().spaces.modelSpaceId)
  const circle = reopened.listEntities({ type: 'CIRCLE' }).find(item => item.payload.center[0] === 3)
  const closed = reopened.listEntities({ type: 'LWPOLYLINE' })[0]
  assert.ok(line && circle && closed)
  const result = check(reopened, [numeric(line.id, 'line-length', 13), numeric(circle.id, 'circle-radius', 2), numeric(closed.id, 'polyline-closed', true)])
  assert.equal(result.passed, true)
  assert.equal(document.serialize(), before)
})

test('two curved segments can be closed; vertex inspection remains bounded', async () => {
  const { document } = await fixture()
  await document.transact('Curved closure', tx => {
    tx.createEntity('LWPOLYLINE', { closed: true, vertices: [{ point: [-2, 0], bulge: 1 }, { point: [2, 0], bulge: 1 }] }, { id: 'curved' })
    tx.createEntity('LWPOLYLINE', { closed: false, vertices: Array.from({ length: 20001 }, (_, index) => [index, 0]) }, { id: 'over-budget' })
  })
  assert.equal(check(document, [numeric('curved', 'polyline-closed', true)]).passed, true)
  const before = document.serialize()
  assert.throws(() => check(document, [numeric('over-budget', 'polyline-closed', false)]), /20000-vertex budget/)
  assert.equal(document.serialize(), before)
})
