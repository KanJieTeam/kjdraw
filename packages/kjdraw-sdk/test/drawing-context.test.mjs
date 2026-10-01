import assert from 'node:assert/strict'
import test from 'node:test'
import { KJDocument } from '../src/document.js'
import { createDrawingContext } from '../src/drawing-context.js'
import { KJRevisionConflictError, KJValidationError } from '../src/errors.js'
import { reflectionAcrossLine3 } from '../src/geometry/matrix3.js'
import { transformEntityPayload } from '../src/geometry/transform.js'

const byteLength = value => Buffer.byteLength(JSON.stringify(value), 'utf8')

async function drawing() {
  const document = KJDocument.create({ documentId: 'drawing-context', units: 'millimeter', metadata: { secret: 'document-private' } })
  const fixture = await document.transact('Context fixture', transaction => {
    const locked = transaction.upsertTableRecord('layers', { name: 'Locked', payload: { visible: true, locked: true } })
    const hidden = transaction.upsertTableRecord('layers', { name: 'Hidden', payload: { visible: false } })
    const frozen = transaction.upsertTableRecord('layers', { name: 'Frozen', payload: { frozen: true } })
    const line = transaction.createEntity('LINE', { start: [1, 2, 3], end: [7, 8, 9], privateData: 'payload-private' }, { id: 'line', extension: { xdata: { secret: 'extension-private' } }, source: { secret: 'source-private' } })
    const arc = transaction.createEntity('ARC', { layerId: locked.id, center: [2, 3], radius: 6, startAngle: 0.3, endAngle: 1.7, clockwise: true }, { id: 'arc' })
    const hiddenPoint = transaction.createEntity('POINT', { layerId: hidden.id, position: [0, 0] }, { id: 'hidden-point' })
    const frozenPoint = transaction.createEntity('POINT', { layerId: frozen.id, position: [1, 1] }, { id: 'frozen-point' })
    const invisiblePoint = transaction.createEntity('POINT', { visible: false, position: [2, 2] }, { id: 'invisible-point' })
    const erasedPoint = transaction.createEntity('POINT', { position: [3, 3] }, { id: 'erased-point' })
    transaction.eraseObject(erasedPoint.id)
    const paperPoint = transaction.createEntity('POINT', { position: [4, 4] }, { id: 'paper-point', ownerId: document.snapshot().spaces.paperSpaceIds[0] })
    return { locked, hidden, frozen, line, arc, hiddenPoint, frozenPoint, invisiblePoint, erasedPoint, paperPoint }
  })
  return { document, ...fixture }
}

test('drawing context exposes frozen native geometry and document identity without metadata or mutation', async () => {
  const { document, line, arc } = await drawing()
  const before = document.serialize()
  const history = document.history
  let changes = 0
  document.on('document:change', () => changes++)
  const context = createDrawingContext(document)
  assert.equal(context.documentId, document.id)
  assert.equal(context.revision, 1)
  assert.equal(context.units, 'millimeter')
  assert.equal(context.spaceId, document.snapshot().spaces.modelSpaceId)
  assert.deepEqual(context.entities.map(entity => entity.id), [line.id, arc.id])
  assert.deepEqual(context.entities[0].geometry, { start: [1, 2, 3], end: [7, 8, 9], degenerate: false })
  assert.equal(context.entities[1].geometry.clockwise, true)
  assert.equal(context.entities[1].geometry.startAngle, 0.3)
  assert.equal(context.entities[1].geometry.radius, 6)
  assert.equal(context.entities[1].visible, true)
  assert.equal(context.entities[1].editable, false)
  assert.equal(context.truncated, false)
  assert.equal(context.nextOffset, null)
  assert.doesNotMatch(JSON.stringify(context), /document-private|payload-private|extension-private|source-private|revisions|opaquePayloads/)
  assert.throws(() => context.entities[0].geometry.start.push(42), TypeError)
  assert.throws(() => { context.layers[0].name = 'Changed' }, TypeError)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
  assert.equal(changes, 0)
})

