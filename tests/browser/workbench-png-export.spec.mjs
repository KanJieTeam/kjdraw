import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.use({ bypassCSP: true })

test('workbench exports the configured model window as a bounded real PNG without changing CAD state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  const expected = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { mountKJDrawWorkbench } = await import('/packages/kjdraw-sdk/src/workbench.js')
    document.body.replaceChildren(); document.body.style.margin = '0'
    const host = document.createElement('div'); host.style.cssText = 'width:1400px;height:900px'; document.body.append(host)
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId: 'configured-model-window', units: 'millimeter' })
    await drawing.transact('fabrication outline', tx => {
      tx.createEntity('LINE', { start:[10,10,0], end:[410,10,0], trueColor:0x0057ff })
      tx.createEntity('LINE', { start:[410,10,0], end:[410,287,0], trueColor:0x0057ff })
      tx.createEntity('CIRCLE', { center:[210,148.5,0], radius:60, trueColor:0xff3300 })
    })
    const layoutId = drawing.spaces.activeLayoutId
    await sdk.executeCommand('PAGESETUP', { layoutId, dxf:{ paperWidth:420, paperHeight:297, paperUnits:1, rotation:0, flags:0, plotType:4, scaleNumerator:1, scaleDenominator:1, marginLeft:0, marginRight:0, marginTop:0, marginBottom:0, originX:0, originY:0, printerName:'', styleSheet:'', shadeMode:0, windowMinX:0, windowMinY:0, windowMaxX:420, windowMaxY:297 } })
    const workbench = mountKJDrawWorkbench(host, { sdk, document:drawing, locale:'en', theme:'light', grid:false })
    await workbench.ready
    const source = drawing.serialize(), history = JSON.stringify(drawing.history), revision = drawing.revision
    const direct = await workbench.exportPng({ download:false, maxEdge:400 })
    window.pngWorkbench = { drawing, workbench, source, history, revision }
    return { layoutId, direct:{ layoutId:direct.layoutId, bounds:direct.bounds, pixelWidth:direct.pixelWidth, pixelHeight:direct.pixelHeight, mimeType:direct.mimeType, signature:direct.dataUrl.slice(0,22) } }
  })
  expect(expected.direct).toEqual({ layoutId:expected.layoutId, bounds:[0,0,420,297], pixelWidth:400, pixelHeight:283, mimeType:'image/png', signature:'data:image/png;base64,' })
  const root = page.locator('.kjwb')
  await expect(root.locator('[data-action="save-png"]')).toHaveAccessibleName('Export PNG')
  const pending = page.waitForEvent('download')
  await root.locator('[data-action="save-png"]').click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('configured-model-window.png')
  const bytes = await readFile(await download.path())
  expect(bytes.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]))
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1400,990])
  await expect(root.locator('[data-message]')).toContainText('1400 × 990 px · PNG')
  expect(await page.evaluate(() => {
    const { drawing, source, history, revision } = window.pngWorkbench
    return { source:drawing.serialize()===source, history:JSON.stringify(drawing.history)===history, revision:drawing.revision===revision }
  })).toEqual({ source:true, history:true, revision:true })
  await root.locator('[data-action="language"]').click()
  await expect(root.locator('[data-action="save-png"]')).toHaveAccessibleName('导出 PNG')
})
