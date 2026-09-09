import { test, expect } from '@playwright/test'
test.use({ bypassCSP: true })

test('editor camera bounds drive a filtered query and reviewed local move without changing unrelated objects', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK, createKJDrawEditor } = await import('/packages/kjdraw-sdk/src/index.js')
    const { KJAgentToolSession } = await import('/packages/kjdraw-sdk/src/agent-tools.js')
    const sdk = createKJDrawSDK(), doc = sdk.createDocument({ units: 'millimeter' })
    await doc.transact('drawing', tx => {
      tx.createEntity('LINE', { start: [-10, 0], end: [10, 0] }, { id: 'inside' })
      tx.createEntity('LINE', { start: [990, 0], end: [1010, 0] }, { id: 'outside' })
    })
    const host = document.createElement('div'); host.style.cssText = 'width:1000px;height:650px'; document.body.replaceChildren(host)
    const editor = createKJDrawEditor(host, { sdk, document: doc }); await editor.ready
    const renderer = editor.workbench.renderer, session = new KJAgentToolSession(sdk, doc)
    renderer.camera.centerX = 0; renderer.camera.centerY = 0; renderer.camera.scale = 5; renderer.render()
    const queryViewport = async () => {
      const topLeft = renderer.screenToWorld([0, 0]), bottomRight = renderer.screenToWorld([renderer.report.width, renderer.report.height])
      const result = await session.call('cad_query_drawing', { expectedRevision: doc.revision, filters: { types: ['LINE'], bounds: [topLeft[0], bottomRight[1], bottomRight[0], topLeft[1]] }, offset: 0, layerOffset: 0, limit: 20, maxLayers: 0, maxBytes: 4096 })
      if (!result.ok) throw new Error(JSON.stringify(result))
      return result.value
    }
    const first = await queryViewport(), before = JSON.stringify(doc.getObject('outside'))
    const proposal = await session.call('cad_propose_move', { expectedRevision: first.revision, units: first.units, ids: first.entities.map(e => e.id), dx: 2, dy: 3 })
    if (!proposal.ok) throw new Error(JSON.stringify(proposal))
    if (!(await session.approve(proposal.value.planId, 'browser-review')).ok) throw new Error('Approval failed')
    const moved = doc.getObject('inside').payload.start
    await editor.undo(); const undone = doc.getObject('inside').payload.start
    await editor.redo()
    renderer.panBy(-5000, 0)
    const second = await queryViewport()
    const unrelated = before === JSON.stringify(doc.getObject('outside'))
    const saved = await editor.save({ format: 'DXF', download: false })
    await editor.open(new File([saved], 'queried.dxf'))
    return { first: first.entities.map(e => e.id), second: second.entities.map(e => e.id), moved, undone, unrelated, reopened: editor.document.listEntities().some(e => JSON.stringify(e.payload.start) === '[-8,3,0]') }
  })
  expect(result).toEqual({ first: ['inside'], second: ['outside'], moved: [-8, 3, 0], undone: [-10, 0, 0], unrelated: true, reopened: true })
})
