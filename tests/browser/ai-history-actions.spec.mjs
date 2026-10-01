import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

const modelEndpoint = 'https://ai-history-test.invalid/v1/chat/completions'
const removedIds = ['survey-edge', 'survey-label']

async function drawingFixture() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'public-ai-history-fixture', units: 'millimeter' })
  await document.transact('Public history fixture baseline', tx => {
    tx.createEntity('LINE', { start: [10, 20, 0], end: [60, 20, 0], trueColor: 0x245bc8 }, { id: removedIds[0] })
    tx.createEntity('TEXT', { position: [15, 25, 0], text: 'Temporary survey mark', height: 3 }, { id: removedIds[1] })
    tx.createEntity('CIRCLE', { center: [125, 65, 0], radius: 14 }, { id: 'retained-circle' })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [160, 0], [160, 100], [0, 100]], closed: true }, { id: 'retained-outline' })
    tx.createEntity('HATCH', { patternName: 'ANSI31', solid: false, patternScale: 2, patternAngle: 30,
      boundaryLoops: [{ flags: 22, external: true, closed: true, vertices: [[75, 20], [105, 20], [105, 45], [75, 45]] }],
    }, { id: 'retained-native-hatch' })
  })
  return { sdk, document, kjd: await sdk.writeDocument(document, { format: 'KJD' }) }
}

// Observe the real runtime document and built-in history methods. These wrappers
// delegate unchanged to the engine; no importer, proposal or mutation is mocked.
async function observeEngine(page) {
  await page.evaluate(async () => {
    const [{ KJDocument }, { KJCanvasRenderer }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/document.js'),
      import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
    ])
    window.__aiHistoryCalls ??= []
    if (KJDocument.prototype.__aiHistoryObserved) return
    KJDocument.prototype.__aiHistoryObserved = true
    for (const name of ['undo', 'redo']) {
      const original = KJDocument.prototype[name]
      KJDocument.prototype[name] = async function (...args) {
        const beforeRevision = this.revision
        const result = await original.apply(this, args)
        window.__aiHistoryCalls.push({ name, documentId: this.id, beforeRevision, revision: this.revision, result })
        return result
      }
    }
    const render = KJCanvasRenderer.prototype.render
    KJCanvasRenderer.prototype.render = function (...args) {
      const result = render.apply(this, args)
      if (this.document?.id === 'public-ai-history-fixture' && this.canvas.closest('.drawing-viewer')) {
        window.__aiHistoryDocument = this.document
      }
      return result
    }
  })
}

async function engineState(page) {
  return page.evaluate(() => {
    const document = window.__aiHistoryDocument
    if (!document) return null
    return {
      revision: document.revision, history: document.history,
      entities: [...document.listEntities()].sort((left, right) => left.id.localeCompare(right.id)),
      lastRevision: document.snapshot().revisions.at(-1),
      calls: window.__aiHistoryCalls,
    }
  })
}

async function savedRecord(page) {
  return page.evaluate(async () => (await import('/apps/playground/ai/local-history.js')).loadLocalHistory())
}

async function connectMock(page) {
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(modelEndpoint)
  await page.getByTestId('settings-model').fill('history-protocol-fixture')
  // No credentials and no real model/provider access are required.
  await page.getByTestId('settings-save').click()
}

async function openDrawing(page, fixture) {
  await page.goto('/ai/')
  await observeEngine(page)
  await page.getByTestId('drawing-file').setInputFiles({
    name: 'public-history.kjd', mimeType: 'application/json', buffer: Buffer.from(fixture.kjd),
  })
  await expect(page.locator('#drawing-name')).toHaveText('public-history.kjd')
  await expect.poll(async () => (await engineState(page))?.entities?.length).toBe(5)
  await connectMock(page)
}

function hostRevision(body) {
  const context = body.messages.find(message => message.role === 'user')?.content ?? ''
  const matched = /Host context: document .+?; revision (\d+); units (\w+)\./.exec(context)
  expect(matched, 'provider receives current authoritative document context').not.toBeNull()
  return { expectedRevision: Number(matched[1]), units: matched[2] }
}

function lastToolResult(body) {
  const output = body.messages.findLast(message => message.role === 'tool')
  return output ? JSON.parse(output.content) : null
}

function toolResponse(route, name, args, content = '') {
  return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content, tool_calls: [{
    id: 'history-' + name, type: 'function', function: { name, arguments: JSON.stringify(args) },
  }] }, finish_reason: 'tool_calls' }] } })
}

function textResponse(route, content) {
  return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] } })
}

