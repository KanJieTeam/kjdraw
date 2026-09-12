import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

test.use({ bypassCSP: true, viewport: { width: 1400, height: 920 } })

async function mountWorkbench(page, bulge = false) {
  await page.goto('/')
  await page.evaluate(async bulge => {
    document.body.replaceChildren(); document.body.style.margin = '0'
    const host = document.createElement('div'); host.id = 'polyline-host'; host.style.cssText = 'width:1320px;height:850px'; document.body.append(host)
    const [{ createKJDrawSDK }, { createKJDrawEditor }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/editor.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'polyline-workbench', units: 'millimeter' })
    const vertices = bulge ? [
      { point: [-20, 0, 0], bulge: 0, startWidth: 1, endWidth: 2 }, { point: [0, 0, 0], bulge: 1, startWidth: 2, endWidth: 6 },
      { point: [100, 0, 0], bulge: 0, startWidth: 6, endWidth: 8 }, { point: [120, 0, 0], bulge: 0, startWidth: 8, endWidth: 8 },
    ] : [
      { point: [0, 0, 0], bulge: 0, startWidth: 1, endWidth: 2 }, { point: [10, 0, 0], bulge: 0, startWidth: 2, endWidth: 6 },
      { point: [100, 0, 0], bulge: Math.tan(Math.PI / 8), startWidth: 6, endWidth: 8 }, { point: [110, 10, 0], bulge: 0, startWidth: 8, endWidth: 8 },
    ]
    const target = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices, elevation: 6, color: 2, lineweight: 35 } })
    const boundaries = []
    for (const x of bulge ? [25, 75] : [30, 70]) boundaries.push(await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
      start: [x, bulge ? -60 : -20, 6], end: [x, bulge ? -10 : 30, 6], color: 4,
    } }))
    await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: bulge ? [-40, -70, 6] : [-20, -30, 6] } })
    await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: bulge ? [140, 40, 6] : [130, 40, 6] } })
    const editor = createKJDrawEditor(host, { sdk, document: drawing, grid: false, layers: false, properties: false })
    await editor.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); editor.fit()
    window.__polylineWorkbench = { editor, sdk, target, boundaries }
  }, bulge)
}

async function workbenchPoint(page, world) {
  return page.evaluate(world => {
    const { editor } = window.__polylineWorkbench, rect = editor.element.querySelector('[data-canvas]').getBoundingClientRect()
    const point = editor.workbench.renderer.worldToScreen(world); return { x: rect.left + point[0], y: rect.top + point[1] }
  }, world)
}

async function workbenchClick(page, world) { const point = await workbenchPoint(page, world); await page.mouse.click(point.x, point.y) }

test('Workbench TRIM previews and commits the picked LWPOLYLINE segment through the boundary session', async ({ page }) => {
  await mountWorkbench(page)
  const root = '#polyline-host', input = page.locator(`${root} [data-command]`)
  const before = await page.evaluate(() => ({ revision: window.__polylineWorkbench.editor.document.revision, history: window.__polylineWorkbench.editor.document.history }))
  await input.fill('TRIM'); await input.press('Enter')
  for (const x of [30, 70]) await workbenchClick(page, [x, 20])
  await page.keyboard.press('Enter')
  const hover = await workbenchPoint(page, [50, 0]); await page.mouse.move(hover.x, hover.y)
  await expect(page.locator(`${root} [data-overlay]`)).toHaveAttribute('data-boundary-preview-count', '2')
  expect(await page.evaluate(() => window.__polylineWorkbench.editor.document.revision)).toBe(before.revision)
  await page.mouse.click(hover.x, hover.y)
  await expect.poll(() => page.evaluate(() => window.__polylineWorkbench.editor.document.revision)).toBe(before.revision + 1)
  const paths = await page.evaluate(() => window.__polylineWorkbench.editor.document.listEntities({ type: 'LWPOLYLINE' })
    .map(entity => entity.payload.vertices.map(vertex => vertex.point)).sort((a, b) => a[0][0] - b[0][0]))
  expect(paths).toEqual([[[0, 0, 0], [10, 0, 0], [30, 0, 0]], [[70, 0, 0], [100, 0, 0], [110, 10, 0]]])
  await input.fill('UNDO'); await input.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__polylineWorkbench.editor.document.listEntities({ type: 'LWPOLYLINE' }).length)).toBe(1)
  await input.fill('REDO'); await input.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__polylineWorkbench.editor.document.listEntities({ type: 'LWPOLYLINE' }).length)).toBe(2)
  await page.keyboard.press('Escape')
})

