import {test,expect} from '@playwright/test'

for(const mode of ['repeated-errors','incomplete-batch'])test(`chat ${mode} stops with a clear diagnostic and no approval`,async({page})=>{
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.evaluate(async mode=>{
    const {createAgentChat}=await import('/apps/playground/agent-chat.js')
    const {createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/index.js')
    const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
    const container=window.document.createElement('section');container.id='repair-chat'
    container.style.cssText='position:fixed;inset:0 auto auto 0;width:440px;height:650px;z-index:10000;background:white;display:flex;flex-direction:column'
    window.document.body.append(container)
    window.repairHarness={document,requests:0}
    const chat=createAgentChat(container,{locale:()=> 'zh',getContext:()=>({sdk,document}),getSelected:()=>[],onPreview(){},onBeforeRun(){},runMutation:operation=>operation(),onApplied(){},onSave(){}})
    chat.setModel({createConversation:()=>({next:async()=>{
      const attempt=++window.repairHarness.requests
      const call=(suffix,radius)=>({id:`${attempt}-${suffix}`,name:'cad_propose_drawing_pattern',arguments:{expectedRevision:0,units:'millimeter',lines:[],circles:[[0,0,radius]],arcs:[],polylines:[],arrays:[]}})
      return {text:'所有修改都已完成。',calls:mode==='repeated-errors'?[call('bad',-1)]:[call('good',2),call('bad',-1)]}
    }})})
  },mode)
  const chat=page.locator('#repair-chat')
  await chat.locator('#chat-input').fill('请根据要求绘制两个构件。')
  await chat.locator('#chat-send').click()
  await expect(chat.locator('.chat-message-body').last()).toContainText(mode==='repeated-errors'?'已达到 CAD 工具纠错上限':'所有待批提案已拒绝')
  await expect(chat.locator('#chat-send')).toBeEnabled()
  await expect(chat.getByRole('button',{name:'应用修改',exact:true})).toHaveCount(0)
  const result=await page.evaluate(()=>({requests:window.repairHarness.requests,revision:window.repairHarness.document.revision,count:window.repairHarness.document.listEntities().length}))
  expect(result).toEqual({requests:mode==='repeated-errors'?3:1,revision:0,count:0})
  await expect(chat).not.toContainText('所有修改都已完成。')
})
