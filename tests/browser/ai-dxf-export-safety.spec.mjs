import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

// Synthetic incomplete viewport reference; no private drawing or model calls.
const incompleteViewportDrawing = () => [
  0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1015',0,'ENDSEC',
  0,'SECTION',2,'ENTITIES',0,'TEXT',5,'10',8,'0',10,1,20,2,40,2,1,'PUBLIC LABEL',
  0,'VIEWPORT',5,'20',102,'{ACAD_XDICTIONARY',360,'DEAD',102,'}',8,'0',67,1,
  10,50,20,50,30,0,40,90,41,80,68,1,69,2,12,0,22,0,16,0,26,0,36,1,17,0,27,0,37,0,45,80,90,0,
  0,'ENDSEC',0,'EOF','',
].join('\n')

async function savedSession(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('kjdraw-ai-local')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const request = db.transaction('conversations').objectStore('conversations').get('history')
      request.onerror = () => { db.close(); reject(request.error) }
      request.onsuccess = () => { const value = request.result?.sessions?.[0]; db.close(); resolve(value) }
    }
  }))
}

test('unsupported viewport links are disclosed on import and failed DXF export is clear without a private-format fallback', async ({ page }) => {
  const downloads = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  let phase = 0
  await page.route('https://export-safety.invalid/v1/chat/completions', route => {
    const body = route.request().postDataJSON()
    let name, args
    if (phase === 0) {
      const revision = Number(body.messages.findLast(message => message.role === 'user').content.match(/revision (\d+)/)[1])
      name = 'cad_find_text'; args = { expectedRevision: revision, search: 'PUBLIC LABEL', match: 'exact' }
    } else {
      const result = JSON.parse(body.messages.findLast(message => message.role === 'tool').content)
      expect(result.ok).toBe(true)
      name = 'cad_propose_text_edit'; args = { expectedRevision: result.value.revision, units: result.value.units,
        changes: [{ id: result.value.matches[0].id, expectedText: 'PUBLIC LABEL', text: 'REVIEWED LABEL' }] }
    }
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: `export-safety-${++phase}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
    }] }, finish_reason: 'tool_calls' }] } })
  })
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name: 'incomplete-viewports.dxf', mimeType: 'application/dxf', buffer: Buffer.from(incompleteViewportDrawing()) })
  const warning = page.getByTestId('drawing-export-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('DXF export is unavailable')
  await expect(warning).toContainText('original file is unchanged')
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://export-safety.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('mock-protocol')
  await page.getByTestId('settings-key').fill('not-a-real-key')
  await page.getByTestId('settings-save').click()
  await page.getByTestId('chat-input').fill('Change the text PUBLIC LABEL to REVIEWED LABEL; edit its text only.')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  await expect.poll(async () => (await savedSession(page))?.state?.committed).toBe(true)
  const approved = (await savedSession(page)).state.drawing
  await page.getByTestId('drawing-download').click()
  await expect(page.getByTestId('chat-error').last()).toContainText('DXF export was blocked to avoid losing viewport-linked data')
  await expect(page.getByTestId('chat-error').last()).not.toContainText('DEAD')
  expect(downloads).toEqual([])
  expect((await savedSession(page)).state.drawing).toBe(approved)
  const retained = await createKJDrawSDK().readDocument(approved, { format: 'KJD' })
  expect(retained.listEntities({ type: 'TEXT' })[0].payload.text).toBe('REVIEWED LABEL')
  await page.reload()
  await expect(warning).toContainText('DXF export is unavailable')
  await page.getByRole('button', { name: '切换到中文' }).click()
  await expect(warning).toContainText('暂不能导出 DXF')
  await page.getByTestId('drawing-download').click()
  await expect(page.getByTestId('chat-error').last()).toContainText('本次 DXF 导出已阻止')
  expect(downloads).toEqual([])
  await page.locator('#new-chat').click()
  await expect(warning).toBeHidden()
})
