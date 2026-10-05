import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { KJDocument } from '../packages/kjdraw-sdk/src/document.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { queryNativePolylineBounds, queryNativePolylineNeighborhood } from '../packages/kjdraw-sdk/src/agent-native-polyline-geometry-query.js'

// Independent public mathematical gold: integral endpoints, 3-4-5 triangles,
// known circles and cardinals. No display bounds, tessellation or benchmark gold.
const vertex = (point, bulge = 0, extra = {}) => ({ point, bulge, ...extra })
const polyline = (id, vertices, extra = {}) => ({ id, type: 'LWPOLYLINE', payload: { vertices, closed: false, ...extra } })
const anchor = (position, extra = {}) => ({ id: 'anchor', type: 'TEXT', payload: { position, text: 'Public label', height: 2, ...extra } })
async function drawing(entities = [], units = 'millimeter') {
  const document = KJDocument.create({ documentId: 'public-native-polyline', units })
  await document.transact('Public native polyline fixture', tx => {
    for (const entity of entities) tx.createEntity(entity.type, entity.payload, { id: entity.id, ...(entity.ownerId ? { ownerId: entity.ownerId } : {}) })
  })
  return document
}
const options = (document, patch = {}) => ({ documentId: document.id, expectedRevision: document.revision,
  ownerId: document.spaces.modelSpaceId, units: document.snapshot().header.units, ownerPolicy: 'model-space-only',
  visibility: 'include-hidden', typeScope: 'lwpolyline-centerline-only', unsupportedPolicy: 'reject',
  closedPolicy: 'native-closed-flag', widthPolicy: 'centerline-only', offset: 0, limit: 200,
  maxEntities: 4096, maxEdges: 4096, maxBytes: 262144, ...patch })
const nearby = (document, patch = {}) => ({ ...options(document), anchorId: 'anchor', radius: 10,
  metric: 'text-insertion-to-finite-native-xy-polyline', boundary: 'inclusive', ...patch })
function unchanged(document, run) {
  const initial = document.serialize(), state = document.snapshot(), history = structuredClone(document.history)
  try { return run() } finally {
    assert.equal(document.serialize(), initial); assert.equal(document.snapshot(), state); assert.deepEqual(document.history, history)
  }
}
function approximate(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance, `${value} != ${expected[index]}`))
}
async function malformed(patch) {
  const document = await drawing([polyline('native', [[0, 0], [2, 0]])])
  const state = structuredClone(document.snapshot())
  Object.assign(state.objects.native.payload, patch)
  return KJDocument.open(state)
}

test('actual normalized native payload, analytic open edges and exact identity/handles', async () => {
  const document = await drawing([polyline('native', [[-4, -3, 5], [8, 9, 5], [2, -6, 5]], { elevation: 9 })])
  const result = unchanged(document, () => queryNativePolylineBounds(document, options(document)))
  assert.deepEqual(result.bounds, { min: [-4, -6], max: [8, 9] }); assert.equal(result.complete, true)
  const row = result.rows[0], native = document.getObject(row.id)
  for (const key of ['id', 'handle', 'ownerId']) assert.equal(row[key], native[key])
  assert.equal(row.layerId, native.payload.layerId); assert.equal(row.type, 'LWPOLYLINE')
  assert.equal(row.vertexCount, 3); assert.equal(row.edgeCount, 2); assert.equal(row.arcEdgeCount, 0)
  assert.equal(result.inspectedPolylineEdgeCount, 2)
  assert.equal(result.method, 'native-analytic-owner-xy-polyline-centerline-v1')
  assert.equal(result.numericalPolicy, 'binary64-analytic-no-selection-tolerance')
  assert.equal(Object.hasOwn(result, 'z'), false); assert.ok(Object.isFrozen(result) && Object.isFrozen(result.rows[0].bounds.min))
})
test('genuine empty owner is complete/null; not fabricated origin extents', () => {
  const document = KJDocument.create(), result = queryNativePolylineBounds(document, options(document))
  assert.equal(result.complete, true); assert.equal(result.totalResultCount, 0); assert.deepEqual(result.rows, []); assert.equal(result.bounds, null)
})
test('finite segment endpoint clamp is not distance to an infinite line; 3-4-5 exact boundary', async () => {
  const document = await drawing([anchor([0, 0]), polyline('five', [[3, 4], [6, 8]]), polyline('outside', [[11, 0], [20, 0]])])
  const result = unchanged(document, () => queryNativePolylineNeighborhood(document, nearby(document, { radius: 5 })))
  assert.deepEqual(result.rows.map(row => row.id), ['five']); assert.equal(result.rows[0].distance, 5)
  assert.deepEqual(result.rows[0].closestPoint, [3, 4]); assert.deepEqual(result.rows[0].closestEdgeIndices, [0])
  assert.equal(result.excludedCounts.anchor, 1)
})
test('native closed flag adds the actual finite closing edge without treating polygon interior as a filled region', async () => {
  const document = await drawing([anchor([1, 1]), polyline('open', [[0, 0], [4, 0], [4, 4]]),
    polyline('closed', [[0, 0], [4, 0], [4, 4]], { closed: true })])
  const rows = queryNativePolylineNeighborhood(document, nearby(document)).rows
  assert.equal(rows[0].edgeCount, 2); assert.equal(rows[0].distance, 1)
  assert.equal(rows[1].edgeCount, 3); assert.equal(rows[1].distance, 0); assert.deepEqual(rows[1].closestPoint, [1, 1])
  assert.deepEqual(rows[1].closestEdgeIndices, [2])
})
for (const [bulge, bounds, closest] of [[1, { min: [0, -1], max: [2, 0] }, [1, -1]],
  [-1, { min: [0, 0], max: [2, 1] }, [1, 1]]])
  test(`signed native ${bulge} bulge is the correct semicircle, never the straight chord`, async () => {
    const document = await drawing([anchor([1, bulge > 0 ? -3 : 3]), polyline('half', [vertex([0, 0], bulge), vertex([2, 0])])])
    const result = queryNativePolylineBounds(document, options(document))
    assert.deepEqual(result.bounds, bounds); assert.equal(result.rows[0].arcEdgeCount, 1)
    const row = queryNativePolylineNeighborhood(document, nearby(document, { radius: 2 })).rows[0]
    assert.equal(row.distance, 2); assert.deepEqual(row.closestPoint, closest); assert.equal(row.closestPointUnique, true)
  })
