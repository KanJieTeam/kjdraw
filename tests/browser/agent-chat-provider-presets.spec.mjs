import { expect, test } from '@playwright/test'

const base=()=>process.env.KJDRAW_PRESET_BASE_URL??'/'
const openSettings=async page=>{
  await page.goto(base())
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#ai-assistant-launcher').click()
  await page.getByRole('button',{name:'Connect model',exact:true}).click()
}

test('direct provider preset persists locally, authenticates the request and disconnect clears it',async({page})=>{
  await page.setViewportSize({width:1440,height:900})
  await openSettings(page)
  const provider=page.locator('#chat-provider'),endpoint=page.locator('#chat-endpoint'),model=page.locator('#chat-model'),common=page.locator('#chat-common-model'),protocol=page.locator('#chat-protocol'),apiKey=page.locator('#chat-api-key')
  await expect(provider.locator('option')).toHaveCount(14)

  await provider.selectOption('openai-responses')
  await expect(endpoint).toHaveValue('https://api.openai.com/v1/responses')
  await expect(model).toHaveValue('gpt-5.6-sol')
  await expect(common).toHaveValue('gpt-5.6-sol')
  await expect(protocol).toHaveValue('responses')
  await common.selectOption('gpt-5.6-terra')
  await apiKey.fill('browser-test-secret')
  let request
  await page.route('https://api.openai.com/v1/responses',route=>{
    request={headers:route.request().headers(),body:route.request().postDataJSON()}
    return route.fulfill({json:{status:'completed',output:[{id:'msg',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:'direct ready',annotations:[]}]}]}})
  })
  await page.getByRole('button',{name:'Use this connection',exact:true}).click()
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('kjdraw:model-connection:v1')))
  expect(stored).toEqual(expect.objectContaining({provider:'openai-responses',endpoint:'https://api.openai.com/v1/responses',model:'gpt-5.6-terra',protocol:'responses',apiKey:'browser-test-secret'}))

  await page.reload()
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await expect(page.locator('#ai-chat-window')).toBeVisible()
  await expect(page.getByRole('button',{name:'Model configured · gpt-5.6-terra',exact:true})).toBeVisible()
  await page.locator('#chat-input').fill('Use the restored direct connection.')
  await page.locator('#chat-send').click()
  await expect(page.locator('.chat-message-body').last()).toHaveText('direct ready')
  expect(request.headers.authorization).toBe('Bearer browser-test-secret')
  expect(request.headers['x-api-key']).toBeUndefined()
  expect(request.headers['x-goog-api-key']).toBeUndefined()
  expect(request.body.model).toBe('gpt-5.6-terra')
  expect(JSON.stringify(request.body)).not.toContain('browser-test-secret')
  await expect(page.locator('.chat-log')).not.toContainText('browser-test-secret')

  await page.getByRole('button',{name:'Model configured · gpt-5.6-terra',exact:true}).click()
  await expect(page.locator('#chat-api-key')).toHaveValue('browser-test-secret')
  const persistedBeforeCancel=await page.evaluate(()=>localStorage.getItem('kjdraw:model-connection:v1'))
  await page.locator('#chat-endpoint').fill('https://draft.invalid/v1/responses')
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  expect(await page.evaluate(()=>localStorage.getItem('kjdraw:model-connection:v1'))).toBe(persistedBeforeCancel)
  await page.getByRole('button',{name:'Model configured · gpt-5.6-terra',exact:true}).click()
  await page.locator('#chat-model').fill('draft-model')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(()=>localStorage.getItem('kjdraw:model-connection:v1'))).toBe(persistedBeforeCancel)
  await page.getByRole('button',{name:'Model configured · gpt-5.6-terra',exact:true}).click()
  await page.getByRole('button',{name:'Disconnect',exact:true}).click()
  await expect(page.getByRole('button',{name:'Connect model',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>localStorage.getItem('kjdraw:model-connection:v1'))).toBeNull()
  await page.getByRole('button',{name:'Connect model',exact:true}).click()
  await expect(page.locator('#chat-api-key')).toHaveValue('')
})

