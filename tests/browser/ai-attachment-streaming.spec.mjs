import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

let server, endpoint, respond, requests
const publicKey = 'public-attachment-fixture-not-a-provider-key'

function jsonReply(response, message) {
  response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  response.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }))
}
function beginStream(response) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
  response.flushHeaders()
  return {
    delta(text) { response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`) },
    finish() {
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      response.end()
    },
  }
}
function readThen(response, body, document, next, { findText = false } = {}) {
  if (body.messages.some(message => message.role === 'tool')) return next(response, JSON.parse(body.messages.findLast(message => message.role === 'tool').content))
  const name = findText ? 'cad_find_text' : 'cad_query_drawing'
  const args = findText ? { expectedRevision: document.revision, search: 'PUBLIC PROJECT TITLE', match: 'exact' }
    : { expectedRevision: document.revision, filters: {}, offset: 0, limit: 100, layerOffset: 0, maxLayers: 100, maxBytes: 262144 }
  jsonReply(response, { role: 'assistant', content: '', tool_calls: [{
    id: 'public-verified-read', type: 'function', function: { name, arguments: JSON.stringify(args) },
  }] })
}

test.beforeAll(async () => {
  // Serve actual incremental HTTP bytes. Browser fetch, stream decoding, the
  // model adapter, CAD runtime, renderer, and IndexedDB all remain real.
  server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' })
      response.end()
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push(body)
    respond(response, body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${server.address().port}/v1/chat/completions`
})
test.beforeEach(() => {
  requests = []
  respond = response => jsonReply(response, { role: 'assistant', content: 'The public drawing contains a project title and one line. No edit was requested.' })
})
test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

async function record(page) {
  return page.evaluate(async () => (await import('/apps/playground/ai/local-history.js')).loadLocalHistory())
}
async function activeRecord(page) {
  const saved = await record(page)
  return saved?.sessions.find(session => session.id === saved.activeId)
}
async function connect(page) {
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(endpoint)
  await page.getByTestId('settings-model').fill('public-incremental-http-fixture')
  await page.getByTestId('settings-key').fill(publicKey)
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
}
async function importDrawing(page, name = 'mistaken-public.dxf') {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-removable-import', units: 'millimeter' })
  await document.transact('Public attachment baseline', transaction => {
    transaction.createEntity('LINE', { start: [0, 0, 0], end: [80, 0, 0] }, { id: 'public-retained-line' })
    transaction.createEntity('TEXT', { position: [0, 5, 0], height: 3, text: 'PUBLIC PROJECT TITLE' }, { id: 'public-title' })
  })
  const dxf = await sdk.writeDocument(document, { format: 'DXF' })
  const imported = await sdk.readDocument(dxf, { format: 'DXF' })
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name, mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await expect(page.locator('#drawing-name')).toHaveText(name)
  await expect.poll(async () => (await activeRecord(page))?.source?.name).toBe(name)
  return imported
}
async function send(page, prompt) {
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()
}
async function expectCleanDrawing(page) {
  await expect(page.getByTestId('drawing-context')).not.toBeVisible()
  await expect(page.locator('#drawing-name')).toHaveText('')
  await expect(page.locator('#drawing-panel')).not.toBeVisible()
  await expect(page.locator('#drawing-history-actions')).not.toBeVisible()
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)
  await expect.poll(async () => (await activeRecord(page))?.source).toBeNull()
  const session = await activeRecord(page)
  expect(session.state).toMatchObject({ sourceFormat: 'blank', committed: false, history: [] })
  expect(session.state.drawingHistory.undo).toEqual([])
  expect(session.state.drawingHistory.redo).toEqual([])
  expect(session.messages.every(message => !message.proposals)).toBe(true)
  const blank = await createKJDrawSDK().readDocument(session.state.drawing, { format: 'KJD' })
  expect(blank.revision).toBe(0)
  expect(blank.listEntities()).toEqual([])
  return session
}
function textProposal(document, receipt) {
  const title = receipt.value.matches.find(entity => entity.text === 'PUBLIC PROJECT TITLE')
  return { role: 'assistant', content: 'The title edit is ready for your review.', tool_calls: [{
    id: 'public-title-edit', type: 'function', function: { name: 'cad_propose_text_edit', arguments: JSON.stringify({
      expectedRevision: document.revision, units: 'millimeter',
      changes: [{ id: title.id, expectedText: title.text, text: 'REVIEWED PROJECT TITLE' }],
    }) },
  }] }
}

