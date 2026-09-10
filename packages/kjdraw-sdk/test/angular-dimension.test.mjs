import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../src/sdk.js'
import { projectDimension } from '../src/geometry/annotation.js'
import { KJCanvasRenderer } from '../src/canvas-renderer.js'
import { classifyEntityInBox, selectEntitiesInBox, selectEntitiesByFence } from '../src/selection-geometry.js'
const native=(t,script,input='')=>{
 const r=spawnSync(process.env.KJDRAW_PYTHON??'python',['-c',script],{input,encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
 if(r.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(r.stderr)){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(r.stderr||r.error.message);t.skip('ezdxf required');return null}
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)
}
const definition=(type,angle=90,placement=angle/2)=>{
 const a=angle*Math.PI/180,b=placement*Math.PI/180,tip=[10*Math.cos(a),10*Math.sin(a),0],base=[6*Math.cos(b),6*Math.sin(b),0]
 return {dimensionType:type,definitionPoints:type==='ANGULAR'?[tip,[0,0,0],[10,0,0],[0,0,0],base]:[base,[10,0,0],tip,[0,0,0]],textHeight:3,precision:2}
}
const inspect=String.raw`
import json,sys,io,ezdxf
D=ezdxf.read(io.StringIO(sys.stdin.read(),newline=None));out=[]
for e in D.modelspace().query('DIMENSION'):
 o=e.override();g=list(e.virtual_entities());before={'type':e.dimtype,'measurement':e.get_measurement(),'arcs':[{'center':list(a.dxf.center),'radius':a.dxf.radius,'start':a.dxf.start_angle,'end':a.dxf.end_angle} for a in g if a.dxftype()=='ARC'],'labels':[a.dxf.text for a in g if a.dxftype()=='TEXT'],'height':o.get('dimtxt'),'precision':o.get('dimadec'),'units':o.get('dimaunit')}
 o.render();before['regeneratedLabels']=[a.plain_text() if a.dxftype()=='MTEXT' else a.dxf.text for a in e.virtual_entities() if a.dxftype() in ['TEXT','MTEXT']];out.append(before)
a=D.audit();print(json.dumps({'dimensions':out,'errors':len(a.errors),'fixes':len(a.fixes)}))
`

test('two-line and three-point angular projection selects the arc placement sector instead of stale cached values',()=>{
 for(const type of ['ANGULAR','ANGULAR_3_POINT'])for(const angle of [37,90,180,270]){
  if(type==='ANGULAR'&&angle===180)continue
  const p=projectDimension({...definition(type,angle),measurement:999})
  const expected=type==='ANGULAR'&&angle===270?90:angle
  assert.ok(p);assert.ok(Math.abs(p.measurement-expected)<1e-9);assert.equal(p.label.text,`${expected}°`)
  assert.equal(p.arcs.length,1);assert.equal(p.arrows.length,2);assert.equal(p.lines.length,2)
  assert.ok(Math.abs((p.arcs[0].endAngle-p.arcs[0].startAngle)*180/Math.PI-expected)<1e-9)
  assert.ok(Math.abs(p.arcs[0].radius-6)<1e-9)
 }
 for(const [type,angle,placement,expected] of [['ANGULAR',37,108.5,143],['ANGULAR',37,198.5,37],['ANGULAR',37,288.5,143],['ANGULAR_3_POINT',90,225,270],['ANGULAR_3_POINT',270,315,90]])assert.ok(Math.abs(projectDimension(definition(type,angle,placement)).measurement-expected)<1e-9)
 for(const p of [definition('ANGULAR',90,0),definition('ANGULAR_3_POINT',90,90),definition('ANGULAR',0),definition('ANGULAR',180),{...definition('ANGULAR'),definitionPoints:definition('ANGULAR').definitionPoints.slice(0,4)},{...definition('ANGULAR_3_POINT'),definitionPoints:[[0,0],[10,0],[0,10],[0,0]]},{...definition('ANGULAR_3_POINT'),normal:[1,0,1]},{...definition('ANGULAR_3_POINT'),angularUnits:3}])assert.equal(projectDimension(p),null)
})

test('new angular dimensions export native ARC graphics and styles; 3-point regeneration agrees while the independent 2-line reversal is explicit',async t=>{
 const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
 for(const type of ['ANGULAR','ANGULAR_3_POINT'])for(const angle of [37,90,270])await sdk.executeCommand('CREATE',{type:'DIMENSION',payload:definition(type,angle)})
 const before=document.serialize(),dxf=await sdk.writeDocument(document,{format:'DXF'});assert.equal(document.serialize(),before)
 const result=native(t,inspect,dxf);if(!result)return
 assert.equal(result.errors,0);assert.equal(result.fixes,0)
 for(const [index,d]of result.dimensions.entries()){
  const angle=index===2?90:[37,90,270][index%3]
  assert.ok(Math.abs(d.measurement-angle)<1e-8);assert.equal(d.arcs.length,1);assert.ok(d.labels.includes(`${angle}°`),JSON.stringify(d))
  assert.deepEqual([d.height,d.precision,d.units],[3,2,0])
  if(d.type===5)assert.ok(d.regeneratedLabels.some(label=>label.includes(`${angle}`)&&label.includes('°')),JSON.stringify(d))
  else {
   // ezdxf 1.4.4's own 2-line factory renders the reversed reflex angle while
   // its get_measurement returns the requested CCW angle. Preserve native fields
   // and our correct picture block; do not reverse them to mask that discrepancy.
   assert.ok(d.regeneratedLabels.includes(`${360-angle}°`),JSON.stringify(d))
  }
 }
 const reopened=await createKJDrawSDK().readDocument(dxf,{format:'DXF'})
 for(const dimension of reopened.listEntities({ownerId:reopened.snapshot().spaces.modelSpaceId,type:'DIMENSION'})){assert.ok(projectDimension(dimension.payload));assert.equal(dimension.payload.precision,2)}
})

test('independent native angular dimensions survive MOVE, rotation, uniform scale and another SDK/DXF reopen',async t=>{
 const source=native(t,String.raw`
import ezdxf,io,json
D=ezdxf.new('R2018');m=D.modelspace()
m.add_angular_dim_3p(base=(6,6),center=(0,0),p1=(10,0),p2=(0,10)).render()
m.add_angular_dim_3p(base=(-6,-6),center=(0,0),p1=(10,0),p2=(0,-10)).render()
s=io.StringIO();D.write(s);print(json.dumps(s.getvalue()))
`);if(!source)return
 const sdk=createKJDrawSDK(),document=await sdk.readDocument(source,{format:'DXF'}),dimensions=document.listEntities({ownerId:document.snapshot().spaces.modelSpaceId,type:'DIMENSION'}),ids=dimensions.map(d=>d.id)
 const initial=dimensions.map(d=>projectDimension(d.payload)),radii=initial.map(d=>d.arcs[0].radius)
 const newTwoLine=await sdk.executeCommand('CREATE',{type:'DIMENSION',payload:definition('ANGULAR',37,108.5)});ids.push(newTwoLine.id);initial.push(projectDimension(newTwoLine.payload));radii.push(6)
 await sdk.executeCommand('MOVE',{ids,dx:1,dy:2})
 await sdk.executeCommand('ROTATE',{ids,center:[0,0],angle:Math.PI/6})
 await sdk.executeCommand('SCALE',{ids,center:[0,0],factor:2})
 for(const [i,id]of ids.entries()){const p=projectDimension(document.getObject(id).payload);assert.ok(Math.abs(p.measurement-initial[i].measurement)<1e-8);assert.ok(Math.abs(p.arcs[0].radius-radii[i]*2)<1e-8);const delta=p.arcs[0].startAngle-initial[i].arcs[0].startAngle-Math.PI/6;assert.ok(Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)))<1e-8);assert.ok(Math.abs((p.arcs[0].endAngle-p.arcs[0].startAngle)-(initial[i].arcs[0].endAngle-initial[i].arcs[0].startAngle))<1e-8)}
 const dxf=await sdk.writeDocument(document,{format:'DXF'}),result=native(t,inspect,dxf)
 assert.equal(result.errors+result.fixes,0)
 for(const [i,d] of result.dimensions.entries()){assert.ok(Math.abs(d.measurement-initial[i].measurement)<1e-8);assert.equal(d.arcs.length,1);assert.ok(d.labels.includes(initial[i].label.text),JSON.stringify(d));const delta=d.arcs[0].start*Math.PI/180-initial[i].arcs[0].startAngle-Math.PI/6;assert.ok(Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)))<1e-8)}
 const next=createKJDrawSDK(),reopened=await next.readDocument(dxf,{format:'DXF'})
 assert.equal(reopened.listEntities({ownerId:reopened.snapshot().spaces.modelSpaceId,type:'DIMENSION'}).length,3)
 await next.writeDocument(reopened,{format:'DXF'})
})