test('direct provider protocols use their required authentication headers and explain setup failures',async({page})=>{
  await page.setViewportSize({width:1024,height:768})
  await openSettings(page)
  const provider=page.locator('#chat-provider'),endpoint=page.locator('#chat-endpoint'),model=page.locator('#chat-model'),protocol=page.locator('#chat-protocol'),apiKey=page.locator('#chat-api-key')

  await provider.selectOption('anthropic')
  await page.getByRole('button',{name:'Use this connection',exact:true}).click()
  await expect(page.locator('.chat-error')).toHaveText('Enter an API key for this direct provider connection.')

  const cases=[
    {provider:'anthropic',url:'https://api.anthropic.com/v1/messages',response:{content:[{type:'text',text:'anthropic ready'}],stop_reason:'end_turn'},header:'x-api-key',value:'anthropic-key',extra:['anthropic-dangerous-direct-browser-access','true']},
    {provider:'gemini',url:'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',response:{candidates:[{finishReason:'STOP',content:{parts:[{text:'gemini ready'}]}}]},header:'x-goog-api-key',value:'gemini-key'},
    {provider:'deepseek',url:'https://api.deepseek.com/chat/completions',response:{choices:[{finish_reason:'stop',message:{role:'assistant',content:'chat ready'}}]},header:'authorization',value:'Bearer chat-key'},
  ]
  for(const item of cases){
    await provider.selectOption(item.provider);await apiKey.fill(item.value.replace(/^Bearer /,''))
    let headers
    await page.route(item.url,route=>{headers=route.request().headers();return route.fulfill({json:item.response})},{times:1})
    await page.getByRole('button',{name:'Use this connection',exact:true}).click()
    await page.locator('#chat-input').fill(`Test ${item.provider}.`);await page.locator('#chat-send').click()
    await expect.poll(()=>headers?.[item.header]).toBe(item.value)
    if(item.extra)expect(headers[item.extra[0]]).toBe(item.extra[1])
    await page.getByRole('button',{name:/^Model configured ·/}).click()
  }

  await provider.selectOption('custom');await endpoint.fill('https://blocked.invalid/v1/chat/completions');await model.fill('blocked-model');await protocol.selectOption('chat-completions');await apiKey.fill('blocked-key')
  await page.route('https://blocked.invalid/**',route=>route.abort('failed'))
  await page.getByRole('button',{name:'Use this connection',exact:true}).click()
  await page.locator('#chat-input').fill('Exercise a blocked cross-origin connection.');await page.locator('#chat-send').click()
  await expect(page.locator('.chat-message-body').last()).toHaveText('Direct model request failed. Check the endpoint, API key, network access and provider CORS policy.')
})

test('Kimi K3 uses its completion-token field without leaking the legacy field',async({page})=>{
  await page.setViewportSize({width:1024,height:768})
  await openSettings(page)
  await page.locator('#chat-provider').selectOption('kimi')
  await expect(page.locator('#chat-model')).toHaveValue('kimi-k3')
  await page.locator('#chat-api-key').fill('kimi-browser-fixture')
  let request
  await page.route('https://api.moonshot.cn/v1/chat/completions',route=>{
    request=route.request().postDataJSON()
    return route.fulfill({json:{choices:[{finish_reason:'stop',message:{role:'assistant',content:'kimi ready'}}]}})
  },{times:1})
  await page.getByRole('button',{name:'Use this connection',exact:true}).click()
  await page.locator('#chat-input').fill('Verify the Kimi wire contract.')
  await page.locator('#chat-send').click()
  await expect(page.locator('.chat-message-body').last()).toHaveText('kimi ready')
  expect(request.model).toBe('kimi-k3')
  expect(request.max_completion_tokens).toBe(4096)
  expect(request).not.toHaveProperty('max_tokens')
})

for(const viewport of [{width:1440,height:900},{width:1024,height:768}])test(`connection settings actions remain reachable and close safely at ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport)
  await openSettings(page)
  await page.locator('#chat-provider').selectOption('anthropic')
  const actions=page.locator('.chat-settings-actions')
  await actions.scrollIntoViewIfNeeded()
  await expect(actions).toBeVisible()
  const box=await actions.boundingBox()
  expect(box.y+box.height).toBeLessThanOrEqual(viewport.height)
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await expect(page.locator('.chat-settings')).toBeHidden()
  expect(await page.evaluate(()=>localStorage.getItem('kjdraw:model-connection:v1'))).toBeNull()
  await page.getByRole('button',{name:'Connect model',exact:true}).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.chat-settings')).toBeHidden()
  expect(await page.evaluate(()=>localStorage.getItem('kjdraw:model-connection:v1'))).toBeNull()
})