test('the attachment X removes only the imported drawing and persists the blank state with chat, draft, and connection intact', async ({ page }) => {
  const imported = await importDrawing(page)
  await connect(page)
  respond = (response, body) => readThen(response, body, imported, value => jsonReply(value, { role: 'assistant', content: 'The public drawing contains a project title and one line. No edit was requested.' }))
  const prompt = 'Describe this public drawing without making any changes.'
  await send(page, prompt)
  await expect(page.getByTestId('chat-stop')).not.toBeVisible()
  await expect(page.locator('.message.assistant .message-content')).toContainText('public drawing')
  const before = await activeRecord(page)
  const draft = 'An unsent public note that must survive removal.'
  await page.getByTestId('chat-input').fill(draft)
  await expect(page.getByRole('button', { name: 'Remove drawing', exact: true })).toBeVisible()
  await page.getByTestId('drawing-remove').click()
  await expect(page.locator('#remove-drawing-dialog')).not.toBeVisible()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  const after = await expectCleanDrawing(page)
  expect(after.id).toBe(before.id)
  expect(after.messages).toEqual(before.messages)
  expect(after.draft).toBe(draft)
  expect((await record(page)).connection).toMatchObject({ endpoint, apiKey: publicKey, protocol: 'chat-completions' })
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await page.reload()
  await expectCleanDrawing(page)
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await expect(page.locator('.message.user')).toContainText(prompt)
  await page.locator('#new-chat').click()
  await expect(page.getByTestId('drawing-context')).not.toBeVisible()
  await page.locator('.conversation-item').filter({ hasText: prompt.slice(0, 34) }).click()
  await expectCleanDrawing(page)
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  expect(requests).toHaveLength(2)
  expect(requests[0].stream).toBe(true)
})

test('removing an import-only attachment reloads the blank active chat without falling back to another saved drawing', async ({ page }) => {
  await importDrawing(page, 'preserved-public.dxf')
  const preserved = await activeRecord(page)
  await importDrawing(page, 'mistaken-empty-chat.dxf')
  await expect(page.getByTestId('chat-message')).toHaveCount(0)
  await page.getByTestId('drawing-remove').click()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expectCleanDrawing(page)
  expect((await record(page)).sessions.find(session => session.id === preserved.id)).toEqual(preserved)
  await page.reload()
  await expectCleanDrawing(page)
  await expect(page.getByTestId('chat-empty')).toBeVisible()
  await page.locator('.conversation-item').filter({ hasText: 'preserved-public.dxf' }).click()
  await expect(page.locator('#drawing-name')).toHaveText('preserved-public.dxf')
  expect(await activeRecord(page)).toEqual(preserved)
  expect(requests).toHaveLength(0)
})

test('removing an unapproved import clears its pending proposal while preserving conversation text', async ({ page }) => {
  const imported = await importDrawing(page)
  await connect(page)
  respond = (response, body) => readThen(response, body, imported, (value, receipt) => jsonReply(value, textProposal(imported, receipt)), { findText: true })
  await send(page, 'Change only PUBLIC PROJECT TITLE to REVIEWED PROJECT TITLE for my review.')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  const before = await activeRecord(page)
  await page.getByTestId('drawing-remove').click()
  await expect(page.locator('#remove-drawing-dialog')).not.toBeVisible()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  const after = await expectCleanDrawing(page)
  expect(after.messages.map(message => message.text)).toEqual(before.messages.map(message => message.text))
  await page.reload()
  await expectCleanDrawing(page)
  expect(requests).toHaveLength(2)
})

test('an applied DXF edit requires removal confirmation and cancel preserves the actual drawing and undo history', async ({ page }) => {
  const imported = await importDrawing(page)
  await connect(page)
  respond = (response, body) => readThen(response, body, imported, (value, receipt) => jsonReply(value, textProposal(imported, receipt)), { findText: true })
  await send(page, 'Change only PUBLIC PROJECT TITLE to REVIEWED PROJECT TITLE for my review.')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-undo')).toBeEnabled()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  const before = await activeRecord(page)
  await page.getByTestId('drawing-remove').click()
  await expect(page.locator('#remove-drawing-dialog')).toBeVisible()
  await expect(page.locator('#remove-drawing-description')).toContainText('applied changes')
  await page.locator('#remove-drawing-cancel').click()
  expect(await activeRecord(page)).toEqual(before)
  await expect(page.getByTestId('drawing-context')).toBeVisible()
  await expect(page.getByTestId('drawing-undo')).toBeEnabled()
  await page.reload()
  await expect(page.getByTestId('drawing-undo')).toBeEnabled()
  await page.getByTestId('drawing-remove').click()
  await expect(page.locator('#remove-drawing-dialog')).toBeVisible()
  await page.getByTestId('drawing-remove-confirm').click()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expectCleanDrawing(page)
  await page.reload()
  await expectCleanDrawing(page)
  expect(requests).toHaveLength(2)
})

