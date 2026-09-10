import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'

const python = process.env.KJDRAW_PYTHON ?? 'python'
function independent(t, script, input = '') {
  const run = spawnSync(python, ['-c', script], { input, encoding:'utf8', timeout:30000 })
  if (run.error?.code === 'ENOENT' || /No module named 'ezdxf'/.test(run.stderr)) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(run.stderr || run.error.message)
    t.skip('Independent ezdxf dependency required'); return null
  }
  assert.equal(run.status, 0, run.stderr); return JSON.parse(run.stdout)
}
const makeNative = String.raw`
import io,json,ezdxf
D=ezdxf.new('R2018');D.layers.new('Frozen detail');p=D.layout()
v=p.add_viewport((50,40),size=(80,60),view_center_point=(12,-5),view_height=75,status=1)
v.dxf.view_target_point=(17,-9,3);v.dxf.view_direction_vector=(1,2,3)
v.dxf.view_twist_angle=37;v.dxf.perspective_lens_length=72
v.dxf.front_clip_plane_z_value=11;v.dxf.back_clip_plane_z_value=-23
v.dxf.flags=1|2|4|16|65536;v.dxf.circle_zoom=321;v.frozen_layers=['Frozen detail']
c=p.add_circle((50,40),20);v.dxf.clipping_boundary_handle=c.dxf.handle
D.modelspace().add_line((0,0),(10,10));s=io.StringIO();D.write(s)
print(json.dumps({'dxf':s.getvalue(),'handle':v.dxf.handle}))
`
const inspectNative = String.raw`
import io,json,sys,ezdxf
D=ezdxf.read(io.StringIO(sys.stdin.read(),newline=None));a=D.audit()
v=[v for v in D.layout().query('VIEWPORT') if v.dxf.id != 1][0]
h=v.dxf.get('clipping_boundary_handle','0');c=D.entitydb.get(h)
print(json.dumps({'target':list(v.dxf.view_target_point),'direction':list(v.dxf.view_direction_vector),'center':list(v.dxf.view_center_point),'twist':v.dxf.view_twist_angle,'status':v.dxf.status,'id':v.dxf.id,'flags':v.dxf.flags,'lens':v.dxf.perspective_lens_length,'front':v.dxf.front_clip_plane_z_value,'back':v.dxf.back_clip_plane_z_value,'frozen':list(v.frozen_layers),'clip':c.dxftype() if c else None,'clipOwnerMatches':c.dxf.owner==v.dxf.owner if c else None,'circleZoom':v.dxf.circle_zoom,'errors':len(a.errors),'fixes':len(a.fixes)}))
`

test('native viewport fields, frozen layer handles and forward clipping reference survive SDK and ezdxf roundtrip', async t => {
  const input = independent(t, makeNative); if (!input) return
  const adapter=createDXFFileAdapter(), document=await adapter.read(input.dxf)
  const viewport=document.listEntities({type:'VIEWPORT'}).find(v=>v.payload.viewportId!==1)
  assert.ok(viewport); const p=viewport.payload
  assert.deepEqual(p.viewTarget,[17,-9,3]); assert.deepEqual(p.viewDirection,[1,2,3])
  assert.equal(p.frontClipDistance,11);assert.equal(p.backClipDistance,-23)
  assert.equal(p.flags,65559); assert.equal(document.getObject(p.frozenLayerIds[0]).name,'Frozen detail')
  const clip=document.getObject(p.clippingBoundaryId);assert.equal(clip.type,'CIRCLE');assert.equal(clip.ownerId,viewport.ownerId)
  assert.ok(p.rawTags.some(tag=>tag.code===72&&tag.value==='321'))
  const before=document.serialize(), output=await adapter.write(document,{version:'2018'})
  assert.equal(document.serialize(),before)
  const actual=independent(t,inspectNative,output)
  assert.deepEqual(actual,{target:[17,-9,3],direction:[1,2,3],center:[12,-5,0],twist:37,status:1,id:3,flags:65559,lens:72,front:11,back:-23,frozen:['Frozen detail'],clip:'CIRCLE',clipOwnerMatches:true,circleZoom:321,errors:0,fixes:0})
  const reopened=await adapter.read(output), rep=reopened.listEntities({type:'VIEWPORT'}).find(v=>v.payload.viewportId!==1).payload
  assert.equal(reopened.getObject(rep.frozenLayerIds[0]).name,'Frozen detail');assert.equal(reopened.getObject(rep.clippingBoundaryId).type,'CIRCLE')
  await document.transact('edit native viewport',tx=>tx.updateObject(viewport.id,{payload:{viewTarget:[20,30,40],twistAngle:Math.PI/2,status:-1}}))
  const edited=independent(t,inspectNative,await adapter.write(document,{version:'2018'}))
  assert.deepEqual(edited.target,[20,30,40]);assert.equal(edited.twist,90);assert.equal(edited.status,-1);assert.equal(edited.circleZoom,321);assert.equal(edited.errors+edited.fixes,0)
})

