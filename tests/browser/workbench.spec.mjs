import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })

async function mountWorkbench(page, { maxFileBytes = 64 } = {}) {
  await page.goto('/')
  await page.evaluate(async ({ maxFileBytes }) => {
    document.body.replaceChildren()
    document.body.style.margin = '0'
    const form = document.createElement('form')
    form.id = 'workbench-form'
    const outside = document.createElement('button')
    outside.id = 'outside-tool'
    outside.className = 'tool'
    outside.type = 'button'
    outside.textContent = 'Host button'
    const host = document.createElement('div')
    host.id = 'workbench-host'
    host.style.width = '1100px'
    host.style.height = '720px'
    form.append(outside, host)
    document.body.append(form)

    const [{ createKJDrawSDK }, { KJDocument }, { mountKJDrawWorkbench }] = await Promise.all([
      import('/packages/kjdraw-sdk/src/sdk.js'),
      import('/packages/kjdraw-sdk/src/document.js'),
      import('/packages/kjdraw-sdk/src/workbench.js'),
    ])
    const sdk = createKJDrawSDK()
    const drawing = sdk.createDocument({ documentId: 'workbench-browser-test', units: 'millimeter' })
    const layerId = drawing.getTable('layers').currentId
    const line = await sdk.executeCommand('CREATE', {
      type: 'LINE', payload: { start: [0, 0, 0], end: [20, 0, 0], layerId },
    }, { document: drawing })
    let submits = 0
    form.addEventListener('submit', event => { event.preventDefault(); submits += 1 })
    const workbench = mountKJDrawWorkbench(host, { sdk, document: drawing, maxFileBytes })
    await workbench.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.renderer.resize()
    workbench.renderer.fit()
    window.__workbenchTest = { workbench, sdk, drawing, line, KJDocument, get submits() { return submits } }
  }, { maxFileBytes })
}

async function canvasPoint(page, world) {
  return page.evaluate(world => {
    const { workbench } = window.__workbenchTest
    const canvas = workbench.root.querySelector('[data-canvas]')
    const rect = canvas.getBoundingClientRect()
    const point = workbench.renderer.worldToScreen(world)
    return { x: rect.left + point[0], y: rect.top + point[1] }
  }, world)
}

async function expectLineStartsWithinPixels(page, expected, tolerancePixels) {
  await expect.poll(() => page.evaluate(({ expected, tolerancePixels }) => {
    const { workbench, drawing } = window.__workbenchTest
    const scale = workbench.renderer.camera.scale
    const starts = drawing.listEntities({ type: 'LINE' })
      .map(entity => entity.payload.start)
      .sort((a, b) => a[0] - b[0])
    return {
      count: starts.length,
      zIsExact: starts.every(start => start[2] === 0),
      withinPixelTolerance: starts.length === expected.length && starts.every((start, index) =>
        Math.hypot(start[0] - expected[index][0], start[1] - expected[index][1]) * scale <= tolerancePixels),
    }
  }, { expected, tolerancePixels })).toEqual({ count: expected.length, zIsExact: true, withinPixelTolerance: true })
}

test('TTR command uses two selected finite lines, previews a unique solution, and creates one exact circle', async ({ page }) => {
  await mountWorkbench(page)
  await page.evaluate(async () => {
    const { workbench, sdk, drawing, line } = window.__workbenchTest
    await sdk.executeCommand('ERASE', { ids: [line.id] }, { document: drawing })
    const horizontal = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-100,0,0], end: [100,0,0] } }, { document: drawing })
    const vertical = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0,-100,0], end: [0,100,0] } }, { document: drawing })
    sdk.getSelectionManager(drawing.id).active.replace([horizontal.id, vertical.id])
    workbench.renderer.setSelection([horizontal.id, vertical.id])
  })
  const root = page.locator('.kjwb'), input = root.locator('[data-command]')
  await input.fill('CIRCLETTR 10'); await input.press('Enter')
  await expect(root.locator('[data-hint]')).toContainText('tangent-circle solution')
  await input.fill('20,30'); await input.press('Enter')
  await expect.poll(() => page.evaluate(() => {
    const circle = window.__workbenchTest.drawing.listEntities({ type: 'CIRCLE' })[0]
    return circle ? { center: circle.payload.center, radius: circle.payload.radius } : null
  })).toEqual({ center: [10,10,0], radius: 10 })
  await input.fill('UNDO'); await input.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__workbenchTest.drawing.listEntities({ type: 'CIRCLE' }).length)).toBe(0)
})

