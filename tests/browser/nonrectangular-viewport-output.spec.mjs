import { test, expect } from '@playwright/test'

test('PNG uses the editable L-shaped paper-space viewport clip', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { exportDrawingPng } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' }), model = drawing.spaces.modelSpaceId
    let layout
    await drawing.transact('L-shaped viewport', tx => {
      tx.createEntity('LINE', { start: [-30, 10, 0], end: [30, 10, 0], trueColor: 0x0000ff }, { ownerId: model })
      tx.createEntity('LINE', { start: [-30, -10, 0], end: [30, -10, 0], trueColor: 0x00aa00 }, { ownerId: model })
      layout = tx.createLayout({ name: 'L detail sheet' })
      const boundary = tx.createEntity('LWPOLYLINE', { vertices: [[30, 30, 0], [70, 30, 0], [70, 45, 0], [50, 45, 0], [50, 70, 0], [30, 70, 0]], closed: true, visible: false }, { ownerId: layout.payload.blockRecordId })
      const viewport = tx.createEntity('VIEWPORT', { center: [50, 50, 0], width: 40, height: 40, viewCenter: [0, 0, 0], viewHeight: 40, viewTarget: [0, 0, 0], viewDirection: [0, 0, 1], flags: 65536, clippingBoundaryId: boundary.id }, { ownerId: layout.payload.blockRecordId })
      tx.updateObject(layout.id, { payload: { viewportIds: [viewport.id] } })
    })
    await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 100, paperHeight: 100, paperUnits: 1, plotType: 5, flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, originX: 0, originY: 0, printerName: '', styleSheet: '', shadeMode: 0 } }, { document: drawing })
    const png = await exportDrawingPng(drawing, { layoutId: layout.id, maxEdge: 400, theme: 'light' })
    const image = new Image(); image.src = png.dataUrl; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, 400, 400).data
    const counts = { blueLeft: 0, blueRight: 0, greenLeft: 0, greenRight: 0 }
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2], x = index / 4 % 400, y = Math.floor(index / 4 / 400)
      if (y < 150 || y > 250) continue
      if (b > 160 && b > r + 60 && b > g + 60) counts[x < 200 ? 'blueLeft' : 'blueRight']++
      if (g > 80 && g > r + 40 && g > b + 20) counts[x < 200 ? 'greenLeft' : 'greenRight']++
    }
    return { counts, diagnostics: png.renderReport.viewportDiagnostics, unsupported: png.renderReport.unsupported }
  })
  expect(result.counts.blueLeft).toBeGreaterThan(40)
  expect(result.counts.blueRight).toBeLessThan(5)
  expect(result.counts.greenLeft).toBeGreaterThan(40)
  expect(result.counts.greenRight).toBeGreaterThan(40)
  expect(result.unsupported).toBe(0)
  expect(result.diagnostics[0]).toMatchObject({ rendered: 2, unsupported: 0 })
})

test('PNG uses the native circular viewport clip without a rectangular leak', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { exportDrawingPng } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' }), model = drawing.spaces.modelSpaceId
    let layout
    await drawing.transact('circular viewport', tx => {
      tx.createEntity('LINE', { start: [-30, 0, 0], end: [30, 0, 0], trueColor: 0x0000ff }, { ownerId: model })
      tx.createEntity('LINE', { start: [-30, 14, 0], end: [30, 14, 0], trueColor: 0x00aa00 }, { ownerId: model })
      layout = tx.createLayout({ name: 'Circular detail' })
      const boundary = tx.createEntity('CIRCLE', { center: [50, 50, 0], radius: 15, visible: false }, { ownerId: layout.payload.blockRecordId })
      const viewport = tx.createEntity('VIEWPORT', { center: [50, 50, 0], width: 30, height: 30, viewCenter: [0, 0, 0], viewHeight: 30, viewTarget: [0, 0, 0], viewDirection: [0, 0, 1], flags: 65536, clippingBoundaryId: boundary.id }, { ownerId: layout.payload.blockRecordId })
      tx.updateObject(layout.id, { payload: { viewportIds: [viewport.id] } })
    })
    await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 100, paperHeight: 100, paperUnits: 1, plotType: 5, flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, originX: 0, originY: 0, printerName: '', styleSheet: '', shadeMode: 0 } }, { document: drawing })
    const png = await exportDrawingPng(drawing, { layoutId: layout.id, maxEdge: 400, theme: 'light' })
    const image = new Image(); image.src = png.dataUrl; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, 400, 400).data
    const bounds = { blue: [400, -1], green: [400, -1] }
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2], x = index / 4 % 400
      if (b > 160 && b > r + 60 && b > g + 60) { bounds.blue[0] = Math.min(bounds.blue[0], x); bounds.blue[1] = Math.max(bounds.blue[1], x) }
      if (g > 80 && g > r + 40 && g > b + 20) { bounds.green[0] = Math.min(bounds.green[0], x); bounds.green[1] = Math.max(bounds.green[1], x) }
    }
    return { bounds, diagnostics: png.renderReport.viewportDiagnostics, unsupported: png.renderReport.unsupported }
  })
  expect(result.bounds.blue[0]).toBeGreaterThanOrEqual(138); expect(result.bounds.blue[1]).toBeLessThanOrEqual(262)
  expect(result.bounds.green[0]).toBeGreaterThanOrEqual(175); expect(result.bounds.green[1]).toBeLessThanOrEqual(225)
  expect(result.bounds.green[1] - result.bounds.green[0]).toBeLessThan(result.bounds.blue[1] - result.bounds.blue[0])
  expect(result.unsupported).toBe(0)
  expect(result.diagnostics[0]).toMatchObject({ rendered: 2, unsupported: 0 })
})