async function mockProvider(page) {
  const requests = []
  const historyReads = []
  const control = { action: 'remove' }
  await page.route(modelEndpoint, route => {
    const request = route.request(), body = request.postDataJSON()
    expect(request.headers().authorization).toBeUndefined()
    requests.push(body)
    const context = hostRevision(body)
    const result = lastToolResult(body)
    const names = body.tools.map(tool => tool.function.name)
    expect(names).toEqual(expect.arrayContaining(['cad_read_history', 'cad_propose_undo', 'cad_propose_redo']))
    if (control.action === 'remove') {
      if (!result) return toolResponse(route, 'cad_query_impact', {
        ...context, operation: 'erase', ids: removedIds, tolerance: 0.01, maxBytes: 262144,
      })
      expect(result).toMatchObject({ ok: true, value: { canErase: true } })
      return toolResponse(route, 'cad_propose_structural_edit', {
        ...context, eraseIds: removedIds, tolerance: 0.01, maxBytes: 262144,
      }, '**Review the removal** before applying it.')
    }
    if (control.action === 'prose') return textResponse(route, 'Undo is a drawing history operation. The earlier removal remains applied.')
    if (!result) return toolResponse(route, 'cad_read_history', { expectedRevision: context.expectedRevision })
    expect(result.ok).toBe(true)
    const value = result.value
    historyReads.push(value)
    const target = control.action === 'redo' ? value.history.redoTarget : value.history.undoTarget
    if (control.action === 'read' || !target) return textResponse(route, 'There is no prior edit in this opened drawing to restore.')
    expect(target.id).toEqual(expect.any(String))
    return toolResponse(route, control.action === 'redo' ? 'cad_propose_redo' : 'cad_propose_undo', {
      expectedRevision: value.revision, units: value.units, targetHistoryId: target.id,
    }, 'Review the exact saved drawing state before applying this history operation.')
  })
  return { control, requests, historyReads }
}

async function send(page, prompt) {
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()
}

async function removeAndApprove(page) {
  await send(page, 'Remove the temporary survey edge and its label, retaining the outline, circle and native hatch.')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  expect((await engineState(page)).entities).toHaveLength(5)
  await page.getByTestId('proposal-approve').click()
  await expect.poll(async () => (await engineState(page)).entities.length).toBe(3)
  await expect(page.getByTestId('drawing-undo')).toBeEnabled()
}

test('natural model history proposals require approval and restore exact entities through real undo and redo', async ({ page }) => {
  const fixture = await drawingFixture(), provider = await mockProvider(page)
  await openDrawing(page, fixture)
  const baseline = await engineState(page)
  expect(baseline.history).toMatchObject({ canUndo: false, canRedo: false })
  await removeAndApprove(page)
  const removed = await engineState(page)
  expect(removed.entities).toEqual(baseline.entities.filter(entity => !removedIds.includes(entity.id)))
  expect(removed.calls).toEqual([])

  provider.control.action = 'prose'
  await send(page, 'Explain what undo means here without changing this drawing.')
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('earlier removal remains applied')
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  expect((await engineState(page)).entities).toEqual(removed.entities)

  provider.control.action = 'undo'
  const naturalPrompt = 'Put everything back exactly as it was before that last approved adjustment.'
  expect(naturalPrompt).not.toMatch(/undo|redo|撤销|重做/i)
  await send(page, naturalPrompt)
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await expect(page.getByTestId('drawing-result').last()).toContainText('UNDO')
  expect((await engineState(page)).entities).toEqual(removed.entities)
  expect((await engineState(page)).calls).toEqual([])
  const undoTarget = provider.historyReads.at(-1).history.undoTarget.id
  await page.getByTestId('proposal-reject').click()
  expect((await engineState(page)).entities).toEqual(removed.entities)
  expect((await engineState(page)).history.undoTarget.id).toBe(undoTarget)

  await send(page, 'I have reviewed it. Show that exact previous state for approval again.')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await page.getByTestId('proposal-approve').click()
  await expect.poll(async () => (await engineState(page)).entities).toEqual(baseline.entities)
  const restored = await engineState(page)
  expect(restored.history).toMatchObject({ canUndo: false, canRedo: true })
  expect(restored.lastRevision).toMatchObject({ kind: 'undo', operationCount: 0 })
  expect(restored.calls).toEqual([{ name: 'undo', documentId: fixture.document.id,
    beforeRevision: removed.revision, revision: removed.revision + 1, result: true }])

  provider.control.action = 'redo'
  await send(page, 'Apply that same approved removal again, preserving all retained geometry.')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await expect(page.getByTestId('drawing-result').last()).toContainText('REDO')
  expect((await engineState(page)).entities).toEqual(baseline.entities)
  await page.getByTestId('proposal-approve').click()
  await expect.poll(async () => (await engineState(page)).entities).toEqual(removed.entities)
  const repeated = await engineState(page)
  expect(repeated.lastRevision).toMatchObject({ kind: 'redo', operationCount: 0 })
  expect(repeated.calls.map(call => call.name)).toEqual(['undo', 'redo'])

  const waiting = page.waitForEvent('download')
  await page.getByTestId('drawing-download').last().click()
  const download = await waiting
  const exported = await fixture.sdk.readDocument(new Uint8Array(await readFile(await download.path())), { format: 'DXF' })
  expect(exported.validate().valid).toBe(true)
  expect(exported.listEntities()).toHaveLength(3)
  expect(exported.listEntities().find(entity => entity.type === 'HATCH').payload.boundaryLoops[0].flags).toBe(22)
  expect(exported.listEntities().find(entity => entity.type === 'CIRCLE').payload).toMatchObject({ center: [125, 65, 0], radius: 14 })
})

