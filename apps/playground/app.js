import { createKJDrawSDK, KJProjectSession, instantiateKJCoreWasm, createWasmGeometryBackend, registerGeometryBackend, createKJCoreDocumentAuthority, createKJCoreSolidBackend } from '../../packages/kjdraw-sdk/src/index.js'
import { KJCanvasRenderer, aciColor } from '../../packages/kjdraw-sdk/src/canvas-renderer.js'
import { kjdrawIcon } from '../../packages/kjdraw-sdk/src/theme.js'
import { KJDRAW_LAYOUTS, normalizeWorkbenchLayout } from '../../packages/kjdraw-sdk/src/layout.js'
import { createDraftingSession, parseDraftCoordinate } from '../../packages/kjdraw-sdk/src/drafting.js'
import { editEntityGrip } from '../../packages/kjdraw-sdk/src/grips.js'
import { KJ_MODIFICATION_DEFINITIONS, getKJModificationDefinition, buildKJModificationCommand, getKJModificationSelectionCenter } from '../../packages/kjdraw-sdk/src/modification-controls.js'
import { createSample } from '../../examples/sample.js'
import { createI18n } from './i18n.js'
import { AGENT_REVISION_COMMAND, createShowcaseRevision, getShowcaseIntent, isShowcaseIntent, registerShowcaseCommand, resolveShowcasePreset } from './agent-showcase.js'
import { createIndustrySamples, INDUSTRY_SAMPLES } from './industry-samples.js'

