import { referenceAnnotatedInput } from '../../scripts/benchmarks/engineering-drawing-tasks.mjs'
import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createKJDrawSDK, openKjpPackage } from '../../packages/kjdraw-sdk/src/index.js'
import { mountingProfile } from '../../packages/kjdraw-sdk/examples/fixtures/mounting-profile.mjs'
import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../../packages/kjdraw-sdk/examples/fixtures/road-design.mjs'
import { buildRoadDrawing } from '../../packages/kjdraw-sdk/src/road-drawing.js'
import { restoreRoadDrawingRecipe } from '../../packages/kjdraw-sdk/src/road-drawing-recipe.js'

function patternProfile(revision = 0) {
  const source = mountingProfile(revision)
  return {
    expectedRevision: source.expectedRevision, units: source.units,
    lines: source.lines.map(({ start, end }) => [start.x, start.y, end.x, end.y]),
    circles: source.circles.slice(0, 1).map(({ center, radius }) => [center.x, center.y, radius]),
    arcs: source.arcs.map(({ center, radius, startDegrees, endDegrees }) => [center.x, center.y, radius, startDegrees, endDegrees]),
    polylines: source.polylines.map(({ vertices, closed }) => ({ points: vertices.map(({ x, y }) => [x, y]), closed })),
    arrays: [{ sources: ['circles:0'], rows: 2, columns: 2, dx: 100, dy: 40 }],
  }
}

const wire = (calls = [], text = '') => ({ choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: {
  role: 'assistant', content: text || null,
  tool_calls: calls.map(([id, name, args = {}]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
} }] })
async function openChat(page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'chat-ui-drawing', units: 'millimeter' })
  await page.locator('#file-input').setInputFiles({ name: 'chat.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(document, { format: 'KJD' })) })
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.locator('#agent-tab').click()
  await expect(page.locator('#chat-input')).toBeVisible()
}
async function connect(page) {
  await page.getByRole('button', { name: 'Connect model', exact: true }).click()
  await page.locator('#chat-endpoint').fill('/api/model')
  await page.locator('#chat-model').fill('browser-fixture')
  await page.locator('#chat-protocol').selectOption('chat-completions')
  await page.getByRole('button', { name: 'Use this connection', exact: true }).click()
}
async function send(page, text) {
  await page.locator('#chat-input').fill(text)
  await page.locator('#chat-send').click()
}
async function snapshot(page, width, name) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
  await mkdir('.cache/agent-chat', { recursive: true })
  await page.screenshot({ path: `.cache/agent-chat/${name}-${width}.png` })
}

