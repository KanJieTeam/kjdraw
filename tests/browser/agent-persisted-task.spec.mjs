import { test, expect } from '@playwright/test'

async function setup(page, mode = 'valid') {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.evaluate(async mode => {
    const { createAgentChat } = await import('/apps/playground/agent-chat.js')
    const { createKJDrawSDK, KJAgentToolSession, createAgentTask, transitionAgentTask, readAgentTasks, createAgentTaskToolBinding } = await import('/packages/kjdraw-sdk/src/index.js')
    const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'})
    await document.transact('Drawing',tx=>{
      tx.createEntity('LINE',{start:[0,0,0],end:[10,0,0]},{id:'edge'})
      tx.createEntity('LINE',{start:[15,0,0],end:[15,10,0]},{id:'anchor'})
      tx.createEntity('LINE',{start:[100,0,0],end:[110,0,0]},{id:'outside'})
    })
    const session=new KJAgentToolSession(sdk,document),actor={kind:'host',id:'fixture-author'},at='2026-09-12T00:00:00.000Z'
    const names=['cad_check_geometry',mode==='forbidden'?'cad_propose_lines':'cad_propose_move']
    await document.transact('Task',tx=>createAgentTask(document,tx,{
      id:'task-edge',expectedRevision:document.revision,title:'调整定位边',goal:'只将 edge 向右移动 5 mm，保留其余对象。',entityIds:['edge','anchor'],at,actor,
      definition:{requirements:[{id:'clearance',description:'定位边与基准起点相距 10 mm',check:{toolName:'cad_check_geometry',assertion:{path:'passed',operator:'is_true',expected:true},geometryCheck:{id:'clearance',kind:'point-distance',from:{objectId:'edge',feature:'start'},to:{objectId:'anchor',feature:'start'},expected:10,tolerance:0}}}],steps:[{id:'move',title:'移动并验收',requirementIds:['clearance']}],tools:createAgentTaskToolBinding(session.definitions,names),capabilities:[]},
    }))
    const draft=readAgentTasks(document)[0]
    await document.transact('Ready',tx=>transitionAgentTask(document,tx,{id:draft.id,expectedRevision:document.revision,expectedTaskVersion:draft.taskVersion,expectedStatus:'draft',to:'ready',at,actor,reason:'Fixture host reviewed requirements'}))
    const container=window.document.createElement('section');container.id='task-chat'
    container.style.cssText='position:fixed;inset:0 auto 0 0;width:540px;z-index:10000;background:white;display:flex;flex-direction:column;overflow:auto'
    window.document.body.append(container)
    const harness=window.taskHarness={sdk,document,requests:0,readAgentTasks,saved:null,initial:document.serialize()}
    const chat=createAgentChat(container,{locale:()=> 'zh',getContext:()=>({sdk,document}),getSelected:()=>[],onPreview(){},onBeforeRun(){},runMutation:operation=>operation(),onApplied(){chat.syncContext()},async onSave(){const {createKjpPackage,openKjpPackage}=await import('/packages/kjdraw-sdk/src/project-package.js');const bytes=await createKjpPackage({projectId:'task-project',drawings:{[document.id]:document},activeDrawing:document.id,createdAt:at,modifiedAt:new Date().toISOString()});harness.saved=(await openKjpPackage(bytes)).activeDocument}})
    harness.chat=chat
    chat.setModel({createConversation:options=>{
      harness.context=options
      return {next:async input=>{
        harness.requests++
        // The fixture receives identities/revision through the public model
        // boundary, not by inspecting the host document behind the model's back.
        const task=JSON.parse(input.text.slice(input.text.indexOf('\n')+1))
        harness.promptSnapshot=task
        return {text:'供用户审阅。',calls:[{id:'move',name:'cad_propose_move',arguments:{expectedRevision:task.revision,units:task.units,ids:[mode==='outside'?'outside':task.scope.members.find(member=>member.id==='edge').id],dx:mode==='bad-check'?6:5,dy:0}}]}
      }}
    }})
  },mode)
  const chat=page.locator('#task-chat')
  await chat.locator('.chat-persisted-tasks > summary').click()
  return chat
}