for (const [bulge, expected] of [[2, { min: [-0.25, -2], max: [2.25, 0] }], [-2, { min: [-0.25, 0], max: [2.25, 2] }]])
  test(`major arc bulge ${bulge} uses directed sweep beyond a semicircle`, async () => {
    const document = await drawing([polyline('major', [vertex([0, 0], bulge), vertex([2, 0])])])
    assert.deepEqual(queryNativePolylineBounds(document, options(document)).bounds, expected)
  })
test('90-degree native rotation gives the right-half semicircle with exact cardinal bounds', async () => {
  const document = await drawing([anchor([3, 0]), polyline('rotated', [vertex([0, -1], 1), vertex([0, 1])])])
  assert.deepEqual(queryNativePolylineBounds(document, options(document)).bounds, { min: [0, -1], max: [1, 1] })
  const row = queryNativePolylineNeighborhood(document, nearby(document)).rows[0]
  assert.equal(row.distance, 2); assert.deepEqual(row.closestPoint, [1, 0])
})
test('oblique semicircle and quarter-arc gold are independent known circles, not tessellated display bounds', async () => {
  const a = 5 / Math.sqrt(2)
  const rotated = await drawing([polyline('oblique', [vertex([3 - a, 4 - a], 1), vertex([3 + a, 4 + a])])])
  const bounds = queryNativePolylineBounds(rotated, options(rotated)).bounds
  approximate(bounds.min, [3 - a, -1]); approximate(bounds.max, [8, 4 + a])
  const quarter = await drawing([polyline('quarter', [vertex([0, 0], Math.tan(Math.PI / 8)), vertex([2, 0])])])
  const q = queryNativePolylineBounds(quarter, options(quarter)).bounds
  approximate(q.min, [0, 1 - Math.sqrt(2)]); approximate(q.max, [2, 0])
})
test('an open final nonzero bulge is not an edge; the identical closed payload creates a real closing arc', async () => {
  const values = [vertex([0, 0]), vertex([2, 0], 1)]
  const document = await drawing([polyline('open', values), polyline('closed', values, { closed: true })])
  const rows = queryNativePolylineBounds(document, options(document)).rows
  assert.equal(rows[0].openTerminalBulgeIgnored, true); assert.equal(rows[0].edgeCount, 1); assert.equal(rows[0].arcEdgeCount, 0)
  assert.deepEqual(rows[0].bounds, { min: [0, 0], max: [2, 0] })
  assert.equal(rows[1].openTerminalBulgeIgnored, false); assert.equal(rows[1].edgeCount, 2); assert.equal(rows[1].arcEdgeCount, 1)
  assert.deepEqual(rows[1].bounds, { min: [0, 0], max: [2, 1] })
})
test('arc finite sweep excludes opposite-circle radial point and reports tied distinct endpoints as nonunique', async () => {
  const document = await drawing([anchor([1, 2]), polyline('lower-half', [vertex([0, 0], 1), vertex([2, 0])])])
  const row = queryNativePolylineNeighborhood(document, nearby(document)).rows[0]
  assert.equal(row.distance, Math.sqrt(5)); assert.equal(row.closestPointUnique, false); assert.equal(row.closestPoint, null)
})
test('arc-center anchor has infinitely many equal closest points; no arbitrary representative', async () => {
  const document = await drawing([anchor([1, 0]), polyline('half', [vertex([0, 0], 1), vertex([2, 0])])])
  const row = queryNativePolylineNeighborhood(document, nearby(document, { radius: 1 })).rows[0]
  assert.equal(row.distance, 1); assert.equal(row.closestPointUnique, false); assert.equal(row.closestPoint, null)
})
test('shared vertex across two line edges is one native closest point, while distinct side ties are nonunique', async () => {
  const document = await drawing([anchor([0, 0]), polyline('shared', [[-2, 0], [0, 0], [0, 2]]),
    polyline('sides', [[-1, -1], [-1, 1], [1, 1], [1, -1]])])
  const rows = queryNativePolylineNeighborhood(document, nearby(document)).rows
  assert.equal(rows[0].distance, 0); assert.equal(rows[0].closestPointUnique, true); assert.deepEqual(rows[0].closestPoint, [0, 0])
  assert.deepEqual(rows[0].closestEdgeIndices, [0, 1])
  assert.equal(rows[1].distance, 1); assert.equal(rows[1].closestPointUnique, false); assert.equal(rows[1].closestPoint, null)
  assert.deepEqual(rows[1].closestEdgeIndices, [0, 1, 2])
})
for (const [length, position, radius] of [[1e-5, 5e-6, 1e-10], [1e-200, 5e-201, 1e-210],
  [2 * Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE]])
  test(`small but nonzero segment ${length} is not collapsed by a squared-length epsilon`, async () => {
    const document = await drawing([anchor([position, 0]), polyline('small', [[0, 0], [length, 0]])])
    const row = queryNativePolylineNeighborhood(document, nearby(document, { radius })).rows[0]
    assert.equal(row.distance, 0); assert.deepEqual(row.closestPoint, [position, 0]); assert.equal(row.closestPointUnique, true)
  })
