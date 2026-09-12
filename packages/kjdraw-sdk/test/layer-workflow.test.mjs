import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { KJValidationError, createKJDrawSDK } from '../src/index.js'

test('layer workflow preserves identity, current layer and batch ByLayer properties across history and reopen', async () => {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'layer-workflow'})
  const dashed=await sdk.executeCommand('LINETYPE',{name:'KJ-DASH',pattern:[4,-2]})
  const revision=document.revision
  const layer=await sdk.executeCommand('LAYERNEW',{name:'FAB',color:3,linetypeId:dashed.id,lineweight:35,visible:true,locked:false,frozen:false,current:true})
  assert.equal(document.revision,revision+1)
  assert.equal(document.getTable('layers').currentId,layer.id)
  await sdk.executeCommand('UNDO');assert.equal(document.getObject(layer.id),null);assert.notEqual(document.getTable('layers').currentId,layer.id)
  await sdk.executeCommand('REDO');assert.equal(document.getObject(layer.id).handle,layer.handle);assert.equal(document.getTable('layers').currentId,layer.id)
  const line=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0,2],end:[10,0,2]}})
  const circle=await sdk.executeCommand('CREATE',{type:'CIRCLE',payload:{center:[5,5,2],radius:2}})
  assert.equal(line.payload.layerId,layer.id)
  const layerIdentity=[layer.id,layer.handle]
  await sdk.executeCommand('LAYERUPDATE',{id:layer.id,newName:'FAB-REVIEW',patch:{color:5,linetypeId:dashed.id,lineweight:50},current:true})
  assert.deepEqual([document.getObject(layer.id).id,document.getObject(layer.id).handle],layerIdentity)
  const before=document.revision
  await sdk.executeCommand('PROPERTIES',{ids:[line.id,circle.id],patch:{payload:{layerId:layer.id,color:256,trueColor:null,linetypeId:null,linetypeName:'BYLAYER',lineweight:-1}}})
  assert.equal(document.revision,before+1)
  for(const source of [line,circle]){const entity=document.getObject(source.id);assert.equal(entity.handle,source.handle);assert.equal(entity.payload.color,256);assert.equal(entity.payload.linetypeName,'BYLAYER');assert.equal(entity.payload.lineweight,-1)}
  await sdk.executeCommand('UNDO');assert.equal(document.getObject(line.id).payload.color,undefined)
  await sdk.executeCommand('REDO');assert.equal(document.getObject(line.id).payload.color,256);assert.equal(document.getObject(circle.id).payload.lineweight,-1)
  const bytes=await sdk.writeDocument(document,{format:'KJD'}),reopened=await createKJDrawSDK().readDocument(bytes,{format:'KJD'})
  assert.equal(reopened.getTable('layers').currentId,layer.id)
  assert.equal(reopened.getObject(layer.id).name,'FAB-REVIEW')
  assert.equal(reopened.getObject(line.id).payload.color,256)
})

test('layer workflow validates names and styles atomically and protects layer destinations', async () => {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'layer-validation'})
  const layer=await sdk.executeCommand('LAYERNEW',{name:'PROTECTED',color:2})
  const line=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0],end:[1,0]}})
  await sdk.executeCommand('LAYERUPDATE',{id:layer.id,patch:{locked:true}})
  const before=document.serialize()
  for(const args of [
    {name:'protected'}, {name:'bad/name'}, {name:'BAD-COLOR',color:0}, {name:'BAD-WEIGHT',lineweight:17}, {name:'BAD-TYPE',linetypeId:'missing'},
  ]){await assert.rejects(sdk.executeCommand('LAYERNEW',args),KJValidationError);assert.equal(document.serialize(),before)}
  await assert.rejects(sdk.executeCommand('LAYERUPDATE',{id:document.getTable('layers').records.find(item=>item.name==='0').id,newName:'ZERO',patch:{}}),/Layer 0/)
  await assert.rejects(sdk.executeCommand('LAYERUPDATE',{id:layer.id,patch:{visible:'no'}}),KJValidationError)
  await assert.rejects(sdk.executeCommand('PROPERTIES',{id:line.id,patch:{payload:{layerId:layer.id}}}),/locked/)
  assert.equal(document.serialize(),before)
})

test('layer and entity ByLayer state round-trip through DXF and independent ezdxf', async t => {
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'layer-dxf'})
  const dashed=await sdk.executeCommand('LINETYPE',{name:'KJ-DASH',pattern:[4,-2]})
  const layer=await sdk.executeCommand('LAYERNEW',{name:'QA-LAYER',color:5,linetypeId:dashed.id,lineweight:50,current:true})
  await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0],end:[10,0],color:256,linetypeName:'BYLAYER',lineweight:-1}})
  await sdk.executeCommand('LAYERUPDATE',{id:layer.id,patch:{locked:true,frozen:true,visible:false}})
  const bytes=await sdk.writeDocument(document,{format:'DXF',version:'2018'}),dxf=typeof bytes==='string'?bytes:new TextDecoder().decode(bytes)
  const reopened=await createKJDrawSDK().readDocument(bytes,{format:'DXF'})
  const imported=reopened.getTable('layers').records.find(item=>item.name==='QA-LAYER')
  assert.equal(imported.payload.color,5);assert.equal(imported.payload.lineweight,50);assert.equal(imported.payload.locked,true);assert.equal(imported.payload.frozen,true);assert.equal(imported.payload.visible,false)
  const python=process.env.KJDRAW_PYTHON??'python'
  const script='import io,json,ezdxf,sys,os; p=os.environ.get("KJDRAW_FILE_STDIN_PATH"); s=open(p,encoding="utf-8").read() if p else sys.stdin.read(); d=ezdxf.read(io.StringIO(s)); a=d.audit(); l=d.layers.get("QA-LAYER"); e=list(d.modelspace().query("LINE"))[0]; print(json.dumps({"layer":{"color":l.color,"linetype":l.dxf.linetype,"lineweight":l.dxf.lineweight,"off":l.is_off(),"frozen":l.is_frozen(),"locked":l.is_locked()},"entity":{"layer":e.dxf.layer,"color":e.dxf.color,"linetype":e.dxf.linetype,"lineweight":e.dxf.lineweight},"errors":len(a.errors),"fixes":len(a.fixes)}))'
  const result=spawnSyncWithFileStdin(python,['-c',script],dxf,{encoding:'utf8',windowsHide:true})
  if(result.error?.code==='ENOENT'||result.status!==0&&/No module named ['"]ezdxf/.test(result.stderr)){t.skip('Independent ezdxf runtime is unavailable');return}
  assert.equal(result.status,0,result.stderr)
  const value=JSON.parse(result.stdout);assert.deepEqual(value.layer,{color:5,linetype:'KJ-DASH',lineweight:50,off:true,frozen:true,locked:true});assert.deepEqual(value.entity,{layer:'QA-LAYER',color:256,linetype:'BYLAYER',lineweight:-1});assert.deepEqual([value.errors,value.fixes],[0,0])
})
