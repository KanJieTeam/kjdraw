import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, openKjpPackage, readDesignRelations } from '../../packages/kjdraw-sdk/src/index.js'

test('chat parameter review shows exact changes even without geometry changes and safely saves and undoes relations', async ({ page }) => {
  const sdk=createKJDrawSDK(), document=sdk.createDocument({units:'millimeter'})
  await document.transact('Line',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[10,0,0]},{id:'line'}))
  const design=await sdk.executeCommand('DESIGNCREATE',{name:'<img src=x onerror=alert(1)>',definition:{
    parameters:[{name:'width',value:10,min:1,max:100},{name:'allowance',value:2,min:1,max:100}],derived:[],requirements:[],
    bindings:[{entityId:'line',path:'end.0',expression:{constant:0,terms:[{parameter:'width',coefficient:1}]}}],
  }})
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:'parameters.kjd',mimeType:'application/json',buffer:Buffer.from(document.serialize())})
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  await page.locator('#agent-tab').click()
  await page.getByRole('button',{name:'Connect model',exact:true}).click()
  await page.locator('#chat-endpoint').fill('/api/model')
  await page.locator('#chat-model').fill('browser-fixture')
  await page.locator('#chat-protocol').selectOption('chat-completions')
  await page.getByRole('button',{name:'Use this connection',exact:true}).click()
  await page.route('**/api/model',route=>route.fulfill({json:{choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{
    id:'parameters',type:'function',function:{name:'cad_propose_design_update',arguments:JSON.stringify({expectedRevision:document.revision,units:'millimeter',id:design.id,changes:[{name:'allowance',value:3}]})},
  }]}}]}}))
  await page.locator('#chat-input').fill('Change the stored allowance to 3.')
  await page.locator('#chat-send').click()
  await expect(page.locator('.chat-proposal-summary')).toContainText('0 → 0')
  await expect(page.locator('.chat-design-parameters [data-parameter="allowance"]')).toHaveText('allowance: 2 → 3')
  await expect(page.locator('.chat-design-parameters')).toContainText(design.name)
  await expect(page.locator('.chat-design-parameters img')).toHaveCount(0)
  await page.getByRole('button',{name:'Apply changes',exact:true}).click()
  let downloadEvent=page.waitForEvent('download')
  await page.getByRole('button',{name:'Save project',exact:true}).click()
  let download=await downloadEvent, reopened=await openKjpPackage(await readFile(await download.path()))
  expect(readDesignRelations(reopened.activeDocument)[0].values.allowance).toBe(3)
  expect(reopened.activeDocument.getObject('line').handle).toBe(document.getObject('line').handle)
  await page.getByRole('button',{name:'Undo this change',exact:true}).click()
  downloadEvent=page.waitForEvent('download')
  await page.getByRole('button',{name:'Save project',exact:true}).click()
  download=await downloadEvent;reopened=await openKjpPackage(await readFile(await download.path()))
  expect(readDesignRelations(reopened.activeDocument)[0].values.allowance).toBe(2)
})
