import test from 'node:test'
import assert from 'node:assert/strict'
import {createKJDrawSDK} from '../src/sdk.js'
import {createDrawingPrintHtml,openDrawingPrintWindow} from '../src/print-export.js'

async function fixture(){
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
  const layoutId=document.snapshot().spaces.layoutIds[1],ownerId=document.getObject(layoutId).payload.blockRecordId
  await sdk.executeCommand('PAGESETUP',{layoutId,dxf:{paperWidth:420,paperHeight:297,paperUnits:1,scaleNumerator:1,scaleDenominator:1,plotType:5,flags:0}})
  const entity=await document.transact('native geometry',tx=>tx.createEntity('LINE',{start:[10,10],end:[110,10]},{ownerId}))
  return {sdk,document,layoutId,ownerId,entity}
}

test('print HTML is immutable vector output with explicit A3 CSS, escaped title and drawing text, and retained reports',async()=>{
  const {document,layoutId,ownerId}=await fixture()
  const hostile='</text></svg><script>fetch("https://evil.invalid")</script>道路'
  await document.transact('text',tx=>tx.createEntity('TEXT',{position:[20,20],text:hostile,height:4},{ownerId}))
  const source=document.serialize(),history=document.history
  const output=createDrawingPrintHtml(document,{layoutId,title:'</title><img src=x onerror=alert(1)>',locale:'zh-CN'})
  assert.equal(output.mimeType,'text/html');assert.equal(output.documentId,document.id);assert.equal(output.revision,document.revision)
  assert.deepEqual(output.paper,{widthMm:420,heightMm:297,millimetersPerDrawingUnit:1})
  assert.match(output.html,/@page\{size:420mm 297mm;margin:0\}/)
  assert.match(output.html,/script-src 'none'/);assert.match(output.html,/connect-src 'none'/)
  assert.match(output.html,/&lt;\/title&gt;&lt;img/);assert.match(output.html,/&lt;\/text&gt;&lt;\/svg&gt;&lt;script&gt;/)
  assert.doesNotMatch(output.html,/<script|<img|<iframe|<object|<canvas/i)
  assert.match(output.html,/字体/);assert.equal(output.report.status,'approximate');assert.equal(output.report.diagnostics.length,0)
  assert.ok(Object.isFrozen(output));assert.equal(document.serialize(),source);assert.deepEqual(document.history,history)
})

test('print rejects visible unsupported objects, partial escape hatches and malicious options without modifying the drawing',async()=>{
  const {document,layoutId,ownerId}=await fixture(),source=document.serialize()
  let getter=0
  const options=Object.defineProperty({layoutId},'title',{get(){getter++;return 'x'}})
  for(const bad of [options,{layoutId,allowPartial:true},{layoutId,title:'bad\u0000'},{layoutId,locale:'xx'},{layoutId,maxEntities:Infinity},{layoutId,title:'x'.repeat(257)}])assert.throws(()=>createDrawingPrintHtml(document,bad))
  assert.equal(getter,0);assert.equal(document.serialize(),source)
  const ray=await document.transact('unsupported geometry',tx=>tx.createEntity('RAY',{origin:[0,0],direction:[1,0]},{ownerId}))
  const before=document.serialize()
  assert.throws(()=>createDrawingPrintHtml(document,{layoutId}),error=>error.details?.diagnostics.some(row=>row.entityId===ray.id))
  assert.equal(document.serialize(),before)
})

test('browser print requires a real host and refuses blocked or stale requests before touching the source',async()=>{
  const {document,layoutId}=await fixture(),source=document.serialize()
  await assert.rejects(openDrawingPrintWindow(document,{layoutId}),/browser window/)
  let opened=0
  const ownerWindow={open(){opened++;return null}}
  await assert.rejects(openDrawingPrintWindow(document,{layoutId,ownerWindow,isCurrent:()=>false}),/drawing changed/)
  assert.equal(opened,0)
  await assert.rejects(openDrawingPrintWindow(document,{layoutId,ownerWindow}),/blocked/)
  assert.equal(opened,1);assert.equal(document.serialize(),source)
})
