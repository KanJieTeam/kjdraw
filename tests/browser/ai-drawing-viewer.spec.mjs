import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

const modelEndpoint = 'https://ai-test.invalid/v1/chat/completions'

async function drawingFixture() {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'interactive-viewer-fixture', units: 'millimeter' })
  await drawing.transact('Three separated, colored model-space entities', tx => {
    tx.createEntity('LINE', { start: [5, 10, 0], end: [45, 10, 0], trueColor: 0xcc2633 }, { id: 'moving-edge' })
    tx.createEntity('CIRCLE', { center: [145, 80, 0], radius: 18, trueColor: 0x255bc8 }, { id: 'unchanged-circle' })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [180, 0], [180, 110], [0, 110]], closed: true, trueColor: 0x209054 }, { id: 'unchanged-outline' })
  })
  return { sdk, drawing, kjd: await sdk.writeDocument(drawing, { format: 'KJD' }), dxf: await sdk.writeDocument(drawing, { format: 'DXF' }) }
}

// Observe what the real renderer draws, without replacing the importer, engine,
// approval transaction or canvas rendering. A nonempty canvas alone cannot catch
// the regression where the applied card still shows only the proposed delta.
async function observeRenderer(page) {
  await page.evaluate(async () => {
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    if (KJCanvasRenderer.prototype.__drawingViewerTestObserved) return
    KJCanvasRenderer.prototype.__drawingViewerTestObserved = true
    const render = KJCanvasRenderer.prototype.render
    let sequence = 0
    KJCanvasRenderer.prototype.render = function (...args) {
      const report = render.apply(this, args)
      if (this.document && this.canvas.closest('.drawing-viewer')) {
        this.canvas.__drawingViewerFrame = {
          sequence: ++sequence, revision: this.document.revision, report: { ...report },
          entities: this.document.listEntities({ ownerId: this.document.spaces.modelSpaceId })
            .map(entity => ({ id: entity.id, type: entity.type, payload: structuredClone(entity.payload) })),
        }
      }
      return report
    }
  })
}

async function mockMove(page, revision) {
  const requests = []
  await page.route(modelEndpoint, route => {
    const request = route.request(), body = request.postDataJSON()
    requests.push(body)
    expect(request.headers().authorization).toBeUndefined()
    const host = body.messages.find(message => message.role === 'user' && message.content.startsWith('Host context: document '))
    expect(host.content).toContain(`Host context: document interactive-viewer-fixture; revision ${revision}; units millimeter.`)
    const output = body.messages.findLast(message => message.role === 'tool')
    if (!output) return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'viewer-read', type: 'function', function: { name: 'cad_query_drawing', arguments: JSON.stringify({
        expectedRevision: revision, filters: { ids: ['moving-edge'] }, offset: 0, limit: 1,
        layerOffset: 0, maxLayers: 1, maxBytes: 10240,
      }) },
    }] }, finish_reason: 'tool_calls' }] } })
    const result = JSON.parse(output.content)
    expect(result).toMatchObject({ ok: true, value: { documentId: 'interactive-viewer-fixture', revision, units: 'millimeter' } })
    expect(result.value.entities).toHaveLength(1)
    expect(result.value.entities[0]).toMatchObject({ id: 'moving-edge', type: 'LINE', geometry: { start: [5, 10, 0], end: [45, 10, 0] } })
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'viewer-move', type: 'function', function: { name: 'cad_propose_move', arguments: JSON.stringify({
        expectedRevision: result.value.revision, units: result.value.units, ids: [result.value.entities[0].id], dx: 20, dy: 30,
      }) },
    }] }, finish_reason: 'tool_calls' }] } })
  })
  return requests
}

async function proposeMove(page) {
  await page.getByTestId('chat-input').fill('Move the existing red line 20 millimeters right and 30 millimeters up.')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(modelEndpoint)
  await page.getByTestId('settings-model').fill('browser-fixture')
  // Custom fixture endpoints accept no key; no real provider is contacted.
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('proposal-approve')).toBeVisible()
}

async function importDrawing(page, name, content) {
  await page.getByTestId('drawing-file').setInputFiles({
    name, mimeType: name.endsWith('.dxf') ? 'application/dxf' : 'application/json', buffer: Buffer.from(content),
  })
  await expect(page.locator('#drawing-name')).toHaveText(name)
  await expect(page.getByTestId('drawing-context').locator('.drawing-viewer-stage canvas')).toBeVisible()
}

async function camera(canvas) {
  return canvas.evaluate(node => JSON.parse(node.dataset.viewerCamera))
}

