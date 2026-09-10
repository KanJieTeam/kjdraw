import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { createDrawingContext } from '../src/drawing-context.js'
import { KJAgentToolSession } from '../src/agent-tools.js'

const query = (revision, filters = {}, options = {}) => ({ expectedRevision: revision, filters, offset: 0, layerOffset: 0, limit: 50, maxLayers: 0, maxBytes: 65536, ...options })
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
async function fixture() {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument({ documentId: 'query', units: 'millimeter' })
  const layers = await doc.transact('query geometry', tx => {
    const locked = tx.upsertTableRecord('layers', { name: 'locked', payload: { locked: true } })
    const hidden = tx.upsertTableRecord('layers', { name: 'hidden', payload: { visible: false } })
    tx.createEntity('LINE', { start: [-100, 0], end: [100, 0], secret: 'private' }, { id: 'crossing' })
    tx.createEntity('LINE', { start: [30, 30], end: [40, 40] }, { id: 'outside' })
    tx.createEntity('CIRCLE', { center: [0, 0], radius: 10, layerId: locked.id }, { id: 'circle' })
    tx.createEntity('POINT', { position: [0, 0], layerId: hidden.id }, { id: 'hidden' })
    tx.createEntity('LINE', { start: [0, 0], end: [1, 1] }, { id: 'paper', ownerId: doc.snapshot().spaces.paperSpaceIds[0] })
    return { locked: locked.id, hidden: hidden.id }
  })
  return { sdk, doc, session: new KJAgentToolSession(sdk, doc), ...layers }
}

test('owner-XY crossing uses actual line and arc geometry, retaining explicit uncertainty', async () => {
  const { doc } = await fixture()
  await doc.transact('curves and uncertainty', tx => {
    tx.createEntity('ARC', { center: [0, 0], radius: 10, startAngle: 0, endAngle: Math.PI / 2 }, { id: 'arc' })
    tx.createEntity('LINE', { start: [999, 999], end: [1000, 1000], normal: [0, 1, 0] }, { id: 'tilted' })
    tx.createEntity('TEXT', { position: [1000, 1000], height: 2, text: 'untrusted' }, { id: 'label' })
    tx.createEntity('RAY', { origin: [30, 0], direction: [-1, 0] }, { id: 'ray' })
  })
  const center = createDrawingContext(doc, { bounds: [-1, -1, 1, 1], maxLayers: 0 })
  assert.deepEqual(center.entities.map(e => [e.id, e.spatialMatch]), [['crossing', 'intersects'], ['tilted', 'unclassified'], ['label', 'unclassified'], ['ray', 'intersects']])
  const north = createDrawingContext(doc, { bounds: [-.1, 9.9, .1, 10.1], types: ['ARC', 'CIRCLE'] })
  assert.deepEqual(north.entities.map(e => e.id), ['circle', 'arc'])
  assert.deepEqual(createDrawingContext(doc, { bounds: [-.1, -10.1, .1, -9.9], types: ['ARC'] }).entities, [])
  assert.equal(center.spatialQuery.coordinates, 'owner-xy')
  assert.throws(() => center.spatialQuery.bounds.push(4), TypeError)
  assert.equal(center.entities.find(e => e.id === 'tilted').geometry.normal[1], 1)
})

test('model query intersects filters, paginates matched objects and preserves native space and read-only state', async () => {
  const { doc, session, locked } = await fixture(), before = doc.serialize()
  const filters = { bounds: [-1, -1, 11, 1], ids: ['circle', 'outside', 'crossing'], types: ['line', 'circle'] }
  const first = value(await session.call('cad_query_drawing', query(doc.revision, filters, { limit: 1 })))
  assert.equal(first.entities[0].id, 'circle'); assert.equal(first.entities[0].editable, false)
  const next = value(await session.call('cad_query_drawing', query(first.revision, filters, { offset: first.nextOffset, limit: 1 })))
  assert.deepEqual(next.entities.map(e => e.id), ['crossing']); assert.equal(next.nextOffset, null)
  assert.equal(value(await session.call('cad_query_drawing', query(doc.revision, { ...filters, layerIds: [locked] }))).entities.length, 1)
  assert.deepEqual(value(await session.call('cad_query_drawing', query(doc.revision, { ids: [] }))).entities, [])
  const paper = value(await session.call('cad_query_drawing', query(doc.revision, { spaceId: doc.snapshot().spaces.paperSpaceIds[0], bounds: [-2, -2, 2, 2] })))
  assert.deepEqual(paper.entities.map(e => e.id), ['paper'])
  const hidden = value(await session.call('cad_query_drawing', query(doc.revision, { includeHidden: true, ids: ['hidden'] })))
  assert.equal(hidden.entities[0].visible, false); assert.equal(hidden.entities[0].editable, false)
  assert.doesNotMatch(JSON.stringify(first), /private/); assert.equal(doc.serialize(), before)
})

