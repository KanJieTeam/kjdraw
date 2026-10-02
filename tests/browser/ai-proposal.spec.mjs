import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

test('real CAD proposal stays pending until approval and exports a reopenable DXF', async ({ page }) => {
  const requests = []
  const args = { expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [] }
  await page.route('https://ai-test.invalid/v1/chat/completions', route => {
    const request = route.request()
    requests.push({ authorization: request.headers().authorization, body: request.postDataJSON() })
    return route.fulfill({ json: {
      id: 'mock-tool', object: 'chat.completion', model: 'browser-fixture',
      choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [{
        id: 'call-1', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify(args) },
      }] }, finish_reason: 'tool_calls' }],
    } })
  })

  await page.goto('/ai/')
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  await page.getByTestId('chat-input').fill('Draw a line from 0,0 to 20,0 millimeters')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /script-src 'self'/)
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  expect(await page.evaluate(() => JSON.stringify({local: {...localStorage}, session: {...sessionStorage}}).includes('browser-test-key'))).toBe(false)
  await expect(page.getByTestId('settings-key')).toHaveValue('')

  const card = page.getByTestId('drawing-result')
  await expect(card).toBeVisible()
  await expect(card).toContainText('REV 0')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  await expect.poll(() => card.locator('canvas').evaluate(canvas => {
    if (!canvas.width || !canvas.height) return 0
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let drawn = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 230 || pixels[i + 1] < 230 || pixels[i + 2] < 230) drawn++
    return drawn
  })).toBeGreaterThan(20)
  expect(requests).toHaveLength(1)
  expect(requests[0].authorization).toBe('Bearer browser-test-key')
  expect(requests[0].body.model).toBe('browser-fixture')

  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  await expect.poll(() => card.locator('canvas').evaluate(canvas => {
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
    let drawn=0
    for(let i=0;i<pixels.length;i+=4) if(pixels[i]<230||pixels[i+1]<230||pixels[i+2]<230) drawn++
    return drawn
  })).toBeGreaterThan(20)
  const waiting = page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const download = await waiting
  expect(download.suggestedFilename()).toBe('kjdraw-ai-drawing.dxf')
  const drawing = await createKJDrawSDK().readDocument(new Uint8Array(await readFile(await download.path())), { format: 'DXF' })
  expect(drawing.validate().valid).toBe(true)
  expect(drawing.listEntities()).toHaveLength(1)
  expect(drawing.listEntities()[0].payload.start).toEqual([0, 0, 0])
  expect(drawing.listEntities()[0].payload.end).toEqual([20, 0, 0])

  await expect.poll(async () => page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('kjdraw-ai-local')
    open.onsuccess = () => {
      const request = open.result.transaction('conversations').objectStore('conversations').get('history')
      request.onsuccess = () => resolve(request.result?.sessions?.[0]?.state?.committed === true)
      request.onerror = () => resolve(false)
    }
    open.onerror = () => resolve(false)
  }))).toBe(true)
  await page.reload()
  await expect(page.locator('#history-count')).toHaveText('1')
  await expect(page.getByTestId('drawing-result')).toContainText('Applied')
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  await expect(page.getByTestId('settings-open')).toContainText('Connection settings')
  expect(await page.evaluate(() => new Promise(resolve => {
    const open=indexedDB.open('kjdraw-ai-local')
    open.onsuccess=()=>{
      const request=open.result.transaction('conversations').objectStore('conversations').get('history')
      request.onsuccess=()=>resolve(JSON.stringify(request.result).includes('browser-test-key'))
    }
  }))).toBe(true)
  const again = page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const restoredDownload = await again
  const restoredDrawing = await createKJDrawSDK().readDocument(new Uint8Array(await readFile(await restoredDownload.path())), { format: 'DXF' })
  expect(restoredDrawing.listEntities()).toHaveLength(1)
  expect(await page.evaluate(() => JSON.stringify({local:{...localStorage},session:{...sessionStorage}}).includes('browser-test-key'))).toBe(false)
  await page.locator('#new-chat').click()
  await expect(page.getByTestId('chat-empty')).toBeVisible()
  await expect(page.locator('#history-count')).toHaveText('1')
  await page.locator('#conversation-list .conversation-item').click()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
})

