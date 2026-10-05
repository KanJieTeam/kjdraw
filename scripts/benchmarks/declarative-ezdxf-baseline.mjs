// Unattended comparator: the model emits JSON data, never executable source.
import {spawnSync} from 'node:child_process'
import {isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
const worker=fileURLToPath(new URL('./declarative-ezdxf-worker.py',import.meta.url))
const manufacturingWorker=fileURLToPath(new URL('./declarative-ezdxf-manufacturing.py',import.meta.url))
export const declarativeEzdxfSchema='com.kanjie.kjdraw.benchmark.declarative-ezdxf@1'
export const declarativeEzdxfManufacturingSchema='com.kanjie.kjdraw.benchmark.declarative-ezdxf-manufacturing@1'
export const declarativeEzdxfSystemPrompt=`Return exactly one JSON object, without markdown or commentary. It must have exactly {"schema":"com.kanjie.kjdraw.benchmark.declarative-ezdxf@1","units":"millimeter","operations":[...]}. The host uses trusted ezdxf code to compile these operations into an editable R2018 DXF. You cannot provide Python, DXF text, file paths, imports or expressions. Supported operations: {"op":"add","id":"unique-id","kind":"LINE|CIRCLE|ARC|LWPOLYLINE","shape":...}; {"op":"set","id":"existing-id","shape":...} to change geometry while preserving its identity; {"op":"move","id":"existing-id","dx":number,"dy":number}; {"op":"delete","id":"existing-id"}; and {"op":"addPolarCircles","prefix":"unique-prefix","center":{"x":0,"y":0},"pitchRadius":number,"holeRadius":number,"count":integer,"startDegrees":number}. LINE shape has start/end {"x","y"} points. CIRCLE has center and radius. ARC adds startDegrees/endDegrees. LWPOLYLINE has vertices as point objects and closed as boolean, with straight segments only. Preserve all unrelated feature IDs from the supplied seed or preceding round. Use ordinary JSON numbers, not strings or calculations.`
export const declarativeEzdxfManufacturingPrompt=`Return exactly one JSON object, without markdown or commentary. Schema: {"schema":"com.kanjie.kjdraw.benchmark.declarative-ezdxf-manufacturing@1","units":"millimeter","drawingId":string,"title":string,"revision":string,"material":string,"quantity":integer,"length":number,"width":number,"thickness":number,"holePatterns":[{"rows":integer,"columns":integer,"origin":[x,y],"spacing":[dx,dy],"throughDiameter":number},{"rows":integer,"columns":integer,"origin":[x,y],"spacing":[dx,dy],"throughDiameter":number,"counterboreDiameter":number,"counterboreDepth":number}],"slots":[{"center":[x,y],"length":number,"width":number,"orientationDegrees":0 or 90},{"center":[x,y],"length":number,"width":number,"orientationDegrees":0 or 90}],"sheet":{"origin":[0,0],"size":[sheetWidth,sheetHeight]},"textHeight":number}. Supply only design parameters stated in the request. Trusted ezdxf code constructs the 1:1 top/front views, editable arrays and slots, layers, native dimensions, border, title block and manufacturing notes. No Python, paths, DXF text, expressions, extra fields or hand-expanded geometry.`

export function supportedDeclarativeEzdxfTask(task){
 if(!task||task.units!=='millimeter'||!Array.isArray(task.rounds)||!task.rounds.length||!Array.isArray(task.expectedRounds)||task.expectedRounds.length!==task.rounds.length)return false
 if(task.category==='complex-one-shot')return task.family==='manufacturing-sheet'&&task.seed===null&&task.rounds.length===1&&task.expectedRounds[0].validatorKind==='manufacturing'
 return ['simple-one-shot','multi-round-edit'].includes(task.category)&&task.expectedRounds.every(round=>round.validatorKind==='generic')&&(task.category==='simple-one-shot'?task.seed===null:task.seed?.units==='millimeter'&&Array.isArray(task.seed.features))
}
export function declarativeEzdxfCoverage(tasks){
 if(!Array.isArray(tasks))throw new Error('Task array required')
 const supported=tasks.filter(supportedDeclarativeEzdxfTask)
 return {total:tasks.length,supported:supported.length,unsupported:tasks.length-supported.length,supportedTaskIds:supported.map(task=>task.id),unsupportedTaskIds:tasks.filter(task=>!supportedDeclarativeEzdxfTask(task)).map(task=>task.id)}
}
export function buildDeclarativeEzdxfRequest({model,userPrompt,settings,priorMessages=[],taskCategory='simple-one-shot'}){
 if(typeof model!=='string'||!model.trim()||typeof userPrompt!=='string'||!userPrompt.trim()||!settings||typeof settings!=='object'||Array.isArray(settings))throw new Error('Explicit shared model, prompt and settings required')
 if(['model','messages','tools','tool_choice'].some(key=>Object.hasOwn(settings,key)))throw new Error('Provider settings cannot replace shared input or arm')
 if(!Array.isArray(priorMessages)||priorMessages.some(message=>!message||!['user','assistant'].includes(message.role)||typeof message.content!=='string'||!message.content))throw new Error('Invalid prior conversation')
 if(!['simple-one-shot','multi-round-edit','complex-one-shot'].includes(taskCategory))throw new Error('UNSUPPORTED_TASK_CATEGORY')
 return {model,messages:[{role:'system',content:taskCategory==='complex-one-shot'?declarativeEzdxfManufacturingPrompt:declarativeEzdxfSystemPrompt},...structuredClone(priorMessages),{role:'user',content:userPrompt}],...structuredClone(settings)}
}
export function compileDeclarativeEzdxfRound({task,roundIndex,content,previous,python=process.env.KJDRAW_PYTHON??'python',ezdxfPath=process.env.KJDRAW_EZDXF_PATH??null,timeoutMs=20000}){
 if(!supportedDeclarativeEzdxfTask(task))throw new Error('UNSUPPORTED_TASK_CATEGORY')
 if(!Number.isSafeInteger(roundIndex)||roundIndex<1||roundIndex>task.rounds.length)throw new Error('INVALID_ROUND')
 if(typeof content!=='string'||!content.trim()||Buffer.byteLength(content)>131072)throw new Error('MODEL_JSON_BUDGET')
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new Error('INVALID_TIMEOUT')
 if(ezdxfPath!==null&&(typeof ezdxfPath!=='string'||!isAbsolute(ezdxfPath)))throw new Error('INVALID_EZDXF_RUNTIME_PATH')
 const manufacturing=task.category==='complex-one-shot'
 if((roundIndex===1&&previous!==undefined)||(roundIndex>1&&(!previous||previous.arm!=='declarative-ezdxf'||previous.passed!==true||previous.taskId!==task.id||previous.roundIndex!==roundIndex-1||typeof previous.dxf!=='string'||!previous.features||previous.units!=='millimeter')))throw new Error('PREVIOUS_ROUND_REQUIRED')
 const initial=manufacturing?null:roundIndex===1?(task.seed?{kind:'seed',units:'millimeter',features:task.seed.features}:{kind:'empty',units:'millimeter'}):{kind:'previous',units:'millimeter',dxf:previous.dxf,features:previous.features}
 const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','PATH','PATHEXT','COMSPEC'])if(process.env[key])env[key]=process.env[key]
 env.PYTHONIOENCODING='utf-8';env.PYTHONDONTWRITEBYTECODE='1'
 const started=performance.now(),result=spawnSync(python,['-I','-B',manufacturing?manufacturingWorker:worker],{input:JSON.stringify(manufacturing?{content,ezdxfPath}:{content,initial,ezdxfPath}),encoding:'utf8',env,timeout:timeoutMs,maxBuffer:6000000,windowsHide:true})
 let parsed
 try{parsed=JSON.parse(result.stdout)}catch{parsed={passed:false,reason:result.error?.code==='ETIMEDOUT'?'COMPILER_TIMEOUT':'COMPILER_RESPONSE_INVALID'}}
 const passed=result.status===0&&parsed.passed===true&&parsed.schema===(manufacturing?declarativeEzdxfManufacturingSchema:declarativeEzdxfSchema)&&parsed.units==='millimeter'&&typeof parsed.dxf==='string'&&(manufacturing||parsed.features&&typeof parsed.features==='object')
 const expected=task.expectedRounds[roundIndex-1],required=expected.requiredFeatureIds??[],preserved=expected.preservedFeatureIds??[]
 const featureIdentity=passed&&!manufacturing?{passed:required.every(id=>Object.hasOwn(parsed.features,id)&&(!Object.hasOwn(parsed.beforeFeatures??{},id)||parsed.beforeFeatures[id]===parsed.features[id]))&&preserved.every(id=>Object.hasOwn(parsed.beforeFeatures??{},id)&&parsed.beforeFeatures[id]===parsed.features[id]),requiredFeatureIds:required,preservedFeatureIds:preserved}:null
 return {taskId:task.id,roundIndex,arm:'declarative-ezdxf',passed,status:passed?'compiled':'rejected',reason:passed?null:parsed.reason??'COMPILER_RESPONSE_INVALID',compilerMs:performance.now()-started,ezdxfVersion:parsed.ezdxfVersion??null,units:passed?parsed.units:null,dxf:passed?parsed.dxf:null,features:passed&&!manufacturing?parsed.features:null,beforeFeatures:passed&&!manufacturing?parsed.beforeFeatures:null,featureIdentity,entities:passed?parsed.entities:null}
}
