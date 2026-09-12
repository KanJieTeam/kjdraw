import { expect, test } from '@playwright/test'

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
