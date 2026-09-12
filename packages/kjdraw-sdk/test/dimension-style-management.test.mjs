import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJValidationError } from '../src/errors.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const dimensionPayload = offset => ({ dimensionType: 'ALIGNED', definitionPoints: [[0, 8 + offset, 0], [0, offset, 0], [12.5, offset, 0]] })

test('DIMSTYLE create, edit and current selection preserve old bindings and drive new single and batch dimensions', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'dimension-style-management', units: 'millimeter' })
  const shop = await sdk.executeCommand('DIMSTYLE', { operation: 'create', name: 'SHOP', current: true, properties: { precision: 3, overallScale: 2, textHeight: 1.8, arrowSize: .9, extensionOffset: .35, extensionBeyond: .7 } }, { document: drawing })
  assert.equal(drawing.getTable('dimensionStyles').currentId, shop.id)
  const first = await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload: dimensionPayload(0) }, { document: drawing })
  assert.deepEqual([first.payload.styleId, first.payload.styleName], [shop.id, 'SHOP'])

  const site = await sdk.executeCommand('DIMSTYLE', { operation: 'create', name: 'SITE', current: true, properties: { precision: 1, overallScale: .5, textHeight: 3, arrowSize: 1.5, extensionOffset: 0, extensionBeyond: 2 } }, { document: drawing })
  const second = await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload: dimensionPayload(20) }, { document: drawing })
  const [third] = await sdk.executeCommand('CREATEBATCH', { entities: [{ type: 'DIMENSION', payload: dimensionPayload(40) }] }, { document: drawing })
  assert.deepEqual([second.payload.styleId, third.payload.styleId], [site.id, site.id])

  await sdk.executeCommand('DIMSTYLE', { operation: 'update', id: shop.id, newName: 'SHOP-UPDATED', properties: { precision: 4, overallScale: 2.5, textHeight: 2.2, arrowSize: 1.1, extensionOffset: .4, extensionBeyond: .8 } }, { document: drawing })
  assert.equal(drawing.getObject(first.id).payload.styleId, shop.id)
  assert.equal(drawing.getObject(second.id).payload.styleId, site.id)
  assert.deepEqual(drawing.getObject(shop.id).payload, { decimalPlaces: 4, overallScale: 2.5, textHeight: 2.2, arrowSize: 1.1, extensionOffset: .4, extensionBeyond: .8 })

  await sdk.executeCommand('DIMSTYLE', { operation: 'set-current', id: shop.id }, { document: drawing })
  assert.equal(drawing.getTable('dimensionStyles').currentId, shop.id)
  await sdk.executeCommand('UNDO', {}, { document: drawing }); assert.equal(drawing.getTable('dimensionStyles').currentId, site.id)
  await sdk.executeCommand('REDO', {}, { document: drawing }); assert.equal(drawing.getTable('dimensionStyles').currentId, shop.id)

  const kjd = await sdk.writeDocument(drawing, { format: 'KJD' }), nativeSdk = createKJDrawSDK(), native = await nativeSdk.readDocument(kjd, { format: 'KJD' })
  assert.equal(native.getTable('dimensionStyles').currentId, shop.id)
  assert.deepEqual(native.listEntities({ type: 'DIMENSION' }).map(entity => entity.payload.styleId).sort(), [shop.id, site.id, site.id].sort())

  const dxf = String(await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })), dxfSdk = createKJDrawSDK(), reopened = await dxfSdk.readDocument(dxf, { format: 'DXF' })
  assert.deepEqual(reopened.listEntities({ type: 'DIMENSION' }).map(entity => reopened.getObject(entity.payload.styleId)?.name).sort(), ['SHOP-UPDATED', 'SITE', 'SITE'].sort())
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', String.raw`
import sys,io,json,os,ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH'); source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source)); styles={s.dxf.name.upper():{'precision':s.dxf.dimdec,'scale':s.dxf.dimscale,'height':s.dxf.dimtxt,'arrow':s.dxf.dimasz,'offset':s.dxf.dimexo,'beyond':s.dxf.dimexe} for s in d.dimstyles if s.dxf.name.upper() in ('SHOP-UPDATED','SITE')}; dimensions=[e.dxf.dimstyle for e in d.modelspace().query('DIMENSION')]; a=d.audit(); print(json.dumps({'styles':styles,'dimensions':dimensions,'errors':len(a.errors),'fixes':len(a.fixes)}))
`], dxf, { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  assert.equal(result.status, 0, result.stderr)
  const audited = JSON.parse(result.stdout)
  assert.deepEqual(audited.styles['SHOP-UPDATED'], { precision: 4, scale: 2.5, height: 2.2, arrow: 1.1, offset: .4, beyond: .8 })
  assert.deepEqual(audited.dimensions.sort(), ['SHOP-UPDATED', 'SITE', 'SITE'].sort())
  assert.equal(audited.errors + audited.fixes, 0)
})

test('DIMSTYLE conflicts, invalid ranges and stale revisions reject atomically', async () => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'dimension-style-atomic' })
  const first = await sdk.executeCommand('DIMSTYLE', { operation: 'create', name: 'FIRST', properties: { precision: 2, overallScale: 1, textHeight: 2.5, arrowSize: 2.5, extensionOffset: .625, extensionBeyond: 1.25 } }, { document: drawing })
  await sdk.executeCommand('DIMSTYLE', { operation: 'create', name: 'SECOND', properties: { precision: 3 } }, { document: drawing })
  const rejected = [
    { operation: 'create', name: ' first ', properties: {} },
    { operation: 'update', id: first.id, newName: 'second', properties: {} },
    ...[['precision', -1], ['precision', 9], ['precision', 1.5], ['overallScale', 0], ['textHeight', -1], ['arrowSize', Infinity], ['extensionOffset', -1], ['extensionBeyond', -1]].map(([key, value]) => ({ operation: 'update', id: first.id, properties: { [key]: value } })),
  ]
  for (const args of rejected) {
    const before = drawing.serialize(), history = drawing.history, revision = drawing.revision
    await assert.rejects(sdk.executeCommand('DIMSTYLE', args, { document: drawing }), KJValidationError)
    assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history); assert.equal(drawing.revision, revision)
  }
  const stale = drawing.revision - 1, before = drawing.serialize(), history = drawing.history
  await assert.rejects(sdk.executeCommand('DIMSTYLE', { operation: 'set-current', id: first.id }, { document: drawing, expectedRevision: stale }))
  assert.equal(drawing.serialize(), before); assert.deepEqual(drawing.history, history)
})
