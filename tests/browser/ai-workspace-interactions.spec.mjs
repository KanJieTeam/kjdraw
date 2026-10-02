import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

const endpoint = 'https://ai-workspace-fixture.invalid/v1/chat/completions'
const alternateEndpoint = 'https://ai-workspace-other.invalid/v1/chat/completions'
const fixtureKey = 'public-workspace-test-key-not-a-provider-credential'

async function saved(page) {
  return page.evaluate(async () => (await import('/apps/playground/ai/local-history.js')).loadLocalHistory())
}

async function activeSaved(page) {
  const record = await saved(page)
  return record?.sessions?.find(session => session.id === record.activeId)
}

async function nativeEntities(page) {
  const session = await activeSaved(page)
  const document = await createKJDrawSDK().readDocument(session.state.drawing, { format: 'KJD' })
  return [...document.listEntities()].sort((left, right) => left.id.localeCompare(right.id))
}

async function connect(page, { url = endpoint, key = '' } = {}) {
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(url)
  await page.getByTestId('settings-model').fill('public-protocol-fixture')
  if (key) await page.getByTestId('settings-key').fill(key)
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
}

async function openPublicDrawing(page, name = 'public-workspace.kjd') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-workspace-fixture', units: 'millimeter' })
  await document.transact('Public workspace baseline', transaction => {
    transaction.createEntity('LINE', { start: [0, 0, 0], end: [40, 0, 0] }, { id: 'public-retained-line' })
    transaction.createEntity('CIRCLE', { center: [20, 15, 0], radius: 5 }, { id: 'public-retained-circle' })
  })
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(document, { format: 'KJD' })) })
  await expect(page.locator('#drawing-name')).toHaveText(name)
  await expect.poll(async () => (await activeSaved(page))?.source?.name).toBe(name)
  return document
}

test('workspace native history preserves pin metadata but resolves only after the actual IDB completion callback', async ({ page }) => {
  // Storage-only proof uses the same origin and real module/IndexedDB without
  // an unrelated AI startup writer competing with this deliberately raw record.
  await page.route('**/__workspace-storage-fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Public native storage fixture</title>' }))
  await page.goto('/__workspace-storage-fixture__')
  const record = { version: 1, activeId: 'pinned', connection: null, sessions: [
    { id: 'pinned', pinned: true, draft: 'Public unsent draft', messages: [] }, { id: 'ordinary', pinned: false, messages: [] }, { id: 'legacy', messages: [] },
  ] }
  await page.evaluate(async value => {
    const { saveLocalHistory } = await import('/apps/playground/ai/local-history.js')
    const nativeTransaction = IDBDatabase.prototype.transaction
    const gate = window.__workspaceCommit = { delivered: false, settled: false, complete: null }
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = nativeTransaction.apply(this, args)
      if (this.name !== 'kjdraw-ai-local' || transaction.mode !== 'readwrite') return transaction
      let owner = transaction, descriptor
      while (owner && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(owner, 'oncomplete'); owner = Object.getPrototypeOf(owner) }
      if (!descriptor?.set) throw new Error('Native transaction completion descriptor is unavailable')
      Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(handler) {
        descriptor.set.call(transaction, event => { gate.delivered = true; gate.complete = () => handler.call(transaction, event) })
      } })
      return transaction
    }
    window.__workspaceSave = saveLocalHistory(value).then(() => { gate.settled = true })
  }, record)
  await expect.poll(() => page.evaluate(() => window.__workspaceCommit.delivered)).toBe(true)
  expect(await page.evaluate(() => window.__workspaceCommit.settled)).toBe(false)
  // The native transaction really committed; only delivery of its completion
  // callback to the app is held. A request-success receipt is not this barrier.
  expect(await saved(page)).toEqual(record)
  await page.evaluate(async () => { window.__workspaceCommit.complete(); await window.__workspaceSave })
  expect(await page.evaluate(() => window.__workspaceCommit.settled)).toBe(true)
  expect((await saved(page)).sessions[2]).not.toHaveProperty('pinned')
})

