import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { KJDocument } from '../packages/kjdraw-sdk/src/document.js'
import { queryNativeCurveBounds, queryNativeCurveNeighborhood } from '../packages/kjdraw-sdk/src/agent-native-geometry-query.js'

const clone = structuredClone
async function drawing(entities = [], units = 'millimeter') {
  const document = KJDocument.create({ documentId: 'native-query-public-fixture', units })
  await document.transact('Public native geometry fixture', transaction => {
    for (const entity of entities) transaction.createEntity(entity.type, entity.payload, { id: entity.id, ...(entity.ownerId ? { ownerId: entity.ownerId } : {}) })
  })
  return document
}
const options = (document, patch = {}) => ({ documentId: document.id, expectedRevision: document.revision,
  ownerId: document.spaces.modelSpaceId, units: document.snapshot().header.units, ownerPolicy: 'model-space-only',
  visibility: 'include-hidden', typeScope: 'all-owner-entities', unsupportedPolicy: 'reject',
  offset: 0, limit: 200, maxEntities: 4096, maxBytes: 262144, ...patch })
const nearby = (document, patch = {}) => ({ ...options(document), anchorId: 'anchor', radius: 10,
  metric: 'text-insertion-to-finite-native-xy-curve', boundary: 'inclusive', ...patch })
const anchor = position => ({ id: 'anchor', type: 'TEXT', payload: { position, text: 'Public label', height: 2 } })
const line = (id, start, end, extra = {}) => ({ id, type: 'LINE', payload: { start, end, ...extra } })
const circle = (id, center, radius, extra = {}) => ({ id, type: 'CIRCLE', payload: { center, radius, ...extra } })
function unchanged(document, run) {
  const initial = document.serialize(), history = clone(document.history), snapshot = document.snapshot()
  try { return run() } finally {
    assert.equal(document.serialize(), initial); assert.deepEqual(document.history, history)
    assert.equal(document.snapshot(), snapshot)
  }
}

