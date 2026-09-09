import assert from 'node:assert/strict'
import { createKJDrawSDK } from '@kanjieteam/kjdraw'
import { createDrawingContext } from '@kanjieteam/kjdraw/drawing-context'

// This example reads a drawing without a model, network request or API key.
const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'drawing-context-example', units: 'millimeter' })
for (const x of [20, 60, 100]) {
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [x, 20, 0], radius: 4 } })
}

const revision = drawing.revision
const fingerprint = drawing.fingerprint()
const entities = []
let offset = 0
do {
  const page = createDrawingContext(drawing, {
    types: ['CIRCLE'], expectedRevision: revision, offset, limit: 2, maxLayers: 0, maxBytes: 4096,
  })
  assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') <= 4096)
  assert.ok(page.entities.every(entity => entity.geometryOmittedReason === null))
  entities.push(...page.entities)
  offset = page.nextOffset
} while (offset !== null)

const layers = []
let layerOffset = 0
do {
  const page = createDrawingContext(drawing, {
    expectedRevision: revision, layerOffset, limit: 0, maxLayers: 2, maxBytes: 4096,
  })
  layers.push(...page.layers)
  layerOffset = page.nextLayerOffset
} while (layerOffset !== null)

assert.equal(entities.length, 3)
assert.equal(new Set(entities.map(entity => entity.id)).size, 3)
assert.deepEqual(entities.map(entity => entity.geometry.center), [[20, 20, 0], [60, 20, 0], [100, 20, 0]])
assert.ok(layers.length >= 1)
assert.equal(drawing.revision, revision)
assert.equal(drawing.fingerprint(), fingerprint)
console.log(JSON.stringify({ drawingContext: true, units: 'millimeter', circles: entities.length, pagination: true, readOnly: true }))
