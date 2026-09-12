import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

async function enter(page, selector, value) {
  const input = page.locator(selector)
  await input.fill(value)
  await input.press('Enter')
}

test('workbench exposes precise point and three-mode polygon construction with retry and persistence', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div')
    host.id = 'point-polygon-workbench'
    host.style.cssText = 'width:1180px;height:760px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }, { KJCanvasRenderer }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'), import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
    ])
    const original = KJCanvasRenderer.prototype.drawPreview
    const previews = []
    KJCanvasRenderer.prototype.drawPreview = function (entities, ...args) {
      previews.push(...entities.filter(entity => ['POINT', 'LWPOLYLINE'].includes(entity.type)).map(entity => structuredClone(entity)))
      return original.call(this, entities, ...args)
    }
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ documentId: 'point-polygon-workbench', units: 'inch' })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready
    window.pointPolygonWorkbench = { sdk, drawing, workbench, previews }
  })
  const root = page.locator('#point-polygon-workbench')
  const command = value => enter(page, '#point-polygon-workbench [data-command]', value)

  await root.locator('[data-tool="point"]').click()
  await command('1.125,-2.375')
  await expect.poll(() => page.evaluate(() => window.pointPolygonWorkbench.drawing.listEntities().length)).toBe(1)
  expect(await page.evaluate(() => window.pointPolygonWorkbench.previews.some(entity => entity.type === 'POINT'))).toBe(true)

  await root.locator('[data-action="draft"]').click()
  await root.locator('[data-draft-tool]').selectOption('polygon')
  await root.locator('[data-draft-option="polygonMode"]').selectOption('circumscribed')
  await root.locator('[data-draft-option="sides"]').fill('4')
  await root.locator('[data-action="start-draft"]').click()
  await command('0.25,0.5')
  const undoPoint = root.locator('[data-action="draft-undo"]')
  await expect(undoPoint).toBeVisible()
  await undoPoint.click()
  await expect(root.locator('[data-message]')).toContainText('center')
  await command('0.25,0.5')
  await command('0.25,0.5')
  await expect(root.locator('[data-message]')).toContainText('distinct')
  await command('@2.75<90')

  await command('POLYGON 5 EDGE')
  await command('10.125,0.25')
  await command('@3.25<0')
  await command('POLYGON 6 INSCRIBED')
  await command('20.5,5.25')
  await command('@4.125<30')
  await expect.poll(() => page.evaluate(() => window.pointPolygonWorkbench.drawing.listEntities().length)).toBe(4)
  expect(await page.evaluate(() => window.pointPolygonWorkbench.previews.some(entity => entity.type === 'LWPOLYLINE'))).toBe(true)

  await command('POLYGON 5 TRIANGLE')
  await expect(root.locator('[data-message]')).toContainText('INSCRIBED, CIRCUMSCRIBED, or EDGE')
  await command('POLYGON 5 EDGE')
  await command('30,10')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.pointPolygonWorkbench.drawing.listEntities().length)).toBe(4)

  await command('UNDO')
  expect(await page.evaluate(() => window.pointPolygonWorkbench.drawing.listEntities().length)).toBe(3)
  await command('REDO')
  expect(await page.evaluate(() => window.pointPolygonWorkbench.drawing.listEntities().length)).toBe(4)
  const reopened = await page.evaluate(async () => {
    const { sdk, drawing, workbench } = window.pointPolygonWorkbench
    const kjd = await workbench.save('KJD', { download: false })
    const dxf = await workbench.save('DXF', { download: false })
    const fromKjd = await sdk.readDocument(kjd, { format: 'KJD', documentId: 'point-polygon-kjd' })
    const fromDxf = await sdk.readDocument(dxf, { format: 'DXF', documentId: 'point-polygon-dxf' })
    return {
      units: fromKjd.snapshot().header.units,
      point: fromKjd.listEntities({ type: 'POINT' })[0].payload.position,
      polygons: fromKjd.listEntities({ type: 'LWPOLYLINE' }).map(entity => ({ closed: entity.payload.closed, vertices: entity.payload.vertices.length })),
      dxfTypes: fromDxf.listEntities().map(entity => entity.type).sort(),
    }
  })
  expect(reopened.units).toBe('inch')
  expect(reopened.point).toEqual([1.125, -2.375, 0])
  expect(reopened.polygons.sort((a, b) => a.vertices - b.vertices)).toEqual([{ closed: true, vertices: 4 }, { closed: true, vertices: 5 }, { closed: true, vertices: 6 }])
  expect(reopened.dxfTypes).toEqual(['LWPOLYLINE', 'LWPOLYLINE', 'LWPOLYLINE', 'POINT'])

  await page.evaluate(() => window.pointPolygonWorkbench.workbench.setLocale('zh-CN'))
  await command('POLYGON 4 CIRCUMSCRIBED')
  await command('0,0')
  await expect(root.locator('[data-message]')).toContainText('内切圆上的边中点')
  await page.keyboard.press('Escape')
})

