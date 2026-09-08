import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'

test('native DXF entities preserve common drawing properties and resolve linetypes on reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'PARTS' })
  const linetype = await sdk.executeCommand('LINETYPE', { name: 'PART-DASH', pattern: [3, -1] })
  const properties = { layerId: layer.id, color: 2, trueColor: 0x123456, linetypeId: linetype.id,
    linetypeScale: 1.5, lineweight: 35, visible: false, normal: [0, 0, 1], thickness: 0.5 }
  for (const [type, payload] of [
    ['LINE', { start: [0, 0, 6], end: [2, 0, 6] }],
    ['ARC', { center: [5, 0, 6], radius: 2, startAngle: 0, endAngle: Math.PI }],
    ['CIRCLE', { center: [10, 0, 6], radius: 2 }],
    ['LWPOLYLINE', { elevation: 6, vertices: [[15, 0], [17, 0], [17, 2]] }],
    ['POLYLINE', { elevation: 6, vertices: [[20, 0, 6], [22, 0, 6], [22, 2, 6]] }],
  ]) await sdk.executeCommand('CREATE', { type, payload: { ...properties, ...payload } })
  const before = document.serialize()
  for (const version of ['2004', '2010', '2013', '2018', '2024']) {
    const bytes = await sdk.writeDocument(document, { format: 'DXF', version })
    const reopened = await sdk.fileAdapters.read(bytes, { format: 'DXF', version })
    assert.equal(reopened.listEntities().length, 5)
    for (const entity of reopened.listEntities()) {
      for (const key of ['color', 'trueColor', 'linetypeScale', 'lineweight', 'visible', 'normal', 'thickness']) assert.deepEqual(entity.payload[key], properties[key], `${version} ${entity.type}.${key}`)
      assert.equal(reopened.getObject(entity.payload.layerId).name, 'PARTS')
      assert.equal(reopened.getObject(entity.payload.linetypeId).name, 'PART-DASH')
      assert.equal(entity.payload.linetypeName, 'PART-DASH')
    }
  }
  assert.equal(document.serialize(), before)
})

test('DXF ACI ByBlock and ByLayer and basic line styles remain representable in legacy versions', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  for (const [index, color] of ['BYBLOCK', 'BYLAYER', 4].entries()) await sdk.executeCommand('CREATE', { type: 'LINE', payload: {
    start: [0, index], end: [2, index], color, linetypeName: index === 0 ? 'BYBLOCK' : 'BYLAYER', linetypeScale: 2, visible: true,
  } })
  const adapter = createDXFFileAdapter()
  for (const version of ['R12', 'R14', '2000', '2018']) {
    const reopened = await adapter.read(await adapter.write(document, { version }))
    assert.deepEqual(reopened.listEntities().map(entity => entity.payload.color), [0, 256, 4])
    assert.ok(reopened.listEntities().every(entity => entity.payload.linetypeScale === 2 && entity.payload.visible === true))
    assert.deepEqual(reopened.listEntities().map(entity => entity.payload.linetypeName), ['BYBLOCK', 'BYLAYER', 'BYLAYER'])
  }
})

test('DXF writes current entity properties instead of stale raw hatch tags', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument()
  await sdk.executeCommand('HATCH', { solid: true, patternName: 'SOLID', boundaryLoops: [{ vertices: [{ point: [0, 0] }, { point: [4, 0] }, { point: [4, 4] }], closed: true }] })
  const imported = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  const hatch = imported.listEntities()[0]
  await sdk.executeCommand('PROPERTIES', { id: hatch.id, patch: { payload: { color: 3, lineweight: 50, linetypeScale: 2.5 } } }, { document: imported })
  const reopened = await sdk.fileAdapters.read(await sdk.writeDocument(imported, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.equal(reopened.listEntities()[0].payload.color, 3)
  assert.equal(reopened.listEntities()[0].payload.lineweight, 50)
  assert.equal(reopened.listEntities()[0].payload.linetypeScale, 2.5)
})

test('unsupported DXF style downgrades fail without mutating the source document', async () => {
  const adapter = createDXFFileAdapter()
  for (const [properties, versions, expression] of [
    [{ color: 2, trueColor: 0x123456 }, ['R12', 'R14', '2000'], /trueColor/],
    [{ lineweight: 35 }, ['R12', 'R14'], /lineweight/],
  ]) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument()
    await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0], end: [1, 0], ...properties } })
    const before = document.serialize()
    for (const version of versions) assert.throws(() => adapter.write(document, { version }), error => error instanceof KJValidationError && expression.test(error.message))
    assert.equal(document.serialize(), before)
  }
})
