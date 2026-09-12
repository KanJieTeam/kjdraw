import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { KJCanvasRenderer } from '../src/canvas-renderer.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'

class RecordingContext2D {
  calls = []
  fillStyle = ''
  strokeStyle = ''
  font = ''
  textBaseline = ''
  lineWidth = 1
  lineDash = []
  globalAlpha = 1
  #record(name, ...args) { this.calls.push([name, ...args]) }
  setTransform(...args) { this.#record('setTransform', ...args) }
  transform(...args) { this.#record('transform', ...args) }
  measureText(value) { return { width: String(value).length * 7, actualBoundingBoxAscent: 9 } }
  clearRect(...args) { this.#record('clearRect', ...args) }
  fillRect(...args) { this.#record('fillRect', ...args) }
  beginPath() { this.#record('beginPath') }
  moveTo(...args) { this.#record('moveTo', ...args) }
  lineTo(...args) { this.#record('lineTo', ...args) }
  closePath() { this.#record('closePath') }
  stroke() { this.#record('stroke', this.lineDash) }
  fill(...args) { this.#record('fill', ...args) }
  clip(...args) { this.#record('clip', ...args) }
  arc(...args) { this.#record('arc', ...args) }
  ellipse(...args) { this.#record('ellipse', ...args) }
  save() { this.#record('save') }
  restore() { this.#record('restore') }
  translate(...args) { this.#record('translate', ...args) }
  rotate(...args) { this.#record('rotate', ...args) }
  fillText(...args) { this.#record('fillText', ...args) }
  strokeRect(...args) { this.#record('strokeRect', ...args) }
  setLineDash(value) { this.lineDash = [...value]; this.#record('setLineDash', value) }
}

function renderer(document, spaceId = document.spaces.modelSpaceId) {
  const context = new RecordingContext2D()
  const canvas = {
    width: 400, height: 200, clientWidth: 400, clientHeight: 200,
    getContext: kind => kind === '2d' ? context : null,
    getBoundingClientRect: () => ({ width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200 }),
  }
  const result = new KJCanvasRenderer(canvas, { document, spaceId, grid: false, pixelRatio: 1 })
  Object.assign(result.camera, { centerX: 50, centerY: 25, scale: 2 })
  context.calls.length = 0
  return { renderer: result, context }
}

async function resources(document) {
  let layer, linetype
  await document.transact('Dashed drawing resources', tx => {
    linetype = tx.upsertTableRecord('linetypes', { name: 'TEST_DASH', type: 'LINETYPE', payload: { pattern: [3, -1] } })
    layer = tx.upsertTableRecord('layers', { name: 'DASHED', type: 'LAYER', payload: { color: 2, linetypeId: linetype.id, visible: true, plottable: true } })
  })
  return { layer, linetype }
}

test('Canvas composes LTSCALE, entity scale and uniform block/viewport geometry scale exactly', async () => {
  for (const [scenario, expected] of [['model', [36, 12]], ['block', [72, 24]], ['viewport', [3.6, 1.2]]]) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ systemVariables: { LTSCALE: 4 } })
    const { layer } = await resources(document)
    let spaceId = document.spaces.modelSpaceId
    if (scenario === 'model') {
      await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [100, 0], layerId: layer.id, linetypeScale: 1.5 } }, { document })
    } else if (scenario === 'block') {
      await document.transact('Scaled dashed block', tx => {
        const block = tx.upsertTableRecord('blockRecords', { name: 'DASH_BLOCK', type: 'BLOCK_RECORD', payload: { basePoint: [0, 0, 0], isSpace: false } })
        tx.createEntity('LINE', { start: [0, 0], end: [40, 0], layerId: layer.id, linetypeScale: 1.5 }, { ownerId: block.id })
        tx.createEntity('INSERT', { blockRecordId: block.id, position: [0, 0], scale: [2, 2, 1] })
      })
    } else {
      await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [100, 0], layerId: layer.id, linetypeScale: 1.5 } }, { document })
      const layoutId = document.spaces.layoutIds.find(id => document.getObject(id)?.name !== 'Model')
      await sdk.executeCommand('VIEWPORT', { layoutId, center: [100, 50], width: 100, height: 50, viewCenter: [0, 0], viewHeight: 500 }, { document })
      spaceId = document.getObject(layoutId).payload.blockRecordId
    }
    const view = renderer(document, spaceId)
    const report = view.renderer.render()
    const actual = view.context.calls.filter(call => call[0] === 'setLineDash' && call[1].length).map(call => call[1])
    assert.equal(actual.length, 1, scenario)
    actual[0].forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12, scenario))
    assert.equal(report.unsupported, 0, scenario)
    view.renderer.dispose()
  }
})

test('Canvas refuses a false dash scale for nonuniform block geometry', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ systemVariables: { LTSCALE: 2 } })
  const { layer } = await resources(document)
  await document.transact('Nonuniform dashed block', tx => {
    const block = tx.upsertTableRecord('blockRecords', { name: 'NONUNIFORM', type: 'BLOCK_RECORD', payload: { basePoint: [0, 0, 0], isSpace: false } })
    tx.createEntity('LINE', { start: [0, 0], end: [20, 0], layerId: layer.id }, { ownerId: block.id })
    tx.createEntity('INSERT', { blockRecordId: block.id, position: [0, 0], scale: [2, 3, 1] })
  })
  const view = renderer(document)
  const report = view.renderer.render()
  assert.equal(report.unsupported, 1)
  assert.equal(view.context.calls.some(call => call[0] === 'setLineDash' && call[1].length), false)
  view.renderer.dispose()
})

test('SVG keeps native dash lengths in entity space so page, block and viewport transforms scale geometry and phase together', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ systemVariables: { LTSCALE: 4 } })
  const { layer } = await resources(document)
  const layoutId = document.spaces.layoutIds.find(id => document.getObject(id)?.name !== 'Model')
  const paperId = document.getObject(layoutId).payload.blockRecordId
  await sdk.executeCommand('PLOTSETUP', { layoutId, dxf: { paperWidth: 420, paperHeight: 297, paperUnits: 1, scaleNumerator: 1, scaleDenominator: 1, plotType: 5, flags: 0 } }, { document })
  let direct, child
  await document.transact('SVG dash scale cases', tx => {
    direct = tx.createEntity('LINE', { start: [0, 0], end: [100, 0], layerId: layer.id, linetypeScale: 1.5 }, { ownerId: paperId })
    const block = tx.upsertTableRecord('blockRecords', { name: 'SVG_DASH_BLOCK', type: 'BLOCK_RECORD', payload: { basePoint: [0, 0, 0], isSpace: false } })
    child = tx.createEntity('LINE', { start: [0, 0], end: [20, 0], layerId: layer.id, linetypeScale: 1.5 }, { ownerId: block.id })
    tx.createEntity('INSERT', { blockRecordId: block.id, position: [20, 20], scale: [2, 2, 1] }, { ownerId: paperId })
    tx.createEntity('LINE', { start: [0, 0], end: [100, 0], layerId: layer.id, linetypeScale: 1.5 })
  })
  const viewport = await sdk.executeCommand('VIEWPORT', { layoutId, center: [100, 100], width: 100, height: 50, viewCenter: [0, 0], viewHeight: 500 }, { document })
  const svg = exportDrawingSvg(document, { layoutId }).svg
  assert.match(svg, new RegExp(`data-entity-id="${direct.id}"[^>]*stroke-dasharray="18 6"`))
  assert.match(svg, new RegExp(`matrix\\(2 0 0 2 [^)]*\\)"[^>]*><g data-entity-id="${child.id}"[^>]*stroke-dasharray="18 6"`))
  assert.match(svg, new RegExp(`data-entity-id="${viewport.id}"[\\s\\S]*matrix\\(0\\.1 0 0 0\\.1 [^)]*\\)"[\\s\\S]*stroke-dasharray="18 6"`))
})

test('DXF preserves global LTSCALE and rejects invalid global or entity scales', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ systemVariables: { LTSCALE: 2.5 } })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0], linetypeScale: 1.25 } }, { document })
  const adapter = createDXFFileAdapter()
  for (const version of ['R12', '2018']) {
    const dxf = await adapter.write(document, { version })
    assert.match(dxf, /\r\n9\r\n\$LTSCALE\r\n40\r\n2\.5\r\n/)
    const reopened = await adapter.read(dxf)
    assert.equal(reopened.snapshot().header.systemVariables.LTSCALE, 2.5)
    assert.equal(reopened.listEntities()[0].payload.linetypeScale, 1.25)
  }
  const valid = await adapter.write(document, { version: '2018' })
  const missing = valid.replace(/\r\n9\r\n\$LTSCALE\r\n40\r\n2\.5/, '')
  assert.equal((await adapter.read(missing)).snapshot().header.systemVariables.LTSCALE, 1)
  await assert.rejects(adapter.read(valid.replace(/(\$LTSCALE\r\n40\r\n)2\.5/, '$1' + '0')), /Invalid DXF \$LTSCALE/)
  await document.transact('Change global linetype scale', tx => tx.setSystemVariable('LTSCALE', 5))
  await document.undo()
  assert.equal(document.snapshot().header.systemVariables.LTSCALE, 2.5)
  await document.redo()
  assert.equal(document.snapshot().header.systemVariables.LTSCALE, 5)
  const kjd = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.equal(kjd.snapshot().header.systemVariables.LTSCALE, 5)
  assert.throws(() => sdk.createDocument({ systemVariables: { LTSCALE: 0 } }), error => error.details?.some(issue => issue.path === 'header.systemVariables.LTSCALE'))
  await assert.rejects(sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [1, 0], linetypeScale: 0 } }, { document }), /linetypeScale/)
})