test('workspace pin and unpin survive reload while an old session without pinned remains usable', async ({ page }) => {
  await openPublicDrawing(page)
  await page.evaluate(async () => {
    const { loadLocalHistory, saveLocalHistory } = await import('/apps/playground/ai/local-history.js')
    const record = await loadLocalHistory()
    delete record.sessions[0].pinned
    await saveLocalHistory(record)
  })
  await page.reload()
  await expect(page.locator('#drawing-name')).toHaveText('public-workspace.kjd')
  await page.evaluate(async () => {
    const { loadLocalHistory, saveLocalHistory } = await import('/apps/playground/ai/local-history.js')
    const record = await loadLocalHistory()
    record.sessions[0].pinned = 'true'
    await saveLocalHistory(record)
  })
  await page.reload()
  await expect(page.locator('#drawing-name')).toHaveText('public-workspace.kjd')
  await page.locator('.history-menu-trigger').click()
  await page.locator('.history-menu-action').filter({ hasText: /^Pin(?: chat)?$/i }).click()
  await expect.poll(async () => (await activeSaved(page))?.pinned).toBe(true)
  await page.reload()
  expect((await activeSaved(page)).pinned).toBe(true)
  await page.locator('.history-menu-trigger').click()
  await page.locator('.history-menu-action').filter({ hasText: /^Unpin(?: chat)?$/i }).click()
  await expect.poll(async () => (await activeSaved(page))?.pinned).toBe(false)
  await page.reload()
  expect((await activeSaved(page)).pinned).toBe(false)
  expect(await nativeEntities(page)).toHaveLength(2)
})

test('workspace restored model key stays masked and cannot silently follow a changed endpoint', async ({ page }) => {
  const authorizations = []
  for (const url of [endpoint, alternateEndpoint]) await page.route(url, route => {
    authorizations.push({ url: route.request().url(), value: route.request().headers().authorization })
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: 'This was a read-only public protocol response.' }, finish_reason: 'stop' }] } })
  })
  await page.goto('/ai/')
  await connect(page, { key: fixtureKey })
  await page.reload()
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('settings-key')).toHaveValue('')
  await expect(page.getByTestId('settings-key')).toHaveAttribute('type', 'password')
  await expect(page.getByTestId('settings-key')).toHaveAttribute('placeholder', /leave blank|留空/)
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  await page.getByTestId('chat-input').fill('A public read-only message with no drawing changes.')
  await page.getByTestId('chat-send').click()
  await expect.poll(() => authorizations.length).toBe(1)
  await expect(page.getByTestId('chat-stop')).not.toBeVisible()
  expect(authorizations[0].value).toBe(`Bearer ${fixtureKey}`)
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-endpoint').fill(alternateEndpoint)
  await page.getByTestId('settings-endpoint').press('Tab')
  await expect(page.getByTestId('settings-key')).toHaveValue('')
  await expect(page.getByTestId('settings-key')).not.toHaveAttribute('placeholder', /leave blank|留空/)
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  await page.getByTestId('chat-input').fill('Another public read-only message.')
  await page.getByTestId('chat-send').click()
  await expect.poll(() => authorizations.length).toBe(2)
  expect(authorizations[1].value).toBeUndefined()
  await expect(page.getByTestId('chat-stop')).not.toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain(fixtureKey)
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes('public-workspace-test-key-not-a-provider-credential'))).toBe(false)
})