test('genuine zero-length straight edges remain explicit finite points and do not divide by zero', async () => {
  const document = await drawing([anchor([3, 4]), polyline('zero', [[0, 0], [0, 0]])])
  const row = queryNativePolylineNeighborhood(document, nearby(document, { radius: 5 })).rows[0]
  assert.equal(row.distance, 5); assert.deepEqual(row.closestPoint, [0, 0]); assert.equal(row.edgeCount, 1)
})
test('nonzero bulge on coincident endpoints and unrepresentable circle are explicit diagnostics, never straight-line fallbacks', async () => {
  for (const vertices of [[vertex([0, 0], 1), vertex([0, 0])], [vertex([0, 0], 1e-300), vertex([1, 0])],
    [vertex([0, 0], 1), vertex([Number.MIN_VALUE, 0])]]) {
    const document = await drawing([polyline('unsupported', vertices)])
    const result = unchanged(document, () => queryNativePolylineBounds(document, options(document, { unsupportedPolicy: 'diagnostics' })))
    assert.equal(result.scopeComplete, false); assert.equal(result.bounds, null); assert.deepEqual(result.rows, [])
    assert.equal(result.diagnostics[0].reason, 'KJNATIVE_POLYLINE_NUMERICAL_UNSUPPORTED')
  }
})
test('small nonzero bulge whose endpoint directions collapse is refused, not epsilon-converted into a line', async () => {
  const document = await drawing([polyline('collapsed', [vertex([0, 0], 1e-20), vertex([1e-12, 1e-12])])])
  const result = queryNativePolylineBounds(document, options(document, { unsupportedPolicy: 'diagnostics' }))
  assert.equal(result.scopeComplete, false); assert.equal(result.diagnostics[0].reason, 'KJNATIVE_POLYLINE_NUMERICAL_UNSUPPORTED')
})
for (const bulge of [1e-8, -1e-8, 1e12, -1e12])
  test(`nonzero bulge ${bulge} with an unrepresentable or severely quantized sagitta is explicitly refused, never advertised as analytic straight-chord geometry`, async () => {
    const document = await drawing([polyline('ill-conditioned', [vertex([0, 0], bulge), vertex([1, 0])])])
    const result = queryNativePolylineBounds(document, options(document, { unsupportedPolicy: 'diagnostics' }))
    assert.equal(result.scopeComplete, false); assert.deepEqual(result.rows, []); assert.equal(result.bounds, null)
    assert.equal(result.diagnostics[0].reason, 'KJNATIVE_POLYLINE_NUMERICAL_UNSUPPORTED')
  })