test('query rejects stale revisions, malformed filters and excessive budgets before disclosure', async () => {
  const { doc, session } = await fixture()
  for (const filters of [{ bounds: [1, 0, -1, 2] }, { bounds: [0, 0, Infinity, 1] }, { bounds: [0, 0, '2', 2] }, { bounds: new Array(4) }, { typo: [] }, { ids: [null] }, { includeHidden: 1 }, { spaceId: 'crossing' }]) {
    assert.equal((await session.call('cad_query_drawing', query(doc.revision, filters))).ok, false)
  }
  for (const options of [{ maxBytes: 999 }, { limit: 201 }, { offset: -.1 }]) assert.equal((await session.call('cad_query_drawing', query(doc.revision, {}, options))).ok, false)
  assert.equal((await session.call('cad_query_drawing', query(doc.revision - 1))).ok, false)
  const missing = query(doc.revision); delete missing.limit
  assert.equal((await session.call('cad_query_drawing', missing)).ok, false)
  assert.throws(() => createDrawingContext(doc, { bounds: [0, 0, 1e13, 2] }))
})

test('filtered byte-budget pagination makes progress over a large drawing without leaking unrelated geometry', async () => {
  const { doc, session } = await fixture()
  await doc.transact('large drawing', tx => {
    for (let i = 0; i < 2000; i++) tx.createEntity('LINE', { start: [i, 20], end: [i, 21] }, { id: `line-${i}` })
  })
  const filters = { types: ['LINE'], bounds: [995, 19, 1005, 22] }, ids = []
  let offset = 0
  do {
    const page = value(await session.call('cad_query_drawing', query(doc.revision, filters, { offset, limit: 200, maxBytes: 1024 })))
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024)
    assert.ok(page.entities.length > 0)
    ids.push(...page.entities.map(e => e.id))
    if (page.nextOffset !== null) assert.ok(page.nextOffset > offset)
    offset = page.nextOffset
  } while (offset !== null)
  assert.deepEqual(ids, Array.from({ length: 11 }, (_, i) => `line-${995 + i}`))
})

test('hatch region queries respect polygon holes and nested islands before and after move, undo and DXF reopen', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument()
  await doc.transact('islands', tx => tx.createEntity('HATCH', {
    solid: false, patternName: 'ORIGINAL_GRID', patternLines: [{ angle: 0, base: [0, 0], offset: [0, 2], dashes: [] }],
    boundaryLoops: [{ vertices: [[0, 0], [30, 0], [30, 30], [0, 30]] }, { external: false, vertices: [[5, 5], [25, 5], [25, 25], [5, 25]] }, { external: false, vertices: [[10, 10], [20, 10], [20, 20], [10, 20]] }],
  }, { id: 'hatch' }))
  const regions = (document, dx = 0) => [[1, 1, 2, 2], [6, 6, 7, 7], [11, 11, 12, 12], [29, 15, 31, 16], [40, 40, 41, 41]].map(bounds => createDrawingContext(document, { bounds: bounds.map((n, i) => i % 2 === 0 ? n + dx : n), types: ['HATCH'], maxLayers: 0 }).entities.map(e => e.spatialMatch))
  const expected = [['intersects'], [], ['intersects'], ['intersects'], []]
  assert.deepEqual(regions(doc), expected)
  await sdk.executeCommand('MOVE', { id: 'hatch', dx: 50, dy: 0 })
  assert.deepEqual(regions(doc, 50), expected)
  await sdk.executeCommand('UNDO'); assert.deepEqual(regions(doc), expected)
  await sdk.executeCommand('REDO')
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(doc, { format: 'DXF' }), { format: 'DXF' })
  assert.deepEqual(regions(reopened, 50), expected)
})