test('playground exposes point and polygon pointer, command, history and persistence workflows', async ({ page }) => {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'point-polygon-playground', units: 'inch' })
  const content = await sdk.writeDocument(drawing, { format: 'KJD' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'point-polygon.kjd', mimeType: 'application/json', buffer: Buffer.from(content) })
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  await page.evaluate(async () => {
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const original = KJCanvasRenderer.prototype.drawPreview
    window.pointPolygonPreviews = []
    KJCanvasRenderer.prototype.drawPreview = function (entities, ...args) {
      window.pointPolygonPreviews.push(...entities.map(entity => entity.type))
      return original.call(this, entities, ...args)
    }
  })
  const canvas = page.locator('#canvas')
  const box = await canvas.boundingBox()
  const command = async value => {
    await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
    await enter(page, '#command-input', value)
    await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  }

  await page.locator('.ribbon-tabs [data-i18n="draw"]').click()
  await page.locator('#drawing-tool').selectOption('point')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(() => page.evaluate(() => window.pointPolygonPreviews.includes('POINT'))).toBe(true)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('#entity-count')).toHaveText('1 entities')

  await page.locator('#drawing-tool').selectOption('polygon')
  await page.locator('#polygon-mode').selectOption('circumscribed')
  await page.locator('#polygon-sides').fill('4')
  await command('0.25,0.5')
  await expect(page.locator('#undo-draft-point')).toBeVisible()
  await page.locator('#undo-draft-point').click()
  await expect(page.locator('#hint')).toContainText('Center')
  await command('0.25,0.5')
  await command('0.25,0.5')
  await expect(page.locator('#hint')).toContainText('distinct')
  await command('@2.75<90')

  await command('POLYGON 5 EDGE')
  await command('10.125,0.25')
  await command('@3.25<0')
  await command('POLYGON 6 INSCRIBED')
  await command('20.5,5.25')
  await command('@4.125<30')
  await expect(page.locator('#entity-count')).toHaveText('4 entities')
  expect(await page.evaluate(() => window.pointPolygonPreviews.includes('LWPOLYLINE'))).toBe(true)

  await command('POLYGON 5 TRIANGLE')
  await expect(page.locator('#hint')).toContainText('INSCRIBED, CIRCUMSCRIBED, or EDGE')
  await command('POLYGON 5 EDGE')
  await command('30,10')
  await page.keyboard.press('Escape')
  await expect(page.locator('#entity-count')).toHaveText('4 entities')

  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  await page.locator('#undo').click()
  await expect(page.locator('#entity-count')).toHaveText('3 entities')
  await page.locator('#redo').click()
  await expect(page.locator('#entity-count')).toHaveText('4 entities')

  const kjpDownload = page.waitForEvent('download')
  await page.locator('#save').click()
  const kjp = await readFile(await (await kjpDownload).path())
  const reopened = await KJProjectSession.open(kjp, { sdk: createKJDrawSDK() })
  const reopenedTypes = reopened.activeDocument.listEntities().map(entity => entity.type).sort()
  const reopenedUnits = reopened.activeDocument.snapshot().header.units
  reopened.destroy()
  expect(reopenedUnits).toBe('inch')
  expect(reopenedTypes).toEqual(['LWPOLYLINE', 'LWPOLYLINE', 'LWPOLYLINE', 'POINT'])

  const dxfDownload = page.waitForEvent('download')
  await page.locator('#export').click()
  const dxf = await readFile(await (await dxfDownload).path(), 'utf8')
  const imported = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  expect(imported.listEntities().map(entity => entity.type).sort()).toEqual(reopenedTypes)

  await page.locator('#language').click()
  await command('POLYGON 4 CIRCUMSCRIBED')
  await command('0,0')
  await expect(page.locator('#hint')).toContainText('内切圆上的边中点')
  await page.keyboard.press('Escape')
})
