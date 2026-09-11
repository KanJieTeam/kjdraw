import test from 'node:test'
import assert from 'node:assert/strict'
import {createKJDrawSDK} from '../src/sdk.js'
import {KJCanvasRenderer} from '../src/canvas-renderer.js'
function canvas(){const calls=[],context=new Proxy({},{get:(_,k)=>(...a)=>calls.push([k,...a]),set:()=>true});return {calls,canvas:{width:800,height:600,clientWidth:800,clientHeight:600,getContext:()=>context,getBoundingClientRect:()=>({width:800,height:600})}}}
async function fixture(scale=[2,2,1]){const sdk=createKJDrawSDK(),document=sdk.createDocument();let dim,insert;await document.transact('native dimension block',tx=>{const block=tx.upsertTableRecord('blockRecords',{name:'dimension-block',type:'BLOCK_RECORD',payload:{basePoint:[0,0,0]}});dim=tx.createEntity('DIMENSION',{dimensionType:'ALIGNED',definitionPoints:[[0,10,0],[0,0,0],[50,0,0]],textHeight:2},{ownerId:block.id});insert=tx.createEntity('INSERT',{blockRecordId:block.id,position:[0,0,0],scale,rotation:0})});const c=canvas(),renderer=new KJCanvasRenderer(c.canvas,{document,grid:false,pixelRatio:1});Object.assign(renderer.camera,{centerX:0,centerY:0,scale:2});c.calls.length=0;return{sdk,document,dim,insert,renderer,calls:c.calls}}
test('scaled model-space INSERT keeps native dimension measurement in block coordinates',async()=>{const{document,renderer,calls}=await fixture(),before=document.serialize();const report=renderer.render();assert.equal(report.unsupported,0);assert.ok(calls.some(c=>c[0]==='fillText'&&c[1]==='50'),JSON.stringify(calls.filter(c=>c[0]==='fillText')));assert.equal(document.serialize(),before);renderer.dispose()})

