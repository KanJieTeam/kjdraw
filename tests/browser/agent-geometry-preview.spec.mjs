import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })

test('agent geometry paints a temporary overlay and approval preserves its exact geometry', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [{ createKJDrawSDK }, { KJAgentToolSession }, { KJCanvasRenderer }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/agent-tools.js'),
      import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
    ])
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width:640px;height:480px'
    document.body.replaceChildren(canvas)
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    const session = new KJAgentToolSession(sdk, drawing)
    const renderer = new KJCanvasRenderer(canvas, { document: drawing, grid: false, pixelRatio: 1 })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    renderer.camera.centerX = 0; renderer.camera.centerY = 0; renderer.camera.scale = 4
    renderer.render()
    const pixel = () => {
      const [x, y] = renderer.worldToScreen([10, 0])
      return [...canvas.getContext('2d').getImageData(Math.floor(x) - 2, Math.floor(y) - 2, 5, 5).data]
    }
    const empty = pixel(), source = drawing.serialize()
    const proposed = await session.call('cad_propose_circles', {
      expectedRevision: 0, units: 'millimeter', circles: [{ center: { x: 0, y: 0 }, radius: 10 }],
    })
    if (!proposed.ok) throw new Error(JSON.stringify(proposed))
    const proposal = proposed.value
    renderer.drawPreview(proposal.preview.after, '#52c99b')
    const overlayPainted = JSON.stringify(pixel()) !== JSON.stringify(empty)
    const unmodified = drawing.serialize() === source
    renderer.render()
    const overlayCleared = JSON.stringify(pixel()) === JSON.stringify(empty)
    const approved = await session.approve(proposal.planId, 'browser-test-reviewer')
    renderer.render()
    const committed = drawing.getObject(proposal.preview.after[0].id)
    const commitPainted = JSON.stringify(pixel()) !== JSON.stringify(empty)
    const exact = JSON.stringify(committed?.payload) === JSON.stringify(proposal.preview.after[0].payload)
    await sdk.executeCommand('UNDO')
    renderer.render()
    const undoCleared = JSON.stringify(pixel()) === JSON.stringify(empty)
    renderer.dispose()
    return { overlayPainted, unmodified, overlayCleared, approved: approved.ok, commitPainted, exact, undoCleared }
  })
  expect(result).toEqual({ overlayPainted: true, unmodified: true, overlayCleared: true, approved: true, commitPainted: true, exact: true, undoCleared: true })
})
