import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

async function runWorkbenchInput(page, value) {
  const input = page.locator('#draft-input-host [data-command]')
  await input.fill(value); await page.locator('#draft-input-host [data-action="run-command"]').click()
}

async function workbenchPoint(page, world) {
  return page.evaluate(world => {
    const { workbench } = window.draftInputWorkbench, canvas = workbench.root.querySelector('[data-canvas]')
    const rect = canvas.getBoundingClientRect(), screen = workbench.renderer.worldToScreen(world)
    return { x: rect.left + screen[0], y: rect.top + screen[1] }
  }, world)
}

test('workbench resolves direct distance and angle input and keeps every draft boundary retryable', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren(); document.body.style.margin = '0'
    const host = document.createElement('div'); host.id = 'draft-input-host'; host.style.cssText = 'width:1000px;height:700px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'draft-input-workbench', units: 'millimeter' })
    await sdk.executeCommand('SNAPSETTINGS', { modes: [], radius: 12 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 0, centerY: 0, scale: 2 }); workbench.renderer.render()
    window.draftInputWorkbench = { workbench, drawing }
  })

  await page.locator('#draft-input-host [data-tool="line"]').click(); await runWorkbenchInput(page, '0,0')
  const direction = await workbenchPoint(page, [3, 4]); await page.mouse.move(direction.x, direction.y); await runWorkbenchInput(page, '10')
  await expect.poll(() => page.evaluate(() => window.draftInputWorkbench.drawing.listEntities({ type: 'LINE' }).length)).toBe(1)
  let line = await page.evaluate(() => window.draftInputWorkbench.drawing.listEntities({ type: 'LINE' })[0].payload)
  expect(line.start).toEqual([0, 0, 0]); expect(line.end).toEqual([6, 8, 0])

  await runWorkbenchInput(page, '20,0'); const samePoint = await workbenchPoint(page, [20, 0]); await page.mouse.move(samePoint.x, samePoint.y); await runWorkbenchInput(page, '5')
  await expect(page.locator('#draft-input-host [data-command]')).toHaveValue('5')
  await expect(page.locator('#draft-input-host [data-message]')).toContainText('Move the pointer')
  expect(await page.evaluate(() => window.draftInputWorkbench.drawing.listEntities({ type: 'LINE' }).length)).toBe(1)
  await runWorkbenchInput(page, '10<90')
  await expect.poll(() => page.evaluate(() => window.draftInputWorkbench.drawing.listEntities({ type: 'LINE' }).length)).toBe(2)
  line = await page.evaluate(() => window.draftInputWorkbench.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(line.start).toEqual([20, 0, 0]); expect(line.end[0]).toBeCloseTo(20, 9); expect(line.end[1]).toBeCloseTo(10, 9)

  await page.locator('#draft-input-host [data-tool="polyline"]').click()
  await runWorkbenchInput(page, '0,20'); await runWorkbenchInput(page, '10<0')
  const angleDirection = await workbenchPoint(page, [10, 30]); await page.mouse.move(angleDirection.x, angleDirection.y); await runWorkbenchInput(page, '<90')
  await runWorkbenchInput(page, 'U'); await runWorkbenchInput(page, '10<90'); await runWorkbenchInput(page, 'FINISH')
  let polylines = await page.evaluate(() => window.draftInputWorkbench.drawing.listEntities({ type: 'LWPOLYLINE' }).map(entity => entity.payload))
  expect(polylines).toHaveLength(1); expect(polylines[0].closed).toBe(false); expect(polylines[0].vertices.map(vertex => vertex.point)).toEqual([[0,20,0],[10,20,0],[10,30,0]])

  await runWorkbenchInput(page, '0,40'); await runWorkbenchInput(page, '10<0'); await runWorkbenchInput(page, '10<90'); await runWorkbenchInput(page, 'CLOSE')
  polylines = await page.evaluate(() => window.draftInputWorkbench.drawing.listEntities({ type: 'LWPOLYLINE' }).map(entity => entity.payload))
  expect(polylines).toHaveLength(2); expect(polylines[1].closed).toBe(true)
  await runWorkbenchInput(page, '100,100'); await runWorkbenchInput(page, 'CANCEL')
  await expect.poll(() => page.evaluate(() => window.draftInputWorkbench.workbench.tool)).toBe('select')
  expect(await page.evaluate(() => window.draftInputWorkbench.drawing.listEntities().length)).toBe(4)
})

async function runPlaygroundInput(page, value) {
  await page.locator('#command-input').fill(value); await page.locator('#run-command').click()
}

test('playground uses the same direct input and retry/cancel boundaries', async ({ page }) => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'draft-input-playground', units: 'millimeter' })
  const data = await sdk.writeDocument(drawing, { format: 'KJD' })
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'draft-input.kjd', mimeType: 'application/json', buffer: Buffer.from(data) })
  await page.locator('#snap').click()
  await page.evaluate(async () => {
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js'), original = KJCanvasRenderer.prototype.screenToWorld
    KJCanvasRenderer.prototype.screenToWorld = function (point) { window.draftInputRenderer = this; return original.call(this, point) }
  })
  const box = await page.locator('#canvas').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const screen = await page.evaluate(() => {
    const renderer = window.draftInputRenderer, rect = document.querySelector('#canvas').getBoundingClientRect()
    Object.assign(renderer.camera, { centerX: 0, centerY: 0, scale: 2 }); renderer.render()
    const point = renderer.worldToScreen([3, 4]); return { x: rect.left + point[0], y: rect.top + point[1] }
  })
  await page.locator('.ribbon-group [data-tool="line"]').click(); await runPlaygroundInput(page, '0,0'); await page.mouse.move(screen.x, screen.y); await runPlaygroundInput(page, '10')
  await expect.poll(() => page.evaluate(() => window.draftInputRenderer.document.listEntities({ type: 'LINE' }).length)).toBe(1)
  const line = await page.evaluate(() => window.draftInputRenderer.document.listEntities({ type: 'LINE' })[0].payload)
  expect(line.end).toEqual([6, 8, 0])

  await runPlaygroundInput(page, '20,0'); await runPlaygroundInput(page, '5')
  await expect(page.locator('#command-input')).toHaveValue('5')
  await expect(page.locator('#status')).toContainText('Move the pointer')
  await runPlaygroundInput(page, '10<90')
  await expect.poll(() => page.evaluate(() => window.draftInputRenderer.document.listEntities({ type: 'LINE' }).length)).toBe(2)
  await runPlaygroundInput(page, '30,0'); await runPlaygroundInput(page, 'CANCEL')
  await expect(page.locator('#nav-select')).toHaveClass(/active/)
  expect(await page.evaluate(() => window.draftInputRenderer.document.listEntities({ type: 'LINE' }).length)).toBe(2)
})
