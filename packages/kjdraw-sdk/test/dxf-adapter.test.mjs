import assert from 'node:assert/strict'
import test from 'node:test'
import { KJValidationError, createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'

const fixture = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n5\n20\n2\nGEO\n70\n0\n62\n3\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n5\n100\n8\nGEO\n10\n0\n20\n0\n11\n10\n21\n5\n0\nCIRCLE\n5\n101\n8\nGEO\n10\n2\n20\n3\n40\n4\n0\nENDSEC\n0\nEOF\n`

test('default ASCII DXF adapter reads layers and core entities and writes a reopenable artifact', async () => {
  const sdk = createKJDrawSDK()
  const document = await sdk.readDocument(new TextEncoder().encode(fixture), { format: 'DXF', version: '2018' })
  assert.equal(document.snapshot().header.sourceVersion, '2018')
  assert.equal(document.getTable('layers').records.some(layer => layer.name === 'GEO'), true)
  assert.deepEqual(document.listEntities({ type: 'LINE' })[0].payload.end, [10, 5, 0])
  assert.equal(document.listEntities({ type: 'CIRCLE' })[0].payload.radius, 4)
  const artifact = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.fileAdapters.read(artifact, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities({ type: 'LINE' }).length, 1)
  assert.equal(reopened.listEntities({ type: 'CIRCLE' }).length, 1)
})

test('DXF export rejects unsupported entities instead of silently dropping them', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'dxf-loss-gate' })
  await sdk.executeCommand('CREATE', { type: 'RAY', payload: { origin: [0, 0, 0], direction: [1, 0, 0] } })
  await assert.rejects(sdk.writeDocument(document, { format: 'DXF', version: '2018' }), error => error.cause instanceof KJValidationError && /prevent data loss/.test(error.cause.message))
})

test('legacy POLYLINE/VERTEX sequences import as one canonical entity and round-trip in R12', async () => {
  const source = [
    '0','SECTION','2','HEADER','9','$ACADVER','1','AC1009','0','ENDSEC',
    '0','SECTION','2','ENTITIES',
    '0','POLYLINE','5','20','8','0','10','0','20','0','30','3','70','1',
    '0','VERTEX','8','0','10','1','20','2','30','3','42','0.5',
    '0','VERTEX','8','0','10','4','20','5','30','3',
    '0','SEQEND','8','0','0','ENDSEC','0','EOF','',
  ].join('\r\n')
  const adapter = createDXFFileAdapter()
  const document = await adapter.read(source)
  const [polyline] = document.listEntities()
  assert.equal(polyline.type, 'POLYLINE')
  assert.equal(polyline.payload.closed, true)
  assert.equal(polyline.payload.vertices.length, 2)
  assert.equal(polyline.payload.vertices[0].bulge, 0.5)
  const written = await adapter.write(document, { version: 'R12' })
  assert.match(written, /\r\nPOLYLINE\r\n/)
  assert.equal((written.match(/\r\nVERTEX\r\n/g) ?? []).length, 2)
  const reopened = await adapter.read(written)
  assert.equal(reopened.listEntities()[0].payload.vertices.length, 2)
})

test('DXF BLOCKS definitions and INSERT ownership survive write and reopen', async () => {
  const source = [
    '0','SECTION','2','HEADER','9','$ACADVER','1','AC1032','0','ENDSEC',
    '0','SECTION','2','BLOCKS','0','BLOCK','5','20','8','0','2','钻孔符号','70','0','10','5','20','6','30','0','3','钻孔符号','1','',
    '0','CIRCLE','5','21','8','0','10','5','20','6','30','0','40','2','0','ENDBLK','5','22','8','0','0','ENDSEC',
    '0','SECTION','2','ENTITIES','0','INSERT','5','30','8','0','2','钻孔符号','10','100','20','200','30','0','41','2','42','2','43','1','0','ENDSEC','0','EOF','',
  ].join('\r\n')
  const adapter = createDXFFileAdapter()
  const document = await adapter.read(source)
  const insert = document.listEntities({ type: 'INSERT' })[0]
  const block = document.getObject(insert.payload.blockRecordId)
  assert.equal(block.name, '钻孔符号')
  assert.equal(document.listEntities({ ownerId: block.id, type: 'CIRCLE' }).length, 1)
  const written = await adapter.write(document, { version: '2018' })
  assert.match(written, /\r\nBLOCKS\r\n/)
  const reopened = await adapter.read(written)
  const reopenedInsert = reopened.listEntities({ type: 'INSERT' })[0]
  assert.equal(reopened.getObject(reopenedInsert.payload.blockRecordId).name, '钻孔符号')
  assert.equal(reopened.listEntities({ ownerId: reopenedInsert.payload.blockRecordId, type: 'CIRCLE' }).length, 1)
})

test('DXF DIMENSION semantics and raw definition data survive write and reopen', async () => {
  const source = [
    '0','SECTION','2','HEADER','9','$ACADVER','1','AC1032','0','ENDSEC',
    '0','SECTION','2','ENTITIES','0','DIMENSION','5','40','8','0','2','*D1','3','ISO-25','70','1','1','<>','10','5','20','7','30','0','11','5','21','9','31','0','13','0','23','0','33','0','14','10','24','0','34','0','42','10','0','ENDSEC','0','EOF','',
  ].join('\r\n')
  const adapter = createDXFFileAdapter()
  const document = await adapter.read(source)
  const dimension = document.listEntities({ type: 'DIMENSION' })[0]
  assert.equal(dimension.payload.dimensionType, 'ALIGNED')
  assert.equal(dimension.payload.styleName, 'ISO-25')
  assert.equal(dimension.payload.measurement, 10)
  assert.deepEqual(dimension.payload.definitionPoints, [[5, 7, 0], [0, 0, 0], [10, 0, 0]])
  const reopened = await adapter.read(await adapter.write(document, { version: '2018' }))
  assert.equal(reopened.listEntities({ type: 'DIMENSION' })[0].payload.dimensionType, 'ALIGNED')
  assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
})

test('DXF paper-space ownership and layout names survive write and reopen', async () => {
  const source = [
    '0','SECTION','2','HEADER','9','$ACADVER','1','AC1032','0','ENDSEC',
    '0','SECTION','2','ENTITIES',
    '0','LINE','5','50','8','0','67','1','410','A1图纸','10','0','20','0','11','100','21','0',
    '0','CIRCLE','5','51','8','0','67','1','410','A2图纸','10','10','20','20','40','5',
    '0','ENDSEC','0','EOF','',
  ].join('\r\n')
  const adapter = createDXFFileAdapter()
  const document = await adapter.read(source)
  const state = document.toJSON({ includeRevisions: false })
  assert.equal(state.spaces.paperSpaceIds.length, 2)
  assert.deepEqual(state.spaces.layoutIds.map(id => state.objects[id].name), ['Model', 'A1图纸', 'A2图纸'])
  assert.equal(document.listEntities({ ownerId: state.spaces.paperSpaceIds[0] }).length, 1)
  assert.equal(document.listEntities({ ownerId: state.spaces.paperSpaceIds[1] }).length, 1)
  const written = await adapter.write(document, { version: '2018' })
  assert.match(written, /\r\n410\r\nA1图纸\r\n/)
  assert.match(written, /\r\n410\r\nA2图纸\r\n/)
  const reopened = await adapter.read(written)
  const reopenedState = reopened.toJSON({ includeRevisions: false })
  assert.deepEqual(reopenedState.spaces.layoutIds.map(id => reopenedState.objects[id].name), ['Model', 'A1图纸', 'A2图纸'])
})

test('DXF target-version gate converts only equivalent R12 geometry and rejects lossy downgrades', async () => {
  const sdk = createKJDrawSDK()
  const adapter = sdk.fileAdapters.get('kanjie.dxf.ascii')
  const document = sdk.createDocument({ documentId: 'dxf-version-gate' })
  await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: { vertices: [[0, 0], [10, 0], [10, 10]], closed: true } })
  const r12 = await adapter.write(document, { version: 'R12' })
  assert.match(r12, /\r\nPOLYLINE\r\n/)
  assert.doesNotMatch(r12, /\r\nLWPOLYLINE\r\n/)
  await sdk.executeCommand('CREATE', { type: 'HATCH', payload: { boundaryLoops: [{ vertices: [[0, 0], [10, 0], [10, 10]], closed: true }], patternName: 'SOLID', solid: true } })
  assert.throws(() => adapter.write(document, { version: 'R12' }), error => error instanceof KJValidationError && /cannot represent HATCH without data loss/.test(error.message))
})

test('DXF pre-2000 export rejects multiple populated named paper spaces', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'dxf-paper-version-gate' })
  let firstPaperId
  await document.transact('Create paper spaces', tx => {
    firstPaperId = tx._draft().spaces.paperSpaceIds[0]
    const second = tx.createLayout({ name: 'Layout2' })
    tx.createEntity('LINE', { start: [0, 0, 0], end: [1, 0, 0] }, { ownerId: firstPaperId })
    tx.createEntity('LINE', { start: [0, 1, 0], end: [1, 1, 0] }, { ownerId: second.payload.blockRecordId })
  })
  await assert.rejects(sdk.writeDocument(document, { format: 'DXF', version: 'R14' }), error => error.cause instanceof KJValidationError && /multiple named paper spaces/.test(error.cause.message))
  const modern = await sdk.writeDocument(document, { format: 'DXF', version: '2000' })
  assert.equal((modern.match(/\r\n410\r\n/g) ?? []).length, 2)
})

test('DXF 2024 is an explicit AC1032 write alias and reopens without changing format family', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'dxf-2024-alias' })
  await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [2024, 1, 0] } })
  const artifact = await sdk.writeDocument(document, { format: 'DXF', version: '2024' })
  assert.match(artifact, /\$ACADVER\r\n\s*1\r\nAC1032\r\n/)
  const reopened = await sdk.readDocument(artifact, { format: 'DXF' })
  assert.equal(reopened.snapshot().header.sourceVersion, '2018')
  assert.deepEqual(reopened.listEntities({ type: 'LINE' })[0].payload.end, [2024, 1, 0])
})

test('DXF standard resource tables and entity style references survive write and reopen', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'dxf-resource-tables' })
  const linetype = await sdk.executeCommand('LINETYPE', { name: 'KJ-CENTER', description: 'Survey center', pattern: [12, -3, 2, -3] })
  const textStyle = await sdk.executeCommand('TEXTSTYLE', { name: 'KJ-CN', fontFile: 'simsun.ttc', bigFontFile: 'hztxt.shx', widthFactor: 0.8, obliqueAngle: 0.1 })
  const dimensionStyle = await sdk.executeCommand('DIMSTYLE', { name: 'KJ-100', properties: { overallScale: 100, arrowSize: 2.5, textHeight: 3.5, textGap: 0.7 } })
  await sdk.executeCommand('UCS', { name: 'SURVEY', origin: [100, 200, 0], xAxis: [0, 1, 0], yAxis: [-1, 0, 0] })
  await document.transact('Create named view', tx => tx.upsertTableRecord('views', { name: 'SITE', type: 'VIEW', payload: { center: [50, 60, 0], width: 500, height: 300, direction: [0, 0, 1], target: [0, 0, 0], twistAngle: 0.2 } }))
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'GEO-TEXT', color: 2, linetypeId: linetype.id, lineweight: 25, locked: true, plottable: false })
  await sdk.executeCommand('CREATE', { type: 'TEXT', payload: { position: [1, 2, 0], text: '钻孔 ZK01', height: 3.5, styleId: textStyle.id, layerId: layer.id } })
  await sdk.executeCommand('CREATE', { type: 'DIMENSION', payload: { dimensionType: 'ALIGNED', definitionPoints: [[0, 0, 0], [100, 0, 0]], textPosition: [50, 10, 0], styleId: dimensionStyle.id, styleName: 'KJ-100', layerId: layer.id } })

  const artifact = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  for (const table of ['LTYPE', 'STYLE', 'DIMSTYLE', 'UCS', 'VIEW', 'LAYER']) assert.match(artifact, new RegExp(`\\r\\n${table}\\r\\n`))
  const reopened = await sdk.readDocument(artifact, { format: 'DXF' })
  const reopenedLinetype = reopened.getTable('linetypes').records.find(record => record.name === 'KJ-CENTER')
  const reopenedTextStyle = reopened.getTable('textStyles').records.find(record => record.name === 'KJ-CN')
  const reopenedDimensionStyle = reopened.getTable('dimensionStyles').records.find(record => record.name === 'KJ-100')
  const reopenedLayer = reopened.getTable('layers').records.find(record => record.name === 'GEO-TEXT')
  assert.deepEqual(reopenedLinetype.payload.pattern, [12, -3, 2, -3])
  assert.equal(reopenedTextStyle.payload.fontFile, 'simsun.ttc')
  assert.equal(reopenedDimensionStyle.payload.overallScale, 100)
  assert.equal(reopened.getTable('ucs').records.find(record => record.name === 'SURVEY').payload.origin[0], 100)
  assert.equal(reopened.getTable('views').records.find(record => record.name === 'SITE').payload.width, 500)
  assert.equal(reopenedLayer.payload.linetypeId, reopenedLinetype.id)
  assert.equal(reopenedLayer.payload.locked, true)
  assert.equal(reopenedLayer.payload.plottable, false)
  assert.equal(reopened.listEntities({ type: 'TEXT' })[0].payload.styleId, reopenedTextStyle.id)
  assert.equal(reopened.listEntities({ type: 'DIMENSION' })[0].payload.styleId, reopenedDimensionStyle.id)
})
