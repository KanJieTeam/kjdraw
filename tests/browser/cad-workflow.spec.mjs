import { test, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

async function openDrawing(page){
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'interaction-fixture',title:'Move workflow',units:'millimeter'})
  await drawing.transact('Moving line',tx=>tx.createEntity('LINE',{start:[0,0],end:[20,0]},{id:'moving-line'}))
  await drawing.transact('Reference line',tx=>tx.createEntity('LINE',{start:[0,30],end:[20,30]},{id:'reference-line'}))
  const data=await sdk.writeDocument(drawing,{format:'KJD'})
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:'move-workflow.kjd',mimeType:'application/json',buffer:Buffer.from(data)})
  await expect(page.locator('#file-state')).toContainText('Opened locally')
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  if(await page.locator('#snap').getAttribute('aria-pressed')==='true')await page.locator('#snap').click()
}
async function screenPoint(page,x,y){
  const box=await page.locator('#canvas').boundingBox(),scale=Math.min((box.width-164)/20,(box.height-164)/30)
  return {x:box.x+box.width/2+(x-10)*scale,y:box.y+box.height/2-(y-15)*scale}
}
async function clickPoint(page,x,y){const p=await screenPoint(page,x,y);await page.mouse.click(p.x,p.y)}
async function saveDrawing(page){
  const downloadEvent=page.waitForEvent('download');await page.locator('#save').click();const download=await downloadEvent
  const bytes=await readFile(await download.path()),session=await KJProjectSession.open(bytes,{sdk:createKJDrawSDK()})
  const snapshot=session.activeDocument.snapshot();session.destroy();return snapshot
}
function line(snapshot,id='moving-line'){return snapshot.objects[id]}

test('ordinary user moves, copies, cancels and saves a real drawing',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await openDrawing(page)
  // Command-first workflow: select a target, then base and destination.
  await page.locator('#move-selection').click()
  await expect(page.locator('#hint')).toContainText('Select an object')
  await clickPoint(page,10,0)
  await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await clickPoint(page,10,0);await clickPoint(page,15,5)
  await expect(page.locator('#revision')).toHaveText('REV 3')
  const moved=await saveDrawing(page)
  expect(line(moved).payload.start[0]).toBeCloseTo(5,1);expect(line(moved).payload.start[1]).toBeCloseTo(5,1)
  await page.locator('#undo').click();await expect(page.locator('#revision')).toHaveText('REV 4')
  expect(line(await saveDrawing(page)).payload.start.slice(0,2)).toEqual([0,0])
  await page.locator('#redo').click();await expect(page.locator('#revision')).toHaveText('REV 5')
  // Exact command path uses the same geometry operation and selects the copy.
  await page.locator('#command-input').fill('COPY 10 0');await page.locator('#command-input').press('Enter')
  await expect(page.locator('#entity-count')).toHaveText('3 entities')
  await expect(page.locator('#selection-count')).toHaveText('1 selected')
  const handle=await page.locator('#inspector .kv').first().textContent()
  await page.locator('#command-input').fill('MOVE 0 5');await page.locator('#command-input').press('Enter')
  await expect(page.locator('#revision')).toHaveText('REV 7')
  expect(await page.locator('#inspector .kv').first().textContent()).toBe(handle)
  const saved=await saveDrawing(page),copy=Object.values(saved.objects).find(object=>object.type==='LINE'&&!['moving-line','reference-line'].includes(object.id))
  expect(copy.payload.start[0]).toBeCloseTo(15,1);expect(copy.payload.start[1]).toBeCloseTo(10,1)
  // Preview cancellation does not mutate the document or history.
  await page.locator('#move-selection').click();await clickPoint(page,10,15)
  await page.locator('#command-input').focus();await page.keyboard.press('Escape')
  await expect(page.locator('.ribbon-group [data-tool="select"]')).toHaveAttribute('aria-pressed','true')
  await clickPoint(page,20,20)
  await expect(page.locator('#revision')).toHaveText('REV 7')
  const final=await saveDrawing(page);expect(final.objects).toEqual(saved.objects)
})

