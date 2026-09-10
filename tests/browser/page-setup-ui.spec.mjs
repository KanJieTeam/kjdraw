import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

// Like the existing workbench integration fixtures, mount the inline-style SDK
// outside the hosted playground's external-styles-only CSP.
test.use({ bypassCSP: true })

async function mount(page, locale = 'en', theme = 'light') {
  await page.goto('/')
  await page.evaluate(async ({ locale, theme }) => {
    const { createKJDrawSDK, createKJDrawEditor } = await import('/packages/kjdraw-sdk/src/index.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    await drawing.transact('two page configurations', tx => {
      tx.createLayout({ name: 'Custom sheet', dxfPlotSettings: { paperWidth: 610, paperHeight: 914, marginLeft: 11, marginTop: 14, paperUnits: 0, rotation: 3, flags: 180, scaleNumerator: 1, scaleDenominator: 50, styleSheet: 'original.ctb' } })
      tx.createLayout({ name: 'Empty sheet', dxfPlotSettings: { paperWidth: 148, paperHeight: 210 } })
      tx.createEntity('LINE', { start: [0, 0], end: [100, 200] }, { id: 'unrelated-line' })
    })
    document.body.style.margin = '0'
    const host = document.createElement('div'); host.style.cssText = 'width:100vw;height:100vh'; document.body.replaceChildren(host)
    window.pageEditor = createKJDrawEditor(host, { sdk, document: drawing, locale, theme }); await window.pageEditor.ready
  }, { locale, theme })
}
const dialog = page => page.locator('[data-page-dialog]')
const field = (page, name) => page.locator(`[data-page-field="${name}"]`)
const values = page => page.evaluate(() => {
  const doc = window.pageEditor.document
  return { revision: doc.revision, pages: doc.snapshot().spaces.layoutIds.map(id => doc.getObject(id)).map(l => [l.name, l.payload.dxfPlotSettings]), line: doc.getObject('unrelated-line') }
})
async function open(page, name = 'Custom sheet') {
  await page.locator('[data-action="page-setup"]').click()
  await expect(dialog(page)).toBeVisible()
  await page.locator('[data-page-sheet]').selectOption({ label: name })
}

test('page setup edits selected paper settings through real controls, history and exported reopen', async ({ page }) => {
  await mount(page)
  const before = await values(page)
  await open(page)
  await expect(field(page, 'paperWidth')).toHaveValue('610')
  await field(page, 'paperWidth').fill('594'); await field(page, 'paperHeight').fill('841')
  await field(page, 'paperUnits').selectOption('1'); await field(page, 'rotation').selectOption('1')
  await field(page, 'marginLeft').fill('7.5'); await field(page, 'scaleDenominator').fill('100')
  await dialog(page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog(page)).not.toBeVisible()
  const after = await values(page), actual = after.pages.find(p => p[0] === 'Custom sheet')[1]
  expect(actual).toEqual({ paperWidth: 594, paperHeight: 841, marginLeft: 7.5, marginTop: 14, paperUnits: 1, rotation: 1, flags: 164, scaleNumerator: 1, scaleDenominator: 100, styleSheet: 'original.ctb' })
  expect(after.line).toEqual(before.line); expect(after.pages.find(p => p[0] === 'Empty sheet')).toEqual(before.pages.find(p => p[0] === 'Empty sheet'))
  await page.evaluate(() => window.pageEditor.undo()); expect((await values(page)).pages).toEqual(before.pages)
  await page.evaluate(() => window.pageEditor.redo()); expect((await values(page)).pages).toEqual(after.pages)
  const reopened = await page.evaluate(async () => {
    const editor = window.pageEditor
    await editor.open(new File([await editor.save({ format: 'DXF', download: false })], 'ui-pages.dxf'))
    return editor.document.snapshot().spaces.layoutIds.map(id => editor.document.getObject(id)).map(l => [l.name, l.payload.dxfPlotSettings])
  })
  expect(reopened).toEqual(after.pages)
})

test('page setup cancellation, invalid numbers, stale revisions and readonly transitions preserve data', async ({ page }) => {
  await mount(page)
  const before = await values(page)
  await open(page); await field(page, 'paperWidth').fill('500')
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await values(page)).toEqual(before)
  await open(page); await field(page, 'paperWidth').fill('-1')
  await dialog(page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog(page)).toBeVisible(); expect(await values(page)).toEqual(before)
  await field(page, 'paperWidth').fill('500')
  await page.evaluate(() => window.pageEditor.execute('MOVE', { id: 'unrelated-line', dx: 2, dy: 3 }))
  const changed = await values(page)
  await dialog(page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('drawing changed')
  expect(await values(page)).toEqual(changed)
  await page.keyboard.press('Escape'); await expect(dialog(page)).not.toBeVisible()
  await open(page); await page.evaluate(() => window.pageEditor.setOptions({ readonly: true }))
  await expect(dialog(page)).not.toBeVisible(); await expect(page.locator('[data-action="page-setup"]')).toBeDisabled()
  await page.evaluate(() => window.pageEditor.setOptions({ readonly: false }))
  await open(page)
  // Applying an unchanged form creates no history entry or materialized defaults.
  await dialog(page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog(page)).not.toBeVisible(); expect(await values(page)).toEqual(changed)
})