test('page settings click and Enter never submit or validate the surrounding host form', async ({ page }) => {
  await mountWorkbench(page)
  await page.evaluate(() => {
    const required = document.createElement('input'); required.required = true
    document.querySelector('#workbench-form').prepend(required)
  })
  const root = page.locator('.kjwb'), modal = root.locator('[data-page-dialog]')
  await root.locator('[data-action="page-setup"]').click()
  await expect(modal).toBeVisible()
  await expect(root.locator('form')).toHaveCount(0)
  await modal.locator('[data-page-field="paperWidth"]').fill('-1')
  await modal.locator('[data-page-field="paperWidth"]').press('Enter')
  await expect(modal).toBeVisible()
  await modal.locator('[data-page-field="paperWidth"]').fill('594')
  await modal.locator('[data-page-field="paperWidth"]').press('Enter')
  await expect(modal).not.toBeVisible()
  await root.locator('[data-action="page-setup"]').click()
  await modal.locator('[data-page-field="paperHeight"]').fill('841')
  await modal.locator('[data-action="apply-page"]').click()
  await expect(modal).not.toBeVisible()
  expect(await page.evaluate(() => {
    const { workbench, submits } = window.__workbenchTest
    return { submits, settings: workbench.document.getObject(workbench.document.snapshot().spaces.activeLayoutId).payload.dxfPlotSettings }
  })).toEqual({ submits: 0, settings: { paperWidth: 594, paperHeight: 841 } })
})

test('embeddable workbench isolates its UI and keeps document, locale, selection and snapping coherent', async ({ page }) => {
  await mountWorkbench(page)

  const initial = await page.evaluate(() => {
    const state = window.__workbenchTest
    const hostButtons = [...state.workbench.root.querySelectorAll('button')]
    return {
      count: state.workbench.snapshot().entityCount,
      allButtonsAreSafe: hostButtons.every(button => button.type === 'button'),
      outsideDisplay: getComputedStyle(document.querySelector('#outside-tool')).display,
      chrome: getComputedStyle(state.workbench.root.querySelector('.appbar')).backgroundColor,
      rowHeights: [
        state.workbench.root.querySelector('.appbar').offsetHeight,
        state.workbench.root.querySelector('.ribbon').offsetHeight,
        state.workbench.root.querySelector('.statusbar').offsetHeight,
      ],
      svgTools: state.workbench.root.querySelectorAll('.ribbon .kj-icon').length,
      iconFill: getComputedStyle(state.workbench.root.querySelector('.ribbon .kj-icon')).fill,
      toolDisplay: getComputedStyle(state.workbench.root.querySelector('.ribbon .tool')).display,
    }
  })
  expect(initial).toEqual({
    count: 1,
    allButtonsAreSafe: true,
    outsideDisplay: 'inline-block',
    chrome: 'rgb(246, 247, 249)',
    rowHeights: [44, 92, 32],
    svgTools: 22,
    iconFill: 'none',
    toolDisplay: 'grid',
  })

  await page.locator('#workbench-host [data-action="toggle-layers"]').click()
  await expect(page.locator('#workbench-host .side.layers')).toBeHidden()
  await page.locator('#workbench-host [data-action="toggle-layers"]').click()
  await expect(page.locator('#workbench-host .side.layers')).toBeVisible()
  expect(await page.evaluate(() => {
    const { workbench, drawing } = window.__workbenchTest
    return { sameDocument: workbench.document === drawing, revision: drawing.revision }
  })).toEqual({ sameDocument: true, revision: 1 })

  await page.locator('#workbench-host [data-action="language"]').click()
  const localized = await page.evaluate(() => {
    const { workbench, drawing, submits } = window.__workbenchTest
    return {
      locale: workbench.locale,
      sameDocument: workbench.document === drawing,
      documentId: workbench.snapshot().documentId,
      revision: workbench.snapshot().revision,
      open: workbench.root.querySelector('[data-copy="open"]').textContent,
      submits,
    }
  })
  expect(localized).toEqual({ locale: 'zh-CN', sameDocument: true, documentId: 'workbench-browser-test', revision: 1, open: '打开', submits: 0 })

  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__workbenchTest
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
  })
  await expect(page.locator('#workbench-host [data-inspector]')).toContainText('LINE')
  expect(await page.evaluate(() => window.__workbenchTest.workbench.snapshot().selectedIds)).toEqual([
    await page.evaluate(() => window.__workbenchTest.line.id),
  ])

  const identityAndLimit = await page.evaluate(async () => {
    const { workbench, drawing, KJDocument } = window.__workbenchTest
    let identity = ''
    let limit = ''
    try { await workbench.setDocument(KJDocument.create({ documentId: drawing.id })) } catch (error) { identity = error.message }
    try { await workbench.open(new Uint8Array(65), { format: 'KJD' }) } catch (error) { limit = error.message }
    return { identity, limit, sameDocument: workbench.document === drawing }
  })
  expect(identityAndLimit.identity).toContain('different KJDraw document')
  expect(identityAndLimit.limit).toContain('65 > 64 bytes')
  expect(identityAndLimit.sameDocument).toBe(true)

  await page.locator('#workbench-host [data-tool="line"]').click()
  const endpoint = await canvasPoint(page, [0, 0])
  await page.mouse.move(endpoint.x, endpoint.y)
  await expect(page.locator('#workbench-host [data-snap]')).toHaveCSS('display', 'block')

  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__workbenchTest
    await sdk.executeCommand('LAYERUPDATE', { id: line.payload.layerId, patch: { visible: false } }, { document: drawing })
  })
  await page.mouse.move(endpoint.x + 30, endpoint.y + 30)
  await page.mouse.move(endpoint.x, endpoint.y)
  await expect(page.locator('#workbench-host [data-snap]')).toHaveCSS('display', 'none')
})

