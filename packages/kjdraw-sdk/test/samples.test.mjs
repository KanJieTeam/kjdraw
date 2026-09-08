import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/core.js'
import { INDUSTRY_SAMPLES, createIndustrySample, createIndustrySamples } from '../src/samples.js'

test('industry collection contains editable, valid layered drawings that survive KJD and DXF', async () => {
  const sdk = createKJDrawSDK()
  const drawings = await createIndustrySamples(sdk)
  assert.equal(drawings.length, 4)
  assert.equal(new Set(INDUSTRY_SAMPLES.map(sample => sample.discipline)).size, 4)
  for (const drawing of drawings) {
    assert.equal(drawing.validate().valid, true)
    assert.ok(drawing.listEntities().length >= 100)
    assert.ok(drawing.snapshot().tables.layers.recordIds.length >= 8)
    const snapshot = drawing.fingerprint()
    const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
    const reopened = await sdk.readDocument(kjd, { format: 'KJD' })
    assert.equal(reopened.fingerprint(), snapshot)
    const dxf = await sdk.writeDocument(drawing, { format: 'DXF' })
    const imported = await sdk.readDocument(dxf, { format: 'DXF' })
    assert.equal(imported.validate().valid, true)
    assert.equal(imported.listEntities().length, drawing.listEntities().length)
  }
})

test('sample creation never overwrites an existing drawing, and architectural dimensions use model units', async () => {
  const sdk = createKJDrawSDK()
  const first = await createIndustrySample(sdk, 'sample-architecture')
  const second = await createIndustrySample(sdk, 'sample-architecture')
  assert.notEqual(first.id, second.id)
  assert.equal(sdk.documents.get(first.id), first)
  const wall = first.listEntities().find(entity => entity.type === 'LWPOLYLINE' && entity.payload.vertices?.[0]?.point?.[0] === 2200)
  assert.ok(wall)
  const xs = wall.payload.vertices.map(vertex => vertex.point[0])
  assert.equal(Math.max(...xs) - Math.min(...xs), 19800)
  await assert.rejects(createIndustrySample(sdk, 'missing'), /Unknown KJDraw sample/)
})
