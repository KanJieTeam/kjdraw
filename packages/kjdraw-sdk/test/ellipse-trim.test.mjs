import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createBoundaryEditSession, createKJDrawSDK, KJDocument, KJValidationError, trimEntityPayloads } from '../src/index.js'

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const records = drawing => Object.fromEntries(drawing.listObjects({ includeErased: true }).map(object => [object.id, object]))
const ellipse = (startParameter = 0, endParameter = Math.PI) => ({
  type: 'ELLIPSE', payload: { center: [0, 0, 6], majorAxis: [10, 0, 0], ratio: .5, startParameter, endParameter,
    color: 2, lineweight: 35, linetypeScale: 1.5 },
})
const vertical = (x, type = 'LINE') => type === 'LINE'
  ? { type, payload: { start: [x, 0, 6], end: [x, 10, 6] } }
  : { type, payload: { origin: [x, 0, 6], direction: [0, 1, 0] } }

test('native elliptical arc TRIM maps LINE, RAY and XLINE boundaries exactly and retains both unpicked parameter intervals', () => {
  const expected = [Math.PI / 3, 2 * Math.PI / 3]
  for (const type of ['LINE', 'RAY', 'XLINE']) {
    const pieces = trimEntityPayloads(ellipse(), [vertical(5, type), vertical(-5, type)], [0, 5])
    assert.equal(pieces.length, 2)
    assert.deepEqual(pieces.map(piece => piece.type), ['ELLIPSE', 'ELLIPSE'])
    near(pieces[0].payload.startParameter, 0); near(pieces[0].payload.endParameter, expected[0])
    near(pieces[1].payload.startParameter, expected[1]); near(pieces[1].payload.endParameter, Math.PI)
    for (const piece of pieces) assert.deepEqual(piece.payload, {
      center: [0, 0, 6], majorAxis: [10, 0, 0], ratio: .5,
      startParameter: piece.payload.startParameter, endParameter: piece.payload.endParameter,
      color: 2, lineweight: 35, linetypeScale: 1.5,
    })
  }
})

test('full ELLIPSE TRIM preserves native curve parameters and rejects ambiguous or unsupported geometry', () => {
  const target = ellipse(0, Math.PI * 2)
  const [remaining] = trimEntityPayloads(target, [vertical(5, 'XLINE'), vertical(-5, 'XLINE')], [0, 5])
  assert.equal(remaining.type, 'ELLIPSE')
  near(remaining.payload.startParameter, 2 * Math.PI / 3)
  near(remaining.payload.endParameter, Math.PI / 3 + Math.PI * 2)
  near(remaining.payload.endParameter - remaining.payload.startParameter, 5 * Math.PI / 3)
  assert.throws(() => trimEntityPayloads(target, [vertical(10)], [0, 5]), /at least two distinct/)
  assert.throws(() => trimEntityPayloads(target, [{ type: 'CIRCLE', payload: { center: [0, 0, 6], radius: 4 } }], [0, 5]), /support LINE, RAY or XLINE/)
  assert.throws(() => trimEntityPayloads(ellipse(), [vertical(5)], [5, Math.sqrt(18.75)]), /exactly on a cutting boundary/)
  assert.throws(() => trimEntityPayloads(ellipse(), [{ type: 'LINE', payload: { start: [5, 0, 7], end: [5, 10, 7] } }], [0, 5]), /same XY plane/)
  assert.throws(() => trimEntityPayloads({ type: 'ELLIPSE', payload: { ...target.payload, majorAxis: [10, 0, 1] } }, [vertical(5)], [0, 5]), /major axis in the XY plane/)
})

