import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

test.use({ bypassCSP: true, viewport: { width: 1400, height: 920 } })

async function mountWorkbench(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren(); document.body.style.margin = '0'
    const host = document.createElement('div'); host.id = 'break-host'; host.style.cssText = 'width:1320px;height:850px'; document.body.append(host)
    const [{ createKJDrawSDK }, { createKJDrawEditor }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/editor.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'break-workbench', units: 'millimeter' })
    const target = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [
      { point: [0, 0, 0], startWidth: 1, endWidth: 3 }, { point: [10, 0, 0], startWidth: 3, endWidth: 5 }, { point: [20, 10, 0], startWidth: 5, endWidth: 5 },
    ], closed: false, color: 2 } })
    await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [-10, -10, 0] } })
    await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [30, 20, 0] } })
    const editor = createKJDrawEditor(host, { sdk, document: drawing, grid: false, layers: false, properties: false })
    await editor.ready; await sdk.executeCommand('SELECT', { ids: [target.id], operation: 'replace' }, { document: drawing })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); editor.fit()
    window.__breakWorkbench = { editor, sdk, target }
  })
}

async function workbenchPoint(page, world) {
  return page.evaluate(world => {
    const { editor } = window.__breakWorkbench, rect = editor.element.querySelector('[data-canvas]').getBoundingClientRect()
    const point = editor.workbench.renderer.worldToScreen(world); return { x: rect.left + point[0], y: rect.top + point[1] }
  }, world)
}

test('Workbench BREAK command retries an invalid pick and commits an exact non-mutating polyline ghost', async ({ page }) => {
  await mountWorkbench(page)
  const root = '#break-host', input = page.locator(`${root} [data-command]`)
  const revision = await page.evaluate(() => window.__breakWorkbench.editor.document.revision)
  await input.fill('BREAK'); await input.press('Enter')
  await expect(page.locator(`${root} [data-modification-dialog]`)).toBeVisible()
  await expect(page.locator(`${root} [data-modification]`)).toHaveValue('break')
  await page.locator(`${root} [data-modification-field="tolerance"]`).fill('0.2')
  await page.locator(`${root} [data-action="start-modification"]`).click()
  await expect(page.locator(`${root} [data-hint]`)).toContainText('Pick the break point')

  const invalid = await workbenchPoint(page, [5, 3]); await page.mouse.click(invalid.x, invalid.y)
  await expect.poll(() => page.evaluate(() => window.__breakWorkbench.editor.document.revision)).toBe(revision)
  await expect(page.locator(`${root} [data-hint]`)).toContainText('tolerance')

  const exact = await workbenchPoint(page, [5, 0]); await page.mouse.move(exact.x, exact.y)
  await expect(page.locator(`${root} [data-overlay]`)).toHaveAttribute('data-modification-preview-count', '2')
  expect(await page.evaluate(() => window.__breakWorkbench.editor.document.revision)).toBe(revision)
  await page.mouse.click(exact.x, exact.y)
  await expect.poll(() => page.evaluate(() => window.__breakWorkbench.editor.document.revision)).toBe(revision + 1)
  const result = await page.evaluate(() => window.__breakWorkbench.editor.document.listEntities({ type: 'LWPOLYLINE' }).map(entity => ({ id: entity.id, points: entity.payload.vertices.map(vertex => vertex.point) })))
  expect(result).toHaveLength(2); expect(result[0].id).toBe(await page.evaluate(() => window.__breakWorkbench.target.id))
  expect(result.map(piece => piece.points)).toEqual([[[0, 0, 0], [5, 0, 0]], [[5, 0, 0], [10, 0, 0], [20, 10, 0]]])
})

