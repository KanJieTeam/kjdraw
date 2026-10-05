import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, computePlanarContours, applyPlanarBoundaryExtraction } from '../packages/kjdraw-sdk/src/index.js'
// Direct TS execution verifies the authoritative module before generated assets exist.
import { previewPlanarBoundaries } from '../packages/kjdraw-sdk/src/planar-boundaries.ts'
import { spawnSyncWithFileStdin } from '../scripts/spawn-file-stdin.mjs'

const point = (x, y) => [x, y, 0]
const vertex = (x, y, bulge = 0) => ({ point: point(x, y), bulge })
const line = (a, b, extra = {}) => ({ type: 'LINE', payload: { start: a, end: b, color: 2, ...extra } })
const circle = (radius, x = 0, y = 0) => ({ type: 'CIRCLE', payload: { center: point(x, y), radius, color: 2 } })
const poly = (vertices, closed = true, extra = {}) => ({ type: 'LWPOLYLINE', payload: { vertices, closed, color: 2, ...extra } })
const square = (size, x = 0, y = 0) => poly([vertex(x, y), vertex(x + size, y), vertex(x + size, y + size), vertex(x, y + size)])
const request = (document, sources, extra = {}) => ({ ids: sources.map(s => s.id), units: 'millimeter', expectedRevision: document.revision, ...extra })
const state = document => ({ serialized: document.serialize(), revision: document.revision, history: JSON.stringify(document.history) })
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`)
async function fixture(specs) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'planar-boundary-tests', units: 'millimeter' })
  const sources = []
  for (const spec of specs) sources.push(await sdk.executeCommand('CREATE', spec, { document }))
  const sentinel = await sdk.executeCommand('CREATE', line(point(500, 500), point(501, 502), { color: 3 }), { document })
  return { sdk, document, sources, sentinel }
}
// Independent Green integral, using actual native vertices and circular segments.
// No SDK geometry routine, result area field, or tessellated polygon is used.
function independentArea(ring) {
  const origin = ring.vertices[0].point
  return ring.vertices.reduce((sum, a, i, vertices) => {
    const b = vertices[(i + 1) % vertices.length], ax = a.point[0] - origin[0], ay = a.point[1] - origin[1], bx = b.point[0] - origin[0], by = b.point[1] - origin[1]
    const q = a.bulge ?? 0, theta = 4 * Math.atan(q), r = q === 0 ? 0 : Math.hypot(bx - ax, by - ay) * (1 + q * q) / (4 * Math.abs(q))
    const segment = Math.abs(theta) < 1e-3 ? theta ** 3 / 6 - theta ** 5 / 120 + theta ** 7 / 5040 : theta - Math.sin(theta)
    return sum + (ax * by - bx * ay) / 2 + r * r * segment / 2
  }, 0)
}
function mapping(ring, sources) {
  assert.equal(ring.vertices.length, ring.segments.length)
  const records = new Map(sources.map(s => [s.id, s])), seen = new Set()
  ring.segments.forEach((m, i) => {
    const source = records.get(m.sourceId), a = ring.vertices[i], b = ring.vertices[(i + 1) % ring.vertices.length]
    assert.ok(source); assert.equal(typeof m.reversed, 'boolean')
    assert.ok(!seen.has(`${m.sourceId}:${m.sourceSegmentIndex}`)); seen.add(`${m.sourceId}:${m.sourceSegmentIndex}`)
    if (source.type === 'LINE' || source.type === 'LWPOLYLINE') {
      const first = source.type === 'LINE' ? source.payload.start : source.payload.vertices[m.sourceSegmentIndex].point
      const last = source.type === 'LINE' ? source.payload.end : source.payload.vertices[(m.sourceSegmentIndex + 1) % source.payload.vertices.length].point
      assert.deepEqual(a.point, m.reversed ? last : first); assert.deepEqual(b.point, m.reversed ? first : last)
      const bulge = source.type === 'LINE' ? 0 : source.payload.vertices[m.sourceSegmentIndex].bulge ?? 0
      assert.equal(a.bulge ?? 0, bulge === 0 ? 0 : m.reversed ? -bulge : bulge)
    } else {
      const q = a.bulge, dx = b.point[0] - a.point[0], dy = b.point[1] - a.point[1], k = (1 - q * q) / (4 * q)
      const cx = (a.point[0] + b.point[0]) / 2 - dy * k, cy = (a.point[1] + b.point[1]) / 2 + dx * k
      close(cx, source.payload.center[0]); close(cy, source.payload.center[1]); close(Math.hypot(dx, dy) * (1 + q * q) / (4 * Math.abs(q)), source.payload.radius)
      if (source.type === 'ARC') {
        const { center, radius, startAngle, endAngle } = source.payload
        const start = [center[0] + radius * Math.cos(startAngle), center[1] + radius * Math.sin(startAngle)]
        const end = [center[0] + radius * Math.cos(endAngle), center[1] + radius * Math.sin(endAngle)]
        for (let axis = 0; axis < 2; axis++) { close(a.point[axis], (m.reversed ? end : start)[axis]); close(b.point[axis], (m.reversed ? start : end)[axis]) }
      }
    }
  })
}
function valid(result, sources) {
  assert.equal(result.complete, true); assert.deepEqual(result.diagnostics, [])
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.contours))
  assert.match(result.sourceDigest, /^[a-f0-9]{16}$/); assert.match(result.receipt.geometryDigest, /^[a-f0-9]{16}$/)
  assert.equal(result.receipt.schema, 'kjdraw.planar-boundaries.v1')
  close(result.area, result.contours.reduce((sum, r) => sum + independentArea(r), 0))
  for (const ring of result.contours) { assert.equal(ring.closed, true); assert.equal(ring.hole, ring.depth % 2 === 1); assert.equal(ring.area < 0, ring.hole); close(ring.area, independentArea(ring)); mapping(ring, sources); assert.ok(ring.vertices.every(v => !Object.is(v.bulge, -0) && v.point.every(c => !Object.is(c, -0)))) }
}

test('unordered and reversed LINE paths form one exact native boundary without touching sources/history', async () => {
  const { document, sources } = await fixture([line(point(10, 0), point(0, 0)), line(point(0, 10), point(10, 10)), line(point(0, 0), point(0, 10)), line(point(10, 10), point(10, 0))])
  const before = state(document), result = await previewPlanarBoundaries(document, request(document, sources))
  valid(result, sources); close(result.area, 100); assert.equal(result.contours.length, 1)
  assert.deepEqual(state(document), before)
  const repeated = await previewPlanarBoundaries(document, request(document, [...sources].reverse()))
  assert.deepEqual(repeated, result)
})

test('multiple disjoint outlines, a hole and an island use parity depth and are directly offset-ready', async () => {
  const { document, sources } = await fixture([square(20, -10, -10), circle(5), circle(2), square(3, 30, 0)])
  const before = state(document), result = await previewPlanarBoundaries(document, request(document, sources))
  valid(result, sources); assert.equal(result.contours.length, 4)
  assert.deepEqual(result.contours.map(r => r.depth), [0, 0, 1, 2])
  close(result.area, 409 - 21 * Math.PI)
  const offset = await computePlanarContours({ operation: 'offset', contours: result.contours.map(({ closed, vertices }) => ({ closed, vertices })), distance: 0.25, tolerance: 1e-7 })
  assert.equal(offset.contours.length, 4); assert.ok(offset.area > result.area)
  assert.deepEqual(state(document), before)
})

test('major ARC plus reverse LINE retains one source arc, exact endpoints and large bulge', async () => {
  const arc = { type: 'ARC', payload: { center: point(0, 0), radius: 10, startAngle: 0, endAngle: 3 * Math.PI / 2, color: 2 } }
  const { document, sources } = await fixture([line(point(10, 0), point(0, -10)), arc])
  const result = await previewPlanarBoundaries(document, request(document, sources))
  valid(result, sources); assert.equal(result.contours.length, 1); assert.equal(result.contours[0].vertices.length, 2)
  assert.ok(result.contours[0].vertices.some(v => Math.abs(v.bulge) > 1))
  close(result.area, 50 * (3 * Math.PI / 2 + 1))
  assert.ok(result.receipt.sourceBoundaryError > 0 && result.receipt.sourceBoundaryError < result.receipt.tolerance)
})

test('non-cardinal ARC and LINE with its actual endpoints form a native ring without snapping', async () => {
  const start = Math.atan2(3, 4), end = Math.atan2(-3, 4), radius = 5, center = point(0, 0)
  const a = point(center[0] + radius * Math.cos(start), center[1] + radius * Math.sin(start)), b = point(center[0] + radius * Math.cos(end), center[1] + radius * Math.sin(end))
  const { document, sources } = await fixture([{ type: 'ARC', payload: { center, radius, startAngle: start, endAngle: end, color: 2 } }, line(b, a)])
  const result = await previewPlanarBoundaries(document, request(document, sources))
  const sweep = end - start + Math.PI * 2
  valid(result, sources); close(result.area, radius ** 2 * (sweep - Math.sin(sweep)) / 2)
})

test('decimal ARC whose source localization is inexact returns an explicit precision diagnostic', async () => {
  const start = 0.37, end = 2.71, radius = 8, center = point(2, 3)
  const a = point(center[0] + radius * Math.cos(start), center[1] + radius * Math.sin(start)), b = point(center[0] + radius * Math.cos(end), center[1] + radius * Math.sin(end))
  const { document, sources } = await fixture([{ type: 'ARC', payload: { center, radius, startAngle: start, endAngle: end, color: 2 } }, line(b, a)])
  const before = state(document), result = await previewPlanarBoundaries(document, request(document, sources))
  assert.equal(result.complete, false); assert.equal(result.contours.length, 0)
  assert.ok(result.diagnostics.some(d => d.code === 'precision' && /localization/i.test(d.message)))
  assert.deepEqual(state(document), before)
})

test('clockwise ARC traversal has correct source correspondence after exterior orientation reversal', async () => {
  const { document, sources } = await fixture([{ type: 'ARC', payload: { center: point(0, 0), radius: 4, startAngle: Math.PI, endAngle: 0, clockwise: true, color: 2 } }, line(point(4, 0), point(-4, 0))])
  const result = await previewPlanarBoundaries(document, request(document, sources))
  valid(result, sources); close(result.area, 8 * Math.PI)
  assert.ok(result.contours[0].segments.find(s => s.sourceId === sources[0].id).reversed)
})

test('open LWPOLYLINE plus LINE and a geometrically closed open LWP preserve segment indices', async () => {
  const { document, sources } = await fixture([poly([vertex(0, 0), vertex(4, 0), vertex(4, 4), vertex(0, 4)], false), line(point(0, 4), point(0, 0)), poly([vertex(10, 0), vertex(12, 0), vertex(12, 2), vertex(10, 0)], false)])
  const result = await previewPlanarBoundaries(document, request(document, sources))
  valid(result, sources); assert.equal(result.contours.length, 2); close(result.area, 18)
  assert.deepEqual(result.contours.find(r => r.sourceIds.includes(sources[2].id)).segments.map(s => s.sourceSegmentIndex).sort(), [0, 1, 2])
})

test('an isolated valid loop remains inspectable beside an open-chain diagnostic; selection is incomplete', async () => {
  const { document, sources } = await fixture([square(4), line(point(20, 0), point(23, 0))])
  const before = state(document), result = await previewPlanarBoundaries(document, request(document, sources))
  assert.equal(result.complete, false); assert.equal(result.contours.length, 1); close(result.area, 16)
  assert.ok(result.diagnostics.some(d => d.code === 'open-chain' && d.sourceIds.includes(sources[1].id)))
  assert.deepEqual(state(document), before)
})

test('distinct near endpoints report ambiguity rather than changing coordinates or inventing a closing edge', async () => {
  const { document, sources } = await fixture([line(point(0, 0), point(4, 0)), line(point(4, 0), point(4, 4)), line(point(4, 4), point(0, 4)), line(point(0, 4 + 5e-8), point(0, 0))])
  const before = state(document), result = await previewPlanarBoundaries(document, request(document, sources))
  assert.equal(result.complete, false); assert.equal(result.contours.length, 0)
  const diagnostic = result.diagnostics.find(d => d.code === 'near-endpoint')
  assert.ok(diagnostic); assert.ok(diagnostic.points.some(p => p[1] === 4 + 5e-8))
  assert.deepEqual(state(document), before)
})

test('branches and internal crossings are explicit and never split into invented faces', async () => {
  for (const specs of [
    [line(point(0, 0), point(2, 0)), line(point(2, 0), point(2, 2)), line(point(2, 2), point(0, 0)), line(point(2, 0), point(4, 0))],
    [line(point(0, 0), point(4, 4)), line(point(4, 4), point(0, 4)), line(point(0, 4), point(4, 0)), line(point(4, 0), point(0, 0))],
  ]) {
    const { document, sources } = await fixture(specs), before = state(document)
    const result = await previewPlanarBoundaries(document, request(document, sources))
    assert.equal(result.complete, false); assert.equal(result.contours.length, 0)
    assert.ok(result.diagnostics.some(d => ['branch', 'boundary-intersection', 'self-intersection'].includes(d.code)))
    assert.deepEqual(state(document), before)
  }
})

test('a self-intersecting closed LWP and crossing/touching rings are refused by native topology validation', async () => {
  for (const specs of [[poly([vertex(0, 0), vertex(4, 4), vertex(0, 4), vertex(4, 0)])], [square(4), square(4, 2, 2)], [circle(2), circle(2, 4, 0)]]) {
    const { document, sources } = await fixture(specs), before = state(document)
    const result = await previewPlanarBoundaries(document, request(document, sources))
    assert.equal(result.complete, false); assert.equal(result.contours.length, 0)
    assert.ok(result.diagnostics.some(d => ['boundary-intersection', 'self-intersection'].includes(d.code)))
    assert.deepEqual(state(document), before)
  }
})

test('near touching rings fail the native relation gate even if a query sees no exact intersection', async () => {
  const { document, sources } = await fixture([circle(2), circle(2, 4 + 5e-8, 0)])
  const before = state(document), result = await previewPlanarBoundaries(document, request(document, sources))
  assert.equal(result.complete, false); assert.ok(result.diagnostics.length); assert.deepEqual(state(document), before)
})

test('source circle separation budgets reject contacts hidden by radius rounding without changing state', async () => {
  const radius = 1 - 6e-8, x = 9e8, y = 9e8, tolerance = 1e-7
  for (const [dx, dy, expectedGapSign] of [
    [2 - 2 ** -23, 0, 1],
    [1.2000000476837158, 1.5999997854232788, -1],
    [1.1999996900558472, 1.600000023841858, -1],
  ]) {
    const gap = Math.hypot(dx, dy) - 2 * radius
    assert.equal(Math.sign(gap), expectedGapSign)
    assert.ok(Math.abs(gap) < tolerance)
    const { document, sources } = await fixture([circle(radius, x, y), circle(radius, x + dx, y + dy)])
    const before = state(document), args = request(document, sources, { tolerance })
    const result = await previewPlanarBoundaries(document, args)
    assert.equal(result.complete, false); assert.equal(result.contours.length, 0)
    assert.ok(result.diagnostics.some(item => ['boundary-intersection', 'precision'].includes(item.code)))
    await assert.rejects(applyPlanarBoundaryExtraction(document, { ...args, expectedGeometryDigest: result.receipt.geometryDigest }), /incomplete/i)
    assert.deepEqual(state(document), before)
  }
  // The larger separation gate must retain ordinary disjoint inexact sources.
  const disjoint = await fixture([circle(radius, x, y), circle(radius, x + 4, y)])
  const before = state(disjoint.document), args = request(disjoint.document, disjoint.sources, { tolerance })
  const preview = await previewPlanarBoundaries(disjoint.document, args)
  assert.equal(preview.complete, true); assert.deepEqual(preview.diagnostics, []); assert.equal(preview.contours.length, 2)
  for (const ring of preview.contours) {
    const source = disjoint.sources.find(entity => ring.sourceIds.includes(entity.id)), [a, b] = ring.vertices
    const actualRadius = Math.hypot(b.point[0] - a.point[0], b.point[1] - a.point[1]) / 2
    const centerError = Math.hypot(a.point[0] + (b.point[0] - a.point[0]) / 2 - source.payload.center[0], a.point[1] + (b.point[1] - a.point[1]) / 2 - source.payload.center[1])
    assert.ok(centerError + Math.abs(actualRadius - radius) <= ring.sourceBoundaryError)
    assert.ok(ring.sourceBoundaryError < tolerance)
    close(ring.area, Math.PI * actualRadius ** 2); close(ring.area, independentArea(ring))
    assert.deepEqual(ring.segments.map(segment => segment.sourceSegmentIndex).sort(), [0, 1])
  }
  assert.ok(preview.contours.every(ring => ring.sourceBoundaryError > 0))
  const originals = disjoint.sources.map(source => JSON.stringify(source))
  const applied = await applyPlanarBoundaryExtraction(disjoint.document, { ...args, expectedGeometryDigest: preview.receipt.geometryDigest })
  assert.equal(applied.resultIds.length, 2); assert.equal(disjoint.document.revision, before.revision + 1)
  assert.deepEqual(disjoint.sources.map(source => JSON.stringify(disjoint.document.getObject(source.id))), originals)
  await disjoint.document.undo()
  assert.deepEqual(disjoint.sources.map(source => JSON.stringify(disjoint.document.getObject(source.id))), originals)
})

test('separation-budget overflow is an explicit precision refusal while exact sources keep the maximum tolerance', async () => {
  const inexact = await fixture([circle(.1, 9e8, 9e8)]), before = state(inexact.document)
  const args = request(inexact.document, inexact.sources, { tolerance: 1e-2 })
  const result = await previewPlanarBoundaries(inexact.document, args)
  assert.equal(result.complete, false); assert.equal(result.contours.length, 0)
  assert.ok(result.diagnostics.some(item => item.code === 'precision' && /separation tolerance.*limit/i.test(item.message)))
  await assert.rejects(applyPlanarBoundaryExtraction(inexact.document, { ...args, expectedGeometryDigest: result.receipt.geometryDigest }), /incomplete/i)
  assert.deepEqual(state(inexact.document), before)
  const exact = await fixture([circle(1, 9e8, 9e8)])
  const complete = await previewPlanarBoundaries(exact.document, request(exact.document, exact.sources, { tolerance: 1e-2 }))
  assert.equal(complete.complete, true); assert.equal(complete.contours[0].sourceBoundaryError, 0)
})

test('one converted ring rejects a near self-contact hidden by arc radius rounding', async () => {
  const x = 9e8, y = 9e8, radius = 1 - 6e-8, roundedRadius = (y + radius) - y, tolerance = 1e-7
  // The original half-circle approaches the nonadjacent closing segment by
  // 6e-8, but its rounded bulge representation appears more than 1e-7 away.
  assert.ok(1 - radius < tolerance); assert.ok(1 - roundedRadius > tolerance)
  const { document, sources } = await fixture([
    { type: 'ARC', payload: { center: point(x, y), radius, startAngle: Math.PI / 2, endAngle: 3 * Math.PI / 2, color: 2 } },
    poly([vertex(x, y - roundedRadius), vertex(x - 1, y - 1), vertex(x - 1, y + 1), vertex(x, y + roundedRadius)], false),
  ])
  const before = state(document), args = request(document, sources, { tolerance })
  const result = await previewPlanarBoundaries(document, args)
  assert.equal(result.complete, false); assert.equal(result.contours.length, 0)
  assert.ok(result.diagnostics.some(item => /self-intersect/i.test(item.message)))
  await assert.rejects(applyPlanarBoundaryExtraction(document, { ...args, expectedGeometryDigest: result.receipt.geometryDigest }), /incomplete/i)
  assert.deepEqual(state(document), before)
})

test('different styles within a joined loop are diagnosed rather than implicitly inherited', async () => {
  const { document, sources } = await fixture([line(point(0, 0), point(3, 0)), line(point(3, 0), point(0, 3), { color: 3 }), line(point(0, 3), point(0, 0))])
  const result = await previewPlanarBoundaries(document, request(document, sources))
  assert.equal(result.complete, false); assert.equal(result.contours.length, 0); assert.ok(result.diagnostics.some(d => d.code === 'incompatible-style'))
})

test('far native polylines have stable local area, while unresolved circle conversion fails read-only', async () => {
  const { document, sources } = await fixture([square(10, 9e8, 9e8)]), before = state(document)
  const result = await previewPlanarBoundaries(document, request(document, sources))
  valid(result, sources); close(result.area, 100); assert.deepEqual(state(document), before)
  const far = await fixture([circle(0.1, 9e8, 9e8)]), unchanged = state(far.document)
  await assert.rejects(previewPlanarBoundaries(far.document, request(far.document, far.sources, { tolerance: 1e-9 })), /conversion|tolerance|budget/i)
  assert.deepEqual(state(far.document), unchanged)
})

test('invalid source plane/width/type, explicit units and revision fail without mutation', async () => {
  for (const spec of [line([0, 0, 1], [4, 0, 1]), square(4, 0, 0), { type: 'ELLIPSE', payload: { center: point(0, 0), majorAxis: point(5, 0), ratio: 0.5 } }]) {
    if (spec.type === 'LWPOLYLINE') spec.payload.constantWidth = 1
    const { document, sources } = await fixture([spec]), before = state(document)
    await assert.rejects(previewPlanarBoundaries(document, request(document, sources)), /XY|width|sources|unsupported/i)
    assert.deepEqual(state(document), before)
  }
  const { document, sources } = await fixture([square(4)]), before = state(document)
  for (const extra of [{ units: 'meter' }, { units: 'unitless' }, { expectedRevision: document.revision - 1 }, { tolerance: 0 }, { ids: [sources[0].id, sources[0].id] }]) await assert.rejects(previewPlanarBoundaries(document, request(document, sources, extra)))
  assert.deepEqual(state(document), before)
})

test('asynchronous extraction rejects a changed document revision and does not commit anything', async () => {
  const { document, sources } = await fixture([square(4)])
  const pending = previewPlanarBoundaries(document, request(document, sources))
  await document.transact('Independent caller edit', tx => tx.createEntity('LINE', { start: point(50, 50), end: point(51, 51) }))
  const afterCaller = state(document)
  await assert.rejects(pending, /revision/i); assert.deepEqual(state(document), afterCaller)
})

test('request accessors are refused without evaluating user code; unknown backend fields are invalid even for open paths', async () => {
  const { document, sources } = await fixture([line(point(0, 0), point(3, 0))]), before = state(document)
  let calls = 0
  const unsafe = { units: 'millimeter', expectedRevision: document.revision, get ids() { calls++; return [sources[0].id] } }
  await assert.rejects(previewPlanarBoundaries(document, unsafe), /accessor/i); assert.equal(calls, 0)
  const array = [sources[0].id]; Object.defineProperty(array, '0', { enumerable: true, get() { calls++; return sources[0].id } })
  await assert.rejects(previewPlanarBoundaries(document, { ...request(document, sources), ids: array }), /accessor/i); assert.equal(calls, 0)
  await assert.rejects(previewPlanarBoundaries(document, request(document, sources), { unexpected: true }), /field/i)
  assert.deepEqual(state(document), before)
})

test('default and explicit backend produce the same extraction; unavailable backend cannot pass', async () => {
  const { document, sources } = await fixture([circle(5)])
  const defaultResult = await previewPlanarBoundaries(document, request(document, sources))
  const explicit = await previewPlanarBoundaries(document, request(document, sources), { wasmUrl: new URL('../packages/kjdraw-sdk/src/assets/kjcontour.wasm', import.meta.url) })
  assert.deepEqual(explicit, defaultResult)
  const before = state(document)
  await assert.rejects(previewPlanarBoundaries(document, request(document, sources), { wasmBytes: new Uint8Array([0, 1, 2]) }), /backend|WASM|native/i)
  assert.deepEqual(state(document), before)
})

const pythonOracle = `import io,json,os,math,ezdxf
doc=ezdxf.read(io.StringIO(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()))
audit=doc.audit();out=[]
for e in doc.modelspace().query('LWPOLYLINE'):
 rows=list(e.get_points('xyb'));area=0
 for i,(x,y,b) in enumerate(rows):
  ex,ey,_=rows[(i+1)%len(rows)];area+=(x*ey-ex*y)/2
  if b:
   t=4*math.atan(b);r=math.hypot(ex-x,ey-y)*(1+b*b)/(4*abs(b));area+=r*r*(t-math.sin(t))/2
 out.append({'closed':e.closed,'area':area,'bulges':[r[2] for r in rows]})
