// Offline execution component: no model transport and no credentials.
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const worker=fileURLToPath(new URL('./python-ezdxf-worker.py',import.meta.url))
export const pythonEzdxfBaselineSystemPrompt=`Produce a complete editable CAD drawing using Python 3 and ezdxf 1.4.4. Return one Python program only (optionally one python code fence). You may use loops, functions, lists, dictionaries and arithmetic; import only ezdxf, math and json. Do not use KJDraw, network, subprocesses, introspection, arbitrary external input files or external packages. The host supplies OUTPUT_DXF and OUTPUT_MANIFEST absolute output filenames. On an edit turn, the host also supplies read-only PREVIOUS_DXF and PREVIOUS_MANIFEST filenames; load the prior drawing with ezdxf.readfile(PREVIOUS_DXF), preserve unrelated entities and stable identifiers, then save the edited drawing to OUTPUT_DXF. For a new drawing use doc=ezdxf.new('R2018'); set doc.units to the requested units (4 for millimeter, 6 for meter); msp=doc.modelspace(); msp.add_lwpolyline([(x,y),...],dxfattribs={'layer':'name'}); msp.add_text('label',dxfattribs={'insert':(x,y),'height':3,'layer':'name'}); doc.saveas(OUTPUT_DXF). Create layers with doc.layers.new(name,dxfattribs={'color':n}); native dimensional APIs, if needed, require .render(). Write the requested view/geometry/table associations as JSON using with open(OUTPUT_MANIFEST,'w',encoding='utf-8') as f: json.dump(manifest,f). Compute geometry and takeoff from the supplied design data. Do not hardcode computed answers, claim success or repair the host environment. Your code is reviewed before execution; review cannot edit the program.`
export function buildPythonEzdxfBaselineRequest({model,userPrompt,settings,priorMessages=[]}){
 if(typeof model!=='string'||!model.trim()||typeof userPrompt!=='string'||!userPrompt.trim()||!settings||typeof settings!=='object')throw new Error('Explicit model, shared user prompt and provider settings required')
 if(['model','messages','tools','tool_choice'].some(key=>Object.hasOwn(settings,key)))throw new Error('Provider settings cannot replace the shared prompt or arm')
 if(!Array.isArray(priorMessages)||priorMessages.some(message=>!message||!['user','assistant'].includes(message.role)||typeof message.content!=='string'||!message.content))throw new Error('Invalid prior conversation')
 return {model,messages:[{role:'system',content:pythonEzdxfBaselineSystemPrompt},...structuredClone(priorMessages),{role:'user',content:userPrompt}],...structuredClone(settings)}
}
function extractResponse(content){
 if(typeof content!=='string'||Buffer.byteLength(content)>131072)throw new Error('PYTHON_SOURCE_BUDGET')
 const fences=[...content.matchAll(/^```[^\r\n]*\r?$/gm)];let code,prefix='',suffix='',format='plain-python'
 if(fences.length){
  if(fences.length!==2||!/^```(?:python|py)?\r?$/.test(fences[0][0])||!/^```\r?$/.test(fences[1][0]))throw new Error('PYTHON_SOURCE_FORMAT')
  const start=fences[0].index+fences[0][0].length+1,end=fences[1].index
  code=content.slice(start,end);prefix=content.slice(0,fences[0].index);suffix=content.slice(end+fences[1][0].length);format='unique-python-fence'
 }else code=content.trim()+'\n'
 if(!code.trim()||code.includes('```')||code.includes('\0'))throw new Error('PYTHON_SOURCE_FORMAT')
 return {code,prefix,suffix,format,originalContent:content}
}
export function extractPythonEzdxfProgram(content){return extractResponse(content).code}
export async function preparePythonEzdxfBaseline({code,outputDirectory,previous}){
 const extraction=extractResponse(code);code=extraction.code;if(typeof outputDirectory!=='string'||!outputDirectory)throw new Error('Choose a new output directory')
 if(previous!==undefined&&(!previous||typeof previous.dxf!=='string'||!previous.dxf||typeof previous.manifest!=='object'||!previous.manifest||Array.isArray(previous.manifest)))throw new Error('Previous drawing and manifest required together')
 const previousManifest=previous===undefined?null:JSON.stringify(previous.manifest)
 if(previous&&(Buffer.byteLength(previous.dxf)>4194304||Buffer.byteLength(previousManifest)>262144))throw new Error('PREVIOUS_ARTIFACT_BUDGET')
 const directory=resolve(outputDirectory);await mkdir(directory,{recursive:false});const canonical=await realpath(directory)
 const sourceSha256=createHash('sha256').update(code).digest('hex');await writeFile(join(canonical,'candidate.py'),code,{flag:'wx'})
 if(previous){await writeFile(join(canonical,'previous.dxf'),previous.dxf,{flag:'wx'});await writeFile(join(canonical,'previous-manifest.json'),previousManifest,{flag:'wx'})}
 await writeFile(join(canonical,'response-content.txt'),extraction.originalContent,{flag:'wx'})
 await writeFile(join(canonical,'extraction.json'),JSON.stringify({format:extraction.format,sourceSha256,originalContentSha256:createHash('sha256').update(extraction.originalContent).digest('hex'),originalContentBytes:Buffer.byteLength(extraction.originalContent),codeBytes:Buffer.byteLength(code),prefix:extraction.prefix,suffix:extraction.suffix,codeBodyPreserved:extraction.format==='unique-python-fence',manualCodeEdits:0},null,2),{flag:'wx'})
 const review={schema:'kjdraw-python-ezdxf-review@1',sourceSha256,directory:canonical,sourceFile:join(canonical,'candidate.py'),previous:previous?{dxfSha256:createHash('sha256').update(previous.dxf).digest('hex'),manifestSha256:createHash('sha256').update(previousManifest).digest('hex')}:null,status:'awaiting-human-review',boundary:'Restricted subprocess and audit checks are defense in depth, not an OS sandbox. Execute only after explicit review of these exact bytes. No credentials enter the worker.'}
 await writeFile(join(canonical,'review.json'),JSON.stringify(review,null,2),{flag:'wx'});return Object.freeze(review)
}
export async function executeReviewedPythonEzdxfBaseline({prepared,approvedCodeSha256,python=process.env.KJDRAW_PYTHON??'python',ezdxfPath,timeoutMs=20000}){
 if(!prepared||approvedCodeSha256!==prepared.sourceSha256||!/^[a-f0-9]{64}$/.test(approvedCodeSha256))throw new Error('EXACT_CODE_REVIEW_REQUIRED')
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new Error('Invalid execution time budget')
 const directory=await realpath(prepared.directory);if(directory!==prepared.directory)throw new Error('OUTPUT_DIRECTORY_REDIRECTED')
 const code=await readFile(prepared.sourceFile,'utf8');if(createHash('sha256').update(code).digest('hex')!==approvedCodeSha256)throw new Error('REVIEWED_SOURCE_CHANGED')
 if(prepared.previous)for(const [name,sha]of [['previous.dxf',prepared.previous.dxfSha256],['previous-manifest.json',prepared.previous.manifestSha256]])if(createHash('sha256').update(await readFile(join(directory,name))).digest('hex')!==sha)throw new Error('PREVIOUS_ARTIFACT_CHANGED')
 const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','PATH','PATHEXT','COMSPEC'])if(process.env[key])env[key]=process.env[key]
 Object.assign(env,{PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',TMP:directory,TEMP:directory,TMPDIR:directory})
 const start=performance.now(),result=spawnSync(python,['-I','-B',worker],{input:JSON.stringify({code,sourceSha256:approvedCodeSha256,directory,ezdxfPath,previous:prepared.previous}),env,cwd:directory,encoding:'utf8',timeout:timeoutMs,maxBuffer:131072,windowsHide:true})
 const executionWallMs=performance.now()-start;let workerReport
 try{workerReport=JSON.parse(result.stdout)}catch{workerReport={passed:false,reason:result.error?.code==='ETIMEDOUT'?'EXECUTION_TIMEOUT':'WORKER_RESPONSE_INVALID'}}
 const report={...workerReport,sourceSha256:approvedCodeSha256,executionWallMs,exitCode:result.status,signal:result.signal??null,passed:result.status===0&&workerReport.passed===true,transportIncluded:false,manualReview:'approval of exact source only; no edits'}
 await writeFile(join(directory,'execution.json'),JSON.stringify(report,null,2),{flag:'wx'})
 if(report.passed){const dxf=await readFile(join(directory,'drawing.dxf'),'utf8'),manifest=JSON.parse(await readFile(join(directory,'drawing-manifest.json'),'utf8'));return {...report,dxf,manifest}}
 return report
}

// The caller owns provider transport. startedAt must be captured immediately before
// that request, so totalMs includes model time, code execution and validation.
// No review is inferred from the source hash: an explicit decision is required.
export async function completeReviewedPythonEzdxfBaselineRound({prepared,review,taskId,repetition,roundIndex,usage,startedAt,validate,python,ezdxfPath,timeoutMs}){
 if(!prepared||typeof taskId!=='string'||!taskId||!Number.isSafeInteger(repetition)||repetition<1||!Number.isSafeInteger(roundIndex)||roundIndex<1||typeof startedAt!=='number'||!Number.isFinite(startedAt)||typeof validate!=='function')throw new Error('Invalid baseline round contract')
 const record={taskId,arm:'python-ezdxf',repetition,roundIndex,usage:usage??null,validation:{passed:false},totalMs:null,status:'review-required',humanInterventionCount:0,review:null,execution:null}
 if(review!==undefined&&review!==null){
  if(!review||!['approved','rejected'].includes(review.decision)||!['human','external-security-gate'].includes(review.kind)||typeof review.reviewer!=='string'||!review.reviewer||typeof review.reviewedAt!=='string'||!Number.isFinite(Date.parse(review.reviewedAt)))throw new Error('Explicit auditable review decision required')
  if(review.decision==='approved'&&review.approvedCodeSha256!==prepared.sourceSha256)throw new Error('EXACT_CODE_REVIEW_REQUIRED')
  record.review={decision:review.decision,kind:review.kind,reviewer:review.reviewer,reviewedAt:review.reviewedAt,sourceSha256:prepared.sourceSha256}
  record.humanInterventionCount=review.kind==='human'?1:0
  await writeFile(join(prepared.directory,'review-decision.json'),JSON.stringify(record.review,null,2),{flag:'wx'})
  if(review.decision==='rejected')record.status='review-rejected'
  else{
   const execution=await executeReviewedPythonEzdxfBaseline({prepared,approvedCodeSha256:review.approvedCodeSha256,python,ezdxfPath,timeoutMs})
   record.execution={passed:execution.passed,reason:execution.reason??null,sourceSha256:execution.sourceSha256,executionWallMs:execution.executionWallMs,artifacts:execution.artifacts??null,programLogBytes:execution.programLogBytes??null}
   if(!execution.passed)record.status='execution-failed'
   else{
    try{
     const validation=await validate({dxf:execution.dxf,manifest:execution.manifest,taskId,repetition,roundIndex})
     if(!validation||typeof validation.passed!=='boolean')throw new Error('Independent validator must return passed boolean')
     record.validation=validation
     record.status=validation.passed?'passed':'validation-failed'
    }catch(error){record.status='validation-error';record.failure=error instanceof Error?error.message:'VALIDATOR_ERROR'}
   }
  }
 }
 record.totalMs=performance.now()-startedAt
 await writeFile(join(prepared.directory,'round-result.json'),JSON.stringify(record,null,2),{flag:'wx'})
 return record
}
