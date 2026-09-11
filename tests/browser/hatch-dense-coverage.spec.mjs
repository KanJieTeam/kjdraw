import { test, expect } from '@playwright/test'

for (const ratio of [1, 2]) test(`dense HATCH preserves dash gaps, holes, opacity and cache at DPR ${ratio}`, async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const result = await page.evaluate(async pixelRatio => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument()
    await drawing.transact('original dense hatch', tx => tx.createEntity('HATCH', {
      solid: false, patternName: 'ORIGINAL', trueColor: 0, transparency: .5,
      boundaryLoops: [{ vertices: [[0,0], [24,0], [24,16], [0,16]] }, { vertices: [[8,4], [16,4], [16,12], [8,12]] }],
      patternLines: [{ angle: 0, base: [.173,.219], offset: [8,1/65536], dashes: [3,-5] }],
    }, { id: 'dense' }))
    const before = drawing.serialize(), canvas = document.createElement('canvas')
    canvas.style.cssText = 'width:200px;height:140px'; document.body.append(canvas)
    const renderer = new KJCanvasRenderer(canvas, { pixelRatio, grid: false, background: '#ffffff' })
    renderer.resize(200,140)
    Object.assign(renderer.camera, { centerX: 12, centerY: 8, scale: 6 })
    const context = canvas.getContext('2d'), read = world => {
      const point = renderer.worldToScreen(world)
      return Array.from(context.getImageData(Math.floor(point[0] * pixelRatio), Math.floor(point[1] * pixelRatio), 1, 1).data)
    }
    const inspect = () => ({ ink: read([1.173,2]), gap: read([5.173,2]), hole: read([9.173,8]), outside: read([-1,2]), diagnostics: renderer.report.hatchDiagnostics })
    let start = performance.now(); renderer.setDocument(drawing); const firstMs = performance.now() - start
    const initial = inspect()
    start = performance.now(); for (let frame = 0; frame < 10; frame++) renderer.render(); const cachedMs = (performance.now() - start) / 10
    renderer.panBy(7,-4); renderer.zoomAt(1.25)
    const moved = inspect()
    const unchanged = drawing.serialize() === before
    renderer.dispose(); canvas.remove()
    return { initial, moved, firstMs, cachedMs, unchanged }
  }, ratio)
  for (const state of [result.initial, result.moved]) {
    expect(state.diagnostics).toEqual([])
    expect(state.ink[0]).toBeGreaterThanOrEqual(126)
    expect(state.ink[0]).toBeLessThanOrEqual(129)
    expect(state.ink[3]).toBe(255)
    expect(state.gap).toEqual([255,255,255,255])
    expect(state.hole).toEqual([255,255,255,255])
    expect(state.outside).toEqual([255,255,255,255])
  }
  expect(result.unchanged).toBe(true)
  console.log(JSON.stringify({ denseHatchDpr: ratio, firstMs: result.firstMs, cachedMs: result.cachedMs }))
  await testInfo.attach('dense-hatch-timing', { body: JSON.stringify(result), contentType: 'application/json' })
})

test('nested HATCH instances keep their own phase after movement and reuse cached masks', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument(), Native = globalThis.OffscreenCanvas
    let masks = 0
    globalThis.OffscreenCanvas = class extends Native { constructor(...args) { super(...args); masks++ } }
    try {
      const hatch = await sdk.executeCommand('CREATE', { type: 'HATCH', payload: {
        solid: false, trueColor: 0, patternName: 'ORIGINAL', transparency: .5,
        boundaryLoops: [{ vertices: [[0,0], [16,0], [16,8], [0,8]] }],
        patternLines: [{ angle: 0, base: [.173,.219], offset: [8,1/65536], dashes: [3,-5] }],
      } })
      const inner = await sdk.executeCommand('BLOCKCREATE', { name: 'detail', id: hatch.id, basePoint: [0,0] })
      const outer = await sdk.executeCommand('BLOCKCREATE', { name: 'assembly', id: inner.insert.id, basePoint: [0,0] })
      await drawing.transact('another instance', tx => tx.createEntity('INSERT', { ...drawing.getObject(outer.insert.id).payload, position: [20,0,0] }))
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:200px;height:120px'; document.body.append(canvas)
      const renderer = new KJCanvasRenderer(canvas, { pixelRatio: 1, grid: false, background: '#ffffff' })
      renderer.resize(200,120); Object.assign(renderer.camera, { centerX: 20, centerY: 6, scale: 4 }); renderer.setDocument(drawing)
      const read = point => { const [x,y] = renderer.worldToScreen(point); return canvas.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data[0] }
      const before = [read([1.173,2]),read([21.173,2])], initialMasks = masks
      for (let frame = 0; frame < 10; frame++) renderer.render()
      const stationaryMasks = masks
      await sdk.executeCommand('MOVE', { id: outer.insert.id, dx: 4, dy: 0 })
      const moved = [read([1.173,2]),read([5.173,2]),read([21.173,2])]
      const diagnostics = renderer.report.hatchDiagnostics
      renderer.dispose(); canvas.remove()
      return { before, initialMasks, stationaryMasks, moved, diagnostics }
    } finally { globalThis.OffscreenCanvas = Native }
  })
  // Half-opacity black over white differs by one 8-bit step across raster backends.
  for(const shade of [...result.before,...result.moved.slice(1)]){expect(shade).toBeGreaterThanOrEqual(126);expect(shade).toBeLessThanOrEqual(128)}
  expect(result.before[0]).toBe(result.before[1])
  expect(result.initialMasks).toBe(2)
  expect(result.stationaryMasks).toBe(2)
  expect(result.moved[0]).toBe(255)
  expect(result.moved.slice(1)).toEqual(result.before)
  expect(result.diagnostics).toEqual([])
})
