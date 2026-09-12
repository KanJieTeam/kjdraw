import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

const commandCases = [
  { command: 'MI ERASE', id: 'mirror', fields: { eraseSource: true } },
  { command: 'ARRAYRECTANGULAR 2 3 7.5 11', id: 'array-rect', fields: { rows: '2', columns: '3', rowSpacing: '7.5', columnSpacing: '11' } },
  { command: 'POLARARRAY 8 180 STATIC', id: 'array-polar', fields: { count: '8', angleDegrees: '180', rotateItems: false } },
  { command: 'O 2.5', id: 'offset', fields: { distance: '2.5' } },
  { command: 'CHA 2 3', id: 'chamfer', fields: { distance1: '2', distance2: '3' } },
  { command: 'F 4', id: 'fillet', fields: { radius: '4' } },
]

async function assertFields(root, fields, attribute) {
  for (const [name, expected] of Object.entries(fields)) {
    const input = root.locator(`[${attribute}="${name}"]`)
    if (typeof expected === 'boolean') {
      if (expected) await expect(input).toBeChecked()
      else await expect(input).not.toBeChecked()
    } else await expect(input).toHaveValue(expected)
  }
}

async function enterWorkbench(page, value) {
  const input = page.locator('#modify-entry-workbench [data-command]')
  await input.fill(value)
  await input.press('Enter')
}

async function workbenchPoint(page, value) {
  return page.evaluate(value => {
    const { workbench } = window.__modifyEntry
    const canvas = workbench.root.querySelector('[data-canvas]')
    const rect = canvas.getBoundingClientRect(), point = workbench.renderer.worldToScreen(value)
    return { x: rect.left + point[0], y: rect.top + point[1] }
  }, value)
}

async function mountWorkbench(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div')
    host.id = 'modify-entry-workbench'
    host.style.cssText = 'width:1100px;height:720px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'),
      import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ documentId: 'modify-entry', units: 'millimeter' })
    const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [10, 0, 0] } }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing })
    await workbench.ready
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
    workbench.renderer.resize()
    workbench.renderer.fit()
    window.__modifyEntry = { sdk, drawing, line, workbench }
  })
}

test('workbench aliases prefill six modification workflows and OFFSET requires a picked side', async ({ page }) => {
  await mountWorkbench(page)
  const root = page.locator('#modify-entry-workbench')
  const dialog = root.locator('[data-modification-dialog]')
  for (const item of commandCases) {
    await enterWorkbench(page, item.command)
    await expect(dialog).toBeVisible()
    await expect(root.locator('[data-modification]')).toHaveValue(item.id)
    await assertFields(root, item.fields, 'data-modification-field')
    await root.locator('[data-action="cancel-modification"]').click()
    await expect(dialog).not.toBeVisible()
  }

  const previewRevision = await page.evaluate(() => window.__modifyEntry.drawing.revision)
  for (const operation of [
    { command: 'MI KEEP', first: '0,0', cursor: [0, 5], count: '1' },
    { command: 'ARRAYPOLAR 4 360 ROTATE', cursor: [0, 0], count: '3' },
    { command: 'OFFSET 2.5', cursor: [0, 5], count: '1' },
  ]) {
    await enterWorkbench(page, operation.command)
    await root.locator('[data-action="start-modification"]').click()
    if (operation.first) await enterWorkbench(page, operation.first)
    const location = await workbenchPoint(page, operation.cursor)
    await page.mouse.move(location.x, location.y)
    await expect(root.locator('[data-overlay]')).toHaveAttribute('data-modification-preview-count', operation.count)
    expect(await page.evaluate(() => window.__modifyEntry.drawing.revision)).toBe(previewRevision)
    await page.keyboard.press('Escape')
  }

  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__modifyEntry
    const vertical = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [0, 10, 0] } }, { document: drawing })
    await sdk.executeCommand('SELECT', { ids: [line.id, vertical.id], operation: 'replace' }, { document: drawing })
    window.__modifyEntry.workbench.renderer.fit()
    window.__modifyEntry.vertical = vertical
  })
  const pairRevision = await page.evaluate(() => window.__modifyEntry.drawing.revision)
  for (const command of ['CHAMFER 2 3', 'FILLET 2']) {
    await enterWorkbench(page, command)
    await root.locator('[data-action="start-modification"]').click()
    await enterWorkbench(page, '8,0')
    const location = await workbenchPoint(page, [0, 8])
    await page.mouse.move(location.x, location.y)
    await expect(root.locator('[data-overlay]')).toHaveAttribute('data-modification-preview-count', '3')
    expect(await page.evaluate(() => window.__modifyEntry.drawing.revision)).toBe(pairRevision)
    await page.keyboard.press('Escape')
  }
  await page.evaluate(async () => {
    const { sdk, drawing, line, vertical } = window.__modifyEntry
    await sdk.executeCommand('ERASE', { id: vertical.id }, { document: drawing })
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
  })

  const before = await page.evaluate(() => window.__modifyEntry.drawing.revision)
  await enterWorkbench(page, 'OFFSET 2.5')
  await root.locator('[data-action="start-modification"]').click()
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.__modifyEntry.drawing.revision)).toBe(before)
  await enterWorkbench(page, '0,5')
  await expect.poll(() => page.evaluate(() => window.__modifyEntry.drawing.listEntities({ type: 'LINE' }).length)).toBe(2)
  expect(await page.evaluate(() => window.__modifyEntry.drawing.listEntities({ type: 'LINE' }).map(entity => entity.payload.start[1]).sort())).toEqual([0, 2.5])

  await root.locator('[data-action="undo"]').click()
  await expect.poll(() => page.evaluate(() => window.__modifyEntry.drawing.listEntities({ type: 'LINE' }).length)).toBe(1)
  await root.locator('[data-action="redo"]').click()
  await expect.poll(() => page.evaluate(() => window.__modifyEntry.drawing.listEntities({ type: 'LINE' }).length)).toBe(2)

  await page.evaluate(() => window.__modifyEntry.workbench.setLocale('zh-CN'))
  const stable = await page.evaluate(() => window.__modifyEntry.drawing.revision)
  await enterWorkbench(page, 'OFFSET nope')
  await expect(root.locator('[data-message]')).toContainText('偏移距离必须是有限数值')
  expect(await page.evaluate(() => window.__modifyEntry.drawing.revision)).toBe(stable)
})