test('Workbench BREAK selects one-point elliptical-arc and two-point full-ellipse flows', async ({ page }) => {
  await mountWorkbench(page)
  await page.evaluate(async () => {
    const { sdk, editor } = window.__breakWorkbench, drawing = editor.document
    const partial = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: { center: [50, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI } })
    const full = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: { center: [80, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2 } })
    await sdk.executeCommand('SELECT', { ids: [partial.id], operation: 'replace' }, { document: drawing })
    editor.fit(); window.__breakWorkbench.ellipses = { partial, full }
  })
  const root = '#break-host', command = page.locator(`${root} [data-command]`)
  await command.fill('BREAK'); await command.press('Enter')
  await expect(page.locator(`${root} [data-modification]`)).toHaveValue('break')
  await page.locator(`${root} [data-modification-dialog]`).press('Escape')
  await page.evaluate(async () => {
    const { sdk, editor, ellipses } = window.__breakWorkbench
    await sdk.executeCommand('SELECT', { ids: [ellipses.full.id], operation: 'replace' }, { document: editor.document })
  })
  await command.fill('BREAK'); await command.press('Enter')
  await expect(page.locator(`${root} [data-modification]`)).toHaveValue('break-two-point')
  await page.locator(`${root} [data-modification-field="tolerance"]`).fill('0.01')
  await page.locator(`${root} [data-action="start-modification"]`).click()
  const right = await workbenchPoint(page, [90, 0]), top = await workbenchPoint(page, [80, 5])
  await page.mouse.click(right.x, right.y); await page.mouse.move(top.x, top.y)
  await expect(page.locator(`${root} [data-overlay]`)).toHaveAttribute('data-modification-preview-count', '2')
  const revision = await page.evaluate(() => window.__breakWorkbench.editor.document.revision)
  await page.mouse.click(top.x, top.y)
  await expect.poll(() => page.evaluate(() => window.__breakWorkbench.editor.document.revision)).toBe(revision + 1)
  const result = await page.evaluate(() => {
    const { editor, ellipses } = window.__breakWorkbench
    return editor.document.listEntities({ type: 'ELLIPSE' }).filter(item => item.id === ellipses.full.id || item.source?.derivedFromId === ellipses.full.id).map(item => ({ id: item.id, start: item.payload.startParameter, end: item.payload.endParameter }))
  })
  expect(result).toHaveLength(2)
  expect(result[0].id).toBe(await page.evaluate(() => window.__breakWorkbench.ellipses.full.id))
  expect(result[0].start).toBe(0); expect(result[0].end).toBeCloseTo(Math.PI / 2, 6)
  expect(result[1].start).toBeCloseTo(Math.PI / 2, 6); expect(result[1].end).toBeCloseTo(Math.PI * 2, 6)
})

test('Workbench JOIN applies two selected elliptical arcs as one native ellipse with history, hit testing and KJD reopen', async ({ page }) => {
  await mountWorkbench(page)
  const source = await page.evaluate(async () => {
    const { sdk, editor } = window.__breakWorkbench, drawing = editor.document
    const first = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: { center: [60, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: 0, endParameter: Math.PI, color: 4 } })
    const second = await sdk.executeCommand('CREATE', { type: 'ELLIPSE', payload: { center: [60, 0, 0], majorAxis: [10, 0, 0], ratio: .5, startParameter: Math.PI, endParameter: Math.PI * 2, color: 4 } })
    await sdk.executeCommand('SELECT', { ids: [first.id, second.id], operation: 'replace' }, { document: drawing })
    editor.fit(); return { firstId: first.id, beforeCount: drawing.listEntities().length, revision: drawing.revision }
  })
  const root = '#break-host', input = page.locator(`${root} [data-command]`)
  await input.fill('JOIN'); await input.press('Enter')
  await expect(page.locator(`${root} [data-modification-dialog]`)).toBeVisible()
  await expect(page.locator(`${root} [data-modification]`)).toHaveValue('join')
  await page.locator(`${root} [data-action="start-modification"]`).click()
  await expect.poll(() => page.evaluate(() => window.__breakWorkbench.editor.document.revision)).toBe(source.revision + 1)
  let joined = await page.evaluate(() => window.__breakWorkbench.editor.document.listEntities({ type: 'ELLIPSE' }).map(entity => ({ id: entity.id, start: entity.payload.startParameter, end: entity.payload.endParameter })))
  expect(joined).toHaveLength(1); expect(joined[0].id).toBe(source.firstId); expect(joined[0].start).toBe(0); expect(joined[0].end).toBeCloseTo(Math.PI * 2, 10)
  expect(await page.evaluate(() => window.__breakWorkbench.editor.document.listEntities().length)).toBe(source.beforeCount - 1)

  await page.evaluate(() => window.__breakWorkbench.sdk.executeCommand('UNDO'))
  await expect.poll(() => page.evaluate(() => window.__breakWorkbench.editor.document.listEntities({ type: 'ELLIPSE' }).length)).toBe(2)
  await page.evaluate(() => window.__breakWorkbench.sdk.executeCommand('REDO'))
  await expect.poll(() => page.evaluate(() => window.__breakWorkbench.editor.document.listEntities({ type: 'ELLIPSE' }).length)).toBe(1)
  const reopen = await page.evaluate(async () => {
    const { sdk, editor } = window.__breakWorkbench
    const bytes = await sdk.writeDocument(editor.document, { format: 'KJD' })
    const reopened = await sdk.readDocument(bytes, { format: 'KJD' }), ellipse = reopened.listEntities({ type: 'ELLIPSE' })[0]
    return { count: reopened.listEntities({ type: 'ELLIPSE' }).length, id: ellipse.id, span: ellipse.payload.endParameter - ellipse.payload.startParameter }
  })
  expect(reopen).toEqual({ count: 1, id: source.firstId, span: Math.PI * 2 })

  await page.evaluate(async () => {
    const { sdk, editor } = window.__breakWorkbench
    await sdk.executeCommand('SELECT', { ids: [], operation: 'replace' }, { document: editor.document }); editor.fit()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const directHit = await page.evaluate(() => {
    const renderer = window.__breakWorkbench.editor.workbench.renderer
    return renderer.hitTest(renderer.worldToScreen([70, 0]), 9)?.entity.id ?? null
  })
  expect(directHit).toBe(source.firstId)
})

async function circleDrawing() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'break-playground', units: 'millimeter' })
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [0, 0, 0], radius: 10, color: 2 } }, { document: drawing })
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [-20, -20, 0] } }, { document: drawing })
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [20, 20, 0] } }, { document: drawing })
  return Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' }))
}

