import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

let workbenchBundle = ''

test.use({ viewport: { width: 1024, height: 768 } })

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../packages/kjdraw-sdk/src/workbench.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  })
  workbenchBundle = result.outputFiles[0].text
})

test('shared Workbench edits native object snap settings with cancel, locale and document boundaries', async ({ page }) => {
  await page.route('**/packages/kjdraw-sdk/src/workbench.js', route => route.fulfill({ contentType: 'text/javascript', body: workbenchBundle }))
  await page.goto('/docs/')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div')
    host.id = 'snap-settings-host'
    host.style.cssText = 'width:1024px;height:768px'
    document.body.append(host)
    const { mountKJDrawWorkbench } = await import('/packages/kjdraw-sdk/src/workbench.js')
    const workbench = mountKJDrawWorkbench(host, { document: 'blank', locale: 'en', grid: false, showLayers: false, showInspector: false })
    await workbench.ready
    window.snapSettingsTest = { workbench }
  })

  const root = page.locator('#snap-settings-host .kjwb')
  const trigger = root.locator('[data-action="snap-settings"]')
  const dialog = root.locator('[data-snap-settings-dialog]')
  const aperture = dialog.locator('[data-snap-aperture]')
  const state = () => page.evaluate(() => {
    const drawing = window.snapSettingsTest.workbench.document
    const variables = drawing.snapshot().header.systemVariables
    return { documentId: drawing.id, revision: drawing.revision, modes: variables.OSMODE, aperture: variables.APERTURE }
  })

  await trigger.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-snap-mode]')).toHaveCount(10)
  await expect(aperture).toHaveValue('10')
  const initial = await state()
  for (const input of await dialog.locator('[data-snap-mode]').all()) if (await input.isChecked()) await input.uncheck()
  await dialog.locator('[data-snap-mode="endpoint"]').focus(); await page.keyboard.press('Space')
  await dialog.locator('[data-snap-mode="quadrant"]').focus(); await page.keyboard.press('Space')
  await aperture.fill('17'); await aperture.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect.poll(state).toEqual({ documentId: initial.documentId, revision: initial.revision + 1, modes: ['endpoint', 'quadrant'], aperture: 17 })

  const applied = await state()
  await trigger.click(); await aperture.fill('31'); await dialog.locator('[data-snap-mode="endpoint"]').uncheck(); await dialog.locator('[data-action="cancel-snap-settings"]').click()
  await expect.poll(state).toEqual(applied)
  await expect(trigger).toBeFocused()
  await trigger.click(); await aperture.fill('29'); await page.keyboard.press('Escape')
  await expect.poll(state).toEqual(applied)
  await expect(trigger).toBeFocused()

  await trigger.click(); await aperture.fill('0'); await dialog.locator('[data-action="apply-snap-settings"]').click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-snap-settings-error]')).toHaveText('Capture aperture must be a positive number.')
  await expect.poll(state).toEqual(applied)
  await page.keyboard.press('Escape')

  await page.evaluate(() => window.snapSettingsTest.workbench.setLocale('zh-CN'))
  await expect(trigger).toContainText('对象捕捉设置')
  await trigger.click()
  await expect(dialog).toHaveAttribute('aria-label', '对象捕捉设置')
  await expect(dialog.locator('[data-copy="snapAperture"]')).toHaveText('捕捉范围（像素）')
  await aperture.fill('99')
  await page.evaluate(async () => {
    const { workbench } = window.snapSettingsTest
    const second = workbench.sdk.createDocument({ documentId: 'snap-settings-second' })
    await workbench.sdk.executeCommand('SNAPSETTINGS', { modes: ['tangent', 'insertion'], radius: 5 }, { document: second })
    await workbench.setDocument(second)
  })
  await expect(dialog).toBeHidden()
  await trigger.click()
  await expect(aperture).toHaveValue('5')
  await expect(dialog.locator('[data-snap-mode="tangent"]')).toBeChecked()
  await expect(dialog.locator('[data-snap-mode="insertion"]')).toBeChecked()
  await expect(dialog.locator('[data-snap-mode="endpoint"]')).not.toBeChecked()
  await expect.poll(state).toEqual({ documentId: 'snap-settings-second', revision: 1, modes: ['tangent', 'insertion'], aperture: 5 })
})
