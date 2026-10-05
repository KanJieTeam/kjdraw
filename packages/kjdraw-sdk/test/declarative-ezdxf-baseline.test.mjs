import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {buildDeclarativeEzdxfRequest,compileDeclarativeEzdxfRound,declarativeEzdxfCoverage,declarativeEzdxfSchema,declarativeEzdxfManufacturingSchema,supportedDeclarativeEzdxfTask} from '../../../scripts/benchmarks/declarative-ezdxf-baseline.mjs'
import {tokenEfficiencyTaskCorpus} from '../../../scripts/benchmarks/token-efficiency-task-corpus.mjs'
import {manufacturingTaskSuite} from '../../../scripts/benchmarks/manufacturing-task-suite.mjs'
import {independentValidation} from '../../../scripts/benchmarks/paired-model-benchmark.mjs'

const python=process.env.KJDRAW_PYTHON??'python',ezdxfPath=process.env.KJDRAW_EZDXF_PATH
const probe=spawnSync(python,['-c',`${ezdxfPath?`import sys;sys.path.append(${JSON.stringify(ezdxfPath)})`:'pass'};import ezdxf;print(ezdxf.__version__)`],{encoding:'utf8'})
function needPython(t){if(probe.status===0)return true;if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(probe.stderr||probe.error?.message);t.skip('ezdxf runtime required');return false}
const json=operations=>JSON.stringify({schema:declarativeEzdxfSchema,units:'millimeter',operations})
const task=id=>{const value=tokenEfficiencyTaskCorpus.find(item=>item.id===id);assert.ok(value);return value}
const validate=(dxf,expected)=>independentValidation({python,dxf,expected,taskSuite:'pilot'})

test('declarative ezdxf arm covers all 100 frozen tasks and keeps shared model settings',()=>{
 const coverage=declarativeEzdxfCoverage(tokenEfficiencyTaskCorpus)
 assert.deepEqual([coverage.total,coverage.supported,coverage.unsupported],[100,100,0])
 assert.equal(supportedDeclarativeEzdxfTask(task('simple-radial-flange-1')),true)
 assert.equal(supportedDeclarativeEzdxfTask(task('sheet-fixture-plate-240x140-a3')),true)
 const priorMessages=[{role:'user',content:'First round'},{role:'assistant',content:json([])}],settings={max_tokens:4096,temperature:0,thinking:{type:'disabled'}}
 const request=buildDeclarativeEzdxfRequest({model:'test-model',userPrompt:'Move the hole',settings,priorMessages})
 assert.deepEqual(request.messages.slice(1,3),priorMessages);assert.equal(request.messages[3].content,'Move the hole');assert.equal(request.max_tokens,4096);assert.equal(request.tools,undefined)
 assert.throws(()=>buildDeclarativeEzdxfRequest({model:'test-model',userPrompt:'x',settings:{...settings,messages:[]}}))
 const sheetRequest=buildDeclarativeEzdxfRequest({model:'test-model',userPrompt:'Create the specified sheet',settings,taskCategory:'complex-one-shot'})
 assert.match(sheetRequest.messages[0].content,/declarative-ezdxf-manufacturing/);assert.equal(sheetRequest.messages[1].content,'Create the specified sheet')
})

const manufacturingContent=source=>{
 const {version,expectedRevision,...design}=source.input
 return JSON.stringify({schema:declarativeEzdxfManufacturingSchema,...design})
}

test('trusted manufacturing intent covers all 30 editable sheets under the independent validator',t=>{
 if(!needPython(t))return
 for(const source of manufacturingTaskSuite){
  const selected=task('sheet-'+source.id)
  const result=compileDeclarativeEzdxfRound({task:selected,roundIndex:1,content:manufacturingContent(source),python,ezdxfPath})
  assert.equal(result.passed,true,JSON.stringify({id:source.id,reason:result.reason,entities:result.entities}))
  const validation=independentValidation({python,dxf:result.dxf,expected:selected.expectedRounds[0].expected,taskSuite:'manufacturing'})
  assert.equal(validation.passed,true,JSON.stringify({id:source.id,...validation}))
 }
})

test('manufacturing intent rejects model-selected paths, expressions and invalid sheet parameters',t=>{
 if(!needPython(t))return
 const source=manufacturingTaskSuite[0],selected=task('sheet-'+source.id),base=JSON.parse(manufacturingContent(source))
 for(const mutate of [
  value=>{value.path='C:/secret.dxf'},
  value=>{value.length='240+0'},
  value=>{value.sheet.size=[400,300]},
  value=>{value.slots[0].orientationDegrees=45},
  value=>{value.holePatterns[0].rows=1000},
 ]){
  const invalid=structuredClone(base);mutate(invalid)
  const result=compileDeclarativeEzdxfRound({task:selected,roundIndex:1,content:JSON.stringify(invalid),python,ezdxfPath})
  assert.equal(result.passed,false,JSON.stringify(result))
 }
})