test('drawing history controls use the real engine without another provider request', async ({ page }) => {
  const fixture = await drawingFixture(), provider = await mockProvider(page)
  await openDrawing(page, fixture)
  const baseline = await engineState(page)
  await expect(page.getByTestId('drawing-undo')).toBeDisabled()
  await expect(page.getByTestId('drawing-redo')).toBeDisabled()
  await removeAndApprove(page)
  const removed = await engineState(page), requestCount = provider.requests.length
  await page.getByTestId('drawing-undo').click()
  await expect.poll(async () => (await engineState(page)).entities).toEqual(baseline.entities)
  await expect(page.getByTestId('drawing-redo')).toBeEnabled()
  await page.getByTestId('drawing-redo').click()
  await expect.poll(async () => (await engineState(page)).entities).toEqual(removed.entities)
  expect((await engineState(page)).calls.map(call => call.name)).toEqual(['undo', 'redo'])
  expect(provider.requests).toHaveLength(requestCount)
})

test('refresh restores validated real history while pending history approval expires', async ({ page }) => {
  const fixture = await drawingFixture(), provider = await mockProvider(page)
  await openDrawing(page, fixture)
  const baseline = await engineState(page)
  await removeAndApprove(page)
  const removed = await engineState(page)
  await expect.poll(async () => (await savedRecord(page))?.sessions?.[0]?.state?.drawingHistory?.documentRevision).toBe(removed.revision)
  await page.reload()
  await observeEngine(page)
  await page.getByTestId('drawing-context').locator('summary').click()
  await page.getByTestId('drawing-context').locator('[data-viewer-action="fit"]').click()
  await expect.poll(async () => (await engineState(page))?.entities).toEqual(removed.entities)
  await expect(page.getByTestId('drawing-undo')).toBeEnabled()
  const freshTarget = (await engineState(page)).history.undoTarget.id
  expect(freshTarget).not.toBe(removed.history.undoTarget.id)
  await page.getByTestId('drawing-undo').click()
  await expect.poll(async () => (await engineState(page)).entities).toEqual(baseline.entities)

  provider.control.action = 'redo'
  await send(page, 'Bring back the approved removal so I can review it once more.')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await expect.poll(async () => (await savedRecord(page))?.sessions?.[0]?.messages?.at(-1)?.proposals?.[0]?.uiState).toBe('pending')
  await page.reload()
  await observeEngine(page)
  await page.getByTestId('drawing-context').locator('summary').click()
  await page.getByTestId('drawing-context').locator('[data-viewer-action="fit"]').click()
  await expect(page.getByTestId('drawing-result').last()).toContainText('Expired')
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  await expect.poll(async () => (await engineState(page))?.entities).toEqual(baseline.entities)
  await expect(page.getByTestId('drawing-redo')).toBeEnabled()
  await page.getByTestId('drawing-redo').click()
  await expect.poll(async () => (await engineState(page)).entities).toEqual(removed.entities)
})

test('an imported drawing is a history baseline and prose never supplies an inverse edit', async ({ page }) => {
  const fixture = await drawingFixture(), provider = await mockProvider(page)
  provider.control.action = 'read'
  await openDrawing(page, fixture)
  const baseline = await engineState(page)
  await send(page, 'Undo the earlier changes mentioned in a previous conversation and restore the original file.')
  await expect(page.locator('.message.assistant .message-content').last()).toContainText('no prior edit')
  expect(provider.historyReads.at(-1)).toMatchObject({ baseline: 'opened-document', history: { canUndo: false, canRedo: false } })
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  await expect(page.getByTestId('drawing-undo')).toBeDisabled()
  expect((await engineState(page)).entities).toEqual(baseline.entities)
  expect((await engineState(page)).calls).toEqual([])
})

