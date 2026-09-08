import { test, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

async function openFixture(page) {
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'selection-grips',title:'Selection and grips',units:'millimeter'})
  await drawing.transact('CAD selection fixture',tx=>{
    const locked=tx.upsertTableRecord('layers',{name:'Locked reference',type:'LAYER',payload:{locked:true,visible:true}})
    const hidden=tx.upsertTableRecord('layers',{name:'Hidden reference',type:'LAYER',payload:{visible:false}})
    const frozen=tx.upsertTableRecord('layers',{name:'Frozen reference',type:'LAYER',payload:{frozen:true,visible:true}})
    tx.createEntity('LINE',{start:[0,0,6],end:[20,0,6]},{id:'line-a'})
    tx.createEntity('LINE',{start:[30,5],end:[60,5]},{id:'line-b'})
    tx.createEntity('CIRCLE',{center:[80,30],radius:10},{id:'circle'})
    tx.createEntity('LINE',{start:[0,40],end:[20,40],layerId:locked.id},{id:'locked-line'})
    tx.createEntity('LINE',{start:[-100,-100],end:[100,100],layerId:hidden.id},{id:'hidden-line'})
    tx.createEntity('LINE',{start:[-100,100],end:[100,-100],layerId:frozen.id},{id:'frozen-line'})
  })
  const content=await sdk.writeDocument(drawing,{format:'KJD'})
  await page.setViewportSize({width:1440,height:960});await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:'selection-grips.kjd',mimeType:'application/json',buffer:Buffer.from(content)})
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  await expect(page.locator('#entity-count')).toHaveText('6 entities')
  if(await page.locator('#snap').getAttribute('aria-pressed')==='true')await page.locator('#snap').click()
}
async function screen(page,x,y) {
  const box=await page.locator('#canvas').boundingBox(),scale=Math.min((box.width-164)/90,(box.height-164)/40)
  return {x:box.x+box.width/2+(x-45)*scale,y:box.y+box.height/2-(y-20)*scale,scale}
}
async function click(page,x,y){const p=await screen(page,x,y);await page.mouse.click(p.x,p.y)}
async function boxSelect(page,first,second,{modifier,mode}={}){
  const a=await screen(page,...first),b=await screen(page,...second)
  if(modifier)await page.keyboard.down(modifier)
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8})
  if(mode)await expect(page.locator('.workbench')).toHaveAttribute('data-selection-mode',mode)
  await page.mouse.up();if(modifier)await page.keyboard.up(modifier)
}
async function save(page){
  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  const pending=page.waitForEvent('download');await page.locator('#save').click()
  const data=await readFile(await (await pending).path()),session=await KJProjectSession.open(data,{sdk:createKJDrawSDK()}),snapshot=session.activeDocument.snapshot()
  session.destroy();return snapshot
}

test('CAD window, crossing, additive/subtractive selection and Select All use real geometry and protect layers',async({page})=>{
  await openFixture(page);const revision=await page.locator('#revision').textContent(),original=await save(page)
  await boxSelect(page,[-2,4],[22,-4],{mode:'window'});await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await expect(page.locator('#inspector h3')).toHaveText('LINE')
  await boxSelect(page,[40,8],[35,2],{mode:'crossing'});await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await boxSelect(page,[-2,4],[22,-4],{modifier:'Shift',mode:'window'});await expect(page.locator('#selection-count')).toHaveText('2 selected')
  await boxSelect(page,[-2,4],[22,-4],{modifier:'Control',mode:'window'});await expect(page.locator('#selection-count')).toHaveText('1 selected')
  // Starting on blank space only changes selection after release, and never edits the drawing.
  await click(page,10,20);await page.keyboard.press('Control+a');await expect(page.locator('#selection-count')).toHaveText('3 selected')
  await expect(page.locator('#revision')).toHaveText(revision)
  expect((await save(page)).objects).toEqual(original.objects)
  if(!(await page.locator('.workbench').getAttribute('class')).includes('layers-open'))await page.locator('#toggle-layers').click()
  const locked=page.locator('.layer[data-layer-name="Locked reference"]')
  await locked.getByRole('button',{name:'Unlock layer · Locked reference',exact:true}).click()
  await click(page,10,20);await page.keyboard.press('Control+a');await expect(page.locator('#selection-count')).toHaveText('4 selected')
  await locked.getByRole('button',{name:'Lock layer · Locked reference',exact:true}).click()
  await expect(page.locator('#selection-count')).toHaveText('3 selected')
  await page.locator('.layer[data-layer-name="Frozen reference"]').getByRole('button',{name:'Layer settings · Frozen reference',exact:true}).click()
  await page.locator('#dialog-fields input[name="frozen"]').uncheck();await page.locator('#dialog-submit').click()
  await click(page,10,20);await page.keyboard.press('Control+a');await expect(page.locator('#selection-count')).toHaveText('4 selected')
})