test('48 independent known-circle directed/rotated gold cases retain complete finite-arc bounds and radial nearest points', async t => {
  for (let startStep = 0; startStep < 8; startStep++) for (const signedQuarterSteps of [1, 2, 3, -1, -2, -3]) {
    await t.test(`start=${startStep}pi/4, sweep=${signedQuarterSteps}pi/2`, async () => {
      const center = [3, 4], radius = 5, startAngle = startStep * Math.PI / 4, sweep = signedQuarterSteps * Math.PI / 2
      const point = angle => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]
      const start = point(startAngle), end = point(startAngle + sweep), middle = startAngle + sweep / 2
      const knownClosest = point(middle), inputAnchor = [center[0] + 2 * radius * Math.cos(middle), center[1] + 2 * radius * Math.sin(middle)]
      const document = await drawing([anchor(inputAnchor), polyline('native', [vertex(start, Math.tan(sweep / 4)), vertex(end)])])
      // Membership gold uses integer angular eighth-turns, independently of
      // center reconstruction and atan2 comparisons inside the implementation.
      const cardinalGold = [[8, 4], [3, 9], [-2, 4], [3, -1]]
      const expectedPoints = [start, end]
      for (let cardinal = 0; cardinal < 4; cardinal++) {
        const delta = signedQuarterSteps > 0 ? (cardinal * 2 - startStep + 16) % 8 : (startStep - cardinal * 2 + 16) % 8
        if (delta <= Math.abs(signedQuarterSteps) * 2) expectedPoints.push(cardinalGold[cardinal])
      }
      const expected = { min: [Math.min(...expectedPoints.map(p => p[0])), Math.min(...expectedPoints.map(p => p[1]))],
        max: [Math.max(...expectedPoints.map(p => p[0])), Math.max(...expectedPoints.map(p => p[1]))] }
      const bounds = unchanged(document, () => queryNativePolylineBounds(document, options(document))).bounds
      approximate(bounds.min, expected.min, 1e-11); approximate(bounds.max, expected.max, 1e-11)
      const row = unchanged(document, () => queryNativePolylineNeighborhood(document, nearby(document, { radius: 6 }))).rows[0]
      assert.ok(Math.abs(row.distance - radius) <= 1e-11); approximate(row.closestPoint, knownClosest, 1e-11)
      assert.equal(row.closestPointUnique, true); assert.equal(row.arcEdgeCount, 1)
    })
  }
})
for (const bulge of [1e-7, -1e-7])
  test(`supported thin native bulge ${bulge} preserves its actual analytic sagitta and distance, not a rounded center-radius subtraction`, async () => {
    const document = await drawing([anchor([0.5, bulge > 0 ? -1 : 1]), polyline('thin', [vertex([0, 0], bulge), vertex([1, 0])])])
    const sagitta = -bulge / 2, bounds = queryNativePolylineBounds(document, options(document)).bounds
    approximate(bounds.min, [0, Math.min(sagitta, 0)], 1e-16); approximate(bounds.max, [1, Math.max(sagitta, 0)], 1e-16)
    const row = queryNativePolylineNeighborhood(document, nearby(document)).rows[0]
    assert.ok(Math.abs(row.distance - (1 - Math.abs(sagitta))) <= 1e-16)
    approximate(row.closestPoint, [0.5, sagitta], 1e-16); assert.equal(row.arcEdgeCount, 1)
  })
test('wide native polyline is explicitly centerline-only, not a stroked or filled-outline extent', async () => {
  const document = await drawing([polyline('wide', [vertex([0, 0], 0, { startWidth: 20, endWidth: 40 }), vertex([2, 0])], { constantWidth: 100 })])
  const result = queryNativePolylineBounds(document, options(document))
  assert.deepEqual(result.bounds, { min: [0, 0], max: [2, 0] }); assert.equal(result.rows[0].widthPolicy, 'centerline-only')
})
for (const [flag, closed] of [[0, false], [1, true], [128, false], [129, true]])
  test(`unsigned LWPOLYLINE flags ${flag} preserve native closure and allow Plinegen without changing geometry`, async () => {
    const document = await drawing([polyline('native', [[0, 0], [2, 0]], { dxfFlags: flag, closed })])
    const row = queryNativePolylineBounds(document, options(document)).rows[0]
    assert.equal(row.closed, closed); assert.equal(row.edgeCount, closed ? 2 : 1)
  })
for (const flag of [-1, 1.5, '128', 65536, 4294967296, 128.5, 2, 32768])
  test(`unsupported or laundered flags ${flag} are never bitwise-coerced into valid flags`, async () => {
    const document = await drawing([polyline('native', [[0, 0], [2, 0]], { dxfFlags: flag })])
    const result = unchanged(document, () => queryNativePolylineBounds(document, options(document, { unsupportedPolicy: 'diagnostics' })))
    assert.equal(result.scopeComplete, false); assert.equal(result.bounds, null); assert.deepEqual(result.rows, [])
    assert.ok(['KJDOCUMENT_INVALID', 'KJNATIVE_POLYLINE_UNSUPPORTED_FLAGS'].includes(result.diagnostics[0].reason))
  })
