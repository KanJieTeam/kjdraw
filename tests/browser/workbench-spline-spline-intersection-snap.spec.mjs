import { expect, test } from '@playwright/test'

async function screenPoint(page, world) {
  return page.evaluate(world => {
    const workbench = window.splineSplineIntersection.workbench
    const canvas = workbench.root.querySelector('[data-canvas]'), rect = canvas.getBoundingClientRect()
    const screen = workbench.renderer.worldToScreen(world)
    return { x: rect.left + screen[0], y: rect.top + screen[1] }
  }, world)
}

test('pointer drawing commits the exact intersection of two native SPLINE references', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'spline-spline-host'; host.style.cssText = 'width:1000px;height:700px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'spline-spline-pointer', units: 'millimeter' })
    const locked = await sdk.executeCommand('LAYERNEW', { name: 'Locked native references', locked: true }, { document: drawing })
    await drawing.transact('Native spline intersection references', tx => {
      tx.createEntity('SPLINE', {
        degree: 2, controlPoints: [[10, 0, 0], [10, 10, 0], [0, 10, 0]],
        weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1], layerId: locked.id,
      }, { id: 'native-rational-spline' })
      tx.createEntity('SPLINE', {
        degree: 1, controlPoints: [[0, 5, 0], [10, 5, 0]], weights: [1, 2], knots: [0, 0, 1, 1], layerId: locked.id,
      }, { id: 'native-crossing-spline' })
    })
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['intersection', 'nearest'], radius: 14 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 5, centerY: 5, scale: 20 }); workbench.renderer.render()
    window.splineSplineIntersection = { workbench, drawing }
  })

  const expected = [5 * Math.sqrt(3), 5], start = [5, 2]
  const startScreen = await screenPoint(page, start), expectedScreen = await screenPoint(page, expected)
  await page.locator('#spline-spline-host [data-tool="line"]').click()
  await page.mouse.click(startScreen.x, startScreen.y)
  await page.mouse.move(expectedScreen.x + 2, expectedScreen.y - 1)
  const marker = page.locator('#spline-spline-host [data-snap]')
  await expect(marker).toHaveAttribute('data-mode', 'intersection')
  await expect(marker).toHaveAttribute('aria-label', 'Intersection')
  await page.mouse.click(expectedScreen.x + 2, expectedScreen.y - 1)
  await expect.poll(() => page.evaluate(() => window.splineSplineIntersection.drawing.listEntities({ type: 'LINE' }).length)).toBe(1)
  const result = await page.evaluate(() => ({
    line: window.splineSplineIntersection.drawing.listEntities({ type: 'LINE' })[0].payload,
    rational: window.splineSplineIntersection.drawing.getObject('native-rational-spline').payload,
    crossing: window.splineSplineIntersection.drawing.getObject('native-crossing-spline').payload,
  }))
  expect(result.line.start).toEqual([...start, 0])
  expect(result.line.end[0]).toBeCloseTo(expected[0], 7)
  expect(result.line.end[1]).toBeCloseTo(expected[1], 7)
  expect(result.rational.weights).toEqual([1, Math.SQRT1_2, 1])
  expect(result.crossing.degree).toBe(1)
})
