import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

test('real CAD proposal stays pending until approval and exports a reopenable KJD', async ({ page }) => {
  const requests = []
  const args = { expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [] }
  await page.route('https://ai-test.invalid/v1/chat/completions', route => {
    const request = route.request()
    requests.push({ authorization: request.headers().authorization, body: request.postDataJSON() })
    return route.fulfill({ json: {
      id: 'mock-tool', object: 'chat.completion', model: 'browser-fixture',
      choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [{
        id: 'call-1', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify(args) },
      }] }, finish_reason: 'tool_calls' }],
    } })
  })

  await page.goto('/ai/')
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  await page.getByTestId('chat-input').fill('Draw a line from 0,0 to 20,0 millimeters')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-key').fill('browser-test-key')
  await page.getByTestId('settings-save').click()

  const card = page.getByTestId('drawing-result')
  await expect(card).toBeVisible()
  await expect(card).toContainText('REV 0')
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  await expect.poll(() => card.locator('canvas').evaluate(canvas => {
    if (!canvas.width || !canvas.height) return 0
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let drawn = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 230 || pixels[i + 1] < 230 || pixels[i + 2] < 230) drawn++
    return drawn
  })).toBeGreaterThan(20)
  expect(requests).toHaveLength(1)
  expect(requests[0].authorization).toBe('Bearer browser-test-key')
  expect(requests[0].body.model).toBe('browser-fixture')

  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-download')).toBeVisible()
  const waiting = page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const download = await waiting
  expect(download.suggestedFilename()).toBe('kjdraw-ai-drawing.kjd')
  const drawing = await createKJDrawSDK().readDocument(await readFile(await download.path(), 'utf8'), { format: 'KJD' })
  expect(drawing.validate().valid).toBe(true)
  expect(drawing.revision).toBe(1)
  expect(drawing.listEntities()).toHaveLength(1)
  expect(drawing.listEntities()[0].payload.start).toEqual([0, 0, 0])
  expect(drawing.listEntities()[0].payload.end).toEqual([20, 0, 0])
})

test('language switch updates examples and connection controls together', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' })
  const page = await context.newPage()
  await page.goto('/ai/')
  await expect(page.locator('.suggestions button')).toHaveText([
    '画一条 100 mm 水平线', '画一个半径 25 mm 的圆', '画一个 120 × 80 mm 矩形',
  ])
  await expect(page.getByTestId('settings-open')).toContainText('连接模型')
  await page.getByRole('button', { name: 'Switch to English' }).click()
  await expect(page.locator('.suggestions button')).toHaveText([
    'Draw a 100 mm horizontal line', 'Draw a circle with a 25 mm radius', 'Draw a 120 × 80 mm rectangle',
  ])
  await expect(page.getByTestId('settings-open')).toContainText('Connect model')
  await page.getByRole('button', { name: '切换到中文' }).click()
  await expect(page.locator('.suggestions button')).toHaveText([
    '画一条 100 mm 水平线', '画一个半径 25 mm 的圆', '画一个 120 × 80 mm 矩形',
  ])
  await expect(page.getByTestId('settings-open')).toContainText('连接模型')
  await context.close()
})
