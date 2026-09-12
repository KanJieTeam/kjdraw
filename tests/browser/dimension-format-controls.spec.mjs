import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

test.use({ bypassCSP: true, viewport: { width: 1360, height: 900 } })

async function command(page, selector, value) {
  const input = page.locator(selector)
  await input.fill(value); await input.press('Enter'); await expect(input).toHaveValue('')
}

test('mounted workbench creates and atomically edits native dimension formatting', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'format-workbench'; host.style.cssText = 'width:1280px;height:840px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'dimension-format-workbench', units: 'millimeter' })
    const style = await sdk.executeCommand('DIMSTYLE', { name: 'ISO-DETAIL', properties: { overallScale: 2, textHeight: 1.5, decimalPlaces: 3 } }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, showInspector: true, grid: false }); await workbench.ready
    window.__dimensionFormat = { sdk, drawing, style, workbench }
  })
  const root = page.locator('#format-workbench'), dialog = root.locator('[data-draft-dialog]')
  await root.locator('[data-action="draft"]').click(); await dialog.locator('[data-draft-tool]').selectOption('dimension')
  await expect(dialog.locator('[data-draft-option="styleId"] option', { hasText: 'ISO-DETAIL' })).toHaveCount(1)
  const beforeCancel = await page.evaluate(() => window.__dimensionFormat.drawing.revision)
  await dialog.locator('[data-draft-option="styleId"]').selectOption({ label: 'ISO-DETAIL' })
  await dialog.locator('[data-draft-option="precision"]').fill('3')
  await dialog.locator('[data-draft-option="overallScale"]').fill('2')
  await dialog.locator('[data-draft-option="textHeight"]').fill('1.5')
  await dialog.locator('[data-draft-option="textOverride"]').fill('CL <> TYP')
  await dialog.locator('[data-action="cancel-draft"]').click(); await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.__dimensionFormat.drawing.revision)).toBe(beforeCancel)

  await root.locator('[data-action="draft"]').click(); await dialog.locator('[data-draft-tool]').selectOption('dimension')
  await dialog.locator('[data-draft-option="styleId"]').selectOption({ label: 'ISO-DETAIL' })
  await dialog.locator('[data-draft-option="precision"]').fill('3'); await dialog.locator('[data-draft-option="overallScale"]').fill('2')
  await dialog.locator('[data-draft-option="textHeight"]').fill('1.5'); await dialog.locator('[data-draft-option="textOverride"]').fill('CL <> TYP')
  await dialog.locator('[data-action="start-draft"]').click()
  for (const coordinate of ['0,0', '12.34567,0', '6,5']) await command(page, '#format-workbench [data-command]', coordinate)
  await page.keyboard.press('Escape')
  const created = await page.evaluate(() => {
    const { drawing } = window.__dimensionFormat, entity = drawing.listEntities({ type: 'DIMENSION' })[0]
    return { id: entity.id, revision: drawing.revision, payload: entity.payload }
  })
  expect(created.payload).toMatchObject({ styleName: 'ISO-DETAIL', precision: 3, overallScale: 2, textHeight: 1.5, textOverride: 'CL <> TYP' })

  await page.evaluate(async id => {
    const { sdk, drawing } = window.__dimensionFormat
    await sdk.executeCommand('SELECT', { ids: [id], operation: 'replace' }, { document: drawing })
  }, created.id)
  const inspector = root.locator('[data-inspector]')
  await expect(inspector.locator('[data-property="dimension-style"]')).toHaveValue(created.payload.styleId)
  await inspector.locator('[data-property="dimension-precision"]').fill('4')
  await inspector.locator('[data-property="dimension-scale"]').fill('1.25')
  await inspector.locator('[data-property="dimension-text-height"]').fill('2.25')
  await inspector.locator('[data-property="dimension-text-override"]').fill('REF <> MAX')
  await inspector.locator('button.apply').click()
  await expect.poll(() => page.evaluate(() => window.__dimensionFormat.drawing.revision)).toBe(created.revision + 1)
  expect(await page.evaluate(id => {
    const entity = window.__dimensionFormat.drawing.getObject(id)
    return { precision: entity.payload.precision, scale: entity.payload.overallScale, height: entity.payload.textHeight, text: entity.payload.textOverride }
  }, created.id)).toEqual({ precision: 4, scale: 1.25, height: 2.25, text: 'REF <> MAX' })
  await root.locator('[data-action="undo"]').click()
  await expect.poll(() => page.evaluate(id => window.__dimensionFormat.drawing.getObject(id).payload.textOverride, created.id)).toBe('CL <> TYP')
  await root.locator('[data-action="redo"]').click()
  await expect.poll(() => page.evaluate(id => window.__dimensionFormat.drawing.getObject(id).payload.textOverride, created.id)).toBe('REF <> MAX')

  await page.evaluate(async id => {
    const { sdk, drawing } = window.__dimensionFormat
    const layer = await sdk.executeCommand('LAYERNEW', { name: 'Locked dimensions' }, { document: drawing })
    await sdk.executeCommand('PROPERTIES', { id, patch: { payload: { layerId: layer.id } } }, { document: drawing })
    await sdk.executeCommand('LAYERUPDATE', { id: layer.id, patch: { locked: true } }, { document: drawing })
    window.__dimensionFormat.protectedRevision = drawing.revision
  }, created.id)
  await inspector.locator('[data-property="dimension-precision"]').fill('6'); await inspector.locator('button.apply').click()
  await expect(root.locator('[data-message]')).toContainText('locked')
  expect(await page.evaluate(() => window.__dimensionFormat.drawing.revision)).toBe(await page.evaluate(() => window.__dimensionFormat.protectedRevision))
})

