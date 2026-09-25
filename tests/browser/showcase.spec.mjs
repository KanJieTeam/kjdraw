import { test, expect } from '@playwright/test'

test('Showcase searches, filters and changes view using generated public sample cards', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium journey covers the documentation-only interaction')
  await page.goto('/docs/latest/showcase/')
  const portal = page.locator('.showcase-portal[data-locale="en"]')
  await expect(portal).toBeVisible()
  const manifest = await (await page.request.get('/docs/latest/showcase/catalog.json')).json()
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(manifest.entries.length)
  await expect(portal.locator('.showcase-thumb img')).toHaveCount(manifest.entries.length)
  const previewStyle = await portal.locator('.showcase-thumb').first().evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    filter: getComputedStyle(element.querySelector('img')).filter,
  }))
  expect(previewStyle.background).toBe('rgb(16, 24, 32)')
  expect(previewStyle.filter).toBe('none')
  const cornerPixels = await portal.locator('.showcase-thumb img').evaluateAll(async images => Promise.all(images.map(async image => {
    const preview = new Image()
    preview.src = image.src
    await preview.decode()
    const canvas = document.createElement('canvas')
    canvas.width = preview.naturalWidth
    canvas.height = preview.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(preview, 0, 0)
    return { src: image.currentSrc, pixel: [...context.getImageData(4, 4, 1, 1).data] }
  })))
  for (const { src, pixel } of cornerPixels) {
    expect(pixel[3], src).toBe(255)
    expect(pixel.slice(0, 3).every(channel => channel < 55), src).toBe(true)
  }
  await expect(portal.locator('.showcase-category[data-category="all"] b')).toHaveText(String(manifest.entries.length))
  await expect(portal.locator('.showcase-category[data-category="core-capabilities"] b')).toHaveText('5')

  await portal.locator('.showcase-query').fill('bearing holes')
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(1)
  await expect(portal.locator('.showcase-card:visible')).toHaveAttribute('data-case-id', 'mechanical-bracket')
  await expect(portal.locator('.showcase-card:visible .showcase-actions a.primary')).toHaveAttribute('href', './mechanical-bracket/')
  await expect(portal.locator('.showcase-result-head output b')).toHaveText('1')

  await portal.locator('.showcase-query').fill('')
  await portal.locator('.showcase-category[data-category="civil"]').click()
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(manifest.categories.find(category => category.id === 'civil').count)
  await expect(portal.locator('.showcase-card:visible').first()).toHaveAttribute('data-case-id', 'site-plan')

  await portal.locator('[data-view="list"]').click()
  await expect(portal.locator('.showcase-grid')).toHaveClass(/list/)
  await expect(portal.locator('[data-view="list"]')).toHaveAttribute('aria-pressed', 'true')

  await page.locator('#language').click()
  const zh = page.locator('.showcase-portal[data-locale="zh"]')
  await expect(zh).toBeVisible()
  await zh.locator('.showcase-tag-filter').selectOption('尺寸')
  await expect(zh.locator('.showcase-card:visible')).toHaveCount(manifest.entries.filter(entry => entry.tags.zh.includes('尺寸')).length)
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
  await expect(page.locator('.provenance a')).toHaveAttribute('href', /github.com\/KanJieTeam\/kjdraw\/blob\/main\//)
  await expect(page.locator('.facts span').first()).toBeVisible()
  await expect(page.frameLocator('iframe').locator('.workbench')).toHaveAttribute('data-demo-state', 'ready', { timeout: 30000 })
  await expect(page.locator('#preview-status')).toBeHidden()
  await page.locator('#source-tab').click()
  await expect(page.locator('#source')).toContainText('function buildMechanical(')
  await expect(page.locator('#source')).not.toContainText('function buildSitePlan(')
  await expect(page.locator('.provenance a')).toHaveAttribute('href', /samples\.ts#L\d+-L\d+$/)

  await page.goto('/docs/latest/showcase/editable-entities/')
  await page.locator('#source-tab').click()
  await expect(page.locator('#source')).toContainText('function geometrySpecimen(')
  await expect(page.locator('#source')).not.toContainText('function dimensionsSpecimen(')
  await expect(page.locator('.viewport iframe')).toHaveAttribute('src', '../../../../?sample=specimen-editable-entities&layout=focus')
  await expect(page.frameLocator('iframe').locator('.workbench')).toHaveAttribute('data-demo-state', 'ready', { timeout: 30000 })
  await expect(page.locator('#preview-status')).toBeHidden()
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

test('Showcase detail reports a failed workspace and recovers on retry', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium journey covers the detail loading state')
  let failFirstLoad = true
  await page.route(/\/\?sample=sample-mechanical&layout=focus$/, route => failFirstLoad
    ? route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporarily unavailable' })
    : route.continue())
  await page.goto('/docs/latest/showcase/mechanical-bracket/')
  const status = page.locator('#preview-status')
  await expect(status).toBeVisible()
  await expect(status).toHaveAttribute('data-state', 'error', { timeout: 10000 })
  await expect(status.locator('.preview-failed')).toBeVisible()
  await expect(status.locator('a')).toHaveAttribute('href', '../../../../?sample=sample-mechanical&layout=focus')
  failFirstLoad = false
  await page.locator('#preview-retry').click()
  await expect(page.frameLocator('iframe').locator('.workbench')).toHaveAttribute('data-demo-state', 'ready', { timeout: 30000 })
  await expect(status).toBeHidden()
})
test('390px Showcase keeps category navigation compact and opens a case detail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium journey covers mobile Showcase navigation')
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/docs/latest/showcase/')
  const portal = page.locator('.showcase-portal[data-locale="en"]')
  await expect(portal).toBeVisible()
  const rail = portal.locator('.showcase-categories')
  const firstCard = portal.locator('.showcase-card:visible').first()
  const geometry = await rail.evaluate((element, card) => ({
    direction: getComputedStyle(element).flexDirection,
    height: element.getBoundingClientRect().height,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    firstCardTop: card.getBoundingClientRect().top,
    pageWidth: document.documentElement.scrollWidth,
  }), await firstCard.elementHandle())
  expect(geometry.direction).toBe('row')
  expect(geometry.height).toBeLessThan(80)
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth)
  expect(geometry.firstCardTop).toBeLessThan(600)
  expect(geometry.pageWidth).toBe(390)

  await rail.locator('.showcase-category[data-category="civil"]').click()
  await expect(rail.locator('.showcase-category[data-category="civil"]')).toHaveAttribute('aria-pressed', 'true')
  const manifest = await (await page.request.get('/docs/latest/showcase/catalog.json')).json()
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(manifest.categories.find(category => category.id === 'civil').count)
  await portal.locator('.showcase-card:visible .showcase-actions a.primary').first().click()
  await expect(page).toHaveURL(/\/docs\/latest\/showcase\/site-plan\/$/)
  await expect(page.locator('.viewport iframe')).toBeVisible()
})