test('trusted ezdxf compiler validates polar array and initial plus two identity-preserving edit rounds',t=>{
 if(!needPython(t))return
 const flange=task('simple-radial-flange-1')
 const polar=compileDeclarativeEzdxfRound({task:flange,roundIndex:1,python,ezdxfPath,content:json([
  {op:'add',id:'outer',kind:'CIRCLE',shape:{center:{x:0,y:0},radius:44}},
  {op:'add',id:'bore',kind:'CIRCLE',shape:{center:{x:0,y:0},radius:10}},
  {op:'addPolarCircles',prefix:'bolt',center:{x:0,y:0},pitchRadius:30,holeRadius:2.5,count:4,startDegrees:0},
 ])})
 assert.equal(polar.passed,true,JSON.stringify(polar));assert.equal(validate(polar.dxf,flange.expectedRounds[0].expected).passed,true)
 assert.equal(Object.keys(polar.features).length,6)
 const edit=task('edit-hole-move-x-1')
 const first=compileDeclarativeEzdxfRound({task:edit,roundIndex:1,python,ezdxfPath,content:json([{op:'move',id:'target-hole',dx:4,dy:0}])})
 assert.equal(first.passed,true,JSON.stringify(first));assert.equal(first.featureIdentity.passed,true);assert.equal(validate(first.dxf,edit.expectedRounds[0].expected).passed,true)
 assert.deepEqual(Object.keys(first.beforeFeatures).sort(),edit.seed.features.map(feature=>feature.id).sort())
 const second=compileDeclarativeEzdxfRound({task:edit,roundIndex:2,python,ezdxfPath,previous:first,content:json([{op:'move',id:'target-hole',dx:-2,dy:0}])})
 assert.equal(second.passed,true,JSON.stringify(second));assert.equal(second.featureIdentity.passed,true);assert.equal(validate(second.dxf,edit.expectedRounds[1].expected).passed,true)
 assert.deepEqual(second.beforeFeatures,first.features)
 assert.deepEqual(second.features,first.features)
})

test('set edits preserve handles for straight polylines, lines and arcs',t=>{
 if(!needPython(t))return
 const boundary=task('edit-boundary-width-1')
 const resized=compileDeclarativeEzdxfRound({task:boundary,roundIndex:1,python,ezdxfPath,content:json([
  {op:'set',id:'boundary',shape:{vertices:[{x:0,y:0},{x:118,y:0},{x:118,y:65},{x:0,y:65}],closed:true}},
 ])})
 assert.equal(resized.passed,true,JSON.stringify(resized));assert.equal(resized.featureIdentity.passed,true);assert.equal(validate(resized.dxf,boundary.expectedRounds[0].expected).passed,true)
 const slot=task('edit-slot-length-1')
 const extended=compileDeclarativeEzdxfRound({task:slot,roundIndex:1,python,ezdxfPath,content:json([
  {op:'set',id:'slot-lower',shape:{start:{x:20,y:21},end:{x:75,y:21}}},
  {op:'set',id:'slot-upper',shape:{start:{x:75,y:29},end:{x:20,y:29}}},
  {op:'set',id:'slot-right',shape:{center:{x:75,y:25},radius:4,startDegrees:270,endDegrees:90}},
 ])})
 assert.equal(extended.passed,true,JSON.stringify(extended));assert.equal(extended.featureIdentity.passed,true);assert.equal(validate(extended.dxf,slot.expectedRounds[0].expected).passed,true)
 assert.deepEqual(Object.keys(extended.features).sort(),slot.seed.features.map(feature=>feature.id).sort())
})

test('declarative compiler rejects unsupported category, paths, expressions, duplicate keys and tampered feature maps',t=>{
 if(!needPython(t))return
 const simple=task('simple-guide-rails-1')
 assert.throws(()=>compileDeclarativeEzdxfRound({task:{...simple,category:'unsupported'},roundIndex:1,content:json([]),python,ezdxfPath}),/UNSUPPORTED_TASK_CATEGORY/)
 for(const content of [
  '{"schema":"'+declarativeEzdxfSchema+'","schema":"'+declarativeEzdxfSchema+'","units":"millimeter","operations":[]}',
  JSON.stringify({schema:declarativeEzdxfSchema,units:'meter',operations:[]}),
  json([{op:'add',id:'x',kind:'CIRCLE',shape:{center:{x:'1+2',y:0},radius:2}}]),
  json([{op:'add',id:'x',kind:'CIRCLE',shape:{center:{x:0,y:0},radius:2},path:'C:/secret'}]),
  json([{op:'shell',command:'whoami'}]),
 ]){const result=compileDeclarativeEzdxfRound({task:simple,roundIndex:1,content,python,ezdxfPath});assert.equal(result.passed,false,JSON.stringify(result))}
 const edit=task('edit-hole-move-y-1')
 const first=compileDeclarativeEzdxfRound({task:edit,roundIndex:1,content:json([{op:'move',id:'target-hole',dx:0,dy:4}]),python,ezdxfPath})
 assert.equal(first.passed,true,JSON.stringify(first))
 const recreated=compileDeclarativeEzdxfRound({task:edit,roundIndex:1,content:json([
  {op:'delete',id:'target-hole'},
  {op:'add',id:'target-hole',kind:'CIRCLE',shape:{center:{x:20,y:24},radius:4}},
 ]),python,ezdxfPath})
 assert.equal(recreated.passed,true,JSON.stringify(recreated));assert.equal(validate(recreated.dxf,edit.expectedRounds[0].expected).passed,true);assert.equal(recreated.featureIdentity.passed,false)
 const previous={...first,features:{...first.features,'target-hole':'FFFFFFFF'}}
 const tampered=compileDeclarativeEzdxfRound({task:edit,roundIndex:2,previous,content:json([{op:'delete',id:'target-hole'}]),python,ezdxfPath})
 assert.equal(tampered.passed,false);assert.equal(tampered.reason,'PREVIOUS_FEATURE_MAP')
 const added=compileDeclarativeEzdxfRound({task:simple,roundIndex:1,content:json([
  {op:'add',id:'temporary',kind:'LINE',shape:{start:{x:0,y:0},end:{x:1,y:1}}},
  {op:'delete',id:'temporary'},
 ]),python,ezdxfPath})
 assert.equal(added.passed,true,JSON.stringify(added));assert.equal(added.entities,0)
})
