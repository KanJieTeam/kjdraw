import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, selectEntitiesInBox, selectEntitiesByFence, getEntityGrips } from '../src/index.js'
import { KJCanvasRenderer } from '../src/canvas-renderer.js'

function setup() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const create = (type, payload) => sdk.executeCommand('CREATE', { type, payload })
  return { sdk, document, create }
}
function canvas() {
  const calls = [], context = new Proxy({}, { get(target, key) { return target[key] ?? ((...args) => calls.push([key, ...args])) }, set(target, key, value) { target[key] = value; return true } })
  return { width: 800, height: 600, clientWidth: 800, clientHeight: 600, getBoundingClientRect: () => ({ width: 800, height: 600 }), getContext: () => context, calls }
}

test('window contains whole objects while crossing includes intersecting objects, not overlapping bounds', async () => {
  const { document, create } = setup()
  const enclosed = await create('LINE', { start: [2, 2], end: [8, 8] })
  const crossing = await create('LINE', { start: [-5, 5], end: [15, 5] })
  await create('LINE', { start: [-5, 9], end: [9, 20] }) // Its box overlaps, the actual line does not.
  const before = document.serialize()
  assert.deepEqual(selectEntitiesInBox(document, [0, 0], [10, 10]), [enclosed.id])
  assert.deepEqual(selectEntitiesInBox(document, [10, 10], [0, 0], 'crossing'), [enclosed.id, crossing.id])
  assert.equal(document.serialize(), before)
})

test('circle, signed arcs and bulged segments use real curve extrema and boundary intersections', async () => {
  const { document, create } = setup()
  const circle = await create('CIRCLE', { center: [0, 0], radius: 10 })
  assert.deepEqual(selectEntitiesInBox(document, [-1, -1], [1, 1], 'crossing'), [], 'a box in a circle interior must not hit its center')
  assert.deepEqual(selectEntitiesInBox(document, [-10, -10], [10, 10]), [circle.id])
  assert.deepEqual(selectEntitiesInBox(document, [9.99, -0.01], [10.01, 0.01], 'crossing'), [circle.id])
  const arc = await create('ARC', { center: [30, 0], radius: 10, startAngle: 0, endAngle: Math.PI / 2 })
  assert.deepEqual(selectEntitiesInBox(document, [29.99, -.01], [40.01, 10.01]), [arc.id], 'quarter arc window must not require the full circle bounding box')
  assert.deepEqual(selectEntitiesInBox(document, [20, -10], [25, -5], 'crossing'), [])
  const bulge = await create('LWPOLYLINE', { vertices: [{ point: [50, 0], bulge: 1 }, { point: [60, 0] }] })
  assert.deepEqual(selectEntitiesInBox(document, [49, -1], [61, 1]), [], 'endpoints alone do not enclose a bulged segment')
  assert.deepEqual(selectEntitiesInBox(document, [54.99, -5.01], [55.01, -4.99], 'crossing'), [bulge.id])
  const midpoint = getEntityGrips(document.getObject(bulge.id)).find(grip => grip.id === 'segment:0')
  assert.deepEqual(midpoint.point, [55, -5, 0])
})

test('rotated ellipse and trimmed ellipse selection is not the major-circle bounding box', async () => {
  const { document, create } = setup()
  const ellipse = await create('ELLIPSE', { center: [0, 0], majorAxis: [6, 8], ratio: .2 })
  const x = Math.hypot(6, -1.6), y = Math.hypot(8, 1.2)
  assert.deepEqual(selectEntitiesInBox(document, [-x, -y], [x, y]), [ellipse.id])
  assert.deepEqual(selectEntitiesInBox(document, [-.2, -.2], [.2, .2], 'crossing'), [])
  assert.deepEqual(selectEntitiesInBox(document, [5.99, 7.99], [6.01, 8.01], 'crossing'), [ellipse.id])
  const arc = await create('ELLIPSE', { center: [30, 0], majorAxis: [10, 0], ratio: .5, startParameter: 0, endParameter: Math.PI / 2 })
  assert.deepEqual(selectEntitiesInBox(document, [30, 0], [40, 5]), [arc.id])
})

test('fence is open and respects tangent circles, line collinearity and ray direction', async () => {
  const { document, create } = setup()
  const circle = await create('CIRCLE', { center: [0, 0], radius: 5 })
  const tangent = await create('LINE', { start: [-3, 5], end: [3, 5] })
  assert.deepEqual(selectEntitiesByFence(document, [[-10, 5], [10, 5]]), [circle.id, tangent.id])
  const ray = await create('RAY', { origin: [20, 0], direction: [1, 0] })
  assert.ok(!selectEntitiesByFence(document, [[19, -1], [19, 1]]).includes(ray.id))
  assert.ok(selectEntitiesByFence(document, [[30, -1], [30, 1]]).includes(ray.id))
  assert.ok(!selectEntitiesInBox(document, [0, -20], [50, 20]).includes(ray.id), 'finite window can never contain a ray')
  const point = await create('POINT', { position: [25, 5] })
  assert.ok(!selectEntitiesByFence(document, [[20, 0], [30, 0], [30, 10]]).includes(point.id), 'do not close an open fence')
})