test('drawing tools, rubber-band preview and command bar execute real SDK edits', async ({ page }) => {
  await mountWorkbench(page, { maxFileBytes: 1024 })
  const command = page.locator('#workbench-host [data-command]')

  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__workbenchTest
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
  })
  await command.fill('MOVE 10 5')
  await command.press('Enter')
  expect(await page.evaluate(() => window.__workbenchTest.drawing.getObject(window.__workbenchTest.line.id).payload.start)).toEqual([10, 5, 0])

  await command.fill('COPY 5 0')
  await command.press('Enter')
  await command.fill('ROTATE 90')
  await command.press('Enter')
  await command.fill('OFFSET 2')
  await command.press('Enter')
  await expect(page.locator('#workbench-host [data-modification-dialog]')).toBeVisible()
  await page.locator('#workbench-host [data-action="start-modification"]').click()
  const offsetSide = await canvasPoint(page, [13, 5])
  await page.mouse.click(offsetSide.x, offsetSide.y)
  expect(await page.evaluate(() => window.__workbenchTest.drawing.listEntities({ type: 'LINE' }).length)).toBe(3)

  await page.locator('#workbench-host [data-tool="polyline"]').click()
  const polylinePoints = await Promise.all([[5, 2], [10, 5], [15, 2]].map(value => canvasPoint(page, value)))
  await page.mouse.click(polylinePoints[0].x, polylinePoints[0].y)
  await page.mouse.click(polylinePoints[1].x, polylinePoints[1].y)
  await page.mouse.move(polylinePoints[2].x, polylinePoints[2].y)
  const previewPixels = await page.evaluate(() => {
    const canvas = window.__workbenchTest.workbench.root.querySelector('[data-overlay]')
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let pixels = 0
    for (let index = 3; index < data.length; index += 4) if (data[index]) pixels += 1
    return pixels
  })
  expect(previewPixels).toBeGreaterThan(10)
  await page.mouse.click(polylinePoints[2].x, polylinePoints[2].y)
  await page.keyboard.press('Enter')

  await page.locator('#workbench-host [data-tool="arc"]').click()
  for (const value of [[10, 0], [15, 0], [10, 5]]) {
    const location = await canvasPoint(page, value)
    await page.mouse.click(location.x, location.y)
  }

  await command.fill('TEXT Hello KJDraw')
  await command.press('Enter')
  const textPoint = await canvasPoint(page, [8, 8])
  await page.mouse.click(textPoint.x, textPoint.y)

  const entities = await page.evaluate(() => window.__workbenchTest.drawing.listEntities().map(entity => ({ type: entity.type, text: entity.payload.text ?? null, vertexCount: Array.isArray(entity.payload.vertices) ? entity.payload.vertices.length : null })))
  expect(entities.filter(entity => entity.type === 'LWPOLYLINE')).toHaveLength(1)
  expect(entities.find(entity => entity.type === 'LWPOLYLINE').vertexCount).toBe(3)
  expect(entities.filter(entity => entity.type === 'ARC')).toHaveLength(1)
  expect(entities).toContainEqual({ type: 'TEXT', text: 'Hello KJDraw', vertexCount: null })
})

