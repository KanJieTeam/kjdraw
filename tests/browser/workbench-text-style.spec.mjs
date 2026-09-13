import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

test.use({ bypassCSP: true, viewport: { width: 1280, height: 820 } })

test('workbench applies native text styles atomically and new text uses the current style', async ({ page }) => {
  await page.goto('/')
  const state = await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div')
    host.style.cssText = 'width:1200px;height:760px'
    document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'text-style-workbench', units: 'millimeter' })
    const standard = drawing.getTable('textStyles').currentId
    const first = await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [10, 10, 0], text: 'PUMP P-01', height: 4 } }, { document: drawing })
    const second = await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [10, 20, 0], text: '泵房标高', height: 4 } }, { document: drawing })
    const engineering = await sdk.executeCommand('TEXTSTYLE', { name: 'ENGINEERING-CJK', fontFamily: 'Noto Sans CJK SC', widthFactor: .8, obliqueAngle: .1, current: true }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, showLayers: false, showInspector: true, grid: false })
    await workbench.ready
    await sdk.executeCommand('SELECT', { ids: [first.id, second.id], operation: 'replace' }, { document: drawing })
    window.__textStyle = { sdk, drawing, workbench, first, second, engineering }
    return { standard, engineering: engineering.id, beforeRevision: drawing.revision }
  })

  const inspector = page.locator('[data-inspector]')
  await expect(inspector.locator('[data-property="text-style"]')).toHaveValue(state.standard)
  await inspector.locator('[data-property="text-style"]').selectOption(state.engineering)
  await inspector.locator('button.apply').click()
  await expect.poll(() => page.evaluate(() => window.__textStyle.drawing.revision)).toBe(state.beforeRevision + 1)
  await expect.poll(() => page.evaluate(() => {
    const { drawing, first, second } = window.__textStyle
    return [drawing.getObject(first.id).payload.styleId, drawing.getObject(second.id).payload.styleId]
  })).toEqual([state.engineering, state.engineering])

  await page.locator('[data-action="undo"]').click()
  await expect.poll(() => page.evaluate(() => {
    const { drawing, first, second } = window.__textStyle
    return [drawing.getObject(first.id).payload.styleId, drawing.getObject(second.id).payload.styleId]
  })).toEqual([state.standard, state.standard])
  await page.locator('[data-action="redo"]').click()
  await expect.poll(() => page.evaluate(() => window.__textStyle.drawing.getObject(window.__textStyle.first.id).payload.styleId)).toBe(state.engineering)

  const command = page.locator('[data-command]')
  await command.fill('TEXT 30 30 新建说明')
  await command.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__textStyle.drawing.listEntities({ type: 'TEXT' }).length)).toBe(3)
  expect(await page.evaluate(() => window.__textStyle.drawing.listEntities({ type: 'TEXT' }).at(-1).payload.styleId)).toBe(state.engineering)
  await page.evaluate(() => window.__textStyle.workbench.setLocale('zh-CN'))
  await expect(inspector.locator('[data-property="text-style"]').locator('xpath=preceding-sibling::span')).toHaveText('文字样式')
})

