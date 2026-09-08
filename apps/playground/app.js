import { createKJDrawSDK, KJProjectSession, instantiateKJCoreWasm, createWasmGeometryBackend, registerGeometryBackend, createKJCoreDocumentAuthority, createKJCoreSolidBackend } from '../../packages/kjdraw-sdk/src/index.js'
import { KJCanvasRenderer } from '../../packages/kjdraw-sdk/src/canvas-renderer.js'
import { createSample } from '../../examples/sample.js'
import { createI18n } from './i18n.js'
import { AGENT_REVISION_COMMAND, createShowcaseRevision, getShowcaseIntent, isShowcaseIntent, registerShowcaseCommand, resolveShowcasePreset } from './agent-showcase.js'
import { createIndustrySamples, INDUSTRY_SAMPLES } from './industry-samples.js'

const $ = id => document.getElementById(id)
const i18n = createI18n(), t = key => i18n.t(key)
const workbench = document.querySelector('.workbench')
const canvas = $('canvas'), canvasRenderer = new KJCanvasRenderer(canvas,{theme:'dark',grid:true,padding:45}), ctx = canvasRenderer.context
const camera = {
  get x(){return canvasRenderer.camera.centerX},set x(value){canvasRenderer.camera.centerX=value},
  get y(){return canvasRenderer.camera.centerY},set y(value){canvasRenderer.camera.centerY=value},
  get scale(){return canvasRenderer.camera.scale},set scale(value){canvasRenderer.camera.scale=value},
}
const colors = ['#c8d7e7','#ee9999','#e8d697','#bdf878','#7db9e4','#b795db','#de91bf','#b8c7d8','#637b91']
let rendererSelectionKey = ''
const SHOWCASE_DOCUMENT_ID = 'sample-resilient-campus'
const SAMPLE_DESCRIPTORS = Object.freeze([
  { id: SHOWCASE_DOCUMENT_ID, title: 'Resilient energy campus · Agent + 2,294 objects', titleZh: '韧性能源园区 · Agent + 2,294 对象', discipline: 'ENERGY · STRESS' },
  ...INDUSTRY_SAMPLES,
])
let sdk, session, selection = new Set(), tool = 'select', start = null, draft = [], cursor = null, snapEnabled = true, gridEnabled = true, orthoEnabled = false, pendingPlan = null, pan = null, busy = false, authority = null, solidAuthority = null, measurement = null, width = 1, height = 1, lastReceipt = null
const doc = () => sdk.activeDocument
const documentTitle = drawing => {
  const metadata = drawing?.snapshot().metadata
  if (i18n.locale === 'zh') return metadata?.custom?.titleZh ?? (drawing?.id === SHOWCASE_DOCUMENT_ID ? '韧性能源园区 / 总协调图' : metadata?.title || drawing?.id || '')
  return metadata?.title || drawing?.id || ''
}
const documentDiscipline = drawing => drawing?.snapshot().metadata?.custom?.discipline ?? (drawing?.id === SHOWCASE_DOCUMENT_ID ? 'ENERGY · STRESS' : 'DRAWING')
const selectedIds = () => [...selection].filter(id => doc()?.getObject(id))
const primarySelection = () => selectedIds().at(-1) ?? null
function replaceSelection(ids = []) { selection = new Set(ids.filter(id => doc()?.getObject(id))) }
const message = text => { $('status').textContent = text }
const point = p => canvasRenderer.worldToScreen(p)
const world = p => canvasRenderer.screenToWorld(p)
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
function isVisible(entity) { if (!entity) return false; const p = doc().getObject(entity.payload?.layerId)?.payload; return p?.visible !== false && !p?.frozen }
// Only transient previews use this painter; committed geometry comes from the
// same public Canvas renderer npm consumers use.
function drawOverlayEntity(entity, color, offset = [0,0]) {
  const p=entity.payload,map=value=>point([value[0]+offset[0],value[1]+offset[1]])
  ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.beginPath()
  if(entity.type==='LINE'){ctx.moveTo(...map(p.start));ctx.lineTo(...map(p.end));ctx.stroke()}
  else if(entity.type==='RAY'||entity.type==='XLINE'){const origin=map(p.origin),direction=p.direction??[1,0],span=Math.max(width,height)*2,length=Math.hypot(...direction)||1,dx=direction[0]/length*span,dy=-direction[1]/length*span;ctx.moveTo(origin[0]-(entity.type==='XLINE'?dx:0),origin[1]-(entity.type==='XLINE'?dy:0));ctx.lineTo(origin[0]+dx,origin[1]+dy);ctx.stroke()}
  else if(entity.type==='CIRCLE'||entity.type==='ARC'){const [x,y]=map(p.center);ctx.arc(x,y,p.radius*camera.scale,entity.type==='ARC'?-p.startAngle:0,entity.type==='ARC'?-p.endAngle:Math.PI*2,entity.type==='ARC');ctx.stroke()}
  else if(entity.type==='POINT'){const [x,y]=map(p.position);ctx.moveTo(x-3,y);ctx.lineTo(x+3,y);ctx.moveTo(x,y-3);ctx.lineTo(x,y+3);ctx.stroke()}
  else if(entity.type==='TEXT'||entity.type==='MTEXT'){const [x,y]=map(p.position);ctx.translate(x,y);ctx.rotate(-(p.rotation??0));ctx.font=`${Math.max(7,(p.height??1)*camera.scale)}px Consolas, monospace`;ctx.fillText(p.text??'',0,0)}
  else if(entity.type==='LWPOLYLINE'||entity.type==='POLYLINE'){const vertices=p.vertices??[];vertices.forEach((value,index)=>{const next=map(value.point??value);index?ctx.lineTo(...next):ctx.moveTo(...next)});if(p.closed)ctx.closePath();ctx.stroke()}
  else if(entity.type==='ELLIPSE'){const [x,y]=map(p.center),radius=Math.hypot(...p.majorAxis)*camera.scale,rotation=-Math.atan2(p.majorAxis[1],p.majorAxis[0]);ctx.ellipse(x,y,radius,radius*p.ratio,rotation,-(p.endParameter??Math.PI*2),-(p.startParameter??0));ctx.stroke()}
  ctx.restore()
}
function render() {
  if(!sdk?.activeDocument)return
  let rendered=false
  if(canvasRenderer.document!==doc()){canvasRenderer.setDocument(doc());rendererSelectionKey='';rendered=true}
  if(canvasRenderer.grid!==gridEnabled){canvasRenderer.setGrid(gridEnabled);rendered=true}
  const selectionKey=selectedIds().sort().join('|')
  if(selectionKey!==rendererSelectionKey){canvasRenderer.setSelection(selectedIds());rendererSelectionKey=selectionKey;rendered=true}
  if(!rendered)canvasRenderer.render()
  const entities=modelEntities()
  if(pendingPlan){
    const args=pendingPlan.envelope.arguments,deleted=new Set(args.deleteIds),moved=new Set(args.moveIds)
    for(const entity of entities)if(deleted.has(entity.id))drawOverlayEntity(entity,'#ff7077')
    for(const entity of entities)if(moved.has(entity.id))drawOverlayEntity(entity,'#ffc766',[args.dx,args.dy])
    for(const spec of args.additions)drawOverlayEntity({id:`preview-${spec.type}`,type:spec.type,payload:spec.payload},'#6ce6a5')
  }
  if(start&&cursor){
    const preview=tool==='circle'?{type:'CIRCLE',payload:{center:start,radius:Math.hypot(cursor[0]-start[0],cursor[1]-start[1])}}
      :tool==='rectangle'?{type:'LWPOLYLINE',payload:{vertices:[[start[0],start[1]],[cursor[0],start[1]],cursor,[start[0],cursor[1]]].map(point=>({point})),closed:true}}
      :tool==='ellipse'?{type:'ELLIPSE',payload:{center:start,majorAxis:[cursor[0]-start[0],cursor[1]-start[1]],ratio:.55,startParameter:0,endParameter:Math.PI*2}}
      :tool==='xline'?{type:'XLINE',payload:{origin:start,direction:[cursor[0]-start[0],cursor[1]-start[1]]}}
      :{type:'LINE',payload:{start,end:cursor}}
    drawOverlayEntity(preview,'#bdf878')
  }
  if(tool==='polyline'&&draft.length>1){ctx.save();ctx.strokeStyle='#bdf878';ctx.setLineDash([5,4]);ctx.beginPath();draft.concat(cursor?[cursor]:[]).forEach((value,index)=>{const next=point(value);index?ctx.lineTo(...next):ctx.moveTo(...next)});ctx.stroke();ctx.restore()}
}
function resize() {
  const rect = canvas.getBoundingClientRect();width=rect.width;height=rect.height
  canvasRenderer.resize(width,height);render()
}
function fit(){canvasRenderer.fit();render()}
function focusRegion([x0,y0,x1,y1]){camera.x=(x0+x1)/2;camera.y=(y0+y1)/2;camera.scale=Math.max(.00001,Math.min((width-90)/Math.max(1,x1-x0),(height-110)/Math.max(1,y1-y0)));render()}
function field(container,label,value) { const row=document.createElement('div');row.className='kv';const k=document.createElement('span'),v=document.createElement('b');k.textContent=label;v.textContent=String(value);row.append(k,v);container.append(row) }
function populateSampleSelector() {
  const select=$('sample-select'),active=doc()?.id
  select.replaceChildren()
  for(const sample of SAMPLE_DESCRIPTORS){
    if(!session?.documents.has(sample.id))continue
    const option=document.createElement('option');option.value=sample.id;option.textContent=i18n.locale==='zh'?sample.titleZh:sample.title;option.selected=sample.id===active;select.append(option)
  }
  select.hidden=!select.options.length
}
function syncAgentAvailability() {
  const available=doc()?.id===SHOWCASE_DOCUMENT_ID
  for(const id of ['agent-preset','agent-intent','plan'])$(id).disabled=!available
  if(!available){$('confirm').disabled=true;$('plan-state').dataset.state='idle';$('plan-state').textContent=i18n.locale==='zh'?'Agent 修改演示位于“韧性能源园区”压力样例，请从上方样例库切换。':'The Agent change demo is available in the Resilient energy campus stress sample.'}
}
function activateDrawing(id,{announce=true}={}) {
  if(!session?.documents.has(id))return
  session.setActiveDocument(id);replaceSelection();measurement=null;invalidatePlan()
  const title=documentTitle(doc()),discipline=documentDiscipline(doc())
  $('drawing-title').textContent=title;$('top-file-name').textContent=title;$('drawing-discipline').textContent=`${discipline} · 2D`;$('sample-discipline').textContent=discipline
  populateSampleSelector();refresh();fit()
  if(announce)message(`${i18n.locale==='zh'?'当前图纸':'Active drawing'} · ${title}`)
}
function renderMeasurement(container,value) {
  const output=document.createElement('section');output.className='measure-result'
  const heading=document.createElement('b');heading.textContent=i18n.locale==='zh'?'测量结果':'Measurement';output.append(heading)
  for(const row of value.rows){const item=document.createElement('div'),label=document.createElement('span'),result=document.createElement('strong');label.textContent=row.label;result.textContent=row.value;item.append(label,result);output.append(item)}
  const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=i18n.locale==='zh'?'查看数据':'View data';pre.textContent=JSON.stringify(value.raw,null,2);details.append(summary,pre);output.append(details);container.append(output)
}
function refresh() {
  const allEntities=doc().listEntities(),modelSpaceId=doc().snapshot().spaces.modelSpaceId,currentModel=allEntities.filter(entity=>entity.ownerId===modelSpaceId),layerEntityCounts=new Map()
  for(const entity of allEntities)layerEntityCounts.set(entity.payload?.layerId,(layerEntityCounts.get(entity.payload?.layerId)??0)+1)
  const tabs=$('document-tabs');for(const old of tabs.querySelectorAll('[data-document]'))old.remove()
  for(const drawing of session?.documents?.values()??[]){const button=document.createElement('button');button.dataset.document=drawing.id;button.textContent=documentTitle(drawing);button.title=documentTitle(drawing);button.classList.toggle('active',drawing.id===session.activeDocumentId);button.onclick=()=>activateDrawing(drawing.id);tabs.insertBefore(button,$('new-drawing'))}
  $('project-file-count').textContent=String(session?.documents.size??1)
  const activeTitle=documentTitle(doc()),discipline=documentDiscipline(doc());$('drawing-title').textContent=activeTitle;$('top-file-name').textContent=activeTitle;$('drawing-discipline').textContent=`${discipline} · 2D`;$('sample-discipline').textContent=discipline
  $('entity-count').textContent=`${allEntities.length.toLocaleString()} ${t('entities')}`;$('revision').textContent=`REV ${doc().revision}`
  $('selection-count').textContent=`${selectedIds().length} ${t('selected')}`
  $('undo').disabled=!doc().history.canUndo;$('redo').disabled=!doc().history.canRedo
  const layers=doc().getTable('layers').records;$('layer-count').textContent=layers.length
  $('layers').replaceChildren()
  for(const layer of layers){const label=document.createElement('label');label.className='layer';const input=document.createElement('input');input.type='checkbox';input.checked=layer.payload.visible!==false;input.setAttribute('aria-label',`${input.checked?'Hide':'Show'} layer ${layer.name}`);input.onchange=()=>run(()=>execute('LAYERUPDATE',{id:layer.id,patch:{visible:input.checked}}));const swatch=document.createElement('i');swatch.style.setProperty('--layer-color',colors[Math.abs(Number(layer.payload?.color??7))%colors.length]);const name=document.createElement('span');name.textContent=layer.name;const count=document.createElement('small');count.textContent=layerEntityCounts.get(layer.id)??0;label.append(input,swatch,name,count);$('layers').append(label)}
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
  if(measurement)renderMeasurement($('inspector'),measurement)
  syncAgentAvailability()
  render()
}
async function execute(command,args={},options={}) {
  invalidatePlan({preserveReceipt:Boolean(options.preserveReceipt)})
  const result=await sdk.executeCommandEnvelope(sdk.createCommandEnvelope(command,args,{expectedRevision:doc().revision,origin:'ui',...options}))
  $('file-state').textContent=i18n.locale==='zh'?'内存中已修改':'Modified in memory';message(`${command} committed · revision ${doc().revision}`);refresh();return result
}
async function query(command,args={}) {
  const result=await sdk.executeCommand(command,args)
  const value=Array.isArray(result)?result[0]??{}:result??{},units=String(doc().snapshot().header.units??''),rows=[]
  const number=(input,digits=3)=>Number(input).toLocaleString(i18n.locale==='zh'?'zh-CN':'en-US',{maximumFractionDigits:digits})
  if(Number.isFinite(value.distance))rows.push({label:i18n.locale==='zh'?'距离':'Distance',value:`${number(value.distance)} ${units}`})
  if(Number.isFinite(value.length))rows.push({label:i18n.locale==='zh'?'长度':'Length',value:`${number(value.length)} ${units}`})
  if(Number.isFinite(value.area))rows.push({label:i18n.locale==='zh'?'面积':'Area',value:`${number(value.area)} ${units}²`})
  if(Number.isFinite(value.degrees))rows.push({label:i18n.locale==='zh'?'角度':'Angle',value:`${number(value.degrees,2)}°`})
  if(Array.isArray(value.firstPoint))rows.push({label:i18n.locale==='zh'?'起点':'Start',value:`${number(value.firstPoint[0])}, ${number(value.firstPoint[1])}`})
  if(Array.isArray(value.secondPoint))rows.push({label:i18n.locale==='zh'?'终点':'End',value:`${number(value.secondPoint[0])}, ${number(value.secondPoint[1])}`})
  if(!rows.length)rows.push({label:command,value:i18n.locale==='zh'?'测量完成':'Complete'})
  measurement={command,rows,raw:result}
  if(!workbench.classList.contains('inspector-open'))$('toggle-inspector').click();selectSidePanel('properties');refresh();message(`${command} completed · drawing unchanged`);return result
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
async function freshSample(){rejectPendingPlan();workbench.dataset.demoState='loading';workbench.setAttribute('aria-busy','true');message(i18n.locale==='zh'?'正在生成五套原创行业图纸…':'Building five original industry drawings…');const next=createKJDrawSDK({documentAuthority:authority,solidAuthority});registerShowcaseCommand(next);const showcase=await createSample(next),industry=await createIndustrySamples(next);session?.destroy();sdk=next;session=KJProjectSession.create({sdk,id:'kjdraw-industry-samples',title:'KJDraw industry sample library',documents:[showcase,...industry],activeDocumentId:'sample-site-plan',metadata:{synthetic:true,industries:['energy','civil','architecture','transportation','mechanical']}});replaceSelection();measurement=null;invalidatePlan();setCanonicalIntent();$('file-state').textContent=t('memory');populateSampleSelector();refresh();fit();workbench.dataset.demoState='ready';workbench.setAttribute('aria-busy','false');message(i18n.locale==='zh'?`五套原创行业图纸已就绪 · 当前 ${modelEntities().length.toLocaleString()} 个可编辑对象`:`Five original industry drawings ready · ${modelEntities().length.toLocaleString()} editable objects in view`)}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function openFile(file){
  if(!file)return
  if(file.size>20*1024*1024)throw new Error('Playground file limit: 20 MiB. Use the SDK directly for larger files.')
  rejectPendingPlan();const next=createKJDrawSDK({documentAuthority:authority,solidAuthority});registerShowcaseCommand(next);let project
  if(file.name.toLowerCase().endsWith('.kjp'))project=await KJProjectSession.open(new Uint8Array(await file.arrayBuffer()),{sdk:next})
  else {const format=file.name.toLowerCase().endsWith('.dxf')?'DXF':'KJD';const drawing=await next.readDocument(format==='DXF'?new Uint8Array(await file.arrayBuffer()):await file.text(),{format});project=KJProjectSession.create({sdk:next,title:file.name,documents:[drawing]})}
  session?.destroy();sdk=next;session=project;replaceSelection();measurement=null;invalidatePlan();setCanonicalIntent();setTool('select');$('top-file-name').textContent=file.name;$('drawing-title').textContent=documentTitle(project.activeDocument);$('file-state').textContent=i18n.locale==='zh'?'已在本地打开':'Opened locally';populateSampleSelector();refresh();fit();workbench.dataset.demoState='ready';message(i18n.locale==='zh'?'文件已在当前工作区打开':'File opened in the current workspace')
}
$('open').onclick=()=>$('file-input').click()
function setPanelOpen(name,open){const className=name==='layers'?'layers-open':'inspector-open',button=$(name==='layers'?'toggle-layers':'toggle-inspector');workbench.classList.toggle(className,open);button.classList.toggle('active',open);button.setAttribute('aria-pressed',String(open))}
$('toggle-layers').onclick=()=>{const open=!workbench.classList.contains('layers-open');if(open&&window.innerWidth<=780)setPanelOpen('inspector',false);setPanelOpen('layers',open);resize()}
$('toggle-inspector').onclick=()=>{const open=!workbench.classList.contains('inspector-open');if(open&&window.innerWidth<=780)setPanelOpen('layers',false);setPanelOpen('inspector',open);resize()}
$('close-layers').onclick=()=>{$('toggle-layers').click()}
$('close-inspector').onclick=()=>{$('toggle-inspector').click()}
$('show-all-layers').onclick=()=>run(async()=>{for(const layer of doc().getTable('layers').records)if(layer.payload.visible===false||layer.payload.frozen)await execute('LAYERUPDATE',{id:layer.id,patch:{visible:true,frozen:false}})})
$('sample-select').onchange=e=>activateDrawing(e.target.value)
function selectSidePanel(name){for(const button of document.querySelectorAll('.right-tabs [data-panel]')){const active=button.dataset.panel===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))}for(const view of document.querySelectorAll('[data-panel-view]'))view.hidden=view.dataset.panelView!==name}
for(const tab of document.querySelectorAll('.right-tabs [data-panel]'))tab.onclick=()=>selectSidePanel(tab.dataset.panel)
$('file-input').onchange=e=>run(async()=>{try{await openFile(e.target.files[0])}finally{e.target.value=''}})
for(const eventName of ['dragenter','dragover'])$('drop-zone').addEventListener(eventName,e=>{e.preventDefault();$('drop-zone').classList.add('dragging')})
for(const eventName of ['dragleave','drop'])$('drop-zone').addEventListener(eventName,e=>{e.preventDefault();$('drop-zone').classList.remove('dragging')})
$('drop-zone').addEventListener('drop',e=>run(()=>openFile(e.dataTransfer?.files?.[0])))
$('snapshot').onclick=()=>{const record=session.createSnapshot(`Snapshot ${session.snapshotLedger.length+1}`);$('file-state').textContent='Modified in memory';message(`Project snapshot created · ${record.documents.length} drawing${record.documents.length===1?'':'s'}`)}
const formatBytes=value=>value<1024?`${value} B`:value<1024*1024?`${(value/1024).toFixed(1)} KiB`:`${(value/1024/1024).toFixed(1)} MiB`
async function saveProject(){const bytes=await session.package();download(bytes,'kjdraw-project.kjp','application/zip');message(i18n.locale==='zh'?`KJP 已生成（${formatBytes(bytes.length)}）· 包含工程内全部图纸`:`KJP generated (${formatBytes(bytes.length)}) · includes every project drawing`);return bytes}
$('save').onclick=()=>run(saveProject)
$('export').onclick=()=>run(async()=>{const text=await sdk.writeDocument(doc(),{format:'DXF',version:'2018'});download(text,'drawing.dxf','application/dxf');message('ASCII DXF 2018 downloaded · core adapter, see compatibility limits')})
$('undo').onclick=()=>run(()=>execute('UNDO'));$('redo').onclick=()=>run(()=>execute('REDO'))
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
$('new-drawing').onclick=()=>run(async()=>{const values=await requestLocalCommand({title:i18n.locale==='zh'?'新建图纸':'Create drawing',fields:[{name:'name',label:i18n.locale==='zh'?'图纸名称':'Drawing name',value:`Drawing ${session.documents.size+1}`}]});if(!values?.name.trim())return;const name=values.name.trim(),id=`drawing-${Date.now().toString(36)}`,drawing=sdk.createDocument({documentId:id,title:name,units:doc().snapshot().header.units??'unitless'});session.attachDocument(drawing);activateDrawing(id,{announce:false});$('file-state').textContent=i18n.locale==='zh'?'内存中已修改':'Modified in memory';message(`Drawing created · ${name}`)})
$('reset').onclick=()=>run(async()=>{const accepted=await requestLocalCommand({title:i18n.locale==='zh'?'重新加载原创示例？':'Reload the original sample?',description:i18n.locale==='zh'?'当前内存中的修改将被替换。需要保留时，请先保存 KJP。':'In-memory edits will be replaced. Save a KJP first if you need to keep them.',submitLabel:i18n.locale==='zh'?'重新加载':'Reload'});if(accepted)await freshSample()})
$('snap').onclick=()=>{snapEnabled=!snapEnabled;$('snap').textContent=t(snapEnabled?'snapOn':'snapOff');$('snap').setAttribute('aria-pressed',String(snapEnabled))}
$('grid').onclick=()=>{gridEnabled=!gridEnabled;$('grid').textContent=t(gridEnabled?'gridOn':'gridOff');$('grid').setAttribute('aria-pressed',String(gridEnabled));render()}
$('ortho').onclick=()=>{orthoEnabled=!orthoEnabled;$('ortho').textContent=t(orthoEnabled?'orthoOn':'orthoOff');$('ortho').setAttribute('aria-pressed',String(orthoEnabled));render()}
$('language').onclick=()=>{const canonical=knownIntent($('agent-intent').value);i18n.toggle();if(canonical)setCanonicalIntent();$('grid').textContent=t(gridEnabled?'gridOn':'gridOff');$('ortho').textContent=t(orthoEnabled?'orthoOn':'orthoOff');$('snap').textContent=t(snapEnabled?'snapOn':'snapOff');if(sdk){populateSampleSelector();refresh()}if(pendingPlan)displayAgentPlan(pendingPlan);setTool(tool)}
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
  if(pan){canvasRenderer.panBy(p[0]-pan.p[0],p[1]-pan.p[1]);pan.p=p;render();return}
  cursor=constrainedPoint(world(p));$('coordinates').textContent=`X ${cursor[0].toFixed(2)} · Y ${cursor[1].toFixed(2)}`;if(start)render()
}
canvas.onpointerdown=e=>{
  if(e.button===1){e.preventDefault();pan={p:pointer(e)};canvas.setPointerCapture(e.pointerId);return}
  if(e.button!==0||busy)return
  const p=constrainedPoint(world(pointer(e)))
  if(tool==='select'){
    const candidates=sdk.snap(world(pointer(e)),{radius:10/camera.scale,modes:['nearest','center','endpoint']})
      .map(candidate=>candidate.entityIds[0]).filter((id,index,ids)=>ids.indexOf(id)===index&&isVisible(doc().getObject(id)))
    const id=e.shiftKey?(candidates.find(candidate=>!selection.has(candidate))??candidates[0]??null):(candidates[0]??null)
    if(e.shiftKey){if(id)selection.has(id)?selection.delete(id):selection.add(id)}else replaceSelection(id?[id]:[])
    if(!workbench.classList.contains('inspector-open'))$('toggle-inspector').click();selectSidePanel('properties');refresh();return
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
canvas.addEventListener('wheel',e=>{e.preventDefault();canvasRenderer.zoomAt(Math.exp(-e.deltaY*.001),pointer(e));render()},{passive:false})
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='Escape'){setTool('select');invalidatePlan();render()}const key=e.key.toLowerCase();if(key==='l')setTool('line');if(key==='p')setTool('polyline');if(key==='c')setTool('circle');if(key==='a')setTool('arc');if(key==='r')setTool('rectangle');if(key==='e')setTool('ellipse');if(key==='x')setTool('xline');if(key==='q')setTool('point');if(key==='t')setTool('text');if(key==='d')setTool('measure');if(key==='v')setTool('select');if((e.ctrlKey||e.metaKey)&&key==='z'){e.preventDefault();run(()=>execute(e.shiftKey?'REDO':'UNDO'))}})
window.addEventListener('resize',()=>requestAnimationFrame(resize))
i18n.apply()
const narrowLayout=window.matchMedia('(max-width: 780px)')
if(narrowLayout.matches)setPanelOpen('inspector',false)
narrowLayout.addEventListener('change',event=>{if(event.matches){setPanelOpen('layers',false);setPanelOpen('inspector',false);requestAnimationFrame(resize)}})
try {
  const {instance}=await instantiateKJCoreWasm(new URL('../../web/public/kjcore/kjcore.wasm',import.meta.url))
  registerGeometryBackend(createWasmGeometryBackend(instance));authority=createKJCoreDocumentAuthority(instance);solidAuthority=createKJCoreSolidBackend(instance)
} catch(e){message('WASM unavailable · JavaScript reference mode');console.warn(e.message)}
await freshSample();resize();fit()
