import { expect, test } from '@playwright/test'

test('unverified geology layouts are labeled before opening an editable case', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One browser verifies the static public gallery')
  await page.goto('/docs/latest/showcase/')
  const en = page.locator('.showcase-portal[data-locale="en"]')
  await expect(en.locator('[data-case-id="borehole-log"] .showcase-review')).toHaveText('Technical demo · layout unverified')
  await expect(en.locator('[data-case-id="geology-plan"] .showcase-review')).toHaveText('Technical demo · layout unverified')
  await expect(en.locator('[data-case-id="geology-section"] .showcase-review')).toHaveText('Technical demo · layout unverified')
  await expect(en.locator('[data-case-id="mechanical-bracket"] .showcase-review')).toHaveCount(0)

  await page.goto('/docs/latest/showcase/borehole-log/')
  await expect(page.locator('.review-warning b.en')).toContainText('engineering layout not validated')
  await expect(page.locator('.review-warning p.en')).toContainText('not as a production drawing template')
  await page.locator('#language').click()
  await expect(page.locator('.review-warning b.zh')).toContainText('工程版式尚未验收')
  await expect(page.locator('.review-warning p.zh')).toContainText('不应作为工程出图模板')
})
