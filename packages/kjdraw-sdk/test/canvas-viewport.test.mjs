import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJCanvasRenderer } from '../src/canvas-renderer.js'
import { spawnSync } from 'node:child_process'

function canvasFixture() {
  const calls=[]
  const context = new Proxy({calls,measureText(value){const height=parseFloat(this.font)||12;return {width:String(value).length*height*.6,actualBoundingBoxAscent:height*.75}}}, {get(target,key){if(key in target)return target[key];return (...args)=>calls.push([key,...args])},set(target,key,value){target[key]=value;return true}})
  const canvas={width:400,height:300,clientWidth:400,clientHeight:300,getContext:()=>context,getBoundingClientRect:()=>({width:400,height:300})}
  return {canvas,calls}
}
async function fixture(twistAngle=0) {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'millimeter'})
  const model=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[90,100],end:[110,100]}})
  const layout=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Viewport sheet'})
  const viewport=await sdk.executeCommand('VIEWPORT',{layoutId:layout.id,center:[50,50],width:40,height:20,viewCenter:[100*Math.cos(twistAngle)-100*Math.sin(twistAngle),100*Math.sin(twistAngle)+100*Math.cos(twistAngle)],viewHeight:40,twistAngle})
  const {canvas,calls}=canvasFixture(), renderer=new KJCanvasRenderer(canvas,{document,spaceId:layout.payload.blockRecordId,grid:false,pixelRatio:1,padding:0})
  Object.assign(renderer.camera,{centerX:50,centerY:50,scale:4});calls.length=0
  return {sdk,document,model,layout,viewport,renderer,calls}
}
const hasPoint=(calls,method,x,y)=>calls.some(call=>call[0]===method&&Math.abs(call[1]-x)<1e-8&&Math.abs(call[2]-y)<1e-8)

test('paper VIEWPORT projects real model coordinates, clips before content, and fits its full rectangle',async()=>{
  const {document,renderer,calls}=await fixture(), before=document.serialize(), camera={...renderer.camera}
  const report=renderer.render()
  assert.ok(hasPoint(calls,'moveTo',180,150));assert.ok(hasPoint(calls,'lineTo',220,150))
  const clip=calls.findIndex(call=>call[0]==='clip'), content=calls.findIndex(call=>call[0]==='moveTo'&&call[1]===180&&call[2]===150)
  assert.ok(clip>=0&&clip<content)
  assert.equal(report.unsupported,0);assert.equal(report.viewportDiagnostics[0].rendered,1)
  assert.deepEqual(renderer.camera,camera);assert.equal(document.serialize(),before)
  renderer.fit();assert.equal(renderer.camera.centerX,50);assert.equal(renderer.camera.centerY,50);assert.equal(renderer.camera.scale,10)
  renderer.dispose()
})

test('viewport twist rotates displayed geometry about view center without changing document or paper camera',async()=>{
  const {renderer,calls}=await fixture(Math.PI/2)
  renderer.render()
  assert.ok(hasPoint(calls,'moveTo',200,170));assert.ok(hasPoint(calls,'lineTo',200,130))
  assert.deepEqual(renderer.camera,{centerX:50,centerY:50,scale:4})
  renderer.dispose()
})

test('viewport scale, DCS center, twist and WCS target agree with independent ezdxf native transforms',async t=>{
  const definitions=[{twist:0,center:[100,100],target:[0,0,0]},{twist:90,center:[-100,100],target:[0,0,0]},{twist:37,center:[12,8],target:[75,80,0]},{twist:-55,center:[3,-6],target:[88,99,0]}]
  const python=process.env.KJDRAW_PYTHON??process.env.KJDRAW_BENCH_PYTHON??'python'
  const script="import sys,json,ezdxf\nout=[]\nfor q in json.load(sys.stdin):\n d=ezdxf.new();v=d.layout().add_viewport((50,50),size=(40,20),view_center_point=q['center'],view_height=40);v.dxf.view_twist_angle=q['twist'];v.dxf.view_target_point=q['target'];out.append(list(v.get_transformation_matrix().transform((90,100,0))))\nprint(json.dumps(out))"
  const result=spawnSync(python,['-c',script],{input:JSON.stringify(definitions),encoding:'utf8',timeout:30000})
  if(result.status!==0){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(result.stderr||result.error?.message);t.skip('Independent ezdxf dependency required');return}
  const expected=JSON.parse(result.stdout)
  for(const [i,definition] of definitions.entries()){
    const {sdk,viewport,renderer,calls}=await fixture()
    await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{viewCenter:[...definition.center,0],twistAngle:definition.twist*Math.PI/180,viewTarget:definition.target}})
    calls.length=0;renderer.render();const point=renderer.worldToScreen(expected[i])
    assert.ok(hasPoint(calls,'moveTo',...point),JSON.stringify(definition));renderer.dispose()
  }
})

