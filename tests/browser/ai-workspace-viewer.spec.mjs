import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

const endpoint = 'https://workspace-viewer.invalid/v1/chat/completions'
async function fixture() {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'workspace-camera-fixture', units: 'millimeter' })
  await drawing.transact('Public camera fixture', tx => {
    tx.createEntity('LINE', { start: [5, 10, 0], end: [45, 10, 0], trueColor: 0xcc2633 }, { id: 'camera-edge' })
    tx.createEntity('CIRCLE', { center: [145, 80, 0], radius: 18, trueColor: 0x255bc8 }, { id: 'camera-circle' })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [180, 0], [180, 110], [0, 110]], closed: true, trueColor: 0x209054 }, { id: 'camera-outline' })
  })
  return { drawing, kjd: await sdk.writeDocument(drawing, { format: 'KJD' }) }
}
async function importFixture(page, content) {
  await page.getByTestId('drawing-file').setInputFiles({ name: 'workspace-camera.kjd', mimeType: 'application/json', buffer: Buffer.from(content) })
  await expect(page.locator('#drawing-name')).toHaveText('workspace-camera.kjd')
}
async function camera(canvas) { return canvas.evaluate(node => JSON.parse(node.dataset.viewerCamera)) }
async function zoomAndPan(page, canvas) {
  const initial = await camera(canvas)
  await canvas.locator('..').press('+')
  await expect.poll(async () => (await camera(canvas)).scale).toBeGreaterThan(initial.scale)
  await canvas.locator('..').press('ArrowRight')
  await expect.poll(async () => (await camera(canvas)).centerX).not.toBe(initial.centerX)
  return camera(canvas)
}
async function screenshot(page, name) {
  const path = test.info().outputPath(name)
  await page.screenshot({ path, fullPage: true })
  await test.info().attach(name, { path, contentType: 'image/png' })
}

test('workspace persistent desktop viewer compares current and proposal with the same camera through approval', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const source = await fixture(), requests = []
  await page.route(endpoint, route => {
    const body = route.request().postDataJSON(); requests.push(body)
    expect(route.request().headers().authorization).toBeUndefined()
    const output = body.messages.findLast(message => message.role === 'tool')
    if (!output) return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'workspace-camera-read', type: 'function', function: { name: 'cad_query_drawing', arguments: JSON.stringify({
        expectedRevision: source.drawing.revision, filters: { ids: ['camera-edge'] }, offset: 0, limit: 1,
        layerOffset: 0, maxLayers: 1, maxBytes: 10240,
      }) },
    }] }, finish_reason: 'tool_calls' }] } })
    const receipt = JSON.parse(output.content)
    expect(receipt).toMatchObject({ ok: true, value: { documentId: source.drawing.id, revision: source.drawing.revision, units: 'millimeter' } })
    expect(receipt.value.entities[0]).toMatchObject({ id: 'camera-edge', type: 'LINE', geometry: { start: [5, 10, 0], end: [45, 10, 0] } })
    return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'workspace-camera-move', type: 'function', function: { name: 'cad_propose_move', arguments: JSON.stringify({
        expectedRevision: receipt.value.revision, units: receipt.value.units, ids: [receipt.value.entities[0].id], dx: 20, dy: 30,
      }) },
    }] }, finish_reason: 'tool_calls' }] } })
  })
  await page.goto('/ai/')
  await importFixture(page, source.kjd)
  const panel = page.locator('#drawing-panel'), viewer = page.locator('#workspace-viewer .drawing-viewer'), canvas = viewer.locator('canvas')
  await expect(panel).toBeVisible()
  await expect(viewer).toHaveAttribute('data-viewer-rendered', '3')
  await canvas.evaluate(node => { window.__workspaceCameraCanvas = node })
  const initial = await camera(canvas), saved = await zoomAndPan(page, canvas)
  const bounds = await canvas.boundingBox()
  await page.getByTestId('chat-input').fill('Move the red line 20 millimeters right and 30 millimeters up.')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('settings-provider').selectOption('custom')
  await page.getByTestId('settings-endpoint').fill(endpoint)
  await page.getByTestId('settings-model').fill('browser-fixture')
  await page.getByTestId('settings-save').click()
  await expect(page.locator('#workspace-approve')).toBeVisible()
  await expect(viewer).toHaveAttribute('data-viewer-mode', 'proposal')
  await expect.poll(() => camera(canvas)).toEqual(saved)
  expect(await canvas.evaluate(node => node === window.__workspaceCameraCanvas)).toBe(true)
  expect((await canvas.boundingBox()).width).toBeCloseTo(bounds.width, 0)
  await screenshot(page, 'desktop-proposal-workspace.png')
  for (const [selector, mode] of [['#view-current', 'document'], ['#view-proposal', 'proposal']]) {
    await page.locator(selector).click()
    await expect(viewer).toHaveAttribute('data-viewer-mode', mode)
    await expect.poll(() => camera(canvas)).toEqual(saved)
  }
  await page.locator('#workspace-approve').click()
  await expect(page.getByTestId('drawing-result')).toContainText('Applied')
  await expect(viewer).toHaveAttribute('data-viewer-mode', 'document')
  await expect(viewer).toHaveAttribute('data-viewer-rendered', '3')
  await expect.poll(() => camera(canvas)).toEqual(saved)
  expect(await canvas.evaluate(node => node === window.__workspaceCameraCanvas)).toBe(true)
  await expect(page.locator('#view-proposal')).toBeHidden()
  await expect(page.locator('#workspace-meta')).toContainText(`REV ${source.drawing.revision + 1}`)
  await viewer.locator('[data-viewer-action="fit"]').click()
  await expect.poll(() => camera(canvas)).toEqual(initial)
  await screenshot(page, 'desktop-approved-workspace.png')
  expect(requests).toHaveLength(2)
  expect(errors).toEqual([])
})

test.describe('workspace high-density mobile viewer', () => {
  test.use({ deviceScaleFactor: 2 })
  test('workspace mobile drawing tab keeps the same camera when returning to chat and reopening', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const source = await fixture()
    await page.goto('/ai/')
    await importFixture(page, source.kjd)
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await expect(page.locator('#workspace-body')).toHaveAttribute('data-mobile-view', 'chat')
    await screenshot(page, 'mobile-chat-with-drawing.png')
    await page.locator('#tab-drawing').click()
    const viewer = page.locator('#workspace-viewer .drawing-viewer'), canvas = viewer.locator('canvas')
    await expect(canvas).toBeVisible()
    await expect(viewer).toHaveAttribute('data-viewer-rendered', '3')
    await canvas.evaluate(node => { window.__workspaceMobileCanvas = node })
    const saved = await zoomAndPan(page, canvas)
    const resolution = await canvas.evaluate(node => ({ bitmap: node.width, css: node.getBoundingClientRect().width }))
    expect(resolution.bitmap).toBeCloseTo(Math.round(resolution.css * 2), 0)
    await screenshot(page, 'mobile-drawing-workspace.png')
    await page.locator('#tab-chat').click()
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await page.locator('#tab-drawing').click()
    await expect(canvas).toBeVisible()
    await expect.poll(() => camera(canvas)).toEqual(saved)
    expect(await canvas.evaluate(node => node === window.__workspaceMobileCanvas)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    for (const control of await viewer.locator('.drawing-viewer-toolbar button').all()) {
      const box = await control.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    expect(errors).toEqual([])
  })
})