const $ = id => document.getElementById(id)
const i18n = createI18n(), t = key => i18n.t(key)
const workbench = document.querySelector('.workbench')
// Keep fitted geometry above the command dock and clear of viewport controls.
const canvas = $('canvas'), canvasRenderer = new KJCanvasRenderer(canvas,{theme:'dark',grid:true,padding:82}), ctx = canvasRenderer.context
const camera = {
  get x(){return canvasRenderer.camera.centerX},set x(value){canvasRenderer.camera.centerX=value},
  get y(){return canvasRenderer.camera.centerY},set y(value){canvasRenderer.camera.centerY=value},
  get scale(){return canvasRenderer.camera.scale},set scale(value){canvasRenderer.camera.scale=value},
}
initializeWorkbenchChrome()
let rendererSelectionKey = ''
const SHOWCASE_DOCUMENT_ID = 'sample-resilient-campus'
const SAMPLE_DESCRIPTORS = Object.freeze([
  { id: SHOWCASE_DOCUMENT_ID, title: 'Resilient energy campus', titleZh: '韧性能源园区', discipline: 'ENERGY' },
  ...INDUSTRY_SAMPLES,
])
let sdk, session, selection = new Set(), tool = 'select', start = null, draft = [], cursor = null, snapEnabled = true, gridEnabled = true, orthoEnabled = false, pendingPlan = null, pan = null, busy = false, authority = null, solidAuthority = null, measurement = null, width = 1, height = 1, lastReceipt = null
let translation = null, dragMove = null, drafting = null, modification = null
let selectionBox = null, gripDrag = null, fence = null, hoveredGrip = null, disposeInteractionDocument = null
const doc = () => sdk.activeDocument
const documentTitle = drawing => {
  const metadata = drawing?.snapshot().metadata
  if (i18n.locale === 'zh') return metadata?.custom?.titleZh ?? (drawing?.id === SHOWCASE_DOCUMENT_ID ? '韧性能源园区 / 总协调图' : metadata?.title || drawing?.id || '')
  return metadata?.title || drawing?.id || ''
}
const documentDiscipline = drawing => drawing?.snapshot().metadata?.custom?.discipline ?? (drawing?.id === SHOWCASE_DOCUMENT_ID ? 'ENERGY · STRESS' : 'DRAWING')
const selectedIds = () => [...selection].filter(id => isEditable(doc()?.getObject(id)))
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
function cancelSelectionGestures(){
  const pointerIds=new Set([dragMove?.pointerId,selectionBox?.pointerId,gripDrag?.pointerId].filter(Number.isInteger))
  const wasFence=Boolean(fence)
  dragMove=null;selectionBox=null;gripDrag=null;fence=null;hoveredGrip=null
  if(wasFence&&tool==='fence'){tool='select';for(const button of document.querySelectorAll('[data-tool]')){button.classList.toggle('active',button.dataset.tool==='select');button.setAttribute('aria-pressed',String(button.dataset.tool==='select'))}$('hint').textContent=t('canvasHint')}
  delete workbench.dataset.selectionMode;delete workbench.dataset.grip
  for(const pointerId of pointerIds)if(canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId)
}
function cancelInteraction(){
  const pointerIds=new Set([pan?.pointerId].filter(Number.isInteger))
  cancelSelectionGestures()
  pan=null;dragMove=null;translation=null;start=null;draft=[];cursor=null;drafting?.session.cancel();drafting=null;modification=null
  for(const pointerId of pointerIds)if(canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId)
}
function setTool(value) {
  let nextDraft=null
  if(isDraftTool(value)&&sdk?.activeDocument){
    try{const options=drawingOptions(value);nextDraft={session:createDraftingSession(value,options),options,documentId:doc().id,revision:doc().revision}}
    catch(error){message(error.message);$('hint').textContent=error.message;return false}
  }
  cancelInteraction()
  tool = value; start = null; draft = []
  canvas.style.cursor=value==='pan'?'grab':value==='select'?'default':'crosshair'
  for (const b of document.querySelectorAll('[data-tool]')) { b.classList.toggle('active', b.dataset.tool === tool); b.setAttribute('aria-pressed', String(b.dataset.tool === tool)) }
  const hints = i18n.locale === 'zh'
    ? { select:'滚轮缩放 · 中键拖动画布 · 单击检查对象', line:'直线：指定起点和终点', polyline:'多段线：依次指定三个顶点', circle:'圆：指定圆心和半径', arc:'圆弧：指定圆心、起点和终点', rectangle:'矩形：指定两个对角点', ellipse:'椭圆：指定中心和长轴端点', point:'点：指定位置', xline:'构造线：指定原点和方向', text:'文字：指定插入点', measure:'距离：指定两个测量点' }
    : { select:'Scroll to zoom · middle-drag to pan · click to inspect', line:'LINE: first point, then endpoint', polyline:'POLYLINE: choose three vertices', circle:'CIRCLE: center, then radius', arc:'ARC: center, start, then endpoint', rectangle:'RECTANGLE: choose opposite corners', ellipse:'ELLIPSE: choose center and major-axis endpoint', point:'POINT: choose a position', xline:'XLINE: choose origin and direction', text:'TEXT: choose insertion point', measure:'DISTANCE: choose two points' }
  $('hint').textContent = `${hints[tool] ?? tool.toUpperCase()}${tool === 'select' ? '' : ' · Esc to cancel'}`
  if(value==='pan')$('hint').textContent=t('panHint')
  if(value==='select')$('hint').textContent=t('canvasHint')
  if(value==='fence'){fence={...pointerBinding(),points:[],operation:'replace',initialIds:selectedIds()};$('hint').textContent=t('fenceHint')}
  if(['move','copy'].includes(value)&&sdk?.activeDocument){
    translation={command:value.toUpperCase(),ids:selectedIds(),base:null,documentId:doc().id,revision:doc().revision}
    updateTranslationHint()
  }
  if(nextDraft){drafting=nextDraft;updateDraftHint()}
  updateDraftControls()
  if(sdk?.activeDocument)render()
}
function isDraftTool(value){return ['line','polyline','circle','arc','ellipse','rectangle','polygon','point','ray','xline','spline','hatch','dimension'].includes(value)}
function drawingOptions(value){
  if(value==='circle')return {circleMode:$('circle-mode').value}
  if(value==='arc')return {arcMode:$('arc-mode').value}
  if(value==='polygon')return {sides:Number($('polygon-sides').value)}
  if(value==='spline')return {splineDegree:Number($('spline-degree').value)}
  if(value==='dimension')return {dimensionType:$('dimension-type').value,rotation:$('dimension-direction').value==='vertical'?Math.PI/2:0,textHeight:Number($('dimension-height').value)}
  if(value==='hatch')return {patternName:$('hatch-pattern').value,patternScale:Number($('hatch-scale').value),solid:$('hatch-pattern').value==='SOLID'}
  return {}
}
function updateDraftControls(){
  const container=$('draft-options');if(!container)return
  container.hidden=!isDraftTool(tool)
  if(isDraftTool(tool))$('drawing-tool').value=tool
  for(const field of container.querySelectorAll('[data-draft-tools]'))field.hidden=!field.dataset.draftTools.split(' ').includes(tool)
  const state=drafting?.session.state
  for(const input of container.querySelectorAll('input,select'))input.dataset.previousValue=input.value
  $('finish-draft').disabled=!state?.canFinish;$('close-draft').disabled=!state?.canClose;$('undo-draft-point').disabled=!state?.points.length
}
function updateDraftHint(){
  if(!drafting)return
  const roles={start:['Start point','起点'],end:['Endpoint','终点'],vertex:['Next vertex','下一顶点'],position:['Position','位置'],origin:['Origin','原点'],directionPoint:['Direction point','方向点'],center:['Center','圆心 / 中心'],radiusPoint:['Radius point (or enter radius)','半径点（也可输入半径）'],diameterPoint1:['First diameter endpoint','直径起点'],diameterPoint2:['Opposite diameter endpoint','直径终点'],throughPoint:['Point on curve','曲线上一点'],majorAxisPoint:['Major-axis endpoint','长轴端点'],minorAxisPoint:['Minor-axis distance','短轴距离'],firstCorner:['First corner','第一角点'],oppositeCorner:['Opposite corner','对角点'],controlPoint:['Next control point','下一控制点'],boundaryPoint:['Boundary vertex','填充边界顶点'],extensionOrigin1:['First measured point','第一测量点'],extensionOrigin2:['Second measured point','第二测量点'],placement:['Dimension line position','尺寸线位置'],oppositePoint:['Opposite diameter point','直径对侧点'],pointOnCircle:['Point on circle','圆上一点']}
  const state=drafting.session.state,role=roles[state.nextPoint]??[state.nextPoint??'',state.nextPoint??'']
  $('hint').textContent=`${tool.toUpperCase()} · ${role[i18n.locale==='zh'?1:0]} · ${state.points.length} ${i18n.locale==='zh'?'点':'points'} · x,y / @dx,dy / @distance<angle${state.canFinish?' · Enter':''}${state.canClose?' · C':''} · Esc`
  message($('hint').textContent);updateDraftControls()
}
async function applyDraftInput(value,{coordinate=false,finish=false,close=false}={}){
  const task=drafting;if(!task)return
  if(doc().id!==task.documentId||doc().revision!==task.revision){setTool('select');throw new Error(t('drawingChanged'))}
  let spec
  const previousPoints=task.session.points
  if(close)spec=task.session.close()
  else if(finish)spec=task.session.finish()
  else if(coordinate){
    if(tool==='circle'&&$('circle-mode').value==='center-radius'&&task.session.points.length===1&&/^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)){
      const radius=Number(value),center=task.session.points[0];if(!(radius>0))throw new Error(i18n.locale==='zh'?'半径必须大于零':'Radius must be positive');spec=task.session.addPoint([center[0]+radius,center[1]])
    }else spec=task.session.addCoordinate(value)
  }else spec=task.session.addPoint(value)
  start=task.session.points.at(-1)??null
  if(spec){
    try{await execute('CREATE',spec,{expectedRevision:task.revision})}
    catch(error){task.session=createDraftingSession(task.session.tool,task.options);for(const p of previousPoints)task.session.addPoint(p);start=task.session.points.at(-1)??null;updateDraftHint();render();throw error}
    const currentTool=tool;setTool(currentTool);refresh()
  }
  else {updateDraftHint();render()}
}
function undoDraftPoint(){drafting?.session.undoPoint();start=drafting?.session.points.at(-1)??null;updateDraftHint();render()}
function updateTranslationHint(){
  if(!translation)return
  const text=t(!translation.ids.length?'moveChoose':translation.base?'moveTarget':'moveBase')
  $('hint').textContent=`${t(tool)} · ${text} · Esc`;message($('hint').textContent)
}
function translationValid(value){return value&&doc().id===value.documentId&&doc().revision===value.revision&&value.ids.every(id=>doc().getObject(id))}
async function commitTranslation(value,target){
  if(!translationValid(value))throw new Error(t('drawingChanged'))
  const dx=target[0]-value.base[0],dy=target[1]-value.base[1]
  if(Math.hypot(dx,dy)<1e-10){setTool('select');return}
  const receipt=await execute(value.command,{ids:value.ids,dx,dy},{expectedRevision:value.revision})
  if(value.command==='COPY')replaceSelection(receipt.result.map(row=>row.id))
  setTool('select');refresh()
}
function isVisible(entity) { if (!entity) return false; const p = doc().getObject(entity.payload?.layerId)?.payload; return p?.visible !== false && p?.frozen !== true }
function isEditable(entity){return Boolean(entity&&entity.ownerId===doc().snapshot().spaces.modelSpaceId&&isVisible(entity)&&doc().getObject(entity.payload?.layerId)?.payload.locked!==true)}
function pointerView(){const rect=canvas.getBoundingClientRect();return [camera.x,camera.y,camera.scale,rect.left,rect.top,rect.width,rect.height]}
function pointerBinding(){return {document:doc(),documentId:doc().id,revision:doc().revision,view:pointerView()}}
function pointerBindingValid(binding){const view=pointerView();return Boolean(binding&&doc()===binding.document&&doc().revision===binding.revision&&binding.view.every((value,index)=>Math.abs(value-view[index])<1e-7))}
function selectionOperation(event){return event.ctrlKey||event.metaKey?'remove':event.shiftKey?'add':'replace'}
function applySelection(ids,operation,initialIds=selectedIds()){
  replaceSelection(operation==='add'?[...new Set([...initialIds,...ids])]:operation==='remove'?initialIds.filter(id=>!ids.includes(id)):ids)
  selectSidePanel('properties');refresh();message(`${selectedIds().length} ${t('selected')}`)
}
function finishFence(){
  const task=fence;if(!task)return
  if(!pointerBindingValid(task)){setTool('select');message(t('interactionChanged'));return}
  if(task.points.length<2){message(t('fenceHint'));return}
  const ids=canvasRenderer.selectFence(task.points)
  setTool('select');applySelection(ids,task.operation,task.initialIds)
}
// Transient and committed geometry share the public renderer.
function drawOverlayEntity(entity, color, offset = [0,0]) {
  canvasRenderer.drawPreview([entity],color,offset)
}
function render() {
  if(!sdk?.activeDocument)return
  let rendered=false
  if(canvasRenderer.document!==doc()){
    disposeInteractionDocument?.();cancelSelectionGestures();canvasRenderer.setDocument(doc());rendererSelectionKey='';rendered=true
    const drawing=doc();disposeInteractionDocument=drawing.on('document:change',()=>{
      if(doc()!==drawing)return
      if(selectionBox||gripDrag||dragMove||fence){cancelSelectionGestures();message(t('interactionChanged'))}
      replaceSelection(selectedIds());render()
    })
  }
  if([selectionBox,gripDrag,dragMove,fence].some(binding=>binding&&!pointerBindingValid(binding))){cancelSelectionGestures();message(t('interactionChanged'))}
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
  const moving=dragMove?.started?{...dragMove,command:'MOVE',base:dragMove.worldStart}:translation
  if(moving?.base&&cursor&&translationValid(moving)){
    const offset=[cursor[0]-moving.base[0],cursor[1]-moving.base[1]]
    for(const id of moving.ids)drawOverlayEntity(doc().getObject(id),'#77a7ff',offset)
    const [sx,sy]=point(moving.base),[ex,ey]=point(cursor)
    ctx.save();ctx.strokeStyle='#77a7ff';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();ctx.restore()
  }
  if(drafting){const preview=drafting.session.preview(cursor??undefined);if(preview)drawOverlayEntity(preview,'#77a7ff')}
  if(!drafting&&start&&cursor){
    drawOverlayEntity({type:'LINE',payload:{start,end:cursor}},'#bdf878')
  }
  if(gripDrag?.preview)drawOverlayEntity(gripDrag.preview,'#77a7ff')
  if(tool==='select'&&selectedIds().length===1&&!selectionBox&&!dragMove?.started)canvasRenderer.drawGrips(hoveredGrip??undefined)
  if(selectionBox){
    const a=selectionBox.start,b=selectionBox.current,crossing=b[0]<a[0]
    workbench.dataset.selectionMode=crossing?'crossing':'window'
    ctx.save();ctx.fillStyle=crossing?'#34d39922':'#60a5fa22';ctx.strokeStyle=crossing?'#34d399':'#60a5fa';ctx.lineWidth=1;ctx.setLineDash(crossing?[5,4]:[])
    ctx.fillRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));ctx.strokeRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));ctx.restore()
  }
  if(fence?.points.length){ctx.save();ctx.strokeStyle='#34d399';ctx.setLineDash([5,4]);ctx.beginPath();for(const [index,p] of [...fence.points,...(cursor?[point(cursor)]:[])].entries())index?ctx.lineTo(...p):ctx.moveTo(...p);ctx.stroke();ctx.restore()}
}
function resize() {
  const rect = canvas.getBoundingClientRect();width=rect.width;height=rect.height
  if([selectionBox,gripDrag,dragMove,fence].some(binding=>binding&&!pointerBindingValid(binding)))cancelSelectionGestures()
  canvasRenderer.resize(width,height);render()
}
function fit(){cancelSelectionGestures();canvasRenderer.fit();render()}
function focusRegion([x0,y0,x1,y1]){camera.x=(x0+x1)/2;camera.y=(y0+y1)/2;camera.scale=Math.max(.00001,Math.min((width-90)/Math.max(1,x1-x0),(height-110)/Math.max(1,y1-y0)));render()}
function field(container,label,value) { const row=document.createElement('div');row.className='kv';const k=document.createElement('span'),v=document.createElement('b');k.textContent=label;v.textContent=String(value);row.append(k,v);container.append(row) }
function populateSampleSelector() {
  const select=$('sample-select'),active=doc()?.id
  select.replaceChildren()
  for(const drawing of session?.documents.values()??[]){
    const sample=SAMPLE_DESCRIPTORS.find(sample=>sample.id===drawing.id)
    const option=document.createElement('option');option.value=drawing.id;option.textContent=sample?(i18n.locale==='zh'?sample.titleZh:sample.title):documentTitle(drawing);option.selected=drawing.id===active;select.append(option)
  }
  select.hidden=!select.options.length
}
function syncAgentAvailability() {
  const available=doc()?.id===SHOWCASE_DOCUMENT_ID
  document.querySelector('.agent-panel').classList.toggle('unavailable',!available)
  $('open-agent-sample').hidden=available
  for(const id of ['agent-preset','agent-intent','plan'])$(id).disabled=!available
  if(!available){$('confirm').disabled=true;$('plan-state').dataset.state='idle';$('plan-state').textContent=t('agentSampleRequired')}
}
function busyNotice(){const text=i18n.locale==='zh'?'正在完成上一项操作，请稍候再试。':'Finishing the current operation. Please wait and try again.';message(text);$('hint').textContent=text;workbench.dataset.lastError=text;return false}
function activateDrawing(id,{announce=true,allowBusy=false}={}) {
  if(!session?.documents.has(id))return
  if(busy&&!allowBusy){if(session.activeDocumentId)$('sample-select').value=session.activeDocumentId;return busyNotice()}
  setTool('select')
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
  for(const layer of layers){
    const row=document.createElement('div');row.className='layer';row.dataset.layerName=layer.name
    const input=document.createElement('input');input.type='checkbox';input.checked=layer.payload.visible!==false
    input.setAttribute('aria-label',`${t(input.checked?'hideLayer':'showLayer')} · ${layer.name}`)
    input.onchange=()=>run(()=>execute('LAYERUPDATE',{id:layer.id,patch:{visible:input.checked}}))
    const swatch=document.createElement('i'),rawColor=layer.payload.trueColor
    const color=rawColor!=null?(typeof rawColor==='number'?`#${rawColor.toString(16).padStart(6,'0')}`:String(rawColor)):aciColor(layer.payload.color??7)
    swatch.style.setProperty('--layer-color',color)
    const name=document.createElement('span');name.textContent=layer.name;name.title=layer.name;row.dataset.frozen=String(layer.payload.frozen===true)
    if(layer.payload.frozen===true){name.textContent+=` · ${t('frozenLayer')}`;name.title=name.textContent}
    const count=document.createElement('small');count.textContent=layerEntityCounts.get(layer.id)??0
    const lock=document.createElement('button'),locked=layer.payload.locked===true;lock.className='layer-lock';lock.innerHTML=kjdrawIcon(locked?'lock':'unlock');lock.title=`${t(locked?'unlockLayer':'lockLayer')} · ${layer.name}`;lock.setAttribute('aria-label',lock.title);lock.setAttribute('aria-pressed',String(locked));lock.onclick=()=>run(()=>execute('LAYERUPDATE',{id:layer.id,patch:{locked:!locked}}))
    const edit=document.createElement('button');edit.innerHTML=kjdrawIcon('panel');edit.title=`${t('editLayer')} · ${layer.name}`;edit.setAttribute('aria-label',edit.title)
    edit.onclick=()=>run(async()=>{const values=await requestLocalCommand({title:t('editLayer'),fields:[{name:'name',label:t('layerName'),value:layer.name},{name:'color',label:t('layerColor'),type:'number',value:layer.payload.color??7,step:1},{name:'visible',label:t('visibleLayer'),type:'checkbox',value:layer.payload.visible!==false,required:false},{name:'locked',label:t('lockedLayer'),type:'checkbox',value:layer.payload.locked===true,required:false},{name:'frozen',label:t('freezeLayer'),type:'checkbox',value:layer.payload.frozen===true,required:false}]});if(!values)return;const color=Number(values.color);if(!Number.isInteger(color)||color<1||color>255)throw new Error(t('layerColorRange'));await execute('LAYERUPDATE',{id:layer.id,newName:values.name.trim()||layer.name,patch:{color,trueColor:null,visible:values.visible,locked:values.locked,frozen:values.frozen}})})
    row.append(input,swatch,name,count,lock,edit);$('layers').append(row)
  }
  filterLayers()
  replaceSelection(selectedIds());const entity=primarySelection()?doc().getObject(primarySelection()):null
  $('inspector').replaceChildren();const title=document.createElement('h3');title.textContent=selectedIds().length>1?`${selectedIds().length} ${t('objectsSelected')}`:entity?entity.type:t('drawingDocument');$('inspector').append(title)
  if(entity){
    if(selectedIds().length>1){const summary=document.createElement('div');summary.className='selection-summary';summary.textContent=`${t('primary')}: ${entity.type} · ${t('groupHint')}`;$('inspector').append(summary)}
    field($('inspector'),t('handle'),entity.handle);field($('inspector'),t('layer'),doc().getObject(entity.payload.layerId)?.name??'0');if(entity.payload.radius)field($('inspector'),t('radius'),entity.payload.radius.toFixed(3));if(entity.payload.text)field($('inspector'),t('textField'),entity.payload.text)
    const editor=document.createElement('div');editor.className='property-editor'
    const layerLabel=document.createElement('label');layerLabel.textContent=t('layer');const layerSelect=document.createElement('select')
    for(const layer of doc().getTable('layers').records){const option=document.createElement('option');option.value=layer.id;option.textContent=layer.name;option.selected=layer.id===entity.payload.layerId;layerSelect.append(option)}
    layerLabel.append(layerSelect);editor.append(layerLabel)
    let valueInput=null
    if(entity.type==='CIRCLE'||entity.type==='ARC'){const label=document.createElement('label');label.textContent=t('radius');valueInput=document.createElement('input');valueInput.type='number';valueInput.min='0.000001';valueInput.step='0.1';valueInput.value=entity.payload.radius;label.append(valueInput);editor.append(label)}
    if(entity.type==='TEXT'||entity.type==='MTEXT'){const label=document.createElement('label');label.textContent=t('textField');valueInput=document.createElement('input');valueInput.value=entity.payload.text??'';label.append(valueInput);editor.append(label)}
    const save=document.createElement('button');save.textContent=t('applyProperties');save.onclick=()=>run(async()=>{const payload={...entity.payload,layerId:layerSelect.value};if(valueInput&&(entity.type==='CIRCLE'||entity.type==='ARC'))payload.radius=Number(valueInput.value);if(valueInput&&(entity.type==='TEXT'||entity.type==='MTEXT'))payload.text=valueInput.value;await execute('PROPERTIES',{id:entity.id,patch:{payload}})});editor.append(save);$('inspector').append(editor)
    const erase=document.createElement('button');erase.textContent=t('deleteSelected');erase.onclick=()=>run(()=>execute('ERASE',{ids:selectedIds()}));$('inspector').append(erase)
  }
  else {field($('inspector'),t('revision'),doc().revision);field($('inspector'),t('modelEntities'),currentModel.length);field($('inspector'),t('kernel'),authority?'Rust / WASM':t('jsReference'));field($('inspector'),t('units'),doc().snapshot().header.units??'unspecified');const help=document.createElement('div');help.className='inspector-empty';help.innerHTML=kjdrawIcon('select');help.append(document.createTextNode(t('inspectHint')));$('inspector').append(help)}
  if(measurement)renderMeasurement($('inspector'),measurement)
  syncAgentAvailability()
  render()
}
async function execute(command,args={},options={}) {
  const operationSdk=sdk,operationDocument=doc(),{preserveReceipt,...commandOptions}=options
  invalidatePlan({preserveReceipt:Boolean(preserveReceipt)})
  const envelope=operationSdk.createCommandEnvelope(command,args,{expectedRevision:operationDocument.revision,origin:'ui',...commandOptions,document:operationDocument})
  const result=await operationSdk.executeCommandEnvelope(envelope,{document:operationDocument})
  $('file-state').textContent=i18n.locale==='zh'?'内存中已修改':'Modified in memory';message(`${command} committed · revision ${operationDocument.revision}`)
  if(sdk===operationSdk&&doc()===operationDocument)refresh()
  return result
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
function requireSelection(){const entity=primarySelection()?doc().getObject(primarySelection()):null;if(!entity)throw new Error(t('selectFirst'));return entity}
function requestLocalCommand({title,description='',submitLabel,fields=[]}) {
  const dialog=$('app-dialog'),form=$('dialog-form'),fieldRoot=$('dialog-fields')
  form.onkeydown=event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT'){event.preventDefault();form.requestSubmit($('dialog-submit'))}}
  $('dialog-title').textContent=title;$('dialog-description').textContent=description;$('dialog-description').hidden=!description
  $('dialog-submit').textContent=submitLabel??t('continue');fieldRoot.replaceChildren()
  const controls=[]
  for(const field of fields){
    const label=document.createElement('label');label.textContent=field.label;const input=document.createElement(field.options?'select':'input');input.name=field.name
    if(field.options){for(const [value,text] of field.options){const option=document.createElement('option');option.value=value;option.textContent=text;input.append(option)}}else input.type=field.type??'text'
    input.value=field.value??'';if(input.type==='checkbox')input.checked=Boolean(field.value);if(field.min!=null)input.min=String(field.min);if(field.max!=null)input.max=String(field.max);if(field.step!=null)input.step=String(field.step);input.required=field.required!==false;input.autocomplete='off';label.append(input);fieldRoot.append(label);controls.push(input)
  }
  return new Promise(resolve=>{
    const close=()=>{dialog.removeEventListener('close',close);if(dialog.returnValue!=='default'){resolve(null);return}const values={};for(const input of controls){if(!input.reportValidity()){resolve(null);return}values[input.name]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value}resolve(values)}
    dialog.addEventListener('close',close);dialog.returnValue='cancel';dialog.showModal();queueMicrotask(()=>controls[0]?.focus())
  })
}
async function transformSelection(command){
  return beginModification(command.toLowerCase())
}
async function beginModification(id){
  const definition=getKJModificationDefinition(id),ids=selectedIds(),drawing=doc(),locale=i18n.locale==='zh'?'zh':'en'
  if(ids.length<definition.minSelection||(definition.maxSelection!=null&&ids.length>definition.maxSelection))throw new Error(`${definition.label[locale]} · ${i18n.locale==='zh'?'需要选择':'Select'} ${definition.minSelection}${definition.maxSelection===definition.minSelection?'': '+'} ${i18n.locale==='zh'?'个对象':'objects'}`)
  if(definition.supportedEntityTypes&&ids.some(id=>!definition.supportedEntityTypes.includes(drawing.getObject(id).type)))throw new Error(`${definition.label[locale]}: ${definition.supportedEntityTypes.join(', ')}`)
  if(['trim','extend'].includes(id)&&drawing.getObject(ids[0]).type!=='LINE')throw new Error(i18n.locale==='zh'?'先选待编辑直线，再按 Shift 选择边界。':'Select the target line first, then Shift-select boundaries.')
  const bound={documentId:drawing.id,revision:drawing.revision,ids,selectionCenter:getKJModificationSelectionCenter(ids.map(id=>drawing.getObject(id)))}
  let values={}
  if(definition.fields.length){values=await requestLocalCommand({title:definition.label[locale],description:definition.description[locale],fields:definition.fields.map(field=>({name:field.key,label:field.label[locale],type:field.type==='boolean'?'checkbox':'number',value:field.default,min:field.min,max:field.max,step:field.type==='integer'?1:field.step??'any',required:field.type!=='boolean'}))});if(!values)return}
  if(!translationValid(bound))throw new Error(t('drawingChanged'))
  setTool('select');modification={...bound,definition,values,points:[]};canvas.style.cursor='crosshair'
  if(!definition.pointKeys.length)await commitModification()
  else {updateModificationHint();canvas.focus()}
}
function updateModificationHint(){if(!modification)return;const locale=i18n.locale==='zh'?'zh':'en';$('hint').textContent=`${modification.definition.label[locale]} · ${modification.definition.pointKeys[modification.points.length]?.label[locale]??''} · x,y / @dx,dy · Esc`;message($('hint').textContent)}
async function addModificationPoint(p){
  if(!translationValid(modification)){setTool('select');throw new Error(t('drawingChanged'))}
  modification.points.push(p);start=p
  if(modification.points.length>=modification.definition.pointKeys.length)await commitModification()
  else {updateModificationHint();render()}
}
async function commitModification(){
  const task=modification;if(!translationValid(task)){setTool('select');throw new Error(t('drawingChanged'))}
  let receipt
  try {const command=buildKJModificationCommand(task.definition.id,{ids:task.ids,values:task.values,points:task.points,selectionCenter:task.selectionCenter});receipt=await execute(command.command,command.arguments,{expectedRevision:task.revision})}
  catch(error){if(translationValid(task)&&task.points.length){task.points.pop();start=task.points.at(-1)??null;updateModificationHint();render()}else setTool('select');throw error}
  const ids=[];const collect=value=>{if(!value||typeof value!=='object')return;if(value.id&&doc().getObject(value.id)?.kind==='entity')ids.push(value.id);else if(Array.isArray(value))value.forEach(collect);else Object.values(value).forEach(collect)};collect(receipt.result)
  if(ids.length)replaceSelection([...new Set(ids)]);setTool('select');refresh()
}
async function runTypedCommand(){
  const raw=$('command-input').value.trim();if(!raw){if(fence)finishFence();else if(drafting?.session.state.canFinish)await applyDraftInput(null,{finish:true});return}
  if(/^FENCE$/i.test(raw)){$('command-input').value='';setTool('fence');canvas.focus();return}
  if(/^(?:SELECTALL|ALL)$/i.test(raw)){$('command-input').value='';setTool('select');applySelection(canvasRenderer.selectAll(),'replace');return}
  if(modification&&/^@?[+\-.\d]/.test(raw)){$('command-input').value='';await addModificationPoint(parseDraftCoordinate(raw,modification.points.at(-1)));return}
  if(drafting&&/^@?[+\-.\d]/.test(raw)){$('command-input').value='';await applyDraftInput(raw,{coordinate:true});return}
  if(drafting&&/^(?:C|CLOSE)$/i.test(raw)){$('command-input').value='';await applyDraftInput(null,{close:true});return}
  if(drafting&&/^(?:U|BACK)$/i.test(raw)){$('command-input').value='';undoDraftPoint();return}
  const drawCommands={LINE:'line',L:'line',PLINE:'polyline',POLYLINE:'polyline',PL:'polyline',CIRCLE:'circle',CIRCLE2P:'circle',CIRCLE3P:'circle',ARC:'arc',ARC3P:'arc',ELLIPSE:'ellipse',POLYGON:'polygon',SPLINE:'spline',HATCH:'hatch',DIMALIGNED:'dimension',DIMLINEAR:'dimension',DIMRADIUS:'dimension',DIMDIAMETER:'dimension',RAY:'ray',XLINE:'xline',POINT:'point',RECTANGLE:'rectangle'}
  const drawCommand=raw.toUpperCase()
  if(drawCommands[drawCommand]){
    if(drawCommand.startsWith('CIRCLE'))$('circle-mode').value=drawCommand==='CIRCLE2P'?'2-point':drawCommand==='CIRCLE3P'?'3-point':'center-radius'
    if(drawCommand.startsWith('ARC'))$('arc-mode').value=drawCommand==='ARC3P'?'3-point':'center-start-end'
    if(drawCommand.startsWith('DIM'))$('dimension-type').value=({DIMALIGNED:'ALIGNED',DIMLINEAR:'ROTATED',DIMRADIUS:'RADIUS',DIMDIAMETER:'DIAMETER'})[drawCommand]
    $('command-input').value='';setTool(drawCommands[drawCommand]);return
  }
  const modificationDefinition=KJ_MODIFICATION_DEFINITIONS.find(definition=>definition.command===drawCommand)
  if(modificationDefinition){$('command-input').value='';await beginModification(modificationDefinition.id);return}
  const [name,...values]=raw.split(/[\s,]+/),command=({M:'MOVE',CO:'COPY',CP:'COPY'})[name.toUpperCase()]??name.toUpperCase();$('command-input').value=''
  if((command==='MOVE'||command==='COPY')&&!values.length){setTool(command.toLowerCase());canvas.focus();return}
  if(command==='FIT'){fit();message('View fitted');return}if(command==='UNDO'||command==='REDO'){await execute(command);return}
  if(command==='MOVE'||command==='COPY'){requireSelection();if(values.length!==2||values.some(value=>!Number.isFinite(Number(value))))throw new Error(t('translationNumbers'));const [dx,dy]=values.map(Number);const result=(await execute(command,{ids:selectedIds(),dx,dy})).result;if(command==='COPY'&&Array.isArray(result))replaceSelection(result.map(row=>row.id).filter(Boolean));setTool('select');refresh();return}
  if(command==='ROTATE'){requireSelection();await execute(command,{ids:selectedIds(),angle:Number(values[0]??0)*Math.PI/180,center:[0,0]});return}
  if(command==='OFFSET'){const result=(await execute(command,{id:requireSelection().id,distance:Number(values[0]??1)})).result;if(result?.id)replaceSelection([result.id]);setTool('select');refresh();return}
  if(command==='ERASE'||command==='DELETE'){requireSelection();await execute('ERASE',{ids:selectedIds()});return}
  if(command==='LENGTH'||command==='AREA'){await query(command,{ids:[requireSelection().id]});return}
  throw new Error(`${i18n.locale==='zh'?'未知命令。绘图和修改菜单列出可用工具；也可输入':'Unknown command. Use the Drawing / Modification menus, or type'} LINE, PLINE, CIRCLE, ARC, ELLIPSE, POLYGON, SPLINE, HATCH, DIMALIGNED, MOVE, COPY, ARRAYPOLAR, TRIM, FILLET, UNDO, FIT.`)
}
async function run(work){if(busy)return busyNotice();busy=true;workbench.setAttribute('aria-busy','true');try{await work();return true}catch(e){const text=e.cause?.message??e.message;message(text);$('hint').textContent=text;workbench.dataset.lastError=text;return false}finally{busy=false;workbench.setAttribute('aria-busy','false')}}
async function freshSample(){setTool('select');rejectPendingPlan();workbench.dataset.demoState='loading';workbench.setAttribute('aria-busy','true');message(i18n.locale==='zh'?'正在生成五套原创行业图纸…':'Building five original industry drawings…');const next=createKJDrawSDK({documentAuthority:authority,solidAuthority});registerShowcaseCommand(next);const showcase=await createSample(next),industry=await createIndustrySamples(next);session?.destroy();sdk=next;session=KJProjectSession.create({sdk,id:'kjdraw-industry-samples',title:'KJDraw industry sample library',documents:[showcase,...industry],activeDocumentId:'sample-site-plan',metadata:{synthetic:true,industries:['energy','civil','architecture','transportation','mechanical']}});replaceSelection();measurement=null;invalidatePlan();setCanonicalIntent();$('file-state').textContent=t('memory');populateSampleSelector();refresh();fit();workbench.dataset.demoState='ready';workbench.setAttribute('aria-busy','false');message(i18n.locale==='zh'?`五套原创行业图纸已就绪 · 当前 ${modelEntities().length.toLocaleString()} 个可编辑对象`:`Five original industry drawings ready · ${modelEntities().length.toLocaleString()} editable objects in view`)}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function openFile(file){
  if(!file)return
  setTool('select')
  if(file.size>20*1024*1024)throw new Error('Playground file limit: 20 MiB. Use the SDK directly for larger files.')
  rejectPendingPlan();const next=createKJDrawSDK({documentAuthority:authority,solidAuthority});registerShowcaseCommand(next);let project
  if(file.name.toLowerCase().endsWith('.kjp'))project=await KJProjectSession.open(new Uint8Array(await file.arrayBuffer()),{sdk:next})
  else {const format=file.name.toLowerCase().endsWith('.dxf')?'DXF':'KJD';const drawing=await next.readDocument(format==='DXF'?new Uint8Array(await file.arrayBuffer()):await file.text(),{format});project=KJProjectSession.create({sdk:next,title:file.name,documents:[drawing]})}
  session?.destroy();sdk=next;session=project;replaceSelection();measurement=null;invalidatePlan();setCanonicalIntent();setTool('select');$('top-file-name').textContent=file.name;$('drawing-title').textContent=documentTitle(project.activeDocument);$('file-state').textContent=i18n.locale==='zh'?'已在本地打开':'Opened locally';populateSampleSelector();refresh();fit();workbench.dataset.demoState='ready';message(i18n.locale==='zh'?'文件已在当前工作区打开':'File opened in the current workspace')
}
function chooseFile(){if(busy)return busyNotice();setTool('select');$('file-input').click()}
$('open').onclick=chooseFile
function setPanelOpen(name,open){const className=name==='layers'?'layers-open':'inspector-open',button=$(name==='layers'?'toggle-layers':'toggle-inspector');workbench.classList.toggle(className,open);button.classList.toggle('active',open);button.setAttribute('aria-pressed',String(open))}
$('open-agent-sample').onclick=()=>activateDrawing(SHOWCASE_DOCUMENT_ID)
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
$('move-selection').onclick=()=>{setTool('move');canvas.focus()}
$('copy-selection').onclick=()=>{setTool('copy');canvas.focus()}
$('rotate-selection').onclick=()=>run(()=>transformSelection('ROTATE'))
$('offset-selection').onclick=()=>run(()=>transformSelection('OFFSET'))
$('delete-selection').onclick=()=>run(()=>{requireSelection();return execute('ERASE',{ids:selectedIds()})})
$('measure-entity').onclick=()=>run(async()=>{const entity=requireSelection();const supportedArea=['CIRCLE','ELLIPSE','LWPOLYLINE','POLYLINE','SOLID','TRACE'].includes(entity.type);await query(supportedArea?'AREA':'LENGTH',{ids:[entity.id]})})
$('run-command').onclick=()=>run(runTypedCommand)
$('command-input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();run(runTypedCommand)}}
$('new-layer').onclick=()=>run(async()=>{const values=await requestLocalCommand({title:i18n.locale==='zh'?'新建图层':'Create layer',fields:[{name:'name',label:i18n.locale==='zh'?'图层名称':'Layer name',value:'Design'}]});if(!values?.name.trim())return;await execute('LAYERNEW',{name:values.name.trim(),color:3})})
$('new-drawing').onclick=()=>run(async()=>{const values=await requestLocalCommand({title:i18n.locale==='zh'?'新建图纸':'Create drawing',fields:[{name:'name',label:i18n.locale==='zh'?'图纸名称':'Drawing name',value:`Drawing ${session.documents.size+1}`},{name:'units',label:i18n.locale==='zh'?'绘图单位':'Drawing units',value:doc().snapshot().header.units??'millimeter',options:[['millimeter','mm'],['centimeter','cm'],['meter','m'],['inch','in'],['foot','ft'],['unitless',i18n.locale==='zh'?'无单位':'Unitless']]}]});if(!values?.name.trim())return;const name=values.name.trim(),id=`drawing-${Date.now().toString(36)}`,drawing=sdk.createDocument({documentId:id,title:name,units:values.units});session.attachDocument(drawing);activateDrawing(id,{announce:false,allowBusy:true});$('file-state').textContent=i18n.locale==='zh'?'内存中已修改':'Modified in memory';message(`Drawing created · ${name}`)})
$('reset').onclick=()=>run(async()=>{const accepted=await requestLocalCommand({title:i18n.locale==='zh'?'重新加载原创示例？':'Reload the original sample?',description:i18n.locale==='zh'?'当前内存中的修改将被替换。需要保留时，请先保存 KJP。':'In-memory edits will be replaced. Save a KJP first if you need to keep them.',submitLabel:i18n.locale==='zh'?'重新加载':'Reload'});if(accepted)await freshSample()})
$('snap').onclick=()=>{snapEnabled=!snapEnabled;$('snap').textContent=t(snapEnabled?'snapOn':'snapOff');$('snap').setAttribute('aria-pressed',String(snapEnabled))}
$('grid').onclick=()=>{gridEnabled=!gridEnabled;$('grid').textContent=t(gridEnabled?'gridOn':'gridOff');$('grid').setAttribute('aria-pressed',String(gridEnabled));render()}
$('ortho').onclick=()=>{orthoEnabled=!orthoEnabled;$('ortho').textContent=t(orthoEnabled?'orthoOn':'orthoOff');$('ortho').setAttribute('aria-pressed',String(orthoEnabled));render()}
$('language').onclick=()=>{const canonical=knownIntent($('agent-intent').value);i18n.toggle();if(canonical)setCanonicalIntent();$('grid').textContent=t(gridEnabled?'gridOn':'gridOff');$('ortho').textContent=t(orthoEnabled?'orthoOn':'orthoOff');$('snap').textContent=t(snapEnabled?'snapOn':'snapOff');if(sdk){populateSampleSelector();refresh();message(`${t('ready')} · ${documentTitle(doc())}`)}if(pendingPlan)displayAgentPlan(pendingPlan);if(translation)updateTranslationHint();else if(drafting)updateDraftHint();else if(modification)updateModificationHint();else if(tool==='select')$('hint').textContent=t('canvasHint');else if(tool==='pan')$('hint').textContent=t('panHint');else if(tool==='fence')$('hint').textContent=t('fenceHint')}
for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>{setTool(b.dataset.tool);canvas.focus()}
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
function snap(p,excludeIds=[]){if(!snapEnabled||!sdk)return p;const hits=sdk.snap(p,{entityIds:modelEntities().filter(entity=>isVisible(entity)&&!excludeIds.includes(entity.id)).map(entity=>entity.id),radius:8/camera.scale,modes:['endpoint','midpoint','center','nearest']});return hits[0]?.point??p}
function constrainedPoint(p){const value=snap(p);if(!orthoEnabled||!start)return value;const dx=Math.abs(value[0]-start[0]),dy=Math.abs(value[1]-start[1]);return dx>=dy?[value[0],start[1]]:[start[0],value[1]]}
function translationPoint(p,base,excludeIds=[]){const value=snap(p,excludeIds);if(!orthoEnabled||!base)return value;return Math.abs(value[0]-base[0])>=Math.abs(value[1]-base[1])?[value[0],base[1]]:[base[0],value[1]]}
function unrelatedPointer(event){
  const owner=pan??selectionBox??gripDrag??dragMove
  return (event.pointerType==='touch'&&!event.isPrimary)||(owner&&owner.pointerId!==event.pointerId)
}
canvas.onpointermove=e=>{
  if(unrelatedPointer(e))return
  const p=pointer(e)
  const binding=selectionBox??gripDrag??dragMove??fence
  if(binding&&!pointerBindingValid(binding)){cancelSelectionGestures();message(t('interactionChanged'));render();return}
  if(pan){canvasRenderer.panBy(p[0]-pan.p[0],p[1]-pan.p[1]);pan.p=p;render();return}
  if(selectionBox){selectionBox.current=p;cursor=world(p);$('hint').textContent=t(p[0]<selectionBox.start[0]?'crossingHint':'windowHint');render();return}
  if(gripDrag){
    const target=translationPoint(world(p),gripDrag.grip.point,[gripDrag.grip.entityId]);cursor=[target[0],target[1],gripDrag.grip.point[2]];gripDrag.target=cursor;gripDrag.started=Math.hypot(p[0]-gripDrag.start[0],p[1]-gripDrag.start[1])>=3
    try{gripDrag.preview={type:gripDrag.entity.type,payload:editEntityGrip(gripDrag.entity,gripDrag.grip.id,cursor)};gripDrag.error=null}catch(error){gripDrag.preview=null;gripDrag.error=error;message(error.message)}
    $('coordinates').textContent=`X ${cursor[0].toFixed(2)} · Y ${cursor[1].toFixed(2)}`;render();return
  }
  if(dragMove&&Math.hypot(p[0]-dragMove.screenStart[0],p[1]-dragMove.screenStart[1])>4)dragMove.started=true
  cursor=translationPoint(constrainedPoint(world(p)),translation?.base??dragMove?.worldStart);$('coordinates').textContent=`X ${cursor[0].toFixed(2)} · Y ${cursor[1].toFixed(2)}`
  const grip=tool==='select'&&selectedIds().length===1&&!dragMove?canvasRenderer.hitGrip(p):null,nextHover=grip?`${grip.entityId}:${grip.id}`:null
  if(nextHover!==hoveredGrip){hoveredGrip=nextHover;canvas.style.cursor=grip?'crosshair':tool==='pan'?'grab':tool==='select'?'default':'crosshair';render()}
  if(start||drafting||modification||translation?.base||dragMove?.started||fence)render()
}
canvas.onpointerdown=e=>{
  if(unrelatedPointer(e)||pan||selectionBox||gripDrag||dragMove)return
  if(e.button===1||(e.button===0&&tool==='pan')){e.preventDefault();cancelSelectionGestures();pan={p:pointer(e),pointerId:e.pointerId};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';return}
  if(e.button!==0)return
  if(busy){busyNotice();return}
  canvas.focus({preventScroll:true})
  const p=constrainedPoint(world(pointer(e)))
  if(fence){if(!pointerBindingValid(fence)){setTool('select');message(t('interactionChanged'));return}if(!fence.points.length)fence.operation=selectionOperation(e);fence.points.push(pointer(e));cursor=world(pointer(e));render();return}
  if(translation){
    if(!translationValid(translation)){setTool('select');message(t('drawingChanged'));return}
    if(!translation.ids.length){const hit=canvasRenderer.hitTest(pointer(e),9);if(!hit){message(t('moveChoose'));return}replaceSelection([hit.entity.id]);translation.ids=selectedIds();refresh();updateTranslationHint();return}
    if(!translation.base){translation.base=p;cursor=p;updateTranslationHint();render();return}
    const task=translation;translation=null;run(()=>commitTranslation(task,translationPoint(p,task.base)));return
  }
  if(modification){run(()=>addModificationPoint(p));return}
  if(drafting){run(()=>applyDraftInput(p));return}
  if(tool==='select'){
    const location=pointer(e),operation=selectionOperation(e),initialIds=selectedIds()
    const grip=operation==='replace'&&initialIds.length===1?canvasRenderer.hitGrip(location):null
    if(grip){gripDrag={...pointerBinding(),pointerId:e.pointerId,start:location,grip,entity:doc().getObject(grip.entityId),target:null,preview:null,error:null,started:false};workbench.dataset.grip=`${grip.entityId}:${grip.id}`;canvas.setPointerCapture(e.pointerId);$('hint').textContent=t('gripHint');e.preventDefault();return}
    const id=canvasRenderer.hitTest(pointer(e),9)?.entity.id??null
    if(!id){selectionBox={...pointerBinding(),pointerId:e.pointerId,start:location,current:location,operation,initialIds};canvas.setPointerCapture(e.pointerId);e.preventDefault();render();return}
    if(operation!=='replace')applySelection([id],operation,initialIds);else if(!selection.has(id))replaceSelection([id])
    if(operation==='replace'){dragMove={...pointerBinding(),screenStart:location,worldStart:world(location),ids:selectedIds(),pointerId:e.pointerId,started:false};canvas.setPointerCapture(e.pointerId)}
    selectSidePanel('properties');refresh();return
  }
  if(tool==='text'){run(async()=>{const values=await requestLocalCommand({title:i18n.locale==='zh'?'放置文字':'Place text',fields:[{name:'text',label:i18n.locale==='zh'?'文字内容':'Text content',value:'KJDraw'}]});if(values?.text)await execute('CREATE',{type:'TEXT',payload:{position:p,height:2.5,rotation:0,text:values.text}})});return}
  if(tool==='measure'){
    if(!start){start=p;cursor=p;message('Choose the second distance point');return}
    const first=start;start=null;run(()=>query('DISTANCE',{firstPoint:first,secondPoint:p}));return
  }
}
canvas.onpointerup=e=>{
  if(unrelatedPointer(e))return
  const box=selectionBox?.pointerId===e.pointerId?selectionBox:null,grip=gripDrag?.pointerId===e.pointerId?gripDrag:null,drag=dragMove?.pointerId===e.pointerId?dragMove:null,binding=box??grip??drag
  const valid=!binding||pointerBindingValid(binding),location=pointer(e)
  if(binding)cancelSelectionGestures()
  if(pan?.pointerId===e.pointerId)pan=null
  if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)
  canvas.style.cursor=tool==='pan'?'grab':tool==='select'?'default':'crosshair'
  if(!valid){message(t('interactionChanged'));render();return}
  if(box){const moved=Math.hypot(location[0]-box.start[0],location[1]-box.start[1])>=3;applySelection(moved?canvasRenderer.selectBox(box.start,location):[],box.operation,box.initialIds);$('hint').textContent=t('canvasHint');return}
  if(grip){
    if(grip.started){const point=translationPoint(world(location),grip.grip.point,[grip.grip.entityId]),target=[point[0],point[1],grip.grip.point[2]];run(async()=>{editEntityGrip(grip.entity,grip.grip.id,target);await execute('GRIPEDIT',{id:grip.grip.entityId,gripId:grip.grip.id,point:target},{expectedRevision:grip.revision});message(t('gripApplied'))})}
    $('hint').textContent=t('canvasHint');render();return
  }
  if(drag?.started)run(()=>commitTranslation({...drag,command:'MOVE',base:drag.worldStart},translationPoint(world(location),drag.worldStart)))
  else render()
}
canvas.onpointercancel=e=>{if(!unrelatedPointer(e))setTool('select')}
canvas.onlostpointercapture=e=>{if(pan?.pointerId===e.pointerId)pan=null;if([dragMove,selectionBox,gripDrag].some(binding=>binding?.pointerId===e.pointerId)){cancelSelectionGestures();render()}}
canvas.addEventListener('wheel',e=>{e.preventDefault();cancelSelectionGestures();canvasRenderer.zoomAt(Math.exp(-e.deltaY*.001),pointer(e));render()},{passive:false})
window.addEventListener('keydown',e=>{
  if($('app-dialog').open)return
  if(e.key==='Escape'){e.preventDefault();setTool('select');invalidatePlan();render();return}
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return
  const key=e.key.toLowerCase()
  if(e.ctrlKey||e.metaKey){
    if(key==='a'){e.preventDefault();if(busy)return busyNotice();setTool('select');applySelection(canvasRenderer.selectAll(),'replace')}
    if(key==='z'){e.preventDefault();setTool('select');run(()=>execute(e.shiftKey?'REDO':'UNDO'))}
    if(key==='s'){e.preventDefault();run(saveProject)}
    if(key==='o'){e.preventDefault();chooseFile()}
    return
  }
  if(e.altKey)return
  if(fence){if(e.key==='Enter'){e.preventDefault();finishFence();return}if(e.key==='Backspace'){e.preventDefault();fence.points.pop();render();return}}
  if(drafting){
    if(e.key==='Enter'&&drafting.session.state.canFinish){e.preventDefault();run(()=>applyDraftInput(null,{finish:true}));return}
    if(key==='c'&&drafting.session.state.canClose){e.preventDefault();run(()=>applyDraftInput(null,{close:true}));return}
    if(e.key==='Backspace'){e.preventDefault();undoDraftPoint();return}
  }
  if(e.key==='Delete'){e.preventDefault();run(()=>{requireSelection();return execute('ERASE',{ids:selectedIds()})});return}
  const tools={l:'line',p:'polyline',c:'circle',a:'arc',r:'rectangle',e:'ellipse',x:'xline',q:'point',t:'text',d:'measure',v:'select',h:'pan',m:'move'}
  if(tools[key]){e.preventDefault();setTool(tools[key])}
})
window.addEventListener('resize',()=>requestAnimationFrame(resize))
i18n.apply()
new ResizeObserver(()=>requestAnimationFrame(resize)).observe($('drop-zone'))
const narrowLayout=window.matchMedia('(max-width: 780px)')
if(narrowLayout.matches)setPanelOpen('inspector',false)
narrowLayout.addEventListener('change',event=>{if(event.matches){setPanelOpen('layers',false);setPanelOpen('inspector',false);requestAnimationFrame(resize)}})
try {
  const {instance}=await instantiateKJCoreWasm(new URL('../../web/public/kjcore/kjcore.wasm',import.meta.url))
  registerGeometryBackend(createWasmGeometryBackend(instance));authority=createKJCoreDocumentAuthority(instance);solidAuthority=createKJCoreSolidBackend(instance)
} catch(e){message('WASM unavailable · JavaScript reference mode');console.warn(e.message)}
await freshSample();resize();fit()

function filterLayers(){
  const term=$('layer-search').value.trim().toLocaleLowerCase()
  let matches=0
  for(const row of $('layers').children){row.hidden=!row.dataset.layerName.toLocaleLowerCase().includes(term);if(!row.hidden)matches++}
  $('layer-search-empty').hidden=matches>0
}

function initializeWorkbenchChrome(){
  const sample=document.querySelector('.sample-ribbon');sample.classList.remove('ribbon-group')
  document.querySelector('.site-header').insertBefore(sample,document.querySelector('.top-document'))
  const layoutSelect=document.createElement('select');layoutSelect.id='layout-select';layoutSelect.dataset.i18nLabel='layout';layoutSelect.setAttribute('aria-label',t('layout'))
  for(const layout of KJDRAW_LAYOUTS){const option=document.createElement('option');option.value=layout;option.dataset.i18n=`layout_${layout}`;option.textContent=t(option.dataset.i18n);layoutSelect.append(option)}
  let savedLayout='classic';try{savedLayout=normalizeWorkbenchLayout(localStorage.getItem('kjdraw.layout'))}catch{}
  layoutSelect.value=savedLayout;workbench.dataset.layout=savedLayout
  layoutSelect.onchange=()=>{const layout=normalizeWorkbenchLayout(layoutSelect.value);workbench.dataset.layout=layout;try{localStorage.setItem('kjdraw.layout',layout)}catch{}requestAnimationFrame(()=>{resize();canvas.focus()})}
  document.querySelector('.site-header').insertBefore(layoutSelect,document.querySelector('.top-document'))
  $('move-selection').dataset.tool='move';$('copy-selection').dataset.tool='copy'
  document.querySelector('.ribbon-tabs > span').textContent='2D'
  const groups=[...document.querySelectorAll('.ribbon-group')]
  groups[3].classList.add('compact');groups[4].classList.add('compact');groups[5].classList.add('compact')
  const groupSections=['file','view','draw','draw','modify','inspect']
  groups.forEach((group,index)=>group.dataset.section=groupSections[index])
  initializeDraftingControls()
  const ribbonGroups=[...document.querySelectorAll('.ribbon-group')]
  const showSection=section=>{for(const group of ribbonGroups)group.hidden=section==='home'?group.matches('.drawing-library,.modification-library'):group.dataset.section!==section&&group.dataset.section!=='view';document.querySelector('.ribbon-groups').scrollLeft=0}
  showSection('home')
  for(const tab of document.querySelectorAll('.ribbon-tabs button')){
    tab.setAttribute('aria-pressed',String(tab.classList.contains('active')))
    tab.onclick=()=>{for(const sibling of tab.parentElement.querySelectorAll('button')){sibling.classList.toggle('active',sibling===tab);sibling.setAttribute('aria-pressed',String(sibling===tab))}showSection(tab.dataset.i18n)}
  }
  const icons={'toggle-layers':'layers','toggle-inspector':'panel',undo:'undo',redo:'redo','move-selection':'move','copy-selection':'copy','rotate-selection':'rotate','offset-selection':'offset','delete-selection':'delete','measure-entity':'area','fit-ribbon':'fit'}
  const shortcuts={select:'V',line:'L',polyline:'P',circle:'C',arc:'A',text:'T',rectangle:'R',ellipse:'E',point:'Q',xline:'X',measure:'D',move:'M'}
  for(const button of document.querySelectorAll('.ribbon-group > button')){
    const label=document.createElement('span');label.textContent=button.textContent
    if(button.dataset.i18n){label.dataset.i18n=button.dataset.i18n;delete button.dataset.i18n}
    button.replaceChildren();button.insertAdjacentHTML('afterbegin',kjdrawIcon(button.dataset.icon||button.dataset.tool||icons[button.id]))
    button.append(label)
    if(shortcuts[button.dataset.tool]){button.dataset.shortcut=shortcuts[button.dataset.tool];button.setAttribute('aria-keyshortcuts',shortcuts[button.dataset.tool])}
  }
  const updateTooltips=()=>{for(const button of document.querySelectorAll('.ribbon-group > button'))button.title=`${button.textContent.trim()}${button.dataset.shortcut?` (${button.dataset.shortcut})`:''}`}
  document.addEventListener('kjdraw:language',updateTooltips);updateTooltips()
  const navigator=document.createElement('div');navigator.className='canvas-navigator';navigator.setAttribute('role','toolbar');navigator.dataset.i18nLabel='navigation';navigator.setAttribute('aria-label',t('navigation'))
  for(const [name,icon,key] of [['select','select','select'],['fence','polyline','fence'],['pan','pan','pan'],['fit','fit','fit'],['zoom-in','zoom-in','zoomIn'],['zoom-out','zoom-out','zoomOut']]){
    const button=document.createElement('button');button.id=`nav-${name}`;button.innerHTML=kjdrawIcon(icon);button.dataset.i18nTitle=key;button.dataset.i18nLabel=key;button.title=t(key);button.setAttribute('aria-label',t(key))
    if(['select','pan','fence'].includes(name)){button.dataset.tool=name;button.onclick=()=>setTool(name)}
    else button.onclick=()=>{if(name==='fit')fit();else {canvasRenderer.zoomAt(name==='zoom-in'?1.25:.8);render()}canvas.focus()}
    navigator.append(button)
  }
  $('drop-zone').append(navigator)
  for(const [id,icon] of Object.entries({'close-layers':'close','close-inspector':'close','show-all-layers':'eye','new-layer':'plus','new-drawing':'plus'}))$(id).innerHTML=kjdrawIcon(icon)
  const search=document.createElement('label');search.className='layer-search';search.innerHTML=kjdrawIcon('search')
  const input=document.createElement('input');input.id='layer-search';input.type='search';input.dataset.i18nPlaceholder='searchLayers';input.setAttribute('aria-label',t('searchLayers'));input.oninput=filterLayers;search.append(input)
  $('layers').before(search)
  const empty=document.createElement('p');empty.id='layer-search-empty';empty.className='layer-empty';empty.dataset.i18n='noLayersFound';empty.hidden=true;$('layers').after(empty)
  const openSample=document.createElement('button');openSample.id='open-agent-sample';openSample.dataset.i18n='openAgentSample';openSample.textContent=t('openAgentSample');$('agent-title').after(openSample)
  for(const [name,selector,variable] of [['layers','.left-panel','--left-width'],['inspector','.right-panel','--right-width']]){
    const panel=document.querySelector(selector),handle=document.createElement('div');handle.className='panel-resizer';handle.tabIndex=0;handle.role='separator';handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label',t(name==='layers'?'resizeLayers':'resizeProperties'));handle.setAttribute('aria-valuemin','220');handle.setAttribute('aria-valuemax','420')
    const adjust=value=>{const next=Math.max(220,Math.min(420,window.innerWidth*.35,value));workbench.style.setProperty(variable,`${next}px`);handle.setAttribute('aria-valuenow',String(Math.round(next)));resize()}
    handle.setAttribute('aria-valuenow',String(Math.round(panel.getBoundingClientRect().width||300)))
    handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();const x=event.clientX,start=panel.getBoundingClientRect().width;handle.setPointerCapture(event.pointerId);handle.onpointermove=move=>adjust(start+(move.clientX-x)*(name==='layers'?1:-1));handle.onpointerup=()=>{handle.onpointermove=null};handle.onlostpointercapture=()=>{handle.onpointermove=null}}
    handle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();adjust(panel.getBoundingClientRect().width+(event.key==='ArrowRight'?20:-20)*(name==='layers'?1:-1))}
    panel.append(handle)
  }
}

