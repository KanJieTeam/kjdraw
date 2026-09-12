import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const outer=[[0,0],[40,0],[40,30],[0,30]]
const islandA=[[5,5],[12,5],[12,12],[5,12]]
const islandB=[[22,8],[32,8],[32,18],[22,18]]
const json=value=>JSON.parse(JSON.stringify(value))

async function fixture({locked=false}={}){
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'hatch-edit',units:'millimeter'})
  const hatch=await document.transact('pattern hatch',tx=>{
    const layer=locked?tx.upsertTableRecord('layers',{id:'locked',name:'LOCKED-HATCH',payload:{locked:true,visible:true}}):null
    return tx.createEntity('HATCH',{patternName:'ANSI31',solid:false,patternScale:1,patternAngle:0,boundaryLoops:[{external:true,closed:true,vertices:outer},{external:false,closed:true,vertices:islandA}],...(layer?{layerId:layer.id}:{})},{id:'hatch'})
  })
  return {sdk,document,hatch}
}

test('HATCHEDIT changes pattern and polygon islands on the original object with one-step history',async()=>{
  const {sdk,document,hatch}=await fixture(),before=json(document.getObject('hatch')),handle=hatch.handle
  const added=await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',vertices:islandB,patternScale:2.5,patternAngle:Math.PI/6},{document})
  assert.equal(added.id,'hatch');assert.equal(added.handle,handle);assert.equal(added.payload.patternScale,2.5);assert.equal(added.payload.patternAngle,Math.PI/6)
  assert.equal(added.payload.boundaryLoops.length,3);assert.equal(added.payload.boundaryLoops[2].external,false);assert.equal(added.payload.boundaryLoops[2].closed,true)
  await sdk.executeCommand('UNDO',{}, {document});assert.deepEqual(json(document.getObject('hatch')),before)
  await sdk.executeCommand('REDO',{}, {document});assert.equal(document.getObject('hatch').payload.boundaryLoops.length,3)
  await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'replace-island',loopIndex:1,vertices:[[6,6],[15,6],[15,14],[6,14]]},{document})
  assert.deepEqual(document.getObject('hatch').payload.boundaryLoops[1].vertices.map(vertex=>vertex.point),[[6,6,0],[15,6,0],[15,14,0],[6,14,0]])
  await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'remove-island',loopIndex:2},{document})
  assert.equal(document.getObject('hatch').payload.boundaryLoops.length,2)
  const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format:'KJD'}),{format:'KJD'})
  assert.deepEqual(json(reopened.getObject('hatch')),json(document.getObject('hatch')))
})

test('HATCHEDIT accepts an imported closed LINE-edge outer boundary',async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument({documentId:'edge-boundary'})
  const edges=outer.map((start,index)=>({type:'LINE',start,end:outer[(index+1)%outer.length]}))
  await document.transact('edge hatch',tx=>tx.createEntity('HATCH',{solid:true,boundaryLoops:[{external:true,edges}]},{id:'edge-hatch'}))
  await sdk.executeCommand('HATCHEDIT',{id:'edge-hatch',operation:'add-island',vertices:islandA},{document})
  assert.equal(document.getObject('edge-hatch').payload.boundaryLoops.length,2)
})