test('CAD aliases, coordinate entry, retry and edit controls create real document entities', async ({ page }) => {
  await mountWorkbench(page, { maxFileBytes: 1024 })
  const command = page.locator('#workbench-host [data-command]')
  const enter = async value => {
    await command.fill(value)
    await command.press('Enter')
    await expect(command).toHaveValue('')
  }

  await enter('CIRCLE3P')
  await enter('0,0')
  await enter('10,0')
  await page.evaluate(async () => {
    const { sdk, drawing } = window.__workbenchTest
    await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [40, 40, 0] } }, { document: drawing })
  })
  await enter('5,5')
  await expect(page.locator('#workbench-host [data-message]')).toContainText('Document revision conflict')
  await enter('5,5')

  await enter('ARC3P')
  for (const coordinate of ['0,10', '5,15', '10,10']) await enter(coordinate)
  await enter('DIMALIGNED')
  for (const coordinate of ['0,20', '@10,0', '5,24']) await enter(coordinate)

  await page.locator('#workbench-host [data-action="draft"]').click()
  await page.locator('#workbench-host [data-draft-tool]').selectOption('polygon')
  await page.locator('#workbench-host [data-draft-option="sides"]').fill('5')
  await page.locator('#workbench-host [data-action="start-draft"]').click()
  await enter('20,0')
  await enter('@5,0')

  expect(await page.evaluate(() => {
    const entities = window.__workbenchTest.drawing.listEntities()
    const polygon = entities.find(entity => entity.type === 'LWPOLYLINE')
    return {
      circles: entities.filter(entity => entity.type === 'CIRCLE').length,
      arcs: entities.filter(entity => entity.type === 'ARC').length,
      dimensions: entities.filter(entity => entity.type === 'DIMENSION').length,
      polygon: polygon ? { closed: polygon.payload.closed, vertices: polygon.payload.vertices.length } : null,
    }
  })).toEqual({ circles: 1, arcs: 1, dimensions: 1, polygon: { closed: true, vertices: 5 } })

  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__workbenchTest
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
  })
  await page.locator('#workbench-host [data-action="modify"]').click()
  await page.locator('#workbench-host [data-modification]').selectOption('array-rect')
  await page.locator('#workbench-host [data-modification-field="rows"]').fill('2')
  await page.locator('#workbench-host [data-modification-field="columns"]').fill('2')
  await page.locator('#workbench-host [data-modification-field="rowSpacing"]').fill('8')
  await page.locator('#workbench-host [data-modification-field="columnSpacing"]').fill('12')
  await page.locator('#workbench-host [data-action="start-modification"]').click()

  await expect.poll(() => page.evaluate(() => window.__workbenchTest.drawing.listEntities({ type: 'LINE' }).length)).toBe(4)
  expect(await page.evaluate(() => window.__workbenchTest.workbench.snapshot().selectedIds.length)).toBe(3)
})