test('conflicting closed flag, flagged legacy vertices, and negative width cannot be silently ignored', async () => {
  for (const patch of [{ dxfFlags: 0, closed: true }, { vertices: [vertex([0, 0], 0, { dxfFlags: 8 }), vertex([2, 0])] }, { constantWidth: -1 }]) {
    const document = await malformed(patch)
    const result = queryNativePolylineBounds(document, options(document, { unsupportedPolicy: 'diagnostics' }))
    assert.equal(result.scopeComplete, false); assert.equal(result.bounds, null)
  }
})
for (const patch of [{ vertices: [] }, { vertices: [vertex([0, 0]), { point: [2, Infinity, 0] }] }])
  test(`genuine native document rejects malformed geometry before any read helper can execute ${JSON.stringify(patch)}`, async () => {
    await assert.rejects(malformed(patch), { code: 'KJDOCUMENT_INVALID' })
  })
for (const patch of [{ vertices: [{ point: [0, 0, 0], bulge: '1' }, { point: [2, 0, 0] }] },
  { vertices: [vertex([0, 0]), { point: [2, 0] }] },
  { vertices: [vertex([0, 0]), vertex([2, 0], 0, { endWidth: '2' })] }, { closed: 'true' }])
  test(`malformed native vertex/closure data is diagnosed without coercion ${JSON.stringify(patch)}`, async () => {
    const document = await malformed(patch)
    const result = unchanged(document, () => queryNativePolylineBounds(document, options(document, { unsupportedPolicy: 'diagnostics' })))
    assert.equal(result.scopeComplete, false); assert.equal(result.bounds, null); assert.equal(result.totalResultCount, null)
  })
for (const patch of [{ normal: [0, 1, 0] }, { normal: [0, 0, -1] }, { extrusionDirection: [1, 0, 0] }, { thickness: 1 }])
  test(`unsupported OCS/extruded polyline ${JSON.stringify(patch)} cannot become an XY approximation`, async () => {
    const document = await drawing([polyline('native', [[0, 0], [2, 0]], patch)])
    assert.throws(() => unchanged(document, () => queryNativePolylineBounds(document, options(document))), { code: 'KJNATIVE_POLYLINE_SCOPE_UNSUPPORTED' })
  })
