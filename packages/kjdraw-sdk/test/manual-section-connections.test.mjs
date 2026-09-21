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

test('section style pack preserves a declared drawing origin and independent frame margins through KJD and DXF', async () => {
  const pack = JSON.parse(JSON.stringify(KJDRAW_GEOLOGY_KNOWLEDGE_PACK))
  pack.id = 'test.section.offset-asymmetric-layout'
  pack.version = '1.0.0'
  pack.rules['geology-section-layout'] = {
    paperWidth: 700, paperHeight: 400, drawingOrigin: [-123, 456],
    outerMargins: { left: 0, right: 0, bottom: 0, top: 0 },
    innerMargins: { left: 31, right: 11, bottom: 12, top: 9 },
    plotLeft: 42, plotRight: 680, plotBottom: 45, plotTop: 320,
    titleY: 370, scaleY: 350, footerHeight: 10, boreholeWidth: 3, elevationTickStep: 2,
    footerGrid: [
      { start: 31, key: 'projectName', label: 'Project' },
      { start: 223, key: 'organization', label: 'Organization' },
      { start: 347, key: 'preparedBy', label: 'Prepared' },
      { start: 431, key: 'checkedBy', label: 'Checked' },
      { start: 517, key: 'approvedBy', label: 'Approved' },
      { start: 601, key: 'drawingNumber', label: 'Drawing' },
    ],
  }
  const input = { holes, correlations: [], sectionStylePack: pack,
    horizontalScaleDenominator: 100, verticalScaleDenominator: 100, datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }
  const result = compileGeologySection(input)
  const frames = result.commandArgs.entities.filter(entity => entity.type === 'LWPOLYLINE').slice(0, 2)
  const bounds = entity => {
    const points = entity.payload.vertices.map(vertex => vertex.point ?? vertex)
    const xs = points.map(point => point[0]), ys = points.map(point => point[1])
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  }
  assert.deepEqual(frames.map(bounds), [[-123, 577, 456, 856], [-92, 566, 468, 847]])
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await sdk.readDocument(bytes, { format })
    const reopenedFrames = reopened.listEntities({ type: 'LWPOLYLINE' }).slice(0, 2)
    assert.deepEqual(reopenedFrames.map(entity => bounds({ payload: entity.payload })), frames.map(bounds))
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  }
  const ambiguous = structuredClone(input)
  ambiguous.sectionStylePack.rules['geology-section-layout'].outerMargin = 5
  assert.throws(() => compileGeologySection(ambiguous), /undeclared field/u)
  const unreadable = structuredClone(input)
  const legacyUnreadable = structuredClone(input)
  delete legacyUnreadable.sectionStylePack.rules['geology-section-layout'].outerMargins
  legacyUnreadable.sectionStylePack.rules['geology-section-layout'].outerMargin = 0
  assert.throws(() => compileGeologySection(legacyUnreadable), /geometry is unreadable/u)
  unreadable.sectionStylePack.rules['geology-section-layout'].innerMargins.right = 0
  assert.throws(() => compileGeologySection(unreadable), /geometry is unreadable/u)
})

test('section style pack preserves explicit frame primitives, start corners, winding and bounded width through KJD and DXF', async () => {
  const pack = JSON.parse(JSON.stringify(KJDRAW_GEOLOGY_KNOWLEDGE_PACK))
  pack.id = 'test.section.frame-topology'
  pack.version = '1.0.0'
  const rule = pack.rules['geology-section-layout']
  rule.frameStyle = {
    outer: { primitive: 'line-segments', startCorner: 'top-right', winding: 'counter-clockwise' },
    inner: { primitive: 'closed-polyline', startCorner: 'bottom-right', winding: 'clockwise', constantWidth: 1.25 },
  }
  const input = { holes, correlations: [], sectionStylePack: pack,
    horizontalScaleDenominator: 100, verticalScaleDenominator: 100, datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }
  const result = compileGeologySection(input)
  const entities = result.commandArgs.entities
  assert.deepEqual(entities.slice(0, 4).map(entity => [entity.type, entity.payload.start, entity.payload.end]), [
    ['LINE', [415, 292, 0], [5, 292, 0]],
    ['LINE', [5, 292, 0], [5, 5, 0]],
    ['LINE', [5, 5, 0], [415, 5, 0]],
    ['LINE', [415, 5, 0], [415, 292, 0]],
  ])
  const inner = entities[4]
  assert.equal(inner.type, 'LWPOLYLINE')
  assert.equal(inner.payload.closed, true)
  assert.equal(inner.payload.constantWidth, 1.25)
  assert.deepEqual(inner.payload.vertices, [[408, 12, 0], [12, 12, 0], [12, 285, 0], [408, 285, 0]])
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await sdk.readDocument(bytes, { format })
    const lines = reopened.listEntities({ type: 'LINE' }).slice(0, 4)
    assert.deepEqual(lines.map(entity => [entity.payload.start, entity.payload.end]), entities.slice(0, 4).map(entity => [entity.payload.start, entity.payload.end]))
    const reopenedInner = reopened.listEntities({ type: 'LWPOLYLINE' })[0]
    assert.equal(reopenedInner.payload.constantWidth, 1.25)
    assert.deepEqual(reopenedInner.payload.vertices.map(vertex => vertex.point ?? vertex), inner.payload.vertices)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  }
  const invalid = mutate => {
    const changed = structuredClone(input)
    mutate(changed.sectionStylePack.rules['geology-section-layout'].frameStyle)
    return () => compileGeologySection(changed)
  }
  assert.throws(invalid(style => { style.outer.constantWidth = 1 }), /undeclared or missing field/u)
  assert.throws(invalid(style => { delete style.inner.constantWidth }), /undeclared or missing field/u)
  assert.throws(invalid(style => { style.outer.startCorner = 'middle' }), /start corner is invalid/u)
  assert.throws(invalid(style => { style.outer.winding = 'inside-out' }), /winding is invalid/u)
  assert.throws(invalid(style => { style.inner.constantWidth = 5.01 }), /out of bounds/u)
})

