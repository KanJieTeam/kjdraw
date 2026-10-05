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

async function openInlinePreview(page) {
  const context = page.getByTestId('drawing-context')
  if (!await context.evaluate(node => node.open)) await context.locator('summary').click()
  await expect(context.locator('.drawing-viewer-stage canvas')).toBeVisible()
}

function observeModelRequests(page) {
  const requests = []
  page.on('request', request => {
    if (/\/(?:chat\/completions|responses|messages|[^/]*generateContent)(?:[/?]|$)/.test(new URL(request.url()).pathname)) requests.push(request.url())
  })
  return requests
}

// Draft timestamps may change; source, exact KJD bytes, native history, messages,
// session identity and every other saved field must not change on failed import.
function withoutDraftMetadata(record) {
  return { ...record, sessions: record.sessions.map(({ draft, updatedAt, ...session }) => session) }
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
  const modelRequests = observeModelRequests(page)
  await page.goto('/ai/')
  await delayFileBytes(page, name)
  await page.getByTestId('drawing-file').setInputFiles({ name, mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  const draft = 'Move the existing circle 5 millimeters right; keep the line unchanged.'
  await expectBlockedComposer(page, draft)
  await expect(page.locator('#drawing-name')).toHaveText('')
  // A preexisting draft-only chat may have been saved before import began.
  // Import must not claim a source or geometry before real bytes are available;
  // busy-state draft persistence may instead wait until the import finishes.
  const blocked = await localRecord(page)
  const blockedSessions = blocked?.sessions ?? []
  expect(blockedSessions.length).toBeLessThanOrEqual(1)
  for (const session of blockedSessions) {
    expect(blocked.activeId).toBe(session.id)
    expect(session).toMatchObject({ source: null, messages: [], state: { committed: false, sourceFormat: 'blank' } })
    const blank = await createKJDrawSDK().readDocument(session.state.drawing, { format: 'KJD' })
    expect(blank.revision).toBe(0)
    expect(blank.listEntities()).toHaveLength(0)
  }
  expect(modelRequests).toEqual([])
  await releaseFileBytes(page)
  await expect(page.locator('#drawing-name')).toHaveText(name)
  await openInlinePreview(page)
  await expect(page.locator('#drawing-meta')).toContainText('2 entities')
  await expectReadyComposer(page, draft)
  await expect.poll(async () => (await localRecord(page)).sessions.map(session => session.source?.name)).toEqual([name])
  const saved = await localRecord(page)
  expect(saved.sessions).toHaveLength(1)
  expect(saved.sessions[0].source).toMatchObject({ name, format: 'DXF', entityCount: 2 })
  expect(saved.sessions[0].messages).toEqual([])
  expect(saved.sessions[0].draft).toBe(draft)
  const imported = await createKJDrawSDK().readDocument(saved.sessions[0].state.drawing, { format: 'KJD' })
  expect(imported.listEntities()).toHaveLength(2)
  expect(imported.listEntities({ type: 'LINE' })[0].payload).toMatchObject({ start: [0, 0, 0], end: [100, 0, 0] })
  expect(imported.listEntities({ type: 'CIRCLE' })[0].payload).toMatchObject({ center: [50, 20, 0], radius: 10 })
  await page.getByTestId('chat-send').click()
  await expect(page.locator('#settings-dialog')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await expect(page.locator('.message.user')).toHaveCount(0)
  expect(modelRequests).toEqual([])
})

test('failed slow DXF import restores controls, preserves the draft and leaves the real original drawing durable', async ({ page }) => {
  const dxf = await fixture(), originalName = 'original-before-failed-import.dxf'
  const modelRequests = observeModelRequests(page)
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name: originalName, mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await expect(page.locator('#drawing-name')).toHaveText(originalName)
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await openInlinePreview(page)
  await expect.poll(async () => (await localRecord(page)).sessions[0]?.source?.name).toBe(originalName)
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
  await expect.poll(async () => (await localRecord(page)).sessions.find(session => session.id === original.activeId)?.draft).toBe(draft)
  const afterFailure = await localRecord(page)
  expect(withoutDraftMetadata(afterFailure)).toEqual(withoutDraftMetadata(original))
  expect(afterFailure.sessions).toHaveLength(1)
  const unchanged = await createKJDrawSDK().readDocument(afterFailure.sessions[0].state.drawing, { format: 'KJD' })
  expect(unchanged.listEntities()).toHaveLength(2)
  expect(unchanged.listEntities({ type: 'LINE' })[0].payload).toMatchObject({ start: [0, 0, 0], end: [100, 0, 0] })
  expect(unchanged.listEntities({ type: 'CIRCLE' })[0].payload).toMatchObject({ center: [50, 20, 0], radius: 10 })
  await page.getByTestId('chat-send').click()
  await expect(page.locator('#settings-dialog')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await page.reload()
  await expect(page.locator('#drawing-name')).toHaveText(originalName)
  // Restored drawing previews are collapsed and lazy-rendered until the user
  // opens the real details control. Keep the actual canvas/IDB checks below.
  await openInlinePreview(page)
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  expect(withoutDraftMetadata(await localRecord(page))).toEqual(withoutDraftMetadata(original))
  expect((await localRecord(page)).sessions[0].draft).toBe(draft)
  expect(modelRequests).toEqual([])
})
