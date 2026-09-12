import { expect,test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'

async function playgroundFile(){
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'block-ui',units:'millimeter'})
  await drawing.transact('block UI fixture',tx=>{
    tx.upsertTableRecord('layers',{id:'target-layer',name:'TARGET',payload:{visible:true}})
    const block=tx.upsertTableRecord('blockRecords',{id:'ui-block',name:'UI PART',payload:{entityIds:[],isSpace:false,basePoint:[0,0,0]}})
    tx.createEntity('LINE',{start:[0,0,0],end:[20,0,0]},{id:'ui-line',ownerId:block.id})
    tx.createEntity('INSERT',{blockRecordId:block.id,position:[20,20,0],scale:[1,1,1],rotation:0},{id:'ui-instance'})
  })
  return Buffer.from(await sdk.writeDocument(drawing,{format:'KJD'}))
}

test('Workbench makes instance and shared-definition layer edits explicit',async({page})=>{
  await page.goto('/')
  await page.evaluate(async()=>{
    document.body.replaceChildren()
    const host=document.createElement('div');host.id='host';host.style.cssText='width:1100px;height:720px';document.body.append(host)
    const [{createKJDrawSDK},{mountKJDrawWorkbench}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'workbench-block-ui',units:'millimeter'})
    await drawing.transact('fixture',tx=>{
      tx.upsertTableRecord('layers',{id:'target-layer',name:'TARGET',payload:{visible:true}})
      const block=tx.upsertTableRecord('blockRecords',{id:'ui-block',name:'UI PART',payload:{entityIds:[],isSpace:false,basePoint:[0,0,0]}})
      tx.createEntity('LINE',{start:[0,0,0],end:[20,0,0]},{id:'ui-line',ownerId:block.id})
      tx.createEntity('INSERT',{blockRecordId:block.id,position:[20,20,0]},{id:'ui-instance'})
      tx.createEntity('INSERT',{blockRecordId:block.id,position:[60,20,0]},{id:'other-instance'})
    })
    const workbench=mountKJDrawWorkbench(host,{sdk,document:drawing,locale:'en'});await workbench.ready
    await sdk.executeCommand('SELECT',{id:'ui-instance'},{document:drawing})
    window.__blockUI={sdk,drawing,workbench}
  })
  const inspector=page.locator('[data-inspector]')
  await expect(inspector).toContainText('UI PART')
  await expect(inspector).toContainText('Instance changes affect this occurrence')
  const selects=inspector.locator('select')
  await expect(selects).toHaveCount(3)
  await selects.nth(0).selectOption('definition')
  await expect(selects.nth(1)).toBeVisible()
  await selects.nth(2).selectOption('target-layer')
  await inspector.locator('button.apply').click()
  await expect.poll(()=>page.evaluate(()=>window.__blockUI.drawing.getObject('ui-line').payload.layerId)).toBe('target-layer')
  expect(await page.evaluate(()=>[window.__blockUI.drawing.getObject('ui-instance').payload.layerId,window.__blockUI.drawing.getObject('other-instance').payload.layerId])).not.toContain('target-layer')
  await page.evaluate(()=>window.__blockUI.sdk.executeCommand('UNDO',{}, {document:window.__blockUI.drawing}))
  await selects.nth(0).selectOption('instance')
  await selects.nth(2).selectOption('target-layer')
  await inspector.locator('button.apply').click()
  await expect.poll(()=>page.evaluate(()=>window.__blockUI.drawing.getObject('ui-instance').payload.layerId)).toBe('target-layer')
  expect(await page.evaluate(()=>window.__blockUI.drawing.getObject('ui-line').payload.layerId)).not.toBe('target-layer')
})

test('Playground exposes the same default instance scope and explicit definition scope',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('kjdraw.language','en'))
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:'block-ui.kjd',mimeType:'application/json',buffer:await playgroundFile()})
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await page.keyboard.press('Control+a')
  const editor=page.locator('#inspector .property-editor'),scope=editor.locator('select').nth(0),member=editor.locator('select').nth(1),layer=editor.locator('select').nth(2)
  await expect(scope).toHaveValue('instance')
  await expect(page.locator('#inspector')).toContainText('Instance changes affect this occurrence')
  await scope.selectOption('definition');await expect(member).toBeVisible();await layer.selectOption('target-layer')
  await editor.getByRole('button',{name:'Apply properties',exact:true}).click()
  await expect(page.locator('#status')).toContainText('BLOCKDEFINITIONUPDATE committed')
  await page.locator('#undo').click()
  await scope.selectOption('instance');await layer.selectOption('target-layer')
  await editor.getByRole('button',{name:'Apply properties',exact:true}).click()
  await expect(page.locator('#status')).toContainText('BLOCKINSTANCEUPDATE committed')
})
