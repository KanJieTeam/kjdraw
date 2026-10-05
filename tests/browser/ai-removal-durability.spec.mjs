import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { compileGeologyColumn } from '../../packages/kjdraw-sdk/src/geology-engineering.js'
import { registerGeologyDrawingRecipe } from '../../packages/kjdraw-sdk/src/geology-drawing-update.js'

// Public source/native SDK + real native IndexedDB failures/completion receipts.
// The model HTTP protocol fixture is not real-provider/model-quality evidence.
const endpoint = 'https://public-removal-durability.invalid/chat/completions'
async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units:'millimeter' })
  const source = { kind:'column', input:{ expectedRevision:0, locale:'en', verticalScaleDenominator:200,
    hole:{ id:'PUBLIC-DURABLE-HOLE', collarElevation:106, depth:10, strata:[
      { intervalId:'PUBLIC-DURABLE-L1', code:'1', name:'Public fill', lithology:'fill', top:0, bottom:3 },
      { intervalId:'PUBLIC-DURABLE-L2', code:'2', name:'Public clay', lithology:'clay', top:3, bottom:10 },
    ] } } }
  await sdk.executeCommand('CREATEBATCH', structuredClone(compileGeologyColumn(source.input).commandArgs), { document })
  const recipe = await registerGeologyDrawingRecipe(document, source, { expectedRevision:document.revision })
  return { kjd:await sdk.writeDocument(document,{format:'KJD'}), drawingId:recipe.drawingId }
}
async function saved(page) { return page.evaluate(async()=>(await import('/apps/playground/ai/local-history.js')).loadLocalHistory()) }
async function activeRecord(page) { const record=await saved(page); return record.sessions.find(session=>session.id===record.activeId) }
async function importDrawing(page, f, name) {
  await page.getByTestId('drawing-file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(f.kjd)})
  await expect(page.locator('#drawing-name')).toHaveText(name)
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect.poll(async()=>(await activeRecord(page))?.source?.name).toBe(name)
}
async function instrumentStorage(page) {
  await page.addInitScript(()=>{
    const gate=window.__removalStorage={abort:false,hold:false,holdTarget:null,completions:[],writes:[]}
    const native=IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction=function(...args){
      const transaction=native.apply(this,args)
      if(this.name!=='kjdraw-ai-local'||transaction.mode!=='readwrite')return transaction
      let owner=transaction,descriptor
      while(owner&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(owner,'oncomplete');owner=Object.getPrototypeOf(owner)}
      Object.defineProperty(transaction,'oncomplete',{configurable:true,get(){return descriptor.get.call(transaction)},
        set(handler){descriptor.set.call(transaction,event=>{
          const deliver=()=>handler.call(transaction,event)
          if(gate.hold&&transaction.__removalCandidate)gate.completions.push(deliver);else deliver()
        })}})
      if(gate.abort)queueMicrotask(()=>{try{transaction.abort()}catch{}})
      return transaction
    }
    const put=IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put=function(record,...rest){
      if(this.transaction.db.name==='kjdraw-ai-local'&&record?.sessions){
        gate.writes.push({activeId:record.activeId,ids:record.sessions.map(session=>session.id),sources:record.sessions.map(session=>session.source?.name??null)})
        this.transaction.__removalCandidate=gate.holdTarget==='blank'
          ?record.sessions.some(session=>session.id===record.activeId&&session.source===null&&session.drawingRemoved===true)
          :typeof gate.holdTarget==='string'&&!record.sessions.some(session=>session.id===gate.holdTarget)
      }
      return put.call(this,record,...rest)
    }
  })
}
async function release(page) { await page.evaluate(()=>{const gate=window.__removalStorage;gate.hold=false;gate.completions.splice(0).forEach(deliver=>deliver())}) }
async function approveSourceChange(page,f) {
  await page.route(endpoint,route=>{
    const body=route.request().postDataJSON(),last=body.messages.findLast(message=>message.role==='tool')
    let name,args
    if(!last){name='cad_read_geology_source';args={expectedRevision:Number(/revision (\d+);/.exec(body.messages.find(message=>message.role==='user').content)[1]),drawingId:f.drawingId,maxBytes:262144}}
    else{const receipt=JSON.parse(last.content);expect(receipt.ok).toBe(true);name='cad_propose_geology_revision';args={expectedRevision:receipt.value.revision,units:receipt.value.units,drawingId:receipt.value.drawingId,
      updates:[{holeId:receipt.value.facts.hole.id,collarElevation:106.65}]}}
    return route.fulfill({json:{choices:[{message:{role:'assistant',content:'Review the public collar elevation change.',tool_calls:[{id:`public-source-${name}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]}})
  })
  await page.getByTestId('settings-open').click();await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(endpoint);await page.getByTestId('settings-model').fill('public-source-protocol-fixture')
  await page.getByTestId('settings-save').click();await expect(page.locator('#settings-dialog')).not.toBeVisible()
  await page.getByTestId('chat-input').fill('Change only the public collar elevation to 106.65 metres for review.')
  await page.getByTestId('chat-send').click();await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await page.getByTestId('proposal-approve').click();await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect(page.getByTestId('drawing-undo')).toBeEnabled()
  const active=await activeRecord(page)
  expect(active.state.committed).toBe(true);expect(active.state.drawingHistory.undo.length).toBe(1)
  expect(JSON.parse(active.state.drawing).opaquePayloads).toHaveProperty(`geology-drawing-recipe:${f.drawingId}`)
  const name=await page.locator('#drawing-name').textContent(),row=page.locator('.history-row.active')
  await row.locator('.history-menu-trigger').click();await row.getByRole('button',{name:'Rename',exact:true}).click()
  await page.locator('#history-title-input').fill(name);await page.locator('#history-confirm').click()
  await expect.poll(async()=>(await activeRecord(page)).title).toBe(name)
}
async function downloadCurrent(page, before) {
  const pending=page.waitForEvent('download');await page.locator('#workspace-download').click();const download=await pending
  const sdk=createKJDrawSDK(),original=await sdk.readDocument(before.state.drawing,{format:'KJD'})
  const reopened=await sdk.readDocument(await readFile(await download.path()),{format:'DXF'})
  expect(reopened.validate().valid).toBe(true);expect(reopened.listEntities().length).toBe(original.listEntities().length)
  const lines=document=>document.listEntities({type:'LINE'}).map(entity=>JSON.stringify({start:entity.payload.start,end:entity.payload.end})).sort()
  expect(lines(reopened)).toEqual(lines(original))
}
async function deleteConversation(page,name) {
  const row=page.locator('.history-row').filter({hasText:name})
  await row.locator('.history-menu-trigger').click();await row.getByRole('button',{name:'Delete',exact:true}).click()
  await expect(page.locator('#history-dialog')).toBeVisible();await page.locator('#history-confirm').click()
}

test('aborted attachment removal retains approved source, exact undo archive, draft and actual DXF download before and after refresh',async({page})=>{
  await instrumentStorage(page);const f=await fixture();await page.goto('/ai/');await importDrawing(page,f,'approved-public.kjd')
  await approveSourceChange(page,f);await page.getByTestId('chat-input').fill('Public unsent draft that must survive a failed removal.')
  await expect.poll(async()=>(await activeRecord(page)).draft).toContain('Public unsent draft')
  const before=await activeRecord(page)
  await page.evaluate(()=>{window.__removalStorage.abort=true})
  await page.getByTestId('drawing-remove').click();await expect(page.locator('#remove-drawing-dialog')).toBeVisible()
  await page.getByTestId('drawing-remove-confirm').click();await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect(page.locator('#import-error')).toContainText('Could not save this conversation locally')
  await expect(page.locator('#drawing-name')).toHaveText('approved-public.kjd');await expect(page.getByTestId('drawing-undo')).toBeEnabled()
  expect(await activeRecord(page)).toEqual(before);await downloadCurrent(page,before)
  await page.reload();await expect(page.locator('#drawing-name')).toHaveText('approved-public.kjd')
  expect((await activeRecord(page)).state).toEqual(before.state);await expect(page.getByTestId('chat-input')).toHaveValue(before.draft)
  await expect(page.getByTestId('drawing-undo')).toBeEnabled();await downloadCurrent(page,before)
})

test('attachment stays visible until the actual native completion callback, then immediate refresh cannot revive it or another attachment',async({page})=>{
  await instrumentStorage(page);const f=await fixture();await page.goto('/ai/');await importDrawing(page,f,'retained-public.kjd')
  const retained=await activeRecord(page);await importDrawing(page,f,'mistaken-public.kjd');const before=await activeRecord(page)
  await page.evaluate(()=>{window.__removalStorage.hold=true;window.__removalStorage.holdTarget='blank'})
  await page.getByTestId('drawing-remove').click()
  await expect.poll(()=>page.evaluate(()=>window.__removalStorage.completions.length)).toBeGreaterThan(0)
  await expect(page.locator('#drawing-name')).toHaveText('mistaken-public.kjd');await expect(page.getByTestId('drawing-context')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveJSProperty('readOnly',true);await expect(page.getByTestId('chat-send')).toBeDisabled()
  await page.locator('#new-chat').click();await page.locator('.conversation-item').filter({hasText:'retained-public.kjd'}).click()
  await expect(page.locator('#drawing-name')).toHaveText('mistaken-public.kjd')
  expect((await activeRecord(page)).source).toBeNull();expect((await activeRecord(page)).drawingRemoved).toBe(true)
  await release(page);await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect(page.getByTestId('drawing-context')).not.toBeVisible();await expect(page.locator('#drawing-name')).toHaveText('')
  await page.reload();await expect(page.getByTestId('drawing-context')).not.toBeVisible()
  const after=await activeRecord(page);expect(after.id).toBe(before.id);expect(after.source).toBeNull();expect(after.state.sourceFormat).toBe('blank')
  expect(after.state.drawingHistory.undo).toEqual([]);expect(after.state.drawingHistory.redo).toEqual([])
  expect((await saved(page)).sessions.find(session=>session.id===retained.id)).toEqual(retained)
})

for(const target of ['active','inactive']){
  test(`aborted ${target} conversation deletion preserves both exact drawings and the approved source history after refresh`,async({page})=>{
    await instrumentStorage(page);const f=await fixture();await page.goto('/ai/');await importDrawing(page,f,'approved-public.kjd')
    await approveSourceChange(page,f);const approved=await activeRecord(page)
    await importDrawing(page,f,'other-public.kjd');const other=await activeRecord(page)
    if(target==='active')await page.locator('.conversation-item').filter({hasText:'approved-public.kjd'}).click()
    await expect.poll(async()=>(await saved(page)).activeId).toBe(target==='active'?approved.id:other.id)
    const before=await saved(page);await page.evaluate(()=>{window.__removalStorage.abort=true})
    await deleteConversation(page,'approved-public.kjd');await expect(page.getByTestId('chat-send')).toBeEnabled()
    await expect(page.locator('#import-error')).toContainText('Could not save this conversation locally')
    await expect(page.locator('#history-count')).toHaveText('2');expect(await saved(page)).toEqual(before)
    await expect(page.locator('#drawing-name')).toHaveText(target==='active'?'approved-public.kjd':'other-public.kjd')
    await page.reload();await expect(page.locator('#history-count')).toHaveText('2')
    expect((await saved(page)).sessions.find(session=>session.id===approved.id).state).toEqual(approved.state)
    await page.locator('.conversation-item').filter({hasText:'approved-public.kjd'}).click()
    await expect(page.getByTestId('drawing-undo')).toBeEnabled();await downloadCurrent(page,approved)
  })

  test(`${target} conversation remains visible during the real commit barrier and cannot be restored by a queued background write`,async({page})=>{
    await instrumentStorage(page);const f=await fixture();await page.goto('/ai/');await importDrawing(page,f,'delete-public.kjd')
    const removed=await activeRecord(page);await importDrawing(page,f,'keep-public.kjd');const retained=await activeRecord(page)
    if(target==='active')await page.locator('.conversation-item').filter({hasText:'delete-public.kjd'}).click()
    await expect.poll(async()=>(await saved(page)).activeId).toBe(target==='active'?removed.id:retained.id)
    await page.evaluate(id=>{window.__removalStorage.hold=true;window.__removalStorage.holdTarget=id;window.__removalStorage.writes=[]},removed.id)
    await deleteConversation(page,'delete-public.kjd')
    await expect.poll(()=>page.evaluate(()=>window.__removalStorage.completions.length)).toBeGreaterThan(0)
    await expect(page.locator('#history-count')).toHaveText('2');await expect(page.locator('.history-row').filter({hasText:'delete-public.kjd'})).toBeVisible()
    await expect(page.locator('#drawing-name')).toHaveText(target==='active'?'delete-public.kjd':'keep-public.kjd')
    await page.locator('#new-chat').click();await page.locator('.conversation-item').filter({hasText:target==='active'?'keep-public.kjd':'delete-public.kjd'}).click()
    await expect(page.locator('#drawing-name')).toHaveText(target==='active'?'delete-public.kjd':'keep-public.kjd')
    const row=page.locator('.history-row').filter({hasText:'keep-public.kjd'})
    await row.locator('.history-menu-trigger').click();await row.getByRole('button',{name:'Pin',exact:true}).click()
    await row.getByRole('button',{name:'Rename',exact:true}).click()
    await expect(page.locator('#history-dialog')).not.toBeVisible()
    expect((await saved(page)).sessions.map(session=>session.id)).toEqual([retained.id])
    expect((await saved(page)).activeId).toBe(retained.id)
    await release(page);await expect(page.getByTestId('chat-send')).toBeEnabled();await expect(page.locator('#history-count')).toHaveText('1')
    await expect(page.locator('#drawing-name')).toHaveText('keep-public.kjd')
    const writes=await page.evaluate(()=>window.__removalStorage.writes),candidateIndex=writes.findIndex(write=>!write.ids.includes(removed.id))
    expect(candidateIndex).toBeGreaterThanOrEqual(0);expect(writes.slice(candidateIndex).every(write=>!write.ids.includes(removed.id))).toBe(true)
    await page.reload();await expect(page.locator('#history-count')).toHaveText('1')
    const after=await saved(page);expect(after.activeId).toBe(retained.id);expect(after.sessions.map(session=>session.id)).toEqual([retained.id])
    expect(after.sessions[0]).toEqual(retained)
  })
}