async function raster(canvas) {
  return canvas.evaluate(node => {
    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data
    let red = 0, blue = 0, green = 0, fingerprint = 2166136261
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2]
      // Thin CAD strokes can fall between device pixels; detect their hue even
      // when antialiasing blends the stroke with the white drawing background.
      if (r - g > 25 && r - b > 25) red++
      if (b - r > 25 && b - g > 25) blue++
      if (g - r > 25 && g - b > 15) green++
      fingerprint = Math.imul(fingerprint ^ r ^ (g << 8) ^ (b << 16), 16777619)
    }
    return { red, blue, green, fingerprint }
  })
}

async function expectFullDrawing(canvas, { moved = false, revision } = {}) {
  // The source canvas is reused across chats; wait for the expected geometry,
  // since the previous conversation can also have the same entity count.
  await expect.poll(() => canvas.evaluate(node => {
    const frame = node.__drawingViewerFrame
    const line = frame?.entities.find(entity => entity.type === 'LINE')
    return { count: frame?.entities.length, rendered: frame?.report.rendered,
      start: line?.payload.start, end: line?.payload.end, revision: frame?.revision }
  })).toMatchObject({ count: 3, rendered: 3,
    start: moved ? [25, 40, 0] : [5, 10, 0], end: moved ? [65, 40, 0] : [45, 10, 0],
    ...(revision === undefined ? {} : { revision }),
  })
  const frame = await canvas.evaluate(node => node.__drawingViewerFrame)
  if (revision !== undefined) expect(frame.revision).toBe(revision)
  expect(frame.report.rendered).toBe(3)
  expect(frame.entities.find(entity => entity.type === 'LINE').payload).toMatchObject({
    start: moved ? [25, 40, 0] : [5, 10, 0], end: moved ? [65, 40, 0] : [45, 10, 0],
  })
  expect(frame.entities.find(entity => entity.type === 'CIRCLE').payload).toMatchObject({ center: [145, 80, 0], radius: 18 })
  expect(frame.entities.find(entity => entity.type === 'LWPOLYLINE').payload.closed).toBe(true)
  await expect.poll(async () => {
    const pixels = await raster(canvas)
    return Math.min(pixels.red, pixels.blue, pixels.green)
  }).toBeGreaterThan(20)
}

async function exerciseInlineCamera(page, viewer) {
  const canvas = viewer.locator('.drawing-viewer-stage canvas')
  await canvas.scrollIntoViewIfNeeded()
  const fitted = await camera(canvas)
  const initialRaster = await raster(canvas)
  const bounds = await canvas.boundingBox()
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5)
  await page.mouse.wheel(0, -200)
  await expect.poll(async () => (await camera(canvas)).scale).toBeGreaterThan(fitted.scale)
  await expect.poll(async () => (await raster(canvas)).fingerprint).not.toBe(initialRaster.fingerprint)
  const zoomed = await camera(canvas)
  await expect.poll(() => canvas.evaluate(node => node.__drawingViewerFrame?.report.scale)).toBeCloseTo(zoomed.scale, 6)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * .5 + 55, bounds.y + bounds.height * .5 + 32, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await camera(canvas)).centerX).not.toBe(zoomed.centerX)
  const panned = await camera(canvas)
  expect(panned.centerY).not.toBe(zoomed.centerY)
  expect(panned.scale).toBeCloseTo(zoomed.scale, 6)
  await viewer.locator('[data-viewer-action="fit"]').click()
  await expect.poll(async () => (await camera(canvas)).scale).toBeCloseTo(fitted.scale, 6)
  expect((await camera(canvas)).centerX).toBeCloseTo(fitted.centerX, 6)
  expect((await camera(canvas)).centerY).toBeCloseTo(fitted.centerY, 6)
  await viewer.locator('[data-viewer-action="zoom-in"]').click()
  await expect.poll(async () => (await camera(canvas)).scale).toBeGreaterThan(fitted.scale)
  const buttonZoom = await camera(canvas)
  await viewer.locator('[data-viewer-action="zoom-out"]').click()
  await expect.poll(async () => (await camera(canvas)).scale).toBeLessThan(buttonZoom.scale)
  await viewer.locator('[data-viewer-action="fit"]').click()
}

