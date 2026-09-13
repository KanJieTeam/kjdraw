import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'
import { classifyEntityInBox } from '../src/selection-geometry.js'
import { transformEntityPayload } from '../src/geometry/transform.js'
import { translation3 } from '../src/geometry/matrix3.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const json=value=>JSON.parse(JSON.stringify(value)),knots=[0,0,0,.25,.25,.5,.5,.75,.75,1,1,1],weights=[1,Math.SQRT1_2,1,Math.SQRT1_2,1,Math.SQRT1_2,1,Math.SQRT1_2,1]
function conicSpline({center=[30,20],u=[8,3],v=[-1.5,4],closed=true}={}){
  const [x,y]=center,[ux,uy]=u,[vx,vy]=v
  return {degree:2,controlPoints:[[x+ux,y+uy,0],[x+ux+vx,y+uy+vy,0],[x+vx,y+vy,0],[x-ux+vx,y-uy+vy,0],[x-ux,y-uy,0],[x-ux-vx,y-uy-vy,0],[x-vx,y-vy,0],[x+ux-vx,y+uy-vy,0],[x+ux,y+uy,0]],knots,weights,fitPoints:[],periodic:false,closed}
}
async function fixture(){
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'hatch-spline-edit',units:'millimeter'})
  await document.transact('fixture',tx=>{tx.createEntity('HATCH',{solid:true,boundaryLoops:[{external:true,vertices:[[0,0],[60,0],[60,40],[0,40]]}]},{id:'hatch'});tx.createEntity('SPLINE',conicSpline(),{id:'spline'})})
  return {sdk,document}
}

test('HATCHEDIT copies a verified closed rational SPLINE as a native island with stable history and KJD identity',async()=>{
  const {sdk,document}=await fixture(),source=json(document.getObject('spline')),before=json(document.getObject('hatch'))
  const edited=await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['spline']},{document}),edge=edited.payload.boundaryLoops[1].edges[0]
  assert.equal(edge.type,'SPLINE');assert.equal(edge.degree,2);assert.equal(edge.controlPoints.length,9);assert.deepEqual(edge.knots,knots);assert.deepEqual(edge.weights,weights)
  assert.deepEqual(json(document.getObject('spline')),source);assert.equal(classifyEntityInBox(document,edited,[29.9,19.9,30.1,20.1]),'outside');assert.equal(classifyEntityInBox(document,edited,[0.1,0.1,.2,.2]),'intersects')
  await sdk.executeCommand('UNDO',{}, {document});assert.deepEqual(json(document.getObject('hatch')),before)
  await sdk.executeCommand('REDO',{}, {document});assert.equal(document.getObject('hatch').payload.boundaryLoops[1].edges[0].type,'SPLINE')
  const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format:'KJD'}),{format:'KJD'});assert.deepEqual(json(reopened.getObject('hatch')),json(document.getObject('hatch')))
})

test('verified native SPLINE is a usable outer boundary and keeps its spline data under transforms and SVG output',async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'spline-outer',units:'millimeter'}),layoutId=document.snapshot().spaces.layoutIds[1],ownerId=document.getObject(layoutId).payload.blockRecordId,edge={type:'SPLINE',...conicSpline({center:[100,80],u:[30,0],v:[0,15]})}
  await sdk.executeCommand('PLOTSETUP',{layoutId,dxf:{paperWidth:420,paperHeight:297,paperUnits:1,scaleNumerator:1,scaleDenominator:1,plotType:5,flags:0,marginLeft:10,marginRight:10,marginTop:10,marginBottom:10}},{document})
  await sdk.executeCommand('CREATE',{type:'HATCH',options:{ownerId},payload:{solid:true,boundaryLoops:[{external:true,edges:[edge]}]}},{document})
  const hatch=document.listEntities({type:'HATCH'})[0];await sdk.executeCommand('HATCHEDIT',{id:hatch.id,operation:'add-island',vertices:[[98,78],[102,78],[102,82],[98,82]]},{document})
  const moved=transformEntityPayload('HATCH',hatch.payload,translation3(7,-3)),movedEdge=moved.boundaryLoops[0].edges[0]
  assert.equal(movedEdge.type,'SPLINE');assert.deepEqual(movedEdge.controlPoints[0],[137,77,0]);assert.deepEqual(movedEdge.knots,knots);assert.deepEqual(movedEdge.weights,weights)
  const output=exportDrawingSvg(document,{layoutId});assert.equal(output.report.diagnostics.length,0);assert.match(output.svg,/data-entity-type="HATCH"[\s\S]* A 30 15/)
})

test('open, non-conic, fit-point, non-planar and protected SPLINE boundaries fail atomically',async()=>{
  for(const mutate of [
    value=>({...value,closed:false}),value=>({...value,weights:value.weights.map((weight,index)=>index===1?.8:weight)}),value=>({...value,fitPoints:[[30,20,0]]}),value=>({...value,controlPoints:value.controlPoints.map((point,index)=>index===3?[point[0]+2,point[1],0]:point)}),value=>({...value,controlPoints:value.controlPoints.map((point,index)=>index===2?[point[0],point[1],1]:point)}),
  ]){
    const {sdk,document}=await fixture();await document.transact('invalid spline',tx=>tx.updateObject('spline',{payload:mutate(conicSpline())}));const before=document.serialize()
    await assert.rejects(sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['spline']},{document}),/SPLINE|spline/);assert.equal(document.serialize(),before)
  }
  for(const state of [{locked:true,visible:true},{visible:false},{visible:true,frozen:true}]){
    const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'protected-spline-hatch'})
    await document.transact('fixture',tx=>{const layer=tx.upsertTableRecord('layers',{id:'protected',name:'PROTECTED',payload:state});tx.createEntity('HATCH',{layerId:layer.id,solid:true,boundaryLoops:[{vertices:[[0,0],[60,0],[60,40],[0,40]]}]},{id:'hatch'});tx.createEntity('SPLINE',conicSpline(),{id:'spline'})})
    const before=document.serialize();await assert.rejects(sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['spline']},{document}),/locked|hidden|frozen/);assert.equal(document.serialize(),before)
  }
})

test('native SPLINE hatch edge round-trips semantically through DXF and official ezdxf without repair',async t=>{
  const {sdk,document}=await fixture();await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['spline']},{document})
  const source=await sdk.writeDocument(document,{format:'DXF',version:'2018'}),reopened=await createKJDrawSDK().readDocument(source,{format:'DXF'}),edge=reopened.listEntities({type:'HATCH'})[0].payload.boundaryLoops[1].edges[0]
  assert.equal(edge.type,'SPLINE');assert.equal(edge.degree,2);assert.deepEqual(edge.controlPoints,conicSpline().controlPoints);assert.deepEqual(edge.knots,knots);assert.deepEqual(edge.weights,weights);assert.equal(edge.periodic,false)
  const script=String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read();d=ezdxf.read(io.StringIO(source));a=d.audit();h=list(d.modelspace().query('HATCH'))[0];e=h.paths[1].edges[0]
print(json.dumps({'edge':type(e).__name__,'degree':e.degree,'rational':e.rational,'periodic':e.periodic,'control':len(e.control_points),'knots':len(e.knot_values),'weights':len(e.weights),'fit':len(e.fit_points),'errors':len(a.errors),'fixes':len(a.fixes)}))
`
  const result=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON??'python',['-c',script],source,{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
  if(result.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(result.stderr)){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(result.stderr||result.error.message);t.skip('ezdxf required');return}
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{edge:'SplineEdge',degree:2,rational:1,periodic:0,control:9,knots:12,weights:9,fit:0,errors:0,fixes:0})
})
