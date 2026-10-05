import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'

const endpoint = 'https://ai-history-durability.invalid/v1/chat/completions'
const fixtureKey = 'public-history-durability-fixture-key'

async function installNativeCompletionGate(page) {
  await page.addInitScript(() => {
    const gate = window.__historyCompletionGate = { hold: false, deliveries: [], commits: 0 }
    const nativeTransaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = nativeTransaction.apply(this, args)
      if (this.name !== 'kjdraw-ai-local' || transaction.mode !== 'readwrite') return transaction
      let owner = transaction, descriptor
      while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, 'oncomplete')
        owner = Object.getPrototypeOf(owner)
      }
      if (!descriptor?.set) throw new Error('Native IndexedDB completion setter is unavailable')
      Object.defineProperty(transaction, 'oncomplete', {
        configurable: true,
        get() { return descriptor.get.call(transaction) },
        set(handler) {
          descriptor.set.call(transaction, event => {
            gate.commits++
            const deliver = () => handler.call(transaction, event)
            if (gate.hold) gate.deliveries.push(deliver)
            else deliver()
          })
        },
      })
      return transaction
    }
  })
}

async function beginCommitGate(page) {
  await page.evaluate(() => { window.__historyCompletionGate.hold = true })
}

async function releaseCommitGate(page) {
  await page.evaluate(() => {
    const gate = window.__historyCompletionGate
    gate.hold = false
    gate.deliveries.splice(0).forEach(deliver => deliver())
  })
}

async function waitForActualCommit(page) {
  await expect.poll(() => page.evaluate(() => window.__historyCompletionGate.deliveries.length)).toBeGreaterThan(0)
}

async function saved(page) {
  return page.evaluate(async () => (await import('/apps/playground/ai/local-history.js')).loadLocalHistory())
}

async function entities(page, sdk) {
  const record = await saved(page), session = record.sessions.find(item => item.id === record.activeId)
  const drawing = await sdk.readDocument(session.state.drawing, { format: 'KJD' })
  return drawing.listEntities().sort((left, right) => left.id.localeCompare(right.id))
}

test('approved edits and real undo/redo expose completion only after native IDB commit, then survive immediate reload with exact entity identity', async ({ page }) => {
  await installNativeCompletionGate(page)
  const sdk = createKJDrawSDK()
  let modelRequests = 0
  await page.route(endpoint, route => {
    modelRequests++
    expect(route.request().headers().authorization).toBe(`Bearer ${fixtureKey}`)
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'reviewed-history-line', type: 'function', function: {
        name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({
          expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [],
        }),
      },
    }] }, finish_reason: 'tool_calls' }] } })
  })
  await page.goto('/ai/')
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(endpoint)
  await page.getByTestId('settings-model').fill('protocol-fixture-not-a-real-model')
  await page.getByTestId('settings-key').fill(fixtureKey)
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  await page.getByTestId('chat-input').fill('Draw a 20 mm horizontal line for review.')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  expect(await entities(page, sdk)).toEqual([])

  await beginCommitGate(page)
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('proposal-approve')).toBeDisabled()
  await waitForActualCommit(page)
  await expect(page.getByTestId('drawing-result').locator('.proposal-tag')).not.toHaveText('Applied')
  await expect(page.locator('.message.assistant .message-content').filter({ hasText: '已应用图纸修改' })).toHaveCount(0)
  await releaseCommitGate(page)
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('已应用图纸修改')
  // No storage poll, export or sleep before reload: the visible terminal is
  // itself the durability boundary for the user's completed operation.
  await page.reload()
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('已应用图纸修改')
  await expect(page.getByTestId('drawing-result').locator('.proposal-tag')).toHaveText('Applied')
  await expect(page.getByTestId('drawing-undo')).toBeEnabled()
  const approved = await entities(page, sdk)
  expect(approved).toHaveLength(1)
  expect(approved[0]).toMatchObject({ type: 'LINE', payload: { start: [0, 0, 0], end: [20, 0, 0] } })

  await beginCommitGate(page)
  await page.getByTestId('drawing-undo').click()
  await waitForActualCommit(page)
  await expect(page.locator('.message.assistant .message-content').filter({ hasText: '已撤销上一次图纸修改' })).toHaveCount(0)
  await releaseCommitGate(page)
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('已撤销上一次图纸修改')
  await page.reload()
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('已撤销上一次图纸修改')
  expect(await entities(page, sdk)).toEqual([])
  await expect(page.getByTestId('drawing-redo')).toBeEnabled()

  await beginCommitGate(page)
  await page.getByTestId('drawing-redo').click()
  await waitForActualCommit(page)
  await expect(page.locator('.message.assistant .message-content').filter({ hasText: '已重做图纸修改' })).toHaveCount(0)
  await releaseCommitGate(page)
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('已重做图纸修改')
  await page.reload()
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('已重做图纸修改')
  expect(await entities(page, sdk)).toEqual(approved)
  expect(modelRequests).toBe(1)
  expect((await saved(page)).connection.apiKey).toBe(fixtureKey)
  expect(await page.locator('body').innerText()).not.toContain(fixtureKey)
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes('public-history-durability-fixture-key'))).toBe(false)

  const waiting = page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const output = await sdk.readDocument(new Uint8Array(await readFile(await (await waiting).path())), { format: 'DXF' })
  expect(output.validate().valid).toBe(true)
  expect(output.listEntities()).toHaveLength(1)
  expect(output.listEntities()[0]).toMatchObject({ type: 'LINE', payload: { start: [0, 0, 0], end: [20, 0, 0] } })
})