test('visibility and editability follow hidden, frozen, locked and erased records', async () => {
  const { document, hidden, frozen, locked } = await drawing()
  const context = createDrawingContext(document, { includeHidden: true })
  assert.deepEqual(context.entities.map(entity => entity.id), ['line', 'arc', 'hidden-point', 'frozen-point', 'invisible-point'])
  for (const id of ['hidden-point', 'frozen-point', 'invisible-point']) {
    const entity = context.entities.find(entity => entity.id === id)
    assert.equal(entity.visible, false)
    assert.equal(entity.editable, false)
  }
  const layers = new Map(context.layers.map(layer => [layer.id, layer]))
  assert.equal(layers.get(hidden.id).visible, false)
  assert.equal(layers.get(frozen.id).frozen, true)
  assert.equal(layers.get(frozen.id).editable, false)
  assert.equal(layers.get(locked.id).locked, true)
  assert.equal(layers.get(locked.id).visible, true)
})

test('ID, type and layer filters intersect, empty filters match nothing, and ID order is deterministic', async () => {
  const { document, locked } = await drawing()
  const context = createDrawingContext(document, { ids: ['arc', 'line', 'arc', 'missing'], types: [' arc '], layerIds: [locked.id] })
  assert.deepEqual(context.entities.map(entity => entity.id), ['arc'])
  assert.deepEqual(context.layers.map(layer => layer.id), [locked.id])
  assert.deepEqual(createDrawingContext(document, { ids: ['arc', 'line', 'arc'] }).entities.map(entity => entity.id), ['arc', 'line'])
  for (const filter of [{ ids: [] }, { types: [] }, { layerIds: [] }]) assert.deepEqual(createDrawingContext(document, filter).entities, [])
  assert.deepEqual(createDrawingContext(document, { ids: ['__proto__', 'constructor'] }).entities, [])
})

test('space queries use the actual owner graph and do not expand INSERTs', async () => {
  const { document } = await drawing()
  const block = await document.transact('Block', transaction => {
    const block = transaction.upsertTableRecord('blockRecords', { id: 'definition', name: 'Definition', payload: { entityIds: [] } })
    transaction.createEntity('POINT', { position: [9, 10] }, { id: 'block-point', ownerId: block.id })
    transaction.createEntity('INSERT', { blockRecordId: block.id, position: [100, 100], scale: [2, 2, 2], attributes: { secret: 'attribute-private' } }, { id: 'insert' })
    return block
  })
  assert.deepEqual(createDrawingContext(document, { ids: ['paper-point'] }).entities, [])
  assert.deepEqual(createDrawingContext(document, { spaceId: document.snapshot().spaces.paperSpaceIds[0] }).entities.map(entity => entity.id), ['paper-point'])
  assert.deepEqual(createDrawingContext(document, { spaceId: block.id }).entities[0].geometry.position, [9, 10, 0])
  const insert = createDrawingContext(document, { ids: ['insert'] }).entities[0]
  assert.equal(insert.geometry.blockRecordId, block.id)
  assert.deepEqual(insert.geometry.position, [100, 100, 0])
  assert.doesNotMatch(JSON.stringify(insert), /attribute-private|block-point/)
  assert.throws(() => createDrawingContext(document, { spaceId: 'line' }), KJValidationError)
})

test('revision-bound pagination continues deterministically across entity and layer caps', async () => {
  const { document } = await drawing()
  const first = createDrawingContext(document, { limit: 1, maxLayers: 1 })
  assert.equal(first.nextOffset, 1)
  assert.equal(first.nextLayerOffset, 1)
  assert.deepEqual(first.truncationReasons, ['entity-limit', 'layer-limit'])
  const second = createDrawingContext(document, { limit: 1, maxLayers: 1, offset: first.nextOffset, layerOffset: first.nextLayerOffset, expectedRevision: first.revision })
  assert.equal(second.entities[0].id, 'arc')
  assert.equal(second.nextOffset, null)
  assert.notEqual(second.layers[0].id, first.layers[0].id)
  assert.throws(() => createDrawingContext(document, { offset: 1 }), KJValidationError)
  assert.throws(() => createDrawingContext(document, { layerOffset: 1 }), KJValidationError)
  await document.transact('Advance revision', transaction => transaction.createEntity('POINT', { position: [7, 7] }))
  assert.throws(() => createDrawingContext(document, { offset: 1, expectedRevision: first.revision }), KJRevisionConflictError)
  assert.throws(() => createDrawingContext(document, { expectedRevision: first.revision }), KJRevisionConflictError)
})