test('chat queries the real drawing, previews native geometry, applies once, saves and undoes', async ({ page }) => {
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  await openChat(page)
  await page.evaluate(() => {
    window.chatProgressText = []
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) window.chatProgressText.push(node.textContent)
    }).observe(document.querySelector('#chat-messages'), { childList: true, subtree: true })
  })
  await page.route('**/api/model', async route => {
    const body = route.request().postDataJSON(); requests.push(body)
    expect(body.tools.map(tool => tool.function.name).sort()).toEqual(['cad_read_drawing', 'cad_read_page', 'cad_query_drawing', 'cad_read_layouts', 'cad_measure_distance', 'cad_check_geometry', 'cad_propose_move', 'cad_propose_drawing_pattern', 'cad_propose_drawing_annotated'].sort())
    if (requests.length === 1) return route.fulfill({ json: wire([['read', 'cad_read_drawing']]) })
    const result = JSON.parse(body.messages.at(-1).content)
    expect(result.ok).toBe(true)
    expect(result.value.documentId).toBe('chat-ui-drawing')
    expect(result.value.entities).toEqual([])
    expect(result.value.units).toBe('millimeter')
    return route.fulfill({ json: wire([['profile', 'cad_propose_drawing_pattern', patternProfile(result.value.revision)]], 'A 120 × 60 mm plate with four holes and one slot is ready to review.') })
  })
  await connect(page)
  await send(page, 'Draw a 120 × 60 mm mounting plate with four radius-3 holes at (10,10), (110,10), (110,50), (10,50), and a 20 × 10 mm straight slot centered at (60,30).')
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeEnabled()
  expect(requests).toHaveLength(2)
  const progressText = await page.evaluate(() => window.chatProgressText.join('\n'))
  expect(progressText).toContain('Reading drawing context…')
  expect(progressText).toContain('Preparing a drawing proposal…')
  expect(requests[0].messages.some(message => message.content?.includes('120 × 60'))).toBe(true)
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.getByRole('button', { name: 'Preview on drawing', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await snapshot(page, 1440, 'review')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText('9 entities')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const download = await downloadEvent, reopened = await openKjpPackage(await readFile(await download.path()))
  const entities = reopened.activeDocument.listEntities()
  expect(entities.map(entity => entity.type).sort()).toEqual(['ARC', 'ARC', 'CIRCLE', 'CIRCLE', 'CIRCLE', 'CIRCLE', 'LINE', 'LINE', 'LWPOLYLINE'])
  const centers = entities.filter(entity => entity.type === 'CIRCLE').map(entity => entity.payload.center).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  expect(centers).toEqual([[10,10,0], [10,50,0], [110,10,0], [110,50,0]])
  await page.getByRole('button', { name: 'Undo this change', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await expect(page.locator('#chat-messages')).toContainText('Change undone.')
  expect(errors).toEqual([])
})

test('chat refuses unadvertised legacy creation tools without applying a proposal', async ({ page }) => {
  await openChat(page)
  await page.route('**/api/model', route => route.fulfill({ json: wire([['legacy', 'cad_propose_drawing', mountingProfile()]], 'The model claims this was created.') }))
  await connect(page)
  await send(page, 'Draw a plate.')
  await expect(page.locator('#chat-messages')).toContainText('The request could not be completed.')
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0)
})

test('disconnected chat and invalid external connections never send drawing data', async ({ page }) => {
  const requests = []
  await openChat(page)
  await page.route('**/api/model', route => { requests.push(route.request()); return route.fulfill({ json: wire([], 'Unexpected') }) })
  await send(page, 'Inspect this private drawing')
  await expect(page.locator('#chat-messages')).toContainText('Connect a model')
  await expect(page.locator('#chat-input')).toHaveValue('Inspect this private drawing')
  await page.locator('#chat-endpoint').fill('https://example.com/api/model')
  await page.locator('#chat-model').fill('fixture')
  await page.getByRole('button', { name: 'Use this connection', exact: true }).click()
  await expect(page.locator('.chat-error')).toContainText('same-origin')
  expect(requests).toHaveLength(0)
  await page.locator('#chat-endpoint').fill('/api/model')
  await page.getByRole('button', { name: 'Use this connection', exact: true }).click()
  await page.getByRole('button', { name: 'Model configured · fixture', exact: true }).click()
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await page.locator('#chat-send').click()
  expect(requests).toHaveLength(0)
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
})

for (const action of ['stop', 'switch document', 'new conversation']) {
  test(`chat ${action} ignores a late model proposal`, async ({ page }) => {
    await openChat(page)
    let release, arrived
    const gate = new Promise(resolve => { release = resolve }), requestStarted = new Promise(resolve => { arrived = resolve })
    await page.route('**/api/model', async route => {
      arrived(); await gate
      await route.fulfill({ json: wire([['late', 'cad_propose_drawing_pattern', patternProfile()]], 'LATE MODEL RESPONSE') }).catch(() => {})
    })
    await connect(page)
    await send(page, 'Draw the plate')
    await requestStarted
    await expect(page.locator('#chat-stop')).toBeVisible()
    if (action === 'stop') await page.locator('#chat-stop').click()
    else if (action === 'switch document') {
      const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'replacement-drawing', units: 'meter' })
      await page.locator('#file-input').setInputFiles({ name: 'replacement.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(document, { format: 'KJD' })) })
    }
    else await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    release()
    await expect(page.locator('#chat-input')).toBeEnabled()
    if (action === 'stop') await expect(page.locator('#chat-messages')).toContainText('Stopped.')
    await expect(page.locator('#chat-messages')).not.toContainText('LATE MODEL RESPONSE')
    await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0)
    if (action !== 'switch document') await expect(page.locator('#entity-count')).toHaveText('0 entities')
    else await expect(page.locator('.chat-context')).toContainText('meter')
  })
}

test('Chinese IME, newlines and long untrusted text remain usable at 390 pixels', async ({ page }) => {
  await openChat(page)
  let requests = 0
  const hostile = '<img src=x onerror="window.chatInjected=true">' + '长文本ABC'.repeat(160)
  await page.route('**/api/model', route => { requests++; return route.fulfill({ json: wire([], hostile) }) })
  await connect(page)
  await page.locator('#language').click()
  await page.setViewportSize({ width: 390, height: 844 })
  if (!(await page.locator('.right-panel').isVisible())) await page.locator('#toggle-inspector').click()
  await page.locator('#agent-tab').click()
  await page.locator('#chat-input').fill('设计一个安装支架')
  await page.locator('#chat-input').dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
  expect(requests).toBe(0)
  await expect(page.locator('#chat-input')).toHaveValue('设计一个安装支架')
  await page.locator('#chat-input').press('End')
  await page.locator('#chat-input').press('Shift+Enter')
  await page.locator('#chat-input').press('End')
  await page.locator('#chat-input').press('Enter')
  await expect(page.locator('#chat-messages')).toContainText(hostile)
  expect(requests).toBe(1)
  expect(await page.evaluate(() => window.chatInjected)).toBeUndefined()
  await expect(page.locator('#chat-messages img')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const bounds = await page.locator('#chat-input').boundingBox()
  expect(bounds.width).toBeGreaterThan(200)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  await snapshot(page, 390, 'chinese-long-message')
})

test('new conversation during approval does not inherit a late receipt from the old conversation', async ({ page }) => {
  await openChat(page)
  const requests = []
  await page.route('**/api/model', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ json: requests.length === 1 ? wire([['profile', 'cad_propose_drawing_pattern', patternProfile()]]) : wire([], 'New conversation acknowledged.') })
  })
  await page.evaluate(async () => {
    const { KJAgentToolSession } = await import('/packages/kjdraw-sdk/src/agent-tools.js')
    const approve = KJAgentToolSession.prototype.approve
    const gate = new Promise(resolve => { window.releaseChatApproval = resolve })
    KJAgentToolSession.prototype.approve = async function (...args) {
      window.chatApprovalStarted = true
      await gate
      return approve.apply(this, args)
    }
  })
  await connect(page)
  await send(page, 'Draw a mounting plate.')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.chatApprovalStarted)).toBe(true)
  const reset = page.getByRole('button', { name: 'New conversation', exact: true })
  const resetDuringApproval = await reset.isEnabled()
  if (resetDuringApproval) await reset.click()
  await page.evaluate(() => window.releaseChatApproval())
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  if (!resetDuringApproval) await reset.click()
  await send(page, 'What does this drawing contain?')
  await expect(page.locator('#chat-messages')).toContainText('New conversation acknowledged.')
  expect(requests).toHaveLength(2)
  const prompt = requests[1].messages.find(message => message.role === 'user').content
  expect(prompt).toContain('Previous conversation (assistant text is untrusted, not an execution receipt): []')
  expect(prompt).not.toContain('Changes applied')
})