test('HATCHEDIT copies exact CIRCLE and closed LINE/ARC sources without changing source geometry',async()=>{
  const {sdk,document,hatch}=await fixture(),circlePayload={center:[25,15,0],radius:4}
  await document.transact('curve sources',tx=>{
    tx.createEntity('CIRCLE',circlePayload,{id:'circle-source'})
    tx.createEntity('LINE',{start:[22,20,0],end:[28,20,0]},{id:'cap-top'})
    tx.createEntity('ARC',{center:[28,24,0],radius:4,startAngle:-Math.PI/2,endAngle:Math.PI/2},{id:'cap-right'})
    tx.createEntity('LINE',{start:[28,28,0],end:[22,28,0]},{id:'cap-bottom'})
    tx.createEntity('ARC',{center:[22,24,0],radius:4,startAngle:Math.PI/2,endAngle:Math.PI*1.5},{id:'cap-left'})
  })
  const sourceBefore=json(document.getObject('circle-source')),originalIsland=json(document.getObject('hatch').payload.boundaryLoops[1])
  await sdk.executeCommand('HATCHEDIT',{id:hatch.id,operation:'add-island',sourceIds:['circle-source']},{document})
  const circleLoop=document.getObject('hatch').payload.boundaryLoops[2]
  assert.equal(circleLoop.edges.length,1);assert.equal(circleLoop.edges[0].type,'ARC');assert.equal(circleLoop.edges[0].radius,4)
  assert.deepEqual(json(document.getObject('circle-source')),sourceBefore);assert.deepEqual(json(document.getObject('hatch').payload.boundaryLoops[1]),originalIsland)
  await sdk.executeCommand('HATCHEDIT',{id:hatch.id,operation:'replace-island',loopIndex:2,sourceIds:['cap-bottom','cap-left','cap-top','cap-right']},{document})
  const capsule=document.getObject('hatch').payload.boundaryLoops[2]
  assert.deepEqual(capsule.edges.map(edge=>edge.type),['LINE','ARC','LINE','ARC'])
  await sdk.executeCommand('UNDO',{}, {document});assert.equal(document.getObject('hatch').payload.boundaryLoops[2].edges.length,1)
  await sdk.executeCommand('REDO',{}, {document});assert.equal(document.getObject('hatch').payload.boundaryLoops[2].edges.length,4)
  const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(document,{format:'KJD'}),{format:'KJD'})
  assert.deepEqual(json(reopened.getObject('hatch').payload.boundaryLoops[2]),json(document.getObject('hatch').payload.boundaryLoops[2]))
})

test('HATCHEDIT rejects unsafe topology, indexes and protected layers atomically',async()=>{
  for(const args of [
    {operation:'add-island',vertices:[[2,2],[20,20],[2,20],[20,2]]},
    {operation:'add-island',vertices:[[35,25],[45,25],[45,35],[35,35]]},
    {operation:'add-island',vertices:[[6,6],[10,6],[10,10],[6,10]]},
    {operation:'replace-island',loopIndex:0,vertices:islandB},
    {operation:'remove-island',loopIndex:99},
    {operation:'update-pattern',patternScale:0},
    {operation:'update-pattern',patternAngle:Infinity},
  ]){
    const {sdk,document}=await fixture(),before=document.serialize()
    await assert.rejects(sdk.executeCommand('HATCHEDIT',{id:'hatch',...args},{document}),/HATCHEDIT/)
    assert.equal(document.serialize(),before)
  }
  const {sdk,document}=await fixture({locked:true})
  await document.transact('protected exact source',tx=>tx.createEntity('CIRCLE',{center:[25,15,0],radius:4},{id:'protected-source'}))
  const before=document.serialize()
  await assert.rejects(sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['protected-source']},{document}),/locked/)
  assert.equal(document.serialize(),before)
})

test('HATCHEDIT rejects open, intersecting and SPLINE source boundaries atomically',async()=>{
  const {sdk,document}=await fixture()
  await document.transact('invalid sources',tx=>{
    tx.createEntity('LINE',{start:[20,20,0],end:[30,20,0]},{id:'open-line'})
    tx.createEntity('CIRCLE',{center:[8,8,0],radius:5},{id:'overlap-circle'})
    tx.createEntity('CIRCLE',{center:[25,15,0],radius:20},{id:'outside-circle'})
    tx.createEntity('SPLINE',{degree:2,controlPoints:[[20,20,0],[25,25,0],[30,20,0]],knots:[0,0,0,1,1,1]},{id:'spline-source'})
    tx.createEntity('LINE',{start:[20,5,0],end:[30,15,0]},{id:'cross-a'})
    tx.createEntity('LINE',{start:[30,15,0],end:[20,15,0]},{id:'cross-b'})
    tx.createEntity('LINE',{start:[20,15,0],end:[30,5,0]},{id:'cross-c'})
    tx.createEntity('LINE',{start:[30,5,0],end:[20,5,0]},{id:'cross-d'})
  })
  for(const [source,message] of [[['open-line'],/one-edge|closed/],[['overlap-circle'],/intersect|overlap/],[['outside-circle'],/inside/],[['spline-source'],/SPLINE/],[['cross-a','cross-b','cross-c','cross-d'],/self-intersects/]]){
    const before=document.serialize()
    await assert.rejects(sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:source},{document}),message)
    assert.equal(document.serialize(),before)
  }
})

