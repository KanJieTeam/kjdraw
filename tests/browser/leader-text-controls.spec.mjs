import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true, viewport: { width: 1360, height: 860 } })

test('workbench edits leader annotation width, rotation and attachment through the real inspector', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    document.body.replaceChildren(); const host = document.createElement('div'); host.id = 'leader-controls'; host.style.cssText = 'width:1320px;height:820px'; document.body.append(host)
    const [{ createKJDrawSDK }, { mountKJDrawWorkbench }] = await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'leader-control-ui', units: 'millimeter' })
    const pair = await sdk.executeCommand('LEADER', { vertices: [[0, 0], [30, 20], [50, 20]], textPosition: [52, 20], text: 'P-101', textHeight: 3 }, { document: drawing })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, showInspector: true, grid: false }); await workbench.ready
    await sdk.executeCommand('SELECT', { ids: [pair.leader.id], operation: 'replace' }, { document: drawing })
    window.__leaderControls = { sdk, drawing, workbench, leaderId: pair.leader.id, noteId: pair.annotation.id, leaderHandle: pair.leader.handle, noteHandle: pair.annotation.handle }
  })
  const root = page.locator('#leader-controls'), inspector = root.locator('[data-inspector]')
  await expect(inspector.locator('[data-property="leader-width"]')).toBeVisible()
  await inspector.locator('[data-property="leader-text"]').fill('泵出口 P-102\n检修空间 800 mm')
  await inspector.locator('[data-property="leader-height"]').fill('4')
  await inspector.locator('[data-property="leader-width"]').fill('24')
  await inspector.locator('[data-property="leader-rotation"]').fill('30')
  await inspector.locator('[data-property="leader-attachment"]').selectOption('5')
  await inspector.locator('[data-property="leader-arrow"]').uncheck()
  const revision = await page.evaluate(() => window.__leaderControls.drawing.revision)
  await inspector.locator('button.apply').click()
  await expect.poll(() => page.evaluate(() => window.__leaderControls.drawing.revision)).toBe(revision + 1)
  const edited = await page.evaluate(async () => {
    const state = window.__leaderControls, leader = state.drawing.getObject(state.leaderId), note = state.drawing.getObject(state.noteId)
    const bytes = await state.workbench.save('KJD', { download: false }), reopened = await (await import('/packages/kjdraw-sdk/src/sdk.js')).createKJDrawSDK().readDocument(bytes, { format: 'KJD' })
    return { leader: { handle: leader.handle, annotationId: leader.payload.annotationId, arrow: leader.payload.arrowEnabled }, note: { handle: note.handle, text: note.payload.text, height: note.payload.height, width: note.payload.width, rotation: note.payload.rotation, attachment: note.payload.attachmentPoint }, reopened: reopened.getObject(state.noteId).payload }
  })
  expect(edited.leader).toEqual({ handle: await page.evaluate(() => window.__leaderControls.leaderHandle), annotationId: await page.evaluate(() => window.__leaderControls.noteId), arrow: false })
  expect(edited.note).toMatchObject({ handle: await page.evaluate(() => window.__leaderControls.noteHandle), text: '泵出口 P-102\n检修空间 800 mm', height: 4, width: 24, attachment: 5 })
  expect(edited.note.rotation).toBeCloseTo(Math.PI / 6, 12); expect(edited.reopened).toMatchObject({ text: edited.note.text, width: 24, attachmentPoint: 5 })
  await root.locator('[data-action="undo"]').click(); await expect.poll(() => page.evaluate(() => window.__leaderControls.drawing.getObject(window.__leaderControls.noteId).payload.width)).toBeUndefined()
  await root.locator('[data-action="redo"]').click(); await expect.poll(() => page.evaluate(() => window.__leaderControls.drawing.getObject(window.__leaderControls.noteId).payload.width)).toBe(24)
})
