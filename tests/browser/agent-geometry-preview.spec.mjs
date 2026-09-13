import { expect, test } from '@playwright/test'
import { mountingProfile } from '../../packages/kjdraw-sdk/examples/fixtures/mounting-profile.mjs'

test.use({ bypassCSP: true })

test('a moved construction line paints only a temporary reviewed overlay before approval', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [{ createKJDrawSDK }, { KJAgentToolSession }, { KJCanvasRenderer }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/agent-tools.js'), import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
    ])
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:640px;height:480px'
    document.body.replaceChildren(canvas)
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    await drawing.transact('guide', tx => tx.createEntity('XLINE', { origin: [1000000,0], direction: [1,0] }, { id: 'guide' }))
    const renderer = new KJCanvasRenderer(canvas, { document: drawing, grid: false, pixelRatio: 1 })
    renderer.resize(640,480); Object.assign(renderer.camera, { centerX: 0, centerY: 0, scale: 4 }); renderer.render()
    const pixel = () => {
      const [x,y] = renderer.worldToScreen([0,20])
      return JSON.stringify([...canvas.getContext('2d').getImageData(x-2,y-2,5,5).data])
    }
    const empty = pixel(), before = drawing.serialize(), session = new KJAgentToolSession(sdk, drawing)
    const result = await session.call('cad_propose_move', { expectedRevision: drawing.revision, units: 'millimeter', ids: ['guide'], dx: 0, dy: 20 })
    if (!result.ok) throw new Error(JSON.stringify(result))
    const proposal = result.value
    renderer.drawPreview(proposal.preview.after)
    const overlay = pixel() !== empty, unchanged = drawing.serialize() === before
    renderer.render(); const cleared = pixel() === empty
    const approved = await session.approve(proposal.planId, 'browser-test-reviewer')
    renderer.render(); const committed = pixel() !== empty
    const exact = JSON.stringify(drawing.getObject('guide').payload) === JSON.stringify(proposal.preview.after[0].payload)
    await sdk.executeCommand('UNDO'); renderer.render(); const undone = pixel() === empty
    renderer.dispose()
    return { overlay, unchanged, cleared, approved: approved.ok, committed, exact, undone }
  })
  expect(result).toEqual({ overlay: true, unchanged: true, cleared: true, approved: true, committed: true, exact: true, undone: true })
})

test('reviewed AI move, rotate and scale keep a native ellipse selectable and editable through reopen',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const [{createKJDrawSDK},{KJAgentToolSession},{KJCanvasRenderer}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/agent-tools.js'),import('/packages/kjdraw-sdk/src/canvas-renderer.js')])
    const canvas=document.createElement('canvas');canvas.style.cssText='width:640px;height:480px';document.body.replaceChildren(canvas)
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'})
    await drawing.transact('ellipse',tx=>tx.createEntity('ELLIPSE',{center:[10,0,0],majorAxis:[8,0,0],ratio:.5,startParameter:.2,endParameter:5.8},{id:'ellipse'}))
    const session=new KJAgentToolSession(sdk,drawing),previews=[],readOnly=[]
    for(const [name,extra]of [['cad_propose_move',{dx:5,dy:5}],['cad_propose_rotate',{center:{x:0,y:0},angleDegrees:90}],['cad_propose_scale',{center:{x:0,y:0},factor:2}]]){
      const before=drawing.serialize()
      const proposed=await session.call(name,{expectedRevision:drawing.revision,units:'millimeter',ids:['ellipse'],...extra})
      if(!proposed.ok)throw new Error(JSON.stringify(proposed));previews.push(proposed.value.preview.after[0]);readOnly.push(drawing.serialize()===before)
      const approved=await session.approve(proposed.value.planId,'browser-reviewer');if(!approved.ok)throw new Error(JSON.stringify(approved))
    }
    const final=drawing.getObject('ellipse'),renderer=new KJCanvasRenderer(canvas,{document:drawing,grid:false,pixelRatio:1}).fit(),report=renderer.render()
    const selected=renderer.hitTest(renderer.worldToScreen([-18,30]))?.entity.id
    await sdk.executeCommand('UNDO');const undo=drawing.getObject('ellipse').payload
    await sdk.executeCommand('REDO')
    const reopened=await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing,{format:'KJD'}),{format:'KJD'}),saved=reopened.listEntities({type:'ELLIPSE'})[0]
    renderer.dispose();const clean=values=>values.map(value=>Math.abs(value)<1e-10?0:Math.abs(value-Math.round(value))<1e-10?Math.round(value):value)
    return {sourceUnchangedBeforeApproval:readOnly.every(Boolean),types:previews.map(item=>item.type),center:clean(final.payload.center),axis:clean(final.payload.majorAxis),ratio:final.payload.ratio,parameters:[final.payload.startParameter,final.payload.endParameter],selected,unsupported:report.unsupported,undoCenter:clean(undo.center),saved:{center:clean(saved.payload.center),axis:clean(saved.payload.majorAxis),ratio:saved.payload.ratio}}
  })
  expect(result).toEqual({sourceUnchangedBeforeApproval:true,types:['ELLIPSE','ELLIPSE','ELLIPSE'],center:[-10,30,0],axis:[0,16,0],ratio:.5,parameters:[.2,5.8],selected:'ellipse',unsupported:0,undoCenter:[-5,15,0],saved:{center:[-10,30,0],axis:[0,16,0],ratio:.5}})
})

test('compact AI ellipse is reviewed, rendered, selectable and editable through reopen', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const [{ createKJDrawSDK }, { KJAgentToolSession }, { KJCanvasRenderer }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/agent-tools.js'), import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
    ])
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:640px;height:480px'; document.body.replaceChildren(canvas)
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, drawing)
    const renderer = new KJCanvasRenderer(canvas, { document: drawing, grid: false, pixelRatio: 1 })
    renderer.resize(640, 480); Object.assign(renderer.camera, { centerX: 0, centerY: 0, scale: 5 }); renderer.render()
    const before = drawing.serialize()
    const called = await session.call('cad_propose_drawing_compact', {
      expectedRevision: 0, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [], ellipses: [[0, 0, 30, 10, .4, 0, 360]],
    })
    if (!called.ok) throw new Error(JSON.stringify(called))
    const proposal = called.value
    renderer.drawPreview(proposal.preview.after)
    const previewHit = canvas.getContext('2d').getImageData(...renderer.worldToScreen([30, 10]).map(value => Math.floor(value) - 2), 5, 5).data.some(Boolean)
    const readOnly = drawing.serialize() === before
    renderer.render()
    const approved = await session.approve(proposal.planId, 'browser-reviewer')
    renderer.fit(); const rendered = renderer.render(), hit = renderer.hitTest(renderer.worldToScreen([30, 10]))?.entity
    await sdk.executeCommand('UNDO'); const undone = drawing.listEntities().length
    await sdk.executeCommand('REDO')
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(drawing, { format: 'KJD' }), { format: 'KJD' })
    const saved = reopened.listEntities({ type: 'ELLIPSE' })[0]
    renderer.dispose()
    return { previewHit, readOnly, approved: approved.ok, rendered: rendered.rendered, unsupported: rendered.unsupported, hitType: hit?.type, undone, saved: { type: saved.type, center: saved.payload.center, axis: saved.payload.majorAxis, ratio: saved.payload.ratio } }
  })
  expect(result).toEqual({ previewHit: true, readOnly: true, approved: true, rendered: 1, unsupported: 0, hitType: 'ELLIPSE', undone: 0, saved: { type: 'ELLIPSE', center: [0, 0, 0], axis: [30, 10, 0], ratio: .4 } })
})

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