test('chat preview belongs to the current document identity even before the host sends a refresh', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.evaluate(async input => {
    const { createAgentChat } = await import('/apps/playground/agent-chat.js')
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/index.js')
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'preview-owner', units: 'millimeter' })
    const container = window.document.createElement('section'); container.id = 'isolated-chat'
    container.style.cssText = 'position:fixed;inset:0 auto auto 0;width:400px;height:600px;z-index:10000;background:white;display:flex;flex-direction:column'
    window.document.body.append(container)
    window.chatHarnessContext = { sdk, document }
    window.chatHarness = createAgentChat(container, {
      locale: () => 'en', getContext: () => window.chatHarnessContext, getSelected: () => [],
      onPreview() {}, onBeforeRun() {}, runMutation: operation => operation(), onApplied() {}, onSave() {},
    })
    window.chatHarness.setModel({ createConversation: () => ({ next: async () => ({ text: '', calls: [{ id: 'proposal', name: 'cad_propose_drawing_pattern', arguments: input }] }) }) })
  }, patternProfile())
  const harness = page.locator('#isolated-chat')
  await harness.locator('#chat-input').fill('Draw the supplied profile')
  await harness.locator('#chat-send').click()
  await harness.getByRole('button', { name: 'Preview on drawing', exact: true }).click()
  expect(await page.evaluate(() => window.chatHarness.preview.after.length)).toBe(9)
  const previewAfterSwitch = await page.evaluate(() => {
    const sdk = window.chatHarnessContext.sdk
    window.chatHarnessContext = { sdk, document: sdk.createDocument({ documentId: 'new-preview-owner', units: 'millimeter' }) }
    return window.chatHarness.preview
  })
  expect(previewAfterSwitch).toBeNull()
})

test('an old chat undo cannot erase a later manual edit', async ({ page }) => {
  await openChat(page)
  await page.route('**/api/model', route => route.fulfill({ json: wire([['profile', 'cad_propose_drawing_pattern', patternProfile()]]) }))
  await connect(page)
  await send(page, 'Draw a mounting plate.')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText('9 entities')
  for (const command of ['POINT', '200,200']) {
    await page.locator('#command-input').fill(command)
    await page.locator('#command-input').press('Enter')
    await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  }
  await page.locator('#command-input').press('Escape')
  await expect(page.locator('#entity-count')).toHaveText('10 entities')
  const revision = await page.locator('#revision').textContent()
  await page.getByRole('button', { name: 'Undo this change', exact: true }).click()
  await expect(page.locator('#chat-messages')).toContainText('The drawing changed.')
  await expect(page.locator('#entity-count')).toHaveText('10 entities')
  await expect(page.locator('#revision')).toHaveText(revision)
})

