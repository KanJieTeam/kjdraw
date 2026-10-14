import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createKJDrawSDK, reflectionAcrossLine3, rotationAround3, scaleAround3,
  transformEntityPayload, transformPoint3, transformVector3,
} from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const TAU = Math.PI * 2
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
const nearPoint = (actual, expected) => { assert.equal(actual.length, expected.length); actual.forEach((n, i) => near(n, expected[i])) }
const ellipsePoint = (p, t) => [
  p.center[0] + p.majorAxis[0] * Math.cos(t) - p.majorAxis[1] * p.ratio * Math.sin(t),
  p.center[1] + p.majorAxis[1] * Math.cos(t) + p.majorAxis[0] * p.ratio * Math.sin(t),
  p.center[2],
]
const ellipse = { center: [12, -4, 3], majorAxis: [8, 6, 0], ratio: .35, startParameter: .2, endParameter: 2.1 }
const spline = {
  degree: 2, controlPoints: [[1, 2, 3], [4, 8, 3], [10, 2, 3]],
  fitPoints: [[1, 2, 3], [5, 5, 3], [10, 2, 3]], knots: [0, 0, 0, 1, 1, 1],
  weights: [1, .6, 1], startTangent: [3, 6, 0], endTangent: [6, -6, 0],
}

test('native spline endpoint tangents follow rotation, scaling and reflection as vectors', () => {
  for (const matrix of [rotationAround3(.7, [11, -9]), scaleAround3(2, 2, [11, -9]), reflectionAcrossLine3([3, 2], [7, 5])]) {
    const before = structuredClone(spline), after = transformEntityPayload('SPLINE', spline, matrix)
    for (const key of ['startTangent', 'endTangent']) nearPoint(after[key], transformVector3(matrix, before[key]))
    for (const key of ['controlPoints', 'fitPoints']) before[key].forEach((p, i) => nearPoint(after[key][i], transformPoint3(matrix, p)))
    assert.deepEqual(after.knots, before.knots); assert.deepEqual(after.weights, before.weights)
    assert.deepEqual(spline, before)
  }
})

test('native elliptical arc reflections preserve the entire locus and increasing sweep', () => {
  for (const matrix of [reflectionAcrossLine3([0, 0], [1, 0]), reflectionAcrossLine3([3, 2], [7, 5])]) {
    for (const interval of [[.2, 2.1], [5.8, 6.8], [5.8, .5], [0, TAU], [.7, .7 + TAU]]) {
      const before = { ...ellipse, startParameter: interval[0], endParameter: interval[1] }
      const after = transformEntityPayload('ELLIPSE', before, matrix)
      const rawSpan = before.endParameter - before.startParameter
      const span = rawSpan < 0 ? rawSpan + TAU : rawSpan
      near(after.endParameter - after.startParameter, span)
      assert.ok(after.startParameter >= 0 && after.startParameter < TAU)
      for (let i = 0; i <= 20; i++) {
        const expected = transformPoint3(matrix, ellipsePoint(before, before.startParameter + span * i / 20))
        nearPoint(ellipsePoint(after, after.endParameter - span * i / 20), expected)
      }
    }
  }
})

test('unsupported ellipse distortion rejects the entire document transaction', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  await document.transact('Fixture', tx => {
    tx.createEntity('ELLIPSE', ellipse, { id: 'ellipse' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 1, 0] }, { id: 'line' })
  })
  for (const matrix of [[2, 0, 0, 1, 0, 0], [1, 0, .5, 1, 0, 0]]) {
    const before = document.serialize(), history = document.history
    await assert.rejects(document.transact('Distortion', tx => {
      tx.transformEntity('line', matrix)
      tx.transformEntity('ellipse', matrix)
    }), /non-circular|similarity|ellipse/i)
    assert.equal(document.serialize(), before); assert.deepEqual(document.history, history)
  }
})

test('MIRROR preserves native curves through undo/redo, KJD and independent DXF geometry', async t => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  await document.transact('Native curves', tx => {
    tx.createEntity('ELLIPSE', ellipse, { id: 'ellipse' })
    tx.createEntity('SPLINE', spline, { id: 'spline' })
  })
  const before = document.serialize(), lineStart = [3, 2], lineEnd = [7, 5]
  const matrix = reflectionAcrossLine3(lineStart, lineEnd)
  const copies = await sdk.executeCommand('MIRROR', { ids: ['ellipse', 'spline'], lineStart, lineEnd, eraseSource: true }, { document })
  const expectedEllipse = copies.find(item => item.type === 'ELLIPSE').payload
  const expectedSpline = copies.find(item => item.type === 'SPLINE').payload
  const originalSpan = ellipse.endParameter - ellipse.startParameter
  const expectedPoints = Array.from({ length: 9 }, (_, i) => transformPoint3(matrix, ellipsePoint(ellipse, ellipse.endParameter - originalSpan * i / 8)))
  expectedPoints.forEach((p, i) => nearPoint(ellipsePoint(expectedEllipse, expectedEllipse.startParameter + originalSpan * i / 8), p))
  nearPoint(expectedSpline.startTangent, transformVector3(matrix, spline.startTangent))
  nearPoint(expectedSpline.endTangent, transformVector3(matrix, spline.endTangent))
  await document.undo(); assert.deepEqual(document.getObject('ellipse').payload, JSON.parse(before).objects.ellipse.payload)
  assert.equal(document.listEntities().length, 2)
  await document.redo(); assert.deepEqual(document.getObject(copies[0].id).payload, copies[0].payload)
  for (const format of ['KJD', 'DXF']) {
    const source = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await createKJDrawSDK().readDocument(source, { format })
    const p = reopened.listEntities({ type: 'ELLIPSE' })[0].payload
    expectedPoints.forEach((point, i) => nearPoint(ellipsePoint(p, p.startParameter + originalSpan * i / 8), point))
    const s = reopened.listEntities({ type: 'SPLINE' })[0].payload
    nearPoint(s.startTangent, expectedSpline.startTangent); nearPoint(s.endTangent, expectedSpline.endTangent)
    assert.equal(reopened.validate().valid, true)
    if (format !== 'DXF') continue
    const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
path=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(path,encoding='utf-8').read() if path else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));e=list(d.modelspace().query('ELLIPSE'))[0];s=list(d.modelspace().query('SPLINE'))[0]
params=[e.dxf.start_param+(e.dxf.end_param-e.dxf.start_param)*i/8 for i in range(9)]
audit=d.audit();assert not audit.errors and not audit.fixes
print(json.dumps({'points':[list(p) for p in e.vertices(params)],'startTangent':list(s.dxf.start_tangent),'endTangent':list(s.dxf.end_tangent)}))
`
    const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], source, { encoding: 'utf8', timeout: 120000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    if (result.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(result.stderr)) {
      if (process.env.KJDRAW_REQUIRE_DXF_INTEGRATION === '1' || process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(result.stderr || result.error.message)
      t.skip('ezdxf required'); return
    }
    assert.equal(result.status, 0, result.stderr)
    const independentlyRead = JSON.parse(result.stdout)
    independentlyRead.points.forEach((p, i) => nearPoint(p, expectedPoints[i]))
    nearPoint(independentlyRead.startTangent, expectedSpline.startTangent); nearPoint(independentlyRead.endTangent, expectedSpline.endTangent)
  }
})
