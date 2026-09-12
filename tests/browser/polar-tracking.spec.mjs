import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

async function workbenchPoint(page, world) {
  return page.evaluate(world => {
    const { workbench } = window.polarWorkbench, canvas = workbench.root.querySelector('[data-canvas]')
    const rect = canvas.getBoundingClientRect(), screen = workbench.renderer.worldToScreen(world)
    return { x: rect.left + screen[0], y: rect.top + screen[1] }
  }, world)
}

test('workbench Polar tracks pointer input while exact snaps and typed coordinates stay exact', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const host = document.createElement('div'); host.id = 'polar-host'; host.style.cssText = 'width:1000px;height:700px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'polar-workbench', units: 'millimeter' })
    await sdk.executeCommand('SNAPSETTINGS', { modes: [], radius: 12 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 0, centerY: 0, scale: 2 }); workbench.renderer.render()
    window.polarWorkbench = { sdk, workbench, drawing }
  })

  const polar = page.locator('#polar-host [data-action="polar"]'), ortho = page.locator('#polar-host [data-action="ortho"]')
  await expect(polar).toHaveAttribute('aria-pressed', 'false')
  await polar.click(); await expect(polar).toHaveAttribute('aria-pressed', 'true'); await expect(polar).toHaveAttribute('data-angle', '45')
  await expect(polar).toHaveAttribute('aria-label', /Polar tracking on.*45°.*F10/)

  await page.locator('#polar-host [data-tool="line"]').click()
  let origin = await workbenchPoint(page, [0, 0]), raw = await workbenchPoint(page, [30, 20])
  await page.mouse.click(origin.x, origin.y)
  await expect(page.locator('#polar-host [data-hint]')).toHaveText(/end point/i)
  await expect(polar).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => ({ tool: window.polarWorkbench.workbench.tool, lines: window.polarWorkbench.drawing.listEntities({ type: 'LINE' }).length }))).toEqual({ tool: 'line', lines: 0 })
  await page.mouse.click(raw.x, raw.y)
  await expect.poll(() => page.evaluate(() => window.polarWorkbench.drawing.listEntities({ type: 'LINE' }).length)).toBe(1)
  let payload = await page.evaluate(() => window.polarWorkbench.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(payload.start).toEqual([0, 0, 0]); expect(payload.end[0]).toBeCloseTo(25, 9); expect(payload.end[1]).toBeCloseTo(25, 9)

  await page.evaluate(async () => {
    const { sdk, drawing } = window.polarWorkbench
    await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [30, 20, 0] } }, { document: drawing })
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['node'], radius: 12 }, { document: drawing })
  })
  await page.locator('#polar-host [data-tool="line"]').click(); origin = await workbenchPoint(page, [0, 0]); raw = await workbenchPoint(page, [30, 20]); await page.mouse.click(origin.x, origin.y); await page.mouse.click(raw.x, raw.y)
  await expect.poll(() => page.evaluate(() => window.polarWorkbench.drawing.listEntities({ type: 'LINE' }).length)).toBe(2)
  payload = await page.evaluate(() => window.polarWorkbench.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(payload.end).toEqual([30, 20, 0])

  await page.locator('#polar-host [data-tool="line"]').click(); const typedBase = await workbenchPoint(page, [0, -20]); await page.mouse.click(typedBase.x, typedBase.y)
  await page.locator('#polar-host [data-command]').fill('@30,20'); await page.locator('#polar-host [data-action="run-command"]').click()
  await expect.poll(() => page.evaluate(() => window.polarWorkbench.drawing.listEntities({ type: 'LINE' }).length)).toBe(3)
  payload = await page.evaluate(() => window.polarWorkbench.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(payload.end).toEqual([30, 0, 0])

  await page.locator('#polar-host [data-tool="line"]').click(); origin = await workbenchPoint(page, [0, 0]); await page.mouse.click(origin.x, origin.y); await page.keyboard.press('Escape')
  await expect(polar).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#polar-host [data-canvas]').focus(); await page.keyboard.press('F10'); await expect(polar).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('F10'); await expect(polar).toHaveAttribute('aria-pressed', 'true')
  await ortho.click(); await expect(ortho).toHaveAttribute('aria-pressed', 'true'); await expect(polar).toHaveAttribute('aria-pressed', 'false')
  await page.locator('#polar-host [data-action="undo"]').click()
  await expect(ortho).toHaveAttribute('aria-pressed', 'false'); await expect(polar).toHaveAttribute('aria-pressed', 'true')
})

test('playground restores Polar from KJD and applies it through the real pointer workflow', async ({ page }) => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'playground-polar', units: 'millimeter' })
  await sdk.executeCommand('POLAR', { enabled: true, angleIncrement: 45 }, { document: drawing })
  const data = await sdk.writeDocument(drawing, { format: 'KJD' })
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'playground-polar.kjd', mimeType: 'application/json', buffer: Buffer.from(data) })
  await expect(page.locator('#polar')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#polar')).toHaveAttribute('data-angle', '45')
  await page.locator('#snap').click()
  await page.evaluate(async () => {
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js'), original = KJCanvasRenderer.prototype.screenToWorld
    KJCanvasRenderer.prototype.screenToWorld = function (point) { window.polarRenderer = this; return original.call(this, point) }
  })
  const box = await page.locator('#canvas').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const points = await page.evaluate(() => {
    const rect = document.querySelector('#canvas').getBoundingClientRect(), renderer = window.polarRenderer
    Object.assign(renderer.camera, { centerX: 0, centerY: 0, scale: 2 }); renderer.render()
    const convert = point => { const screen = renderer.worldToScreen(point); return { x: rect.left + screen[0], y: rect.top + screen[1] } }
    return { origin: convert([0, 0]), raw: convert([30, 20]), typedBase: convert([0, -20]) }
  })
  await page.locator('.ribbon-group [data-tool="line"]').click(); await page.mouse.click(points.origin.x, points.origin.y); await page.mouse.click(points.raw.x, points.raw.y)
  await expect.poll(() => page.evaluate(() => window.polarRenderer.document.listEntities({ type: 'LINE' }).length)).toBe(1)
  let payload = await page.evaluate(() => window.polarRenderer.document.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(payload.end[0]).toBeCloseTo(25, 9); expect(payload.end[1]).toBeCloseTo(25, 9)

  await page.locator('.ribbon-group [data-tool="line"]').click(); await page.mouse.click(points.typedBase.x, points.typedBase.y)
  await page.locator('#command-input').fill('@30,20'); await page.locator('#run-command').click()
  await expect.poll(() => page.evaluate(() => window.polarRenderer.document.listEntities({ type: 'LINE' }).length)).toBe(2)
  payload = await page.evaluate(() => window.polarRenderer.document.listEntities({ type: 'LINE' }).map(entity => entity.payload).find(value => value.start[0] === 0 && value.start[1] === -20))
  expect(payload).toBeTruthy()
  expect(payload.end).toEqual([30, 0, 0])

  await page.locator('.ribbon-group [data-tool="line"]').click(); await page.mouse.click(points.origin.x, points.origin.y)
  await page.keyboard.press('Escape'); await page.locator('#canvas').focus(); await page.keyboard.press('F10'); await expect(page.locator('#polar')).toHaveAttribute('aria-pressed', 'false')
})
