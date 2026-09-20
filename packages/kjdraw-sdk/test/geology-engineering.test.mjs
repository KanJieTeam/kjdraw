import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { buildHatchPatternKnowledgePack, compileGeologyColumn, compileGeologySection, createKJDrawSDK, exportDrawingSvg, validateKnowledgePack } from '../src/index.js'
import { layoutCadMText } from '../src/geometry/text-layout.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const hole = (id, station, collarElevation, depths = [3, 9, 16]) => ({
  id, station, collarElevation, depth: depths.at(-1),
  strata: [
    { code: '1', name: 'Made ground', top: 0, bottom: depths[0], lithology: 'fill' },
    { code: '2', name: 'Silty clay', top: depths[0], bottom: depths[1], lithology: 'clay' },
    { code: '3', name: 'Medium sand', top: depths[1], bottom: depths[2], lithology: 'sand' },
  ],
})

test('engineering column expands stratigraphy into physical A4 frame, elevations, depth scale and legend', async () => {
  const input = { hole: hole('ZK-01', 0, 105.25), verticalScaleDenominator: 125, expectedRevision: 0 }
  const a = compileGeologyColumn(input), b = compileGeologyColumn(input)
  assert.deepEqual(a, b)
  assert.equal(a.evidence.templateId, 'borehole-column-engineering')
  assert.ok(a.commandArgs.entities.length > 35)
  assert.equal(a.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 6)
  const labels = a.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['DEPTH m', 'ELEV. m', 'LITHOLOGY LEGEND', '89.25', '16.00', 'VERTICAL SCALE 1:125']) assert.ok(labels.some(label => label.includes(expected)), expected)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', a.commandArgs, { document })
  assert.equal(document.revision, 1)
  assert.equal(document.listEntities().length, a.evidence.entityCount)
  assert.equal(document.getTable('layers').records.filter(layer => layer.name.startsWith('GEO_')).length, 5)
  await sdk.executeCommand('UNDO', {}, { document })
  assert.equal(document.listEntities().length, 0)
  await sdk.executeCommand('REDO', {}, { document })
  assert.equal(document.listEntities().length, a.evidence.entityCount)
  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
  assert.equal(reopenedKjd.listEntities({ type: 'HATCH' }).length, 6)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopenedDxf.listEntities({ type: 'HATCH' }).length, 6)
  assert.equal(reopenedDxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.name === 'Model')
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 210, paperHeight: 297, paperUnits: 1, plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 210, windowMaxY: 297, flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 } }, { document })
  const svg = exportDrawingSvg(document, { layoutId: layout.id })
  assert.equal(svg.report.diagnostics.length, 0)
  assert.match(svg.svg, /LITHOLOGY LEGEND/)
})

test('legacy footer legend lays out seven distinct lithologies without merging source strata', () => {
  const kinds = ['fill', 'clay', 'silt', 'sand', 'gravel', 'rock', 'weathered-rock']
  const input = { hole: { id: 'LEGEND-7', collarElevation: 120, depth: 14,
    strata: kinds.map((lithology, index) => ({ code: String(index + 1), name: `Unit ${index + 1}`,
      top: index * 2, bottom: (index + 1) * 2, lithology })) },
    verticalScaleDenominator: 100, expectedRevision: 0 }
  const compiled = compileGeologyColumn(input)
  assert.equal(compiled.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 14,
    'seven exact strata and seven legend swatches are retained')
  const labels = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['fill', 'clay', 'silt', 'sand', 'gravel', 'rock', 'weathered rock'])
    assert.ok(labels.includes(expected), expected)
})

test('A4 footer legend retains nine distinct lithologies and reports their exact count', () => {
  const kinds = ['fill', 'cultivated-soil', 'clay', 'silty-clay', 'silt', 'sand', 'gravel', 'loess', 'paleosol']
  const result = compileGeologyColumn({ hole: { id: 'LEGEND-9', collarElevation: 300, depth: 30,
    strata: kinds.map((lithology, index) => ({ code: String(index + 1), name: `Unit ${index + 1}`,
      top: index * 30 / 9, bottom: (index + 1) * 30 / 9, lithology })) }, expectedRevision: 0 })
  assert.equal(result.evidence.parameters.stratumCount, 9)
  assert.equal(result.evidence.parameters.lithologyCount, 9)
  assert.equal(result.evidence.parameters.verticalScaleDenominator, 200)
  assert.equal(result.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 18,
    'all nine strata and all nine separate legend swatches must remain native hatches')
  const labels = result.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const kind of kinds) assert.ok(labels.includes(kind.replaceAll('-', ' ')), kind)
})

test('Chinese geology inputs produce Chinese compiler labels for columns and sections', () => {
  const columnHole = hole('ZK-中文-01', 0, 105.25)
  columnHole.strata[0].name = '杂填土'
  columnHole.strata[1].name = '粉质黏土'
  columnHole.strata[2].name = '中砂'
  const column = compileGeologyColumn({ hole: columnHole, expectedRevision: 0 })
  const columnText = column.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['钻孔柱状图', '勘探点编号', 'ZK-中文-01', '深度', '柱状图图例', '地  层  描  述']) assert.ok(columnText.some(value => value.includes(expected)), expected)
  assert.ok(columnText.includes('1:100'), 'the physical column header carries the selected vertical scale')
  assert.ok(!columnText.some(value => /ENGINEERING BOREHOLE LOG|LITHOLOGY LEGEND|VERTICAL SCALE/u.test(value)))
  const verticalRules = column.commandArgs.entities.filter(entity => entity.type === 'LINE' &&
    entity.payload.start[0] === entity.payload.end[0] && entity.payload.start[1] === 15 && entity.payload.end[1] === 245)
  assert.deepEqual(verticalRules.map(entity => entity.payload.start[0]).sort((a, b) => a - b), [25, 43, 55, 65, 75, 95, 145, 170],
    'the public style preserves the measured nine-column proportions of the accepted CAD form')
  for (const hatch of column.commandArgs.entities.filter(entity => entity.type === 'HATCH')) {
    const xs = hatch.payload.boundaryLoops[0].vertices.map(point => point[0])
    assert.equal(Math.min(...xs), 75)
    assert.equal(Math.max(...xs), 95)
  }
  assert.equal(column.commandArgs.entities.filter(entity => entity.type === 'CIRCLE').length, columnHole.strata.length,
    'the formal style emits editable CAD circles for layer numbers')
  assert.ok(column.commandArgs.entities.some(entity => entity.type === 'LWPOLYLINE' && entity.payload.closed &&
    entity.payload.vertices.some(point => point[0] === 15 && point[1] === 5) &&
    entity.payload.vertices.some(point => point[0] === 195 && point[1] === 282)), 'formal frame follows the 180 mm CAD form instead of the paper edge')

  const left = hole('ZK1', 0, 105.25), right = hole('ZK2', 20, 104.8)
  for (const item of [...left.strata, ...right.strata]) item.name = item.code === '1' ? '填土' : item.code === '2' ? '粉质黏土' : '中砂'
  const section = compileGeologySection({ holes: [left, right], correlations: [
    { fromHoleId: 'ZK1', toHoleId: 'ZK2', fromStratumCode: '1', toStratumCode: '1' },
  ], horizontalScaleDenominator: 500, verticalScaleDenominator: 200, datumElevation: 80,
  surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 })
  const sectionText = section.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const expected of ['工程地质剖面图', '水平比例尺', '里程', '仅显示已提供的地层与对比关系']) assert.ok(sectionText.some(value => value.includes(expected)), expected)
  assert.ok(!sectionText.some(value => /ENGINEERING GEOLOGICAL SECTION|HORIZONTAL 1:|Only supplied strata/u.test(value)))

  const forcedEnglish = compileGeologyColumn({ hole: columnHole, locale: 'en', expectedRevision: 0 })
  assert.ok(forcedEnglish.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text === 'ENGINEERING BOREHOLE LOG'))
})

test('column selects the smallest fitting standard vertical scale and records whether it was automatic or explicit', () => {
  for (const [depths, expected] of [
    [[3, 9, 15], 100],
    [[6, 18, 30], 200],
    [[12, 36, 60], 500],
  ]) {
    const compiled = compileGeologyColumn({ hole: hole(`AUTO-${depths[2]}`, 0, 105.25, depths), expectedRevision: 0 })
    assert.equal(compiled.evidence.parameters.verticalScaleDenominator, expected)
    assert.equal(compiled.evidence.parameters.verticalScaleSource, 'style-standard')
    const labels = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
    assert.ok(labels.some(label => label.includes(`1:${expected}`)))
  }
  const explicit = compileGeologyColumn({ hole: hole('EXPLICIT', 0, 105.25), verticalScaleDenominator: 125, expectedRevision: 0 })
  assert.equal(explicit.evidence.parameters.verticalScaleDenominator, 125)
  assert.equal(explicit.evidence.parameters.verticalScaleSource, 'explicit')
})

test('real projected coordinates are accepted as metadata while unsafe magnitudes are refused', () => {
  const input = { hole: { ...hole('1', 0, 1780.5, [1.5, 3.6, 15]), x: 4017268.61, y: 641811.24 },
    verticalScaleDenominator: 100, expectedRevision: 0 }
  const drawing = compileGeologyColumn(input)
  const texts = drawing.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.ok(texts.some(value => value.includes('4017268.61')))
  const unsafe = structuredClone(input)
  unsafe.hole.x = 1e10
  assert.throws(() => compileGeologyColumn(unsafe), /invalid borehole X coordinate/)
})

test('source-backed major groups keep every thin lens boundary and depth while aggregating major thickness', async () => {
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-major-group-test', version: '1.0.0',
    title: 'Test-authored major log geometry', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'layout', title: 'Test-authored physical columns', license: 'MIT', contentHash: crypto.createHash('sha256').update('260x340 six-column group QA').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255, columns: [20, 40, 60, 82, 100, 145] } } })
  const input = { hole: { id: 'SYNTHETIC-1', collarElevation: 1111.04, depth: 6.8, strata: [
    { intervalId: 'a', groupId: '1', groupRole: 'principal', code: '1_0', name: 'Fill', top: 0, bottom: 0.2, lithology: 'fill' },
    { intervalId: 'b', groupId: '2', groupRole: 'principal', code: '2_0', name: 'Silty clay', top: 0.2, bottom: 1.2, lithology: 'clay' },
    { intervalId: 'c', groupId: '2', groupRole: 'lens', code: '2_1', name: 'Silt lens', top: 1.2, bottom: 2.9, lithology: 'silt' },
    { intervalId: 'd', groupId: '2', groupRole: 'principal', code: '2_0', name: 'Silty clay', top: 2.9, bottom: 6.8, lithology: 'clay' },
  ] }, verticalScaleDenominator: 250, expectedRevision: 0, columnStylePack: style }
  const compiled = compileGeologyColumn(input)
  const texts = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const value of ['0.20', '1.20', '2.90', '6.80', '6.60', '1104.24']) assert.ok(texts.includes(value), value)
  const lines = compiled.commandArgs.entities.filter(entity => entity.type === 'LINE').map(entity => entity.payload)
  assert.ok(lines.some(line => line.start[0] === 20 && line.end[0] === 145 && Math.abs(line.start[1] - 269.2) < 1e-6))
  assert.ok(lines.some(line => line.start[0] === 5 && line.end[0] === 255 && Math.abs(line.start[1] - 246.8) < 1e-6))
  assert.equal(compiled.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 7)
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document: drawing })
  const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  assert.equal((await sdk.readDocument(dxf, { format: 'DXF' })).listEntities().length, compiled.evidence.entityCount)
  const crowded = structuredClone(input)
  crowded.hole.strata.splice(3, 0, { intervalId: 'c2', groupId: '2', groupRole: 'lens', code: '2_2',
    name: 'Thin lens', top: 2.9, bottom: 3.1, lithology: 'silt' })
  crowded.hole.strata[4].top = 3.1
  const crowdedEntities = compileGeologyColumn(crowded).commandArgs.entities
  const depthAt = value => crowdedEntities.find(entity => entity.type === 'TEXT' && entity.payload.text === value).payload.position[1]
  assert.ok(depthAt('2.90') - depthAt('3.10') >= 2.3 - 1e-6, 'Adjacent thin-lens depths must not overlap')
  assert.ok(crowdedEntities.some(entity => entity.type === 'LINE' && entity.payload.start[0] === 15 && entity.payload.end[0] === 19 && entity.payload.start[1] !== entity.payload.end[1]), 'A displaced exact depth needs a leader')
  const incomplete = structuredClone(input); delete incomplete.hole.strata[2].groupRole
  assert.throws(() => compileGeologyColumn(incomplete), /principal\/lens role/)
  const reappearing = structuredClone(input); reappearing.hole.strata[3].groupId = '1'
  assert.throws(() => compileGeologyColumn(reappearing), /may not reappear/)
})