test('independent exact analytic native curve bounds, actual IDs/handles, not header cache or display bounds', async () => {
  const document = await drawing([line('segment', [-4, -3, 5], [8, 9, 20]), circle('ring', [20, 5, 8], 4)])
  const result = unchanged(document, () => queryNativeCurveBounds(document, options(document)))
  assert.equal(result.method, 'native-analytic-owner-xy-centerline-curves-v1')
  assert.equal(result.numericalPolicy, 'binary64-no-selection-tolerance')
  assert.deepEqual(result.bounds, { min: [-4, -3], max: [24, 9] })
  assert.equal(result.complete, true); assert.equal(result.scopeComplete, true); assert.equal(result.totalResultCount, 2)
  for (const row of result.rows) {
    const entity = document.getObject(row.id)
    assert.equal(row.handle, entity.handle); assert.equal(row.ownerId, entity.ownerId); assert.equal(row.layerId, entity.payload.layerId)
  }
  assert.equal(Object.hasOwn(result, 'z'), false, 'Native XY projection does not claim XYZ or 3D distance')
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.rows) && Object.isFrozen(result.bounds.min))
})
test('zero live curve owner is complete with null bounds, never invented origin extents', () => {
  const document = KJDocument.create({ units: 'millimeter' }), result = queryNativeCurveBounds(document, options(document))
  assert.equal(result.inspectedOwnerEntityCount, 0); assert.equal(result.totalResultCount, 0)
  assert.deepEqual(result.rows, []); assert.equal(result.bounds, null); assert.equal(result.complete, true)
})
test('finite endpoint clamp differs from infinite line; native 3-4-5 distance and closed exact radius boundary', async () => {
  const document = await drawing([anchor([0, 0]), line('three-four-five', [3, 4], [6, 8]),
    line('at-boundary', [0, 10], [1, 10]), line('just-outside', [0, 10.00000001], [1, 10.00000001]),
    line('finite-not-infinite', [11, 0], [20, 0])])
  const result = unchanged(document, () => queryNativeCurveNeighborhood(document, nearby(document)))
  assert.deepEqual(result.rows.map(row => row.id), ['three-four-five', 'at-boundary'])
  assert.equal(result.rows[0].distance, 5); assert.deepEqual(result.rows[0].closestPoint, [3, 4])
  assert.equal(result.rows[1].distance, 10); assert.equal(result.excludedCounts.anchor, 1)
})
test('tiny nonzero 1e-5 line is not collapsed by default squared-length selection tolerance', async () => {
  const document = await drawing([anchor([5e-6, 0]), line('tiny', [0, 0], [1e-5, 0])])
  const result = queryNativeCurveNeighborhood(document, nearby(document, { radius: 1e-8 }))
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].distance, 0)
  assert.deepEqual(result.rows[0].closestPoint, [5e-6, 0])
})
test('very small native nonzero segment does not underflow squared length into zero', async () => {
  const document = await drawing([anchor([5e-201, 0]), line('sub-square-underflow', [0, 0], [1e-200, 0])])
  const result = queryNativeCurveNeighborhood(document, nearby(document, { radius: 1e-210 }))
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].distance, 0)
})
test('minimum subnormal diagonal segment retains its actual native endpoint and midpoint', async () => {
  const tiny = Number.MIN_VALUE
  for (const position of [[tiny, tiny], [2 * tiny, 2 * tiny]]) {
    const document = await drawing([anchor(position), line('subnormal-diagonal', [0, 0], [2 * tiny, 2 * tiny])])
    const result = queryNativeCurveNeighborhood(document, nearby(document, { radius: tiny }))
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].distance, 0)
    assert.deepEqual(result.rows[0].closestPoint, position)
  }
})
test('true zero segment is a unique point distance, not a divide-by-zero', async () => {
  const document = await drawing([anchor([3, 4]), line('zero', [0, 0], [0, 0])])
  const result = queryNativeCurveNeighborhood(document, nearby(document, { radius: 5 }))
  assert.equal(result.rows[0].distance, 5); assert.deepEqual(result.rows[0].closestPoint, [0, 0])
  assert.equal(result.rows[0].closestPointUnique, true)
})
test('circle distance is to circumference, never center or filled disk; center nearest point is nonunique', async () => {
  const document = await drawing([anchor([0, 0]), circle('circumference-boundary', [14, 0], 4),
    circle('center-radius-outside', [0, 0], 15), circle('center-at-boundary', [0, 0], 10)])
  const result = queryNativeCurveNeighborhood(document, nearby(document))
  assert.deepEqual(result.rows.map(row => row.id), ['circumference-boundary', 'center-at-boundary'])
  assert.equal(result.rows[0].distance, 10); assert.deepEqual(result.rows[0].closestPoint, [10, 0])
  assert.equal(result.rows[1].distance, 10); assert.equal(result.rows[1].closestPoint, null)
  assert.equal(result.rows[1].closestPointUnique, false)
})
test('near-center circle retains radial direction rather than default-tolerance +X representative', async () => {
  const document = await drawing([anchor([0, 1e-10]), circle('near-center', [0, 0], 15)])
  const result = queryNativeCurveNeighborhood(document, nearby(document, { radius: 15 }))
  assert.equal(result.rows[0].distance, 15 - 1e-10); assert.deepEqual(result.rows[0].closestPoint, [0, 15])
  assert.equal(result.rows[0].closestPointUnique, true)
})
test('minimum subnormal circle radial direction is normalized before circumference projection', async () => {
  const document = await drawing([anchor([Number.MIN_VALUE, Number.MIN_VALUE]), circle('subnormal-radial', [0, 0], 1)])
  const result = queryNativeCurveNeighborhood(document, nearby(document, { radius: 1 }))
  const expected = 1 / Math.sqrt(2)
  assert.equal(result.rows[0].distance, 1); assert.deepEqual(result.rows[0].closestPoint, [expected, expected])
  assert.equal(result.rows[0].closestPointUnique, true)
})
test('all-owner scope cannot silently omit native TEXT, HATCH, unsupported curve, or a later-page unsupported object', async () => {
  const document = await drawing([line('first', [0, 0], [1, 1]), circle('second', [2, 2], 1),
    { id: 'label', type: 'TEXT', payload: { position: [0, 0], text: 'Not geometric extents', height: 2 } }])
  assert.throws(() => unchanged(document, () => queryNativeCurveBounds(document, options(document, { limit: 1 }))), { code: 'KJNATIVE_GEOMETRY_SCOPE_UNSUPPORTED' })
  const incomplete = queryNativeCurveBounds(document, options(document, { unsupportedPolicy: 'diagnostics', limit: 1 }))
  assert.equal(incomplete.scopeComplete, false); assert.equal(incomplete.complete, false); assert.equal(incomplete.bounds, null)
  assert.equal(incomplete.totalResultCount, null); assert.deepEqual(incomplete.rows, [])
  assert.deepEqual(incomplete.diagnostics.map(row => row.id), ['label'])
})
test('explicit line-circle-only scope reports other-type exclusion and never claims full drawing extents', async () => {
  const document = await drawing([line('curve', [0, 0], [1, 1]), { id: 'far-label', type: 'TEXT', payload: { position: [1000, 2000], text: 'Far text', height: 2 } }])
  const result = queryNativeCurveBounds(document, options(document, { typeScope: 'finite-line-circle-only' }))
  assert.deepEqual(result.bounds, { min: [0, 0], max: [1, 1] }); assert.equal(result.excludedCounts.otherTypes, 1)
  assert.equal(result.typeScope, 'finite-line-circle-only'); assert.equal(result.complete, true)
})
for (const entity of [{ id: 'ray', type: 'RAY', payload: { origin: [0, 0], direction: [1, 0] } },
  { id: 'polyline', type: 'LWPOLYLINE', payload: { vertices: [[0, 0], [1, 1]] } },
  { id: 'arc', type: 'ARC', payload: { center: [0, 0], radius: 2, startAngle: 0, endAngle: 1 } }])
  test(`unsupported native ${entity.type} yields diagnostics, not an empty certified answer`, async () => {
    const document = await drawing([entity]), result = queryNativeCurveBounds(document, options(document, { unsupportedPolicy: 'diagnostics' }))
    assert.equal(result.bounds, null); assert.equal(result.scopeComplete, false); assert.equal(result.totalResultCount, null)
    assert.equal(result.diagnostics[0].type, entity.type)
  })