test('geometry validation shows real failed requirements even when the model claims success', async ({ page }) => {
  await openChat(page)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'checked-drawing', units: 'millimeter' })
  await document.transact('measurable line', transaction => transaction.createEntity('LINE', { start: [0,0,0], end: [10,0,0] }, { id: 'measured-line' }))
  await page.locator('#file-input').setInputFiles({ name: 'checked-line.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(document, { format: 'KJD' })) })
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  const revision = await page.locator('#revision').textContent(), requests = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/model', async route => {
    const body = route.request().postDataJSON(); requests.push(body)
    if (requests.length === 1) return route.fulfill({ json: wire([['read', 'cad_read_drawing']]) })
    const result = JSON.parse(body.messages.at(-1).content)
    expect(result.ok).toBe(true)
    if (requests.length === 2) {
      expect(result.value.entities).toHaveLength(1)
      expect(result.value.entities[0].id).toBe('measured-line')
      return route.fulfill({ json: wire([['check', 'cad_check_geometry', {
        expectedRevision: result.value.revision, units: result.value.units,
        lineLengths: [{ id: 'required-length', objectId: result.value.entities[0].id, expected: 12, tolerance: 0.01 }],
        circleRadii: [], pointDistances: [], polylineClosures: [],
      }]]) })
    }
    expect(result.value.documentId).toBe('checked-drawing')
    expect(result.value.passed).toBe(false)
    expect(result.value.checks).toHaveLength(1)
    expect(result.value.checks[0]).toMatchObject({ id: 'required-length', kind: 'line-length', actual: 10, expected: 12, tolerance: 0.01, passed: false })
    return route.fulfill({ json: wire([], 'All requirements passed. The drawing is perfect.') })
  })
  await connect(page)
  await send(page, 'Check whether this line has length 12 mm within 0.01 mm tolerance.')
  const validation = page.locator('.chat-validation')
  await expect(validation).toBeVisible()
  await expect(validation).toContainText('Failed')
  await expect(validation).toContainText('required-length')
  const requirement = validation.locator('tbody tr[data-check-id="required-length"]')
  await expect(requirement).toHaveAttribute('data-passed', 'false')
  await expect(requirement.locator('[data-field="actual"]')).toHaveText('10')
  await expect(requirement.locator('[data-field="expected"]')).toHaveText('12')
  await expect(requirement.locator('[data-field="tolerance"]')).toHaveText('0.01')
  await expect(page.locator('#chat-messages')).toContainText('All requirements passed. The drawing is perfect.')
  await expect(validation).not.toContainText('The drawing is perfect')
  expect(requests).toHaveLength(3)
  await expect(page.locator('#revision')).toHaveText(revision)
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0)
  const downloadEvent = page.waitForEvent('download')
  await page.locator('#save').click()
  const download = await downloadEvent, reopened = await openKjpPackage(await readFile(await download.path()))
  expect(reopened.activeDocument.getObject('measured-line').payload).toEqual(document.getObject('measured-line').payload)
  expect(reopened.activeDocument.revision).toBe(document.revision)
  expect(errors).toEqual([])
  await snapshot(page, 1440, 'failed-geometry-validation')
})


test('engineering proposal previews native dimensions and dashed layers, then saves the reviewed drawing', async ({ page }) => {
  await openChat(page)
  await page.route('**/api/model', route => route.fulfill({ json: wire([['engineering', 'cad_propose_drawing_annotated', referenceAnnotatedInput()]], 'Engineering UI fixture: review the two-view drawing.') }))
  await connect(page)
  await send(page, 'Create the supplied engineering drawing for UI conformance testing.')
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeEnabled()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText('70 entities')
  await page.locator('#fit-ribbon').click()
  await snapshot(page, 1440, 'engineering-annotated-applied')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const download = await downloadPromise
  const bytes = await readFile(await download.path())
  const project = await openKjpPackage(bytes)
  const saved = project.activeDocument
  expect(saved.listEntities({ownerId:saved.snapshot().spaces.modelSpaceId}).filter(e=>e.type==='DIMENSION')).toHaveLength(14)
  expect(saved.getTable('layers').records.some(e=>e.name==='HIDDEN')).toBe(true)
  await page.getByRole('button', { name: 'Undo this change', exact: true }).click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
})


test('chat attaches the actual current drawing view only when explicitly selected', async ({ page }) => {
  await openChat(page)
  const requests=[]
  await page.route('**/api/model', route => { requests.push(route.request().postDataJSON()); return route.fulfill({json:wire([], 'Image transport fixture received.')}) })
  await connect(page)
  await send(page, 'Inspect this document without an image.')
  await expect(page.locator('#chat-messages')).toContainText('Image transport fixture received.')
  expect(typeof requests[0].messages.at(-1).content).toBe('string')
  await page.locator('#chat-attach-view').check()
  await send(page, 'Inspect the current visible drawing image.')
  await expect(page.locator('.chat-view-thumbnail')).toBeVisible()
  await expect.poll(()=>requests.length).toBe(2)
  const content=requests[1].messages.at(-1).content
  expect(content[0].type).toBe('text')
  expect(content[0].text).toContain('chat-ui-drawing')
  expect(content[0].text).toContain('renderReport')
  expect(content[1].type).toBe('image_url')
  expect(content[1].image_url.url).toMatch(/^data:image\/png;base64,iVBOR/)
  expect(content[1].image_url.url).toBe(await page.locator('.chat-view-thumbnail').getAttribute('src'))
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
})

