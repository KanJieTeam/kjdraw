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
  const {sdk,document}=await fixture({locked:true}),before=document.serialize()
  await assert.rejects(sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',vertices:islandB},{document}),/locked/)
  assert.equal(document.serialize(),before)
})

test('edited pattern and islands survive DXF and independent ezdxf without repair',async t=>{
  const {sdk,document}=await fixture()
  await sdk.executeCommand('HATCHEDIT',{id:'hatch',operation:'add-island',vertices:islandB,patternScale:2.5,patternAngle:Math.PI/6},{document})
  const source=await sdk.writeDocument(document,{format:'DXF',version:'2018'}),reopened=await createKJDrawSDK().readDocument(source,{format:'DXF'})
  const hatch=reopened.listEntities({type:'HATCH'})[0]
  assert.equal(hatch.payload.boundaryLoops.length,3);assert.equal(hatch.payload.patternScale,2.5);assert.ok(Math.abs(hatch.payload.patternAngle-Math.PI/6)<1e-10)
  const script=String.raw`
import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));items=list(d.modelspace().query('HATCH'));assert len(items)==1
h=items[0];assert len(h.paths)==3 and abs(h.dxf.pattern_scale-2.5)<1e-10 and abs(h.dxf.pattern_angle-30)<1e-10
assert all(path.is_closed for path in h.paths)
flags=[path.path_type_flags for path in h.paths];assert flags[0]&1 and not flags[1]&1 and not flags[2]&1
audit=d.audit();assert not audit.errors and not audit.fixes,([str(e) for e in audit.errors],[str(e) for e in audit.fixes])
print(json.dumps({'loops':len(h.paths),'scale':h.dxf.pattern_scale,'angle':h.dxf.pattern_angle}))
`
  const result=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON??'python',['-c',script],source,{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
  if(result.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(result.stderr)){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(result.stderr||result.error.message);t.skip('ezdxf required');return}
  assert.equal(result.status,0,result.stderr);const audited=JSON.parse(result.stdout);assert.equal(audited.loops,3);assert.equal(audited.scale,2.5);assert.ok(Math.abs(audited.angle-30)<1e-9)
})
