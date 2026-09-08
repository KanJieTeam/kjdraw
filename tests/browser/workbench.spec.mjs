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

test('embeddable workbench isolates its UI and keeps document, locale, selection and snapping coherent', async ({ page }) => {
  await mountWorkbench(page)

  const initial = await page.evaluate(() => {
    const state = window.__workbenchTest
    const hostButtons = [...state.workbench.root.querySelectorAll('button')]
    return {
      count: state.workbench.snapshot().entityCount,
      allButtonsAreSafe: hostButtons.every(button => button.type === 'button'),
      outsideDisplay: getComputedStyle(document.querySelector('#outside-tool')).display,
    }
  })
  expect(initial).toEqual({ count: 1, allButtonsAreSafe: true, outsideDisplay: 'inline-block' })

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
