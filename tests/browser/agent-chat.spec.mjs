import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createKJDrawSDK, openKjpPackage } from '../../packages/kjdraw-sdk/src/index.js'
import { mountingProfile } from '../../packages/kjdraw-sdk/examples/fixtures/mounting-profile.mjs'

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
    if (requests.length === 1) return route.fulfill({ json: wire([['read', 'cad_read_drawing']]) })
    const result = JSON.parse(body.messages.at(-1).content)
    expect(result.ok).toBe(true)
    expect(result.value.documentId).toBe('chat-ui-drawing')
    expect(result.value.entities).toEqual([])
    expect(result.value.units).toBe('millimeter')
    return route.fulfill({ json: wire([['profile', 'cad_propose_drawing', mountingProfile(result.value.revision)]], 'A 120 × 60 mm plate with four holes and one slot is ready to review.') })
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
      await route.fulfill({ json: wire([['late', 'cad_propose_drawing', mountingProfile()]], 'LATE MODEL RESPONSE') }).catch(() => {})
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
    return route.fulfill({ json: requests.length === 1 ? wire([['profile', 'cad_propose_drawing', mountingProfile()]]) : wire([], 'New conversation acknowledged.') })
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
    window.chatHarness.setModel({ createConversation: () => ({ next: async () => ({ text: '', calls: [{ id: 'proposal', name: 'cad_propose_drawing', arguments: input }] }) }) })
  }, mountingProfile())
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
  await page.route('**/api/model', route => route.fulfill({ json: wire([['profile', 'cad_propose_drawing', mountingProfile()]]) }))
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