test('explicit saved task executes, verifies atomically, saves/reopens and undoes with its receipt',async({page})=>{
  const chat=await setup(page)
  await expect(chat.locator('#chat-task-select')).toHaveValue('')
  await expect(chat.locator('#chat-task-run')).toBeDisabled()
  expect(await page.evaluate(()=>window.taskHarness.requests)).toBe(0)
  await chat.locator('#chat-task-select').selectOption('task-edge')
  await expect(chat.locator('.chat-task-goal')).toContainText('向右移动 5 mm')
  await expect(chat.locator('.chat-task-requirement')).toContainText('10 mm')
  await chat.locator('#chat-task-run').click()
  const apply=chat.getByRole('button',{name:'应用修改',exact:true})
  await expect(apply).toBeVisible()
  const before=await page.evaluate(()=>{const h=window.taskHarness;return {revision:h.document.revision,start:h.document.getObject('edge').payload.start,status:h.readAgentTasks(h.document)[0].status,requests:h.requests}})
  expect(before).toEqual({revision:4,start:[0,0,0],status:'running',requests:1})
  expect(await page.evaluate(()=>window.taskHarness.promptSnapshot.scope.members.map(member=>member.id))).toEqual(['edge','anchor'])
  await apply.click()
  await expect(chat.locator('.chat-task-receipt')).toContainText('task-edge')
  await expect(chat.locator('.chat-validation')).toHaveAttribute('data-passed','true')
  await expect(chat.locator('[data-check-id="clearance"] [data-field="actual"]')).toHaveText('10')
  await chat.getByRole('button',{name:'保存工程',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>Boolean(window.taskHarness.saved))).toBe(true)
  const result=await page.evaluate(()=>{
    const h=window.taskHarness,task=h.readAgentTasks(h.document)[0],saved=h.readAgentTasks(h.saved)[0]
    return {revision:h.document.revision,start:h.document.getObject('edge').payload.start,outside:h.document.getObject('outside').payload.start,status:task.status,checks:task.receipts[0].checks,savedEqual:JSON.stringify(saved)===JSON.stringify(task)}
  })
  expect(result).toMatchObject({revision:5,start:[5,0,0],outside:[100,0,0],status:'completed',savedEqual:true,checks:[{id:'clearance',actual:10,passed:true}]})
  await chat.getByRole('button',{name:'撤销这次修改',exact:true}).click()
  await expect(chat.locator('.chat-proposal-state')).toHaveText('已撤销这次修改。')
  expect(await page.evaluate(()=>{const h=window.taskHarness;return {status:h.readAgentTasks(h.document)[0].status,start:h.document.getObject('edge').payload.start,receipts:h.readAgentTasks(h.document)[0].receipts.length}})).toEqual({status:'running',start:[0,0,0],receipts:0})
  await page.evaluate(async()=>{await window.taskHarness.document.redo();window.taskHarness.chat.syncContext()})
  expect(await page.evaluate(()=>window.taskHarness.readAgentTasks(window.taskHarness.document)[0].status)).toBe('completed')
})

for(const mode of ['bad-check','outside'])test(`saved task ${mode} cannot produce a receipt or change geometry`,async({page})=>{
  const chat=await setup(page,mode)
  await chat.locator('#chat-task-select').selectOption('task-edge')
  await chat.locator('#chat-task-run').click()
  await expect(chat.getByRole('button',{name:'应用修改',exact:true})).toBeVisible()
  const before=await page.evaluate(()=>window.taskHarness.document.serialize())
  await chat.getByRole('button',{name:'应用修改',exact:true}).click()
  await expect(chat.locator('.chat-proposal-state')).toContainText('任务审批未完成')
  await expect(chat.locator('.chat-task-receipt')).toHaveCount(0)
  expect(await page.evaluate(()=>window.taskHarness.document.serialize())).toBe(before)
})

test('imported task cannot widen host tools, and new message is never silently ignored',async({page})=>{
  const chat=await setup(page,'forbidden')
  await chat.locator('#chat-task-select').selectOption('task-edge')
  await chat.locator('#chat-input').fill('这是新要求，不得被忽略')
  await chat.locator('#chat-task-run').click()
  await expect(chat.locator('.chat-task-error')).toContainText('先发送或清空新消息')
  await expect(chat.locator('#chat-input')).toHaveValue('这是新要求，不得被忽略')
  await chat.locator('#chat-input').fill('')
  await chat.locator('#chat-task-run').click()
  await expect(chat.locator('.chat-message-body').last()).toContainText('未发送模型请求')
  expect(await page.evaluate(()=>{const h=window.taskHarness;return {requests:h.requests,unchanged:h.document.serialize()===h.initial}})).toEqual({requests:0,unchanged:true})
})

test('drawing changes clear the explicit task selection and stale tasks fail before model contact',async({page})=>{
  const chat=await setup(page)
  await chat.locator('#chat-task-select').selectOption('task-edge')
  await page.evaluate(async()=>{const h=window.taskHarness;await h.document.transact('Manual edit',tx=>tx.updateObject('edge',{payload:{start:[1,0,0],end:[11,0,0]}}));h.chat.syncContext()})
  await expect(chat.locator('#chat-task-select')).toHaveValue('')
  await expect(chat.locator('#chat-task-run')).toBeDisabled()
  await chat.locator('#chat-task-select').selectOption('task-edge')
  const before=await page.evaluate(()=>window.taskHarness.document.serialize())
  await chat.locator('#chat-task-run').click()
  await expect(chat.locator('.chat-message-body').last()).toContainText('未发送模型请求')
  expect(await page.evaluate(()=>window.taskHarness.requests)).toBe(0)
  expect(await page.evaluate(()=>window.taskHarness.document.serialize())).toBe(before)
})