test('main playground exposes style, precision, scale and text controls on real dimension creation', async ({ page }) => {
  const fixtureSdk = createKJDrawSDK(), drawing = fixtureSdk.createDocument({ documentId: 'playground-dimension-format', units: 'millimeter' })
  const style = await fixtureSdk.executeCommand('DIMSTYLE', { name: 'SHOP-DIM', properties: { overallScale: 1.5, textHeight: 2, decimalPlaces: 3 } }, { document: drawing })
  const content = await fixtureSdk.writeDocument(drawing, { format: 'KJD' })
  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'dimension-format.kjd', mimeType: 'application/json', buffer: Buffer.from(content) })
  await command(page, '#command-input', 'DIMALIGNED')
  await expect(page.locator('#dimension-style option', { hasText: 'SHOP-DIM' })).toHaveCount(1)
  await page.locator('#dimension-style').selectOption(style.id); await page.locator('#dimension-style').dispatchEvent('change')
  await page.locator('#dimension-precision').fill('4'); await page.locator('#dimension-precision').dispatchEvent('change')
  await page.locator('#dimension-scale').fill('1.25'); await page.locator('#dimension-scale').dispatchEvent('change')
  await page.locator('#dimension-height').fill('2.25'); await page.locator('#dimension-height').dispatchEvent('change')
  await page.locator('#dimension-text-override').fill('REF <> MAX'); await page.locator('#dimension-text-override').dispatchEvent('change')
  for (const coordinate of ['0,0', '12.34567,0', '6,5']) await command(page, '#command-input', coordinate)
  await page.keyboard.press('Escape')
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  const pending = page.waitForEvent('download'); await page.locator('#save').click(); const download = await pending
  const bytes = await readFile(await download.path()), session = await KJProjectSession.open(bytes, { sdk: createKJDrawSDK() })
  const entity = session.activeDocument.listEntities({ type: 'DIMENSION' })[0]
  expect(entity.payload).toMatchObject({ styleId: style.id, styleName: 'SHOP-DIM', precision: 4, overallScale: 1.25, textHeight: 2.25, textOverride: 'REF <> MAX' })
  session.destroy()
})

