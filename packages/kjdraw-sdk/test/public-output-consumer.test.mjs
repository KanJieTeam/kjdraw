import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm,realpath} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const run=(command,args,options={})=>{const r=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,...options});assert.equal(r.status,0,`${r.error?.message??''}\n${r.stdout}\n${r.stderr}`);return r}
async function compiler(){const tsc=join(root,'node_modules/typescript/bin/tsc');if(existsSync(tsc))return[process.execPath,[tsc]];const name=`typescript-${process.platform}-${process.arch}`;const binary=join(root,'node_modules/@typescript',name,'lib',process.platform==='win32'?'tsc.exe':'tsc');assert.ok(existsSync(binary),'Install the locked TypeScript compiler first');return[binary,[]]}

test('real installed tarball exposes vector output, headless print and angular/AI transform APIs to typed framework consumers',{timeout:180000},async()=>{
 const parent=resolve(process.env.KJDRAW_AUDIT_TMPDIR||tmpdir());await mkdir(parent,{recursive:true});const scratch=await mkdtemp(join(parent,'kjdraw-output-consumer-'))
 try{
  const audit=run(process.execPath,['scripts/audits/verify-packed-package.mjs'],{env:{...process.env,KJDRAW_KEEP_PACK_AUDIT:'1',KJDRAW_AUDIT_TMPDIR:scratch,npm_config_offline:'true'}})
  const baseline=JSON.parse(audit.stdout);assert.equal(baseline.ok,true);assert.deepEqual(baseline.typedConsumers,['Vanilla TypeScript','React TSX','Vue composable']);assert.equal(baseline.frameworkInstall.mode,'locked-offline-npm-ci')
  const folders=(await readdir(scratch)).filter(n=>n.startsWith('kjdraw-packed-consumer-'));assert.equal(folders.length,1)
  const consumer=join(scratch,folders[0],'consumer'),installed=join(consumer,'node_modules/@kanjieteam/kjdraw'),manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'))
  const installedPath=await realpath(installed),relativePath=relative(scratch,installedPath);assert.ok(relativePath&&!relativePath.startsWith('..')&&!isAbsolute(relativePath),'Installed package must be copied from the tarball, not a checkout symlink')
  for(const subpath of ['./svg-export','./print-export','./file/svg']){const target=manifest.exports[subpath];assert.ok(target,`Missing public ${subpath}`);for(const field of ['types','import'])assert.ok(existsSync(join(installed,target[field])),`${subpath} ${field} missing from packed artifact`)}
  const runtime=String.raw`
import assert from 'node:assert/strict'
import * as root from '@kanjieteam/kjdraw'
import {exportDrawingSvg} from '@kanjieteam/kjdraw/svg-export'
import {createDrawingPrintHtml,openDrawingPrintWindow} from '@kanjieteam/kjdraw/print-export'
import {createSVGFileAdapter} from '@kanjieteam/kjdraw/file/svg'
import {createDraftingSession} from '@kanjieteam/kjdraw/drafting'
import {KJAgentToolSession} from '@kanjieteam/kjdraw/agent-tools'
assert.equal(typeof globalThis.window,'undefined');assert.equal(typeof globalThis.document,'undefined');assert.equal(typeof globalThis.CSSStyleSheet,'undefined')
assert.equal(root.exportDrawingSvg,exportDrawingSvg);assert.equal(root.createDrawingPrintHtml,createDrawingPrintHtml);assert.equal(root.createSVGFileAdapter,createSVGFileAdapter)
const sdk=root.createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'}),layoutId=drawing.snapshot().spaces.layoutIds[1],ownerId=drawing.getObject(layoutId).payload.blockRecordId
await sdk.executeCommand('PAGESETUP',{layoutId,dxf:{paperWidth:210,paperHeight:297,paperUnits:1,scaleNumerator:1,scaleDenominator:1,plotType:5,flags:0}})
const draft=createDraftingSession('dimension',{dimensionType:'ANGULAR_3_POINT',textHeight:3});for(const p of [[40,40],[50,40],[40,50]])assert.equal(draft.addPoint(p),null)
const angle=draft.addPoint([30,30]);assert.equal(angle.payload.measurement,270);await drawing.transact('paper angular dimension',tx=>tx.createEntity(angle.type,angle.payload,{ownerId}))
const edge=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0,0],end:[10,0,0]}})
const session=new KJAgentToolSession(sdk,drawing),value=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
for(const [tool,extra]of [['cad_propose_rotate',{angleDegrees:90}],['cad_propose_scale',{factor:2}]]){
 assert.ok(session.definitions.some(t=>t.name===tool));const before=drawing.serialize(),proposal=value(await session.call(tool,{expectedRevision:drawing.revision,units:'millimeter',ids:[edge.id],center:{x:0,y:0},...extra}));assert.equal(drawing.serialize(),before)
 const receipt=value(await session.approve(proposal.planId,'packed-consumer-reviewer'));assert.equal(receipt.status,'committed')
}
assert.ok(Math.abs(drawing.getObject(edge.id).payload.end[0])<1e-8);assert.ok(Math.abs(drawing.getObject(edge.id).payload.end[1]-20)<1e-8)
const before=drawing.serialize(),output=exportDrawingSvg(drawing,{layoutId});assert.match(output.svg,/<svg/);assert.match(output.svg,/270°/);assert.equal(output.report.diagnostics.length,0)
assert.equal(await sdk.writeDocument(drawing,{format:'SVG',layoutId}),output.svg)
const html=createDrawingPrintHtml(drawing,{layoutId,title:'Packed output'});assert.match(html.html,/@page\{size:210mm 297mm/);assert.match(html.html,/<svg/);assert.equal(html.report.diagnostics.length,0)
await assert.rejects(openDrawingPrintWindow(drawing,{layoutId}),/browser window/);assert.equal(drawing.serialize(),before)
console.log(JSON.stringify({nodeWithoutDOM:true,angular:270,reviewedTransforms:2,svg:output.mimeType,print:html.mimeType,diagnostics:0}))
`
  const runtimePath=join(consumer,'public-output.mjs');await writeFile(runtimePath,runtime);const result=JSON.parse(run(process.execPath,[runtimePath],{cwd:consumer}).stdout)
  assert.deepEqual(result,{nodeWithoutDOM:true,angular:270,reviewedTransforms:2,svg:'image/svg+xml',print:'text/html',diagnostics:0})
  const types=String.raw`
import { createKJDrawSDK, createDraftingSession, exportDrawingSvg as rootSvg, createDrawingPrintHtml as rootPrint, type KJDraftDimensionType, type KJDrawingPrintOptions, type KJSvgExportOptions } from '@kanjieteam/kjdraw'
import { exportDrawingSvg, type KJSvgDrawingExport } from '@kanjieteam/kjdraw/svg-export'
import { createDrawingPrintHtml, openDrawingPrintWindow, type KJDrawingPrintHtml } from '@kanjieteam/kjdraw/print-export'
import { createSVGFileAdapter } from '@kanjieteam/kjdraw/file/svg'
import { KJAgentToolSession, type KJAgentToolResult } from '@kanjieteam/kjdraw/agent-tools'
export function publicOutput(document: ReturnType<ReturnType<typeof createKJDrawSDK>['createDocument']>, layoutId: string) {
 const svgOptions: KJSvgExportOptions = {layoutId}; const printOptions: KJDrawingPrintOptions = {layoutId,locale:'en'}
 const svg: KJSvgDrawingExport=exportDrawingSvg(document,svgOptions),print:KJDrawingPrintHtml=createDrawingPrintHtml(document,printOptions)
 const dimensionType:KJDraftDimensionType='ANGULAR_3_POINT'; const draft=createDraftingSession('dimension',{dimensionType})
 const paperWidth:number=svg.paper.widthMm; const diagnostics:readonly unknown[]=print.report.diagnostics
 rootSvg(document,svgOptions);rootPrint(document,printOptions);createSVGFileAdapter()
 const browserPrint:()=>Promise<KJDrawingPrintHtml>=()=>openDrawingPrintWindow(document,printOptions)
 return {svg,print,draft,paperWidth,diagnostics,browserPrint}
}
export function proposals(sdk:ReturnType<typeof createKJDrawSDK>,document:Parameters<typeof publicOutput>[0]):Promise<KJAgentToolResult>[] {
 const session=new KJAgentToolSession(sdk,document)
 return [session.call('cad_propose_rotate',{expectedRevision:document.revision,units:'millimeter',ids:['line'],center:{x:0,y:0},angleDegrees:90}),session.call('cad_propose_scale',{expectedRevision:document.revision,units:'millimeter',ids:['line'],center:{x:0,y:0},factor:2})]
}
// @ts-expect-error This is not a supported dimension mode.
createDraftingSession('dimension',{dimensionType:'ANGULAR_4_POINT'})
// @ts-expect-error Physical output requires an explicit layout reference.
const missingLayout:KJSvgExportOptions={}
// @ts-expect-error Headless print must never silently accept partial geometry.
const unsafePrint:KJDrawingPrintOptions={layoutId:'sheet',allowPartial:true}
`
  await writeFile(join(consumer,'src/public-output.ts'),types)
  await writeFile(join(consumer,'src/public-output-react.tsx'),`import {useCallback} from 'react'\nimport {KJDraw} from '@kanjieteam/kjdraw/react'\nimport {publicOutput} from './public-output.js'\nexport function OutputReact(props:{drawing:Parameters<typeof publicOutput>[0];layoutId:string}){const output=useCallback(()=>publicOutput(props.drawing,props.layoutId),[props.drawing,props.layoutId]);return <><KJDraw document={props.drawing}/><button onClick={output}>Export vectors</button></>}\n`)
  await writeFile(join(consumer,'src/public-output-vue.ts'),`import {defineComponent,h} from 'vue'\nimport {KJDraw} from '@kanjieteam/kjdraw/vue'\nimport {publicOutput} from './public-output.js'\nexport const outputVue=(drawing:Parameters<typeof publicOutput>[0],layoutId:string)=>defineComponent({setup(){return()=>h('section',[h(KJDraw,{document:drawing}),h('button',{onClick:()=>publicOutput(drawing,layoutId)},'Export vectors')])}})\n`)
  const [command,args]=await compiler();run(command,[...args,'--project',join(consumer,'tsconfig.json'),'--pretty','false'],{cwd:consumer})
 }finally{
  const resolved=await realpath(scratch);assert.equal(resolved,resolve(scratch),'Refuse cleanup through a redirected scratch directory');await rm(scratch,{recursive:true,force:true})
 }
})
