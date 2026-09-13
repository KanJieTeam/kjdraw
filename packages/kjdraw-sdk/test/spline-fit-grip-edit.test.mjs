import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { editEntityGrip, getEntityGrips } from '../src/grips.js'
import { splinePoint2 } from '../src/geometry/curves.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const fit = [[0,0,2],[10,10,2],[20,-5,2],[30,0,2]]
const rationalControls = [[0,0,3],[8,18,3],[18,-7,3],[30,14,3],[40,0,3]]
const rationalKnots = [0,0,0,0,.5,1,1,1,1]
const rationalWeights = [1,.75,2,1.25,1]

function chordParameters(points) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1])), total = lengths.reduce((sum, value) => sum + value, 0), result = [0]
  for (const length of lengths) result.push(result.at(-1) + length / total)
  result[result.length - 1] = 1; return result
}

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'fit-spline-grips', units: 'millimeter' })
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 3, controlPoints: fit, fitPoints: fit, knots: [0,0,0,0,1,1,1,1] } }, { document })
  return { sdk, document, spline }
}

test('fit-point grip edits rebuild native control points and knots instead of changing metadata only', async () => {
  const { sdk, document, spline } = await fixture(), before = document.getObject(spline.id).payload
  assert.deepEqual(getEntityGrips(document.getObject(spline.id)).map(grip => grip.id), ['fit:0','fit:1','fit:2','fit:3'])
  const moved = [10,15,2]
  await sdk.executeCommand('GRIPEDIT', { id: spline.id, gripId: 'fit:1', point: moved }, { document })
  const changed = document.getObject(spline.id).payload
  assert.deepEqual(changed.fitPoints[1], moved); assert.notDeepEqual(changed.controlPoints, before.controlPoints)
  assert.equal(changed.controlPoints.length, changed.fitPoints.length); assert.equal(changed.knots.length, changed.controlPoints.length + changed.degree + 1)
  for (const [index, parameter] of chordParameters(changed.fitPoints).entries()) {
    const point = splinePoint2(changed, parameter); close(point[0], changed.fitPoints[index][0]); close(point[1], changed.fitPoints[index][1])
  }
  await sdk.executeCommand('UNDO', {}, { document }); assert.deepEqual(document.getObject(spline.id).payload, before)
  await sdk.executeCommand('REDO', {}, { document }); assert.deepEqual(document.getObject(spline.id).payload, changed)

  const invalidBefore = document.serialize()
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: spline.id, gripId: 'fit:1', point: changed.fitPoints[0] }, { document }), /adjacent duplicates/)
  assert.equal(document.serialize(), invalidBefore)
  await sdk.executeCommand('LAYERUPDATE', { id: spline.payload.layerId, patch: { locked: true } }, { document })
  const protectedBefore = document.serialize()
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: spline.id, gripId: 'fit:1', point: [10,20,2] }, { document }), /locked|writable/)
  assert.equal(document.serialize(), protectedBefore)
})

test('control-point splines remain directly editable while unsupported fit definitions reject atomically', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const control = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 2, controlPoints: [[0,0,4],[5,10,4],[10,0,4]], knots: [0,0,0,1,1,1] } }, { document })
  assert.deepEqual(getEntityGrips(document.getObject(control.id)).map(grip => grip.id), ['control:0','control:1','control:2'])
  await sdk.executeCommand('GRIPEDIT', { id: control.id, gripId: 'control:1', point: [5,12,4] }, { document }); assert.deepEqual(document.getObject(control.id).payload.controlPoints[1], [5,12,4])
  const rational = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 3, controlPoints: fit, fitPoints: fit, knots: [0,0,0,0,1,1,1,1], weights: [1,1,1,1] } }, { document })
  assert.throws(() => getEntityGrips(document.getObject(rational.id)), /Rational SPLINE/)
  const before = document.serialize()
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: rational.id, gripId: 'fit:1', point: [10,12,2] }, { document }), /Rational SPLINE/)
  assert.equal(document.serialize(), before)
  const densePoints = Array.from({ length: 129 }, (_, index) => [index, Math.sin(index), 0]), denseKnots = [0,0,...Array.from({ length: 127 }, (_, index) => (index + 1) / 128),1,1]
  const dense = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 1, controlPoints: densePoints, fitPoints: densePoints, knots: denseKnots } }, { document })
  assert.throws(() => getEntityGrips(document.getObject(dense.id)), /128-point interactive budget/)
  const denseBefore = document.serialize()
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: dense.id, gripId: 'fit:1', point: [1,2,0] }, { document }), /128-point interactive budget/)
  assert.equal(document.serialize(), denseBefore)
})