test('Chinese dark page setup fits a narrow screen and remains usable by keyboard', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mount(page, 'zh-CN', 'dark')
  await open(page, 'Empty sheet')
  await expect(dialog(page)).toHaveAttribute('aria-label', '页面设置')
  // Precision keeps light control surfaces with a dark canvas; verify the actual
  // shared dialog styling instead of imposing a different theme contract.
  expect(await dialog(page).evaluate(el => getComputedStyle(el).borderRadius)).toBe('10px')
  await expect(page.locator('.kjwb')).toHaveClass(/dark/)
  expect(await page.locator('.kjwb').evaluate(el => getComputedStyle(el).display)).toBe('grid')
  await expect(dialog(page).getByText('纸张宽度（毫米）', { exact: true })).toBeVisible()
  const box = await dialog(page).boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(await dialog(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await field(page, 'paperWidth').fill('210'); await field(page, 'paperHeight').fill('297')
  await field(page, 'paperHeight').press('Enter')
  await expect(dialog(page)).not.toBeVisible()
  expect((await values(page)).pages.find(p => p[0] === 'Empty sheet')[1]).toEqual({ paperWidth: 210, paperHeight: 297 })
  await open(page, 'Empty sheet')
  await mkdir('.cache/page-ui', { recursive: true })
  await page.screenshot({ path: `.cache/page-ui/${testInfo.project.name}-zh-dark-narrow.png` })
  await page.keyboard.press('Escape'); await expect(dialog(page)).not.toBeVisible()
})


test('window plotting, physical offsets and fit/custom scale survive UI edits, history, agent reads and DXF reopen', async ({ page }) => {
  await mount(page)
  const before = await values(page)
  await open(page)
  await field(page, 'plotType').selectOption('4')
  for (const [key, value] of Object.entries({ windowMinX: -20, windowMinY: -30, windowMaxX: 125, windowMaxY: 250, originX: -2.5, originY: 3.5 })) await field(page, key).fill(String(value))
  await page.locator('[data-page-scale-mode]').selectOption('fit')
  await expect(field(page, 'scaleDenominator')).toBeDisabled()
  await dialog(page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog(page)).not.toBeVisible()
  const after = await values(page), settings = after.pages.find(p => p[0] === 'Custom sheet')[1]
  expect(settings).toEqual({ ...before.pages.find(p => p[0] === 'Custom sheet')[1], plotType: 4, windowMinX: -20, windowMinY: -30, windowMaxX: 125, windowMaxY: 250, originX: -2.5, originY: 3.5, standardScaleType: 0 })
  expect(after.line).toEqual(before.line)
  expect(after.pages.filter(p => p[0] !== 'Custom sheet')).toEqual(before.pages.filter(p => p[0] !== 'Custom sheet'))
  await page.evaluate(() => window.pageEditor.undo()); expect((await values(page)).pages).toEqual(before.pages)
  await page.evaluate(() => window.pageEditor.redo()); expect((await values(page)).pages).toEqual(after.pages)
  await page.evaluate(async () => {
    const editor = window.pageEditor
    await editor.open(new File([await editor.save({ format: 'DXF', download: false })], 'window-fit.dxf'))
  })
  expect((await values(page)).pages).toEqual(after.pages)
  const read = await page.evaluate(async () => {
    const { KJAgentToolSession } = await import('/packages/kjdraw-sdk/src/index.js')
    const editor = window.pageEditor, session = new KJAgentToolSession(editor.sdk, editor.document)
    return session.call('cad_read_layouts', { expectedRevision: editor.document.revision, offset: 0, limit: 20, maxBytes: 4096 })
  })
  expect(read.ok).toBe(true)
  expect(read.value.layouts.find(l => l.name === 'Custom sheet').pageSettings).toMatchObject({ plotType: 4, windowMinX: -20, windowMaxY: 250, flags: 180, standardScaleType: 0 })
  await open(page); await expect(page.locator('[data-page-scale-mode]')).toHaveValue('fit')
  const noOp = await values(page)
  await dialog(page).getByRole('button', { name: 'Apply', exact: true }).click(); expect(await values(page)).toEqual(noOp)
  await open(page); await page.locator('[data-page-scale-mode]').selectOption('custom')
  await field(page, 'scaleDenominator').fill('200')
  await dialog(page).getByRole('button', { name: 'Apply', exact: true }).click()
  expect((await values(page)).pages.find(p => p[0] === 'Custom sheet')[1]).toEqual({ ...settings, flags: 164, scaleDenominator: 200 })
})

test('plot windows reject missing and reversed coordinates; named views require a name', async ({ page }) => {
  await mount(page, 'zh-CN')
  const before = await values(page)
  await open(page)
  await field(page, 'plotType').selectOption('4')
  await dialog(page).getByRole('button', { name: '应用', exact: true }).click()
  await expect(dialog(page)).toBeVisible(); expect(await values(page)).toEqual(before)
  for (const [key, value] of Object.entries({ windowMinX: 20, windowMinY: 0, windowMaxX: 10, windowMaxY: 20 })) await field(page, key).fill(String(value))
  await dialog(page).getByRole('button', { name: '应用', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('positive width and height')
  expect(await values(page)).toEqual(before)
  await field(page, 'plotType').selectOption('3')
  await expect(field(page, 'windowMinX')).toBeDisabled()
  await dialog(page).getByRole('button', { name: '应用', exact: true }).click()
  await expect(dialog(page)).toBeVisible(); expect(await values(page)).toEqual(before)
  await field(page, 'viewName').fill('Original view')
  await dialog(page).getByRole('button', { name: '应用', exact: true }).click()
  await expect(dialog(page)).not.toBeVisible()
  expect((await values(page)).pages.find(p => p[0] === 'Custom sheet')[1]).toEqual({ ...before.pages.find(p => p[0] === 'Custom sheet')[1], plotType: 3, viewName: 'Original view' })
})
