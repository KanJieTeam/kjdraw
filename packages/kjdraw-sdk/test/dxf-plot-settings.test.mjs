import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { createDXFFileAdapter } from '../src/dxf-adapter.js'

const layouts = doc => doc.snapshot().spaces.layoutIds.map(id => doc.getObject(id))
const settings = { pageSetupName: 'Engineering setup', printerName: '', paperName: 'Custom 610 x 914', viewName: '', marginLeft: 11, marginBottom: 12, marginRight: 13, marginTop: 14, paperWidth: 610, paperHeight: 914, originX: -2, originY: 3, windowMinX: -20, windowMinY: -30, windowMaxX: 125, windowMaxY: 250, scaleNumerator: 1, scaleDenominator: 50, flags: 132, paperUnits: 0, rotation: 3, plotType: 4, styleSheet: 'original.ctb', standardScaleType: 25, shadeMode: 2, shadeResolution: 5, shadeDpi: 720, unitFactor: 1 / 25.4, imageOriginX: 3.5, imageOriginY: -4.5 }

test('layout page settings preserve model, populated and empty sheets through KJD and DXF versions', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument()
  await doc.transact('original page configurations', tx => {
    tx.updateObject(layouts(doc)[0].id, { payload: { dxfPlotSettings: { ...settings, pageSetupName: 'Model preset', paperUnits: 2 } } })
    const paper = tx.createLayout({ name: '施工图 A', dxfPlotSettings: settings })
    tx.createLayout({ name: 'Empty B', dxfPlotSettings: { paperName: 'A5', paperWidth: 148, paperHeight: 210, rotation: 0 } })
    tx.createEntity('LINE', { start: [1, 2], end: [3, 4] }, { ownerId: paper.payload.blockRecordId })
  })
  const expected = layouts(doc).map(l => [l.name, l.payload.dxfPlotSettings])
  for (const version of ['2000', '2004', '2010', '2013', '2018', '2024']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(doc, { format: 'DXF', version }), { format: 'DXF' })
    assert.deepEqual(layouts(reopened).map(l => [l.name, l.payload.dxfPlotSettings]), expected, version)
    assert.deepEqual(layouts(reopened).map(l => reopened.listEntities({ ownerId: l.payload.blockRecordId }).length), [0, 0, 1, 0])
  }
  const kjd = await createKJDrawSDK().readDocument(await sdk.writeDocument(doc, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(layouts(kjd).map(l => [l.name, l.payload.dxfPlotSettings]), expected)
})

test('PAGESETUP edits only specified DXF fields, preserving other sheets, native settings and history', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument(), paper = layouts(doc)[1]
  await sdk.executeCommand('PLOTSETUP', { layoutId: paper.id, scale: 'fit', rotation: 90 })
  const native = doc.getObject(paper.id).payload.plotSettings
  await sdk.executeCommand('PAGESETUP', { layoutId: paper.id, dxf: settings })
  await sdk.executeCommand('PLOTSETUP', { layoutId: paper.id, dxf: { paperWidth: 594, paperHeight: 841, rotation: 1, scaleDenominator: 100 } })
  const edited = { ...settings, paperWidth: 594, paperHeight: 841, rotation: 1, scaleDenominator: 100 }
  assert.deepEqual(doc.getObject(paper.id).payload.dxfPlotSettings, edited)
  assert.deepEqual(doc.getObject(paper.id).payload.plotSettings, native)
  assert.equal(layouts(doc)[0].payload.dxfPlotSettings, undefined)
  await sdk.executeCommand('UNDO'); assert.deepEqual(doc.getObject(paper.id).payload.dxfPlotSettings, settings)
  await sdk.executeCommand('REDO'); assert.deepEqual(doc.getObject(paper.id).payload.dxfPlotSettings, edited)
  const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(doc, { format: 'DXF' }), { format: 'DXF' })
  assert.deepEqual(layouts(reopened)[1].payload.dxfPlotSettings, edited)
})