test('workspace failed upload keeps the durable original drawing and unsent draft after reload', async ({ page }) => {
  await openPublicDrawing(page)
  const originalEntities = await nativeEntities(page)
  const draft = 'Keep the existing circle unchanged; I have not submitted this draft. 未提交草稿。'
  await page.getByTestId('chat-input').fill(draft)
  await page.getByTestId('drawing-file').setInputFiles({ name: 'public-invalid.kjd', mimeType: 'application/json', buffer: Buffer.from('{invalid-native-drawing') })
  await expect(page.locator('#import-error')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect.poll(async () => (await activeSaved(page))?.draft).toBe(draft)
  expect(await nativeEntities(page)).toEqual(originalEntities)
  await page.reload()
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await expect(page.locator('#drawing-name')).toHaveText('public-workspace.kjd')
  expect(await nativeEntities(page)).toEqual(originalEntities)
})

test('workspace stopping a pending model call keeps actual native geometry and the retry draft after reload', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window)
    window.__workspaceAbort = { requests: 0, aborted: 0 }
    window.fetch = (input, options) => {
      if (!String(input).includes('ai-workspace-fixture.invalid')) return nativeFetch(input, options)
      window.__workspaceAbort.requests++
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
        window.__workspaceAbort.aborted++
        reject(new DOMException('Public fixture aborted', 'AbortError'))
      }, { once: true }))
    }
  })
  await openPublicDrawing(page)
  await connect(page)
  const before = await nativeEntities(page), prompt = 'Move the existing circle only after a separately reviewed proposal.'
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()
  await expect.poll(() => page.evaluate(() => window.__workspaceAbort.requests)).toBe(1)
  await page.getByTestId('chat-stop').click()
  await expect(page.getByTestId('chat-message').last()).toContainText('Stopped. The drawing was not changed.')
  await expect(page.getByTestId('chat-input')).toHaveValue(prompt)
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  expect(await page.evaluate(() => window.__workspaceAbort.aborted)).toBe(1)
  expect(await nativeEntities(page)).toEqual(before)
  await page.reload()
  await expect(page.getByTestId('chat-input')).toHaveValue(prompt)
  expect(await nativeEntities(page)).toEqual(before)
})

test('workspace approval then undo and redo survive reload without asking the provider to repeat an edit', async ({ page }) => {
  let requests = 0
  await page.route(endpoint, route => {
    requests++
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'public-workspace-native-line', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({
        expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [],
      }) },
    }] }, finish_reason: 'tool_calls' }] } })
  })
  await page.goto('/ai/')
  await connect(page)
  await page.getByTestId('chat-input').fill('Prepare a 20 mm line for my review; do not apply it yourself.')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  expect(await nativeEntities(page)).toEqual([])
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-result').locator('.proposal-tag')).toHaveText('Applied')
  const approved = await nativeEntities(page)
  expect(approved).toHaveLength(1)
  expect(approved[0]).toMatchObject({ type: 'LINE', payload: { start: [0, 0, 0], end: [20, 0, 0] } })
  await page.reload()
  expect(await nativeEntities(page)).toEqual(approved)
  await expect(page.getByTestId('drawing-undo')).toBeEnabled()
  await page.getByTestId('drawing-undo').click()
  await expect(page.getByTestId('drawing-redo')).toBeEnabled()
  await page.reload()
  expect(await nativeEntities(page)).toEqual([])
  await page.getByTestId('drawing-redo').click()
  await expect(page.getByTestId('drawing-undo')).toBeEnabled()
  await page.reload()
  expect(await nativeEntities(page)).toEqual(approved)
  expect(requests).toBe(1)
})

test('workspace progress labels follow a real native read receipt and return to actual model waiting without changing geometry', async ({ page }) => {
  const document = await openPublicDrawing(page)
  await connect(page)
  const before = await nativeEntities(page)
  let requests = 0, release
  const finalResponse = new Promise(resolve => { release = resolve })
  await page.route(endpoint, async route => {
    requests++
    if (requests === 1) return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'public-workspace-read', type: 'function', function: { name: 'cad_query_drawing', arguments: JSON.stringify({
        expectedRevision: document.revision, filters: {}, offset: 0, limit: 100, layerOffset: 0, maxLayers: 100, maxBytes: 262144,
      }) },
    }] }, finish_reason: 'tool_calls' }] } })
    const receipt = JSON.parse(route.request().postDataJSON().messages.findLast(message => message.role === 'tool').content)
    expect(receipt.ok).toBe(true)
    expect(receipt.value.entities).toHaveLength(2)
    await finalResponse
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: 'The public native read completed. No edit was requested.' }, finish_reason: 'stop' }] } })
  })
  await page.evaluate(() => {
    window.__workspaceProgress = []
    const observer = new MutationObserver(() => {
      for (const node of document.querySelectorAll('.message-progress[data-phase]')) {
        window.__workspaceProgress.push({ phase: node.dataset.phase, text: node.textContent })
      }
    })
    observer.observe(document.getElementById('messages'), { subtree: true, childList: true, characterData: true, attributes: true })
  })
  await page.getByTestId('chat-input').fill('Read the actual native drawing and describe it without making a proposal.')
  await page.getByTestId('chat-send').click()
  await expect.poll(() => requests).toBe(2)
  await expect.poll(() => page.evaluate(() => window.__workspaceProgress.some(item => item.phase.startsWith('tool-') && item.text === 'Reading the drawing'))).toBe(true)
  await expect(page.locator('.message-progress[data-phase="model"]')).toHaveText('Waiting for the model')
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  release()
  await expect(page.getByTestId('chat-stop')).not.toBeVisible()
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('The public native read completed.')
  expect(await nativeEntities(page)).toEqual(before)
  expect(requests).toBe(2)
})

