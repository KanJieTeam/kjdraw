import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

test.use({ bypassCSP: true })
test('imported custom pattern paints dashes and dots, clips holes and survives editor save/reopen', async ({ page }, testInfo) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK, createKJDrawEditor } = await import('/packages/kjdraw-sdk/src/index.js')
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const { createDrawingContext } = await import('/packages/kjdraw-sdk/src/drawing-context.js')
    const sdk = createKJDrawSDK(), doc = sdk.createDocument()
    await doc.transact('original pattern', tx => tx.createEntity('HATCH', {
      trueColor: 0, solid: false, patternName: 'ORIGINAL_DASH_DOT', patternScale: 1, patternAngle: 0,
      patternLines: [{ angle: 0, base: [1, 0], offset: [2, 4], dashes: [2, -2, 0, -2] }],
      boundaryLoops: [{ edges: [{ type: 'LINE', start: [0, 0], end: [24, 0] }, { type: 'LINE', start: [24, 0], end: [24, 24] }, { type: 'LINE', start: [24, 24], end: [0, 24] }, { type: 'LINE', start: [0, 24], end: [0, 0] }] }, { external: false, vertices: [[8, 8], [16, 8], [16, 16], [8, 16]] }],
    }))
    const dxf = await sdk.writeDocument(doc, { format: 'DXF', version: '2018' })
    document.body.replaceChildren()
    const host = document.createElement('div'); host.style.cssText = 'width:1000px;height:650px'; document.body.append(host)
    const editor = createKJDrawEditor(host, { document: 'blank', theme: 'light' }); await editor.ready
    await editor.open(new File([dxf], 'original-pattern.dxf'))
    const entity = editor.document.listEntities()[0]
    await editor.execute('MOVE', { id: entity.id, dx: 4, dy: 0 }); await editor.undo(); await editor.redo()
    await editor.open(new File([await editor.save({ format: 'DXF', download: false })], 'saved-pattern.dxf'))
    const canvas = document.createElement('canvas'); canvas.id = 'pattern-pixels'; canvas.style.cssText = 'width:480px;height:480px'; document.body.append(canvas)
    const renderer = new KJCanvasRenderer(canvas, { document: editor.document, background: '#ffffff', grid: false, pixelRatio: 1 }).fit()
    const context = canvas.getContext('2d')
    const ink = (point, radius = 2) => {
      const [x, y] = renderer.worldToScreen(point), bytes = context.getImageData(Math.round(x) - radius, Math.round(y) - radius, radius * 2 + 1, radius * 2 + 1).data
      let count = 0; for (let i = 0; i < bytes.length; i += 4) if (bytes[i] < 160 && bytes[i + 1] < 160 && bytes[i + 2] < 160) count++
      return count
    }
    // Row y=4 has base x=7 after the move. Row y=12 crosses the inner hole.
    const pixels = { dash: ink([8, 4]), gap: ink([10, 4]), dot: ink([11, 4]), hole: ink([14, 12]), outside: ink([3, 4]) }
    const regionMatches = [[7, 3, 9, 5], [13, 11, 15, 13], [0, 0, 1, 1]].map(bounds => createDrawingContext(editor.document, { types: ['HATCH'], bounds, maxLayers: 0 }).entities.map(e => e.spatialMatch))
    const hit = renderer.selectBox(renderer.worldToScreen([4, 1]), renderer.worldToScreen([11, 7]), { mode: 'crossing' })
    renderer.panBy(13, -17); renderer.zoomAt(1.4)
    const afterNavigation = { dash: ink([8, 4]), dot: ink([11, 4]), hole: ink([14, 12]) }
    const current = editor.document.listEntities()[0], first = current.payload.boundaryLoops[0].edges[0].start
    await editor.document.transact('reuse as a rotated block', tx => {
      const block = tx.upsertTableRecord('blockRecords', { name: 'Original pattern part', type: 'BLOCK_RECORD', payload: { entityIds: [], basePoint: [0, 0, 0] } })
      tx.reparentObject(current.id, block.id)
      tx.createEntity('INSERT', { blockRecordId: block.id, position: [32, 24], scale: [2, 2, 2], rotation: Math.PI / 2 })
    })
    renderer.fit()
    const blockPixels = { dash: ink([24, 40]), dot: ink([24, 46]), hole: ink([8, 52]) }
    return { pixels, regionMatches, afterNavigation, blockPixels, report: renderer.report, selected: hit.length, first }
  })
  expect(result.pixels.dash).toBeGreaterThan(0); expect(result.pixels.dot).toBeGreaterThan(0)
  expect(result.pixels.gap).toBe(0); expect(result.pixels.hole).toBe(0); expect(result.pixels.outside).toBe(0)
  expect(result.regionMatches).toEqual([['intersects'], [], []])
  expect(result.afterNavigation.dash).toBeGreaterThan(0); expect(result.afterNavigation.dot).toBeGreaterThan(0); expect(result.afterNavigation.hole).toBe(0)
  expect(result.blockPixels.dash).toBeGreaterThan(0); expect(result.blockPixels.dot).toBeGreaterThan(0); expect(result.blockPixels.hole).toBe(0)
  expect(result.report.unsupported).toBe(0); expect(result.report.hatchDiagnostics).toEqual([])
  expect(result.selected).toBe(1); expect(result.first).toEqual([4, 0, 0])
  await mkdir('.cache/hatch-acceptance', { recursive: true })
  await page.locator('#pattern-pixels').screenshot({ path: `.cache/hatch-acceptance/${testInfo.project.name}-dash-dot-holes.png` })
})

test('dense patterns and unsupported curve boundaries report their limitations', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/index.js')
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const sdk = createKJDrawSDK(), doc = sdk.createDocument()
    await doc.transact('dense pattern', tx => tx.createEntity('HATCH', { patternName: 'DENSE', solid: false, patternLines: [{ angle: 0, base: [0, 0], offset: [0, .000001], dashes: [] }], boundaryLoops: [{ vertices: [[0, 0], [20, 0], [20, 20], [0, 20]] }] }))
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:400px;height:300px'; document.body.replaceChildren(canvas)
    const renderer = new KJCanvasRenderer(canvas, { document: doc, grid: false }).fit()
    const dense = renderer.report.hatchDiagnostics
    const entity = doc.listEntities()[0]
    await doc.transact('unsupported boundary', tx => tx.updateObject(entity.id, { payload: { boundaryLoops: [{ edges: [{ type: 'ELLIPSE', rawTags: [] }] }] } }))
    return { dense: dense.map(d => d.reason), unsupported: renderer.report.hatchDiagnostics.map(d => d.reason), count: renderer.report.unsupported }
  })
  expect(result).toEqual({ dense: ['budget'], unsupported: ['unsupported-boundary'], count: 1 })
})
