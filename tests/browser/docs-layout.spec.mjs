import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })

const chromiumOnly = testInfo => test.skip(testInfo.project.name !== 'chromium', 'One Chromium layout run covers the generated documentation shell')

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }))
  expect(widths.body).toBeLessThanOrEqual(widths.viewport)
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
}

test('documentation home follows the model-led product story without embedding the editor in the hero', async ({ page }, testInfo) => {
  chromiumOnly(testInfo)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/docs/latest/')

  await expect(page.locator('.topbar')).toBeVisible()
  await expect(page.locator('.brand')).toContainText('KJDraw')
  await expect(page.locator('#search-button')).toBeHidden()
  await expect(page.locator('#language')).toBeVisible()
  await expect(page.locator('.product-nav a[href$="api/"]')).toBeVisible()
  await expect(page.locator('.top-links a[href*="github.com/KanJieTeam/kjdraw"]')).toBeVisible()
  await expect(page.locator('#sidebar')).toBeHidden()
  await expect(page.locator('.toc')).toBeHidden()
  await expect(page.locator('article.lang-en .home-hero h1')).toContainText('One editable model')
  await expect(page.locator('article.lang-en .home-actions a.primary').first()).toBeVisible()
  await expect(page.locator('article.lang-en .home-visual img')).toBeVisible()
  await expect(page.locator('article.lang-en .home-live-frame iframe')).toHaveCount(0)
  await expect(page.locator('article.lang-en .home-value-strip > span')).toHaveCount(3)
  await expect(page.locator('article.lang-en .home-path-list a')).toHaveCount(3)
  await expect(page.locator('article.lang-en .home-example-grid a')).toHaveCount(3)
  await expect(page.locator('article.lang-en .home-developer .home-code')).toBeVisible()
  await expect(page.locator('article.lang-en .home-evidence-grid a')).toHaveCount(3)
  for (const route of ['workbench/', 'api/', 'mcp/']) await expect(page.locator('article.lang-en .home-path-list a[href="./' + route + '"]')).toBeVisible()
  const layout = await page.evaluate(() => {
    const home = document.querySelector('article.lang-en')
    const image = home.querySelector('.home-visual img')
    const order = ['.home-hero', '.home-visual', '.home-value-strip', '.home-paths', '.home-examples', '.home-developer', '.home-evidence', '.home-closing']
      .map(selector => home.querySelector(selector).getBoundingClientRect().top + scrollY)
    return { order, imageLoaded: image.complete && image.naturalWidth > 0, mainWidth: document.querySelector('main').getBoundingClientRect().width, viewport: innerWidth }
  })
  expect(layout.imageLoaded).toBe(true)
  expect(layout.order).toEqual([...layout.order].sort((a, b) => a - b))
  expect(layout.mainWidth / layout.viewport).toBeGreaterThanOrEqual(0.95)

  await page.locator('#language').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('article.lang-zh .home-hero h1')).toContainText('一份可编辑图档')
  await expectNoHorizontalOverflow(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('article.lang-zh .home-visual img')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
test('guide pages retain a readable article column and an independent right-hand table of contents', async ({ page }, testInfo) => {
  chromiumOnly(testInfo)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/docs/latest/concepts/')

  await expect(page.locator('article.lang-en h1')).toBeVisible()
  await expect(page.locator('#docs-version')).toBeVisible()
  const groups = page.locator('#sidebar .nav-group')
  expect(await groups.count()).toBeGreaterThanOrEqual(4)
  for (const group of await groups.all()) {
    await expect(group.locator('h3.lang-en')).not.toHaveText('')
    expect(await group.locator('a').count()).toBeGreaterThan(0)
  }
  const topApi = await page.locator('.product-nav a[href$="api/"]').getAttribute('href')
  const sideApi = await page.locator('#sidebar .api-nav').getAttribute('href')
  expect(new URL(topApi, page.url()).href).toBe(new URL(sideApi, page.url()).href)
  await page.locator('#language').click()
  await expect(page.locator('#docs-version option')).toContainText('当前')
  await page.locator('#language').click()
  await expect(page.locator('.toc')).toBeVisible()
  expect(await page.locator('.toc a').count()).toBeGreaterThanOrEqual(2)

  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector('#sidebar').getBoundingClientRect()
    const content = document.querySelector('main > .content').getBoundingClientRect()
    const article = document.querySelector('article.lang-en').getBoundingClientRect()
    const toc = document.querySelector('.toc').getBoundingClientRect()
    return {
      sidebarRight: sidebar.right,
      contentLeft: content.left,
      contentWidth: content.width,
      articleWidth: article.width,
      tocLeft: toc.left,
      tocWidth: toc.width,
      viewport: window.innerWidth,
    }
  })
  expect(layout.contentLeft).toBeGreaterThanOrEqual(layout.sidebarRight)
  expect(layout.articleWidth).toBeGreaterThanOrEqual(680)
  expect(layout.articleWidth).toBeLessThanOrEqual(900)
  expect(layout.tocLeft).toBeGreaterThan(layout.contentLeft + layout.contentWidth)
  expect(layout.tocWidth).toBeGreaterThanOrEqual(150)
  expect(layout.tocLeft + layout.tocWidth).toBeLessThanOrEqual(layout.viewport)
})