test('query options reject non-finite numbers, coercions, typos and oversized filters', () => {
  const document = KJDocument.create()
  for (const options of [
    null, [], { limti: 1 }, { limit: NaN }, { limit: Infinity }, { limit: 1.5 }, { limit: '1' }, { limit: 201 }, { maxLayers: 101 },
    { maxBytes: 1023 }, { maxBytes: 262145 }, { expectedRevision: -1 }, { expectedRevision: null }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { offset: -1 }, { layerOffset: Infinity }, { includeHidden: 'false' }, { ids: 'line' }, { ids: [''] }, { ids: [42] }, { ids: ['x'.repeat(513)] },
    { ids: Array(201).fill('x') }, { types: [null] }, { layerIds: [' '] }, { spaceId: null },
  ]) assert.throws(() => createDrawingContext(document, options), KJValidationError, JSON.stringify(options))
})

test('huge text and polylines omit geometry atomically while retaining stable IDs and subsequent entities', async () => {
  const document = KJDocument.create({ documentId: 'huge-geometry' })
  await document.transact('Large native fields', transaction => {
    transaction.createEntity('TEXT', { position: [0, 0], text: '秘密🌍'.repeat(100_000) }, { id: 'huge-text' })
    transaction.createEntity('LWPOLYLINE', { vertices: Array.from({ length: 2000 }, (_, index) => [index, index * 2]) }, { id: 'huge-polyline' })
    transaction.createEntity('POINT', { position: [8, 9] }, { id: 'small-point' })
  })
  const context = createDrawingContext(document, { maxLayers: 0 })
  assert.deepEqual(context.entities.map(entity => entity.id), ['huge-text', 'huge-polyline', 'small-point'])
  for (const entity of context.entities.slice(0, 2)) {
    assert.equal(entity.geometry, null)
    assert.equal(entity.geometryOmittedReason, 'geometry-budget')
  }
  assert.deepEqual(context.entities[2].geometry.position, [8, 9, 0])
  assert.deepEqual(context.pageEntityCounts, { TEXT: 1, LWPOLYLINE: 1, POINT: 1 }, 'geometry omission does not omit the admitted native entity count')
  assert.deepEqual(context.truncationReasons, ['geometry-budget'])
  assert.ok(byteLength(context) <= context.limits.maxBytes)
})

test('UTF-8 response budgets include JSON escaping and support progress at the minimum cap', async () => {
  const document = KJDocument.create({ documentId: '图纸🌍' })
  await document.transact('Unicode', transaction => {
    for (let index = 0; index < 12; index++) transaction.createEntity('TEXT', { position: [index, 0], text: '\u0000"\\测🌍'.repeat(100) }, { id: `文字-${index}` })
  })
  const seen = []
  let offset = 0
  for (let page = 0; page < 12; page++) {
    const context = createDrawingContext(document, { offset, expectedRevision: document.revision, maxLayers: 0, maxBytes: 1024 })
    assert.ok(byteLength(context) <= 1024)
    assert.ok(context.entities.length > 0)
    seen.push(...context.entities.map(entity => entity.id))
    assert.ok(context.truncationReasons.includes('response-budget'))
    if (context.nextOffset === null) break
    assert.ok(context.nextOffset > offset)
    offset = context.nextOffset
  }
  assert.deepEqual(seen, Array.from({ length: 12 }, (_, index) => `文字-${index}`))
  assert.equal(new Set(seen).size, 12)
})