test('mouse move, copy, direct drag and layouts preserve the mounted drawing and history', async ({ page }) => {
  await mountWorkbench(page, { maxFileBytes: 1024 })
  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__workbenchTest
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
  })

  await page.locator('#workbench-host [data-tool="move"]').click()
  const base = await canvasPoint(page, [0, 0])
  const destination = await canvasPoint(page, [10, 5])
  await page.mouse.click(base.x, base.y)
  await page.mouse.move(destination.x, destination.y)
  const previewPixels = await page.evaluate(() => {
    const canvas = window.__workbenchTest.workbench.root.querySelector('[data-overlay]')
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let pixels = 0
    for (let index = 3; index < data.length; index += 4) if (data[index]) pixels += 1
    return pixels
  })
  expect(previewPixels).toBeGreaterThan(10)
  await page.mouse.click(destination.x, destination.y)
  await expectLineStartsWithinPixels(page, [[10, 5]], 1.5)
  const movedStart = await page.evaluate(() => [...window.__workbenchTest.drawing.getObject(window.__workbenchTest.line.id).payload.start])

  await page.locator('#workbench-host [data-action="undo"]').click()
  await expect.poll(() => page.evaluate(() => window.__workbenchTest.drawing.getObject(window.__workbenchTest.line.id).payload.start)).toEqual([0, 0, 0])
  await page.locator('#workbench-host [data-action="redo"]').click()
  await expect.poll(() => page.evaluate(() => window.__workbenchTest.drawing.getObject(window.__workbenchTest.line.id).payload.start)).toEqual(movedStart)

  const dragBase = await canvasPoint(page, [20, 5])
  const dragDestination = await canvasPoint(page, [25, 8])
  await page.mouse.move(dragBase.x, dragBase.y)
  await page.mouse.down()
  await page.mouse.move(dragDestination.x, dragDestination.y, { steps: 4 })
  await page.mouse.up()
  await expectLineStartsWithinPixels(page, [[movedStart[0] + 5, movedStart[1] + 3]], 1.5)
  const draggedStart = await page.evaluate(() => [...window.__workbenchTest.drawing.getObject(window.__workbenchTest.line.id).payload.start])

  await page.evaluate(async () => {
    const { sdk, drawing } = window.__workbenchTest
    await sdk.executeCommand('SELECT', { ids: [], operation: 'clear' }, { document: drawing })
  })
  await page.locator('#workbench-host [data-action="nav-fit"]').click()
  await page.locator('#workbench-host [data-tool="copy"]').click()
  const selectPoint = await canvasPoint(page, [25, 8])
  await page.mouse.click(selectPoint.x, selectPoint.y)
  await expect.poll(() => page.evaluate(() => window.__workbenchTest.workbench.snapshot().selectedIds.length)).toBe(1)
  const copyBase = await canvasPoint(page, [15, 8])
  await page.mouse.click(copyBase.x, copyBase.y)

  await page.locator('#workbench-host [data-layout]').selectOption('compact')
  await page.locator('#workbench-host [data-layout]').selectOption('focus')
  const preserved = await page.evaluate(() => {
    const { workbench, drawing } = window.__workbenchTest
    return { layout: workbench.layout, tool: workbench.tool, sameDocument: workbench.document === drawing, count: workbench.snapshot().entityCount }
  })
  expect(preserved).toEqual({ layout: 'focus', tool: 'copy', sameDocument: true, count: 1 })
  await expect(page.locator('#workbench-host .ribbon')).toBeHidden()
  await expect(page.locator('#workbench-host .navigator button')).toHaveCount(5)
  await expect(page.locator('#workbench-host .navigator')).toBeVisible()
  await expect(page.locator('#workbench-host .command')).toBeVisible()
  await expect(page.locator('#workbench-host [data-action="toggle-layers"]')).toBeHidden()
  await expect(page.locator('#workbench-host [data-action="toggle-inspector"]')).toBeHidden()
  const focusCanvas = await page.locator('#workbench-host .canvas-wrap').boundingBox()
  expect(focusCanvas?.height ?? 0).toBeGreaterThan(300)

  const copyDestination = await canvasPoint(page, [25, 10])
  await page.mouse.click(copyDestination.x, copyDestination.y)
  await expectLineStartsWithinPixels(page, [draggedStart, [draggedStart[0] + 10, draggedStart[1] + 2, 0]], 1.5)

  await page.locator('#workbench-host [data-layout]').selectOption('classic')
  expect(await page.evaluate(() => {
    const { workbench, drawing } = window.__workbenchTest
    const shortcut = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    workbench.root.dispatchEvent(shortcut)
    return { layout: workbench.layout, sameDocument: workbench.document === drawing, canUndo: drawing.history.canUndo, shortcutPrevented: shortcut.defaultPrevented }
  })).toEqual({ layout: 'classic', sameDocument: true, canUndo: true, shortcutPrevented: false })
})