test('PROPERTIES rejects invalid entity scale and linetype references atomically', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const first = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0] } }, { document })
  const second = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 5], end: [10, 5] } }, { document })
  const before = document.serialize()
  const revision = document.revision
  for (const value of [0, -1, Number.NaN, '2']) {
    await assert.rejects(
      sdk.executeCommand('PROPERTIES', { ids: [first.id, second.id], patch: { payload: { linetypeScale: value } } }, { document }),
      /linetypeScale must be positive and finite/,
    )
    assert.equal(document.serialize(), before)
    assert.equal(document.revision, revision)
  }
  await assert.rejects(
    sdk.executeCommand('PROPERTIES', { ids: [first.id, second.id], patch: { payload: { linetypeId: 'missing-linetype' } } }, { document }),
    /linetypes record does not exist/,
  )
  assert.equal(document.serialize(), before)
  assert.equal(document.revision, revision)
})

test('KJD and DXF preserve inherited block properties and linetype scales for independent ezdxf', async t => {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({systemVariables:{LTSCALE:3}})
  const dash=await sdk.executeCommand('LINETYPE',{name:'SCALE-DASH',pattern:[4,-2]})
  const layer=await sdk.executeCommand('LAYERNEW',{name:'SCALE-LAYER',color:2,linetypeId:dash.id,lineweight:50,current:true})
  const direct=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0],end:[20,0],color:256,linetypeName:'BYLAYER',lineweight:-1,linetypeScale:2}})
  let child,insert
  await document.transact('Inherited block properties',tx=>{const zero=document.getTable('layers').records.find(item=>item.name==='0');const block=tx.upsertTableRecord('blockRecords',{name:'SCALE-BLOCK',type:'BLOCK_RECORD',payload:{basePoint:[0,0,0],isSpace:false}});child=tx.createEntity('LINE',{start:[0,0],end:[10,0],layerId:zero.id,color:0,linetypeName:'BYBLOCK',lineweight:-2,linetypeScale:1.25},{ownerId:block.id});insert=tx.createEntity('INSERT',{blockRecordId:block.id,position:[30,0],scale:[2,2,1],layerId:layer.id,color:256,linetypeName:'BYLAYER',lineweight:-1})})
  await sdk.executeCommand('MOVE',{ids:[direct.id],dx:2,dy:3});assert.equal(document.getObject(direct.id).payload.linetypeScale,2)
  const kjd=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format:'KJD'}),{format:'KJD'});assert.equal(kjd.snapshot().header.systemVariables.LTSCALE,3);assert.equal(kjd.getObject(child.id).payload.linetypeScale,1.25)
  const bytes=await sdk.writeDocument(document,{format:'DXF',version:'2018'}),dxf=typeof bytes==='string'?bytes:new TextDecoder().decode(bytes)
  const reopened=await createKJDrawSDK().readDocument(bytes,{format:'DXF'});assert.equal(reopened.snapshot().header.systemVariables.LTSCALE,3);assert.equal(reopened.listEntities({type:'LINE',ownerId:reopened.spaces.modelSpaceId})[0].payload.linetypeScale,2)
  const script='import io,json,ezdxf,sys,os; p=os.environ.get("KJDRAW_FILE_STDIN_PATH"); s=open(p,encoding="utf-8").read() if p else sys.stdin.read(); d=ezdxf.read(io.StringIO(s)); a=d.audit(); e=list(d.modelspace().query("LINE"))[0]; i=list(d.modelspace().query("INSERT"))[0]; c=list(d.blocks.get("SCALE-BLOCK").query("LINE"))[0]; l=d.layers.get("SCALE-LAYER"); print(json.dumps({"global":d.header["$LTSCALE"],"direct":[e.dxf.layer,e.dxf.color,e.dxf.linetype,e.dxf.lineweight,e.dxf.ltscale],"insert":[i.dxf.layer,i.dxf.color,i.dxf.linetype,i.dxf.lineweight],"child":[c.dxf.layer,c.dxf.color,c.dxf.linetype,c.dxf.lineweight,c.dxf.ltscale],"layer":[l.color,l.dxf.linetype,l.dxf.lineweight],"errors":len(a.errors),"fixes":len(a.fixes)}))'
  const result=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON??'python',['-c',script],dxf,{encoding:'utf8',windowsHide:true})
  if(result.error?.code==='ENOENT'||result.status!==0&&/No module named ['"]ezdxf/.test(result.stderr)){t.skip('Independent ezdxf runtime is unavailable');return}
  assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);assert.equal(value.global,3);assert.deepEqual(value.direct,['SCALE-LAYER',256,'BYLAYER',-1,2]);assert.deepEqual(value.insert,['SCALE-LAYER',256,'BYLAYER',-1]);assert.deepEqual(value.child,['0',0,'BYBLOCK',-2,1.25]);assert.deepEqual(value.layer,[2,'SCALE-DASH',50]);assert.deepEqual([value.errors,value.fixes],[0,0])
})