for (const action of ['approve', 'reject']) {
  test(`proposal ${action} blocks a new Send until real storage completion without losing the next draft`, async ({ page }) => {
    await installNativeCompletionGate(page)
    const sdk = createKJDrawSDK()
    const requests = []
    await page.route(endpoint, route => {
      requests.push(route.request().postDataJSON())
      if (requests.length === 2) return route.fulfill({ json: { choices: [{ message: {
        role: 'assistant', content: '', tool_calls: [{ id: 'actual-followup-drawing-read', type: 'function',
          function: { name: 'cad_read_drawing', arguments: '{}' } }],
      }, finish_reason: 'tool_calls' }] } })
      if (requests.length > 2) return route.fulfill({ json: { choices: [{ message: {
        role: 'assistant', content: 'The previous review finished. This follow-up did not modify the drawing.',
      }, finish_reason: 'stop' }] } })
      return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
        id: 'native-storage-gated-line', type: 'function', function: {
          name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({
            expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [],
          }),
        },
      }] }, finish_reason: 'tool_calls' }] } })
    })
    await page.goto('/ai/')
    await page.getByTestId('settings-open').click()
    await page.getByTestId('settings-provider').selectOption('custom')
    await page.getByTestId('settings-endpoint').fill(endpoint)
    await page.getByTestId('settings-model').fill('native-storage-gate-protocol-fixture')
    await page.getByTestId('settings-save').click()
    await expect(page.locator('#settings-dialog')).not.toBeVisible()
    await page.getByTestId('chat-input').fill('Draw one 20 mm line for review.')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('proposal-approve')).toBeVisible()
    expect(await entities(page, sdk)).toEqual([])
    await beginCommitGate(page)
    await page.getByTestId(`proposal-${action}`).click()
    await waitForActualCommit(page)
    await expect(page.getByTestId('chat-send')).toBeDisabled()
    await expect(page.locator('#chat-form')).toHaveAttribute('aria-busy', 'true')
    const draft = 'Explain the current drawing; do not change it.'
    await page.getByTestId('chat-input').fill(draft)
    const bounds = await page.getByTestId('chat-send').boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.getByTestId('chat-input').press('Enter')
    await expect(page.getByTestId('chat-input')).toHaveValue(draft)
    await expect(page.locator('.message.user')).toHaveCount(1)
    expect(requests).toHaveLength(1)
    // The native transaction committed. Only its real oncomplete delivery is
    // gated: no importer, engine, storage write or proposal result is faked.
    expect(await entities(page, sdk)).toHaveLength(action === 'approve' ? 1 : 0)
    await releaseCommitGate(page)
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    await expect(page.locator('#chat-form')).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByTestId('chat-input')).toHaveValue(draft)
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.message.user').last()).toContainText(draft)
    await expect(page.locator('.message.assistant .message-content').last()).toContainText('This follow-up did not modify the drawing')
    expect(requests).toHaveLength(3)
    const receipt = JSON.parse(requests.at(-1).messages.findLast(message => message.role === 'tool').content)
    expect(receipt.ok).toBe(true)
    await page.reload()
    await expect(page.locator('.message.user').last()).toContainText(draft)
    expect(await entities(page, sdk)).toHaveLength(action === 'approve' ? 1 : 0)
  })
}
