import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test('AI creates native minor and reflex angle dimensions with visible arcs, exact host approval and native round trips', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const result = await page.evaluate(async () => {
    const [{ createKJDrawSDK }, { KJAgentToolSession }, { KJCanvasRenderer }, { projectDimension }, { createKJModelAdapter }, { runKJAgentTask }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'), import('/packages/kjdraw-sdk/src/agent-tools.js'), import('/packages/kjdraw-sdk/src/canvas-renderer.js'),
      import('/packages/kjdraw-sdk/src/geometry/annotation.js'), import('/packages/kjdraw-sdk/src/model-adapters.js'), import('/packages/kjdraw-sdk/src/agent-runner.js'),
    ])
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
    await drawing.transact('Existing bracket datum', tx => tx.createEntity('LINE', { start: [0, 0], end: [40, 0] }, { id: 'datum' }))
    const original = drawing.serialize(), originalDatum = JSON.stringify(drawing.getObject('datum'))
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:960px;height:640px;position:fixed;left:0;top:0;z-index:9999'; document.body.append(canvas)
    canvas.getContext('2d', { willReadFrequently: true })
    const renderer = new KJCanvasRenderer(canvas, { document: drawing, pixelRatio: 1, grid: false, theme: 'light' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const camera = { centerX: 8, centerY: 6, scale: 8 }
    renderer.resize(960, 640); Object.assign(renderer.camera, camera)
    let labels = []
    const nativeText = renderer.context.fillText
    renderer.context.fillText = function(text, ...args) { labels.push(String(text)); return nativeText.call(this, text, ...args) }
    const render = () => { labels = []; renderer.render(); return { png: canvas.toDataURL(), labels: [...labels] } }
    const before = render(), session = new KJAgentToolSession(sdk, drawing)
    const ref = (source, id, feature, vertexIndex) => ({ source, id, feature, ...(vertexIndex === undefined ? {} : { vertexIndex }) })
    const annotation = position => ({ center: ref('document', 'datum', 'start'), first: ref('document', 'datum', 'end'), second: ref('proposal', 'lines:0', 'end'), position, height: 1.2 })
    const input = {
      expectedRevision: drawing.revision, units: 'millimeter',
      lines: [[0, 0, 0, 35]], circles: [[22, 3, 1.5], [3, 22, 1.5]], arcs: [],
      polylines: [{ points: [[0, 0], [40, 0], [40, 6], [6, 6], [6, 35], [0, 35]], closed: true }], arrays: [],
      texts: [{ text: 'BRACKET A-17', position: { x: -18, y: -29 }, height: 2, rotationDegrees: 0 }],
      alignedDimensions: [{ from: ref('proposal', 'polylines:0', 'vertex', 0), to: ref('proposal', 'polylines:0', 'vertex', 1), position: { x: 0, y: -25 }, height: 1.2 }],
      rotatedDimensions: [], radiusDimensions: [], diameterDimensions: [], angularDimensions: [annotation({ x: 8, y: 8 }), annotation({ x: -13, y: -13 })],
      styles: [{ name: 'Angles', sources: ['angularDimensions:0', 'angularDimensions:1'], pattern: [], color: 1, lineweight: 18 }],
    }
    let requests = 0, optionalSchema = false
    const model = createKJModelAdapter({ protocol: 'chat-completions', model: 'offline-browser-angle-protocol', request: async ({ body }) => {
      requests++
      const schema = body.tools[0].function.parameters
      optionalSchema = !schema.required.includes('angularDimensions') && schema.properties.angularDimensions.items.additionalProperties === false
      return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', id: 'angular-proposal', function: { name: 'cad_propose_drawing_annotated', arguments: JSON.stringify(input) } }] } }] }
    } })
    const run = await runKJAgentTask({ session, model, prompt: 'Complete bracket A-17, dimension its width and both 90-degree and 270-degree sectors.', toolNames: ['cad_propose_drawing_annotated'] })
    if (run.status !== 'awaiting-approval' || !run.outputs[0]?.result.ok) throw new Error(JSON.stringify(run))
    const plan = run.outputs[0].result.value
    labels = []; renderer.drawPreview(plan.preview.after, '#ff0000')
    const preview = { png: canvas.toDataURL(), labels: [...labels] }
    const redAt = point => {
      const pixel = renderer.worldToScreen(point), pixels = renderer.context.getImageData(Math.round(pixel[0]) - 3, Math.round(pixel[1]) - 3, 7, 7).data
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > pixels[i + 1] + 80 && pixels[i] > pixels[i + 2] + 80) return true
      return false
    }
    const arcInk = [redAt([8, 8]), redAt([-13, -13])]
    const readOnly = drawing.serialize() === original
    const approval = await session.approve(plan.planId, 'browser-host')
    if (!approval.ok) throw new Error(JSON.stringify(approval))
    const approved = render()
    const exact = plan.preview.after.every(entity => JSON.stringify(drawing.getObject(entity.id).payload) === JSON.stringify(entity.payload))
    const sourceUnchanged = JSON.stringify(drawing.getObject('datum')) === originalDatum
    const nativeAngles = doc => doc.listEntities({ type: 'DIMENSION', ownerId: doc.snapshot().spaces.modelSpaceId }).filter(entity => entity.payload.dimensionType === 'ANGULAR_3_POINT').map(entity => ({ type: entity.payload.dimensionType, points: entity.payload.definitionPoints, measurement: projectDimension(entity.payload).measurement, textOverride: entity.payload.textOverride })).sort((a, b) => a.measurement - b.measurement)
    const native = nativeAngles(drawing)
    await drawing.undo(); const undo = render(), undoExact = drawing.listEntities().length === 1 && JSON.stringify(drawing.getObject('datum')) === originalDatum
    await drawing.redo(); const redo = render()
    const roundTrips = {}
    let dxf
    for (const format of ['KJD', 'DXF']) {
      const bytes = await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
      if (format === 'DXF') dxf = bytes
      const reopened = await createKJDrawSDK().readDocument(bytes, { format })
      renderer.setDocument(reopened); Object.assign(renderer.camera, camera)
      roundTrips[format] = { ...render(), native: nativeAngles(reopened) }
    }
    renderer.context.fillText = nativeText; renderer.dispose(); canvas.remove()
    return { before, preview, approved, undo, redo, roundTrips, native, dxf, readOnly, sourceUnchanged, exact, undoExact, arcInk, requests, optionalSchema, revisionDelta: approval.value.afterRevision - approval.value.beforeRevision }
  })
  await mkdir('.cache/agent-angular-annotations', { recursive: true })
  await writeFile('.cache/agent-angular-annotations/approved.dxf', result.dxf)
  for (const name of ['before', 'preview', 'approved', 'undo', 'redo']) {
    const bytes = Buffer.from(result[name].png.split(',')[1], 'base64')
    await writeFile('.cache/agent-angular-annotations/' + name + '.png', bytes)
    await testInfo.attach(name, { body: bytes, contentType: 'image/png' })
  }
  for (const format of ['KJD', 'DXF']) await writeFile('.cache/agent-angular-annotations/' + format + '.png', Buffer.from(result.roundTrips[format].png.split(',')[1], 'base64'))
  expect(result.readOnly).toBe(true); expect(result.sourceUnchanged).toBe(true); expect(result.exact).toBe(true); expect(result.undoExact).toBe(true)
  expect(result.arcInk).toEqual([true, true]); expect(result.requests).toBe(1); expect(result.optionalSchema).toBe(true); expect(result.revisionDelta).toBe(1)
  expect(result.native.map(item => item.measurement)).toEqual([90, 270])
  expect(result.native.every(item => item.type === 'ANGULAR_3_POINT' && item.textOverride === null)).toBe(true)
  expect(result.preview.labels.sort()).toEqual(['40', '90°', '270°', 'BRACKET A-17'].sort())
  expect(result.approved.labels.sort()).toEqual(result.preview.labels.sort())
  expect(result.undo.png).toBe(result.before.png); expect(result.redo.png).toBe(result.approved.png)
  for (const format of ['KJD', 'DXF']) {
    if (format === 'KJD') expect(result.roundTrips[format].native).toEqual(result.native)
    else {
      // Native DXF directs reflex arcs by swapping the ray endpoints. Preserve
      // exact anchors, placement and measured sector, allowing only that swap.
      const nativeGeometry = rows => rows.map(({ points, ...rest }) => ({ ...rest, center: points[3], placement: points[0], rays: points.slice(1, 3).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }))
      expect(nativeGeometry(result.roundTrips[format].native)).toEqual(nativeGeometry(result.native))
    }
    expect(result.roundTrips[format].png === result.approved.png, format + ' must preserve every pixel').toBe(true)
  }
})

