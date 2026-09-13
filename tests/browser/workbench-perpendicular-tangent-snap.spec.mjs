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
  const localizedBase = await screenPoint(page, 'relationSnap', [5, 20]), localizedFoot = await screenPoint(page, 'relationSnap', [5, 0])
  await page.locator('#relation-snap-host [data-tool="line"]').click()
  await page.mouse.click(localizedBase.x, localizedBase.y)
  await page.mouse.move(localizedFoot.x + 2, localizedFoot.y + 1)
  await expect(marker).toHaveAttribute('aria-label', '垂足')
  await page.mouse.click(localizedFoot.x + 2, localizedFoot.y + 1)
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

test('workbench pointer drawing commits exact tangent and perpendicular lines to a rotated ellipse', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'ellipse-tangent-host'; host.style.cssText = 'width:1100px;height:720px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'ellipse-tangent-workbench', units: 'millimeter' })
    const locked = await sdk.executeCommand('LAYERNEW', { name: 'Locked references', locked: true }, { document: drawing })
    await drawing.transact('Reference ellipse', tx => tx.createEntity('ELLIPSE', {
      center: [-30, 20, 0], majorAxis: [8, 6, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2, layerId: locked.id,
    }, { id: 'reference-ellipse' }))
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['tangent', 'perpendicular'], radius: 18 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: -20, centerY: 20, scale: 6 }); workbench.renderer.render()
    window.ellipseTangent = { sdk, workbench, drawing }
  })

  const base = [-14, 32], point = [-26 - 3 * Math.sqrt(3) / 2, 23 + 2 * Math.sqrt(3)]
  const baseScreen = await screenPoint(page, 'ellipseTangent', base), pointScreen = await screenPoint(page, 'ellipseTangent', point)
  await page.locator('#ellipse-tangent-host [data-tool="line"]').click()
  await page.mouse.click(baseScreen.x, baseScreen.y)
  await page.mouse.move(pointScreen.x + 1, pointScreen.y - 1)
  const marker = page.locator('#ellipse-tangent-host [data-snap]')
  await expect(marker).toHaveAttribute('data-mode', 'tangent')
  await page.mouse.click(pointScreen.x + 1, pointScreen.y - 1)
  const tangent = await page.evaluate(() => window.ellipseTangent.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(tangent.start).toEqual([...base, 0])
  expect(tangent.end[0]).toBeCloseTo(point[0], 9)
  expect(tangent.end[1]).toBeCloseTo(point[1], 9)

  const foot = [-22, 26], footScreen = await screenPoint(page, 'ellipseTangent', foot)
  await page.locator('#ellipse-tangent-host [data-tool="line"]').click()
  await page.mouse.click(baseScreen.x, baseScreen.y)
  await page.mouse.move(footScreen.x + 1, footScreen.y - 1)
  await expect(marker).toHaveAttribute('data-mode', 'perpendicular')
  await page.mouse.click(footScreen.x + 1, footScreen.y - 1)
  const perpendicular = await page.evaluate(() => window.ellipseTangent.drawing.listEntities({ type: 'LINE' }).at(-1).payload)
  expect(perpendicular.start).toEqual([...base, 0])
  expect(perpendicular.end).toEqual([...foot, 0])
})

test('workbench pointer drawing snaps to an ellipse-circle intersection', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'ellipse-intersection-host'; host.style.cssText = 'width:900px;height:650px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'ellipse-circle-intersection', units: 'millimeter' })
    await drawing.transact('Intersection references', tx => {
      tx.createEntity('ELLIPSE', { center: [0, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2 }, { id: 'intersection-ellipse' })
      tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 8 }, { id: 'intersection-circle' })
    })
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['intersection'], radius: 14 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 0, centerY: 0, scale: 4 }); workbench.renderer.render()
    window.ellipseIntersection = { workbench, drawing }
  })

  const start = [-15, -10], intersection = [Math.sqrt(52), Math.sqrt(12)]
  const startScreen = await screenPoint(page, 'ellipseIntersection', start), intersectionScreen = await screenPoint(page, 'ellipseIntersection', intersection)
  await page.locator('#ellipse-intersection-host [data-tool="line"]').click()
  await page.mouse.click(startScreen.x, startScreen.y)
  await page.mouse.move(intersectionScreen.x + 2, intersectionScreen.y - 1)
  const marker = page.locator('#ellipse-intersection-host [data-snap]')
  await expect(marker).toHaveAttribute('data-mode', 'intersection')
  await page.mouse.click(intersectionScreen.x + 2, intersectionScreen.y - 1)
  const line = await page.evaluate(() => window.ellipseIntersection.drawing.listEntities({ type: 'LINE' })[0].payload)
  expect(line.start).toEqual([...start, 0])
  expect(line.end[0]).toBeCloseTo(intersection[0], 8)
  expect(line.end[1]).toBeCloseTo(intersection[1], 8)
})