test('versioned header grid uses only present borehole facts and keeps a deep-log legend below the body', async () => {
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-fact-grid-test', version: '1.0.0',
    title: 'Test-authored fact role grid', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'layout', title: 'Original synthetic role geometry', license: 'MIT', contentHash: crypto.createHash('sha256').update('synthetic grid 260x340').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      columns: [20, 40, 60, 82, 100, 145], headerDepth: 56, footerReserve: 30,
      headerGrid: { rows: [
        [{ role: 'projectName', label: '工程名称' }],
        [{ role: 'x', label: 'X坐标' }, { role: 'y', label: 'Y坐标' }, { role: 'holeId', label: '钻孔编号' }],
        [{ role: 'endDate', label: '终孔日期' }, { role: 'collarElevation', label: '孔口标高' }, { role: 'stableWaterDepth', label: '稳定水位' }],
      ] } } } })
  const source = { ...hole('QA-1', 0, 1111.04, [6.8, 15.4, 60]), x: 59333.05, y: 5168.5,
    endDate: '2013-05-12', stableWaterDepth: 5.2 }
  const input = { hole: source, projectName: 'Synthetic project', columnStylePack: style,
    verticalScaleDenominator: 250, expectedRevision: 0 }
  const compiled = compileGeologyColumn(input)
  const texts = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT')
  for (const value of ['Synthetic project', '59333.05', '5168.50', 'QA-1', '2013-05-12', '1111.04', '5.20'])
    assert.ok(texts.some(entity => entity.payload.text === value), value)
  const legend = texts.find(entity => entity.payload.text === 'LITHOLOGY LEGEND')
  assert.ok(legend.payload.position[1] < 34 - 3, 'Legend must not cross a 60 m log body ending at 34 mm')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  assert.equal((await sdk.readDocument(dxf, { format: 'DXF' })).listEntities().length, compiled.evidence.entityCount)
  const missing = structuredClone(input); delete missing.hole.stableWaterDepth
  assert.throws(() => compileGeologyColumn(missing), /declared header fact stableWaterDepth is missing/)
})