print(json.dumps({'errors':len(audit.errors),'fixes':len(audit.fixes),'rings':out}))`
test('extracted native rings survive KJD/DXF reopening and an independent ezdxf audit', async t => {
  const { sdk, document, sources } = await fixture([circle(5), circle(2)])
  const before = state(document), result = await previewPlanarBoundaries(document, request(document, sources))
  valid(result, sources); assert.deepEqual(state(document), before)
  const target = sdk.createDocument({ documentId: 'extracted-boundary-roundtrip', units: 'millimeter' })
  await target.transact('Explicit caller copies reviewed geometry', tx => result.contours.forEach(ring => tx.createEntity('LWPOLYLINE', { closed: true, vertices: ring.vertices })))
  const kjd = await sdk.writeDocument(target, { format: 'KJD' }), reopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  const again = await previewPlanarBoundaries(reopened, request(reopened, reopened.listEntities({ type: 'LWPOLYLINE' })))
  close(again.area, result.area); assert.deepEqual(again.contours.map(r => r.depth), [0, 1])
  const dxf = await sdk.writeDocument(target, { format: 'DXF', version: '2018' }), dxfDoc = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const last = await previewPlanarBoundaries(dxfDoc, request(dxfDoc, dxfDoc.listEntities({ type: 'LWPOLYLINE' })))
  close(last.area, result.area); assert.deepEqual(last.contours.map(r => r.depth), [0, 1])
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-B', '-c', pythonOracle], dxf, { encoding: 'utf8', env: { ...process.env, PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail('Independent ezdxf validator is required but unavailable')
    return t.skip('Independent ezdxf unavailable; native reopen checks completed')
  }
  assert.equal(independent.status, 0, independent.stderr)
  const output = JSON.parse(independent.stdout); assert.equal(output.errors, 0); assert.equal(output.fixes, 0); assert.equal(output.rings.length, 2)
  assert.ok(output.rings.every(r => r.closed && r.bulges.every(b => b !== 0)))
  close(output.rings.reduce((a, r) => a + r.area, 0), 21 * Math.PI)
})
