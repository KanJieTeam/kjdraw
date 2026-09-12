import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createDraftingSession } from '../src/drafting.js'
import { createKJDrawSDK, selectEntitiesInBox } from '../src/index.js'
import { displayedEntityBounds } from '../src/selection-geometry.js'

const TAU = Math.PI * 2
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const point = (center, u, ratio, parameter) => [
  center[0] + u[0] * Math.cos(parameter) - u[1] * ratio * Math.sin(parameter),
  center[1] + u[1] * Math.cos(parameter) + u[0] * ratio * Math.sin(parameter),
]

function rotatedArc() {
  const center = [10, 20], u = [6, 3], ratio = 2 / Math.hypot(...u)
  const minor = [center[0] - u[1] / Math.hypot(...u) * 2, center[1] + u[0] / Math.hypot(...u) * 2]
  const start = 5 * Math.PI / 3, end = Math.PI / 3
  const draft = createDraftingSession('ellipse', { ellipseMode: 'arc' })
  for (const value of [center, [16, 23], minor, point(center, u, ratio, start)]) assert.equal(draft.addPoint(value), null)
  return { draft, center, u, ratio, minor, start, end, endPoint: point(center, u, ratio, end) }
}

test('five-point elliptical arc uses the normalized local basis and preserves a CCW sweep across zero', () => {
  const { draft, center, u, ratio, start, end, endPoint } = rotatedArc()
  assert.equal(draft.state.maximumPoints, 5)
  assert.equal(draft.state.nextPoint, 'ellipseArcEnd')
  const spec = draft.addPoint(endPoint)
  assert.equal(spec.type, 'ELLIPSE')
  assert.deepEqual(spec.payload.center, [...center, 0])
  assert.deepEqual(spec.payload.majorAxis, [...u, 0])
  close(spec.payload.ratio, ratio)
  close(spec.payload.startParameter, start)
  close(spec.payload.endParameter, start + 2 * Math.PI / 3)
  close(spec.payload.endParameter - spec.payload.startParameter, 2 * Math.PI / 3)
  close((spec.payload.endParameter % TAU + TAU) % TAU, end)

  const full = createDraftingSession('ellipse')
  full.addPoint(center); full.addPoint([16, 23])
  const oldCompatible = full.addPoint([center[0] - 3 / Math.sqrt(45) * 2, center[1] + 6 / Math.sqrt(45) * 2])
  assert.equal(oldCompatible.payload.startParameter, 0)
  assert.equal(oldCompatible.payload.endParameter, TAU)
})

test('elliptical arc preview, undo, cancellation and degenerate retry never create a partial result', () => {
  const { draft, center, u, ratio, endPoint } = rotatedArc()
  const cursorPreview = draft.preview(endPoint)
  assert.equal(cursorPreview.type, 'ELLIPSE')
  assert.ok(cursorPreview.payload.endParameter - cursorPreview.payload.startParameter < TAU)
  assert.deepEqual(draft.points.length, 4)
  const removed = draft.undoPoint(), expectedStart = point(center, u, ratio, 5 * Math.PI / 3)
  close(removed[0], expectedStart[0]); close(removed[1], expectedStart[1])
  assert.equal(draft.state.nextPoint, 'ellipseArcStart')
  const fullPreview = draft.preview(point(center, u, ratio, 5 * Math.PI / 3))
  assert.equal(fullPreview.payload.startParameter, 0)
  assert.equal(fullPreview.payload.endParameter, TAU)

  const cancelled = createDraftingSession('ellipse', { ellipseMode: 'arc' })
  cancelled.addPoint([0, 0]); cancelled.addPoint([10, 0]); cancelled.addPoint([0, 5]); cancelled.cancel()
  assert.equal(cancelled.preview([10, 0]), null)
  assert.throws(() => cancelled.addPoint([10, 0]), /cancelled/)

  const zero = createDraftingSession('ellipse', { ellipseMode: 'arc' })
  for (const value of [[0, 0], [10, 0], [0, 5], [10, 0]]) zero.addPoint(value)
  assert.throws(() => zero.addPoint([20, 0]), /sweep is degenerate/)
  assert.equal(zero.points.length, 4)
  assert.equal(zero.state.nextPoint, 'ellipseArcEnd')
  assert.equal(zero.addPoint([0, 5]).type, 'ELLIPSE')

  const coincident = createDraftingSession('ellipse', { ellipseMode: 'arc' })
  coincident.addPoint([0, 0])
  assert.throws(() => coincident.addPoint([0, 0]), /distinct/)
  assert.equal(coincident.state.status, 'collecting')
  const flat = createDraftingSession('ellipse', { ellipseMode: 'arc' })
  for (const value of [[0, 0], [10, 0], [5, 0], [10, 0]]) flat.addPoint(value)
  assert.throws(() => flat.addPoint([0, 5]), /minor axis is degenerate/)
  assert.equal(flat.points.length, 4)
  assert.equal(flat.state.status, 'collecting')
  assert.throws(() => createDraftingSession('ellipse', { ellipseMode: 'segment' }), /Unsupported ellipse mode/)
})