test('workbench pointer drawing snaps to an ellipse-ellipse intersection', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'two-ellipse-host'; host.style.cssText = 'width:900px;height:650px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'two-ellipse-intersection', units: 'millimeter' })
    await drawing.transact('Ellipse references', tx => {
      tx.createEntity('ELLIPSE', { center: [0, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2 }, { id: 'ellipse-a' })
      tx.createEntity('ELLIPSE', { center: [6, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2 }, { id: 'ellipse-b' })
    })
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['intersection'], radius: 14 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 0, centerY: 0, scale: 4 }); workbench.renderer.render()
    window.twoEllipseIntersection = { workbench, drawing }
  })

  const start = [-12, 8], intersection = [3, 5 * Math.sqrt(.91)]
  const startScreen = await screenPoint(page, 'twoEllipseIntersection', start), intersectionScreen = await screenPoint(page, 'twoEllipseIntersection', intersection)
  await page.locator('#two-ellipse-host [data-tool="line"]').click()
  await page.mouse.click(startScreen.x, startScreen.y)
  await page.mouse.move(intersectionScreen.x + 2, intersectionScreen.y - 1)
  const marker = page.locator('#two-ellipse-host [data-snap]')
  await expect(marker).toHaveAttribute('data-mode', 'intersection')
  await page.mouse.click(intersectionScreen.x + 2, intersectionScreen.y - 1)
  const line = await page.evaluate(() => window.twoEllipseIntersection.drawing.listEntities({ type: 'LINE' })[0].payload)
  expect(line.start).toEqual([...start, 0])
  expect(line.end[0]).toBeCloseTo(intersection[0], 8)
  expect(line.end[1]).toBeCloseTo(intersection[1], 8)
})

test('workbench pointer drawing snaps to the evaluated spline instead of its control polygon', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'spline-nearest-host'; host.style.cssText = 'width:900px;height:650px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'spline-nearest-workbench', units: 'millimeter' })
    await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: {
      degree: 2, controlPoints: [[0, 0, 0], [5, 10, 0], [10, 0, 0]], knots: [0, 0, 0, 1, 1, 1],
    } }, { document: drawing })
    await sdk.executeCommand('SNAPSETTINGS', { modes: ['nearest'], radius: 14 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 0, centerY: 0, scale: 4 }); workbench.renderer.render()
    window.splineNearest = { workbench, drawing }
  })

  const start = [-10, -10], hover = [5, 6], nearest = [5, 5]
  const startScreen = await screenPoint(page, 'splineNearest', start), hoverScreen = await screenPoint(page, 'splineNearest', hover)
  await page.locator('#spline-nearest-host [data-tool="line"]').click()
  await page.mouse.click(startScreen.x, startScreen.y)
  await page.mouse.move(hoverScreen.x, hoverScreen.y)
  const marker = page.locator('#spline-nearest-host [data-snap]')
  await expect(marker).toHaveAttribute('data-mode', 'nearest')
  await page.mouse.click(hoverScreen.x, hoverScreen.y)
  const line = await page.evaluate(() => window.splineNearest.drawing.listEntities({ type: 'LINE' })[0].payload)
  expect(line.start).toEqual([...start, 0])
  expect(line.end[0]).toBeCloseTo(nearest[0], 7)
  expect(line.end[1]).toBeCloseTo(nearest[1], 7)
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
