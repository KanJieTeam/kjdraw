import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

test.use({ bypassCSP: true, viewport: { width: 1280, height: 900 } })

const fit = [[0,0,2],[10,10,2],[20,-5,2],[30,0,2]]
const rationalControls = [[0,0,3],[8,18,3],[18,-7,3],[30,14,3],[40,0,3]]
const rationalKnots = [0,0,0,0,.5,1,1,1,1]
const rationalWeights = [1,.75,2,1.25,1]

async function workbenchPoint(page, world) {
  return page.evaluate(world => {
    const { workbench } = window.__fitSpline
    const rect = workbench.root.querySelector('[data-canvas]').getBoundingClientRect(), point = workbench.renderer.worldToScreen(world)
    return { x: rect.left + point[0], y: rect.top + point[1] }
  }, world)
}

async function playgroundPoint(page, world) {
  const box = await page.locator('#canvas').boundingBox(), scale = Math.min((box.width - 164) / 50, (box.height - 164) / 40)
  return { x: box.x + box.width / 2 + (world[0] - 15) * scale, y: box.y + box.height / 2 - world[1] * scale }
}

async function drag(page, point, from, to) {
  const a = await point(page, from), b = await point(page, to)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up()
}

async function fixtureBuffer() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'fit-spline-playground', units: 'millimeter' })
  await drawing.transact('fit spline fixture', transaction => {
    const locked = transaction.upsertTableRecord('layers', { name: 'Fit boundary', type: 'LAYER', payload: { locked: true, visible: true } })
    for (const [id, start, end] of [['fit-a', [-10,-20], [40,-20]], ['fit-b', [40,-20], [40,20]], ['fit-c', [40,20], [-10,20]], ['fit-d', [-10,20], [-10,-20]]]) transaction.createEntity('LINE', { start, end, layerId: locked.id }, { id })
    transaction.createEntity('SPLINE', { degree: 3, controlPoints: fit, fitPoints: fit, knots: [0,0,0,0,1,1,1,1] }, { id: 'fit-spline' })
  })
  return Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' }))
}

async function controlFixtureBuffer() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'control-spline-playground', units: 'millimeter' })
  await drawing.transact('control spline fixture', transaction => {
    const locked = transaction.upsertTableRecord('layers', { name: 'Control boundary', type: 'LAYER', payload: { locked: true, visible: true } })
    for (const [id, start, end] of [['control-a', [-10,-20], [40,-20]], ['control-b', [40,-20], [40,20]], ['control-c', [40,20], [-10,20]], ['control-d', [-10,20], [-10,-20]]]) transaction.createEntity('LINE', { start, end, layerId: locked.id }, { id })
    transaction.createEntity('SPLINE', { degree: 3, controlPoints: rationalControls, knots: rationalKnots, weights: rationalWeights, startTangent: [2,1,0], endTangent: [3,-1,0] }, { id: 'control-spline' })
  })
  return Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' }))
}

async function savedPlayground(page) {
  await page.locator('.ribbon-tabs [data-i18n=home]').click()
  const pending = page.waitForEvent('download'); await page.locator('#save').click()
  const data = await readFile(await (await pending).path()), session = await KJProjectSession.open(data, { sdk: createKJDrawSDK() })
  const snapshot = session.activeDocument.snapshot(); session.destroy(); return snapshot
}

function expectPoint(actual, expected, digits = 5) {
  expect(actual).toHaveLength(expected.length)
  for (const [index, value] of expected.entries()) expect(actual[index]).toBeCloseTo(value, digits)
}

test('fit-point spline grips rebuild visible native geometry in Workbench and Playground', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async points => {
    document.body.replaceChildren(); const host = document.createElement('div'); host.style.cssText = 'width:1100px;height:720px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'fit-spline-workbench', units: 'millimeter' })
    const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 3, controlPoints: points, fitPoints: points, knots: [0,0,0,0,1,1,1,1] } }, { document: drawing })
    const beforeControls = spline.payload.controlPoints
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false }); await workbench.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 15, centerY: 5, scale: 8 }); workbench.renderer.render()
    await sdk.executeCommand('SELECT', { id: spline.id }, { document: drawing }); window.__fitSpline = { sdk, drawing, spline, workbench, beforeControls }
  }, fit)
  await expect(page.locator('[data-overlay]')).toHaveAttribute('data-grip-count', '4')
  await drag(page, workbenchPoint, [10,10], [10,15])
  await expect.poll(() => page.evaluate(() => window.__fitSpline.drawing.getObject(window.__fitSpline.spline.id).payload.fitPoints[1])).toEqual([10,15,2])
  expect(await page.evaluate(() => window.__fitSpline.drawing.getObject(window.__fitSpline.spline.id).payload.controlPoints)).not.toEqual(await page.evaluate(() => window.__fitSpline.beforeControls))
  await page.locator('[data-action=undo]').click(); await expect.poll(() => page.evaluate(() => window.__fitSpline.drawing.getObject(window.__fitSpline.spline.id).payload.fitPoints[1])).toEqual([10,10,2])
  await page.locator('[data-action=redo]').click(); await expect.poll(() => page.evaluate(() => window.__fitSpline.drawing.getObject(window.__fitSpline.spline.id).payload.fitPoints[1])).toEqual([10,15,2])

  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'fit-spline.kjd', mimeType: 'application/json', buffer: await fixtureBuffer() }); await expect(page.locator('#entity-count')).toHaveText('5 entities')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  const endpoint = await playgroundPoint(page, [0,0]); await page.mouse.click(endpoint.x, endpoint.y); await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await drag(page, playgroundPoint, [10,10], [10,15]); await expect(page.locator('#status')).toContainText('Grip edit applied')
  let snapshot = await savedPlayground(page); expect(snapshot.objects['fit-spline'].payload.fitPoints[1]).toEqual([10,15,2]); expect(snapshot.objects['fit-spline'].payload.controlPoints).not.toEqual(fit)
  await page.locator('#undo').click(); snapshot = await savedPlayground(page); expect(snapshot.objects['fit-spline'].payload.fitPoints[1]).toEqual([10,10,2])
  await page.locator('#redo').click(); snapshot = await savedPlayground(page); expect(snapshot.objects['fit-spline'].payload.fitPoints[1]).toEqual([10,15,2])
})

