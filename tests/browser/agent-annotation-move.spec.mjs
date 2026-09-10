import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test('native text and dimension move previews draw in Chromium and match the approved geometry', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { KJAgentToolSession } = await import('/packages/kjdraw-sdk/src/agent-tools.js')
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    await drawing.transact('Native drawing', tx => {
      tx.createEntity('LINE', { start: [5, 5, 0], end: [45, 5, 0] }, { id: 'edge' })
      tx.createEntity('TEXT', { position: [7, 15, 0], text: 'P-12 / 6061-T6', height: 3, rotation: 0 }, { id: 'note' })
      tx.createEntity('DIMENSION', { dimensionType: 'ROTATED', definitionPoints: [[5, 0, 0], [5, 5, 0], [45, 5, 0]], textPosition: [25, -1, 0], rotation: 0, textHeight: 3 }, { id: 'dimension' })
    })
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:960px;height:420px;position:fixed;left:0;top:0;z-index:9999'; document.body.append(canvas)
    const renderer = new KJCanvasRenderer(canvas, { document: drawing, pixelRatio: 1, grid: false, theme: 'light' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    renderer.resize(960, 420); Object.assign(renderer.camera, { centerX: 55, centerY: 10, scale: 8 }); renderer.render()
    const beforePng = canvas.toDataURL(), original = drawing.serialize(), session = new KJAgentToolSession(sdk, drawing)
    const response = await session.call('cad_propose_move', { expectedRevision: drawing.revision, units: 'millimeter', ids: ['edge', 'note', 'dimension'], dx: 55, dy: 0 })
    if (!response.ok) throw new Error(JSON.stringify(response))
    const proposal = response.value, originalFillText = renderer.context.fillText, labels = []
    renderer.context.fillText = function (text, ...args) { labels.push(text); return originalFillText.call(this, text, ...args) }
    renderer.drawPreview(proposal.preview.after, '#ff0000')
    renderer.context.fillText = originalFillText
    const previewPng = canvas.toDataURL(), unchanged = drawing.serialize() === original
    const pixel = renderer.worldToScreen([80, 0]), rgba = renderer.context.getImageData(Math.round(pixel[0]) - 2, Math.round(pixel[1]) - 2, 5, 5).data
    const redDimension = Array.from(rgba).some((value, index) => index % 4 === 0 && value > rgba[index + 1] + 50 && value > rgba[index + 2] + 50)
    const approval = await session.approve(proposal.planId, 'browser-reviewer')
    if (!approval.ok) throw new Error(JSON.stringify(approval))
    renderer.render()
    const approvedPng = canvas.toDataURL(), exact = proposal.preview.after.every(entity => JSON.stringify(drawing.getObject(entity.id).payload) === JSON.stringify(entity.payload))
    await drawing.undo(); renderer.render(); const undoExact = canvas.toDataURL() === beforePng
    await drawing.redo(); renderer.render(); const redoExact = canvas.toDataURL() === approvedPng
    renderer.dispose(); canvas.remove()
    return { unchanged, exact, undoExact, redoExact, labels, redDimension, beforePng, previewPng, approvedPng }
  })
  expect(result.unchanged).toBe(true)
  expect(result.exact).toBe(true)
  expect(result.redDimension).toBe(true)
  expect(result.labels).toEqual(['P-12 / 6061-T6', '40'])
  expect(result.undoExact).toBe(true)
  expect(result.redoExact).toBe(true)
  expect(result.previewPng).not.toBe(result.beforePng)
  expect(result.approvedPng).not.toBe(result.beforePng)
  await mkdir('.cache/agent-annotation-move', { recursive: true })
  for (const name of ['before', 'preview', 'approved']) {
    const body = Buffer.from(result[`${name}Png`].split(',')[1], 'base64')
    await writeFile(`.cache/agent-annotation-move/${name}.png`, body)
    await testInfo.attach(name, { body, contentType: 'image/png' })
  }
})
