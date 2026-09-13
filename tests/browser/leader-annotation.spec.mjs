import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, KJProjectSession } from '../../packages/kjdraw-sdk/src/index.js'

test.use({ bypassCSP: true, viewport: { width: 1360, height: 860 } })

test('workbench creates ghosted native leaders and edits the owned annotation', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren(); const host = document.createElement('div'); host.id = 'leader-ui'; host.style.cssText = 'width:1320px;height:820px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }, { KJCanvasRenderer }] = await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js'), import('/packages/kjdraw-sdk/src/canvas-renderer.js')])
    const original = KJCanvasRenderer.prototype.drawPreview; window.__leaderPreviews = []
    KJCanvasRenderer.prototype.drawPreview = function (entities, ...args) { window.__leaderPreviews.push(...entities.map(entity => ({ type: entity.type, text: entity.payload.text }))); return original.call(this, entities, ...args) }
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'workbench-leader', units: 'millimeter' })
    const style = await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'LEADER-CJK', properties: { fontFamily: 'Noto Sans CJK SC' } }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, showInspector: true, grid: false }); await workbench.ready
    window.__leaderUI = { sdk, drawing, workbench, style }
  })
  const root = page.locator('#leader-ui'), dialog = root.locator('[data-draft-dialog]')
  const startRevision = await page.evaluate(() => window.__leaderUI.drawing.revision)
  await root.locator('[data-action="draft"]').click(); await dialog.locator('[data-draft-tool]').selectOption('leader'); await expect(dialog).toBeVisible()
  await dialog.locator('[data-draft-option="leaderText"]').fill('泵出口压力表 PI-101\n设计压力 1.6 MPa')
  await dialog.locator('[data-draft-option="styleId"]').selectOption({ label: 'LEADER-CJK' })
  await dialog.locator('[data-draft-option="textHeight"]').fill('4')
  await dialog.locator('[data-draft-option="leaderWidth"]').fill('28')
  await dialog.locator('[data-draft-option="leaderRotationDegrees"]').fill('15')
  await dialog.locator('[data-draft-option="leaderAttachmentPoint"]').selectOption('5')
  await dialog.locator('[data-draft-option="arrowEnabled"]').uncheck()
  await dialog.locator('[data-action="cancel-draft"]').click(); await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.__leaderUI.drawing.revision)).toBe(startRevision)

  await root.locator('[data-action="draft"]').click(); await dialog.locator('[data-draft-tool]').selectOption('leader'); await dialog.locator('[data-draft-option="leaderText"]').fill('泵出口压力表 PI-101\n设计压力 1.6 MPa')
  await dialog.locator('[data-draft-option="styleId"]').selectOption({ label: 'LEADER-CJK' }); await dialog.locator('[data-draft-option="textHeight"]').fill('4'); await dialog.locator('[data-draft-option="leaderWidth"]').fill('28'); await dialog.locator('[data-draft-option="leaderRotationDegrees"]').fill('15'); await dialog.locator('[data-draft-option="leaderAttachmentPoint"]').selectOption('5'); await dialog.locator('[data-action="start-draft"]').click()
  const command = root.locator('[data-command]')
  for (const point of ['0,0', '15,10', '35,10']) { await command.fill(point); await command.press('Enter') }
  await expect.poll(() => page.evaluate(() => window.__leaderPreviews.some(item => item.type === 'LEADER' && item.text === '泵出口压力表 PI-101\n设计压力 1.6 MPa'))).toBe(true)
  await command.fill(''); await command.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__leaderUI.drawing.listEntities().length)).toBe(2)
  const ids = await page.evaluate(() => { const leader = window.__leaderUI.drawing.listEntities({ type: 'LEADER' })[0], note = window.__leaderUI.drawing.getObject(leader.payload.annotationId); return { leader: leader.id, note: note.id } })
  await page.evaluate(async id => { const { sdk, drawing } = window.__leaderUI; await sdk.executeCommand('SELECT', { ids: [id], operation: 'replace' }, { document: drawing }) }, ids.leader)
  const inspector = root.locator('[data-inspector]')
  await expect(inspector.locator('[data-property="leader-text"]')).toHaveValue('泵出口压力表 PI-101\n设计压力 1.6 MPa')
  await inspector.locator('[data-property="leader-text"]').fill('泵出口压力表 PI-102\n校准')
  await inspector.locator('[data-property="leader-height"]').fill('5'); await inspector.locator('[data-property="leader-arrow"]').uncheck()
  const beforeEdit = await page.evaluate(() => window.__leaderUI.drawing.revision); await inspector.locator('button.apply').click()
  await expect.poll(() => page.evaluate(() => window.__leaderUI.drawing.revision)).toBe(beforeEdit + 1)
  expect(await page.evaluate(ids => ({ leader: window.__leaderUI.drawing.getObject(ids.leader).payload, note: window.__leaderUI.drawing.getObject(ids.note).payload }), ids)).toMatchObject({ leader: { annotationId: ids.note, arrowEnabled: false }, note: { text: '泵出口压力表 PI-102\n校准', height: 5 } })
  await root.locator('[data-action="undo"]').click(); await expect.poll(() => page.evaluate(id => window.__leaderUI.drawing.getObject(id).payload.text, ids.note)).toBe('泵出口压力表 PI-101\n设计压力 1.6 MPa')
  await root.locator('[data-action="redo"]').click(); await expect.poll(() => page.evaluate(id => window.__leaderUI.drawing.getObject(id).payload.text, ids.note)).toContain('PI-102')
})

