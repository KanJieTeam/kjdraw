import { expect, test } from '@playwright/test'

test.use({bypassCSP:true})

test('Workbench edits global and batch entity linetype scales and renders inherited styles',async({page})=>{
  await page.goto('/')
  await page.evaluate(async()=>{document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1100px;height:720px';document.body.append(host);const [{createKJDrawSDK},{mountKJDrawWorkbench}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/workbench.js')]);const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'scale-ui'}),dash=await sdk.executeCommand('LINETYPE',{name:'UI-DASH',pattern:[4,-2]},{document:drawing}),layer=await sdk.executeCommand('LAYERNEW',{name:'DASH',color:2,linetypeId:dash.id,lineweight:35,current:true},{document:drawing}),a=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0],end:[20,0],linetypeScale:1}},{document:drawing}),b=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,5],end:[20,5],linetypeScale:1}},{document:drawing}),workbench=mountKJDrawWorkbench(host,{sdk,document:drawing,locale:'en',grid:false});await workbench.ready;window.scaleTest={sdk,drawing,workbench,ids:[a.id,b.id],layer}})
  const root=page.locator('.kjwb'),inspector=root.locator('[data-inspector]'),global=inspector.locator('[data-property="global-linetype-scale"]')
  await expect(global).toHaveValue('1');await global.fill('2.5');await inspector.getByRole('button',{name:'Apply'}).click();await expect(global).toHaveValue('2.5')
  await page.evaluate(()=>window.scaleTest.sdk.getSelectionManager(window.scaleTest.drawing.id).active.replace(window.scaleTest.ids))
  const entityScale=inspector.locator('[data-property="linetype-scale"]');await expect(entityScale).toHaveValue('1');await entityScale.fill('1.5');await inspector.getByRole('button',{name:'Apply'}).click()
  await expect.poll(()=>page.evaluate(()=>window.scaleTest.ids.map(id=>window.scaleTest.drawing.getObject(id).payload.linetypeScale))).toEqual([1.5,1.5])
  await root.locator('[data-action="undo"]').click();await expect.poll(()=>page.evaluate(()=>window.scaleTest.ids.map(id=>window.scaleTest.drawing.getObject(id).payload.linetypeScale))).toEqual([1,1])
  await root.locator('[data-action="redo"]').click();await expect.poll(()=>page.evaluate(()=>window.scaleTest.ids.map(id=>window.scaleTest.drawing.getObject(id).payload.linetypeScale))).toEqual([1.5,1.5])
  await page.evaluate(()=>window.scaleTest.sdk.getSelectionManager(window.scaleTest.drawing.id).active.clear())
  await root.locator('[data-command]').fill('LTSCALE 4');await root.locator('[data-action="run-command"]').click();await expect(inspector.locator('[data-property="global-linetype-scale"]')).toHaveValue('4')
  expect(await page.evaluate(()=>window.scaleTest.workbench.renderer.render().unsupported)).toBe(0)
})

test('Playground exposes the same global and batch entity linetype scale workflow',async({page})=>{
  await page.goto('/');await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready',{timeout:30000})
  const inspector=page.locator('#inspector'),global=inspector.locator('[data-property="global-linetype-scale"]');await expect(global).toHaveValue('1')
  const revision=Number((await page.locator('#revision').textContent()).replace(/\D/g,''));await global.fill('2');await inspector.getByRole('button',{name:/Apply properties|应用特性/}).click();await expect(page.locator('#revision')).toHaveText(`REV ${revision+1}`);await expect(global).toHaveValue('2')
  await page.locator('#canvas').click({position:{x:20,y:20}});await page.keyboard.press('Control+a');await expect(page.locator('#selection-count')).not.toHaveText('0 selected')
  const scale=inspector.locator('[data-property="linetype-scale"]');await scale.fill('1.75');await inspector.getByRole('button',{name:/Apply properties|应用特性/}).click();await expect(scale).toHaveValue('1.75')
  await page.locator('#undo').click();await page.locator('#redo').click();await expect(scale).toHaveValue('1.75')
  await page.locator('#canvas').click({position:{x:20,y:20}});await page.keyboard.press('Escape');await page.locator('#command-input').fill('LTSCALE 3');await page.locator('#run-command').click()
  await expect(inspector.locator('[data-property="global-linetype-scale"]')).toHaveValue('3')
})
