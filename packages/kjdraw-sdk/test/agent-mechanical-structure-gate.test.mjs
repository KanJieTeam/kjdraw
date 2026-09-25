import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { auditMechanicalSheetStructure } from '../src/agent-mechanical-structure-gate.js'

async function synthetic({ extraSheet = true, paperLine = true, layerColor = 3, paperWidth = 420 } = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('synthetic mechanical sheet', transaction => {
    const layer = transaction.upsertTableRecord('layers', { name: 'PART_OUTLINE', type: 'LAYER', payload: { color: layerColor, visible: true, frozen: false, locked: false, plottable: true } })
    const layout = transaction.createLayout({ name: 'Production sheet', dxfPlotSettings: { paperWidth, paperHeight: 297, paperUnits: 1, plotType: 5 } })
    if (paperLine) transaction.createEntity('LINE', { start: [10, 10], end: [20, 20], layerId: layer.id }, { ownerId: layout.payload.blockRecordId })
    if (extraSheet) transaction.createLayout({ name: 'Detail sheet', dxfPlotSettings: { paperWidth: 210, paperHeight: 297, paperUnits: 1, plotType: 5 } })
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