test('imports an existing KJD, edits its entity, restores the chat, and downloads DXF', async ({ page }) => {
  const sdk = createKJDrawSDK()
  const source = sdk.createDocument({ documentId:'uploaded-line', units:'millimeter' })
  await source.transact('Source drawing', tx => {
    tx.createEntity('LINE', { start:[5,5,0], end:[45,5,0] }, { id:'seed-edge' })
  })
  const args = { expectedRevision:source.revision, units:'millimeter', ids:['seed-edge'], dx:5, dy:2 }
  await page.route('https://ai-test.invalid/v1/chat/completions', route => {
    const body = route.request().postDataJSON()
    const host = body.messages.find(message => message.role === 'user' && message.content.startsWith('Host context: document '))
    expect(host.content).toContain(`Host context: document ${source.id}; revision ${source.revision}; units millimeter.`)
    const output = body.messages.findLast(message => message.role === 'tool')
    if (!output) return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'read-seed-edge', type: 'function', function: { name: 'cad_query_drawing', arguments: JSON.stringify({
        expectedRevision: source.revision, filters: { ids: ['seed-edge'] }, offset: 0, limit: 1,
        layerOffset: 0, maxLayers: 1, maxBytes: 10240,
      }) },
    }] }, finish_reason: 'tool_calls' }] } })
    const read = JSON.parse(output.content)
    expect(read).toMatchObject({ ok: true, value: { documentId: source.id, revision: source.revision, units: 'millimeter' } })
    expect(read.value.entities).toHaveLength(1)
    expect(read.value.entities[0]).toMatchObject({ id: 'seed-edge', type: 'LINE', geometry: { start: [5,5,0], end: [45,5,0] } })
    return route.fulfill({ json: {
    id:'mock-move', object:'chat.completion', model:'browser-fixture',
    choices:[{ index:0, message:{ role:'assistant', content:'', tool_calls:[{
      id:'move-1', type:'function', function:{ name:'cad_propose_move', arguments:JSON.stringify(args) },
    }] }, finish_reason:'tool_calls' }],
  } })
  })
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({
    name:'seed.kjd', mimeType:'application/json', buffer:Buffer.from(await sdk.writeDocument(source,{format:'KJD'})),
  })
  await expect(page.getByTestId('drawing-context')).toBeVisible()
  await expect(page.locator('#drawing-name')).toHaveText('seed.kjd')
  await expect(page.locator('#drawing-meta')).toContainText('1 entities')
  await page.getByTestId('chat-input').fill('Move the existing line 5 millimeters right and 2 millimeters up')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  await expect.poll(async () => page.evaluate(() => new Promise(resolve => {
    const open=indexedDB.open('kjdraw-ai-local')
    open.onsuccess=()=>{
      const request=open.result.transaction('conversations').objectStore('conversations').get('history')
      request.onsuccess=()=>resolve(request.result?.sessions?.[0]?.state?.committed===true)
      request.onerror=()=>resolve(false)
    }
    open.onerror=()=>resolve(false)
  }))).toBe(true)
  await page.reload()
  await expect(page.locator('#history-count')).toHaveText('1')
  await expect(page.locator('#drawing-name')).toHaveText('seed.kjd')
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  const downloadPromise=page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const download=await downloadPromise
  expect(download.suggestedFilename()).toBe('seed.dxf')
  const output=await createKJDrawSDK().readDocument(new Uint8Array(await readFile(await download.path())),{format:'DXF'})
  expect(output.listEntities()).toHaveLength(1)
  expect(output.listEntities()[0].payload.start).toEqual([10,7,0])
  expect(output.listEntities()[0].payload.end).toEqual([50,7,0])
})

test('dragging in a DXF opens it locally and a broken drawing does not replace it', async ({ page }) => {
  const sdk=createKJDrawSDK(), source=sdk.createDocument({documentId:'drop-source',units:'millimeter'})
  await source.transact('Source',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[30,0,0]},{id:'drop-edge'}))
  const dxf=await sdk.writeDocument(source,{format:'DXF'})
  await page.goto('/ai/')
  await page.evaluate(text=>{
    const transfer=new DataTransfer()
    transfer.items.add(new File([text],'drop.dxf',{type:'application/dxf'}))
    window.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}))
    window.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))
  },dxf)
  await expect(page.locator('#drawing-name')).toHaveText('drop.dxf')
  await expect(page.locator('#drawing-meta')).toContainText('1 entities')
  await page.getByTestId('drawing-file').setInputFiles({name:'broken.dxf',mimeType:'application/dxf',buffer:Buffer.from('not a DXF')})
  await expect(page.locator('#import-error')).toBeVisible()
  await expect(page.locator('#drawing-name')).toHaveText('drop.dxf')
  await expect.poll(async()=>page.evaluate(()=>new Promise(resolve=>{
    const open=indexedDB.open('kjdraw-ai-local')
    open.onsuccess=()=>{
      const request=open.result.transaction('conversations').objectStore('conversations').get('history')
      request.onsuccess=()=>resolve(request.result?.sessions?.[0]?.source?.name)
    }
  }))).toBe('drop.dxf')
  await page.reload()
  await expect(page.locator('#drawing-name')).toHaveText('drop.dxf')
})