test('source-backed physical header cells preserve unequal real-form lanes and separate initial from stable water', async t => {
  const fieldGrid = [
    { start: 5, role: 'layerNumber', label: 'No', headerTextStyle: { main: {
      offset: [1.25, 4.4], height: 2.6, textWidthFactor: 0.85, horizontalAlignment: 'left', verticalAlignment: 'baseline',
    } } }, { start: 15, role: 'layerName', label: 'Name' },
    { start: 33, role: 'baseElevation', label: 'Base', textWidthFactor: 0.7 },
    { start: 45, role: 'thickness', label: 'Thick', textWidthFactor: 0.7 },
    { start: 55, role: 'depth', label: 'Depth', textWidthFactor: 0.7 },
    { start: 65, role: 'pattern', label: 'Pattern', subLabel: '1:{verticalScale}', headerTextStyle: {
      main: { offset: [1.5, 7.1], height: 2.75, textWidthFactor: 0.8, horizontalAlignment: 'left', verticalAlignment: 'baseline' },
      sub: { offset: [2.25, 2.1], height: 2.25, textWidthFactor: 0.9, horizontalAlignment: 'left', verticalAlignment: 'baseline' },
    } },
    { start: 85, role: 'description', label: 'Description' }, { start: 145, role: 'sample', label: 'Sample' },
    { start: 165, role: 'spt', label: 'SPT' },
  ]
  const physicalRows = [
    [{ start: 5, valueStart: 25, role: 'projectName', label: 'Project', textStyle: {
      label: { offset: [1.3, 1.1], height: 2.8, textWidthFactor: 0.8, horizontalAlignment: 'left', verticalAlignment: 'baseline' },
      value: { offset: [1.2, 1.1], height: 2.7, textWidthFactor: 0.85, horizontalAlignment: 'left', verticalAlignment: 'baseline' },
    } },
      { start: 105, valueStart: 125, role: 'documentFact', key: 'projectCode', label: 'Code' },
      { start: 145, valueStart: 165, role: 'holeId', label: 'Hole' }],
    [{ start: 5, valueStart: 25, role: 'x', label: 'X' },
      { start: 55, valueStart: 75, role: 'y', label: 'Y' },
      { start: 105, valueStart: 125, role: 'collarElevation', label: 'Collar' }],
    [{ start: 5, valueStart: 25, role: 'startDate', label: 'Start' },
      { start: 55, valueStart: 75, role: 'endDate', label: 'End' },
      { start: 105, valueStart: 125, role: 'initialWaterDepth', label: 'Initial' },
      { start: 145, valueStart: 165, role: 'stableWaterDepth', label: 'Stable' }],
  ]
  const notationPlacement = (offset, height, horizontalAlignment) => ({ offset, height, textWidthFactor: 1,
    horizontalAlignment, verticalAlignment: 'middle' })
  const notationSet = symbolY => ({
    symbol: notationPlacement([7.5, symbolY], 3, 'center'),
    superscript: notationPlacement([9, symbolY + 1.2], 1.5, 'left'),
    subscript: notationPlacement([9, symbolY - 1.2], 1.5, 'left'),
  })
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-physical-header-test', version: '1.0.0',
    title: 'MIT synthetic unequal header grid', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-header', title: 'MIT-authored unequal header lanes', license: 'MIT',
      contentHash: crypto.createHash('sha256').update('physical header 100-40-40 / 50-50-80 / 50-50-40-40').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] }, rules: { 'geology-column-layout': {
      paperWidth: 190, paperHeight: 290, left: 5, right: 185, headerDepth: 45, headerRowHeight: 5,
      fieldHeaderHeight: 10, footerReserve: 15, titleHeight: 10, verticalScaleDenominators: [100],
      fieldGrid, headerGrid: { rows: physicalRows, continuousDividers: [145, 165] }, footerGrid: { height: 10, cells: [
        { start: 5, key: 'organization', label: 'Organization' }, { start: 65, key: 'checkedBy', label: 'Checked' },
        { start: 125, key: 'drawingNumber', label: 'Drawing', internalDivider: 145, textStyle: {
          label: { offset: [1, 3.2], height: 2.2, textWidthFactor: 0.8, horizontalAlignment: 'left', verticalAlignment: 'baseline' },
          value: { offset: [1.5, 3.2], height: 2.3, textWidthFactor: 0.85, horizontalAlignment: 'left', verticalAlignment: 'baseline' },
        } },
      ] }, legendMode: 'none', textHeights: {
        headerFact: 3, fieldHeader: 3, fieldSubHeader: 2.5, majorValue: 3, intervalDepth: 2.5, observation: 2,
      }, stratigraphicNotationStyle: { symbolHeight: 3, qualifierHeight: 1.5, placement: {
        fieldRole: 'layerName', anchor: 'major-group-midpoint', principal: notationSet(-2), topBoundary: notationSet(-1),
      } },
      intervalDepthTextStyle: { fieldRole: 'depth',
        principal: { offset: [5, 1.2], height: 2.4, textWidthFactor: 0.85, horizontalAlignment: 'center', verticalAlignment: 'middle' },
        lens: { offset: [5, 0], height: 2, textWidthFactor: 0.9, horizontalAlignment: 'center', verticalAlignment: 'middle' } },
      defaultTextStyle: { name: 'GEO-SYNTHETIC-TEXT', fontFamily: 'serif', fontFile: 'serif.ttf', bigFontFile: '',
        fixedHeight: 0, widthFactor: 1, obliqueAngleDegrees: 0, dxfFlags: 0, generationFlags: 0 },
      sampleMarkerStyle: { height: 1, gap: 0.5, baselineOffset: 0.5 },
      sampleAnnotationStyle: { depthAnchor: 'observation-depth',
        label: { offset: [3, 1.1], height: 2, textWidthFactor: 0.9, horizontalAlignment: 'center', verticalAlignment: 'middle' },
        marker: { offset: [7, 1.1], height: 1, textWidthFactor: 0.95, horizontalAlignment: 'center', verticalAlignment: 'middle' } },
      groundwaterAnnotationStyle: { fieldRole: 'pattern', textHeight: 2, markerHeight: 2.5,
        textWidthFactor: 0.8, gap: 0.6, valueOffset: 3, markerOffset: 0, dateOffset: -3, guide: 'field-top-to-reading' },
      patternLabelStyle: { height: 1.5, textWidthFactor: 1, minimumBandHeight: 2 },
      frameStyle: { topMargin: 5, bottomMargin: 5, constantWidth: 0.5 },
      formTopology: { containers: 'outer-frame-separators', headerDividers: 'merge-adjacent-collinear', patternCells: 'closed-outline' },
      textFlow: { firstGroupBorrowMm: 8, firstGroupUnruled: true, firstBaselineMm: 3.4,
        labelPitchMm: 5, labelHeightMm: 2, paragraphGapMm: 0.8 },
      descriptionBoundaryStyle: { inset: 2, clearance: 1.5 },
      titleMarginFacts: [{ key: 'recordNumber', label: 'Record', separator: ':', edge: 'top', anchor: 'right', offset: [-10, -10],
        height: 3, textWidthFactor: 0.8, horizontalAlignment: 'right', verticalAlignment: 'baseline', rotationDegrees: 0,
        decoration: { kind: 'top-edge-elbow-underline', elbowOffset: [-15, -3], horizontalEnd: 'frame-right' } }],
    } } })
  const source = { ...hole('PHYS-1', 0, 123.45, [0.6, 4, 18]), x: 123456.78, y: 654321.09,
    startDate: '2026-01-02', endDate: '2026-01-03', initialWaterDepth: 2.5, stableWaterDepth: 3 }
  source.strata[0].name = 'Fill'; source.strata[1].name = 'Clay'; source.strata[2].name = 'Sand'
  for (const [index, layer] of source.strata.entries()) Object.assign(layer, { groupId: String(index + 1), groupRole: 'principal',
    description: ['Compact fill.', 'Stiff clay.', 'Dense sand.'][index] })
  source.strata[0].stratigraphicNotation = { symbol: 'Q', subscript: '4', superscript: 'ml' }
  source.strata[1].stratigraphicNotation = { symbol: 'Q', subscript: '3' }
  source.strata[1].patternLabel = 'SC'
  source.strata[2].stratigraphicNotation = { symbol: 'N', superscript: 'al' }
  source.observations = [{ kind: 'sample', id: 'S1', depth: 5, sampleMarker: 'filled-circle' }]
  source.groundwaterObservations = [{ depth: 3.25, elevation: 120.2, observedOn: '2026-01-04', marker: 'filled-down-triangle' }]
  const input = { hole: source, projectName: 'Project A', documentFacts: { projectCode: 'P-18', recordNumber: '18', drawingNumber: 'D-7' },
    verticalScaleDenominator: 100, expectedRevision: 0, columnStylePack: style }
  const compiled = compileGeologyColumn(input)
  const texts = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT')
  const declaredTextStyle = compiled.commandArgs.resources.textStyles[0]
  assert.equal(declaredTextStyle.payload.fontFile, 'serif.ttf')
  assert.ok(compiled.commandArgs.entities.filter(entity => ['TEXT', 'MTEXT'].includes(entity.type))
    .every(entity => entity.payload.styleId === declaredTextStyle.id), 'all column text uses the declared source style')
  for (const [value, x] of [['P-18', 127], ['PHYS-1', 167], ['2.50', 127], ['3.00', 167]])
    assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.position[0] === x), `${value} at ${x}`)
  for (const [value, height] of [['Project', 2.8], ['Pattern', 2.75], ['1:100', 2.25], ['Fill', 2], ['0.60', 2.4], ['S1', 2]])
    assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.height === height), `${value} height ${height}`)
  assert.ok(texts.some(entity => entity.payload.text === '0.60' && entity.payload.position[0] === 60 &&
    entity.payload.position[1] === 230.2 && entity.payload.height === 2.4 && entity.payload.widthFactor === 0.85 &&
    entity.payload.horizontalAlignment === 1 && entity.payload.verticalAlignment === 2),
  'principal interval depth uses its source-backed bottom-boundary placement')
  for (const [value, x, y, height, widthFactor] of [
    ['Project', 6.3, 256.1, 2.8, 0.8], ['Project A', 26.2, 256.1, 2.7, 0.85],
  ]) assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.position[0] === x &&
    entity.payload.position[1] === y && entity.payload.height === height && entity.payload.widthFactor === widthFactor &&
    entity.payload.horizontalAlignment == null && entity.payload.alignmentPoint == null), `${value} uses its source-backed table-header placement`)
  for (const [value, x, y, height, widthFactor] of [
    ['Drawing', 126, 8.2, 2.2, 0.8], ['D-7', 146.5, 8.2, 2.3, 0.85],
  ]) assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.position[0] === x &&
    entity.payload.position[1] === y && entity.payload.height === height && entity.payload.widthFactor === widthFactor &&
    entity.payload.horizontalAlignment == null && entity.payload.alignmentPoint == null), `${value} uses its source-backed footer placement`)
  for (const [value, x, y, height, widthFactor] of [
    ['No', 6.25, 239.4, 2.6, 0.85], ['Pattern', 66.5, 242.1, 2.75, 0.8], ['1:100', 67.25, 237.1, 2.25, 0.9],
  ]) assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.position[0] === x &&
    entity.payload.position[1] === y && entity.payload.height === height && entity.payload.widthFactor === widthFactor &&
    entity.payload.horizontalAlignment == null && entity.payload.alignmentPoint == null), `${value} uses its source-backed field-header placement`)
  for (const [value, height] of [['Q', 3], ['4', 1.5], ['ml', 1.5], ['3', 1.5], ['N', 3], ['al', 1.5]])
    assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.height === height), `${value} notation height ${height}`)
  for (const [value, x, y, height, horizontalAlignment] of [
    ['Q', 22.5, 231, 3, 1], ['ml', 24, 232.2, 1.5, 0], ['4', 24, 229.8, 1.5, 0],
    ['3', 24, 208.8, 1.5, 0], ['N', 22.5, 123, 3, 1], ['al', 24, 124.2, 1.5, 0],
  ]) assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.position[0] === x &&
    Math.abs(entity.payload.position[1] - y) < 1e-9 && entity.payload.height === height && entity.payload.widthFactor === 1 &&
    (entity.payload.horizontalAlignment ?? 0) === horizontalAlignment && entity.payload.verticalAlignment === 2),
  `${value} uses its semantic notation placement`)
  assert.ok(texts.some(entity => entity.payload.text === '●' && entity.payload.height === 1), 'filled sample marker')
  for (const [value, x, y, height, widthFactor] of [
    ['S1', 148, 186.1, 2, 0.9], ['●', 152, 186.1, 1, 0.95],
  ]) assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.position[0] === x &&
    entity.payload.position[1] === y && entity.payload.height === height && entity.payload.widthFactor === widthFactor &&
    entity.payload.horizontalAlignment === 1 && entity.payload.verticalAlignment === 2), `${value} uses its source-backed sample annotation placement`)
  for (const [value, height] of [['3.25', 2], ['120.20', 2], ['▼', 2.5], ['2026-01-04', 2]])
    assert.ok(texts.some(entity => entity.payload.text === value && entity.payload.height === height), `${value} groundwater annotation`)
  assert.ok(texts.some(entity => entity.payload.text === 'SC' && entity.payload.height === 1.5 &&
    entity.payload.horizontalAlignment === 1 && entity.payload.verticalAlignment === 2), 'centered pattern lane label')
  assert.ok(texts.some(entity => entity.payload.text === 'Record:18' && entity.payload.position[0] === 180 &&
    entity.payload.position[1] === 280 && entity.payload.height === 3 && entity.payload.widthFactor === 0.8 &&
    entity.payload.horizontalAlignment === 2 && entity.payload.rotation === 0), 'declared title-margin document fact')
  const polylines = compiled.commandArgs.entities.filter(entity => entity.type === 'LWPOLYLINE')
  assert.ok(polylines.some(entity => entity.payload.closed !== true && entity.payload.vertices.length === 3 &&
    JSON.stringify(entity.payload.vertices) === JSON.stringify([[65, 235, 0], [65, 202.5, 0], [85, 202.5, 0]])),
  'declared groundwater guide connects the field top to the exact reading depth')
  assert.ok(polylines.some(entity => entity.payload.closed !== true && entity.payload.vertices.length === 3 &&
    JSON.stringify(entity.payload.vertices) === JSON.stringify([[165, 285, 0], [165, 277, 0], [185, 277, 0]])),
  'declared title-margin decoration connects the frame edge to an exact underline')
  assert.ok(polylines.some(entity => entity.payload.closed === true && entity.payload.constantWidth === 0.5 &&
    entity.payload.vertices[0][0] === 5 && entity.payload.vertices[0][1] === 5 && entity.payload.vertices[2][1] === 285), 'source-backed wide outer frame')
  assert.equal(polylines.filter(entity => entity.payload.closed !== true && entity.payload.vertices.length === 6).length, 3,
    'each major group boundary is one stepped description-lane polyline')
  assert.equal(polylines.filter(entity => entity.payload.closed === true && entity.payload.constantWidth == null &&
    entity.payload.vertices[0][0] === 65 && entity.payload.vertices[1][0] === 85).length, 3,
  'each filled pattern cell keeps one editable closed outline')
  assert.equal(polylines.filter(entity => entity.payload.closed === true && entity.payload.constantWidth == null &&
    entity.payload.vertices.some(vertex => vertex[0] === 5) && entity.payload.vertices.some(vertex => vertex[0] === 185)).length, 0,
  'form containers rely on the outer frame instead of duplicate closed rectangles')
  const headerBottom = 245, headerTop = 260
  const vertical = compiled.commandArgs.entities.filter(entity => entity.type === 'LINE' &&
    entity.payload.start[0] === entity.payload.end[0] && entity.payload.start[1] >= headerBottom && entity.payload.end[1] <= headerTop)
  for (const x of [25, 55, 75, 105, 125, 145, 165]) assert.ok(vertical.some(entity => entity.payload.start[0] === x), `header x=${x}`)
  assert.deepEqual(vertical.filter(entity => entity.payload.start[0] === 25).map(entity =>
    [entity.payload.start[1], entity.payload.end[1]]), [[245, 260]], 'adjacent header dividers merge without crossing a gap')
  for (const x of [145, 165]) assert.deepEqual(vertical.filter(entity => entity.payload.start[0] === x).map(entity =>
    [entity.payload.start[1], entity.payload.end[1]]), [[245, 260]], `declared continuous header divider x=${x} bridges its exact source-row gap`)
  const fullWidthSeparators = compiled.commandArgs.entities.filter(entity => entity.type === 'LINE' &&
    entity.payload.start[0] === 5 && entity.payload.end[0] === 185 && entity.payload.start[1] === entity.payload.end[1])
  for (const y of [260, 255, 250, 245, 235, 15]) assert.ok(fullWidthSeparators.some(entity => entity.payload.start[1] === y), `separator y=${y}`)
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'LINE' && entity.payload.start[0] === 145 &&
    entity.payload.end[0] === 145 && entity.payload.start[1] === 5 && entity.payload.end[1] === 15),
  'declared footer internal divider spans the exact footer height')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF' }), reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD' })
  assert.equal(reopened.validate().valid, true); assert.equal(reopenedKjd.validate().valid, true)
  for (const reopenedDocument of [reopened, reopenedKjd]) {
    const styleRecord = reopenedDocument.getTable('textStyles').records.find(record => record.name === 'GEO-SYNTHETIC-TEXT')
    assert.equal(styleRecord.payload.fontFile, 'serif.ttf')
    assert.ok(reopenedDocument.listEntities().filter(entity => ['TEXT', 'MTEXT'].includes(entity.type))
      .every(entity => entity.payload.styleId === styleRecord.id), 'declared source font survives KJD/DXF reopen')
  }
  for (const reopenedDocument of [reopened, reopenedKjd]) assert.equal(reopenedDocument.listEntities({ type: 'LWPOLYLINE' })
    .filter(entity => entity.payload.closed !== true && entity.payload.vertices.length === 3).length, 2,
  'groundwater guide and title-margin decoration survive KJD/DXF reopen')
  for (const reopenedDocument of [reopened, reopenedKjd]) assert.ok(reopenedDocument.listEntities({ type: 'LINE' }).some(entity =>
    entity.payload.start[0] === 145 && entity.payload.end[0] === 145 &&
    Math.min(entity.payload.start[1], entity.payload.end[1]) === 5 && Math.max(entity.payload.start[1], entity.payload.end[1]) === 15),
  'declared footer internal divider survives KJD/DXF reopen')
  for (const value of ['0.60', '2.50', 'Q', 'ml', 'S1', '●', 'SC', '3.25', '120.20', '▼', '2026-01-04', 'Record:18', 'D-7']) {
    assert.ok(reopened.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === value), `DXF ${value}`)
    assert.ok(reopenedKjd.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === value), `KJD ${value}`)
  }
  const independent = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON || 'python', ['-c',
    'import io,json,os,ezdxf; d=ezdxf.read(io.StringIO(open(os.environ["KJDRAW_FILE_STDIN_PATH"],encoding="utf-8").read())); a=d.audit(); m=d.modelspace(); ts=list(m.query("TEXT")); ps=list(m.query("LWPOLYLINE")); ls=list(m.query("LINE")); xs=sorted({round(e.dxf.start.x,6) for e in ls if abs(e.dxf.start.x-e.dxf.end.x)<1e-9 and e.dxf.start.y>=245 and e.dxf.end.y<=260}); rs=[e for e in ts if e.dxf.text=="Record:18"]; outer=[e for e in ps if e.closed and abs(e.dxf.const_width-.5)<1e-9]; outlines=[e for e in ps if e.closed and abs(e.dxf.const_width)<1e-9 and abs(list(e.get_points())[0][0]-65)<1e-9 and abs(list(e.get_points())[1][0]-85)<1e-9]; containers=[e for e in ps if e.closed and abs(e.dxf.const_width)<1e-9 and min(p[0] for p in e.get_points())==5 and max(p[0] for p in e.get_points())==185]; merged=[[e.dxf.start.y,e.dxf.end.y] for e in ls if abs(e.dxf.start.x-25)<1e-9 and abs(e.dxf.end.x-25)<1e-9 and e.dxf.start.y>=245 and e.dxf.end.y<=260]; separators=sorted({e.dxf.start.y for e in ls if abs(e.dxf.start.y-e.dxf.end.y)<1e-9 and abs(e.dxf.start.x-5)<1e-9 and abs(e.dxf.end.x-185)<1e-9}); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"xs":xs,"texts":[e.dxf.text for e in ts],"record":[[e.dxf.insert.x,e.dxf.insert.y,e.dxf.height,e.dxf.width,e.dxf.halign,e.dxf.valign,e.dxf.rotation] for e in rs],"outer":[[e.dxf.const_width,list(e.get_points())[0][0],list(e.get_points())[0][1],list(e.get_points())[2][1]] for e in outer],"stepped":sum(1 for e in ps if not e.closed and len(e)==6),"outlines":len(outlines),"containers":len(containers),"merged":merged,"separators":separators},ensure_ascii=False))'],
  dxf, { encoding: 'utf8', windowsHide: true, env: { ...process.env,
    PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '', PYTHONIOENCODING: 'utf-8' } })
  if (independent.error?.code === 'ENOENT' || /No module named ['"]ezdxf/u.test(independent.stderr || '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(independent.stderr || independent.error?.message)
    t.diagnostic('official ezdxf unavailable; independent check skipped')
  } else {
    assert.equal(independent.status, 0, independent.stderr)
    const report = JSON.parse(independent.stdout)
    assert.deepEqual([report.errors, report.fixes], [0, 0])
    for (const x of [25, 55, 75, 105, 125, 145, 165]) assert.ok(report.xs.includes(x), `ezdxf header x=${x}`)
    for (const value of ['0.60', '2.50', '3.00', 'Q', 'ml', 'S1', '●', 'SC', '3.25', '120.20', '▼', '2026-01-04', 'Record:18', 'D-7'])
      assert.ok(report.texts.includes(value), `ezdxf ${value}`)
    assert.deepEqual(report.record, [[180, 280, 3, 0.8, 2, 0, 0]])
    assert.deepEqual(report.outer, [[0.5, 5, 5, 285]])
    assert.equal(report.stepped, 3)
    assert.equal(report.outlines, 3)
    assert.equal(report.containers, 0)
    assert.deepEqual(report.merged, [[245, 260]])
    for (const y of [15, 235, 245, 250, 255, 260]) assert.ok(report.separators.includes(y), `ezdxf separator y=${y}`)
  }
  const partial = structuredClone(input)
  delete partial.columnStylePack.rules['geology-column-layout'].headerGrid.rows[0][1].valueStart
  assert.throws(() => compileGeologyColumn(partial), /must declare start and valueStart/u)
  const incompleteHeaderFactPlacement = structuredClone(input)
  delete incompleteHeaderFactPlacement.columnStylePack.rules['geology-column-layout'].headerGrid.rows[0][0].textStyle.value
  assert.throws(() => compileGeologyColumn(incompleteHeaderFactPlacement), /exact label and value placements/u)
  const redundantContinuousDivider = structuredClone(input)
  redundantContinuousDivider.columnStylePack.rules['geology-column-layout'].headerGrid.continuousDividers = [25]
  assert.throws(() => compileGeologyColumn(redundantContinuousDivider), /must bridge an actual source-row gap/u)
  const outside = structuredClone(input)
  outside.hole.initialWaterDepth = 19
  assert.throws(() => compileGeologyColumn(outside), /initial groundwater depth is outside/u)
  const incompleteTextHeights = structuredClone(input)
  delete incompleteTextHeights.columnStylePack.rules['geology-column-layout'].textHeights.observation
  assert.throws(() => compileGeologyColumn(incompleteTextHeights), /exact versioned schema/u)
  const incompleteIntervalDepthStyle = structuredClone(input)
  delete incompleteIntervalDepthStyle.columnStylePack.rules['geology-column-layout'].intervalDepthTextStyle.lens
  assert.throws(() => compileGeologyColumn(incompleteIntervalDepthStyle), /exact declarative field-grid schema/u)
  const incompleteFieldHeaderPlacement = structuredClone(input)
  delete incompleteFieldHeaderPlacement.columnStylePack.rules['geology-column-layout'].fieldGrid[5].headerTextStyle.sub
  assert.throws(() => compileGeologyColumn(incompleteFieldHeaderPlacement), /exactly match the field sublabel/u)
  const incompleteFooterFactPlacement = structuredClone(input)
  delete incompleteFooterFactPlacement.columnStylePack.rules['geology-column-layout'].footerGrid.cells[2].textStyle.value
  assert.throws(() => compileGeologyColumn(incompleteFooterFactPlacement), /exact label and value placements/u)
  const unsafeTextStyle = structuredClone(input)
  unsafeTextStyle.columnStylePack.rules['geology-column-layout'].defaultTextStyle.fontFile = 'https://invalid.example/font.ttf'
  assert.throws(() => compileGeologyColumn(unsafeTextStyle), /invalid default text font file/u)
  const oversizedText = structuredClone(input)
  oversizedText.columnStylePack.rules['geology-column-layout'].textHeights.headerFact = 5
  assert.throws(() => compileGeologyColumn(oversizedText), /do not fit the declared rows/u)
  const missingNotationStyle = structuredClone(input)
  delete missingNotationStyle.columnStylePack.rules['geology-column-layout'].stratigraphicNotationStyle
  assert.throws(() => compileGeologyColumn(missingNotationStyle), /notation facts need a declared/u)
  const incompleteNotationPlacement = structuredClone(input)
  delete incompleteNotationPlacement.columnStylePack.rules['geology-column-layout'].stratigraphicNotationStyle.placement.topBoundary.symbol
  assert.throws(() => compileGeologyColumn(incompleteNotationPlacement), /exact symbol and qualifier placements/u)
  const malformedNotation = structuredClone(input)
  malformedNotation.hole.strata[0].stratigraphicNotation.extra = 'invented'
  assert.throws(() => compileGeologyColumn(malformedNotation), /exact symbol\/qualifier schema/u)
  const missingMarkerStyle = structuredClone(input)
  delete missingMarkerStyle.columnStylePack.rules['geology-column-layout'].sampleMarkerStyle
  assert.throws(() => compileGeologyColumn(missingMarkerStyle), /marker facts need a declared/u)
  const incompleteSampleAnnotationStyle = structuredClone(input)
  delete incompleteSampleAnnotationStyle.columnStylePack.rules['geology-column-layout'].sampleAnnotationStyle.marker
  assert.throws(() => compileGeologyColumn(incompleteSampleAnnotationStyle), /exact declarative field-grid schema/u)
  const invalidMarker = structuredClone(input)
  invalidMarker.hole.observations[0].sampleMarker = 'triangle'
  assert.throws(() => compileGeologyColumn(invalidMarker), /must be a declared marker/u)
  const wrongObservationKind = structuredClone(input)
  Object.assign(wrongObservationKind.hole.observations[0], { kind: 'spt', value: 8 })
  assert.throws(() => compileGeologyColumn(wrongObservationKind), /must be a declared marker/u)
  const missingGroundwaterStyle = structuredClone(input)
  delete missingGroundwaterStyle.columnStylePack.rules['geology-column-layout'].groundwaterAnnotationStyle
  assert.throws(() => compileGeologyColumn(missingGroundwaterStyle), /groundwater observation facts need a declared/u)
  const overlappingGroundwaterStyle = structuredClone(input)
  overlappingGroundwaterStyle.columnStylePack.rules['geology-column-layout'].groundwaterAnnotationStyle.valueOffset = 2
  assert.throws(() => compileGeologyColumn(overlappingGroundwaterStyle), /groundwater annotation style is unreadable/u)
  const invalidGroundwaterGuide = structuredClone(input)
  invalidGroundwaterGuide.columnStylePack.rules['geology-column-layout'].groundwaterAnnotationStyle.guide = 'diagonal'
  assert.throws(() => compileGeologyColumn(invalidGroundwaterGuide), /unsupported groundwater annotation guide/u)
  const mismatchedGroundwaterElevation = structuredClone(input)
  mismatchedGroundwaterElevation.hole.groundwaterObservations[0].elevation = 120.5
  assert.throws(() => compileGeologyColumn(mismatchedGroundwaterElevation), /depth and elevation disagree/u)
  const invalidGroundwaterMarker = structuredClone(input)
  invalidGroundwaterMarker.hole.groundwaterObservations[0].marker = 'open-down-triangle'
  assert.throws(() => compileGeologyColumn(invalidGroundwaterMarker), /unsupported groundwater observation marker/u)
  const inferredGroundwaterFact = structuredClone(input)
  delete inferredGroundwaterFact.hole.groundwaterObservations[0].observedOn
  assert.throws(() => compileGeologyColumn(inferredGroundwaterFact), /needs exact depth, elevation, date and marker/u)
  const missingPatternLabelStyle = structuredClone(input)
  delete missingPatternLabelStyle.columnStylePack.rules['geology-column-layout'].patternLabelStyle
  assert.throws(() => compileGeologyColumn(missingPatternLabelStyle), /pattern label facts need a declared/u)
  const oversizedPatternLabel = structuredClone(input)
  oversizedPatternLabel.hole.strata[1].patternLabel = 'THIS LABEL CANNOT FIT'
  assert.throws(() => compileGeologyColumn(oversizedPatternLabel), /pattern label for 2 does not fit/u)
  const undeclaredTitleFact = structuredClone(input)
  delete undeclaredTitleFact.columnStylePack.rules['geology-column-layout'].titleMarginFacts
  assert.throws(() => compileGeologyColumn(undeclaredTitleFact), /document fact recordNumber is not declared/u)
  const outsideTitleFact = structuredClone(input)
  outsideTitleFact.columnStylePack.rules['geology-column-layout'].titleMarginFacts[0].offset = [20, -10]
  assert.throws(() => compileGeologyColumn(outsideTitleFact), /crosses the title band or drawing frame/u)
  const frameCrossingTitleFact = structuredClone(input)
  frameCrossingTitleFact.columnStylePack.rules['geology-column-layout'].titleMarginFacts[0].offset = [-10, -4]
  assert.throws(() => compileGeologyColumn(frameCrossingTitleFact), /crosses the title band or drawing frame/u)
  const invalidTitleDecoration = structuredClone(input)
  invalidTitleDecoration.columnStylePack.rules['geology-column-layout'].titleMarginFacts[0].decoration.kind = 'freehand'
  assert.throws(() => compileGeologyColumn(invalidTitleDecoration), /unsupported title margin fact decoration/u)
  const malformedFrame = structuredClone(input)
  malformedFrame.columnStylePack.rules['geology-column-layout'].frameStyle.constantWidth = 3
  assert.throws(() => compileGeologyColumn(malformedFrame), /frame style is outside/u)
  const boundaryWithoutFlow = structuredClone(input)
  delete boundaryWithoutFlow.columnStylePack.rules['geology-column-layout'].textFlow
  assert.throws(() => compileGeologyColumn(boundaryWithoutFlow), /description boundary style needs text flow/u)
  const malformedTopology = structuredClone(input)
  malformedTopology.columnStylePack.rules['geology-column-layout'].formTopology.patternCells = 'hatch-only'
  assert.throws(() => compileGeologyColumn(malformedTopology), /unsupported form topology strategy/u)
  const invalidFooterDivider = structuredClone(input)
  invalidFooterDivider.columnStylePack.rules['geology-column-layout'].footerGrid.cells[2].internalDivider = 184
  assert.throws(() => compileGeologyColumn(invalidFooterDivider), /footer cell is out of bounds or unreadable/u)
  const topologyWithoutFooter = structuredClone(input)
  delete topologyWithoutFooter.columnStylePack.rules['geology-column-layout'].footerGrid
  assert.throws(() => compileGeologyColumn(topologyWithoutFooter), /form topology needs field, header and footer grids/u)
})