test('hatch crossing honors holes and dimensions use the annotation instead of only definition points', async () => {
  const { document, create } = setup()
  const hatch = await create('HATCH', { patternName: 'SOLID', solid: true, boundaryLoops: [{ vertices: [[0,0],[20,0],[20,20],[0,20]], closed: true }, { vertices: [[5,5],[15,5],[15,15],[5,15]], closed: true }] })
  assert.deepEqual(selectEntitiesInBox(document, [1,1], [2,2], 'crossing'), [hatch.id])
  assert.deepEqual(selectEntitiesInBox(document, [8,8], [9,9], 'crossing'), [])
  assert.deepEqual(selectEntitiesByFence(document, [[8,8],[9,9]]), [])
  const dim = await create('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[35,-10],[30,0],[40,0]], textHeight: 1 })
  assert.deepEqual(selectEntitiesInBox(document, [34,-10.1],[36,-9.9], 'crossing'), [dim.id])
})

test('curve fence endpoint tolerance stays in model units regardless of fence length', async () => {
  const { document, create } = setup()
  const circle = await create('CIRCLE', { center: [0,0], radius: 1 })
  for (const length of [1, 100, 10000]) {
    assert.deepEqual(selectEntitiesByFence(document, [[2,0],[2 + length,0]], { tolerance: .01 }), [])
    assert.deepEqual(selectEntitiesByFence(document, [[1.005,0],[1.005 + length,0]], { tolerance: .01 }), [circle.id])
    assert.deepEqual(selectEntitiesByFence(document, [[-2 - length,0],[-2,0]], { tolerance: .01 }), [])
  }
})

test('zoomed-out selection never collapses infinite line directions to points', async () => {
  const { document, create } = setup()
  const ray = await create('RAY', { origin: [0,0], direction: [1,0] })
  const line = await create('XLINE', { origin: [0,2], direction: [1,0] })
  for (const tolerance of [.01, 2, 4]) {
    assert.deepEqual(selectEntitiesByFence(document, [[100,-5],[100,5]], { tolerance }), [ray.id,line.id])
    assert.deepEqual(selectEntitiesInBox(document, [100,-5],[110,5], 'crossing', { tolerance }), [ray.id,line.id])
    assert.deepEqual(selectEntitiesByFence(document, [[-100,-5],[-100,5]], { tolerance }), [line.id])
    assert.deepEqual(selectEntitiesInBox(document, [-200,-100],[200,100], 'window', { tolerance }), [])
  }
})

test('NURBS selection follows the displayed spline, not the control polygon', async () => {
  const { document, create } = setup()
  const spline = await create('SPLINE', { degree: 2, controlPoints: [[0,0],[5,10],[10,0]], knots: [0,0,0,1,1,1] })
  assert.deepEqual(selectEntitiesInBox(document, [0,0],[10,5.01]), [spline.id])
  assert.deepEqual(selectEntitiesInBox(document, [4.9,9.9],[5.1,10.1], 'crossing'), [])
  assert.deepEqual(selectEntitiesByFence(document, [[5,4.9],[5,5.1]]), [spline.id])
})

test('visible hatch LINE edge loops support whole-window, crossing and fence selection', async () => {
  const { document, create } = setup()
  const hatch = await create('HATCH', { patternName: 'SOLID', solid: true, boundaryLoops: [{ edges: [
    { type: 'LINE', start: [0,0], end: [10,0] },
    { type: 'LINE', start: [10,0], end: [10,10] },
    { type: 'LINE', start: [10,10], end: [0,10] },
    { type: 'LINE', start: [0,10], end: [0,0] },
  ] }] })
  const before = document.serialize(), renderer = new KJCanvasRenderer(canvas(), { document, grid: false, pixelRatio: 1 })
  assert.equal(renderer.report.rendered, 1); assert.equal(renderer.report.unsupported, 0)
  assert.deepEqual(selectEntitiesInBox(document, [-1,-1], [11,11]), [hatch.id])
  assert.deepEqual(selectEntitiesInBox(document, [1,1], [2,2], 'crossing'), [hatch.id])
  assert.deepEqual(selectEntitiesByFence(document, [[-1,5],[11,5]]), [hatch.id])
  assert.deepEqual(selectEntitiesInBox(document, [1,1], [2,2]), [])
  assert.equal(document.serialize(), before); renderer.dispose()
})

test('hatch ARC edges preserve signed sweeps, curved fill and even-odd holes', async () => {
  const { document, create } = setup()
  const ring = await create('HATCH', { patternName: 'ANSI31', solid: false, boundaryLoops: [
    { edges: [{ type: 'ARC', center: [0,0], radius: 10, startAngle: 0, endAngle: Math.PI * 2, counterClockwise: true }] },
    { external: false, edges: [{ type: 'ARC', center: [0,0], radius: 3, startAngle: 0, endAngle: Math.PI * 2, counterClockwise: false }] },
  ] })
  assert.deepEqual(selectEntitiesInBox(document, [-10,-10], [10,10]), [ring.id])
  assert.deepEqual(selectEntitiesInBox(document, [-1,-1], [1,1], 'crossing'), [])
  assert.deepEqual(selectEntitiesByFence(document, [[-1,0],[1,0]]), [])
  assert.deepEqual(selectEntitiesInBox(document, [5,-.1], [6,.1], 'crossing'), [ring.id])
  assert.deepEqual(selectEntitiesByFence(document, [[5,0],[6,0]]), [ring.id])
  assert.deepEqual(selectEntitiesByFence(document, [[-.1,9.99],[.1,10.01]]), [ring.id])
  const half = await create('HATCH', { patternName: 'SOLID', solid: true, boundaryLoops: [{ edges: [
    { type: 'ARC', center: [30,0], radius: 5, startAngle: Math.PI, endAngle: 0, clockwise: true },
    { type: 'LINE', start: [35,0], end: [25,0] },
  ] }] })
  assert.deepEqual(selectEntitiesInBox(document, [25,0], [35,5]), [half.id])
  assert.deepEqual(selectEntitiesInBox(document, [29,1], [31,2], 'crossing'), [half.id])
  assert.deepEqual(selectEntitiesInBox(document, [29,-2], [31,-1], 'crossing'), [])
  assert.deepEqual(selectEntitiesByFence(document, [[29,-.1],[31,.1]]), [half.id])
})

test('bulged hatch fill follows its rendered curves rather than its endpoint polygon', async () => {
  const { document, create } = setup()
  const hatch = await create('HATCH', { patternName: 'SOLID', solid: true, boundaryLoops: [
    { vertices: [{ point: [-5,0], bulge: 1 }, { point: [5,0], bulge: 1 }] },
    { external: false, vertices: [{ point: [-1,0], bulge: -1 }, { point: [1,0], bulge: -1 }] },
  ] })
  assert.deepEqual(selectEntitiesInBox(document, [-5,-5], [5,5]), [hatch.id])
  assert.deepEqual(selectEntitiesInBox(document, [-.1,2], [.1,3], 'crossing'), [hatch.id])
  assert.deepEqual(selectEntitiesByFence(document, [[-.1,2],[.1,3]]), [hatch.id])
  assert.deepEqual(selectEntitiesInBox(document, [-.1,-.1], [.1,.1], 'crossing'), [])
  assert.deepEqual(selectEntitiesByFence(document, [[-.1,0],[.1,0]]), [])
})

test('unsupported hatch patterns select their visible boundary, not an invented fill', async () => {
  const { document, create } = setup()
  const hatch = await create('HATCH', { patternName: 'CUSTOM-UNKNOWN', solid: false, boundaryLoops: [{ vertices: [[0,0],[10,0],[10,10],[0,10]] }] })
  assert.deepEqual(selectEntitiesInBox(document, [-1,-1], [11,11]), [hatch.id])
  assert.deepEqual(selectEntitiesInBox(document, [1,1], [2,2], 'crossing'), [])
  assert.deepEqual(selectEntitiesByFence(document, [[1,1],[2,2]]), [])
  assert.deepEqual(selectEntitiesByFence(document, [[-1,5],[1,5]]), [hatch.id])
})

test('all picking modes and grips filter invisible, frozen, locked layers and non-active spaces', async () => {
  const { sdk, document, create } = setup()
  const open = await create('LINE', { start: [0,0], end: [10,0] })
  const hidden = await create('LINE', { start: [0,10], end: [10,10] })
  const frozen = await create('LINE', { start: [0,20], end: [10,20] })
  const locked = await create('LINE', { start: [0,30], end: [10,30] })
  for (const [entity, patch] of [[hidden,{visible:false}],[frozen,{frozen:true}],[locked,{locked:true}]]) {
    const layer = await sdk.executeCommand('LAYERNEW', { name: entity.id })
    await sdk.executeCommand('PROPERTIES', { id: entity.id, patch: { payload: { layerId: layer.id } } })
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch })
  }
  const renderer = new KJCanvasRenderer(canvas(), { document, grid: false, pixelRatio: 1 })
  assert.deepEqual(renderer.selectAll(), [open.id])
  assert.deepEqual(renderer.selectAll({ includeLocked: true }), [open.id, locked.id])
  assert.deepEqual(selectEntitiesInBox(document, [-1,-1],[11,31]), [open.id])
  assert.deepEqual(selectEntitiesByFence(document, [[5,-1],[5,31]]), [open.id])
  renderer.setSelection([locked.id])
  assert.deepEqual(renderer.getGrips(), [])
  assert.equal(renderer.hitTest(renderer.worldToScreen([5,30]), 1), null)
  assert.equal(renderer.hitTest(renderer.worldToScreen([5,30]), 1, { includeLocked: true }).entity.id, locked.id)
  assert.equal(renderer.hitTest(renderer.worldToScreen([5,10]), 1, { includeLocked: true }), null)
  const before = document.serialize()
  renderer.setSelection([open.id]); renderer.drawGrips()
  assert.equal(renderer.hitGrip(renderer.worldToScreen([10,0])).id, 'end')
  assert.equal(renderer.getGrips().length, 3)
  assert.equal(document.serialize(), before)
  renderer.setSpace('not-model-space')
  assert.deepEqual(renderer.selectAll(), [])
  assert.equal(renderer.hitTest(renderer.worldToScreen([5,0])), null)
  renderer.dispose()
})