test('workbench manages text style records and edits multiline placement controls', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'text-style-ui'; host.style.cssText = 'width:1200px;height:760px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'text-style-ui', units: 'millimeter' })
    const original = await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [0, 0, 0], text: '原有对象', height: 2.5 } }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, showInspector: true, grid: false }); await workbench.ready
    window.__textStyleUI = { sdk, drawing, workbench, original }
  })
  const root = page.locator('#text-style-ui'), dialog = root.locator('[data-text-style-dialog]')
  const initial = await page.evaluate(() => window.__textStyleUI.drawing.revision)
  await root.locator('[data-action="text-styles"]').click(); await dialog.locator('[data-action="cancel-text-style"]').click()
  expect(await page.evaluate(() => window.__textStyleUI.drawing.revision)).toBe(initial)

  await root.locator('[data-action="text-styles"]').click(); await dialog.locator('[data-action="new-text-style"]').click()
  await dialog.locator('[data-text-style-field="name"]').fill('UI-CJK')
  for (const [key, value] of [['fontFamily', 'Noto Sans CJK SC'], ['fontFile', 'NotoSansCJK-Regular.ttc'], ['bigFontFile', 'hztxt.shx'], ['fixedHeight', '4'], ['widthFactor', '.8'], ['obliqueDegrees', '10']]) await dialog.locator(`[data-text-style-field="${key}"]`).fill(value)
  await dialog.locator('[data-action="save-text-style"]').click(); await expect(dialog).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__textStyleUI.drawing.revision)).toBe(initial + 1)

  await root.locator('[data-action="text-styles"]').click(); await dialog.locator('[data-action="new-text-style"]').click()
  await dialog.locator('[data-text-style-field="name"]').fill('ui-cjk'); await dialog.locator('[data-action="save-text-style"]').click()
  await expect(dialog.locator('[data-text-style-error]')).toContainText('already exists')
  expect(await page.evaluate(() => window.__textStyleUI.drawing.revision)).toBe(initial + 1)
  await dialog.locator('[data-action="cancel-text-style"]').click()

  await root.locator('[data-action="text-styles"]').click(); await dialog.locator('[data-text-style-record]').selectOption({ label: 'UI-CJK' })
  await page.evaluate(async () => { const { sdk, drawing } = window.__textStyleUI; await sdk.executeCommand('LAYERNEW', { name: 'Concurrent' }, { document: drawing }) })
  const staleRevision = await page.evaluate(() => window.__textStyleUI.drawing.revision)
  await dialog.locator('[data-text-style-field="widthFactor"]').fill('.75'); await dialog.locator('[data-action="save-text-style"]').click()
  await expect(dialog.locator('[data-text-style-error]')).not.toBeEmpty()
  expect(await page.evaluate(() => window.__textStyleUI.drawing.revision)).toBe(staleRevision)
  await dialog.locator('[data-action="cancel-text-style"]').click()

  await root.locator('[data-action="text-styles"]').click(); await dialog.locator('[data-text-style-record]').selectOption({ label: 'UI-CJK' })
  await dialog.locator('[data-action="set-current-text-style"]').click(); await expect(dialog).not.toBeVisible()
  const style = await page.evaluate(() => {
    const { drawing, original } = window.__textStyleUI, record = drawing.getTable('textStyles').records.find(candidate => candidate.name === 'UI-CJK')
    return { id: record.id, payload: record.payload, originalStyle: drawing.getObject(original.id).payload.styleId }
  })
  expect(style.payload).toMatchObject({ fontFamily: 'Noto Sans CJK SC', fontFile: 'NotoSansCJK-Regular.ttc', bigFontFile: 'hztxt.shx', fixedHeight: 4, widthFactor: .8 })
  expect(style.originalStyle).not.toBe(style.id)

  const command = root.locator('[data-command]'); await command.fill('MTEXT 30 30 设备说明\\P第二行 😀'); await command.press('Enter')
  const created = await page.evaluate(() => window.__textStyleUI.drawing.listEntities({ type: 'MTEXT' })[0])
  const painted = await page.evaluate(() => {
    const renderer=window.__textStyleUI.workbench.renderer,labels=[],native=renderer.context.fillText
    renderer.context.fillText=function(value,...rest){labels.push(String(value));return native.call(this,value,...rest)}
    renderer.fit();const report=renderer.render();renderer.context.fillText=native
    return {labels,unsupported:report.unsupported}
  })
  expect(painted.labels).toEqual(expect.arrayContaining(['设备说明','第二行 😀']));expect(painted.unsupported).toBe(0)
  expect(created.payload).toMatchObject({ styleId: style.id, text: '设备说明\\P第二行 😀', attachmentPoint: 1 })
  await page.evaluate(async id => { const { sdk, drawing } = window.__textStyleUI; await sdk.executeCommand('SELECT', { ids: [id], operation: 'replace' }, { document: drawing }) }, created.id)
  const inspector = root.locator('[data-inspector]')
  await expect(inspector.locator('[data-property="text-style"]')).toHaveValue(style.id)
  await inspector.locator('[data-property="text-height"]').fill('6'); await inspector.locator('[data-property="text-rotation"]').fill('30'); await inspector.locator('[data-property="text-alignment"]').selectOption('5')
  const beforeEdit = await page.evaluate(() => window.__textStyleUI.drawing.revision); await inspector.locator('button.apply').click()
  await expect.poll(() => page.evaluate(() => window.__textStyleUI.drawing.revision)).toBe(beforeEdit + 1)
  expect(await page.evaluate(id => { const p = window.__textStyleUI.drawing.getObject(id).payload; return { styleId: p.styleId, height: p.height, rotation: p.rotation, attachmentPoint: p.attachmentPoint } }, created.id)).toEqual({ styleId: style.id, height: 6, rotation: Math.PI / 6, attachmentPoint: 5 })
  await root.locator('[data-action="undo"]').click(); await expect.poll(() => page.evaluate(id => window.__textStyleUI.drawing.getObject(id).payload.attachmentPoint, created.id)).toBe(1)
  await root.locator('[data-action="redo"]').click(); await expect.poll(() => page.evaluate(id => window.__textStyleUI.drawing.getObject(id).payload.attachmentPoint, created.id)).toBe(5)
  await page.evaluate(() => window.__textStyleUI.workbench.setOptions({ readonly: true })); await expect(root.locator('[data-action="text-styles"]')).toBeDisabled()
})