test('native elliptical arc survives history and KJD/DXF reopen while selection and bounds exclude the complement', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'ellipse-arc', units: 'millimeter' })
  const draft = createDraftingSession('ellipse', { ellipseMode: 'arc', payload: { color: 3 } })
  for (const value of [[0, 0], [10, 0], [0, 5], [10, 0]]) draft.addPoint(value)
  const spec = draft.addPoint([0, 5]), created = await sdk.executeCommand('CREATE', spec)
  const expected = structuredClone(document.getObject(created.id).payload)
  assert.deepEqual(displayedEntityBounds(document, document.getObject(created.id)).map(value => Math.round(value * 1e9) / 1e9), [0, 0, 10, 5])
  assert.deepEqual(selectEntitiesInBox(document, [-.02, 4.98], [.02, 5.02], 'crossing'), [created.id])
  assert.deepEqual(selectEntitiesInBox(document, [-.02, -5.02], [.02, -4.98], 'crossing'), [])
  assert.deepEqual(selectEntitiesInBox(document, [6.9, 3.4], [7.2, 3.7], 'crossing'), [created.id])
  assert.deepEqual(selectEntitiesInBox(document, [6.9, -3.7], [7.2, -3.4], 'crossing'), [])

  await sdk.executeCommand('UNDO')
  assert.equal(document.listEntities().length, 0)
  await sdk.executeCommand('REDO')
  assert.deepEqual(document.getObject(created.id).payload, expected)

  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const fromKjd = await sdk.readDocument(kjd, { format: 'KJD', documentId: 'ellipse-arc-kjd' })
  assert.deepEqual(fromKjd.listEntities()[0].payload, expected)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const fromDxf = await sdk.readDocument(dxf, { format: 'DXF', documentId: 'ellipse-arc-dxf' })
  const roundtrip = fromDxf.listEntities({ type: 'ELLIPSE' })[0]
  close(roundtrip.payload.startParameter, expected.startParameter)
  close(roundtrip.payload.endParameter, expected.endParameter)

  const python = process.env.KJDRAW_PYTHON ?? 'python', extra = process.env.KJDRAW_EZDXF_PATH
  const prefix = extra ? `import sys;sys.path.append(${JSON.stringify(extra)});` : ''
  const script = `${prefix}import sys,io,json,ezdxf\ndoc=ezdxf.read(io.StringIO(sys.stdin.read()))\ne=list(doc.modelspace().query('ELLIPSE'))[0]\npoints=list(e.vertices([e.dxf.start_param,e.dxf.end_param]))\nprint(json.dumps({'start':e.dxf.start_param,'end':e.dxf.end_param,'points':[list(p) for p in points]}))`
  const probe = spawnSync(python, ['-c', script], { input: String(dxf), encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (probe.status !== 0) { t.skip(`ezdxf required: ${probe.stderr || probe.error?.message}`); return }
  const independent = JSON.parse(probe.stdout)
  close(independent.start, expected.startParameter)
  close(independent.end, expected.endParameter)
  close(independent.points[0][0], 10); close(independent.points[0][1], 0)
  close(independent.points[1][0], 0); close(independent.points[1][1], 5)
})
