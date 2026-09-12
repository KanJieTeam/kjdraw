import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'

async function sourceFile() {
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'block-authoring-ui',units:'millimeter'})
  await drawing.transact('source',tx=>{
    tx.createEntity('LINE',{start:[0,0],end:[30,0]},{id:'source-line'})
    tx.createEntity('CIRCLE',{center:[15,10],radius:4},{id:'source-circle'})
  })
  return Buffer.from(await sdk.writeDocument(drawing,{format:'KJD'}))
}

async function nestedSourceFile() {
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'nested-block-ui',units:'millimeter'})
  const line=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0],end:[20,0]}},{document:drawing})
  const inner=await sdk.executeCommand('BLOCKCREATE',{name:'INNER_UI',id:line.id,basePoint:[0,0],attributeDefinitions:[{tag:'MARK',defaultValue:'A-001',position:[2,2],height:2}]},{document:drawing})
  await sdk.executeCommand('BLOCKINSTANCEUPDATE',{id:inner.insert.id,attributeValues:{MARK:'A-009'}},{document:drawing})
  const circle=await sdk.executeCommand('CREATE',{type:'CIRCLE',payload:{center:[10,8],radius:3}},{document:drawing})
  await sdk.executeCommand('BLOCKCREATE',{name:'OUTER_UI',ids:[inner.insert.id,circle.id],basePoint:[0,0]},{document:drawing})
  return Buffer.from(await sdk.writeDocument(drawing,{format:'KJD'}))
}

test('Workbench creates an attributed native block and edits its instance value',async({page})=>{
  await page.goto('/')
  await page.evaluate(async()=>{
    document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1100px;height:720px';document.body.append(host)
    const [{createKJDrawSDK},{mountKJDrawWorkbench}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'block-create-workbench',units:'millimeter'})
    await drawing.transact('source',tx=>{tx.createEntity('LINE',{start:[0,0],end:[30,0]},{id:'line'});tx.createEntity('CIRCLE',{center:[15,10],radius:4},{id:'circle'})})
    const workbench=mountKJDrawWorkbench(host,{sdk,document:drawing,locale:'en'});await workbench.ready;await sdk.executeCommand('SELECT',{ids:['line','circle']},{document:drawing});window.__blockAuthoring={sdk,drawing,workbench}
  })
  const revision=await page.evaluate(()=>window.__blockAuthoring.drawing.revision)
  await page.locator('[data-action=block-create]').click();await expect(page.locator('[data-block-create-dialog]')).toBeVisible();await page.keyboard.press('Escape')
  expect(await page.evaluate(()=>window.__blockAuthoring.drawing.revision)).toBe(revision)
  await page.locator('[data-action=block-create]').click();await page.locator('[data-block-name]').fill('PUMP_TAGGED');await page.locator('[data-block-attributes]').fill('MARK=P-001');await page.locator('[data-block-apply]').click()
  await expect(page.locator('[data-block-create-dialog]')).toHaveCount(0)
  await expect(page.locator('[data-inspector]')).toContainText('Instance attribute values')
  const attribute=page.locator('[data-block-attribute=MARK]');await expect(attribute).toHaveValue('P-001');await attribute.fill('P-009');await page.locator('[data-inspector] button.apply').click()
  await expect.poll(()=>page.evaluate(()=>{const d=window.__blockAuthoring.drawing,i=d.listEntities({type:'INSERT'})[0];return d.getObject(i.payload.attributeIds[0]).payload.text})).toBe('P-009')
})

test('Playground exposes selection-to-block and explicit instance attribute editing',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('kjdraw.language','en'));await page.goto('/');await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:'source.kjd',mimeType:'application/json',buffer:await sourceFile()});await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await page.keyboard.press('Control+a');await page.getByRole('button',{name:'DRAW',exact:true}).click();await page.locator('#block-create').click()
  await expect(page.locator('#dialog-description')).toContainText('Selected INSERTs remain nested');await page.locator('#dialog-fields [name=name]').fill('FRAME_TAGGED');await page.locator('#dialog-fields [name=attributes]').fill('MARK=F-001');await page.locator('#dialog-submit').click()
  await expect(page.locator('#status')).toContainText('BLOCKCREATE committed');await expect(page.locator('#inspector')).toContainText('Instance attribute values')
  const attribute=page.locator('#inspector [data-block-attribute=MARK]');await expect(attribute).toHaveValue('F-001');await attribute.fill('F-007');await page.getByRole('button',{name:'Apply properties',exact:true}).click();await expect(page.locator('#status')).toContainText('BLOCKINSTANCEUPDATE committed')
})

