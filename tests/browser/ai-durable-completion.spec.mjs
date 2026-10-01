import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { publicAnnotationSheet } from '../helpers/public-annotation-sheet.mjs'

const endpoint = 'https://ai-durability.invalid/v1/chat/completions'
const fixtureKey = 'public-browser-durability-fixture-key'

async function connect(page) {
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(endpoint)
  await page.getByTestId('settings-model').fill('protocol-fixture-not-a-real-model')
  await page.getByTestId('settings-key').fill(fixtureKey)
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('settings-open')).toContainText('Connection settings')
  await expect(page.getByTestId('settings-key')).toHaveValue('')
}
async function record(page) {
  return page.evaluate(async () => (await import('/apps/playground/ai/local-history.js')).loadLocalHistory())
}
async function send(page, prompt) {
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()
}
async function unchangedProvider(page, revision) {
  let requests = 0
  await page.route(endpoint, route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${fixtureKey}`)
    const first = requests++ % 3 === 0
    const message = first ? { role: 'assistant', content: '', tool_calls: [{ id: `read-${requests}`, type: 'function',
      function: { name: 'cad_find_text', arguments: JSON.stringify({ expectedRevision: revision, search: 'ZK03', match: 'exact' }) } }] }
      : { role: 'assistant', content: 'I have not created a CAD proposal.' }
    return route.fulfill({ json: { choices: [{ message, finish_reason: first ? 'tool_calls' : 'stop' }] } })
  })
  return () => requests
}

test('twenty immediate reloads retain each completed assistant turn and exact drawing, without copying private state or model key to Web Storage', async ({ page }) => {
  test.setTimeout(600_000)
  const { dxf } = await publicAnnotationSheet(), sdk = createKJDrawSDK(), native = await sdk.readDocument(dxf, { format: 'DXF' })
  const requests = await unchangedProvider(page, native.revision)
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name: 'public-durability.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await expect(page.locator('#drawing-name')).toHaveText('public-durability.dxf')
  await connect(page)
  const initial = await record(page), baseline = initial.sessions[0].state.drawing
  for (let iteration = 1; iteration <= 20; iteration++) {
    await send(page, `Change the hole label ZK03 to ZK03-A, text only. Durability trial ${iteration}.`)
    await expect(page.getByTestId('chat-no-proposal')).toHaveCount(iteration)
    // Deliberately no sleep, storage poll or export between visible completion
    // and reload: this is the exact user sequence that previously lost a turn.
    await page.reload()
    await expect(page.getByTestId('chat-no-proposal')).toHaveCount(iteration)
    await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
    await expect(page.getByTestId('settings-open')).toContainText('Connection settings')
    const saved = await record(page), active = saved.sessions.find(item => item.id === saved.activeId)
    expect(active.messages.filter(item => item.role === 'assistant' && item.status === 'not-proposed')).toHaveLength(iteration)
    expect(active.state.drawing).toBe(baseline)
    expect(saved.connection.apiKey).toBe(fixtureKey)
    expect(requests()).toBe(iteration * 3)
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes('public-browser-durability-fixture-key'))).toBe(false)
    expect(await page.locator('body').innerText()).not.toContain(fixtureKey)
    console.log(`durable immediate reload ${iteration}/20 passed`)
  }
})

// These instrumentation hooks use the native IndexedDB transaction and commit.
// They only delay delivery of its completion callback, or abort a real write;
// no fake database, timer-based 'saved' flag or replacement CAD runtime is used.
async function storageInstrumentation(page) {
  await page.addInitScript(() => {
    const gate = window.__durabilityStorage = { hold: false, completions: [], committed: 0, abortWrites: false }
    const nativeTransaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = nativeTransaction.apply(this, args)
      if (this.name !== 'kjdraw-ai-local' || transaction.mode !== 'readwrite') return transaction
      let owner = transaction, descriptor
      while (owner && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(owner, 'oncomplete'); owner = Object.getPrototypeOf(owner) }
      if (!descriptor?.set) throw new Error('Native IndexedDB completion setter is unavailable')
      Object.defineProperty(transaction, 'oncomplete', {
        configurable: true,
        get() { return descriptor.get.call(transaction) },
        set(handler) { descriptor.set.call(transaction, event => {
          gate.committed++
          const complete = () => handler.call(transaction, event)
          if (gate.hold) gate.completions.push(complete)
          else complete()
        }) },
      })
      return transaction
    }
    const nativePut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = nativePut.apply(this, args)
      if (window.__durabilityStorage.abortWrites && this.transaction.db.name === 'kjdraw-ai-local') this.transaction.abort()
      return request
    }
  })
}

test('terminal response stays pending until the real IDB transaction completion callback is delivered', async ({ page }) => {
  await storageInstrumentation(page)
  const { dxf } = await publicAnnotationSheet(), sdk = createKJDrawSDK(), native = await sdk.readDocument(dxf, { format: 'DXF' })
  await unchangedProvider(page, native.revision)
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name: 'commit-gate.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await expect(page.locator('#drawing-name')).toHaveText('commit-gate.dxf')
  await connect(page)
  await page.evaluate(() => { window.__durabilityStorage.hold = true })
  await send(page, 'Change the hole label ZK03 to ZK03-A, text only.')
  await expect.poll(() => page.evaluate(() => window.__durabilityStorage.completions.length)).toBeGreaterThan(0)
  await expect(page.getByTestId('chat-no-proposal')).toHaveCount(0)
  await expect(page.getByTestId('chat-stop')).toBeVisible()
  // Release actual commit completion events; terminal UI must follow, not lead.
  await page.evaluate(() => { const gate = window.__durabilityStorage; gate.hold = false; gate.completions.splice(0).forEach(complete => complete()) })
  await expect(page.getByTestId('chat-no-proposal')).toHaveCount(1)
  await page.reload()
  await expect(page.getByTestId('chat-no-proposal')).toHaveCount(1)
})

test('aborted real IDB upload does not replace the existing drawing or show a false opened state', async ({ page }) => {
  await storageInstrumentation(page)
  const { dxf } = await publicAnnotationSheet()
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name: 'original.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await expect(page.locator('#drawing-name')).toHaveText('original.dxf')
  const baseline = await record(page)
  await page.evaluate(() => { window.__durabilityStorage.abortWrites = true })
  await page.getByTestId('drawing-file').setInputFiles({ name: 'replacement.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await expect(page.locator('#import-error')).toBeVisible()
  await expect(page.locator('#drawing-name')).toHaveText('original.dxf')
  expect((await record(page)).sessions.map(item => item.source.name)).toEqual(baseline.sessions.map(item => item.source.name))
  await page.evaluate(() => { window.__durabilityStorage.abortWrites = false })
  await page.reload()
  await expect(page.locator('#drawing-name')).toHaveText('original.dxf')
})

test('an approved in-memory edit whose real IDB write aborts is explicitly unsaved, not falsely completed', async ({ page }) => {
  await storageInstrumentation(page)
  await page.route(endpoint, route => route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
    id: 'durability-line', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({ expectedRevision: 0,
      units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [] }) },
  }] }, finish_reason: 'tool_calls' }] } }))
  await page.goto('/ai/')
  await connect(page)
  await send(page, 'Draw a 20 mm horizontal line.')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await page.evaluate(() => { window.__durabilityStorage.abortWrites = true })
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-result').locator('.proposal-tag')).toHaveText('Not saved')
  await expect(page.locator('#import-error')).toContainText('Could not save this conversation locally.')
  await expect(page.getByTestId('chat-error')).toContainText('Could not save this conversation locally.')
  expect((await record(page)).sessions[0].state.committed).toBe(false)
  await page.evaluate(() => { window.__durabilityStorage.abortWrites = false })
  await page.reload()
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  await expect(page.getByTestId('drawing-result').locator('.proposal-tag')).toHaveText('Expired')
})
