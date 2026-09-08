import assert from 'node:assert/strict'
import test from 'node:test'
import { KJCanvasRenderer, aciColor } from '../src/canvas-renderer.js'
import { createKJDrawSDK } from '../src/index.js'

class RecordingContext2D {
  calls = []
  fillStyle = ''
  strokeStyle = ''
  font = ''
  textBaseline = ''
  lineWidth = 1
  globalAlpha = 1
  #record(name, ...args) { this.calls.push([name, ...args]) }
  setTransform(...args) { this.#record('setTransform', ...args) }
  clearRect(...args) { this.#record('clearRect', ...args) }
  fillRect(...args) { this.#record('fillRect', ...args) }
  beginPath() { this.#record('beginPath') }
  moveTo(...args) { this.#record('moveTo', ...args) }
  lineTo(...args) { this.#record('lineTo', ...args) }
  closePath() { this.#record('closePath') }
  stroke() { this.#record('stroke') }
  fill() { this.#record('fill') }
  save() { this.#record('save') }
  restore() { this.#record('restore') }
  translate(...args) { this.#record('translate', ...args) }
  rotate(...args) { this.#record('rotate', ...args) }
  fillText(...args) { this.#record('fillText', ...args) }
  strokeRect(...args) { this.#record('strokeRect', ...args) }
  setLineDash(...args) { this.#record('setLineDash', ...args) }
}

function mockCanvas(width = 640, height = 360) {
  const context = new RecordingContext2D()
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: kind => kind === '2d' ? context : null,
    getBoundingClientRect: () => ({ width, height, top: 0, left: 0, right: width, bottom: height }),
  }
  return { canvas, context }
}

test('Canvas renderer projects core entities, reports approximations and skips hidden layers', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'canvas-projection' })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [100, 0], color: 1 } })
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [40, 30], radius: 12 } })
  await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [{ point: [0, 10], bulge: 0.5 }, { point: [30, 10] }, { point: [30, 30] }], closed: false } })
  await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [4, 20], text: 'KJDraw', height: 3 } })
  const hidden = await sdk.executeCommand('LAYERNEW', { name: 'HIDDEN', color: 5 })
  await sdk.executeCommand('LAYERCURRENT', { id: hidden.id })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [-100, -100], end: [100, 100] } })
  await sdk.executeCommand('LAYERUPDATE', { id: hidden.id, patch: { visible: false } })

  const { canvas, context } = mockCanvas()
  const renderer = new KJCanvasRenderer(canvas, { document, pixelRatio: 1, grid: false })
  renderer.fit()

  assert.equal(renderer.report.total, 5)
  assert.equal(renderer.report.rendered, 4)
  assert.equal(renderer.report.hidden, 1)
  assert.equal(renderer.report.approximated, 1)
  assert.deepEqual(renderer.report.approximateTypes, ['TEXT'])
  assert.equal(renderer.report.unsupported, 0)
  assert.ok(renderer.camera.scale > 0)
  assert.equal(renderer.camera.centerX, 50, 'fit ignores geometry on hidden layers')
  assert.ok(context.calls.some(call => call[0] === 'fillText' && call[1] === 'KJDraw'))
  assert.ok(context.calls.filter(call => call[0] === 'lineTo').length > 10, 'bulge is tessellated instead of drawn as a straight segment')
  renderer.dispose()
})

test('Canvas renderer keeps world/screen transforms, navigation and hit testing coherent', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'canvas-navigation' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [100, 0] } })
  const { canvas } = mockCanvas(800, 500)
  const renderer = new KJCanvasRenderer(canvas, { document, pixelRatio: 1, grid: false }).fit()
  const world = [25, 0]
  const screen = renderer.worldToScreen(world)
  assert.deepEqual(renderer.screenToWorld(screen).map(value => Number(value.toFixed(10))), world)
  assert.equal(renderer.hitTest(screen)?.entity.id, line.id)

  const before = renderer.screenToWorld([100, 100])
  renderer.zoomAt(2, [100, 100])
  assert.deepEqual(renderer.screenToWorld([100, 100]).map(value => Number(value.toFixed(10))), before.map(value => Number(value.toFixed(10))))
  const priorCenter = { ...renderer.camera }
  renderer.panBy(40, -20)
  assert.notEqual(renderer.camera.centerX, priorCenter.centerX)
  assert.notEqual(renderer.camera.centerY, priorCenter.centerY)

  renderer.setSelection([line.id])
  assert.deepEqual(renderer.selection, [line.id])
  renderer.dispose()
})