test('angular canvas renders a real arc, hit tests it and preserves its measured text through a paper viewport',async()=>{
 const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
 const entity=await sdk.executeCommand('CREATE',{type:'DIMENSION',payload:definition('ANGULAR_3_POINT')})
 const calls=[],ctx=new Proxy({},{get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true}),canvas={width:400,height:300,clientWidth:400,clientHeight:300,getContext:()=>ctx,getBoundingClientRect:()=>({width:400,height:300})}
 const renderer=new KJCanvasRenderer(canvas,{document,grid:false,padding:0,pixelRatio:1});Object.assign(renderer.camera,{centerX:0,centerY:0,scale:10});calls.length=0
 let report=renderer.render();assert.equal(report.unsupported,0);assert.ok(calls.some(c=>c[0]==='arc'&&Math.abs(c[3]-60)<1e-8));assert.ok(calls.some(c=>c[0]==='fillText'&&c[1]==='90°'))
 assert.equal(renderer.hitTest(renderer.worldToScreen([6/Math.sqrt(2),6/Math.sqrt(2)]),3)?.entity.id,entity.id);renderer.dispose()
 const layout=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Angles'});await sdk.executeCommand('VIEWPORT',{layoutId:layout.id,center:[50,50],width:40,height:20,viewCenter:[0,0],viewHeight:40,twistAngle:.2})
 const paper=new KJCanvasRenderer(canvas,{document,spaceId:layout.payload.blockRecordId,grid:false,padding:0,pixelRatio:1});Object.assign(paper.camera,{centerX:50,centerY:50,scale:10});calls.length=0
 report=paper.render();assert.equal(report.unsupported,0);assert.ok(calls.some(c=>c[0]==='arc'&&Math.abs(c[3]-30)<1e-8));assert.ok(calls.some(c=>c[0]==='fillText'&&c[1]==='90°'));paper.dispose()
})