test('Workbench TRIM renders and commits two exact ghost pieces for a picked bulge arc', async ({ page }) => {
  await mountWorkbench(page, true)
  const root = '#polyline-host', input = page.locator(`${root} [data-command]`)
  const revision = await page.evaluate(() => window.__polylineWorkbench.editor.document.revision)
  await input.fill('TRIM'); await input.press('Enter')
  for (const x of [25, 75]) await workbenchClick(page, [x, -20])
  await page.keyboard.press('Enter')
  const hover = await workbenchPoint(page, [50, -50]); await page.mouse.move(hover.x, hover.y)
  await expect(page.locator(`${root} [data-overlay]`)).toHaveAttribute('data-boundary-preview-count', '2')
  expect(await page.evaluate(() => window.__polylineWorkbench.editor.document.revision)).toBe(revision)
  await page.mouse.click(hover.x, hover.y)
  await expect.poll(() => page.evaluate(() => window.__polylineWorkbench.editor.document.revision)).toBe(revision + 1)
  const geometry = await page.evaluate(() => [...window.__polylineWorkbench.editor.document.listEntities({ type: 'LWPOLYLINE' })]
    .sort((a, b) => a.payload.vertices[0].point[0] - b.payload.vertices[0].point[0])
    .map(entity => ({ points: entity.payload.vertices.map(vertex => vertex.point), bulges: entity.payload.vertices.map(vertex => vertex.bulge) })))
  expect(geometry).toHaveLength(2)
  expect(geometry[0].points.at(-1)[0]).toBeCloseTo(25, 8); expect(geometry[0].points.at(-1)[1]).toBeCloseTo(-25 * Math.sqrt(3), 8)
  expect(geometry[1].points[0][0]).toBeCloseTo(75, 8); expect(geometry[1].points[0][1]).toBeCloseTo(-25 * Math.sqrt(3), 8)
  expect(geometry[0].bulges[1]).toBeCloseTo(Math.tan(Math.PI / 12), 10); expect(geometry[1].bulges[0]).toBeCloseTo(Math.tan(Math.PI / 12), 10)
  await page.keyboard.press('Escape')
})

async function playgroundDrawing({ locked = false, bulge = false } = {}) {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: `polyline-playground-${locked}`, units: 'millimeter' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'Profile' })
  const vertices = bulge ? [
    { point: [-20, 0, 0], bulge: 0, startWidth: 1, endWidth: 2 }, { point: [0, 0, 0], bulge: 1, startWidth: 2, endWidth: 6 },
    { point: [100, 0, 0], bulge: 0, startWidth: 6, endWidth: 6 },
  ] : [
    { point: [0, 0, 0], bulge: 0, startWidth: 1, endWidth: 2 }, { point: [20, 0, 0], bulge: 0, startWidth: 2, endWidth: 2 },
    { point: [30, 10, 0], bulge: 0, startWidth: 2, endWidth: 2 },
  ]
  await sdk.executeCommand('CREATE', { type: 'POLYLINE', payload: { vertices, elevation: 6, dxfFlags: 0, layerId: layer.id, color: 2 } }, { document: drawing })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: bulge
    ? { start: [75, 10, 6], end: [75, 60, 6], color: 4 } : { start: [-20, -20, 6], end: [-20, 30, 6], color: 4 } }, { document: drawing })
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: bulge ? [-40, -70, 6] : [-35, -30, 6] } }, { document: drawing })
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: bulge ? [120, 70, 6] : [45, 35, 6] } }, { document: drawing })
  if (locked) await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } }, { document: drawing })
  return Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' }))
}

async function loadPlayground(page, locked = false, bulge = false) {
  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'polyline.kjd', mimeType: 'application/json', buffer: await playgroundDrawing({ locked, bulge }) })
  await expect(page.locator('#entity-count')).toHaveText('4 entities')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
}

async function playgroundPoint(page, x, y) {
  const box = await page.locator('#canvas').boundingBox(), scale = Math.min((box.width - 164) / 80, (box.height - 164) / 65)
  return { x: box.x + box.width / 2 + (x - 5) * scale, y: box.y + box.height / 2 - (y - 2.5) * scale }
}

async function bulgePlaygroundPoint(page, x, y) {
  const box = await page.locator('#canvas').boundingBox(), scale = Math.min((box.width - 164) / 160, (box.height - 164) / 140)
  return { x: box.x + box.width / 2 + (x - 40) * scale, y: box.y + box.height / 2 - y * scale }
}

