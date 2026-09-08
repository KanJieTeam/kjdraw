import { createKJDrawSDK, KJProjectSession, instantiateKJCoreWasm, createWasmGeometryBackend, registerGeometryBackend, createKJCoreDocumentAuthority, createKJCoreSolidBackend, multiply3, rotation3, scale3, translation3, transformEntityPayload } from '../../packages/kjdraw-sdk/src/index.js'
import { createSample } from '../../examples/sample.js'
import { createI18n } from './i18n.js'
import { AGENT_REVISION_COMMAND, createShowcaseRevision, getShowcaseIntent, isShowcaseIntent, registerShowcaseCommand, resolveShowcasePreset } from './agent-showcase.js'

const $ = id => document.getElementById(id)
const i18n = createI18n(), t = key => i18n.t(key)
const workbench = document.querySelector('.workbench')
const canvas = $('canvas'), ctx = canvas.getContext('2d')
const camera = { x: 60, y: 38, scale: 4 }
const colors = ['#c8d7e7','#ee9999','#e8d697','#bdf878','#7db9e4','#b795db','#de91bf','#b8c7d8','#637b91']
const visibleTypes = new Set(['LINE','RAY','XLINE','CIRCLE','ARC','POINT','LWPOLYLINE','POLYLINE','ELLIPSE','SPLINE','TEXT','MTEXT','ATTDEF','ATTRIB','INSERT','HATCH','LEADER','MLEADER','DIMENSION','WIPEOUT','REVISION_CLOUD','SOLID','TRACE','TABLE','VIEWPORT'])
let sdk, session, selection = new Set(), tool = 'select', start = null, draft = [], cursor = null, snapEnabled = true, gridEnabled = true, orthoEnabled = false, pendingPlan = null, pan = null, busy = false, authority = null, solidAuthority = null, measurement = '', width = 1, height = 1, lastReceipt = null
const doc = () => sdk.activeDocument
const documentTitle = drawing => drawing?.id === 'sample-resilient-campus' && i18n.locale === 'zh'
  ? '韧性能源园区 / 总协调图'
  : drawing?.snapshot().metadata?.title || drawing?.id || ''
const selectedIds = () => [...selection].filter(id => doc()?.getObject(id))
const primarySelection = () => selectedIds().at(-1) ?? null
function replaceSelection(ids = []) { selection = new Set(ids.filter(id => doc()?.getObject(id))) }
const message = text => { $('status').textContent = text }
const point = p => [(p[0]-camera.x)*camera.scale+width/2, height/2-(p[1]-camera.y)*camera.scale]
const world = p => [(p[0]-width/2)/camera.scale+camera.x, (height/2-p[1])/camera.scale+camera.y]
const modelEntities = () => doc().listEntities({ ownerId: doc().snapshot().spaces.modelSpaceId })
const currentIntent = preset => getShowcaseIntent(i18n.locale,preset)
const knownIntent = value => isShowcaseIntent(value)
function setCanonicalIntent({ preserveCustom = false } = {}) {
  if (preserveCustom && $('agent-intent').value.trim() && !knownIntent($('agent-intent').value)) return
  $('agent-intent').value = currentIntent($('agent-preset').value)
}
function rejectPendingPlan() {
  if (!pendingPlan?.envelope?.id || !sdk?.agentPlans) return
  try { if (sdk.agentPlans.get(pendingPlan.envelope.id)?.status === 'active') sdk.agentPlans.reject(pendingPlan.envelope.id, 'playground-state-change') } catch {}
}
function invalidatePlan({ preserveReceipt = false } = {}) {
  rejectPendingPlan(); pendingPlan = null
  $('confirm').disabled = true
  $('plan-state').dataset.state = 'idle'
  $('plan-state').textContent = t('previewHelp')
  $('diff-legend').hidden = true; $('plan-details').hidden = true; $('plan-steps').replaceChildren()
  if ($('canvas-diff')) $('canvas-diff').hidden = true
  if (!preserveReceipt) { lastReceipt = null; $('receipt-panel').hidden = true; $('receipt-timeline').replaceChildren() }
}

