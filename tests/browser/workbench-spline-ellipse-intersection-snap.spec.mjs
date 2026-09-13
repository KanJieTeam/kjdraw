import { expect, test } from '@playwright/test'

async function screenPoint(page, world) {
  return page.evaluate(world => {
    const workbench = window.splineEllipseIntersection.workbench
    const canvas = workbench.root.querySelector('[data-canvas]'), rect = canvas.getBoundingClientRect()
    const screen = workbench.renderer.worldToScreen(world)
    return { x: rect.left + screen[0], y: rect.top + screen[1] }
  }, world)
}

test('pointer drawing commits the rational SPLINE and elliptical-arc intersection', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'spline-ellipse-host'; host.style.cssText = 'width:1000px;height:700px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'spline-ellipse-pointer', units: 'millimeter' })
    const locked = await sdk.executeCommand('LAYERNEW', { name: 'Locked native references', locked: true }, { document: drawing })
    const angle = Math.PI / 6, cosine = Math.cos(angle), sine = Math.sin(angle), center = [4, -3, 0]
    const transform = ([x, y]) => [center[0] + cosine * x - sine * y, center[1] + sine * x + cosine * y, 0]
    await drawing.transact('Native spline and elliptical arc', tx => {
      tx.createEntity('SPLINE', {
        degree: 2, controlPoints: [[10, 0], [10, 10], [0, 10]].map(transform),
        weights: [1, Math.SQRT1_2, 1], knots: [0, 0, 0, 1, 1, 1], layerId: locked.id,
      }, { id: 'native-rational-spline' })
      tx.createEntity('ELLIPSE', {
        center, majorAxis: [12 * cosine, 12 * sine, 0], ratio: 2 / 3,
        startParameter: 0, endParameter: Math.PI / 2, layerId: locked.id,
      }, { id: 'native-elliptical-arc' })
    })
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['intersection', 'nearest'], radius: 14 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 7, centerY: 5, scale: 20 }); workbench.renderer.render()
    window.splineEllipseIntersection = { workbench, drawing }
  })

  const angle = Math.PI / 6, cosine = Math.cos(angle), sine = Math.sin(angle)
  const local = [90 / Math.sqrt(125), 10 * Math.sqrt(44 / 125)]
  const expected = [4 + cosine * local[0] - sine * local[1], -3 + sine * local[0] + cosine * local[1]]
  const start = [4, 3], startScreen = await screenPoint(page, start), expectedScreen = await screenPoint(page, expected)
  await page.locator('#spline-ellipse-host [data-tool="line"]').click()
  await page.mouse.click(startScreen.x, startScreen.y)
  await page.mouse.move(expectedScreen.x + 2, expectedScreen.y - 1)
  const marker = page.locator('#spline-ellipse-host [data-snap]')
  await expect(marker).toHaveAttribute('data-mode', 'intersection')
  await expect(marker).toHaveAttribute('aria-label', 'Intersection')
  await page.mouse.click(expectedScreen.x + 2, expectedScreen.y - 1)
  await expect.poll(() => page.evaluate(() => window.splineEllipseIntersection.drawing.listEntities({ type: 'LINE' }).length)).toBe(1)
  const result = await page.evaluate(() => ({
    line: window.splineEllipseIntersection.drawing.listEntities({ type: 'LINE' })[0].payload,
    spline: window.splineEllipseIntersection.drawing.getObject('native-rational-spline').payload,
    ellipse: window.splineEllipseIntersection.drawing.getObject('native-elliptical-arc').payload,
  }))
  expect(result.line.start).toEqual([...start, 0])
  expect(result.line.end[0]).toBeCloseTo(expected[0], 7)
  expect(result.line.end[1]).toBeCloseTo(expected[1], 7)
  expect(result.spline.weights).toEqual([1, Math.SQRT1_2, 1])
  expect(result.ellipse.endParameter).toBe(Math.PI / 2)
})
