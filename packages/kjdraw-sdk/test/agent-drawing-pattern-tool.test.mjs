import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { createAgentGeometryPreview } from '../src/agent-preview.js'

const tool = 'cad_propose_drawing_pattern'
const empty = () => ({ expectedRevision: 0, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [], arrays: [] })
const array = (changes = {}) => ({ sources: ['circles:0'], rows: 2, columns: 2, dx: 10, dy: 20, ...changes })
const polar = (changes = {}) => ({ sources: ['circles:0'], center: { x: 0, y: 0 }, count: 8, angleDegrees: 360, ...changes })
function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  return { sdk, document, session: new KJAgentToolSession(sdk, document) }
}
function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
function geometry(entities) {
  return entities.map(({ type, payload: p }) => {
    if (type === 'LINE') return { type, start: p.start, end: p.end }
    if (type === 'CIRCLE') return { type, center: p.center, radius: p.radius }
    if (type === 'ARC') return { type, center: p.center, radius: p.radius, start: p.startAngle, end: p.endAngle }
    if (type === 'ELLIPSE') return {type,center:p.center,majorAxis:p.majorAxis,ratio:p.ratio,start:p.startParameter,end:p.endParameter}
    return { type, points: p.vertices.map(vertex => vertex.point), closed: p.closed }
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

test('one circle seed produces a 209-entity native hole plate with full preview, approval, KJD/DXF and one undo', async () => {
  const { sdk, document, session } = fixture(), input = empty()
  input.circles = [[20, 20, 2]]
  input.polylines = [{ points: [[0, 0], [180, 0], [180, 146], [0, 146]], closed: true }]
  for (const y of [20, 52, 84, 116]) {
    input.lines.push([148, y - 3, 160, y - 3], [148, y + 3, 160, y + 3])
    input.arcs.push([148, y, 3, 90, 270], [160, y, 3, 270, 90])
  }
  input.arrays = [array({ sources: ['circles:0'], rows: 16, columns: 12, dx: 8, dy: 7 })]
  const source = document.serialize(), inputCopy = structuredClone(input)
  const proposed = value(await session.call(tool, input))
  assert.deepEqual(input, inputCopy)
  assert.equal(document.serialize(), source)
  assert.equal(proposed.status, 'awaiting-host-approval')
  assert.equal(proposed.command, 'CREATEBATCH')
  assert.equal(proposed.preview.before.length, 0)
  assert.equal(proposed.preview.after.length, 209)
  assert.equal(new Set(proposed.preview.after.map(item => item.id)).size, 209)
  const holes = proposed.preview.after.filter(item => item.type === 'CIRCLE')
  assert.equal(holes.length, 192)
  for (let row = 0; row < 16; row++) for (let column = 0; column < 12; column++) {
    const hole = holes.find(item => item.payload.center[0] === 20 + column * 8 && item.payload.center[1] === 20 + row * 7)
    assert.ok(hole, `missing row ${row}, column ${column}`)
    assert.equal(hole.payload.radius, 2)
    assert.equal(hole.payload.center[2], 0)
  }
  assert.equal(proposed.preview.after.filter(item => item.type === 'LINE').length, 8)
  assert.equal(proposed.preview.after.filter(item => item.type === 'ARC').length, 8)
  assert.equal(proposed.preview.after.filter(item => item.type === 'LWPOLYLINE').length, 1)
  value(await session.approve(proposed.planId, 'reviewer'))
  assert.equal(document.revision, 1)
  for (const entity of proposed.preview.after) assert.deepEqual(document.getObject(entity.id).payload, entity.payload)
  const committed = geometry(document.listEntities())
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    assert.equal(reopened.listEntities().length, 209)
    assert.deepEqual(geometry(reopened.listEntities()), committed)
  }
  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length, 0)
  await sdk.executeCommand('REDO')
  assert.deepEqual(geometry(document.listEntities()), committed)
})

test('one bolt and spoke seed produces a reviewed native full-circle array and survives reopening', async () => {
  const { sdk, document, session } = fixture()
  const input = { ...empty(), lines: [[12, 0, 28, 0]], circles: [[20, 0, 2]], polarArrays: [polar({ sources: ['circles:0', 'lines:0'] })] }
  const source = document.serialize(), proposed = value(await session.call(tool, input))
  assert.equal(document.serialize(), source)
  assert.equal(proposed.preview.after.length, 16)
  const circles = proposed.preview.after.filter(item => item.type === 'CIRCLE')
  const lines = proposed.preview.after.filter(item => item.type === 'LINE')
  assert.equal(circles.length, 8)
  assert.equal(lines.length, 8)
  for (let index = 0; index < 8; index++) {
    const radians = index * Math.PI / 4
    assert.ok(Math.abs(circles[index].payload.center[0] - 20 * Math.cos(radians)) < 1e-9)
    assert.ok(Math.abs(circles[index].payload.center[1] - 20 * Math.sin(radians)) < 1e-9)
  }
  value(await session.approve(proposed.planId, 'reviewer'))
  assert.equal(document.revision, 1)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    assert.deepEqual(geometry(reopened.listEntities()), geometry(document.listEntities()))
  }
  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length, 0)
})

