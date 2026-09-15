import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK, exportDrawingSvg } from '../src/index.js'

async function preview(patternLines) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const layerId = document.getTable('layers').records.find(layer => layer.name === '0').id
  await sdk.executeCommand('CREATEBATCH', { entities: [{ type: 'HATCH', payload: {
    layerId, solid: false, patternName: 'ORIGINAL_TEST_PAT', patternScale: 1, patternAngle: 0,
    patternLines, boundaryLoops: [{ external: true, closed: true, vertices: [[10, 10, 0], [60, 10, 0], [60, 35, 0], [10, 35, 0]] }],
  } }] }, { document })
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.name === 'Model')
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 100, paperHeight: 60, paperUnits: 1,
    plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 100, windowMaxY: 60, flags: 0,
    scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 } }, { document })
  return { sdk, document, layout }
}

test('authored PAT line families have bounded visible SVG geometry and preserve native DXF hatch', async () => {
  const { sdk, document, layout } = await preview([
    { angle: 0, base: [0, 0], offset: [0, 3], dashes: [1, -2] },
    { angle: Math.PI / 2, base: [0, 0], offset: [0, 4], dashes: [] },
  ])
  const svg = exportDrawingSvg(document, { layoutId: layout.id })
  assert.equal(svg.report.diagnostics.length, 0)
  assert.equal(svg.report.rendered, 1)
  assert.equal(svg.report.approximations.filter(item => item.type === 'HATCH').length, 1)
  assert.match(svg.svg, /kj-pat-clip-/)
  assert.match(svg.svg, /stroke-dasharray="1 2"/)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 1)
  assert.equal(reopened.listEntities({ type: 'HATCH' })[0].payload.patternLines.length, 2)
})

test('non-spacing or unbounded custom PAT definitions refuse a misleading SVG preview', async () => {
  const invalid = await preview([{ angle: 0, base: [0, 0], offset: [5, 0], dashes: [] }])
  assert.throws(() => exportDrawingSvg(invalid.document, { layoutId: invalid.layout.id }), /visible geometry could not be represented/)
  const diagnostic = exportDrawingSvg(invalid.document, { layoutId: invalid.layout.id, allowPartial: true }).report.diagnostics
  assert.equal(diagnostic.length, 1)
  assert.match(diagnostic[0].reason, /no readable row spacing/)
})
