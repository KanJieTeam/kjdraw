import test from 'node:test'
import assert from 'node:assert/strict'
import { createDrawingViewer, zoomViewerCamera, panViewerCamera } from '../apps/playground/ai/drawing-viewer.js'
import { createAiChatRuntime, computeAiDocumentCamera } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

function canvasFixture(width = 640, height = 360) {
  const calls = []
  const context = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]),
    set: (target, key, value) => { target[key] = value; return true },
  })
  return {
    calls,
    canvas: { width, height, clientWidth: width, clientHeight: height, getContext: () => context,
      getBoundingClientRect: () => ({ width, height }) },
  }
}

// A small deterministic DOM host: camera lifecycle tests do not need a browser
// or a provider. The actual runtime proposal test below still renders real CAD.
function viewerHost(runtime, options = {}) {
  const frames = new Map()
  let sequence = 0
  const window = {
    devicePixelRatio: 1,
    requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener() {}, removeEventListener() {},
  }
  class Element {
    constructor(tag) {
      this.tagName = tag; this.ownerDocument = document; this.children = []
      this.dataset = {}; this.attributes = {}; this.events = new Map()
      this.clientWidth = 640; this.clientHeight = 360; this.width = 640; this.height = 360
      this.classList = { add() {}, remove() {} }
    }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected) }
    setAttribute(key, value) { this.attributes[key] = value }
    getAttribute(key) { return this.attributes[key] }
    append(...elements) {
      for (const element of elements) { element.remove(); element.parentElement = this; this.children.push(element) }
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this)
      this.parentElement = null
    }
    addEventListener(name, handler) { this.events.set(name, handler) }
    removeEventListener(name) { this.events.delete(name) }
    emit(name, event = {}) { this.events.get(name)?.({ preventDefault() {}, ...event }) }
    getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight } }
    querySelector(selector) {
      const all = this.children.flatMap(child => [child, ...child.descendants()])
      return all.find(element => selector.startsWith('.') ? element.className === selector.slice(1) : element.tagName === selector)
    }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]) }
    focus() { document.activeElement = this }
    showModal() { this.open = true }
    close() { this.open = false; this.emit('close') }
  }
  const document = { defaultView: window, createElement: tag => new Element(tag) }
  document.body = new Element('body')
  const container = document.createElement('div')
  document.body.append(container)
  const { canvas, calls } = canvasFixture()
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.getContext = canvas.getContext
  const viewer = createDrawingViewer({ container, runtime, canvas: sourceCanvas, ...options })
  const flush = () => { for (const [id, callback] of frames) { frames.delete(id); callback() } }
  const shell = container.querySelector('.drawing-viewer')
  const stage = container.querySelector('.drawing-viewer-stage')
  const button = action => shell.descendants().find(element => element.dataset.viewerAction === action)
  return { viewer, flush, shell, stage, canvas: sourceCanvas, calls, button, document }
}

function cameraRuntime() {
  const renders = []
  const runtime = {
    revision: 1,
    getViewerCamera: ({ mode, planId }) => ({ centerX: mode === 'proposal' ? Number(planId) : runtime.revision * 10, centerY: 20, scale: 2 }),
    renderDocument: (_canvas, options) => { renders.push({ mode: 'document', camera: { ...options.camera } }); return { rendered: 1 } },
    renderProposal: (_canvas, planId, options) => { renders.push({ mode: 'proposal', planId, camera: { ...options.camera } }); return { rendered: 1 } },
  }
  return { runtime, renders }
}

const worldAt = (camera, [x, y], { width, height }) => [
  camera.centerX + (x - width / 2) / camera.scale,
  camera.centerY + (height / 2 - y) / camera.scale,
]

