import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

async function workbenchPoint(page, world) {
  return page.evaluate(world => {
    const { workbench } = window.snapWorkbench, canvas = workbench.root.querySelector('[data-canvas]')
    const rect = canvas.getBoundingClientRect(), screen = workbench.renderer.worldToScreen(world)
    return { x: rect.left + screen[0], y: rect.top + screen[1] }
  }, world)
}

test('workbench uses document snap settings for quadrant and intersection without crossing space or layer boundaries', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'snap-host'; host.style.cssText = 'width:1100px;height:720px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'snap-workbench', units: 'millimeter' })
    const locked = await sdk.executeCommand('LAYERNEW', { name: 'Locked reference', locked: true }, { document: drawing })
    const hidden = await sdk.executeCommand('LAYERNEW', { name: 'Hidden reference', visible: false }, { document: drawing })
    const frozen = await sdk.executeCommand('LAYERNEW', { name: 'Frozen reference', frozen: true }, { document: drawing })
    await drawing.transact('Snap fixtures', tx => {
      tx.createEntity('CIRCLE', { center: [30, 0, 0], radius: 10, layerId: locked.id })
      tx.createEntity('CIRCLE', { center: [10, 30, 0], radius: 10, layerId: hidden.id })
      tx.createEntity('CIRCLE', { center: [-10, 30, 0], radius: 10, layerId: frozen.id })
      tx.createEntity('LINE', { start: [-12, 0, 0], end: [12, 0, 0] })
      tx.createEntity('LINE', { start: [0, -12, 0], end: [0, 12, 0] })
      tx.createEntity('LINE', { start: [-50, -50, 0], end: [50, 50, 0] })
      tx.createEntity('CIRCLE', { center: [0, -30, 0], radius: 10 }, { ownerId: drawing.snapshot().spaces.paperSpaceIds[0] })
    })
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['quadrant', 'nearest'], radius: 12 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 0, centerY: 0, scale: 2 }); workbench.renderer.render()
    window.snapWorkbench = { sdk, workbench, drawing }
  })
  const marker = page.locator('#snap-host [data-snap]')
  const east = await workbenchPoint(page, [40, 0]), target = await workbenchPoint(page, [45, 18])
  await page.locator('#snap-host [data-tool="line"]').click()
  await page.mouse.move(east.x, east.y)
  await expect(marker).toHaveAttribute('data-mode', 'quadrant')
  await expect(marker).toHaveAttribute('aria-label', 'Quadrant')
  await page.mouse.click(east.x, east.y)
  const revisionBeforeCancel = await page.evaluate(() => window.snapWorkbench.drawing.revision)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.snapWorkbench.drawing.revision)).toBe(revisionBeforeCancel)
  expect(await page.evaluate(() => window.snapWorkbench.drawing.listEntities({ type: 'LINE' }).length)).toBe(3)

  await page.locator('#snap-host [data-tool="line"]').click()
  await page.mouse.click(east.x, east.y); await page.mouse.click(target.x, target.y)
  const quadrantLine = await page.evaluate(() => window.snapWorkbench.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(quadrantLine.start).toEqual([40, 0, 0])
  await page.locator('#snap-host [data-action="undo"]').click()
  await expect.poll(() => page.evaluate(() => window.snapWorkbench.drawing.listEntities({ type: 'LINE' }).length)).toBe(3)

  await page.evaluate(() => window.snapWorkbench.sdk.executeCommand('SNAPSETTINGS', { modes: ['intersection', 'nearest'], radius: 12 }, { document: window.snapWorkbench.drawing }))
  const crossing = await workbenchPoint(page, [0, 0])
  await page.locator('#snap-host [data-tool="line"]').click()
  await page.mouse.move(crossing.x + 4, crossing.y + 3)
  await expect(marker).toHaveAttribute('data-mode', 'intersection')
  await expect(marker).toHaveAttribute('aria-label', 'Intersection')
  await page.mouse.click(crossing.x + 4, crossing.y + 3); await page.mouse.click(target.x, target.y)
  expect(await page.evaluate(() => window.snapWorkbench.drawing.listEntities({ type: 'LINE' }).at(-1).payload.start)).toEqual([0, 0, 0])

  await page.evaluate(() => window.snapWorkbench.sdk.executeCommand('SNAPSETTINGS', { modes: [], radius: 12 }, { document: window.snapWorkbench.drawing }))
  await page.locator('#snap-host [data-tool="line"]').click(); await page.mouse.move(east.x, east.y)
  await expect(marker).toHaveCSS('display', 'none')
  await page.keyboard.press('Escape')

  await page.evaluate(() => window.snapWorkbench.sdk.executeCommand('SNAPSETTINGS', { modes: ['quadrant'], radius: 6 }, { document: window.snapWorkbench.drawing }))
  for (const point of [[20, 30], [0, 30], [10, -30]]) {
    const screen = await workbenchPoint(page, point)
    await page.locator('#snap-host [data-tool="line"]').click(); await page.mouse.move(screen.x, screen.y)
    await expect(marker).toHaveCSS('display', 'none')
    await page.keyboard.press('Escape')
  }
})

test('playground reads persisted OSMODE and APERTURE, exposes the mode, and honors SNAP OFF', async ({ page }) => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'playground-snap', units: 'millimeter' })
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 20 } }, { document: drawing })
  await sdk.executeCommand('SNAPSETTINGS', { modes: ['quadrant'], radius: 12 }, { document: drawing })
  const data = await sdk.writeDocument(drawing, { format: 'KJD' })
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'playground-snap.kjd', mimeType: 'application/json', buffer: Buffer.from(data) })
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  await page.evaluate(async()=>{const {KJCanvasRenderer}=await import('/packages/kjdraw-sdk/src/canvas-renderer.js');const original=KJCanvasRenderer.prototype.screenToWorld;KJCanvasRenderer.prototype.screenToWorld=function(p){window.snapRenderer=this;return original.call(this,p)}})
  await page.locator('.ribbon-group [data-tool="line"]').click()
  const box = await page.locator('#canvas').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const east = await page.evaluate(()=>{const canvas=document.querySelector('#canvas'),rect=canvas.getBoundingClientRect(),point=window.snapRenderer.worldToScreen([20,0]);return{x:rect.left+point[0],y:rect.top+point[1]}})
  await page.mouse.move(east.x + 5, east.y)
  await expect(page.locator('.workbench')).toHaveAttribute('data-snap-mode', 'quadrant')
  await page.mouse.click(east.x + 5, east.y)
  await page.keyboard.press('Escape')
  await expect(page.locator('.workbench')).not.toHaveAttribute('data-snap-mode', /.+/)
  await page.locator('#snap').click()
  await expect(page.locator('#snap')).toHaveAttribute('aria-pressed', 'false')
  await page.locator('.ribbon-group [data-tool="line"]').click(); await page.mouse.move(east.x, east.y)
  await expect(page.locator('.workbench')).not.toHaveAttribute('data-snap-mode', /.+/)
  await page.keyboard.press('Escape')

})