test('all-owner diagnostics retain unsupported TEXT/HATCH/LINE even beyond the returned page; finite scope states exclusion', async () => {
  const document = await drawing([polyline('native', [[0, 0], [2, 0]]), anchor([1000, 1000]),
    { id: 'line', type: 'LINE', payload: { start: [0, 0], end: [1, 0] } },
    { id: 'fill', type: 'HATCH', payload: { solid: true, boundaryLoops: [{ vertices: [[0, 0], [1, 0], [1, 1]], closed: true }] } }])
  assert.throws(() => queryNativePolylineBounds(document, options(document, { typeScope: 'all-owner-entities', limit: 1 })), { code: 'KJNATIVE_POLYLINE_SCOPE_UNSUPPORTED' })
  const all = queryNativePolylineBounds(document, options(document, { typeScope: 'all-owner-entities', unsupportedPolicy: 'diagnostics', limit: 1 }))
  assert.equal(all.complete, false); assert.equal(all.scopeComplete, false); assert.deepEqual(all.rows, []); assert.equal(all.bounds, null)
  assert.deepEqual(all.diagnostics.map(value => value.type), ['TEXT', 'LINE', 'HATCH'])
  const limited = queryNativePolylineBounds(document, options(document))
  assert.equal(limited.complete, true); assert.equal(limited.typeScope, 'lwpolyline-centerline-only')
  assert.equal(limited.excludedCounts.otherTypes, 3); assert.deepEqual(limited.bounds, { min: [0, 0], max: [2, 0] })
})
test('closed/hidden/frozen/locked policies remain actual native layer semantics', async () => {
  const document = await drawing([anchor([0, 0]), polyline('shown', [[0, 1], [1, 1]]), polyline('hidden', [[0, 2], [1, 2]], { visible: false })])
  await document.transact('Native layer semantics', tx => {
    const frozen = tx.upsertTableRecord('layers', { name: 'Public frozen', payload: { visible: true, frozen: true } })
    const locked = tx.upsertTableRecord('layers', { name: 'Public locked', payload: { visible: true, locked: true } })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 3], [1, 3]], layerId: frozen.id }, { id: 'frozen' })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 4], [1, 4]], layerId: locked.id }, { id: 'locked' })
  })
  const visible = queryNativePolylineNeighborhood(document, nearby(document, { visibility: 'visible-only' }))
  assert.deepEqual(visible.rows.map(row => row.id), ['shown', 'locked']); assert.equal(visible.excludedCounts.hidden, 2)
  const all = queryNativePolylineNeighborhood(document, nearby(document))
  assert.equal(all.rows.length, 4); assert.equal(all.rows.find(row => row.id === 'frozen').visible, false)
  await document.transact('Hide TEXT', tx => tx.updateObject('anchor', { payload: { visible: false } }))
  assert.throws(() => queryNativePolylineNeighborhood(document, nearby(document, { visibility: 'visible-only' })), { code: 'KJNATIVE_POLYLINE_ANCHOR_HIDDEN' })
})
test('entire owner entity budget includes hidden/type-excluded records; edge budget cannot hide later-page work', async () => {
  const document = await drawing([anchor([0, 0]), polyline('a', [[0, 0], [1, 0], [1, 1]]),
    polyline('b', [[2, 0], [3, 0], [3, 1]], { visible: false })])
  assert.throws(() => unchanged(document, () => queryNativePolylineBounds(document, options(document, { maxEntities: 2, visibility: 'visible-only' }))), { code: 'KJNATIVE_POLYLINE_ENTITY_LIMIT' })
  assert.throws(() => unchanged(document, () => queryNativePolylineBounds(document, options(document, { maxEdges: 3, limit: 1, unsupportedPolicy: 'diagnostics' }))), { code: 'KJNATIVE_POLYLINE_EDGE_LIMIT' })
  assert.equal(queryNativePolylineBounds(document, options(document, { maxEdges: 2, visibility: 'visible-only' })).rows.length, 1)
})
test('single many-vertex polyline cannot bypass the explicit finite edge work budget', async () => {
  const document = await drawing([polyline('many', Array.from({ length: 4098 }, (_, index) => [index, 0]))])
  assert.throws(() => queryNativePolylineBounds(document, options(document)), { code: 'KJNATIVE_POLYLINE_EDGE_LIMIT' })
})
for (const unsupportedPolicy of ['diagnostics', 'reject']) for (const failure of ['late-numerical', 'invalid-flags', 'malformed-native-point'])
  test(`declared work remains debited after ${failure} under ${unsupportedPolicy}; a second entity cannot reuse 4096 edge budget`, async () => {
    const vertices = Array.from({ length: 4001 }, (_, index) => vertex([index, 0]))
    if (failure === 'late-numerical') {
      vertices[3999].bulge = 1
      vertices[4000].point = [3999, 0]
    }
    const document = await drawing([polyline('bad-first', vertices, failure === 'invalid-flags' ? { dxfFlags: 2 } : {}),
      polyline('second', Array.from({ length: 201 }, (_, index) => [index, 1]))])
    const target = failure === 'malformed-native-point' ? (() => {
      const state = structuredClone(document.snapshot()); state.objects['bad-first'].payload.vertices[3999].point = [3999, 0]
      return KJDocument.open(state)
    })() : document
    assert.throws(() => unchanged(target, () => queryNativePolylineBounds(target, options(target, { unsupportedPolicy, limit: 1 }))),
      { code: 'KJNATIVE_POLYLINE_EDGE_LIMIT' })
  })
