import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test('paper-space preview fits the physical sheet, shows margins and preserves dark-theme line contrast', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  const layoutId = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { mountKJDrawWorkbench } = await import('/packages/kjdraw-sdk/src/workbench.js')
    document.body.replaceChildren(); document.body.style.margin = '0'
    const host = document.createElement('div'); host.style.cssText = 'width:1240px;height:840px'; document.body.append(host)
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ documentId:'paper-sheet-preview', units:'millimeter' })
    const layout = await sdk.executeCommand('LAYOUT', { operation:'create', name:'A3 review sheet' })
    await sdk.executeCommand('PAGESETUP', { layoutId:layout.id, dxf:{
      paperWidth:420, paperHeight:297, paperUnits:1, rotation:0, plotType:5, flags:0,
      scaleNumerator:1, scaleDenominator:1, marginLeft:12, marginRight:18, marginTop:15, marginBottom:10,
    } })
    await drawing.transact('paper line', tx => tx.createEntity('LINE', { start:[30,30], end:[150,30] }, { ownerId:layout.payload.blockRecordId }))
    const workbench = mountKJDrawWorkbench(host, { sdk, document:drawing, locale:'en', theme:'dark', grid:true, showLayers:false, showInspector:false })
    await workbench.ready
    workbench.setDrawingLayout(layout.id)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize(); workbench.renderer.fit()
    window.paperSheetPreview = { sdk, drawing, workbench, layoutId:layout.id }
    return layout.id
  })

  const result = await page.evaluate(() => {
    const { workbench, drawing } = window.paperSheetPreview, canvas = workbench.root.querySelector('[data-canvas]')
    const context = canvas.getContext('2d'), ratio = canvas.width / canvas.getBoundingClientRect().width
    const rgba = point => {
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(point[0] * ratio)))
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(point[1] * ratio)))
      return [...context.getImageData(x, y, 1, 1).data]
    }
    const page0 = workbench.renderer.worldToScreen([0,0]), page1 = workbench.renderer.worldToScreen([420,297])
    const line = workbench.renderer.worldToScreen([80,30]), center = workbench.renderer.worldToScreen([210,148.5])
    const outside = [Math.max(2, Math.min(page0[0], page1[0]) - 24), center[1]]
    const source = drawing.serialize(), history = JSON.stringify(drawing.history)
    return {
      camera:{ ...workbench.renderer.camera }, page0, page1,
      paper:rgba(center), outside:rgba(outside),
      line:Math.min(...[-2,-1,0,1,2].map(offset => Math.max(...rgba([line[0],line[1]+offset]).slice(0,3)))),
      unchanged:drawing.serialize() === source && JSON.stringify(drawing.history) === history,
      image:canvas.toDataURL('image/png'),
    }
  })
  expect(result.camera.centerX).toBeCloseTo(210, 10); expect(result.camera.centerY).toBeCloseTo(148.5, 10)
  expect(Math.min(result.page0[0], result.page1[0])).toBeGreaterThan(60)
  expect(Math.max(result.page0[0], result.page1[0])).toBeLessThan(1180)
  expect(result.paper[0]).toBeGreaterThan(245); expect(result.paper[1]).toBeGreaterThan(245); expect(result.paper[2]).toBeGreaterThan(240)
  expect(result.outside[0]).toBeLessThan(40); expect(result.outside[1]).toBeLessThan(50)
  expect(result.line).toBeLessThan(160)
  expect(result.unchanged).toBe(true)

  const rotated = await page.evaluate(async layoutId => {
    const { sdk, workbench } = window.paperSheetPreview
    await sdk.executeCommand('PAGESETUP', { layoutId, dxf:{ rotation:1 } })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { camera:{ ...workbench.renderer.camera }, lower:workbench.renderer.worldToScreen([0,0]), upper:workbench.renderer.worldToScreen([297,420]) }
  }, layoutId)
  expect(rotated.camera.centerX).toBeCloseTo(148.5, 10); expect(rotated.camera.centerY).toBeCloseTo(210, 10)
  expect(Math.abs(rotated.upper[1] - rotated.lower[1])).toBeGreaterThan(Math.abs(rotated.upper[0] - rotated.lower[0]))

  await mkdir('.cache/paper-sheet-preview', { recursive:true })
  const image = Buffer.from(result.image.split(',')[1], 'base64')
  await writeFile('.cache/paper-sheet-preview/a3-dark-workbench.png', image)
  await testInfo.attach('a3-paper-preview', { body:image, contentType:'image/png' })
})