test('viewport frozen layers hide model content but leave independent paper objects visible',async()=>{
  const {sdk,document,model,layout,viewport,renderer,calls}=await fixture()
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{frozenLayerIds:[model.payload.layerId]}})
  await document.transact('paper label',tx=>tx.createEntity('TEXT',{text:'Paper remains',position:[75,50],height:2},{ownerId:layout.payload.blockRecordId}))
  calls.length=0;const report=renderer.render()
  assert.equal(report.viewportDiagnostics[0].hidden,1)
  assert.equal(report.viewportDiagnostics[0].rendered,0)
  assert.ok(calls.some(call=>call[0]==='fillText'&&call[1]==='Paper remains'))
  renderer.dispose()
})

test('scaled viewport keeps native dimension values and scales annotation graphics including inside blocks',async()=>{
  const {sdk,document,renderer,calls}=await fixture()
  const dim=await sdk.executeCommand('CREATE',{type:'DIMENSION',payload:{dimensionType:'ALIGNED',definitionPoints:[[100,105],[90,100],[110,100]],textHeight:2}})
  await sdk.executeCommand('BLOCKCREATE',{name:'Dimension detail',id:dim.id,basePoint:[100,100]})
  const before=document.serialize();calls.length=0;const report=renderer.render()
  assert.ok(calls.some(call=>call[0]==='fillText'&&call[1]==='20'))
  assert.ok(!calls.some(call=>call[0]==='fillText'&&call[1]==='10'))
  assert.equal(report.viewportDiagnostics[0].approximated,1)
  assert.ok(report.approximateTypes.includes('VIEWPORT'))
  assert.equal(document.serialize(),before);renderer.dispose()
})

test('unsupported viewport controls and projected model types report partial content instead of a successful empty frame',async()=>{
  const {sdk,document,viewport,renderer}=await fixture()
  await document.transact('unknown model entity',tx=>tx.createEntity('UNKNOWN_VIEW_MODEL',{position:[100,100]}))
  let report=renderer.render();assert.equal(report.unsupported,1);assert.equal(report.viewportDiagnostics[0].unsupported,1)
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{perspective:true}})
  report=renderer.render();assert.equal(report.viewportDiagnostics[0].reason,'unsupported-view')
  renderer.dispose()
})

test('viewport model traversal has a shared bounded frame budget even for invisible candidates',async()=>{
  const {document,model,layout,renderer}=await fixture();renderer.dispose()
  const {canvas}=canvasFixture(), hidden={...model,payload:{...model.payload,visible:false}}
  const paper=document.listEntities({ownerId:layout.payload.blockRecordId}), candidates=Array(100001).fill(hidden)
  const bounded=new KJCanvasRenderer(canvas,{document,spaceId:layout.payload.blockRecordId,grid:false,pixelRatio:1,sceneProvider:{listEntities:({spaceId})=>spaceId===document.snapshot().spaces.modelSpaceId?candidates:paper}})
  const report=bounded.render();assert.equal(report.viewportDiagnostics[0].reason,'budget');assert.equal(report.viewportDiagnostics[0].hidden,100000);assert.equal(report.unsupported,1)
  bounded.dispose()
})

test('native viewport flags keep off views empty and reject unsupported clipping and perspective',async()=>{
  const {sdk,viewport,renderer,calls}=await fixture()
  for(const flags of [1,2,4,16,65536]){
    await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{flags}})
    assert.equal(renderer.render().viewportDiagnostics[0].reason,'unsupported-view')
  }
  for(const patch of [{flags:131072},{flags:0,status:0},{flags:0,status:1,viewportId:1}]){
    await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch})
    calls.length=0;const diagnostic=renderer.render().viewportDiagnostics[0]
    assert.equal(diagnostic.hidden,1);assert.equal(diagnostic.rendered,0)
    assert.equal(hasPoint(calls,'moveTo',180,150),false)
  }
  renderer.dispose()
})

test('saved offscreen status remains ON after fit while unresolved native references are unsupported',async()=>{
  const {sdk,viewport,renderer,calls}=await fixture()
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{status:-1}})
  renderer.fit();calls.length=0
  let diagnostic=renderer.render().viewportDiagnostics[0]
  assert.equal(diagnostic.hidden,0);assert.equal(diagnostic.rendered,1)
  const point=renderer.worldToScreen([45,50]);assert.ok(hasPoint(calls,'moveTo',...point))
  await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{unresolvedViewportReferences:['frozen-layer:FFFF']}})
  diagnostic=renderer.render().viewportDiagnostics[0]
  assert.equal(diagnostic.reason,'unsupported-view');assert.equal(diagnostic.rendered,0)
  renderer.dispose()
})