test('failed native polyline work is visible in the edge ledger even when diagnostics fit inside budget', async () => {
  const document = await drawing([polyline('bad', [vertex([0, 0]), vertex([1, 0]), vertex([2, 0])], { dxfFlags: 2 }),
    polyline('good', [[3, 0], [4, 0]])])
  const result = queryNativePolylineBounds(document, options(document, { maxEdges: 3, unsupportedPolicy: 'diagnostics' }))
  assert.equal(result.inspectedPolylineEdgeCount, 3); assert.equal(result.scopeComplete, false)
  assert.deepEqual(result.rows, []); assert.equal(result.bounds, null)
})
test('entity pagination keeps stable scope bounds and complete totals without calling any partial page the entire result', async () => {
  const document = await drawing(Array.from({ length: 7 }, (_, index) => polyline(`native-${index}`, [[index, -index], [index + 1, 2]])))
  const ids = []; let offset = 0, pages = 0
  do {
    const result = unchanged(document, () => queryNativePolylineBounds(document, options(document, { limit: 2, offset })))
    assert.equal(result.scopeComplete, true); assert.equal(result.complete, false); assert.equal(result.totalResultCount, 7)
    assert.deepEqual(result.bounds, { min: [0, -6], max: [7, 2] }); ids.push(...result.rows.map(row => row.id)); pages++; offset = result.nextOffset
  } while (offset !== null)
  assert.equal(pages, 4); assert.equal(new Set(ids).size, 7)
  assert.deepEqual(ids, Array.from({ length: 7 }, (_, index) => `native-${index}`))
  assert.throws(() => queryNativePolylineBounds(document, options(document, { offset: 8 })), /Offset cannot skip/)
})
test('neighborhood pagination is entity-based even when a polyline has multiple nearby edges', async () => {
  const document = await drawing([anchor([0, 0]), ...Array.from({ length: 5 }, (_, index) => polyline(`near-${index}`, [[index, 1], [index, 2], [index + 1, 2]]))])
  const first = queryNativePolylineNeighborhood(document, nearby(document, { limit: 2 }))
  assert.equal(first.totalResultCount, 5); assert.equal(first.complete, false); assert.equal(first.nextOffset, 2)
  const last = queryNativePolylineNeighborhood(document, nearby(document, { offset: 4, limit: 2 }))
  assert.equal(last.nextOffset, null); assert.equal(last.complete, false); assert.equal(last.rows.length, 1)
})
test('byte budget rejects entire result without truncation; explicit small page still has correct total', async () => {
  const document = await drawing(Array.from({ length: 12 }, (_, index) => polyline(`public-${index}`, [[0, 0], [1, 1]])))
  assert.throws(() => unchanged(document, () => queryNativePolylineBounds(document, options(document, { maxBytes: 1024 }))), { code: 'KJNATIVE_POLYLINE_BYTE_LIMIT' })
  const page = queryNativePolylineBounds(document, options(document, { maxBytes: 2048, limit: 1 }))
  assert.equal(page.rows.length, 1); assert.equal(page.totalResultCount, 12); assert.equal(page.nextOffset, 1)
})
test('exact owner, units, ID, and revision reject aliases/foreign references, not best-effort conversion', async () => {
  const document = await drawing([anchor([0, 0]), polyline('native', [[3, 4], [6, 8]])], 'meter')
  assert.equal(queryNativePolylineNeighborhood(document, nearby(document, { radius: 5 })).rows[0].distance, 5)
  for (const [patch, code] of [[{ documentId: 'foreign' }, 'KJNATIVE_POLYLINE_DOCUMENT_MISMATCH'],
    [{ expectedRevision: document.revision + 1 }, 'KJDOCUMENT_REVISION_CONFLICT'], [{ units: 'mm' }, 'KJNATIVE_POLYLINE_UNITS_MISMATCH'],
    [{ ownerId: document.spaces.paperSpaceIds[0] }, 'KJNATIVE_POLYLINE_OWNER_UNSUPPORTED'], [{ ownerId: 'foreign' }, 'KJNATIVE_POLYLINE_OWNER_UNSUPPORTED']])
    assert.throws(() => unchanged(document, () => queryNativePolylineBounds(document, options(document, patch))), { code })
  await document.transact('Native block owner', tx => tx.upsertTableRecord('blockRecords', { id: 'native-block', name: 'Public block', payload: { entityIds: [] } }))
  assert.throws(() => queryNativePolylineBounds(document, options(document, { ownerId: 'native-block' })), { code: 'KJNATIVE_POLYLINE_OWNER_UNSUPPORTED' })
})
test('foreign-owner/non-TEXT anchor is never substituted from a similar label or display centroid', async () => {
  const document = await drawing([polyline('native', [[0, 0], [2, 0]])])
  await document.transact('Foreign paper label', tx => tx.createEntity('TEXT', { position: [0, 0], text: 'Public paper', height: 2 }, { id: 'anchor', ownerId: document.spaces.paperSpaceIds[0] }))
  assert.throws(() => queryNativePolylineNeighborhood(document, nearby(document)), { code: 'KJNATIVE_POLYLINE_ANCHOR_UNSUPPORTED' })
  assert.throws(() => queryNativePolylineNeighborhood(document, nearby(document, { anchorId: 'native' })), { code: 'KJNATIVE_POLYLINE_ANCHOR_UNSUPPORTED' })
})
test('genuine snapshot is used despite overridden facade methods', async () => {
  const document = await drawing([polyline('native', [[0, 0], [2, 0]])]), input = options(document)
  for (const key of ['snapshot', 'listEntities', 'getObject']) Object.defineProperty(document, key, { value() { throw Error('fake facade') } })
  assert.equal(queryNativePolylineBounds(document, input).rows[0].id, 'native')
  assert.throws(() => queryNativePolylineBounds({}, input), /actual KJDocument/)
})
for (const patch of [{ closedPolicy: undefined }, { closedPolicy: 'force-closed' }, { widthPolicy: undefined }, { widthPolicy: 'include-stroke' },
  { maxEdges: 0 }, { maxEdges: 4097 }, { maxEdges: '10' }, { maxEntities: 4097 }, { maxBytes: 262145 }, { maxBytes: 1023 },
  { expectedRevision: '1' }, { limit: 201 }, { limit: 0 }, { offset: -1 }, { visibility: undefined },
  { typeScope: undefined }, { unsupportedPolicy: undefined }, { ownerPolicy: 'project-paper' }, { extra: 1 }])
  test(`invalid explicit polyline policy/resource budget ${JSON.stringify(patch)}`, async () => {
    const document = await drawing([polyline('native', [[0, 0], [2, 0]])])
    assert.throws(() => unchanged(document, () => queryNativePolylineBounds(document, options(document, patch))), { code: 'KJDOCUMENT_INVALID' })
  })