test('bundled Chinese column header renders the selected physical vertical scale as visible native text', () => {
  const source = hole('比例-1', 0, 1111.04, [6.8, 15.4, 30])
  source.strata[0].name = '填土'
  const compiled = compileGeologyColumn({ hole: source, projectName: '比例尺回归', expectedRevision: 0 })
  const texts = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.equal(compiled.evidence.parameters.verticalScaleDenominator, 150)
  assert.ok(texts.includes('垂直比例尺'))
  assert.ok(texts.includes('1:150'))
})

test('a versioned SPT chart cap affects visible text only, never the raw measured input', () => {
  const pack = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-spt-chart-cap', version: '1.0.0',
    title: 'Original synthetic display convention', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'display-rule', title: 'Synthetic observed chart cap', license: 'MIT', contentHash: crypto.createHash('sha256').update('SPT visible cap 50').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      columns: [20, 40, 60, 82, 100, 145], observationColumns: [205, 228], footerReserve: 30, sptDisplayCap: 50 } } })
  const source = hole('QA-N', 0, 1111.04, [6.8, 15.4, 60])
  source.observations = [{ kind: 'spt', id: 'measured-83', depth: 48.5, value: 83 }]
  const input = { hole: source, columnStylePack: pack, verticalScaleDenominator: 250, expectedRevision: 0 }
  const visible = compileGeologyColumn(input).commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.ok(visible.includes('N=50'))
  assert.ok(!visible.includes('N=83'))
  assert.equal(input.hole.observations[0].value, 83)
  const noCap = structuredClone(input); delete noCap.columnStylePack.rules['geology-column-layout'].sptDisplayCap
  assert.ok(compileGeologyColumn(noCap).commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text === 'N=83'))
  const bypass = structuredClone(input); bypass.hole.observations[0].displayLabel = 'N=83'
  assert.throws(() => compileGeologyColumn(bypass), /display cap cannot coexist/)
})