test('ribbon groups keep every tool inside its own hit area in both languages and layouts', async ({ page }) => {
  await mountWorkbench(page, { maxFileBytes: 1024 })
  for (const layout of ['classic', 'compact']) {
    await page.locator('#workbench-host [data-layout]').selectOption(layout)
    for (let language = 0; language < 2; language += 1) {
      const overflow = await page.locator('#workbench-host .ribbon').evaluate(ribbon =>
        [...ribbon.querySelectorAll('.group')].flatMap(group => {
          const bounds = group.getBoundingClientRect()
          return [...group.querySelectorAll('button')].filter(button => {
            const tool = button.getBoundingClientRect()
            return tool.left < bounds.left - .5 || tool.right > bounds.right + .5
          }).map(button => button.textContent.trim())
        }))
      expect(overflow).toEqual([])
      await page.locator('#workbench-host [data-action="draft"]').click()
      await expect(page.locator('#workbench-host [data-draft-tool]')).toBeVisible()
      await page.keyboard.press('Escape')
      await page.locator('#workbench-host [data-action="language"]').click()
    }
  }
})

test('transform gestures stay bound to their starting document, revision and entities', async ({ page }) => {
  await mountWorkbench(page, { maxFileBytes: 1024 })
  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__workbenchTest
    const target = sdk.createDocument({ documentId: 'gesture-target', units: 'millimeter' })
    const layerId = target.getTable('layers').currentId
    const targetLine = await sdk.executeCommand('CREATE', {
      type: 'LINE', payload: { start: [100, 100, 0], end: [120, 100, 0], layerId },
    }, { document: target })
    sdk.setActiveDocument(drawing.id)
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
    Object.assign(window.__workbenchTest, { target, targetLine })
  })

  await page.locator('#workbench-host [data-tool="move"]').click()
  const sourceBase = await canvasPoint(page, [0, 0])
  await page.mouse.click(sourceBase.x, sourceBase.y)
  await page.evaluate(async () => { await window.__workbenchTest.workbench.setDocument(window.__workbenchTest.target) })
  const targetClick = await canvasPoint(page, [110, 100])
  await page.mouse.click(targetClick.x, targetClick.y)
  expect(await page.evaluate(() => {
    const { drawing, line, target, targetLine } = window.__workbenchTest
    return {
      sourceRevision: drawing.revision,
      sourceStart: drawing.getObject(line.id).payload.start,
      targetRevision: target.revision,
      targetStart: target.getObject(targetLine.id).payload.start,
    }
  })).toEqual({ sourceRevision: 1, sourceStart: [0, 0, 0], targetRevision: 1, targetStart: [100, 100, 0] })

  await page.evaluate(async () => {
    const { sdk, workbench, drawing, line } = window.__workbenchTest
    await workbench.setDocument(drawing)
    const layerId = drawing.getTable('layers').currentId
    const secondLine = await sdk.executeCommand('CREATE', {
      type: 'LINE', payload: { start: [0, 20, 0], end: [20, 20, 0], layerId },
    }, { document: drawing })
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
    window.__workbenchTest.secondLine = secondLine
  })
  await page.locator('#workbench-host [data-tool="move"]').click()
  const base = await canvasPoint(page, [0, 0])
  await page.mouse.click(base.x, base.y)
  await page.evaluate(async () => {
    const { sdk, drawing, secondLine } = window.__workbenchTest
    await sdk.executeCommand('SELECT', { ids: [secondLine.id], operation: 'replace' }, { document: drawing })
  })
  const destination = await canvasPoint(page, [5, 5])
  await page.mouse.click(destination.x, destination.y)
  // Pointer events quantize CSS pixels; only the mouse displacement gets this tolerance.
  await expectLineStartsWithinPixels(page, [[0, 20], [5, 5]], 1.5)
  const movedStart = await page.evaluate(() => window.__workbenchTest.drawing.getObject(window.__workbenchTest.line.id).payload.start)
  expect(await page.evaluate(() => window.__workbenchTest.drawing.getObject(window.__workbenchTest.secondLine.id).payload.start)).toEqual([0, 20, 0])

  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__workbenchTest
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
  })
  await page.locator('#workbench-host [data-tool="move"]').click()
  const conflictBase = await canvasPoint(page, [5, 5])
  await page.mouse.click(conflictBase.x, conflictBase.y)
  await page.evaluate(async () => {
    const { sdk, drawing } = window.__workbenchTest
    await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [40, 40, 0] } }, { document: drawing })
  })
  const conflictDestination = await canvasPoint(page, [10, 5])
  await page.mouse.click(conflictDestination.x, conflictDestination.y)
  expect(await page.evaluate(() => window.__workbenchTest.drawing.getObject(window.__workbenchTest.line.id).payload.start)).toEqual(movedStart)
  await expect(page.locator('#workbench-host [data-message]')).toContainText('Document revision conflict')

  await page.locator('#workbench-host [data-tool="move"]').click()
  await page.mouse.click(conflictBase.x, conflictBase.y)
  const command = page.locator('#workbench-host [data-command]')
  await command.fill('MOVE')
  await command.press('Escape')
  expect(await page.evaluate(() => window.__workbenchTest.workbench.tool)).toBe('select')
  const revisionAfterEscape = await page.evaluate(() => window.__workbenchTest.drawing.revision)
  await page.mouse.click(conflictDestination.x, conflictDestination.y)
  expect(await page.evaluate(() => window.__workbenchTest.drawing.revision)).toBe(revisionAfterEscape)
})