test('KJP project upload restores its active drawing after refresh', async ({ page }) => {
  const sdk=createKJDrawSDK(), source=sdk.createDocument({documentId:'project-source',units:'millimeter'})
  await source.transact('Project drawing',tx=>tx.createEntity('CIRCLE',{center:[12,9,0],radius:5},{id:'project-circle'}))
  const project=KJProjectSession.create({sdk,id:'ai-upload-project',documents:[source],activeDocumentId:source.id})
  const bytes=await project.package()
  project.destroy()
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({name:'survey.kjp',mimeType:'application/zip',buffer:Buffer.from(bytes)})
  await expect(page.locator('#drawing-name')).toHaveText('survey.kjp')
  await expect(page.locator('#drawing-meta')).toContainText('1 entities')
  await expect.poll(async()=>page.evaluate(()=>new Promise(resolve=>{
    const open=indexedDB.open('kjdraw-ai-local')
    open.onsuccess=()=>{
      const request=open.result.transaction('conversations').objectStore('conversations').get('history')
      request.onsuccess=()=>resolve(request.result?.sessions?.[0]?.source?.name)
    }
  }))).toBe('survey.kjp')
  await page.reload()
  await expect(page.locator('#drawing-name')).toHaveText('survey.kjp')
  await expect(page.locator('#drawing-meta')).toContainText('1 entities')
})

test('local conversation history can be reopened, searched, renamed and deleted', async ({ page }) => {
  const sdk=createKJDrawSDK(), source=sdk.createDocument({documentId:'history-source',units:'millimeter'})
  await source.transact('History drawing',tx=>tx.createEntity('LINE',{start:[0,0,0],end:[10,0,0]},{id:'history-line'}))
  const drawing=await sdk.writeDocument(source,{format:'KJD'})
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({name:'alpha.kjd',mimeType:'application/json',buffer:Buffer.from(drawing)})
  await expect(page.locator('#drawing-name')).toHaveText('alpha.kjd')
  await page.getByTestId('drawing-file').setInputFiles({name:'beta.kjd',mimeType:'application/json',buffer:Buffer.from(drawing)})
  await expect(page.locator('#history-count')).toHaveText('2')
  await page.locator('.history-row').filter({hasText:'alpha.kjd'}).locator('.conversation-item').click()
  await expect(page.locator('#drawing-name')).toHaveText('alpha.kjd')
  await page.locator('.history-row').filter({hasText:'alpha.kjd'}).locator('.history-menu-trigger').click()
  await page.locator('.history-row').filter({hasText:'alpha.kjd'}).getByRole('button',{name:'Rename'}).click()
  await page.locator('#history-title-input').fill('Survey plan')
  await page.locator('#history-confirm').click()
  await expect(page.locator('.history-row').filter({hasText:'Survey plan'})).toHaveCount(1)
  await page.locator('#history-search').fill('survey')
  await expect(page.locator('.history-row')).toHaveCount(1)
  await page.locator('#history-search').fill('')
  await page.locator('.history-row').filter({hasText:'beta.kjd'}).locator('.history-menu-trigger').click()
  await page.locator('.history-row').filter({hasText:'beta.kjd'}).getByRole('button',{name:'Delete'}).click()
  await expect(page.locator('#history-dialog')).toBeVisible()
  await page.locator('#history-confirm').click()
  await expect(page.locator('#history-count')).toHaveText('1')
  await expect(page.locator('.history-row').filter({hasText:'beta.kjd'})).toHaveCount(0)
  await expect.poll(async()=>page.evaluate(()=>new Promise(resolve=>{
    const open=indexedDB.open('kjdraw-ai-local')
    open.onsuccess=()=>{
      const request=open.result.transaction('conversations').objectStore('conversations').get('history')
      request.onsuccess=()=>resolve(request.result?.sessions?.map(item=>item.title))
    }
  }))).toEqual(['Survey plan'])
  await page.reload()
  await expect(page.locator('.history-row').filter({hasText:'Survey plan'})).toHaveCount(1)
  await expect(page.locator('#drawing-name')).toHaveText('alpha.kjd')
})

