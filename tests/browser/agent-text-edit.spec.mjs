import { test, expect } from '@playwright/test'

test('chat reviews exact old/new engineering notes, commits once, then saves and undoes',async({page})=>{
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.evaluate(async()=>{
    const {createAgentChat}=await import('/apps/playground/agent-chat.js'),{createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/sdk.js')
    const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
    await document.transact('Notes',tx=>{
      tx.createEntity('TEXT',{position:[0,0,0],height:3,text:'REV A'},{id:'revision'})
      tx.createEntity('MTEXT',{position:[0,10,0],height:3,width:80,text:'数量 1\\P材料 6061-T6'},{id:'notes'})
      tx.createEntity('CIRCLE',{center:[20,20,0],radius:5},{id:'hole'})
    })
    const container=window.document.createElement('section');container.id='text-chat';container.style.cssText='position:fixed;inset:0 auto 0 0;width:440px;z-index:10000;background:white;display:flex;flex-direction:column';window.document.body.append(container)
    const h=window.textHarness={sdk,document,calls:0,saved:null}
    const chat=createAgentChat(container,{locale:()=> 'zh',getContext:()=>({sdk,document}),getSelected:()=>[],onBeforeRun(){},onPreview(){},runMutation:operation=>operation(),onApplied(){chat.syncContext()},async onSave(){const bytes=await sdk.writeDocument(document,{format:'KJD'});h.saved=await createKJDrawSDK().readDocument(bytes,{format:'KJD'})}})
    chat.setModel({createConversation:options=>({next:async input=>{
      h.calls++
      if(input.kind==='prompt')return {text:'',calls:[{id:'read',name:'cad_query_drawing',arguments:{expectedRevision:document.revision,filters:{types:['TEXT','MTEXT']},offset:0,layerOffset:0,limit:10,maxLayers:10,maxBytes:16384}}]}
      const read=input.results.find(result=>result.name==='cad_query_drawing'&&result.result.ok)
      if(!read)throw new Error('Real drawing query failed')
      const changes=read.result.value.entities.map(entity=>({id:entity.id,expectedText:entity.geometry.text,text:entity.id==='revision'?'REV B':'数量 4\\P材料 6061-T6'}))
      return {text:'供审阅。',calls:[{id:'edit',name:'cad_propose_text_edit',arguments:{expectedRevision:read.result.value.revision,units:'millimeter',changes}}]}
    }})})
  })
  const chat=page.locator('#text-chat')
  await chat.locator('#chat-input').fill('把版本号从 A 改成 B，数量从 1 改成 4，材料、位置和孔不变。')
  await chat.locator('#chat-send').click()
  await expect(chat.locator('.chat-text-change')).toHaveCount(2)
  await expect(chat.locator('[data-entity-id="revision"] .chat-text-before')).toHaveText('REV A')
  await expect(chat.locator('[data-entity-id="revision"] .chat-text-after')).toHaveText('REV B')
  expect(await page.evaluate(()=>window.textHarness.document.getObject('revision').payload.text)).toBe('REV A')
  await chat.getByRole('button',{name:'应用修改',exact:true}).click()
  await expect(chat.locator('.chat-proposal-state')).toContainText('修改已应用')
  expect(await page.evaluate(()=>{const h=window.textHarness;return {revision:h.document.revision,text:h.document.getObject('revision').payload.text,radius:h.document.getObject('hole').payload.radius,calls:h.calls}})).toEqual({revision:2,text:'REV B',radius:5,calls:2})
  await chat.getByRole('button',{name:'保存工程',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.textHarness.saved?.getObject('notes').payload.text)).toBe('数量 4\\P材料 6061-T6')
  await chat.getByRole('button',{name:'撤销这次修改',exact:true}).click()
  await expect(chat.locator('.chat-proposal-state')).toContainText('已撤销')
  expect(await page.evaluate(()=>window.textHarness.document.getObject('notes').payload.text)).toBe('数量 1\\P材料 6061-T6')
})
