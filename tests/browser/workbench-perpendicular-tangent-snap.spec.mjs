import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

async function screenPoint(page, owner, world) {
  return page.evaluate(({ owner, world }) => {
    const workbench = window[owner].workbench, canvas = workbench.root.querySelector('[data-canvas]')
    const rect = canvas.getBoundingClientRect(), screen = workbench.renderer.worldToScreen(world)
    return { x: rect.left + screen[0], y: rect.top + screen[1] }
  }, { owner, world })
}

test('workbench pointer drawing commits exact perpendicular and tangent points from locked references', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'relation-snap-host'; host.style.cssText = 'width:1100px;height:720px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'relation-snap-workbench', units: 'millimeter' })
    const locked = await sdk.executeCommand('LAYERNEW', { name: 'Locked references', locked: true }, { document: drawing })
    await drawing.transact('Reference geometry', tx => {
      tx.createEntity('LINE', { start: [-20, 0, 0], end: [20, 0, 0], layerId: locked.id }, { id: 'reference-line' })
      tx.createEntity('CIRCLE', { center: [30, 0, 0], radius: 10, layerId: locked.id }, { id: 'reference-circle' })
    })
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['perpendicular', 'tangent', 'nearest'], radius: 18 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 15, centerY: 10, scale: 4 }); workbench.renderer.render()
    window.relationSnap = { sdk, workbench, drawing }
  })

  const marker = page.locator('#relation-snap-host [data-snap]')
  const base = await screenPoint(page, 'relationSnap', [5, 20]), foot = await screenPoint(page, 'relationSnap', [5, 0])
  await page.locator('#relation-snap-host [data-tool="line"]').click()
  await page.mouse.click(base.x, base.y)
  await page.mouse.move(foot.x + 2, foot.y + 1)
  await expect(marker).toHaveAttribute('data-mode', 'perpendicular')
  await expect(marker).toHaveAttribute('aria-label', 'Perpendicular')
  await page.evaluate(() => window.relationSnap.workbench.setLocale('zh-CN'))
  await expect(marker).toHaveAttribute('aria-label', '垂足')
  await page.mouse.click(foot.x + 2, foot.y + 1)
  const perpendicular = await page.evaluate(() => window.relationSnap.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(perpendicular.start).toEqual([5, 20, 0])
  expect(perpendicular.end).toEqual([5, 0, 0])

  await page.evaluate(() => window.relationSnap.workbench.setLocale('en'))
  const tangentBase = await screenPoint(page, 'relationSnap', [50, 0]), tangentPoint = await screenPoint(page, 'relationSnap', [35, Math.sqrt(75)])
  await page.locator('#relation-snap-host [data-tool="line"]').click()
  await page.mouse.click(tangentBase.x, tangentBase.y)
  await page.mouse.move(tangentPoint.x + 1, tangentPoint.y - 1)
  await expect(marker).toHaveAttribute('data-mode', 'tangent')
  await expect(marker).toHaveAttribute('aria-label', 'Tangent')
  await page.mouse.click(tangentPoint.x + 1, tangentPoint.y - 1)
  const tangent = await page.evaluate(() => window.relationSnap.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(tangent.start).toEqual([50, 0, 0])
  expect(tangent.end[0]).toBeCloseTo(35, 9)
  expect(tangent.end[1]).toBeCloseTo(Math.sqrt(75), 9)
})

test('playground pointer drawing exposes and applies perpendicular snap mode', async ({ page }) => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'playground-perpendicular', units: 'millimeter' })
  const locked = await sdk.executeCommand('LAYERNEW', { name: 'Locked reference' }, { document: drawing })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-20, 0, 0], end: [20, 0, 0], layerId: locked.id } }, { document: drawing })
  await sdk.executeCommand('LAYERUPDATE', { id: locked.id, patch: { locked: true } }, { document: drawing })
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [0, 30, 0] } }, { document: drawing })
  await sdk.executeCommand('SNAPSETTINGS', { modes: ['perpendicular', 'nearest'], radius: 14 }, { document: drawing })
  const data = await sdk.writeDocument(drawing, { format: 'KJD' })
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'playground-perpendicular.kjd', mimeType: 'application/json', buffer: Buffer.from(data) })
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await page.evaluate(async () => {
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const original = KJCanvasRenderer.prototype.screenToWorld
    KJCanvasRenderer.prototype.screenToWorld = function (point) { window.relationSnapRenderer = this; return original.call(this, point) }
  })
  await page.locator('.ribbon-group [data-tool="line"]').click()
  const canvas = page.locator('#canvas'), box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const points = await page.evaluate(() => {
    const rect = document.querySelector('#canvas').getBoundingClientRect(), renderer = window.relationSnapRenderer
    const convert = point => { const screen = renderer.worldToScreen(point); return { x: rect.left + screen[0], y: rect.top + screen[1] } }
    return { base: convert([5, 20]), foot: convert([5, 0]) }
  })
  await page.mouse.click(points.base.x, points.base.y)
  await page.mouse.move(points.foot.x + 2, points.foot.y + 1)
  await expect(page.locator('.workbench')).toHaveAttribute('data-snap-mode', 'perpendicular')
  await page.mouse.click(points.foot.x + 2, points.foot.y + 1)
  await expect(page.locator('#entity-count')).toHaveText('3 entities')
})