async function playgroundPoint(page, x, y) {
  const box = await page.locator('#canvas').boundingBox(), scale = Math.min((box.width - 164) / 40, (box.height - 164) / 40)
  return { x: box.x + box.width / 2 + x * scale, y: box.y + box.height / 2 - y * scale }
}

test('Playground BREAK command chooses the two-point circle flow, previews two arcs, cancels and then commits', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'break.kjd', mimeType: 'application/json', buffer: await circleDrawing() })
  await expect(page.locator('#entity-count')).toHaveText('3 entities')
  if (await page.locator('#snap').getAttribute('aria-pressed') === 'true') await page.locator('#snap').click()
  const right = await playgroundPoint(page, 10, 0); await page.mouse.click(right.x, right.y); await expect(page.locator('#selection-count')).toHaveText('1 selected')
  const revision = Number((await page.locator('#revision').textContent()).replace('REV ', ''))
  const command = async () => { await page.locator('#command-input').fill('BREAK'); await page.locator('#command-input').press('Enter'); await expect(page.locator('#app-dialog')).toBeVisible() }
  await command(); await expect(page.locator('#modification-tool')).toHaveValue('break-two-point')
  await page.locator('#dialog-fields input[name="tolerance"]').fill('0.2'); await page.locator('#dialog-submit').click()
  const top = await playgroundPoint(page, 0, 10), bottom = await playgroundPoint(page, 0, -10)
  await page.mouse.click(top.x, top.y); await page.mouse.move(bottom.x, bottom.y)
  await expect(page.locator('.workbench')).toHaveAttribute('data-modification-preview-count', '2')
  await expect(page.locator('#revision')).toHaveText(`REV ${revision}`)
  await page.keyboard.press('Escape'); await expect(page.locator('#revision')).toHaveText(`REV ${revision}`)

  await command(); await page.locator('#dialog-submit').click(); await page.mouse.click(top.x, top.y); await page.mouse.move(bottom.x, bottom.y)
  await expect(page.locator('.workbench')).toHaveAttribute('data-modification-preview-count', '2'); await page.mouse.click(bottom.x, bottom.y)
  await expect(page.locator('#revision')).toHaveText(`REV ${revision + 1}`); await expect(page.locator('#entity-count')).toHaveText('4 entities')
  await page.locator('#undo').click(); await expect(page.locator('#entity-count')).toHaveText('3 entities')
  await page.locator('#redo').click(); await expect(page.locator('#entity-count')).toHaveText('4 entities')
})