test('single-entity grip drag previews without mutation, reshapes the endpoint and undoes exactly once',async({page},testInfo)=>{
  await openFixture(page);const original=await save(page),revision=await page.locator('#revision').textContent()
  await click(page,5,0);await expect(page.locator('#selection-count')).toHaveText('1 selected')
  const a=await screen(page,20,0),b=await screen(page,24,7)
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8})
  await expect(page.locator('.workbench')).toHaveAttribute('data-grip','line-a:end')
  await expect(page.locator('#revision')).toHaveText(revision)
  await page.keyboard.press('Escape');await page.mouse.up()
  expect((await save(page)).objects).toEqual(original.objects)
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up()
  await expect(page.locator('#status')).toContainText('Grip edit applied')
  const changed=await save(page),end=changed.objects['line-a'].payload.end
  // Browser pointer events quantize to CSS pixels. Stored undo/redo geometry is exact.
  expect(Math.abs(end[0]-24)).toBeLessThan(1.5/a.scale);expect(Math.abs(end[1]-7)).toBeLessThan(1.5/a.scale)
  expect(changed.objects['line-a'].payload.start).toEqual([0,0,6]);expect(end[2]).toBe(6)
  for(const id of ['line-b','circle','locked-line','hidden-line','frozen-line'])expect(changed.objects[id]).toEqual(original.objects[id])
  await page.locator('#undo').click();expect((await save(page)).objects).toEqual(original.objects)
  await page.locator('#redo').click();expect((await save(page)).objects).toEqual(changed.objects)
  if(testInfo.project.name==='chromium'){
    if(!(await page.locator('.workbench').getAttribute('class')).includes('layers-open'))await page.locator('#toggle-layers').click()
    await page.locator('#nav-fit').click();await click(page,12,3.5)
    await expect(page.locator('#selection-count')).toHaveText('1 selected')
    await mkdir('.cache/playground-selection-results',{recursive:true})
    await page.screenshot({path:'.cache/playground-selection-results/selection-layers.png'})
  }
})

test('fence selects crossed objects, supports point undo, and bilingual prompts describe the workflow',async({page})=>{
  await openFixture(page);const revision=await page.locator('#revision').textContent()
  await page.locator('#nav-fence').click();await click(page,10,-5);await click(page,10,10)
  await expect(page.locator('#selection-count')).toHaveText('0 selected')
  await page.keyboard.press('Backspace');await click(page,10,8);await page.keyboard.press('Enter')
  await expect(page.locator('#selection-count')).toHaveText('1 selected');await expect(page.locator('#revision')).toHaveText(revision)
  await page.locator('#language').click();await page.locator('#nav-fence').click();await expect(page.locator('#hint')).toContainText('围栏点')
  await page.keyboard.press('Escape');await expect(page.locator('#hint')).toContainText('空白拖动框选')
})

test('view changes, pointer cancellation and lost capture discard unfinished grip and box gestures',async({page})=>{
  await openFixture(page);const original=await save(page)
  await click(page,5,0)
  for(const cancellation of ['pointercancel','lostpointercapture','wheel','layout']){
    await page.locator('#layout-select').selectOption('classic');await page.locator('#nav-fit').click()
    const a=await screen(page,20,0),b=await screen(page,25,8)
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5})
    await expect(page.locator('.workbench')).toHaveAttribute('data-grip','line-a:end')
    if(cancellation==='wheel')await page.mouse.wheel(0,100)
    else if(cancellation==='layout')await page.locator('#layout-select').selectOption('compact')
    else await page.locator('#canvas').dispatchEvent(cancellation,{pointerId:1,button:0})
    await expect(page.locator('.workbench')).not.toHaveAttribute('data-grip',/./)
    await page.mouse.up();expect((await save(page)).objects).toEqual(original.objects)
  }
  await page.locator('#layout-select').selectOption('classic');await page.locator('#nav-fit').click()
  const a=await screen(page,-2,4),b=await screen(page,22,-4)
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.keyboard.press('Escape');await page.mouse.up()
  expect((await save(page)).objects).toEqual(original.objects)
})

test('unrelated touch pointers cannot replace, move or cancel the active CAD gesture',async({page})=>{
  await openFixture(page);const original=await save(page),revision=await page.locator('#revision').textContent()
  const canvas=page.locator('#canvas')
  const disturb=async()=>{
    const p=await screen(page,80,30)
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])
      await canvas.dispatchEvent(type,{pointerType:'touch',isPrimary:false,pointerId:99,button:0,buttons:1,clientX:p.x,clientY:p.y})
  }
  const a=await screen(page,-2,4),b=await screen(page,22,-4)
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4})
  await disturb();await expect(page.locator('.workbench')).toHaveAttribute('data-selection-mode','window')
  await page.mouse.up();await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await expect(page.locator('#inspector h3')).toHaveText('LINE')
  const endpoint=await screen(page,20,0),target=await screen(page,24,7)
  await page.mouse.move(endpoint.x,endpoint.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:4})
  await disturb();await expect(page.locator('.workbench')).toHaveAttribute('data-grip','line-a:end')
  await expect(page.locator('#revision')).toHaveText(revision)
  await page.mouse.up();await expect(page.locator('#status')).toContainText('Grip edit applied')
  const edited=await save(page)
  expect(Math.abs(edited.objects['line-a'].payload.end[0]-24)).toBeLessThan(1.5/endpoint.scale)
  expect(Math.abs(edited.objects['line-a'].payload.end[1]-7)).toBeLessThan(1.5/endpoint.scale)
  await page.locator('#undo').click();expect((await save(page)).objects).toEqual(original.objects)
  await page.locator('#nav-fence').click();await click(page,10,-5);await disturb();await click(page,10,8);await page.keyboard.press('Enter')
  await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await expect(page.locator('#inspector h3')).toHaveText('LINE')
  expect((await save(page)).objects).toEqual(original.objects)
})
