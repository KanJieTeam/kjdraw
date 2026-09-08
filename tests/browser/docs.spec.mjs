import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })

test('Editor API switches languages, searches the complete reference and preserves old deep links', async ({ page }) => {
  await page.goto('/docs/latest/api/')

  await expect(page).toHaveTitle('Editor API · KJDraw')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('h1 .lang-en')).toHaveText('KJDraw Editor API')
  await expect(page.locator('#quickstart')).toBeVisible()
  await expect(page.locator('#method-setoptions')).toContainText('setOptions')

  await page.locator('#language').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('h1 .lang-zh')).toHaveText('KJDraw 编辑器 API')
  await expect(page.locator('#quickstart')).toContainText('快速接入')

  await page.locator('#language').click()
  const search = page.locator('#api-search')
  await search.fill('setOptions')
  await expect(page.locator('#api-results a[href="#method-setoptions"]')).toBeVisible()

  await search.fill('KJCanvasRenderer')
  const generatedResult = page.locator('#api-results a[href^="./reference/#"]').first()
  await expect(generatedResult).toBeVisible()
  const generatedHash = await generatedResult.getAttribute('href')
  await generatedResult.click()
  await expect(page).toHaveURL(new RegExp(`/docs/latest/api/reference/#${generatedHash.split('#')[1]}$`))
  await expect(page.locator(':target')).toBeVisible()

  await page.goto('/docs/latest/api/#editor-class-kjdraweditor')
  await expect(page).toHaveURL(/\/docs\/latest\/api\/reference\/#editor-class-kjdraweditor$/)
  await expect(page.locator('#editor-class-kjdraweditor')).toBeVisible()
})

test('390px guides keep search and React-to-Vue navigation inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })

  const expectNoPageOverflow = async () => {
    const dimensions = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }))
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport)
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
  }

  await page.goto('/docs/latest/react/')
  await expect(page.locator('article.lang-en h1')).toHaveText('React integration')
  await expect(page.locator('#en-react-editor-component')).toBeVisible()
  await expectNoPageOverflow()

  await page.locator('#search-button').click()
  await expect(page.locator('#search-dialog')).toBeVisible()
  await page.locator('#search').fill('KJDrawEditor')
  await expect(page.locator('#results a[href*="/api/reference/#editor-class-kjdraweditor"]')).toBeVisible()
  await expectNoPageOverflow()
  await page.keyboard.press('Escape')
  await expect(page.locator('#search-dialog')).toBeHidden()
  await expect(page.locator('#search-button')).toBeFocused()

  await page.locator('#menu-button').click()
  await expect(page.locator('#sidebar')).toHaveClass(/open/)
  const vueLink = page.locator('#sidebar a[href="../vue/"]')
  await expect(vueLink).toBeVisible()
  await vueLink.click()

  await expect(page).toHaveURL(/\/docs\/latest\/vue\/$/)
  await expect(page.locator('article.lang-en h1')).toHaveText('Vue integration')
  await page.locator('#language').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('article.lang-zh h1')).toHaveText('Vue 集成')
  await expect(page.locator('#zh-vue-editor-component')).toBeVisible()
  await expectNoPageOverflow()
})
