import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { createDraftingSession } from '../src/drafting.js'
import { projectDimension } from '../src/geometry/annotation.js'
import { KJValidationError } from '../src/errors.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

async function fixture(id = 'dimension-format-controls') {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: id, units: 'millimeter' })
  const style = await sdk.executeCommand('DIMSTYLE', { name: 'ISO-DETAIL', properties: { overallScale: 2, textHeight: 1.5, arrowSize: .8, extensionOffset: .3, extensionBeyond: .6, decimalPlaces: 3 } }, { document: drawing })
  const source = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [12.34567, 0, 0] } }, { document: drawing })
  const draft = createDraftingSession('dimension', { dimensionType: 'ALIGNED', styleId: style.id, styleName: style.name, precision: 3, overallScale: 2, textHeight: 1.5, textOverride: 'CL <> TYP' })
  draft.addPoint([0, 0], { entityId: source.id, feature: 'start' })
  draft.addPoint([12.34567, 0], { entityId: source.id, feature: 'end' })
  const spec = draft.addPoint([6, 5])
  const dimension = await sdk.executeCommand('CREATE', spec, { document: drawing })
  return { sdk, drawing, style, source, dimension }
}

test('draft and property format controls preserve associative dimensions through undo and native reopen', async () => {
  const { sdk, drawing, style, source, dimension } = await fixture()
  const association = structuredClone(dimension.payload.dimensionAssociations)
  assert.deepEqual({ styleId: dimension.payload.styleId, styleName: dimension.payload.styleName, precision: dimension.payload.precision, overallScale: dimension.payload.overallScale, textHeight: dimension.payload.textHeight, textOverride: dimension.payload.textOverride }, { styleId: style.id, styleName: 'ISO-DETAIL', precision: 3, overallScale: 2, textHeight: 1.5, textOverride: 'CL <> TYP' })
  assert.equal(projectDimension(dimension.payload, style.payload).label.text, 'CL 12.346 TYP')

  const revision = drawing.revision
  await sdk.executeCommand('PROPERTIES', { id: dimension.id, patch: { payload: { styleId: style.id, styleName: style.name, precision: 4, overallScale: 1.25, textHeight: 2.25, textOverride: 'REF <> MAX' } } }, { document: drawing })
  assert.equal(drawing.revision, revision + 1)
  const edited = drawing.getObject(dimension.id)
  assert.deepEqual(edited.payload.dimensionAssociations, association)
  assert.equal(projectDimension(edited.payload, style.payload).label.text, 'REF 12.3457 MAX')
  await sdk.executeCommand('UNDO', {}, { document: drawing })
  assert.equal(drawing.getObject(dimension.id).payload.textOverride, 'CL <> TYP')
  await sdk.executeCommand('REDO', {}, { document: drawing })
  assert.equal(drawing.getObject(dimension.id).payload.textOverride, 'REF <> MAX')

  for (const format of ['KJD', 'DXF']) {
    const content = await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopenedSdk = createKJDrawSDK(), reopened = await reopenedSdk.readDocument(content, { format })
    const reopenedDimension = reopened.listEntities({ type: 'DIMENSION' })[0]
    if (format === 'KJD') assert.deepEqual(reopenedDimension.payload.dimensionAssociations, association)
    else assert.equal(new Set(reopenedDimension.payload.dimensionAssociations.map(reference => reference.entityId)).size, 1)
    assert.deepEqual({ precision: reopenedDimension.payload.precision, overallScale: reopenedDimension.payload.overallScale, textHeight: reopenedDimension.payload.textHeight, textOverride: reopenedDimension.payload.textOverride }, { precision: 4, overallScale: 1.25, textHeight: 2.25, textOverride: 'REF <> MAX' })
    const reopenedSource = reopened.getObject(reopenedDimension.payload.dimensionAssociations[0].entityId)
    assert.equal(reopenedSource.type, 'LINE')
    await reopenedSdk.executeCommand('GRIPEDIT', { id: reopenedSource.id, gripId: 'end', point: [20, 0, 0] }, { document: reopened })
    assert.equal(projectDimension(reopened.getObject(reopenedDimension.id).payload, reopened.getObject(reopenedDimension.payload.styleId)?.payload).label.text, 'REF 20 MAX')
  }

  const dxf = String(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }))
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import sys,io,json,os,ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH'); source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source)); e=list(d.modelspace().query('DIMENSION'))[0]; o=e.override()
before={'style':e.dxf.dimstyle,'text':e.dxf.text,'precision':o.get('dimdec'),'scale':o.get('dimscale'),'height':o.get('dimtxt'),'measurement':e.get_measurement()}
o.render(); labels=[x.dxf.text for x in e.virtual_entities() if x.dxftype() in ('TEXT','MTEXT')]
a=d.audit(); print(json.dumps({'before':before,'labels':labels,'errors':len(a.errors),'fixes':len(a.fixes)}))
`], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  assert.equal(result.status, 0, result.stderr)
  const native = JSON.parse(result.stdout)
  assert.deepEqual(native.before, { style: 'ISO-DETAIL', text: 'REF <> MAX', precision: 4, scale: 1.25, height: 2.25, measurement: 12.34567 })
  assert.ok(native.labels.includes('REF 12.3457 MAX'), JSON.stringify(native))
  assert.equal(native.errors + native.fixes, 0)
  assert.ok(drawing.getObject(source.id))
})

test('invalid, cancelled and protected dimension format edits never partially mutate a drawing', async t => {
  for (const options of [{ precision: 1.5 }, { precision: 9 }, { overallScale: 0 }, { textHeight: -1 }]) assert.throws(() => createDraftingSession('dimension', options), KJValidationError)
  const cancelled = createDraftingSession('dimension', { precision: 2, overallScale: 1, textHeight: 2 })
  cancelled.addPoint([0, 0]); cancelled.cancel(); assert.equal(cancelled.state.status, 'cancelled')

  for (const [reason, protection] of [['locked', { locked: true }], ['hidden', { visible: false }], ['frozen', { frozen: true }]]) await t.test(reason, async () => {
    const { sdk, drawing, dimension } = await fixture('dimension-format-' + reason)
    const layer = await sdk.executeCommand('LAYERNEW', { name: 'Protected dimensions ' + reason }, { document: drawing })
    await sdk.executeCommand('PROPERTIES', { id: dimension.id, patch: { payload: { layerId: layer.id } } }, { document: drawing })
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: protection }, { document: drawing })
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(sdk.executeCommand('PROPERTIES', { id: dimension.id, patch: { payload: { precision: 5, overallScale: 3, textHeight: 4, textOverride: 'BLOCKED <>' } } }, { document: drawing }), error => error instanceof KJValidationError && error.details?.policy === 'layer-editability' && error.details?.reason === reason)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  })
})
