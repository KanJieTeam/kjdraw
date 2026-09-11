import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../src/sdk.js'
import { exportDrawingSvg } from '../src/svg-export.js'

async function fixture(){
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
  const layoutId=document.snapshot().spaces.layoutIds[1],ownerId=document.getObject(layoutId).payload.blockRecordId
  await sdk.executeCommand('PLOTSETUP',{layoutId,dxf:{paperWidth:420,paperHeight:297,paperUnits:1,scaleNumerator:1,scaleDenominator:1,plotType:5,flags:0,marginLeft:10,marginRight:10,marginTop:10,marginBottom:10}})
  const create=async(type,payload,owner=ownerId)=>sdk.executeCommand('CREATE',{type,payload,options:{ownerId:owner}},{document})
  return {sdk,document,layoutId,ownerId,create}
}
const python=process.env.KJDRAW_PYTHON??(process.platform==='win32'?'python':'python3')
const parseSvg=(svg)=>{
  const script=String.raw`
import sys,json,math,re,xml.etree.ElementTree as E
root=E.fromstring(sys.stdin.buffer.read());ns='{http://www.w3.org/2000/svg}'
def mul(a,b):
 return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
def transform(s):
 m=[1,0,0,1,0,0]
 for name,body in re.findall(r'(matrix|translate|scale|rotate)\(([^)]*)\)',s):
  p=list(map(float,re.split(r'[ ,]+',body)))
  if name=='matrix':v=p
  elif name=='translate':v=[1,0,0,1,p[0],p[1] if len(p)>1 else 0]
  elif name=='scale':v=[p[0],0,0,p[1] if len(p)>1 else p[0],0,0]
  else:
   a=p[0]*math.pi/180;v=[math.cos(a),math.sin(a),-math.sin(a),math.cos(a),0,0]
  m=mul(m,v)
 return m
lines=[];groups=[]
def visit(e,m,id=None):
 m=mul(m,transform(e.get('transform','')));id=e.get('data-entity-id',id)
 if e.tag==ns+'g' and 'data-entity-id' in e.attrib:groups.append({**dict(e.attrib),'matrix':m})
 if e.tag==ns+'line':
  def at(x,y):return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]
  lines.append({'id':id,'start':at(float(e.get('x1')),float(e.get('y1'))),'end':at(float(e.get('x2')),float(e.get('y2')))})
 for child in e:visit(child,m,id)
visit(root,[1,0,0,1,0,0])
print(json.dumps({'root':dict(root.attrib),'lines':lines,'groups':groups,'texts':[e.text for e in root.iter(ns+'text')],'clips':[dict(e.attrib) for c in root.iter(ns+'clipPath') for e in c],'tags':[e.tag for e in root.iter()],'metadata':json.loads(root.find(ns+'metadata').text)}))
`
  const result=spawnSync(python,['-c',script],{input:svg,encoding:'utf8',maxBuffer:8_388_608})
  assert.equal(result.status,0,result.stderr||result.error?.message)
  return JSON.parse(result.stdout)
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`)

test('A3 vector SVG has physical millimeters and exact 1:100 viewport geometry, clips, layer styles and native dimension values',async()=>{
  const {sdk,document,layoutId,create}=await fixture(),model=document.snapshot().spaces.modelSpaceId
  let dashed,frozen,noPlot
  await document.transact('fixture layers',tx=>{
    const type=tx.upsertTableRecord('linetypes',{name:'ENGINEERING_DASH',type:'LINETYPE',payload:{pattern:[300,-100]}})
    dashed=tx.upsertTableRecord('layers',{name:'Engineering <A>&',type:'LAYER',payload:{color:1,lineweight:35,linetypeId:type.id,visible:true}})
    const continuous=document.getTable('linetypes').records.find(row=>row.name==='CONTINUOUS').id
    frozen=tx.upsertTableRecord('layers',{name:'Frozen in viewport',type:'LAYER',payload:{color:2,linetypeId:continuous,visible:true}})
    noPlot=tx.upsertTableRecord('layers',{name:'Not printable',type:'LAYER',payload:{color:3,linetypeId:continuous,visible:true,plottable:false}})
  })
  const line=await create('LINE',{start:[0,0,0],end:[1000,0,0],layerId:dashed.id},model)
  const hidden=await create('LINE',{start:[0,0,0],end:[0,1000,0],layerId:frozen.id},model)
  const noPrint=await create('LINE',{start:[0,0,0],end:[30000,0,0],layerId:noPlot.id},model)
  const dimension=await create('DIMENSION',{dimensionType:'ALIGNED',definitionPoints:[[500,300,0],[0,0,0],[1000,0,0]],textHeight:250,measurement:999},model)
  await sdk.executeCommand('VIEWPORT',{layoutId,center:[100,100],width:200,height:100,viewCenter:[0,0],viewHeight:10000,frozenLayerIds:[frozen.id]})
  const label='A3 <script>alert("x")</script> & 中文 😀'
  await create('TEXT',{position:[5,5],text:label,height:3})
  const before=document.serialize(),history=document.history,result=exportDrawingSvg(document,{layoutId}),parsed=parseSvg(result.svg)
  assert.equal(document.serialize(),before);assert.deepEqual(document.history,history)
  assert.equal(parsed.root.width,'420mm');assert.equal(parsed.root.height,'297mm');assert.equal(parsed.root.viewBox,'0 0 420 297')
  const projected=parsed.lines.find(row=>row.id===line.id)
  near(projected.start[0],110);near(projected.start[1],187);near(projected.end[0],120);near(projected.end[1],187)
  assert.ok(!parsed.lines.some(row=>row.id===hidden.id||row.id===noPrint.id))
  const style=parsed.groups.find(row=>row['data-entity-id']===line.id)
  assert.equal(style['data-layer-name'],'Engineering <A>&');near(Number(style['stroke-width'])*Math.hypot(style.matrix[0],style.matrix[1]),.35);assert.deepEqual(style['stroke-dasharray'].split(' ').map(Number).map(value=>value*Math.hypot(style.matrix[0],style.matrix[1])),[3,1]);assert.equal(style.color,'#ff0000')
  assert.ok(parsed.clips.some(clip=>clip.x==='0'&&clip.y==='50'&&clip.width==='200'&&clip.height==='100'))
  assert.ok(parsed.texts.includes('1000'));assert.ok(!parsed.texts.includes('999'));assert.ok(parsed.texts.includes(label))
  assert.ok(!parsed.tags.some(tag=>/script|image|foreignObject/.test(tag)))
  assert.equal(result.report.status,'approximate');assert.equal(result.report.hidden,2);assert.equal(result.report.diagnostics.length,0)
  assert.equal(result.report.viewports[0].millimetersPerModelUnit,.01)
  assert.ok(result.report.approximations.some(row=>row.entityId===dimension.id))
  assert.deepEqual(parsed.metadata,JSON.parse(JSON.stringify(result.report)))
})

test('twisted DCS viewport uses independent target and center math, while model-window custom scales stay exact',async()=>{
  const {sdk,document,layoutId,create}=await fixture(),model=document.snapshot().spaces.modelSpaceId
  const line=await create('LINE',{start:[30,40],end:[40,40]},model)
  const viewport=await sdk.executeCommand('VIEWPORT',{layoutId,center:[100,100],width:100,height:100,viewCenter:[5,10],viewHeight:50,twistAngle:Math.PI/2})
  await document.transact('explicit viewport target',tx=>tx.updateObject(viewport.id,{payload:{viewTarget:[30,40,0]}}))
  let parsed=parseSvg(exportDrawingSvg(document,{layoutId}).svg),projected=parsed.lines.find(row=>row.id===line.id)
  near(projected.start[0],100);near(projected.start[1],207);near(projected.end[0],100);near(projected.end[1],187)
  const modelLayout=document.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PLOTSETUP',{layoutId:modelLayout,dxf:{paperWidth:420,paperHeight:297,paperUnits:1,plotType:4,flags:0,windowMinX:30,windowMinY:40,windowMaxX:50,windowMaxY:60,scaleNumerator:2,scaleDenominator:1}})
  parsed=parseSvg(exportDrawingSvg(document,{layoutId:modelLayout}).svg);projected=parsed.lines.find(row=>row.id===line.id)
  near(projected.start[0],0);near(projected.start[1],297);near(projected.end[0],20);near(projected.end[1],297)
})

test('SVG retains exact arc and bulge commands and expands nested blocks with correct DXF SOLID winding',async()=>{
  const {document,layoutId}=await fixture()
  let line,solid,arc
  await document.transact('native block drawing',tx=>{
    const block=tx.upsertTableRecord('blockRecords',{name:'Nested symbols',type:'BLOCK_RECORD',payload:{basePoint:[0,0,0],isSpace:false}})
    line=tx.createEntity('LINE',{start:[0,0,0],end:[10,0,0]},{ownerId:block.id})
    const outer=tx.upsertTableRecord('blockRecords',{name:'Outer',type:'BLOCK_RECORD',payload:{basePoint:[0,0,0],isSpace:false}})
    tx.createEntity('INSERT',{blockRecordId:block.id,position:[5,0,0],scale:[2,2,1]},{ownerId:outer.id})
    tx.createEntity('INSERT',{blockRecordId:outer.id,position:[20,20,0],scale:[1,1,1]},{ownerId:document.getObject(layoutId).payload.blockRecordId})
    const ownerId=document.getObject(layoutId).payload.blockRecordId
    solid=tx.createEntity('SOLID',{vertices:[[0,0],[10,0],[0,10],[10,10]]},{ownerId})
    arc=tx.createEntity('ARC',{center:[30,30],radius:5,startAngle:0,endAngle:Math.PI*1.5},{ownerId})
    tx.createEntity('LWPOLYLINE',{vertices:[{point:[0,0],bulge:1},{point:[10,0],bulge:0}],closed:false},{ownerId})
  })
  const result=exportDrawingSvg(document,{layoutId}),parsed=parseSvg(result.svg)
  const projected=parsed.lines.find(row=>row.id===line.id)
  near(projected.start[0],35);near(projected.end[0],55)
  assert.match(result.svg,/M 0 0 L 10 0 L 10 10 L 0 10 L 0 0 Z/)
  assert.match(result.svg,/A 5 5 0 1 1/);assert.match(result.svg,/M 0 0 A 5 5 0 0 1 10 0/)
  assert.equal(result.report.status,'complete');assert.equal(result.report.rendered,4)
})

test('visible unsupported geometry rejects the whole default SVG; explicit partial reports omissions and hidden geometry is excluded',async()=>{
  const {document,layoutId,create}=await fixture()
  await create('LINE',{start:[0,0],end:[10,0]})
  const ray=await create('RAY',{origin:[0,0],direction:[1,0]})
  const before=document.serialize()
  assert.throws(()=>exportDrawingSvg(document,{layoutId}),error=>error.details?.diagnostics.some(row=>row.entityId===ray.id))
  const partial=exportDrawingSvg(document,{layoutId,allowPartial:true})
  assert.equal(partial.report.status,'partial');assert.equal(parseSvg(partial.svg).metadata.diagnostics[0].entityId,ray.id)
  assert.equal(document.serialize(),before)
  await document.transact('hide construction',tx=>tx.updateObject(ray.id,{payload:{visible:false}}))
  assert.equal(exportDrawingSvg(document,{layoutId}).report.status,'complete')
  assert.throws(()=>exportDrawingSvg(document,{layoutId,maxEntities:1}),/budget/)
})

test('SVG refuses unsupported page transformations and native 3D, fitted text and unpositioned attribute values without silently changing semantics',async()=>{
  for(const payload of [{flags:4},{rotation:1},{flags:16},{paperUnits:2},{styleSheet:'unknown.ctb'}]){
    const {sdk,document,layoutId}=await fixture()
    await sdk.executeCommand('PLOTSETUP',{layoutId,dxf:payload})
    assert.throws(()=>exportDrawingSvg(document,{layoutId}),/SVG export/)
  }
  for(const [type,payload] of [
    ['POLYLINE',{vertices:[[0,0],[1,1]],dxfFlags:8}],
    ['TEXT',{position:[0,0],alignmentPoint:[10,0],text:'fitted',height:3,horizontalAlignment:5}],
    ['LINE',{start:[0,0,1],end:[1,1,1]}],
    ['CIRCLE',{center:[0,0],radius:1,normal:[0,1,0]}],
    ['TEXT',{position:[0,0],text:'invalid\u0001XML',height:3}],
  ]){
    const {document,layoutId,create}=await fixture();const entity=await create(type,payload)
    assert.throws(()=>exportDrawingSvg(document,{layoutId}),error=>error.details?.diagnostics.some(row=>row.entityId===entity.id))
  }
  const {document,layoutId}=await fixture()
  await document.transact('attributed insert',tx=>{const block=tx.upsertTableRecord('blockRecords',{name:'Has attributes',type:'BLOCK_RECORD',payload:{basePoint:[0,0,0],isSpace:false}});tx.createEntity('INSERT',{blockRecordId:block.id,position:[0,0],attributes:{TAG:'value'}},{ownerId:document.getObject(layoutId).payload.blockRecordId})})
  assert.throws(()=>exportDrawingSvg(document,{layoutId}),error=>error.details?.diagnostics.some(row=>row.reason.includes('attributes')))
})

test('default SDK SVG writer exposes complete vector delivery but never permits silent partial output',async()=>{
  const {sdk,document,layoutId,create}=await fixture()
  await create('LINE',{start:[0,0],end:[20,0]})
  const svg=await sdk.writeDocument(document,{format:'SVG',layoutId})
  assert.equal(parseSvg(svg).root.width,'420mm')
  await assert.rejects(sdk.writeDocument(document,{format:'SVG',layoutId,allowPartial:true}))
  await create('RAY',{origin:[0,0],direction:[1,0]})
  await assert.rejects(sdk.writeDocument(document,{format:'SVG',layoutId}))
})
test('both angular dimension subtypes export actual circular SVG arcs and degree labels from the shared kernel',async()=>{
  const {document,layoutId,create}=await fixture()
  await create('DIMENSION',{dimensionType:'ANGULAR_3_POINT',definitionPoints:[[6,6,0],[10,0,0],[0,10,0],[0,0,0]]})
  await create('DIMENSION',{dimensionType:'ANGULAR',definitionPoints:[[30,0,0],[30,0,0],[40,0,0],[30,10,0],[36,6,0]]})
  const result=exportDrawingSvg(document,{layoutId}),parsed=parseSvg(result.svg)
  assert.deepEqual(parsed.texts,['90°','90°'])
  assert.equal((result.svg.match(/ A /g)??[]).length,2)
  assert.equal(result.report.rendered,2);assert.equal(result.report.diagnostics.length,0)
})

test('SVG source/revision guards and actual UTF-8 output budget reject without producing truncated files',async()=>{
  const {document,layoutId,create}=await fixture()
  await create('LINE',{start:[0,0],end:[1,0]})
  const original=document.snapshot.bind(document);let calls=0
  document.snapshot=()=>++calls>1?{...original()}:original()
  assert.throws(()=>exportDrawingSvg(document,{layoutId}),error=>error.code==='KJDOCUMENT_REVISION_CONFLICT')
  document.snapshot=original
  for(let i=0;i<3;i++)await create('TEXT',{position:[i,i],height:1,text:'&'.repeat(600000)})
  const before=document.serialize()
  assert.throws(()=>exportDrawingSvg(document,{layoutId}),/8 MiB budget/)
  assert.equal(document.serialize(),before)
})