import {test,expect} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'

test.use({bypassCSP:false})
async function fixture(page,strict=false){
  await page.route('**/print-test-host.html',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'${strict?'':" 'unsafe-inline'"}; object-src 'none'; base-uri 'none'`},body:'<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'}))
  await page.goto('/print-test-host.html')
  return page.evaluate(async()=>{
    const {createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/sdk.js')
    const {mountKJDrawWorkbench}=await import('/packages/kjdraw-sdk/src/workbench.js')
    const {openDrawingPrintWindow}=await import('/packages/kjdraw-sdk/src/print-export.js')
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'})
    const layoutId=drawing.snapshot().spaces.layoutIds[1],ownerId=drawing.getObject(layoutId).payload.blockRecordId
    await sdk.executeCommand('PAGESETUP',{layoutId,dxf:{paperWidth:420,paperHeight:297,paperUnits:1,scaleNumerator:1,scaleDenominator:1,plotType:5,flags:0,marginLeft:10,marginBottom:10}})
    const line=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0],end:[1000,0],trueColor:0xff0000,lineweight:100}})
    await sdk.executeCommand('VIEWPORT',{layoutId,center:[100,100],width:180,height:120,viewCenter:[0,0],viewHeight:12000})
    await drawing.transact('paper text',tx=>{
      tx.createEntity('TEXT',{position:[10,250],text:'KJDraw - Vector engineering drawing',height:6},{ownerId})
      tx.createEntity('TEXT',{position:[10,235],text:'道路工程图：平面、纵断面、横断面',height:6},{ownerId})
      tx.createEntity('TEXT',{position:[10,220],text:'1000 mm at 1:100 = 10 mm on paper',height:4},{ownerId})
      tx.createEntity('TEXT',{position:[10,205],text:'</text><script>window.attacked=true</script>',height:3},{ownerId})
      tx.createEntity('LWPOLYLINE',{vertices:[{point:[0,0]},{point:[400,0]},{point:[400,277]},{point:[0,277]}],closed:true},{ownerId})
    })
    const host=document.createElement('div');host.style.cssText='width:1500px;height:850px';document.body.append(host)
    const workbench=mountKJDrawWorkbench(host,{sdk,document:drawing,locale:'en',theme:'light',grid:false,showLayers:false,showInspector:false});await workbench.ready
    workbench.setDrawingLayout(layoutId)
    const realOpen=window.open.bind(window)
    const state={sdk,drawing,workbench,layoutId,line,source:drawing.serialize(),history:JSON.stringify(drawing.history),prints:0,beforePrint:0,popup:null,openDrawingPrintWindow,realOpen}
    window.printTest=state
    window.open=(...args)=>{
      const popup=realOpen(...args);state.popup=popup
      if(popup){const native=popup.print.bind(popup);popup.print=()=>{state.prints++;popup.addEventListener('beforeprint',()=>state.beforePrint++,{once:true});native()}}
      return popup
    }
    return {layoutId,lineId:line.id}
  })
}

test('workbench Print opens a real vector A3 PDF with extractable Chinese and exact viewport scale',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='chromium','PDF bytes are independently verified with Chromium printing')
  await page.setViewportSize({width:1600,height:1000});await fixture(page)
  const received=page.waitForEvent('popup')
  await page.locator('[data-action="print"]').click()
  const popup=await received
  await expect(page.locator('[data-message]')).toContainText('Print dialog opened')
  expect(await page.evaluate(()=>({prints:printTest.prints,before:printTest.beforePrint,unchanged:printTest.source===printTest.drawing.serialize()&&printTest.history===JSON.stringify(printTest.drawing.history)}))).toEqual({prints:1,before:1,unchanged:true})
  expect(await popup.evaluate(()=>({opener:window.opener,attacked:window.attacked===true,scriptCount:document.scripts.length,svg:!!document.querySelector('svg'),note:getComputedStyle(document.querySelector('.kj-print-note')).display}))).toEqual({opener:null,attacked:false,scriptCount:0,svg:true,note:'block'})
  await expect(popup.locator('.kj-print-note')).toContainText('100%')
  await mkdir('.cache/print-export',{recursive:true})
  const pdf=await popup.pdf({path:'.cache/print-export/workbench-a3.pdf',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false,scale:1})
  await testInfo.attach('actual-workbench-vector-pdf',{body:pdf,contentType:'application/pdf'})
  const script=String.raw`
import json,math,sys
from pypdf import PdfReader
import pdfplumber
r=PdfReader(sys.argv[1]);assert len(r.pages)==1
p=r.pages[0];text=p.extract_text();assert '道路工程图：平面、纵断面、横断面' in text;assert 'KJDraw - Vector engineering drawing' in text
assert 'Print at 100%' not in text
fonts=[];images=[]
def visit(res):
 for name,ref in res.get('/Font',{}).items():
  f=ref.get_object();fd=f.get('/DescendantFonts',[f])[0].get_object().get('/FontDescriptor',{}).get_object()
  fonts.append({'embedded':any(k in fd for k in ['/FontFile','/FontFile2','/FontFile3']),'unicode':'/ToUnicode' in f})
 for name,ref in res.get('/XObject',{}).items():
  x=ref.get_object()
  if x.get('/Subtype')=='/Image':images.append(str(name))
  if '/Resources' in x:visit(x['/Resources'])
visit(p['/Resources']);assert not images;assert fonts and all(f['embedded'] and f['unicode'] for f in fonts)
mm=[float(p.mediabox.width)*25.4/72,float(p.mediabox.height)*25.4/72]
assert abs(mm[0]-420)<.25 and abs(mm[1]-297)<.25
with pdfplumber.open(sys.argv[1]) as doc:
 lines=[l for l in doc.pages[0].lines if l['stroking_color']==(1.,0.,0.)]
 assert len(lines)==1
 length=math.hypot(lines[0]['width'],lines[0]['height'])*25.4/72;assert abs(length-10)<.001
print(json.dumps({'pages':1,'paperMm':mm,'lineMm':length,'images':images,'fonts':fonts}))
`
  const python=process.env.KJDRAW_PDF_PYTHON??process.env.KJDRAW_PYTHON??(process.platform==='win32'?'python':'python3')
  const result=spawnSync(python,['-c',script,resolve('.cache/print-export/workbench-a3.pdf')],{encoding:'utf8',maxBuffer:1024*1024})
  expect(result.status,result.stderr||result.error?.message).toBe(0)
  await writeFile('.cache/print-export/pdf-report.json',result.stdout)
  await popup.emulateMedia({media:'print'});await popup.setViewportSize({width:1600,height:1150});await popup.screenshot({path:'.cache/print-export/workbench-print.png',fullPage:true})
  await popup.close()
  await page.locator('[data-action="language"]').click();await expect(page.locator('[data-action="print"]')).toHaveAccessibleName('打印 / PDF')
})