test('Workbench and Playground explicitly transform a nested attributed INSERT in shared-definition scope',async({page})=>{
  await page.goto('/')
  await page.evaluate(async()=>{
    document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1100px;height:720px';document.body.append(host)
    const [{createKJDrawSDK},{mountKJDrawWorkbench}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'nested-workbench-ui',units:'millimeter'})
    const line=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0],end:[20,0]}},{document:drawing})
    const inner=await sdk.executeCommand('BLOCKCREATE',{name:'INNER_UI',id:line.id,basePoint:[0,0],attributeDefinitions:[{tag:'MARK',defaultValue:'A-001',position:[2,2],height:2}]},{document:drawing})
    await sdk.executeCommand('BLOCKINSTANCEUPDATE',{id:inner.insert.id,attributeValues:{MARK:'A-009'}},{document:drawing})
    const circle=await sdk.executeCommand('CREATE',{type:'CIRCLE',payload:{center:[10,8],radius:3}},{document:drawing})
    const outer=await sdk.executeCommand('BLOCKCREATE',{name:'OUTER_UI',ids:[inner.insert.id,circle.id],basePoint:[0,0]},{document:drawing})
    const workbench=mountKJDrawWorkbench(host,{sdk,document:drawing,locale:'en'});await workbench.ready;await sdk.executeCommand('SELECT',{id:outer.insert.id},{document:drawing});window.__nestedBlock={drawing,outer}
  })
  await page.locator('select[data-block-scope]').selectOption('definition')
  const workbenchMember=page.locator('select[data-block-member]'),workbenchNested=await workbenchMember.locator('option').filter({hasText:'INSERT'}).getAttribute('value');await workbenchMember.selectOption(workbenchNested)
  await page.locator('[data-block-member-transform=position]').fill('5, 6');await page.locator('[data-block-member-transform=scale]').fill('2');await page.locator('[data-block-member-transform=rotation]').fill('90');await page.locator('[data-inspector] button.apply').click()
  await expect.poll(()=>page.evaluate(()=>{const d=window.__nestedBlock.drawing,b=d.getObject(window.__nestedBlock.outer.block.id),i=(b.payload.entityIds??[]).map(id=>d.getObject(id)).find(x=>x?.type==='INSERT'),a=d.getObject(i.payload.attributeIds[0]);return {position:i.payload.position,scale:i.payload.scale,rotation:i.payload.rotation,attribute:a.payload.position,text:a.payload.text}})).toEqual({position:[5,6,0],scale:[2,2,2],rotation:Math.PI/2,attribute:[1.0000000000000004,10,0],text:'A-009'})

  await page.addInitScript(()=>localStorage.setItem('kjdraw.language','en'));await page.goto('/');await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:'nested.kjd',mimeType:'application/json',buffer:await nestedSourceFile()});await page.keyboard.press('Control+a')
  await page.locator('#inspector select[data-block-scope]').selectOption('definition');const playgroundMember=page.locator('#inspector select[data-block-member]'),playgroundNested=await playgroundMember.locator('option').filter({hasText:'INSERT'}).getAttribute('value');await playgroundMember.selectOption(playgroundNested)
  await page.locator('#inspector [data-block-member-transform=position]').fill('5, 6');await page.locator('#inspector [data-block-member-transform=scale]').fill('2');await page.locator('#inspector [data-block-member-transform=rotation]').fill('90');await page.getByRole('button',{name:'Apply properties',exact:true}).click();await expect(page.locator('#status')).toContainText('BLOCKDEFINITIONUPDATE committed')
  await page.locator('#inspector select[data-block-scope]').selectOption('definition');await page.locator('#inspector select[data-block-member]').selectOption(playgroundNested);await expect(page.locator('#inspector [data-block-member-transform=position]')).toHaveValue('5, 6');await expect(page.locator('#inspector [data-block-member-transform=scale]')).toHaveValue('2');await expect(page.locator('#inspector [data-block-member-transform=rotation]')).toHaveValue('90')
})
