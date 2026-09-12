import { test, expect } from '@playwright/test'

test.use({ bypassCSP: true })

async function command(page, value) {
  const input = page.locator('#ellipse-workbench [data-command]')
  await input.fill(value); await input.press('Enter'); await expect(input).toHaveValue('')
}

async function mount(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'ellipse-workbench'; host.style.cssText = 'width:1100px;height:760px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }, { KJCanvasRenderer }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'), import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
    ])
    const original = KJCanvasRenderer.prototype.drawPreview, previews = []
    KJCanvasRenderer.prototype.drawPreview = function (entities, ...args) {
      for (const entity of entities) if (entity.type === 'ELLIPSE') previews.push(structuredClone(entity.payload))
      return original.call(this, entities, ...args)
    }
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing }); await workbench.ready
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 0, centerY: 0, scale: 10 }); workbench.renderer.render()
    window.ellipseArc = { workbench, drawing, previews }
  })
}

async function screen(page, point) {
  return page.evaluate(point => {
    const workbench = window.ellipseArc.workbench, bounds = workbench.root.querySelector('[data-canvas]').getBoundingClientRect()
    const local = workbench.renderer.worldToScreen(point)
    return { x: bounds.left + local[0], y: bounds.top + local[1] }
  }, point)
}

test('workbench creates, previews, retries and reopens a native five-point elliptical arc', async ({ page }) => {
  await mount(page)
  const root = page.locator('#ellipse-workbench'), hint = root.locator('[data-hint]')
  await root.locator('[data-action="draft"]').click()
  await root.locator('[data-draft-tool]').selectOption('ellipse')
  await expect(root.locator('[data-draft-option="ellipseMode"] option[value="arc"]')).toHaveText('Elliptical arc (5 points)')
  await root.locator('[data-draft-option="ellipseMode"]').selectOption('arc')
  await root.locator('[data-action="start-draft"]').click()
  await expect(hint).toContainText('Specify the center')
  for (const coordinate of ['0,0', '10,0', '0,5']) await command(page, coordinate)
  await expect(hint).toContainText('elliptical-arc start direction')
  await command(page, '10,0'); await expect(hint).toContainText('counter-clockwise')
  const endpoint = await screen(page, [0, 5]); await page.mouse.move(endpoint.x, endpoint.y)
  await expect.poll(() => page.evaluate(() => window.ellipseArc.previews.some(value => value.endParameter - value.startParameter < Math.PI * 2))).toBe(true)
  expect(await page.evaluate(() => ({ count: window.ellipseArc.drawing.listEntities().length, revision: window.ellipseArc.drawing.revision }))).toEqual({ count: 0, revision: 0 })
  await page.locator('#ellipse-workbench [data-command]').press('Tab'); await page.keyboard.press('Backspace')
  await expect(hint).toContainText('elliptical-arc start direction')
  await command(page, '10,0'); await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.ellipseArc.drawing.listEntities().length)).toBe(0)

  await command(page, 'ELLIPSEARC')
  for (const coordinate of ['0,0', '10,0', '0,5', '10,0']) await command(page, coordinate)
  await command(page, '20,0')
  await expect(root.locator('[data-message]')).toContainText('sweep is degenerate')
  expect(await page.evaluate(() => window.ellipseArc.drawing.listEntities().length)).toBe(0)
  await command(page, '0,5')
  await expect.poll(() => page.evaluate(() => window.ellipseArc.drawing.listEntities().length)).toBe(1)
  const state = await page.evaluate(async () => {
    const { displayedEntityBounds } = await import('/packages/kjdraw-sdk/src/selection-geometry.js')
    const { workbench, drawing } = window.ellipseArc, entity = drawing.listEntities()[0]
    const actual = workbench.renderer.hitTest(workbench.renderer.worldToScreen([Math.SQRT1_2 * 10, Math.SQRT1_2 * 5]), 3)
    const complement = workbench.renderer.hitTest(workbench.renderer.worldToScreen([Math.SQRT1_2 * 10, -Math.SQRT1_2 * 5]), 3)
    return { id: entity.id, payload: entity.payload, bounds: displayedEntityBounds(drawing, entity), actual: actual?.entity.id ?? null, complement: complement?.entity.id ?? null }
  })
  expect(state.payload.startParameter).toBeCloseTo(0, 10); expect(state.payload.endParameter).toBeCloseTo(Math.PI / 2, 10)
  for (const [actual, expected] of state.bounds.map((value, index) => [value, [0, 0, 10, 5][index]])) expect(actual).toBeCloseTo(expected, 10)
  expect(state.actual).toBe(state.id); expect(state.complement).toBeNull()

  await command(page, 'UNDO'); expect(await page.evaluate(() => window.ellipseArc.drawing.listEntities().length)).toBe(0)
  await command(page, 'REDO'); expect((await page.evaluate(() => window.ellipseArc.drawing.listEntities()[0].id))).toBe(state.id)
  const files = await page.evaluate(async () => ({
    kjd: await window.ellipseArc.workbench.save('KJD', { download: false }),
    dxf: await window.ellipseArc.workbench.save('DXF', { download: false }),
  }))
  for (const [format, content] of [['KJD', files.kjd], ['DXF', files.dxf]]) {
    const restored = await page.evaluate(async ({ format, content }) => {
      const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js'), sdk = createKJDrawSDK()
      const drawing = await sdk.readDocument(content, { format, documentId: `ellipse-${format}` })
      return drawing.listEntities({ type: 'ELLIPSE' })[0].payload
    }, { format, content })
    expect(restored.startParameter).toBeCloseTo(0, 10); expect(restored.endParameter).toBeCloseTo(Math.PI / 2, 10)
  }
  await root.locator('[data-action="language"]').click()
  await command(page, 'ELLIPSEARC'); await expect(hint).toContainText('指定中心')
  await command(page, '0,0'); await command(page, '10,0'); await command(page, '0,5')
  await expect(hint).toContainText('指定椭圆弧起点方向')
  await page.keyboard.press('Escape')
})
