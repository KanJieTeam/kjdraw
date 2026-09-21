import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test('geology plan stays pixel exact locally and as a whole through KJD and DXF 2007', async ({ page }, testInfo) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [{ createKJDrawSDK }, { buildAgentGeologyPlan }, { exportDrawingSvg }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'),
      import('/packages/kjdraw-sdk/src/agent-geology-plan.js'),
      import('/packages/kjdraw-sdk/src/svg-export.js'),
    ])
    const sdk = createKJDrawSDK(), source = sdk.createDocument({ units: 'meter' })
    const compiled = buildAgentGeologyPlan(source, {
      version: '1.0.0', expectedRevision: 0, units: 'meter', locale: 'en',
      drawingId: 'PUBLIC-GEO-PIXELS', title: 'GEOLOGICAL INVESTIGATION PLAN', revision: 'A', scale: 500,
      boundary: [[0, 0], [140, 0], [140, 90], [0, 90]],
      boreholes: [
        { id: 'P1', position: [20, 20], collarElevation: 100, depth: 30 },
        { id: 'P2', position: [70, 35], collarElevation: 99, depth: 28 },
        { id: 'P3', position: [115, 70], collarElevation: 98, depth: 32 },
      ],
      sectionLines: [{ id: 'S1', holeIds: ['P1', 'P2', 'P3'], label: 'A-A', endpointLabels: ['A', 'A'] }],
      coordinateGrid: { origin: [0, 0], spacing: 20 }, northAngleDegrees: 0,
    })
    await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document: source })
    const kjdArtifact = await sdk.writeDocument(source, { format: 'KJD' })
    const dxfArtifact = await sdk.writeDocument(source, { format: 'DXF', version: '2007' })
    const [kjd, dxf] = await Promise.all([
      createKJDrawSDK().readDocument(kjdArtifact, { format: 'KJD' }),
      createKJDrawSDK().readDocument(dxfArtifact, { format: 'DXF' }),
    ])
    const canvas = document.createElement('canvas')
    canvas.width = 840; canvas.height = 594; document.body.append(canvas)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const render = async drawing => {
      const layoutId = drawing.snapshot().spaces.layoutIds.find(id => drawing.getObject(id)?.name === compiled.outputConfig.layoutName)
      const output = exportDrawingSvg(drawing, { layoutId, allowPartial: false })
      const image = await new Promise((resolve, reject) => {
        const value = new Image(); value.onload = () => resolve(value); value.onerror = reject
        value.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(output.svg)}`
      })
      context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return { diagnostics: output.report.diagnostics.length, pixels: new Uint8ClampedArray(context.getImageData(0, 0, canvas.width, canvas.height).data), png: canvas.toDataURL() }
    }
    const frames = { source: await render(source), kjd: await render(kjd), dxf: await render(dxf) }
    const viewport = source.listEntities({ type: 'VIEWPORT' })[0].payload
    const point = [20, 20], pageScale = canvas.width / compiled.outputConfig.paper.widthMm
    const modelWidth = viewport.viewHeight * viewport.width / viewport.height
    const localCenter = [
      (viewport.center[0] - viewport.width / 2 + (point[0] - (viewport.viewCenter[0] - modelWidth / 2)) * viewport.width / modelWidth) * pageScale,
      (viewport.center[1] - (point[1] - viewport.viewCenter[1]) * viewport.height / viewport.viewHeight) * pageScale,
    ]
    const compare = (actual, localSize = 96) => {
      let exactChannels = 0, mismatchedPixels = 0, localMismatchedPixels = 0, localInkPixels = 0
      const left = Math.round(localCenter[0] - localSize / 2), top = Math.round(localCenter[1] - localSize / 2)
      for (let pixel = 0; pixel < canvas.width * canvas.height; pixel++) {
        const offset = pixel * 4
        let differs = false
        for (let channel = 0; channel < 4; channel++) {
          if (actual[offset + channel] === frames.source.pixels[offset + channel]) exactChannels++
          else differs = true
        }
        const x = pixel % canvas.width, y = Math.floor(pixel / canvas.width)
        const local = x >= left && x < left + localSize && y >= top && y < top + localSize
        if (local && frames.source.pixels[offset + 3] > 0 && (frames.source.pixels[offset] < 245 || frames.source.pixels[offset + 1] < 245 || frames.source.pixels[offset + 2] < 245)) localInkPixels++
        if (!differs) continue
        mismatchedPixels++
        if (local) localMismatchedPixels++
      }
      return { exactChannels, mismatchedPixels, localMismatchedPixels, localInkPixels }
    }
    let ink = 0
    for (let pixel = 0; pixel < canvas.width * canvas.height; pixel++) {
      const offset = pixel * 4
      if (frames.source.pixels[offset + 3] > 0 && (frames.source.pixels[offset] < 245 || frames.source.pixels[offset + 1] < 245 || frames.source.pixels[offset + 2] < 245)) ink++
    }
    canvas.remove()
    return {
      sourceDiagnostics: frames.source.diagnostics,
      kjdDiagnostics: frames.kjd.diagnostics,
      dxfDiagnostics: frames.dxf.diagnostics,
      kjd: compare(frames.kjd.pixels), dxf: compare(frames.dxf.pixels),
      channels: frames.source.pixels.length, ink, localCenter,
      valid: [source.validate().valid, kjd.validate().valid, dxf.validate().valid],
      proxies: [source, kjd, dxf].map(drawing => drawing.listEntities({ type: 'PROXY_ENTITY' }).length),
      dxf2007: /\$ACADVER\r?\n\s*1\r?\nAC1021\r?\n/.test(dxfArtifact),
      pngs: { source: frames.source.png, dxf: frames.dxf.png },
    }
  })
  await mkdir('.cache/agent-geology-plan', { recursive: true })
  for (const [name, dataUrl] of Object.entries(result.pngs)) {
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64')
    await writeFile(`.cache/agent-geology-plan/${name}.png`, bytes)
    await testInfo.attach(name, { body: bytes, contentType: 'image/png' })
  }
  expect(result.valid).toEqual([true, true, true])
  expect(result.proxies).toEqual([0, 0, 0])
  expect(result.dxf2007).toBe(true)
  expect([result.sourceDiagnostics, result.kjdDiagnostics, result.dxfDiagnostics]).toEqual([0, 0, 0])
  expect(result.ink).toBeGreaterThan(10_000)
  expect(result.kjd.localInkPixels).toBeGreaterThan(50)
  expect(result.kjd).toEqual({ exactChannels: result.channels, mismatchedPixels: 0, localMismatchedPixels: 0, localInkPixels: result.kjd.localInkPixels })
  expect(result.dxf).toEqual(result.kjd)
})