test('native rational control grips have stable indices and preserve the complete entity atomically', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'rational-control-grips', units: 'millimeter' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Rational spline', color: 4 }, { document })
  const spline = await sdk.executeCommand('CREATE', {
    type: 'SPLINE',
    payload: {
      degree: 3, controlPoints: rationalControls, knots: rationalKnots, weights: rationalWeights,
      startTangent: [2,1,0], endTangent: [3,-1,0], closed: false, periodic: false, layerId: layer.id,
    },
    options: { id: 'rational-control-spline', handle: 'ABC' },
  }, { document })
  const before = document.getObject(spline.id), beforeRevision = document.revision
  const grips = getEntityGrips(before)
  assert.deepEqual(grips.map(({ id, role, controlPointIndex }) => ({ id, role, controlPointIndex })), rationalControls.map((_, index) => ({ id: `control:${index}`, role: 'control-point', controlPointIndex: index })))

  const target = [9,22,3], preview = editEntityGrip(before, 'control:1', target)
  assert.equal(document.revision, beforeRevision); assert.deepEqual(document.getObject(spline.id), before)
  assert.deepEqual(preview.controlPoints[1], target)
  for (const key of ['degree','knots','weights','fitPoints','startTangent','endTangent','closed','periodic','layerId']) assert.deepEqual(preview[key], before.payload[key], key)

  await sdk.executeCommand('GRIPEDIT', { id: spline.id, gripId: 'control:1', point: target }, { document, expectedRevision: beforeRevision })
  const changed = document.getObject(spline.id)
  assert.equal(changed.id, before.id); assert.equal(changed.handle, before.handle); assert.equal(changed.ownerId, before.ownerId)
  assert.deepEqual(changed.payload.controlPoints[1], target)
  for (const key of ['degree','knots','weights','fitPoints','startTangent','endTangent','closed','periodic','layerId']) assert.deepEqual(changed.payload[key], before.payload[key], key)
  await sdk.executeCommand('UNDO', {}, { document }); assert.deepEqual(document.getObject(spline.id), before)
  await sdk.executeCommand('REDO', {}, { document }); assert.deepEqual(document.getObject(spline.id), changed)

  for (const patch of [{ locked: true }, { visible: false }, { frozen: true }]) {
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch }, { document })
    const protectedBefore = document.serialize()
    await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: spline.id, gripId: 'control:1', point: [10,23,3] }, { document }), /locked|hidden|frozen/)
    assert.equal(document.serialize(), protectedBefore)
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false, visible: true, frozen: false } }, { document })
  }
  const invalidBefore = document.serialize()
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: spline.id, gripId: 'control:1', point: [1e12 + 1,0,3] }, { document }), /within/)
  await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: spline.id, gripId: 'control:99', point: [0,0,3] }, { document }), /does not exist/)
  assert.equal(document.serialize(), invalidBefore)
})

