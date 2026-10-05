import { expect, test } from '@playwright/test'

test('actual CAD viewer preserves camera across proposal and approved revision, but never shows stale proposal pixels', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/ai/')
  await page.evaluate(async () => {
    const { createAiChatRuntime } = await import('/apps/playground/ai/runtime.js')
    const { createDrawingViewer } = await import('/apps/playground/ai/drawing-viewer.js')
    const runtime = createAiChatRuntime({ endpoint: 'https://viewer-fixture.invalid/v1/chat/completions', model: 'browser-fixture',
      // A local scripted transport only; the actual CAD plan/approval/rendering
      // remains real, and no request leaves this browser.
      fetchImpl: async () => Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
        id: 'viewer-camera-line', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({
          expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [],
        }) },
      }] }, finish_reason: 'tool_calls' }] }),
    })
    const result = await runtime.send('Draw a line from 0,0 to 20,0 millimeters')
    if (result.status !== 'proposal') throw new Error(`Fixture did not propose: ${result.status}`)
    const host = document.createElement('div')
    host.dataset.testid = 'camera-refresh-fixture'
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:640px;background:white;z-index:1000'
    document.body.append(host)
    const viewer = createDrawingViewer({ container: host, runtime })
    host.querySelector('.drawing-viewer-stage').style.cssText = 'width:640px;height:360px;min-height:0'
    const frames = []
    for (const name of ['renderDocument', 'renderProposal']) {
      const render = runtime[name]
      runtime[name] = (...args) => {
        const report = render(...args)
        frames.push({ name, revision: runtime.revision, camera: { ...args.at(-1).camera }, report: { ...report } })
        return report
      }
    }
    window.__cameraRefreshFixture = { runtime, viewer, result, frames }
  })
  const host = page.getByTestId('camera-refresh-fixture')
  const canvas = host.locator('canvas')
  const camera = () => canvas.evaluate(node => JSON.parse(node.dataset.viewerCamera))
  await expect(host.locator('.drawing-viewer')).toHaveAttribute('data-viewer-rendered', '0')
  await host.locator('[data-viewer-action="zoom-in"]').click()
  await canvas.locator('..').press('ArrowRight')
  const saved = await camera()
  const initialDrawing = await page.evaluate(async () => (await window.__cameraRefreshFixture.runtime.exportLocalState()).drawing)

  await page.evaluate(() => {
    const { viewer, result } = window.__cameraRefreshFixture
    viewer.refresh({ mode: 'proposal', planId: result.proposal.planId, preserveCamera: true })
  })
  await expect(host.locator('.drawing-viewer')).toHaveAttribute('data-viewer-mode', 'proposal')
  await expect.poll(() => camera()).toEqual(saved)
  await expect.poll(() => page.evaluate(() => window.__cameraRefreshFixture.frames.at(-1)?.name)).toBe('renderProposal')
  expect(await page.evaluate(async () => (await window.__cameraRefreshFixture.runtime.exportLocalState()).drawing)).toBe(initialDrawing)

  expect(await page.evaluate(async () => {
    const { runtime, result } = window.__cameraRefreshFixture
    return (await runtime.approve(result.proposal.planId)).status
  })).toBe('applied')
  const approvedDrawing = await page.evaluate(async () => (await window.__cameraRefreshFixture.runtime.exportLocalState()).drawing)
  await page.evaluate(() => window.__cameraRefreshFixture.viewer.refresh({ mode: 'document', preserveCamera: true }))
  // A preserved zoom/pan may intentionally put geometry outside the viewport;
  // total native entities, not the culled rendered count, proves this revision.
  await expect.poll(() => page.evaluate(() => window.__cameraRefreshFixture.frames.at(-1)?.report.total)).toBe(1)
  await expect.poll(() => camera()).toEqual(saved)
  expect(await page.evaluate(() => window.__cameraRefreshFixture.frames.at(-1))).toMatchObject({ name: 'renderDocument', revision: 1, camera: saved })

  await page.evaluate(() => window.__cameraRefreshFixture.viewer.refresh({ preserveCamera: true, labels: {
    title: '图纸预览', zoomIn: '放大', zoomOut: '缩小', fit: '适合窗口', enlarge: '全屏查看', close: '关闭预览',
  } }))
  await expect(host.locator('[data-viewer-action="fit"]')).toHaveAttribute('title', '适合窗口')
  await expect(host.locator('[data-viewer-action="zoom-in"]')).toHaveAccessibleName('放大')
  await host.locator('[data-viewer-action="enlarge"]').click()
  const dialog = page.locator('.drawing-viewer-dialog[open]')
  await expect(dialog).toHaveAccessibleName('图纸预览')
  await page.evaluate(() => window.__cameraRefreshFixture.viewer.refresh({ labels: { title: 'Current drawing', close: 'Close preview' }, preserveCamera: true }))
  await expect(dialog).toHaveAccessibleName('Current drawing')
  await expect(dialog.locator('[data-viewer-action="close"]')).toHaveAttribute('title', 'Close preview')
  await dialog.locator('[data-viewer-action="close"]').click()

  // The approved plan is no longer pending. Its failure must erase all old
  // document pixels rather than silently showing current geometry as a preview.
  await page.evaluate(() => {
    const { viewer, result } = window.__cameraRefreshFixture
    viewer.refresh({ mode: 'proposal', planId: result.proposal.planId, preserveCamera: true })
  })
  await expect(host.locator('.drawing-viewer')).toHaveAttribute('data-viewer-error', 'true')
  await expect(host.locator('.drawing-viewer')).toHaveAttribute('data-viewer-rendered', '0')
  expect(await canvas.evaluate(node => node.getContext('2d').getImageData(0, 0, node.width, node.height).data.some(value => value !== 0))).toBe(false)
  expect(await page.evaluate(async () => (await window.__cameraRefreshFixture.runtime.exportLocalState()).drawing)).toBe(approvedDrawing)
  await page.evaluate(() => window.__cameraRefreshFixture.viewer.refresh({ mode: 'document', preserveCamera: true, fit: true }))
  await expect(host.locator('.drawing-viewer')).not.toHaveAttribute('data-viewer-error', 'true')
  await expect.poll(async () => (await camera()).centerX).toBe(10)
  await expect(host.locator('.drawing-viewer')).toHaveAttribute('data-viewer-rendered', '1')
  expect(await page.evaluate(async () => (await window.__cameraRefreshFixture.runtime.exportLocalState()).drawing)).toBe(approvedDrawing)
  await page.evaluate(() => { const { viewer, runtime } = window.__cameraRefreshFixture; viewer.destroy(); runtime.destroy() })
  expect(errors).toEqual([])
})