test('PNG uses a rotated native ellipse clip instead of its bounding rectangle', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { exportDrawingPng } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' }), model = drawing.spaces.modelSpaceId
    let layout
    await drawing.transact('rotated elliptical viewport', tx => {
      tx.createEntity('LINE', { start: [-30, 0, 0], end: [30, 0, 0], trueColor: 0x0000ff }, { ownerId: model })
      tx.createEntity('LINE', { start: [-30, 9, 0], end: [30, 9, 0], trueColor: 0x00aa00 }, { ownerId: model })
      layout = tx.createLayout({ name: 'Elliptical detail' })
      const angle = Math.PI / 6, boundary = tx.createEntity('ELLIPSE', { center: [50, 50, 0], majorAxis: [20 * Math.cos(angle), 20 * Math.sin(angle), 0], ratio: .5, startParameter: 0, endParameter: Math.PI * 2, visible: false }, { ownerId: layout.payload.blockRecordId })
      const viewport = tx.createEntity('VIEWPORT', { center: [50, 50, 0], width: 40, height: 20, viewCenter: [0, 0, 0], viewHeight: 20, viewTarget: [0, 0, 0], viewDirection: [0, 0, 1], flags: 65536, clippingBoundaryId: boundary.id }, { ownerId: layout.payload.blockRecordId })
      tx.updateObject(layout.id, { payload: { viewportIds: [viewport.id] } })
    })
    await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 100, paperHeight: 100, paperUnits: 1, plotType: 5, flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, originX: 0, originY: 0, printerName: '', styleSheet: '', shadeMode: 0 } }, { document: drawing })
    const png = await exportDrawingPng(drawing, { layoutId: layout.id, maxEdge: 400, theme: 'light' })
    const image = new Image(); image.src = png.dataUrl; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, 400, 400).data
    const counts = { blue: 0, green: 0 }, bounds = { blue: [400, -1], green: [400, -1] }
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2], x = index / 4 % 400
      if (b > 160 && b > r + 60 && b > g + 60) { counts.blue++; bounds.blue[0] = Math.min(bounds.blue[0], x); bounds.blue[1] = Math.max(bounds.blue[1], x) }
      if (g > 80 && g > r + 40 && g > b + 20) { counts.green++; bounds.green[0] = Math.min(bounds.green[0], x); bounds.green[1] = Math.max(bounds.green[1], x) }
    }
    return { counts, bounds, diagnostics: png.renderReport.viewportDiagnostics, unsupported: png.renderReport.unsupported }
  })
  expect(result.counts.blue).toBeGreaterThan(50); expect(result.counts.green).toBeGreaterThan(20)
  expect(result.bounds.blue[0]).toBeGreaterThanOrEqual(135); expect(result.bounds.blue[0]).toBeLessThanOrEqual(145)
  expect(result.bounds.blue[1]).toBeGreaterThanOrEqual(255); expect(result.bounds.blue[1]).toBeLessThanOrEqual(265)
  expect(result.bounds.green[0]).toBeGreaterThanOrEqual(178); expect(result.bounds.green[0]).toBeLessThanOrEqual(190)
  expect(result.bounds.green[1]).toBeGreaterThanOrEqual(266); expect(result.bounds.green[1]).toBeLessThanOrEqual(274)
  expect(result.bounds.green[1] - result.bounds.green[0]).toBeLessThan(result.bounds.blue[1] - result.bounds.blue[0])
  expect(result.unsupported).toBe(0)
  expect(result.diagnostics[0]).toMatchObject({ rendered: 2, unsupported: 0 })
})
