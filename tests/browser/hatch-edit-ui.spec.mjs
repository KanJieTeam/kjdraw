import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'

const outer = [[0,0],[40,0],[40,30],[0,30]]
const island = [[5,5],[12,5],[12,12],[5,12]]

async function hatchFile() {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'hatch-ui', units: 'millimeter' })
  await drawing.transact('hatch fixture', tx => tx.createEntity('HATCH', { patternName: 'ANSI31', patternScale: 1, patternAngle: 0, boundaryLoops: [{ external: true, closed: true, vertices: outer }, { external: false, closed: true, vertices: island }] }, { id: 'hatch-ui' }))
  return Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' }))
}

test('Workbench edits the selected hatch and Cancel creates no history', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async ({ outer, island }) => {
    document.body.replaceChildren()
    const host = document.createElement('div'); host.id = 'hatch-host'; host.style.cssText = 'width:1100px;height:720px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'hatch-workbench-ui', units: 'millimeter' })
    await drawing.transact('fixture', tx => tx.createEntity('HATCH', { patternName: 'ANSI31', patternScale: 1, patternAngle: 0, boundaryLoops: [{ external: true, closed: true, vertices: outer }, { external: false, closed: true, vertices: island }] }, { id: 'hatch-ui' }))
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, locale: 'en' }); await workbench.ready
    await sdk.executeCommand('SELECT', { id: 'hatch-ui' }, { document: drawing })
    window.__hatchUI = { sdk, drawing, workbench }
  }, { outer, island })
  const revision = await page.evaluate(() => window.__hatchUI.drawing.revision)
  await page.locator('[data-inspector] [data-action="edit-hatch"]').click()
  await expect(page.locator('[data-hatch-edit-dialog]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-hatch-edit-dialog]')).toHaveCount(0)
  expect(await page.evaluate(() => window.__hatchUI.drawing.revision)).toBe(revision)

  await page.locator('[data-inspector] [data-action="edit-hatch"]').click()
  await page.locator('[data-hatch-operation]').selectOption('add-island')
  await page.locator('[data-hatch-vertices]').fill('22,8; 32,8; 32,18; 22,18')
  await page.locator('[data-hatch-scale]').fill('2')
  await page.locator('[data-hatch-angle]').fill('30')
  await page.locator('[data-hatch-apply]').click()
  await expect(page.locator('[data-hatch-edit-dialog]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const hatch = window.__hatchUI.drawing.getObject('hatch-ui')
    return [hatch.id, hatch.payload.boundaryLoops.length, hatch.payload.patternScale, Math.round(hatch.payload.patternAngle * 180 / Math.PI)]
  })).toEqual(['hatch-ui', 3, 2, 30])
  await page.evaluate(() => window.__hatchUI.sdk.executeCommand('UNDO', {}, { document: window.__hatchUI.drawing }))
  await expect.poll(() => page.evaluate(() => window.__hatchUI.drawing.getObject('hatch-ui').payload.boundaryLoops.length)).toBe(2)
  await page.evaluate(() => window.__hatchUI.sdk.executeCommand('REDO', {}, { document: window.__hatchUI.drawing }))
  await expect.poll(() => page.evaluate(() => window.__hatchUI.drawing.getObject('hatch-ui').payload.boundaryLoops.length)).toBe(3)

  await page.locator('[data-inspector] [data-action="edit-hatch"]').click()
  await page.locator('[data-hatch-operation]').selectOption('replace-island')
  await page.locator('[data-hatch-island]').selectOption('1')
  await page.locator('[data-hatch-vertices]').fill('6,6; 15,6; 15,14; 6,14')
  await page.locator('[data-hatch-apply]').click()
  await expect.poll(() => page.evaluate(() => window.__hatchUI.drawing.getObject('hatch-ui').payload.boundaryLoops[1].vertices[0].point.slice(0,2))).toEqual([6,6])
})

test('Playground exposes pattern and island editing for an opened drawing', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kjdraw.language', 'en'))
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'hatch-ui.kjd', mimeType: 'application/json', buffer: await hatchFile() })
  await expect(page.locator('#entity-count')).toHaveText('1 entities')
  await page.keyboard.press('Control+a')
  const revision = Number((await page.locator('#revision').textContent()).replace(/\D/g, ''))
  await page.locator('#inspector [data-action="edit-hatch"]').click()
  await page.locator('#dialog-fields [name=operation]').selectOption('remove-island')
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#dialog-fields [name=loopIndex]')).toBeVisible()
  await page.locator('#app-dialog button[value=cancel]').click()
  await expect(page.locator('#app-dialog')).not.toBeVisible()
  expect(Number((await page.locator('#revision').textContent()).replace(/\D/g, ''))).toBe(revision)

  await page.locator('#inspector [data-action="edit-hatch"]').click()
  await page.locator('#dialog-fields [name=operation]').selectOption('remove-island')
  await page.locator('#dialog-submit').click()
  await page.locator('#dialog-submit').click()
  await expect(page.locator('#status')).toContainText('HATCHEDIT committed')
  await expect.poll(async () => Number((await page.locator('#revision').textContent()).replace(/\D/g, ''))).toBe(revision + 1)
  await page.locator('#undo').click()
  await expect.poll(async () => Number((await page.locator('#revision').textContent()).replace(/\D/g, ''))).toBe(revision + 2)
})
