import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { createSyntheticGeologyDemo } from '../../examples/synthetic-geology-demo.mjs'

// Public SDK/protocol UI diagnostic, not a live-provider/model-quality test.
// Only delivery of a real native IndexedDB completion is held. CAD approval,
// current geometry, renderer, camera and persistent receipts remain real.
const endpoint='https://public-approval-paint.invalid/chat/completions'
async function saved(page) {
  return page.evaluate(async()=>{const record=await(await import('/apps/playground/ai/local-history.js')).loadLocalHistory();return record.sessions.find(session=>session.id===record.activeId)})
}
const camera=canvas=>canvas.evaluate(node=>JSON.parse(node.dataset.viewerCamera))
async function setup(page) {
  const source=await createSyntheticGeologyDemo(),sdk=createKJDrawSDK()
  const kjd=await source.sdk.writeDocument(source.document,{format:'KJD'}),before=source.document.snapshot()
  let requests=0
  await page.route(endpoint,route=>{
    requests++
    const body=route.request().postDataJSON(),output=body.messages.findLast(message=>message.role==='tool')
    let name,args
    if(!output){name='cad_read_geology_source';args={expectedRevision:Number(/revision (\d+);/.exec(body.messages.find(message=>message.role==='user').content)[1]),drawingId:source.drawingId,maxBytes:262144}}
    else{
      const receipt=JSON.parse(output.content);expect(receipt.ok,JSON.stringify(receipt.error??{})).toBe(true)
      name='cad_propose_geology_revision';args={expectedRevision:receipt.value.revision,units:receipt.value.units,drawingId:receipt.value.drawingId,
        updates:receipt.value.facts.holes.map(hole=>({holeId:hole.id,stratumChanges:{update:[{
          target:{intervalId:hole.strata[0].intervalId,expectedTop:hole.strata[0].top,expectedBottom:hole.strata[0].bottom},
          set:{name:'示例耕植土',lithology:'cultivated-soil'},
        }]}}))}
    }
    return route.fulfill({json:{choices:[{message:{role:'assistant',content:'Review this public synthetic lithology change.',tool_calls:[{
      id:`paint-${name}`,type:'function',function:{name,arguments:JSON.stringify(args)},
    }]},finish_reason:'tool_calls'}]}})
  })
  await page.goto('/ai/');await page.setViewportSize({width:1600,height:1000})
  await page.getByTestId('drawing-file').setInputFiles({name:'public-approval-section.kjd',mimeType:'application/json',buffer:Buffer.from(kjd)})
  await expect(page.locator('#drawing-name')).toHaveText('public-approval-section.kjd')
  await expect.poll(async()=>(await saved(page)).source.name).toBe('public-approval-section.kjd')
  await page.getByTestId('settings-open').click();await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(endpoint);await page.getByTestId('settings-model').fill('public-protocol-ui-diagnostic')
  await page.getByTestId('settings-save').click();await expect(page.locator('#settings-dialog')).not.toBeVisible()
  await page.evaluate(async()=>{
    const {KJCanvasRenderer}=await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const nativeRender=KJCanvasRenderer.prototype.render,nativePreview=KJCanvasRenderer.prototype.drawPreview
    const probe=window.__approvalPaint={errors:[],frames:[],previewDraws:0,approvalCalls:0,observing:false,failNext:false,hold:false,deliveries:[]}
    KJCanvasRenderer.prototype.render=function(...args){
      const report=nativeRender.apply(this,args)
      if(this.canvas.closest('#workspace-viewer')&&this.document){
        this.canvas.__nativeFrame={revision:this.document.revision,ids:this.document.listEntities().map(entity=>entity.id).sort(),
          topsoil:this.document.listEntities({type:'HATCH'}).some(entity=>entity.payload.patternName==='GEO_TOPSOIL')}
      }
      if(probe.observing&&this.canvas.closest('.drawing-viewer'))probe.frames.push({revision:this.document.revision,mode:this.canvas.dataset.viewerMode,rendered:report.rendered})
      return report
    }
    KJCanvasRenderer.prototype.drawPreview=function(...args){if(probe.observing&&this.canvas.closest('.drawing-viewer'))probe.previewDraws++;return nativePreview.apply(this,args)}
    new MutationObserver(records=>{
      for(const record of records)if(probe.observing&&record.target.closest('.drawing-viewer')&&record.attributeName==='data-viewer-error'&&
        (record.oldValue==='true'||record.target.dataset.viewerError==='true'))probe.errors.push('actual-viewer-failed')
    }).observe(document.body,{subtree:true,attributes:true,attributeOldValue:true})
    const {KJAgentToolSession}=await import('/packages/kjdraw-sdk/src/agent-tools.js'),nativeApprove=KJAgentToolSession.prototype.approve
    KJAgentToolSession.prototype.approve=function(...args){
      probe.approvalCalls++
      // A bounded adapter exception before native approval; no CAD mutation or
      // plan consumption. This proves a still-valid proposal can be retried.
      if(probe.failNext){probe.failNext=false;throw new Error('Public diagnostic approval adapter failure')}
      return nativeApprove.apply(this,args)
    }
    const nativePut=IDBObjectStore.prototype.put,nativeTransaction=IDBDatabase.prototype.transaction
    IDBObjectStore.prototype.put=function(value,...args){
      if(this.transaction.db.name==='kjdraw-ai-local'&&probe.hold&&value?.sessions?.some(session=>session.messages.some(message=>
        probe.target==='error'?message.status==='error':message.proposals?.some(proposal=>proposal.planId===probe.planId&&proposal.uiState===probe.target))))
        this.transaction.__approvalPaintRecord=true
      return nativePut.call(this,value,...args)
    }
    IDBDatabase.prototype.transaction=function(...args){
      const transaction=nativeTransaction.apply(this,args)
      if(this.name!=='kjdraw-ai-local'||transaction.mode!=='readwrite')return transaction
      let owner=transaction,descriptor
      while(owner&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(owner,'oncomplete');owner=Object.getPrototypeOf(owner)}
      Object.defineProperty(transaction,'oncomplete',{configurable:true,set(handler){descriptor.set.call(transaction,event=>{
        const deliver=()=>handler.call(transaction,event)
        if(probe.hold&&transaction.__approvalPaintRecord)probe.deliveries.push(deliver);else deliver()
      })}})
      return transaction
    }
  })
  await page.getByTestId('chat-input').fill('Read the synthetic source and prepare a reviewable change of all eight first layers to topsoil named 示例耕植土. Do not apply before review.')
  await page.getByTestId('chat-send').click();await expect(page.getByTestId('proposal-approve')).toBeVisible()
  const pending=await saved(page),proposal=pending.messages.flatMap(message=>message.proposals??[]).find(proposal=>proposal.uiState==='pending')
  expect(JSON.parse(pending.state.drawing).objects).toEqual(before.objects)
  const viewer=page.locator('#workspace-viewer .drawing-viewer'),canvas=viewer.locator('canvas')
  await expect(viewer).toHaveAttribute('data-viewer-mode','proposal')
  await expect(viewer).not.toHaveAttribute('data-viewer-error','true')
  await canvas.locator('..').press('+');await canvas.locator('..').press('ArrowRight')
  await expect.poll(async()=>(await camera(canvas)).scale).toBeGreaterThan(0)
  const retainedCamera=await camera(canvas),bounds=await canvas.boundingBox()
  return {source,sdk,before,proposal,viewer,canvas,retainedCamera,bounds,requests:()=>requests}
}
async function beginBarrier(page,planId,target,{failNext=false}={}) {
  await page.evaluate(({planId,target,failNext})=>{Object.assign(window.__approvalPaint,{planId,target,failNext,hold:true,observing:true});window.__approvalPaint.frames=[];window.__approvalPaint.errors=[];window.__approvalPaint.previewDraws=0},{planId,target,failNext})
}
async function release(page) {await page.evaluate(()=>{const probe=window.__approvalPaint;probe.hold=false;probe.deliveries.splice(0).forEach(deliver=>deliver())})}
async function expectCurrentWhileSaving(page,f) {
  await expect.poll(()=>page.evaluate(()=>window.__approvalPaint.deliveries.length)).toBeGreaterThan(0)
  await expect(f.viewer).toHaveAttribute('data-viewer-mode','document');await expect(f.viewer).not.toHaveAttribute('data-viewer-error','true')
  const cardViewer=page.getByTestId('drawing-result').locator('.drawing-viewer')
  await expect(cardViewer).toHaveAttribute('data-viewer-mode','document');await expect(cardViewer).not.toHaveAttribute('data-viewer-error','true')
  await expect(page.getByTestId('chat-send')).toBeDisabled();await expect(page.locator('#workspace-download')).toBeDisabled()
  await expect(page.locator('#view-proposal')).toBeDisabled();await expect(page.locator('#workspace-approve')).toBeDisabled()
  await expect(page.getByTestId('proposal-approve')).toBeDisabled();await expect(page.getByTestId('proposal-reject')).toBeDisabled()
  await expect(page.locator('#workspace-review')).toContainText('Processing the review and saving local history')
  await expect(page.locator('#workspace-review')).not.toContainText('Awaiting review')
  await expect(page.locator('#view-current')).toHaveAttribute('aria-selected','true')
  await page.locator('#view-current').click()
  await page.locator('#view-proposal').dispatchEvent('click')
  await page.setViewportSize({width:1600,height:1012});await page.setViewportSize({width:1600,height:1000})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await expect.poll(async()=>camera(f.canvas)).toEqual(f.retainedCamera)
  const nextBounds=await f.canvas.boundingBox();expect(nextBounds.width).toBeCloseTo(f.bounds.width,0);expect(nextBounds.height).toBeCloseTo(f.bounds.height,0)
  const probe=await page.evaluate(()=>window.__approvalPaint)
  expect(probe.errors).toEqual([]);expect(probe.previewDraws).toBe(0)
  expect(probe.frames.length).toBeGreaterThan(0);expect(probe.frames.every(frame=>frame.mode==='document'&&frame.rendered>0)).toBe(true)
}
function dispose(f) { f.source.dispose();for(const id of [...f.sdk.documents.keys()])f.sdk.closeDocument(id) }