for (const extra of [{ normal: [0, 1, 0] }, { normal: [0, 0, -1] }, { extrusionDirection: [0, 1, 0] }, { thickness: 1 }])
  test(`nondefault circle orientation/extrusion is never treated as a default XY circle: ${JSON.stringify(extra)}`, async () => {
    const document = await drawing([anchor([0, 0]), circle('unsupported-ring', [0, 0], 2, extra)])
    assert.throws(() => unchanged(document, () => queryNativeCurveNeighborhood(document, nearby(document))), { code: 'KJNATIVE_GEOMETRY_SCOPE_UNSUPPORTED' })
    const result = queryNativeCurveNeighborhood(document, nearby(document, { unsupportedPolicy: 'diagnostics' }))
    assert.equal(result.scopeComplete, false); assert.deepEqual(result.rows, []); assert.equal(result.totalResultCount, null)
  })
test('explicit visibility policy excludes entity-hidden and frozen layers; locked visible curves remain readable', async () => {
  const document = await drawing([anchor([0, 0]), circle('hidden-entity', [0, 0], 2, { visible: false }), line('visible-curve', [0, 3], [2, 3])])
  await document.transact('Public hidden and locked layers', tx => {
    const frozen = tx.upsertTableRecord('layers', { name: 'Public frozen', payload: { visible: true, frozen: true, locked: false } })
    const locked = tx.upsertTableRecord('layers', { name: 'Public locked', payload: { visible: true, frozen: false, locked: true } })
    tx.createEntity('LINE', { start: [0, 4], end: [2, 4], layerId: frozen.id }, { id: 'frozen-curve' })
    tx.createEntity('LINE', { start: [0, 5], end: [2, 5], layerId: locked.id }, { id: 'locked-visible' })
  })
  const visible = queryNativeCurveNeighborhood(document, nearby(document, { visibility: 'visible-only' }))
  assert.deepEqual(visible.rows.map(row => row.id), ['visible-curve', 'locked-visible']); assert.equal(visible.excludedCounts.hidden, 2)
  const all = queryNativeCurveNeighborhood(document, nearby(document))
  assert.equal(all.rows.length, 4); assert.equal(all.rows.find(row => row.id === 'frozen-curve').visible, false)
  assert.equal(all.rows.find(row => row.id === 'locked-visible').visible, true)
})
test('hidden TEXT anchor follows explicit caller visibility and is never silently substituted', async () => {
  const document = await drawing([anchor([0, 0]), line('curve', [1, 0], [2, 0])])
  await document.transact('Hide anchor', tx => tx.updateObject('anchor', { payload: { visible: false } }))
  assert.throws(() => queryNativeCurveNeighborhood(document, nearby(document, { visibility: 'visible-only' })), { code: 'KJNATIVE_GEOMETRY_ANCHOR_HIDDEN' })
  const all = queryNativeCurveNeighborhood(document, nearby(document))
  assert.equal(all.anchor.visible, false); assert.equal(all.rows.length, 1)
})
test('malformed visibility string does not coerce to visible or disappear', async () => {
  const document = await drawing([line('malformed-visible', [0, 0], [1, 1], { visible: 'false' })])
  assert.throws(() => queryNativeCurveBounds(document, options(document)), { code: 'KJNATIVE_GEOMETRY_SCOPE_UNSUPPORTED' })
})
test('same-owner TEXT insertion anchor required, not arbitrary coordinates/MTEXT/foreign ownership', async () => {
  const document = await drawing([anchor([0, 0]), line('curve', [1, 0], [2, 0]),
    { id: 'multi', type: 'MTEXT', payload: { position: [0, 0], text: 'Multi', height: 2, width: 10 } }])
  await document.transact('Paper anchor', tx => tx.createEntity('TEXT', { position: [0, 0], text: 'Paper', height: 2 }, { id: 'paper-anchor', ownerId: document.spaces.paperSpaceIds[0] }))
  for (const anchorId of ['absent', 'curve', 'multi', 'paper-anchor'])
    assert.throws(() => unchanged(document, () => queryNativeCurveNeighborhood(document, nearby(document, { anchorId, typeScope: 'finite-line-circle-only' }))), { code: 'KJNATIVE_GEOMETRY_ANCHOR_UNSUPPORTED' })
})
test('pagination returns actual stable native IDs without duplicate/skipped rows; final page alone never claims complete', async () => {
  const document = await drawing(Array.from({ length: 7 }, (_, index) => line(`native-${index}`, [index, -index], [index + 1, 2])))
  const ids = [], initial = document.serialize(), history = clone(document.history)
  let offset = 0, pages = 0
  do {
    const result = queryNativeCurveBounds(document, options(document, { offset, limit: 2 }))
    assert.equal(result.complete, false); assert.equal(result.scopeComplete, true); assert.equal(result.totalResultCount, 7)
    assert.deepEqual(result.bounds, { min: [0, -6], max: [7, 2] })
    ids.push(...result.rows.map(row => row.id)); pages++; offset = result.nextOffset
  } while (offset !== null)
  assert.equal(pages, 4); assert.deepEqual(ids, Array.from({ length: 7 }, (_, index) => `native-${index}`)); assert.equal(new Set(ids).size, 7)
  assert.equal(document.serialize(), initial); assert.deepEqual(document.history, history)
  assert.throws(() => queryNativeCurveBounds(document, options(document, { offset: 8 })), /offset cannot skip/)
})
test('candidate pagination has complete exact total while each page is not an all-candidates answer', async () => {
  const document = await drawing([anchor([0, 0]), ...Array.from({ length: 5 }, (_, index) => line(`within-${index}`, [index, 1], [index, 2]))])
  const first = queryNativeCurveNeighborhood(document, nearby(document, { limit: 2 }))
  assert.equal(first.complete, false); assert.equal(first.totalResultCount, 5); assert.equal(first.nextOffset, 2)
  const last = queryNativeCurveNeighborhood(document, nearby(document, { limit: 2, offset: 4 }))
  assert.equal(last.complete, false); assert.equal(last.nextOffset, null); assert.equal(last.rows.length, 1)
})
test('maxEntities counts hidden and type-excluded native entities, not just returned curves', async () => {
  const document = await drawing([line('one', [0, 0], [1, 1]), anchor([0, 0]), circle('hidden', [0, 0], 2, { visible: false })])
  assert.throws(() => unchanged(document, () => queryNativeCurveBounds(document, options(document, {
    maxEntities: 2, typeScope: 'finite-line-circle-only', visibility: 'visible-only' }))), { code: 'KJNATIVE_GEOMETRY_ENTITY_LIMIT' })
})
test('maxBytes refuses the whole response, never truncates rows or native handle/identity', async () => {
  const document = await drawing(Array.from({ length: 12 }, (_, index) => line(`public-curve-${index}`, [0, 0], [1, 1])))
  assert.throws(() => unchanged(document, () => queryNativeCurveBounds(document, options(document, { maxBytes: 1024 }))), { code: 'KJNATIVE_GEOMETRY_BYTE_LIMIT' })
  const bounded = queryNativeCurveBounds(document, options(document, { maxBytes: 1024, limit: 1 }))
  assert.equal(bounded.rows.length, 1); assert.equal(bounded.nextOffset, 1); assert.equal(bounded.totalResultCount, 12)
})
test('explicit document/revision/unit/model-owner identity is checked without alias conversion or mutation', async () => {
  const document = await drawing([line('curve', [0, 0], [1, 1])])
  for (const [patch, code] of [[{ documentId: 'foreign' }, 'KJNATIVE_GEOMETRY_DOCUMENT_MISMATCH'],
    [{ expectedRevision: document.revision + 1 }, 'KJDOCUMENT_REVISION_CONFLICT'], [{ units: 'mm' }, 'KJNATIVE_GEOMETRY_UNITS_MISMATCH'],
    [{ ownerId: document.spaces.paperSpaceIds[0] }, 'KJNATIVE_GEOMETRY_OWNER_UNSUPPORTED'], [{ ownerId: 'foreign-owner' }, 'KJNATIVE_GEOMETRY_OWNER_UNSUPPORTED']])
    assert.throws(() => unchanged(document, () => queryNativeCurveBounds(document, options(document, patch))), { code })
})
test('header-meter model is measured natively without auto-conversion; paper and block owner units remain unsupported', async () => {
  const document = await drawing([anchor([0, 0]), line('meters-five', [3, 4], [6, 8])], 'meter')
  const result = queryNativeCurveNeighborhood(document, nearby(document, { radius: 5 }))
  assert.equal(result.units, 'meter'); assert.equal(result.rows[0].distance, 5)
  await document.transact('Public block definition', tx => tx.upsertTableRecord('blockRecords', { id: 'native-block', name: 'Public component', payload: { entityIds: [] } }))
  assert.throws(() => queryNativeCurveBounds(document, options(document, { ownerId: 'native-block' })), { code: 'KJNATIVE_GEOMETRY_OWNER_UNSUPPORTED' })
})
test('query uses genuine native snapshot, not an overridden fake list/getObject/snapshot answer facade', async () => {
  const document = await drawing([line('actual', [0, 0], [1, 1])])
  Object.defineProperty(document, 'snapshot', { value: () => { throw Error('fake snapshot must not execute') } })
  Object.defineProperty(document, 'listEntities', { value: () => { throw Error('fake entities must not execute') } })
  Object.defineProperty(document, 'getObject', { value: () => { throw Error('fake object must not execute') } })
  const actualState = KJDocument.prototype.snapshot.call(document)
  const input = { ...options(KJDocument.create()), documentId: actualState.documentId, expectedRevision: actualState.revision,
    ownerId: actualState.spaces.modelSpaceId, units: actualState.header.units }
  assert.equal(queryNativeCurveBounds(document, input).rows[0].id, 'actual')
  assert.throws(() => queryNativeCurveBounds({}, input), /actual KJDocument/)
})
for (const patch of [{ radius: -1 }, { radius: 0 }, { radius: '10' }, { radius: Number.NaN }, { radius: Infinity },
  { radius: 1e13 }, { metric: 'distance-to-center' }, { boundary: 'exclusive' }])
  test(`invalid metric/radius fails closed without numeric coercion ${JSON.stringify(patch)}`, async () => {
    const document = await drawing([anchor([0, 0]), circle('ring', [0, 0], 2)])
    assert.throws(() => unchanged(document, () => queryNativeCurveNeighborhood(document, nearby(document, patch))), { code: 'KJDOCUMENT_INVALID' })
  })