test('TRIM ELLIPSE is one protected atomic transaction with membership, undo, redo and KJD reopen', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Elliptical parts', color: 4 })
  const target = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', options: { name: 'opening' }, payload: { ...ellipse().payload, layerId: layer.id } })
  const cutters = await Promise.all([5, -5].map(x => sdk.executeCommand('CREATE', { type: 'LINE', payload: vertical(x).payload })))
  const group = await sdk.executeCommand('GROUP', { name: 'profile', ids: [target.id] })
  sdk.activeSelection.replace([target.id]); const saved = await sdk.getSelectionManager().saveNamed('profile-selection'); sdk.activeSelection.clear()
  const before = records(drawing), revision = drawing.revision
  const primary = await sdk.executeCommand('TRIM', { id: target.id, boundaryIds: cutters.map(entity => entity.id), pickPoint: [0, 5] })
  assert.equal(drawing.revision, revision + 1); assert.equal(primary.id, target.id); assert.equal(primary.handle, target.handle)
  const pieces = [...drawing.listEntities({ type: 'ELLIPSE' })].sort((a, b) => a.payload.startParameter - b.payload.startParameter)
  assert.equal(pieces.length, 2); assert.equal(pieces[0].id, target.id); assert.notEqual(pieces[1].id, target.id)
  assert.deepEqual(drawing.getObject(group.id).payload.memberIds, pieces.map(piece => piece.id))
  assert.deepEqual(drawing.getObject(saved.id).payload.memberIds, pieces.map(piece => piece.id))
  const after = records(drawing), serialized = drawing.serialize()
  await sdk.executeCommand('UNDO'); assert.deepEqual(records(drawing), before)
  await sdk.executeCommand('REDO'); assert.deepEqual(records(drawing), after)
  assert.deepEqual(records(KJDocument.open(serialized)), after)

  await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } })
  const protectedBefore = drawing.serialize(), protectedRevision = drawing.revision
  await assert.rejects(sdk.executeCommand('TRIM', { id: target.id, boundaryIds: [cutters[0].id], pickPoint: [8, 3] }), KJValidationError)
  assert.equal(drawing.serialize(), protectedBefore); assert.equal(drawing.revision, protectedRevision)
})

test('boundary-edit exposes ELLIPSE in the shared bilingual workflow and DXF reopens independently in ezdxf', async t => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const target = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: ellipse().payload })
  const cutters = await Promise.all([5, -5].map(x => sdk.executeCommand('CREATE', { type: 'LINE', payload: vertical(x).payload })))
  const session = createBoundaryEditSession('trim', { document: drawing, boundaryIds: cutters.map(entity => entity.id), locale: 'zh' })
  session.confirmBoundaries(); assert.match(session.prompt, /修剪/)
  const preview = session.preview(target.id, [0, 5]); assert.equal(preview.pieces.length, 2); assert.equal(preview.pieces[0].type, 'ELLIPSE')
  await session.apply(preview, request => sdk.executeCommandEnvelope(sdk.createCommandEnvelope(request.command, request.arguments, {
    document: drawing, expectedRevision: request.expectedRevision, origin: 'ui',
  }), { document: drawing }))
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  const reopened = await sdk.fileAdapters.read(dxf, { format: 'DXF' })
  const actual = [...reopened.listEntities({ type: 'ELLIPSE' })].sort((a, b) => a.payload.startParameter - b.payload.startParameter)
  assert.equal(actual.length, 2); near(actual[0].payload.endParameter, Math.PI / 3); near(actual[1].payload.startParameter, 2 * Math.PI / 3)

  const script = String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH')
source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source)); audit=d.audit(); items=list(d.modelspace().query('ELLIPSE'))
print(json.dumps({'errors':len(audit.errors),'fixes':len(audit.fixes),'items':[[e.dxf.start_param,e.dxf.end_param,list(e.dxf.center),list(e.dxf.major_axis),e.dxf.ratio] for e in items]}))`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(result.stderr)) {
    if (process.env.KJDRAW_REQUIRE_DXF_INTEGRATION === '1') assert.fail(result.stderr || result.error.message)
    t.skip('ezdxf required'); return
  }
  assert.equal(result.status, 0, result.stderr); const verified = JSON.parse(result.stdout)
  assert.deepEqual({ errors: verified.errors, fixes: verified.fixes }, { errors: 0, fixes: 0 }); assert.equal(verified.items.length, 2)
  verified.items.sort((a, b) => a[0] - b[0]); near(verified.items[0][1], Math.PI / 3); near(verified.items[1][0], 2 * Math.PI / 3)
  for (const item of verified.items) { assert.deepEqual(item[2], [0, 0, 6]); assert.deepEqual(item[3], [10, 0, 0]); near(item[4], .5) }
})