test('building edits are chosen by model tools, impact-checked, and never inferred by a canned phrase', async ({ page }) => {
  const sdk=createKJDrawSDK(), source=sdk.createDocument({documentId:'building-source',units:'millimeter'})
  await source.transact('Two building rows',tx=>{
    for(let index=0;index<6;index++){
      const x=index*40
      const y=index<4?100:40
      tx.createEntity('LWPOLYLINE',{vertices:[[x,y],[x+24,y],[x+24,y+20],[x,y+20]],closed:true},{id:'building-'+index})
      tx.createEntity('TEXT',{position:[x+4,y+10],text:String(index+3)+'F',height:2},{id:'floor-'+index})
    }
    tx.createEntity('LINE',{start:[0,20],end:[224,20]},{id:'road'})
  })
  const requests=[]
  let phase=0, ids=[]
  await page.route('https://ai-test.invalid/v1/chat/completions',route=>{
    const body=route.request().postDataJSON()
    requests.push(body)
    const userMessage=body.messages.find(message=>message.role==='user' && message.content.startsWith('Host context: document '))?.content ?? ''
    expect(userMessage).toContain(`Host context: document ${source.id}; revision ${source.revision}; units millimeter.`)
    if(userMessage.endsWith('Current user request: 删掉顶部三个楼')){
      const output=body.messages.findLast(message=>message.role==='tool')
      if(!output) return route.fulfill({json:{choices:[{message:{role:'assistant',content:'',tool_calls:[{
        id:'read-ambiguous-top-row',type:'function',function:{name:'cad_query_spatial_candidates',arguments:JSON.stringify({
          expectedRevision:source.revision,indices:[0,1,2,3],
        })},
      }]},finish_reason:'tool_calls'}]}})
      const read=JSON.parse(output.content)
      expect(read).toMatchObject({ok:true,value:{expectedRevision:source.revision,total:6,returned:4,completeInventory:false}})
      expect(read.value.candidates).toHaveLength(4)
      expect(read.value.candidates.flatMap(candidate=>candidate.memberIds)).toEqual([
        'building-0','floor-0','building-1','floor-1','building-2','floor-2','building-3','floor-3',
      ])
      return route.fulfill({json:{choices:[{message:{role:'assistant',content:'顶部有四栋候选，请指出是哪三栋。'},finish_reason:'stop'}]}})
    }
    expect(userMessage).toMatch(/Current user request: 删掉底部两个楼$/)
    const revision=source.revision
    let name,args
    if(phase===0){name='cad_query_spatial_candidates';args={expectedRevision:revision,indices:[4,5]}}
    else if(phase===1){
      const result=JSON.parse(body.messages.filter(message=>message.role==='tool').at(-1).content)
      ids=result.value.candidates.flatMap(candidate=>candidate.memberIds)
      name='cad_query_impact';args={expectedRevision:revision,units:'millimeter',operation:'erase',ids,tolerance:0.01,maxBytes:262144}
    }else{
      const result=JSON.parse(body.messages.filter(message=>message.role==='tool').at(-1).content)
      expect(result.value.canErase).toBe(true)
      name='cad_propose_structural_edit';args={expectedRevision:revision,units:'millimeter',eraseIds:ids,tolerance:0.01,maxBytes:262144}
    }
    phase++
    return route.fulfill({json:{choices:[{message:{role:'assistant',content:'',tool_calls:[{
      id:'building-tool-'+phase,type:'function',function:{name,arguments:JSON.stringify(args)},
    }]},finish_reason:'tool_calls'}]}})
  })
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({
    name:'six-buildings.kjd',mimeType:'application/json',buffer:Buffer.from(await sdk.writeDocument(source,{format:'KJD'})),
  })
  await expect(page.locator('#drawing-name')).toHaveText('six-buildings.kjd')
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await page.getByTestId('chat-input').fill('删掉顶部三个楼')
  await page.getByTestId('chat-send').click()
  await expect(page.locator('#settings-dialog')).toBeVisible()
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('请指出是哪三栋')
  await page.getByTestId('chat-input').fill('删掉底部两个楼')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  expect(phase).toBe(3)
  expect(ids).toEqual(['building-4','floor-4','building-5','floor-5'])
  expect(requests.some(body=>body.tools.some(tool=>tool.function.name==='cad_query_spatial_candidates'))).toBe(true)
  await page.getByTestId('proposal-approve').click()
  const waiting=page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const download=await waiting
  const output=await createKJDrawSDK().readDocument(new Uint8Array(await readFile(await download.path())),{format:'DXF'})
  expect(output.validate().valid).toBe(true)
  expect(output.listEntities({ownerId:output.spaces.modelSpaceId})).toHaveLength(9)
})