async function playgroundClick(page, x, y) { const point = await playgroundPoint(page, x, y); await page.mouse.click(point.x, point.y); await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false') }
async function playgroundCommand(page, command) { await page.locator('#command-input').fill(command); await page.locator('#command-input').press('Enter'); await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false') }

test('Playground EXTEND previews a POLYLINE endpoint and protected layers remain unchanged', async ({ page }) => {
  await loadPlayground(page, true)
  const lockedRevision = await page.locator('#revision').textContent()
  await playgroundCommand(page, 'EXTEND'); await playgroundClick(page, -20, 20); await page.keyboard.press('Enter')
  const lockedTarget = await playgroundPoint(page, 0, 0); await page.mouse.move(lockedTarget.x, lockedTarget.y)
  await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-preview-count', '0')
  await page.mouse.click(lockedTarget.x, lockedTarget.y); await expect(page.locator('#revision')).toHaveText(lockedRevision)
  await page.keyboard.press('Escape')

  await loadPlayground(page, false)
  const revision = Number((await page.locator('#revision').textContent()).replace('REV ', ''))
  await playgroundCommand(page, 'EXTEND'); await playgroundClick(page, -20, 20); await page.keyboard.press('Enter')
  const target = await playgroundPoint(page, 0, 0); await page.mouse.move(target.x, target.y)
  await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-preview-count', '1')
  await page.mouse.click(target.x, target.y); await expect(page.locator('#revision')).toHaveText(`REV ${revision + 1}`)
  await playgroundCommand(page, 'UNDO'); await expect(page.locator('#revision')).toHaveText(`REV ${revision + 2}`)
})

test('Playground EXTEND previews and commits a terminal bulge continuation', async ({ page }) => {
  await loadPlayground(page, false, true)
  const revision = Number((await page.locator('#revision').textContent()).replace('REV ', ''))
  await playgroundCommand(page, 'EXTEND')
  const boundary = await bulgePlaygroundPoint(page, 75, 50); await page.mouse.click(boundary.x, boundary.y); await page.keyboard.press('Enter')
  const target = await bulgePlaygroundPoint(page, 100, 0); await page.mouse.move(target.x, target.y)
  await expect(page.locator('.workbench')).toHaveAttribute('data-boundary-preview-count', '1')
  await page.mouse.click(target.x, target.y); await expect(page.locator('#revision')).toHaveText(`REV ${revision + 1}`)
  await page.keyboard.press('Escape')
})

test('Playground PEDIT inserts by segment pick with a non-mutating exact ghost preview', async ({ page }) => {
  await loadPlayground(page)
  await playgroundClick(page, 10, 0); await expect(page.locator('#selection-count')).toHaveText('1 selected')
  const revision = Number((await page.locator('#revision').textContent()).replace('REV ', ''))
  await page.locator('.ribbon-tabs [data-i18n="modify"]').click()
  await page.locator('#modification-tool').selectOption('polyline-insert')
  await expect(page.locator('#app-dialog')).toBeVisible(); await page.locator('#dialog-fields input[name="tolerance"]').fill('0.2'); await page.locator('#dialog-submit').click()
  const target = await playgroundPoint(page, 10, 0); await page.mouse.move(target.x, target.y)
  await expect(page.locator('.workbench')).toHaveAttribute('data-modification-preview-count', '1')
  await expect(page.locator('#revision')).toHaveText(`REV ${revision}`)
  await page.mouse.click(target.x, target.y); await expect(page.locator('#revision')).toHaveText(`REV ${revision + 1}`)
  await page.locator('#undo').click(); await expect(page.locator('#revision')).toHaveText(`REV ${revision + 2}`)
  await page.locator('#redo').click(); await expect(page.locator('#revision')).toHaveText(`REV ${revision + 3}`)
})

test('Playground PEDIT edits one segment taper through the real modification workflow', async ({ page }) => {
  await loadPlayground(page)
  await playgroundClick(page, 10, 0); await expect(page.locator('#selection-count')).toHaveText('1 selected')
  const revision = Number((await page.locator('#revision').textContent()).replace('REV ', ''))
  await page.locator('.ribbon-tabs [data-i18n="modify"]').click()
  await page.locator('#modification-tool').selectOption('polyline-width')
  await expect(page.locator('#app-dialog')).toBeVisible()
  await page.locator('#dialog-fields input[name="startWidth"]').fill('2.5')
  await page.locator('#dialog-fields input[name="endWidth"]').fill('7.5')
  await page.locator('#dialog-fields input[name="tolerance"]').fill('0.2')
  await page.locator('#dialog-submit').click()
  const target = await playgroundPoint(page, 10, 0); await page.mouse.click(target.x, target.y)
  await expect(page.locator('#revision')).toHaveText(`REV ${revision + 1}`)
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save-kjd').click()])
  const { readFile } = await import('node:fs/promises'), path = await download.path()
  const reopened = await createKJDrawSDK().readDocument(await readFile(path, 'utf8'), { format: 'KJD' })
  const widths = reopened.listEntities({ type: 'POLYLINE' })[0].payload.vertices.map(vertex => [vertex.startWidth, vertex.endWidth])
  expect(widths.some(pair => pair[0] === 2.5 && pair[1] === 7.5)).toBe(true)
  await page.locator('#undo').click(); await expect(page.locator('#revision')).toHaveText(`REV ${revision + 2}`)
})