function createAgentTask() {
  const preset=resolveShowcasePreset($('agent-intent').value.trim())
  if(!preset)throw new Error(i18n.locale==='zh'?'这个离线演示只识别上面的三个预设场景，请选择一个场景后再试。':'This offline demo recognizes the three listed scenarios. Choose one, then try again.')
  $('agent-preset').value=preset
  try{return {preset,intent:$('agent-intent').value.trim(),arguments:createShowcaseRevision(doc(),preset)}}catch(error){throw new Error(i18n.locale==='zh'?'当前图纸缺少演示目标，或场景已经执行；请撤销或重新加载示例。':'Showcase targets are missing or already applied. Undo or reload the sample.',{cause:error})}
}
function setTool(value) {
  tool = value; start = null; draft = []
  for (const b of document.querySelectorAll('[data-tool]')) { b.classList.toggle('active', b.dataset.tool === tool); b.setAttribute('aria-pressed', String(b.dataset.tool === tool)) }
  const hints = i18n.locale === 'zh'
    ? { select:'滚轮缩放 · 中键拖动画布 · 单击检查对象', line:'直线：指定起点和终点', polyline:'多段线：依次指定三个顶点', circle:'圆：指定圆心和半径', arc:'圆弧：指定圆心、起点和终点', rectangle:'矩形：指定两个对角点', ellipse:'椭圆：指定中心和长轴端点', point:'点：指定位置', xline:'构造线：指定原点和方向', text:'文字：指定插入点', measure:'距离：指定两个测量点' }
    : { select:'Scroll to zoom · middle-drag to pan · click to inspect', line:'LINE: first point, then endpoint', polyline:'POLYLINE: choose three vertices', circle:'CIRCLE: center, then radius', arc:'ARC: center, start, then endpoint', rectangle:'RECTANGLE: choose opposite corners', ellipse:'ELLIPSE: choose center and major-axis endpoint', point:'POINT: choose a position', xline:'XLINE: choose origin and direction', text:'TEXT: choose insertion point', measure:'DISTANCE: choose two points' }
  $('hint').textContent = `${hints[tool] ?? tool.toUpperCase()}${tool === 'select' ? '' : ' · Esc to cancel'}`
  render()
}
function layerColor(entity) {
  const layer = doc().getObject(entity.payload?.layerId)
  return colors[Math.abs(Number(layer?.payload?.color ?? 7)) % colors.length]
}
function isVisible(entity) { if (!entity) return false; const p = doc().getObject(entity.payload?.layerId)?.payload; return p?.visible !== false && !p?.frozen }
function drawEntity(entity, color, offset = [0,0], dashed = false, depth = 0) {
  const p = entity.payload
  const map = v => point([v[0]+offset[0],v[1]+offset[1]])
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = selection.has(entity.id) ? 2 : 1; ctx.setLineDash(dashed ? [5,4] : [])
  ctx.beginPath()
  if (entity.type === 'LINE') { ctx.moveTo(...map(p.start)); ctx.lineTo(...map(p.end)); ctx.stroke() }
  else if (entity.type === 'RAY' || entity.type === 'XLINE') { const origin=map(p.origin),d=p.direction??[1,0],span=Math.max(width,height)*2,s=Math.hypot(d[0],d[1])||1,dx=d[0]/s*span,dy=-d[1]/s*span;ctx.moveTo(origin[0]-(entity.type==='XLINE'?dx:0),origin[1]-(entity.type==='XLINE'?dy:0));ctx.lineTo(origin[0]+dx,origin[1]+dy);ctx.stroke() }
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
  else if(entity.type==='ELLIPSE'){const [x,y]=map(p.center),rx=Math.hypot(p.majorAxis[0],p.majorAxis[1])*camera.scale,rotation=-Math.atan2(p.majorAxis[1],p.majorAxis[0]);ctx.ellipse(x,y,rx,rx*p.ratio,rotation,-(p.endParameter??Math.PI*2),-(p.startParameter??0));ctx.stroke()}
  else if(entity.type==='SPLINE'){const points=p.fitPoints?.length?p.fitPoints:p.controlPoints??[];points.forEach((v,i)=>{const q=map(v);i?ctx.lineTo(...q):ctx.moveTo(...q)});ctx.stroke()}
  else if(entity.type==='HATCH'){for(const loop of p.boundaryLoops??[]){const verts=loop.vertices??[];ctx.beginPath();verts.forEach((v,i)=>{const q=map(v.point??v);i?ctx.lineTo(...q):ctx.moveTo(...q)});ctx.closePath();ctx.globalAlpha=p.solid?.18:.08;ctx.fill();ctx.globalAlpha=1;ctx.stroke()}}
  else if(['LEADER','MLEADER','DIMENSION'].includes(entity.type)){const verts=p.vertices??p.definitionPoints??[];verts.forEach((v,i)=>{const q=map(v);i?ctx.lineTo(...q):ctx.moveTo(...q)});ctx.stroke();if(p.textPosition){const q=map(p.textPosition);ctx.fillText(p.textOverride??(p.measurement==null?'':Number(p.measurement).toFixed(2)),q[0],q[1])}}
  else if(['SOLID','TRACE','WIPEOUT','REVISION_CLOUD'].includes(entity.type)){const verts=p.vertices??[];verts.forEach((v,i)=>{const q=map(v.point??v);i?ctx.lineTo(...q):ctx.moveTo(...q)});ctx.closePath();ctx.globalAlpha=.15;ctx.fill();ctx.globalAlpha=1;ctx.stroke()}
  else if(entity.type==='VIEWPORT'){const [x,y]=map(p.center);ctx.rect(x-p.width*camera.scale/2,y-p.height*camera.scale/2,p.width*camera.scale,p.height*camera.scale);ctx.stroke()}
  else if(entity.type==='TABLE'){const [x,y]=map(p.position),totalW=(p.columnWidths??[]).reduce((a,b)=>a+b,0),totalH=(p.rowHeights??[]).reduce((a,b)=>a+b,0);ctx.rect(x,y,totalW*camera.scale,totalH*camera.scale);ctx.stroke()}
  else if(entity.type==='INSERT'&&depth<8){const block=doc().getObject(p.blockRecordId),base=block?.payload?.basePoint??[0,0],factor=Array.isArray(p.scale)?p.scale:[p.scale??1,p.scale??1],matrix=multiply3(translation3(...p.position),multiply3(rotation3(p.rotation??0),multiply3(scale3(factor[0]??1,factor[1]??factor[0]??1),translation3(-base[0],-base[1]))));for(const child of doc().listEntities({ownerId:p.blockRecordId})){try{drawEntity({...child,payload:transformEntityPayload(child.type,child.payload,matrix)},color,offset,dashed,depth+1)}catch{}}}
  ctx.setLineDash([])
}
function rendererSupports(entity) { return visibleTypes.has(entity.type) && !(['LWPOLYLINE','POLYLINE'].includes(entity.type) && entity.payload.vertices?.some(v => v.bulge)) }
function render() {
  if (!sdk?.activeDocument) return
  const ratio = window.devicePixelRatio || 1
  ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height)
  let grid = 10; while(grid*camera.scale<24)grid*=2; while(grid*camera.scale>100)grid/=2
  const a = world([0,height]), b = world([width,0]); ctx.fillStyle='#243349'
  if(gridEnabled)for(let x=Math.ceil(a[0]/grid)*grid;x<b[0];x+=grid)for(let y=Math.ceil(a[1]/grid)*grid;y<b[1];y+=grid){const [px,py]=point([x,y]);ctx.fillRect(px,py,1,1)}
  const entities = modelEntities(),layers=new Map(doc().getTable('layers').records.map(layer=>[layer.id,layer.payload]))
  for (const entity of entities) { const layer=layers.get(entity.payload?.layerId);if(layer?.visible===false||layer?.frozen)continue;drawEntity(entity,selection.has(entity.id) ? '#edffd8' : colors[Math.abs(Number(layer?.color??7))%colors.length]) }
  if(pendingPlan){
    const args=pendingPlan.envelope.arguments
    const deleted=new Set(args.deleteIds),moved=new Set(args.moveIds)
    for(const entity of entities)if(deleted.has(entity.id))drawEntity(entity,'#ff7077',[0,0],true)
    for(const entity of entities)if(moved.has(entity.id))drawEntity(entity,'#ffc766',[args.dx,args.dy],true)
    for(const spec of args.additions)drawEntity({id:`preview-${spec.type}`,type:spec.type,payload:spec.payload},'#6ce6a5',[0,0],true)
  }
  if(start && cursor){
    const preview = tool==='circle' ? {type:'CIRCLE',payload:{center:start,radius:Math.hypot(cursor[0]-start[0],cursor[1]-start[1])}}
      : tool==='rectangle' ? {type:'LWPOLYLINE',payload:{vertices:[[start[0],start[1]],[cursor[0],start[1]],cursor,[start[0],cursor[1]]].map(point=>({point})),closed:true}}
      : tool==='ellipse' ? {type:'ELLIPSE',payload:{center:start,majorAxis:[cursor[0]-start[0],cursor[1]-start[1]],ratio:.55,startParameter:0,endParameter:Math.PI*2}}
      : tool==='xline' ? {type:'XLINE',payload:{origin:start,direction:[cursor[0]-start[0],cursor[1]-start[1]]}}
      : {type:'LINE',payload:{start,end:cursor}}
    drawEntity(preview,'#bdf878',[0,0],true)
  }
  if(tool==='polyline'&&draft.length>1){ctx.strokeStyle='#bdf878';ctx.setLineDash([5,4]);ctx.beginPath();draft.concat(cursor?[cursor]:[]).forEach((v,i)=>{const q=point(v);i?ctx.lineTo(...q):ctx.moveTo(...q)});ctx.stroke();ctx.setLineDash([])}
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
    if(p.origin)coords.push(p.origin);if(p.textPosition)coords.push(p.textPosition)
    if(p.center)coords.push([p.center[0]-(p.radius??0),p.center[1]-(p.radius??0)],[p.center[0]+(p.radius??0),p.center[1]+(p.radius??0)])
    for(const v of p.vertices??[])coords.push(v.point??v)
    for(const v of p.controlPoints??[])coords.push(v);for(const v of p.fitPoints??[])coords.push(v);for(const v of p.definitionPoints??[])coords.push(v)
    for(const loop of p.boundaryLoops??[])for(const v of loop.vertices??[])coords.push(v.point??v)
  }
  const valid=coords.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]))
  if(!valid.length)return [0,0,100,80]
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity
  for(const [x,y] of valid){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
  return [x0,y0,x1,y1]
}
function fit(){const [x0,y0,x1,y1]=bounds();camera.x=(x0+x1)/2;camera.y=(y0+y1)/2;camera.scale=Math.max(.00001,Math.min((width-70)/Math.max(1,x1-x0),(height-145)/Math.max(1,y1-y0)));render()}
function focusRegion([x0,y0,x1,y1]){camera.x=(x0+x1)/2;camera.y=(y0+y1)/2;camera.scale=Math.max(.00001,Math.min((width-90)/Math.max(1,x1-x0),(height-110)/Math.max(1,y1-y0)));render()}
function field(container,label,value) { const row=document.createElement('div');row.className='kv';const k=document.createElement('span'),v=document.createElement('b');k.textContent=label;v.textContent=String(value);row.append(k,v);container.append(row) }
function refresh() {
  const allEntities=doc().listEntities(),modelSpaceId=doc().snapshot().spaces.modelSpaceId,currentModel=allEntities.filter(entity=>entity.ownerId===modelSpaceId),layerEntityCounts=new Map()
  for(const entity of allEntities)layerEntityCounts.set(entity.payload?.layerId,(layerEntityCounts.get(entity.payload?.layerId)??0)+1)
  const tabs=$('document-tabs');for(const old of tabs.querySelectorAll('[data-document]'))old.remove()
  for(const drawing of session?.documents?.values()??[]){const button=document.createElement('button');button.dataset.document=drawing.id;button.textContent=documentTitle(drawing);button.classList.toggle('active',drawing.id===session.activeDocumentId);button.onclick=()=>{session.setActiveDocument(drawing.id);replaceSelection();measurement='';const title=documentTitle(drawing);$('drawing-title').textContent=title;$('top-file-name').textContent=title;invalidatePlan();refresh();fit();message(`${i18n.locale==='zh'?'当前图纸':'Active drawing'} · ${drawing.id}`)};tabs.insertBefore(button,$('new-drawing'))}
  $('entity-count').textContent=`${allEntities.length.toLocaleString()} ${t('entities')}`;$('revision').textContent=`REV ${doc().revision}`
  $('selection-count').textContent=`${selectedIds().length} ${t('selected')}`
  $('undo').disabled=!doc().history.canUndo;$('redo').disabled=!doc().history.canRedo
  const layers=doc().getTable('layers').records;$('layer-count').textContent=layers.length
  $('layers').replaceChildren()
  for(const layer of layers){const label=document.createElement('label');label.className='layer';const input=document.createElement('input');input.type='checkbox';input.checked=layer.payload.visible!==false;input.setAttribute('aria-label',`Show layer ${layer.name}`);input.onchange=()=>run(()=>execute('LAYERUPDATE',{id:layer.id,patch:{visible:input.checked}}));const name=document.createElement('span');name.textContent=layer.name;const count=document.createElement('small');count.textContent=layerEntityCounts.get(layer.id)??0;label.append(input,name,count);$('layers').append(label)}
  replaceSelection(selectedIds());const entity=primarySelection()?doc().getObject(primarySelection()):null
  $('inspector').replaceChildren();const title=document.createElement('h3');title.textContent=selectedIds().length>1?`${selectedIds().length} ${t('objectsSelected')}`:entity?entity.type:t('drawingDocument');$('inspector').append(title)
  if(entity){
    if(selectedIds().length>1){const summary=document.createElement('div');summary.className='selection-summary';summary.textContent=`${t('primary')}: ${entity.type} · ${t('groupHint')}`;$('inspector').append(summary)}
    field($('inspector'),t('handle'),entity.handle);field($('inspector'),t('layer'),doc().getObject(entity.payload.layerId)?.name??'0');if(entity.payload.radius)field($('inspector'),t('radius'),entity.payload.radius.toFixed(3));if(entity.payload.text)field($('inspector'),t('textField'),entity.payload.text)
    const editor=document.createElement('div');editor.className='property-editor'
    const layerLabel=document.createElement('label');layerLabel.textContent='LAYER';const layerSelect=document.createElement('select')
    for(const layer of doc().getTable('layers').records){const option=document.createElement('option');option.value=layer.id;option.textContent=layer.name;option.selected=layer.id===entity.payload.layerId;layerSelect.append(option)}
    layerLabel.append(layerSelect);editor.append(layerLabel)
    let valueInput=null
    if(entity.type==='CIRCLE'||entity.type==='ARC'){const label=document.createElement('label');label.textContent='RADIUS';valueInput=document.createElement('input');valueInput.type='number';valueInput.min='0.000001';valueInput.step='0.1';valueInput.value=entity.payload.radius;label.append(valueInput);editor.append(label)}
    if(entity.type==='TEXT'||entity.type==='MTEXT'){const label=document.createElement('label');label.textContent='TEXT';valueInput=document.createElement('input');valueInput.value=entity.payload.text??'';label.append(valueInput);editor.append(label)}
    const save=document.createElement('button');save.textContent=t('applyProperties');save.onclick=()=>run(async()=>{const payload={...entity.payload,layerId:layerSelect.value};if(valueInput&&(entity.type==='CIRCLE'||entity.type==='ARC'))payload.radius=Number(valueInput.value);if(valueInput&&(entity.type==='TEXT'||entity.type==='MTEXT'))payload.text=valueInput.value;await execute('PROPERTIES',{id:entity.id,patch:{payload}})});editor.append(save);$('inspector').append(editor)
    const erase=document.createElement('button');erase.textContent=t('deleteSelected');erase.onclick=()=>run(()=>execute('ERASE',{ids:selectedIds()}));$('inspector').append(erase)
  }
  else {field($('inspector'),t('revision'),doc().revision);field($('inspector'),t('modelEntities'),currentModel.length);field($('inspector'),t('kernel'),authority?'Rust / WASM':t('jsReference'));field($('inspector'),t('units'),doc().snapshot().header.units??'unspecified')}
  const omitted=currentModel.filter(e=>!rendererSupports(e)).length
  if(omitted){const warning=document.createElement('p');warning.textContent=`${omitted} entities not drawn by this minimal viewer. Preserved in the document; use KJP for lossless storage.`;$('inspector').append(warning)}
  if(measurement){const output=document.createElement('div');output.className='measure-result';output.textContent=measurement;$('inspector').append(output)}
  render()
}
async function execute(command,args={},options={}) {
  invalidatePlan({preserveReceipt:Boolean(options.preserveReceipt)})
  const result=await sdk.executeCommandEnvelope(sdk.createCommandEnvelope(command,args,{expectedRevision:doc().revision,origin:'ui',...options}))
  $('file-state').textContent=i18n.locale==='zh'?'内存中已修改':'Modified in memory';message(`${command} committed · revision ${doc().revision}`);refresh();return result
}
async function query(command,args={}) {
  const result=await sdk.executeCommand(command,args)
  measurement=`${command}: ${JSON.stringify(result)}`
  refresh();message(`${command} completed · drawing unchanged`);return result
}
function requireSelection(){const entity=primarySelection()?doc().getObject(primarySelection()):null;if(!entity)throw new Error('Select an entity first.');return entity}
function requestLocalCommand({title,description='',submitLabel,fields=[]}) {
  const dialog=$('app-dialog'),form=$('dialog-form'),fieldRoot=$('dialog-fields')
  $('dialog-title').textContent=title;$('dialog-description').textContent=description;$('dialog-description').hidden=!description
  $('dialog-submit').textContent=submitLabel??t('continue');fieldRoot.replaceChildren()
  const controls=[]
  for(const field of fields){const label=document.createElement('label');label.textContent=field.label;const input=document.createElement('input');input.name=field.name;input.type=field.type??'text';input.value=field.value??'';if(field.min!=null)input.min=String(field.min);if(field.max!=null)input.max=String(field.max);if(field.step!=null)input.step=String(field.step);input.required=field.required!==false;input.autocomplete='off';label.append(input);fieldRoot.append(label);controls.push(input)}
  return new Promise(resolve=>{
    const close=()=>{dialog.removeEventListener('close',close);if(dialog.returnValue!=='default'){resolve(null);return}const values={};for(const input of controls){if(!input.reportValidity()){resolve(null);return}values[input.name]=input.type==='number'?Number(input.value):input.value}resolve(values)}
    dialog.addEventListener('close',close);dialog.returnValue='cancel';dialog.showModal();queueMicrotask(()=>controls[0]?.focus())
  })
}
async function transformSelection(command){
  const entity=requireSelection(),ids=selectedIds()
  if(command==='MOVE'||command==='COPY'){const values=await requestLocalCommand({title:command==='MOVE'?(i18n.locale==='zh'?'移动所选对象':'Move selection'):(i18n.locale==='zh'?'复制所选对象':'Copy selection'),description:`${ids.length} ${t('selected')}`,fields:[{name:'dx',label:'ΔX',type:'number',value:5,step:.1},{name:'dy',label:'ΔY',type:'number',value:0,step:.1}]});if(!values)return;const result=await execute(command,{ids,dx:values.dx,dy:values.dy});if(command==='COPY'&&Array.isArray(result))replaceSelection(result.map(row=>row.id).filter(Boolean))}
  else if(command==='ROTATE'){const values=await requestLocalCommand({title:i18n.locale==='zh'?'旋转所选对象':'Rotate selection',fields:[{name:'degrees',label:i18n.locale==='zh'?'角度（度）':'Angle (degrees)',type:'number',value:15,step:1}]});if(!values)return;await execute('ROTATE',{ids,angle:values.degrees*Math.PI/180,center:[0,0]})}
  else if(command==='OFFSET'){if(ids.length!==1)throw new Error('OFFSET requires exactly one selected object.');const values=await requestLocalCommand({title:i18n.locale==='zh'?'偏移对象':'Offset entity',fields:[{name:'distance',label:i18n.locale==='zh'?'偏移距离':'Offset distance',type:'number',value:2,step:.1}]});if(!values)return;const result=await execute('OFFSET',{id:entity.id,distance:values.distance});if(result?.id)replaceSelection([result.id])}
  refresh()
}
async function runTypedCommand(){
  const raw=$('command-input').value.trim();if(!raw)return
  const [name,...values]=raw.split(/[\s,]+/),command=name.toUpperCase();$('command-input').value=''
  if(command==='FIT'){fit();message('View fitted');return}if(command==='UNDO'||command==='REDO'){await execute(command);return}
  if(command==='MOVE'||command==='COPY'){requireSelection();const dx=Number(values[0]??0),dy=Number(values[1]??0);const result=await execute(command,{ids:selectedIds(),dx,dy});if(command==='COPY'&&Array.isArray(result))replaceSelection(result.map(row=>row.id).filter(Boolean));return}
  if(command==='ROTATE'){requireSelection();await execute(command,{ids:selectedIds(),angle:Number(values[0]??0)*Math.PI/180,center:[0,0]});return}
  if(command==='OFFSET'){await execute(command,{id:requireSelection().id,distance:Number(values[0]??1)});return}
  if(command==='ERASE'||command==='DELETE'){requireSelection();await execute('ERASE',{ids:selectedIds()});return}
  if(command==='LENGTH'||command==='AREA'){await query(command,{ids:[requireSelection().id]});return}
  throw new Error(`Supported commands: MOVE, COPY, ROTATE, OFFSET, LENGTH, AREA, ERASE, UNDO, REDO, FIT`)
}
async function run(work){if(busy)return;busy=true;workbench.setAttribute('aria-busy','true');try{await work()}catch(e){message(e.cause?.message??e.message);console.error(e)}finally{busy=false;workbench.setAttribute('aria-busy','false')}}
async function freshSample(){rejectPendingPlan();workbench.dataset.demoState='loading';workbench.setAttribute('aria-busy','true');message(i18n.locale==='zh'?'正在生成 2,000+ 对象的原创工程图…':'Generating an original 2,000+ entity engineering drawing…');const next=createKJDrawSDK({documentAuthority:authority,solidAuthority});registerShowcaseCommand(next);const document=await createSample(next);session?.destroy();sdk=next;session=KJProjectSession.create({sdk,id:'sample-resilient-campus',title:'KJDraw 1.0 showcase',documents:[document],metadata:{synthetic:true,scenario:'resilient-energy-campus'}});replaceSelection();invalidatePlan();setCanonicalIntent();$('top-file-name').textContent=documentTitle(document);$('drawing-title').textContent=documentTitle(document);$('file-state').textContent=t('memory');refresh();fit();workbench.dataset.demoState='ready';workbench.setAttribute('aria-busy','false');message(i18n.locale==='zh'?`原创工程总图 · ${modelEntities().length.toLocaleString()} 个可编辑对象 · 全程本地`:`Original engineering plan · ${modelEntities().length.toLocaleString()} editable entities · local only`)}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function openFile(file){
  if(!file)return
  if(file.size>20*1024*1024)throw new Error('Playground file limit: 20 MiB. Use the SDK directly for larger files.')
  rejectPendingPlan();const next=createKJDrawSDK({documentAuthority:authority,solidAuthority});registerShowcaseCommand(next);let project
  if(file.name.toLowerCase().endsWith('.kjp'))project=await KJProjectSession.open(new Uint8Array(await file.arrayBuffer()),{sdk:next})
  else {const format=file.name.toLowerCase().endsWith('.dxf')?'DXF':'KJD';const drawing=await next.readDocument(format==='DXF'?new Uint8Array(await file.arrayBuffer()):await file.text(),{format});project=KJProjectSession.create({sdk:next,title:file.name,documents:[drawing]})}
  session?.destroy();sdk=next;session=project;replaceSelection();invalidatePlan();setCanonicalIntent();setTool('select');$('top-file-name').textContent=file.name;$('drawing-title').textContent=documentTitle(project.activeDocument);$('file-state').textContent=i18n.locale==='zh'?'已在本地打开':'Opened locally';refresh();fit();workbench.dataset.demoState='ready';message(i18n.locale==='zh'?'文件已在本地打开 · 暂不显示的对象仍完整保留':'File opened locally · unsupported view entities remain in the document')
}
$('open').onclick=()=>$('file-input').click()
$('toggle-layers').onclick=()=>{const open=workbench.classList.toggle('layers-open');$('toggle-layers').classList.toggle('active',open);$('toggle-layers').setAttribute('aria-pressed',String(open));resize()}
$('toggle-inspector').onclick=()=>{const open=workbench.classList.toggle('inspector-open');$('toggle-inspector').classList.toggle('active',open);$('toggle-inspector').setAttribute('aria-pressed',String(open));resize()}
$('file-input').onchange=e=>run(async()=>{try{await openFile(e.target.files[0])}finally{e.target.value=''}})
for(const eventName of ['dragenter','dragover'])$('drop-zone').addEventListener(eventName,e=>{e.preventDefault();$('drop-zone').classList.add('dragging')})
for(const eventName of ['dragleave','drop'])$('drop-zone').addEventListener(eventName,e=>{e.preventDefault();$('drop-zone').classList.remove('dragging')})
$('drop-zone').addEventListener('drop',e=>run(()=>openFile(e.dataTransfer?.files?.[0])))
$('snapshot').onclick=()=>{const record=session.createSnapshot(`Snapshot ${session.snapshotLedger.length+1}`);$('file-state').textContent='Modified in memory';message(`Project snapshot created · ${record.documents.length} drawing${record.documents.length===1?'':'s'}`)}
const formatBytes=value=>value<1024?`${value} B`:value<1024*1024?`${(value/1024).toFixed(1)} KiB`:`${(value/1024/1024).toFixed(1)} MiB`
async function saveProject(){const bytes=await session.package();download(bytes,'kjdraw-resilient-campus.kjp','application/zip');message(i18n.locale==='zh'?`KJP 已生成（${formatBytes(bytes.length)}）· 包含工程内全部图纸`:`KJP generated (${formatBytes(bytes.length)}) · includes every project drawing`);return bytes}
$('save').onclick=()=>run(saveProject)
$('export').onclick=()=>run(async()=>{const text=await sdk.writeDocument(doc(),{format:'DXF',version:'2018'});download(text,'drawing.dxf','application/dxf');message('ASCII DXF 2018 downloaded · core adapter, see compatibility limits')})
$('undo').onclick=()=>run(()=>execute('UNDO'));$('redo').onclick=()=>run(()=>execute('REDO'));$('fit').onclick=fit
$('fit-ribbon').onclick=fit
$('move-selection').onclick=()=>run(()=>transformSelection('MOVE'))
$('copy-selection').onclick=()=>run(()=>transformSelection('COPY'))
$('rotate-selection').onclick=()=>run(()=>transformSelection('ROTATE'))
$('offset-selection').onclick=()=>run(()=>transformSelection('OFFSET'))
$('delete-selection').onclick=()=>run(()=>{requireSelection();return execute('ERASE',{ids:selectedIds()})})
$('measure-entity').onclick=()=>run(async()=>{const entity=requireSelection();const supportedArea=['CIRCLE','ELLIPSE','LWPOLYLINE','POLYLINE','SOLID','TRACE'].includes(entity.type);await query(supportedArea?'AREA':'LENGTH',{ids:[entity.id]})})
$('run-command').onclick=()=>run(runTypedCommand)
$('command-input').onkeydown=e=>{if(e.key==='Enter')run(runTypedCommand)}
$('new-layer').onclick=()=>run(async()=>{const values=await requestLocalCommand({title:i18n.locale==='zh'?'新建图层':'Create layer',fields:[{name:'name',label:i18n.locale==='zh'?'图层名称':'Layer name',value:'Design'}]});if(!values?.name.trim())return;await execute('LAYERNEW',{name:values.name.trim(),color:3})})
$('new-drawing').onclick=()=>run(async()=>{const values=await requestLocalCommand({title:i18n.locale==='zh'?'新建图纸':'Create drawing',fields:[{name:'name',label:i18n.locale==='zh'?'图纸名称':'Drawing name',value:`Drawing ${session.documents.size+1}`}]});if(!values?.name.trim())return;const name=values.name.trim(),id=`drawing-${Date.now().toString(36)}`,drawing=sdk.createDocument({documentId:id,title:name,units:doc().snapshot().header.units??'unitless'});session.attachDocument(drawing);session.setActiveDocument(id);replaceSelection();measurement='';$('drawing-title').textContent=name;$('top-file-name').textContent=name;$('file-state').textContent=i18n.locale==='zh'?'内存中已修改':'Modified in memory';invalidatePlan();refresh();fit();message(`Drawing created · ${name}`)})
$('reset').onclick=()=>run(async()=>{const accepted=await requestLocalCommand({title:i18n.locale==='zh'?'重新加载原创示例？':'Reload the original sample?',description:i18n.locale==='zh'?'当前内存中的修改将被替换。需要保留时，请先保存 KJP。':'In-memory edits will be replaced. Save a KJP first if you need to keep them.',submitLabel:i18n.locale==='zh'?'重新加载':'Reload'});if(accepted)await freshSample()})
$('snap').onclick=()=>{snapEnabled=!snapEnabled;$('snap').textContent=t(snapEnabled?'snapOn':'snapOff');$('snap').setAttribute('aria-pressed',String(snapEnabled))}
$('grid').onclick=()=>{gridEnabled=!gridEnabled;$('grid').textContent=t(gridEnabled?'gridOn':'gridOff');$('grid').setAttribute('aria-pressed',String(gridEnabled));render()}
$('ortho').onclick=()=>{orthoEnabled=!orthoEnabled;$('ortho').textContent=t(orthoEnabled?'orthoOn':'orthoOff');$('ortho').setAttribute('aria-pressed',String(orthoEnabled));render()}
$('language').onclick=()=>{const canonical=knownIntent($('agent-intent').value);i18n.toggle();if(canonical)setCanonicalIntent();$('grid').textContent=t(gridEnabled?'gridOn':'gridOff');$('ortho').textContent=t(orthoEnabled?'orthoOn':'orthoOff');$('snap').textContent=t(snapEnabled?'snapOn':'snapOff');if(sdk){if(doc()?.id==='sample-resilient-campus'){const title=documentTitle(doc());$('top-file-name').textContent=title;$('drawing-title').textContent=title}refresh()}if(pendingPlan)displayAgentPlan(pendingPlan);setTool(tool)}
for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>setTool(b.dataset.tool)
function planStep(title,detail){const item=document.createElement('li'),heading=document.createElement('b');heading.textContent=title;item.append(heading,document.createTextNode(detail));$('plan-steps').append(item)}
function displayAgentPlan(plan){
  const args=plan.envelope.arguments,binding=plan.record.binding
  $('plan-state').dataset.state='planned';$('plan-state').textContent=i18n.locale==='zh'?`尚未修改 · 修订 ${plan.envelope.expectedRevision} · SHA-256 ${binding.slice(0,12)}…`:`NO MUTATION · revision ${plan.envelope.expectedRevision} · SHA-256 ${binding.slice(0,12)}…`
  $('plan-steps').replaceChildren()
  planStep(`MOVE  ${args.moveIds.length}`,i18n.locale==='zh'?` 位移 ΔX ${args.dx} m / ΔY ${args.dy} m`:` · displacement ΔX ${args.dx} m / ΔY ${args.dy} m`)
  planStep(`ERASE  ${args.deleteIds.length}`,i18n.locale==='zh'?' 删除“临时工程”对象':' · remove temporary-work objects')
  planStep(`CREATE  ${args.additions.length}`,i18n.locale==='zh'?' 在“安全方案”图层新增对象':' · add objects on Safety · proposal')
  $('diff-legend').hidden=false;$('plan-details').hidden=false;$('canvas-diff').hidden=false
  $('plan-json').textContent=JSON.stringify({schema:plan.envelope.schema,schemaVersion:plan.envelope.schemaVersion,command:plan.envelope.command,mode:plan.envelope.mode,origin:plan.envelope.origin,documentId:plan.envelope.documentId,expectedRevision:plan.envelope.expectedRevision,arguments:plan.envelope.arguments,binding:{algorithm:plan.record.bindingAlgorithm,value:binding,expiresAt:plan.record.expiresAt}},null,2)
  $('confirm').disabled=false;workbench.dataset.demoState='planned';render()
}
async function previewAgentPlan(){
  invalidatePlan();const task=createAgentTask()
  const envelope=sdk.createCommandEnvelope(AGENT_REVISION_COMMAND,task.arguments,{origin:'ai',mode:'plan',expectedRevision:doc().revision})
  const planned=await sdk.executeCommandEnvelope(envelope)
  pendingPlan={task,envelope,record:planned.result,documentId:doc().id,fingerprint:doc().fingerprint()}
  displayAgentPlan(pendingPlan)
  focusRegion([187,16,247,73])
  message(i18n.locale==='zh'?'计划已绑定当前图纸与精确参数 · 画布显示移动 / 删除 / 新增差异 · 尚未修改':'Plan bound to exact arguments and drawing state · canvas shows move / delete / add diff · no mutation')
}
function timeline(text){const item=document.createElement('li');item.textContent=text;$('receipt-timeline').append(item)}
async function commitAgentPlan(){
  const plan=pendingPlan;if(!plan)throw new Error(i18n.locale==='zh'?'请先生成精确计划。':'Build an exact plan first.')
  if(doc().id!==plan.documentId||doc().revision!==plan.envelope.expectedRevision||doc().fingerprint()!==plan.fingerprint){invalidatePlan();throw new Error(i18n.locale==='zh'?'图纸已改变，请重新生成计划。':'Drawing changed. Build a fresh plan.')}
  $('confirm').disabled=true
  const started=performance.now(),envelope=sdk.createCommandEnvelope(plan.envelope.command,plan.envelope.arguments,{origin:'ai',expectedRevision:plan.envelope.expectedRevision,confirmation:{status:'confirmed',planId:plan.envelope.id,confirmedBy:'playground-user'}})
  const receipt=await sdk.executeCommandEnvelope(envelope),elapsed=performance.now()-started
  pendingPlan=null;lastReceipt={receipt,planId:plan.envelope.id,binding:plan.record.binding}
  $('diff-legend').hidden=true;$('plan-details').hidden=true;$('plan-steps').replaceChildren();$('canvas-diff').hidden=true
  $('plan-state').dataset.state='committed';$('plan-state').textContent=i18n.locale==='zh'?`已原子提交到修订 ${receipt.afterRevision} · 可一键撤销或验证 KJP 重开`:`Atomically committed at revision ${receipt.afterRevision} · undo or verify a KJP reopen below`
  $('receipt-panel').hidden=false;$('receipt-timeline').replaceChildren()
  timeline(i18n.locale==='zh'?`意图已确定化 · 预设 ${plan.task.preset}`:`Intent normalized · preset ${plan.task.preset}`)
  timeline(`SHA-256 ${plan.record.binding.slice(0,16)}… · REV ${receipt.beforeRevision}`)
  timeline(i18n.locale==='zh'?'人工批准 · playground-user':'Human approval · playground-user')
  timeline(i18n.locale==='zh'?`原子事务已提交 · REV ${receipt.beforeRevision} → ${receipt.afterRevision} · ${elapsed.toFixed(0)} ms`:`Atomic transaction committed · REV ${receipt.beforeRevision} → ${receipt.afterRevision} · ${elapsed.toFixed(0)} ms`)
  $('receipt-undo').disabled=false;$('file-state').textContent=i18n.locale==='zh'?'内存中已修改':'Modified in memory';workbench.dataset.demoState='committed';refresh();message(i18n.locale==='zh'?`Agent 来源命令已提交 · 回执 ${receipt.commandEnvelopeId}`:`AI-origin command committed · receipt ${receipt.commandEnvelopeId}`)
}
$('agent-preset').onchange=()=>{invalidatePlan();setCanonicalIntent();render()}
$('agent-intent').oninput=()=>{if(pendingPlan){invalidatePlan();render()}}
$('agent-intent').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();run(previewAgentPlan)}}
$('plan').onclick=()=>run(previewAgentPlan)
$('clear-plan').onclick=()=>{invalidatePlan();render();message(i18n.locale==='zh'?'计划已清除 · 图纸未改变':'Plan cleared · drawing unchanged')}
$('confirm').onclick=()=>run(commitAgentPlan)
$('receipt-undo').onclick=()=>run(async()=>{await execute('UNDO',{}, {preserveReceipt:true});$('receipt-undo').disabled=true;$('plan-state').dataset.state='verified';$('plan-state').textContent=i18n.locale==='zh'?'撤销已验证 · 原始几何已恢复，可用 Redo 重做':'Undo verified · original geometry restored; Redo remains available';timeline(i18n.locale==='zh'?`撤销完成 · 当前 REV ${doc().revision}`:`Undo complete · current REV ${doc().revision}`);workbench.dataset.demoState='undone'})
$('receipt-save').onclick=()=>run(async()=>{const bytes=await saveProject();timeline(i18n.locale==='zh'?`KJP 下载已请求 · ${formatBytes(bytes.length)}`:`KJP download requested · ${formatBytes(bytes.length)}`)})
$('receipt-reopen').onclick=()=>run(async()=>{const bytes=await session.package(),fingerprint=doc().fingerprint(),next=createKJDrawSDK({documentAuthority:authority,solidAuthority});registerShowcaseCommand(next);const reopened=await KJProjectSession.open(bytes,{sdk:next}),match=reopened.activeDocument.fingerprint()===fingerprint,count=reopened.activeDocument.listEntities().length;reopened.destroy();if(!match)throw new Error('KJP reopen fingerprint mismatch.');$('plan-state').dataset.state='verified';$('plan-state').textContent=i18n.locale==='zh'?`KJP 重开验证通过 · ${count.toLocaleString()} 个对象 · 指纹一致`:`KJP reopen verified · ${count.toLocaleString()} entities · fingerprint match`;timeline(i18n.locale==='zh'?`保存 / 重开验证通过 · ${formatBytes(bytes.length)} · 指纹一致`:`Save / reopen verified · ${formatBytes(bytes.length)} · fingerprint match`);workbench.dataset.demoState='verified';message(i18n.locale==='zh'?'KJP 往返验证通过 · 当前工作区未被替换':'KJP round-trip verified · current workspace was not replaced')})
function pointer(e){const r=canvas.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]}
function snap(p){if(!snapEnabled||!sdk)return p;const hits=sdk.snap(p,{radius:8/camera.scale,modes:['endpoint','midpoint','center','nearest']});return hits[0]?.point??p}
function constrainedPoint(p){const value=snap(p);if(!orthoEnabled||!start)return value;const dx=Math.abs(value[0]-start[0]),dy=Math.abs(value[1]-start[1]);return dx>=dy?[value[0],start[1]]:[start[0],value[1]]}
canvas.onpointermove=e=>{
  const p=pointer(e)
  if(pan){camera.x=pan.x-(p[0]-pan.p[0])/camera.scale;camera.y=pan.y+(p[1]-pan.p[1])/camera.scale;render();return}
  cursor=constrainedPoint(world(p));$('coordinates').textContent=`X ${cursor[0].toFixed(2)} · Y ${cursor[1].toFixed(2)}`;if(start)render()
}
canvas.onpointerdown=e=>{
  if(e.button===1){e.preventDefault();pan={p:pointer(e),x:camera.x,y:camera.y};canvas.setPointerCapture(e.pointerId);return}
  if(e.button!==0||busy)return
  const p=constrainedPoint(world(pointer(e)))
  if(tool==='select'){
    const candidates=sdk.snap(world(pointer(e)),{radius:10/camera.scale,modes:['nearest','center','endpoint']})
      .map(candidate=>candidate.entityIds[0]).filter((id,index,ids)=>ids.indexOf(id)===index&&isVisible(doc().getObject(id)))
    const id=e.shiftKey?(candidates.find(candidate=>!selection.has(candidate))??candidates[0]??null):(candidates[0]??null)
    if(e.shiftKey){if(id)selection.has(id)?selection.delete(id):selection.add(id)}else replaceSelection(id?[id]:[])
    refresh();return
  }
  if(tool==='text'){run(async()=>{const values=await requestLocalCommand({title:i18n.locale==='zh'?'放置文字':'Place text',fields:[{name:'text',label:i18n.locale==='zh'?'文字内容':'Text content',value:'KJDraw'}]});if(values?.text)await execute('CREATE',{type:'TEXT',payload:{position:p,height:2.5,rotation:0,text:values.text}})});return}
  if(tool==='point'){run(()=>execute('CREATE',{type:'POINT',payload:{position:p}}));return}
  if(tool==='measure'){
    if(!start){start=p;cursor=p;message('Choose the second distance point');return}
    const first=start;start=null;run(()=>query('DISTANCE',{firstPoint:first,secondPoint:p}));return
  }
  if(tool==='polyline'){
    draft.push(p);start=p
    if(draft.length<3){message(`Polyline vertex ${draft.length}/3`);render();return}
    const vertices=draft.map(point=>({point}));draft=[];start=null;run(()=>execute('CREATE',{type:'LWPOLYLINE',payload:{vertices,closed:false}}));return
  }
  if(tool==='arc'){
    draft.push(p);start=p
    if(draft.length<3){message(draft.length===1?'Choose arc start point':'Choose arc endpoint');render();return}
    const [center,arcStart,arcEnd]=draft;draft=[];start=null
    const radius=Math.hypot(arcStart[0]-center[0],arcStart[1]-center[1]);if(radius<1e-9){message('Arc radius must be positive');return}
    run(()=>execute('CREATE',{type:'ARC',payload:{center,radius,startAngle:Math.atan2(arcStart[1]-center[1],arcStart[0]-center[0]),endAngle:Math.atan2(arcEnd[1]-center[1],arcEnd[0]-center[0])}}));return
  }
  if(!start){start=p;cursor=p;message(i18n.locale==='zh'?'指定下一点':'Choose the next point');return}
  const initial=start;start=null
  run(async()=>{
    if(tool==='circle'){const radius=Math.hypot(p[0]-initial[0],p[1]-initial[1]);if(radius<1e-9)throw new Error('Circle radius must be positive.');await execute('CREATE',{type:'CIRCLE',payload:{center:initial,radius}})}
    else if(tool==='rectangle')await execute('CREATE',{type:'LWPOLYLINE',payload:{vertices:[[initial[0],initial[1]],[p[0],initial[1]],p,[initial[0],p[1]]].map(point=>({point})),closed:true}})
    else if(tool==='ellipse'){const majorAxis=[p[0]-initial[0],p[1]-initial[1]];if(Math.hypot(...majorAxis)<1e-9)throw new Error('Ellipse axis must be positive.');await execute('CREATE',{type:'ELLIPSE',payload:{center:initial,majorAxis,ratio:.55,startParameter:0,endParameter:Math.PI*2}})}
    else if(tool==='xline'){const direction=[p[0]-initial[0],p[1]-initial[1]];if(Math.hypot(...direction)<1e-9)throw new Error('Construction line direction must be positive.');await execute('CREATE',{type:'XLINE',payload:{origin:initial,direction}})}
    else await execute('CREATE',{type:'LINE',payload:{start:initial,end:p}})
  })
}
canvas.onpointerup=()=>{pan=null};canvas.onpointercancel=()=>{pan=null;start=null;render()}
canvas.addEventListener('wheel',e=>{e.preventDefault();const p=pointer(e),a=world(p);camera.scale=Math.min(10000,Math.max(.00001,camera.scale*Math.exp(-e.deltaY*.001)));const b=world(p);camera.x+=a[0]-b[0];camera.y+=a[1]-b[1];render()},{passive:false})
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='Escape'){setTool('select');invalidatePlan();render()}const key=e.key.toLowerCase();if(key==='l')setTool('line');if(key==='p')setTool('polyline');if(key==='c')setTool('circle');if(key==='a')setTool('arc');if(key==='r')setTool('rectangle');if(key==='e')setTool('ellipse');if(key==='x')setTool('xline');if(key==='q')setTool('point');if(key==='t')setTool('text');if(key==='d')setTool('measure');if(key==='v')setTool('select');if((e.ctrlKey||e.metaKey)&&key==='z'){e.preventDefault();run(()=>execute(e.shiftKey?'REDO':'UNDO'))}})
new ResizeObserver(resize).observe(canvas)
i18n.apply()
try {
  const {instance}=await instantiateKJCoreWasm(new URL('../../web/public/kjcore/kjcore.wasm',import.meta.url))
  registerGeometryBackend(createWasmGeometryBackend(instance));authority=createKJCoreDocumentAuthority(instance);solidAuthority=createKJCoreSolidBackend(instance)
} catch(e){message('WASM unavailable · JavaScript reference mode');console.warn(e.message)}
await freshSample();resize();fit()
