import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJValidationError } from '../src/errors.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const execute = (sdk, drawing, command, args, options = {}) => sdk.executeCommand(command, args, { document: drawing, ...options })

test('LEADEREDIT keeps the native pair identity while editing multiline width, rotation and attachment', async t => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'leader-text-controls', units: 'millimeter' })
  const style = await execute(sdk, drawing, 'TEXTSTYLE', { operation: 'create', name: 'CALLOUT', properties: { fontFamily: 'Arial' } })
  const pair = await execute(sdk, drawing, 'LEADER', { vertices: [[0, 0], [20, 10], [35, 10]], textPosition: [36, 10], text: 'P-101', textHeight: 3, width: 18, rotation: .1, attachmentPoint: 7, styleId: style.id })
  const identity = { leader: [pair.leader.id, pair.leader.handle], annotation: [pair.annotation.id, pair.annotation.handle] }
  const revision = drawing.revision
  await execute(sdk, drawing, 'LEADEREDIT', { id: pair.leader.id, text: String.raw`泵出口 P-102\P检修空间 800 mm`, textHeight: 4, width: 24, rotation: Math.PI / 6, attachmentPoint: 5, arrowEnabled: false })
  assert.equal(drawing.revision, revision + 1)
  const leader = drawing.getObject(pair.leader.id), note = drawing.getObject(pair.annotation.id)
  assert.deepEqual([leader.id, leader.handle], identity.leader); assert.deepEqual([note.id, note.handle], identity.annotation)
  assert.deepEqual({ text: note.payload.text, height: note.payload.height, width: note.payload.width, rotation: note.payload.rotation, attachmentPoint: note.payload.attachmentPoint, styleId: note.payload.styleId }, { text: String.raw`泵出口 P-102\P检修空间 800 mm`, height: 4, width: 24, rotation: Math.PI / 6, attachmentPoint: 5, styleId: style.id })
  assert.equal(leader.payload.annotationId, note.id); assert.equal(leader.payload.arrowEnabled, false)
  await execute(sdk, drawing, 'UNDO', {}); assert.deepEqual(drawing.getObject(note.id).payload, pair.annotation.payload)
  await execute(sdk, drawing, 'REDO', {}); assert.equal(drawing.getObject(note.id).payload.attachmentPoint, 5)

  const native = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual([native.getObject(leader.id).id, native.getObject(leader.id).handle], identity.leader)
  assert.deepEqual({ text: native.getObject(note.id).payload.text, width: native.getObject(note.id).payload.width, rotation: native.getObject(note.id).payload.rotation, attachmentPoint: native.getObject(note.id).payload.attachmentPoint }, { text: note.payload.text, width: 24, rotation: Math.PI / 6, attachmentPoint: 5 })

  const dxf = String(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })), reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const importedLeader = reopened.listEntities({ type: 'LEADER' })[0], importedNote = reopened.getObject(importedLeader.payload.annotationId)
  assert.deepEqual({ text: importedNote.payload.text, height: importedNote.payload.height, width: importedNote.payload.width, rotation: importedNote.payload.rotation, attachmentPoint: importedNote.payload.attachmentPoint }, { text: String.raw`泵出口 P-102\P检修空间 800 mm`, height: 4, width: 24, rotation: Math.PI / 6, attachmentPoint: 5 })
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import sys,io,json,os,ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH'); source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source)); leader=list(d.modelspace().query('LEADER'))[0]; note=d.entitydb.get(leader.dxf.annotation_handle); audit=d.audit()
print(json.dumps({'text':note.text,'height':note.dxf.char_height,'width':note.dxf.width,'rotation':note.dxf.rotation,'attachment':note.dxf.attachment_point,'errors':len(audit.errors),'fixes':len(audit.fixes)},ensure_ascii=False))
`], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(result.stderr)) t.skip('Independent ezdxf dependency required')
  else {
    assert.equal(result.status, 0, result.stderr)
    const observed = JSON.parse(result.stdout)
    assert.deepEqual({ ...observed, rotation: 30 }, { text: String.raw`泵出口 P-102\P检修空间 800 mm`, height: 4, width: 24, rotation: 30, attachment: 5, errors: 0, fixes: 0 })
    assert.ok(Math.abs(observed.rotation - 30) < 1e-9)
  }
})

test('invalid leader text controls and protected annotations reject atomically', async t => {
  for (const patch of [{ width: 0 }, { width: Infinity }, { rotation: Infinity }, { attachmentPoint: 0 }, { attachmentPoint: 10 }, { attachmentPoint: 1.5 }]) {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument(), pair = await execute(sdk, drawing, 'LEADER', { vertices: [[0, 0], [10, 5]], text: 'note' })
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(execute(sdk, drawing, 'LEADEREDIT', { id: pair.leader.id, ...patch }), KJValidationError)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  }
  for (const [reason, protection] of [['locked', { locked: true }], ['hidden', { visible: false }], ['frozen', { frozen: true }]]) await t.test(reason, async () => {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument(), layer = await execute(sdk, drawing, 'LAYERNEW', { name: `NOTE-${reason}` })
    const pair = await execute(sdk, drawing, 'LEADER', { vertices: [[0, 0], [10, 5]], text: 'note', layerId: layer.id })
    await execute(sdk, drawing, 'LAYERUPDATE', { id: layer.id, patch: protection })
    const before = drawing.serialize(), history = drawing.history
    await assert.rejects(execute(sdk, drawing, 'LEADEREDIT', { id: pair.leader.id, width: 20, rotation: .2, attachmentPoint: 3 }), error => error instanceof KJValidationError && error.details?.reason === reason)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history)
  })
})