test('malformed page edits and KJD loads reject atomically; legacy DXF refuses page-setting loss', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument(), paper = layouts(doc)[1]
  for (const dxf of [null, [], { typo: 1 }, { paperWidth: -1 }, { scaleDenominator: 0 }, { rotation: 90 }, { paperUnits: 3 }, { paperHeight: Infinity }, { shadeDpi: 99 }, { printerName: 'bad\n0\nEOF' }, { flags: 1.5 }]) {
    const before = doc.serialize()
    await assert.rejects(sdk.executeCommand('PLOTSETUP', { layoutId: paper.id, dxf }))
    assert.equal(doc.serialize(), before)
  }
  await sdk.executeCommand('PLOTSETUP', { layoutId: paper.id, dxf: settings })
  for (const version of ['R12', 'R14']) assert.throws(() => createDXFFileAdapter().write(doc, { version }), /cannot preserve layout plot settings/)
  const invalid = JSON.parse(doc.serialize()); invalid.objects[paper.id].payload.dxfPlotSettings.scaleDenominator = 0
  await assert.rejects(createKJDrawSDK().readDocument(JSON.stringify(invalid), { format: 'KJD' }))
})

test('DXF subclass names and flags stay distinct and malformed scalar tags reject', async () => {
  const input = extra => `0\nSECTION\n2\nOBJECTS\n0\nLAYOUT\n5\nB1\n100\nAcDbPlotSettings\n1\nPreset\n70\n132\n44\n610\n${extra}100\nAcDbLayout\n1\nSheet\n70\n1\n71\n7\n330\nB0\n0\nENDSEC\n0\nEOF\n`
  const doc = await createKJDrawSDK().readDocument(input(''), { format: 'DXF' })
  assert.equal(layouts(doc)[1].name, 'Sheet')
  assert.deepEqual(layouts(doc)[1].payload.dxfPlotSettings, { pageSetupName: 'Preset', flags: 132, paperWidth: 610 })
  for (const extra of ['44\n300\n', '143\nNaN\n', '73\n9\n']) await assert.rejects(createKJDrawSDK().readDocument(input(extra), { format: 'DXF' }))
})


test('window and named-view page edits reject incomplete or reversed configurations atomically', async () => {
  const sdk = createKJDrawSDK(), doc = sdk.createDocument(), paper = layouts(doc)[1]
  for (const dxf of [{ plotType: 4 }, { plotType: 4, windowMinX: 2, windowMinY: 0, windowMaxX: 1, windowMaxY: 1 }, { plotType: 4, windowMinX: 0, windowMinY: 1, windowMaxX: 1, windowMaxY: 1 }, { plotType: 3 }, { plotType: 3, viewName: '  ' }]) {
    const before = doc.serialize()
    await assert.rejects(sdk.executeCommand('PAGESETUP', { layoutId: paper.id, dxf }))
    assert.equal(doc.serialize(), before)
  }
  const window = { plotType: 4, windowMinX: -20, windowMinY: -30, windowMaxX: 125, windowMaxY: 250, flags: 148, standardScaleType: 0 }
  await sdk.executeCommand('PAGESETUP', { layoutId: paper.id, dxf: window })
  const before = doc.serialize()
  await assert.rejects(sdk.executeCommand('PAGESETUP', { layoutId: paper.id, dxf: { windowMaxX: -21 } }))
  assert.equal(doc.serialize(), before)
  await sdk.executeCommand('PAGESETUP', { layoutId: paper.id, dxf: { windowMaxX: 150 } })
  assert.equal(doc.getObject(paper.id).payload.dxfPlotSettings.windowMaxX, 150)
  await sdk.executeCommand('UNDO'); assert.deepEqual(doc.getObject(paper.id).payload.dxfPlotSettings, window)
  await doc.transact('named plot view', tx => tx.upsertTableRecord('views', { name:'Original View', type:'VIEW', payload:{ center:[0,0,0], width:100, height:100, direction:[0,0,1], target:[0,0,0] } }))
  await sdk.executeCommand('PAGESETUP', { layoutId: paper.id, dxf: { plotType: 3, viewName: 'Original View' } })
  assert.equal(doc.getObject(paper.id).payload.dxfPlotSettings.viewName, 'Original View')
})
