import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJValidationError } from '../src/errors.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const execute = (sdk, drawing, command, args = {}, options = {}) => sdk.executeCommand(command, args, { document: drawing, ...options })

test('native LEADER owns editable MTEXT and round-trips through KJD and DXF', async t => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'native-leader', units: 'millimeter' })
  const style = await execute(sdk, drawing, 'TEXTSTYLE', { operation: 'create', name: 'LEADER-CJK', properties: { fontFamily: 'Noto Sans CJK SC', widthFactor: .8 } })
  const revision = drawing.revision
  const created = await execute(sdk, drawing, 'LEADER', { vertices: [[0, 0, 0], [12, 8, 0], [30, 8, 0]], textPosition: [32, 8, 0], text: '阀门 V-101 Δ 😀', textHeight: 4, styleId: style.id, arrowEnabled: true })
  assert.equal(drawing.revision, revision + 1)
  assert.equal(created.leader.type, 'LEADER'); assert.equal(created.annotation.type, 'MTEXT')
  assert.equal(created.leader.payload.annotationId, created.annotation.id); assert.equal(created.leader.payload.ownsAnnotation, true)
  assert.deepEqual(created.annotation.payload, { ...created.annotation.payload, position: [32, 8, 0], text: '阀门 V-101 Δ 😀', height: 4, styleId: style.id })

  const editedRevision = drawing.revision
  await execute(sdk, drawing, 'LEADEREDIT', { id: created.leader.id, vertices: [[1, 2, 0], [15, 9, 0], [34, 9, 0]], textPosition: [36, 9, 0], text: '阀门 V-102\P第二行', textHeight: 5, styleId: style.id, arrowEnabled: false })
  assert.equal(drawing.revision, editedRevision + 1)
  assert.deepEqual(drawing.getObject(created.leader.id).payload.vertices, [[1, 2, 0], [15, 9, 0], [34, 9, 0]])
  assert.equal(drawing.getObject(created.leader.id).payload.arrowEnabled, false)
  assert.deepEqual(drawing.getObject(created.annotation.id).payload.position, [36, 9, 0])
  assert.equal(drawing.getObject(created.annotation.id).payload.text, '阀门 V-102\P第二行')

  await execute(sdk, drawing, 'GRIPEDIT', { id: created.leader.id, gripId: 'text', point: [42, 11, 0] })
  assert.deepEqual(drawing.getObject(created.annotation.id).payload.position, [42, 11, 0])
  assert.deepEqual(drawing.getObject(created.leader.id).payload.textPosition, [42, 11, 0])
  await execute(sdk, drawing, 'UNDO'); assert.deepEqual(drawing.getObject(created.annotation.id).payload.position, [36, 9, 0])
  await execute(sdk, drawing, 'REDO'); assert.deepEqual(drawing.getObject(created.annotation.id).payload.position, [42, 11, 0])

  await execute(sdk, drawing, 'ERASE', { id: created.leader.id })
  assert.equal(drawing.getObject(created.leader.id, { includeErased: true }).erased, true)
  assert.equal(drawing.getObject(created.annotation.id, { includeErased: true }).erased, true)
  await execute(sdk, drawing, 'RESTORE', { id: created.annotation.id })
  assert.equal(drawing.getObject(created.leader.id).erased, false); assert.equal(drawing.getObject(created.annotation.id).erased, false)

  const kjd = String(await sdk.writeDocument(drawing, { format: 'KJD' })), native = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  assert.equal(native.getObject(created.leader.id).payload.annotationId, created.annotation.id)
  assert.equal(native.getObject(created.annotation.id).payload.text, '阀门 V-102\P第二行')

  const dxf = String(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })), reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const leader = reopened.listEntities({ type: 'LEADER' })[0], annotation = reopened.getObject(leader.payload.annotationId)
  assert.equal(annotation.type, 'MTEXT'); assert.equal(annotation.payload.text, '阀门 V-102\P第二行'); assert.equal(annotation.payload.height, 5)
  assert.deepEqual(leader.payload.textPosition, annotation.payload.position); assert.equal(leader.payload.unresolvedLeaderAnnotation, undefined)

  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import sys,io,json,os,ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH'); source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source)); leader=list(d.modelspace().query('LEADER'))[0]; note=d.entitydb.get(leader.dxf.annotation_handle); a=d.audit()
print(json.dumps({'vertices':[list(v) for v in leader.vertices], 'arrow':leader.dxf.has_arrowhead, 'annotation_type':leader.dxf.annotation_type, 'annotation_handle':leader.dxf.annotation_handle, 'note_handle':note.dxf.handle, 'text':note.text, 'height':note.dxf.char_height, 'errors':len(a.errors), 'fixes':len(a.fixes)},ensure_ascii=False))
`], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(result.stderr)) t.skip('Independent ezdxf dependency required')
  else {
    assert.equal(result.status, 0, result.stderr)
    const observed = JSON.parse(result.stdout)
    assert.equal(observed.annotation_handle, observed.note_handle); assert.equal(observed.arrow, 0); assert.equal(observed.annotation_type, 0)
    assert.equal(observed.text, '阀门 V-102\P第二行'); assert.equal(observed.height, 5); assert.equal(observed.errors + observed.fixes, 0)
  }
})

test('LEADER validation, stale edits and protected layers reject atomically', async t => {
  for (const args of [
    { vertices: [[0, 0], [0, 0]], text: 'bad' }, { vertices: [[0, 0], [1, 1]], text: '' },
    { vertices: [[0, 0], [1, 1]], text: 'bad style', styleId: 'missing' }, { vertices: [[0, 0], [1, 1]], text: 'height', textHeight: 0 },
  ]) {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument(), before = drawing.serialize(), history = drawing.history
    await assert.rejects(execute(sdk, drawing, 'LEADER', args), KJValidationError)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history)
  }
  for (const [reason, protection] of [['locked', { locked: true }], ['hidden', { visible: false }], ['frozen', { frozen: true }]]) await t.test(reason, async () => {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument(), layer = await execute(sdk, drawing, 'LAYERNEW', { name: `LEADER-${reason}` })
    const pair = await execute(sdk, drawing, 'LEADER', { vertices: [[0, 0], [10, 5]], text: reason, layerId: layer.id })
    await execute(sdk, drawing, 'LAYERUPDATE', { id: layer.id, patch: protection })
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(execute(sdk, drawing, 'LEADEREDIT', { id: pair.leader.id, text: 'changed' }), error => error instanceof KJValidationError && error.details?.reason === reason)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  })
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument(), pair = await execute(sdk, drawing, 'LEADER', { vertices: [[0, 0], [10, 5]], text: 'stale' })
  const before = drawing.serialize(), history = drawing.history
  await assert.rejects(execute(sdk, drawing, 'LEADEREDIT', { id: pair.leader.id, text: 'changed' }, { expectedRevision: drawing.revision - 1 }))
  assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history)
  await execute(sdk, drawing, 'CREATE', { type: 'MLEADER', payload: { vertices: [[0, 0], [10, 5]] } })
  await assert.rejects(sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }), error => /MLEADER/.test(error.cause?.message ?? error.message))
})
