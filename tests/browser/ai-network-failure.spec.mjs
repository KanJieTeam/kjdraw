import { expect, test } from '@playwright/test'

test('model network failure stays in the conversation as a clear error', async ({ page }) => {
  await page.route('**/ai-test.invalid/**', route => route.abort('failed'))
  await page.goto('/ai/')
  const prompt = '画一条 100 毫米的水平线'
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()

  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('test-model')
  await page.getByTestId('settings-key').fill('test-key')
  await page.getByTestId('settings-save').click()

  await expect(page.getByTestId('chat-message')).toContainText([prompt])
  await expect(page.getByTestId('chat-error')).toBeVisible()
  await expect(page.getByTestId('chat-error')).toContainText(/网络|连接|请求|失败|重试/)
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)
})

test('a stalled model request can be stopped without mutating the drawing', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input, init) => String(input).includes('ai-test.invalid')
      ? new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
      : originalFetch(input, init)
  })
  await page.goto('/ai/')
  const prompt = 'Draw a 100 mm line'
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('test-model')
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('chat-stop')).toBeVisible()
  await page.getByTestId('chat-stop').click()
  await expect(page.getByTestId('chat-message').last()).toContainText('Stopped. The drawing was not changed.')
  await expect(page.getByTestId('chat-send')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toHaveValue(prompt)
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)
})
