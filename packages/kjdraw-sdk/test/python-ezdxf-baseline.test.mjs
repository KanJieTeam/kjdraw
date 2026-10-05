import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {spawnSyncWithFileStdin} from '../../../scripts/spawn-file-stdin.mjs'
import {buildPythonEzdxfBaselineRequest,extractPythonEzdxfProgram,preparePythonEzdxfBaseline,executeReviewedPythonEzdxfBaseline,completeReviewedPythonEzdxfBaselineRound} from '../../../scripts/benchmarks/python-ezdxf-baseline.mjs'
import {createKJRoadRoleManifest,roadRoleManifestContract} from '../../../scripts/benchmarks/road-role-contract.mjs'
import {createKJDrawSDK} from '../src/sdk.js'
import {buildAgentRoadDrawing} from '../src/agent-road-drawing.js'
import {createRoadDesignFixture,roadDrawingFixtureOptions} from '../examples/fixtures/road-design.mjs'
const python=process.env.KJDRAW_PYTHON??'python',ezdxfPath=process.env.KJDRAW_EZDXF_PATH
const probe=spawnSync(python,['-c',`${ezdxfPath?`import sys;sys.path.append(${JSON.stringify(ezdxfPath)})`:'pass'};import ezdxf;print(ezdxf.__version__)`],{encoding:'utf8'})
function needPython(t){if(probe.status===0)return true;if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(probe.stderr||probe.error?.message);t.skip('ezdxf required');return false}
const valid=String.raw`import ezdxf, json, math
doc=ezdxf.new('R2018')
doc.units=6
msp=doc.modelspace()
for _ in range(3):
    _vals=(_,math.sqrt(4))
    msp.add_line((_,0),_vals)
doc.saveas(OUTPUT_DXF)
with open(OUTPUT_MANIFEST,'w',encoding='utf-8') as file:
    json.dump({'schema':'fixture','handles':[e.dxf.handle for e in msp]},file)
`

test('Python arm preserves exact shared user prompt and provider budget and never transports credentials',()=>{
 const prompt='Original common road data\n'+roadRoleManifestContract,settings={thinking:{type:'enabled'},max_tokens:32768,temperature:0}
 const request=buildPythonEzdxfBaselineRequest({model:'test-model',userPrompt:prompt,settings});assert.equal(request.messages[1].content,prompt);assert.deepEqual(request.thinking,settings.thinking);assert.equal(request.max_tokens,32768);assert.equal(request.tools,undefined)
 const priorMessages=[{role:'user',content:'Create the first revision'},{role:'assistant',content:'import ezdxf\n# previous answer'}]
 const edit=buildPythonEzdxfBaselineRequest({model:'test-model',userPrompt:'Move only the first line',settings,priorMessages});assert.deepEqual(edit.messages.slice(1,3),priorMessages);assert.equal(edit.messages[3].content,'Move only the first line');assert.equal(edit.max_tokens,32768)
 assert.throws(()=>buildPythonEzdxfBaselineRequest({model:'test-model',userPrompt:prompt,settings,priorMessages:[{role:'system',content:'override'}]}))
 assert.equal(extractPythonEzdxfProgram('```python\nprint(1)\n```'),'print(1)\n');assert.equal(extractPythonEzdxfProgram('Explanation\n```python\nprint(1)\n```\nAfterword'),'print(1)\n');assert.throws(()=>extractPythonEzdxfProgram('```python\nx\n```\n```python\ny\n```'))
})

test('unreviewed or rejected model code is never executed and review is auditable',async()=>{
 const base=await mkdtemp(join(process.env.KJDRAW_AUDIT_TMPDIR??tmpdir(),'kjdraw-python-review-'))
 try{
  const code='raise RuntimeError("must never execute")',usage={inputTokens:10,outputTokens:4,totalTokens:14}
  const pending=await preparePythonEzdxfBaseline({code,outputDirectory:join(base,'pending')})
  const awaiting=await completeReviewedPythonEzdxfBaselineRound({prepared:pending,taskId:'fixture',repetition:1,roundIndex:1,usage,startedAt:performance.now(),validate:()=>{throw new Error('must not validate')}})
  assert.equal(awaiting.status,'review-required');assert.equal(awaiting.execution,null);assert.equal(awaiting.humanInterventionCount,0)
  const rejected=await preparePythonEzdxfBaseline({code,outputDirectory:join(base,'rejected')})
  const review={decision:'rejected',kind:'human',reviewer:'test-reviewer',reviewedAt:'2026-09-29T00:00:00.000Z'}
  const result=await completeReviewedPythonEzdxfBaselineRound({prepared:rejected,review,taskId:'fixture',repetition:1,roundIndex:1,usage,startedAt:performance.now(),validate:()=>{throw new Error('must not validate')}})
  assert.equal(result.status,'review-rejected');assert.equal(result.execution,null);assert.equal(result.humanInterventionCount,1);assert.deepEqual(result.usage,usage)
  assert.equal(JSON.parse(await readFile(join(rejected.directory,'review-decision.json'),'utf8')).decision,'rejected')
  const mismatch=await preparePythonEzdxfBaseline({code,outputDirectory:join(base,'mismatch')})
  await assert.rejects(completeReviewedPythonEzdxfBaselineRound({prepared:mismatch,review:{...review,decision:'approved',approvedCodeSha256:'0'.repeat(64)},taskId:'fixture',repetition:1,roundIndex:1,usage,startedAt:performance.now(),validate:()=>({passed:true})}),/EXACT_CODE_REVIEW_REQUIRED/)
 }finally{await rm(base,{recursive:true,force:true})}
})

