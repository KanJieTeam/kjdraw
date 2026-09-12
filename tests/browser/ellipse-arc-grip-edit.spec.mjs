import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

test.use({ viewport: { width: 1280, height: 900 } })

const target = [10 * Math.SQRT1_2, 5 * Math.SQRT1_2]

async function workbenchPoint(page, world) {
  return page.evaluate(world => {
    const { workbench } = window.__ellipseArc
    const rect = workbench.root.querySelector('[data-canvas]').getBoundingClientRect(), point = workbench.renderer.worldToScreen(world)
    return { x: rect.left + point[0], y: rect.top + point[1] }
  }, world)
}

async function playgroundPoint(page, world) {
  const box = await page.locator('#canvas').boundingBox()
  const scale = Math.min((box.width - 164) / 40, (box.height - 164) / 40)
  return { x: box.x + box.width / 2 + world[0] * scale, y: box.y + box.height / 2 - world[1] * scale }
}

async function drag(page, point, from, to) {
  const a = await point(page, from), b = await point(page, to)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up()
}

async function fixtureBuffer() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'ellipse-arc-playground', units: 'millimeter' })
  await drawing.transact('ellipse arc fixture', transaction => {
    const locked = transaction.upsertTableRecord('layers', { name: 'Fit boundary', type: 'LAYER', payload: { locked: true, visible: true } })
    for (const [id, start, end] of [['fit-a', [-20,-20], [20,-20]], ['fit-b', [20,-20], [20,20]], ['fit-c', [20,20], [-20,20]], ['fit-d', [-20,20], [-20,-20]]]) transaction.createEntity('LINE', { start, end, layerId: locked.id }, { id })
    transaction.createEntity('ELLIPSE', { center: [0,0,3], majorAxis: [10,0,0], ratio: .5, startParameter: 0, endParameter: Math.PI }, { id: 'ellipse' })
  })
  return Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' }))
}

async function savedPlayground(page) {
  await page.locator('.ribbon-tabs [data-i18n=home]').click()
  const pending = page.waitForEvent('download'); await page.locator('#save').click()
  const data = await readFile(await (await pending).path()), session = await KJProjectSession.open(data, { sdk: createKJDrawSDK() })
  const snapshot = session.activeDocument.snapshot(); session.destroy(); return snapshot
}

test('elliptical arc endpoint grips are real pointer edits in Workbench and Playground', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren(); const host = document.createElement('div'); host.style.cssText = 'width:1100px;height:720px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'ellipse-arc-workbench', units: 'millimeter' })
    const ellipse = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: { center: [0,0,3], majorAxis: [10,0,0], ratio: .5, startParameter: 0, endParameter: Math.PI } }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false }); await workbench.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 0, centerY: 0, scale: 10 }); workbench.renderer.render()
    await sdk.executeCommand('SELECT', { id: ellipse.id }, { document: drawing }); window.__ellipseArc = { sdk, drawing, ellipse, workbench }
  })
  await expect(page.locator('[data-overlay]')).toHaveAttribute('data-grip-count', '7')
  await drag(page, workbenchPoint, [10,0], target)
  await expect.poll(() => page.evaluate(() => window.__ellipseArc.drawing.getObject(window.__ellipseArc.ellipse.id).payload.startParameter)).toBeCloseTo(Math.PI / 4, 5)
  await page.locator('[data-action=undo]').click(); await expect.poll(() => page.evaluate(() => window.__ellipseArc.drawing.getObject(window.__ellipseArc.ellipse.id).payload.startParameter)).toBe(0)
  await page.locator('[data-action=redo]').click(); await expect.poll(() => page.evaluate(() => window.__ellipseArc.drawing.getObject(window.__ellipseArc.ellipse.id).payload.startParameter)).toBeCloseTo(Math.PI / 4, 5)

  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'ellipse-arc.kjd', mimeType: 'application/json', buffer: await fixtureBuffer() }); await expect(page.locator('#entity-count')).toHaveText('5 entities')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  const body = await playgroundPoint(page, [0,5]); await page.mouse.click(body.x, body.y); await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await drag(page, playgroundPoint, [10,0], target); await expect(page.locator('#status')).toContainText('Grip edit applied')
  let snapshot = await savedPlayground(page); expect(snapshot.objects.ellipse.payload.startParameter).toBeCloseTo(Math.PI / 4, 5)
  await page.locator('#undo').click(); snapshot = await savedPlayground(page); expect(snapshot.objects.ellipse.payload.startParameter).toBe(0)
  await page.locator('#redo').click(); snapshot = await savedPlayground(page); expect(snapshot.objects.ellipse.payload.startParameter).toBeCloseTo(Math.PI / 4, 5)
})