test('direct drag freezes its targets and camera until pointer release', async ({ page }) => {
  await mountWorkbench(page, { maxFileBytes: 1024 })
  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__workbenchTest
    const layerId = drawing.getTable('layers').currentId
    const secondLine = await sdk.executeCommand('CREATE', {
      type: 'LINE', payload: { start: [0, 20, 0], end: [20, 20, 0], layerId },
    }, { document: drawing })
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
    window.__workbenchTest.secondLine = secondLine
  })

  // Pick the line body, clear of the new endpoint and midpoint grips.
  const dragBase = await canvasPoint(page, [5, 0])
  const dragDestination = await canvasPoint(page, [10, 5])
  expect(await page.evaluate(() => {
    const { workbench, line } = window.__workbenchTest
    const screen = workbench.renderer.worldToScreen([5, 0])
    return {
      tool: workbench.tool,
      selected: workbench.snapshot().selectedIds.includes(line.id),
      hit: workbench.renderer.hitTest(screen, 9)?.entity.id === line.id,
    }
  })).toEqual({ tool: 'select', selected: true, hit: true })
  const scrollBeforeDrag = await page.evaluate(() => scrollY)
  await page.mouse.move(dragBase.x, dragBase.y)
  await page.mouse.down()
  await expect(page.locator('#workbench-host .cad-canvas')).toHaveClass(/dragging/)
  expect(await page.evaluate(() => scrollY)).toBe(scrollBeforeDrag)
  const scaleBeforeWheel = await page.evaluate(() => window.__workbenchTest.workbench.renderer.camera.scale)
  await page.mouse.wheel(0, 240)
  expect(await page.evaluate(() => window.__workbenchTest.workbench.renderer.camera.scale)).toBe(scaleBeforeWheel)
  await page.evaluate(async () => {
    const { sdk, drawing, secondLine } = window.__workbenchTest
    await sdk.executeCommand('SELECT', { ids: [secondLine.id], operation: 'replace' }, { document: drawing })
  })
  await page.mouse.move(dragDestination.x, dragDestination.y, { steps: 4 })
  await page.mouse.up()
  await expectLineStartsWithinPixels(page, [[0, 20], [5, 5]], 1.5)
  const draggedStart = await page.evaluate(() => window.__workbenchTest.drawing.getObject(window.__workbenchTest.line.id).payload.start)
  expect(await page.evaluate(() => window.__workbenchTest.drawing.getObject(window.__workbenchTest.secondLine.id).payload.start)).toEqual([0, 20, 0])

  await page.evaluate(async () => {
    const { sdk, drawing, line } = window.__workbenchTest
    await sdk.executeCommand('SELECT', { ids: [line.id], operation: 'replace' }, { document: drawing })
  })
  const conflictBase = await canvasPoint(page, [10, 5])
  const conflictDestination = await canvasPoint(page, [15, 10])
  await page.mouse.move(conflictBase.x, conflictBase.y)
  await page.mouse.down()
  await page.evaluate(async () => {
    const { sdk, drawing } = window.__workbenchTest
    await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [40, 40, 0] } }, { document: drawing })
  })
  await page.mouse.move(conflictDestination.x, conflictDestination.y, { steps: 4 })
  await page.mouse.up()
  expect(await page.evaluate(() => window.__workbenchTest.drawing.getObject(window.__workbenchTest.line.id).payload.start)).toEqual(draggedStart)
  await expect(page.locator('#workbench-host [data-message]')).toContainText('Drawing or view changed')
})