test('removing an attachment aborts the real streaming request before resetting the document and never exposes a late approval', async ({ page }) => {
  const imported = await importDrawing(page)
  await connect(page)
  let aborted = false, response, stream
  respond = (response, body) => readThen(response, body, imported, value => {
    response = value
    response.on('close', () => { aborted = !response.writableEnded })
    stream = beginStream(response)
    stream.delta('Reading the public drawing now.')
  })
  const prompt = 'Read this public drawing without editing it.'
  await send(page, prompt)
  await expect(page.getByTestId('chat-streaming-text')).toContainText('Reading the public drawing now.')
  await expect(page.getByTestId('chat-stop')).toBeVisible()
  await expect(page.getByTestId('drawing-remove')).toBeEnabled()
  await page.getByTestId('drawing-remove').click()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect.poll(() => aborted).toBe(true)
  await expectCleanDrawing(page)
  stream.delta('This response arrived after removal and must never be displayed.')
  stream.finish()
  await expect(page.getByTestId('chat-streaming-text')).toHaveCount(0)
  await expect(page.locator('.message.assistant')).not.toContainText('after removal')
  await expect(page.getByTestId('chat-input')).toHaveValue(prompt)
  await page.reload()
  await expectCleanDrawing(page)
  await expect(page.getByTestId('chat-input')).toHaveValue(prompt)
  expect(requests).toHaveLength(2)
})

test('actual HTTP text chunks render before completion while reading position and the collapsed drawing workspace stay stable', async ({ page }) => {
  const imported = await importDrawing(page)
  await connect(page)
  const notes = Array.from({ length: 45 }, (_, index) => `Retained public note ${index + 1}: this line is available while reading earlier messages.`).join('\n\n')
  respond = (response, body) => readThen(response, body, imported, value => jsonReply(value, { role: 'assistant', content: notes }))
  await send(page, 'Describe the public drawing without changing it.')
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  const baseline = await activeRecord(page)
  await expect.poll(() => page.locator('#conversation').evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(1000)
  let stream
  respond = (response, body) => readThen(response, body, imported, value => {
    stream = beginStream(value)
    stream.delta('The first real chunk is visible')
  })
  await send(page, 'Read the drawing again and explain it without editing anything.')
  await expect(page.getByTestId('chat-streaming-text')).toHaveText('The first real chunk is visible')
  await expect(page.getByTestId('chat-stop')).toBeVisible()
  await page.locator('#workspace-close').click()
  await expect(page.locator('#drawing-panel')).not.toBeVisible()
  await page.locator('#conversation').evaluate(node => { node.scrollTop = 150 })
  await expect(page.locator('#jump-latest')).toBeVisible()
  const readingPosition = await page.locator('#conversation').evaluate(node => node.scrollTop)
  stream.delta(', followed by the second delivered chunk.')
  await expect(page.getByTestId('chat-streaming-text')).toHaveText('The first real chunk is visible, followed by the second delivered chunk.')
  await expect(page.getByTestId('chat-stop')).toBeVisible()
  expect(Math.abs(await page.locator('#conversation').evaluate(node => node.scrollTop) - readingPosition)).toBeLessThan(3)
  await expect(page.locator('#drawing-panel')).not.toBeVisible()
  stream.finish()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect(page.locator('.message.assistant .message-content').last()).toHaveText('The first real chunk is visible, followed by the second delivered chunk.')
  expect(Math.abs(await page.locator('#conversation').evaluate(node => node.scrollTop) - readingPosition)).toBeLessThan(3)
  await expect(page.locator('#drawing-panel')).not.toBeVisible()
  const after = await activeRecord(page)
  expect(after.state.drawing).toEqual(baseline.state.drawing)
  await page.locator('#jump-latest').click()
  await expect.poll(() => page.locator('#conversation').evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(100)
  await page.reload()
  await expect(page.locator('.message.assistant .message-content').last()).toHaveText('The first real chunk is visible, followed by the second delivered chunk.')
  expect(requests).toHaveLength(4)
})