test('wheel zoom keeps the world position under the pointer, including scale limits', () => {
  const viewport = { width: 800, height: 400 }
  const camera = { centerX: 4200, centerY: -1700, scale: 5 }
  const saved = { ...camera }
  for (const point of [[0, 0], [613, 87], [400, 200]]) {
    const originalWorld = worldAt(camera, point, viewport)
    for (const factor of [0.5, 2, 1e20, 1e-20]) {
      const zoomed = zoomViewerCamera(camera, factor, point, viewport)
      assert.ok(zoomed.scale >= 1e-7 && zoomed.scale <= 1e7)
      worldAt(zoomed, point, viewport).forEach((value, axis) => assert.ok(Math.abs(value - originalWorld[axis]) < 1e-6))
    }
  }
  assert.deepEqual(camera, saved)
})

test('pointer pan follows screen movement without modifying its previous camera', () => {
  const camera = { centerX: 10, centerY: 30, scale: 2 }
  assert.deepEqual(panViewerCamera(camera, 60, -20), { centerX: -20, centerY: 20, scale: 2 })
  assert.deepEqual(camera, { centerX: 10, centerY: 30, scale: 2 })
})

test('opt-in refresh preserves zoom and pan across revision, mode and plan changes; explicit fit resets', () => {
  const { runtime, renders } = cameraRuntime()
  const host = viewerHost(runtime)
  host.viewer.refresh({ preserveCamera: true })
  host.flush()
  assert.deepEqual(host.viewer.getCamera(), { centerX: 10, centerY: 20, scale: 2 })
  host.button('zoom-in').emit('click')
  host.stage.emit('keydown', { key: 'ArrowRight' })
  host.flush()
  const camera = host.viewer.getCamera()
  camera.centerX += 999 // getCamera returns a copy, not the viewer's mutable state.
  const saved = host.viewer.getCamera()
  for (const next of [{}, { mode: 'proposal', planId: '90' }, { planId: '120' }, { mode: 'document' }]) {
    runtime.revision++
    host.viewer.refresh({ ...next, preserveCamera: true })
    host.flush()
    assert.deepEqual(host.viewer.getCamera(), saved)
    assert.deepEqual(renders.at(-1).camera, saved)
  }
  host.viewer.refresh({ preserveCamera: true, fit: true })
  host.flush()
  assert.deepEqual(host.viewer.getCamera(), { centerX: runtime.revision * 10, centerY: 20, scale: 2 })
  host.button('zoom-in').emit('click'); host.flush()
  host.viewer.fit(); host.flush()
  assert.equal(host.viewer.getCamera().scale, 2)
  host.viewer.destroy()
})

test('default refresh still resets on revisions, modes and plans', () => {
  const { runtime } = cameraRuntime()
  const host = viewerHost(runtime)
  host.flush()
  for (const [next, centerX] of [[{}, 20], [{ mode: 'proposal', planId: '90' }, 90], [{ planId: '120' }, 120], [{ mode: 'document' }, 50]]) {
    host.button('zoom-in').emit('click'); host.flush()
    runtime.revision++
    host.viewer.refresh(next); host.flush()
    assert.deepEqual(host.viewer.getCamera(), { centerX, centerY: 20, scale: 2 })
  }
  host.viewer.destroy()
})

test('preserved refresh also keeps its camera when review controls resize the viewport in that refresh', () => {
  const { runtime } = cameraRuntime()
  runtime.getViewerCamera = ({ mode, width, height }) => ({ centerX: mode === 'proposal' ? 99 : 10, centerY: 20, scale: (mode === 'proposal' ? 8 : 2) * Math.min(width / 640, height / 360) })
  const host = viewerHost(runtime)
  host.flush(); host.button('zoom-in').emit('click'); host.stage.emit('keydown', { key: 'ArrowRight' }); host.flush()
  const saved = host.viewer.getCamera()
  host.stage.clientHeight = 280
  host.viewer.refresh({ mode: 'proposal', planId: '90', preserveCamera: true }); host.flush()
  assert.deepEqual(host.viewer.getCamera(), saved)
  host.stage.clientHeight = 360
  host.viewer.refresh({ mode: 'document', preserveCamera: true }); host.flush()
  assert.deepEqual(host.viewer.getCamera(), saved)
  // A later independent viewport resize still uses the original relative-fit
  // behavior, rather than disabling responsive/fullscreen rendering altogether.
  host.stage.clientWidth = 1280; host.stage.clientHeight = 720
  host.viewer.enlarge(); host.flush()
  assert.deepEqual(host.viewer.getCamera(), { ...saved, scale: saved.scale * 2 })
  host.viewer.destroy()
})

