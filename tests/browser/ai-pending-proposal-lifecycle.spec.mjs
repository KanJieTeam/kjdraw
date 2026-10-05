import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn } from '../../packages/kjdraw-sdk/src/geology-engineering.js'

// Offline public synthetic provider-wire fixtures, not real-model acceptance.
// Native source, approval registry, undo, canvas, history and IndexedDB stay real.
const endpoint = 'https://public-pending-browser.invalid/v1/chat/completions'
const content = state => ({ objects: state.objects, tables: state.tables, spaces: state.spaces, opaquePayloads: state.opaquePayloads })
async function saved(page) {
  return page.evaluate(async () => {
    const record = await (await import('/apps/playground/ai/local-history.js')).loadLocalHistory()
    return record.sessions.find(session => session.id === record.activeId)
  })
}
async function send(page, prompt) {
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()
}
async function setup(page) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'public-browser-pending-undo', units: 'millimeter' })
  const source = { kind: 'column', input: { expectedRevision: 0, locale: 'zh-CN', verticalScaleDenominator: 200,
    hole: { id: 'PUBLIC-HOLE', collarElevation: 100, depth: 6, strata: [
      { intervalId: 'PUBLIC-FILL', code: '1', name: '素填土', lithology: 'fill', top: 0, bottom: 2 },
      { intervalId: 'PUBLIC-CLAY', code: '2', name: '黏土', lithology: 'clay', top: 2, bottom: 6 },
    ] } } }
  await sdk.executeCommand('CREATEBATCH', { ...structuredClone(compileGeologyColumn(source.input).commandArgs),
    geologySource: structuredClone(source) }, { document })
  const drawing = await sdk.writeDocument(document, { format: 'KJD' }), baseline = content(JSON.parse(drawing))
  const drawingId = Object.keys(document.snapshot().opaquePayloads).find(key => key.startsWith('geology-drawing-recipe:')).slice('geology-drawing-recipe:'.length)
  let requests = 0, releaseFailure, failureStarted
  const failure = new Promise(resolve => { failureStarted = resolve })
  const release = new Promise(resolve => { releaseFailure = resolve })
  await page.route(endpoint, async route => {
    requests++
    const body = route.request().postDataJSON(), context = body.messages.find(message => message.role === 'user').content
    const revision = Number(/; revision (\d+);/.exec(context)[1]), last = body.messages.at(-1)
    const prompt = context.slice(context.lastIndexOf('Current user request: ') + 'Current user request: '.length)
    let name, args
    if (prompt === '下一条复合请求') {
      failureStarted()
      await release
      return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: 'x'.repeat(1048600) }, finish_reason: 'stop' }] } })
    }
    if (prompt === '素填土改成杂填土') {
      if (last.role === 'user') { name = 'cad_read_geology_source'; args = { expectedRevision: revision, drawingId, maxBytes: 262144 } }
      else {
        const receipt = JSON.parse(last.content); expect(receipt.ok).toBe(true)
        const hole = receipt.value.facts.hole, interval = hole.strata[0]
        name = 'cad_propose_geology_revision'
        args = { expectedRevision: receipt.value.revision, units: receipt.value.units, drawingId,
          updates: [{ holeId: hole.id, stratumChanges: { update: [{ target: { intervalId: interval.intervalId,
            expectedTop: interval.top, expectedBottom: interval.bottom }, set: { name: '杂填土' } }] } }] }
      }
    } else if (last.role === 'user') { name = 'cad_read_history'; args = { expectedRevision: revision } }
    else {
      const receipt = JSON.parse(last.content); expect(receipt.ok).toBe(true)
      name = 'cad_propose_undo'; args = { expectedRevision: receipt.value.revision, units: receipt.value.units,
        targetHistoryId: receipt.value.history.undoTarget.id }
    }
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: 'Review this exact native proposal.', tool_calls: [{
      id: 'pending-browser-' + requests, type: 'function', function: { name, arguments: JSON.stringify(args) },
    }] }, finish_reason: 'tool_calls' }] } })
  })
  await page.goto('/ai/')
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.getByTestId('drawing-file').setInputFiles({ name: 'public-pending.kjd', mimeType: 'application/json', buffer: Buffer.from(drawing) })
  await expect(page.locator('#drawing-name')).toHaveText('public-pending.kjd')
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(endpoint)
  await page.getByTestId('settings-model').fill('offline-public-lifecycle-fixture')
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#settings-dialog')).not.toBeVisible()
  await send(page, '素填土改成杂填土')
  await expect(page.getByTestId('proposal-approve')).toBeEnabled()
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('chat-send')).toBeEnabled()
  await expect.poll(async () => JSON.parse((await saved(page)).state.drawing).revision).toBe(2)
  await send(page, '撤销')
  await expect(page.getByTestId('proposal-approve')).toBeEnabled()
  const record = await saved(page), undo = record.messages.flatMap(message => message.proposals ?? []).find(proposal => proposal.uiState === 'pending')
  expect(undo.command).toBe('UNDO'); expect(undo.expectedRevision).toBe(2)
  const card = page.locator(`[data-plan-id="${undo.planId}"]`)
  await expect(card.locator('.drawing-viewer')).not.toHaveAttribute('data-viewer-error', 'true')
  return { sdk, baseline, undo, card, failure, releaseFailure, requests: () => requests,
    dispose: () => { releaseFailure(); for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}

for (const action of ['approve', 'reject']) test('REV2 undo survives a failed next size-limited request and remains usable for ' + action + ' after durable save', async ({ page }) => {
  const f = await setup(page)
  try {
    const before = await saved(page)
    await send(page, '下一条复合请求')
    await f.failure
    await expect(f.card.getByTestId('proposal-approve')).toBeDisabled()
    await expect(f.card.getByTestId('proposal-reject')).toBeDisabled()
    await expect(f.card.locator('.proposal-tag')).not.toHaveText('Expired')
    f.releaseFailure()
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    const failed = await saved(page)
    expect(failed.messages.at(-1).status).toBe('error')
    expect(failed.messages.at(-1).text).toMatch(/The model response exceeded the size limit \(\d+ bytes; maximum 1048576 bytes\)/)
    expect(failed.state.drawing).toBe(before.state.drawing)
    expect(failed.messages.flatMap(message => message.proposals ?? []).find(proposal => proposal.planId === f.undo.planId).uiState).toBe('pending')
    await expect(f.card.getByTestId('proposal-approve')).toBeEnabled()
    await expect(f.card.locator('.drawing-viewer')).not.toHaveAttribute('data-viewer-error', 'true')
    if (action === 'reject') {
      await f.card.getByTestId('proposal-reject').click()
      await expect(page.getByTestId('chat-send')).toBeEnabled()
      const rejected = await saved(page)
      expect(rejected.state.drawing).toBe(before.state.drawing)
      expect(rejected.messages.flatMap(message => message.proposals ?? []).find(proposal => proposal.planId === f.undo.planId).uiState).toBe('rejected')
      expect(f.requests()).toBe(5)
      await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
      return
    }
    await f.card.getByTestId('proposal-approve').click()
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    const undone = await saved(page), native = JSON.parse(undone.state.drawing)
    expect(native.revision).toBe(3)
    expect(content(native)).toEqual(f.baseline)
    expect(undone.messages.flatMap(message => message.proposals ?? []).find(proposal => proposal.planId === f.undo.planId).uiState).toBe('approved')
    expect(native.revisions.at(-1).kind).toBe('undo')
    expect(f.requests()).toBe(5)
    await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
    await page.reload()
    expect(content(JSON.parse((await saved(page)).state.drawing))).toEqual(f.baseline)
  } finally { f.dispose() }
})
test('successful replacement handoff expires only the previous review and does not apply either proposal automatically', async ({ page }) => {
  const f = await setup(page)
  try {
    const before = (await saved(page)).state.drawing
    await send(page, '再生成撤销提案')
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    await expect(f.card.locator('.proposal-tag')).toHaveText('Expired')
    const record = await saved(page), pending = record.messages.flatMap(message => message.proposals ?? []).filter(proposal => proposal.uiState === 'pending')
    expect(pending).toHaveLength(1); expect(pending[0].planId).not.toBe(f.undo.planId)
    expect(pending[0].expectedRevision).toBe(2); expect(record.state.drawing).toBe(before)
    await expect(page.getByTestId('proposal-approve')).toHaveCount(1)
    await page.getByTestId('proposal-approve').click()
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    expect(content(JSON.parse((await saved(page)).state.drawing))).toEqual(f.baseline)
  } finally { f.dispose() }
})

test('size error UI formats only known numeric phase details and hides malformed or untrusted extra fields', async ({ page }) => {
  await page.goto('/ai/')
  const result = await page.evaluate(async () => {
    const { requestErrorMessage } = await import('/apps/playground/ai/ai.js')
    const valid = { phase: 'response', actualBytes: 1048600, maxBytes: 1048576 }
    const malformed = [undefined, null, {}, { ...valid, phase: 'PRIVATE_PROMPT_DO_NOT_DISPLAY' },
      { ...valid, phase: '__proto__' }, { ...valid, actualBytes: 'PRIVATE_PROMPT_DO_NOT_DISPLAY' },
      { ...valid, actualBytes: -1 }, { ...valid, actualBytes: NaN }, { ...valid, actualBytes: Infinity },
      { ...valid, actualBytes: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, maxBytes: 0 }, { ...valid, maxBytes: '1048576' }]
    return { malformed: malformed.map(details => requestErrorMessage({ code: 'KJMODEL_SIZE_LIMIT', message: 'Safe fallback', details }, 'Fallback')),
      wrongCode: requestErrorMessage({ code: 'OTHER_ERROR', message: 'Safe fallback', details: valid }, 'Fallback'),
      valid: requestErrorMessage({ code: 'KJMODEL_SIZE_LIMIT', details: { ...valid, prompt: 'PRIVATE_PROMPT_DO_NOT_DISPLAY', apiKey: 'PRIVATE_KEY_DO_NOT_DISPLAY' } }, 'Fallback') }
  })
  expect(result.malformed.every(text => text === 'Safe fallback')).toBe(true)
  expect(result.wrongCode).toBe('Safe fallback')
  expect(result.valid).toContain('The model response exceeded the size limit (1048600 bytes; maximum 1048576 bytes)')
  expect(JSON.stringify(result)).not.toContain('PRIVATE_')
  await page.locator('#language-button').click()
  const chinese = await page.evaluate(async () => (await import('/apps/playground/ai/ai.js')).requestErrorMessage({ code: 'KJMODEL_SIZE_LIMIT',
    details: { phase: 'request', actualBytes: 2097200, maxBytes: 2097152 } }, 'Fallback'))
  expect(chinese).toContain('本次请求与工具读取记录超过大小限制（实际 2097200 字节，上限 2097152 字节）')
})
