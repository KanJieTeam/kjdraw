import { test, expect } from '@playwright/test'

test('Showcase searches, filters and changes view using generated public sample cards', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium journey covers the documentation-only interaction')
  await page.goto('/docs/latest/showcase/')
  const portal = page.locator('.showcase-portal[data-locale="en"]')
  await expect(portal).toBeVisible()
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(12)
  await expect(portal.locator('.showcase-thumb img')).toHaveCount(12)
  await expect(portal.locator('.showcase-category[data-category="all"] b')).toHaveText('12')
  await expect(portal.locator('.showcase-category[data-category="core-capabilities"] b')).toHaveText('4')

  await portal.locator('.showcase-query').fill('bearing holes')
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(1)
  await expect(portal.locator('.showcase-card:visible')).toHaveAttribute('data-case-id', 'mechanical-bracket')
  await expect(portal.locator('.showcase-card:visible .showcase-actions a.primary')).toHaveAttribute('href', 'https://kanjieteam.github.io/kjdraw/?sample=sample-mechanical')
  await expect(portal.locator('.showcase-result-head output b')).toHaveText('1')

  await portal.locator('.showcase-query').fill('')
  await portal.locator('.showcase-category[data-category="civil"]').click()
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(1)
  await expect(portal.locator('.showcase-card:visible')).toHaveAttribute('data-case-id', 'site-plan')

  await portal.locator('[data-view="list"]').click()
  await expect(portal.locator('.showcase-grid')).toHaveClass(/list/)
  await expect(portal.locator('[data-view="list"]')).toHaveAttribute('aria-pressed', 'true')

  await page.locator('#language').click()
  const zh = page.locator('.showcase-portal[data-locale="zh"]')
  await expect(zh).toBeVisible()
  await zh.locator('.showcase-tag-filter').selectOption('尺寸')
  await expect(zh.locator('.showcase-card:visible')).toHaveCount(3)
  await expect(zh.locator('.showcase-empty')).toBeHidden()
})
