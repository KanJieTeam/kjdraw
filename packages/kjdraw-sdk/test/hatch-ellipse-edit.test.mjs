import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { transformEntityPayload } from '../src/geometry/transform.js'
import { translation3 } from '../src/geometry/matrix3.js'
import { classifyEntityInBox } from '../src/selection-geometry.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const json=value=>JSON.parse(JSON.stringify(value))
const ellipse=(id='ellipse-source',startParameter=0,endParameter=Math.PI*2)=>({id,type:'ELLIPSE',payload:{center:[25,15,0],majorAxis:[6,2,0],ratio:.45,startParameter,endParameter}})
async function fixture(){
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'hatch-ellipse-edit',units:'millimeter'})
  await document.transact('fixture',tx=>{
    tx.createEntity('HATCH',{patternName:'SOLID',solid:true,boundaryLoops:[{external:true,closed:true,vertices:[[0,0],[50,0],[50,30],[0,30]]}]},{id:'hatch'})
    const source=ellipse();tx.createEntity(source.type,source.payload,{id:source.id})
  })
  return {sdk,document}
}

test('HATCHEDIT copies one full ELLIPSE as an exact native island with stable history and KJD identity',async()=>{
  const {sdk,document}=await fixture(),sourceBefore=json(document.getObject('ellipse-source')),hatchBefore=json(document.getObject('hatch'))
  const edited=await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['ellipse-source']},{document})
  const edge=edited.payload.boundaryLoops[1].edges[0]
  assert.deepEqual(edge,{type:'ELLIPSE',center:[25,15,0],majorAxis:[6,2,0],ratio:.45,startAngle:0,endAngle:Math.PI*2,counterClockwise:true})
  assert.deepEqual(json(document.getObject('ellipse-source')),sourceBefore)
  assert.equal(classifyEntityInBox(document,edited,[24.9,14.9,25.1,15.1]),'outside')
  assert.equal(classifyEntityInBox(document,edited,[23.65,18.7,23.75,18.8]),'intersects')
  assert.equal(classifyEntityInBox(document,edited,[30.8,16.8,31.2,17.2]),'intersects')
  await sdk.executeCommand('UNDO',{}, {document});assert.deepEqual(json(document.getObject('hatch')),hatchBefore)
  await sdk.executeCommand('REDO',{}, {document});assert.deepEqual(json(document.getObject('hatch').payload.boundaryLoops[1].edges[0]),edge)
  const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format:'KJD'}),{format:'KJD'})
  assert.deepEqual(json(reopened.getObject('hatch').payload.boundaryLoops[1].edges[0]),edge)
  assert.equal(reopened.getObject('hatch').id,'hatch')
})

test('physical SVG keeps a full hatch ellipse as vector arc commands',async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'ellipse-hatch-svg',units:'millimeter'}),layoutId=document.snapshot().spaces.layoutIds[1],ownerId=document.getObject(layoutId).payload.blockRecordId
  await sdk.executeCommand('PLOTSETUP',{layoutId,dxf:{paperWidth:420,paperHeight:297,paperUnits:1,scaleNumerator:1,scaleDenominator:1,plotType:5,flags:0,marginLeft:10,marginRight:10,marginTop:10,marginBottom:10}},{document})
  await sdk.executeCommand('CREATE',{type:'HATCH',options:{ownerId},payload:{solid:true,boundaryLoops:[{external:true,edges:[{type:'ELLIPSE',center:[100,80,0],majorAxis:[30,10,0],ratio:.4,startAngle:0,endAngle:Math.PI*2,counterClockwise:true}]}]}},{document})
  const output=exportDrawingSvg(document,{layoutId})
  assert.equal(output.report.diagnostics.length,0);assert.equal(output.report.rendered,1);assert.match(output.svg,/data-entity-type="HATCH"[\s\S]* A 31\.622/)
})

test('a native full ELLIPSE outer boundary accepts a strict polygon island and transforms without tessellating',async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'ellipse-outer'}),edge={type:'ELLIPSE',center:[0,0,0],majorAxis:[20,5,0],ratio:.5,startAngle:0,endAngle:Math.PI*2,counterClockwise:true}
  await document.transact('ellipse outer',tx=>tx.createEntity('HATCH',{solid:true,boundaryLoops:[{external:true,closed:true,edges:[edge]}]},{id:'hatch'}))
  await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',vertices:[[-2,-1],[2,-1],[2,1],[-2,1]]},{document})
  assert.equal(document.getObject('hatch').payload.boundaryLoops[0].edges[0].type,'ELLIPSE')
  const moved=transformEntityPayload('HATCH',document.getObject('hatch').payload,translation3(7,-3))
  assert.deepEqual(moved.boundaryLoops[0].edges[0].center,[7,-3,0]);assert.deepEqual(moved.boundaryLoops[0].edges[0].majorAxis,[20,5,0])
})

test('open ellipse arcs, unsafe combinations and protected hatch layers reject atomically',async()=>{
  for(const [start,end,message] of [[0,Math.PI,/open ELLIPSE/],[0,Math.PI*2-1e-5,/open ELLIPSE/]]){
    const {sdk,document}=await fixture();await document.transact('open source',tx=>tx.updateObject('ellipse-source',{payload:{startParameter:start,endParameter:end}}))
    const before=document.serialize();await assert.rejects(sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['ellipse-source']},{document}),message);assert.equal(document.serialize(),before)
  }
  for(const state of [{locked:true,visible:true},{locked:false,visible:false},{locked:false,visible:true,frozen:true}]){
    const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'protected-hatch'})
    await document.transact('protected fixture',tx=>{const layer=tx.upsertTableRecord('layers',{id:'protected',name:'PROTECTED',payload:state});tx.createEntity('HATCH',{layerId:layer.id,solid:true,boundaryLoops:[{vertices:[[0,0],[20,0],[20,20],[0,20]]}]},{id:'hatch'});tx.createEntity('ELLIPSE',{center:[10,10,0],majorAxis:[3,0,0],ratio:.5},{id:'ellipse'})})
    const before=document.serialize();await assert.rejects(sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['ellipse']},{document}),/locked|hidden|frozen/);assert.equal(document.serialize(),before)
  }
})

test('native ELLIPSE hatch edges round-trip through DXF and official ezdxf without repair',async t=>{
  const {sdk,document}=await fixture();await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['ellipse-source']},{document})
  const source=await sdk.writeDocument(document,{format:'DXF',version:'2018'}),reopened=await createKJDrawSDK().readDocument(source,{format:'DXF'}),edge=reopened.listEntities({type:'HATCH'})[0].payload.boundaryLoops[1].edges[0]
  assert.equal(edge.type,'ELLIPSE');assert.deepEqual(edge.center,[25,15,0]);assert.deepEqual(edge.majorAxis,[6,2,0]);assert.equal(edge.ratio,.45);assert.ok(Math.abs(edge.endAngle-Math.PI*2)<1e-10)
  const script=String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));a=d.audit();h=list(d.modelspace().query('HATCH'))[0];e=h.paths[1].edges[0]
print(json.dumps({'edge':type(e).__name__,'center':list(e.center),'axis':list(e.major_axis),'ratio':e.ratio,'start':e.start_angle,'end':e.end_angle,'ccw':e.ccw,'errors':len(a.errors),'fixes':len(a.fixes)}))
`
  const result=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON??'python',['-c',script],source,{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
  if(result.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(result.stderr)){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(result.stderr||result.error.message);t.skip('ezdxf required');return}
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{edge:'EllipseEdge',center:[25,15],axis:[6,2],ratio:.45,start:0,end:360,ccw:true,errors:0,fixes:0})
})