test('strict host CSP retains physical print CSS and blocks executable content and external resources',async({page})=>{
  await fixture(page,true)
  const received=page.waitForEvent('popup')
  await page.evaluate(()=>{printTest.pending=printTest.openDrawingPrintWindow(printTest.drawing,{layoutId:printTest.layoutId,ownerWindow:window,title:'</title><script>alert(1)</script>'})})
  const popup=await received
  await page.evaluate(()=>printTest.pending)
  const result=await popup.evaluate(()=>{
    const target=document.querySelector('.kj-print-sheet'),box=target.getBoundingClientRect()
    return {width:box.width,height:box.height,sheets:document.adoptedStyleSheets.length,rules:[...document.adoptedStyleSheets].flatMap(sheet=>[...sheet.cssRules].map(rule=>rule.cssText)),scripts:document.scripts.length,title:document.title,network:performance.getEntriesByType('resource').length}
  })
  expect(result.width).toBeCloseTo(420*96/25.4,1);expect(result.height).toBeCloseTo(297*96/25.4,1)
  expect(result.sheets).toBe(1);expect(result.rules.some(rule=>rule.startsWith('@page')&&rule.includes('420mm 297mm'))).toBe(true)
  expect(result.scripts).toBe(0);expect(result.title).toBe('</title><script>alert(1)</script>');expect(result.network).toBe(0)
  expect(await page.evaluate(()=>printTest.prints)).toBe(1);await popup.close()
})

test('workbench reports blocked popups and rejects drawing or binding changes while fonts are loading',async({page})=>{
  await fixture(page)
  await page.evaluate(()=>{window.open=()=>null})
  await page.locator('[data-action="print"]').click();await expect(page.locator('[data-message]')).toContainText('blocked')
  expect(await page.evaluate(()=>printTest.drawing.serialize()===printTest.source)).toBe(true)
  for(const mutate of ['geometry','binding','document']){
    await page.evaluate(()=>{
      printTest.workbench.setDrawingLayout(printTest.layoutId)
      window.open=(...args)=>{
        const popup=printTest.realOpen(...args);printTest.popup=popup
        const ready=new Promise(resolve=>{printTest.resolveFonts=resolve})
        Object.defineProperty(popup.Document.prototype,'fonts',{get:()=>({ready}),configurable:true})
        popup.print=()=>{printTest.prints++};return popup
      }
    })
    const received=page.waitForEvent('popup');await page.locator('[data-action="print"]').click();const popup=await received
    await page.waitForFunction(()=>typeof printTest.resolveFonts==='function')
    const changed=await page.evaluate(async mutate=>{
      if(mutate==='geometry')await printTest.sdk.executeCommand('MOVE',{ids:[printTest.line.id],delta:[1,0]})
      else if(mutate==='binding')printTest.workbench.setDrawingLayout(null)
      else await printTest.workbench.setDocument(printTest.sdk.createDocument({units:'millimeter'}))
      const result={source:printTest.drawing.serialize(),history:JSON.stringify(printTest.drawing.history)}
      printTest.resolveFonts();return result
    },mutate)
    await expect(page.locator('[data-message]')).toContainText('drawing changed')
    await expect.poll(()=>popup.isClosed()).toBe(true)
    expect(await page.evaluate(()=>({source:printTest.drawing.serialize(),history:JSON.stringify(printTest.drawing.history)}))).toEqual(changed)
    expect(await page.evaluate(()=>printTest.prints)).toBe(0)
  }
})