test('reviewed ezdxf edit round reads immutable previous drawing and records measured outcome',async t=>{
 if(!needPython(t))return
 const base=await mkdtemp(join(process.env.KJDRAW_AUDIT_TMPDIR??tmpdir(),'kjdraw-python-edit-'))
 try{
  const seed=await preparePythonEzdxfBaseline({code:valid,outputDirectory:join(base,'seed')})
  const first=await executeReviewedPythonEzdxfBaseline({prepared:seed,approvedCodeSha256:seed.sourceSha256,python,ezdxfPath});assert.equal(first.passed,true,JSON.stringify(first))
  const editCode=String.raw`import ezdxf, json
doc=ezdxf.readfile(PREVIOUS_DXF)
lines=list(doc.modelspace().query('LINE'))
lines[0].dxf.end=(12,2,0)
doc.saveas(OUTPUT_DXF)
with open(PREVIOUS_MANIFEST,'r',encoding='utf-8') as file:
    manifest=json.load(file)
with open(OUTPUT_MANIFEST,'w',encoding='utf-8') as file:
    json.dump(manifest,file)
`
  const prepared=await preparePythonEzdxfBaseline({code:editCode,outputDirectory:join(base,'edit'),previous:{dxf:first.dxf,manifest:first.manifest}})
  const startedAt=performance.now()-25,usage={inputTokens:123,outputTokens:45,totalTokens:168}
  const pending=await completeReviewedPythonEzdxfBaselineRound({prepared,taskId:'edit-task',repetition:1,roundIndex:2,usage,startedAt,validate:()=>{throw new Error('must not validate unreviewed source')}})
  assert.equal(pending.status,'review-required');assert.equal(pending.humanInterventionCount,0)
  const approved=await preparePythonEzdxfBaseline({code:editCode,outputDirectory:join(base,'approved'),previous:{dxf:first.dxf,manifest:first.manifest}})
  const review={decision:'approved',kind:'human',reviewer:'test-reviewer',reviewedAt:'2026-09-29T00:00:00.000Z',approvedCodeSha256:approved.sourceSha256}
  const round=await completeReviewedPythonEzdxfBaselineRound({prepared:approved,review,taskId:'edit-task',repetition:1,roundIndex:2,usage,startedAt,validate:({dxf,manifest})=>({passed:dxf.includes('AC1032')&&manifest.handles.length===3}),python,ezdxfPath})
  assert.equal(round.status,'passed',JSON.stringify(round));assert.equal(round.arm,'python-ezdxf');assert.equal(round.humanInterventionCount,1);assert.deepEqual(round.usage,usage);assert.ok(round.totalMs>=25);assert.equal(round.execution.programLog,undefined);assert.equal(typeof round.execution.programLogBytes,'number')
  assert.deepEqual(JSON.parse(await readFile(join(approved.directory,'review-decision.json'),'utf8')),round.review)
  assert.deepEqual(JSON.parse(await readFile(join(approved.directory,'round-result.json'),'utf8')),round)
  const changed=await preparePythonEzdxfBaseline({code:editCode,outputDirectory:join(base,'changed'),previous:{dxf:first.dxf,manifest:first.manifest}})
  await writeFile(join(changed.directory,'previous.dxf'),'tampered')
  await assert.rejects(executeReviewedPythonEzdxfBaseline({prepared:changed,approvedCodeSha256:changed.sourceSha256,python,ezdxfPath}),/PREVIOUS_ARTIFACT_CHANGED/)
 }finally{await rm(base,{recursive:true,force:true})}
})