test('native field projection excludes nested metadata and reports unsupported geometry', async () => {
  const document = KJDocument.create()
  await document.transact('Native projection', transaction => {
    transaction.createEntity('LWPOLYLINE', { closed: true, vertices: [{ point: [1, 2], bulge: 0.5, startWidth: 2, endWidth: 3, metadata: 'nested-private' }, { point: [3, 4] }] }, { id: 'polyline' })
    transaction.createEntity('PROXY_ENTITY', { originalType: 'UNKNOWN', rawData: 'raw-private' }, { id: 'proxy' })
    transaction.createEntity('PLUGIN_ENTITY', { position: [0, 0], secret: 'custom-private' }, { id: 'custom' })
    transaction.createEntity('HATCH', { boundaryLoops: [{ edges: [{ type: 'ELLIPSE', rawTags: [{ code: 1, value: 'edge-private' }] }] }] }, { id: 'raw-hatch' })
  })
  const context = createDrawingContext(document)
  const entities = new Map(context.entities.map(entity => [entity.id, entity]))
  assert.deepEqual(entities.get('polyline').geometry.vertices[0], { point: [1, 2, 0], bulge: 0.5, startWidth: 2, endWidth: 3 })
  assert.equal(entities.get('proxy').geometryOmittedReason, 'unsupported-type')
  assert.equal(entities.get('custom').geometryOmittedReason, 'unsupported-type')
  assert.equal(entities.get('raw-hatch').geometryOmittedReason, 'unsupported-data')
  assert.equal(entities.get('raw-hatch').geometry, null)
  assert.deepEqual(context.truncationReasons, ['unsupported-geometry'])
  assert.doesNotMatch(JSON.stringify(context), /nested-private|raw-private|custom-private|edge-private/)
})

test('layer-only pages and disabled collections retain bounded identity context', async () => {
  const { document } = await drawing()
  const layers = []
  let layerOffset = 0
  for (let page = 0; page < 4; page++) {
    const context = createDrawingContext(document, { limit: 0, maxLayers: 1, layerOffset, expectedRevision: document.revision })
    assert.deepEqual(context.entities, [])
    assert.equal(context.nextOffset, null)
    layers.push(...context.layers.map(layer => layer.id))
    if (context.nextLayerOffset === null) break
    layerOffset = context.nextLayerOffset
  }
  assert.deepEqual(layers, document.snapshot().tables.layers.recordIds)
  const identity = createDrawingContext(document, { limit: 0, maxLayers: 0 })
  assert.deepEqual(identity.layers, [])
  assert.equal(identity.truncated, false)
  const empty = createDrawingContext(KJDocument.create())
  assert.deepEqual(empty.entities, [])
  assert.equal(empty.truncated, false)
})

test('native and mirrored HATCH arc edges retain both stored direction conventions', async () => {
  const document = KJDocument.create()
  const hatch = await document.transact('Clockwise hatch', transaction => transaction.createEntity('HATCH', {
    boundaryLoops: [{ edges: [
      { type: 'ARC', center: [3, 4, 0], radius: 2, startAngle: 0, endAngle: Math.PI / 2, clockwise: true },
      { type: 'ARC', center: [3, 4, 0], radius: 2, startAngle: Math.PI / 2, endAngle: Math.PI, counterClockwise: false },
    ] }],
  }))
  const initial = createDrawingContext(document, { ids: [hatch.id] }).entities[0]
  assert.deepEqual(initial.geometry.boundaryLoops[0].edges, hatch.payload.boundaryLoops[0].edges)
  const reflection = reflectionAcrossLine3([0, 0], [0, 1])
  const mirrored = transformEntityPayload('HATCH', hatch.payload, reflection)
  await document.transact('Mirror hatch', transaction => transaction.updateObject(hatch.id, { payload: mirrored }))
  const storedEdges = document.getObject(hatch.id).payload.boundaryLoops[0].edges
  const contextEdges = createDrawingContext(document, { ids: [hatch.id] }).entities[0].geometry.boundaryLoops[0].edges
  assert.deepEqual(contextEdges, storedEdges)
  assert.equal(contextEdges[0].clockwise, false)
  // Reflection reverses the actual sweep regardless of which direction field was supplied.
  assert.equal(contextEdges[1].clockwise, false)
  assert.equal(contextEdges[1].counterClockwise, true)
  assert.ok(Math.abs(contextEdges[1].startAngle - Math.PI / 2) < 1e-9)
  assert.ok(Math.abs(contextEdges[1].endAngle) < 1e-9)
  assert.deepEqual(contextEdges[0].center, [-3, 4, 0])
})

