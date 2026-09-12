import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

async function workbenchCommand(page, value) {
  const input = page.locator('#curve-workbench [data-command]')
  await input.fill(value)
  await input.press('Enter')
}

async function workbenchScreen(page, world) {
  return page.evaluate(world => {
    const workbench = window.curveWorkbench.workbench
    const canvas = workbench.root.querySelector('[data-canvas]')
    const rect = canvas.getBoundingClientRect()
    const screen = workbench.renderer.worldToScreen(world)
    return { x: rect.left + screen[0], y: rect.top + screen[1] }
  }, world)
}

async function playgroundCommand(page, value) {
  const input = page.locator('#command-input')
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  await input.fill(value)
  await input.press('Enter')
  await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
}

test('workbench completes ellipse, elliptical arc and spline workflows with preview, retry and persistence', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div')
    host.id = 'curve-workbench'
    host.style.cssText = 'width:1180px;height:760px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }, { KJCanvasRenderer }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'),
      import('/packages/kjdraw-sdk/src/workbench.js'),
      import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
    ])
    const original = KJCanvasRenderer.prototype.drawPreview
    const previews = []
    KJCanvasRenderer.prototype.drawPreview = function (entities, ...args) {
      previews.push(...entities.filter(entity => ['ELLIPSE', 'SPLINE'].includes(entity.type)).map(entity => structuredClone(entity)))
      return original.call(this, entities, ...args)
    }
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ documentId: 'curve-workbench', units: 'millimeter' })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize()
    Object.assign(workbench.renderer.camera, { centerX: 20, centerY: 15, scale: 8 })
    workbench.renderer.render()
    window.curveWorkbench = { sdk, drawing, workbench, previews }
  })

  const root = page.locator('#curve-workbench')
  const hint = root.locator('[data-hint]')
  await root.locator('[data-tool="ellipse"]').click()
  await workbenchCommand(page, '0.125,0.25')
  await workbenchCommand(page, '@10.5,0')
  const undoPoint = root.locator('[data-action="draft-undo"]')
  await expect(undoPoint).toBeVisible()
  await undoPoint.click()
  await expect(hint).toContainText('major-axis endpoint')
  await workbenchCommand(page, '10.625,0.25')
  await workbenchCommand(page, '0.125,4.75')
  await expect.poll(() => page.evaluate(() => window.curveWorkbench.drawing.listEntities().length)).toBe(1)
  const full = await page.evaluate(() => window.curveWorkbench.drawing.listEntities()[0].payload)
  expect(full.center).toEqual([0.125, 0.25, 0])
  expect(full.majorAxis).toEqual([10.5, 0, 0])
  expect(full.ratio).toBeCloseTo(4.5 / 10.5, 12)

  await root.locator('[data-tool="ellipse"]').click()
  await workbenchCommand(page, '30,30')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.curveWorkbench.drawing.listEntities().length)).toBe(1)

  await workbenchCommand(page, 'ELLIPSEARC')
  for (const value of ['20,20', '30,20', '20,25', '30,20']) await workbenchCommand(page, value)
  await workbenchCommand(page, '40,20')
  await expect(root.locator('[data-message]')).toContainText('sweep is degenerate')
  expect(await page.evaluate(() => window.curveWorkbench.drawing.listEntities().length)).toBe(1)
  await workbenchCommand(page, '20,25')
  await expect.poll(() => page.evaluate(() => window.curveWorkbench.drawing.listEntities().length)).toBe(2)

  await workbenchCommand(page, 'SPLINE')
  for (const value of ['0,40', '8,48', '16,34']) await workbenchCommand(page, value)
  await expect(undoPoint).toBeVisible()
  await undoPoint.click()
  await expect(hint).toContainText('control point')
  await workbenchCommand(page, '16,34')
  await workbenchCommand(page, '24,42')
  await expect.poll(() => page.evaluate(() => window.curveWorkbench.previews.some(item => item.type === 'SPLINE'))).toBe(true)
  await undoPoint.click()
  const finishPoint = await workbenchScreen(page, [24, 42])
  const workbenchCanvas = root.locator('[data-canvas]')
  for (let pointerId = 31; pointerId <= 32; pointerId += 1) {
    await workbenchCanvas.dispatchEvent('pointerup', { button: 0, pointerId, clientX: finishPoint.x, clientY: finishPoint.y })
    await page.waitForTimeout(25)
  }
  await workbenchCanvas.dispatchEvent('dblclick', { button: 0, clientX: finishPoint.x, clientY: finishPoint.y })
  await expect.poll(() => page.evaluate(() => window.curveWorkbench.drawing.listEntities().length)).toBe(3)

  await workbenchCommand(page, 'UNDO')
  expect(await page.evaluate(() => window.curveWorkbench.drawing.listEntities().length)).toBe(2)
  await workbenchCommand(page, 'REDO')
  expect(await page.evaluate(() => window.curveWorkbench.drawing.listEntities().length)).toBe(3)
  const restored = await page.evaluate(async () => {
    const { sdk, drawing, workbench } = window.curveWorkbench
    const content = await workbench.save('KJD', { download: false })
    const reopened = await sdk.readDocument(content, { format: 'KJD', documentId: 'curve-workbench-reopened' })
    return reopened.listEntities().map(entity => ({ type: entity.type, payload: entity.payload }))
  })
  expect(restored.map(entity => entity.type).sort()).toEqual(['ELLIPSE', 'ELLIPSE', 'SPLINE'])
  const spline = restored.find(entity => entity.type === 'SPLINE')
  const arc = restored.find(entity => entity.type === 'ELLIPSE' && entity.payload.endParameter - entity.payload.startParameter < Math.PI)
  expect(spline.payload.controlPoints).toHaveLength(4)
  expect(arc.payload.endParameter - arc.payload.startParameter).toBeCloseTo(Math.PI / 2, 10)

  await page.evaluate(() => window.curveWorkbench.workbench.setLocale('zh-CN'))
  await workbenchCommand(page, 'SPLINE')
  await expect(hint).toContainText('下一控制点')
  await page.keyboard.press('Escape')
})

