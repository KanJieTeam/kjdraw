import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })

async function mountBlankWorkbench(page) {
  await page.goto(process.env.KJDRAW_TEST_BASE_URL ?? '/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const host = document.createElement('div')
    host.id = 'workbench-host'
    host.style.width = '1000px'
    host.style.height = '700px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'),
      import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ documentId: 'ortho-browser', units: 'millimeter' })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing })
    await workbench.ready
    window.__ortho = { sdk, drawing, workbench }
  })
}

async function pointOnCanvas(page, world, action = 'click') {
  const screen = await page.evaluate(value => window.__ortho.workbench.renderer.worldToScreen(value), world)
  const box = await page.locator('#workbench-host [data-canvas]').boundingBox()
  if (!box) throw new Error('CAD canvas is unavailable')
  const location = { x: box.x + screen[0], y: box.y + screen[1] }
  if (action === 'move') await page.mouse.move(location.x, location.y)
  else await page.mouse.click(location.x, location.y)
}

test('workbench Ortho constrains pointer drafting while coordinates, cancellation and undo stay exact', async ({ page }) => {
  await mountBlankWorkbench(page)
  const ortho = page.locator('#workbench-host [data-action="ortho"]')
  await expect(ortho).toHaveAttribute('aria-pressed', 'false')
  await ortho.click()
  await expect(ortho).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => ({
    revision: window.__ortho.drawing.revision,
    mode: window.__ortho.drawing.snapshot().header.systemVariables.ORTHOMODE,
  }))).toEqual({ revision: 1, mode: 1 })

  await page.evaluate(() => window.__ortho.workbench.setTool('line'))
  await pointOnCanvas(page, [0, 0])
  await pointOnCanvas(page, [40, 12], 'move')
  await expect(page.locator('#workbench-host [data-coordinate]')).toHaveText(/Y 0\.000/)
  await pointOnCanvas(page, [40, 12])
  await expect.poll(() => page.evaluate(() => window.__ortho.drawing.listEntities({ type: 'LINE' }).map(entity => ({ start: entity.payload.start, end: entity.payload.end })))).toEqual([
    { start: [0, 0, 0], end: [40, 0, 0] },
  ])

  await page.evaluate(() => window.__ortho.workbench.setTool('line'))
  await pointOnCanvas(page, [0, 20])
  await page.locator('#workbench-host [data-command]').fill('@6,4')
  await page.locator('#workbench-host [data-action="run-command"]').click()
  await expect.poll(() => page.evaluate(() => window.__ortho.drawing.listEntities({ type: 'LINE' }).map(entity => ({ start: entity.payload.start, end: entity.payload.end })))).toEqual([
    { start: [0, 0, 0], end: [40, 0, 0] },
    { start: [0, 20, 0], end: [6, 24, 0] },
  ])

  await page.evaluate(() => window.__ortho.workbench.setTool('line'))
  await pointOnCanvas(page, [0, -20])
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => ({ tool: window.__ortho.workbench.tool, count: window.__ortho.drawing.listEntities().length }))).toEqual({ tool: 'select', count: 2 })

  await page.locator('#workbench-host [data-action="undo"]').click()
  await page.locator('#workbench-host [data-action="undo"]').click()
  await expect.poll(() => page.evaluate(() => ({ count: window.__ortho.drawing.listEntities().length, mode: window.__ortho.drawing.snapshot().header.systemVariables.ORTHOMODE }))).toEqual({ count: 0, mode: 1 })
  await page.locator('#workbench-host [data-action="undo"]').click()
  await expect(ortho).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => page.evaluate(() => Number(window.__ortho.drawing.snapshot().header.systemVariables.ORTHOMODE ?? 0))).toBe(0)
})