for (const patch of [{ expectedRevision: '1' }, { offset: -1 }, { limit: 0 }, { limit: 201 }, { maxEntities: 0 }, { maxEntities: 4097 },
  { maxBytes: 1023 }, { maxBytes: 262145 }, { visibility: undefined }, { typeScope: undefined }, { unsupportedPolicy: undefined },
  { ownerPolicy: 'project-paper-viewport' }, { geometry: {} }])
  test(`invalid/missing policy or expanded resource budget ${JSON.stringify(patch)}`, async () => {
    const document = await drawing([line('curve', [0, 0], [1, 1])])
    assert.throws(() => unchanged(document, () => queryNativeCurveBounds(document, options(document, patch))), { code: 'KJDOCUMENT_INVALID' })
  })
test('accessors, hidden fields, inherited required fields and symbol options reject before any getter is evaluated', async () => {
  const document = await drawing([line('curve', [0, 0], [1, 1])]); let getters = 0
  const valid = options(document)
  for (const input of [Object.defineProperty({ ...valid }, 'ownerId', { enumerable: true, get() { getters++; return valid.ownerId } }),
    Object.defineProperty({ ...valid }, 'offset', { enumerable: false, value: 0 }), { ...valid, [Symbol('geometry')]: {} },
    Object.assign(Object.create({ ownerId: valid.ownerId }), { ...valid, ownerId: undefined })])
    assert.throws(() => unchanged(document, () => queryNativeCurveBounds(document, input)), { code: 'KJDOCUMENT_INVALID' })
  assert.equal(getters, 0)
})
test('erased entities are outside the explicit live owner scope; history remains fully usable after reads', async () => {
  const document = await drawing([line('preserved', [0, 0], [1, 1]), circle('erased', [100, 100], 20)])
  await document.transact('Erase actual native object', tx => tx.eraseObject('erased'))
  const result = unchanged(document, () => queryNativeCurveBounds(document, options(document)))
  assert.equal(result.inspectedOwnerEntityCount, 1); assert.equal(result.rows.length, 1)
  await document.undo({ expectedRevision: document.revision })
  assert.equal(queryNativeCurveBounds(document, options(document)).rows.length, 2)
  await document.redo({ expectedRevision: document.revision })
  assert.equal(queryNativeCurveBounds(document, options(document)).rows.length, 1)
})
test('internal utility is not added to public agent registry or index and imports no benchmark gold/router', async () => {
  const source = await readFile(new URL('../packages/kjdraw-sdk/src/agent-native-geometry-query.ts', import.meta.url), 'utf8')
  for (const text of ['geology-round9', 'expectedRound9', 'fixture', 'KJDRAW_AGENT_TOOLS']) assert.equal(source.includes(text), false)
  const index = await readFile(new URL('../packages/kjdraw-sdk/src/index.ts', import.meta.url), 'utf8')
  assert.equal(index.includes('agent-native-geometry-query'), false)
})