test('rational control-point edit survives KJD, native DXF and independent ezdxf with tangents', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'rational-control-roundtrip', units: 'millimeter' })
  const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 3, controlPoints: rationalControls, knots: rationalKnots, weights: rationalWeights, startTangent: [2,1,0], endTangent: [3,-1,0] }, options: { id: 'rational-spline', handle: 'ABC' } }, { document })
  await sdk.executeCommand('GRIPEDIT', { id: spline.id, gripId: 'control:2', point: [20,-11,3] }, { document })
  const expected = document.getObject(spline.id)
  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), kjdReopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  const kjdSpline = kjdReopened.getObject(spline.id)
  assert.equal(kjdSpline.id, expected.id); assert.equal(kjdSpline.handle, expected.handle); assert.equal(kjdSpline.ownerId, expected.ownerId)
  for (const key of ['degree','controlPoints','knots','weights','startTangent','endTangent','closed','periodic','layerId']) assert.deepEqual(kjdSpline.payload[key], expected.payload[key], key)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), dxfReopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const reopened = dxfReopened.listEntities({ type: 'SPLINE' })[0]
  assert.equal(reopened.handle, expected.handle); assert.deepEqual(reopened.payload.controlPoints, expected.payload.controlPoints)
  assert.deepEqual(reopened.payload.knots, expected.payload.knots); assert.deepEqual(reopened.payload.weights, expected.payload.weights)
  assert.deepEqual(reopened.payload.startTangent, expected.payload.startTangent); assert.deepEqual(reopened.payload.endTangent, expected.payload.endTangent)
  const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));items=list(d.modelspace().query('SPLINE'));assert len(items)==1
s=items[0];audit=d.audit();assert not audit.errors and not audit.fixes
print(json.dumps({'handle':s.dxf.handle,'degree':s.dxf.degree,'controls':[list(v) for v in s.control_points],'knots':list(s.knots),'weights':list(s.weights),'start':list(s.dxf.start_tangent),'end':list(s.dxf.end_tangent)}))
`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(result.stderr)) { if (process.env.KJDRAW_REQUIRE_DXF_INTEGRATION === '1') assert.fail(result.stderr || result.error.message); t.skip('ezdxf required'); return }
  assert.equal(result.status, 0, result.stderr)
  const audited = JSON.parse(result.stdout)
  assert.equal(audited.handle, expected.handle); assert.equal(audited.degree, 3); assert.deepEqual(audited.controls, expected.payload.controlPoints)
  assert.deepEqual(audited.knots, rationalKnots); assert.deepEqual(audited.weights, rationalWeights); assert.deepEqual(audited.start, [2,1,0]); assert.deepEqual(audited.end, [3,-1,0])
})

test('rebuilt fit-point spline survives KJD, DXF and independent ezdxf curve evaluation', async t => {
  const { sdk, document, spline } = await fixture(), moved = [10,15,2]
  await sdk.executeCommand('GRIPEDIT', { id: spline.id, gripId: 'fit:1', point: moved }, { document })
  const expected = document.getObject(spline.id).payload, parameters = chordParameters(expected.fitPoints)
  const kjd = await sdk.writeDocument(document, { format: 'KJD' }), kjdReopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  assert.deepEqual(kjdReopened.listEntities({ type: 'SPLINE' })[0].payload.controlPoints, expected.controlPoints)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), dxfReopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const reopened = dxfReopened.listEntities({ type: 'SPLINE' })[0]; assert.deepEqual(reopened.payload.fitPoints, expected.fitPoints); assert.equal(dxfReopened.validate().valid, true)
  const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));items=list(d.modelspace().query('SPLINE'));assert len(items)==1
s=items[0];curve=s.construction_tool();params=json.loads(os.environ['KJDRAW_SPLINE_PARAMS']);points=[list(curve.point(v)) for v in params];audit=d.audit();assert not audit.errors and not audit.fixes
print(json.dumps({'controlCount':len(s.control_points),'fitCount':len(s.fit_points),'points':points,'auditErrors':len(audit.errors)}))
`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8', KJDRAW_SPLINE_PARAMS: JSON.stringify(parameters) } })
  if (result.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(result.stderr)) { if (process.env.KJDRAW_REQUIRE_DXF_INTEGRATION === '1') assert.fail(result.stderr || result.error.message); t.skip('ezdxf required'); return }
  assert.equal(result.status, 0, result.stderr)
  const audited = JSON.parse(result.stdout); assert.equal(audited.controlCount, 4); assert.equal(audited.fitCount, 4); assert.equal(audited.auditErrors, 0)
  for (const [index, point] of audited.points.entries()) { close(point[0], expected.fitPoints[index][0], 1e-7); close(point[1], expected.fitPoints[index][1], 1e-7); close(point[2], 2, 1e-7) }
})