test('real native approval and held durable completion never repaint an expired proposal or enable approval/send/download early',async({page})=>{
  const f=await setup(page)
  try{
    await beginBarrier(page,f.proposal.planId,'approved');await page.getByTestId('proposal-approve').click()
    await expectCurrentWhileSaving(page,f)
    const current=await saved(page),native=await f.sdk.readDocument(current.state.drawing,{format:'KJD'})
    expect(native.revision).toBe(f.before.revision+1)
    const nativeFrame=await f.canvas.evaluate(node=>node.__nativeFrame)
    expect(nativeFrame.revision).toBe(native.revision);expect(nativeFrame.ids).toEqual(native.listEntities().map(entity=>entity.id).sort());expect(nativeFrame.topsoil).toBe(true)
    expect(native.getObject(f.source.manual.id)).toEqual(f.source.manual)
    expect(await page.evaluate(()=>window.__approvalPaint.approvalCalls)).toBe(1)
    await expect(page.locator('#messages')).not.toContainText('已应用图纸修改')
    await expect(page.locator('.proposal-tag')).not.toHaveText('Applied')
    await release(page);await expect(page.getByTestId('chat-send')).toBeEnabled()
    await expect(page.locator('#workspace-download')).toBeEnabled();await expect(page.locator('#workspace-review')).not.toBeVisible()
    await expect.poll(()=>page.evaluate(()=>window.__approvalPaint.errors)).toEqual([])
    expect(f.requests()).toBe(2)
    await page.reload();await expect(page.locator('#workspace-viewer .drawing-viewer')).toHaveAttribute('data-viewer-mode','document')
    expect((await saved(page)).state.drawing).toBe(current.state.drawing)
  }finally{dispose(f)}
})