test('playground exposes real leader controls and saves the native pair', async ({ page }) => {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'playground-leader', units: 'millimeter' })
  await sdk.executeCommand('TEXTSTYLE', { operation: 'create', name: 'NOTES', properties: { fontFamily: 'Arial' }, current: true }, { document: drawing })
  await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  await page.locator('#file-input').setInputFiles({ name: 'leader.kjd', mimeType: 'application/json', buffer: Buffer.from(await sdk.writeDocument(drawing, { format: 'KJD' })) })
  await page.locator('.ribbon-tabs [data-i18n="draw"]').click(); await page.locator('[data-tool="leader"]').click()
  await expect(page.locator('#leader-text')).toBeVisible(); await page.locator('#leader-text').fill('设备检修空间')
  await page.locator('#leader-style').selectOption({ label: 'NOTES' }); await page.locator('#leader-height').fill('4'); await page.locator('#leader-width').fill('30'); await page.locator('#leader-rotation').fill('-10'); await page.locator('#leader-attachment').selectOption('3'); await page.locator('#leader-arrow').check()
  const canvas = page.locator('#canvas'), box = await canvas.boundingBox()
  for (const point of [{ x: box.width * .35, y: box.height * .65 }, { x: box.width * .45, y: box.height * .5 }, { x: box.width * .6, y: box.height * .5 }]) await canvas.click({ position: point })
  await expect(page.locator('#finish-draft')).toBeEnabled(); await page.locator('#finish-draft').click(); await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  await page.locator('.ribbon-tabs [data-i18n="home"]').click()
  const pending = page.waitForEvent('download'); await page.locator('#save').click(); const download = await pending
  const session = await KJProjectSession.open(await readFile(await download.path()), { sdk: createKJDrawSDK() }), leader = session.activeDocument.listEntities({ type: 'LEADER' })[0], note = session.activeDocument.getObject(leader.payload.annotationId)
  expect(leader.payload).toMatchObject({ arrowEnabled: true, ownsAnnotation: true }); expect(leader.payload.vertices).toHaveLength(3)
  expect(note).toMatchObject({ type: 'MTEXT', payload: { text: '设备检修空间', height: 4, width: 30, attachmentPoint: 3 } }); expect(note.payload.rotation).toBeCloseTo(-Math.PI / 18, 12); expect(session.activeDocument.getObject(note.payload.styleId).name).toBe('NOTES')
  session.destroy()
})