test('reviewed Python actually executes ezdxf while source tampering and host-side effects are rejected',async t=>{
 if(!needPython(t))return
 const base=await mkdtemp(join(process.env.KJDRAW_AUDIT_TMPDIR??tmpdir(),'kjdraw-python-baseline-'))
 try{
  const prepared=await preparePythonEzdxfBaseline({code:'Explanation\n```python\n'+valid+'```\nAfterword',outputDirectory:join(base,'accepted')})
  await assert.rejects(executeReviewedPythonEzdxfBaseline({prepared,approvedCodeSha256:'0'.repeat(64),python,ezdxfPath}),/EXACT_CODE_REVIEW_REQUIRED/)
  const result=await executeReviewedPythonEzdxfBaseline({prepared,approvedCodeSha256:prepared.sourceSha256,python,ezdxfPath});assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.manifest.handles.length,3);const extraction=JSON.parse(await readFile(join(prepared.directory,'extraction.json'),'utf8'));assert.equal(extraction.prefix,'Explanation\n');assert.equal(extraction.suffix,'\nAfterword');assert.equal(extraction.codeBodyPreserved,true);assert.equal(await readFile(prepared.sourceFile,'utf8'),valid);assert.match(result.dxf,/AC1032/);assert.equal(result.transportIncluded,false)
  const changed=await preparePythonEzdxfBaseline({code:valid,outputDirectory:join(base,'tampered')});await writeFile(changed.sourceFile,'print(1)')
  await assert.rejects(executeReviewedPythonEzdxfBaseline({prepared:changed,approvedCodeSha256:changed.sourceSha256,python,ezdxfPath}),/REVIEWED_SOURCE_CHANGED/)
  for(const [i,code]of ['import os\nos.system("echo bad")','import ezdxf\nx=ezdxf.__dict__',`with open(${JSON.stringify(join(base,'outside.txt'))},'w') as f:\n    f.write('bad')`,"with open(OUTPUT_DXF,'w') as f:\n    f.write('x'*4194305)"].entries()){
   const review=await preparePythonEzdxfBaseline({code,outputDirectory:join(base,'denied-'+i)}),r=await executeReviewedPythonEzdxfBaseline({prepared:review,approvedCodeSha256:review.sourceSha256,python,ezdxfPath});assert.equal(r.passed,false,JSON.stringify(r));assert.match(r.reason,/NOT_ALLOWED|OUTSIDE_OUTPUT|ARTIFACT_WRITE_BUDGET/)
  }
 }finally{await rm(base,{recursive:true,force:true})}
})

test('independent road validator accepts real approved 488-entity evidence, independently recomputes takeoff and rejects corruptions',async t=>{
 if(!needPython(t))return
 const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'meter'}),input=createRoadDesignFixture(),options=structuredClone(roadDrawingFixtureOptions),proposal=buildAgentRoadDrawing(document,{...input,...options,expectedRevision:0})
 await sdk.executeCommand('CREATEBATCH',proposal.commandArgs)
 const manifest=createKJRoadRoleManifest(document,proposal.evidence),dxf=await sdk.writeDocument(document,{format:'DXF',version:'2018'})
 const validate=payload=>{const r=spawnSyncWithFileStdin(python,['scripts/benchmarks/road-independent-validator.py'],JSON.stringify(payload),{encoding:'utf8',timeout:30000,maxBuffer:262144});assert.equal(r.status,0,r.stderr||r.error?.message);return JSON.parse(r.stdout)}
 const payload={dxf,input,options,manifest},result=validate(payload);assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.sections,13);assert.equal(result.entities,488)
 assert.ok(Math.abs(result.cutVolume-proposal.evidence.calculation.totalVolume.cut)<1e-6);assert.ok(Math.abs(result.fillVolume-proposal.evidence.calculation.totalVolume.fill)<1e-6)
 for(const mutate of [p=>p.manifest.sections.pop(),p=>p.manifest.profile.origin[0]+=1,p=>p.manifest.sections[3].design=p.manifest.sections[3].ground,p=>p.manifest.totals.cells.reverse(),p=>p.input.pavement.leftWidth+=.1,p=>p.input.sections[3].ground[2][1]+=.1,p=>p.manifest.profile.origin[0]=null,p=>p.manifest.sections[0].elevationDatum='NaN',p=>p.manifest.plan.alignment.push(p.manifest.plan.alignment[0]),p=>p.manifest.sections[1].labels=p.manifest.sections[0].labels]){
  const bad=structuredClone(payload);mutate(bad);const observed=validate(bad);assert.equal(observed.passed,false,JSON.stringify(observed))
 }
 const editTag=(handle,code,value)=>{
  const rows=String(dxf).trimEnd().split(/\r?\n/),pairs=[];for(let i=0;i<rows.length;i+=2)pairs.push([Number(rows[i]),rows[i+1]])
  let start=0
  while(start<pairs.length){let end=start+1;while(end<pairs.length&&pairs[end][0]!==0)end++;const group=pairs.slice(start,end)
   if(group.some(([c,v])=>c===5&&v===handle)){const item=group.find(([c])=>c===code);if(item)item[1]=String(value);else group.push([code,String(value)]);pairs.splice(start,end-start,...group);return pairs.flat().join('\r\n')+'\r\n'}start=end}
  throw new Error('Missing native test entity')
 }
 for(const [handle,code,value]of [[manifest.plan.edges[0],39,1],[manifest.profile.labels[0],10,'NaN'],[manifest.stationTable[0].cells[0],40,'Infinity']]){
  const result=validate({...payload,dxf:editTag(handle,code,value)});assert.equal(result.passed,false,JSON.stringify(result))
 }
 const layerId=document.getObject(`road:${options.drawingId}:plan/alignment`).payload.layerId
 await document.transact('Lock actual evidence layer',tx=>tx.updateObject(layerId,{payload:{locked:true}}))
 assert.equal(validate({...payload,dxf:await sdk.writeDocument(document,{format:'DXF',version:'2018'})}).passed,false)
})