test('workspace reading older messages does not jump on model completion until Jump to latest is explicitly used', async ({ page }) => {
  let requests = 0, release
  const delayedResponse = new Promise(resolve => { release = resolve })
  await page.route(endpoint, async route => {
    requests++
    if (requests > 1) await delayedResponse
    const content = requests === 1 ? '## Retained public notes\n\n' + 'An earlier public drawing review note.\n\n'.repeat(90) : 'New response completed while you were reading earlier notes.'
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] } })
  })
  await page.goto('/ai/')
  await connect(page)
  await page.getByTestId('chat-input').fill('Give me public review notes without changing a drawing.')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-stop')).not.toBeVisible()
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('Retained public notes')
  await expect.poll(() => page.locator('#conversation').evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(1000)
  await page.getByTestId('chat-input').fill('Prepare one more public note while I read the earlier notes.')
  await page.getByTestId('chat-send').click()
  await expect.poll(() => requests).toBe(2)
  await expect(page.locator('.message-progress[data-phase="model"]')).toHaveText('Waiting for the model')
  await page.locator('#conversation').evaluate(node => { node.scrollTop = 150 })
  await expect(page.locator('#jump-latest')).toBeVisible()
  const oldPosition = await page.locator('#conversation').evaluate(node => node.scrollTop)
  release()
  await expect(page.getByTestId('chat-stop')).not.toBeVisible()
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('New response completed')
  const completedPosition = await page.locator('#conversation').evaluate(node => node.scrollTop)
  expect(Math.abs(completedPosition - oldPosition)).toBeLessThan(3)
  await expect(page.locator('#jump-latest')).toBeVisible()
  await page.locator('#jump-latest').click()
  await expect.poll(() => page.locator('#conversation').evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(100)
  await expect(page.locator('#jump-latest')).not.toBeVisible()
  expect(requests).toBe(2)
})

test('workspace example and Retry fill persist the actual per-session draft before reload without submitting it', async ({ page }) => {
  await openPublicDrawing(page)
  await page.locator('[data-prompt="line"]').click()
  const example = await page.getByTestId('chat-input').inputValue()
  expect(example).toContain('Read the current drawing')
  await expect.poll(async () => (await activeSaved(page))?.draft).toBe(example)
  await page.reload()
  await expect(page.getByTestId('chat-input')).toHaveValue(example)
  let requests = 0
  await page.route(endpoint, route => { requests++; return route.abort('failed') })
  await connect(page)
  const original = 'Read the original drawing without editing any entity.'
  await page.getByTestId('chat-input').fill(original)
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-error')).toBeVisible()
  await expect(page.getByTestId('chat-stop')).not.toBeVisible()
  const replacement = 'This is a different unsent draft, not the request to retry.'
  await page.getByTestId('chat-input').fill(replacement)
  await expect.poll(async () => (await activeSaved(page))?.draft).toBe(replacement)
  await page.locator('.message-retry').last().click()
  await expect(page.getByTestId('chat-input')).toHaveValue(original)
  await expect.poll(async () => (await activeSaved(page))?.draft).toBe(original)
  await page.reload()
  await expect(page.getByTestId('chat-input')).toHaveValue(original)
  expect(requests).toBe(1)
})