test('section preserves caller-supplied references and native measured-observation symbols through KJD and DXF', async () => {
  const pack = structuredClone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  pack.id = 'test.section.references-and-observation-symbols'
  pack.version = '1.0.0'
  const rule = pack.rules['geology-section-layout']
  const placement = (offset, height, horizontalAlignment = 'center') => ({
    offset, height, textWidthFactor: 1, horizontalAlignment, verticalAlignment: 'baseline',
  })
  rule.sectionReferenceStyle = {
    start: placement([190, 315], 4, 'right'),
    end: placement([230, 315], 4, 'left'),
  }
  rule.observationSymbolStyle = {
    sample: { centerOffset: [6, -1], radius: 1, fill: 'solid' },
    spt: { topRightOffset: [0, 0], width: 10, height: 3, labelPlacement: placement([-5, -2], 2) },
    groundwater: { insertOffset: [-8, 0], lineSegments: [
      [[0, -2], [4, -2]],
      [[0, -1], [4, -1]],
    ], markerPolygon: [[1, 2], [3, 2], [2, 0]], fill: 'solid' },
  }
  const measured = structuredClone(holes)
  measured[0].stableWaterDepth = 6
  measured[0].observations = [
    { kind: 'sample', id: 'sample-1', depth: 2, sampleMarker: 'filled-circle' },
    { kind: 'spt', id: 'spt-1', depth: 4, value: 8 },
  ]
  const input = {
    holes: measured, correlations: [], sectionReference: { start: 'S1', end: "S1'" }, sectionStylePack: pack,
    horizontalScaleDenominator: 100, verticalScaleDenominator: 100, datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0,
  }
  const result = compileGeologySection(input)
  const entities = result.commandArgs.entities
  const references = entities.filter(entity => entity.type === 'TEXT' && ['S1', "S1'"].includes(entity.payload.text))
  assert.deepEqual(references.map(entity => ({ position: entity.payload.position, alignmentPoint: entity.payload.alignmentPoint,
    height: entity.payload.height, horizontalAlignment: entity.payload.horizontalAlignment ?? 0 })), [
    { position: [190, 315, 0], alignmentPoint: [190, 315, 0], height: 4, horizontalAlignment: 2 },
    { position: [230, 315, 0], alignmentPoint: undefined, height: 4, horizontalAlignment: 0 },
  ])
  const circle = entities.find(entity => entity.type === 'CIRCLE' && entity.payload.radius === 1)
  assert.deepEqual(circle.payload.center, [58, 222, 0])
  const solid = entities.find(entity => entity.type === 'HATCH' && entity.payload.solid === true && entity.payload.boundaryLoops[0].edges)
  assert.equal(solid.payload.boundaryLoops[0].edges[0].type, 'ARC')
  assert.deepEqual(solid.payload.boundaryLoops[0].edges[0].center, circle.payload.center)
  const box = entities.filter(entity => entity.type === 'LINE').filter(entity => {
    const points = [entity.payload.start, entity.payload.end]
    return points.every(point => point[0] >= 42 && point[0] <= 52 && point[1] >= 200 && point[1] <= 203)
  })
  assert.equal(box.length, 4)
  const groundwaterMarker = entities.find(entity => entity.type === 'LWPOLYLINE' && entity.payload.closed === true && entity.payload.vertices.length === 3)
  assert.deepEqual(groundwaterMarker.payload.vertices, [[45, 185, 0], [47, 185, 0], [46, 183, 0]])
  assert.equal(entities.filter(entity => entity.type === 'HATCH' && entity.payload.solid === true).length, 2)
  assert.equal(entities.filter(entity => entity.type === 'TEXT' && String(entity.payload.text).startsWith('WL ')).length, 0)
  const spt = entities.find(entity => entity.type === 'TEXT' && entity.payload.text === 'N=8')
  assert.deepEqual(spt.payload.alignmentPoint, [47, 201, 0])
  assert.equal(spt.payload.height, 2)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  for (const [format, version] of [['KJD', '1'], ['DXF', '2018']]) {
    const bytes = await sdk.writeDocument(document, { format, version })
    const reopened = await sdk.readDocument(bytes, { format, version })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    assert.equal(reopened.listEntities({ type: 'CIRCLE' }).length, document.listEntities({ type: 'CIRCLE' }).length)
    assert.equal(reopened.listEntities({ type: 'HATCH' }).filter(entity => entity.payload.solid === true).length, 2)
  }
  const missingPlacement = structuredClone(input)
  delete missingPlacement.sectionStylePack.rules['geology-section-layout'].sectionReferenceStyle
  assert.throws(() => compileGeologySection(missingPlacement), /reference needs a declared source-backed placement/u)
  const oversized = structuredClone(input)
  oversized.sectionStylePack.rules['geology-section-layout'].observationSymbolStyle.spt.width = 31
  assert.throws(() => compileGeologySection(oversized), /symbol geometry is unreadable/u)
  const undeclared = structuredClone(input)
  undeclared.sectionReference.middle = 'invented'
  const invalidGroundwater = structuredClone(input)
  invalidGroundwater.sectionStylePack.rules['geology-section-layout'].observationSymbolStyle.groundwater.lineSegments = []
  assert.throws(() => compileGeologySection(invalidGroundwater), /groundwater symbol geometry is unreadable/u)
  assert.throws(() => compileGeologySection(undeclared), /exact start and end identifiers/u)
})

