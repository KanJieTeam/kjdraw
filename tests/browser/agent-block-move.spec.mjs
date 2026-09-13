import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test('nested INSERT move previews actual block geometry, approves once and restores native geometry', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { KJAgentToolSession } = await import('/packages/kjdraw-sdk/src/agent-tools.js')
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    await drawing.transact('Nested equipment', tx => {
      const motor = tx.upsertTableRecord('blockRecords', { id: 'motor', name: 'MOTOR', payload: { basePoint: [3, 2, 0], entityIds: [] } })
      tx.createEntity('CIRCLE', { center: [3, 2, 0], radius: 5 }, { id: 'motor-circle', ownerId: motor.id })
      tx.createEntity('LINE', { start: [3, 2, 0], end: [10, 2, 0] }, { id: 'motor-axis', ownerId: motor.id })
      const block = tx.upsertTableRecord('blockRecords', { id: 'assembly', name: 'PUMP', payload: { basePoint: [5, 5, 0], entityIds: [] } })
      tx.createEntity('LWPOLYLINE', { vertices: [[5, 5, 0], [35, 5, 0], [35, 25, 0], [5, 25, 0]], closed: true }, { id: 'outline', ownerId: block.id })
      tx.createEntity('INSERT', { blockRecordId: motor.id, position: [20, 15, 0], rotation: .4 }, { id: 'motor-insert', ownerId: block.id })
      tx.createEntity('TEXT', { position: [9, 7, 0], text: 'PUMP-12', height: 2 }, { id: 'label', ownerId: block.id })
      tx.createEntity('INSERT', { blockRecordId: block.id, position: [5, 5, 0], scale: [1, 1, 1], rotation: .3 }, { id: 'pump' })
    })
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:960px;height:440px;position:fixed;left:0;top:0;z-index:9999'; document.body.append(canvas)
    const renderer = new KJCanvasRenderer(canvas, { document: drawing, pixelRatio: 1, grid: false, theme: 'light' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    renderer.resize(960, 440); Object.assign(renderer.camera, { centerX: 47, centerY: 17, scale: 9 }); renderer.render()
    const beforePng = canvas.toDataURL(), original = drawing.serialize(), session = new KJAgentToolSession(sdk, drawing)
    const proposed = await session.call('cad_propose_move', { expectedRevision: drawing.revision, units: 'millimeter', ids: ['pump'], dx: 52, dy: 0 })
    if (!proposed.ok) throw new Error(JSON.stringify(proposed))
    const proposal = proposed.value, labels = [], originalFillText = renderer.context.fillText
    renderer.context.fillText = function (text, ...args) { labels.push(text); return originalFillText.call(this, text, ...args) }
    renderer.drawPreview(proposal.preview.after, '#ff0000')
    renderer.context.fillText = originalFillText
    const previewPng = canvas.toDataURL(), pixels = renderer.context.getImageData(0, 0, canvas.width, canvas.height).data
    let redPixels = 0, wrongSidePixels = 0
    const middle = renderer.worldToScreen([48, 17])[0]
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] > pixels[index + 1] + 80 && pixels[index] > pixels[index + 2] + 80) {
      redPixels++
      if ((index / 4) % canvas.width < middle) wrongSidePixels++
    }
    const unchanged = drawing.serialize() === original, definitions = new Map(proposal.preview.blockDependencies.map(item => [item.id, JSON.stringify(drawing.getObject(item.id))]))
    const approval = await session.approve(proposal.planId, 'browser-reviewer')
    if (!approval.ok) throw new Error(JSON.stringify(approval))
    renderer.render()
    const approvedPng = canvas.toDataURL(), exactDefinitions = [...definitions].every(([id, json]) => JSON.stringify(drawing.getObject(id)) === json)
    const exactInsert = JSON.stringify(drawing.getObject('pump').payload) === JSON.stringify(proposal.preview.after[0].payload)
    await drawing.undo(); renderer.render(); const undoPng = canvas.toDataURL()
    const undoGeometryExact = JSON.stringify(drawing.getObject('pump').payload) === JSON.stringify(proposal.preview.before[0].payload)
    await drawing.redo(); renderer.render(); const redoGeometryExact = JSON.stringify(drawing.getObject('pump').payload) === JSON.stringify(proposal.preview.after[0].payload)
    const dx = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
    const reopened = await createKJDrawSDK().readDocument(dx, { format: 'DXF' })
    renderer.setDocument(reopened); Object.assign(renderer.camera, { centerX: 47, centerY: 17, scale: 9 }); renderer.render()
    const reopenedPng = canvas.toDataURL(), reopenedReport = renderer.report
    const transform = payload => ({ position: payload.position, scale: payload.scale, rotation: payload.rotation })
    const approvedTransform = transform(proposal.preview.after[0].payload)
    const reopenedTransform = transform(reopened.listEntities({ type: 'INSERT', ownerId: reopened.snapshot().spaces.modelSpaceId })[0].payload)
    renderer.dispose(); canvas.remove()
    return { unchanged, exactDefinitions, exactInsert, undoGeometryExact, redoGeometryExact, approvedTransform, reopenedTransform, labels, redPixels, wrongSidePixels, beforePng, previewPng, approvedPng, undoPng, reopenedPng, reopenedReport, dependencies: proposal.preview.blockDependencies.map(item => item.id) }
  })
  await mkdir('.cache/agent-block-move', { recursive: true })
  for (const name of ['before', 'preview', 'approved', 'undo', 'reopened']) {
    const body = Buffer.from(result[`${name}Png`].split(',')[1], 'base64')
    await writeFile(`.cache/agent-block-move/${name}.png`, body)
    await testInfo.attach(name, { body, contentType: 'image/png' })
  }
  expect(result.unchanged).toBe(true)
  expect(result.exactDefinitions).toBe(true)
  expect(result.exactInsert).toBe(true)
  expect(result.undoGeometryExact).toBe(true)
  expect(result.redoGeometryExact).toBe(true)
  expect(result.reopenedTransform.position).toEqual(result.approvedTransform.position)
  expect(result.reopenedTransform.scale).toEqual(result.approvedTransform.scale)
  expect(result.reopenedTransform.rotation).toBeCloseTo(result.approvedTransform.rotation, 12)
  expect(result.reopenedReport.unsupported).toBe(0)
  expect(result.labels).toEqual(['PUMP-12'])
  expect(result.redPixels).toBeGreaterThan(800)
  expect(result.wrongSidePixels).toBe(0)
  for (const id of ['motor', 'assembly', 'motor-circle', 'motor-axis', 'outline', 'motor-insert', 'label']) expect(result.dependencies).toContain(id)
})