test('Showcase uses the desktop canvas, supports four-column browsing and preserves real grid/list behavior', async ({ page }, testInfo) => {
  chromiumOnly(testInfo)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/docs/latest/showcase/')

  const portal = page.locator('.showcase-portal[data-locale="en"]')
  await expect(portal).toBeVisible()
  await expect(portal.locator('.showcase-query')).toBeVisible()
  await expect(portal.locator('.showcase-tag-filter')).toBeVisible()
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(16)

  const desktop = await page.evaluate(() => {
    const rail = document.querySelector('.showcase-portal:not([hidden]) .showcase-categories').getBoundingClientRect()
    const content = document.querySelector('main > .content').getBoundingClientRect()
    const grid = document.querySelector('.showcase-portal:not([hidden]) .showcase-grid')
    return {
      contentWidth: content.width,
      availableWidth: window.innerWidth - rail.right,
      columns: getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
    }
  })
  expect(desktop.contentWidth / desktop.availableWidth).toBeGreaterThanOrEqual(0.8)
  expect(desktop.columns).toBe(4)

  await portal.locator('.showcase-query').fill('bearing holes')
  await expect(portal.locator('.showcase-card:visible')).toHaveCount(1)
  await portal.locator('.showcase-query').fill('')

  await portal.locator('[data-view="list"]').click()
  await expect(portal.locator('.showcase-grid')).toHaveClass(/list/)
  const listColumns = await portal.locator('.showcase-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length)
  expect(listColumns).toBe(1)
  const firstCard = portal.locator('.showcase-card:visible').first()
  const listGeometry = await firstCard.evaluate(element => {
    const card = element.getBoundingClientRect()
    const thumb = element.querySelector('.showcase-thumb').getBoundingClientRect()
    return { cardWidth: card.width, cardHeight: card.height, thumbWidth: thumb.width, thumbHeight: thumb.height }
  })
  expect(listGeometry.cardWidth).toBeGreaterThan(listGeometry.cardHeight)
  expect(listGeometry.thumbWidth).toBeGreaterThan(listGeometry.thumbHeight)
})

test('mobile docs navigation opens accessibly and Showcase collapses to one usable column without overflow', async ({ page }, testInfo) => {
  chromiumOnly(testInfo)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/latest/concepts/')

  await expect(page.locator('#menu-button')).toBeVisible()
  await expect(page.locator('#search-button')).toBeVisible()
  await expect(page.locator('#language')).toBeVisible()
  await expect(page.locator('#sidebar')).not.toHaveClass(/open/)
  await page.locator('#menu-button').click()
  await expect(page.locator('#sidebar')).toHaveClass(/open/)
  await expect(page.locator('#docs-version')).toBeVisible()
  await expect(page.locator('#sidebar .api-nav')).toBeVisible()
  await page.keyboard.press('Escape')
  await expectNoHorizontalOverflow(page)

  await page.goto('/docs/latest/showcase/')
  const portal = page.locator('.showcase-portal[data-locale="en"]')
  await expect(portal).toBeVisible()
  const mobile = await portal.evaluate(element => {
    const grid = element.querySelector('.showcase-grid')
    const toolbar = element.querySelector('.showcase-toolbar').getBoundingClientRect()
    const card = element.querySelector('.showcase-card:not([hidden])').getBoundingClientRect()
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      toolbarRight: toolbar.right,
      cardRight: card.right,
      viewport: window.innerWidth,
    }
  })
  expect(mobile.columns).toBe(1)
  expect(mobile.toolbarRight).toBeLessThanOrEqual(mobile.viewport)
  expect(mobile.cardRight).toBeLessThanOrEqual(mobile.viewport)
  await expectNoHorizontalOverflow(page)
})