async function expectLargeViewer(page, viewer, drawingOptions = {}) {
  const inlineCanvas = viewer.locator('canvas')
  await inlineCanvas.evaluate(node => { window.__inlineViewerCanvas = node })
  await viewer.locator('[data-viewer-action="enlarge"]').click()
  const dialog = page.locator('.drawing-viewer-dialog[open]')
  await expect(dialog).toBeVisible()
  const largeCanvas = dialog.locator('canvas')
  await expect(largeCanvas).toBeVisible()
  expect(await largeCanvas.evaluate(node => node === window.__inlineViewerCanvas)).toBe(true)
  const box = await dialog.boundingBox(), viewport = page.viewportSize()
  expect(box.width).toBeGreaterThan(viewport.width * .8)
  expect(box.height).toBeGreaterThan(viewport.height * .75)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await dialog.locator('[data-viewer-action="fit"]').click()
  await expectFullDrawing(largeCanvas, drawingOptions)
  const fit = await camera(largeCanvas)
  await dialog.locator('[data-viewer-action="zoom-in"]').click()
  await expect.poll(async () => (await camera(largeCanvas)).scale).toBeGreaterThan(fit.scale)
  const enlargedCamera = await camera(largeCanvas)
  const enlargedZoomLabel = await dialog.getByRole('status').textContent()
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawing-viewer-dialog[open]')).toHaveCount(0)
  await expect(inlineCanvas).toBeVisible()
  expect(await inlineCanvas.evaluate(node => node === window.__inlineViewerCanvas)).toBe(true)
  // Resizing preserves the same center and zoom relative to fit, rather than
  // preserving a device-size-dependent number of pixels per world unit.
  expect((await camera(inlineCanvas)).centerX).toBe(enlargedCamera.centerX)
  expect((await camera(inlineCanvas)).centerY).toBe(enlargedCamera.centerY)
  await expect(viewer.getByRole('status')).toHaveText(enlargedZoomLabel)
  await viewer.locator('[data-viewer-action="fit"]').click()
}

test('applied AI result renders the revised full drawing and supports inline and large viewing', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const fixture = await drawingFixture()
  const requests = await mockMove(page, fixture.drawing.revision)
  await page.goto('/ai/')
  await observeRenderer(page)
  await importDrawing(page, 'three-entities.kjd', fixture.kjd)
  await proposeMove(page)
  const card = page.getByTestId('drawing-result')
  await expect(card).toContainText('Awaiting review')
  await expect(card.locator('.drawing-viewer')).toHaveAttribute('data-viewer-mode', 'proposal')
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
  await expect.poll(() => card.locator('canvas').evaluate(node => node.__drawingViewerFrame?.revision)).toBe(fixture.drawing.revision)
  expect(await card.locator('canvas').evaluate(node => node.__drawingViewerFrame.entities.find(entity => entity.type === 'LINE').payload.start)).toEqual([5, 10, 0])
  await page.getByTestId('proposal-approve').click()
  await expect(card).toContainText('Current drawing')
  await expect(card).toContainText('Applied')
  await expect(card.locator('.drawing-viewer')).toHaveAttribute('data-viewer-mode', 'document')
  const canvas = card.locator('.drawing-viewer-stage canvas')
  await expectFullDrawing(canvas, { moved: true, revision: fixture.drawing.revision + 1 })
  await exerciseInlineCamera(page, card.locator('.drawing-viewer'))
  await expectLargeViewer(page, card.locator('.drawing-viewer'), { moved: true, revision: fixture.drawing.revision + 1 })
  await expectFullDrawing(canvas, { moved: true })
  const waiting = page.waitForEvent('download')
  await page.getByTestId('drawing-download').click()
  const download = await waiting
  const reopened = await fixture.sdk.readDocument(new Uint8Array(await readFile(await download.path())), { format: 'DXF' })
  expect(reopened.validate().valid).toBe(true)
  expect(reopened.listEntities()).toHaveLength(3)
  expect(reopened.listEntities({ type: 'LINE' })[0].payload.start).toEqual([25, 40, 0])
  // One actual native read and one proposal; neither approval nor viewing
  // makes another model request, and the host request budget is unchanged.
  expect(requests).toHaveLength(2)
  expect(errors).toEqual([])
})

test('raw DXF import gets the same zoom, pan, fit and large-view controls', async ({ page }) => {
  const fixture = await drawingFixture()
  await page.goto('/ai/')
  await observeRenderer(page)
  await importDrawing(page, 'raw-source.dxf', fixture.dxf)
  const viewer = page.getByTestId('drawing-context').locator('.drawing-viewer')
  await expect(viewer).toHaveAttribute('data-viewer-mode', 'document')
  await expectFullDrawing(viewer.locator('canvas'))
  await exerciseInlineCamera(page, viewer)
  await expectLargeViewer(page, viewer)
  await expectFullDrawing(viewer.locator('canvas'))
  await expect(page.getByTestId('drawing-download')).toHaveCount(0)
})