test('pattern references address all four groups and disjoint negative arrays retain each original exactly once', async () => {
  const { document, session } = fixture()
  const input = { ...empty(),
    lines: [[0, 0, 4, 2]], circles: [[2, 3, 1]], arcs: [[5, 6, 2, 90, 180]],
    polylines: [{ points: [[1, 1], [3, 1], [3, 2]], closed: true }],
    arrays: [array({ sources: ['lines:0', 'arcs:0', 'polylines:0'], rows: 1, columns: 2, dx: -10, dy: 0 }), array({ sources: ['circles:0'], rows: 2, columns: 1, dx: 0, dy: -20 })],
  }
  const proposed = value(await session.call(tool, input))
  assert.equal(proposed.preview.after.length, 8)
  const after = proposed.preview.after
  assert.deepEqual(after.map(item => item.type), ['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'LINE', 'ARC', 'LWPOLYLINE', 'CIRCLE'])
  assert.deepEqual(after[4].payload.start, [-10, 0, 0])
  assert.deepEqual(after[4].payload.end, [-6, 2, 0])
  assert.deepEqual(after[5].payload.center, [-5, 6, 0])
  assert.equal(after[5].payload.startAngle, Math.PI / 2)
  assert.equal(after[5].payload.endAngle, Math.PI)
  assert.deepEqual(after[6].payload.vertices.map(vertex => vertex.point), [[-9, 1, 0], [-7, 1, 0], [-7, 2, 0]])
  assert.deepEqual(after[7].payload.center, [2, -17, 0])
  assert.equal(document.revision, 0)
})

test('native elliptical arcs can seed compact rectangular arrays without tessellation',async()=>{
  const {document,session}=fixture(),input={...empty(),ellipses:[[10,20,8,6,.4,15,300]],arrays:[array({sources:['ellipses:0'],rows:2,columns:2,dx:30,dy:40})]}
  const proposal=value(await session.call(tool,input)),items=proposal.preview.after
  assert.equal(items.length,4);assert.ok(items.every(item=>item.type==='ELLIPSE'))
  assert.deepEqual(items.map(item=>item.payload.center),[[10,20,0],[40,20,0],[10,60,0],[40,60,0]])
  for(const item of items){assert.deepEqual(item.payload.majorAxis,[8,6,0]);assert.equal(item.payload.ratio,.4);assert.equal(item.payload.startParameter,15*Math.PI/180);assert.equal(item.payload.endParameter,300*Math.PI/180)}
  assert.equal(document.revision,0);value(await session.approve(proposal.planId,'reviewer'));assert.equal(document.listEntities({type:'ELLIPSE'}).length,4)
})

test('native rational splines can seed reviewed rectangular arrays without tessellation', async () => {
  const { document, session } = fixture()
  const spline = { degree: 2, controlPoints: [{ x: 0, y: 0 }, { x: 5, y: 8 }, { x: 10, y: 0 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, 0.5, 1] }
  const proposal = value(await session.call(tool, { ...empty(), splines: [spline], arrays: [array({ sources: ['splines:0'], rows: 1, columns: 3, dx: 20, dy: 0 })] }))
  assert.equal(proposal.preview.after.length, 3)
  assert.ok(proposal.preview.after.every(item => item.type === 'SPLINE'))
  assert.deepEqual(proposal.preview.after.map(item => item.payload.controlPoints[0]), [[0, 0, 0], [20, 0, 0], [40, 0, 0]])
  assert.ok(proposal.preview.after.every(item => JSON.stringify(item.payload.knots) === JSON.stringify([0, 0, 0, 1, 1, 1])))
  assert.ok(proposal.preview.after.every(item => JSON.stringify(item.payload.weights) === JSON.stringify([1, 0.5, 1])))
  value(await session.approve(proposal.planId, 'reviewer'))
  assert.equal(document.listEntities({ type: 'SPLINE' }).length, 3)
})

test('pattern total budget accepts exactly 512 and rejects 513 across all arrays before geometry expansion', async () => {
  const { document, session } = fixture(), source = document.serialize()
  const good = { ...empty(), circles: [[0, 0, 1]], arrays: [array({ rows: 16, columns: 32, dx: 4, dy: 5 })] }
  const proposed = value(await session.call(tool, good))
  assert.equal(proposed.preview.after.length, 512)
  assert.equal(document.serialize(), source)
  const over = { ...good, lines: [[0, 0, 1, 0]], arrays: [array({ sources: ['circles:0'], rows: 16, columns: 32, dx: 4, dy: 5 })] }
  let result = await session.call(tool, over)
  assert.equal(result.ok, false)
  assert.match(result.error.message, /512 entity budget/)
  // Degenerate geometry would fail the builder, but total cardinality is checked first.
  const overTwoArrays = { ...empty(), lines: [[0, 0, 0, 0]], circles: [[0, 0, 1], [2, 0, 1]], arrays: [array({ sources: ['circles:0'], rows: 1, columns: 256 }), array({ sources: ['circles:1'], rows: 1, columns: 256 })] }
  result = await session.call(tool, overTwoArrays)
  assert.equal(result.ok, false)
  assert.match(result.error.message, /512 entity budget/)
  assert.equal(document.serialize(), source)
})

test('invalid group references, duplicate seeds, counts, spacing and original drawing inputs fail atomically', async () => {
  const { document, session } = fixture(), source = document.serialize()
  const good = { ...empty(), circles: [[0, 0, 1]], arrays: [array()] }
  const badArrays = [
    ...['circles:-1', 'circles:1', 'circles:64', 'circles:0.5', 'circles:00', 'circles:01', 'circles:0\n', 'circles:0 ', 'lines:0', 'circle:0', 'Circles:0', '__proto__:0', 'circles:1e0', 'circles:0;DELETE'].map(source => [array({ sources: [source] })]),
    [array({ sources: [0] })], [array({ sources: [] })], [array({ sources: ['circles:0', 'circles:0'] })],
    [array({ sourceIndices: [0] })],
    [array(), array()], [array({ rows: 0 })], [array({ columns: 1.5 })], [array({ rows: 513 })],
    [array({ rows: 512, columns: 512 })], [array({ dx: 0 })], [array({ dy: 0 })],
    ...[Infinity, NaN, -Infinity, 1e13].map(dx => [array({ dx })]),
    [array({ command: 'DELETE' })], Array.from({ length: 17 }, () => array()),
  ]
  for (const arrays of badArrays) {
    assert.equal((await session.call(tool, { ...good, arrays })).ok, false)
    assert.equal(document.serialize(), source)
  }
  const badDrawings = [
    { ...good, expectedRevision: 1 }, { ...good, units: 'meter' },
    { ...good, circles: [[0, 0, -1]] }, { ...good, circles: [[1e12, 0, 1]] },
    { ...good, circles: [[0, 0, 1, 2]] }, { ...good, arcs: [[0, 0, 2, 0, 360]] },
    { ...good, lines: Array.from({ length: 64 }, (_, i) => [i, 0, i + 1, 1]) },
    { ...good, maxCreatedEntities: 9999 },
    { ...good, polylines: [{ points: [[0, 0], [1, 1], [0, 0]], closed: true }] },
  ]
  const missing = { ...good }; delete missing.arrays; badDrawings.push(missing)
  for (const input of badDrawings) {
    assert.equal((await session.call(tool, input)).ok, false)
    assert.equal(document.serialize(), source)
  }
  let getters = 0
  const sources = ['circles:0']; Object.defineProperty(sources, '0', { enumerable: true, get() { getters++; return 'circles:0' } })
  assert.equal((await session.call(tool, { ...good, arrays: [array({ sources })] })).ok, false)
  assert.equal(getters, 0)
  assert.equal(document.serialize(), source)
  value(await session.call(tool, { ...good, arrays: [] }))
})

test('polar arrays enforce combined array, source and entity budgets atomically', async () => {
  const { document, session } = fixture(), source = document.serialize()
  const base = { ...empty(), circles: [[20, 0, 1]] }
  const invalid = [
    { ...base, polarArrays: [polar({ angleDegrees: 0 })] },
    { ...base, polarArrays: [polar({ count: 1 })] },
    { ...base, polarArrays: [polar({ count: 513 })] },
    { ...base, polarArrays: [polar({ center: { x: 1e13, y: 0 } })] },
    { ...base, arrays: [array()], polarArrays: [polar()] },
    { ...base, arrays: Array.from({ length: 16 }, () => array({ sources: ['circles:0'], rows: 1, columns: 1 })), polarArrays: [polar({ sources: ['circles:0'] })] },
    { ...base, circles: [[20, 0, 1], [30, 0, 1]], polarArrays: [polar({ sources: ['circles:0', 'circles:1'], count: 257 })] },
  ]
  for (const input of invalid) {
    assert.equal((await session.call(tool, input)).ok, false, JSON.stringify(input))
    assert.equal(document.serialize(), source)
  }
  const exact = { ...base, circles: [[20, 0, 1], [30, 0, 1]], polarArrays: [polar({ sources: ['circles:0', 'circles:1'], count: 256 })] }
  assert.equal(value(await session.call(tool, exact)).preview.after.length, 512)
  assert.equal(document.serialize(), source)
})

test('preview creation budget is opt-in and bounded, does not widen MOVE, and preserves byte budgets', async () => {
  const { sdk, document } = fixture(), source = document.serialize()
  const entities = Array.from({ length: 65 }, (_, i) => ({ type: 'CIRCLE', payload: { center: [i * 3, 0, 0], radius: 1 }, options: { id: `hole-${i}` } }))
  await assert.rejects(createAgentGeometryPreview(document, 'CREATEBATCH', { entities }), /1–64/)
  const preview = await createAgentGeometryPreview(document, 'CREATEBATCH', { entities }, { maxCreatedEntities: 512 })
  assert.equal(preview.after.length, 65)
  assert.equal(document.serialize(), source)
  for (const maxCreatedEntities of [0, 513, 1.5, NaN, Infinity]) {
    await assert.rejects(createAgentGeometryPreview(document, 'CREATEBATCH', { entities }, { maxCreatedEntities }), /integer from 1 to 512/)
  }
  await assert.rejects(createAgentGeometryPreview(document, 'CREATEBATCH', { entities: Array.from({ length: 513 }, (_, i) => ({ ...entities[0], options: { id: `extra-${i}` } })) }, { maxCreatedEntities: 512 }), /1–512/)
  await assert.rejects(createAgentGeometryPreview(document, 'CREATEBATCH', { entities: [{ ...entities[0], payload: { ...entities[0].payload, note: 'x'.repeat(2200000) } }] }, { maxCreatedEntities: 512 }), /4 MiB/)
  const dense = Array.from({ length: 65 }, (_, row) => ({ type: 'LWPOLYLINE', payload: { vertices: Array.from({ length: 64 }, (_, column) => [100000000000.12345 + column, -100000000000.12345 - row, 0]), closed: false } }))
  await assert.rejects(createAgentGeometryPreview(document, 'CREATEBATCH', { entities: dense }, { maxCreatedEntities: 512 }), /256 KiB/)
  assert.equal(document.serialize(), source)
  await sdk.executeCommand('CREATEBATCH', { entities })
  const changed = document.serialize()
  await assert.rejects(createAgentGeometryPreview(document, 'MOVE', { ids: entities.map(item => item.options.id), dx: 1, dy: 1 }, { maxCreatedEntities: 512 }), /1–64/)
  assert.equal(document.serialize(), changed)
})

test('expanded patterns retain preview byte rejection and stale/rejected approval guards', async () => {
  const { sdk, document, session } = fixture(), source = document.serialize()
  const points = Array.from({ length: 64 }, (_, i) => [100000000000.12345 + i, -100000000000.12345])
  const overBytes = { ...empty(), polylines: [{ points, closed: false }], arrays: [array({ sources: ['polylines:0'], rows: 64, columns: 1, dx: 0, dy: 10 })] }
  const result = await session.call(tool, overBytes)
  assert.equal(result.ok, false)
  assert.match(result.error.message, /256 KiB/)
  assert.equal(document.serialize(), source)
  const good = { ...empty(), circles: [[0, 0, 1]], arrays: [array()] }
  const rejected = value(await session.call(tool, good))
  value(session.reject(rejected.planId, 'reviewer'))
  assert.equal((await session.approve(rejected.planId, 'reviewer')).ok, false)
  const stale = value(await session.call(tool, good))
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [200, 300, 0], radius: 9 } })
  const changed = document.serialize()
  assert.equal((await session.approve(stale.planId, 'reviewer')).ok, false)
  assert.equal(document.serialize(), changed)
})