test('versioned layout aliases adapt visible unit codes and names without altering source intervals', () => {
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-visible-aliases', version: '1.0.0',
    title: 'Test-authored display vocabulary', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-layout', title: 'Test-authored display mapping', license: 'MIT',
      contentHash: crypto.createHash('sha256').update('synthetic display aliases').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 190, paperHeight: 340, left: 5, right: 185,
      columns: [20, 40, 55, 79, 100], observationColumns: [140, 160],
      displayAliases: { codes: { '1_0': '1' }, names: { '黄土状土': '黄土' } } } } })
  const source = hole('1', 0, 1780.5, [1.5, 3.6, 15])
  source.strata[0].code = '1_0'
  source.strata[0].name = '黄土状土'
  const drawing = compileGeologyColumn({ hole: source, verticalScaleDenominator: 100,
    expectedRevision: 0, columnStylePack: style })
  const texts = drawing.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.ok(texts.includes('黄土'))
  assert.ok(texts.includes('1'))
  assert.ok(!texts.includes('黄土状土'))
  assert.equal(source.strata[0].code, '1_0')
  assert.equal(source.strata[0].name, '黄土状土')
  const invalid = structuredClone(style)
  invalid.rules['geology-column-layout'].displayAliases.names['黄土状土'] = '\u0000bad'
  assert.throws(() => compileGeologyColumn({ hole: source, verticalScaleDenominator: 100,
    expectedRevision: 0, columnStylePack: invalid }), /invalid visible names alias/)
})

test('engineering section only connects declared compatible strata, with independent physical scales', async () => {
  const input = {
    holes: [hole('ZK-03', 80, 101.2, [4, 11, 18]), hole('ZK-01', 0, 105.25), hole('ZK-02', 40, 103.3, [3.5, 10, 17])],
    correlations: [
      { fromHoleId: 'ZK-01', toHoleId: 'ZK-02', fromStratumCode: '2', toStratumCode: '2' },
      { fromHoleId: 'ZK-02', toHoleId: 'ZK-03', fromStratumCode: '2', toStratumCode: '2' },
    ],
    horizontalScaleDenominator: 500, verticalScaleDenominator: 200, datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0,
  }
  const result = compileGeologySection(input)
  assert.equal(result.evidence.templateId, 'geology-section-engineering')
  assert.equal(result.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 11)
  assert.ok(result.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text.includes('HORIZONTAL 1:500')))
  assert.ok(result.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text.includes('VERTICAL 1:200')))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  assert.equal(document.revision, 1)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 11)
  assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.name === 'Model')
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 420, paperHeight: 297, paperUnits: 1, plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 420, windowMaxY: 297, flags: 0, scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 } }, { document })
  assert.equal(exportDrawingSvg(document, { layoutId: layout.id }).report.diagnostics.length, 0)
})

test('long engineering log preserves 31 numeric intervals, repeated codes and physical 841 mm bounds', () => {
  const depths = [5.3, 6.5, 13, 17.8, 20.7, 22, 25.2, 26.5, 29.3, 33, 34.1, 37, 40.2, 47.5, 48.6, 49.5, 55.5, 58, 58.7, 60.5, 62, 63.3, 66, 70, 74.2, 77.5, 81.4, 83.5, 85, 100.5, 120]
  const codes = ['2_0', '2_2', '3_0', '5_0', '6_0', '6_1', '6_0', '6_1', '6_0', '7_0', '7_1', '7_0', '7_2', '7_0', '7_1', '7_0', '8_0', '9_0', '9_1', '9_0', '9_1', '9_0', '9_1', '9_0', '10_0', '10_1', '10_0', '10_1', '10_0', '11_0', '12_0']
  const strata = depths.map((bottom, index) => ({ code: codes[index], name: `UNIT ${codes[index]}`, top: index ? depths[index - 1] : 0, bottom, lithology: codes[index].endsWith('_1') ? 'sand' : 'clay' }))
  const result = compileGeologyColumn({ hole: { id: 'ZK-18', collarElevation: 409.68, depth: 120, strata }, verticalScaleDenominator: 200, pageHeightMillimeters: 841, expectedRevision: 0 })
  const texts = result.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.equal(result.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 33)
  assert.equal(texts.filter(text => text === '120.00').length, 1)
  assert.ok(texts.includes('289.68'))
  assert.equal(texts.filter(text => text === '6_0').length, 3)
  for (const entity of result.commandArgs.entities) for (const point of [entity.payload.start, entity.payload.end, entity.payload.position, ...(entity.payload.vertices ?? [])].filter(Boolean)) assert.ok(point[1] >= 0 && point[1] <= 841)
})

test('versioned external pattern pack changes geology style as data, without changing depth geometry', async () => {
  const patSource = '*GEO_FILL,original fill\n0,0,0,0,3\n*GEO_CLAY,original clay\n45,0,0,0,3\n*GEO_SAND,original sand\n0,0,0,0,3,0,-3'
  const pack = buildHatchPatternKnowledgePack({
    id: 'geo-test-patterns', version: '1.0.0', title: 'Original test patterns', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'original-pat', title: 'Test-authored pattern lines', license: 'MIT', contentHash: crypto.createHash('sha256').update(patSource).digest('hex') }],
    patSource, selectedPatterns: ['GEO_FILL', 'GEO_CLAY', 'GEO_SAND'],
    mappings: { fill: 'GEO_FILL', clay: 'GEO_CLAY', sand: 'GEO_SAND' },
  })
  const input = { hole: hole('ZK-01', 0, 105.25), verticalScaleDenominator: 125, expectedRevision: 0 }
  const defaultDrawing = compileGeologyColumn(input), styledDrawing = compileGeologyColumn({ ...input, hatchPack: pack })
  assert.notEqual(defaultDrawing.evidence.packHash, styledDrawing.evidence.packHash)
  assert.equal(defaultDrawing.evidence.entityCount, styledDrawing.evidence.entityCount)
  assert.ok(styledDrawing.commandArgs.entities.filter(entity => entity.type === 'HATCH').every(entity => entity.payload.patternLines?.length === 1))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', styledDrawing.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities({ type: 'HATCH' }).length, 6)
  assert.equal(reopened.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
  const layout = document.snapshot().spaces.layoutIds.map(id => document.getObject(id)).find(record => record?.name === 'Model')
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 210, paperHeight: 297, paperUnits: 1,
    plotType: 4, windowMinX: 0, windowMinY: 0, windowMaxX: 210, windowMaxY: 297, flags: 0,
    scaleNumerator: 1, scaleDenominator: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 } }, { document })
  const preview = exportDrawingSvg(document, { layoutId: layout.id })
  assert.equal(preview.report.diagnostics.length, 0)
  assert.match(preview.svg, /kj-pat-clip-/)
  assert.match(preview.svg, /stroke-dasharray=/)
})

