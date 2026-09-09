import { expect, test } from '@playwright/test'
import { mountingProfile } from '../../packages/kjdraw-sdk/examples/fixtures/mounting-profile.mjs'

test.use({ bypassCSP: true })

test('mixed agent geometry opens in the packaged editor and remains selectable after undo and redo', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async input => {
    const [{ createKJDrawSDK }, { KJAgentToolSession }, { createKJDrawEditor }, { runKJAgentTask }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/agent-tools.js'),
      import('/packages/kjdraw-sdk/src/editor.js'),
      import('/packages/kjdraw-sdk/src/agent-runner.js'),
    ])
    const host = document.createElement('div')
    host.style.cssText = 'width:1100px;height:760px'
    document.body.replaceChildren(host)
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    const session = new KJAgentToolSession(sdk, drawing)
    const editor = createKJDrawEditor(host, { sdk, document: drawing, grid: false })
    await editor.ready
    const blocked = await runKJAgentTask({ session, prompt: 'Use only the host-selected tool.', toolNames: ['cad_propose_drawing'], model: {
      createConversation: () => ({ next: async () => ({ text: '', calls: [{ id: 'omitted', name: 'cad_propose_circles', arguments: {} }] }) }),
    } })
    if (blocked.error?.code !== 'KJAGENT_TOOL_NOT_ALLOWED' || blocked.toolCalls !== 0 || drawing.revision !== 0) throw new Error('Tool policy was not enforced')
    const run = await runKJAgentTask({ session, prompt: 'Propose the fully specified profile.', toolNames: ['cad_propose_drawing'], model: {
      createConversation({ tools }) {
        if (tools.length !== 1 || tools[0].name !== 'cad_propose_drawing') throw new Error('Unexpected tool definitions')
        return { next: async () => ({ text: '', calls: [{ id: 'profile', name: 'cad_propose_drawing', arguments: input }] }) }
      },
    } })
    if (run.status !== 'awaiting-approval') throw new Error(JSON.stringify(run))
    const result = run.outputs[0].result
    if (!result.ok) throw new Error(JSON.stringify(result))
    const approved = await session.approve(result.value.planId, 'browser-test-reviewer')
    if (!approved.ok) throw new Error(JSON.stringify(approved))
    editor.fit()
    const renderer = editor.workbench.renderer
    const rendered = renderer.render()
    const ids = drawing.listEntities().map(entity => entity.id)
    sdk.activeSelection.replace(ids)
    await sdk.executeCommand('UNDO')
    const undone = drawing.listEntities().length
    await sdk.executeCommand('REDO')
    editor.fit()
    const restored = renderer.render()
    sdk.activeSelection.replace(ids)
    const selected = sdk.activeSelection.size
    const exact = result.value.preview.after.every(expected => JSON.stringify(drawing.getObject(expected.id)?.payload) === JSON.stringify(expected.payload))
    return { rendered: rendered.rendered, unsupported: rendered.unsupported, undone, restored: restored.rendered, selected, exact }
  }, mountingProfile())
  expect(result).toEqual({ rendered: 9, unsupported: 0, undone: 0, restored: 9, selected: 9, exact: true })
})

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
