import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('a 0.3 m real-world thin-layer shape remains legible on the declared long sheet', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [{ createKJDrawSDK }, { KJAgentToolSession }, { KJCanvasRenderer }, { exportDrawingPng }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'),
      import('/packages/kjdraw-sdk/src/agent-tools.js'),
      import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
      import('/packages/kjdraw-sdk/src/drawing-image.js'),
    ])
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ units: 'millimeter' })
    const session = new KJAgentToolSession(sdk, drawing)
    const boundaries = [1.5, 10.4, 20.1, 20.4, 29.8, 37.8, 40.3]
    const names = ['素填土', '粉质黏土', '中砂', '细砂薄层', '中砂', '圆砾', '粉质黏土']
    const lithologies = ['fill', 'silty-clay', 'sand', 'sand', 'sand', 'gravel', 'silty-clay']
    const proposed = await session.call('cad_propose_geology_column', {
      version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN',
      pageHeightMillimeters: 500,
      hole: {
        id: 'ZK-THIN', collarElevation: 105.25, depth: 40.3,
        strata: boundaries.map((bottom, index) => ({
          intervalId: 'ZK-THIN-' + (index + 1), code: String(index + 1),
          name: names[index], lithology: lithologies[index],
          top: index ? boundaries[index - 1] : 0, bottom,
        })),
      },
    })
    if (!proposed.ok) throw new Error(proposed.error.message)
    const approved = await session.approve(proposed.value.planId, 'long-sheet-browser-review')
    if (!approved.ok) throw new Error(approved.error.message)
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width:620px;height:2100px'
    document.body.append(canvas)
    const renderer = new KJCanvasRenderer(canvas, { document: drawing, theme: 'light', grid: false, pixelRatio: 1, padding: 20 })
    renderer.resize(620, 2100).fit()
    const report = renderer.render()
    const entities = drawing.listEntities()
    const labels = entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
    const layoutId = drawing.snapshot().spaces.activeLayoutId
    await sdk.executeCommand('PAGESETUP', { layoutId, dxf: {
      paperWidth: 210, paperHeight: 500, paperUnits: 1, rotation: 0, plotType: 4, flags: 0,
      scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
      windowMinX: 0, windowMinY: 0, windowMaxX: 210, windowMaxY: 500,
    } }, { document: drawing })
    const png = await exportDrawingPng(drawing, { layoutId, maxEdge: 1600, theme: 'light' })
    return {
      rendered: report.rendered,
      unsupported: report.unsupported,
      hatchDiagnostics: report.hatchDiagnostics,
      entityCount: entities.length,
      hatchCount: entities.filter(entity => entity.type === 'HATCH').length,
      hasThinName: labels.includes('细砂薄层'),
      hasHole: labels.includes('ZK-THIN'),
      scale: proposed.value.engineeringEvidence.parameters.verticalScaleDenominator,
      pngUnsupported: png.renderReport.unsupported,
      pngWidth: png.pixelWidth,
      pngHeight: png.pixelHeight,
      pngDataUrl: png.dataUrl,
    }
  })
  expect(result.unsupported).toBe(0)
  expect(result.hatchDiagnostics).toEqual([])
  expect(result.rendered).toBe(result.entityCount)
  expect(result.hatchCount).toBe(7)
  expect(result.hasThinName).toBe(true)
  expect(result.hasHole).toBe(true)
  expect(result.scale).toBe(100)
  expect(result.pngUnsupported).toBe(0)
  expect(result.pngHeight).toBeGreaterThan(result.pngWidth * 2)
  await writeFile(test.info().outputPath('geology-long-sheet-export.png'), Buffer.from(result.pngDataUrl.split(',')[1], 'base64'))
  await page.screenshot({ path: test.info().outputPath('geology-long-sheet.png'), fullPage: true })
})