test('history switches and restored applied drawings keep working and dispose old viewers', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const fixture = await drawingFixture()
  await mockMove(page, fixture.drawing.revision)
  await page.goto('/ai/')
  await observeRenderer(page)
  await importDrawing(page, 'approved-history.kjd', fixture.kjd)
  await proposeMove(page)
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('drawing-result')).toContainText('Applied')
  await expectFullDrawing(page.getByTestId('drawing-result').locator('canvas'), { moved: true })
  await page.getByTestId('drawing-result').locator('canvas').evaluate(node => { window.__retiredViewerCanvas = node })
  await importDrawing(page, 'raw-history.dxf', fixture.dxf)
  await expect(page.getByTestId('drawing-result')).toHaveCount(0)
  for (let round = 0; round < 3; round++) {
    await page.locator('.history-row').filter({ hasText: 'Move the existing red line' }).locator('.conversation-item').click()
    const appliedViewer = page.getByTestId('drawing-result').locator('.drawing-viewer')
    await expectFullDrawing(appliedViewer.locator('canvas'), { moved: true })
    await expectLargeViewer(page, appliedViewer, { moved: true })
    await page.locator('.history-row').filter({ hasText: 'raw-history.dxf' }).locator('.conversation-item').click()
    const sourceViewer = page.getByTestId('drawing-context').locator('.drawing-viewer')
    await expectFullDrawing(sourceViewer.locator('canvas'))
    await exerciseInlineCamera(page, sourceViewer)
    await expect(page.locator('.drawing-viewer-dialog')).toHaveCount(0)
  }
  // A disposed proposal canvas must no longer respond to its former listeners.
  const retired = await page.evaluate(async () => {
    const canvas = window.__retiredViewerCanvas
    const before = { camera: canvas.dataset.viewerCamera, sequence: canvas.__drawingViewerFrame.sequence }
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true }))
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 91, button: 0, clientX: 40, clientY: 40, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 91, buttons: 1, clientX: 90, clientY: 80, bubbles: true }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 91, button: 0, bubbles: true }))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { connected: canvas.isConnected, before, after: { camera: canvas.dataset.viewerCamera, sequence: canvas.__drawingViewerFrame.sequence } }
  })
  expect(retired.connected).toBe(false)
  expect(retired.after).toEqual(retired.before)
  await page.locator('.history-row').filter({ hasText: 'Move the existing red line' }).locator('.conversation-item').click()
  await expect.poll(() => page.evaluate(() => new Promise(resolve => {
    const opening = indexedDB.open('kjdraw-ai-local')
    opening.onsuccess = () => {
      const database = opening.result
      const request = database.transaction('conversations').objectStore('conversations').get('history')
      request.onsuccess = () => {
        const ready = request.result?.sessions?.some(session => session.source?.name === 'approved-history.kjd' && session.state?.committed === true)
        database.close()
        resolve(ready)
      }
      request.onerror = () => { database.close(); resolve(false) }
    }
    opening.onerror = () => resolve(false)
  }))).toBe(true)
  await page.reload()
  await observeRenderer(page)
  await expect(page.getByTestId('drawing-result')).toContainText('Applied')
  const restoredViewer = page.getByTestId('drawing-result').locator('.drawing-viewer')
  await restoredViewer.locator('[data-viewer-action="fit"]').click()
  await expectFullDrawing(restoredViewer.locator('canvas'), { moved: true })
  await exerciseInlineCamera(page, restoredViewer)
  await expectLargeViewer(page, restoredViewer, { moved: true })
  expect(errors).toEqual([])
})

test.describe('high-density mobile viewport', () => {
  test.use({ deviceScaleFactor: 2 })

  test('mobile drawing controls and enlarged view stay within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const fixture = await drawingFixture()
    await mockMove(page, fixture.drawing.revision)
    await page.goto('/ai/')
    await observeRenderer(page)
    await importDrawing(page, 'mobile-source.kjd', fixture.kjd)
    await proposeMove(page)
    await page.getByTestId('proposal-approve').click()
    const viewer = page.getByTestId('drawing-result').locator('.drawing-viewer')
    await expectFullDrawing(viewer.locator('canvas'), { moved: true })
    const pixelSize = await viewer.locator('canvas').evaluate(node => ({ width: node.width, cssWidth: node.getBoundingClientRect().width }))
    expect(pixelSize.width).toBeCloseTo(Math.round(pixelSize.cssWidth * 2), 0)
    await viewer.scrollIntoViewIfNeeded()
    for (const control of await viewer.locator('.drawing-viewer-toolbar button').all()) {
      const box = await control.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    await expectLargeViewer(page, viewer, { moved: true })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    await expectFullDrawing(viewer.locator('canvas'), { moved: true })
  })
})
