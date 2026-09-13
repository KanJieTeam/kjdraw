import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 } })

test('playground constructs a tangent circle from a selected line and circle', async ({ page }) => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'playground-ttr-mixed', units: 'millimeter' })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-50,0,0], end: [50,0,0] } }, { document: drawing })
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0,15,0], radius: 5 } }, { document: drawing })
  const data = await sdk.writeDocument(drawing, { format: 'KJD' })
  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'ttr-mixed.kjd', mimeType: 'application/json', buffer: Buffer.from(data) })
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await page.evaluate(async () => {
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js'), original = KJCanvasRenderer.prototype.screenToWorld
    KJCanvasRenderer.prototype.screenToWorld = function (point) { window.ttrRenderer = this; return original.call(this, point) }
  })
  const canvas = page.locator('#canvas'), box = await canvas.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const points = await page.evaluate(() => {
    const renderer = window.ttrRenderer, rect = document.querySelector('#canvas').getBoundingClientRect()
    Object.assign(renderer.camera, { centerX: 0, centerY: 10, scale: 10 }); renderer.render()
    const convert = world => { const screen = renderer.worldToScreen(world); return { x: rect.left + screen[0], y: rect.top + screen[1] } }
    return { line: convert([-20,0]), circle: convert([5,15]), solution: convert([0,5]) }
  })
  await page.mouse.click(points.line.x, points.line.y)
  await page.keyboard.down('Shift'); await page.mouse.click(points.circle.x, points.circle.y); await page.keyboard.up('Shift')
  await expect(page.locator('#selection-count')).toContainText('2')
  await page.locator('#drawing-tool').selectOption('circle')
  await page.locator('#circle-mode').selectOption('tangent-tangent-radius')
  await page.locator('#circle-radius').fill('5'); await page.locator('#circle-radius').press('Enter')
  await page.mouse.click(points.solution.x, points.solution.y)
  await expect(page.locator('#entity-count')).toHaveText('3 entities')
  await expect.poll(() => page.evaluate(() => window.ttrRenderer.document.listEntities({ type: 'CIRCLE' }).some(entity => entity.payload.center[0] === 0 && entity.payload.center[1] === 5 && entity.payload.radius === 5))).toBe(true)
})
