import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJProjectSession } from '../../packages/kjdraw-sdk/src/project-session.js'
import { projectDimension } from '../../packages/kjdraw-sdk/src/geometry/annotation.js'
test.use({bypassCSP:true})
async function command(page,selector,value){const input=page.locator(selector);await input.fill(value);await input.press('Enter');await expect(input).toHaveValue('')}
async function mount(page){
 await page.goto('/');await page.evaluate(async()=>{
  document.body.replaceChildren();const host=document.createElement('div');host.id='angle-workbench';host.style.cssText='width:1100px;height:760px';document.body.append(host)
  const [{createKJDrawSDK},{mountKJDrawWorkbench},{KJCanvasRenderer},{projectDimension}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/workbench.js'),import('/packages/kjdraw-sdk/src/canvas-renderer.js'),import('/packages/kjdraw-sdk/src/geometry/annotation.js')])
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'}),workbench=mountKJDrawWorkbench(host,{sdk,document:drawing});await workbench.ready
  workbench.renderer.resize();Object.assign(workbench.renderer.camera,{centerX:0,centerY:0,scale:10});workbench.renderer.render()
  window.angle={workbench,drawing,previews:[],projectDimension};const original=KJCanvasRenderer.prototype.drawPreview
  KJCanvasRenderer.prototype.drawPreview=function(entities,...args){for(const e of entities)if(e.type==='DIMENSION')window.angle.previews.push(projectDimension(e.payload)?.measurement);return original.call(this,entities,...args)}
 })
}
async function position(page,point){return page.evaluate(point=>{const w=window.angle.workbench,r=w.root.querySelector('[data-canvas]').getBoundingClientRect(),p=w.renderer.worldToScreen(point);return{x:r.left+p[0],y:r.top+p[1]}},point)}

test('workbench four-step angular tool previews sectors, cancels, retries placement, commits and reopens native files',async({page})=>{
 await mount(page);const input='#angle-workbench [data-command]',hint=page.locator('#angle-workbench [data-hint]')
 await command(page,input,'DIMANGULAR');await expect(hint).toContainText('Three-point angle 1/4')
 for(const coordinate of ['0,0','@10,0','@-10,10'])await command(page,input,coordinate)
 for(const point of [[6,6],[-6,-6]]){const p=await position(page,point);await page.mouse.move(p.x,p.y)}
 await expect.poll(()=>page.evaluate(()=>window.angle.previews.includes(90)&&window.angle.previews.includes(270))).toBe(true)
 expect(await page.evaluate(()=>({count:window.angle.drawing.listEntities().length,revision:window.angle.drawing.revision}))).toEqual({count:0,revision:0})
 await page.keyboard.press('Escape');expect(await page.evaluate(()=>window.angle.drawing.listEntities().length)).toBe(0)
 await page.locator('#angle-workbench [data-action="draft"]').click();await page.locator('#angle-workbench [data-draft-tool]').selectOption('dimension')
 await page.locator('#angle-workbench [data-draft-option="dimensionType"]').selectOption('ANGULAR_3_POINT');await page.locator('#angle-workbench [data-action="start-draft"]').click()
 for(const coordinate of ['0,0','10,0','0,10'])await command(page,input,coordinate)
 await page.locator(input).press('Tab');await page.keyboard.press('Backspace');await expect(hint).toContainText('3/4');await command(page,input,'0,10')
 await command(page,input,'6,0');await expect(page.locator('#angle-workbench [data-message]')).toContainText('ambiguous arc placement')
 expect(await page.evaluate(()=>window.angle.drawing.listEntities().length)).toBe(0)
 const p=await position(page,[-6,-6]);await page.mouse.click(p.x,p.y);await expect.poll(()=>page.evaluate(()=>window.angle.drawing.listEntities().length)).toBe(1);await page.keyboard.press('Escape')
 const id=await page.evaluate(()=>window.angle.drawing.listEntities()[0].id)
 await command(page,input,'UNDO');await expect.poll(()=>page.evaluate(()=>window.angle.drawing.listEntities().length)).toBe(0)
 await command(page,input,'REDO');expect(await page.evaluate(()=>window.angle.drawing.listEntities()[0].id)).toBe(id)
 const files=await page.evaluate(async()=>({kjd:await window.angle.workbench.save('KJD',{download:false}),dxf:await window.angle.workbench.save('DXF',{download:false})}))
 for(const [format,content]of [['KJD',files.kjd],['DXF',files.dxf]]){const sdk=createKJDrawSDK(),d=await sdk.readDocument(content,{format}),e=d.listEntities({ownerId:d.snapshot().spaces.modelSpaceId,type:'DIMENSION'})[0];expect(e.payload.dimensionType).toBe('ANGULAR_3_POINT');expect(projectDimension(e.payload).measurement).toBeCloseTo(270,9)}
})

test('main playground exposes the angular option and DIMANGULAR3P creates a saved undoable dimension',async({page})=>{
 const sdk=createKJDrawSDK(),empty=sdk.createDocument({units:'millimeter'}),content=await sdk.writeDocument(empty,{format:'KJD'})
 await page.goto('/');await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
 await page.locator('#file-input').setInputFiles({name:'angular-empty.kjd',mimeType:'application/json',buffer:Buffer.from(content)})
 await expect(page.locator('#entity-count')).toHaveText('0 entities')
 expect(await page.locator('#dimension-type option[value="ANGULAR_3_POINT"]').count()).toBe(1)
 await command(page,'#command-input','DIMANGULAR3P');await expect(page.locator('#hint')).toContainText('1/4')
 for(const coordinate of ['0,0','10,0','0,10'])await command(page,'#command-input',coordinate)
 await expect(page.locator('#entity-count')).toHaveText('0 entities');await command(page,'#command-input','6,6');await expect(page.locator('#entity-count')).toHaveText('1 entities');await page.keyboard.press('Escape')
 await command(page,'#command-input','UNDO');await expect(page.locator('#entity-count')).toHaveText('0 entities');await command(page,'#command-input','REDO');await expect(page.locator('#entity-count')).toHaveText('1 entities')
 await page.locator('.ribbon-tabs [data-i18n="home"]').click();const pending=page.waitForEvent('download');await page.locator('#save').click();const file=await pending,bytes=await readFile(await file.path())
 const session=await KJProjectSession.open(bytes,{sdk:createKJDrawSDK()}),e=session.activeDocument.listEntities({type:'DIMENSION'})[0];expect(e.payload.dimensionType).toBe('ANGULAR_3_POINT');expect(projectDimension(e.payload).measurement).toBe(90);session.destroy()
})
