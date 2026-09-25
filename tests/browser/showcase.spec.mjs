import { test, expect } from '@playwright/test'

test('Showcase searches, filters and changes view using generated public sample cards', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium journey covers the documentation-only interaction')
  await page.goto('/docs/latest/showcase/')
  const portal = page.locator('.showcase-portal[data-locale="en"]')
  await expect(portal).toBeVisible()
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(15)
  await expect(portal.locator('.showcase-thumb img')).toHaveCount(15)
  await expect(portal.locator('.showcase-category[data-category="all"] b')).toHaveText('15')
  await expect(portal.locator('.showcase-category[data-category="core-capabilities"] b')).toHaveText('4')

  await portal.locator('.showcase-query').fill('bearing holes')
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(1)
  await expect(portal.locator('.showcase-card:visible')).toHaveAttribute('data-case-id', 'mechanical-bracket')
  await expect(portal.locator('.showcase-card:visible .showcase-actions a.primary')).toHaveAttribute('href', './mechanical-bracket/')
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

test('Showcase case detail opens a real editable workspace instead of a raw SVG', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium journey covers the documentation-only interaction')
  await page.goto('/docs/latest/showcase/mechanical-bracket/')
  await expect(page.locator('h1 .en')).toContainText('Bearing bracket')
  await expect(page.locator('.viewport iframe')).toHaveAttribute('src', '../../../../?sample=sample-mechanical&layout=focus')
  await expect(page.locator('a[href$="mechanical-bracket.kjd"]')).toBeVisible()
  await expect(page.locator('a[href$="mechanical-bracket.dxf"]')).toBeVisible()
  await expect(page.locator('img[src$="mechanical-bracket.svg"]')).toHaveCount(0)
  await expect(page.frameLocator('iframe').locator('.workbench')).toHaveAttribute('data-demo-state', 'ready', { timeout: 30000 })
  await page.locator('#source-tab').click()
  await expect(page.locator('#source')).toContainText('createIndustrySamples')

  await page.goto('/docs/latest/showcase/editable-entities/')
  await expect(page.locator('.viewport iframe')).toHaveAttribute('src', '../../../../?sample=specimen-editable-entities&layout=focus')
  await expect(page.frameLocator('iframe').locator('.workbench')).toHaveAttribute('data-demo-state', 'ready', { timeout: 30000 })
  await expect(page.frameLocator('iframe').locator('#layout-select')).toHaveValue('focus')

  await page.goto('/docs/latest/showcase/a4-print-layout/')
  await expect(page.locator('.viewport iframe')).toHaveAttribute('src', '../../../../?sample=specimen-a4-print-layout&layout=focus&space=paper')
  const paper = page.frameLocator('iframe')
  await expect(paper.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready', { timeout: 30000 })
  await expect(paper.locator('#layout-select')).toHaveValue('focus')
  const colorCount = await paper.locator('#canvas').evaluate(canvas => {
    const { width, height } = canvas
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
    const colors = new Set()
    for (let y = 8; y < height; y += 8) for (let x = 8; x < width; x += 8) {
      const offset = (y * width + x) * 4
      colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`)
    }
    return colors.size
  })
  expect(colorCount).toBeGreaterThan(2)
  await expect(paper.locator('.stage-label [data-i18n="modelSpace"]')).toHaveText('PAPER SPACE')
  await paper.locator('#canvas').focus()
  await paper.locator('#canvas').press('ControlOrMeta+a')
  await expect(paper.locator('#selection-count')).toContainText('3 selected')
  const beforeRevision = await paper.locator('#revision').textContent()
  await paper.locator('#command-input').fill('MOVE 1 0')
  await paper.locator('#command-input').press('Enter')
  await expect(paper.locator('#revision')).not.toHaveText(beforeRevision)
  await expect(paper.locator('#status')).toContainText('MOVE committed')
})