test('new SDK viewport exports positive-Z defaults and preserves explicit view controls and frozen layers',async t=>{
  const sdk=createKJDrawSDK(), document=sdk.createDocument(), layout=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Detail'})
  const viewport=await sdk.executeCommand('VIEWPORT',{layoutId:layout.id,center:[50,40],width:80,height:60,viewCenter:[12,-5],viewHeight:75})
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{viewTarget:[4,5,6],twistAngle:Math.PI/6,perspective:true,frozenLayerIds:[document.getTable('layers').records[0].id]}})
  const adapter=createDXFFileAdapter(), output=await adapter.write(document,{version:'2018'})
  const actual=independent(t,inspectNative.replace('D.layout().query',"D.layouts.get('Detail').query"),output);if(!actual)return
  assert.equal(actual.status,1);assert.equal(actual.id,2);assert.equal(actual.flags,1);assert.deepEqual(actual.direction,[0,0,1]);assert.deepEqual(actual.target,[4,5,6]);assert.deepEqual(actual.frozen,['0']);assert.equal(actual.errors+actual.fixes,0)
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{flags:0}})
  assert.equal(document.getObject(viewport.id).payload.flags,0)
  assert.throws(()=>adapter.write(document,{version:'R12'}),/cannot represent VIEWPORT/)
})

test('unresolved viewport graph references are retained and prevent lossy export',async t=>{
  const input=independent(t,makeNative);if(!input)return
  for(const code of [331,340]){
    const lines=input.dxf.split('\n');let type=''
    for(let i=0;i+1<lines.length;i+=2){if(Number(lines[i])===0)type=lines[i+1].trim();else if(type==='VIEWPORT'&&Number(lines[i])===code)lines[i+1]='DEADBEEF'}
    const invalid=lines.join('\n')
    const adapter=createDXFFileAdapter(), document=await adapter.read(invalid)
    const p=document.listEntities({type:'VIEWPORT'}).find(v=>v.payload.viewportId!==1).payload
    assert.ok(p.unresolvedViewportReferences?.length);assert.ok(p.rawTags.some(tag=>tag.value==='DEADBEEF'))
    assert.throws(()=>adapter.write(document,{version:'2018'}),/unresolved source references/)
  }
})

test('viewport export rejects missing or cross-space typed references and unsupported raw pointers',async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument(), layout=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Detail'})
  const viewport=await sdk.executeCommand('VIEWPORT',{layoutId:layout.id,center:[50,40],width:80,height:60,viewCenter:[12,-5],viewHeight:75})
  const model=await sdk.executeCommand('CREATE',{type:'CIRCLE',payload:{center:[0,0],radius:2}}),adapter=createDXFFileAdapter()
  for(const [patch,pattern] of [[{frozenLayerIds:['missing']},/frozen layer/],[{frozenLayerIds:[],clippingBoundaryId:model.id},/same space/],[{clippingBoundaryId:null,flags:65536},/requires a clipping boundary/],[{flags:0,rawTags:[{code:345,value:'ABC'}]},/raw reference/],[{rawTags:[],viewCenter:[0,0,1]},/two-dimensional/]]){
    await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch})
    assert.throws(()=>adapter.write(document,{version:'2018'}),pattern)
  }
})

test('viewport normalization rejects malformed controls and canonicalizes boolean aliases for later updates',async()=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument(),layout=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Detail'})
  const viewport=await sdk.executeCommand('VIEWPORT',{layoutId:layout.id,center:[50,40],width:80,height:60,viewCenter:[0,0],viewHeight:75})
  for(const patch of [{flags:1.5},{flags:-1},{status:32768},{viewportId:NaN},{viewDirection:[0,0,0]},{viewTarget:[0,0,Infinity]},{frontClipDistance:NaN},{lensLength:0},{frozenLayerIds:['x','x']},{perspective:'yes'}]){
    const before=document.serialize()
    await assert.rejects(sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch}))
    assert.equal(document.serialize(),before)
  }
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{perspective:true,nonRectangularClip:true}})
  assert.equal(document.getObject(viewport.id).payload.flags,65537)
  assert.equal(document.getObject(viewport.id).payload.perspective,undefined)
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{perspective:false,nonRectangularClip:false}})
  assert.equal(document.getObject(viewport.id).payload.flags,0)
})

test('multiple paper viewports receive unique owner-local native IDs without overwriting explicit IDs',async t=>{
  const sdk=createKJDrawSDK(),document=sdk.createDocument(), first=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Three details'})
  const created=[]
  for(let i=0;i<3;i++)created.push(await sdk.executeCommand('VIEWPORT',{layoutId:first.id,center:[i*100,40],width:80,height:60,viewHeight:75}))
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:created[1].id,patch:{viewportId:8}})
  const other=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Other details'})
  const fourth=await sdk.executeCommand('VIEWPORT',{layoutId:other.id,center:[50,40],width:80,height:60,viewHeight:75})
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:fourth.id,patch:{viewportId:8}})
  const adapter=createDXFFileAdapter(),before=document.serialize(),output=adapter.write(document,{version:'2018'})
  assert.equal(document.serialize(),before)
  const actual=independent(t,String.raw`
import io,json,sys,ezdxf
D=ezdxf.read(io.StringIO(sys.stdin.read(),newline=None));a=D.audit()
print(json.dumps({'first':[v.dxf.id for v in D.layouts.get('Three details').query('VIEWPORT')],'second':[v.dxf.id for v in D.layouts.get('Other details').query('VIEWPORT')],'errors':len(a.errors),'fixes':len(a.fixes)}))
`,output);if(!actual)return
  assert.deepEqual(actual,{first:[2,8,3],second:[8],errors:0,fixes:0})
  const reopened=await adapter.read(output),native=reopened.listEntities({type:'VIEWPORT'}).map(v=>v.payload.viewportId)
  assert.deepEqual(native.sort((a,b)=>a-b),[2,3,8,8])
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:created[2].id,patch:{viewportId:8}})
  assert.throws(()=>adapter.write(document,{version:'2018'}),/Conflicting explicit VIEWPORT IDs/)
})