test('Canvas box direction chooses window/crossing and queries do not change selection or revision', async () => {
  const { document, create } = setup()
  const contained = await create('LINE', { start: [2,2], end: [8,8] })
  const crossed = await create('LINE', { start: [-10,5], end: [20,5] })
  const renderer = new KJCanvasRenderer(canvas(), { document, grid: false, pixelRatio: 1 })
  const first = renderer.worldToScreen([0,10]), second = renderer.worldToScreen([10,0]), snapshot = document.serialize()
  assert.deepEqual(renderer.selectBox(first,second), [contained.id])
  assert.deepEqual(renderer.selectBox(second,first), [contained.id,crossed.id])
  assert.deepEqual(renderer.selection, [])
  assert.equal(document.serialize(), snapshot)
  renderer.dispose()
})

test('invalid query inputs fail before returning misleading selection results', () => {
  const { document } = setup()
  assert.throws(() => selectEntitiesInBox(document, [NaN,0], [1,1]), /finite/)
  assert.throws(() => selectEntitiesInBox(document, [0,0], [1,1], 'bbox'), /mode/)
  assert.throws(() => selectEntitiesInBox(document, [0,0], [1,1], 'window', { tolerance: -1 }), /tolerance/)
  assert.throws(() => selectEntitiesByFence(document, [[0,0]]), /two points/)
})