test('Canvas renderer preserves model text height below one screen pixel', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'canvas-text-scale' })
  await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [0, 0], text: 'scaled', height: 3 } })
  const { canvas, context } = mockCanvas()
  const renderer = new KJCanvasRenderer(canvas, { document, pixelRatio: 1, grid: false })

  renderer.camera.scale = 0.1
  renderer.render()

  assert.ok(Math.abs(Number.parseFloat(context.font) - 0.3) < 1e-12)
  assert.ok(Number.parseFloat(context.font) < 1, 'text is not inflated to a fixed screen-space minimum')
  renderer.dispose()
})

test('Canvas renderer refits responsive viewports until the user navigates manually', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'canvas-responsive-fit' })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [100, 0] } })
  const { canvas } = mockCanvas(800, 500)
  const renderer = new KJCanvasRenderer(canvas, { document, pixelRatio: 1, grid: false }).fit()

  assert.equal(renderer.camera.scale, 7.04)
  renderer.resize(500, 500)
  assert.equal(renderer.camera.scale, 4.04, 'a fitted drawing adapts when panels reduce the canvas width')

  renderer.zoomAt(0.5, [250, 250])
  const zoomed = { ...renderer.camera }
  renderer.resize(700, 500)
  assert.deepEqual(renderer.camera, zoomed, 'manual zoom is preserved across subsequent layout changes')

  renderer.fit()
  renderer.camera.centerX += 10
  const externallyPositioned = { ...renderer.camera }
  renderer.resize(600, 500)
  assert.deepEqual(renderer.camera, externallyPositioned, 'direct camera navigation also leaves responsive fit mode')
  renderer.dispose()
})

test('Canvas renderer reacts to document commits and keeps ACI colors deterministic', async () => {
  assert.equal(aciColor(1, 'dark'), '#ff0000')
  assert.equal(aciColor(7, 'light'), '#111111')
  assert.match(aciColor(142), /^#[0-9a-f]{6}$/)

  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'canvas-change' })
  const { canvas, context } = mockCanvas()
  const renderer = new KJCanvasRenderer(canvas, { document, pixelRatio: 1, grid: false })
  const before = context.calls.length
  await sdk.executeCommand('CREATE', { type: 'POINT', payload: { position: [2, 3] } })
  assert.ok(context.calls.length > before, 'document:change schedules a new render')
  assert.equal(renderer.report.rendered, 1)
  renderer.setDocument(null)
  assert.equal(renderer.report.total, 0)
  renderer.dispose()
})

test('fit includes transformed nested block geometry and remains finite in a small viewport', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'canvas-block-bounds' })
  const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [100, 40] } })
  const inner = await sdk.executeCommand('BLOCKCREATE', { name: 'detail', id: line.id, basePoint: [0, 0] })
  await sdk.executeCommand('BLOCKCREATE', { name: 'assembly', id: inner.insert.id, basePoint: [0, 0] })
  const { canvas } = mockCanvas(640, 360)
  const renderer = new KJCanvasRenderer(canvas, { document, grid: false, pixelRatio: 1 }).fit()
  assert.equal(renderer.camera.centerX, 50)
  assert.equal(renderer.camera.centerY, 20)
  assert.ok(renderer.camera.scale < 10)
  renderer.resize(40, 40).fit()
  assert.ok(Number.isFinite(renderer.camera.scale) && renderer.camera.scale > 0)
  renderer.dispose()
})
