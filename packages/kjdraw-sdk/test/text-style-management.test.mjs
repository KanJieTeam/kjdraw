import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJValidationError } from '../src/errors.js'
import { layoutCadText, textFontFamily } from '../src/geometry/text-layout.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const textPayload = (text, y = 0) => ({ position: [0, y, 0], text, height: 2.5, rotation: Math.PI / 12 })

test('TEXTSTYLE records keep stable bindings while current style drives all text entity creation paths', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'text-style-management', units: 'millimeter' })
  const cjk = await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'CJK-NOTES', current: true, properties: { fontFamily: 'Noto Sans CJK SC', fontFile: 'NotoSansCJK-Regular.ttc', bigFontFile: 'hztxt.shx', fixedHeight: 4, widthFactor: .8, obliqueAngle: .1 } }, { document: drawing })
  const first = await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { ...textPayload('泵房 Δ 😀'), horizontalAlignment: 1, verticalAlignment: 2, alignmentPoint: [0, 0, 0] } }, { document: drawing })
  const multiline = await sdk.executeCommand('CREATE', { type: 'MTEXT', payload: { ...textPayload('设备说明\\P第二行 😀', 10), attachmentPoint: 5, width: 60 } }, { document: drawing })
  for (const type of ['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB']) {
    const entity = await sdk.executeCommand('CREATE', { type, payload: { ...textPayload(`${type} 中文`, 20), ...(type === 'MTEXT' ? { attachmentPoint: 1 } : {}), ...(['ATTDEF', 'ATTRIB'].includes(type) ? { tag: type, prompt: '提示' } : {}) } }, { document: drawing })
    assert.equal(entity.payload.styleId, cjk.id)
  }
  assert.equal(layoutCadText(first.payload, cjk.payload).height, 4)
  assert.match(textFontFamily(cjk.payload), /^"NotoSansCJK-Regular",/)

  const iso = await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'ISO-TEXT', current: true, properties: { fontFamily: 'Arial', fixedHeight: 0, widthFactor: 1, obliqueAngle: 0 } }, { document: drawing })
  const batch = await sdk.executeCommand('CREATEBATCH', { entities: ['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].map((type, index) => ({ type, payload: { ...textPayload(`BATCH ${type}`, 40 + index * 5), ...(type === 'MTEXT' ? { attachmentPoint: 9 } : {}), ...(['ATTDEF', 'ATTRIB'].includes(type) ? { tag: `B${index}`, prompt: 'Batch' } : {}) } })) }, { document: drawing })
  assert.ok(batch.every(entity => entity.payload.styleId === iso.id))
  assert.equal(drawing.getObject(first.id).payload.styleId, cjk.id)

  await sdk.executeCommand('TEXTSTYLE', { operation: 'update', id: cjk.id, newName: 'CJK-NOTES-UPDATED', properties: { widthFactor: .75, fixedHeight: 5 } }, { document: drawing })
  assert.equal(drawing.getObject(first.id).payload.styleId, cjk.id)
  assert.equal(drawing.getObject(multiline.id).payload.styleId, cjk.id)
  assert.equal(layoutCadText(first.payload, drawing.getObject(cjk.id).payload).height, 5)
  await sdk.executeCommand('TEXTSTYLE', { operation: 'set-current', id: cjk.id }, { document: drawing })
  await sdk.executeCommand('UNDO', {}, { document: drawing }); assert.equal(drawing.getTable('textStyles').currentId, iso.id)
  await sdk.executeCommand('REDO', {}, { document: drawing }); assert.equal(drawing.getTable('textStyles').currentId, cjk.id)

  const kjd = await sdk.writeDocument(drawing, { format: 'KJD' }), native = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  assert.equal(native.getTable('textStyles').currentId, cjk.id)
  assert.equal(native.getObject(first.id).payload.text, '泵房 Δ 😀')
  assert.equal(native.getObject(multiline.id).payload.attachmentPoint, 5)

  await sdk.executeCommand('ERASE', { ids: drawing.listEntities({ type: 'ATTRIB' }).map(entity => entity.id) }, { document: drawing })
  const dxf = String(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })), reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  const reopenedText = reopened.listEntities({ type: 'TEXT' }).find(entity => entity.payload.text === '泵房 Δ 😀'), reopenedMText = reopened.listEntities({ type: 'MTEXT' }).find(entity => entity.payload.text.includes('第二行'))
  assert.equal(reopened.getObject(reopenedText.payload.styleId).name, 'CJK-NOTES-UPDATED')
  assert.equal(reopenedText.payload.horizontalAlignment, 1); assert.equal(reopenedText.payload.verticalAlignment, 2)
  assert.equal(reopenedMText.payload.attachmentPoint, 5); assert.equal(reopenedMText.payload.width, 60)
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import sys,io,json,os,ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH'); source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source)); s=d.styles.get('CJK-NOTES-UPDATED'); text=next(e for e in d.modelspace().query('TEXT') if e.dxf.text=='泵房 Δ 😀'); mtext=next(e for e in d.modelspace().query('MTEXT') if '第二行' in e.text); a=d.audit(); print(json.dumps({'style':{'font':s.dxf.font,'bigfont':s.dxf.bigfont,'height':s.dxf.height,'width':s.dxf.width,'oblique':s.dxf.oblique},'text':text.dxf.text,'halign':text.dxf.halign,'valign':text.dxf.valign,'mtext':mtext.plain_text(),'attachment':mtext.dxf.attachment_point,'width':mtext.dxf.width,'errors':len(a.errors),'fixes':len(a.fixes)},ensure_ascii=False))
`], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  assert.equal(result.status, 0, result.stderr)
  const audited = JSON.parse(result.stdout)
  assert.deepEqual({ ...audited.style, oblique: Number(audited.style.oblique.toFixed(6)) }, { font: 'NotoSansCJK-Regular.ttc', bigfont: 'hztxt.shx', height: 5, width: .75, oblique: Number((.1 * 180 / Math.PI).toFixed(6)) })
  assert.equal(audited.text, '泵房 Δ 😀'); assert.match(audited.mtext, /第二行 😀/); assert.equal(audited.attachment, 5); assert.equal(audited.width, 60)
  assert.equal(audited.errors + audited.fixes, 0)
  assert.deepEqual(drawing.snapshot().resources.fonts, {})
})

test('TEXTSTYLE conflicts, invalid metrics, embedded-font claims and stale revisions reject atomically', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'text-style-atomic' })
  const first = await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'FIRST', properties: { fontFamily: 'Arial' } }, { document: drawing })
  await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'SECOND', properties: { fontFamily: 'sans-serif' } }, { document: drawing })
  const rejected = [{ operation: 'create', name: ' first ', properties: {} }, { operation: 'update', id: first.id, newName: 'second', properties: {} }, ...[['fixedHeight', -1], ['widthFactor', 0], ['obliqueAngle', Math.PI / 2], ['obliqueAngle', Infinity]].map(([key, value]) => ({ operation: 'update', id: first.id, properties: { [key]: value } })), { operation: 'update', id: first.id, properties: { fontFile: 'data:font/ttf;base64,AAAA' } }, { operation: 'update', id: first.id, properties: { bigFontFile: 'https://example.com/font.shx' } }]
  for (const args of rejected) {
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(sdk.executeCommand('TEXTSTYLE', args, { document: drawing }), KJValidationError)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  }
  const before = drawing.serialize(), history = drawing.history
  await assert.rejects(sdk.executeCommand('TEXTSTYLE', { operation: 'set-current', id: first.id }, { document: drawing, expectedRevision: drawing.revision - 1 }))
  assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history)
})

test('protected text entities reject style and text geometry edits without partial mutation', async t => {
  for (const [reason, protection] of [['locked', { locked: true }], ['hidden', { visible: false }], ['frozen', { frozen: true }]]) await t.test(reason, async () => {
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: `text-style-${reason}` })
    const style = await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'NOTES', properties: { fontFamily: 'Arial' } }, { document: drawing })
    const layer = await sdk.executeCommand('LAYERNEW', { name: `Protected ${reason}` }, { document: drawing })
    const text = await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { ...textPayload('Protected'), layerId: layer.id } }, { document: drawing })
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: protection }, { document: drawing })
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(sdk.executeCommand('PROPERTIES', { id: text.id, patch: { payload: { styleId: style.id, height: 8, rotation: 1 } } }, { document: drawing }), error => error instanceof KJValidationError && error.details?.reason === reason)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  })
})
