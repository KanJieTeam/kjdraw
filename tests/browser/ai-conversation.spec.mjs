import { expect, test } from '@playwright/test'

test('AI route opens a dedicated conversation with an honest empty state', async ({ page }) => {
  await page.goto('/ai/')

  await expect(page.getByTestId('chat-empty')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toBeVisible()
  await expect(page.getByTestId('chat-send')).toBeVisible()
  await expect(page.getByTestId('chat-message')).toHaveCount(0)
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)

  // The old CAD workbench and its preloaded review scene must not be the AI entry point.
  await expect(page.locator('.workbench')).toHaveCount(0)
  await expect(page.locator('#agent-tab')).toHaveCount(0)
  await expect(page.locator('#sample-select')).toHaveCount(0)
})

test('sending without a model keeps the prompt and does not claim a drawing exists', async ({ page }) => {
  await page.goto('/ai/')
  const prompt = '画一张三层地质柱状图，并标注每层厚度'
  await page.getByTestId('chat-input').fill(prompt)
  await page.getByTestId('chat-send').click()

  await expect(page.getByTestId('chat-input')).toHaveValue(prompt)
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)
  await expect(page.getByTestId('chat-message')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText(/模型|连接|配置|model|connect|setup/i)
  await expect(page.getByTestId('settings-endpoint')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByTestId('chat-input')).toHaveValue(prompt)
})

test('conversation controls remain usable by keyboard on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ai/')

  await expect(page.getByTestId('chat-input')).toBeVisible()
  await expect(page.getByTestId('chat-send')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  const unnamedButtons = await page.locator('button:visible').evaluateAll(buttons => buttons
    .filter(button => !button.getAttribute('aria-label') && !button.textContent?.trim() && !button.getAttribute('title'))
    .map(button => button.outerHTML))
  expect(unnamedButtons).toEqual([])

  await page.getByTestId('chat-input').focus()
  await expect(page.getByTestId('chat-input')).toBeFocused()
  await page.keyboard.type('画一根柱子')
  await expect(page.getByTestId('chat-input')).toHaveValue('画一根柱子')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
})