test('playground exposes complete ellipse, elliptical arc and spline controls to pointer and command users', async ({ page }) => {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'playground-curves', units: 'millimeter' })
  const content = await sdk.writeDocument(drawing, { format: 'KJD' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'playground-curves.kjd', mimeType: 'application/json', buffer: Buffer.from(content) })
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  await page.evaluate(async () => {
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const originalScreen = KJCanvasRenderer.prototype.screenToWorld
    const originalPreview = KJCanvasRenderer.prototype.drawPreview
    window.playgroundCurvePreviews = []
    KJCanvasRenderer.prototype.screenToWorld = function (point) {
      window.playgroundCurveRenderer = this
      return originalScreen.call(this, point)
    }
    KJCanvasRenderer.prototype.drawPreview = function (entities, ...args) {
      window.playgroundCurvePreviews.push(...entities.filter(entity => ['ELLIPSE', 'SPLINE'].includes(entity.type)).map(entity => entity.type))
      return originalPreview.call(this, entities, ...args)
    }
  })
  const canvas = page.locator('#canvas')
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const screen = world => page.evaluate(world => {
    const canvas = document.querySelector('#canvas')
    const rect = canvas.getBoundingClientRect()
    const point = window.playgroundCurveRenderer.worldToScreen(world)
    return { x: rect.left + point[0], y: rect.top + point[1] }
  }, world)

  await page.locator('.ribbon-group [data-tool="ellipse"]').click()
  await expect(page.locator('#ellipse-mode')).toBeVisible()
  await page.locator('#ellipse-mode').selectOption('full')
  for (const world of [[0, 0], [12, 0]]) {
    const point = await screen(world)
    await page.mouse.click(point.x, point.y)
  }
  await expect(page.locator('#undo-draft-point')).toBeVisible()
  await page.locator('#undo-draft-point').click()
  await expect(page.locator('#hint')).toContainText('Major-axis endpoint')
  for (const world of [[12, 0], [0, 4]]) {
    const point = await screen(world)
    await page.mouse.move(point.x, point.y)
    await page.mouse.click(point.x, point.y)
  }
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  expect(await page.evaluate(() => window.playgroundCurvePreviews)).toContain('ELLIPSE')
  await page.locator('.ribbon-tabs [data-i18n="draw"]').click()
  await page.locator('#drawing-tool').selectOption('spline')
  for (const world of [[20, 0], [25, 6], [30, -2]]) {
    const point = await screen(world)
    await page.mouse.move(point.x, point.y)
    await page.mouse.click(point.x, point.y)
  }
  const splineEnd = await screen([35, 4])
  await page.mouse.dblclick(splineEnd.x, splineEnd.y)
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  expect(await page.evaluate(() => window.playgroundCurvePreviews)).toContain('SPLINE')

  await playgroundCommand(page, 'ELLIPSEARC')
  await expect(page.locator('#ellipse-mode')).toHaveValue('arc')
  for (const value of ['40.25,10.5', '@10.5,0', '@-10.5,4.25', '@10.5,-4.25', '@-10.5,4.25']) await playgroundCommand(page, value)
  await expect(page.locator('#entity-count')).toHaveText('3 entities')

  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  await page.locator('.ribbon-group [data-tool="ellipse"]:visible').click()
  await playgroundCommand(page, '70,20')
  await page.keyboard.press('Escape')
  await expect(page.locator('#entity-count')).toHaveText('3 entities')
  await page.locator('#undo').click()
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await page.locator('#redo').click()
  await expect(page.locator('#entity-count')).toHaveText('3 entities')

  const pending = page.waitForEvent('download')
  await page.locator('#save').click()
  const bytes = await readFile(await (await pending).path())
  const reopened = await KJProjectSession.open(bytes, { sdk: createKJDrawSDK() })
  const entities = reopened.activeDocument.listEntities()
  reopened.destroy()
  expect(entities.map(entity => entity.type).sort()).toEqual(['ELLIPSE', 'ELLIPSE', 'SPLINE'])
  const spline = entities.find(entity => entity.type === 'SPLINE')
  const ellipses = entities.filter(entity => entity.type === 'ELLIPSE')
  const fullEllipse = ellipses.find(entity => entity.payload.endParameter - entity.payload.startParameter > Math.PI)
  const arc = ellipses.find(entity => entity.payload.endParameter - entity.payload.startParameter < Math.PI)
  expect(fullEllipse.payload.ratio).toBeCloseTo(1 / 3, 10)
  expect(spline.payload.controlPoints).toHaveLength(4)
  expect(arc.payload.center).toEqual([40.25, 10.5, 0])
  expect(arc.payload.endParameter - arc.payload.startParameter).toBeCloseTo(Math.PI / 2, 10)

  await page.locator('#language').click()
  await playgroundCommand(page, 'ELLIPSEARC')
  for (const value of ['0,0', '10,0', '0,5']) await playgroundCommand(page, value)
  await expect(page.locator('#hint')).toContainText('椭圆弧起点方向')
  await page.keyboard.press('Escape')
})
