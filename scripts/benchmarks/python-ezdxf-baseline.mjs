// Offline execution component: no model transport and no credentials.
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const worker=fileURLToPath(new URL('./python-ezdxf-worker.py',import.meta.url))
export const pythonEzdxfBaselineSystemPrompt=`Produce a complete editable CAD drawing using Python 3 and ezdxf 1.4.4. Return one Python program only (optionally one python code fence). You may use loops, functions, lists, dictionaries and arithmetic; import only ezdxf, math and json. Do not use KJDraw, network, subprocesses, introspection, external input files or external packages. The host supplies OUTPUT_DXF and OUTPUT_MANIFEST absolute output filenames. Use doc=ezdxf.new('R2018'); doc.units=6; msp=doc.modelspace(); msp.add_lwpolyline([(x,y),...],dxfattribs={'layer':'name'}); msp.add_text('label',dxfattribs={'insert':(x,y),'height':3,'layer':'name'}); doc.saveas(OUTPUT_DXF). Create layers with doc.layers.new(name,dxfattribs={'color':n}); native dimensional APIs, if needed, require .render(). Write the requested view/geometry/table associations as JSON using with open(OUTPUT_MANIFEST,'w',encoding='utf-8') as f: json.dump(manifest,f). Compute geometry and takeoff from the supplied design data. Do not hardcode computed answers, claim success or repair the host environment. Your code is reviewed before execution; review cannot edit the program.`
export function buildPythonEzdxfBaselineRequest({model,userPrompt,settings}){
 if(typeof model!=='string'||!model.trim()||typeof userPrompt!=='string'||!userPrompt.trim()||!settings||typeof settings!=='object')throw new Error('Explicit model, shared user prompt and provider settings required')
 if(['model','messages','tools','tool_choice'].some(key=>Object.hasOwn(settings,key)))throw new Error('Provider settings cannot replace the shared prompt or arm')
 return {model,messages:[{role:'system',content:pythonEzdxfBaselineSystemPrompt},{role:'user',content:userPrompt}],...structuredClone(settings)}
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
export async function preparePythonEzdxfBaseline({code,outputDirectory}){
 const extraction=extractResponse(code);code=extraction.code;if(typeof outputDirectory!=='string'||!outputDirectory)throw new Error('Choose a new output directory')
 const directory=resolve(outputDirectory);await mkdir(directory,{recursive:false});const canonical=await realpath(directory)
 const sourceSha256=createHash('sha256').update(code).digest('hex');await writeFile(join(canonical,'candidate.py'),code,{flag:'wx'})
 await writeFile(join(canonical,'response-content.txt'),extraction.originalContent,{flag:'wx'})
 await writeFile(join(canonical,'extraction.json'),JSON.stringify({format:extraction.format,sourceSha256,originalContentSha256:createHash('sha256').update(extraction.originalContent).digest('hex'),originalContentBytes:Buffer.byteLength(extraction.originalContent),codeBytes:Buffer.byteLength(code),prefix:extraction.prefix,suffix:extraction.suffix,codeBodyPreserved:extraction.format==='unique-python-fence',manualCodeEdits:0},null,2),{flag:'wx'})
 const review={schema:'kjdraw-python-ezdxf-review@1',sourceSha256,directory:canonical,sourceFile:join(canonical,'candidate.py'),status:'awaiting-human-review',boundary:'Restricted subprocess and audit checks are defense in depth, not an OS sandbox. Execute only after explicit review of these exact bytes. No credentials enter the worker.'}
 await writeFile(join(canonical,'review.json'),JSON.stringify(review,null,2),{flag:'wx'});return Object.freeze(review)
}
export async function executeReviewedPythonEzdxfBaseline({prepared,approvedCodeSha256,python=process.env.KJDRAW_PYTHON??'python',ezdxfPath,timeoutMs=20000}){
 if(!prepared||approvedCodeSha256!==prepared.sourceSha256||!/^[a-f0-9]{64}$/.test(approvedCodeSha256))throw new Error('EXACT_CODE_REVIEW_REQUIRED')
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new Error('Invalid execution time budget')
 const directory=await realpath(prepared.directory);if(directory!==prepared.directory)throw new Error('OUTPUT_DIRECTORY_REDIRECTED')
 const code=await readFile(prepared.sourceFile,'utf8');if(createHash('sha256').update(code).digest('hex')!==approvedCodeSha256)throw new Error('REVIEWED_SOURCE_CHANGED')
 const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','PATH','PATHEXT','COMSPEC'])if(process.env[key])env[key]=process.env[key]
 Object.assign(env,{PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',TMP:directory,TEMP:directory,TMPDIR:directory})
 const start=performance.now(),result=spawnSync(python,['-I','-B',worker],{input:JSON.stringify({code,sourceSha256:approvedCodeSha256,directory,ezdxfPath}),env,cwd:directory,encoding:'utf8',timeout:timeoutMs,maxBuffer:131072,windowsHide:true})
 const executionWallMs=performance.now()-start;let workerReport
 try{workerReport=JSON.parse(result.stdout)}catch{workerReport={passed:false,reason:result.error?.code==='ETIMEDOUT'?'EXECUTION_TIMEOUT':'WORKER_RESPONSE_INVALID'}}
 const report={...workerReport,sourceSha256:approvedCodeSha256,executionWallMs,exitCode:result.status,signal:result.signal??null,passed:result.status===0&&workerReport.passed===true,transportIncluded:false,manualReview:'approval of exact source only; no edits'}
 await writeFile(join(directory,'execution.json'),JSON.stringify(report,null,2),{flag:'wx'})
 if(report.passed){const dxf=await readFile(join(directory,'drawing.dxf'),'utf8'),manifest=JSON.parse(await readFile(join(directory,'drawing-manifest.json'),'utf8'));return {...report,dxf,manifest}}
 return report
}
