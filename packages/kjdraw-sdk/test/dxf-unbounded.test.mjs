import assert from 'node:assert/strict'
import test from 'node:test'
import { createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'

test('native DXF construction lines preserve 3D geometry, style and space ownership without mutating the drawing', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument(), adapter = createDXFFileAdapter()
  const paper = doc.getObject(doc.snapshot().spaces.layoutIds[1])
  await doc.transact('unbounded geometry', tx => {
    tx.createEntity('XLINE', { origin: [1000000, 2, 3], direction: [3, 4, 12], color: 2, lineweight: 35 })
    tx.createEntity('RAY', { origin: [-1000000, 4, 5], direction: [-3, -4, 0], color: 3 }, { ownerId: paper.payload.blockRecordId })
  })
  const original = doc.serialize()
  for (const version of ['2000', '2004', '2010', '2013', '2018', '2024']) {
    const text = adapter.write(doc, { version })
    assert.match(text, /AcDbXline/); assert.match(text, /AcDbRay/)
    const copy = await adapter.read(text), model = copy.listEntities({ ownerId: copy.snapshot().spaces.modelSpaceId })
    const sheet = copy.getObject(copy.snapshot().spaces.layoutIds[1])
    const rays = copy.listEntities({ ownerId: sheet.payload.blockRecordId })
    assert.equal(model.length, 1); assert.equal(rays.length, 1)
    assert.equal(model[0].type, 'XLINE'); assert.equal(rays[0].type, 'RAY')
    assert.deepEqual(model[0].payload.origin, [1000000, 2, 3])
    assert.deepEqual(rays[0].payload.origin, [-1000000, 4, 5])
    model[0].payload.direction.forEach((n, i) => assert.ok(Math.abs(n - [3/13,4/13,12/13][i]) < 1e-12))
    assert.deepEqual(rays[0].payload.direction, [-.6, -.8, 0])
    assert.equal(model[0].payload.color, 2); assert.equal(model[0].payload.lineweight, 35)
    assert.equal(rays[0].payload.color, 3)
  }
  for (const version of ['R12', 'R14']) assert.throws(() => adapter.write(doc, { version }), /minimum target is 2000/)
  assert.equal(doc.serialize(), original)
})

test('DXF preserves invalid directions as diagnosed proxies, and normalizes huge finite vectors without overflow', async () => {
  const adapter = createDXFFileAdapter()
  for (const type of ['XLINE', 'RAY']) {
    for (const direction of ['', '11\n0\n21\n0\n31\n0\n']) {
      const text = `0\nSECTION\n2\nENTITIES\n0\n${type}\n10\n1\n20\n2\n${direction}0\nENDSEC\n0\nEOF\n`
      const imported = await adapter.read(text), entity = imported.listEntities()[0]
      assert.equal(entity.type, 'PROXY_ENTITY')
      assert.equal(entity.payload.originalType, type)
      assert.match(entity.payload.importError, /direction cannot be zero/)
      assert.ok(entity.payload.rawTags.length > 0)
    }
    const sdk = createKJDrawSDK(), doc = sdk.createDocument()
    await doc.transact('large vector', tx => tx.createEntity(type, { origin: [0,0,0], direction: [1.7e308,1.7e308,0] }))
    const copy = await adapter.read(adapter.write(doc))
    const actual = copy.listEntities()[0].payload.direction
    assert.ok(actual.every(Number.isFinite)); assert.ok(Math.abs(Math.hypot(...actual)-1) < 1e-12)
    assert.ok(actual[0]>0 && actual[1]>0)
  }
})
