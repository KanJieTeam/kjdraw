import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test('AI uniformly scales a mixed dimensioned nested block with native values, exact approval and zero-pixel DXF round trip', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const result = await page.evaluate(async () => {
    const [{ createKJDrawSDK }, { KJAgentToolSession }, { KJCanvasRenderer }, { projectDimension }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/agent-tools.js'), import('/packages/kjdraw-sdk/src/canvas-renderer.js'), import('/packages/kjdraw-sdk/src/geometry/annotation.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    await drawing.transact('Mixed native dimensioned pump', tx => {
      const style = tx.upsertTableRecord('dimensionStyles', { id: 'dim-style', name: 'Equipment dimension', payload: { textHeight: 1.2, arrowSize: 1, extensionOffset: .3, extensionBeyond: .5, decimalPlaces: 2 } })
      const motor = tx.upsertTableRecord('blockRecords', { id: 'motor', name: 'Motor', payload: { basePoint: [2, 1, 0], entityIds: [] } })
      tx.createEntity('CIRCLE', { center: [2, 1], radius: 3 }, { id: 'motor-circle', ownerId: motor.id })
      for (const [id, dimensionType, definitionPoints, textPosition] of [
        ['radius', 'RADIUS', [[2, 1], [5, 1]], [8, 2]],
        ['diameter', 'DIAMETER', [[-1, 1], [5, 1]], [3, -4]],
        ['angular', 'ANGULAR_3_POINT', [[4, 3], [5, 1], [2, 4], [2, 1]], [6, 6]],
      ]) tx.createEntity('DIMENSION', { dimensionType, definitionPoints, textPosition, textHeight: 1.2 }, { id, ownerId: motor.id })
      const block = tx.upsertTableRecord('blockRecords', { id: 'body', name: 'Pump assembly', payload: { basePoint: [4, 3, 0], entityIds: [] } })
      tx.createEntity('LWPOLYLINE', { vertices: [[4, 3], [54, 3], [54, 25], [4, 25]], closed: true }, { id: 'outline', ownerId: block.id })
      tx.createEntity('TEXT', { position: [6, 21], text: 'PUMP-17', height: 2 }, { id: 'name', ownerId: block.id })
      tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[4, -4], [4, 3], [54, 3]], textPosition: [29, -6], styleId: style.id }, { id: 'width', ownerId: block.id })
      tx.createEntity('DIMENSION', { dimensionType: 'ROTATED', definitionPoints: [[60, 3], [54, 3], [54, 25]], textPosition: [63, 14], rotation: Math.PI / 2, styleId: style.id }, { id: 'height', ownerId: block.id })
      tx.createEntity('INSERT', { blockRecordId: motor.id, position: [32, 14], rotation: Math.PI / 6, scale: [1.25, 1.25, 1] }, { id: 'nested', ownerId: block.id })
      tx.createEntity('INSERT', { blockRecordId: block.id, position: [0, 0], scale: [1.5, 1.5, 1.5] }, { id: 'pump' })
    })
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:1200px;height:600px;position:fixed;left:0;top:0;z-index:9999'; document.body.append(canvas)
    // Pixel sampling must not switch Chromium's raster backend midway through
    // before/Undo comparisons. Keep all frames on the same readback context.
    canvas.getContext('2d', { willReadFrequently: true })
    const renderer = new KJCanvasRenderer(canvas, { document: drawing, pixelRatio: 1, grid: false, theme: 'light' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    renderer.resize(1200, 600); Object.assign(renderer.camera, { centerX: 50, centerY: 20, scale: 6 })
    let labels = []
    const nativeText = renderer.context.fillText
    renderer.context.fillText = function (text, ...args) {
      const transform = this.getTransform(), fontPixels = Number(this.font.match(/([\d.]+)px/)?.[1])
      labels.push({ text: String(text), pixels: fontPixels * Math.hypot(transform.a, transform.b) })
      return nativeText.call(this, text, ...args)
    }
    const render = () => { labels = []; renderer.render(); return { png: canvas.toDataURL(), labels: structuredClone(labels) } }
    const before = render(), original = drawing.serialize(), originals = new Map(drawing.listObjects().map(item => [item.id, JSON.stringify(item)]))
    const originalRoot = JSON.stringify(drawing.getObject('pump')), session = new KJAgentToolSession(sdk, drawing)
    const response = await session.call('cad_propose_scale', { expectedRevision: drawing.revision, units: 'millimeter', ids: ['pump'], center: { x: 0, y: 0 }, factor: 1.5 })
    if (!response.ok) throw new Error(JSON.stringify(response))
    const proposal = response.value
    labels = []; renderer.drawPreview(proposal.preview.after, '#ff0000')
    const preview = { png: canvas.toDataURL(), labels: structuredClone(labels) }, pixels = renderer.context.getImageData(0, 0, canvas.width, canvas.height).data
    let redPixels = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > pixels[i + 1] + 80 && pixels[i] > pixels[i + 2] + 80) redPixels++
    // Check the actual scaled 90-degree dimension arc through both block matrices.
    const angle = Math.PI / 4, localRadius = Math.sqrt(8), mx = 2 + localRadius * Math.cos(angle), my = 1 + localRadius * Math.sin(angle)
    const cx = 32 + 1.25 * ((mx - 2) * Math.cos(Math.PI / 6) - (my - 1) * Math.sin(Math.PI / 6))
    const cy = 14 + 1.25 * ((mx - 2) * Math.sin(Math.PI / 6) + (my - 1) * Math.cos(Math.PI / 6))
    const arcPixel = renderer.worldToScreen([(cx - 4) * 2.25, (cy - 3) * 2.25])
    const arcPixels = renderer.context.getImageData(Math.round(arcPixel[0]) - 3, Math.round(arcPixel[1]) - 3, 7, 7).data
    let angularInk = false
    for (let i = 0; i < arcPixels.length; i += 4) if (arcPixels[i] > arcPixels[i + 1] + 80 && arcPixels[i] > arcPixels[i + 2] + 80) angularInk = true
    const unchanged = drawing.serialize() === original
    const approval = await session.approve(proposal.planId, 'browser-reviewer')
    if (!approval.ok) throw new Error(JSON.stringify(approval))
    const approved = render(), acceptedRoot = JSON.stringify(drawing.getObject('pump'))
    const exactRoot = JSON.stringify(drawing.getObject('pump').payload) === JSON.stringify(proposal.preview.after[0].payload)
    const exactDefinitions = [...originals].every(([id, record]) => id === 'pump' || JSON.stringify(drawing.getObject(id)) === record)
    // DXF import can remap low handles reserved by default resources. Compare
    // every native definition by its owner block and dimension type instead.
    const measures = document => document.listEntities({ type: 'DIMENSION' }).map(entity => ({ owner: document.getObject(entity.ownerId).name, type: entity.payload.dimensionType, points: entity.payload.definitionPoints, measurement: projectDimension(entity.payload, document.getObject(entity.payload.styleId)?.payload).measurement })).sort((a, b) => `${a.owner}:${a.type}`.localeCompare(`${b.owner}:${b.type}`))
    const originalMeasurements = measures(drawing)
    await drawing.undo(); const undo = render(), undoRootExact = JSON.stringify(drawing.getObject('pump')) === originalRoot
    const undoDefinitionsExact = [...originals].every(([id, record]) => JSON.stringify(drawing.getObject(id)) === record)
    await drawing.redo(); const redo = render(), redoRootExact = JSON.stringify(drawing.getObject('pump')) === acceptedRoot
    const bytes = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' }), reopenedDrawing = await createKJDrawSDK().readDocument(bytes, { format: 'DXF' })
    renderer.setDocument(reopenedDrawing); Object.assign(renderer.camera, { centerX: 50, centerY: 20, scale: 6 })
    const reopened = render(), reopenedMeasurements = measures(reopenedDrawing)
    const nativeBlocks = reopenedDrawing.listEntities({ type: 'INSERT' }).length
    renderer.context.fillText = nativeText; renderer.dispose(); canvas.remove()
    return { before, preview, approved, undo, redo, reopened, dxf: bytes, unchanged, exactRoot, exactDefinitions, undoRootExact, undoDefinitionsExact, redoRootExact, redPixels, angularInk, originalMeasurements, reopenedMeasurements, nativeBlocks, revisionDelta: approval.value.afterRevision - approval.value.beforeRevision, dependencyIds: proposal.preview.blockDependencies.map(item => item.id) }
  })
  await mkdir('.cache/agent-scaled-dimension-block', { recursive: true })
  await writeFile('.cache/agent-scaled-dimension-block/approved.dxf', result.dxf)
  for (const name of ['before', 'preview', 'approved', 'undo', 'redo', 'reopened']) {
    const bytes = Buffer.from(result[name].png.split(',')[1], 'base64')
    await writeFile(`.cache/agent-scaled-dimension-block/${name}.png`, bytes)
    await testInfo.attach(name, { body: bytes, contentType: 'image/png' })
  }
  expect(result.unchanged).toBe(true); expect(result.exactRoot).toBe(true); expect(result.exactDefinitions).toBe(true)
  expect(result.undoRootExact).toBe(true); expect(result.undoDefinitionsExact).toBe(true); expect(result.redoRootExact).toBe(true); expect(result.revisionDelta).toBe(1)
  expect(result.redPixels).toBeGreaterThan(1000); expect(result.angularInk).toBe(true)
  const text = rows => rows.map(item => item.text).sort()
  expect(text(result.before.labels)).toEqual(['22', '50', '90°', 'PUMP-17', 'R3', '⌀6'].sort())
  expect(text(result.preview.labels)).toEqual(text(result.before.labels)); expect(result.preview.labels).toEqual(result.approved.labels)
  for (const item of result.approved.labels) expect(item.pixels).toBeCloseTo(result.before.labels.find(original => original.text === item.text).pixels * 1.5, 7)
  expect(result.reopenedMeasurements).toEqual(result.originalMeasurements); expect(result.nativeBlocks).toBe(2)
  for (const id of ['body', 'motor', 'nested', 'width', 'height', 'radius', 'diameter', 'angular', 'dim-style']) expect(result.dependencyIds).toContain(id)
  // Exact image equality after native DXF reopen: no tolerance for changed values,
  // annotation style, block transforms, or omitted dimensions.
  expect(result.reopened.png === result.approved.png).toBe(true)
  expect(result.redo.png === result.approved.png).toBe(true)
  expect(result.undo.png === result.before.png).toBe(true)
})