test('independent two-line dimension factory itself reverses regeneration labels before SDK import',t=>{
 const result=native(t,String.raw`
import ezdxf,json,math
D=ezdxf.new('R2018');m=D.modelspace();result=[]
for angle in [37,90,270]:
 a=math.radians(angle);o=m.add_angular_dim_2l(base=(6*math.cos(a/2),6*math.sin(a/2)),line1=((0,0),(10,0)),line2=((0,0),(10*math.cos(a),10*math.sin(a))));o.render();d=o.dimension
 result.append({'requested':angle,'measured':d.get_measurement(),'labels':[e.plain_text() for e in d.virtual_entities() if e.dxftype()=='MTEXT']})
print(json.dumps(result))
`);if(!result)return
 for(const row of result){assert.ok(Math.abs(row.measured-row.requested)<1e-9);assert.ok(row.labels.includes(`${360-row.requested}°`))}
})

test('inconsistent imported two-line picture retains original reflex arc and label and refuses edited regeneration',async t=>{
 const source=native(t,String.raw`
import ezdxf,io,json
D=ezdxf.new('R2018');m=D.modelspace()
m.add_angular_dim_2l(base=(6,6),line1=((0,0),(10,0)),line2=((0,0),(0,10))).render()
s=io.StringIO();D.write(s);print(json.dumps(s.getvalue()))
`);if(!source)return
 const readPicture=String.raw`
import ezdxf,io,json,sys
D=ezdxf.read(io.StringIO(sys.stdin.read(),newline=None));d=list(D.modelspace().query('DIMENSION'))[0]
print(json.dumps({'labels':[e.plain_text() if e.dxftype()=='MTEXT' else e.dxf.text for e in d.virtual_entities() if e.dxftype() in ['TEXT','MTEXT']],'arcs':[[e.dxf.start_angle,e.dxf.end_angle,e.dxf.radius] for e in d.virtual_entities() if e.dxftype()=='ARC']}))
`
 const sdk=createKJDrawSDK(),document=await sdk.readDocument(source,{format:'DXF'})
 const prior=native(t,readPicture,source);assert.ok(prior.labels.includes('270°'))
 const unchanged=await sdk.writeDocument(document,{format:'DXF'});const retained=native(t,readPicture,unchanged);assert.deepEqual(retained.labels,prior.labels);assert.equal(retained.arcs.length,prior.arcs.length);for(const [i,arc]of retained.arcs.entries())for(const [j,value]of arc.entries())assert.ok(Math.abs(value-prior.arcs[i][j])<1e-10)
 const ids=document.listEntities({ownerId:document.snapshot().spaces.modelSpaceId,type:'DIMENSION'}).map(e=>e.id)
 await sdk.executeCommand('MOVE',{ids,dx:1,dy:2});await sdk.executeCommand('ROTATE',{ids,center:[0,0],angle:.4})
 const before=document.serialize();await assert.rejects(sdk.writeDocument(document,{format:'DXF'}),error=>/picture and definition sector/.test(error.cause?.message??error.message));assert.equal(document.serialize(),before)
})