test('rational SPLINE control grip previews without mutation and commits in Workbench and Playground', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async ({ controls, knots, weights }) => {
    document.body.replaceChildren(); const host = document.createElement('div'); host.style.cssText = 'width:1100px;height:720px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'control-spline-workbench', units: 'millimeter' })
    const spline = await sdk.executeCommand('CREATE', { type: 'SPLINE', payload: { degree: 3, controlPoints: controls, knots, weights, startTangent: [2,1,0], endTangent: [3,-1,0] } }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en', grid: false, showLayers: false, showInspector: false }); await workbench.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); workbench.renderer.resize(); Object.assign(workbench.renderer.camera, { centerX: 15, centerY: 2, scale: 8 }); workbench.renderer.render()
    await sdk.executeCommand('SELECT', { id: spline.id }, { document: drawing }); window.__controlSpline = { sdk, drawing, spline, workbench, revision: drawing.revision }; window.__fitSpline = window.__controlSpline
  }, { controls: rationalControls, knots: rationalKnots, weights: rationalWeights })
  await expect(page.locator('[data-overlay]')).toHaveAttribute('data-grip-count', '5')
  const from = await workbenchPoint(page, [8,18]), to = await workbenchPoint(page, [11,22])
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 })
  await expect(page.locator('[data-overlay]')).toHaveAttribute('data-grip-count', '5')
  expect(await page.evaluate(() => window.__controlSpline.drawing.revision)).toBe(await page.evaluate(() => window.__controlSpline.revision))
  expect(await page.evaluate(() => window.__controlSpline.drawing.getObject(window.__controlSpline.spline.id).payload.controlPoints[1])).toEqual([8,18,3])
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__controlSpline.drawing.getObject(window.__controlSpline.spline.id).payload.controlPoints[1])).toEqual([11,22,3])
  expect(await page.evaluate(() => {
    const p = window.__controlSpline.drawing.getObject(window.__controlSpline.spline.id).payload
    return { degree: p.degree, knots: p.knots, weights: p.weights, startTangent: p.startTangent, endTangent: p.endTangent }
  })).toEqual({ degree: 3, knots: rationalKnots, weights: rationalWeights, startTangent: [2,1,0], endTangent: [3,-1,0] })
  await page.locator('[data-action=undo]').click(); await expect.poll(() => page.evaluate(() => window.__controlSpline.drawing.getObject(window.__controlSpline.spline.id).payload.controlPoints[1])).toEqual([8,18,3])
  await page.locator('[data-action=redo]').click(); await expect.poll(() => page.evaluate(() => window.__controlSpline.drawing.getObject(window.__controlSpline.spline.id).payload.controlPoints[1])).toEqual([11,22,3])

  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'control-spline.kjd', mimeType: 'application/json', buffer: await controlFixtureBuffer() }); await expect(page.locator('#entity-count')).toHaveText('5 entities')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  const endpoint = await playgroundPoint(page, [0,0]); await page.mouse.click(endpoint.x, endpoint.y); await expect(page.locator('#selection-count')).toHaveText('1 selected')
  await drag(page, playgroundPoint, [8,18], [11,19]); await expect(page.locator('#status')).toContainText('Grip edit applied')
  let snapshot = await savedPlayground(page), payload = snapshot.objects['control-spline'].payload
  expectPoint(payload.controlPoints[1], [11,19,3]); expect(payload.knots).toEqual(rationalKnots); expect(payload.weights).toEqual(rationalWeights); expect(payload.startTangent).toEqual([2,1,0]); expect(payload.endTangent).toEqual([3,-1,0])
  await page.locator('#undo').click(); snapshot = await savedPlayground(page); expect(snapshot.objects['control-spline'].payload.controlPoints[1]).toEqual([8,18,3])
  await page.locator('#redo').click(); snapshot = await savedPlayground(page); expectPoint(snapshot.objects['control-spline'].payload.controlPoints[1], [11,19,3])
})