test('tilted native geometry retains OCS normals and extrusion directions without changing stored coordinates', async () => {
  const document = KJDocument.create()
  const normal = [0, 1, 0]
  const extrusionDirection = [0, 0, -1]
  await document.transact('Tilted native entities', transaction => {
    transaction.createEntity('LWPOLYLINE', { normal, extrusionDirection, vertices: [[1, 2, 3], [4, 5, 6]], elevation: 7 }, { id: 'tilted-polyline' })
    transaction.createEntity('TEXT', { normal, extrusionDirection, position: [8, 9, 10], text: 'OCS' }, { id: 'tilted-text' })
    transaction.createEntity('HATCH', { normal, extrusionDirection, boundaryLoops: [{ vertices: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] }] }, { id: 'tilted-hatch' })
  })
  const context = createDrawingContext(document)
  for (const entity of context.entities) {
    assert.deepEqual(entity.geometry.normal, normal)
    assert.deepEqual(entity.geometry.extrusionDirection, extrusionDirection)
    assert.equal(entity.geometryOmittedReason, null)
  }
  assert.deepEqual(context.entities[0].geometry.vertices[0].point, [1, 2, 3])
  assert.equal(context.entities[0].geometry.elevation, 7)
  assert.deepEqual(context.entities[1].geometry.position, [8, 9, 10])
  assert.deepEqual(context.entities[2].geometry.boundaryLoops[0].vertices[0].point, [1, 2, 3])
})

test('mirror orientation flags survive projection for existing ellipse, text and INSERT types', async () => {
  const document = KJDocument.create()
  const reflection = reflectionAcrossLine3([0, 0], [0, 1])
  await document.transact('Mirrored native entities', transaction => {
    const block = transaction.upsertTableRecord('blockRecords', { name: 'Mirror source', payload: { entityIds: [] } })
    const entities = [
      transaction.createEntity('ELLIPSE', { center: [2, 3], majorAxis: [4, 0], ratio: 0.5, startParameter: 0.2, endParameter: 1.4 }, { id: 'mirrored-ellipse' }),
      transaction.createEntity('TEXT', { position: [2, 3], text: 'Mirrored' }, { id: 'mirrored-text' }),
      transaction.createEntity('INSERT', { blockRecordId: block.id, position: [2, 3] }, { id: 'mirrored-insert' }),
    ]
    for (const entity of entities) transaction.updateObject(entity.id, { payload: transformEntityPayload(entity.type, entity.payload, reflection) })
  })
  const entities = new Map(createDrawingContext(document).entities.map(entity => [entity.id, entity]))
  assert.equal(entities.get('mirrored-ellipse').geometry.clockwise, true)
  assert.equal(entities.get('mirrored-text').geometry.mirrored, true)
  assert.equal(entities.get('mirrored-insert').geometry.mirrored, true)
  assert.deepEqual(entities.get('mirrored-ellipse').geometry.majorAxis, [-4, 0, 0])
})

test('an identity that cannot fit the budget fails explicitly without serializing it into the result', () => {
  const document = KJDocument.create({ documentId: 'x'.repeat(10_000) })
  assert.throws(() => createDrawingContext(document, { maxBytes: 1024 }), error => error instanceof KJValidationError && error.message.length < 200)
})

function exactReturnedPageCounts(context) {
  const counts = new Map()
  for (const entity of context.entities) counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1)
  return Object.fromEntries(counts)
}