test('imported DXF geology edits disclose missing source facts instead of exposing blank-only redraw tools', async ({ page }) => {
  const sdk=createKJDrawSDK(), source=sdk.createDocument({documentId:'section-graphic',units:'millimeter'})
  await source.transact('Graphic section',tx=>{
    tx.createEntity('TEXT',{position:[0,0],text:'ZK01',height:2},{id:'hole-label'})
    tx.createEntity('LINE',{start:[0,-10],end:[10,-10]},{id:'stratum-line'})
  })
  let captured
  await page.route('https://ai-test.invalid/v1/chat/completions',route=>{
    captured=route.request().postDataJSON()
    const host=captured.messages.find(message=>message.role==='user' && message.content.startsWith('Host context: document '))
    expect(host.content).toContain('not a verified borehole source table')
    const output=captured.messages.findLast(message=>message.role==='tool')
    if(!output) return route.fulfill({json:{choices:[{message:{role:'assistant',content:'',tool_calls:[{
      id:'read-imported-section',type:'function',function:{name:'cad_read_drawing',arguments:'{}'},
    }]},finish_reason:'tool_calls'}]}})
    const read=JSON.parse(output.content)
    expect(read).toMatchObject({ok:true,value:{units:'millimeter'}})
    expect(read.value.entities).toHaveLength(2)
    expect(read.value.entities.map(entity=>entity.type).sort()).toEqual(['LINE','TEXT'])
    return route.fulfill({json:{choices:[{message:{role:'assistant',content:'请提供 ZK01 的原始分层表和与邻孔的对比关系，不能只改图上的文字。'},finish_reason:'stop'}]}})
  })
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({
    name:'section.dxf',mimeType:'application/dxf',buffer:Buffer.from(await sdk.writeDocument(source,{format:'DXF'})),
  })
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  await page.getByTestId('chat-input').fill('把 ZK01 第三层改成砂层并重绘剖面图')
  await page.getByTestId('chat-send').click()
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('原始分层表')
  expect(captured.messages.find(message=>message.role==='user' && message.content.startsWith('Host context: document ')).content).toContain('not a verified borehole source table')
  const names=captured.tools.map(tool=>tool.function.name)
  expect(names).not.toContain('cad_propose_geology_section')
  expect(names).not.toContain('cad_propose_geology_column')
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
})

test('refresh retains the conversation but expires proposals that were never approved', async ({ page }) => {
  const args={expectedRevision:0,units:'millimeter',lines:[[0,0,20,0]],circles:[],arcs:[],polylines:[],arrays:[]}
  await page.route('https://ai-test.invalid/v1/chat/completions',route=>route.fulfill({json:{
    choices:[{message:{role:'assistant',content:'',tool_calls:[{
      id:'pending',type:'function',function:{name:'cad_propose_drawing_pattern',arguments:JSON.stringify(args)},
    }]},finish_reason:'tool_calls'}],
  }}))
  await page.goto('/ai/')
  await page.getByTestId('chat-input').fill('Draw a line from 0,0 to 20,0')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await expect.poll(async()=>page.evaluate(()=>new Promise(resolve=>{
    const open=indexedDB.open('kjdraw-ai-local')
    open.onsuccess=()=>{
      const request=open.result.transaction('conversations').objectStore('conversations').get('history')
      request.onsuccess=()=>resolve(request.result?.sessions?.[0]?.messages?.some(message=>message.proposals?.[0]?.uiState==='pending'))
    }
  }))).toBe(true)
  await page.reload()
  await expect(page.locator('#history-count')).toHaveText('1')
  await expect(page.getByTestId('drawing-result')).toContainText('Expired')
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
})

