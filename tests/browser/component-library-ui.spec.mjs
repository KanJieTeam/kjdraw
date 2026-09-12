import { expect, test } from '@playwright/test'

test('Workbench searches licensed components, cancels without history and inserts one native block',async({page})=>{
  await page.goto('/')
  await page.evaluate(async()=>{
    document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1100px;height:720px';document.body.append(host)
    const [{createKJDrawSDK},{mountKJDrawWorkbench}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'component-workbench',units:'millimeter'}),workbench=mountKJDrawWorkbench(host,{sdk,document:drawing,locale:'en'});await workbench.ready
    window.__componentUI={sdk,drawing,workbench}
  })
  const revision=await page.evaluate(()=>window.__componentUI.drawing.revision)
  await page.locator('[data-action=component-library]').click();await expect(page.locator('[data-component-dialog]')).toBeVisible()
  await expect(page.locator('[data-component-license]')).toContainText('Apache-2.0');await page.keyboard.press('Escape')
  await expect(page.locator('[data-component-dialog]')).toHaveCount(0);expect(await page.evaluate(()=>window.__componentUI.drawing.revision)).toBe(revision)
  await page.locator('[data-action=component-library]').click();await page.locator('[data-component-query]').fill('bearing');await page.locator('[data-component-search]').click()
  await expect(page.locator('[data-component-results]')).toHaveValue('org.kjdraw.mechanical.four-hole-flange')
  await page.locator('[data-component-position]').fill('120, 80');await page.locator('[data-component-scale]').fill('1.5');await page.locator('[data-component-rotation]').fill('30');await page.locator('[data-component-insert]').click()
  await expect(page.locator('[data-component-dialog]')).toHaveCount(0)
  await expect.poll(()=>page.evaluate(()=>{const d=window.__componentUI.drawing,i=d.listEntities({type:'INSERT'})[0],b=d.getObject(i.payload.blockRecordId);return{i:i.payload.position,s:i.payload.scale,r:Math.round(i.payload.rotation*180/Math.PI),name:b.name,members:d.listEntities({ownerId:b.id}).length,license:b.payload.component.license.spdx}})).toEqual({i:[120,80,0],s:[1.5,1.5,1.5],r:30,name:expect.stringContaining('KJCOMP_'),members:6,license:'Apache-2.0'})
})

test('Playground exposes real component search, license review and insertion',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('kjdraw.language','en'));await page.goto('/');await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  const before=Number((await page.locator('#revision').textContent()).replace(/\D/g,''))
  await page.getByRole('button',{name:'DRAW',exact:true}).click();await page.locator('#component-library').click();await expect(page.locator('#dialog-description')).toContainText('License and source')
  await page.locator('#dialog-fields [name=query]').fill('socket');await page.locator('#dialog-submit').click()
  await expect(page.locator('#dialog-fields [name=componentId]')).toHaveValue('org.kjdraw.electrical.duplex-receptacle');await page.locator('#dialog-submit').click()
  await expect(page.locator('#dialog-description')).toContainText('Apache-2.0');await expect(page.locator('#dialog-description')).toContainText('KJDraw original component catalog')
  await page.locator('#dialog-fields [name=position]').fill('250, 140');await page.locator('#dialog-submit').click()
  await expect(page.locator('#status')).toContainText('COMPONENTINSERT committed');await expect.poll(async()=>Number((await page.locator('#revision').textContent()).replace(/\D/g,''))).toBe(before+1)
  await expect.poll(()=>page.evaluate(()=>{const insert=window.document.querySelector('.workbench')&&document.querySelector('#entity-count').textContent;return insert})).toContain('entities')
})