test('page entity counts follow returned visibility, owner and intersected filters without revealing hidden inventory', async () => {
  const { document, locked } = await drawing()
  const before = document.serialize(), history = document.history
  const visible = createDrawingContext(document)
  assert.deepEqual(visible.pageEntityCounts, { LINE: 1, ARC: 1 })
  assert.equal(Object.hasOwn(visible.pageEntityCounts, 'POINT'), false)
  assert.deepEqual(createDrawingContext(document, { includeHidden: true }).pageEntityCounts, { LINE: 1, ARC: 1, POINT: 3 })
  assert.deepEqual(createDrawingContext(document, { includeHidden: true, types: ['POINT'], bounds: [-1, -1, 1.5, 1.5] }).pageEntityCounts, { POINT: 2 })
  assert.deepEqual(createDrawingContext(document, { types: ['LINE'], bounds: [100, 100, 110, 110] }).pageEntityCounts, {})
  const filtered = createDrawingContext(document, { ids: ['arc', 'line', 'arc', 'hidden-point'], types: ['arc'], layerIds: [locked.id] })
  assert.deepEqual(filtered.pageEntityCounts, { ARC: 1 })
  for (const options of [{ ids: [] }, { types: [] }, { layerIds: [] }, { limit: 0 }, { ids: ['paper-point', 'erased-point'] }]) {
    assert.deepEqual(createDrawingContext(document, options).pageEntityCounts, {})
  }
  const paper = createDrawingContext(document, { spaceId: document.spaces.paperSpaceIds[0] })
  assert.deepEqual(paper.pageEntityCounts, { POINT: 1 })
  assert.equal(Object.isFrozen(visible.pageEntityCounts), true)
  assert.throws(() => { visible.pageEntityCounts.LINE = 9000 }, TypeError)
  assert.equal(document.serialize(), before)
  assert.deepEqual(document.history, history)
})

test('page entity counts are page-local, sum across exact continuations, and never count native label text as extra entities', async () => {
  const { document } = await drawing()
  await document.transact('An inventory-looking label is one native entity', tx => {
    tx.createEntity('TEXT', { position: [0, 0], text: 'LINE LINE ARC POINT TEXT TEST-A TEST-B' }, { id: 'inventory-label' })
  })
  const seen = [], totals = new Map()
  let offset = 0
  for (let index = 0; index < 4; index++) {
    const page = createDrawingContext(document, { expectedRevision: document.revision, offset, limit: 1, maxLayers: 0 })
    assert.deepEqual(page.pageEntityCounts, exactReturnedPageCounts(page))
    assert.equal(Object.values(page.pageEntityCounts).reduce((sum, count) => sum + count, 0), 1)
    seen.push(...page.entities.map(entity => entity.id))
    for (const [type, count] of Object.entries(page.pageEntityCounts)) totals.set(type, (totals.get(type) ?? 0) + count)
    if (page.nextOffset === null) break
    assert.ok(page.nextOffset > offset)
    offset = page.nextOffset
  }
  assert.deepEqual(seen, ['line', 'arc', 'inventory-label'])
  assert.deepEqual(Object.fromEntries(totals), { LINE: 1, ARC: 1, TEXT: 1 })
  const exhausted = createDrawingContext(document, { expectedRevision: document.revision, offset: 3, maxLayers: 0 })
  assert.deepEqual(exhausted.pageEntityCounts, {})
  assert.equal(exhausted.nextOffset, null)
})