test('native angular precision -1 inherits the reported per-entity linear precision',async t=>{
 const source=native(t,String.raw`
import ezdxf,io,json,math
D=ezdxf.new('R2018');a=math.radians(37.1254)
m=D.modelspace();o=m.add_angular_dim_3p(base=(6,3),center=(0,0),p1=(10,0),p2=(10*math.cos(a),10*math.sin(a)),override={'dimadec':3,'dimdec':3});o.render();o['dimadec']=-1;o.commit()
s=io.StringIO();D.write(s);print(json.dumps(s.getvalue()))
`);if(!source)return
 const sdk=createKJDrawSDK(),document=await sdk.readDocument(source,{format:'DXF'}),d=document.listEntities({ownerId:document.snapshot().spaces.modelSpaceId,type:'DIMENSION'})[0]
 assert.equal(d.payload.precision,-1);assert.equal(d.payload.linearPrecision,3);assert.equal(projectDimension(d.payload).label.text,'37.125°')
 await sdk.executeCommand('MOVE',{ids:[d.id],dx:2,dy:3});const out=await sdk.writeDocument(document,{format:'DXF'}),result=native(t,inspect,out)
 assert.equal(result.errors+result.fixes,0);assert.equal(result.dimensions[0].precision,3);assert.deepEqual(result.dimensions[0].labels,['37.125°'])
})

test('degenerate and non-XY angular dimensions fail export explicitly without changing document history',async()=>{
 for(const payload of [definition('ANGULAR',0),definition('ANGULAR',180),{...definition('ANGULAR_3_POINT'),definitionPoints:[[0,0],[10,0],[0,10],[0,0]]},{...definition('ANGULAR_3_POINT'),definitionPoints:[[6,6,2],[10,0,2],[0,10,2],[0,0,2]]},{...definition('ANGULAR_3_POINT'),angularUnits:3}]){
  const sdk=createKJDrawSDK(),document=sdk.createDocument();await sdk.executeCommand('CREATE',{type:'DIMENSION',payload})
  const before=document.serialize();await assert.rejects(sdk.writeDocument(document,{format:'DXF'}),error=>/degenerate|XY plane|decimal degrees/.test(error.cause?.message??error.message));assert.equal(document.serialize(),before)
 }
})


test('box classification, crossing and open fence select only the middle of the actual dimension arc',async()=>{
 const sdk=createKJDrawSDK(),document=sdk.createDocument();const entity=await sdk.executeCommand('CREATE',{type:'DIMENSION',payload:{...definition('ANGULAR_3_POINT'),textHeight:.2}})
 const x=6*Math.cos(Math.PI/6),y=3,box=[x-.03,y-.03,x+.03,y+.03]
 assert.equal(classifyEntityInBox(document,entity,box),'intersects')
 assert.deepEqual(selectEntitiesInBox(document,box.slice(0,2),box.slice(2),'crossing'),[entity.id])
 assert.deepEqual(selectEntitiesInBox(document,box.slice(0,2),box.slice(2),'window'),[])
 assert.deepEqual(selectEntitiesByFence(document,[[x*.98,y*.98],[x*1.02,y*1.02]]),[entity.id])
 assert.equal(classifyEntityInBox(document,entity,[-x-.03,-y-.03,-x+.03,-y+.03]),'outside')
 assert.deepEqual(selectEntitiesByFence(document,[[-x*.98,-y*.98],[-x*1.02,-y*1.02]]),[])
})
