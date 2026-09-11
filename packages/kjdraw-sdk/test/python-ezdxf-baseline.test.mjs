import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {buildPythonEzdxfBaselineRequest,extractPythonEzdxfProgram,preparePythonEzdxfBaseline,executeReviewedPythonEzdxfBaseline} from '../../../scripts/benchmarks/python-ezdxf-baseline.mjs'
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
for i in range(3):
    msp.add_line((i,0),(i,math.sqrt(4)))
doc.saveas(OUTPUT_DXF)
with open(OUTPUT_MANIFEST,'w',encoding='utf-8') as file:
    json.dump({'schema':'fixture','handles':[e.dxf.handle for e in msp]},file)
`

test('Python arm preserves exact shared user prompt and provider budget and never transports credentials',()=>{
 const prompt='Original common road data\n'+roadRoleManifestContract,settings={thinking:{type:'enabled'},max_tokens:32768,temperature:0}
 const request=buildPythonEzdxfBaselineRequest({model:'test-model',userPrompt:prompt,settings});assert.equal(request.messages[1].content,prompt);assert.deepEqual(request.thinking,settings.thinking);assert.equal(request.max_tokens,32768);assert.equal(request.tools,undefined)
 assert.equal(extractPythonEzdxfProgram('```python\nprint(1)\n```'),'print(1)\n');assert.throws(()=>extractPythonEzdxfProgram('```python\nx\n```\nextra'))
})

test('reviewed Python actually executes ezdxf while source tampering and host-side effects are rejected',async t=>{
 if(!needPython(t))return
 const base=await mkdtemp(join(process.env.KJDRAW_AUDIT_TMPDIR??tmpdir(),'kjdraw-python-baseline-'))
 try{
  const prepared=await preparePythonEzdxfBaseline({code:valid,outputDirectory:join(base,'accepted')})
  await assert.rejects(executeReviewedPythonEzdxfBaseline({prepared,approvedCodeSha256:'0'.repeat(64),python,ezdxfPath}),/EXACT_CODE_REVIEW_REQUIRED/)
  const result=await executeReviewedPythonEzdxfBaseline({prepared,approvedCodeSha256:prepared.sourceSha256,python,ezdxfPath});assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.manifest.handles.length,3);assert.match(result.dxf,/AC1032/);assert.equal(result.transportIncluded,false)
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
 const validate=payload=>{const r=spawnSync(python,['scripts/benchmarks/road-independent-validator.py'],{input:JSON.stringify(payload),encoding:'utf8',timeout:30000,maxBuffer:262144});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)}
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