test('refresh labels updates button titles, aria labels, fullscreen heading and close control', () => {
  const { runtime } = cameraRuntime()
  const host = viewerHost(runtime)
  host.flush(); host.viewer.enlarge(); host.flush()
  const labels = { title: '图纸预览', zoomIn: '放大', zoomOut: '缩小', fit: '适合窗口', enlarge: '全屏查看', close: '关闭预览', hint: '滚轮缩放，拖动平移' }
  host.viewer.refresh({ labels, preserveCamera: true }); host.flush()
  for (const [action, key] of [['zoom-in', 'zoomIn'], ['zoom-out', 'zoomOut'], ['fit', 'fit'], ['enlarge', 'enlarge'], ['close', 'close']]) {
    const control = action === 'close' ? host.document.body.descendants().find(element => element.dataset.viewerAction === action) : host.button(action)
    assert.equal(control.title, labels[key])
    assert.equal(control.getAttribute('aria-label'), labels[key])
    if (action === 'fit' || action === 'enlarge') assert.equal(control.textContent, labels[key])
  }
  assert.equal(host.document.body.querySelector('h2').textContent, labels.title)
  assert.equal(host.shell.getAttribute('aria-label'), labels.title)
  assert.equal(host.canvas.getAttribute('aria-label'), labels.title)
  assert.equal(host.stage.getAttribute('aria-label'), labels.title)
  assert.equal(host.shell.querySelector('.drawing-viewer-hint').textContent, labels.hint)
  host.viewer.close(); host.viewer.enlarge(); host.flush()
  assert.equal(host.document.body.querySelector('h2').textContent, labels.title)
  host.viewer.destroy()
})

test('stale actual proposal clears its bitmap without displaying current geometry or mutating CAD', async () => {
  const runtime = createAiChatRuntime({ endpoint: 'https://example.invalid/v1/chat/completions', model: 'mock-model',
    fetchImpl: async () => Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'viewer-stale', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({
        expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [],
      }) },
    }] }, finish_reason: 'tool_calls' }] }),
  })
  let host
  try {
    const result = await runtime.send('Draw a line from 0,0 to 20,0 millimeters')
    assert.equal(result.status, 'proposal')
    host = viewerHost(runtime, { mode: 'proposal', planId: result.proposal.planId })
    host.flush()
    assert.equal(host.shell.dataset.viewerError, undefined)
    assert.ok(host.calls.some(([method]) => method === 'lineTo'))
    assert.equal((await runtime.approve(result.proposal.planId)).status, 'applied')
    const before = await runtime.exportLocalState()
    let bitmapResets = 0
    let width = host.canvas.width
    Object.defineProperty(host.canvas, 'width', { get: () => width, set: value => { bitmapResets++; width = value } })
    const renderedCalls = host.calls.length
    host.viewer.refresh({ preserveCamera: true }); host.flush()
    assert.equal(host.shell.dataset.viewerError, 'true')
    assert.equal(host.shell.dataset.viewerRendered, '0')
    assert.equal(bitmapResets, 1)
    assert.equal(host.calls.length, renderedCalls) // No renderer or document fallback ran.
    assert.equal(host.button('zoom-in').disabled, true)
    assert.deepEqual(await runtime.exportLocalState(), before)
    host.viewer.refresh({ mode: 'document', preserveCamera: true }); host.flush()
    assert.equal(host.shell.dataset.viewerError, undefined)
    assert.equal(host.shell.dataset.viewerRendered, '1')
    assert.deepEqual(await runtime.exportLocalState(), before)
  } finally { host?.viewer.destroy(); runtime.destroy() }
})