test('meter chat session previews every road entity and resource before approval, then saves and undoes once', async ({ page }) => {
  test.setTimeout(120_000)
  await openChat(page)
  const sdk=createKJDrawSDK(), document=sdk.createDocument({documentId:'chat-road-document',units:'meter'})
  await page.locator('#file-input').setInputFiles({name:'road-empty.kjd',mimeType:'application/json',buffer:Buffer.from(await sdk.writeDocument(document,{format:'KJD'}))})
  await expect(page.locator('.chat-context')).toContainText('meter')
  const compiled=buildRoadDrawing(createRoadDesignFixture(),roadDrawingFixtureOptions), requests=[], errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.evaluate(async()=>{
    const {KJCanvasRenderer}=await import('/packages/kjdraw-sdk/src/canvas-renderer.js'), original=KJCanvasRenderer.prototype.drawPreview
    window.roadPreviewBatches=[]
    KJCanvasRenderer.prototype.drawPreview=function(entities,color,offset,resources){
      const result=original.call(this,entities,color,offset,resources)
      if(entities.length>64) window.roadPreviewBatches.push({ids:entities.map(entity=>entity.id),resources:(resources??[]).map(resource=>({id:resource.id,type:resource.type,name:resource.name})),camera:{...this.camera}})
      return result
    }
  })
  await page.route('**/api/model',async route=>{
    const body=route.request().postDataJSON();requests.push(body)
    expect(body.tools.some(tool=>tool.function.name==='cad_propose_road_drawing')).toBe(true)
    if(requests.length===1)return route.fulfill({json:wire([['read-road','cad_read_drawing']])})
    const read=JSON.parse(body.messages.at(-1).content)
    expect(read.ok).toBe(true);expect(read.value).toMatchObject({documentId:'chat-road-document',units:'meter',revision:0})
    return route.fulfill({json:wire([['road-study','cad_propose_road_drawing',{...createRoadDesignFixture(),...roadDrawingFixtureOptions,expectedRevision:read.value.revision}]],'UI protocol fixture: road study proposed from supplied data; review before applying.')})
  })
  await connect(page)
  await send(page,'For this UI conformance fixture, compile the supplied 600 m road input, profile, cross sections and quantities for review.')
  await expect(page.getByRole('button',{name:'Apply changes',exact:true})).toBeEnabled()
  await expect(page.locator('.chat-road-evidence')).toHaveAttribute('data-entity-count',String(compiled.entities.length))
  await expect(page.locator('.chat-road-evidence [data-field="roadLength"]')).toContainText('600')
  await expect(page.locator('.chat-road-evidence [data-field="roadSections"]')).toContainText(String(compiled.calculation.sections.length))
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  const revision=await page.locator('#revision').textContent()
  await page.getByRole('button',{name:'Preview on drawing',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.roadPreviewBatches.length)).toBeGreaterThan(0)
  const preview=await page.evaluate(()=>window.roadPreviewBatches.at(-1))
  expect(preview.ids).toEqual(compiled.entities.map(entity=>entity.options.id))
  expect(preview.resources.map(resource=>resource.id).sort()).toEqual([...compiled.resources.layers,...compiled.resources.linetypes].map(resource=>resource.id).sort())
  expect(preview.camera.centerX).toBeCloseTo((compiled.bounds[0]+compiled.bounds[2])/2,6)
  expect(preview.camera.centerY).toBeCloseTo((compiled.bounds[1]+compiled.bounds[3])/2,6)
  await expect(page.locator('#entity-count')).toHaveText('0 entities');await expect(page.locator('#revision')).toHaveText(revision)
  await snapshot(page,1440,'road-full-preview')
  await page.getByRole('button',{name:'Apply changes',exact:true}).click()
  await expect(page.locator('#entity-count')).toHaveText(`${compiled.entities.length} entities`)
  await snapshot(page,1440,'road-approved')
  const downloadPromise=page.waitForEvent('download')
  await page.getByRole('button',{name:'Save project',exact:true}).click()
  const download=await downloadPromise, project=await openKjpPackage(await readFile(await download.path())), saved=project.activeDocument
  expect(saved.id).toBe('chat-road-document');expect(saved.snapshot().header.units).toBe('meter')
  const recipe=project.manifest.metadata.roadDrawingRecipes[`${saved.id}:${roadDrawingFixtureOptions.drawingId}`]
  expect(recipe.input).toEqual(createRoadDesignFixture())
  const restored=await restoreRoadDrawingRecipe(saved,recipe)
  expect(restored.drawing.entities.length).toBe(compiled.entities.length)
  expect(restored.drawing.calculation.totalVolume).toEqual(compiled.calculation.totalVolume)
  expect(saved.listEntities()).toHaveLength(compiled.entities.length)
  expect(saved.getTable('layers').records.filter(layer=>layer.name.includes('_ROAD_'))).toHaveLength(compiled.resources.layers.length)
  expect(saved.getTable('linetypes').records.find(type=>type.name.endsWith('_ROAD_GROUND')).payload.pattern).toEqual([3,-1])
  const total=compiled.entities.find(entity=>entity.key==='profile/volume-table/row/total/cell/4')
  expect(saved.getObject(total.options.id).payload.text).toBe(compiled.calculation.totalVolume.fill.toFixed(3))
  await page.getByRole('button',{name:'Undo this change',exact:true}).click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  expect(requests).toHaveLength(2);expect(errors).toEqual([])
})

