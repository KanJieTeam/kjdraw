import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSyncWithFileStdin} from '../../../scripts/spawn-file-stdin.mjs'
import {createBoundaryEditSession,createKJDrawSDK,extendEntityPayload} from '../src/index.js'

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`)
const target=()=>({type:'ELLIPSE',payload:{center:[0,0,6],majorAxis:[10,0,0],ratio:.5,startParameter:0,endParameter:Math.PI/2,color:2,lineweight:35,linetypeScale:1.5}})
const boundary=(x,type='LINE',lower=false)=>type==='LINE'?{type,payload:{start:[x,lower?-10:0,6],end:[x,lower?0:10,6]}}:{type,payload:{origin:[x,0,6],direction:[0,lower?-1:1,0]}}
const records=drawing=>Object.fromEntries(drawing.listObjects({includeErased:true}).map(object=>[object.id,object]))

test('ELLIPSE EXTEND changes only the selected parameter end at the nearest finite LINE/RAY/XLINE continuation',()=>{
  for(const type of ['LINE','RAY','XLINE']){
    const source=target(),before=JSON.stringify(source)
    const end=extendEntityPayload(source,[boundary(-5,type),boundary(-8,type)],[0,5])
    near(end.startParameter,0);near(end.endParameter,2*Math.PI/3)
    const start=extendEntityPayload(source,[boundary(5,type,true)],[10,0])
    near(start.startParameter,-Math.PI/3);near(start.endParameter,Math.PI/2)
    for(const payload of [start,end]){
      assert.deepEqual(payload.center,source.payload.center);assert.deepEqual(payload.majorAxis,source.payload.majorAxis)
      assert.equal(payload.ratio,.5);assert.equal(payload.lineweight,35)
    }
    assert.equal(JSON.stringify(source),before)
  }
  // Rotate/translate a non-circular ellipse: the same local cut has the same parameter.
  const source=target();source.payload.center=[12,-20,6];source.payload.majorAxis=[8,6,0];source.payload.ratio=.25
  const world=(x,y)=>[12+8*x-1.5*y,-20+6*x+2*y,6]
  const next=extendEntityPayload(source,[{type:'LINE',payload:{start:world(-.5,0),end:world(-.5,2)}}],world(0,1))
  near(next.endParameter,2*Math.PI/3)
})

test('ELLIPSE EXTEND rejects full curves, ambiguous picks and unavailable or unsupported boundaries',()=>{
  const source=target()
  assert.throws(()=>extendEntityPayload({type:'ELLIPSE',payload:{...source.payload,endParameter:2*Math.PI}},[boundary(-5)],[0,5]),/no endpoint/)
  assert.throws(()=>extendEntityPayload(source,[boundary(-5)],[Math.sqrt(50),Math.sqrt(12.5)]),/midpoint/)
  assert.throws(()=>extendEntityPayload(source,[boundary(5)],[0,5]),/No boundary/)
  assert.throws(()=>extendEntityPayload(source,[boundary(-5)],[0,-5]),/within the target/)
  assert.throws(()=>extendEntityPayload(source,[{type:'CIRCLE',payload:{center:[0,0,6],radius:5}}],[0,5]),/support LINE, RAY or XLINE/)
  assert.throws(()=>extendEntityPayload(source,[{type:'LINE',payload:{start:[-5,0,7],end:[-5,10,7]}}],[0,5]),/same XY plane/)
})

test('shared ELLIPSE EXTEND preserves identity, membership and history; stale/protected commits reject; DXF validates independently',async t=>{
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'})
  const layer=await sdk.executeCommand('LAYERNEW',{name:'Elliptical detail'})
  const entity=await sdk.executeCommand('CREATE',{type:'ELLIPSE',payload:{...target().payload,layerId:layer.id},options:{name:'Opening'}})
  const cutter=await sdk.executeCommand('CREATE',{type:'LINE',payload:boundary(-5).payload})
  const group=await sdk.executeCommand('GROUP',{name:'Assembly',ids:[entity.id]})
  const named=await sdk.getSelectionManager().saveNamed('Detail',{ids:[entity.id]})
  const before=records(drawing),revision=drawing.revision
  const session=createBoundaryEditSession('extend',{document:drawing,boundaryIds:[cutter.id]});session.confirmBoundaries()
  const preview=session.preview(entity.id,[0,5])
  assert.deepEqual(records(drawing),before)
  await session.apply(preview,request=>sdk.executeCommandEnvelope(sdk.createCommandEnvelope(request.command,request.arguments,{document:drawing,expectedRevision:request.expectedRevision}),{document:drawing}))
  assert.equal(drawing.revision,revision+1)
  const updated=drawing.getObject(entity.id);assert.equal(updated.handle,entity.handle);assert.equal(updated.name,'Opening')
  near(updated.payload.endParameter,2*Math.PI/3)
  for(const id of [group.id,named.id])assert.deepEqual(drawing.getObject(id).payload.memberIds,[entity.id])
  const after=records(drawing)
  for(const format of ['KJD','DXF']){
    const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing,{format,...(format==='DXF'?{version:'2018'}:{})}),{format})
    near(reopened.listEntities({type:'ELLIPSE'})[0].payload.endParameter,2*Math.PI/3)
  }
  await sdk.executeCommand('UNDO');assert.deepEqual(records(drawing),before)
  await sdk.executeCommand('REDO');assert.deepEqual(records(drawing),after)
  const lower=await sdk.executeCommand('CREATE',{type:'LINE',payload:boundary(5,'LINE',true).payload})
  const stale=createBoundaryEditSession('extend',{document:drawing,boundaryIds:[lower.id]});stale.confirmBoundaries()
  const pending=stale.preview(entity.id,[10,0])
  await sdk.executeCommand('LAYERUPDATE',{id:layer.id,patch:{locked:true}})
  const protectedBefore=drawing.serialize()
  await assert.rejects(stale.apply(pending,request=>sdk.executeCommand(request.command,request.arguments)),/changed|stale|revision/i)
  await assert.rejects(sdk.executeCommand('EXTEND',{id:entity.id,boundaryIds:[cutter.id],pickPoint:[10,0]}))
  assert.equal(drawing.serialize(),protectedBefore)

  const independent=createKJDrawSDK(), native=independent.createDocument({units:'millimeter'})
  for(const payload of [extendEntityPayload(target(),[boundary(-5)],[0,5]),extendEntityPayload(target(),[boundary(5,'LINE',true)],[10,0])])await independent.executeCommand('CREATE',{type:'ELLIPSE',payload})
  const dxf=await independent.writeDocument(native,{format:'DXF',version:'2018'})
  const script=String.raw`import io,json,os,sys
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH')
d=ezdxf.read(io.StringIO(open(p,encoding='utf-8').read() if p else sys.stdin.read()))
a=d.audit()
print(json.dumps({'errors':len(a.errors),'fixes':len(a.fixes),'items':[[e.dxf.start_param,e.dxf.end_param,list(e.start_point),list(e.end_point)] for e in d.modelspace().query('ELLIPSE')]}))`
  const verified=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON??'python',['-c',script],dxf,{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
  if(verified.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(verified.stderr)){
    if(process.env.KJDRAW_REQUIRE_DXF_INTEGRATION==='1')assert.fail(verified.stderr||verified.error.message)
    t.skip('ezdxf required');return
  }
  assert.equal(verified.status,0,verified.stderr)
  const actual=JSON.parse(verified.stdout);assert.equal(actual.errors,0);assert.equal(actual.fixes,0);assert.equal(actual.items.length,2)
  near(actual.items[0][1],2*Math.PI/3);near(actual.items[0][3][0],-5);near(actual.items[0][3][1],Math.sqrt(18.75))
  near(actual.items[1][0],-Math.PI/3);near(actual.items[1][2][0],5);near(actual.items[1][2][1],-Math.sqrt(18.75))
})
