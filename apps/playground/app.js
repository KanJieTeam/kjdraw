import { createKJDrawSDK, KJProjectSession, instantiateKJCoreWasm, createWasmGeometryBackend, registerGeometryBackend, createKJCoreDocumentAuthority, createKJCoreSolidBackend } from '../../packages/kjdraw-sdk/src/index.js'
import { createSample } from '../../examples/sample.js'

const $ = id => document.getElementById(id)
const canvas = $('canvas'), ctx = canvas.getContext('2d')
const camera = { x: 60, y: 38, scale: 4 }
const colors = ['#c8d7e7','#ee9999','#e8d697','#bdf878','#7db9e4','#b795db','#de91bf','#b8c7d8','#637b91']
const visibleTypes = new Set(['LINE','CIRCLE','ARC','POINT','LWPOLYLINE','POLYLINE','TEXT','MTEXT'])
let sdk, session, selection = null, tool = 'select', start = null, cursor = null, snapEnabled = true, pendingPlan = null, pan = null, busy = false, authority = null, solidAuthority = null, width = 1, height = 1
const doc = () => sdk.activeDocument
const message = text => { $('status').textContent = text }
const point = p => [(p[0]-camera.x)*camera.scale+width/2, height/2-(p[1]-camera.y)*camera.scale]
const world = p => [(p[0]-width/2)/camera.scale+camera.x, (height/2-p[1])/camera.scale+camera.y]
const modelEntities = () => doc().listEntities({ ownerId: doc().snapshot().spaces.modelSpaceId })
function invalidatePlan() { pendingPlan = null; $('confirm').disabled = true; $('plan-state').textContent = 'Preview a change before committing it.' }
function setTool(value) {
  tool = value; start = null
  for (const b of document.querySelectorAll('[data-tool]')) { b.classList.toggle('active', b.dataset.tool === tool); b.setAttribute('aria-pressed', String(b.dataset.tool === tool)) }
  $('hint').textContent = tool === 'select' ? 'Scroll to zoom · middle-drag to pan · click to inspect' : `${tool === 'line' ? 'LINE: first point, then endpoint' : 'CIRCLE: center, then radius'} · Esc to cancel`
  render()
}
function layerColor(entity) {
  const layer = doc().getObject(entity.payload?.layerId)
  return colors[Math.abs(Number(layer?.payload?.color ?? 7)) % colors.length]
}
function isVisible(entity) { if (!entity) return false; const p = doc().getObject(entity.payload?.layerId)?.payload; return p?.visible !== false && !p?.frozen }
function drawEntity(entity, color, offset = [0,0], dashed = false) {
  const p = entity.payload
  const map = v => point([v[0]+offset[0],v[1]+offset[1]])
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = entity.id === selection ? 2 : 1; ctx.setLineDash(dashed ? [5,4] : [])
  ctx.beginPath()
  if (entity.type === 'LINE') { ctx.moveTo(...map(p.start)); ctx.lineTo(...map(p.end)); ctx.stroke() }
  else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
    const [x,y] = map(p.center)
    ctx.arc(x,y,p.radius*camera.scale,entity.type === 'ARC' ? -p.startAngle : 0,entity.type === 'ARC' ? -p.endAngle : Math.PI*2,entity.type === 'ARC'); ctx.stroke()
  } else if (entity.type === 'POINT') { const [x,y] = map(p.position); ctx.moveTo(x-3,y);ctx.lineTo(x+3,y);ctx.moveTo(x,y-3);ctx.lineTo(x,y+3);ctx.stroke() }
  else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
    const [x,y] = map(p.position); ctx.save(); ctx.translate(x,y);ctx.rotate(-(p.rotation ?? 0));ctx.font = `${Math.max(4,(p.height ?? 1)*camera.scale)}px Consolas, monospace`;ctx.fillText(p.text ?? '',0,0);ctx.restore()
  } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
    const verts = p.vertices ?? []; if (verts.some(v => v.bulge)) return
    verts.forEach((v,i) => { const q = map(v.point ?? v); i ? ctx.lineTo(...q) : ctx.moveTo(...q) }); if (p.closed) ctx.closePath(); ctx.stroke()
  }
  ctx.setLineDash([])
}
function rendererSupports(entity) { return visibleTypes.has(entity.type) && !(['LWPOLYLINE','POLYLINE'].includes(entity.type) && entity.payload.vertices?.some(v => v.bulge)) }
function render() {
  if (!sdk?.activeDocument) return
  const ratio = window.devicePixelRatio || 1
  ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height)
  let grid = 10; while(grid*camera.scale<24)grid*=2; while(grid*camera.scale>100)grid/=2
  const a = world([0,height]), b = world([width,0]); ctx.fillStyle='#243349'
  for(let x=Math.ceil(a[0]/grid)*grid;x<b[0];x+=grid)for(let y=Math.ceil(a[1]/grid)*grid;y<b[1];y+=grid){const [px,py]=point([x,y]);ctx.fillRect(px,py,1,1)}
  const entities = modelEntities()
  for (const entity of entities) if(isVisible(entity))drawEntity(entity,entity.id === selection ? '#edffd8' : layerColor(entity))
  if(pendingPlan)for(const entity of entities)if(pendingPlan.ids.includes(entity.id))drawEntity(entity,'#e4bc7b',[pendingPlan.dx,0],true)
  if(start && cursor)drawEntity({type:tool==='circle'?'CIRCLE':'LINE',payload:tool==='circle'?{center:start,radius:Math.hypot(cursor[0]-start[0],cursor[1]-start[1])}:{start,end:cursor}},'#bdf878',[0,0],true)
}
function resize() {
  const rect = canvas.getBoundingClientRect();width=rect.width;height=rect.height
  const ratio = window.devicePixelRatio || 1;canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);render()
}
function bounds() {
  const coords=[]
  for(const e of modelEntities()) {
    const p=e.payload
    if(p.start)coords.push(p.start);if(p.end)coords.push(p.end);if(p.position)coords.push(p.position)
    if(p.center)coords.push([p.center[0]-(p.radius??0),p.center[1]-(p.radius??0)],[p.center[0]+(p.radius??0),p.center[1]+(p.radius??0)])
    for(const v of p.vertices??[])coords.push(v.point??v)
  }
  const valid=coords.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]))
  if(!valid.length)return [0,0,100,80]
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity
  for(const [x,y] of valid){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
  return [x0,y0,x1,y1]
}
function fit(){const [x0,y0,x1,y1]=bounds();camera.x=(x0+x1)/2;camera.y=(y0+y1)/2;camera.scale=Math.max(.00001,Math.min((width-70)/Math.max(1,x1-x0),(height-145)/Math.max(1,y1-y0)));render()}
function field(container,label,value) { const row=document.createElement('div');row.className='kv';const k=document.createElement('span'),v=document.createElement('b');k.textContent=label;v.textContent=String(value);row.append(k,v);container.append(row) }
function refresh() {
  $('entity-count').textContent=`${doc().listEntities().length} entities`;$('revision').textContent=`REV ${doc().revision}`
  $('undo').disabled=!doc().history.canUndo;$('redo').disabled=!doc().history.canRedo
  const layers=doc().getTable('layers').records;$('layer-count').textContent=layers.length
  $('layers').replaceChildren()
  for(const layer of layers){const label=document.createElement('label');label.className='layer';const input=document.createElement('input');input.type='checkbox';input.checked=layer.payload.visible!==false;input.setAttribute('aria-label',`Show layer ${layer.name}`);input.onchange=()=>run(()=>execute('LAYERUPDATE',{id:layer.id,patch:{visible:input.checked}}));const name=document.createElement('span');name.textContent=layer.name;const count=document.createElement('small');count.textContent=doc().listEntities().filter(e=>e.payload.layerId===layer.id).length;label.append(input,name,count);$('layers').append(label)}
  const entity=selection?doc().getObject(selection):null; if(!entity)selection=null
  $('inspector').replaceChildren();const title=document.createElement('h3');title.textContent=entity?entity.type:'Drawing document';$('inspector').append(title)
  if(entity){field($('inspector'),'Handle',entity.handle);field($('inspector'),'Layer',doc().getObject(entity.payload.layerId)?.name??'0');if(entity.payload.radius)field($('inspector'),'Radius',entity.payload.radius.toFixed(3));if(entity.payload.text)field($('inspector'),'Text',entity.payload.text);const erase=document.createElement('button');erase.textContent='Delete selected';erase.onclick=()=>run(()=>execute('ERASE',{ids:[selection]}));$('inspector').append(erase)}
  else {field($('inspector'),'Revision',doc().revision);field($('inspector'),'Model entities',modelEntities().length);field($('inspector'),'Kernel',authority?'Rust / WASM':'JS reference');field($('inspector'),'Units',doc().snapshot().header.units??'unspecified')}
  const omitted=modelEntities().filter(e=>!rendererSupports(e)).length
  if(omitted){const warning=document.createElement('p');warning.textContent=`${omitted} entities not drawn by this minimal viewer. Preserved in the document; use KJP for lossless storage.`;$('inspector').append(warning)}
  render()
}
async function execute(command,args={},options={}) {
  invalidatePlan()
  const result=await sdk.executeCommandEnvelope(sdk.createCommandEnvelope(command,args,{expectedRevision:doc().revision,origin:'ui',...options}))
  $('file-state').textContent='Modified in memory';message(`${command} committed · revision ${doc().revision}`);refresh();return result
}
async function run(work){if(busy)return;busy=true;try{await work()}catch(e){message(e.cause?.message??e.message);console.error(e)}finally{busy=false}}
async function freshSample(){const next=createKJDrawSDK({documentAuthority:authority,solidAuthority});const document=await createSample(next);session?.destroy();sdk=next;session=KJProjectSession.create({sdk,id:'sample-field-station',title:'Field station',documents:[document],metadata:{synthetic:true}});selection=null;invalidatePlan();$('file-name').textContent='Field station';$('drawing-title').textContent='Concept plan';$('file-state').textContent='In memory';refresh();fit();message('Synthetic sample · local execution · no uploads')}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function openFile(file){
  if(!file)return
  if(file.size>20*1024*1024)throw new Error('Playground file limit: 20 MiB. Use the SDK directly for larger files.')
  const next=createKJDrawSDK({documentAuthority:authority,solidAuthority});let project
  if(file.name.toLowerCase().endsWith('.kjp'))project=await KJProjectSession.open(new Uint8Array(await file.arrayBuffer()),{sdk:next})
  else {const format=file.name.toLowerCase().endsWith('.dxf')?'DXF':'KJD';const drawing=await next.readDocument(format==='DXF'?new Uint8Array(await file.arrayBuffer()):await file.text(),{format});project=KJProjectSession.create({sdk:next,title:file.name,documents:[drawing]})}
  session?.destroy();sdk=next;session=project;selection=null;invalidatePlan();setTool('select');$('file-name').textContent=file.name;$('drawing-title').textContent=project.activeDocument.id;$('file-state').textContent='Opened locally';refresh();fit();message('File opened locally · unsupported view entities remain in the document')
}
$('open').onclick=()=>$('file-input').click()
$('file-input').onchange=e=>run(async()=>{try{await openFile(e.target.files[0])}finally{e.target.value=''}})
$('save').onclick=()=>run(async()=>{const bytes=await session.package();download(bytes,'drawing.kjp','application/zip');message('KJP download requested · includes every drawing in this project')})
$('export').onclick=()=>run(async()=>{const text=await sdk.writeDocument(doc(),{format:'DXF',version:'2018'});download(text,'drawing.dxf','application/dxf');message('ASCII DXF 2018 downloaded · core adapter, see compatibility limits')})
$('undo').onclick=()=>run(()=>execute('UNDO'));$('redo').onclick=()=>run(()=>execute('REDO'));$('fit').onclick=fit
$('reset').onclick=()=>run(async()=>{if(window.confirm('Replace the open project with the sample? Download KJP first to keep your changes.'))await freshSample()})
$('snap').onclick=()=>{snapEnabled=!snapEnabled;$('snap').textContent=`SNAP ${snapEnabled?'ON':'OFF'}`;$('snap').setAttribute('aria-pressed',String(snapEnabled))}
for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>setTool(b.dataset.tool)
$('shift').oninput=()=>{invalidatePlan();render()}
$('plan').onclick=()=>run(async()=>{
  const dx=Number($('shift').value);if(!Number.isFinite(dx)||Math.abs(dx)>100)throw new Error('Choose a distance between -100 and 100 meters.')
  const layer=doc().getTable('layers').records.find(x=>x.name==='Survey points');const ids=layer?modelEntities().filter(e=>e.payload.layerId===layer.id).map(e=>e.id):[]
  if(!ids.length)throw new Error('This demo targets the sample’s Survey points layer. Reload the sample to try it.')
  const envelope=sdk.createCommandEnvelope('MOVE',{ids,dx,dy:0},{origin:'ai',mode:'plan',expectedRevision:doc().revision})
  await sdk.executeCommandEnvelope(envelope)
  pendingPlan={envelope,ids,dx,documentId:doc().id,fingerprint:doc().fingerprint()}
  $('plan-state').textContent=`${ids.length} entities · X ${dx>=0?'+':''}${dx.toFixed(2)} m · revision ${doc().revision}. Amber = proposed position.`;$('confirm').disabled=false;render();message('Plan previewed · document unchanged')
})
$('confirm').onclick=()=>run(async()=>{
  const plan=pendingPlan;if(!plan)throw new Error('Preview a plan first.')
  if(doc().id!==plan.documentId||doc().revision!==plan.envelope.expectedRevision||doc().fingerprint()!==plan.fingerprint){invalidatePlan();throw new Error('Drawing changed. Generate a fresh preview.')}
  const envelope=sdk.createCommandEnvelope(plan.envelope.command,plan.envelope.arguments,{origin:'ai',expectedRevision:plan.envelope.expectedRevision,confirmation:{status:'confirmed',planId:plan.envelope.id,confirmedBy:'playground-user'}})
  const receipt=await sdk.executeCommandEnvelope(envelope);invalidatePlan();$('plan-state').textContent=`Committed revision ${receipt.afterRevision}. Undo restores the previous geometry.`;$('file-state').textContent='Modified in memory';refresh();message(`AI-origin command committed · receipt ${receipt.commandEnvelopeId}`)
})
function pointer(e){const r=canvas.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]}
function snap(p){if(!snapEnabled||!sdk)return p;const hits=sdk.snap(p,{radius:8/camera.scale,modes:['endpoint','midpoint','center','nearest']});return hits[0]?.point??p}
canvas.onpointermove=e=>{
  const p=pointer(e)
  if(pan){camera.x=pan.x-(p[0]-pan.p[0])/camera.scale;camera.y=pan.y+(p[1]-pan.p[1])/camera.scale;render();return}
  cursor=snap(world(p));$('coordinates').textContent=`X ${cursor[0].toFixed(2)} · Y ${cursor[1].toFixed(2)}`;if(start)render()
}
canvas.onpointerdown=e=>{
  if(e.button===1){e.preventDefault();pan={p:pointer(e),x:camera.x,y:camera.y};canvas.setPointerCapture(e.pointerId);return}
  if(e.button!==0||busy)return
  const p=snap(world(pointer(e)))
  if(tool==='select'){
    const candidates=sdk.snap(world(pointer(e)),{radius:10/camera.scale,modes:['nearest','center','endpoint']});selection=candidates.find(c=>isVisible(doc().getObject(c.entityIds[0])))?.entityIds[0]??null;refresh();return
  }
  if(!start){start=p;cursor=p;message(tool==='line'?'Choose endpoint':'Choose radius');return}
  const initial=start;start=null
  run(async()=>{if(tool==='circle'){const radius=Math.hypot(p[0]-initial[0],p[1]-initial[1]);if(radius<1e-9)throw new Error('Circle radius must be positive.');await execute('CREATE',{type:'CIRCLE',payload:{center:initial,radius}})}else await execute('CREATE',{type:'LINE',payload:{start:initial,end:p}})})
}
canvas.onpointerup=()=>{pan=null};canvas.onpointercancel=()=>{pan=null;start=null;render()}
canvas.addEventListener('wheel',e=>{e.preventDefault();const p=pointer(e),a=world(p);camera.scale=Math.min(10000,Math.max(.00001,camera.scale*Math.exp(-e.deltaY*.001)));const b=world(p);camera.x+=a[0]-b[0];camera.y+=a[1]-b[1];render()},{passive:false})
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA'].includes(e.target.tagName))return;if(e.key==='Escape'){setTool('select');invalidatePlan();render()}if(e.key.toLowerCase()==='l')setTool('line');if(e.key.toLowerCase()==='c')setTool('circle');if(e.key.toLowerCase()==='v')setTool('select');if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();run(()=>execute(e.shiftKey?'REDO':'UNDO'))}})
new ResizeObserver(resize).observe(canvas)
try {
  const {instance}=await instantiateKJCoreWasm(new URL('../../web/public/kjcore/kjcore.wasm',import.meta.url))
  registerGeometryBackend(createWasmGeometryBackend(instance));authority=createKJCoreDocumentAuthority(instance);solidAuthority=createKJCoreSolidBackend(instance)
} catch(e){message('WASM unavailable · JavaScript reference mode');console.warn(e.message)}
await freshSample();resize();fit()
