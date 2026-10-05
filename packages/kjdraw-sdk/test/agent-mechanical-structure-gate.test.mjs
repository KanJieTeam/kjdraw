import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { auditMechanicalSheetStructure } from '../src/agent-mechanical-structure-gate.js'

async function synthetic({ extraSheet = true, paperLine = true, paperEnd = [20, 20], layerColor = 3, paperWidth = 420 } = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('synthetic mechanical sheet', transaction => {
    const layer = transaction.upsertTableRecord('layers', { name: 'PART_OUTLINE', type: 'LAYER', payload: { color: layerColor, visible: true, frozen: false, locked: false, plottable: true } })
    const layout = transaction.createLayout({ name: 'Production sheet', dxfPlotSettings: { paperWidth, paperHeight: 297, paperUnits: 1, plotType: 5 } })
    if (paperLine) transaction.createEntity('LINE', { start: [10, 10], end: paperEnd, layerId: layer.id }, { ownerId: layout.payload.blockRecordId })
    if (extraSheet) transaction.createLayout({ name: 'Detail sheet', dxfPlotSettings: { paperWidth: 210, paperHeight: 297, paperUnits: 1, plotType: 5 } })
  })
  return { sdk, document }
}

async function syntheticBlock({ blockEnd = [6, 0, 0], basePoint = [0, 0, 0], extraBlock = false } = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('synthetic reusable mechanical detail', transaction => {
    const definition = transaction.upsertTableRecord('blockRecords', { name: 'FLANGE DETAIL', payload: { basePoint, entityIds: [], isSpace: false } })
    transaction.createEntity('LINE', { start: [0, 0, 0], end: blockEnd }, { ownerId: definition.id })
    transaction.createEntity('INSERT', { blockRecordId: definition.id, position: [20, 20, 0] })
    if (extraBlock) transaction.upsertTableRecord('blockRecords', { name: 'UNUSED DETAIL', payload: { basePoint: [0, 0, 0], entityIds: [], isSpace: false } })
  })
  return { sdk, document }
}

test('mechanical structure gate keeps layout, paper, layer and plot checks after KJD/DXF reopening', async () => {
  const { sdk, document } = await synthetic()
  for (const format of ['KJD', 'DXF']) {
    const data = await sdk.writeDocument(document, format === 'DXF' ? { format, version: '2018' } : { format })
    const reopened = await sdk.readDocument(data, { format })
    const baseline = auditMechanicalSheetStructure(reopened, reopened)
    assert.equal(baseline.passed, true)
    assert.equal(baseline.layouts.source, baseline.layouts.candidate)
    assert.equal(baseline.layers.source, baseline.layers.candidate)
  }
})

test('mechanical structure gate rejects matching model views with changed layout, paper, layer and plot facts', async () => {
  const { sdk, document: source } = await synthetic()
  const { document: altered } = await synthetic({ extraSheet: false, paperLine: false, layerColor: 1, paperWidth: 594 })
  for (const format of ['KJD', 'DXF']) {
    const options = format === 'DXF' ? { format, version: '2018' } : { format }
    const [original, candidate] = await Promise.all([sdk.readDocument(await sdk.writeDocument(source, options), { format }), sdk.readDocument(await sdk.writeDocument(altered, options), { format })])
    const result = auditMechanicalSheetStructure(original, candidate)
    assert.equal(result.passed, false)
    assert.equal(result.layouts.missing, 1)
    assert.ok(result.layouts.plotFields >= 1)
    assert.equal(result.layouts.paperEntityTypes, 1)
    assert.ok(result.layers.fields >= 1)
    assert.equal(JSON.stringify(result).includes('PART_OUTLINE'), false)
  }
})

test('mechanical structure gate rejects altered paper geometry even when entity type counts match', async () => {
  const { document: source } = await synthetic()
  const { document: sameFacts } = await synthetic()
  const { document: movedPaperLine } = await synthetic({ paperEnd: [21, 20] })
  assert.equal(auditMechanicalSheetStructure(source, sameFacts).passed, true)
  const result = auditMechanicalSheetStructure(source, movedPaperLine)
  assert.equal(result.passed, false)
  assert.equal(result.layouts.paperEntityTypes, 0)
  assert.equal(result.layouts.paperEntitySemantics, 1)
  assert.equal(JSON.stringify(result).includes('21'), false)
})

test('mechanical structure gate rejects changed reusable block geometry behind an unchanged model INSERT', async () => {
  const { sdk, document: source } = await syntheticBlock()
  const { document: sameFacts } = await syntheticBlock()
  const { document: changed } = await syntheticBlock({ blockEnd: [7, 0, 0] })
  for (const format of ['KJD', 'DXF']) {
    const options = format === 'DXF' ? { format, version: '2018' } : { format }
    const reopen = async document => sdk.readDocument(await sdk.writeDocument(document, options), { format })
    const [original, equivalent, altered] = await Promise.all([reopen(source), reopen(sameFacts), reopen(changed)])
    assert.equal(auditMechanicalSheetStructure(original, equivalent).passed, true)
    const result = auditMechanicalSheetStructure(original, altered)
    assert.equal(result.passed, false)
    assert.equal(result.blocks.entityTypes, 0)
    assert.equal(result.blocks.entitySemantics, 1)
    assert.equal(result.layouts.paperEntitySemantics, 0)
    assert.equal(JSON.stringify(result).includes('FLANGE DETAIL'), false)
  }
})

test('mechanical structure gate compares reusable block metadata and missing or extra definitions', async () => {
  const { document: source } = await syntheticBlock()
  const { document: movedBase } = await syntheticBlock({ basePoint: [1, 0, 0] })
  const { document: extra } = await syntheticBlock({ extraBlock: true })
  const changed = auditMechanicalSheetStructure(source, movedBase)
  assert.equal(changed.passed, false)
  assert.ok(changed.blocks.definitionFields >= 1)
  assert.equal(changed.blocks.entitySemantics, 0)
  assert.equal(auditMechanicalSheetStructure(source, extra).blocks.extra, 1)
  assert.equal(auditMechanicalSheetStructure(extra, source).blocks.missing, 1)
})
