import { expect, test } from '@playwright/test'

async function screenPoint(page, world) {
  return page.evaluate(world => {
    const workbench = window.splineRelationSnap.workbench
    const canvas = workbench.root.querySelector('[data-canvas]'), rect = canvas.getBoundingClientRect(), screen = workbench.renderer.worldToScreen(world)
    return { x: rect.left + screen[0], y: rect.top + screen[1] }
  }, world)
}

test('Workbench pointer drawing consumes exact tangent and perpendicular points on a locked rational SPLINE', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'spline-relation-host'; host.style.cssText = 'width:1000px;height:700px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'spline-relation-pointer', units: 'millimeter' })
    const locked = await sdk.executeCommand('LAYERNEW', { name: 'Locked rational reference', locked: true }, { document: drawing })
    await drawing.transact('Native rational reference', tx => tx.createEntity('SPLINE', {
      degree: 2, controlPoints: [[10, 0, 0], [10, 10, 0], [0, 10, 0]],
      weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1], layerId: locked.id,
    }, { id: 'native-rational-spline' }))
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['perpendicular', 'tangent', 'nearest'], radius: 14 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 10, centerY: 5, scale: 10 }); workbench.renderer.render()
    window.splineRelationSnap = { workbench, drawing }
  })

  const reference = [20, 0], tangent = [5, 5 * Math.sqrt(3)], referenceScreen = await screenPoint(page, reference), tangentScreen = await screenPoint(page, tangent)
  await page.locator('#spline-relation-host [data-tool="line"]').click()
  await page.mouse.click(referenceScreen.x, referenceScreen.y)
  await page.mouse.move(tangentScreen.x + 1, tangentScreen.y - 1)
  const marker = page.locator('#spline-relation-host [data-snap]')
  await expect(marker).toHaveAttribute('data-mode', 'tangent'); await expect(marker).toHaveAttribute('aria-label', 'Tangent')
  await page.mouse.click(tangentScreen.x + 1, tangentScreen.y - 1)
  let line = await page.evaluate(() => window.splineRelationSnap.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(line.start).toEqual([...reference, 0]); expect(line.end[0]).toBeCloseTo(tangent[0], 8); expect(line.end[1]).toBeCloseTo(tangent[1], 8)

  await page.evaluate(() => window.splineRelationSnap.workbench.setLocale('zh-CN'))
  const foot = [10, 0], localizedReference = await screenPoint(page, reference), footScreen = await screenPoint(page, foot)
  await page.locator('#spline-relation-host [data-tool="line"]').click(); await page.mouse.click(localizedReference.x, localizedReference.y)
  await page.mouse.move(footScreen.x + 1, footScreen.y)
  await expect(marker).toHaveAttribute('data-mode', 'perpendicular'); await expect(marker).toHaveAttribute('aria-label', '垂足')
  await page.mouse.click(footScreen.x + 1, footScreen.y)
  line = await page.evaluate(() => window.splineRelationSnap.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(line.start).toEqual([...reference, 0]); expect(line.end).toEqual([...foot, 0])
  const weights = await page.evaluate(() => window.splineRelationSnap.drawing.getObject('native-rational-spline').payload.weights)
  expect(weights).toEqual([1, Math.SQRT1_2, 1])
})