for (const archiveState of ['missing', 'corrupt']) {
  test(`${archiveState} saved history preserves the approved drawing but cannot invent a prior state`, async ({ page }) => {
    const fixture = await drawingFixture(), provider = await mockProvider(page)
    await openDrawing(page, fixture)
    await removeAndApprove(page)
    const removed = await engineState(page)
    await expect.poll(async () => (await savedRecord(page))?.sessions?.[0]?.state?.drawingHistory?.documentRevision).toBe(removed.revision)
    await page.evaluate(async mode => {
      const { loadLocalHistory, saveLocalHistory } = await import('/apps/playground/ai/local-history.js')
      const record = await loadLocalHistory()
      const session = record.sessions.find(item => item.id === record.activeId)
      if (mode === 'missing') delete session.state.drawingHistory
      else session.state.drawingHistory.documentFingerprint = 'mismatched-regression-fixture'
      await saveLocalHistory(record)
    }, archiveState)
    await page.reload()
    await observeEngine(page)
    await page.getByTestId('drawing-context').locator('summary').click()
    await page.getByTestId('drawing-context').locator('[data-viewer-action="fit"]').click()
    await expect.poll(async () => (await engineState(page))?.entities).toEqual(removed.entities)
    await expect(page.locator('#drawing-history-warning')).toBeVisible()
    await expect(page.getByTestId('drawing-undo')).toBeDisabled()
    await expect(page.getByTestId('drawing-redo')).toBeDisabled()
    provider.control.action = 'undo'
    await send(page, 'This saved chat mentions an approved removal. Put the preceding drawing state back for review.')
    await expect(page.locator('.message.assistant .message-content').last()).toContainText('no prior edit')
    await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
    expect(provider.historyReads.at(-1).history).toMatchObject({ canUndo: false, canRedo: false })
    expect((await engineState(page)).entities).toEqual(removed.entities)
    expect((await engineState(page)).calls).toEqual([])
  })
}

test('assistant Markdown formats safely and scrolls code and tables inside a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const longCode = 'survey_point_' + '0123456789'.repeat(30)
  const markdown = [
    '## Drawing review', '', '**Native geometry** and *review notes*.', '',
    '- Retain the circle', '- Restore the original hatch', '',
    '> Approval is required before an edit.', '',
    '| Entity | Before | After |', '| --- | --- | --- |',
    '| Survey-edge-with-a-very-long-unbroken-object-identity | Original | Restored |', '',
    '```text', longCode, '```', '', 'Use `cad_read_history` first.', '',
    '[Documentation](https://example.com/history) [unsafe](javascript:alert(1))', '',
    '<img src="https://xss-test.invalid/image" onerror="window.aiMarkdownXss=true">',
    '<script>window.aiMarkdownXss=true</script>', '',
    '![external image](https://xss-test.invalid/pixel)',
  ].join('\n')
  const unwantedRequests = []
  page.on('request', request => { if (request.url().includes('xss-test.invalid')) unwantedRequests.push(request.url()) })
  await page.route(modelEndpoint, route => textResponse(route, markdown))
  await page.goto('/ai/')
  await connectMock(page)
  await send(page, '**This user message is plain text.** Explain the drawing history tools.')
  const assistant = page.locator('.message.assistant .message-content').last()
  await expect(assistant.locator('h2')).toHaveText('Drawing review')
  await expect(assistant.locator('strong')).toHaveText('Native geometry')
  await expect(assistant.locator('em')).toHaveText('review notes')
  await expect(assistant.locator('ul > li')).toHaveCount(2)
  await expect(assistant.locator('blockquote')).toContainText('Approval is required')
  await expect(assistant.locator('pre > code')).toHaveText(longCode)
  await expect(assistant.locator('p > code')).toHaveText('cad_read_history')
  await expect(assistant.locator('table th')).toHaveCount(3)
  await expect(assistant.locator('.message-table-scroll')).toHaveAttribute('tabindex', '0')
  await expect(assistant.getByRole('link')).toHaveCount(1)
  await expect(assistant.getByRole('link')).toHaveAttribute('href', 'https://example.com/history')
  await expect(assistant.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(assistant.locator('img, script, iframe, object')).toHaveCount(0)
  await expect(assistant).toContainText('<script>window.aiMarkdownXss=true</script>')
  expect(await page.evaluate(() => window.aiMarkdownXss)).toBeUndefined()
  expect(unwantedRequests).toEqual([])
  await expect(page.locator('.message.user .message-content strong')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  expect(await assistant.locator('pre').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
  await expect(assistant.locator('.message-table-scroll')).toHaveAttribute('role', 'region')
  await expect.poll(async () => (await savedRecord(page))?.sessions?.[0]?.messages?.at(-1)?.text).toBe(markdown)
  await page.reload()
  await expect(page.locator('.message.assistant .message-content').last().locator('h2')).toHaveText('Drawing review')
  await expect(page.locator('.message.assistant img, .message.assistant script')).toHaveCount(0)
})