import {projectDimension} from '../src/geometry/annotation.js'
import {multiply3,rotation3,scale3,translation3} from '../src/geometry/matrix3.js'
import {selectEntitiesByFence,selectEntitiesInBox} from '../src/selection-geometry.js'
const map=(m,p)=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]]
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`)
function recordingCanvas(){
 const marks=[],stack=[];let m=[1,0,0,1,0,0]
 const context=new Proxy({},{get:(_,key)=>(...a)=>{
  if(key==='save')stack.push([...m]);else if(key==='restore')m=stack.pop()??m
  else if(key==='setTransform')m=[...a];else if(key==='resetTransform')m=[1,0,0,1,0,0]
  else if(key==='transform')m=multiply3(m,a);else if(key==='translate')m=multiply3(m,translation3(...a));else if(key==='rotate')m=multiply3(m,rotation3(a[0]));else if(key==='scale')m=multiply3(m,scale3(...a))
  else if(key==='fillText')marks.push({type:'text',text:a[0],position:map(m,[a[1],a[2]]),matrix:[...m]})
  else if(key==='arc')marks.push({type:'arc',center:map(m,[a[0],a[1]]),u:[m[0]*a[2],m[1]*a[2]],v:[m[2]*a[2],m[3]*a[2]],start:a[3],end:a[4]})
 },set:()=>true})
 return {marks,canvas:{width:800,height:600,clientWidth:800,clientHeight:600,getContext:()=>context,getBoundingClientRect:()=>({width:800,height:600})}}
}
async function nestedFixture(kind='ANGULAR_3_POINT',reflex=true){
 const sdk=createKJDrawSDK(),document=sdk.createDocument();let dim,insert
 const payload=kind==='ALIGNED'?{dimensionType:kind,definitionPoints:[[0,10],[0,0],[50,0]]}:{dimensionType:kind,definitionPoints:[reflex?[-6,-6]:[6,6],[10,0],[0,10],[0,0]]}
 const inner=multiply3(translation3(4,5),multiply3(rotation3(Math.PI/6),multiply3(scale3(1.5,.75),translation3(-2,-3))))
 const outer=multiply3(translation3(40,30),multiply3(rotation3(Math.PI/5),multiply3(scale3(-2,3),translation3(4,-6))))
 await document.transact('nested styled native annotations',tx=>{
  const style=tx.upsertTableRecord('dimensionStyles',{name:'block-style',type:'DIM_STYLE',payload:{textHeight:1,arrowSize:.3,extensionOffset:.1,extensionBeyond:.2}})
  const a=tx.upsertTableRecord('blockRecords',{name:'inner',type:'BLOCK_RECORD',payload:{basePoint:[2,3,0]}}),b=tx.upsertTableRecord('blockRecords',{name:'outer',type:'BLOCK_RECORD',payload:{basePoint:[-4,6,0]}})
  dim=tx.createEntity('DIMENSION',{...payload,styleId:style.id},{ownerId:a.id})
  tx.createEntity('INSERT',{blockRecordId:a.id,position:[4,5,0],rotation:Math.PI/6,scale:[1.5,.75,1]},{ownerId:b.id})
  insert=tx.createEntity('INSERT',{blockRecordId:b.id,position:[40,30,0],rotation:Math.PI/5,scale:[-2,3,1]})
 })
 const c=recordingCanvas(),renderer=new KJCanvasRenderer(c.canvas,{document,grid:false,pixelRatio:1});Object.assign(renderer.camera,{centerX:0,centerY:0,scale:2});c.marks.length=0
 return{sdk,document,dim,insert,renderer,marks:c.marks,matrix:multiply3(outer,inner),local:projectDimension(dim.payload,document.getObject(dim.payload.styleId).payload)}
}

test('nested nonuniform reflected INSERT transforms styled annotation graphics and labels without measuring transformed definitions',async()=>{
 for(const [kind,reflex]of [['ALIGNED',false],['ANGULAR_3_POINT',false],['ANGULAR_3_POINT',true]]){
  const{document,renderer,marks,matrix,local}=await nestedFixture(kind,reflex),before=document.serialize(),report=renderer.render()
  assert.equal(report.unsupported,0);const label=marks.find(m=>m.type==='text');assert.equal(label.text,local.label.text)
  const expected=renderer.worldToScreen(map(matrix,local.label.position));label.position.forEach((x,i)=>close(x,expected[i]))
  if(local.arcs.length){const actual=marks.find(m=>m.type==='arc'),arc=local.arcs[0],center=renderer.worldToScreen(map(matrix,arc.center));actual.center.forEach((x,i)=>close(x,center[i]));close(actual.u[0],matrix[0]*arc.radius*2);close(actual.u[1],-matrix[1]*arc.radius*2);close(actual.v[0],-matrix[2]*arc.radius*2);close(actual.v[1],matrix[3]*arc.radius*2)}
  assert.equal(document.serialize(),before);renderer.dispose()
 }
})

test('selection follows the true transformed angular arc and styled label, including nested reflection',async()=>{
 for(const reflex of [false,true]){
  const {document,renderer,insert,matrix,local}=await nestedFixture('ANGULAR_3_POINT',reflex),arc=local.arcs[0],angle=arc.startAngle+(arc.endAngle-arc.startAngle)*.3
  const p=[arc.center[0]+arc.radius*Math.cos(angle),arc.center[1]+arc.radius*Math.sin(angle)],a=map(matrix,[p[0]*.99,p[1]*.99]),b=map(matrix,[p[0]*1.01,p[1]*1.01]),q=map(matrix,p)
  assert.deepEqual(selectEntitiesByFence(document,[a,b]),[insert.id]);assert.deepEqual(selectEntitiesInBox(document,[q[0]-.01,q[1]-.01],[q[0]+.01,q[1]+.01],'crossing'),[insert.id])
  const label=map(matrix,local.label.position);assert.deepEqual(selectEntitiesInBox(document,[label[0]-.02,label[1]-.02],[label[0]+.02,label[1]+.02],'crossing'),[insert.id])
  assert.deepEqual(selectEntitiesByFence(document,[[900,900],[901,901]]),[]);renderer.dispose()
 }
})

test('a nested model-space dimension keeps its original measurement through a paper viewport',async()=>{
 const{sdk,document,renderer}=await nestedFixture('ALIGNED');renderer.dispose()
 const layout=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Nested block sheet'});await sdk.executeCommand('VIEWPORT',{layoutId:layout.id,center:[50,50],width:40,height:30,viewCenter:[0,0],viewHeight:200,twistAngle:.2})
 const c=recordingCanvas(),paper=new KJCanvasRenderer(c.canvas,{document,spaceId:layout.payload.blockRecordId,grid:false,pixelRatio:1});c.marks.length=0;const result=paper.render();assert.equal(result.unsupported,0);assert.ok(c.marks.some(m=>m.type==='text'&&m.text==='50'));paper.dispose()
})