test('count key UTF-8 escaping and 9-to-10/99-to-100 growth stay inside every response budget during complete pagination', async () => {
  const document = KJDocument.create({ documentId: '计数-🌍' })
  await document.transact('Count budget stress', tx => {
    for (let index = 0; index < 130; index++) tx.createEntity('POINT', { position: [index, 0] }, { id: 'point-' + index })
    for (let index = 0; index < 30; index++) tx.createEntity('插件_🌍_"\\_' + index % 5,
      { privateData: 'unknown-native-payload-not-exposed' }, { id: 'plugin-' + index })
  })
  assert.equal(document.validate().valid, true)
  const before = document.serialize(), expectedIds = document.listEntities().map(entity => entity.id)
  for (const maxBytes of [1024, 1025, 1050, 1100, 1279, 1536, 2048, 4096, 8192, 16384, 65536]) {
    const seen = [], total = new Map()
    let offset = 0
    for (let pageNumber = 0; pageNumber < expectedIds.length; pageNumber++) {
      const page = createDrawingContext(document, { expectedRevision: document.revision, offset, limit: 200, maxLayers: 0, maxBytes })
      assert.ok(byteLength(page) <= maxBytes, `${maxBytes} bytes includes the actual pageEntityCounts JSON`)
      assert.deepEqual(page.pageEntityCounts, exactReturnedPageCounts(page))
      assert.ok(page.entities.length > 0)
      assert.equal(Object.values(page.pageEntityCounts).reduce((sum, count) => sum + count, 0), page.entities.length)
      seen.push(...page.entities.map(entity => entity.id))
      for (const [type, count] of Object.entries(page.pageEntityCounts)) total.set(type, (total.get(type) ?? 0) + count)
      if (page.nextOffset === null) break
      assert.ok(page.nextOffset > offset)
      offset = page.nextOffset
    }
    assert.deepEqual(seen, expectedIds, `complete, duplicate-free pagination at ${maxBytes} bytes`)
    assert.equal(new Set(seen).size, expectedIds.length)
    assert.equal(total.get('POINT'), 130)
    assert.equal([...total.values()].reduce((sum, value) => sum + value, 0), 160)
  }
  assert.equal(document.serialize(), before)
})

test('a rejected next-type count is not charged to or disclosed by the returned page', async () => {
  const document = KJDocument.create({ documentId: 'count-admission' })
  const longType = 'CUSTOM_"\\测🌍'.repeat(20)
  await document.transact('Long count key after small entities', tx => {
    tx.createEntity('POINT', { position: [0, 0] }, { id: 'small-a' })
    tx.createEntity('POINT', { position: [1, 0] }, { id: 'small-b' })
    tx.createEntity(longType, { privateData: 'not-a-count' }, { id: 'long-type' })
  })
  const first = createDrawingContext(document, { expectedRevision: document.revision, maxLayers: 0, maxBytes: 1024 })
  assert.ok(first.nextOffset !== null)
  assert.deepEqual(first.pageEntityCounts, exactReturnedPageCounts(first))
  assert.equal(Object.hasOwn(first.pageEntityCounts, document.getObject('long-type').type), false)
  assert.equal(JSON.stringify(first).includes(document.getObject('long-type').type), false)
  assert.ok(byteLength(first) <= 1024)
  const rest = createDrawingContext(document, { expectedRevision: document.revision, offset: first.nextOffset, maxLayers: 0, maxBytes: 4096 })
  assert.deepEqual(rest.pageEntityCounts, exactReturnedPageCounts(rest))
  assert.deepEqual([...first.entities, ...rest.entities].map(entity => entity.id), ['small-a', 'small-b', 'long-type'])
  assert.equal(rest.nextOffset, null)
})

test('admissible prototype-like native type names have exact own counts and never alter object prototypes', async () => {
  const document = KJDocument.create({ documentId: 'count-own-keys' })
  const requested = ['__proto__', 'constructor', 'toString', 'toJSON']
  await document.transact('Unusual native type names', tx => {
    for (const [index, type] of requested.entries()) tx.createEntity(type, { privateData: 'unsupported-native-data' }, { id: 'odd-' + index })
  })
  assert.equal(document.validate().valid, true)
  const page = createDrawingContext(document, { maxLayers: 0 })
  assert.deepEqual(page.pageEntityCounts, exactReturnedPageCounts(page))
  assert.deepEqual(Object.keys(page.pageEntityCounts), requested.map(type => type.toUpperCase()))
  assert.equal(Object.getPrototypeOf(page.pageEntityCounts), Object.prototype)
  for (const entity of page.entities) {
    assert.equal(Object.hasOwn(page.pageEntityCounts, entity.type), true)
    assert.equal(page.pageEntityCounts[entity.type], 1)
    assert.equal(entity.geometryOmittedReason, 'unsupported-type')
  }
  assert.equal(Object.hasOwn({}, '__PROTO__'), false)
  assert.equal(Object.hasOwn({}, 'CONSTRUCTOR'), false)
  assert.equal(JSON.stringify(page).includes('unsupported-native-data'), false)
  assert.ok(byteLength(page) <= page.limits.maxBytes)
})