test('transformed block geometry is selectable at its actual placement without selecting definition members', async () => {
  const { sdk, document, create } = setup()
  const line = await create('LINE', { start: [10,20], end: [30,20] })
  const block = await sdk.executeCommand('BLOCKCREATE', { name: 'Selection beam', id: line.id, basePoint: [10,20] })
  const insert = await sdk.executeCommand('BLOCKINSERT', { name: 'Selection beam', position: [100,200], scale: [2,2,2], rotation: Math.PI / 2 })
  assert.deepEqual(selectEntitiesInBox(document, [99,199],[101,241]), [insert.id])
  assert.deepEqual(selectEntitiesByFence(document, [[99,220],[101,220]]), [insert.id])
  assert.deepEqual(selectEntitiesInBox(document, [9,19],[31,21]), [block.insert.id])
  assert.ok(!selectEntitiesInBox(document, [-1000,-1000],[1000,1000]).includes(line.id))
})

test('Canvas region queries honor a scene provider subset and entity visibility', async () => {
  const { document, create } = setup()
  const visible = await create('LINE', { start: [0,0], end: [10,0] })
  await create('LINE', { start: [0,5], end: [10,5] })
  const hidden = await create('LINE', { start: [0,10], end: [10,10], visible: false })
  const renderer = new KJCanvasRenderer(canvas(), { document, sceneProvider: { listEntities: () => [document.getObject(visible.id), document.getObject(hidden.id)] }, grid: false, pixelRatio: 1 })
  assert.deepEqual(renderer.selectBox(renderer.worldToScreen([-1,-1]), renderer.worldToScreen([11,11])), [visible.id])
  assert.deepEqual(renderer.selectFence([renderer.worldToScreen([5,-1]), renderer.worldToScreen([5,11])]), [visible.id])
  assert.equal(renderer.report.hidden, 1)
  renderer.dispose()
})
