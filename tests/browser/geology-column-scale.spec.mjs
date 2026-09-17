import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('30 m Chinese geology column uses the real 1:150 scale slot and renders completely', async ({ page }, testInfo) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [{ createKJDrawSDK }, { KJAgentToolSession }, { KJCanvasRenderer }, { exportDrawingPng }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'),
      import('/packages/kjdraw-sdk/src/agent-tools.js'),
      import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
      import('/packages/kjdraw-sdk/src/drawing-image.js'),
    ])
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width:900px;height:1200px'
    document.body.append(canvas)
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    const session = new KJAgentToolSession(sdk, drawing)
    const proposed = await session.call('cad_propose_geology_column', {
      version: '1.0.0', expectedRevision: 0, units: 'millimeter', locale: 'zh-CN', projectName: '黄土塬工程',
      hole: { id: 'ZK1', collarElevation: 1128.5, depth: 30, stableWaterDepth: 25.5,
        strata: [
          { code: '1', name: '耕土', top: 0, bottom: 0.5, lithology: 'cultivated-soil', description: '植物根系发育' },
          { code: '2', name: '湿陷性黄土', top: 0.5, bottom: 5.5, lithology: 'loess-collapsible', description: '大孔隙发育' },
          { code: '3', name: '黄土', top: 5.5, bottom: 12.5, lithology: 'loess', description: '垂直节理发育' },
          { code: '4', name: '古土壤', top: 12.5, bottom: 14.8, lithology: 'paleosol', description: '棕红色' },
          { code: '5', name: '钙质结核层', top: 14.8, bottom: 18, lithology: 'calcareous-nodule', description: '钙质结核富集' },
          { code: '6', name: '黄土状土', top: 18, bottom: 23.5, lithology: 'loess-like', description: '黄褐色' },
          { code: '7', name: '粉质黏土', top: 23.5, bottom: 30, lithology: 'silty-clay', description: '可塑' },
        ],
        observations: [
          { kind: 'sample', id: 'S1', depth: 4.1, displayLabel: 'S1' },
          { kind: 'spt', id: 'N1', depth: 11, value: 19 },
          { kind: 'sample', id: 'S2', depth: 20, displayLabel: 'S2' },
          { kind: 'spt', id: 'N2', depth: 27, value: 28 },
        ],
      },
    })
    if (!proposed.ok) throw new Error(proposed.error.message)
    const proposal = proposed.value
    const approved = await session.approve(proposal.planId, 'browser-regression')
    if (!approved.ok) throw new Error(approved.error.message)
    const renderer = new KJCanvasRenderer(canvas, { document: drawing, theme: 'light', grid: false, pixelRatio: 1, padding: 20 })
    renderer.resize(900, 1200).fit()
    const report = renderer.render(), hatches = drawing.listEntities({ type: 'HATCH' })
    const layoutId = drawing.snapshot().spaces.activeLayoutId
    await sdk.executeCommand('PAGESETUP', { layoutId, dxf: {
      paperWidth: 210, paperHeight: 297, paperUnits: 1, rotation: 0, plotType: 4, flags: 0,
      scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
      windowMinX: 0, windowMinY: 0, windowMaxX: 210, windowMaxY: 297,
    } }, { document: drawing })
    const png = await exportDrawingPng(drawing, { layoutId, maxEdge: 1200, theme: 'light' })
    const image = new Image()
    image.src = png.dataUrl
    await image.decode()
    const probe = document.createElement('canvas')
    probe.width = png.pixelWidth
    probe.height = png.pixelHeight
    const probeContext = probe.getContext('2d')
    probeContext.drawImage(image, 0, 0)
    const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data
    let maximumInkY = -1
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 180 && pixels[index + 1] < 180 && pixels[index + 2] < 180)
        maximumInkY = Math.max(maximumInkY, Math.floor(index / 4 / probe.width))
    }
    image.style.width = '840px'
    document.body.replaceChildren(image)
    const hatchY = hatches.flatMap(entity => entity.payload.boundaryLoops.flatMap(loop =>
      (loop.vertices ?? []).map(vertex => Array.isArray(vertex) ? vertex[1] : vertex.point?.[1])))
      .filter(Number.isFinite)
    const labels = drawing.listEntities().filter(entity => entity.type === 'TEXT' || entity.type === 'MTEXT').map(entity => String(entity.payload.text))
    return {
      scale: proposal.engineeringEvidence.parameters.verticalScaleDenominator,
      hatchCount: hatches.length,
      hatchVertexCount: hatchY.length,
      lowestHatchY: Math.min(...hatchY),
      hasScaleLabel: labels.includes('1:150'),
      unsupported: report.unsupported,
      unsupportedTypes: report.unsupportedTypes,
      hatchDiagnostics: report.hatchDiagnostics,
      pngUnsupported: png.renderReport.unsupported,
      pngWidth: png.pixelWidth,
      pngHeight: png.pixelHeight,
      maximumInkY,
      pngDataUrl: png.dataUrl,
      rendered: report.rendered,
      entityCount: drawing.listEntities().length,
    }
  })
  expect(result.scale).toBe(150)
  expect(result.hatchCount).toBe(7)
  expect(result.hatchVertexCount).toBe(28)
  expect(result.lowestHatchY).toBeCloseTo(33, 6)
  expect(result.hasScaleLabel).toBe(true)
  expect(result.unsupported).toBe(0)
  expect(result.unsupportedTypes).toEqual([])
  expect(result.hatchDiagnostics).toEqual([])
  expect(result.pngUnsupported).toBe(0)
  expect(result.pngHeight).toBeGreaterThan(result.pngWidth)
  expect(result.maximumInkY).toBeGreaterThan(result.pngHeight * 0.85)
  expect(result.rendered).toBe(result.entityCount)
  await writeFile(testInfo.outputPath('geology-column-150.png'), Buffer.from(result.pngDataUrl.split(',')[1], 'base64'))
})
