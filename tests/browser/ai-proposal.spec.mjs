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
  await page.locator('#conversation-list button').click()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
})

test('imports an existing KJD, edits its entity, restores the chat, and downloads DXF', async ({ page }) => {
  const sdk = createKJDrawSDK()
  const source = sdk.createDocument({ documentId:'uploaded-line', units:'millimeter' })
  await source.transact('Source drawing', tx => {
    tx.createEntity('LINE', { start:[5,5,0], end:[45,5,0] }, { id:'seed-edge' })
  })
  const args = { expectedRevision:source.revision, units:'millimeter', ids:['seed-edge'], dx:5, dy:2 }
  await page.route('https://ai-test.invalid/v1/chat/completions', route => route.fulfill({ json: {
    id:'mock-move', object:'chat.completion', model:'browser-fixture',
    choices:[{ index:0, message:{ role:'assistant', content:'', tool_calls:[{
      id:'move-1', type:'function', function:{ name:'cad_propose_move', arguments:JSON.stringify(args) },
    }] }, finish_reason:'tool_calls' }],
  } }))
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
