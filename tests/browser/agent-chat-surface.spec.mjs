import { test, expect } from '@playwright/test'

test('dedicated Try with AI surface opens the real conversation and CAD runtime', async ({ page }) => {
  await page.goto('/ai/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await expect(page.locator('body')).toHaveClass(/ai-surface/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('#ai-chat-window')).toBeVisible()
  await expect(page.locator('#chat-provider')).toBeAttached()
  await expect(page.locator('#chat-input')).toBeVisible()
  await expect(page.locator('#canvas')).toBeVisible()
  await expect(page.locator('.cad-ribbon')).toBeHidden()
})