test('declared layout separates project descriptions from measured samples and SPT at exact depths', async () => {
  const source = '300x720 authored seven-column QA layout'
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-seven-column-test', version: '1.0.0',
    title: 'Original test layout', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'layout', title: 'Test-authored layout', license: 'MIT', contentHash: crypto.createHash('sha256').update(source).digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 300, paperHeight: 720, left: 5, right: 295,
      columns: [20, 40, 55, 79, 130], observationColumns: [245, 270] } } })
  const input = { hole: { ...hole('18', 0, 409.68), observations: [
    { kind: 'sample', id: '18-1', depth: 2, displayLabel: '1(2.00)' }, { kind: 'spt', id: '18-SPT-1', depth: 11, value: 50 } ] },
    verticalScaleDenominator: 200, expectedRevision: 0, columnStylePack: style }
  input.hole.strata[0].description = 'Silty clay, measured field description'
  assert.throws(() => compileGeologyColumn({ ...input, columnStylePack: undefined }), /separate declared columns/)
  const result = compileGeologyColumn(input)
  const labels = result.commandArgs.entities.filter(entity => entity.type === 'TEXT')
  assert.ok(labels.some(entity => entity.payload.text === '1(2.00)' && entity.payload.position[0] === 247))
  assert.ok(labels.some(entity => entity.payload.text === 'N=50' && entity.payload.position[0] === 272))
  assert.ok(result.commandArgs.entities.some(entity => entity.type === 'MTEXT' && entity.payload.text.includes('Silty clay') && entity.payload.position[0] === 132 && entity.payload.width > 0))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', result.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities().length, result.evidence.entityCount)
  assert.equal(reopened.listEntities({ type: 'MTEXT' }).length, 1)
  const wide = structuredClone(input); wide.hole.observations[0].displayLabel = 'too-wide-sample-label'
  assert.throws(() => compileGeologyColumn(wide), /label does not fit/)
})

test('repeated project-definition descriptions anchor once, while interval descriptions remain distinct', () => {
  const strata = [
    { intervalId: 'a', code: '7', name: '粉质粘土', top: 0, bottom: 4, lithology: 'clay',
      description: '项目地层定义描述', descriptionSource: 'layer-definition' },
    { intervalId: 'lens', code: '7_1', name: '中砂', top: 4, bottom: 5, lithology: 'sand' },
    { intervalId: 'b', code: '7', name: '粉质粘土', top: 5, bottom: 10, lithology: 'clay',
      description: '项目地层定义描述', descriptionSource: 'layer-definition' },
  ]
  const input = { hole: { id: '18', collarElevation: 409.68, depth: 10, strata },
    verticalScaleDenominator: 200, expectedRevision: 0 }
  const project = compileGeologyColumn(input)
  assert.equal(project.commandArgs.entities.filter(entity => entity.type === 'MTEXT' && entity.payload.text === '项目地层定义描述').length, 1)
  const interval = structuredClone(input)
  interval.hole.strata[0].descriptionSource = 'interval'
  interval.hole.strata[2].descriptionSource = 'interval'
  assert.equal(compileGeologyColumn(interval).commandArgs.entities.filter(entity => entity.type === 'MTEXT' && entity.payload.text === '项目地层定义描述').length, 2)
  const unproven = structuredClone(input); unproven.hole.strata[0].description = undefined
  assert.throws(() => compileGeologyColumn(unproven), /description source requires/)
})

test('long unspaced Chinese geology descriptions remain native bounded MTEXT through DXF reopen', async () => {
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-cjk-mtext-test', version: '1.0.0',
    title: 'Original synthetic CJK role layout', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'text-layout', title: 'Test-authored CJK MTEXT cell', license: 'MIT', contentHash: crypto.createHash('sha256').update('native CJK description').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      columns: [20, 40, 60, 82, 100, 145], observationColumns: [205, 228], footerReserve: 30 } } })
  const source = hole('CJK-1', 0, 1111.04, [6.8, 15.4, 60])
  const paragraph = '黄褐色中密细砂含少量云母碎片'.repeat(8)
  assert.ok([...paragraph].length > 96)
  source.strata[1].description = paragraph
  const compiled = compileGeologyColumn({ hole: source, verticalScaleDenominator: 250, expectedRevision: 0, columnStylePack: style })
  const text = compiled.commandArgs.entities.find(entity => entity.type === 'MTEXT' && entity.payload.text === paragraph)
  assert.ok(text)
  assert.equal(text.payload.width, 56)
  assert.ok(layoutCadMText(text.payload).lines.length > 1, 'CJK without spaces must wrap inside the declared CAD width')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
  for (const copy of [reopened, reopenedKjd])
    assert.ok(copy.listEntities({ type: 'MTEXT' }).some(entity => entity.payload.text === paragraph && entity.payload.width === 56))
  const overlong = structuredClone(source); overlong.strata[1].description = '土'.repeat(513)
  assert.throws(() => compileGeologyColumn({ hole: overlong, verticalScaleDenominator: 250, expectedRevision: 0,
    columnStylePack: style }), /invalid stratum description/u)
})

test('a versioned fourteen-field grid charts direct sample measurements without per-project drawing code', async () => {
  const fieldGrid = [
    { start: 5, role: 'layerNumber', label: '层号' }, { start: 21, role: 'layerName', label: '地层名称' },
    { start: 41, role: 'baseElevation', label: '底标高' }, { start: 56, role: 'thickness', label: '厚度' },
    { start: 71, role: 'depth', label: '层底深度' }, { start: 83, role: 'pattern', label: '岩性花纹' },
    { start: 102, role: 'description', label: '地层描述' }, { start: 171, role: 'sample', label: '取样编号' },
    { start: 186, role: 'measurement', key: 'moisture', decimals: 1, label: '含水率' },
    { start: 195, role: 'measurement', key: 'voidRatio', decimals: 3, label: '孔隙比' },
    { start: 205, role: 'measurement', key: 'liquidIndex', decimals: 2, label: '液性指数' },
    { start: 214, role: 'measurement', key: 'plasticityIndex', decimals: 1, label: '塑性指数' },
    { start: 223, role: 'spt', label: '标贯N' },
    { start: 242, role: 'measurement', key: 'collapseCoefficient', decimals: 3, label: '湿陷系数' },
  ]
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-fourteen-field-test', version: '1.0.0',
    title: 'Test-authored measurement role schema', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'role-grid', title: 'Synthetic fourteen-field grid', license: 'MIT', contentHash: crypto.createHash('sha256').update('synthetic14fieldgrid').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 260, paperHeight: 340, left: 5, right: 255,
      fieldGrid, footerReserve: 30, sptDisplayCap: 50, legendMode: 'none', titleHeight: 9 } } })
  const source = hole('GRID-1', 0, 1111.04, [6.8, 15.4, 60])
  Object.assign(source.strata[0], { intervalId: 'grid-a', groupId: '1', groupRole: 'principal' })
  Object.assign(source.strata[1], { intervalId: 'grid-b', groupId: '2', groupRole: 'lens',
    bottomBoundaryLineVisibility: { depth: 'hidden', pattern: 'hidden' } })
  Object.assign(source.strata[2], { intervalId: 'grid-c', groupId: '2', groupRole: 'principal' })
  source.observations = [
    { kind: 'sample', id: 'R1', depth: 2, displayLabel: '1(2.00)', measurements: {
      moisture: 19.4, voidRatio: 0.715, liquidIndex: 0.43, plasticityIndex: 8.9, collapseCoefficient: 0.003 } },
    { kind: 'spt', id: 'P2', depth: 6.8, value: 12 },
    { kind: 'spt', id: 'P1', depth: 42.5, value: 83 },
  ]
  const input = { hole: source, verticalScaleDenominator: 250, expectedRevision: 0, columnStylePack: style }
  const compiled = compileGeologyColumn(input)
  const visible = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  for (const value of ['19.4', '0.715', '0.43', '8.9', '0.003', 'N=12', 'N=50']) assert.ok(visible.includes(value), value)
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'TEXT' &&
    entity.payload.text === 'ENGINEERING BOREHOLE LOG' && entity.payload.height === 9))
  assert.equal(input.hole.observations[2].value, 83)
  const boundaryY = 340 - 56 - 10 - 6.8 * 4
  const spt = compiled.commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === 'N=12')
  assert.ok(!compiled.commandArgs.entities.some(entity => entity.type === 'LINE' &&
    Math.abs(entity.payload.start[1] - boundaryY) < 1e-6 && Math.abs(entity.payload.end[1] - boundaryY) < 1e-6 &&
    entity.payload.start[0] <= spt.payload.position[0] + 1 && entity.payload.end[0] >= spt.payload.position[0] + 1))
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'HATCH' &&
    Math.min(...entity.payload.boundaryLoops[0].vertices.map(point => point[0])) === 83 &&
    Math.max(...entity.payload.boundaryLoops[0].vertices.map(point => point[0])) === 102))
  const hiddenBoundaryY = 340 - 56 - 10 - 15.4 * 4
  assert.ok(!compiled.commandArgs.entities.some(entity => entity.type === 'LINE' &&
    Math.abs(entity.payload.start[1] - hiddenBoundaryY) < 1e-6 && Math.abs(entity.payload.end[1] - hiddenBoundaryY) < 1e-6 &&
    [[71, 83], [83, 102]].some(([start, end]) => entity.payload.start[0] === start && entity.payload.end[0] === end)),
  'source visibility hides only duplicate depth/pattern rules at the exact interval bottom')
  assert.ok(visible.includes('15.40'), 'hidden boundary line never removes the exact depth fact')
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'HATCH' &&
    entity.payload.boundaryLoops[0].vertices.some(vertex => Math.abs(vertex[1] - hiddenBoundaryY) < 1e-6)),
  'hidden duplicate rule never removes the measured hatch boundary')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  assert.equal((await sdk.readDocument(dxf, { format: 'DXF' })).listEntities().length, compiled.evidence.entityCount)
  const missing = structuredClone(input)
  missing.columnStylePack.rules['geology-column-layout'].fieldGrid = fieldGrid.filter(field => field.role !== 'description')
  assert.throws(() => compileGeologyColumn(missing), /misses a core role/)
  const unsafe = structuredClone(input)
  unsafe.hole.observations[0].measurements.__proto__ = { untracked: 4 }
  unsafe.hole.observations[0].measurements['not-safe!'] = 4
  assert.throws(() => compileGeologyColumn(unsafe), /invalid sampled measurement key/)
  const invalidBoundaryVisibility = structuredClone(input)
  delete invalidBoundaryVisibility.hole.strata[1].bottomBoundaryLineVisibility.pattern
  assert.throws(() => compileGeologyColumn(invalidBoundaryVisibility), /invalid bottom boundary line visibility/u)
  const badTitle = structuredClone(input)
  badTitle.columnStylePack.rules['geology-column-layout'].titleHeight = 30
  assert.throws(() => compileGeologyColumn(badTitle), /title height must be 3–12/)
  const ranged = structuredClone(input)
  ranged.hole.observations[0].depth = 2.075
  ranged.hole.observations[0].rangeTop = 2
  ranged.hole.observations[0].rangeBottom = 2.15
  const rangedCompiled = compileGeologyColumn(ranged)
  assert.ok(rangedCompiled.commandArgs.entities.some(entity => entity.type === 'TEXT' &&
    entity.payload.text === '2.00–2.15'), 'only source-supplied sample endpoints may be charted')
  const rangedLabel = rangedCompiled.commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === '1(2.00)')
  for (const endpoint of [2, 2.15]) {
    const endpointY = 340 - 56 - 10 - endpoint * 4
    assert.ok(rangedCompiled.commandArgs.entities.some(entity => entity.type === 'LINE' &&
      Math.abs(entity.payload.start[1] - endpointY) < 1e-6 &&
      Math.abs(entity.payload.end[1] - endpointY) < 1e-6 &&
      entity.payload.start[0] >= 171 && entity.payload.end[0] <= 186), `sample endpoint ${endpoint}`)
  }
  const rangedTopY = 340 - 56 - 10 - 2 * 4
  assert.ok(!rangedCompiled.commandArgs.entities.some(entity => entity.type === 'LINE' &&
    Math.abs(entity.payload.start[1] - rangedTopY) < 1e-6 && Math.abs(entity.payload.end[1] - rangedTopY) < 1e-6 &&
    entity.payload.start[0] <= rangedLabel.payload.position[0] && entity.payload.end[0] >= rangedLabel.payload.position[0]),
  'the default sample endpoint rule remains collision-safe')

  const continuous = structuredClone(ranged)
  continuous.columnStylePack.rules['geology-column-layout'].sampleRangeBaselineStyle = {
    boundaries: ['top'], continuity: 'continuous', insetMm: 3.5,
  }
  const continuousCompiled = compileGeologyColumn(continuous)
  const sampleLines = continuousCompiled.commandArgs.entities.filter(entity => entity.type === 'LINE' &&
    entity.payload.start[0] >= 171 && entity.payload.end[0] <= 186 &&
    [rangedTopY, 340 - 56 - 10 - 2.15 * 4].some(y => Math.abs(entity.payload.start[1] - y) < 1e-6 && Math.abs(entity.payload.end[1] - y) < 1e-6))
  assert.deepEqual(sampleLines.map(entity => [entity.payload.start.slice(0, 2), entity.payload.end.slice(0, 2)]),
    [[[174.5, rangedTopY], [182.5, rangedTopY]]], 'a source-backed rule emits one uninterrupted inset baseline at the declared boundary')
  const continuousDocument = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', continuousCompiled.commandArgs, { document: continuousDocument })
  for (const format of ['KJD', 'DXF']) {
    const bytes = await sdk.writeDocument(continuousDocument, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const reopened = await sdk.readDocument(bytes, { format })
    const reopenedLines = reopened.listEntities({ type: 'LINE' }).filter(entity =>
      Math.abs(entity.payload.start[0] - 174.5) < 1e-6 && Math.abs(entity.payload.end[0] - 182.5) < 1e-6 &&
      Math.abs(entity.payload.start[1] - rangedTopY) < 1e-6 && Math.abs(entity.payload.end[1] - rangedTopY) < 1e-6)
    assert.equal(reopenedLines.length, 1, `${format} preserves the continuous sample baseline`)
  }
  const invalidBaseline = structuredClone(continuous)
  invalidBaseline.columnStylePack.rules['geology-column-layout'].sampleRangeBaselineStyle.boundaries = ['top', 'top']
  assert.throws(() => compileGeologyColumn(invalidBaseline), /unique top\/bottom roles/)
  const hiddenBaseline = structuredClone(continuous)
  hiddenBaseline.columnStylePack.rules['geology-column-layout'].sampleRangeBaselineStyle.insetMm = 7.4
  assert.throws(() => compileGeologyColumn(hiddenBaseline), /leaves no visible source lane/)
  const rangedDocument = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', rangedCompiled.commandArgs, { document: rangedDocument })
  const rangedDxf = await sdk.writeDocument(rangedDocument, { format: 'DXF', version: '2018' })
  const rangedReopen = await sdk.readDocument(rangedDxf, { format: 'DXF', version: '2018' })
  assert.ok(rangedReopen.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === '2.00–2.15'))
  assert.ok(!visible.some(value => value.includes('–')), 'a point sample without measured endpoints has no invented interval')
  const incomplete = structuredClone(ranged)
  delete incomplete.hole.observations[0].rangeBottom
  assert.throws(() => compileGeologyColumn(incomplete), /require both measured endpoints/)
  const outside = structuredClone(ranged)
  outside.hole.observations[0].rangeTop = 2.1
  assert.throws(() => compileGeologyColumn(outside), /outside its point/)
  const overlap = structuredClone(ranged)
  overlap.hole.observations.push({ kind: 'sample', id: 'R2', depth: 2.13, rangeTop: 2.1, rangeBottom: 2.2 })
  assert.throws(() => compileGeologyColumn(overlap), /intervals overlap/)
})