test('an approval adapter failure leaves native CAD unchanged and a valid pending preview can be restored and retried after the real save barrier',async({page})=>{
  const f=await setup(page)
  try{
    await beginBarrier(page,f.proposal.planId,'error',{failNext:true});await page.getByTestId('proposal-approve').click()
    await expectCurrentWhileSaving(page,f)
    expect(JSON.parse((await saved(page)).state.drawing).objects).toEqual(f.before.objects)
    await release(page);await expect(page.getByTestId('chat-send')).toBeEnabled();await expect(page.getByTestId('proposal-approve')).toBeEnabled()
    await page.locator('#view-proposal').click();await expect(f.viewer).toHaveAttribute('data-viewer-mode','proposal')
    await expect(f.viewer).not.toHaveAttribute('data-viewer-error','true')
    await page.evaluate(()=>{window.__approvalPaint.observing=false})
    await page.getByTestId('proposal-approve').click();await expect(page.getByTestId('chat-send')).toBeEnabled()
    expect((await saved(page)).state.committed).toBe(true);expect(await page.evaluate(()=>window.__approvalPaint.approvalCalls)).toBe(2)
    expect(f.requests()).toBe(2)
  }finally{dispose(f)}
})

test('discarding a proposal paints only the unchanged native document while its actual rejection completion is held',async({page})=>{
  const f=await setup(page)
  try{
    await beginBarrier(page,f.proposal.planId,'rejected');await page.getByTestId('proposal-reject').click()
    await expectCurrentWhileSaving(page,f)
    expect(JSON.parse((await saved(page)).state.drawing).objects).toEqual(f.before.objects)
    expect(await page.evaluate(()=>window.__approvalPaint.approvalCalls)).toBe(0)
    await release(page);await expect(page.getByTestId('chat-send')).toBeEnabled()
    await expect(page.locator('#workspace-review')).not.toBeVisible();await expect(f.viewer).not.toHaveAttribute('data-viewer-error','true')
    expect((await saved(page)).state.committed).toBe(false);expect(f.requests()).toBe(2)
  }finally{dispose(f)}
})