function initializeDraftingControls(){
  const bilingual=(element,en,zh)=>{element.dataset.labelEn=en;element.dataset.labelZh=zh;element.textContent=i18n.locale==='zh'?zh:en;return element}
  const library=document.createElement('div');library.className='ribbon-group drawing-library';library.dataset.section='draw'
  library.append(bilingual(document.createElement('small'),'CONSTRUCTION','图形构造'))
  const picker=document.createElement('select');picker.id='drawing-tool'
  for(const [value,en,zh] of [['line','Line','直线'],['polyline','Polyline','多段线'],['circle','Circle','圆'],['arc','Arc','圆弧'],['ellipse','Ellipse','椭圆'],['rectangle','Rectangle','矩形'],['polygon','Polygon','正多边形'],['spline','Spline','样条曲线'],['hatch','Hatch / fill','填充'],['dimension','Dimension','尺寸标注'],['point','Point','点'],['ray','Ray','射线'],['xline','Construction line','构造线']]){
    const option=bilingual(document.createElement('option'),en,zh);option.value=value;picker.append(option)
  }
  picker.setAttribute('aria-label',i18n.locale==='zh'?'绘图工具':'Drawing tool');picker.onchange=()=>{if(!busy){setTool(picker.value);canvas.focus()}}
  library.append(picker);document.querySelector('.ribbon-groups').insertBefore(library,document.querySelector('.ribbon-group[data-section="modify"]'))
  const options=document.createElement('div');options.id='draft-options';options.className='draft-options';options.hidden=true;options.setAttribute('role','toolbar');options.setAttribute('aria-label','Drawing options')
  const add=(id,en,zh,tools,values,defaultValue,limits={})=>{
    const label=document.createElement('label');label.dataset.draftTools=tools;label.append(bilingual(document.createElement('span'),en,zh));let input
    if(values){input=document.createElement('select');for(const [value,labelEn,labelZh] of values){const option=bilingual(document.createElement('option'),labelEn,labelZh);option.value=value;input.append(option)}}
    else {input=document.createElement('input');input.type='number';for(const [key,value]of Object.entries(limits))input[key]=String(value)}
    input.id=id;input.value=String(defaultValue);input.dataset.previousValue=input.value;input.setAttribute('aria-label',i18n.locale==='zh'?zh:en)
    input.onchange=()=>{
      if(busy||drafting?.session.points.length){input.value=input.dataset.previousValue;if(busy)busyNotice();else message(i18n.locale==='zh'?'请先完成或按 Esc 取消当前图形，再更改构造参数。':'Finish the current shape or press Esc before changing construction options.');return}
      if(!input.checkValidity()){input.reportValidity();return}
      if(isDraftTool(tool)){setTool(tool);canvas.focus()}
    };label.append(input);options.append(label)
  }
  add('circle-mode','Circle','画圆方式','circle',[['center-radius','Center / radius','圆心 / 半径'],['2-point','Two diameter points','直径两点'],['3-point','Three points','圆上三点']],'center-radius')
  add('arc-mode','Arc','圆弧方式','arc',[['center-start-end','Center / start / end','圆心 / 起点 / 终点'],['3-point','Start / through / end','起点 / 中间点 / 终点']],'center-start-end')
  add('polygon-sides','Sides','边数','polygon',null,6,{min:3,max:360,step:1})
  add('spline-degree','Degree','次数','spline',[['2','Quadratic','二次'],['3','Cubic','三次']],'3')
  add('dimension-type','Dimension','标注类型','dimension',[['ALIGNED','Aligned','对齐'],['ROTATED','Linear','线性'],['RADIUS','Radius','半径'],['DIAMETER','Diameter','直径']],'ALIGNED')
  add('dimension-direction','Direction','方向','dimension',[['horizontal','Horizontal','水平'],['vertical','Vertical','垂直']],'horizontal')
  add('dimension-height','Text height','字高','dimension',null,2.5,{min:.001,step:.1})
  add('hatch-pattern','Pattern','图案','hatch',[['ANSI31','Diagonal','斜线'],['ANSI37','Cross','交叉'],['SOLID','Solid fill','实心']],'ANSI31')
  add('hatch-scale','Scale','比例','hatch',null,1,{min:.001,step:.1})
  for(const [id,en,zh,action] of [['finish-draft','Finish ↵','完成 ↵',()=>run(()=>applyDraftInput(null,{finish:true}))],['close-draft','Close (C)','闭合 (C)',()=>run(()=>applyDraftInput(null,{close:true}))],['undo-draft-point','Undo point','退回一点',undoDraftPoint]]){
    const button=bilingual(document.createElement('button'),en,zh);button.id=id;button.dataset.draftTools='polyline spline hatch';button.onclick=action;options.append(button)
  }
  $('drop-zone').append(options)
  const modify=document.createElement('div');modify.className='ribbon-group modification-library';modify.dataset.section='modify';modify.append(bilingual(document.createElement('small'),'EDIT GEOMETRY','编辑几何'))
  const modifySelect=document.createElement('select');modifySelect.id='modification-tool';const placeholder=bilingual(document.createElement('option'),'More editing tools…','更多修改工具…');placeholder.value='';modifySelect.append(placeholder)
  for(const definition of KJ_MODIFICATION_DEFINITIONS){const option=bilingual(document.createElement('option'),definition.label.en,definition.label.zh);option.value=definition.id;modifySelect.append(option)}
  modifySelect.setAttribute('aria-label',i18n.locale==='zh'?'修改工具':'Modification tool');modifySelect.onchange=()=>{const value=modifySelect.value;modifySelect.value='';if(value)run(()=>beginModification(value))};modify.append(modifySelect);document.querySelector('.ribbon-groups').append(modify)
  document.addEventListener('kjdraw:language',()=>{for(const node of document.querySelectorAll('[data-label-en]'))node.textContent=i18n.locale==='zh'?node.dataset.labelZh:node.dataset.labelEn;for(const label of options.querySelectorAll('label'))label.querySelector('input,select')?.setAttribute('aria-label',label.querySelector('span').textContent);picker.setAttribute('aria-label',i18n.locale==='zh'?'绘图工具':'Drawing tool');modifySelect.setAttribute('aria-label',i18n.locale==='zh'?'修改工具':'Modification tool');options.setAttribute('aria-label',i18n.locale==='zh'?'绘图参数':'Drawing options');if(drafting)updateDraftHint()})
}
