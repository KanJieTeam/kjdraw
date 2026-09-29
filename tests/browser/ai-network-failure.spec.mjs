import { expect, test } from '@playwright/test'

test('model network failure stays in the conversation as a clear error', async ({ page }) => {
  await page.route('**/ai-test.invalid/**', route => route.abort('failed'))
  await page.goto('/ai/')
  const prompt = '画一条 100 毫米的水平线'
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()

  await page.getByTestId('settings-endpoint').fill('https://ai-test.invalid/v1/chat/completions')
  await page.getByTestId('settings-model').fill('test-model')
  await page.getByTestId('settings-key').fill('test-key')
  await page.getByTestId('settings-save').click()

  await expect(page.getByTestId('chat-message')).toContainText([prompt])
  await expect(page.getByTestId('chat-error')).toBeVisible()
  await expect(page.getByTestId('chat-error')).toContainText(/网络|连接|请求|失败|重试/)
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)
})