test('main playground creates current text styles and real aligned Unicode MTEXT', async ({ page }) => {
  const fixtureSdk = createKJDrawSDK(), drawing = fixtureSdk.createDocument({ documentId: 'playground-text-style', units: 'millimeter' })
  const content = await fixtureSdk.writeDocument(drawing, { format: 'KJD' })
  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'text-style.kjd', mimeType: 'application/json', buffer: Buffer.from(content) })
  await page.locator('#text-styles').click(); await page.locator('#app-dialog select[name="operation"]').selectOption('create'); await page.locator('#dialog-submit').click()
  const dialog = page.locator('#app-dialog'); await dialog.locator('input[name="name"]').fill('PLAY-CJK')
  for (const [key, value] of [['fontFamily', 'Noto Sans CJK SC'], ['fontFile', 'NotoSansCJK-Regular.ttc'], ['bigFontFile', 'hztxt.shx'], ['fixedHeight', '4'], ['widthFactor', '.8'], ['obliqueDegrees', '8']]) await dialog.locator(`[name="${key}"]`).fill(value)
  await dialog.locator('input[name="current"]').check(); await page.locator('#dialog-submit').click(); await expect(dialog).not.toBeVisible()

  const canvas = page.locator('#canvas'), box = await canvas.boundingBox(), point = { x: Math.floor(box.width * .55), y: Math.floor(box.height * .48) }
  await page.locator('[data-tool="text"]').click(); await canvas.click({ position: point }); await expect(dialog).toBeVisible()
  await dialog.locator('select[name="type"]').selectOption('MTEXT'); await dialog.locator('textarea[name="text"]').fill('总装说明\\P第二行 Δ 😀')
  await dialog.locator('select[name="styleId"]').selectOption({ label: 'PLAY-CJK' }); await dialog.locator('input[name="height"]').fill('3.5'); await dialog.locator('input[name="rotationDegrees"]').fill('12'); await dialog.locator('select[name="attachment"]').selectOption('5')
  await page.locator('#dialog-submit').click(); await expect(dialog).not.toBeVisible(); await expect(page.locator('#entity-count')).toHaveText('1 entities')

  await page.locator('#nav-select').click(); await canvas.click({ position: point })
  await expect(page.locator('#inspector [data-property="text-style"]')).toHaveValue(/.+/)
  await expect(page.locator('#inspector [data-property="text-height"]')).toHaveValue('3.5')
  await expect(page.locator('#inspector [data-property="text-rotation"]')).toHaveValue('12')
  await expect(page.locator('#inspector [data-property="text-alignment"]')).toHaveValue('5')

  const pending = page.waitForEvent('download'); await page.locator('#save').click(); const download = await pending
  const bytes = await readFile(await download.path()), session = await KJProjectSession.open(bytes, { sdk: createKJDrawSDK() })
  const style = session.activeDocument.getTable('textStyles').records.find(record => record.name === 'PLAY-CJK'), mtext = session.activeDocument.listEntities({ type: 'MTEXT' })[0]
  expect(session.activeDocument.getTable('textStyles').currentId).toBe(style.id)
  expect(style.payload).toMatchObject({ fontFamily: 'Noto Sans CJK SC', fontFile: 'NotoSansCJK-Regular.ttc', bigFontFile: 'hztxt.shx', fixedHeight: 4, widthFactor: .8 })
  expect(mtext.payload).toMatchObject({ text: '总装说明\\P第二行 Δ 😀', styleId: style.id, height: 3.5, attachmentPoint: 5 }); expect(mtext.payload.rotation).toBeCloseTo(12 * Math.PI / 180)
  session.destroy()
})