test('pattern schema advertises bounded group-local references and accepts the last valid seed index', async () => {
  const { session, document } = fixture()
  const definition = session.definitions.find(item => item.name === tool)
  const arraySchema = definition.inputSchema.properties.arrays.items
  assert.ok(arraySchema.required.includes('sources'))
  assert.equal('sourceIndices' in arraySchema.properties, false)
  assert.equal(arraySchema.properties.sources.items.type, 'string')
  assert.equal(arraySchema.properties.sources.items.maxLength, 12)
  const polarSchema = definition.inputSchema.properties.polarArrays.items
  assert.ok(definition.inputSchema.required.includes('arrays'))
  assert.ok(definition.inputSchema.required.includes('polarArrays') === false)
  assert.deepEqual(polarSchema.required, ['sources', 'center', 'count', 'angleDegrees'])
  assert.equal(polarSchema.properties.count.maximum, 512)
  assert.equal(polarSchema.properties.angleDegrees.minimum, -360)
  assert.match(definition.description, /group-local zero-based/)
  assert.match(definition.description, /circles:0/)
  assert.doesNotMatch(definition.description, /flattened/)
  const circles = Array.from({ length: 64 }, (_, index) => [index * 3, 0, 1])
  const proposed = value(await session.call(tool, { ...empty(), circles, arrays: [array({ sources: ['circles:63'], rows: 1, columns: 2, dx: 10, dy: 0 })] }))
  assert.equal(proposed.preview.after.length, 65)
  assert.deepEqual(proposed.preview.after.at(-1).payload.center, [199, 0, 0])
  assert.equal(document.revision, 0)
  const legacy = { sourceIndices: [63], rows: 1, columns: 2, dx: 10, dy: 0 }
  const result = await session.call(tool, { ...empty(), circles, arrays: [legacy] })
  assert.equal(result.ok, false); assert.match(result.error.message, /unknown property/)
})