test('millimeter chat omits and rejects the meter road tool', async ({ page }) => {
  await openChat(page)
  await page.route('**/api/model',route=>{
    const body=route.request().postDataJSON()
    expect(body.tools.some(tool=>tool.function.name==='cad_propose_road_drawing')).toBe(false)
    return route.fulfill({json:wire([['wrong-units','cad_propose_road_drawing',{...createRoadDesignFixture(),...roadDrawingFixtureOptions,expectedRevision:0}]])})
  })
  await connect(page);await send(page,'Protocol test: a road request in a millimeter drawing must not be dispatched.')
  await expect(page.locator('#chat-messages')).toContainText('The request could not be completed.')
  await expect(page.getByRole('button',{name:'Apply changes',exact:true})).toHaveCount(0)
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
})

test('image attachment label and existing thumbnail follow locale changes without changing selection', async ({ page }) => {
  await openChat(page)
  await page.route('**/api/model',route=>route.fulfill({json:wire([],'Image locale fixture received.')}))
  await connect(page);await page.locator('#chat-attach-view').check()
  await send(page,'Attach the current view for this locale fixture.')
  await expect(page.locator('.chat-view-thumbnail')).toHaveAttribute('alt','Current drawing view sent to the model')
  await expect(page.locator('.chat-attach-view')).toContainText('Attach current view')
  await page.locator('#language').click()
  await expect(page.locator('.chat-attach-view')).toContainText('附上当前视图')
  await expect(page.locator('.chat-view-thumbnail')).toHaveAttribute('alt','发送给模型的当前图纸视图')
  await expect(page.locator('#chat-attach-view')).toBeChecked()
  await page.locator('#language').click()
  await expect(page.locator('.chat-attach-view')).toContainText('Attach current view')
  await expect(page.locator('.chat-view-thumbnail')).toHaveAttribute('alt','Current drawing view sent to the model')
  await expect(page.locator('#chat-attach-view')).toBeChecked()
})

