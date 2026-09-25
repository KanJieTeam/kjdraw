import { expect, test } from '@playwright/test'

const curatedCases = [
  { id: 'sleeve-bushing', title: 'THROUGH-BORE SLEEVE', sample: 'specimen-sleeve-bushing' },
  { id: 'compact-office-plan', title: 'Compact office floor plan', sample: 'specimen-compact-office-plan' },
  { id: 'drainage-network', title: 'Site drainage network', sample: 'specimen-drainage-network' },
]

test('curated mechanical, architectural and civil cases open editable nonempty drawings', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One Chromium run covers the curated public journey')
  await page.goto('/docs/latest/showcase/')
  const portal = page.locator('.showcase-portal[data-locale="en"]')
  await expect(portal).toBeVisible()

  for (const { id, title, sample } of curatedCases) {
    const card = portal.locator(`.showcase-card[data-case-id="${id}"]`)
    await expect(card).toBeVisible()
    await expect(card.locator('.showcase-thumb img')).toBeVisible()
    await card.locator('.showcase-actions a.primary').click()
    await expect(page).toHaveURL(new RegExp(`/docs/latest/showcase/${id}/$`))
    await expect(page.locator('.viewport iframe')).toHaveAttribute('src', `../../../../?sample=${sample}&layout=focus`)
    await expect(page.locator('.viewport img[src$=".svg"]')).toHaveCount(0)

    const workspace = page.frameLocator('iframe')
    await expect(workspace.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready', { timeout: 30_000 })
    await expect(workspace.locator('#drawing-title')).toHaveText(title)
    await expect(workspace.locator('#sample-select option:checked')).toHaveText(title)
    await expect(workspace.locator('#entity-count')).toHaveText(/^[1-9][\d,]* entities$/)
    await expect(page.locator('#preview-status')).toBeHidden()
    const colors = await workspace.locator('#canvas').evaluate(canvas => {
      const { width, height } = canvas
      const context = canvas.getContext('2d', { willReadFrequently: true })
      const pixels = context.getImageData(0, 0, width, height).data
      const unique = new Set()
      for (let y = 8; y < height; y += 8) for (let x = 8; x < width; x += 8) {
        const i = (y * width + x) * 4
        unique.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
      }
      return unique.size
    })
    expect(colors, `${id} should render geometry rather than an empty canvas`).toBeGreaterThan(2)

    for (const extension of ['kjd', 'dxf']) {
      const path = `/docs/latest/showcase/assets/${id}.${extension}`
      await expect(page.locator(`a[download][href$="${id}.${extension}"]`)).toBeVisible()
      const response = await request.get(path)
      expect(response.status(), `${path} should download`).toBe(200)
      expect((await response.body()).byteLength, `${path} should contain a real drawing`).toBeGreaterThan(500)
    }

    await page.goto('/docs/latest/showcase/')
    await expect(portal).toBeVisible()
  }
})