test('saved model key can be used after refresh without entering it again', async ({ page }) => {
  const args={expectedRevision:0,units:'millimeter',lines:[[0,0,10,0]],circles:[],arcs:[],polylines:[],arrays:[]}
  const requests=[]
  await page.route('https://ai-test.invalid/v1/chat/completions',route=>{
    requests.push(route.request().headers().authorization)
    return route.fulfill({json:{choices:[{message:{role:'assistant',content:'',tool_calls:[{
      id:'restored-key',type:'function',function:{name:'cad_propose_drawing_pattern',arguments:JSON.stringify(args)},
    }]},finish_reason:'tool_calls'}]}})
  })
  await page.goto('/ai/')
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()
  await expect.poll(async()=>page.evaluate(()=>new Promise(resolve=>{
    const open=indexedDB.open('kjdraw-ai-local')
    open.onsuccess=()=>{
      const request=open.result.transaction('conversations').objectStore('conversations').get('history')
      request.onsuccess=()=>resolve(request.result?.connection?.apiKey)
    }
  }))).toBe('browser-test-key')
  await page.reload()
  await expect(page.getByTestId('settings-open')).toContainText('Connection settings')
  await page.getByTestId('chat-input').fill('Draw a 10 mm line')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  expect(requests).toEqual(['Bearer browser-test-key'])
})

test('language switch updates examples and connection controls together', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' })
  const page = await context.newPage()
  await page.goto('/ai/')
  await expect(page.locator('.suggestions button')).toHaveText([
    '画一条 100 mm 水平线', '画一个半径 25 mm 的圆', '画一个 120 × 80 mm 矩形',
  ])
  await expect(page.getByTestId('settings-open')).toContainText('连接模型')
  await page.getByRole('button', { name: 'Switch to English' }).click()
  await expect(page.locator('.suggestions button')).toHaveText([
    'Draw a 100 mm horizontal line', 'Draw a circle with a 25 mm radius', 'Draw a 120 × 80 mm rectangle',
  ])
  await expect(page.getByTestId('settings-open')).toContainText('Connect model')
  await page.getByRole('button', { name: '切换到中文' }).click()
  await expect(page.locator('.suggestions button')).toHaveText([
    '画一条 100 mm 水平线', '画一个半径 25 mm 的圆', '画一个 120 × 80 mm 矩形',
  ])
  await expect(page.getByTestId('settings-open')).toContainText('连接模型')
  await context.close()
})

test('model connection reuses common providers and keeps custom endpoints editable', async ({ page }) => {
  await page.goto('/ai/')
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('deepseek')
  await expect(page.getByTestId('settings-common-model')).toHaveValue('deepseek-v4-flash')
  await expect(page.getByTestId('settings-endpoint')).toHaveValue('https://api.deepseek.com/chat/completions')
  await expect(page.getByTestId('settings-protocol')).toHaveValue('chat-completions')
  await page.getByTestId('settings-provider').selectOption('anthropic')
  await expect(page.getByTestId('settings-common-model')).toHaveValue('claude-fable-5-1')
  await expect(page.getByTestId('settings-protocol')).toHaveValue('anthropic-messages')
  await page.getByTestId('settings-common-model').selectOption('claude-sonnet-5')
  await expect(page.getByTestId('settings-model')).toHaveValue('claude-sonnet-5')
  await page.getByTestId('settings-provider').selectOption('custom')
  await expect(page.locator('#settings-details')).toHaveAttribute('open', '')
})

test('switching model providers never silently reuses the previous provider key', async ({ page }) => {
  await page.goto('/ai/')
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://first.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('fixture')
  await page.getByTestId('settings-key').fill('first-provider-secret')
  await page.getByTestId('settings-save').click()
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('settings-key')).toHaveValue('')
  await page.getByTestId('settings-provider').selectOption('deepseek')
  await expect(page.getByTestId('settings-key')).toHaveAttribute('placeholder', 'Enter provider API key')
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-error')).toBeVisible()
  await expect(page.locator('#settings-error')).toContainText('API key')
  await expect(page.locator('#settings-dialog')).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes('first-provider-secret'))).toBe(false)
})