test('mounted workbench manages dimension style records and new dimensions inherit the current style', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'style-workbench'; host.style.cssText = 'width:1280px;height:840px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'dimension-style-workbench', units: 'millimeter' })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, grid: false }); await workbench.ready
    window.__dimensionStyles = { sdk, drawing, workbench }
  })
  const root = page.locator('#style-workbench'), dialog = root.locator('[data-dimension-style-dialog]')
  const initial = await page.evaluate(() => window.__dimensionStyles.drawing.revision)
  await root.locator('[data-action="dimension-styles"]').click(); await dialog.locator('[data-action="cancel-dimension-style"]').click()
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.__dimensionStyles.drawing.revision)).toBe(initial)
  await root.locator('[data-action="dimension-styles"]').click(); await expect(dialog).toBeVisible()
  await dialog.locator('[data-action="new-dimension-style"]').click()
  await dialog.locator('[data-dimension-style-field="name"]').fill('UI-DETAIL')
  for (const [key, value] of [['precision', '4'], ['overallScale', '2'], ['textHeight', '1.8'], ['arrowSize', '.9'], ['extensionOffset', '.35'], ['extensionBeyond', '.7']]) await dialog.locator(`[data-dimension-style-field="${key}"]`).fill(value)
  await dialog.locator('[data-action="save-dimension-style"]').click(); await expect(dialog).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__dimensionStyles.drawing.revision)).toBe(initial + 1)

  await root.locator('[data-action="dimension-styles"]').click(); await dialog.locator('[data-action="new-dimension-style"]').click()
  await dialog.locator('[data-dimension-style-field="name"]').fill('ui-detail'); await dialog.locator('[data-action="save-dimension-style"]').click()
  await expect(dialog.locator('[data-dimension-style-error]')).toContainText('already exists')
  expect(await page.evaluate(() => window.__dimensionStyles.drawing.revision)).toBe(initial + 1)
  await dialog.locator('[data-action="cancel-dimension-style"]').click()

  await root.locator('[data-action="dimension-styles"]').click(); await dialog.locator('[data-dimension-style-record]').selectOption({ label: 'UI-DETAIL' })
  await dialog.locator('[data-action="set-current-dimension-style"]').click(); await expect(dialog).not.toBeVisible()
  const style = await page.evaluate(() => {
    const { drawing } = window.__dimensionStyles, record = drawing.getTable('dimensionStyles').records.find(candidate => candidate.name === 'UI-DETAIL')
    return { id: record.id, currentId: drawing.getTable('dimensionStyles').currentId }
  })
  expect(style.currentId).toBe(style.id)

  await command(page, '#style-workbench [data-command]', 'DIMALIGNED')
  for (const coordinate of ['0,0', '12.5,0', '6,5']) await command(page, '#style-workbench [data-command]', coordinate)
  const dimension = await page.evaluate(() => window.__dimensionStyles.drawing.listEntities({ type: 'DIMENSION' })[0])
  expect(dimension.payload).toMatchObject({ styleId: style.id, styleName: 'UI-DETAIL' })

  await root.locator('[data-action="dimension-styles"]').click(); await dialog.locator('[data-dimension-style-record]').selectOption(style.id)
  await dialog.locator('[data-dimension-style-field="precision"]').fill('5'); await dialog.locator('[data-action="save-dimension-style"]').click()
  expect(await page.evaluate(id => window.__dimensionStyles.drawing.getObject(id).payload.styleId, dimension.id)).toBe(style.id)
  await root.locator('[data-action="undo"]').click()
  await expect.poll(() => page.evaluate(id => window.__dimensionStyles.drawing.getObject(id).payload.decimalPlaces, style.id)).toBe(4)
  await root.locator('[data-action="redo"]').click()
  await expect.poll(() => page.evaluate(id => window.__dimensionStyles.drawing.getObject(id).payload.decimalPlaces, style.id)).toBe(5)
  await page.evaluate(() => window.__dimensionStyles.workbench.setOptions({ readonly: true }))
  await expect(root.locator('[data-action="dimension-styles"]')).toBeDisabled()
})

test('main playground creates and activates a complete dimension style through its native dialog', async ({ page }) => {
  const fixtureSdk = createKJDrawSDK(), drawing = fixtureSdk.createDocument({ documentId: 'playground-dimension-style', units: 'millimeter' })
  const content = await fixtureSdk.writeDocument(drawing, { format: 'KJD' })
  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'dimension-style.kjd', mimeType: 'application/json', buffer: Buffer.from(content) })
  await page.locator('#dimension-styles').click()
  await page.locator('#app-dialog select[name="operation"]').selectOption('create'); await page.locator('#dialog-submit').click()
  const dialog = page.locator('#app-dialog')
  await dialog.locator('input[name="name"]').fill('PLAYGROUND-DETAIL')
  for (const [key, value] of [['precision', '4'], ['overallScale', '1.75'], ['textHeight', '2.2'], ['arrowSize', '1.1'], ['extensionOffset', '.4'], ['extensionBeyond', '.8']]) await dialog.locator(`input[name="${key}"]`).fill(value)
  await dialog.locator('input[name="current"]').check(); await page.locator('#dialog-submit').click(); await expect(dialog).not.toBeVisible()
  await expect(page.locator('#dimension-style option', { hasText: 'PLAYGROUND-DETAIL' })).toHaveCount(1)
  await command(page, '#command-input', 'DIMALIGNED')
  for (const coordinate of ['0,0', '20,0', '10,6']) await command(page, '#command-input', coordinate)
  const pending = page.waitForEvent('download'); await page.locator('#save').click(); const download = await pending
  const bytes = await readFile(await download.path()), session = await KJProjectSession.open(bytes, { sdk: createKJDrawSDK() })
  const style = session.activeDocument.getTable('dimensionStyles').records.find(record => record.name === 'PLAYGROUND-DETAIL')
  const dimension = session.activeDocument.listEntities({ type: 'DIMENSION' })[0]
  expect(style.payload).toMatchObject({ decimalPlaces: 4, overallScale: 1.75, textHeight: 2.2, arrowSize: 1.1, extensionOffset: .4, extensionBeyond: .8 })
  expect(session.activeDocument.getTable('dimensionStyles').currentId).toBe(style.id)
  expect(dimension.payload.styleId).toBe(style.id)
  session.destroy()
})