test('source-backed physical grids omit absent SPT lanes and strict mode rejects unrenderable observations', async () => {
  const fieldGrid = [
    { start: 26, role: 'layerNumber', label: 'No' }, { start: 36, role: 'layerName', label: 'Name' },
    { start: 54, role: 'baseElevation', label: 'Base', textWidthFactor: 0.8 }, { start: 66, role: 'thickness', label: 'Thick' },
    { start: 76, role: 'depth', label: 'Depth' }, { start: 86, role: 'pattern', label: 'Pattern' },
    { start: 106, role: 'description', label: 'Description' }, { start: 166, role: 'sample', label: 'Sample', textWidthFactor: 0.8 },
    { start: 176, role: 'measurement', key: 'collapseCoefficient', label: 'Collapse' },
    { start: 186, role: 'measurement', key: 'compressionCoefficient', label: 'Compress' },
  ]
  const footerGrid = { height: 8, cells: [
    { start: 26, key: 'drawnBy', label: 'Drawn' }, { start: 86, key: 'reviewedBy', label: 'Reviewed' },
    { start: 146, key: 'drawingDate', label: 'Date' },
  ] }
  const sourceSha256 = crypto.createHash('sha256').update('synthetic-native-dwg-vector-evidence').digest('hex')
  const rule = { paperWidth: 210, paperHeight: 340, left: 26, right: 196, fieldGrid, footerGrid,
    footerReserve: 30, legendMode: 'none', sourceTemplate: {
      sourceId: 'synthetic-native-dwg', innerGridWidthMillimeters: 170, verticalScaleDenominator: 200,
      fieldRoles: fieldGrid.map(field => field.role === 'measurement' ? `measurement:${field.key}` : field.role),
      footerLabels: footerGrid.cells.map(cell => cell.label), gridLineHandles: ['A1', 'A2'],
    } }
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'source-vector-grid-test', version: '1.0.0',
    title: 'Synthetic native vector source contract', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-native-dwg', title: 'Synthetic vector grid', license: 'MIT', contentHash: sourceSha256 }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] }, rules: { 'geology-column-layout': rule } })
  const source = hole('SOURCE-1', 0, 1111.04, [10, 20, 30])
  source.observations = [{ kind: 'sample', id: 'R1', depth: 5,
    measurements: { collapseCoefficient: 0.123, compressionCoefficient: 0.234 } }]
  const input = { hole: source, verticalScaleDenominator: 200, expectedRevision: 0,
    columnStylePack: style, strictSourceTemplate: true }
  const compiled = compileGeologyColumn(input)
  assert.equal(compiled.evidence.parameters.sourceGridWidthMillimeters, 170)
  assert.equal(compiled.evidence.parameters.sourceTemplateSha256, sourceSha256)
  const visible = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT').map(entity => entity.payload.text)
  assert.ok(visible.includes('0.12') && visible.includes('0.23'))
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'TEXT' && entity.payload.text === 'Sample' && entity.payload.widthFactor === 0.8))
  assert.ok(!visible.some(value => value.includes('SPT') || value.includes('N=')))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  assert.equal(reopened.listEntities().length, compiled.evidence.entityCount)
  assert.ok(reopened.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === 'Sample' && entity.payload.widthFactor === 0.8))
  const withSpt = structuredClone(input)
  withSpt.hole.observations.push({ kind: 'spt', id: 'P1', depth: 15, value: 9 })
  assert.throws(() => compileGeologyColumn(withSpt), /no physical field for supplied observations/)
  withSpt.strictSourceTemplate = false
  assert.throws(() => compileGeologyColumn(withSpt), /no physical field for supplied observations/,
    'non-strict field grids must not silently discard observations either')
  const wrongScale = structuredClone(input)
  wrongScale.verticalScaleDenominator = 250
  assert.throws(() => compileGeologyColumn(wrongScale), /vertical scale differs from the source template/)
  const wrongWidth = structuredClone(input)
  wrongWidth.columnStylePack.rules['geology-column-layout'].right = 195
  assert.throws(() => compileGeologyColumn(wrongWidth), /vector grid width differs/)
  const invalidTextFactor = structuredClone(input)
  invalidTextFactor.columnStylePack.rules['geology-column-layout'].fieldGrid[2].textWidthFactor = 0.1
  assert.throws(() => compileGeologyColumn(invalidTextFactor), /text width factor must be 0.5–1.5/)
  const missingSptEvidence = structuredClone(input)
  delete missingSptEvidence.columnStylePack.rules['geology-column-layout'].sourceTemplate
  assert.throws(() => compileGeologyColumn(missingSptEvidence), /needs native vector evidence/)
})

test('a declared text lane borrows space for a sourced thin first group without moving depth or hatch boundaries', async () => {
  const grid = [
    { start: 5, role: 'layerNumber', label: 'No' }, { start: 20, role: 'layerName', label: 'Name' },
    { start: 40, role: 'baseElevation', label: 'Base' }, { start: 55, role: 'thickness', label: 'Thick' },
    { start: 70, role: 'depth', label: 'Depth' }, { start: 82, role: 'pattern', label: 'Pattern' },
    { start: 100, role: 'description', label: 'Description' }, { start: 170, role: 'sample', label: 'Sample' },
    { start: 190, role: 'spt', label: 'SPT' },
  ]
  const rule = { paperWidth: 260, paperHeight: 340, left: 5, right: 255, fieldGrid: grid,
    legendMode: 'none', textFlow: { firstGroupBorrowMm: 8, firstGroupUnruled: true,
      firstBaselineMm: 3.4, labelPitchMm: 5, labelHeightMm: 2.7, paragraphGapMm: 1.5 } }
  const style = validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id: 'geo-thin-text-flow', version: '1.0.0',
    title: 'Synthetic source-backed thin text lane', domain: 'geology',
    license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-text', title: 'Synthetic layer paragraphs', license: 'MIT',
      contentHash: crypto.createHash('sha256').update('synthetic-thin-text-flow').digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] }, rules: { 'geology-column-layout': rule } })
  const input = { hole: { id: 'FLOW-1', collarElevation: 1111.04, depth: 10, strata: [
    { intervalId: 'a', groupId: '1', groupRole: 'principal', code: '1', name: 'Fill', top: 0, bottom: 0.2,
      lithology: 'fill', description: '土'.repeat(40) },
    { intervalId: 'b', groupId: '2', groupRole: 'principal', code: '2', name: 'Clay', top: 0.2, bottom: 5,
      lithology: 'clay', description: '黏'.repeat(55) },
    { intervalId: 'c', groupId: '3', groupRole: 'principal', code: '3', name: 'Sand', top: 5, bottom: 10,
      lithology: 'sand' },
  ] }, verticalScaleDenominator: 250, expectedRevision: 0, columnStylePack: style }
  const compiled = compileGeologyColumn(input)
  const firstBottom = 340 - 56 - 10 - 0.2 * 4
  const firstName = compiled.commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === 'Fill')
  const secondName = compiled.commandArgs.entities.find(entity => entity.type === 'TEXT' && entity.payload.text === 'Clay')
  assert.ok(firstName.payload.position[1] < firstBottom)
  assert.ok(secondName.payload.position[1] <= firstName.payload.position[1] - 5)
  assert.equal(compiled.commandArgs.entities.filter(entity => entity.type === 'MTEXT').length, 2)
  const firstBoundaryLines = compiled.commandArgs.entities.filter(entity => entity.type === 'LINE' &&
    Math.abs(entity.payload.start[1] - firstBottom) < 1e-6 && Math.abs(entity.payload.end[1] - firstBottom) < 1e-6)
  assert.ok(firstBoundaryLines.some(entity => entity.payload.start[0] >= 70 && entity.payload.end[0] <= 82))
  assert.ok(firstBoundaryLines.some(entity => entity.payload.start[0] === 82 && entity.payload.end[0] === 100))
  assert.ok(!firstBoundaryLines.some(entity => entity.payload.start[0] <= 20 && entity.payload.end[0] >= 170))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF', version: '2018' }), { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'MTEXT' }).length, 2)
  const noFlow = structuredClone(input)
  delete noFlow.columnStylePack.rules['geology-column-layout'].textFlow
  assert.throws(() => compileGeologyColumn(noFlow), /core labels collide with a boundary/)
  const noBorrow = structuredClone(input)
  noBorrow.columnStylePack.rules['geology-column-layout'].textFlow.firstGroupBorrowMm = 0
  assert.throws(() => compileGeologyColumn(noBorrow), /core labels collide|description collides/)
})

