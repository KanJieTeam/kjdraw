import { test, expect } from '@playwright/test'

test('distant construction lines remain visible and selectable after pan, zoom and DXF reopening', async ({ page }) => {
  await page.goto('/')
  const checks = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/index.js')
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const sdk = createKJDrawSDK(), source = sdk.createDocument()
    await source.transact('distant origin', tx => {
      tx.createEntity('XLINE', { origin: [1000000, 0], direction: [1,0], trueColor: 0 })
      tx.createEntity('RAY', { origin: [-1000000, 40], direction: [1,0], trueColor: 0 })
    })
    const drawing = await createKJDrawSDK().readDocument(await sdk.writeDocument(source, { format: 'DXF' }), { format: 'DXF' })
    const original = drawing.serialize(), output = []
    for (const dpr of [1,2]) {
      const canvas = document.createElement('canvas'); document.body.replaceChildren(canvas)
      const renderer = new KJCanvasRenderer(canvas, { document: drawing, background: '#ffffff', grid: false, pixelRatio: dpr })
      renderer.resize(640,360)
      Object.assign(renderer.camera, { centerX: 0, centerY: 0, scale: 1 })
      renderer.render()
      const ink = world => {
        const p = renderer.worldToScreen(world), x = Math.round(p[0]*dpr), y = Math.round(p[1]*dpr)
        if (x<2 || y<2 || x>=canvas.width-2 || y>=canvas.height-2) throw new Error('Invalid pixel sample')
        const pixels = canvas.getContext('2d').getImageData(x-2,y-2,5,5).data
        // A one-pixel black stroke between device pixels blends with white at DPR 1.
        return Array.from({length:25},(_,i)=>i*4).some(i=>pixels[i+3]===255&&pixels[i]<200&&pixels[i+1]<200&&pixels[i+2]<200)
      }
      const initial = [-300,0,300].every(x=>ink([x,0])) && ink([0,40])
      renderer.panBy(100,-20); renderer.zoomAt(1.5)
      const navigated = ink([0,0]) && ink([0,40])
      const hit = renderer.hitTest(renderer.worldToScreen([0,0]),3)?.entity.type
      output.push({ dpr, initial, navigated, hit, unchanged: original===drawing.serialize() })
      renderer.dispose()
    }
    return output
  })
  expect(checks).toEqual([1,2].map(dpr=>({dpr,initial:true,navigated:true,hit:'XLINE',unchanged:true})))
})