test('hatch LINE and bulged regions are classified while unsupported patterns remain explicit', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument()
  await doc.transact('hatch boundaries', tx => {
    tx.createEntity('HATCH', { solid: true, boundaryLoops: [{ edges: [{ type: 'LINE', start: [0, 0], end: [10, 0] }, { type: 'LINE', start: [10, 0], end: [10, 10] }, { type: 'LINE', start: [10, 10], end: [0, 10] }, { type: 'LINE', start: [0, 10], end: [0, 0] }] }] }, { id: 'edges' })
    tx.createEntity('HATCH', { solid: true, boundaryLoops: [{ vertices: [{ point: [0, 0], bulge: 1 }, { point: [10, 0] }, { point: [10, 10] }] }] }, { id: 'curved' })
    tx.createEntity('HATCH', { solid: false, patternName: 'UNDEFINED', boundaryLoops: [{ vertices: [[0, 0], [10, 0], [10, 10]] }] }, { id: 'unknown' })
  })
  const result = createDrawingContext(doc, { bounds: [1, 1, 2, 2], maxLayers: 0 })
  assert.deepEqual(result.entities.map(e => [e.id, e.spatialMatch]), [['edges', 'intersects'], ['curved', 'intersects'], ['unknown', 'unclassified']])
  const outside = createDrawingContext(doc, { bounds: [100, 100, 101, 101], maxLayers: 0 })
  assert.deepEqual(outside.entities.map(e => e.id), ['unknown'])
})

test('circular hatch holes use exact arcs in either direction, including tiny regions between display chords', async () => {
  for (const clockwise of [false, true]) {
    const sdk = createKJDrawSDK(), doc = sdk.createDocument()
    await doc.transact('annulus', tx => tx.createEntity('HATCH', { solid: true, boundaryLoops: [10, 5].map(radius => ({ edges: [{ type: 'ARC', center: [0, 0], radius, startAngle: 0, endAngle: Math.PI * 2, clockwise }] })) }, { id: 'ring' }))
    const hit = (x, y, r = 0) => createDrawingContext(doc, { bounds: [x - r, y - r, x + r, y + r], maxLayers: 0 }).entities.length > 0
    for (let x = -11; x <= 11; x += .5) for (let y = -11; y <= 11; y += .5) {
      const radius = Math.hypot(x, y)
      assert.equal(hit(x, y), radius >= 5 - 1e-8 && radius <= 10 + 1e-8, `${clockwise}: ${x},${y}`)
    }
    const a = Math.PI / 72
    assert.equal(hit(9.999 * Math.cos(a), 9.999 * Math.sin(a), .00001), true)
    assert.equal(hit(4.999 * Math.cos(a), 4.999 * Math.sin(a), .00001), false)
    assert.equal(hit(10, 0, .001), true)
    assert.equal(hit(0, 10.01, .001), false)
  }
})

test('two-bulge circular boundaries retain exact holes through reflection, history and independent SDK reopen', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument()
  await doc.transact('bulged annulus', tx => tx.createEntity('HATCH', { solid: true, boundaryLoops: [10, 5].map(r => ({ vertices: [{ point: [-r, 0], bulge: 1 }, { point: [r, 0], bulge: 1 }] })) }, { id: 'bulged' }))
  const regions = document => [[0, 0], [7, 0], [0, -7], [0, 7], [12, 0]].map(([x, y]) => createDrawingContext(document, { bounds: [x, y, x, y], maxLayers: 0 }).entities.length)
  assert.deepEqual(regions(doc), [0, 1, 1, 1, 0])
  const { transformEntityPayload } = await import('../src/geometry/transform.js')
  const { scale3 } = await import('../src/geometry/matrix3.js')
  await doc.transact('reflect', tx => tx.updateObject('bulged', { payload: transformEntityPayload('HATCH', doc.getObject('bulged').payload, scale3(-1, 1)) }))
  assert.deepEqual(regions(doc), [0, 1, 1, 1, 0])
  await sdk.executeCommand('UNDO'); await sdk.executeCommand('REDO')
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(doc, { format: 'DXF' }), { format: 'DXF' })
  assert.deepEqual(regions(reopened), [0, 1, 1, 1, 0])
})
