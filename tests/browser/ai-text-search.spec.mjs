import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { publicAnnotationSheet } from '../helpers/public-annotation-sheet.mjs'

test('uploaded DXF label gets a real proposal after one prose-only turn, then can be reviewed and restored', async ({ page }) => {
  // Protocol fixture: exercise the real browser and CAD engine, without claiming a live-model score.
  const { dxf } = await publicAnnotationSheet()
  const sdk = createKJDrawSDK()
  const imported = await sdk.readDocument(dxf, { format: 'DXF' })
  const original = imported.listEntities().find(entity => entity.payload.text === 'ZK03')
  let phase = 0
  const calls = []
  await page.route('https://ai-test.invalid/v1/chat/completions', route => {
    const body = route.request().postDataJSON()
    expect(body.tools.some(tool => tool.function.name === 'cad_find_text')).toBe(true)
    if (phase === 1) {
      phase++
      return route.fulfill({ json: { choices: [{ message: { role: 'assistant',
        content: 'The change is ready for approval.',
      }, finish_reason: 'stop' }] } })
    }
    let name, args
    if (phase === 0) {
      name = 'cad_find_text'
      args = { expectedRevision: imported.revision, search: 'ZK03', match: 'exact' }
    } else {
      expect(body.messages.at(-1).content).toContain('no reviewable proposal exists')
      const result = JSON.parse(body.messages.findLast(message => message.role === 'tool').content)
      expect(result.ok).toBe(true)
      expect(result.value.totalMatches).toBe(1)
      expect(result.value.matches[0].handle).toBe(original.handle)
      name = 'cad_propose_text_edit'
      args = { expectedRevision: result.value.revision, units: result.value.units,
        changes: [{ id: result.value.matches[0].id, expectedText: result.value.matches[0].text, text: 'ZK03-A' }],
      }
    }
    phase++
    calls.push(name)
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'find-label-' + phase, type: 'function', function: { name, arguments: JSON.stringify(args) },
    }] }, finish_reason: 'tool_calls' }] } })
  })
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name: 'public-sheet.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await expect(page.getByTestId('drawing-context')).toBeVisible()
  await page.getByTestId('chat-input').fill('Change the hole label ZK03 to ZK03-A. Edit its text only.')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  expect(calls).toEqual(['cad_find_text', 'cad_propose_text_edit'])
  expect(phase).toBe(3)
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  await expect.poll(() => page.getByTestId('drawing-result').locator('canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let drawn = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 230 || pixels[i + 1] < 230 || pixels[i + 2] < 230) drawn++
    return drawn
  })).toBeGreaterThan(20)
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  const waiting = page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const download = await waiting
  expect(download.suggestedFilename()).toMatch(/\.dxf$/)
  const reopened = await sdk.readDocument(new Uint8Array(await readFile(await download.path())), { format: 'DXF' })
  expect(reopened.validate().valid).toBe(true)
  expect(reopened.listEntities()).toHaveLength(imported.listEntities().length)
  expect(reopened.listEntities().find(entity => entity.handle === original.handle).payload.text).toBe('ZK03-A')
  expect(reopened.listEntities().filter(entity => entity.type === 'HATCH')[0].payload.boundaryLoops[0].flags).toBe(22)
  await page.reload()
  await expect(page.getByTestId('drawing-result')).toContainText('Applied')
  await expect(page.getByTestId('drawing-download')).toBeVisible()
})

test('prose-only response never creates an approval card and keeps its unchanged notice after refresh', async ({ page }) => {
  const { dxf } = await publicAnnotationSheet()
  const sdk = createKJDrawSDK(), imported = await sdk.readDocument(dxf, { format: 'DXF' })
  let requests = 0
  await page.route('https://ai-test.invalid/v1/chat/completions', route => {
    requests++
    const message = requests === 1 ? { role: 'assistant', content: '', tool_calls: [{
      id: 'read-label', type: 'function', function: { name: 'cad_find_text', arguments: JSON.stringify({
        expectedRevision: imported.revision, search: 'ZK03', match: 'exact',
      }) },
    }] } : { role: 'assistant', content: 'The change is ready for approval.' }
    return route.fulfill({ json: { choices: [{ message, finish_reason: requests === 1 ? 'tool_calls' : 'stop' }] } })
  })
  await page.goto('/ai/')
  await page.getByTestId('drawing-file').setInputFiles({ name: 'public-sheet.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await expect(page.getByTestId('drawing-context')).toBeVisible()
  await page.getByTestId('chat-input').fill('Change the hole label ZK03 to ZK03-A. Edit its text only.')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('chat-no-proposal')).toContainText('The drawing is unchanged.')
  expect(requests).toBe(3)
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('chat-no-proposal')).toContainText('The drawing is unchanged.')
  await expect(page.getByTestId('proposal-approve')).toHaveCount(0)
  expect(requests).toBe(3)
})