test('switching drawings cancels an unfinished point-to-point move',async({page})=>{
  const sdk=createKJDrawSDK(),first=sdk.createDocument({documentId:'switch-a',title:'Drawing A',units:'millimeter'}),second=sdk.createDocument({documentId:'switch-b',title:'Drawing B',units:'millimeter'})
  for(const [drawing,prefix] of [[first,'a'],[second,'b']])await drawing.transact('Fixture geometry',tx=>{
    tx.createEntity('LINE',{start:[0,0],end:[20,0]},{id:`${prefix}-moving`})
    tx.createEntity('LINE',{start:[0,30],end:[20,30]},{id:`${prefix}-reference`})
  })
  const project=KJProjectSession.create({sdk,id:'switch-project',documents:[first,second],activeDocumentId:first.id}),data=await project.package();project.destroy()
  await page.setViewportSize({width:1440,height:900});await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:'switch-project.kjp',mimeType:'application/zip',buffer:Buffer.from(data)})
  await expect(page.locator('[data-document="switch-a"]')).toHaveClass(/active/)
  if(await page.locator('#snap').getAttribute('aria-pressed')==='true')await page.locator('#snap').click()
  await page.locator('#move-selection').click();await clickPoint(page,10,0);await clickPoint(page,10,0)
  await page.locator('[data-document="switch-b"]').click()
  await expect(page.locator('[data-document="switch-b"]')).toHaveClass(/active/)
  await expect(page.locator('.ribbon-group [data-tool="select"]')).toHaveAttribute('aria-pressed','true')
  await clickPoint(page,10,0);await clickPoint(page,15,5)
  await expect(page.locator('#revision')).toHaveText('REV 1')
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
})

test('selected-object drag, navigation and layouts preserve the drawing',async({page},testInfo)=>{
  await page.setViewportSize({width:1440,height:900});await openDrawing(page)
  await clickPoint(page,10,0)
  const a=await screenPoint(page,10,0),b=await screenPoint(page,13,4)
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up()
  await expect(page.locator('#revision')).toHaveText('REV 3')
  const saved=await saveDrawing(page);expect(line(saved).payload.start[0]).toBeCloseTo(3,1);expect(line(saved).payload.start[1]).toBeCloseTo(4,1)
  await page.locator('#nav-pan').click();const canvas=await page.locator('#canvas').boundingBox()
  await page.mouse.move(canvas.x+100,canvas.y+120);await page.mouse.down();await page.mouse.move(canvas.x+180,canvas.y+160,{steps:5});await page.mouse.up()
  await expect(page.locator('#nav-pan')).toHaveAttribute('aria-pressed','true')
  await expect(page.locator('#revision')).toHaveText('REV 3')
  await page.locator('#nav-zoom-in').click();await page.locator('#nav-zoom-out').click();await page.locator('#nav-fit').click()
  const layoutHeights=[]
  for(const layout of ['classic','compact','focus','classic']){
    await page.locator('#layout-select').selectOption(layout)
    await expect(page.locator('.workbench')).toHaveAttribute('data-layout',layout)
    await expect(page.locator('#nav-pan')).toBeVisible()
    await expect(page.locator('#revision')).toHaveText('REV 3')
    await expect(page.locator('#selection-count')).toHaveText('1 selected')
    layoutHeights.push((await page.locator('#canvas').boundingBox()).height)
    if(testInfo.project.name==='chromium'){
      await mkdir('.cache/cad-workflow',{recursive:true});await page.screenshot({path:`.cache/cad-workflow/${layout}.png`})
    }
  }
  expect(layoutHeights[1]).toBeGreaterThan(layoutHeights[0]);expect(layoutHeights[2]).toBeGreaterThan(layoutHeights[1])
  expect((await saveDrawing(page)).objects).toEqual(saved.objects)
  await page.locator('#undo').click();expect(line(await saveDrawing(page)).payload.start.slice(0,2)).toEqual([0,0])
  // Layout preference survives reload; it never serializes document edits implicitly.
  await page.locator('#layout-select').selectOption('compact');await page.reload()
  await expect(page.locator('#layout-select')).toHaveValue('compact')
})

test('compact and focus navigation stay reachable on small screens',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  for(const layout of ['compact','focus','classic']){
    await page.locator('#layout-select').selectOption(layout)
    await expect(page.locator('#nav-pan')).toBeVisible()
    await expect(page.locator('#layout-select')).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    const box=await page.locator('#layout-select').boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(390)
  }
})
