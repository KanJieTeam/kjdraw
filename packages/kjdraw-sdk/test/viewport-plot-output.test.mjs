import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'

async function fixture() {
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'}),model=drawing.spaces.modelSpaceId
  let noPlot,visible,noPrint,paperText,paperNoPrint,viewport,layout
  await drawing.transact('production viewport layers',tx=>{
    const continuous=drawing.getTable('linetypes').records.find(record=>record.name==='CONTINUOUS').id
    noPlot=tx.upsertTableRecord('layers',{name:'VP-NOPLOT',type:'LAYER',payload:{color:3,linetypeId:continuous,visible:true,plottable:false}})
    visible=tx.createEntity('LINE',{start:[-100,0],end:[100,0],trueColor:0x0000ff},{ownerId:model})
    noPrint=tx.createEntity('LINE',{start:[0,-100],end:[0,100],trueColor:0xff0000,layerId:noPlot.id},{ownerId:model})
    layout=tx.createLayout({name:'Production sheet'})
    viewport=tx.createEntity('VIEWPORT',{center:[50,50,0],width:40,height:20,viewCenter:[0,0,0],viewHeight:20,twistAngle:0,viewTarget:[0,0,0],viewDirection:[0,0,1],flags:16384,layerId:noPlot.id},{ownerId:layout.payload.blockRecordId})
    tx.updateObject(layout.id,{payload:{viewportIds:[viewport.id]}})
    paperText=tx.createEntity('TEXT',{position:[10,10,0],text:'PAPER NOTE',height:3},{ownerId:layout.payload.blockRecordId})
    paperNoPrint=tx.createEntity('LINE',{start:[5,70],end:[95,70],trueColor:0xff0000,layerId:noPlot.id},{ownerId:layout.payload.blockRecordId})
  })
  await sdk.executeCommand('PAGESETUP',{layoutId:layout.id,dxf:{paperWidth:100,paperHeight:100,paperUnits:1,plotType:5,flags:0,scaleNumerator:1,scaleDenominator:1,marginLeft:0,marginRight:0,marginTop:0,marginBottom:0,originX:0,originY:0,printerName:'',styleSheet:'',shadeMode:0}},{document:drawing})
  return {sdk,drawing,noPlot,visible,noPrint,paperText,paperNoPrint,viewport,layout}
}

test('no-plot viewport layer suppresses only its frame while SVG retains clipped model and paper output',async()=>{
  const f=await fixture(),before=f.drawing.serialize(),history=f.drawing.history
  const svg=exportDrawingSvg(f.drawing,{layoutId:f.layout.id})
  assert.match(svg.svg,new RegExp(`data-entity-id="${f.visible.id}"`));assert.match(svg.svg,new RegExp(`data-entity-id="${f.paperText.id}"`))
  assert.doesNotMatch(svg.svg,new RegExp(`data-entity-id="${f.noPrint.id}"|data-entity-id="${f.paperNoPrint.id}"`))
  assert.equal((svg.svg.match(/<rect\b/g)??[]).length,2)
  assert.equal(svg.report.viewports.length,1);assert.equal(svg.report.hidden,2);assert.equal(svg.report.diagnostics.length,0)
  assert.equal(f.drawing.serialize(),before);assert.deepEqual(f.drawing.history,history)
  await f.drawing.transact('plot viewport frame',tx=>tx.updateObject(f.noPlot.id,{payload:{plottable:true}}))
  assert.equal((exportDrawingSvg(f.drawing,{layoutId:f.layout.id}).svg.match(/<rect\b/g)??[]).length,3)
  await f.sdk.executeCommand('UNDO',{}, {document:f.drawing});assert.equal((exportDrawingSvg(f.drawing,{layoutId:f.layout.id}).svg.match(/<rect\b/g)??[]).length,2)
  await f.sdk.executeCommand('REDO',{}, {document:f.drawing});assert.equal((exportDrawingSvg(f.drawing,{layoutId:f.layout.id}).svg.match(/<rect\b/g)??[]).length,3)
  await f.sdk.executeCommand('UNDO',{}, {document:f.drawing})
  const kjd=await createKJDrawSDK().readDocument(await f.sdk.writeDocument(f.drawing,{format:'KJD'}),{format:'KJD'})
  assert.equal(exportDrawingSvg(kjd,{layoutId:f.layout.id}).report.viewports.length,1)
})

test('locked native viewport and no-plot layers survive DXF; off and unsupported views never expose model content',async t=>{
  const f=await fixture(),dxf=await f.sdk.writeDocument(f.drawing,{format:'DXF',version:'2018'})
  const reopened=await createKJDrawSDK().readDocument(dxf,{format:'DXF'}),layout=reopened.listObjects({kind:'layout'}).find(item=>item.name==='Production sheet')
  const output=exportDrawingSvg(reopened,{layoutId:layout.id})
  assert.equal(output.report.viewports.length,1);assert.equal(output.report.hidden,2)
  const script=String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
d=ezdxf.read(io.StringIO(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read()));a=d.audit();p=d.layouts.get('Production sheet');v=[e for e in p.query('VIEWPORT') if e.dxf.id!=1][0]
print(json.dumps({'flags':v.dxf.flags,'layer':v.dxf.layer,'plottable':bool(d.layers.get(v.dxf.layer).dxf.plot),'errors':len(a.errors),'fixes':len(a.fixes)}))
`
  const result=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON??'python',['-c',script],dxf,{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
  if(result.error?.code==='ENOENT'||/No module named ['"]ezdxf/.test(result.stderr)){if(process.env.KJDRAW_REQUIRE_DXF_INTEGRATION==='1')assert.fail(result.stderr||result.error.message);t.skip('ezdxf required');return}
  assert.equal(result.status,0,result.stderr||result.error?.message);assert.deepEqual(JSON.parse(result.stdout),{flags:16384,layer:'VP-NOPLOT',plottable:false,errors:0,fixes:0})
  await f.sdk.executeCommand('VIEWPORT',{operation:'update',id:f.viewport.id,patch:{status:0}},{document:f.drawing})
  const off=exportDrawingSvg(f.drawing,{layoutId:f.layout.id});assert.equal(off.report.viewports.length,0);assert.doesNotMatch(off.svg,new RegExp(`data-entity-id="${f.visible.id}"`))
  await f.sdk.executeCommand('UNDO',{}, {document:f.drawing});assert.equal(exportDrawingSvg(f.drawing,{layoutId:f.layout.id}).report.viewports.length,1)
  const stable=f.drawing.getObject(f.viewport.id).payload;await f.sdk.executeCommand('VIEWPORT',{operation:'update',id:f.viewport.id,patch:{flags:16385}},{document:f.drawing})
  assert.throws(()=>exportDrawingSvg(f.drawing,{layoutId:f.layout.id}),/visible geometry could not be represented/)
  const partial=exportDrawingSvg(f.drawing,{layoutId:f.layout.id,allowPartial:true});assert.equal(partial.report.diagnostics[0].entityId,f.viewport.id);assert.doesNotMatch(partial.svg,new RegExp(`data-entity-id="${f.visible.id}"`))
  await f.sdk.executeCommand('UNDO',{}, {document:f.drawing});assert.deepEqual(f.drawing.getObject(f.viewport.id).payload,stable)
})