test('twelve sourced CJK layer-name characters reject a 20 mm lane and survive a 39 mm knowledge-pack lane without truncation', async () => {
  const name = '灰黄含砾粉质黏土夹层细砂'
  assert.equal([...name].length, 12)
  const patSource = '*SYNTH_CLAY,synthetic test hatch\n45,0,0,0,3'
  const hatchPack = buildHatchPatternKnowledgePack({ id: 'geo-cjk-lane-pat-test', version: '1.0.0', title: 'Synthetic clay hatch',
    domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-pat', title: 'MIT-authored hatch line', license: 'MIT', contentHash: crypto.createHash('sha256').update(patSource).digest('hex') }],
    patSource, selectedPatterns: ['SYNTH_CLAY'], mappings: { clay: 'SYNTH_CLAY' } })
  const grid = nameEnd => [
    { start: 5, role: 'layerNumber', label: '层号' }, { start: 20, role: 'layerName', label: '地层名' },
    { start: nameEnd, role: 'baseElevation', label: '底标高' }, { start: nameEnd + 15, role: 'thickness', label: '厚度' },
    { start: nameEnd + 30, role: 'depth', label: '层底深度' }, { start: nameEnd + 42, role: 'pattern', label: '花纹' },
    { start: nameEnd + 60, role: 'description', label: '描述' }, { start: nameEnd + 130, role: 'sample', label: '取样' },
    { start: nameEnd + 150, role: 'spt', label: '标贯' },
  ]
  const style = (id, nameEnd) => validateKnowledgePack({ schema: 'kjdraw.knowledge-pack.v1', id, version: '1.0.0',
    title: 'MIT synthetic CJK field lane', domain: 'geology', license: { spdx: 'MIT', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-grid', title: 'MIT-authored CJK lane widths', license: 'MIT',
      contentHash: crypto.createHash('sha256').update(`synthetic CJK name lane ${nameEnd - 20} mm`).digest('hex') }],
    ontology: { objectKinds: ['borehole-log'], relationKinds: [] },
    rules: { 'geology-column-layout': { paperWidth: 300, paperHeight: 340, left: 5, right: 295,
      fieldGrid: grid(nameEnd), legendMode: 'none' } } })
  const narrow = style('geo-cjk-name-lane-20-test', 40), wide = style('geo-cjk-name-lane-39-test', 59)
  const originalNarrow = structuredClone(narrow), originalWide = structuredClone(wide), originalHatch = structuredClone(hatchPack)
  const input = { hole: { id: 'SYN-CJK-12', collarElevation: 105, depth: 10,
    strata: [{ code: '1', name, top: 0, bottom: 10, lithology: 'clay' }] },
  verticalScaleDenominator: 125, expectedRevision: 0, hatchPack }
  assert.throws(() => compileGeologyColumn({ ...input, columnStylePack: narrow }), /layerName text does not fit its declared field/u)
  const compiled = compileGeologyColumn({ ...input, columnStylePack: wide })
  const sourceLabels = compiled.commandArgs.entities.filter(entity => entity.type === 'TEXT' && entity.payload.text === name)
  assert.equal(sourceLabels.length, 1)
  const wideFields = grid(59), layerNameField = wideFields.find(field => field.role === 'layerName')
  const baseElevationField = wideFields.find(field => field.role === 'baseElevation')
  assert.equal(sourceLabels[0].payload.position[0], (layerNameField.start + baseElevationField.start) / 2,
    'formal field values are centred inside their declared physical lane')
  assert.equal(sourceLabels[0].payload.horizontalAlignment, 1)
  assert.ok(compiled.commandArgs.entities.some(entity => entity.type === 'HATCH' && entity.payload.patternLines?.length === 1))
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  assert.equal(document.revision, 1)
  assert.equal(document.listEntities().length, compiled.evidence.entityCount)
  assert.equal(document.validate().valid, true)
  await sdk.executeCommand('UNDO', {}, { document })
  assert.equal(document.listEntities().length, 0)
  assert.equal(document.validate().valid, true)
  await sdk.executeCommand('REDO', {}, { document })
  assert.equal(document.listEntities().length, compiled.evidence.entityCount)
  assert.equal(document.validate().valid, true)
  for (const format of ['KJD', 'DXF']) {
    const reopened = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format }), { format })
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, compiled.evidence.entityCount)
    assert.equal(reopened.listEntities({ type: 'TEXT' }).filter(entity => entity.payload.text === name).length, 1)
    assert.ok(reopened.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternLines?.length === 1))
  }
  assert.equal(input.hole.strata[0].name, name)
  assert.deepEqual(narrow, originalNarrow)
  assert.deepEqual(wide, originalWide)
  assert.deepEqual(hatchPack, originalHatch)
})

test('section targets repeated layer codes by exact interval identity, never an arbitrary first match', () => {
  const repeated = (id, station) => ({ id, station, collarElevation: 105, depth: 10, strata: [
    { intervalId: `${id}-a`, code: '7', name: 'Clay', top: 0, bottom: 3, lithology: 'clay' },
    { intervalId: `${id}-lens`, code: '7_1', name: 'Sand lens', top: 3, bottom: 4, lithology: 'sand' },
    { intervalId: `${id}-b`, code: '7', name: 'Clay', top: 4, bottom: 10, lithology: 'clay' },
  ] })
  const base = { holes: [repeated('A', 0), repeated('B', 20)], horizontalScaleDenominator: 500,
    verticalScaleDenominator: 200, datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }
  assert.throws(() => compileGeologySection({ ...base, correlations: [{ fromHoleId: 'A', toHoleId: 'B', fromStratumCode: '7', toStratumCode: '7' }] }), /unambiguous interval/)
  const exact = compileGeologySection({ ...base, correlations: [{ fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-b', toIntervalId: 'B-b' }] })
  assert.equal(exact.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 7)
  assert.equal(exact.commandArgs.entities.filter(entity => entity.type === 'HATCH' && Math.max(...entity.payload.boundaryLoops[0].vertices.map(point => point[0])) - Math.min(...entity.payload.boundaryLoops[0].vertices.map(point => point[0])) > 20).length, 1)
})

test('section correlations stay between adjacent holes and preserve one-to-one stratigraphic order', () => {
  const sectionHole = (id, station, order = ['clay', 'clay', 'clay']) => ({
    id, station, collarElevation: 105, depth: 12,
    strata: order.map((lithology, index) => ({
      intervalId: `${id}-${index + 1}`, code: `${index + 1}`, name: lithology,
      top: index * 4, bottom: (index + 1) * 4, lithology,
    })),
  })
  const holes = [sectionHole('A', 0), sectionHole('B', 20), sectionHole('C', 40)]
  const base = { holes, horizontalScaleDenominator: 500, verticalScaleDenominator: 200,
    datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }
  assert.throws(() => compileGeologySection({ ...base, correlations: [
    { fromHoleId: 'A', toHoleId: 'C', fromIntervalId: 'A-1', toIntervalId: 'C-1' },
  ] }), /adjacent station-ordered holes/)
  assert.throws(() => compileGeologySection({ ...base, correlations: [
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-1', toIntervalId: 'B-2' },
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-2', toIntervalId: 'B-1' },
  ] }), /cross or reverse stratigraphic order/)
  assert.throws(() => compileGeologySection({ ...base, correlations: [
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-1', toIntervalId: 'B-1' },
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-1', toIntervalId: 'B-2' },
  ] }), /cannot branch into multiple correlations/)
  const compiled = compileGeologySection({ ...base, correlations: [
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-1', toIntervalId: 'B-1' },
    { fromHoleId: 'A', toHoleId: 'B', fromIntervalId: 'A-2', toIntervalId: 'B-2' },
    { fromHoleId: 'B', toHoleId: 'C', fromIntervalId: 'B-1', toIntervalId: 'C-1' },
  ] })
  assert.equal(compiled.commandArgs.entities.filter(entity => entity.type === 'HATCH').length, 12,
    'nine borehole bands plus three non-crossing correlation polygons are preserved')
})

test('engineering geography refuses invented, discontinuous or visually unreadable layers and correlations', () => {
  const base = { hole: hole('ZK-01', 0, 105.25), verticalScaleDenominator: 125, expectedRevision: 0 }
  const gap = structuredClone(base); gap.hole.strata[1].top = 3.1
  assert.throws(() => compileGeologyColumn(gap), /gap, overlap/)
  const thin = structuredClone(base); thin.hole.strata[0].bottom = 0.1; thin.hole.strata[1].top = 0.1
  assert.throws(() => compileGeologyColumn(thin), /too thin/)
  const unknown = structuredClone(base); unknown.hole.strata[1].lithology = 'imaginary-rock'
  assert.throws(() => compileGeologyColumn(unknown), /undeclared lithology/)
  const noRule = { holes: [hole('ZK-01', 0, 105.25), hole('ZK-02', 40, 103.3)], correlations: [], horizontalScaleDenominator: 500, verticalScaleDenominator: 200, datumElevation: 80, expectedRevision: 0 }
  assert.throws(() => compileGeologySection(noRule), /explicit surface connection rule/)
  const noLink = { ...noRule, surfaceRule: 'straight-between-supplied-collars' }
  assert.ok(compileGeologySection(noLink).commandArgs.entities.every(entity => entity.type !== 'HATCH' || entity.payload.boundaryLoops[0].vertices.length === 4))
  const badLink = { ...noLink, correlations: [{ fromHoleId: 'ZK-01', toHoleId: 'ZK-02', fromStratumCode: '2', toStratumCode: 'missing' }] }
  assert.throws(() => compileGeologySection(badLink), /unambiguous interval/)
})
