import assert from 'node:assert/strict'
import test from 'node:test'
import { compileGeologySection, createKJDrawSDK, KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../src/index.js'

const holes = [
  { id: 'ZK1', station: 0, collarElevation: 100, depth: 10, strata: [{ code: '1', name: 'soil', top: 0, bottom: 10, lithology: 'clay' }] },
  { id: 'ZK2', station: 20, collarElevation: 99, depth: 10, strata: [{ code: '1', name: 'soil', top: 0, bottom: 10, lithology: 'clay' }] },
]

test('source manual section connection is rendered and reopens without inventing a correlation', async () => {
  const result = compileGeologySection({
    holes,
    correlations: [],
    manualConnections: [{ fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 4, toDepth: 5, kind: 'pinchout', layerCode: '1' }],
    horizontalScaleDenominator: 100,
    verticalScaleDenominator: 100,
    datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars',
    expectedRevision: 0,
  })
  const lines = result.commandArgs.entities.filter(entity => entity.type === 'LINE' && entity.payload.semanticRole === 'source-manual-connection')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].payload.connectionKind, 'pinchout')
  assert.equal(lines[0].payload.sourceLayerCode, '1')
  assert.equal(result.evidence.entityCount, result.commandArgs.entities.length)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
  assert.equal(reopenedKjd.listEntities({ type: 'LINE' }).length, document.listEntities({ type: 'LINE' }).length)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopenedDxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  assert.equal(reopenedDxf.listEntities({ type: 'LINE' }).length, document.listEntities({ type: 'LINE' }).length)
})

test('source manual section connections reject non-adjacent, out-of-range and crossing input', () => {
  assert.throws(() => compileGeologySection({ holes, correlations: [], manualConnections: [{ fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 11, toDepth: 5 }], horizontalScaleDenominator: 100, verticalScaleDenominator: 100, datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }), /outside its borehole/)
  assert.throws(() => compileGeologySection({ holes, correlations: [], manualConnections: [{ fromHoleId: 'ZK2', toHoleId: 'ZK1', fromDepth: 4, toDepth: 5 }], horizontalScaleDenominator: 100, verticalScaleDenominator: 100, datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }), /declared station order/)
})

test('source-backed pinchout and lens boundaries may share one endpoint without permitting ordinary branching or crossing', () => {
  const base = { holes, correlations: [], horizontalScaleDenominator: 100, verticalScaleDenominator: 100,
    datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }
  const result = compileGeologySection({ ...base, manualConnections: [
    { fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 4, toDepth: 5, kind: 'pinchout', layerCode: '1a' },
    { fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 4, toDepth: 7, kind: 'continuity', layerCode: '1b' },
  ] })
  const boundaries = result.commandArgs.entities.filter(entity => entity.type === 'LINE' && entity.payload.semanticRole === 'source-manual-connection')
  assert.equal(boundaries.length, 2)
  assert.throws(() => compileGeologySection({ ...base, manualConnections: [
    { fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 4, toDepth: 5, kind: 'manualBoundary' },
    { fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 4, toDepth: 7, kind: 'continuity' },
  ] }), /branching manual connections require/u)
  assert.throws(() => compileGeologySection({ ...base, manualConnections: [
    { fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 2, toDepth: 8, kind: 'pinchout' },
    { fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 8, toDepth: 2, kind: 'lens' },
  ] }), /cross or reverse/u)
})
test('versioned section style pack controls physical sheet geometry without project code', () => {
  const pack = JSON.parse(JSON.stringify(KJDRAW_GEOLOGY_KNOWLEDGE_PACK))
  pack.id = 'test.section.physical-layout'
  pack.version = '1.0.0'
  pack.rules['geology-section-layout'] = {
    paperWidth: 656, paperHeight: 361, outerMargin: 5, innerMargin: 10,
    plotLeft: 20, plotRight: 645, plotBottom: 40, plotTop: 300,
    titleY: 345, scaleY: 330, footerHeight: 10, boreholeWidth: 3, elevationTickStep: 2,
    footerGrid: [
      { start: 10, key: 'projectName', label: 'Project' },
      { start: 190, key: 'organization', label: 'Organization' },
      { start: 310, key: 'preparedBy', label: 'Prepared' },
      { start: 390, key: 'checkedBy', label: 'Checked' },
      { start: 470, key: 'approvedBy', label: 'Approved' },
      { start: 550, key: 'drawingNumber', label: 'Drawing' },
    ],
  }
  const result = compileGeologySection({ holes, correlations: [], sectionStylePack: pack,
    horizontalScaleDenominator: 100, verticalScaleDenominator: 100, datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 })
  const outer = result.commandArgs.entities.find(entity => entity.type === 'LWPOLYLINE')
  const xs = outer.payload.vertices.map(point => point[0]), ys = outer.payload.vertices.map(point => point[1])
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [5, 651, 5, 356])
})
