import { expect, test } from '@playwright/test'

test('unverified geology layouts and internal review labels stay off the public Showcase', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One browser verifies the public gallery')
  await page.goto('/docs/latest/showcase/')
  const en = page.locator('.showcase-portal[data-locale="en"]')
  await expect(en).toBeVisible()
  for (const id of ['borehole-log', 'geology-plan', 'geology-section']) {
    await expect(en.locator(`.showcase-card[data-case-id="${id}"]`)).toHaveCount(0)
  }
  await expect(en.locator('.showcase-review')).toHaveCount(0)
  await expect(en).not.toContainText('Technical demo')
  await expect(en).not.toContainText('layout unverified')

  await page.locator('#language').click()
  const zh = page.locator('.showcase-portal[data-locale="zh"]')
  await expect(zh).toBeVisible()
  for (const id of ['borehole-log', 'geology-plan', 'geology-section']) {
    await expect(zh.locator(`.showcase-card[data-case-id="${id}"]`)).toHaveCount(0)
  }
  await expect(zh.locator('.showcase-review')).toHaveCount(0)
  await expect(zh).not.toContainText('技术示意')
  await expect(zh).not.toContainText('版式未验收')

  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready', { timeout: 30_000 })
  for (const id of ['sample-geology-section', 'sample-geology-plan', 'sample-borehole-log']) {
    await expect(page.locator(`#sample-select option[value="${id}"]`)).toHaveCount(1)
  }
})