test('workspace cancelling an old chat request never injects its prompt into another active chat', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window)
    window.__workspaceCrossChat = { requests: 0 }
    window.fetch = (input, options) => {
      if (!String(input).includes('ai-workspace-fixture.invalid')) return nativeFetch(input, options)
      window.__workspaceCrossChat.requests++
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Public old-chat request aborted', 'AbortError')), { once: true }))
    }
  })
  await openPublicDrawing(page, 'other-workspace.kjd')
  await connect(page)
  const other = await activeSaved(page), before = await nativeEntities(page)
  await page.locator('#new-chat').click()
  const prompt = 'Old chat request: prepare a reviewed 20 mm line.'
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()
  await expect.poll(() => page.evaluate(() => window.__workspaceCrossChat.requests)).toBe(1)
  await page.locator('.conversation-item').filter({ hasText: 'other-workspace.kjd' }).click()
  await expect(page.getByTestId('chat-input')).toHaveValue('')
  await page.getByTestId('chat-stop').click()
  await expect(page.getByTestId('chat-stop')).not.toBeVisible()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect(page.getByTestId('chat-input')).toHaveValue('')
  await expect.poll(async () => (await activeSaved(page))?.id).toBe(other.id)
  expect(await nativeEntities(page)).toEqual(before)
  const oldChat = (await saved(page)).sessions.find(session => session.id !== other.id)
  expect(oldChat.draft).toBe(prompt)
  await page.reload()
  await expect(page.getByTestId('chat-input')).toHaveValue('')
  await page.locator('.conversation-item').filter({ hasText: prompt.slice(0, 34) }).click()
  await expect(page.getByTestId('chat-input')).toHaveValue(prompt)
})

test('workspace switching chats during a real approval commit unlocks the new composer without changing its drawing', async ({ page }) => {
  await openPublicDrawing(page, 'approval-other.kjd')
  await connect(page)
  const other = await activeSaved(page), before = await nativeEntities(page)
  let requests = 0
  await page.route(endpoint, route => {
    requests++
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'cross-chat-approval-line', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({
        expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [],
      }) },
    }] }, finish_reason: 'tool_calls' }] } })
  })
  await page.locator('#new-chat').click()
  await page.getByTestId('chat-input').fill('Prepare a public line for a manual cross-chat approval check.')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  const target = await activeSaved(page)
  expect(await nativeEntities(page)).toEqual([])
  await page.evaluate(targetId => {
    const gate = window.__workspaceApproval = { targetId, deliveries: [] }
    const nativePut = IDBObjectStore.prototype.put, nativeTransaction = IDBDatabase.prototype.transaction
    gate.restore = () => {
      IDBObjectStore.prototype.put = nativePut
      IDBDatabase.prototype.transaction = nativeTransaction
    }
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.transaction.db.name === 'kjdraw-ai-local' && value?.sessions?.some(session => session.id === gate.targetId && session.state?.committed === true)) {
        this.transaction.__workspaceApprovedRecord = true
      }
      return nativePut.call(this, value, ...args)
    }
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = nativeTransaction.apply(this, args)
      if (this.name !== 'kjdraw-ai-local' || transaction.mode !== 'readwrite') return transaction
      let owner = transaction, descriptor
      while (owner && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(owner, 'oncomplete'); owner = Object.getPrototypeOf(owner) }
      if (!descriptor?.set) throw new Error('Native completion descriptor is unavailable')
      Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(handler) {
        descriptor.set.call(transaction, event => {
          const deliver = () => handler.call(transaction, event)
          if (transaction.__workspaceApprovedRecord) gate.deliveries.push(deliver)
          else deliver()
        })
      } })
      return transaction
    }
  }, target.id)
  await page.getByTestId('proposal-approve').click()
  await expect.poll(() => page.evaluate(() => window.__workspaceApproval.deliveries.length)).toBeGreaterThan(0)
  expect(await nativeEntities(page)).toHaveLength(1)
  await page.locator('.conversation-item').filter({ hasText: 'approval-other.kjd' }).click()
  await expect(page.getByTestId('chat-send')).toBeDisabled()
  await expect(page.getByTestId('chat-input')).toHaveValue('')
  await page.evaluate(() => {
    // Future native writes are released normally; only the actual approved
    // target snapshot completion was held, never an earlier draft-only write.
    window.__workspaceApproval.restore()
    window.__workspaceApproval.deliveries.splice(0).forEach(deliver => deliver())
  })
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect(page.locator('#chat-form')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(async () => (await activeSaved(page))?.id).toBe(other.id)
  expect(await nativeEntities(page)).toEqual(before)
  expect(requests).toBe(1)
})