test('document fit uses visible model entities, including locked layers, instead of paper or hidden extents', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ units: 'millimeter' })
  const paper = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'Oversized paper' })
  await document.transact('Fit fixture', tx => {
    const locked = tx.upsertTableRecord('layers', { name: 'Locked geometry', type: 'LAYER', payload: { visible: true, locked: true } })
    const hidden = tx.upsertTableRecord('layers', { name: 'Hidden geometry', type: 'LAYER', payload: { visible: false } })
    tx.createEntity('LINE', { start: [0, 0], end: [20, 0], layerId: locked.id })
    tx.createEntity('LINE', { start: [1e8, 1e8], end: [2e8, 2e8], layerId: hidden.id })
    tx.createEntity('LINE', { start: [-1e9, -1e9], end: [1e9, 1e9] }, { ownerId: paper.payload.blockRecordId })
  })
  const before = document.serialize()
  const camera = computeAiDocumentCamera(document, { width: 640, height: 360 })
  assert.deepEqual(camera, { centerX: 10, centerY: 0, scale: 29 })
  assert.equal(document.serialize(), before)
})

test('runtime honors camera and device resolution while rendering the whole unchanged live drawing', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Live drawing', tx => {
    tx.createEntity('LINE', { start: [0, 0], end: [20, 0] })
    tx.createEntity('CIRCLE', { center: [50, 20], radius: 10 })
    tx.createEntity('LWPOLYLINE', { vertices: [[0, 0], [60, 0], [60, 40], [0, 40]], closed: true })
  })
  const runtime = createAiChatRuntime()
  try {
    await runtime.restoreLocalState({ drawing: await sdk.writeDocument(document, { format: 'KJD' }) })
    const before = (await runtime.exportLocalState()).drawing
    const { canvas, calls } = canvasFixture()
    const camera = { centerX: 30, centerY: 20, scale: 2 }
    const report = runtime.renderDocument(canvas, { width: 640, height: 360, camera, pixelRatio: 2 })
    assert.equal(report.scale, 2)
    assert.equal(report.total, 3)
    assert.equal(report.rendered, 3)
    assert.equal(canvas.width, 1280)
    assert.equal(canvas.height, 720)
    assert.ok(calls.some(([method, x, y]) => method === 'moveTo' && x === 260 && y === 220))
    assert.equal((await runtime.exportLocalState()).drawing, before)
    assert.deepEqual(camera, { centerX: 30, centerY: 20, scale: 2 })
    const fitted = runtime.getViewerCamera({ width: 640, height: 360 })
    assert.equal(fitted.centerX, 30)
    assert.equal(fitted.centerY, 20)
    assert.equal(fitted.scale, 7.5)
  } finally { runtime.destroy() }
})

test('proposal camera renders CAD overlays before approval and live mode after approval', async () => {
  const runtime = createAiChatRuntime({ endpoint: 'https://example.invalid/v1/chat/completions', model: 'mock-model',
    fetchImpl: async () => Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'viewer-line', type: 'function', function: { name: 'cad_propose_drawing_pattern', arguments: JSON.stringify({
        expectedRevision: 0, units: 'millimeter', lines: [[0, 0, 20, 0]], circles: [], arcs: [], polylines: [], arrays: [],
      }) },
    }] }, finish_reason: 'tool_calls' }] }),
  })
  try {
    const result = await runtime.send('Draw a line from 0,0 to 20,0 millimeters')
    assert.equal(result.status, 'proposal')
    const { canvas, calls } = canvasFixture()
    const report = runtime.renderProposal(canvas, result.proposal.planId, {
      width: 640, height: 360, camera: { centerX: 10, centerY: 0, scale: 2 }, pixelRatio: 2,
    })
    assert.equal(report.scale, 2)
    assert.ok(calls.some(([method, x, y]) => method === 'lineTo' && x === 340 && y === 180))
    assert.equal(runtime.entityCount, 0)
    assert.equal((await runtime.approve(result.proposal.planId)).status, 'applied')
    assert.equal(runtime.getViewerCamera({ mode: 'document', width: 640, height: 360 }).centerX, 10)
    assert.equal(runtime.renderDocument(canvas, { width: 640, height: 360 }).rendered, 1)
    assert.throws(() => runtime.getViewerCamera({ mode: 'proposal', planId: result.proposal.planId }), /提案已失效/)
  } finally { runtime.destroy() }
})