test('parameter bookkeeping failure reports applied geometry accurately and never repeats approval',async({page})=>{
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.evaluate(async input=>{
    const {createAgentChat}=await import('/apps/playground/agent-chat.js')
    const {createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/sdk.js')
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'}),container=document.createElement('section')
    container.id='bookkeeping-failure-chat';container.style.cssText='position:fixed;inset:0 auto auto 0;width:420px;height:700px;z-index:10000;background:white;display:flex;flex-direction:column';document.body.append(container)
    window.bookkeepingDrawing=drawing;window.bookkeepingCalls=0
    const chat=createAgentChat(container,{locale:()=> 'en',getContext:()=>({sdk,document:drawing}),getSelected:()=>[],onPreview(){},onBeforeRun(){},runMutation:operation=>operation(),onApplied(){},onSave(){},onProposalApplied(){window.bookkeepingCalls++;throw new Error('parameter store unavailable')}})
    chat.setModel({createConversation:()=>({next:async()=>({text:'Protocol fixture',calls:[{id:'geometry',name:'cad_propose_drawing_pattern',arguments:input}]})})})
  },patternProfile())
  const chat=page.locator('#bookkeeping-failure-chat')
  await chat.locator('#chat-input').fill('Test successful geometry with failed host parameter storage.')
  await chat.locator('#chat-send').click()
  await chat.getByRole('button',{name:'Apply changes',exact:true}).click()
  await expect(chat.locator('.chat-proposal-state')).toContainText('Changes applied · REV 1')
  await expect(chat.locator('.chat-proposal-state')).toContainText('Design parameters were not saved.')
  await expect(chat.getByRole('button',{name:'Apply changes',exact:true})).toHaveCount(0)
  expect(await page.evaluate(()=>({calls:window.bookkeepingCalls,revision:window.bookkeepingDrawing.revision,count:window.bookkeepingDrawing.listEntities().length}))).toEqual({calls:1,revision:1,count:9})
  await chat.getByRole('button',{name:'Undo this change',exact:true}).click()
  expect(await page.evaluate(()=>window.bookkeepingDrawing.listEntities().length)).toBe(0)
})

test('reopened road project revises the same drawing in chat, preserves external objects and saves updated parameters', async ({page})=>{
  test.setTimeout(120000)
  const {KJProjectSession}=await import('../../packages/kjdraw-sdk/src/project-session.js')
  const {createRoadDrawingRecipe}=await import('../../packages/kjdraw-sdk/src/road-drawing-recipe.js')
  const {applyRoadDrawingRevision}=await import('../../packages/kjdraw-sdk/src/road-drawing-update.js')
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'chat-road-reopen',units:'meter'})
  const input=createRoadDesignFixture(),original=buildRoadDrawing(input,roadDrawingFixtureOptions)
  await sdk.executeCommand('CREATEBATCH',{entities:original.entities,resources:original.resources},{document:drawing})
  await sdk.executeCommand('CREATE',{type:'POINT',payload:{position:[449990,3300000,0]}},{document:drawing})
  const outside=drawing.listEntities({type:'POINT'})[0],key=`${drawing.id}:${roadDrawingFixtureOptions.drawingId}`
  const recipe=await createRoadDrawingRecipe(drawing,input,roadDrawingFixtureOptions)
  const project=KJProjectSession.create({sdk,documents:[drawing],metadata:{hostSecret:'never-send-project-metadata',roadDrawingRecipes:{[key]:recipe}}})
  const packageBytes=await project.package(),before=drawing.serialize()
  const revisedInput=structuredClone(input)
  revisedInput.pavement.leftWidth+=.5;revisedInput.pavement.rightWidth+=.5
  revisedInput.profile.forEach(point=>point.elevation+=.25)
  const revised=buildRoadDrawing(revisedInput,roadDrawingFixtureOptions),branch=drawing.fork()
  const expectedReceipt=await applyRoadDrawingRevision(branch,original,revised,{expectedRevision:drawing.revision})
  const requests=[],errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await openChat(page)
  await page.locator('#file-input').setInputFiles({name:'saved-road.kjp',mimeType:'application/octet-stream',buffer:Buffer.from(packageBytes)})
  await expect(page.locator('#entity-count')).toHaveText(`${original.entities.length+1} entities`)
  await page.locator('#agent-tab').click()
  await page.evaluate(async()=>{
    const {KJCanvasRenderer}=await import('/packages/kjdraw-sdk/src/canvas-renderer.js'),draw=KJCanvasRenderer.prototype.drawPreview
    window.roadRevisionPreviews=[]
    KJCanvasRenderer.prototype.drawPreview=function(entities,color,offset,resources){
      const result=draw.call(this,entities,color,offset,resources)
      if(['#e6a04b','#77a7ff'].includes(color)){window.roadRevisionPreviews.push({color,entities:entities.map(({id,type,payload})=>({id,type,payload})),source:this.document.serialize(),resources:(resources??[]).map(resource=>resource.id)});if(window.roadRevisionPreviews.length>4)window.roadRevisionPreviews.shift()}
      return result
    }
  })
  await page.route('**/api/model',async route=>{
    const body=route.request().postDataJSON();requests.push(body)
    expect(body.tools.some(tool=>tool.function.name==='cad_propose_road_revision')).toBe(true)
    const userText=body.messages.filter(message=>message.role==='user').map(message=>message.content).join('\n')
    expect(userText).toContain('Verified saved road designs')
    expect(userText).toContain(roadDrawingFixtureOptions.drawingId)
    expect(userText).toContain('"leftWidth":3.5')
    expect(userText).not.toContain('never-send-project-metadata')
    expect(userText).not.toContain('3300000')
    expect(userText).not.toContain('"ground"')
    if(requests.length%2===1)return route.fulfill({json:wire([['read-reopen','cad_read_drawing']])})
    const read=JSON.parse(body.messages.at(-1).content)
    expect(read.ok).toBe(true);expect(read.value.documentId).toBe(drawing.id)
    return route.fulfill({json:wire([['revise-road','cad_propose_road_revision',{expectedRevision:read.value.revision,units:'meter',drawingId:roadDrawingFixtureOptions.drawingId,leftWidthDelta:requests.length>2?.25:.5,rightWidthDelta:requests.length>2?.25:.5,elevationDelta:requests.length>2?0:.25}]],'Protocol fixture: review the proposed width and elevation change.')})
  })
  await connect(page)
  await send(page,`Modify saved drawing ${roadDrawingFixtureOptions.drawingId}: add 0.5 m to each pavement side and raise all design profile elevations 0.25 m. Keep its supplied terrain and identity.`)
  await expect(page.getByRole('button',{name:'Apply changes',exact:true})).toBeEnabled()
  const format=value=>value.toLocaleString('en-US',{maximumFractionDigits:3})
  for(const [field,oldValue,newValue] of [['roadCut',original.calculation.totalVolume.cut,revised.calculation.totalVolume.cut],['roadFill',original.calculation.totalVolume.fill,revised.calculation.totalVolume.fill]]){
    await expect(page.locator(`[data-field="${field}"]`)).toContainText(`${format(oldValue)} → ${format(newValue)}`)
  }
  await expect(page.locator('[data-field="roadDrawing"]')).toContainText(roadDrawingFixtureOptions.drawingId)
  await expect(page.locator('[data-field="roadUpdated"]')).toContainText(String(expectedReceipt.updatedIds.length))
  await expect(page.locator('[data-field="roadCreated"]')).toContainText(String(expectedReceipt.createdIds.length))
  await expect(page.locator('[data-field="roadRemoved"]')).toContainText(String(expectedReceipt.removedIds.length))
  await page.getByRole('button',{name:'Preview on drawing',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.roadRevisionPreviews.length)).toBeGreaterThan(0)
  const previews=await page.evaluate(()=>window.roadRevisionPreviews)
  expect(previews.every(preview=>preview.source===before)).toBe(true)
  const native=(document,id)=>{const {type,payload}=document.getObject(id);return {id,type,payload}}
  const expectedBefore=[...expectedReceipt.updatedIds,...expectedReceipt.removedIds].map(id=>native(drawing,id))
  const expectedAfter=[...expectedReceipt.updatedIds,...expectedReceipt.createdIds].map(id=>native(branch,id))
  const beforeBatches=previews.filter(preview=>preview.color==='#e6a04b'),afterBatches=previews.filter(preview=>preview.color==='#77a7ff')
  expect(beforeBatches.length).toBeGreaterThan(0);expect(afterBatches.length).toBeGreaterThan(0)
  for(const batch of beforeBatches)expect(batch.entities).toEqual(expectedBefore)
  for(const batch of afterBatches)expect(batch.entities).toEqual(expectedAfter)
  await snapshot(page,1440,'road-revision-preview')
  await page.getByRole('button',{name:'Apply changes',exact:true}).click()
  await expect(page.locator('.chat-proposal-state')).toContainText('Changes applied')
  await expect(page.locator('.chat-proposal-state')).not.toContainText('not saved')
  let lastSavedBytes
  const save=async selector=>{
    const promised=page.waitForEvent('download');await page.locator(selector).click()
    lastSavedBytes=await readFile(await (await promised).path());return openKjpPackage(lastSavedBytes)
  }
  const applied=await save('#save'),updated=applied.activeDocument
  expect(updated.id).toBe(drawing.id)
  expect(updated.getObject(outside.id)).toEqual(outside)
  expect(updated.listEntities().map(entity=>entity.id).sort()).toEqual(drawing.listEntities().map(entity=>entity.id).sort())
  const updatedRecipe=applied.manifest.metadata.roadDrawingRecipes[key]
  expect(updatedRecipe.input).toEqual(revisedInput)
  const restored=await restoreRoadDrawingRecipe(updated,updatedRecipe)
  expect(restored.drawing.calculation.totalVolume).toEqual(revised.calculation.totalVolume)
  const table=revised.entities.find(entity=>entity.key==='profile/volume-table/row/total/cell/4')
  expect(updated.getObject(table.options.id).payload.text).toBe(revised.calculation.totalVolume.fill.toFixed(3))
  await snapshot(page,1440,'road-revision-applied')
  await page.getByRole('button',{name:'Undo this change',exact:true}).click()
  await expect(page.locator('.chat-proposal-state')).toContainText('Change undone')
  const undone=await save('#save'),undoneBytes=lastSavedBytes
  // KJP canonicalizes object-key order and omits undefined values. Compare every
  // persisted entity field by stable ID, independently of dictionary enumeration.
  const persistedEntities=document=>JSON.parse(JSON.stringify(Object.fromEntries(document.listEntities().map(entity=>[entity.id,entity]))))
  expect(persistedEntities(undone.activeDocument)).toEqual(persistedEntities(drawing))
  const historical=await restoreRoadDrawingRecipe(undone.activeDocument,undone.manifest.metadata.roadDrawingRecipeHistory[key][0])
  expect(historical.recipe.input).toEqual(input)
  await page.locator('#redo').click()
  const redone=await save('#save')
  expect(persistedEntities(redone.activeDocument)).toEqual(persistedEntities(updated))
  await restoreRoadDrawingRecipe(redone.activeDocument,redone.manifest.metadata.roadDrawingRecipes[key])
  // Reload the saved Undo state: current recipe is newer than geometry, so chat
  // must recover the exact historical input before allowing another revision.
  await page.locator('#file-input').setInputFiles({name:'undone-road.kjp',mimeType:'application/octet-stream',buffer:undoneBytes})
  await expect(page.locator('#revision')).toHaveText(`REV ${undone.activeDocument.revision}`)
  await expect(page.locator('#entity-count')).toHaveText(`${original.entities.length+1} entities`)
  await page.locator('#agent-tab').click()
  await send(page,`Continue editing ${roadDrawingFixtureOptions.drawingId} from this saved Undo state: widen each side by 0.25 m without shifting elevations.`)
  await expect(page.getByRole('button',{name:'Apply changes',exact:true})).toBeEnabled()
  await expect(page.locator('.chat-proposal-state')).toContainText('Your drawing is unchanged')
  await page.getByRole('button',{name:'Apply changes',exact:true}).click()
  await expect(page.locator('.chat-proposal-state')).toContainText('Changes applied')
  await expect(page.locator('.chat-proposal-state')).not.toContainText('not saved')
  const continued=await save('#save'),continuedRecipe=continued.manifest.metadata.roadDrawingRecipes[key]
  const checked=await restoreRoadDrawingRecipe(continued.activeDocument,continuedRecipe)
  expect(checked.recipe.input.pavement.leftWidth).toBe(3.75)
  expect(checked.recipe.input.pavement.rightWidth).toBe(3.75)
  expect(checked.recipe.input.profile).toEqual(input.profile)
  expect(continued.activeDocument.getObject(outside.id)).toEqual(outside)
  await snapshot(page,1440,'road-revision-history-continued')
  expect(requests).toHaveLength(4);expect(errors).toEqual([])
  project.destroy()
})