test('workbench rejects all six modification workflows on locked, frozen and hidden layers without history changes', async ({ page }) => {
  await mountWorkbench(page)
  const root = page.locator('#modify-entry-workbench')
  await page.evaluate(async () => {
    const { sdk, drawing } = window.__modifyEntry
    const layer = await sdk.executeCommand('LAYERNEW', { name: 'Protected modifications' }, { document: drawing })
    const horizontal = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [10, 0], layerId: layer.id } }, { document: drawing })
    const vertical = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [0, 10], layerId: layer.id } }, { document: drawing })
    Object.assign(window.__modifyEntry, { protectedLayer: layer, protectedHorizontal: horizontal, protectedVertical: vertical })
  })
  const cases = [
    { protection: { locked: true }, command: 'MIRROR KEEP', ids: ['protectedHorizontal'], points: ['0,0', '1,0'], reason: 'locked' },
    { protection: { locked: true }, command: 'OFFSET 2', ids: ['protectedHorizontal'], points: ['0,5'], reason: 'locked' },
    { protection: { frozen: true }, command: 'ARRAYRECT 2 2 5 5', ids: ['protectedHorizontal'], points: [], reason: 'frozen' },
    { protection: { frozen: true }, command: 'ARRAYPOLAR 4 360 ROTATE', ids: ['protectedHorizontal'], points: ['0,0'], reason: 'frozen' },
    { protection: { visible: false }, command: 'CHAMFER 2 2', ids: ['protectedHorizontal', 'protectedVertical'], points: ['8,0', '0,8'], reason: 'hidden' },
    { protection: { visible: false }, command: 'FILLET 2', ids: ['protectedHorizontal', 'protectedVertical'], points: ['8,0', '0,8'], reason: 'hidden' },
  ]
  for (const item of cases) {
    await page.evaluate(async item => {
      const state = window.__modifyEntry, layer = state.protectedLayer
      await state.sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: false, frozen: false, visible: true, ...item.protection } }, { document: state.drawing })
      await state.sdk.executeCommand('SELECT', { ids: item.ids.map(key => state[key].id), operation: 'replace' }, { document: state.drawing })
    }, item)
    const before = await page.evaluate(() => ({ revision: window.__modifyEntry.drawing.revision, fingerprint: window.__modifyEntry.drawing.fingerprint(), history: window.__modifyEntry.drawing.history }))
    await enterWorkbench(page, item.command)
    await root.locator('[data-action="start-modification"]').click()
    for (const point of item.points) await enterWorkbench(page, point)
    await expect(root.locator('[data-message]')).toContainText(item.reason)
    await page.keyboard.press('Escape')
    const after = await page.evaluate(() => ({ revision: window.__modifyEntry.drawing.revision, fingerprint: window.__modifyEntry.drawing.fingerprint(), history: window.__modifyEntry.drawing.history }))
    expect(after).toEqual(before)
  }
})

async function enterPlayground(page, value) {
  await page.locator('#command-input').fill(value)
  await page.locator('#command-input').press('Enter')
}

test('playground uses the same six command parameters and keeps OFFSET transactional', async ({ page }) => {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'modify-playground', units: 'millimeter' })
  const content = await sdk.writeDocument(drawing, { format: 'KJD' })
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'modify-playground.kjd', mimeType: 'application/json', buffer: Buffer.from(content) })
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  const dialog = page.locator('#app-dialog')
  await enterPlayground(page, 'LINE')
  await enterPlayground(page, '0,0')
  await enterPlayground(page, '10,0')
  await page.keyboard.press('Escape')
  await enterPlayground(page, 'SELECTALL')
  for (const item of commandCases.slice(0, 4)) {
    await enterPlayground(page, item.command)
    await expect(dialog).toBeVisible()
    await assertFields(dialog, item.fields, 'name')
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  }

  await enterPlayground(page, 'OFFSET 2')
  await expect(dialog).toBeVisible()
  await dialog.locator('#dialog-submit').click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  const canvasBox = await page.locator('#canvas').boundingBox()
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 3)
  await expect(page.locator('.workbench')).toHaveAttribute('data-modification-preview-count', '1')
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  await enterPlayground(page, '0,5')
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await enterPlayground(page, 'UNDO')
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  await enterPlayground(page, 'REDO')
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await enterPlayground(page, 'UNDO')
  await enterPlayground(page, 'LINE')
  await enterPlayground(page, '0,0')
  await enterPlayground(page, '0,10')
  await page.keyboard.press('Escape')
  await enterPlayground(page, 'SELECTALL')
  for (const item of commandCases.slice(4)) {
    await enterPlayground(page, item.command)
    await expect(dialog).toBeVisible()
    await assertFields(dialog, item.fields, 'name')
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.workbench')).toHaveAttribute('aria-busy', 'false')
  }
})
