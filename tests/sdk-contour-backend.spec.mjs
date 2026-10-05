import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK, previewPlanarContourEdit, previewPlanarBoundaries } from '../packages/kjdraw-sdk/src/index.js'

const asset = new URL('../packages/kjdraw-sdk/src/assets/kjcontour.wasm', import.meta.url)
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
const state = document => [document.serialize(), JSON.stringify(document.history), document.revision]
async function drawing(sdk) {
  const document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Sources', tx => {
    tx.createEntity('CIRCLE', { center: [0, 0, 0], radius: 5 }, { id: 'a' })
    tx.createEntity('CIRCLE', { center: [6, 0, 0], radius: 5 }, { id: 'b' })
    tx.createEntity('TEXT', { text: 'Manual note', position: [20, 0, 0], height: 2 }, { id: 'note' })
  })
  return document
}

test('SDK host contour bytes detach input views, buffers and getter results', () => {
  for (const input of [new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4), new Uint8Array([1, 2, 3]).buffer]) {
    const sdk = createKJDrawSDK({ contourBackend: { wasmBytes: input } })
    const original = input instanceof Uint8Array ? input : new Uint8Array(input)
    original.fill(0)
    const first = sdk.contourBackend
    assert.deepEqual([...first.wasmBytes], [1, 2, 3])
    first.wasmBytes.fill(8)
    assert.deepEqual([...sdk.contourBackend.wasmBytes], [1, 2, 3])
    assert.equal(Object.isFrozen(first), true)
    assert.throws(() => { sdk.contourBackend = {} }, TypeError)
    assert.throws(() => Object.defineProperty(sdk, 'contourBackend', { value: {} }), TypeError)
  }
})

test('SDK host contour URLs retain a detached snapshot and strings retain loader resolution', () => {
  const input = new URL(asset), sdk = createKJDrawSDK({ contourBackend: { wasmUrl: input } })
  input.pathname = '/changed-by-caller.wasm'
  assert.equal(sdk.contourBackend.wasmUrl.href, asset.href)
  sdk.contourBackend.wasmUrl.pathname = '/changed-through-getter.wasm'
  assert.equal(sdk.contourBackend.wasmUrl.href, asset.href)
  const relative = createKJDrawSDK({ contourBackend: { wasmUrl: '../assets/kjcontour.wasm' } })
  assert.equal(relative.contourBackend.wasmUrl, '../assets/kjcontour.wasm')
  assert.deepEqual(createKJDrawSDK().contourBackend, {})
  assert.deepEqual(createKJDrawSDK({ contourBackend: {} }).contourBackend, {})
})

test('SDK rejects malformed host asset configuration without invoking accessors', () => {
  const invalid = [null, [], 1, { wasmBytes: [] }, { wasmBytes: new Uint8Array() }, { wasmBytes: new Uint8Array(4 * 1024 * 1024 + 1) }, { wasmUrl: 1 }, { wasmBytes: new Uint8Array([1]), wasmUrl: asset }, { extra: true }]
  for (const contourBackend of invalid) assert.throws(() => createKJDrawSDK({ contourBackend }), { name: 'KJValidationError' })
  let calls = 0
  const outer = Object.defineProperty({}, 'contourBackend', { enumerable: true, get() { calls++; return {} } })
  const inner = Object.defineProperty({}, 'wasmBytes', { enumerable: true, get() { calls++; return new Uint8Array([1]) } })
  for (const options of [outer, { contourBackend: inner }, Object.create({ contourBackend: {} }), { contourBackend: Object.defineProperty({}, 'wasmUrl', { value: asset }) }]) {
    assert.throws(() => createKJDrawSDK(options), { name: 'KJValidationError' })
  }
  assert.equal(calls, 0)
})

test('all three registered contour commands share the SDK asset with preview and envelopes', async () => {
  const supplied = new Uint8Array(await readFile(asset)), sdk = createKJDrawSDK({ contourBackend: { wasmBytes: supplied } })
  supplied.fill(0)
  sdk.contourBackend.wasmBytes.fill(0)
  const document = await drawing(sdk), original = document.listEntities().map(entity => JSON.stringify(entity))
  const before = state(document)
  const request = { operation: 'offset', ids: ['a'], units: 'millimeter', expectedRevision: document.revision, distance: 2 }
  const preview = await previewPlanarContourEdit(document, request, sdk.contourBackend)
  assert.deepEqual(state(document), before)
  const offset = await sdk.executeCommand('CONTOUROFFSET', { ...request, expectedGeometryDigest: preview.receipt.geometryDigest }, { document, expectedRevision: document.revision })
  close(offset.area, 49 * Math.PI)
  const args = { operation: 'intersection', ids: ['a', 'b'], units: 'millimeter', expectedRevision: document.revision }
  const boolean = await sdk.executeCommandEnvelope(sdk.createCommandEnvelope('CONTOURBOOLEAN', args, { document, expectedRevision: document.revision }))
  assert.equal(boolean.status, 'committed')
  close(boolean.result.area, 50 * Math.acos(0.6) - 24)
  const boundary = { ids: ['a'], units: 'millimeter', expectedRevision: document.revision }
  const boundariesPreview = await previewPlanarBoundaries(document, boundary, sdk.contourBackend)
  const extracted = await sdk.executeCommand('CONTOURBOUNDARIES', { ...boundary, expectedGeometryDigest: boundariesPreview.receipt.geometryDigest }, { document, expectedRevision: document.revision })
  assert.equal(extracted.complete, true)
  assert.equal(extracted.resultIds.length, 1)
  assert.deepEqual(document.listEntities().slice(0, 3).map(entity => JSON.stringify(entity)), original)
  assert.doesNotMatch(document.serialize(), /wasmBytes|wasmUrl|contourBackend/)
  assert.doesNotMatch(JSON.stringify(boolean), /wasmBytes|wasmUrl|contourBackend/)
})

test('configured invalid assets refuse atomically and command arguments cannot replace host assets', async () => {
  const sdk = createKJDrawSDK({ contourBackend: { wasmBytes: new Uint8Array([0]) } }), document = await drawing(sdk)
  const before = state(document)
  const args = { ids: ['a'], units: 'millimeter', expectedRevision: document.revision, distance: 1 }
  await assert.rejects(sdk.executeCommand('CONTOUROFFSET', args, { document, expectedRevision: document.revision }), /backend is unavailable/)
  assert.deepEqual(state(document), before)
  for (const injected of [{ wasmUrl: asset.href }, { wasmBytes: [0] }, { contourBackend: { wasmUrl: asset.href } }]) {
    await assert.rejects(sdk.executeCommand('CONTOUROFFSET', { ...args, ...injected }, { document, expectedRevision: document.revision }), /unsupported field/)
    assert.deepEqual(state(document), before)
  }
})

test('unconfigured Node SDK commands keep the default ESM asset path', async () => {
  const sdk = createKJDrawSDK(), document = await drawing(sdk)
  const result = await sdk.executeCommand('CONTOUROFFSET', { ids: ['a'], units: 'millimeter', expectedRevision: document.revision, distance: 1 }, { document, expectedRevision: document.revision })
  close(result.area, 36 * Math.PI)
})
