import test from 'node:test'
import assert from 'node:assert/strict'
import { zoomViewerCamera, panViewerCamera } from '../apps/playground/ai/drawing-viewer.js'
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
