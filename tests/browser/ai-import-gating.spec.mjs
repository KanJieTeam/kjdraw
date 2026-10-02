import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

async function fixture() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'import-gating-public-fixture', units: 'millimeter' })
  await document.transact('Public import gating geometry', transaction => {
    transaction.createEntity('LINE', { start: [0, 0, 0], end: [100, 0, 0] }, { id: 'unchanged-line' })
    transaction.createEntity('CIRCLE', { center: [50, 20, 0], radius: 10 }, { id: 'unchanged-circle' })
  })
  return await sdk.writeDocument(document, { format: 'DXF' })
}

// Delay delivery of real File bytes, then call the native browser method.
// The actual importer, CAD engine, renderer and IndexedDB are not replaced.
async function delayFileBytes(page, name) {
  await page.evaluate(fileName => {
    if (window.__importBytesGate) throw new Error('Only one File byte gate may be installed')
    const nativeRead = File.prototype.arrayBuffer
    let release
    const ready = new Promise(resolve => { release = resolve })
    window.__importBytesGate = { name: fileName, started: 0, completed: 0, release }
    File.prototype.arrayBuffer = async function (...args) {
      if (this.name !== fileName) return nativeRead.apply(this, args)
      window.__importBytesGate.started++
      await ready
      const bytes = await nativeRead.apply(this, args)
      window.__importBytesGate.completed++
      return bytes
    }
  }, name)
}

async function releaseFileBytes(page) {
  await page.evaluate(() => window.__importBytesGate.release())
}

async function localRecord(page) {
  return await page.evaluate(async () => (await import('/apps/playground/ai/local-history.js')).loadLocalHistory())
}

async function expectBlockedComposer(page, draft) {
  await expect.poll(() => page.evaluate(() => window.__importBytesGate.started)).toBe(1)
  await expect(page.getByTestId('chat-send')).toBeDisabled()
  await expect(page.locator('#chat-form')).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByTestId('chat-send')).toContainText('Opening drawing')
  await expect(page.locator('.composer-hint')).toContainText('Opening drawing')
  await expect(page.getByTestId('drawing-open')).toBeDisabled()
  await expect(page.locator('#attach-drawing')).toBeDisabled()
  await page.getByTestId('chat-input').fill(draft)
  // A real pointer click on the disabled control must not submit. Playwright's
  // locator.click intentionally waits for enablement, so use the browser mouse.
  const bounds = await page.getByTestId('chat-send').boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.getByTestId('chat-input').press('Enter')
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  await expect(page.locator('.message.user')).toHaveCount(0)
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  expect(await page.evaluate(() => window.__importBytesGate.completed)).toBe(0)
}

async function expectReadyComposer(page, draft) {
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect(page.locator('#chat-form')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByTestId('chat-send')).toContainText('Send')
  await expect(page.locator('.composer-hint')).not.toContainText('Opening drawing')
  await expect(page.getByTestId('drawing-open')).toBeEnabled()
  await expect(page.locator('#attach-drawing')).toBeEnabled()
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
}

test('slow real DXF import blocks click and Enter without losing the draft, then enables the normal Send flow', async ({ page }) => {
  const dxf = await fixture(), name = 'delayed-valid.dxf'
  await page.goto('/ai/')
  await delayFileBytes(page, name)
  await page.getByTestId('drawing-file').setInputFiles({ name, mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  const draft = 'Move the existing circle 5 millimeters right; keep the line unchanged.'
  await expectBlockedComposer(page, draft)
  await expect(page.locator('#drawing-name')).toHaveText('')
  expect((await localRecord(page)).sessions).toHaveLength(0)
  await releaseFileBytes(page)
  await expect(page.locator('#drawing-name')).toHaveText(name)
  await expect(page.getByTestId('drawing-context').locator('.drawing-viewer-stage canvas')).toBeVisible()
  await expect(page.locator('#drawing-meta')).toContainText('2 entities')
  await expectReadyComposer(page, draft)
  const saved = await localRecord(page)
  expect(saved.sessions).toHaveLength(1)
  expect(saved.sessions[0].source).toMatchObject({ name, format: 'DXF', entityCount: 2 })
  expect(saved.sessions[0].messages).toEqual([])
  await page.getByTestId('chat-send').click()
  await expect(page.locator('#settings-dialog')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await expect(page.locator('.message.user')).toHaveCount(0)
})

test('failed slow DXF import restores controls, preserves the draft and leaves the real original drawing durable', async ({ page }) => {
  const dxf = await fixture(), originalName = 'original-before-failed-import.dxf'
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name: originalName, mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await expect(page.locator('#drawing-name')).toHaveText(originalName)
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect(page.getByTestId('drawing-context').locator('.drawing-viewer-stage canvas')).toBeVisible()
  const original = await localRecord(page)
  const invalidName = 'delayed-invalid.dxf'
  await delayFileBytes(page, invalidName)
  await page.getByTestId('drawing-file').setInputFiles({ name: invalidName, mimeType: 'application/dxf', buffer: Buffer.from('This is not a DXF group-code stream.') })
  const draft = 'Change only the circle radius to 12 millimeters.'
  await expectBlockedComposer(page, draft)
  await expect(page.locator('#drawing-name')).toHaveText(originalName)
  await releaseFileBytes(page)
  await expect(page.locator('#import-error')).toBeVisible()
  await expect(page.locator('#import-error')).not.toHaveText('')
  await expectReadyComposer(page, draft)
  await expect(page.locator('#drawing-name')).toHaveText(originalName)
  await expect(page.locator('#drawing-meta')).toContainText('2 entities')
  await expect(page.getByTestId('drawing-context').locator('.drawing-viewer-stage canvas')).toBeVisible()
  expect(await localRecord(page)).toEqual(original)
  await page.getByTestId('chat-send').click()
  await expect(page.locator('#settings-dialog')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await page.reload()
  await expect(page.locator('#drawing-name')).toHaveText(originalName)
  // Restored drawing previews are collapsed and lazy-rendered until the user
  // opens the real details control. Keep the actual canvas/IDB checks below.
  await page.getByTestId('drawing-context').locator('summary').click()
  await expect(page.getByTestId('drawing-context').locator('.drawing-viewer-stage canvas')).toBeVisible()
  expect(await localRecord(page)).toEqual(original)
})