test('section style pack preserves bounded title and scale TEXT placement through KJD and DXF', async () => {
  const pack = structuredClone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  pack.id = 'test.section.heading-text-placement'
  pack.version = '1.0.0'
  const rule = pack.rules['geology-section-layout']
  rule.headingTextStyle = {
    title: { anchorX: 233, height: 6.25, textWidthFactor: 0.8, horizontalAlignment: 4, verticalAlignment: 0 },
    scale: { anchorX: 237, height: 3.75, textWidthFactor: 0.7, horizontalAlignment: 2, verticalAlignment: 3 },
  }
  const input = { holes, correlations: [], sectionStylePack: pack, title: 'SYNTHETIC SECTION TITLE',
    horizontalScaleDenominator: 100, verticalScaleDenominator: 100, datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }
  const result = compileGeologySection(input)
  const texts = result.commandArgs.entities.filter(entity => entity.type === 'TEXT')
  const title = texts.find(entity => entity.payload.text === input.title)
  const scale = texts.find(entity => String(entity.payload.text).startsWith('HORIZONTAL'))
  assert.deepEqual([title.payload.position, title.payload.alignmentPoint, title.payload.height, title.payload.widthFactor,
    title.payload.horizontalAlignment, title.payload.verticalAlignment ?? 0], [[233, 277, 0], [233, 277, 0], 6.25, 0.8, 4, 0])
  assert.deepEqual([scale.payload.position, scale.payload.alignmentPoint, scale.payload.height, scale.payload.widthFactor,
    scale.payload.horizontalAlignment, scale.payload.verticalAlignment], [[237, 268, 0], [237, 268, 0], 3.75, 0.7, 2, 3])
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await sdk.readDocument(bytes, { format })
    const reopenedTitle = reopened.listEntities({ type: 'TEXT' }).find(entity => entity.payload.text === input.title)
    const reopenedScale = reopened.listEntities({ type: 'TEXT' }).find(entity => String(entity.payload.text).startsWith('HORIZONTAL'))
    for (const [actual, expected] of [[reopenedTitle, title], [reopenedScale, scale]]) {
      assert.equal(actual.payload.height, expected.payload.height)
      assert.equal(actual.payload.widthFactor, expected.payload.widthFactor)
      assert.equal(actual.payload.horizontalAlignment, expected.payload.horizontalAlignment)
      assert.equal(actual.payload.verticalAlignment ?? 0, expected.payload.verticalAlignment ?? 0)
      assert.deepEqual(actual.payload.alignmentPoint, expected.payload.alignmentPoint)
    }
    assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  }
  const legacy = structuredClone(input)
  delete legacy.sectionStylePack.rules['geology-section-layout'].headingTextStyle
  const legacyTitle = compileGeologySection(legacy).commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === input.title)
  assert.deepEqual([legacyTitle.payload.height, legacyTitle.payload.horizontalAlignment, legacyTitle.payload.position,
    legacyTitle.payload.widthFactor, legacyTitle.payload.rotation], [5, 1, [210, 277, 0], undefined, undefined])
  const invalid = mutate => {
    const changed = structuredClone(input)
    mutate(changed.sectionStylePack.rules['geology-section-layout'].headingTextStyle)
    return () => compileGeologySection(changed)
  }
  assert.throws(invalid(style => { style.title.extra = true }), /exact placement schema/u)
  assert.throws(invalid(style => { delete style.scale.height }), /exact placement schema/u)
  assert.throws(invalid(style => { style.title.horizontalAlignment = 3 }), /out of bounds/u)
  assert.throws(invalid(style => { style.scale.height = 12.01 }), /out of bounds/u)
  assert.throws(invalid(style => { style.title.anchorX = 2 }), /geometry is unreadable/u)
})
