import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJCanvasRenderer } from '../src/canvas-renderer.js'

function context(calls = []) {
  return new Proxy({ calls, lineWidth: 1, createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) }, {
    get(target, key) { return key in target ? target[key] : (...args) => { calls.push([key, ...args]) } },
  })
}
function canvas(width = 64, height = 32) {
  const drawing = context()
  return { width, height, clientWidth: width, clientHeight: height, getContext: () => drawing, getBoundingClientRect: () => ({ width, height }), drawing }
}
async function drawing(dashes = [3,-5]) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  await document.transact('dense original pattern', tx => tx.createEntity('HATCH', {
    solid: false, patternName: 'ORIGINAL',
    boundaryLoops: [{ vertices: [[0,0], [16,0], [16,8], [0,8]] }],
    patternLines: [{ angle: 0, base: [.173,.219], offset: [8,1/65536], dashes }],
  }, { id: 'dense' }))
  return document
}

test('dense raster keeps gaps, reuses immutable payloads and evicts old camera masks', async () => {
  const Native = globalThis.OffscreenCanvas, created = []
  globalThis.OffscreenCanvas = class { constructor(width, height) { this.width = width; this.height = height; this.target = context(); created.push(this) } getContext() { return this.target } }
  try {
    const document = await drawing(), before = document.serialize(), surface = canvas()
    const renderer = new KJCanvasRenderer(surface, { grid: false, pixelRatio: 1 })
    Object.assign(renderer.camera, { centerX: 8, centerY: 4, scale: 4 }); renderer.setDocument(document)
    assert.deepEqual(renderer.report.hatchDiagnostics, [])
    const image = created.at(-1).target.calls.find(call => call[0] === 'putImageData')[1]
    const alpha = Array.from(image.data).filter((_, index) => index % 4 === 3)
    assert.ok(alpha.includes(255)); assert.ok(alpha.includes(0))
    const allocated = created.length
    renderer.render(); renderer.render()
    assert.equal(created.length, allocated, 'stationary frames reuse the mask')
    for (let index = 1; index <= 9; index++) { renderer.camera.centerX = 8 + index / 16; renderer.render() }
    const afterPanning = created.length
    renderer.camera.centerX = 8; renderer.render()
    assert.equal(created.length, afterPanning + 1, 'the ninth different camera evicts the oldest mask')
    assert.equal(document.serialize(), before)
    const oldMask = created.at(-1).target.calls.find(call => call[0] === 'putImageData')[1].data
    await document.transact('shift original dash origin', tx => tx.updateObject('dense', { payload: { patternLines: [{ angle: 0, base: [4.173,.219], offset: [8,1/65536], dashes: [3,-5] }] } }))
    const newMask = created.at(-1).target.calls.find(call => call[0] === 'putImageData')[1].data
    assert.notDeepEqual(newMask, oldMask, 'a changed payload cannot reuse the old phase mask')
    renderer.dispose()
  } finally { if (Native === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = Native }
})

test('unknown dense dot coverage preserves partial diagnostics instead of painting a guessed mask', async () => {
  const Native = globalThis.OffscreenCanvas
  globalThis.OffscreenCanvas = class { constructor(width, height) { this.width = width; this.height = height } getContext() { return context() } }
  try {
    const document = await drawing([0,-8]), surface = canvas(), renderer = new KJCanvasRenderer(surface, { grid: false, pixelRatio: 1 })
    Object.assign(renderer.camera, { centerX: 8, centerY: 4, scale: 4 }); renderer.setDocument(document)
    assert.deepEqual(renderer.report.hatchDiagnostics, [{ entityId: 'dense', reason: 'budget', samplingReason: 'unsupported-dots' }])
    assert.equal(surface.drawing.calls.some(call => call[0] === 'drawImage'), false)
    renderer.dispose()
  } finally { if (Native === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = Native }
})

test('oversized dense viewport stops at the pixel budget before allocating an image', async () => {
  const Native = globalThis.OffscreenCanvas
  let allocated = 0
  globalThis.OffscreenCanvas = class { constructor() { allocated++ } }
  try {
    const document = await drawing(), surface = canvas(2048,1024), renderer = new KJCanvasRenderer(surface, { grid: false, pixelRatio: 1 })
    Object.assign(renderer.camera, { centerX: 8, centerY: 4, scale: 128 }); renderer.setDocument(document)
    assert.equal(allocated, 0)
    assert.deepEqual(renderer.report.hatchDiagnostics, [{ entityId: 'dense', reason: 'budget', samplingReason: 'pixel-budget' }])
    renderer.dispose()
  } finally { if (Native === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = Native }
})

test('nested INSERT masks reuse source geometry and isolate moved instances and changed block contents', async () => {
  const Native = globalThis.OffscreenCanvas, created = []
  globalThis.OffscreenCanvas = class { constructor(width, height) { this.width = width; this.height = height; this.target = context(); created.push(this) } getContext() { return this.target } }
  try {
    const sdk = createKJDrawSDK(), document = sdk.createDocument()
    const { layerId, ...payload } = (await drawing()).getObject('dense').payload
    const hatch = await sdk.executeCommand('CREATE', { type: 'HATCH', payload })
    const inner = await sdk.executeCommand('BLOCKCREATE', { name: 'hatch-detail', id: hatch.id, basePoint: [0,0] })
    const outer = await sdk.executeCommand('BLOCKCREATE', { name: 'hatch-assembly', id: inner.insert.id, basePoint: [0,0] })
    const original = document.getObject(outer.insert.id)
    await document.transact('second assembly instance', tx => tx.createEntity('INSERT', { ...original.payload, position: [24,0,0] }, { id: 'other-instance' }))
    const renderer = new KJCanvasRenderer(canvas(256,96), { grid: false, pixelRatio: 1 })
    Object.assign(renderer.camera, { centerX: 28, centerY: 8, scale: 4 }); renderer.setDocument(document)
    assert.equal(created.length, 2)
    assert.deepEqual(renderer.report.hatchDiagnostics, [])
    renderer.render(); renderer.render()
    assert.equal(created.length, 2, 'transient nested payloads reuse their stable projection keys')
    await sdk.executeCommand('MOVE', { id: original.id, dx: 1, dy: 0 })
    assert.equal(created.length, 4, 'a new document snapshot invalidates the source payload identities')
    const destinations = renderer.context.calls.filter(call => call[0] === 'drawImage').slice(-2).map(call => call[2]).sort((a,b) => a-b)
    assert.deepEqual(destinations, [20,112], 'the moved instance and the unchanged instance retain separate positions')
    renderer.render(); assert.equal(created.length, 4)
    const leaf = document.listEntities({ type: 'HATCH' })[0]
    await document.transact('revise block pattern phase', tx => tx.updateObject(leaf.id, { payload: { patternLines: [{ angle: 0, base: [4.173,.219], offset: [8,1/65536], dashes: [3,-5] }] } }))
    assert.equal(created.length, 6, 'changed source payload invalidates both projected instances')
    renderer.render(); assert.equal(created.length, 6)
    renderer.setDocument(document)
    assert.equal(created.length, 8, 'changing the document binding clears projected masks')
    renderer.dispose()
  } finally { if (Native === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = Native }
})