for (const patch of [{ radius: 0 }, { radius: -1 }, { radius: NaN }, { radius: Infinity }, { radius: '10' }, { radius: 1e13 },
  { metric: 'distance-to-vertices' }, { boundary: 'exclusive' }])
  test(`invalid neighborhood metric/radius ${JSON.stringify(patch)}`, async () => {
    const document = await drawing([anchor([0, 0]), polyline('native', [[0, 0], [2, 0]])])
    assert.throws(() => unchanged(document, () => queryNativePolylineNeighborhood(document, nearby(document, patch))), { code: 'KJDOCUMENT_INVALID' })
  })
test('accessors/inheritance/nonenumerable/symbol option fields reject without executing getters', async () => {
  const document = await drawing([polyline('native', [[0, 0], [2, 0]])]), valid = options(document); let getters = 0
  const inherited = { ...valid }; delete inherited.maxEdges; Object.setPrototypeOf(inherited, { maxEdges: 4096 })
  for (const input of [Object.defineProperty({ ...valid }, 'ownerId', { enumerable: true, get() { getters++; return valid.ownerId } }),
    Object.defineProperty({ ...valid }, 'closedPolicy', { enumerable: false, value: 'native-closed-flag' }),
    { ...valid, [Symbol('hidden')]: true }, inherited])
    assert.throws(() => queryNativePolylineBounds(document, input), { code: 'KJDOCUMENT_INVALID' })
  assert.equal(getters, 0)
})
test('actual edits, erased-state undo/redo history remain usable and byte-identical through read queries', async () => {
  const document = await drawing([polyline('a', [[0, 0], [2, 0]]), polyline('b', [[10, 0], [12, 0]])])
  await document.transact('Erase native second polyline', tx => tx.eraseObject('b'))
  assert.equal(unchanged(document, () => queryNativePolylineBounds(document, options(document))).rows.length, 1)
  await document.undo({ expectedRevision: document.revision })
  assert.equal(unchanged(document, () => queryNativePolylineBounds(document, options(document))).rows.length, 2)
  await document.redo({ expectedRevision: document.revision })
  assert.equal(unchanged(document, () => queryNativePolylineBounds(document, options(document))).rows.length, 1)
})
test('actual public DXF import/reexport/reopen keeps raw bulge/closure semantics and source bytes unchanged', async () => {
  const sdk = createKJDrawSDK(), original = await drawing([polyline('open', [vertex([0, 0], 1), vertex([2, 0], -1)]),
    polyline('closed', [vertex([10, 0]), vertex([12, 0], 1)], { closed: true })])
  const bytes = await sdk.writeDocument(original, { format: 'DXF' }), before = createHash('sha256').update(bytes).digest('hex')
  const imported = await sdk.readDocument(bytes, { format: 'DXF' }), result = unchanged(imported, () => queryNativePolylineBounds(imported, options(imported)))
  assert.deepEqual(result.rows[0].bounds, { min: [0, -1], max: [2, 0] }); assert.equal(result.rows[0].openTerminalBulgeIgnored, true)
  assert.deepEqual(result.rows[1].bounds, { min: [10, 0], max: [12, 1] }); assert.equal(result.rows[1].closed, true)
  const returned = await sdk.readDocument(await sdk.writeDocument(imported, { format: 'DXF' }), { format: 'DXF' })
  const again = queryNativePolylineBounds(returned, options(returned))
  assert.deepEqual(again.rows.map(row => [row.handle, row.closed, row.edgeCount, row.arcEdgeCount, row.bounds]),
    result.rows.map(row => [row.handle, row.closed, row.edgeCount, row.arcEdgeCount, row.bounds]))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), before)
})
test('helper stays independent of benchmarks, old helper changes, registry and root exports', async () => {
  const source = await readFile(new URL('../packages/kjdraw-sdk/src/agent-native-polyline-geometry-query.ts', import.meta.url), 'utf8')
  for (const token of ['geology-round9', 'expectedRound9', 'fixture', 'KJDRAW_AGENT_TOOLS', 'agent-native-geometry-query']) assert.equal(source.includes(token), false)
  const index = await readFile(new URL('../packages/kjdraw-sdk/src/index.ts', import.meta.url), 'utf8')
  assert.equal(index.includes('agent-native-polyline-geometry-query'), false)
})