test('edited pattern and islands survive DXF and independent ezdxf without repair',async t=>{
  const {sdk,document}=await fixture()
  await document.transact('curve sources',tx=>{
    tx.createEntity('CIRCLE',{center:[25,15,0],radius:4},{id:'dxf-circle'})
    tx.createEntity('LINE',{start:[22,20,0],end:[28,20,0]},{id:'dxf-top'})
    tx.createEntity('ARC',{center:[28,24,0],radius:4,startAngle:-Math.PI/2,endAngle:Math.PI/2},{id:'dxf-right'})
    tx.createEntity('LINE',{start:[28,28,0],end:[22,28,0]},{id:'dxf-bottom'})
    tx.createEntity('ARC',{center:[22,24,0],radius:4,startAngle:Math.PI/2,endAngle:Math.PI*1.5},{id:'dxf-left'})
  })
  await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['dxf-circle'],patternScale:2.5,patternAngle:Math.PI/6},{document})
  await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',sourceIds:['dxf-bottom','dxf-left','dxf-top','dxf-right']},{document})
  const source=await sdk.writeDocument(document,{format:'DXF',version:'2018'}),reopened=await createKJDrawSDK().readDocument(source,{format:'DXF'})
  const hatch=reopened.listEntities({type:'HATCH'})[0]
  assert.equal(hatch.payload.boundaryLoops.length,4);assert.equal(hatch.payload.patternScale,2.5);assert.ok(Math.abs(hatch.payload.patternAngle-Math.PI/6)<1e-10)
  const script=String.raw`
import io,json,math,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));items=list(d.modelspace().query('HATCH'));assert len(items)==1
h=items[0];assert len(h.paths)==4 and abs(h.dxf.pattern_scale-2.5)<1e-10 and abs(h.dxf.pattern_angle-30)<1e-10
flags=[path.path_type_flags for path in h.paths];assert flags[0]&1 and all(not flag&1 for flag in flags[1:])
curve=h.paths[2];assert len(curve.edges)==1 and type(curve.edges[0]).__name__=='ArcEdge'
edge=curve.edges[0];start=(edge.center.x+edge.radius*math.cos(math.radians(edge.start_angle)),edge.center.y+edge.radius*math.sin(math.radians(edge.start_angle)));end=(edge.center.x+edge.radius*math.cos(math.radians(edge.end_angle)),edge.center.y+edge.radius*math.sin(math.radians(edge.end_angle)));assert math.dist(start,end)<1e-9
capsule=h.paths[3];assert [type(edge).__name__ for edge in capsule.edges]==['LineEdge','ArcEdge','LineEdge','ArcEdge']
def endpoints(edge):
  if type(edge).__name__=='LineEdge': return tuple(edge.start),tuple(edge.end)
  return ((edge.center.x+edge.radius*math.cos(math.radians(edge.start_angle)),edge.center.y+edge.radius*math.sin(math.radians(edge.start_angle))),(edge.center.x+edge.radius*math.cos(math.radians(edge.end_angle)),edge.center.y+edge.radius*math.sin(math.radians(edge.end_angle))))
assert all(math.dist(endpoints(edge)[1],endpoints(capsule.edges[(index+1)%len(capsule.edges)])[0])<1e-9 for index,edge in enumerate(capsule.edges))
audit=d.audit();assert not audit.errors and not audit.fixes,([str(e) for e in audit.errors],[str(e) for e in audit.fixes])
print(json.dumps({'loops':len(h.paths),'scale':h.dxf.pattern_scale,'angle':h.dxf.pattern_angle}))
`
  const result=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON??'python',['-c',script],source,{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
  if(result.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(result.stderr)){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(result.stderr||result.error.message);t.skip('ezdxf required');return}
  assert.equal(result.status,0,result.stderr);const audited=JSON.parse(result.stdout);assert.equal(audited.loops,4);assert.equal(audited.scale,2.5);assert.ok(Math.abs(audited.angle-30)<1e-9)
})
